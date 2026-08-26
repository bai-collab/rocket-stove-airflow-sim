import {
  AMBIENT_T,
  H,
  MAX_T,
  N,
  NX,
  NY,
  clamp,
  idx,
  inCanvas
} from '../core/grid.js';
import {
  oxygen,
  smoke,
  solid,
  temperature,
  unburnedGas,
  exhaustGas,
  u,
  v
} from '../core/fields.js';
import {lineClear, isSolidPoint} from '../core/state.js';
import {advectFieldBase} from './solver-base.js';

const TRACE_STEP = Math.max(2, H * 0.35);
const EPS = 1e-10;

function traceBackStatus(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / TRACE_STEP));

  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    if (!inCanvas(x, y)) return 'outside';
    if (isSolidPoint(x, y)) return 'solid';
  }
  return 'fluid';
}

export function sampleFluidField(field, px, py, fallback = 0) {
  if (!inCanvas(px, py) || isSolidPoint(px, py)) return fallback;

  const gxFloat = px / H - 0.5;
  const gyFloat = py / H - 0.5;
  const x0 = Math.floor(gxFloat);
  const y0 = Math.floor(gyFloat);
  const tx = gxFloat - x0;
  const ty = gyFloat - y0;
  let sum = 0;
  let weightSum = 0;

  for (let oy = 0; oy <= 1; oy++) {
    for (let ox = 0; ox <= 1; ox++) {
      const x = x0 + ox;
      const y = y0 + oy;
      if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
      const weight = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty);
      if (weight <= 0) continue;
      const i = idx(x, y);
      if (solid[i]) continue;
      if (!lineClear(px, py, (x + 0.5) * H, (y + 0.5) * H, false)) continue;
      sum += field[i] * weight;
      weightSum += weight;
    }
  }
  return weightSum > 1e-6 ? sum / weightSum : fallback;
}

function buildFluidComponents() {
  const labels = new Int32Array(N);
  labels.fill(-1);
  const components = [];
  const queue = new Int32Array(N);

  for (let start = 0; start < N; start++) {
    if (solid[start] || labels[start] >= 0) continue;

    const id = components.length;
    let head = 0;
    let tail = 0;
    let touchesBoundary = false;
    const cells = [];

    queue[tail++] = start;
    labels[start] = id;

    while (head < tail) {
      const i = queue[head++];
      cells.push(i);
      const x = i % NX;
      const y = Math.floor(i / NX);
      if (x === 0 || y === 0 || x === NX - 1 || y === NY - 1) {
        touchesBoundary = true;
      }

      if (x > 0) {
        const ni = i - 1;
        if (!solid[ni] && labels[ni] < 0) {
          labels[ni] = id;
          queue[tail++] = ni;
        }
      }
      if (x < NX - 1) {
        const ni = i + 1;
        if (!solid[ni] && labels[ni] < 0) {
          labels[ni] = id;
          queue[tail++] = ni;
        }
      }
      if (y > 0) {
        const ni = i - NX;
        if (!solid[ni] && labels[ni] < 0) {
          labels[ni] = id;
          queue[tail++] = ni;
        }
      }
      if (y < NY - 1) {
        const ni = i + NX;
        if (!solid[ni] && labels[ni] < 0) {
          labels[ni] = id;
          queue[tail++] = ni;
        }
      }
    }

    components.push({cells, touchesBoundary});
  }
  return components;
}

function conserveSealedComponent(src, dst, cells) {
  if (dst === temperature) {
    let before = 0;
    let after = 0;
    for (const i of cells) {
      before += Math.max(0, src[i] - AMBIENT_T);
      after += Math.max(0, dst[i] - AMBIENT_T);
    }
    if (before <= EPS) {
      for (const i of cells) dst[i] = AMBIENT_T;
      return;
    }
    if (after <= EPS) {
      for (const i of cells) dst[i] = src[i];
      return;
    }
    const scale = before / after;
    for (const i of cells) {
      const excess = Math.max(0, dst[i] - AMBIENT_T) * scale;
      dst[i] = clamp(AMBIENT_T + excess, AMBIENT_T, MAX_T);
    }
    return;
  }

  let before = 0;
  let after = 0;
  for (const i of cells) {
    before += Math.max(0, src[i]);
    after += Math.max(0, dst[i]);
  }

  if (before <= EPS) {
    for (const i of cells) dst[i] = 0;
    return;
  }
  if (after <= EPS) {
    for (const i of cells) dst[i] = src[i];
    return;
  }

  const scale = before / after;
  for (const i of cells) {
    let value = Math.max(0, dst[i] * scale);
    if (dst === oxygen) value = clamp(value, 0, 1);
    else if (dst === smoke) value = clamp(value, 0, 1.5);
    dst[i] = value;
  }
}

export function advectField(dst, src, velocityU, velocityV, dt, fallback) {
  const scalarPass = velocityU === u && velocityV === v;
  if (!scalarPass) {
    advectFieldBase(dst, src, velocityU, velocityV, dt, fallback);
    return;
  }

  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) {
        dst[i] = fallback;
        continue;
      }

      const px = (x + 0.5) * H;
      const py = (y + 0.5) * H;
      const bx = px - velocityU[i] * dt;
      const by = py - velocityV[i] * dt;
      const status = traceBackStatus(px, py, bx, by);

      if (status === 'solid') {
        dst[i] = src[i];
      } else if (status === 'outside') {
        dst[i] = fallback;
      } else {
        dst[i] = sampleFluidField(src, bx, by, src[i]);
      }
    }
  }

  const components = buildFluidComponents();
  for (const component of components) {
    if (!component.touchesBoundary) {
      conserveSealedComponent(src, dst, component.cells);
    }
  }
}

export function getCapturedScalars() {
  return {unburnedGas, exhaustGas};
}
