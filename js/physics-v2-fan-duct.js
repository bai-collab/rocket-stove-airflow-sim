/* Physics v2.3: duct resistance + electric fan.
 *
 * Duct resistance is based on Darcy-Weisbach in distributed form:
 *   dp/L = f/Dh * rho*V^2/2
 *   a_drag = -(1/rho) dp/dx = -f/(2Dh) * |V| V
 *
 * Rectangular hydraulic diameter:
 *   Dh = 2ab/(a+b)
 *
 * The 2-D solver assumes an out-of-plane depth of 0.10 m.  Local passage
 * width is estimated perpendicular to the velocity from the nearest solid
 * walls.  This is an educational approximation, but it makes longer/narrower
 * passages accumulate more resistance instead of treating every opening alike.
 *
 * The electric fan is a local pressure-rise source.  Its requested pressure
 * rise is converted to an orifice-scale target speed, then momentum is added
 * locally before the incompressible pressure projection.  Tracers are still
 * visualization only.
 */
(() => {
  const PPM = 240;                 // 24 px brick module ~= 0.10 m
  const RHO = 1.204;               // kg/m^3 near 20 C
  const OUT_OF_PLANE_DEPTH = 0.10; // m
  const DARCY_F = 0.045;           // rough educational duct/brick surface
  const WALL_SCAN_CELLS = 8;
  const DRAG_ACCEL_CAP = 150;      // px/s^2 numerical limit
  const FAN_RADIUS = 42;           // px
  const FAN_CD = 0.62;
  const FAN_VELOCITY_CAP = 165;    // px/s, below base solver MAX_SPEED
  const FAN_RELAX = 3.8;           // s^-1, approach target jet speed smoothly

  const fans = [];
  const fanPressureEl = document.getElementById('fanPressure');
  const fanPressureValueEl = document.getElementById('fanPressureValue');
  const DIRS = [
    {x:1,y:0,label:'→'},
    {x:0,y:1,label:'↓'},
    {x:-1,y:0,label:'←'},
    {x:0,y:-1,label:'↑'}
  ];

  function fanPressurePa() {
    return fanPressureEl ? Number(fanPressureEl.value) || 0 : 2.0;
  }
  function updateFanPressureLabel() {
    if (fanPressureValueEl) fanPressureValueEl.textContent = fanPressurePa().toFixed(1) + ' Pa';
  }
  if (fanPressureEl) fanPressureEl.addEventListener('input', updateFanPressureLabel);
  updateFanPressureLabel();

  function fanAt(x,y) { return fans.find(f => f.x === x && f.y === y); }

  // Base app already sets selectedTool.  For fan, base placeAt intentionally
  // does nothing; this listener owns fan placement. Re-tapping rotates it.
  canvas.addEventListener('pointerdown', e => {
    const p = pointerPos(e);
    const x = snap(p.x), y = snap(p.y);
    if (selectedTool === 'fan') {
      const existing = fanAt(x,y);
      if (existing) existing.dir = (existing.dir + 1) % 4;
      else fans.push({x,y,dir:0});
    } else if (selectedTool === 'erase') {
      const i = fans.findIndex(f => f.x === x && f.y === y);
      if (i >= 0) fans.splice(i,1);
    }
  });

  clearBtn.addEventListener('click', () => { fans.length = 0; });

  function scanWallDistance(gx,gy,dx,dy) {
    for (let d=1; d<=WALL_SCAN_CELLS; d++) {
      const x=gx+dx*d, y=gy+dy*d;
      if (x<0||y<0||x>=NX||y>=NY) return null;
      if (solid[idx(x,y)]) return d;
    }
    return null;
  }

  function localHydraulicDiameter(gx,gy,horizontalFlow) {
    let aCells = null;
    if (horizontalFlow) {
      const up=scanWallDistance(gx,gy,0,-1), down=scanWallDistance(gx,gy,0,1);
      if (up!==null && down!==null) aCells = Math.max(1, up + down - 1);
    } else {
      const left=scanWallDistance(gx,gy,-1,0), right=scanWallDistance(gx,gy,1,0);
      if (left!==null && right!==null) aCells = Math.max(1, left + right - 1);
    }
    if (aCells === null) return null; // open ambient, no duct-like wall friction
    const a = aCells * H / PPM;
    const b = OUT_OF_PLANE_DEPTH;
    return 2 * a * b / Math.max(1e-6, a + b);
  }

  function applyDuctFriction(dt) {
    for (let gy=0; gy<NY; gy++) {
      for (let gx=0; gx<NX; gx++) {
        const i=idx(gx,gy);
        if (solid[i]) continue;
        const sx=u[i], sy=v[i], speedPx=Math.hypot(sx,sy);
        if (speedPx < 0.8) continue;
        const horizontal=Math.abs(sx)>=Math.abs(sy);
        const dh=localHydraulicDiameter(gx,gy,horizontal);
        if (!dh) continue;
        const vx=sx/PPM, vy=sy/PPM, vm=Math.hypot(vx,vy);
        if (vm < 1e-4) continue;
        // Darcy distributed drag: a = -f/(2Dh) * |V| V.
        let axM = -DARCY_F/(2*dh) * vm * vx;
        let ayM = -DARCY_F/(2*dh) * vm * vy;
        let ax=clamp(axM*PPM,-DRAG_ACCEL_CAP,DRAG_ACCEL_CAP);
        let ay=clamp(ayM*PPM,-DRAG_ACCEL_CAP,DRAG_ACCEL_CAP);
        u[i]+=ax*dt; v[i]+=ay*dt;
      }
    }
  }

  function fanTargetSpeedPx() {
    const dp=Math.max(0,fanPressurePa());
    if (dp<=0) return 0;
    const ms=FAN_CD*Math.sqrt(2*dp/RHO);
    return Math.min(FAN_VELOCITY_CAP,ms*PPM);
  }

  function applyFans(dt) {
    if (!fans.length) return;
    const target=fanTargetSpeedPx();
    if (target<=0) return;
    for (const fan of fans) {
      const dvec=DIRS[fan.dir]||DIRS[0];
      const cx=fan.x+BUILD_CELL/2, cy=fan.y+BUILD_CELL/2;
      const gx0=gridX(cx-FAN_RADIUS),gx1=gridX(cx+FAN_RADIUS);
      const gy0=gridY(cy-FAN_RADIUS),gy1=gridY(cy+FAN_RADIUS);
      for(let gy=gy0;gy<=gy1;gy++) for(let gx=gx0;gx<=gx1;gx++) {
        const i=idx(gx,gy); if(solid[i]) continue;
        const px=(gx+.5)*H,py=(gy+.5)*H;
        const dx=px-cx,dy=py-cy,d=Math.hypot(dx,dy);
        if(d>FAN_RADIUS) continue;
        // Only accelerate cells in front/through the fan disk, not the entire circle.
        const axial=dx*dvec.x+dy*dvec.y;
        if(axial < -BUILD_CELL*.45) continue;
        const lateral=Math.abs(-dx*dvec.y+dy*dvec.x);
        if(lateral > BUILD_CELL*.85 + Math.max(0,axial)*.18) continue;
        const w=Math.max(.12,1-d/FAN_RADIUS);
        const desiredU=dvec.x*target, desiredV=dvec.y*target;
        const relax=Math.min(1,FAN_RELAX*w*dt);
        u[i]+=(desiredU-u[i])*relax;
        v[i]+=(desiredV-v[i])*relax;
      }
    }
  }

  // Loaded after v2.2 stack patch, so stack pressure + Boussinesq run first;
  // duct losses and fan momentum are then included before velocity advection and
  // pressure projection in the base physicsStep.
  const previousAddBuoyancy = addBuoyancy;
  addBuoyancy = function(dt) {
    previousAddBuoyancy(dt);
    applyDuctFriction(dt);
    applyFans(dt);
  };

  function drawFans() {
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='13px system-ui';
    for(const f of fans){
      const d=DIRS[f.dir]||DIRS[0];
      ctx.fillStyle='rgba(8,145,178,.88)';
      ctx.fillRect(f.x+1,f.y+1,BUILD_CELL-2,BUILD_CELL-2);
      ctx.fillStyle='#fff';
      ctx.fillText('🌀'+d.label,f.x+BUILD_CELL/2,f.y+BUILD_CELL/2);
    }
  }
  const previousDraw=draw;
  draw=function(){previousDraw();drawFans();};

  const previousUpdateMetrics=updateMetrics;
  updateMetrics=function(){
    previousUpdateMetrics();
    if(fans.length && feedbackEl){
      feedbackEl.textContent += ` 電風扇 ${fans.length} 個，設定壓升 ${fanPressurePa().toFixed(1)} Pa；再點同一風扇可旋轉方向。`;
    }
  };
})();
