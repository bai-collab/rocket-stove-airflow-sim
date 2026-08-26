import {
  BUILD_CELL,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  H,
  N,
  NX,
  NY,
  clamp,
  gridX,
  gridY,
  idx,
  inCanvas
} from '../core/grid.js';
import {solid, u, v} from '../core/fields.js';
import {
  ensureGeometry,
  ignited,
  isSolidPoint,
  lineClear,
  particles,
  setParticles,
  targetParticleCount
} from '../core/state.js';

const MIN_INFLOW = 0.03;
const EDGE_INSET = 2.5;
const TRACE_STEP = Math.max(2, H * 0.35);
const PARTICLE_SOURCE_TAU = 0.85;
const BOUNDARY_FLOW_REFERENCE = 240;
const BACKGROUND_BOUNDARY_WEIGHT = 0.22;
const BOUNDARY_BAND_CELLS = 5;
const BOUNDARY_RESERVE_RATIO = 0.28;
const MAX_DENSITY_RESAMPLES_PER_STEP = 2;

let respawnCount = 0;
let visualSeedCount = 0;
let boundaryInjectedCount = 0;
let densityResampleCount = 0;
let boundarySourceRate = 0;
let boundaryParticleDensity = 0;
let boundaryBandParticles = 0;
let boundaryBandTargetCount = 0;
let boundaryFluxIn = 0;
let boundaryFluxOut = 0;
let boundaryModel = null;

export function resetTracerDiagnostics(resetModel = false) {
  respawnCount = 0;
  visualSeedCount = 0;
  boundaryInjectedCount = 0;
  densityResampleCount = 0;
  boundarySourceRate = 0;
  boundaryParticleDensity = 0;
  boundaryBandParticles = 0;
  boundaryBandTargetCount = 0;
  boundaryFluxIn = 0;
  boundaryFluxOut = 0;
  if (resetModel) boundaryModel = null;
}

export function resetTracerGeometry() {
  boundaryModel = null;
  boundarySourceRate = 0;
  boundaryParticleDensity = 0;
  boundaryBandParticles = 0;
  boundaryBandTargetCount = 0;
  boundaryFluxIn = 0;
  boundaryFluxOut = 0;
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
    const boundaryBandCells = [];
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
      if (Math.min(x, y, NX - 1 - x, NY - 1 - y) <= BOUNDARY_BAND_CELLS) {
        boundaryBandCells.push(i);
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
      boundaryBandCells,
      touchesBoundary: boundaryCells.length > 0,
      particleCount: 0,
      boundaryBandCount: 0,
      targetCount: 0,
      targetDensity: 0,
      boundaryTargetCount: 0,
      boundaryFlux: 0,
      boundaryFluxIn: 0,
      boundaryFluxOut: 0,
      deficitSourceRate: 0,
      fluxSourceRate: 0,
      sourceRate: 0,
      sourceAccumulator: 0
    });
  }

  return {componentByCell, components};
}

function getBoundaryModel() {
  if (!boundaryModel) boundaryModel = buildFluidComponents();
  return boundaryModel;
}

function componentAtPoint(x, y) {
  if (!inCanvas(x, y)) return -1;
  return getBoundaryModel().componentByCell[idx(gridX(x), gridY(y))];
}

function isBoundaryBandCell(cell) {
  const x = cell % NX;
  const y = Math.floor(cell / NX);
  return Math.min(x, y, NX - 1 - x, NY - 1 - y) <= BOUNDARY_BAND_CELLS;
}

function nearestOpenPointInComponent(x, y, componentId) {
  const model = getBoundaryModel();
  const component = model.components[componentId];
  if (!component) return null;
  if (componentId === componentAtPoint(x, y)) return {x, y};

  const gx = gridX(x), gy = gridY(y);
  for (let radius = 1; radius <= 8; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
        if (model.componentByCell[idx(nx, ny)] === componentId) {
          return {x: (nx + 0.5) * H, y: (ny + 0.5) * H};
        }
      }
    }
  }

  const first = component.cells[0];
  return first === undefined ? null : {
    x: (first % NX + 0.5) * H,
    y: (Math.floor(first / NX) + 0.5) * H
  };
}

