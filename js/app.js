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
const GRID_COLS = Math.ceil(canvas.width / CELL);
const GRID_ROWS = Math.ceil(canvas.height / CELL);
const MAX_SPEED = 125;
const BUOYANCY = 34;
const COOLING = 0.075;
const MAX_PARTICLES_PER_CELL = 4;
const DENSITY_PRESSURE = 8.5;
const DENSITY_INTERVAL = 0.08;

let regionMap = new Int32Array(GRID_COLS * GRID_ROWS);
let externalRegions = new Set();
let densitySnapshot = new Int16Array(GRID_COLS * GRID_ROWS);

function pointerPos(e) {
  const r = canvas.getBoundingClientRect();
  return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};
}
function snap(v){return Math.floor(v/CELL)*CELL;}
function hasRect(arr,x,y){return arr.some(o=>o.x===x&&o.y===y);}
function blocked(x,y){return walls.some(w=>x>=w.x&&x<=w.x+CELL&&y>=w.y&&y<=w.y+CELL);}
function cellIndexXY(x,y){if(x<0||y<0||x>=canvas.width||y>=canvas.height)return-1;return Math.floor(y/CELL)*GRID_COLS+Math.floor(x/CELL);}
function pointInCell(idx){const cx=idx%GRID_COLS,cy=Math.floor(idx/GRID_COLS),pad=4;return{x:cx*CELL+pad+Math.random()*(CELL-pad*2),y:cy*CELL+pad+Math.random()*(CELL-pad*2)};}
function wallCellSet(){return new Set(walls.map(w=>Math.floor(w.y/CELL)*GRID_COLS+Math.floor(w.x/CELL)));}

