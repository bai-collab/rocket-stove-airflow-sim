const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

const tools = [...document.querySelectorAll('.tool')];
const igniteBtn = document.getElementById('igniteBtn');
const pauseBtn = document.getElementById('pauseBtn');
const clearBtn = document.getElementById('clearBtn');
const particleSlider = document.getElementById('particleCount');
const flowScoreEl = document.getElementById('flowScore');
const avgSpeedEl = document.getElementById('avgSpeed');
const stagnantRateEl = document.getElementById('stagnantRate');
const oxygenRateEl = document.getElementById('oxygenRate');
const feedbackEl = document.getElementById('feedback');

let selectedTool = 'wall';
let drawing = false;
let running = false;
let ignited = false;
let lastFrame = performance.now();
let accumulator = 0;
let geometryDirty = true;

const walls = [];
const inlets = [];
const fires = [];
const chimneys = [];
let particles = [];

const BUILD_CELL = 24;
const H = 12;
const NX = Math.ceil(canvas.width / H);
const NY = Math.ceil(canvas.height / H);
const N = NX * NY;
const DT = 1 / 30;
const PRESSURE_ITERS = 22;
const AMBIENT_T = 20;
const AMBIENT_O2 = 1.0;
const MAX_T = 700;
const MAX_SPEED = 180;

const G = 9.81;
const BETA = 1 / 293.15;
const PIXELS_PER_METER = 40;
const BUOYANCY_DT_CAP = 140;

const FIRE_AIR_RADIUS = 105;
const FIRE_REACTION_RADIUS = 62;
const FIRE_BRICK_RADIUS = 115;
const FIRE_AIR_HEAT_RATE = 230;
const FIRE_BRICK_HEAT_RATE = 150;
const O2_CONSUMPTION_RATE = 0.10;
const SMOKE_PRODUCTION_RATE = 0.16;
const BRICK_CONDUCTION_RATE = 1.8;
const BRICK_AIR_CONVECTION = 0.70;
const AIR_COOLING_RATE = 0.035;
const SMOKE_DECAY_OPEN = 0.025;

const u = new Float32Array(N);
const v = new Float32Array(N);
const uPrev = new Float32Array(N);
const vPrev = new Float32Array(N);
const pressure = new Float32Array(N);
const pressureNext = new Float32Array(N);
const divergence = new Float32Array(N);
const temperature = new Float32Array(N);
const temperaturePrev = new Float32Array(N);
const oxygen = new Float32Array(N);
const oxygenPrev = new Float32Array(N);
const smoke = new Float32Array(N);
const smokePrev = new Float32Array(N);
const brickTemp = new Float32Array(N);
const brickTempNext = new Float32Array(N);
const solid = new Uint8Array(N);

temperature.fill(AMBIENT_T);
oxygen.fill(AMBIENT_O2);
brickTemp.fill(AMBIENT_T);

function idx(x, y) { return y * NX + x; }
function clamp(v0, lo, hi) { return Math.max(lo, Math.min(hi, v0)); }
function gridX(px) { return clamp(Math.floor(px / H), 0, NX - 1); }
function gridY(py) { return clamp(Math.floor(py / H), 0, NY - 1); }
function inCanvas(x, y) { return x >= 0 && y >= 0 && x < canvas.width && y < canvas.height; }
function isSolidPoint(x, y) {
  if (!inCanvas(x, y)) return false;
  return solid[idx(gridX(x), gridY(y))] === 1;
}
function snap(v0) { return Math.floor(v0 / BUILD_CELL) * BUILD_CELL; }
function hasRect(arr, x, y) { return arr.some(o => o.x === x && o.y === y); }

function pointerPos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * canvas.width / r.width,
    y: (e.clientY - r.top) * canvas.height / r.height
  };
}

function resetFields() {
  u.fill(0); v.fill(0);
  uPrev.fill(0); vPrev.fill(0);
  pressure.fill(0); pressureNext.fill(0); divergence.fill(0);
  temperature.fill(AMBIENT_T); temperaturePrev.fill(AMBIENT_T);
  oxygen.fill(AMBIENT_O2); oxygenPrev.fill(AMBIENT_O2);
  smoke.fill(0); smokePrev.fill(0);
  brickTemp.fill(AMBIENT_T); brickTempNext.fill(AMBIENT_T);
}

