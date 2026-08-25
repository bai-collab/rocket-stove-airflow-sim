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
const feedbackEl = document.getElementById('feedback');

let selectedTool = 'wall';
let drawing = false;
let running = false;
let ignited = false;
let lastTime = performance.now();

const walls = [];
const inlets = [];
const fires = [];
const chimneys = [];
let particles = [];

const CELL = 24;
const MAX_SPEED = 120;

function pointerPos(evt) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (evt.clientX - r.left) * canvas.width / r.width,
    y: (evt.clientY - r.top) * canvas.height / r.height
  };
}

function snap(v) { return Math.floor(v / CELL) * CELL; }
function hasRect(arr, x, y) { return arr.some(o => o.x === x && o.y === y); }
function blocked(x, y) {
  return walls.some(w => x >= w.x && x <= w.x + CELL && y >= w.y && y <= w.y + CELL);
}

function placeAt(pos) {
  const x = snap(pos.x), y = snap(pos.y);
  if (selectedTool === 'wall') {
    if (!hasRect(walls, x, y)) walls.push({x, y});
  } else if (selectedTool === 'erase') {
    for (const arr of [walls, inlets, fires, chimneys]) {
      const i = arr.findIndex(o => o.x === x && o.y === y);
      if (i >= 0) arr.splice(i, 1);
    }
  } else {
    const map = { inlet: inlets, fire: fires, chimney: chimneys };
    const arr = map[selectedTool];
    if (!hasRect(arr, x, y)) arr.push({x, y});
  }
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
  if (!drawing) return;
  if (selectedTool === 'wall' || selectedTool === 'erase') placeAt(pointerPos(e));
});
canvas.addEventListener('pointerup', () => drawing = false);
canvas.addEventListener('pointercancel', () => drawing = false);

function targetParticleCount() {
  return Math.max(20, Number(particleSlider.value) || 240);
}

function randomOpenPoint() {
  for (let i = 0; i < 80; i++) {
    const x = 8 + Math.random() * (canvas.width - 16);
    const y = 8 + Math.random() * (canvas.height - 16);
    if (!blocked(x, y)) return {x, y};
  }
  return {x: 8, y: 8};
}

function makeAmbientParticle(point = randomOpenPoint()) {
  return {
    x: point.x,
    y: point.y,
    vx: (Math.random() - .5) * 0.5,
    vy: (Math.random() - .5) * 0.5,
    heated: false,
    stagnant: 0
  };
}

function seedAmbientAir() {
  particles = Array.from({length: targetParticleCount()}, () => makeAmbientParticle());
}

function respawnFromSurroundings(p) {
  const edge = Math.floor(Math.random() * 4);
  let point;
  if (edge === 0) point = {x: 3, y: Math.random() * canvas.height};
  else if (edge === 1) point = {x: canvas.width - 3, y: Math.random() * canvas.height};
  else if (edge === 2) point = {x: Math.random() * canvas.width, y: 3};
  else point = {x: Math.random() * canvas.width, y: canvas.height - 3};

  if (blocked(point.x, point.y)) point = randomOpenPoint();
  Object.assign(p, makeAmbientParticle(point));
}

function forceToward(p, sources, radius, strength) {
  let fx = 0, fy = 0;
  for (const s of sources) {
    const sx = s.x + CELL/2, sy = s.y + CELL/2;
    const dx = sx - p.x, dy = sy - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < radius) {
      const k = (1 - d/radius) * strength;
      fx += dx / d * k;
      fy += dy / d * k;
    }
  }
  return {fx, fy};
}