function rebuildConnectivity(){
  const wallCells=wallCellSet();
  regionMap=new Int32Array(GRID_COLS*GRID_ROWS);
  externalRegions=new Set();
  let nextRegion=1;
  for(let start=0;start<regionMap.length;start++){
    if(wallCells.has(start)||regionMap[start]!==0)continue;
    const regionId=nextRegion++,queue=[start];
    regionMap[start]=regionId;
    let touchesBoundary=false;
    for(let qi=0;qi<queue.length;qi++){
      const idx=queue[qi],x=idx%GRID_COLS,y=Math.floor(idx/GRID_COLS);
      if(x===0||y===0||x===GRID_COLS-1||y===GRID_ROWS-1)touchesBoundary=true;
      for(const[nx,ny]of[[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
        if(nx<0||ny<0||nx>=GRID_COLS||ny>=GRID_ROWS)continue;
        const ni=ny*GRID_COLS+nx;
        if(wallCells.has(ni)||regionMap[ni]!==0)continue;
        regionMap[ni]=regionId;queue.push(ni);
      }
    }
    if(touchesBoundary)externalRegions.add(regionId);
  }
  connectivityDirty=false;
}
function ensureConnectivity(){if(connectivityDirty)rebuildConnectivity();}
function regionAt(x,y){ensureConnectivity();const idx=cellIndexXY(x,y);return idx>=0?(regionMap[idx]||0):0;}

function placeAt(pos){
  const x=snap(pos.x),y=snap(pos.y);
  if(selectedTool==='wall'){if(!hasRect(walls,x,y)){walls.push({x,y});connectivityDirty=true;}return;}
  if(selectedTool==='erase'){
    for(const arr of[walls,inlets,fires,chimneys]){const i=arr.findIndex(o=>o.x===x&&o.y===y);if(i>=0){if(arr===walls)connectivityDirty=true;arr.splice(i,1);}}
    return;
  }
  const arr={inlet:inlets,fire:fires,chimney:chimneys}[selectedTool];
  if(arr&&!hasRect(arr,x,y))arr.push({x,y});
}
tools.forEach(btn=>btn.addEventListener('click',()=>{tools.forEach(b=>b.classList.remove('active'));btn.classList.add('active');selectedTool=btn.dataset.tool;}));
canvas.addEventListener('pointerdown',e=>{drawing=true;canvas.setPointerCapture(e.pointerId);placeAt(pointerPos(e));});
canvas.addEventListener('pointermove',e=>{if(drawing&&(selectedTool==='wall'||selectedTool==='erase'))placeAt(pointerPos(e));});
canvas.addEventListener('pointerup',()=>drawing=false);
canvas.addEventListener('pointercancel',()=>drawing=false);

function targetParticleCount(){return Math.max(20,Number(particleSlider.value)||240);}
function makeParticle(point,gas='fresh',temperature=0){return{x:point.x,y:point.y,vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.4,gas,temperature,stagnant:0};}
function externalOpenCells(){
  ensureConnectivity();
  const cells=[],wallCells=wallCellSet();
  for(let idx=0;idx<regionMap.length;idx++){
    if(wallCells.has(idx))continue;
    const region=regionMap[idx];
    if(region&&externalRegions.has(region))cells.push(idx);
  }
  return cells;
}
function boundaryOpenCells(){
  ensureConnectivity();
  const cells=[],wallCells=wallCellSet();
  for(let idx=0;idx<regionMap.length;idx++){
    if(wallCells.has(idx))continue;
    const cx=idx%GRID_COLS,cy=Math.floor(idx/GRID_COLS);
    if(cx!==0&&cy!==0&&cx!==GRID_COLS-1&&cy!==GRID_ROWS-1)continue;
    const region=regionMap[idx];
    if(region&&externalRegions.has(region))cells.push(idx);
  }
  return cells;
}
function buildDensity(){const counts=new Int16Array(GRID_COLS*GRID_ROWS);for(const p of particles){const idx=cellIndexXY(p.x,p.y);if(idx>=0)counts[idx]++;}return counts;}
function seedAmbientAir(){
  ensureConnectivity();
  const cells=externalOpenCells();particles=[];if(!cells.length)return;
  for(let i=cells.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]];}
  const target=targetParticleCount();
  for(let i=0;i<target;i++)particles.push(makeParticle(pointInCell(cells[i%cells.length])));
}
function boundarySpawnPoint(){
  const cells=boundaryOpenCells();
  if(!cells.length)return{x:1,y:1,vx:1,vy:1};
  const counts=buildDensity();
  let min=Infinity,candidates=[];
  for(const idx of cells){const n=counts[idx];if(n>=MAX_PARTICLES_PER_CELL)continue;if(n<min){min=n;candidates=[idx];}else if(n===min)candidates.push(idx);}
  const pool=candidates.length?candidates:cells;
  const idx=pool[Math.floor(Math.random()*pool.length)],cx=idx%GRID_COLS,cy=Math.floor(idx/GRID_COLS);
  let x=cx*CELL+CELL/2,y=cy*CELL+CELL/2,vx=0,vy=0;
  if(cx===0){x=1;vx=6+(Math.random()*4);}else if(cx===GRID_COLS-1){x=canvas.width-1;vx=-(6+Math.random()*4);}
  if(cy===0){y=1;vy=6+(Math.random()*4);}else if(cy===GRID_ROWS-1){y=canvas.height-1;vy=-(6+Math.random()*4);}
  return{x,y,vx,vy};
}
function respawnFromBoundary(p){
  const s=boundarySpawnPoint();
  Object.assign(p,makeParticle({x:s.x,y:s.y},'fresh',0));
  p.vx=s.vx+(Math.random()-.5)*.8;
  p.vy=s.vy+(Math.random()-.5)*.8;
}
function regionParticles(regionId){return particles.filter(p=>regionAt(p.x,p.y)===regionId);}
function oxygenRatioForRegion(regionId){if(!regionId)return 0;if(externalRegions.has(regionId))return 1;const ps=regionParticles(regionId);return ps.length?ps.filter(p=>p.gas==='fresh').length/ps.length:0;}
function fireIntensity(fire){if(!ignited)return 0;const o=oxygenRatioForRegion(regionAt(fire.x+CELL/2,fire.y+CELL/2));if(o<=.12)return 0;if(o>=.55)return 1;return(o-.12)/.43;}