function rebuildSolidMask() {
  solid.fill(0);
  for (const wall of walls) {
    const x0 = Math.floor(wall.x / H);
    const y0 = Math.floor(wall.y / H);
    const x1 = Math.ceil((wall.x + BUILD_CELL) / H);
    const y1 = Math.ceil((wall.y + BUILD_CELL) / H);
    for (let gy = y0; gy < y1 && gy < NY; gy++) {
      for (let gx = x0; gx < x1 && gx < NX; gx++) {
        if (gx < 0 || gy < 0) continue;
        const i = idx(gx, gy);
        solid[i] = 1;
        u[i] = 0;
        v[i] = 0;
        temperature[i] = AMBIENT_T;
        oxygen[i] = 0;
        smoke[i] = 0;
        if (brickTemp[i] < AMBIENT_T) brickTemp[i] = AMBIENT_T;
      }
    }
  }
  geometryDirty = false;
  relocateTracersOutOfSolids();
}

function ensureGeometry() {
  if (geometryDirty) rebuildSolidMask();
}

function placeAt(pos) {
  const x = snap(pos.x);
  const y = snap(pos.y);

  if (selectedTool === 'wall') {
    if (!hasRect(walls, x, y)) {
      walls.push({x, y});
      geometryDirty = true;
    }
    return;
  }

  if (selectedTool === 'erase') {
    for (const arr of [walls, inlets, fires, chimneys]) {
      const i = arr.findIndex(o => o.x === x && o.y === y);
      if (i >= 0) {
        arr.splice(i, 1);
        if (arr === walls) geometryDirty = true;
      }
    }
    return;
  }

  const arr = {inlet: inlets, fire: fires, chimney: chimneys}[selectedTool];
  if (arr && !hasRect(arr, x, y)) arr.push({x, y});
}

tools.forEach(btn => btn.addEventListener('click', () => {
  tools.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedTool = btn.dataset.tool;
}));
canvas.addEventListener('pointerdown', e => {
  drawing = true;
  canvas.setPointerCapture(e.pointerId);
  placeAt(pointerPos(e));
});
canvas.addEventListener('pointermove', e => {
  if (drawing && (selectedTool === 'wall' || selectedTool === 'erase')) placeAt(pointerPos(e));
});
canvas.addEventListener('pointerup', () => drawing = false);
canvas.addEventListener('pointercancel', () => drawing = false);

function sampleField(field, px, py, fallback = 0) {
  const gx = px / H - 0.5;
  const gy = py / H - 0.5;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const tx = gx - x0, ty = gy - y0;
  let sum = 0, wsum = 0;

  for (let oy = 0; oy <= 1; oy++) {
    for (let ox = 0; ox <= 1; ox++) {
      const x = x0 + ox, y = y0 + oy;
      if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
      const i = idx(x, y);
      if (solid[i]) continue;
      const w = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty);
      sum += field[i] * w;
      wsum += w;
    }
  }
  return wsum > 1e-6 ? sum / wsum : fallback;
}

function advectField(dst, src, velocityU, velocityV, dt, fallback) {
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) {
        dst[i] = fallback;
        continue;
      }
      const px = (x + 0.5) * H;
      const py = (y + 0.5) * H;
      const bx = px - velocityU[i] * dt;
      const by = py - velocityV[i] * dt;
      dst[i] = sampleField(src, bx, by, src[i]);
    }
  }
}

function copyFluidBoundaries() {
  for (let x = 0; x < NX; x++) {
    for (const y of [0, NY - 1]) {
      const i = idx(x, y);
      if (solid[i]) continue;
      if ((y === 0 && v[i] > 0) || (y === NY - 1 && v[i] < 0) || Math.abs(v[i]) < 3) {
        temperature[i] = AMBIENT_T;
        oxygen[i] = AMBIENT_O2;
        smoke[i] = 0;
      }
    }
  }
  for (let y = 0; y < NY; y++) {
    for (const x of [0, NX - 1]) {
      const i = idx(x, y);
      if (solid[i]) continue;
      if ((x === 0 && u[i] > 0) || (x === NX - 1 && u[i] < 0) || Math.abs(u[i]) < 3) {
        temperature[i] = AMBIENT_T;
        oxygen[i] = AMBIENT_O2;
        smoke[i] = 0;
      }
    }
  }
}