function collectBoundaryCandidates() {
  const model = getBoundaryModel();
  const candidates = [];
  for (const component of model.components) {
    component.boundaryFlux = 0;
    component.boundaryFluxIn = 0;
    component.boundaryFluxOut = 0;
    component.sourceRate = 0;
  }

  function add(x, y, inwardSpeed) {
    const i = idx(x, y);
    if (solid[i]) return;
    const componentId = model.componentByCell[i];
    const component = model.components[componentId];
    if (!component || !component.touchesBoundary) return;
    const inward = Math.max(0, Number(inwardSpeed) || 0);
    const outward = Math.max(0, -(Number(inwardSpeed) || 0));
    component.boundaryFlux += inward;
    component.boundaryFluxIn += inward;
    component.boundaryFluxOut += outward;
    candidates.push({
      x: (x + 0.5) * H,
      y: (y + 0.5) * H,
      w: BACKGROUND_BOUNDARY_WEIGHT + inward,
      componentId
    });
  }

  for (let x = 0; x < NX; x++) {
    const top = idx(x, 0);
    const bottom = idx(x, NY - 1);
    if (!solid[top]) add(x, 0, v[top]);
    if (!solid[bottom]) add(x, NY - 1, -v[bottom]);
  }
  for (let y = 0; y < NY; y++) {
    const left = idx(0, y);
    const right = idx(NX - 1, y);
    if (!solid[left]) add(0, y, u[left]);
    if (!solid[right]) add(NX - 1, y, -u[right]);
  }
  return candidates;
}

function componentCandidates(candidates, componentId) {
  return candidates.filter(q => q.componentId === componentId);
}

function makeTracer(p) {
  return {x: p.x, y: p.y, vx: 0, vy: 0};
}

function randomOpenPoint() {
  for (let tries = 0; tries < 400; tries++) {
    const x = 2 + Math.random() * (CANVAS_WIDTH - 4);
    const y = 2 + Math.random() * (CANVAS_HEIGHT - 4);
    if (!isSolidPoint(x, y)) return {x, y};
  }
  return {x: 2, y: 2};
}

function nearestOpenPoint(x, y) {
  if (!isSolidPoint(x, y)) return {x, y};
  const gx = gridX(x), gy = gridY(y);
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
        if (!solid[idx(nx, ny)]) return {x: (nx + 0.5) * H, y: (ny + 0.5) * H};
      }
    }
  }
  return randomOpenPoint();
}

export function seedBaseTracers() {
  ensureGeometry();
  setParticles([]);
  const target = targetParticleCount();
  for (let i = 0; i < target; i++) particles.push(makeTracer(randomOpenPoint()));
}

export function seedStratifiedTracers() {
  ensureGeometry();
  setParticles([]);
  const target = targetParticleCount();
  const candidates = [];
  const nearWall = [];
  const step = BUILD_CELL;
  for (let y = step / 2; y < CANVAS_HEIGHT; y += step) {
    for (let x = step / 2; x < CANVAS_WIDTH; x += step) {
      if (isSolidPoint(x, y)) continue;
      const p = {x: x + (Math.random() - .5) * step * .45, y: y + (Math.random() - .5) * step * .45};
      candidates.push(p);
      const gx = gridX(x), gy = gridY(y);
      let adjacent = false;
      for (const [nx, ny] of [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]]) {
        if (nx >= 0 && ny >= 0 && nx < NX && ny < NY && solid[idx(nx, ny)]) {
          adjacent = true;
          break;
        }
      }
      if (adjacent) nearWall.push(p);
    }
  }
  const wallQuota = Math.min(nearWall.length, Math.floor(target * .34));
  for (let i = nearWall.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nearWall[i], nearWall[j]] = [nearWall[j], nearWall[i]];
  }
  for (let i = 0; i < wallQuota; i++) particles.push(makeTracer(nearWall[i]));
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (let i = 0; particles.length < target && i < candidates.length; i++) {
    particles.push(makeTracer(candidates[i]));
  }
  while (particles.length < target) particles.push(makeTracer(randomOpenPoint()));
}

export function seedTracers() {
  boundaryModel = null;
  boundaryInjectedCount = 0;
  densityResampleCount = 0;
  boundarySourceRate = 0;
  boundaryParticleDensity = 0;
  boundaryBandParticles = 0;
  boundaryBandTargetCount = 0;
  boundaryFluxIn = 0;
  boundaryFluxOut = 0;
  seedStratifiedTracers();
}