function forceToward(p,sources,radius,strength){let fx=0,fy=0;const sourceRegion=regionAt(p.x,p.y);for(const s of sources){const sx=s.x+CELL/2,sy=s.y+CELL/2;if(regionAt(sx,sy)!==sourceRegion)continue;const dx=sx-p.x,dy=sy-p.y,d=Math.hypot(dx,dy)||1;if(d<radius){const k=(1-d/radius)*strength;fx+=dx/d*k;fy+=dy/d*k;}}return{fx,fy};}
function fireForce(p){let fx=0,fy=0;const pRegion=regionAt(p.x,p.y);for(const fire of fires){const cx=fire.x+CELL/2,cy=fire.y+CELL/2;if(regionAt(cx,cy)!==pRegion)continue;const intensity=fireIntensity(fire);if(!intensity)continue;const dx=p.x-cx,dy=p.y-cy,d=Math.hypot(dx,dy)||1;if(d<300){const k=(1-d/300)*intensity;fx-=dx/d*18*k;fy-=dy/d*8*k;}if(d<145){const heat=(1-d/145)*intensity;p.temperature=Math.min(1,p.temperature+heat*.055);fy-=14*heat;}}return{fx,fy};}
function burnRegion(dt){
  if(!ignited)return;
  const byRegion=new Map();
  for(const fire of fires){const region=regionAt(fire.x+CELL/2,fire.y+CELL/2);if(!region)continue;if(!byRegion.has(region))byRegion.set(region,[]);byRegion.get(region).push(fire);}
  for(const[region,regionFires]of byRegion){const intensity=Math.max(...regionFires.map(fireIntensity));if(!intensity)continue;const fresh=regionParticles(region).filter(p=>p.gas==='fresh');if(!fresh.length)continue;const rate=(externalRegions.has(region)?.025:.18)*regionFires.length*intensity;let budget=rate*dt*fresh.length,convert=Math.floor(budget);if(Math.random()<budget-convert)convert++;convert=Math.min(convert,fresh.length);fresh.sort((a,b)=>Math.min(...regionFires.map(f=>Math.hypot(a.x-f.x-CELL/2,a.y-f.y-CELL/2)))-Math.min(...regionFires.map(f=>Math.hypot(b.x-f.x-CELL/2,b.y-f.y-CELL/2))));for(let i=0;i<convert;i++){fresh[i].gas='exhaust';fresh[i].temperature=Math.max(fresh[i].temperature,.9);}}
}
function entrainment(p){let fx=0,fy=0,count=0;const region=regionAt(p.x,p.y),radius=105;for(const q of particles){if(q===p||regionAt(q.x,q.y)!==region)continue;const dx=q.x-p.x,dy=q.y-p.y,d2=dx*dx+dy*dy;if(d2>0&&d2<radius*radius){const d=Math.sqrt(d2),influence=(1-d/radius)*.085;fx+=(q.vx-p.vx)*influence;fy+=(q.vy-p.vy)*influence;if(++count>=20)break;}}return{fx,fy};}
function densityPressure(p){const idx=cellIndexXY(p.x,p.y);if(idx<0)return{fx:0,fy:0};const cx=idx%GRID_COLS,cy=Math.floor(idx/GRID_COLS),region=regionMap[idx],here=densitySnapshot[idx]||0;let fx=0,fy=0;for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]]){const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=GRID_COLS||ny>=GRID_ROWS)continue;const ni=ny*GRID_COLS+nx;if(regionMap[ni]!==region||region===0)continue;const gradient=here-(densitySnapshot[ni]||0);fx+=dx*gradient*DENSITY_PRESSURE;fy+=dy*gradient*DENSITY_PRESSURE;}return{fx,fy};}
function nearestFireCenterX(p){let best=null,dist=Infinity;const region=regionAt(p.x,p.y);for(const fire of fires){if(regionAt(fire.x+CELL/2,fire.y+CELL/2)!==region)continue;const d=Math.hypot(p.x-fire.x-CELL/2,p.y-fire.y-CELL/2);if(d<dist){dist=d;best=fire.x+CELL/2;}}return best;}
function updateParticle(p,dt){
  let ax=0,ay=0;
  if(ignited){let f=fireForce(p);ax+=f.fx;ay+=f.fy;if(inlets.length){f=forceToward(p,inlets,230,8);ax+=f.fx;ay+=f.fy;}if(chimneys.length){f=forceToward(p,chimneys,290,22);ax+=f.fx;ay+=f.fy-10;}f=entrainment(p);ax+=f.fx;ay+=f.fy;f=densityPressure(p);ax+=f.fx;ay+=f.fy;ay-=BUOYANCY*p.temperature;}
  const cooling=COOLING*(p.gas==='exhaust'?.6:1);p.temperature=Math.max(0,p.temperature-cooling*dt);
  p.vx*=Math.pow(.994,dt*60);p.vy*=Math.pow(.994,dt*60);p.vx+=ax*dt;p.vy+=ay*dt;
  const speed=Math.hypot(p.vx,p.vy);if(speed>MAX_SPEED){p.vx=p.vx/speed*MAX_SPEED;p.vy=p.vy/speed*MAX_SPEED;}
  const oldX=p.x,oldY=p.y,nx=oldX+p.vx*dt,ny=oldY+p.vy*dt;
  if(blocked(nx,p.y))p.vx*=-.16;else p.x=nx;
  const upwardBefore=p.vy<0;
  if(blocked(p.x,ny)){
    if(upwardBefore&&p.temperature>.08){const fireX=nearestFireCenterX(p);let dir=fireX===null?(Math.random()<.5?-1:1):Math.sign(p.x-fireX);if(!dir)dir=Math.random()<.5?-1:1;const spread=Math.max(8,Math.min(42,Math.abs(p.vy)*.7+22*p.temperature));p.vx+=dir*spread;p.vy=Math.abs(p.vy)*.06;}else p.vy*=-.12;
  }else p.y=ny;
  if(blocked(p.x,p.y)){p.x=oldX;p.y=oldY;p.vx*=.08;p.vy*=.08;}
  const currentSpeed=Math.hypot(p.vx,p.vy);p.stagnant=currentSpeed<3?p.stagnant+dt:Math.max(0,p.stagnant-dt*.7);
  const region=regionAt(p.x,p.y);if(p.gas==='exhaust'&&externalRegions.has(region)&&Math.random()<dt*.12){p.gas='fresh';p.temperature*=.75;}
  if(p.x<0||p.x>=canvas.width||p.y<0||p.y>=canvas.height)respawnFromBoundary(p);
}