function projectVelocity() {
  pressure.fill(0);
  pressureNext.fill(0);
  divergence.fill(0);

  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) {
        u[i] = 0; v[i] = 0;
        continue;
      }
      const uL = x > 0 && !solid[idx(x - 1, y)] ? u[idx(x - 1, y)] : 0;
      const uR = x < NX - 1 && !solid[idx(x + 1, y)] ? u[idx(x + 1, y)] : 0;
      const vU = y > 0 && !solid[idx(x, y - 1)] ? v[idx(x, y - 1)] : 0;
      const vD = y < NY - 1 && !solid[idx(x, y + 1)] ? v[idx(x, y + 1)] : 0;
      divergence[i] = (uR - uL + vD - vU) / (2 * H);
    }
  }

  for (let iter = 0; iter < PRESSURE_ITERS; iter++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const i = idx(x, y);
        if (solid[i]) {
          pressureNext[i] = 0;
          continue;
        }
        let sum = 0, count = 0;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) {
            count++;
            continue;
          }
          const ni = idx(nx, ny);
          if (solid[ni]) continue;
          sum += pressure[ni];
          count++;
        }
        pressureNext[i] = count ? (sum - divergence[i] * H * H) / count : 0;
      }
    }
    pressure.set(pressureNext);
  }

  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) {
        u[i] = 0; v[i] = 0;
        continue;
      }
      const pC = pressure[i];
      const pL = x > 0 ? (solid[idx(x - 1, y)] ? pC : pressure[idx(x - 1, y)]) : 0;
      const pR = x < NX - 1 ? (solid[idx(x + 1, y)] ? pC : pressure[idx(x + 1, y)]) : 0;
      const pU = y > 0 ? (solid[idx(x, y - 1)] ? pC : pressure[idx(x, y - 1)]) : 0;
      const pD = y < NY - 1 ? (solid[idx(x, y + 1)] ? pC : pressure[idx(x, y + 1)]) : 0;
      u[i] -= (pR - pL) / (2 * H);
      v[i] -= (pD - pU) / (2 * H);
      const s = Math.hypot(u[i], v[i]);
      if (s > MAX_SPEED) {
        u[i] = u[i] / s * MAX_SPEED;
        v[i] = v[i] / s * MAX_SPEED;
      }
    }
  }
  enforceSolidNoFlow();
}

function enforceSolidNoFlow() {
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) {
        u[i] = 0; v[i] = 0;
        continue;
      }
      if (x > 0 && solid[idx(x - 1, y)] && u[i] < 0) u[i] = 0;
      if (x < NX - 1 && solid[idx(x + 1, y)] && u[i] > 0) u[i] = 0;
      if (y > 0 && solid[idx(x, y - 1)] && v[i] < 0) v[i] = 0;
      if (y < NY - 1 && solid[idx(x, y + 1)] && v[i] > 0) v[i] = 0;
    }
  }
}

function lineClear(x0, y0, x1, y1, allowTargetSolid = false) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(2, Math.ceil(Math.hypot(dx, dy) / (H * 0.45)));
  const last = allowTargetSolid ? steps - 1 : steps;
  for (let s = 1; s < last; s++) {
    const t = s / steps;
    if (isSolidPoint(x0 + dx * t, y0 + dy * t)) return false;
  }
  return true;
}

function oxygenAroundFire(fire) {
  const fx = fire.x + BUILD_CELL / 2;
  const fy = fire.y + BUILD_CELL / 2;
  let sum = 0, count = 0;
  const r = 38;
  const gx0 = gridX(fx - r), gx1 = gridX(fx + r);
  const gy0 = gridY(fy - r), gy1 = gridY(fy + r);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const i = idx(gx, gy);
      if (solid[i]) continue;
      const px = (gx + 0.5) * H, py = (gy + 0.5) * H;
      if (Math.hypot(px - fx, py - fy) <= r) {
        sum += oxygen[i];
        count++;
      }
    }
  }
  return count ? sum / count : 0;
}

