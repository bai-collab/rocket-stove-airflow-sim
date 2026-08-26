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
  const STACK_PRESSURE_ITERS = 80;
  const STACK_OUTLET_SPEED_FRACTION = 0.28;
  const STACK_OUTLET_SPEED_CAP = 90;
  const FIRE_PRESSURE_RADIUS = 30;

  const stackPressure = new Float32Array(N);
  const stackNext = new Float32Array(N);
  const fixed = new Uint8Array(N);
  const fixedValue = new Float32Array(N);
  const boundaryU = new Float32Array(N);
  const boundaryV = new Float32Array(N);
  const boundaryMask = new Uint8Array(N);

  let topology = null;
  let topologyKey = '';
  let activeHeads = [];
  let boundaryInFlow = 0;
  let boundaryOutFlow = 0;

  function resetStackDiagnostics() {
    stackPressure.fill(0);
    stackNext.fill(0);
    fixed.fill(0);
    fixedValue.fill(0);
    boundaryU.fill(0);
    boundaryV.fill(0);
    boundaryMask.fill(0);
    activeHeads = [];
    boundaryInFlow = 0;
    boundaryOutFlow = 0;
  }

  const baseResetFields = resetFields;
  resetFields = function() {
    baseResetFields();
    resetStackDiagnostics();
  };

  const baseRebuildSolidMask = rebuildSolidMask;
  rebuildSolidMask = function() {
    baseRebuildSolidMask();
    topology = null;
    topologyKey = '';
    activeHeads = [];
    boundaryInFlow = 0;
    boundaryOutFlow = 0;
  };

  const previousResetHook = window.physicsV26ResetDiagnostics;
  window.physicsV26ResetDiagnostics = function() {
    if (typeof previousResetHook === 'function') previousResetHook();
    resetStackDiagnostics();
  };

  function currentTopologyKey() {
    let hash = 2166136261;
    for (let i = 0; i < N; i++) {
      hash ^= solid[i];
      hash = Math.imul(hash, 16777619);
    }
    return String(hash >>> 0);
  }

  function buildFluidComponents() {
    const componentByCell = new Int32Array(N);
    componentByCell.fill(-1);
    const components = [];
    const queue = new Int32Array(N);

    for (let start = 0; start < N; start++) {
      if (solid[start] || componentByCell[start] >= 0) continue;
      const id = components.length;
      const cells = [];
      const boundaryCells = [];
      let head = 0;
      let tail = 0;
      componentByCell[start] = id;
      queue[tail++] = start;

      while (head < tail) {
        const i = queue[head++];
        const x = i % NX;
        const y = Math.floor(i / NX);
        cells.push(i);
        if (x === 0 || y === 0 || x === NX - 1 || y === NY - 1) {
          boundaryCells.push(i);
        }

        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
          const ni = idx(nx, ny);
          if (solid[ni] || componentByCell[ni] >= 0) continue;
          componentByCell[ni] = id;
          queue[tail++] = ni;
        }
      }

      components.push({
        id,
        cells,
        boundaryCells,
        touchesBoundary: boundaryCells.length > 0
      });
    }
    return {componentByCell, components};
  }

  function getTopology() {
    const key = currentTopologyKey();
    if (!topology || topologyKey !== key) {
      topology = buildFluidComponents();
      topologyKey = key;
    }
    return topology;
  }

  function estimateStackHead(fire) {
    const fx = fire.x + BUILD_CELL / 2;
    const fy = fire.y + BUILD_CELL / 2;
    const intensity = fireIntensity(fire);
    if (intensity <= 0) return null;

    const model = getTopology();
    const fireCell = idx(gridX(fx), gridY(fy));
    const componentId = model.componentByCell[fireCell];
    const component = model.components[componentId];
    // A sealed room has no external pressure reference and must not receive
    // an artificial stack source. Its oxygen/scalar rules still run normally.
    if (!component || !component.touchesBoundary) return null;

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

    return {fx, fy, deltaP, targetPx, hotC, heightM, componentId};
  }

  function buildStackPressureField() {
    getTopology();
    stackPressure.fill(0);
    stackNext.fill(0);
    fixed.fill(0);
    fixedValue.fill(0);
    activeHeads = [];

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
    for (const fire of fires) {
      const head = estimateStackHead(fire);
      if (!head) continue;
      activeHeads.push(head);
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

    if (!activeHeads.length) return 0;

    // Solve the pressure potential through the actual open geometry. Solid
    // neighbors use a zero-normal-gradient condition. This field is retained
    // for diagnostics and for converting the pressure head into boundary
    // flux; it is not applied as a second free-space gradient force, because
    // the later incompressible projection would absorb that pure gradient.
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

  function addBoundaryNormal(i, outwardSpeed) {
    const x = i % NX;
    const y = Math.floor(i / NX);
    const faceCount = (x === 0 || x === NX - 1 ? 1 : 0) +
      (y === 0 || y === NY - 1 ? 1 : 0);
    if (!faceCount) return;
    // A corner cell represents two boundary faces. Split the requested
    // normal flux between them; applying the full value to both faces would
    // create an artificial extra inlet/outlet at every corner.
    const faceSpeed = outwardSpeed / faceCount;
    if (x === 0) {
      boundaryU[i] += -faceSpeed;
      boundaryMask[i] = 1;
    }
    if (x === NX - 1) {
      boundaryU[i] += faceSpeed;
      boundaryMask[i] = 1;
    }
    if (y === 0) {
      boundaryV[i] += -faceSpeed;
      boundaryMask[i] = 1;
    }
    if (y === NY - 1) {
      boundaryV[i] += faceSpeed;
      boundaryMask[i] = 1;
    }
  }

  function boundaryWeight(i, head) {
    const x = i % NX;
    const y = Math.floor(i / NX);
    const px = (x + 0.5) * H;
    const py = (y + 0.5) * H;
    const rise = head.fy - py;
    const lateral = Math.abs(px - head.fx);
    return Math.max(0.15, 1 + rise / MAX_HOT_SEARCH_PX - lateral / 160);
  }

  function isOutletCandidate(i, head) {
    const x = i % NX;
    const y = Math.floor(i / NX);
    const px = (x + 0.5) * H;
    const py = (y + 0.5) * H;
    const rise = head.fy - py;
    const lateral = Math.abs(px - head.fx);
    return rise > H && lateral <= 55 + rise * 0.55;
  }

  function addBoundaryFluxForHead(head) {
    const model = getTopology();
    const component = model.components[head.componentId];
    if (!component || !component.touchesBoundary) return;

    let outlet = component.boundaryCells.filter(i => isOutletCandidate(i, head));
    if (!outlet.length) {
      const highestY = Math.min(...component.boundaryCells.map(i => Math.floor(i / NX)));
      outlet = component.boundaryCells.filter(i => Math.floor(i / NX) === highestY);
    }
    const outletSet = new Set(outlet);
    const inlet = component.boundaryCells.filter(i => !outletSet.has(i));
    if (!outlet.length || !inlet.length) return;

    const outletWeights = outlet.map(i => boundaryWeight(i, head));
    const outletMean = outletWeights.reduce((sum, w) => sum + w, 0) / outletWeights.length;
    const outletSpeed = clamp(
      head.targetPx * STACK_OUTLET_SPEED_FRACTION,
      8,
      STACK_OUTLET_SPEED_CAP
    );
    let totalFlux = 0;
    for (let k = 0; k < outlet.length; k++) {
      const speed = outletSpeed * outletWeights[k] / Math.max(0.1, outletMean);
      addBoundaryNormal(outlet[k], speed);
      totalFlux += speed;
    }

    const inletWeights = inlet.map(i => Math.max(0.20, 1 / (1 + Math.abs(Math.floor(i / NX) - Math.floor(head.fy / H)) * 0.04)));
    const inletWeightSum = inletWeights.reduce((sum, w) => sum + w, 0);
    for (let k = 0; k < inlet.length; k++) {
      const speed = -totalFlux * inletWeights[k] / Math.max(1e-6, inletWeightSum);
      addBoundaryNormal(inlet[k], speed);
    }
  }

  function updateBoundaryFlux() {
    boundaryU.fill(0);
    boundaryV.fill(0);
    boundaryMask.fill(0);
    for (const head of activeHeads) addBoundaryFluxForHead(head);

    boundaryInFlow = 0;
    boundaryOutFlow = 0;
    const model = getTopology();
    for (const component of model.components) {
      if (!component.touchesBoundary) continue;
      for (const i of component.boundaryCells) {
        const x = i % NX;
        const y = Math.floor(i / NX);
        let outward = 0;
        if (x === 0) outward += -boundaryU[i];
        if (x === NX - 1) outward += boundaryU[i];
        if (y === 0) outward += -boundaryV[i];
        if (y === NY - 1) outward += boundaryV[i];
        if (outward >= 0) boundaryOutFlow += outward;
        else boundaryInFlow += -outward;
      }
    }
  }

  function updateStackFlow() {
    buildStackPressureField();
    updateBoundaryFlux();
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
    updateStackFlow();
  };

  const metricsPanel = document.querySelector('.panel.metrics');
  const advancedMetrics = document.getElementById('advancedMetrics');
  let stackPressureEl = null;
  let stackHeightEl = null;
  let stackFluxEl = null;
  const metricsTarget = advancedMetrics || metricsPanel;
  if (metricsTarget) {
    const addCard = (label, id) => {
      const card = document.createElement('div');
      card.className = 'metric-card';
      card.innerHTML = `<span>${label}</span><strong id="${id}">—</strong>`;
      metricsTarget.appendChild(card);
      return card.querySelector(`#${id}`);
    };
    stackPressureEl = addCard('煙囪壓差（表壓）', 'stackPressureValue');
    stackHeightEl = addCard('有效熱柱高度', 'stackHeightValue');
    stackFluxEl = addCard('邊界通量（進／出）', 'stackFluxValue');
  }

  const baseUpdateMetrics = updateMetrics;
  updateMetrics = function() {
    baseUpdateMetrics();
    const strongest = activeHeads.reduce((best, head) => head.deltaP > best.deltaP ? head : best, {deltaP: 0, heightM: 0});
    if (stackPressureEl) stackPressureEl.textContent = `${strongest.deltaP.toFixed(2)} Pa`;
    if (stackHeightEl) stackHeightEl.textContent = `${(strongest.heightM * 100).toFixed(0)} cm`;
    if (stackFluxEl) stackFluxEl.textContent = `${boundaryInFlow.toFixed(1)} ／ ${boundaryOutFlow.toFixed(1)} px²/s`;
  };

  window.stackFlowV26 = {
    boundaryU,
    boundaryV,
    boundaryMask,
    pressureField: stackPressure,
    get activeHeads() {
      return activeHeads.map(head => ({
        deltaP: head.deltaP,
        targetPx: head.targetPx,
        hotC: head.hotC,
        heightM: head.heightM,
        componentId: head.componentId
      }));
    },
    get boundaryInFlow() { return boundaryInFlow; },
    get boundaryOutFlow() { return boundaryOutFlow; },
    get openComponents() { return getTopology().components.filter(c => c.touchesBoundary).length; },
    get sealedComponents() { return getTopology().components.filter(c => !c.touchesBoundary).length; },
    reset: resetStackDiagnostics
  };

  if (typeof globalThis !== 'undefined' && globalThis.__oracleFields) {
    globalThis.__oracleFields.boundaryU = boundaryU;
    globalThis.__oracleFields.boundaryV = boundaryV;
    globalThis.__oracleFields.boundaryMask = boundaryMask;
  }

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