function weightedPick(candidates) {
  if (!candidates.length) return null;
  let sum = 0;
  for (const q of candidates) sum += Math.max(MIN_INFLOW, q.w);
  let r = Math.random() * sum;
  for (const q of candidates) {
    r -= Math.max(MIN_INFLOW, q.w);
    if (r <= 0) return jitterSpawn(q);
  }
  const q = candidates[candidates.length - 1];
  return jitterSpawn(q);
}

function jitterSpawn(q) {
  const p = {
    x: clamp(q.x + (Math.random() - 0.5) * H * 0.65, EDGE_INSET, CANVAS_WIDTH - EDGE_INSET),
    y: clamp(q.y + (Math.random() - 0.5) * H * 0.65, EDGE_INSET, CANVAS_HEIGHT - EDGE_INSET)
  };
  if (!isSolidPoint(p.x, p.y)) return p;
  return nearestOpenPointInComponent(q.x, q.y, q.componentId) || p;
}

export function boundarySpawnForFlow(componentId = null) {
  const model = getBoundaryModel();
  const candidates = collectBoundaryCandidates();
  const filtered = componentId === null
    ? candidates
    : componentCandidates(candidates, componentId);

  if (filtered.length) return weightedPick(filtered);
  if (componentId !== null) {
    const component = model.components[componentId];
    if (!component || !component.touchesBoundary) return null;
  }
  const openCandidates = candidates.filter(q => model.components[q.componentId]?.touchesBoundary);
  if (openCandidates.length) return weightedPick(openCandidates);
  visualSeedCount++;
  return null;
}

function sampleVelocitySafe(px, py) {
  if (!inCanvas(px, py) || isSolidPoint(px, py)) return {x: 0, y: 0};

  const gxFloat = px / H - 0.5;
  const gyFloat = py / H - 0.5;
  const x0 = Math.floor(gxFloat), y0 = Math.floor(gyFloat);
  const tx = gxFloat - x0, ty = gyFloat - y0;
  let sumU = 0, sumV = 0, weightSum = 0;

  for (let oy = 0; oy <= 1; oy++) {
    for (let ox = 0; ox <= 1; ox++) {
      const x = x0 + ox, y = y0 + oy;
      if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
      const i = idx(x, y);
      if (solid[i]) continue;
      const w = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty);
      if (w <= 0) continue;

      const cx = (x + 0.5) * H;
      const cy = (y + 0.5) * H;
      if (!lineClear(px, py, cx, cy, false)) continue;
      sumU += u[i] * w;
      sumV += v[i] * w;
      weightSum += w;
    }
  }

  if (weightSum > 1e-6) return {x: sumU / weightSum, y: sumV / weightSum};
  const i = idx(gridX(px), gridY(py));
  return solid[i] ? {x: 0, y: 0} : {x: u[i], y: v[i]};
}

function moveTracer(p, dx, dy) {
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / TRACE_STEP));
  const stepX = dx / steps, stepY = dy / steps;

  for (let step = 0; step < steps; step++) {
    const startX = p.x, startY = p.y;
    const targetX = startX + stepX, targetY = startY + stepY;
    if (!inCanvas(targetX, targetY)) return false;

    const canX = !isSolidPoint(targetX, startY) &&
      lineClear(startX, startY, targetX, startY, false);
    const canY = !isSolidPoint(startX, targetY) &&
      lineClear(startX, startY, startX, targetY, false);
    const canDiagonal = !isSolidPoint(targetX, targetY) &&
      lineClear(startX, startY, targetX, targetY, false);

    if (canDiagonal) {
      p.x = targetX;
      p.y = targetY;
    } else {
      if (Math.abs(stepX) >= Math.abs(stepY)) {
        if (canX) p.x = targetX;
        else if (canY) p.y = targetY;
      } else if (canY) {
        p.y = targetY;
      } else if (canX) {
        p.x = targetX;
      }
      if (!canX && !canY) {
        p.vx = 0;
        p.vy = 0;
        return true;
      }
    }
  }
  return true;
}

