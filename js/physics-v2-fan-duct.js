/* Physics v2.4.3: duct resistance + electric fan.
 *
 * Duct resistance is based on Darcy-Weisbach in distributed form:
 *   dp/L = f/Dh * rho*V^2/2
 *   a_drag = -(1/rho) dp/dx = -f/(2Dh) * |V| V
 *
 * Rectangular hydraulic diameter:
 *   Dh = 2ab/(a+b)
 *
 * The electric fan is represented as a reduced-order actuator disk:
 *   upstream ambient -> suction region -> [fan body][arrow] -> downstream jet
 *
 * The body cell owns the pressure/momentum source. The arrow cell is visual
 * direction only. The visual arrow is allowed to overlap walls/objects when
 * rotating; walls still block the physical suction/jet through line-of-sight.
 */
(() => {
  const PPM = 240;
  const RHO = 1.204;
  const OUT_OF_PLANE_DEPTH = 0.10;
  const DARCY_F = 0.045;
  const WALL_SCAN_CELLS = 8;
  const DRAG_ACCEL_CAP = 150;
  const FAN_CD = 0.62;
  const FAN_VELOCITY_CAP = 150;
  const FAN_REFERENCE_PRESSURE = 5;
  const FAN_RELAX = 4.4;

  const FAN_SUCTION_LENGTH = BUILD_CELL * 4.2;
  const FAN_JET_LENGTH = BUILD_CELL * 3.2;
  const FAN_BASE_HALF_WIDTH = BUILD_CELL * 0.80;
  const FAN_SUCTION_SPREAD = 0.28;
  const FAN_JET_SPREAD = 0.18;
  const FAN_UPSTREAM_SPEED_FACTOR = 0.72;

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

  function arrowCell(fan, dirIndex = fan.dir) {
    const d = DIRS[dirIndex] || DIRS[0];
    return {x: fan.x + d.x * BUILD_CELL, y: fan.y + d.y * BUILD_CELL};
  }
  function cellInsideCanvas(x, y) {
    return x >= 0 && y >= 0 && x + BUILD_CELL <= canvas.width && y + BUILD_CELL <= canvas.height;
  }
  function isWallBuildCell(x, y) {
    return walls.some(w => w.x === x && w.y === y);
  }
  function fanOccupiesCell(fan, x, y, dirIndex = fan.dir) {
    if (fan.x === x && fan.y === y) return true;
    const a = arrowCell(fan, dirIndex);
    return a.x === x && a.y === y;
  }
  function fanAtEitherCell(x, y) {
    return fans.find(f => fanOccupiesCell(f, x, y));
  }
  function fanBodyPlacementValid(fan) {
    if (!cellInsideCanvas(fan.x, fan.y)) return false;
    if (isWallBuildCell(fan.x, fan.y)) return false;
    // The body is a physical device, so two fan bodies cannot occupy one cell.
    return !fans.some(other => other.x === fan.x && other.y === fan.y);
  }
  function setTransientFanMessage(text) {
    if (!feedbackEl) return;
    const prior = feedbackEl.textContent;
    feedbackEl.textContent = text;
    window.setTimeout(() => {
      if (feedbackEl.textContent === text) feedbackEl.textContent = prior;
    }, 1200);
  }

  canvas.addEventListener('pointerdown', e => {
    const p = pointerPos(e);
    const x = snap(p.x), y = snap(p.y);
    if (selectedTool === 'fan') {
      const existing = fanAtEitherCell(x, y);
      if (existing) {
        // Rotation is intentionally unrestricted by the VISUAL arrow footprint.
        // The arrow may overlap a wall or another object.  Physical airflow is
        // still blocked by lineClear() below, so this is only a UI relaxation.
        existing.dir = (existing.dir + 1) % 4;
        return;
      }
      const candidate = {x, y, dir:0};
      if (fanBodyPlacementValid(candidate)) fans.push(candidate);
      else setTransientFanMessage('風扇本體不能放在磚牆、另一個風扇本體或畫布外。箭頭方向之後可自由旋轉。');
      return;
    }
    if (selectedTool === 'erase') {
      const i = fans.findIndex(f => fanOccupiesCell(f, x, y));
      if (i >= 0) fans.splice(i, 1);
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
    if (aCells === null) return null;
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
        const axM = -DARCY_F/(2*dh) * vm * vx;
        const ayM = -DARCY_F/(2*dh) * vm * vy;
        u[i]+=clamp(axM*PPM,-DRAG_ACCEL_CAP,DRAG_ACCEL_CAP)*dt;
        v[i]+=clamp(ayM*PPM,-DRAG_ACCEL_CAP,DRAG_ACCEL_CAP)*dt;
      }
    }
  }

  function fanTargetSpeedPx() {
    const dp=Math.max(0,fanPressurePa());
    if (dp<=0) return 0;
    const ms=FAN_CD*Math.sqrt(2*dp/RHO);
    const referenceMs=FAN_CD*Math.sqrt(2*FAN_REFERENCE_PRESSURE/RHO);
    // Normalize the pressure curve to the teaching-scale velocity cap. This
    // keeps 0..5 Pa monotonic instead of saturating at almost every setting.
    return clamp(ms/Math.max(1e-6,referenceMs)*FAN_VELOCITY_CAP,0,FAN_VELOCITY_CAP);
  }

  function applyFans(dt) {
    if (!fans.length) return;
    const target=fanTargetSpeedPx();
    if (target<=0) return;

    for (const fan of fans) {
      const dvec=DIRS[fan.dir]||DIRS[0];
      const cx=fan.x+BUILD_CELL/2, cy=fan.y+BUILD_CELL/2;
      const reach=Math.max(FAN_SUCTION_LENGTH,FAN_JET_LENGTH)+BUILD_CELL;
      const gx0=gridX(cx-reach),gx1=gridX(cx+reach);
      const gy0=gridY(cy-reach),gy1=gridY(cy+reach);

      for(let gy=gy0;gy<=gy1;gy++) for(let gx=gx0;gx<=gx1;gx++) {
        const i=idx(gx,gy);
        if(solid[i]) continue;
        const px=(gx+.5)*H,py=(gy+.5)*H;
        const dx=px-cx,dy=py-cy;
        const axial=dx*dvec.x+dy*dvec.y;
        const lateral=Math.abs(-dx*dvec.y+dy*dvec.x);

        const upstream=axial<0;
        const length=upstream?FAN_SUCTION_LENGTH:FAN_JET_LENGTH;
        if(Math.abs(axial)>length) continue;

        const spread=upstream?FAN_SUCTION_SPREAD:FAN_JET_SPREAD;
        const halfWidth=FAN_BASE_HALF_WIDTH+Math.abs(axial)*spread;
        if(lateral>halfWidth) continue;

        // Visual arrows may overlap walls, but PHYSICAL flow cannot pass them.
        if(!lineClear(cx,cy,px,py,false)) continue;

        const axialWeight=Math.max(0.08,1-Math.abs(axial)/length);
        const lateralWeight=Math.max(0,1-lateral/Math.max(1,halfWidth));
        const weight=axialWeight*(0.35+0.65*lateralWeight);
        const speedFactor=upstream?FAN_UPSTREAM_SPEED_FACTOR:1.0;
        const desiredU=dvec.x*target*speedFactor;
        const desiredV=dvec.y*target*speedFactor;
        const relax=Math.min(1,FAN_RELAX*weight*dt);

        u[i]+=(desiredU-u[i])*relax;
        v[i]+=(desiredV-v[i])*relax;
      }
    }
  }

  const previousAddBuoyancy = addBuoyancy;
  addBuoyancy = function(dt) {
    previousAddBuoyancy(dt);
    applyDuctFriction(dt);
    applyFans(dt);
  };

  function drawFanBody(f) {
    const x=f.x, y=f.y, cx=x+BUILD_CELL/2, cy=y+BUILD_CELL/2;
    ctx.save();
    ctx.fillStyle='rgba(8,145,178,.94)';
    ctx.fillRect(x+1,y+1,BUILD_CELL-2,BUILD_CELL-2);
    ctx.strokeStyle='rgba(255,255,255,.92)';ctx.lineWidth=1.8;
    ctx.beginPath();ctx.arc(cx,cy,BUILD_CELL*.30,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.92)';
    for(let k=0;k<4;k++){
      ctx.save();ctx.translate(cx,cy);ctx.rotate(k*Math.PI/2+Math.PI/8);
      ctx.beginPath();ctx.moveTo(1,-1.5);ctx.quadraticCurveTo(8,-5.5,8.5,0);ctx.quadraticCurveTo(5,4,1.5,2.2);ctx.closePath();ctx.fill();ctx.restore();
    }
    ctx.fillStyle='rgba(8,145,178,1)';ctx.beginPath();ctx.arc(cx,cy,2.2,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function drawArrowCell(f) {
    const d=DIRS[f.dir]||DIRS[0],a=arrowCell(f);
    const cx=a.x+BUILD_CELL/2,cy=a.y+BUILD_CELL/2;
    const pulse=(Math.sin(performance.now()/170)+1)/2,shift=(pulse-.5)*2.4;
    ctx.save();ctx.fillStyle='rgba(14,165,233,.76)';ctx.fillRect(a.x+1,a.y+1,BUILD_CELL-2,BUILD_CELL-2);
    ctx.translate(cx+d.x*shift,cy+d.y*shift);ctx.rotate(Math.atan2(d.y,d.x));
    ctx.strokeStyle='#fff';ctx.fillStyle='#fff';ctx.lineWidth=3.4;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(-8,0);ctx.lineTo(4,0);ctx.stroke();
    ctx.beginPath();ctx.moveTo(3,-6.2);ctx.lineTo(9,0);ctx.lineTo(3,6.2);ctx.closePath();ctx.fill();ctx.restore();
  }
  function drawFans() { for(const f of fans){drawFanBody(f);drawArrowCell(f);} }
  const previousDraw=draw;
  draw=function(){previousDraw();drawFans();};

  const previousUpdateMetrics=updateMetrics;
  updateMetrics=function(){
    previousUpdateMetrics();
    if(fans.length&&feedbackEl){
      feedbackEl.textContent+=` 電風扇 ${fans.length} 個，設定壓升 ${fanPressurePa().toFixed(1)} Pa；箭頭可自由旋轉，磚牆仍會阻擋實際吸入與送風。`;
    }
  };
})();
