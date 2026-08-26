import {
  H,
  MAX_SPEED,
  N,
  NX,
  NY,
  clamp,
  gridX,
  gridY,
  inCanvas,
  idx
} from '../core/grid.js';
import {
  boundaryMask,
  boundaryU,
  boundaryV,
  divergence,
  pressure,
  pressureNext,
  solid,
  u,
  v
} from '../core/fields.js';
import {enforceSolidNoFlow} from '../core/state.js';

const PROJECTION_ITERS = 48;
const BOUNDARY_RELAX = 0.72;
const RESIDUAL_LIMIT = 0.08;

let pressureResidual = 0;
let pressureEquationResidual = 0;
let projectionIterationsUsed = 0;
let projectedInFlow = 0;
let projectedOutFlow = 0;

export function resetConservationDiagnostics() {
  pressureResidual = 0;
  pressureEquationResidual = 0;
  projectionIterationsUsed = 0;
  projectedInFlow = 0;
  projectedOutFlow = 0;
}

function boundaryUAt(i) {
  return boundaryMask[i] ? boundaryU[i] : 0;
}

function boundaryVAt(i) {
  return boundaryMask[i] ? boundaryV[i] : 0;
}

function neighbourVelocityU(x, y, side, i) {
  const nx = side === 'L' ? x - 1 : x + 1;
  if (nx >= 0 && nx < NX) {
    const ni = idx(nx, y);
    if (!solid[ni]) return u[ni];
    return 0;
  }
  return x === 0 || x === NX - 1 ? boundaryUAt(i) : 0;
}

function neighbourVelocityV(x, y, side, i) {
  const ny = side === 'U' ? y - 1 : y + 1;
  if (ny >= 0 && ny < NY) {
    const ni = idx(x, ny);
    if (!solid[ni]) return v[ni];
    return 0;
  }
  return y === 0 || y === NY - 1 ? boundaryVAt(i) : 0;
}

function neighbourPressure(x, y, side, pc) {
  const nx = side === 'L' ? x - 1 : side === 'R' ? x + 1 : x;
  const ny = side === 'U' ? y - 1 : side === 'D' ? y + 1 : y;
  if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) return 0;
  const ni = idx(nx, ny);
  return solid[ni] ? pc : pressure[ni];
}

function actualNeighbourVelocityU(x, y, side, i) {
  const nx = side === 'L' ? x - 1 : x + 1;
  if (nx >= 0 && nx < NX) {
    const ni = idx(nx, y);
    if (!solid[ni]) return u[ni];
    return 0;
  }
  return x === 0 || x === NX - 1 ? u[i] : 0;
}

function actualNeighbourVelocityV(x, y, side, i) {
  const ny = side === 'U' ? y - 1 : y + 1;
  if (ny >= 0 && ny < NY) {
    const ni = idx(x, ny);
    if (!solid[ni]) return v[ni];
    return 0;
  }
  return y === 0 || y === NY - 1 ? v[i] : 0;
}

function applyOpenBoundaryVelocity(x, y, i) {
  if (!boundaryMask[i]) return;
  const targetU = boundaryUAt(i);
  const targetV = boundaryVAt(i);
  if (x === 0 || x === NX - 1) u[i] += (targetU - u[i]) * BOUNDARY_RELAX;
  if (y === 0 || y === NY - 1) v[i] += (targetV - v[i]) * BOUNDARY_RELAX;
}

function updateBoundaryDiagnostics() {
  projectedInFlow = 0;
  projectedOutFlow = 0;
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      if (x !== 0 && x !== NX - 1 && y !== 0 && y !== NY - 1) continue;
      const i = idx(x, y);
      if (solid[i]) continue;
      let outward = 0;
      if (x === 0) outward += -u[i];
      if (x === NX - 1) outward += u[i];
      if (y === 0) outward += -v[i];
      if (y === NY - 1) outward += v[i];
      if (outward >= 0) projectedOutFlow += outward;
      else projectedInFlow += -outward;
    }
  }
}

function boundaryFaces() {
  const faces = [];
  for (let x = 0; x < NX; x++) {
    const top = idx(x, 0);
    const bottom = idx(x, NY - 1);
    if (!solid[top]) faces.push({i: top, axis: 'v', sign: -1});
    if (!solid[bottom]) faces.push({i: bottom, axis: 'v', sign: 1});
  }
  for (let y = 0; y < NY; y++) {
    const left = idx(0, y);
    const right = idx(NX - 1, y);
    if (!solid[left]) faces.push({i: left, axis: 'u', sign: -1});
    if (!solid[right]) faces.push({i: right, axis: 'u', sign: 1});
  }
  return faces;
}

function faceNormalVelocity(face) {
  return face.sign * (face.axis === 'u' ? u[face.i] : v[face.i]);
}

