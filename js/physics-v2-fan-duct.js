/* Physics v2.3: duct resistance + electric fan.
 *
 * Duct resistance is based on Darcy-Weisbach in distributed form:
 *   dp/L = f/Dh * rho*V^2/2
 *   a_drag = -(1/rho) dp/dx = -f/(2Dh) * |V| V
 *
 * Rectangular hydraulic diameter:
 *   Dh = 2ab/(a+b)
 *
 * The electric fan is a LOCAL pressure-rise source.  The fan object has a
 * two-build-cell footprint for UI clarity:
 *   [body][arrow]  (or vertical equivalent)
 * The body cell owns the physical pressure/momentum source.  The arrow cell is
 * only a direction indicator and does not create a second fan source.
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

  function footprintValid(fan, dirIndex, ignoreFan = fan) {
    const body = {x: fan.x, y: fan.y};
    const arrow = arrowCell(fan, dirIndex);
    if (!cellInsideCanvas(body.x, body.y) || !cellInsideCanvas(arrow.x, arrow.y)) return false;
    if (isWallBuildCell(body.x, body.y) || isWallBuildCell(arrow.x, arrow.y)) return false;
    for (const other of fans) {
      if (other === ignoreFan) continue;
      if (fanOccupiesCell(other, body.x, body.y) || fanOccupiesCell(other, arrow.x, arrow.y)) return false;
    }
    return true;
  }

  function setTransientFanMessage(text) {
    if (!feedbackEl) return;
    const prior = feedbackEl.textContent;
    feedbackEl.textContent = text;
    window.setTimeout(() => {
      if (feedbackEl.textContent === text) feedbackEl.textContent = prior;
    }, 1200);
  }

  // Base app already sets selectedTool.  For fan, base placeAt intentionally
  // does nothing; this listener owns fan placement and rotation.
  canvas.addEventListener('pointerdown', e => {
    const p = pointerPos(e);
    const x = snap(p.x), y = snap(p.y);

    if (selectedTool === 'fan') {
      const existing = fanAtEitherCell(x, y);
      if (existing) {
        const nextDir = (existing.dir + 1) % 4;
        if (footprintValid(existing, nextDir, existing)) {
          existing.dir = nextDir;
        } else {
          setTransientFanMessage('這個方向的箭頭格會碰到磚牆、其他風扇或畫布邊界，無法旋轉。');
        }
        return;
      }

      const candidate = {x, y, dir:0};
      if (footprintValid(candidate, candidate.dir, null)) {
        fans.push(candidate);
      } else {
        setTransientFanMessage('風扇需要連續兩格空間：一格風扇本體＋一格出風箭頭。');
      }
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
      // Physical source stays at the BODY cell. The second cell is UI only.
      const cx=fan.x+BUILD_CELL/2, cy=fan.y+BUILD_CELL/2;
      const gx0=gridX(cx-FAN_RADIUS),gx1=gridX(cx+FAN_RADIUS);
      const gy0=gridY(cy-FAN_RADIUS),gy1=gridY(cy+FAN_RADIUS);
      for(let gy=gy0;gy<=gy1;gy++) for(let gx=gx0;gx<=gx1;gx++) {
        const i=idx(gx,gy); if(solid[i]) continue;
        const px=(gx+.5)*H,py=(gy+.5)*H;
        const dx=px-cx,dy=py-cy,d=Math.hypot(dx,dy);
        if(d>FAN_RADIUS) continue;
        const axial=dx*dvec.x+dy*dvec.y;
        if(axial < -BUILD_CELL*.35) continue;
        const lateral=Math.abs(-dx*dvec.y+dy*dvec.x);
        if(lateral > BUILD_CELL*.82 + Math.max(0,axial)*.18) continue;
        const w=Math.max(.12,1-d/FAN_RADIUS);
        const desiredU=dvec.x*target, desiredV=dvec.y*target;
        const relax=Math.min(1,FAN_RELAX*w*dt);
        u[i]+=(desiredU-u[i])*relax;
        v[i]+=(desiredV-v[i])*relax;
      }
    }
  }

  // Loaded after stack patch: stack pressure + Boussinesq run first, then duct
  // losses and fan momentum before velocity advection / pressure projection.
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
    ctx.strokeStyle='rgba(255,255,255,.92)';
    ctx.lineWidth=1.8;
    ctx.beginPath();ctx.arc(cx,cy,BUILD_CELL*.30,0,Math.PI*2);ctx.stroke();
    // Four simple blades; avoids relying on a tiny emoji glyph on mobile.
    ctx.fillStyle='rgba(255,255,255,.92)';
    for(let k=0;k<4;k++){
      ctx.save();ctx.translate(cx,cy);ctx.rotate(k*Math.PI/2 + Math.PI/8);
      ctx.beginPath();
      ctx.moveTo(1,-1.5);ctx.quadraticCurveTo(8,-5.5,8.5,0);ctx.quadraticCurveTo(5,4,1.5,2.2);ctx.closePath();ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle='rgba(8,145,178,1)';ctx.beginPath();ctx.arc(cx,cy,2.2,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }

  function drawArrowCell(f) {
    const d=DIRS[f.dir]||DIRS[0];
    const a=arrowCell(f);
    const cx=a.x+BUILD_CELL/2, cy=a.y+BUILD_CELL/2;
    const pulse=(Math.sin(performance.now()/170)+1)/2;
    const shift=(pulse-.5)*2.4;
    ctx.save();
    ctx.fillStyle='rgba(14,165,233,.76)';
    ctx.fillRect(a.x+1,a.y+1,BUILD_CELL-2,BUILD_CELL-2);
    ctx.translate(cx+d.x*shift,cy+d.y*shift);
    ctx.rotate(Math.atan2(d.y,d.x));
    ctx.strokeStyle='#fff';
    ctx.fillStyle='#fff';
    ctx.lineWidth=3.4;
    ctx.lineCap='round';
    // Large shaft + triangular head fills most of the second cell.
    ctx.beginPath();ctx.moveTo(-8,0);ctx.lineTo(4,0);ctx.stroke();
    ctx.beginPath();ctx.moveTo(3,-6.2);ctx.lineTo(9,0);ctx.lineTo(3,6.2);ctx.closePath();ctx.fill();
    ctx.restore();
  }

  function drawFans() {
    for(const f of fans){
      drawFanBody(f);
      drawArrowCell(f);
    }
  }

  const previousDraw=draw;
  draw=function(){previousDraw();drawFans();};

  const previousUpdateMetrics=updateMetrics;
  updateMetrics=function(){
    previousUpdateMetrics();
    if(fans.length && feedbackEl){
      feedbackEl.textContent += ` 電風扇 ${fans.length} 個，設定壓升 ${fanPressurePa().toFixed(1)} Pa；風扇採兩格顯示，本體＋大箭頭，再點任一格可旋轉。`;
    }
  };
})();