function enforceCellCapacity(){
  ensureConnectivity();
  for(let pass=0;pass<2;pass++){
    const buckets=Array.from({length:GRID_COLS*GRID_ROWS},()=>[]),counts=new Int16Array(GRID_COLS*GRID_ROWS);
    for(const p of particles){const idx=cellIndexXY(p.x,p.y);if(idx>=0){buckets[idx].push(p);counts[idx]++;}}
    for(let idx=0;idx<buckets.length;idx++){
      const bucket=buckets[idx];if(bucket.length<=MAX_PARTICLES_PER_CELL)continue;
      const cx=idx%GRID_COLS,cy=Math.floor(idx/GRID_COLS),region=regionMap[idx],extras=bucket.slice(MAX_PARTICLES_PER_CELL);
      for(const p of extras){let best=-1,bestCount=Infinity;for(const[dx,dy]of[[-1,0],[1,0],[0,-1],[0,1]]){const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=GRID_COLS||ny>=GRID_ROWS)continue;const ni=ny*GRID_COLS+nx;if(regionMap[ni]!==region||region===0||counts[ni]>=MAX_PARTICLES_PER_CELL)continue;if(counts[ni]<bestCount){best=ni;bestCount=counts[ni];}}
        if(best>=0){const point=pointInCell(best);p.x=point.x;p.y=point.y;p.vx*=.35;p.vy*=.35;counts[idx]--;counts[best]++;}else{const centerX=cx*CELL+CELL/2,centerY=cy*CELL+CELL/2,dx=p.x-centerX||(Math.random()-.5),dy=p.y-centerY||(Math.random()-.5),d=Math.hypot(dx,dy)||1;p.vx+=dx/d*6;p.vy+=dy/d*6;}
      }
    }
  }
}

