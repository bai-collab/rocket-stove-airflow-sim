import {
  BUILD_CELL,
  H,
  N,
  NX,
  NY,
  clamp,
  gridX,
  gridY,
  idx
} from '../core/grid.js';
import {solid, u, v} from '../core/fields.js';
import {fans, fanPressurePa, lineClear, walls} from '../core/state.js';

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

export const DIRS = [
  {x:1,y:0,label:'→'},
  {x:0,y:1,label:'↓'},
  {x:-1,y:0,label:'←'},
  {x:0,y:-1,label:'↑'}
];

function scanWallDistance(gx, gy, dx, dy) {
  for (let d = 1; d <= WALL_SCAN_CELLS; d++) {
    const x = gx + dx * d, y = gy + dy * d;
    if (x < 0 || y < 0 || x >= NX || y >= NY) return null;
    if (solid[idx(x, y)]) return d;
  }
  return null;
}

function localHydraulicDiameter(gx, gy, horizontalFlow) {
  let aCells = null;
  if (horizontalFlow) {
    const up = scanWallDistance(gx, gy, 0, -1), down = scanWallDistance(gx, gy, 0, 1);
    if (up !== null && down !== null) aCells = Math.max(1, up + down - 1);
  } else {
    const left = scanWallDistance(gx, gy, -1, 0), right = scanWallDistance(gx, gy, 1, 0);
    if (left !== null && right !== null) aCells = Math.max(1, left + right - 1);
  }
  if (aCells === null) return null;
  const a = aCells * H / PPM;
  const b = OUT_OF_PLANE_DEPTH;
  return 2 * a * b / Math.max(1e-6, a + b);
}

function applyDuctFriction(dt) {
  for (let gy = 0; gy < NY; gy++) {
    for (let gx = 0; gx < NX; gx++) {
      const i = idx(gx, gy);
      if (solid[i]) continue;
      const sx = u[i], sy = v[i], speedPx = Math.hypot(sx, sy);
      if (speedPx < 0.8) continue;
      const horizontal = Math.abs(sx) >= Math.abs(sy);
      const dh = localHydraulicDiameter(gx, gy, horizontal);
      if (!dh) continue;
      const vx = sx / PPM, vy = sy / PPM, vm = Math.hypot(vx, vy);
      if (vm < 1e-4) continue;
      const axM = -DARCY_F / (2 * dh) * vm * vx;
      const ayM = -DARCY_F / (2 * dh) * vm * vy;
      u[i] += clamp(axM * PPM, -DRAG_ACCEL_CAP, DRAG_ACCEL_CAP) * dt;
      v[i] += clamp(ayM * PPM, -DRAG_ACCEL_CAP, DRAG_ACCEL_CAP) * dt;
    }
  }
}

export function fanTargetSpeedPx() {
  const dp = Math.max(0, fanPressurePa());
  if (dp <= 0) return 0;
  const ms = FAN_CD * Math.sqrt(2 * dp / RHO);
  const referenceMs = FAN_CD * Math.sqrt(2 * FAN_REFERENCE_PRESSURE / RHO);
  return clamp(ms / Math.max(1e-6, referenceMs) * FAN_VELOCITY_CAP, 0, FAN_VELOCITY_CAP);
}

function applyFans(dt) {
  if (!fans.length) return;
  const target = fanTargetSpeedPx();
  if (target <= 0) return;

  for (const fan of fans) {
    const dvec = DIRS[fan.dir] || DIRS[0];
    const cx = fan.x + BUILD_CELL / 2, cy = fan.y + BUILD_CELL / 2;
    const reach = Math.max(FAN_SUCTION_LENGTH, FAN_JET_LENGTH) + BUILD_CELL;
    const gx0 = gridX(cx - reach), gx1 = gridX(cx + reach);
    const gy0 = gridY(cy - reach), gy1 = gridY(cy + reach);

    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const i = idx(gx, gy);
      if (solid[i]) continue;
      const px = (gx + .5) * H, py = (gy + .5) * H;
      const dx = px - cx, dy = py - cy;
      const axial = dx * dvec.x + dy * dvec.y;
      const lateral = Math.abs(-dx * dvec.y + dy * dvec.x);

      const upstream = axial < 0;
      const length = upstream ? FAN_SUCTION_LENGTH : FAN_JET_LENGTH;
      if (Math.abs(axial) > length) continue;

      const spread = upstream ? FAN_SUCTION_SPREAD : FAN_JET_SPREAD;
      const halfWidth = FAN_BASE_HALF_WIDTH + Math.abs(axial) * spread;
      if (lateral > halfWidth) continue;
      if (!lineClear(cx, cy, px, py, false)) continue;

      const axialWeight = Math.max(0.08, 1 - Math.abs(axial) / length);
      const lateralWeight = Math.max(0, 1 - lateral / Math.max(1, halfWidth));
      const weight = axialWeight * (0.35 + 0.65 * lateralWeight);
      const speedFactor = upstream ? FAN_UPSTREAM_SPEED_FACTOR : 1.0;
      const desiredU = dvec.x * target * speedFactor;
      const desiredV = dvec.y * target * speedFactor;
      const relax = Math.min(1, FAN_RELAX * weight * dt);

      u[i] += (desiredU - u[i]) * relax;
      v[i] += (desiredV - v[i]) * relax;
    }
  }
}

export function applyFanLayer(dt) {
  applyDuctFriction(dt);
  applyFans(dt);
}

export {walls};
