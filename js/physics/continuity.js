import {
  H,
  AMBIENT_T,
  MAX_SPEED,
  N,
  NX,
  NY,
  idx
} from '../core/grid.js';
import {solid, temperature, u, v} from '../core/fields.js';

const PPM = 240;
const RHO0 = 1.204;
const T0K = AMBIENT_T + 273.15;
const DEPTH_M = 0.10;
const UPSTREAM_CELLS = 3;
const MAX_AREA_RATIO = 3.0;
const MAX_SPEED_RATIO = 2.8;
const MIN_FLOW_SPEED = 1.2;
const RELAX_RATE = 4.0;

let continuityBest = null;

function rhoAt(i) {
  if (solid[i]) return RHO0;
  const tk = Math.max(180, temperature[i] + 273.15);
  return RHO0 * T0K / tk;
}

function sectionAt(gx, gy, orientation) {
  if (gx < 0 || gy < 0 || gx >= NX || gy >= NY) return null;
  const ci = idx(gx, gy);
  if (solid[ci]) return null;

  const cells = [];
  if (orientation === 'h') {
    let y0 = gy, y1 = gy;
    while (y0 - 1 >= 0 && !solid[idx(gx, y0 - 1)]) y0--;
    while (y1 + 1 < NY && !solid[idx(gx, y1 + 1)]) y1++;
    if (y0 === 0 || y1 === NY - 1) return null;
    for (let y = y0; y <= y1; y++) cells.push(idx(gx, y));
  } else {
    let x0 = gx, x1 = gx;
    while (x0 - 1 >= 0 && !solid[idx(x0 - 1, gy)]) x0--;
    while (x1 + 1 < NX && !solid[idx(x1 + 1, gy)]) x1++;
    if (x0 === 0 || x1 === NX - 1) return null;
    for (let x = x0; x <= x1; x++) cells.push(idx(x, gy));
  }

  if (!cells.length) return null;
  const widthM = cells.length * H / PPM;
  const area = widthM * DEPTH_M;
  let weightedRho = 0;
  let axialSum = 0;
  for (const i of cells) {
    weightedRho += rhoAt(i);
    axialSum += orientation === 'h' ? u[i] : v[i];
  }
  return {
    cells,
    area,
    rho: weightedRho / cells.length,
    axial: axialSum / cells.length
  };
}

export function applyContinuity(dt) {
  continuityBest = null;
  const touched = new Uint8Array(N);

  for (let gy = 0; gy < NY; gy++) {
    for (let gx = 0; gx < NX; gx++) {
      const i = idx(gx, gy);
      if (solid[i] || touched[i]) continue;
      const sx = u[i], sy = v[i];
      const speed = Math.hypot(sx, sy);
      if (speed < MIN_FLOW_SPEED) continue;

      const orientation = Math.abs(sx) >= Math.abs(sy) ? 'h' : 'v';
      const sign = orientation === 'h' ? Math.sign(sx) : Math.sign(sy);
      if (!sign) continue;

      const current = sectionAt(gx, gy, orientation);
      if (!current) continue;

      const ugx = orientation === 'h' ? gx - sign * UPSTREAM_CELLS : gx;
      const ugy = orientation === 'v' ? gy - sign * UPSTREAM_CELLS : gy;
      const upstream = sectionAt(ugx, ugy, orientation);
      if (!upstream) continue;

      if (upstream.area <= current.area * 1.04) continue;
      if (Math.sign(upstream.axial) !== sign || Math.abs(upstream.axial) < MIN_FLOW_SPEED) continue;

      const areaRatio = Math.min(MAX_AREA_RATIO, upstream.area / current.area);
      const mProxy = upstream.rho * upstream.area * Math.abs(upstream.axial);
      let target = mProxy / Math.max(1e-8, current.rho * current.area);
      target = Math.min(Math.abs(upstream.axial) * MAX_SPEED_RATIO, target, MAX_SPEED);
      if (target <= Math.abs(current.axial) * 1.02) continue;

      const alpha = Math.min(0.35, RELAX_RATE * dt);
      for (const ci of current.cells) {
        touched[ci] = 1;
        if (orientation === 'h') {
          const desired = sign * target;
          u[ci] += (desired - u[ci]) * alpha;
        } else {
          const desired = sign * target;
          v[ci] += (desired - v[ci]) * alpha;
        }
      }

      const actualRatio = Math.abs(current.axial) / Math.max(1e-6, Math.abs(upstream.axial));
      const expectedRatio = (upstream.rho * upstream.area) / Math.max(1e-8, current.rho * current.area);
      const score = areaRatio * Math.abs(upstream.axial);
      if (!continuityBest || score > continuityBest.score) {
        continuityBest = {
          score,
          areaRatio,
          actualRatio,
          expectedRatio,
          a1: upstream.area,
          a2: current.area,
          v1: Math.abs(upstream.axial),
          v2: Math.abs(current.axial)
        };
      }
    }
  }
}

export function getContinuityBest() {
  return continuityBest;
}
