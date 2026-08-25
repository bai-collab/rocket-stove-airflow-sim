/* Physics v2.2: buoyancy-driven stack pressure correction.
 *
 * The base solver already integrates incompressible velocity + pressure and
 * Boussinesq buoyancy.  At this coarse 2-D resolution the hydrostatic pressure
 * head of a hot column is under-resolved, so this module adds a reduced-order
 * pressure potential derived from buoyancy-driven natural ventilation:
 *
 *   dp_stack = g * H * (rho_ambient - rho_hot)
 *   rho_hot  = rho_ambient * T_ambient(K) / T_hot(K)
 *   v_orifice = Cd * sqrt(2 * dp_stack / rho_ambient)
 *
 * Pressure is solved through open fluid cells around solid walls, so the
 * resulting acceleration follows connected passages instead of pulling tracer
 * particles directly.  Tracers remain visualization only.
 */
(() => {
  const PHYSICAL_PIXELS_PER_METER = 240; // 24 px brick module ~= 0.10 m
  const RHO_AMBIENT = 1.204;             // kg/m^3 near 20 C
  const T_AMBIENT_K = AMBIENT_T + 273.15;
  const DISCHARGE_COEFFICIENT = 0.60;
  const HOT_THRESHOLD = 15;              // C above ambient
  const MAX_HOT_SEARCH_PX = 260;
  const STACK_PRESSURE_ITERS = 30;
  const STACK_COUPLING = 0.20;            // damping for coarse educational grid
  const STACK_ACCEL_CAP = 280;            // px/s^2 numerical stability cap
  const FIRE_PRESSURE_RADIUS = 30;

  const stackPressure = new Float32Array(N);
  const stackNext = new Float32Array(N);
  const fixed = new Uint8Array(N);
  const fixedValue = new Float32Array(N);

  function estimateStackHead(fire) {
    const fx = fire.x + BUILD_CELL / 2;
    const fy = fire.y + BUILD_CELL / 2;
    const intensity = fireIntensity(fire);
    if (intensity <= 0) return null;

    let maxRise = 0;
    let weightedT = 0;
    let weight = 0;

    const gx0 = gridX(fx - MAX_HOT_SEARCH_PX);
    const gx1 = gridX(fx + MAX_HOT_SEARCH_PX);
    const gy0 = gridY(Math.max(0, fy - MAX_HOT_SEARCH_PX));
    const gy1 = gridY(fy);

    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = idx(gx, gy);
        if (solid[i]) continue;
        const px = (gx + 0.5) * H;
        const py = (gy + 0.5) * H;
        const rise = fy - py;
        if (rise <= 0) continue;
        const lateral = Math.abs(px - fx);
        // The hot column may widen with height, but unrelated remote hot cells
        // should not contribute to this fire's stack head.
        if (lateral > 55 + rise * 0.55) continue;
        const dT = temperature[i] - AMBIENT_T;
        if (dT < HOT_THRESHOLD) continue;
        const w = dT * (1 + rise / MAX_HOT_SEARCH_PX);
        weightedT += temperature[i] * w;
        weight += w;
        if (rise > maxRise) maxRise = rise;
      }
    }

    if (weight <= 0 || maxRise < H) return null;

    const hotC = weightedT / weight;
    const hotK = hotC + 273.15;
    const rhoHot = RHO_AMBIENT * T_AMBIENT_K / hotK;
    const heightM = maxRise / PHYSICAL_PIXELS_PER_METER;
    const deltaP = Math.max(0, G * heightM * (RHO_AMBIENT - rhoHot));
    if (deltaP <= 1e-4) return null;

    // Diagnostic target velocity from the classic orifice relation.  The grid
    // is pressure-driven below; this value is used only to limit the correction
    // to a physically plausible order of magnitude.
    const targetMS = DISCHARGE_COEFFICIENT * Math.sqrt(2 * deltaP / RHO_AMBIENT);
    const targetPx = targetMS * PHYSICAL_PIXELS_PER_METER;

    return {fx, fy, deltaP, targetPx, hotC, heightM};
  }

  function buildStackPressureField() {
    stackPressure.fill(0);
    stackNext.fill(0);
    fixed.fill(0);
    fixedValue.fill(0);

    // Ambient gauge pressure at the outer computational boundary.
    for (let x = 0; x < NX; x++) {
      for (const y of [0, NY - 1]) {
        const i = idx(x, y);
        if (!solid[i]) { fixed[i] = 1; fixedValue[i] = 0; }
      }
    }
    for (let y = 0; y < NY; y++) {
      for (const x of [0, NX - 1]) {
        const i = idx(x, y);
        if (!solid[i]) { fixed[i] = 1; fixedValue[i] = 0; }
      }
    }

    let strongestTarget = 0;
    let active = 0;
    for (const fire of fires) {
      const head = estimateStackHead(fire);
      if (!head) continue;
      active++;
      strongestTarget = Math.max(strongestTarget, head.targetPx);
      const suction = -head.deltaP;
      const r2 = FIRE_PRESSURE_RADIUS * FIRE_PRESSURE_RADIUS;
      const gx0 = gridX(head.fx - FIRE_PRESSURE_RADIUS);
      const gx1 = gridX(head.fx + FIRE_PRESSURE_RADIUS);
      const gy0 = gridY(head.fy - FIRE_PRESSURE_RADIUS);
      const gy1 = gridY(head.fy + FIRE_PRESSURE_RADIUS);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = idx(gx, gy);
          if (solid[i]) continue;
          const px = (gx + 0.5) * H, py = (gy + 0.5) * H;
          if ((px - head.fx) ** 2 + (py - head.fy) ** 2 > r2) continue;
          fixed[i] = 1;
          // Multiple fires use the strongest local negative pressure.
          fixedValue[i] = Math.min(fixedValue[i], suction);
          stackPressure[i] = fixedValue[i];
        }
      }
    }

    if (!active) return 0;

    // Laplace solve through the actual open geometry. Solid neighbors use a
    // zero-normal-gradient condition, so pressure influence routes around walls.
    for (let iter = 0; iter < STACK_PRESSURE_ITERS; iter++) {
      for (let y = 0; y < NY; y++) {
        for (let x = 0; x < NX; x++) {
          const i = idx(x, y);
          if (solid[i]) { stackNext[i] = 0; continue; }
          if (fixed[i]) { stackNext[i] = fixedValue[i]; continue; }
          let sum = 0, count = 0;
          for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
            if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
            const ni = idx(nx, ny);
            if (solid[ni]) continue;
            sum += stackPressure[ni];
            count++;
          }
          stackNext[i] = count ? sum / count : 0;
        }
      }
      stackPressure.set(stackNext);
    }
    return strongestTarget;
  }

  function applyStackPressure(dt) {
    const targetPx = buildStackPressureField();
    if (targetPx <= 0) return;
    const dxM = H / PHYSICAL_PIXELS_PER_METER;

    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const i = idx(x, y);
        if (solid[i] || fixed[i]) continue;
        const pc = stackPressure[i];
        const pL = x > 0 && !solid[idx(x-1,y)] ? stackPressure[idx(x-1,y)] : pc;
        const pR = x < NX-1 && !solid[idx(x+1,y)] ? stackPressure[idx(x+1,y)] : pc;
        const pU = y > 0 && !solid[idx(x,y-1)] ? stackPressure[idx(x,y-1)] : pc;
        const pD = y < NY-1 && !solid[idx(x,y+1)] ? stackPressure[idx(x,y+1)] : pc;

        // a = -(1/rho) grad(p), converted from m/s^2 to px/s^2.
        let ax = -((pR - pL) / (2 * dxM)) / RHO_AMBIENT * PHYSICAL_PIXELS_PER_METER;
        let ay = -((pD - pU) / (2 * dxM)) / RHO_AMBIENT * PHYSICAL_PIXELS_PER_METER;
        ax = clamp(ax * STACK_COUPLING, -STACK_ACCEL_CAP, STACK_ACCEL_CAP);
        ay = clamp(ay * STACK_COUPLING, -STACK_ACCEL_CAP, STACK_ACCEL_CAP);
        u[i] += ax * dt;
        v[i] += ay * dt;

        // Avoid a coarse-grid pressure correction accelerating beyond the
        // velocity scale predicted by the orifice relation.
        const s = Math.hypot(u[i], v[i]);
        const limit = Math.max(45, Math.min(MAX_SPEED, targetPx * 1.25));
        if (s > limit) { u[i] = u[i] / s * limit; v[i] = v[i] / s * limit; }
      }
    }
  }

  // Correct the visual/physical length scale of the existing Boussinesq force.
  // app-v2 originally used 40 px/m; a 24 px brick module is much closer to a
  // 0.10 m teaching-scale brick, i.e. ~240 px/m.
  const baseAddBuoyancy = addBuoyancy;
  addBuoyancy = function(dt) {
    baseAddBuoyancy(dt);
    const extraPPM = PHYSICAL_PIXELS_PER_METER - PIXELS_PER_METER;
    if (extraPPM > 0) {
      for (let i = 0; i < N; i++) {
        if (solid[i]) continue;
        const dT = clamp(temperature[i] - AMBIENT_T, 0, BUOYANCY_DT_CAP);
        v[i] += (-G * BETA * dT * extraPPM) * dt;
      }
    }
    applyStackPressure(dt);
  };

  // Stratified tracer seeding.  This changes only visualization: it does not
  // alter temperature, oxygen, pressure, density, or velocity fields.
  seedTracers = function() {
    ensureGeometry();
    particles = [];
    const target = targetParticleCount();
    const candidates = [];
    const nearWall = [];
    const step = BUILD_CELL;
    for (let y = step/2; y < canvas.height; y += step) {
      for (let x = step/2; x < canvas.width; x += step) {
        if (isSolidPoint(x, y)) continue;
        const p = {x:x+(Math.random()-.5)*step*.45, y:y+(Math.random()-.5)*step*.45};
        candidates.push(p);
        const gx=gridX(x),gy=gridY(y);
        let adjacent=false;
        for(const[nx,ny]of[[gx-1,gy],[gx+1,gy],[gx,gy-1],[gx,gy+1]]){
          if(nx>=0&&ny>=0&&nx<NX&&ny<NY&&solid[idx(nx,ny)]){adjacent=true;break}
        }
        if(adjacent)nearWall.push(p);
      }
    }
    // Reserve roughly one third of tracers for wall-adjacent passages so narrow
    // ducts remain visually observable; the rest cover the ambient field.
    const wallQuota=Math.min(nearWall.length,Math.floor(target*.34));
    for(let i=nearWall.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[nearWall[i],nearWall[j]]=[nearWall[j],nearWall[i]]}
    for(let i=0;i<wallQuota;i++)particles.push(makeTracer(nearWall[i]));
    for(let i=candidates.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]]}
    for(let i=0;particles.length<target&&i<candidates.length;i++)particles.push(makeTracer(candidates[i]));
    while(particles.length<target)particles.push(makeTracer(randomOpenPoint()));
  };

  // Reseed only the visualization once when v2.2 loads.
  seedTracers();
})();