function fireIntensity(fire) {
  if (!ignited) return 0;
  const o2 = oxygenAroundFire(fire);
  return clamp((o2 - 0.55) / 0.35, 0, 1);
}

function applyFireAndRadiation(dt) {
  for (const fire of fires) {
    const fx = fire.x + BUILD_CELL / 2;
    const fy = fire.y + BUILD_CELL / 2;
    const intensity = fireIntensity(fire);
    if (intensity <= 0) continue;

    const r = Math.max(FIRE_AIR_RADIUS, FIRE_BRICK_RADIUS);
    const gx0 = gridX(fx - r), gx1 = gridX(fx + r);
    const gy0 = gridY(fy - r), gy1 = gridY(fy + r);

    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = idx(gx, gy);
        const px = (gx + 0.5) * H;
        const py = (gy + 0.5) * H;
        const d = Math.hypot(px - fx, py - fy);

        if (solid[i]) {
          if (d <= FIRE_BRICK_RADIUS && lineClear(fx, fy, px, py, true)) {
            const w = 1 - d / FIRE_BRICK_RADIUS;
            brickTemp[i] = clamp(brickTemp[i] + FIRE_BRICK_HEAT_RATE * w * intensity * dt, AMBIENT_T, 550);
          }
          continue;
        }

        if (d <= FIRE_AIR_RADIUS && lineClear(fx, fy, px, py, false)) {
          const w = 1 - d / FIRE_AIR_RADIUS;
          temperature[i] = clamp(temperature[i] + FIRE_AIR_HEAT_RATE * w * intensity * dt, AMBIENT_T, MAX_T);
        }

        if (d <= FIRE_REACTION_RADIUS && lineClear(fx, fy, px, py, false)) {
          const w = 1 - d / FIRE_REACTION_RADIUS;
          oxygen[i] = clamp(oxygen[i] - O2_CONSUMPTION_RATE * w * intensity * dt, 0, 1);
          smoke[i] = clamp(smoke[i] + SMOKE_PRODUCTION_RATE * w * intensity * dt, 0, 1);
        }
      }
    }
  }
}

function updateBrickHeat(dt) {
  brickTempNext.set(brickTemp);
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (!solid[i]) continue;
      let sum = 0, count = 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
        const ni = idx(nx, ny);
        if (!solid[ni]) continue;
        sum += brickTemp[ni];
        count++;
      }
      if (count) {
        const avg = sum / count;
        brickTempNext[i] += (avg - brickTemp[i]) * BRICK_CONDUCTION_RATE * dt;
      }
    }
  }
  brickTemp.set(brickTempNext);

  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (!solid[i]) continue;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
        const ni = idx(nx, ny);
        if (solid[ni]) continue;
        const delta = brickTemp[i] - temperature[ni];
        if (Math.abs(delta) < 0.01) continue;
        const transfer = delta * BRICK_AIR_CONVECTION * dt;
        temperature[ni] = clamp(temperature[ni] + transfer, AMBIENT_T, MAX_T);
        brickTemp[i] = clamp(brickTemp[i] - transfer * 0.10, AMBIENT_T, 550);
      }
    }
  }
}

function addBuoyancy(dt) {
  for (let i = 0; i < N; i++) {
    if (solid[i]) continue;
    const dT = clamp(temperature[i] - AMBIENT_T, 0, BUOYANCY_DT_CAP);
    const ay = -G * BETA * dT * PIXELS_PER_METER;
    v[i] += ay * dt;
  }
}

function coolAndMix(dt) {
  for (let i = 0; i < N; i++) {
    if (solid[i]) continue;
    temperature[i] += (AMBIENT_T - temperature[i]) * AIR_COOLING_RATE * dt;
    smoke[i] = Math.max(0, smoke[i] - SMOKE_DECAY_OPEN * dt);
    oxygen[i] = clamp(oxygen[i], 0, 1);
  }
}