function setFaceNormalVelocity(face, value) {
  if (face.axis === 'u') u[face.i] = face.sign * value;
  else v[face.i] = face.sign * value;
}

function balanceOpenBoundaryFlux() {
  const faces = boundaryFaces();
  if (!faces.length) return;

  let netOutward = 0;
  for (const face of faces) netOutward += faceNormalVelocity(face);
  if (Math.abs(netOutward) <= 1e-5) return;

  const correction = netOutward / faces.length;
  for (const face of faces) {
    setFaceNormalVelocity(face, faceNormalVelocity(face) - correction);
  }
}

export function computePressureEquationResidual() {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) continue;
      const pc = pressure[i];
      let neighbourSum = 0;
      let neighbourCount = 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) {
          neighbourCount++;
          continue;
        }
        const ni = idx(nx, ny);
        if (solid[ni]) continue;
        neighbourSum += pressure[ni];
        neighbourCount++;
      }
      const equation = neighbourSum - neighbourCount * pc - divergence[i] * H * H;
      sum += Math.abs(equation) / (Math.max(1, neighbourCount) * H * H);
      count++;
    }
  }
  return count ? sum / count : 0;
}

export function computeVelocityDivergenceResidual() {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) continue;
      const uL = actualNeighbourVelocityU(x, y, 'L', i);
      const uR = actualNeighbourVelocityU(x, y, 'R', i);
      const vU = actualNeighbourVelocityV(x, y, 'U', i);
      const vD = actualNeighbourVelocityV(x, y, 'D', i);
      sum += Math.abs((uR - uL + vD - vU) / (2 * H));
      count++;
    }
  }
  return count ? sum / count : 0;
}

export function projectVelocity() {
  pressure.fill(0);
  pressureNext.fill(0);
  divergence.fill(0);

  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) {
        u[i] = 0;
        v[i] = 0;
        continue;
      }
      const uL = neighbourVelocityU(x, y, 'L', i);
      const uR = neighbourVelocityU(x, y, 'R', i);
      const vU = neighbourVelocityV(x, y, 'U', i);
      const vD = neighbourVelocityV(x, y, 'D', i);
      divergence[i] = (uR - uL + vD - vU) / (2 * H);
    }
  }

  projectionIterationsUsed = 0;
  for (let iter = 0; iter < PROJECTION_ITERS; iter++) {
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const i = idx(x, y);
        if (solid[i]) {
          pressureNext[i] = 0;
          continue;
        }

        let sum = 0;
        let count = 0;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) {
            count++;
            continue;
          }
          const ni = idx(nx, ny);
          if (solid[ni]) continue;
          sum += pressure[ni];
          count++;
        }
        pressureNext[i] = count ? (sum - divergence[i] * H * H) / count : 0;
      }
    }
    pressure.set(pressureNext);
    projectionIterationsUsed = iter + 1;
    if (projectionIterationsUsed % 8 === 0 && computePressureEquationResidual() <= RESIDUAL_LIMIT) {
      break;
    }
  }

  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) {
        u[i] = 0;
        v[i] = 0;
        continue;
      }
      const pC = pressure[i];
      const pL = neighbourPressure(x, y, 'L', pC);
      const pR = neighbourPressure(x, y, 'R', pC);
      const pU = neighbourPressure(x, y, 'U', pC);
      const pD = neighbourPressure(x, y, 'D', pC);
      u[i] -= (pR - pL) / (2 * H);
      v[i] -= (pD - pU) / (2 * H);
      applyOpenBoundaryVelocity(x, y, i);

      const speed = Math.hypot(u[i], v[i]);
      if (speed > MAX_SPEED) {
        u[i] = u[i] / speed * MAX_SPEED;
        v[i] = v[i] / speed * MAX_SPEED;
      }
    }
  }
  enforceSolidNoFlow();
  balanceOpenBoundaryFlux();
  pressureEquationResidual = computePressureEquationResidual();
  pressureResidual = computeVelocityDivergenceResidual();
  updateBoundaryDiagnostics();
}

export function getConservationDiagnostics() {
  return {
    get pressureResidual() { return pressureResidual; },
    get pressureEquationResidual() { return pressureEquationResidual; },
    get projectedInFlow() { return projectedInFlow; },
    get projectedOutFlow() { return projectedOutFlow; },
    get projectionIterations() { return PROJECTION_ITERS; },
    get projectionIterationsUsed() { return projectionIterationsUsed; },
    get residualLimit() { return RESIDUAL_LIMIT; },
    samplePressureAt(x, y) {
      if (!inCanvas(x, y)) return 0;
      return pressure[idx(gridX(x), gridY(y))];
    },
    reset: resetConservationDiagnostics
  };
}
