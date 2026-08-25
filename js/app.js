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

function pointerPos(evt) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (evt.clientX - r.left) * canvas.width / r.width,
    y: (evt.clientY - r.top) * canvas.height / r.height
  };
}

function snap(v) { return Math.floor(v / CELL) * CELL; }
function hasRect(arr, x, y) { return arr.some(o => o.x === x && o.y === y); }
function blocked(x, y) { return walls.some(w => x >= w.x && x <= w.x + CELL && y >= w.y && y <= w.y + CELL); }

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

function spawnParticle() {
  let x = 5, y = Math.random() * canvas.height;
  if (inlets.length) {
    const inlet = inlets[Math.floor(Math.random() * inlets.length)];
    x = inlet.x + CELL * 0.5;
    y = inlet.y + CELL * 0.5 + (Math.random() - .5) * CELL * .6;
  }
  return {x, y, vx: 18 + Math.random() * 10, vy:(Math.random()-.5)*5, age:0, heated:false, stagnant:0};
}

function resetParticles() {
  const count = Number(particleSlider.value);
  particles = Array.from({length: count}, spawnParticle);
}

function nearestForce(p, sources, radius, strength, upwardOnly=false) {
  let fx = 0, fy = 0;
  for (const s of sources) {
    const sx = s.x + CELL/2, sy = s.y + CELL/2;
    const dx = sx - p.x, dy = sy - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < radius) {
      const k = (1 - d/radius) * strength;
      if (upwardOnly) fy -= k;
      else { fx += dx/d*k; fy += dy/d*k; }
    }
  }
  return {fx, fy};
}

function updateParticle(p, dt) {
  p.age += dt;
  let ax = 7, ay = 0;

  if (inlets.length) {
    const f = nearestForce(p, inlets, 140, 18);
    ax += f.fx * .15; ay += f.fy * .15;
  }

  if (ignited && fires.length) {
    for (const fire of fires) {
      const cx = fire.x + CELL/2, cy = fire.y + CELL/2;
      const d = Math.hypot(p.x-cx, p.y-cy);
      if (d < 95) {
        p.heated = true;
        ay -= (1-d/95) * 34;
        ax += 3;
      }
    }
  }

  if (ignited && chimneys.length) {
    const f = nearestForce(p, chimneys, 190, 26);
    ax += f.fx; ay += f.fy - 10;
  }

  if (p.heated) ay -= 10;

  p.vx += ax * dt;
  p.vy += ay * dt;
  const speed = Math.hypot(p.vx,p.vy);
  const maxSpeed = 115;
  if (speed > maxSpeed) { p.vx = p.vx/speed*maxSpeed; p.vy = p.vy/speed*maxSpeed; }

  const nx = p.x + p.vx * dt;
  const ny = p.y + p.vy * dt;

  if (blocked(nx, p.y)) p.vx *= -0.35; else p.x = nx;
  if (blocked(p.x, ny)) p.vy *= -0.35; else p.y = ny;

  const s2 = Math.hypot(p.vx,p.vy);
  if (s2 < 8) p.stagnant += dt; else p.stagnant = Math.max(0,p.stagnant-dt*.5);

  if (p.x < -20 || p.x > canvas.width+20 || p.y < -30 || p.y > canvas.height+30 || p.age > 18) {
    Object.assign(p, spawnParticle());
  }
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(148,163,184,.16)';
  ctx.lineWidth = 1;
  for (let x=0; x<canvas.width; x+=CELL) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
  for (let y=0; y<canvas.height; y+=CELL) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
}

function drawCells(arr, fill, label) {
  ctx.fillStyle = fill;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '16px system-ui';
  for (const o of arr) {
    ctx.fillRect(o.x+1,o.y+1,CELL-2,CELL-2);
    if (label) { ctx.fillStyle = '#fff'; ctx.fillText(label,o.x+CELL/2,o.y+CELL/2); ctx.fillStyle = fill; }
  }
}

function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawGrid();
  drawCells(walls,'#374151','');
  drawCells(inlets,'#2563eb','→');
  drawCells(fires, ignited ? '#ea580c' : '#9ca3af','🔥');
  drawCells(chimneys,'#7c3aed','↑');

  for (const p of particles) {
    const sp = Math.hypot(p.vx,p.vy);
    ctx.beginPath();
    ctx.arc(p.x,p.y,Math.min(4,1.8+sp/55),0,Math.PI*2);
    ctx.fillStyle = p.heated ? 'rgba(234,88,12,.78)' : 'rgba(37,99,235,.65)';
    ctx.fill();
  }
}

function updateMetrics() {
  if (!running || particles.length === 0) return;
  const speeds = particles.map(p=>Math.hypot(p.vx,p.vy));
  const avg = speeds.reduce((a,b)=>a+b,0)/speeds.length;
  const stagnant = particles.filter(p=>p.stagnant>.8).length/particles.length;
  const structureBonus = (inlets.length?12:0) + (fires.length?10:0) + (chimneys.length?18:0);
  const speedPart = Math.min(45, avg/90*45);
  const penalty = stagnant*40;
  const score = Math.max(0,Math.min(100,Math.round(structureBonus+speedPart-penalty+15)));
  flowScoreEl.textContent = score + ' / 100';
  avgSpeedEl.textContent = avg.toFixed(1) + '（相對值）';
  stagnantRateEl.textContent = Math.round(stagnant*100) + '%';

  if (!inlets.length) feedbackEl.textContent = '目前沒有進氣口；試著加入一個進氣位置。';
  else if (!chimneys.length) feedbackEl.textContent = '目前沒有煙囪；加入煙囪後再比較氣流變化。';
  else if (!fires.length) feedbackEl.textContent = '目前沒有火源；加入火源後才能觀察點火後的浮力效果。';
  else if (stagnant > .35) feedbackEl.textContent = '有不少空氣停滯。看看是不是有死角、狹窄通道或封閉區域。';
  else if (score >= 70) feedbackEl.textContent = '在這個簡化模型中，氣流目前相對順暢。試著改一個結構，看看分數會不會更高。';
  else feedbackEl.textContent = '氣流已經形成，但還有改善空間。可以調整進氣口、轉角或煙囪位置。';
}

function loop(now) {
  const dt = Math.min(.033,(now-lastTime)/1000);
  lastTime = now;
  if (running) {
    particles.forEach(p=>updateParticle(p,dt));
    updateMetrics();
  }
  draw();
  requestAnimationFrame(loop);
}

igniteBtn.addEventListener('click',()=>{
  ignited = true; running = true; resetParticles();
  igniteBtn.textContent = '🔥 已點火';
  feedbackEl.textContent = '正在觀察點火後的氣流變化。';
});
pauseBtn.addEventListener('click',()=>{
  running = !running;
  pauseBtn.textContent = running ? '暫停' : '繼續';
});
clearBtn.addEventListener('click',()=>{
  walls.length = inlets.length = fires.length = chimneys.length = 0;
  particles = []; running = false; ignited = false;
  igniteBtn.textContent = '🔥 點火'; pauseBtn.textContent = '暫停';
  flowScoreEl.textContent = avgSpeedEl.textContent = stagnantRateEl.textContent = '—';
  feedbackEl.textContent = '先設計火箭爐，再按「點火」。';
});
particleSlider.addEventListener('input',()=>{ if (running) resetParticles(); });

resetParticles();
particles = [];
requestAnimationFrame(loop);