function fireCirculationForce(p) {
  let fx = 0, fy = 0;

  for (const fire of fires) {
    const cx = fire.x + CELL/2;
    const cy = fire.y + CELL/2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.hypot(dx, dy) || 1;

    // 1) Surrounding ambient air is drawn toward the combustion zone.
    const intakeRadius = 320;
    if (dist < intakeRadius) {
      const k = (1 - dist / intakeRadius);
      fx += (-dx / dist) * 18 * k;
      fy += (-dy / dist) * 10 * k;
    }

    // 2) Above the fire, create a broad rising plume.
    // Wider influence makes the circulation visible to students.
    if (p.y < cy + 40) {
      const verticalDistance = Math.max(0, cy - p.y);
      const plumeWidth = 70 + verticalDistance * 0.28;
      const horizontal = Math.abs(p.x - cx);
      if (horizontal < plumeWidth) {
        const centerFactor = 1 - horizontal / plumeWidth;
        const heightFactor = Math.max(0.25, 1 - verticalDistance / 520);
        fy -= 46 * centerFactor * heightFactor;
        fx += (cx - p.x) * 0.018 * centerFactor;
      }
    }

    // 3) Very near the flame, mark air as heated and strengthen buoyancy.
    if (dist < 120) {
      p.heated = true;
      const k = 1 - dist / 120;
      fy -= 42 * k;
    }
  }

  return {fx, fy};
}

function entrainmentForce(p) {
  let fx = 0, fy = 0, count = 0;
  const radius = 85;
  for (const q of particles) {
    if (q === p) continue;
    const dx = q.x - p.x, dy = q.y - p.y;
    const d2 = dx*dx + dy*dy;
    if (d2 > 0 && d2 < radius*radius) {
      const d = Math.sqrt(d2);
      const influence = (1 - d/radius) * 0.085;
      fx += (q.vx - p.vx) * influence;
      fy += (q.vy - p.vy) * influence;
      count++;
      if (count >= 18) break;
    }
  }
  return {fx, fy};
}

function updateParticle(p, dt) {
  let ax = 0, ay = 0;

  if (ignited && fires.length) {
    const f = fireCirculationForce(p);
    ax += f.fx;
    ay += f.fy;
  }

  // Inlets are low-resistance openings, not particle emitters.
  if (ignited && inlets.length) {
    const f = forceToward(p, inlets, 190, 8);
    ax += f.fx;
    ay += f.fy;
  }

  if (ignited && chimneys.length) {
    const f = forceToward(p, chimneys, 260, 24);
    ax += f.fx;
    ay += f.fy - 14;
  }

  if (ignited) {
    const e = entrainmentForce(p);
    ax += e.fx;
    ay += e.fy;
  }

  // Mild damping prevents unforced air from drifting forever.
  p.vx *= Math.pow(0.992, dt * 60);
  p.vy *= Math.pow(0.992, dt * 60);
  p.vx += ax * dt;
  p.vy += ay * dt;

  const speed = Math.hypot(p.vx, p.vy);
  if (speed > MAX_SPEED) {
    p.vx = p.vx / speed * MAX_SPEED;
    p.vy = p.vy / speed * MAX_SPEED;
  }

  const nx = p.x + p.vx * dt;
  const ny = p.y + p.vy * dt;

  if (blocked(nx, p.y)) p.vx *= -0.18;
  else p.x = nx;

  if (blocked(p.x, ny)) p.vy *= -0.18;
  else p.y = ny;

  const currentSpeed = Math.hypot(p.vx, p.vy);
  if (currentSpeed < 3) p.stagnant += dt;
  else p.stagnant = Math.max(0, p.stagnant - dt * .7);

  if (blocked(p.x, p.y)) {
    Object.assign(p, makeAmbientParticle());
  } else if (
    p.x < -12 || p.x > canvas.width + 12 ||
    p.y < -12 || p.y > canvas.height + 12
  ) {
    respawnFromSurroundings(p);
  }
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(148,163,184,.16)';
  ctx.lineWidth = 1;
  for (let x=0; x<canvas.width; x+=CELL) {
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
  }
  for (let y=0; y<canvas.height; y+=CELL) {
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
  }
}

function drawCells(arr, fill, label) {
  ctx.fillStyle = fill;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '16px system-ui';
  for (const o of arr) {
    ctx.fillRect(o.x+1,o.y+1,CELL-2,CELL-2);
    if (label) {
      ctx.fillStyle = '#fff';
      ctx.fillText(label,o.x+CELL/2,o.y+CELL/2);
      ctx.fillStyle = fill;
    }
  }
}

