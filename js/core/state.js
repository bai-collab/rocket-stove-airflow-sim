import {readFanPressure, readParticleCount} from './dom.js';
import {
  AMBIENT_O2,
  AMBIENT_T,
  BUILD_CELL,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  H,
  MAX_T,
  N,
  NX,
  NY,
  clamp,
  gridX,
  gridY,
  idx,
  inCanvas,
  isSolidPoint,
  snap
} from './grid.js';
import {
  brickTemp,
  oxygen,
  smoke,
  solid,
  temperature,
  u,
  v
} from './fields.js';

export const walls = [];
export const inlets = [];
export const fires = [];
export const chimneys = [];
export const fans = [];
export let particles = [];

export let ignited = false;
export let running = false;
export let geometryDirty = true;

let geometryPostProcessor = null;

export function setParticles(nextParticles) {
  particles = nextParticles;
}

export function setIgnited(value) {
  ignited = Boolean(value);
}

export function setRunning(value) {
  running = Boolean(value);
}

export function setGeometryDirty(value) {
  geometryDirty = Boolean(value);
}

export function setGeometryPostProcessor(processor) {
  geometryPostProcessor = processor;
}

export function resetSceneCollections() {
  walls.length = 0;
  inlets.length = 0;
  fires.length = 0;
  chimneys.length = 0;
  fans.length = 0;
  particles = [];
  ignited = false;
  running = false;
  geometryDirty = true;
}

export function hasRect(arr, x, y) {
  return arr.some(item => item.x === x && item.y === y);
}

// This is the app-v2 solid-mask operation.  The engine supplies the final
// wrapper work through one post-processor so the base operation stays in the
// same order and all array identities remain stable.
export function rebuildSolidMask() {
  const previousSolid = solid.slice();
  solid.fill(0);
  for (const wall of walls) {
    const x0 = Math.floor(wall.x / H);
    const y0 = Math.floor(wall.y / H);
    const x1 = Math.ceil((wall.x + BUILD_CELL) / H);
    const y1 = Math.ceil((wall.y + BUILD_CELL) / H);
    for (let gy = y0; gy < y1 && gy < NY; gy++) {
      for (let gx = x0; gx < x1 && gx < NX; gx++) {
        if (gx < 0 || gy < 0) continue;
        const i = idx(gx, gy);
        solid[i] = 1;
        u[i] = 0;
        v[i] = 0;
        temperature[i] = AMBIENT_T;
        oxygen[i] = 0;
        smoke[i] = 0;
        if (brickTemp[i] < AMBIENT_T) brickTemp[i] = AMBIENT_T;
      }
    }
  }
  geometryDirty = false;
  if (geometryPostProcessor) geometryPostProcessor(previousSolid);
}

export function ensureGeometry() {
  if (geometryDirty) rebuildSolidMask();
}

export function sampleField(field, px, py, fallback = 0) {
  const gx = px / H - 0.5;
  const gy = py / H - 0.5;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const tx = gx - x0, ty = gy - y0;
  let sum = 0, wsum = 0;

  for (let oy = 0; oy <= 1; oy++) {
    for (let ox = 0; ox <= 1; ox++) {
      const x = x0 + ox, y = y0 + oy;
      if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
      const i = idx(x, y);
      if (solid[i]) continue;
      const w = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty);
      sum += field[i] * w;
      wsum += w;
    }
  }
  return wsum > 1e-6 ? sum / wsum : fallback;
}

export function enforceSolidNoFlow() {
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) {
        u[i] = 0; v[i] = 0;
        continue;
      }
      if (x > 0 && solid[idx(x - 1, y)] && u[i] < 0) u[i] = 0;
      if (x < NX - 1 && solid[idx(x + 1, y)] && u[i] > 0) u[i] = 0;
      if (y > 0 && solid[idx(x, y - 1)] && v[i] < 0) v[i] = 0;
      if (y < NY - 1 && solid[idx(x, y + 1)] && v[i] > 0) v[i] = 0;
    }
  }
}

export function lineClear(x0, y0, x1, y1, allowTargetSolid = false) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(2, Math.ceil(Math.hypot(dx, dy) / (H * 0.45)));
  const last = allowTargetSolid ? steps - 1 : steps;
  for (let s = 1; s < last; s++) {
    const t = s / steps;
    if (isSolidPoint(x0 + dx * t, y0 + dy * t)) return false;
  }
  return true;
}

export function oxygenAroundFire(fire) {
  const fx = fire.x + BUILD_CELL / 2;
  const fy = fire.y + BUILD_CELL / 2;
  let sum = 0, count = 0;
  const r = 38;
  const gx0 = gridX(fx - r), gx1 = gridX(fx + r);
  const gy0 = gridY(fy - r), gy1 = gridY(fy + r);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const i = idx(gx, gy);
      if (solid[i]) continue;
      const px = (gx + 0.5) * H, py = (gy + 0.5) * H;
      if (Math.hypot(px - fx, py - fy) <= r) {
        sum += oxygen[i];
        count++;
      }
    }
  }
  return count ? sum / count : 0;
}

export function fireIntensity(fire) {
  if (!ignited) return 0;
  const o2 = oxygenAroundFire(fire);
  return clamp((o2 - 0.55) / 0.35, 0, 1);
}

export function targetParticleCount() {
  return Math.max(80, readParticleCount());
}

export function fanPressurePa() {
  return readFanPressure();
}

export {
  AMBIENT_O2,
  AMBIENT_T,
  BUILD_CELL,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  H,
  MAX_T,
  N,
  NX,
  NY,
  clamp,
  gridX,
  gridY,
  idx,
  inCanvas,
  isSolidPoint,
  snap
};
