import {ctx} from '../core/dom.js';
import {AMBIENT_T, BUILD_CELL, H, NX, NY, clamp, idx} from '../core/grid.js';
import {brickTemp, solid} from '../core/fields.js';
import {fires, fireIntensity, walls} from '../core/state.js';

export function drawCells(arr, fill, label) {
  if (!ctx) return;
  ctx.fillStyle = fill;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '16px system-ui';
  for (const o of arr) {
    ctx.fillRect(o.x + 1, o.y + 1, BUILD_CELL - 2, BUILD_CELL - 2);
    if (label) {
      ctx.fillStyle = '#fff';
      ctx.fillText(label, o.x + BUILD_CELL / 2, o.y + BUILD_CELL / 2);
      ctx.fillStyle = fill;
    }
  }
}

export function drawBrickWalls() {
  if (!ctx) return;
  for (const wall of walls) {
    let sum = 0, count = 0;
    const x0 = Math.floor(wall.x / H), y0 = Math.floor(wall.y / H);
    const x1 = Math.ceil((wall.x + BUILD_CELL) / H), y1 = Math.ceil((wall.y + BUILD_CELL) / H);
    for (let gy = y0; gy < y1 && gy < NY; gy++) {
      for (let gx = x0; gx < x1 && gx < NX; gx++) {
        const i = idx(gx, gy);
        if (solid[i]) {
          sum += brickTemp[i];
          count++;
        }
      }
    }
    const t = count ? sum / count : AMBIENT_T;
    const hot = clamp((t - AMBIENT_T) / 300, 0, 1);
    const r = Math.round(55 + 115 * hot);
    const g = Math.round(65 + 35 * hot);
    const b = Math.round(81 - 45 * hot);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(wall.x + 1, wall.y + 1, BUILD_CELL - 2, BUILD_CELL - 2);
  }
}

export function drawFires() {
  if (!ctx) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '16px system-ui';
  for (const fire of fires) {
    const intensity = fireIntensity(fire);
    ctx.fillStyle = intensity > 0 ? `rgba(234,88,12,${0.35 + 0.65 * intensity})` : '#6b7280';
    ctx.fillRect(fire.x + 1, fire.y + 1, BUILD_CELL - 2, BUILD_CELL - 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(intensity > 0 ? '🔥' : '✕', fire.x + BUILD_CELL / 2, fire.y + BUILD_CELL / 2);
  }
}
