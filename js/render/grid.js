import {canvas, ctx} from '../core/dom.js';
import {BUILD_CELL} from '../core/grid.js';

export function drawGrid() {
  if (!ctx) return;
  ctx.strokeStyle = 'rgba(148,163,184,.13)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += BUILD_CELL) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += BUILD_CELL) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}
