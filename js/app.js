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
let lastTime = performance.now();
let densityTimer = 0;
let connectivityDirty = true;

const walls = [];
const inlets = [];
const fires = [];
const chimneys = [];
let particles = [];

const CELL = 24;
const MAX_SPEED = 125;
const DENSITY_CELL = 90;
const GRID_COLS = Math.ceil(canvas.width / CELL);
const GRID_ROWS = Math.ceil(canvas.height / CELL);
let regionMap = new Int32Array(GRID_COLS * GRID_ROWS);
let externalRegions = new Set();

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

function wallCellSet() {
  const set = new Set();
  for (const w of walls) {
    const cx = Math.floor(w.x / CELL);
    const cy = Math.floor(w.y / CELL);
    if (cx >= 0 && cx < GRID_COLS && cy >= 0 && cy < GRID_ROWS) {
      set.add(cy * GRID_COLS + cx);
    }
  }
  return set;
}

function rebuildConnectivity() {
  const wallCells = wallCellSet();
  regionMap = new Int32Array(GRID_COLS * GRID_ROWS);
  externalRegions = new Set();
  let nextRegion = 1;

  for (let start = 0; start < regionMap.length; start++) {
    if (wallCells.has(start) || regionMap[start] !== 0) continue;
    const regionId = nextRegion++;
    const queue = [start];
    regionMap[start] = regionId;
    let touchesBoundary = false;

    for (let qi = 0; qi < queue.length; qi++) {
      const idx = queue[qi];
      const x = idx % GRID_COLS;
      const y = Math.floor(idx / GRID_COLS);
      if (x === 0 || y === 0 || x === GRID_COLS - 1 || y === GRID_ROWS - 1) touchesBoundary = true;

      for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
        if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
        const ni = ny * GRID_COLS + nx;
        if (wallCells.has(ni) || regionMap[ni] !== 0) continue;
        regionMap[ni] = regionId;
        queue.push(ni);
      }
    }
    if (touchesBoundary) externalRegions.add(regionId);
  }
  connectivityDirty = false;
}

function ensureConnectivity() { if (connectivityDirty) rebuildConnectivity(); }

function regionAt(x, y) {
  ensureConnectivity();
  if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) return 0;
  const cx = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(x / CELL)));
  const cy = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(y / CELL)));
  return regionMap[cy * GRID_COLS + cx] || 0;
}

function isExternalPoint(x, y) {
  const region = regionAt(x, y);
  return region !== 0 && externalRegions.has(region);
}