function resetAfterTrueExit(p, componentId) {
  const q = boundarySpawnForFlow(componentId);
  if (!q) {
    const safe = nearestOpenPointInComponent(p.prevX, p.prevY, componentId);
    if (!safe) return;
    p.x = safe.x;
    p.y = safe.y;
  } else {
    p.x = q.x;
    p.y = q.y;
  }
  p.vx = 0;
  p.vy = 0;
  p.prevX = p.x;
  p.prevY = p.y;
  respawnCount++;
}

function refreshComponentPopulations(model, target) {
  const cellCounts = new Uint16Array(N);
  boundaryBandParticles = 0;
  boundaryBandTargetCount = 0;
  for (const component of model.components) {
    component.particleCount = 0;
    component.boundaryBandCount = 0;
    component.targetCount = 0;
    component.targetDensity = 0;
    component.boundaryTargetCount = 0;
  }

  for (const p of particles) {
    const componentId = componentAtPoint(p.x, p.y);
    if (componentId < 0) continue;
    const component = model.components[componentId];
    component.particleCount++;
    const cell = idx(gridX(p.x), gridY(p.y));
    cellCounts[cell]++;
    if (isBoundaryBandCell(cell)) {
      component.boundaryBandCount++;
      if (component.touchesBoundary) boundaryBandParticles++;
    }
  }

  const openComponents = model.components.filter(component => component.touchesBoundary);
  const openArea = openComponents.reduce((sum, component) => sum + component.cells.length, 0);
  boundaryParticleDensity = openArea > 0 ? target / openArea : 0;
  for (const component of openComponents) {
    component.targetCount = openArea > 0
      ? target * component.cells.length / openArea
      : 0;
    component.targetDensity = boundaryParticleDensity;
    component.boundaryTargetCount = Math.max(2, component.targetCount * BOUNDARY_RESERVE_RATIO);
    boundaryBandTargetCount += component.boundaryTargetCount;
  }
  return {openComponents, cellCounts};
}

function replenishOpenBoundary(dt) {
  const model = getBoundaryModel();
  const target = targetParticleCount();
  const population = refreshComponentPopulations(model, target);
  const openComponents = population.openComponents;
  const candidates = collectBoundaryCandidates();
  boundarySourceRate = 0;
  boundaryFluxIn = 0;
  boundaryFluxOut = 0;

  for (const component of openComponents) {
    const deficit = Math.max(0, component.targetCount - component.particleCount);
    const flowFactor = 1 + Math.min(
      component.boundaryFluxIn / BOUNDARY_FLOW_REFERENCE,
      1
    );
    const fluxDensityRate = component.boundaryFluxIn * component.targetDensity / Math.max(1, H);
    component.deficitSourceRate = deficit > 0
      ? deficit / PARTICLE_SOURCE_TAU * flowFactor
      : 0;
    component.fluxSourceRate = fluxDensityRate;
    component.sourceRate = component.deficitSourceRate + component.fluxSourceRate;
    boundarySourceRate += component.sourceRate;
    boundaryFluxIn += component.boundaryFluxIn;
    boundaryFluxOut += component.boundaryFluxOut;
    component.sourceAccumulator += component.deficitSourceRate * dt;

    const choices = componentCandidates(candidates, component.id);
    while (component.sourceAccumulator >= 1 && choices.length) {
      const q = weightedPick(choices);
      if (!q) break;
      particles.push(makeTracer(q));
      component.particleCount++;
      component.sourceAccumulator -= 1;
      boundaryInjectedCount++;
    }
    if (component.particleCount >= component.targetCount) {
      component.sourceAccumulator = 0;
    }
  }

  rebalanceBoundaryBand(model, openComponents, candidates, population.cellCounts);
}

function rebalanceBoundaryBand(model, openComponents, candidates, cellCounts) {
  let remaining = MAX_DENSITY_RESAMPLES_PER_STEP;
  if (remaining <= 0) return;

  for (const component of openComponents) {
    if (remaining <= 0) break;
    if (component.boundaryFluxIn <= 0) continue;
    let deficit = Math.ceil(component.boundaryTargetCount - component.boundaryBandCount);
    if (deficit <= 0) continue;

    const choices = componentCandidates(candidates, component.id);
    while (deficit > 0 && remaining > 0 && choices.length) {
      const donor = findOverrepresentedTracer(component, cellCounts);
      const q = weightedPick(choices);
      if (!donor || !q) break;
      donor.x = q.x;
      donor.y = q.y;
      donor.vx = 0;
      donor.vy = 0;
      donor.prevX = donor.x;
      donor.prevY = donor.y;
      densityResampleCount++;
      remaining--;
      deficit--;
      component.boundaryBandCount++;
    }
  }
}