function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawGrid();
  drawCells(walls,'#374151','');
  drawCells(inlets,'#2563eb','↔');
  drawCells(fires, ignited ? '#ea580c' : '#9ca3af','🔥');
  drawCells(chimneys,'#7c3aed','↑');

  for (const p of particles) {
    const sp = Math.hypot(p.vx,p.vy);
    ctx.beginPath();
    ctx.arc(p.x,p.y,Math.min(4.5,1.8+sp/42),0,Math.PI*2);
    ctx.fillStyle = p.heated && ignited ? 'rgba(234,88,12,.80)' : 'rgba(37,99,235,.52)';
    ctx.fill();
  }
}

function updateMetrics() {
  if (!ignited || particles.length === 0) return;
  const speeds = particles.map(p => Math.hypot(p.vx,p.vy));
  const avg = speeds.reduce((a,b)=>a+b,0)/speeds.length;
  const stagnant = particles.filter(p=>p.stagnant>.8).length/particles.length;
  const structureBonus = (inlets.length?10:0) + (fires.length?10:0) + (chimneys.length?18:0);
  const speedPart = Math.min(45, avg/55*45);
  const penalty = stagnant*32;
  const score = Math.max(0,Math.min(100,Math.round(structureBonus+speedPart-penalty+18)));
  flowScoreEl.textContent = score + ' / 100';
  avgSpeedEl.textContent = avg.toFixed(1) + '（相對值）';
  stagnantRateEl.textContent = Math.round(stagnant*100) + '%';

  if (!fires.length) feedbackEl.textContent = '目前沒有火源；加入火源後才能觀察受熱空氣帶動周圍空氣。';
  else if (!chimneys.length) feedbackEl.textContent = '周圍空氣已受到火源帶動；加入煙囪後可觀察上升氣流是否更集中。';
  else if (!inlets.length) feedbackEl.textContent = '沒有標示進氣開口；周圍空氣仍會補入，但加入開口後可觀察主要補氣路徑。';
  else if (stagnant > .55) feedbackEl.textContent = '很多空氣仍接近靜止。看看結構是否阻礙熱空氣上升或周圍空氣補入。';
  else if (score >= 70) feedbackEl.textContent = '點火後已形成較明顯的上升與補氣循環。';
  else feedbackEl.textContent = '已看到周圍空氣被帶動；試著調整火源、進氣開口或煙囪位置再比較。';
}

function loop(now) {
  const dt = Math.min(.033,(now-lastTime)/1000);
  lastTime = now;

  if (running && ignited) {
    particles.forEach(p => updateParticle(p,dt));
    updateMetrics();
  }

  draw();
  requestAnimationFrame(loop);
}

igniteBtn.addEventListener('click',()=>{
  ignited = true;
  running = true;
  lastTime = performance.now();
  igniteBtn.textContent = '🔥 已點火';
  pauseBtn.textContent = '暫停';
  feedbackEl.textContent = '點火了：觀察火焰上方的上升氣流，以及四周空氣向燃燒區補入。';
});

pauseBtn.addEventListener('click',()=>{
  if (!ignited) return;
  running = !running;
  lastTime = performance.now();
  pauseBtn.textContent = running ? '暫停' : '繼續';
});

clearBtn.addEventListener('click',()=>{
  walls.length = inlets.length = fires.length = chimneys.length = 0;
  ignited = false;
  running = false;
  seedAmbientAir();
  igniteBtn.textContent = '🔥 點火';
  pauseBtn.textContent = '暫停';
  flowScoreEl.textContent = avgSpeedEl.textContent = stagnantRateEl.textContent = '—';
  feedbackEl.textContent = '周圍已充滿空氣。先設計火箭爐，再按「點火」。';
});

particleSlider.addEventListener('input',()=>{
  const target = targetParticleCount();
  if (particles.length > target) particles.length = target;
  while (particles.length < target) particles.push(makeAmbientParticle());
});

seedAmbientAir();
feedbackEl.textContent = '周圍已充滿空氣。先設計火箭爐，再按「點火」。';
requestAnimationFrame(loop);
