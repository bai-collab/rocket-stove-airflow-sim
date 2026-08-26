import {
  AMBIENT_O2,
  AMBIENT_T,
  BRICK_AIR_CONVECTION,
  BRICK_CONDUCTION_RATE,
  BUOYANCY_DT_CAP,
  BETA,
  G,
  H,
  MAX_SPEED,
  MAX_T,
  N,
  NX,
  NY,
  clamp,
  idx
} from '../core/grid.js';
import {
  brickTemp,
  brickTempNext,
  oxygen,
  smoke,
  temperature,
  u,
  v
} from '../core/fields.js';
import {sampleField, enforceSolidNoFlow} from '../core/state.js';

export function advectFieldBase(dst, src, velocityU, velocityV, dt, fallback) {
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solidAt(i)) {
        dst[i] = fallback;
        continue;
      }
      const px = (x + 0.5) * H;
      const py = (y + 0.5) * H;
      const bx = px - velocityU[i] * dt;
      const by = py - velocityV[i] * dt;
      dst[i] = sampleField(src, bx, by, src[i]);
    }
  }
}

function solidAt(i) {
  // Kept as a local read helper so the base loop remains the same operation
  // order as app-v2 without importing any DOM-facing module.
  return solidField[i] === 1;
}

import {solid as solidField} from '../core/fields.js';

export function updateBrickHeat(dt) {
  brickTempNext.set(brickTemp);
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (!solidField[i]) continue;
      let sum = 0, count = 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
        const ni = idx(nx, ny);
        if (!solidField[ni]) continue;
        sum += brickTemp[ni];
        count++;
      }
      if (count) {
        const avg = sum / count;
        brickTempNext[i] += (avg - brickTemp[i]) * BRICK_CONDUCTION_RATE * dt;
      }
    }
  }
  brickTemp.set(brickTempNext);

  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (!solidField[i]) continue;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
        const ni = idx(nx, ny);
        if (solidField[ni]) continue;
        const delta = brickTemp[i] - temperature[ni];
        if (Math.abs(delta) < 0.01) continue;
        const transfer = delta * BRICK_AIR_CONVECTION * dt;
        temperature[ni] = clamp(temperature[ni] + transfer, AMBIENT_T, MAX_T);
        brickTemp[i] = clamp(brickTemp[i] - transfer * 0.10, AMBIENT_T, 550);
      }
    }
  }
}

export function addBuoyancyBase(dt) {
  for (let i = 0; i < N; i++) {
    if (solidField[i]) continue;
    const dT = clamp(temperature[i] - AMBIENT_T, 0, BUOYANCY_DT_CAP);
    const ay = -G * BETA * dT * 40;
    v[i] += ay * dt;
  }
}

export function coolAndMixBase(dt) {
  for (let i = 0; i < N; i++) {
    if (solidField[i]) continue;
    temperature[i] += (AMBIENT_T - temperature[i]) * 0.035 * dt;
    smoke[i] = Math.max(0, smoke[i] - 0.025 * dt);
    oxygen[i] = clamp(oxygen[i], 0, 1);
  }
}

export function copyFluidBoundariesBase() {
  for (let x = 0; x < NX; x++) {
    for (const y of [0, NY - 1]) {
      const i = idx(x, y);
      if (solidField[i]) continue;
      if ((y === 0 && v[i] > 0) || (y === NY - 1 && v[i] < 0) || Math.abs(v[i]) < 3) {
        temperature[i] = AMBIENT_T;
        oxygen[i] = AMBIENT_O2;
        smoke[i] = 0;
      }
    }
  }
  for (let y = 0; y < NY; y++) {
    for (const x of [0, NX - 1]) {
      const i = idx(x, y);
      if (solidField[i]) continue;
      if ((x === 0 && u[i] > 0) || (x === NX - 1 && u[i] < 0) || Math.abs(u[i]) < 3) {
        temperature[i] = AMBIENT_T;
        oxygen[i] = AMBIENT_O2;
        smoke[i] = 0;
      }
    }
  }
}

export {enforceSolidNoFlow};
