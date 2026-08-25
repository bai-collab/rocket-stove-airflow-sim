/* Local open-air reservoir correction.
 * Open regions are connected to an effectively infinite atmosphere.
 * New tracers are created only at the canvas boundary.
 * Local low-density cells create an intake demand; existing fresh air and
 * boundary inflow are pulled through connected passages toward that demand.
 */
(() => {
  const LOCAL_TARGET = 0.55;
  const SAMPLE_RADIUS = 1;
  const MAX_LOCAL_INFLOW = 12;
  const DEMAND_LIMIT = 18;
  const SUCTION_RADIUS_CELLS = 15;
  const SUCTION_ACCEL = 42;

  let demandCells = [];

  function externalDeficitCells() {
    ensureConnectivity();
    const counts = buildDensity();
    const wallCells = wallCellSet();
    const deficits = [];

    for (let idx = 0; idx < regionMap.length; idx++) {
      if (wallCells.has(idx)) continue;
      const region = regionMap[idx];
      if (!region || !externalRegions.has(region)) continue;
      const cx = idx % GRID_COLS, cy = Math.floor(idx / GRID_COLS);
      let total = 0, open = 0;
      for (let dy=-SAMPLE_RADIUS;dy<=SAMPLE_RADIUS;dy++) for(let dx=-SAMPLE_RADIUS;dx<=SAMPLE_RADIUS;dx++) {
        const nx=cx+dx, ny=cy+dy;
        if(nx<0||ny<0||nx>=GRID_COLS||ny>=GRID_ROWS) continue;
        const ni=ny*GRID_COLS+nx;
        if(regionMap[ni]!==region||wallCells.has(ni)) continue;
        total+=counts[ni]; open++;
      }
      if(!open) continue;
      const density=total/open;
      if(density<LOCAL_TARGET) deficits.push({idx,region,density,need:LOCAL_TARGET-density});
    }
    deficits.sort((a,b)=>b.need-a.need);
    return deficits;
  }

  function boundaryForTarget(target) {
    const candidates=boundaryOpenCells().filter(i=>regionMap[i]===target.region);
    if(!candidates.length) return -1;
    const counts=buildDensity(), tx=target.idx%GRID_COLS, ty=Math.floor(target.idx/GRID_COLS);
    let best=-1,score=Infinity;
    for(const i of candidates){
      if(counts[i]>=MAX_PARTICLES_PER_CELL) continue;
      const bx=i%GRID_COLS,by=Math.floor(i/GRID_COLS);
      const s=Math.hypot(tx-bx,ty-by)+counts[i]*2;
      if(s<score){score=s;best=i}
    }
    return best;
  }

  function spawnTowardCell(target){
    const best=boundaryForTarget(target); if(best<0)return false;
    const bx=best%GRID_COLS,by=Math.floor(best/GRID_COLS);
    let x=bx*CELL+CELL/2,y=by*CELL+CELL/2;
    if(bx===0)x=1;else if(bx===GRID_COLS-1)x=canvas.width-1;
    if(by===0)y=1;else if(by===GRID_ROWS-1)y=canvas.height-1;
    const tp=pointInCell(target.idx),dx=tp.x-x,dy=tp.y-y,d=Math.hypot(dx,dy)||1;
    const p=makeParticle({x,y},'fresh',0),speed=24+Math.min(26,d/18);
    p.vx=dx/d*speed+(Math.random()-.5)*1.2;
    p.vy=dy/d*speed+(Math.random()-.5)*1.2;
    particles.push(p);return true;
  }

  // A low-density open passage must not wait for a boundary tracer to happen
  // to cross it.  It produces a pressure-demand field that entrains existing
  // ambient fresh air through the connected region.
  function intakeDemandForce(p){
    if(!ignited||p.gas!=='fresh'||!demandCells.length)return{fx:0,fy:0};
    const r=regionAt(p.x,p.y); if(!r||!externalRegions.has(r))return{fx:0,fy:0};
    let fx=0,fy=0,used=0;
    const maxD=SUCTION_RADIUS_CELLS*CELL;
    for(const t of demandCells){
      if(t.region!==r)continue;
      const tx=(t.idx%GRID_COLS)*CELL+CELL/2,ty=Math.floor(t.idx/GRID_COLS)*CELL+CELL/2;
      const dx=tx-p.x,dy=ty-p.y,d=Math.hypot(dx,dy)||1;
      if(d>maxD)continue;
      const k=(1-d/maxD)*SUCTION_ACCEL*Math.min(1,t.need/LOCAL_TARGET);
      fx+=dx/d*k;fy+=dy/d*k;
      if(++used>=4)break;
    }
    return{fx,fy};
  }

  const baseUpdateParticle=updateParticle;
  updateParticle=function(p,dt){
    baseUpdateParticle(p,dt);
    if(!ignited)return;
    const f=intakeDemandForce(p);
    p.vx+=f.fx*dt;p.vy+=f.fy*dt;
    const s=Math.hypot(p.vx,p.vy);
    if(s>MAX_SPEED){p.vx=p.vx/s*MAX_SPEED;p.vy=p.vy/s*MAX_SPEED}
  };

  maintainExternalReservoir=function(){
    const deficits=externalDeficitCells();
    demandCells=deficits.slice(0,DEMAND_LIMIT);
    if(!deficits.length)return;
    let added=0;
    // Feed several distinct depleted zones.  All new particles still originate
    // at the outer canvas boundary; none are created inside the passage.
    const stride=Math.max(1,Math.floor(deficits.length/Math.min(deficits.length,MAX_LOCAL_INFLOW)));
    for(let i=0;i<deficits.length&&added<MAX_LOCAL_INFLOW;i+=stride){
      if(spawnTowardCell(deficits[i]))added++;
    }
  };
})();