function findOverrepresentedTracer(component, cellCounts) {
  let best = null;
  let bestScore = 0;
  for (const p of particles) {
    const componentId = componentAtPoint(p.x, p.y);
    if (componentId !== component.id) continue;
    const cell = idx(gridX(p.x), gridY(p.y));
    if (isBoundaryBandCell(cell)) continue;
    const score = cellCounts[cell] - component.targetDensity * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export function trimOpenPopulation(target) {
  const model = getBoundaryModel();
  let openCount = 0;
  for (const p of particles) {
    const componentId = componentAtPoint(p.x, p.y);
    if (componentId >= 0 && model.components[componentId].touchesBoundary) openCount++;
  }
  let excess = Math.max(0, openCount - target);
  if (!excess) return;

  const kept = [];
  for (const p of particles) {
    const componentId = componentAtPoint(p.x, p.y);
    const isOpen = componentId >= 0 && model.components[componentId].touchesBoundary;
    if (isOpen && excess > 0) {
      excess--;
      continue;
    }
    kept.push(p);
  }
  setParticles(kept);
}

export function updateTracers(dt) {
  const target = targetParticleCount();

  trimOpenPopulation(target);
  while (particles.length < target) {
    const q = ignited ? boundarySpawnForFlow() : randomOpenPoint();
    const p = makeTracer(q || randomOpenPoint());
    particles.push(p);
  }

  for (const p of particles) {
    if (!Number.isFinite(p.prevX) || !Number.isFinite(p.prevY)) {
      p.prevX = p.x;
      p.prevY = p.y;
    }
    p.prevX = p.x;
    p.prevY = p.y;
    const componentId = componentAtPoint(p.x, p.y);
    const vel = sampleVelocitySafe(p.x, p.y);
    p.vx = Number.isFinite(vel.x) ? vel.x : 0;
    p.vy = Number.isFinite(vel.y) ? vel.y : 0;

    if (!Number.isFinite(p.vx) || !Number.isFinite(p.vy) ||
        !moveTracer(p, p.vx * dt, p.vy * dt)) {
      resetAfterTrueExit(p, componentId);
    }
  }

  replenishOpenBoundary(dt);
}

export function relocateTracersOutOfSolids() {
  for (const p of particles) {
    if (isSolidPoint(p.x, p.y)) {
      const q = nearestOpenPoint(p.x, p.y);
      p.x = q.x;
      p.y = q.y;
      p.vx = 0;
      p.vy = 0;
    }
  }
}

export function getTracerDiagnostics() {
  const model = getBoundaryModel();
  return {
    get particleCount() { return particles.length; },
    get visibleParticleCount() {
      let count = 0;
      for (const p of particles) if (inCanvas(p.x, p.y) && !isSolidPoint(p.x, p.y)) count++;
      return count;
    },
    get respawnCount() { return respawnCount; },
    get visualSeedCount() { return visualSeedCount; },
    get boundaryInjectedCount() { return boundaryInjectedCount; },
    get boundarySourceRate() { return boundarySourceRate; },
    get densityResampleCount() { return densityResampleCount; },
    get boundaryParticleDensity() { return boundaryParticleDensity; },
    get boundaryBandParticles() { return boundaryBandParticles; },
    get boundaryBandTargetCount() { return boundaryBandTargetCount; },
    get boundaryFluxIn() { return boundaryFluxIn; },
    get boundaryFluxOut() { return boundaryFluxOut; },
    resetDiagnostics: () => resetTracerDiagnostics(true),
    trimOpenPopulation,
    get openComponents() { return model.components.filter(component => component.touchesBoundary).length; },
    get sealedComponents() { return model.components.filter(component => !component.touchesBoundary).length; }
  };
}

export {makeTracer, randomOpenPoint, nearestOpenPoint};