function placeAt(pos) {
  const x = snap(pos.x), y = snap(pos.y);
  if (selectedTool === 'wall') {
    if (!hasRect(walls, x, y)) {
      walls.push({x, y});
      connectivityDirty = true;
    }
  } else if (selectedTool === 'erase') {
    for (const arr of [walls, inlets, fires, chimneys]) {
      const i = arr.findIndex(o => o.x === x && o.y === y);
      if (i >= 0) {
        if (arr === walls) connectivityDirty = true;
        arr.splice(i, 1);
      }
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

function targetParticleCount() { return Math.max(20, Number(particleSlider.value) || 240); }

function randomOpenPoint(regionId = null) {
  for (let i = 0; i < 180; i++) {
    const x = 8 + Math.random() * (canvas.width - 16);
    const y = 8 + Math.random() * (canvas.height - 16);
    if (blocked(x, y)) continue;
    if (regionId !== null && regionAt(x, y) !== regionId) continue;
    return {x, y};
  }
  return null;
}

function randomExternalPoint() {
  ensureConnectivity();
  for (let i = 0; i < 220; i++) {
    const point = randomOpenPoint();
    if (point && isExternalPoint(point.x, point.y)) return point;
  }
  return {x: 8, y: 8};
}

function makeAmbientParticle(point = randomExternalPoint(), gas = 'fresh') {
  return {
    x: point.x,
    y: point.y,
    vx: (Math.random() - .5) * 0.4,
    vy: (Math.random() - .5) * 0.4,
    gas,
    heated: false,
    burnExposure: 0,
    stagnant: 0
  };
}

function seedAmbientAir() {
  ensureConnectivity();
  particles = Array.from({length: targetParticleCount()}, () => makeAmbientParticle(randomExternalPoint(), 'fresh'));
}

function respawnFromSurroundings(p) {
  Object.assign(p, makeAmbientParticle(randomExternalPoint(), 'fresh'));
}

function regionParticles(regionId) {
  return particles.filter(p => regionAt(p.x, p.y) === regionId);
}

function oxygenRatioForRegion(regionId) {
  if (!regionId) return 0;
  if (externalRegions.has(regionId)) return 1;
  const ps = regionParticles(regionId);
  if (!ps.length) return 0;
  const fresh = ps.filter(p => p.gas === 'fresh').length;
  return fresh / ps.length;
}

function fireIntensity(fire) {
  if (!ignited) return 0;
  const region = regionAt(fire.x + CELL/2, fire.y + CELL/2);
  const oxygen = oxygenRatioForRegion(region);
  if (oxygen <= 0.12) return 0;
  if (oxygen >= 0.55) return 1;
  return (oxygen - 0.12) / 0.43;
}

function forceToward(p, sources, radius, strength) {
  let fx = 0, fy = 0;
  const sourceRegion = regionAt(p.x, p.y);
  for (const s of sources) {
    const sx = s.x + CELL/2, sy = s.y + CELL/2;
    if (regionAt(sx, sy) !== sourceRegion) continue;
    const dx = sx - p.x, dy = sy - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < radius) {
      const k = (1 - d/radius) * strength;
      fx += dx/d*k;
      fy += dy/d*k;
    }
  }
  return {fx, fy};
}

function fireCirculationForce(p, dt) {
  let fx = 0, fy = 0;
  const pRegion = regionAt(p.x, p.y);

  for (const fire of fires) {
    const cx = fire.x + CELL/2;
    const cy = fire.y + CELL/2;
    if (regionAt(cx, cy) !== pRegion) continue;
    const intensity = fireIntensity(fire);
    if (intensity <= 0) continue;

    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.hypot(dx, dy) || 1;

    const intakeRadius = 460;
    if (dist < intakeRadius) {
      const k = (1 - dist / intakeRadius) * intensity;
      fx += (-dx / dist) * 30 * k;
      fy += (-dy / dist) * 16 * k;
    }

    if (p.y < cy + 55) {
      const verticalDistance = Math.max(0, cy - p.y);
      const plumeWidth = 85 + verticalDistance * 0.34;
      const horizontal = Math.abs(p.x - cx);
      if (horizontal < plumeWidth) {
        const centerFactor = 1 - horizontal / plumeWidth;
        const heightFactor = Math.max(0.28, 1 - verticalDistance / 560);
        fy -= 52 * centerFactor * heightFactor * intensity;
        fx += (cx - p.x) * 0.022 * centerFactor * intensity;
      }
    }

    if (dist < 135) {
      p.heated = true;
      const k = 1 - dist / 135;
      fy -= 48 * k * intensity;

      if (p.gas === 'fresh') {
        p.burnExposure += dt * (0.55 + fires.length * 0.08) * k * intensity;
        if (p.burnExposure >= 0.65) {
          p.gas = 'exhaust';
          p.burnExposure = 0;
        }
      }
    }
  }
  return {fx, fy};
}

function entrainmentForce(p) {
  let fx = 0, fy = 0, count = 0;
  const radius = 105;
  const sourceRegion = regionAt(p.x, p.y);
  for (const q of particles) {
    if (q === p || regionAt(q.x, q.y) !== sourceRegion) continue;
    const dx = q.x-p.x, dy = q.y-p.y;
    const d2 = dx*dx + dy*dy;
    if (d2 > 0 && d2 < radius*radius) {
      const d = Math.sqrt(d2);
      const influence = (1-d/radius)*0.11;
      fx += (q.vx-p.vx)*influence;
      fy += (q.vy-p.vy)*influence;
      if (++count >= 22) break;
    }
  }
  return {fx, fy};
}

function redistributeSparseTracers() {
  if (!ignited || particles.length < 20) return;
  ensureConnectivity();

  const cols = Math.ceil(canvas.width / DENSITY_CELL);
  const rows = Math.ceil(canvas.height / DENSITY_CELL);
  const regionCells = new Map();
  for (let cy=0; cy<rows; cy++) for (let cx=0; cx<cols; cx++) {
    const x = Math.min(canvas.width-1, cx*DENSITY_CELL+DENSITY_CELL/2);
    const y = Math.min(canvas.height-1, cy*DENSITY_CELL+DENSITY_CELL/2);
    const region = regionAt(x,y);
    if (!region) continue;
    if (!regionCells.has(region)) regionCells.set(region, []);
    regionCells.get(region).push({cx,cy});
  }

  let moved = 0;
  const maxMoves = Math.max(2, Math.round(particles.length*0.018));
  for (const [region,cells] of regionCells) {
    if (moved >= maxMoves) break;
    const ps = regionParticles(region);
    if (!ps.length || cells.length < 2) continue;
    const counts = new Map();
    for (const p of ps) {
      const cx = Math.floor(p.x/DENSITY_CELL), cy = Math.floor(p.y/DENSITY_CELL);
      const key = `${cx}:${cy}`;
      counts.set(key, (counts.get(key)||0)+1);
    }
    const expected = ps.length/cells.length;
    const sparse = cells.filter(c => (counts.get(`${c.cx}:${c.cy}`)||0) <= expected*0.28);
    const denseMin = Math.max(2, expected*1.9);
    for (const p of ps) {
      if (moved >= maxMoves || !sparse.length) break;
      const key = `${Math.floor(p.x/DENSITY_CELL)}:${Math.floor(p.y/DENSITY_CELL)}`;
      if ((counts.get(key)||0) < denseMin) continue;
      const target = sparse.splice(Math.floor(Math.random()*sparse.length),1)[0];
      let point = null;
      for (let t=0;t<30;t++) {
        const x = target.cx*DENSITY_CELL + Math.random()*DENSITY_CELL;
        const y = target.cy*DENSITY_CELL + Math.random()*DENSITY_CELL;
        if (x<canvas.width && y<canvas.height && !blocked(x,y) && regionAt(x,y)===region) { point={x,y}; break; }
      }
      if (!point) continue;
      const gas = p.gas;
      Object.assign(p, makeAmbientParticle(point, gas));
      moved++;
    }
  }
}

function updateParticle(p, dt) {
  let ax = 0, ay = 0;

  if (ignited && fires.length) {
    const f = fireCirculationForce(p, dt);
    ax += f.fx; ay += f.fy;
  }
  if (ignited && inlets.length) {
    const f = forceToward(p, inlets, 230, 10);
    ax += f.fx; ay += f.fy;
  }
  if (ignited && chimneys.length) {
    const f = forceToward(p, chimneys, 290, 26);
    ax += f.fx; ay += f.fy - 15;
  }
  if (ignited) {
    const e = entrainmentForce(p);
    ax += e.fx; ay += e.fy;
  }

  p.vx *= Math.pow(0.993, dt*60);
  p.vy *= Math.pow(0.993, dt*60);
  p.vx += ax*dt;
  p.vy += ay*dt;

  const speed = Math.hypot(p.vx,p.vy);
  if (speed > MAX_SPEED) {
    p.vx = p.vx/speed*MAX_SPEED;
    p.vy = p.vy/speed*MAX_SPEED;
  }

  const nx = p.x+p.vx*dt, ny = p.y+p.vy*dt;
  if (blocked(nx,p.y)) p.vx *= -0.18; else p.x = nx;
  if (blocked(p.x,ny)) p.vy *= -0.18; else p.y = ny;

  const currentSpeed = Math.hypot(p.vx,p.vy);
  if (currentSpeed < 3) p.stagnant += dt;
  else p.stagnant = Math.max(0,p.stagnant-dt*0.7);

  const region = regionAt(p.x,p.y);
  if (p.gas === 'exhaust' && externalRegions.has(region) && Math.random() < dt*0.18) {
    p.gas = 'fresh';
    p.heated = false;
  }

  if (blocked(p.x,p.y)) {
    const point = region ? randomOpenPoint(region) : null;
    if (point) Object.assign(p, makeAmbientParticle(point, p.gas));
    else respawnFromSurroundings(p);
  } else if (p.x < -12 || p.x > canvas.width+12 || p.y < -12 || p.y > canvas.height+12) {
    respawnFromSurroundings(p);
  }
}

function drawGrid() {
  ctx.strokeStyle='rgba(148,163,184,.16)'; ctx.lineWidth=1;
  for(let x=0;x<canvas.width;x+=CELL){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
  for(let y=0;y<canvas.height;y+=CELL){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
}

function drawCells(arr, fill, label) {
  ctx.fillStyle=fill; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='16px system-ui';
  for(const o of arr){ctx.fillRect(o.x+1,o.y+1,CELL-2,CELL-2);if(label){ctx.fillStyle='#fff';ctx.fillText(label,o.x+CELL/2,o.y+CELL/2);ctx.fillStyle=fill;}}
}

function drawFires() {
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='16px system-ui';
  for (const fire of fires) {
    const intensity = fireIntensity(fire);
    ctx.fillStyle = intensity > 0 ? `rgba(234,88,12,${0.35+0.65*intensity})` : '#6b7280';
    ctx.fillRect(fire.x+1,fire.y+1,CELL-2,CELL-2);
    ctx.fillStyle='#fff';
    ctx.fillText(intensity > 0 ? '🔥' : '✕', fire.x+CELL/2, fire.y+CELL/2);
  }
}

function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawGrid();
  drawCells(walls,'#374151','');
  drawCells(inlets,'#2563eb','↔');
  drawFires();
  drawCells(chimneys,'#7c3aed','↑');

  for(const p of particles){
    const sp=Math.hypot(p.vx,p.vy);
    ctx.beginPath();
    ctx.arc(p.x,p.y,Math.min(4.5,1.8+sp/42),0,Math.PI*2);
    if (p.gas === 'exhaust') ctx.fillStyle='rgba(107,114,128,.72)';
    else if (p.heated && ignited) ctx.fillStyle='rgba(234,88,12,.80)';
    else ctx.fillStyle='rgba(37,99,235,.52)';
    ctx.fill();
  }
}

function fireRegionSummary() {
  const regions = [...new Set(fires.map(f=>regionAt(f.x+CELL/2,f.y+CELL/2)).filter(Boolean))];
  if (!regions.length) return {oxygen:0, external:false, burning:false};
  const oxygen = Math.min(...regions.map(r=>oxygenRatioForRegion(r)));
  const external = regions.some(r=>externalRegions.has(r));
  const burning = fires.some(f=>fireIntensity(f)>0);
  return {oxygen,external,burning};
}

function updateMetrics() {
  if (!ignited || particles.length===0) return;
  const speeds=particles.map(p=>Math.hypot(p.vx,p.vy));
  const avg=speeds.reduce((a,b)=>a+b,0)/speeds.length;
  const stagnant=particles.filter(p=>p.stagnant>.8).length/particles.length;
  const summary=fireRegionSummary();
  const structureBonus=(inlets.length?10:0)+(fires.length?10:0)+(chimneys.length?18:0);
  const speedPart=Math.min(45,avg/55*45);
  const penalty=stagnant*32;
  const oxygenPenalty = summary.external ? 0 : (1-summary.oxygen)*22;
  const score=Math.max(0,Math.min(100,Math.round(structureBonus+speedPart-penalty-oxygenPenalty+18)));
  flowScoreEl.textContent=score+' / 100';
  avgSpeedEl.textContent=avg.toFixed(1)+'（相對值）';
  stagnantRateEl.textContent=Math.round(stagnant*100)+'%';
  if (oxygenRateEl) oxygenRateEl.textContent=Math.round(summary.oxygen*100)+'%';

  if(!fires.length) feedbackEl.textContent='目前沒有火源；加入火源後才能觀察燃燒與氣流。';
  else if(!summary.burning) feedbackEl.textContent='氧氣不足，火源已熄滅。封閉空間內的燃燒後氣體仍會留在原區域；打開進氣路徑後可重新點火。';
  else if(!summary.external) feedbackEl.textContent=`燃燒區封閉：新鮮空氣約剩 ${Math.round(summary.oxygen*100)}%，燃燒後氣體正在累積，火焰會逐漸變弱。`;
  else if(!chimneys.length) feedbackEl.textContent='燃燒區與外界相通，新鮮空氣可持續補入；加入煙囪後可觀察排氣是否更集中。';
  else if(!inlets.length) feedbackEl.textContent='燃燒區仍與外界連通；加入進氣開口後可更清楚觀察主要補氣路徑。';
  else if(stagnant>.55) feedbackEl.textContent='很多空氣仍接近靜止。看看結構是否阻礙進氣或排氣。';
  else feedbackEl.textContent='目前有持續進氣與排氣；試著改變火源大小、進氣口或煙囪位置再比較。';
}

function loop(now) {
  const dt=Math.min(.033,(now-lastTime)/1000); lastTime=now;
  if(running&&ignited){
    particles.forEach(p=>updateParticle(p,dt));
    densityTimer+=dt;
    if(densityTimer>=.22){redistributeSparseTracers();densityTimer=0;}
    updateMetrics();
  }
  draw();
  requestAnimationFrame(loop);
}

igniteBtn.addEventListener('click',()=>{
  ensureConnectivity();
  ignited=true; running=true; lastTime=performance.now(); densityTimer=0;
  igniteBtn.textContent='🔥 已點火'; pauseBtn.textContent='暫停';
  feedbackEl.textContent='點火了：觀察新鮮空氣、受熱空氣與燃燒後氣體的變化。';
});

pauseBtn.addEventListener('click',()=>{
  if(!ignited)return;
  running=!running; lastTime=performance.now();
  pauseBtn.textContent=running?'暫停':'繼續';
});

clearBtn.addEventListener('click',()=>{
  walls.length=inlets.length=fires.length=chimneys.length=0;
  ignited=false;running=false;densityTimer=0;connectivityDirty=true;
  seedAmbientAir();
  igniteBtn.textContent='🔥 點火';pauseBtn.textContent='暫停';
  flowScoreEl.textContent=avgSpeedEl.textContent=stagnantRateEl.textContent='—';
  if(oxygenRateEl) oxygenRateEl.textContent='—';
  feedbackEl.textContent='周圍已充滿空氣。先設計火箭爐，再按「點火」。';
});

particleSlider.addEventListener('input',()=>{
  ensureConnectivity();
  const target=targetParticleCount();
  if(particles.length>target)particles.length=target;
  while(particles.length<target)particles.push(makeAmbientParticle(randomExternalPoint(),'fresh'));
});

rebuildConnectivity();
seedAmbientAir();
feedbackEl.textContent='周圍已充滿空氣。先設計火箭爐，再按「點火」。';
requestAnimationFrame(loop);