function physicsStep(dt) {
  ensureGeometry();
  applyFireAndRadiation(dt);
  updateBrickHeat(dt);
  addBuoyancy(dt);

  uPrev.set(u);
  vPrev.set(v);
  advectField(u, uPrev, uPrev, vPrev, dt, 0);
  advectField(v, vPrev, uPrev, vPrev, dt, 0);
  projectVelocity();

  temperaturePrev.set(temperature);
  oxygenPrev.set(oxygen);
  smokePrev.set(smoke);
  advectField(temperature, temperaturePrev, u, v, dt, AMBIENT_T);
  advectField(oxygen, oxygenPrev, u, v, dt, AMBIENT_O2);
  advectField(smoke, smokePrev, u, v, dt, 0);

  coolAndMix(dt);
  copyFluidBoundaries();
  updateTracers(dt);
}

function targetParticleCount() {
  return Math.max(80, Number(particleSlider.value) || 240);
}

function randomOpenPoint() {
  for (let tries = 0; tries < 400; tries++) {
    const x = 2 + Math.random() * (canvas.width - 4);
    const y = 2 + Math.random() * (canvas.height - 4);
    if (!isSolidPoint(x, y)) return {x, y};
  }
  return {x: 2, y: 2};
}

function nearestOpenPoint(x, y) {
  if (!isSolidPoint(x, y)) return {x, y};
  const gx = gridX(x), gy = gridY(y);
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
        if (!solid[idx(nx, ny)]) return {x: (nx + 0.5) * H, y: (ny + 0.5) * H};
      }
    }
  }
  return randomOpenPoint();
}

function makeTracer(p) { return {x: p.x, y: p.y, vx: 0, vy: 0}; }

function seedTracers() {
  ensureGeometry();
  particles = [];
  const target = targetParticleCount();
  for (let i = 0; i < target; i++) particles.push(makeTracer(randomOpenPoint()));
}

function boundarySpawnForFlow() {
  const candidates = [];
  for (let x = 0; x < NX; x++) {
    const top = idx(x, 0), bottom = idx(x, NY - 1);
    if (!solid[top] && v[top] > 0.5) candidates.push({x:(x+0.5)*H,y:1});
    if (!solid[bottom] && v[bottom] < -0.5) candidates.push({x:(x+0.5)*H,y:canvas.height-1});
  }
  for (let y = 0; y < NY; y++) {
    const left = idx(0, y), right = idx(NX - 1, y);
    if (!solid[left] && u[left] > 0.5) candidates.push({x:1,y:(y+0.5)*H});
    if (!solid[right] && u[right] < -0.5) candidates.push({x:canvas.width-1,y:(y+0.5)*H});
  }
  if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];

  for (let tries = 0; tries < 100; tries++) {
    const side = Math.floor(Math.random() * 4);
    let p;
    if (side === 0) p = {x:1,y:Math.random()*canvas.height};
    if (side === 1) p = {x:canvas.width-1,y:Math.random()*canvas.height};
    if (side === 2) p = {x:Math.random()*canvas.width,y:1};
    if (side === 3) p = {x:Math.random()*canvas.width,y:canvas.height-1};
    if (!isSolidPoint(p.x, p.y)) return p;
  }
  return randomOpenPoint();
}

function relocateTracersOutOfSolids() {
  for (const p of particles) {
    if (isSolidPoint(p.x, p.y)) {
      const q = nearestOpenPoint(p.x, p.y);
      p.x = q.x; p.y = q.y; p.vx = 0; p.vy = 0;
    }
  }
}

function sampleVelocity(px, py) {
  return {x: sampleField(u, px, py, 0), y: sampleField(v, px, py, 0)};
}