function drawGrid(){ctx.strokeStyle='rgba(148,163,184,.16)';ctx.lineWidth=1;for(let x=0;x<canvas.width;x+=CELL){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}for(let y=0;y<canvas.height;y+=CELL){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}}
function drawCells(arr,fill,label){ctx.fillStyle=fill;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='16px system-ui';for(const o of arr){ctx.fillRect(o.x+1,o.y+1,CELL-2,CELL-2);if(label){ctx.fillStyle='#fff';ctx.fillText(label,o.x+CELL/2,o.y+CELL/2);ctx.fillStyle=fill;}}}
function drawFires(){ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='16px system-ui';for(const fire of fires){const intensity=fireIntensity(fire);ctx.fillStyle=intensity?`rgba(234,88,12,${.35+.65*intensity})`:'#6b7280';ctx.fillRect(fire.x+1,fire.y+1,CELL-2,CELL-2);ctx.fillStyle='#fff';ctx.fillText(intensity?'🔥':'✕',fire.x+CELL/2,fire.y+CELL/2);}}
function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);drawGrid();drawCells(walls,'#374151','');drawCells(inlets,'#2563eb','↔');drawFires();drawCells(chimneys,'#7c3aed','↑');for(const p of particles){const speed=Math.hypot(p.vx,p.vy);ctx.beginPath();ctx.arc(p.x,p.y,Math.min(4.8,2+speed/42),0,Math.PI*2);ctx.fillStyle=p.gas==='exhaust'?'rgba(75,85,99,.88)':p.temperature>.12?'rgba(234,88,12,.80)':'rgba(37,99,235,.52)';ctx.fill();}}
function summary(){const regions=[...new Set(fires.map(f=>regionAt(f.x+CELL/2,f.y+CELL/2)).filter(Boolean))];if(!regions.length)return{oxygen:0,external:false,burning:false,exhaust:0};const oxygen=Math.min(...regions.map(oxygenRatioForRegion)),external=regions.some(r=>externalRegions.has(r)),burning=fires.some(f=>fireIntensity(f)>0),ps=regions.flatMap(regionParticles),exhaust=ps.length?ps.filter(p=>p.gas==='exhaust').length/ps.length:0;return{oxygen,external,burning,exhaust};}
function updateMetrics(){if(!ignited||!particles.length)return;const speeds=particles.map(p=>Math.hypot(p.vx,p.vy)),avg=speeds.reduce((a,b)=>a+b,0)/speeds.length,stagnant=particles.filter(p=>p.stagnant>.8).length/particles.length,s=summary(),score=Math.max(0,Math.min(100,Math.round((inlets.length?10:0)+(fires.length?10:0)+(chimneys.length?18:0)+Math.min(45,avg/55*45)-stagnant*32-(s.external?0:(1-s.oxygen)*22)+18)));flowScoreEl.textContent=score+' / 100';avgSpeedEl.textContent=avg.toFixed(1)+'（相對值）';stagnantRateEl.textContent=Math.round(stagnant*100)+'%';if(oxygenRateEl)oxygenRateEl.textContent=Math.round(s.oxygen*100)+'%';if(!fires.length)feedbackEl.textContent='目前沒有火源。';else if(!s.burning)feedbackEl.textContent=`氧氣不足，火源已熄滅。封閉區約 ${Math.round(s.exhaust*100)}% 示蹤粒子已成為燃燒後氣體。`;else if(!s.external)feedbackEl.textContent=`燃燒區封閉：新鮮空氣約 ${Math.round(s.oxygen*100)}%，燃燒後氣體約 ${Math.round(s.exhaust*100)}%。`;else feedbackEl.textContent=`空氣補充只從畫布邊界進入；每格最多 ${MAX_PARTICLES_PER_CELL} 顆示蹤粒子。`;}
function loop(now){const dt=Math.min(.033,(now-lastTime)/1000);lastTime=now;if(running&&ignited){burnRegion(dt);densitySnapshot=buildDensity();particles.forEach(p=>updateParticle(p,dt));densityTimer+=dt;if(densityTimer>=DENSITY_INTERVAL){enforceCellCapacity();densityTimer=0;}updateMetrics();}draw();requestAnimationFrame(loop);}

igniteBtn.addEventListener('click',()=>{ensureConnectivity();ignited=true;running=true;lastTime=performance.now();densityTimer=0;igniteBtn.textContent='🔥 已點火';pauseBtn.textContent='暫停';});
pauseBtn.addEventListener('click',()=>{if(!ignited)return;running=!running;lastTime=performance.now();pauseBtn.textContent=running?'暫停':'繼續';});
clearBtn.addEventListener('click',()=>{walls.length=inlets.length=fires.length=chimneys.length=0;ignited=false;running=false;densityTimer=0;connectivityDirty=true;rebuildConnectivity();seedAmbientAir();igniteBtn.textContent='🔥 點火';pauseBtn.textContent='暫停';flowScoreEl.textContent=avgSpeedEl.textContent=stagnantRateEl.textContent='—';if(oxygenRateEl)oxygenRateEl.textContent='—';feedbackEl.textContent='周圍已充滿空氣。先設計火箭爐，再按「點火」。';});
particleSlider.addEventListener('input',()=>{ensureConnectivity();const target=targetParticleCount();if(particles.length>target)particles.length=target;while(particles.length<target){const p=makeParticle({x:0,y:0});respawnFromBoundary(p);particles.push(p);}enforceCellCapacity();});

rebuildConnectivity();
seedAmbientAir();
requestAnimationFrame(loop);