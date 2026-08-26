import {
  AMBIENT_T,
  BETA,
  BUILD_CELL,
  BUOYANCY_DT_CAP,
  G,
  H,
  MAX_SPEED,
  N,
  NX,
  NY,
  PIXELS_PER_METER,
  clamp,
  gridX,
  gridY,
  idx
} from '../core/grid.js';
import {
  boundaryMask,
  boundaryU,
  boundaryV,
  fixed,
  fixedValue,
  solid,
  stackNext,
  stackPressure,
  temperature,
  v
} from '../core/fields.js';
import {fires, fireIntensity} from '../core/state.js';

const PHYSICAL_PPM = 240;
const RHO_AMBIENT = 1.204;
const T_AMBIENT_K = AMBIENT_T + 273.15;
const DISCHARGE_COEFFICIENT = 0.60;
const HOT_THRESHOLD = 15;
const MAX_HOT_SEARCH = 260;
const STACK_PRESSURE_ITERS = 80;
const STACK_OUTLET_SPEED_FRACTION = 0.28;
const STACK_OUTLET_SPEED_CAP = 90;
const FIRE_PRESSURE_RADIUS = 30;

let topology = null;
let topologyKey = '';
let activeHeads = [];
let boundaryInFlow = 0;
let boundaryOutFlow = 0;

export function resetStackDiagnostics() {
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

export function resetStackGeometry() {
  topology = null;
  topologyKey = '';
  activeHeads = [];
  boundaryInFlow = 0;
  boundaryOutFlow = 0;
}

function currentTopologyKey() {
  let hash = 2166136261;
  for (let i = 0; i < N; i++) {
    hash ^= solid[i];
    hash = Math.imul(hash, 16777619);
  }
  return String(hash >>> 0);
}

export function buildFluidComponents() {
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

export function getTopology() {
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
  if (!component || !component.touchesBoundary) return null;

  let maxRise = 0;
  let weightedT = 0;
  let weight = 0;

  const gx0 = gridX(fx - MAX_HOT_SEARCH);
  const gx1 = gridX(fx + MAX_HOT_SEARCH);
  const gy0 = gridY(Math.max(0, fy - MAX_HOT_SEARCH));
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
      if (lateral > 55 + rise * 0.55) continue;
      const dT = temperature[i] - AMBIENT_T;
      if (dT < HOT_THRESHOLD) continue;
      const w = dT * (1 + rise / MAX_HOT_SEARCH);
      weightedT += temperature[i] * w;
      weight += w;
      if (rise > maxRise) maxRise = rise;
    }
  }

  if (weight <= 0 || maxRise < H) return null;

  const hotC = weightedT / weight;
  const hotK = hotC + 273.15;
  const rhoHot = RHO_AMBIENT * T_AMBIENT_K / hotK;
  const heightM = maxRise / PHYSICAL_PPM;
  const deltaP = Math.max(0, G * heightM * (RHO_AMBIENT - rhoHot));
  if (deltaP <= 1e-4) return null;

  const targetMS = DISCHARGE_COEFFICIENT * Math.sqrt(2 * deltaP / RHO_AMBIENT);
  const targetPx = targetMS * PHYSICAL_PPM;

  return {fx, fy, deltaP, targetPx, hotC, heightM, componentId};
}

function buildStackPressureField() {
  getTopology();
  stackPressure.fill(0);
  stackNext.fill(0);
  fixed.fill(0);
  fixedValue.fill(0);
  activeHeads = [];

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
        fixedValue[i] = Math.min(fixedValue[i], suction);
        stackPressure[i] = fixedValue[i];
      }
    }
  }

  if (!activeHeads.length) return 0;

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
  return Math.max(0.15, 1 + rise / MAX_HOT_SEARCH - lateral / 160);
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

export function updateStackFlow() {
  buildStackPressureField();
  updateBoundaryFlux();
}

export function applyStackBuoyancy(dt) {
  const extraPPM = PHYSICAL_PPM - PIXELS_PER_METER;
  if (extraPPM > 0) {
    for (let i = 0; i < N; i++) {
      if (solid[i]) continue;
      const dT = clamp(temperature[i] - AMBIENT_T, 0, BUOYANCY_DT_CAP);
      v[i] += (-G * BETA * dT * extraPPM) * dt;
    }
  }
  updateStackFlow();
}

export function getStackDiagnostics() {
  return {
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
    boundaryU,
    boundaryV,
    boundaryMask,
    pressureField: stackPressure,
    reset: resetStackDiagnostics
  };
}