function updateTracers(dt) {
  for (const p of particles) {
    const vel = sampleVelocity(p.x, p.y);
    p.vx = vel.x;
    p.vy = vel.y;
    const nx = p.x + p.vx * dt;
    const ny = p.y + p.vy * dt;

    if (!inCanvas(nx, ny)) {
      const q = boundarySpawnForFlow();
      p.x = q.x; p.y = q.y; p.vx = 0; p.vy = 0;
      continue;
    }

    if (isSolidPoint(nx, ny)) {
      if (!isSolidPoint(nx, p.y)) p.x = nx;
      if (!isSolidPoint(p.x, ny)) p.y = ny;
      p.vx = 0; p.vy = 0;
    } else {
      p.x = nx; p.y = ny;
    }
  }
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(148,163,184,.13)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += BUILD_CELL) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += BUILD_CELL) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}

function drawTemperatureField() {
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) continue;
      const dT = temperature[i] - AMBIENT_T;
      if (dT < 25) continue;
      const alpha = clamp(dT / 450, 0, 0.16);
      ctx.fillStyle = `rgba(249,115,22,${alpha})`;
      ctx.fillRect(x * H, y * H, H + 1, H + 1);
    }
  }
}

function drawCells(arr, fill, label) {
  ctx.fillStyle = fill;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '16px system-ui';
  for (const o of arr) {
    ctx.fillRect(o.x + 1, o.y + 1, BUILD_CELL - 2, BUILD_CELL - 2);
    if (label) {
      ctx.fillStyle = '#fff';
      ctx.fillText(label, o.x + BUILD_CELL / 2, o.y + BUILD_CELL / 2);
      ctx.fillStyle = fill;
    }
  }
}

function drawBrickWalls() {
  for (const wall of walls) {
    let sum = 0, count = 0;
    const x0 = Math.floor(wall.x / H), y0 = Math.floor(wall.y / H);
    const x1 = Math.ceil((wall.x + BUILD_CELL) / H), y1 = Math.ceil((wall.y + BUILD_CELL) / H);
    for (let gy = y0; gy < y1 && gy < NY; gy++) {
      for (let gx = x0; gx < x1 && gx < NX; gx++) {
        const i = idx(gx, gy);
        if (solid[i]) { sum += brickTemp[i]; count++; }
      }
    }
    const t = count ? sum / count : AMBIENT_T;
    const hot = clamp((t - AMBIENT_T) / 300, 0, 1);
    const r = Math.round(55 + 115 * hot);
    const g = Math.round(65 + 35 * hot);
    const b = Math.round(81 - 45 * hot);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(wall.x + 1, wall.y + 1, BUILD_CELL - 2, BUILD_CELL - 2);
  }
}

function drawFires() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '16px system-ui';
  for (const fire of fires) {
    const intensity = fireIntensity(fire);
    ctx.fillStyle = intensity > 0 ? `rgba(234,88,12,${0.35 + 0.65 * intensity})` : '#6b7280';
    ctx.fillRect(fire.x + 1, fire.y + 1, BUILD_CELL - 2, BUILD_CELL - 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(intensity > 0 ? '🔥' : '✕', fire.x + BUILD_CELL / 2, fire.y + BUILD_CELL / 2);
  }
}

function drawTracers() {
  for (const p of particles) {
    const t = sampleField(temperature, p.x, p.y, AMBIENT_T);
    const s = sampleField(smoke, p.x, p.y, 0);
    const speed = Math.hypot(p.vx, p.vy);
    ctx.beginPath();
    ctx.arc(p.x, p.y, clamp(1.8 + speed / 90, 1.8, 4.2), 0, Math.PI * 2);
    if (s > 0.12) ctx.fillStyle = `rgba(75,85,99,${clamp(0.48 + s * 0.45, 0.48, 0.92)})`;
    else if (t > 40) ctx.fillStyle = 'rgba(234,88,12,.72)';
    else ctx.fillStyle = 'rgba(37,99,235,.52)';
    ctx.fill();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  drawTemperatureField();
  drawBrickWalls();
  drawCells(inlets, '#2563eb', '↔');
  drawFires();
  drawCells(chimneys, '#7c3aed', '↑');
  drawTracers();
}

function averageFireOxygen() {
  if (!fires.length) return 0;
  return fires.reduce((sum, f) => sum + oxygenAroundFire(f), 0) / fires.length;
}

function updateMetrics() {
  let speedSum = 0, fluidCount = 0, stagnant = 0;
  for (let i = 0; i < N; i++) {
    if (solid[i]) continue;
    const s = Math.hypot(u[i], v[i]);
    speedSum += s;
    fluidCount++;
    if (s < 2.0) stagnant++;
  }
  const avg = fluidCount ? speedSum / fluidCount : 0;
  const stagnantRate = fluidCount ? stagnant / fluidCount : 0;
  const o2 = averageFireOxygen();
  const burning = fires.some(f => fireIntensity(f) > 0);
  const score = Math.round(clamp(25 + Math.min(45, avg / 1.5) - stagnantRate * 25 + (burning ? 20 : 0), 0, 100));

  flowScoreEl.textContent = score + ' / 100';
  avgSpeedEl.textContent = avg.toFixed(1) + '（相對值）';
  stagnantRateEl.textContent = Math.round(stagnantRate * 100) + '%';
  if (oxygenRateEl) oxygenRateEl.textContent = Math.round(o2 * 100) + '%';

  if (!fires.length) {
    feedbackEl.textContent = '目前沒有火源。';
  } else if (!burning) {
    feedbackEl.textContent = '燃燒區氧氣不足，火源已熄滅。封閉空間中的燃燒後氣體不會穿過磚牆。';
  } else {
    feedbackEl.textContent = 'Physics v2：火源先加熱溫度場，再由浮力與壓力場帶動空氣；磚牆會阻擋直火並透過導熱間接加熱另一側空氣。';
  }
}

function frame(now) {
  const elapsed = Math.min(0.08, (now - lastFrame) / 1000);
  lastFrame = now;

  if (running && ignited) {
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= DT && steps < 3) {
      physicsStep(DT);
      accumulator -= DT;
      steps++;
    }
    updateMetrics();
  }

  if (geometryDirty) ensureGeometry();
  draw();
  requestAnimationFrame(frame);
}

igniteBtn.addEventListener('click', () => {
  ensureGeometry();
  ignited = true;
  running = true;
  accumulator = 0;
  lastFrame = performance.now();
  igniteBtn.textContent = '🔥 已點火';
  pauseBtn.textContent = '暫停';
});

pauseBtn.addEventListener('click', () => {
  if (!ignited) return;
  running = !running;
  lastFrame = performance.now();
  pauseBtn.textContent = running ? '暫停' : '繼續';
});

clearBtn.addEventListener('click', () => {
  walls.length = 0;
  inlets.length = 0;
  fires.length = 0;
  chimneys.length = 0;
  ignited = false;
  running = false;
  accumulator = 0;
  geometryDirty = true;
  resetFields();
  ensureGeometry();
  seedTracers();
  igniteBtn.textContent = '🔥 點火';
  pauseBtn.textContent = '暫停';
  flowScoreEl.textContent = avgSpeedEl.textContent = stagnantRateEl.textContent = '—';
  if (oxygenRateEl) oxygenRateEl.textContent = '—';
  if (typeof window.physicsV26ResetDiagnostics === 'function') window.physicsV26ResetDiagnostics();
  for (const id of [
    'continuityValue', 'stackPressureValue', 'stackHeightValue', 'stackFluxValue',
    'pressureResidualValue', 'projectedFluxValue', 'particleStatus', 'boundaryAirRate',
    'boundaryTopology', 'boundaryDensity', 'boundaryBandStatus', 'secondaryBurnRate',
    'unburnedGasRate', 'smokeLevelRate', 'smokeOutRate', 'ashRate', 'ashFate'
  ]) {
    const metric = document.getElementById(id);
    if (metric) metric.textContent = '—';
  }
  feedbackEl.textContent = 'Physics v2 已重置。先建立爐體，再按「點火」。';
});

particleSlider.addEventListener('input', () => {
  const target = targetParticleCount();
  if (particles.length > target) {
    if (window.tracerV25?.trimOpenPopulation) window.tracerV25.trimOpenPopulation(target);
    else particles.length = target;
  } else {
    while (particles.length < target) {
      const p = ignited ? boundarySpawnForFlow() : randomOpenPoint();
      particles.push(makeTracer(p));
    }
  }
});

ensureGeometry();
seedTracers();
requestAnimationFrame(frame);
