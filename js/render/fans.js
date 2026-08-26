import {ctx} from '../core/dom.js';
import {BUILD_CELL} from '../core/grid.js';
import {DIRS} from '../physics/fan-duct.js';
import {fans} from '../core/state.js';

function arrowCell(fan, dirIndex = fan.dir) {
  const d = DIRS[dirIndex] || DIRS[0];
  return {x: fan.x + d.x * BUILD_CELL, y: fan.y + d.y * BUILD_CELL};
}

export function drawFanBody(fan) {
  if (!ctx) return;
  const x = fan.x, y = fan.y, cx = x + BUILD_CELL / 2, cy = y + BUILD_CELL / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(8,145,178,.94)';
  ctx.fillRect(x + 1, y + 1, BUILD_CELL - 2, BUILD_CELL - 2);
  ctx.strokeStyle = 'rgba(255,255,255,.92)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(cx, cy, BUILD_CELL * .30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(k * Math.PI / 2 + Math.PI / 8);
    ctx.beginPath();
    ctx.moveTo(1, -1.5);
    ctx.quadraticCurveTo(8, -5.5, 8.5, 0);
    ctx.quadraticCurveTo(5, 4, 1.5, 2.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(8,145,178,1)';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawArrowCell(fan) {
  if (!ctx) return;
  const d = DIRS[fan.dir] || DIRS[0];
  const a = arrowCell(fan);
  const cx = a.x + BUILD_CELL / 2, cy = a.y + BUILD_CELL / 2;
  const pulse = (Math.sin(performance.now() / 170) + 1) / 2;
  const shift = (pulse - .5) * 2.4;
  ctx.save();
  ctx.fillStyle = 'rgba(14,165,233,.76)';
  ctx.fillRect(a.x + 1, a.y + 1, BUILD_CELL - 2, BUILD_CELL - 2);
  ctx.translate(cx + d.x * shift, cy + d.y * shift);
  ctx.rotate(Math.atan2(d.y, d.x));
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(4, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(3, -6.2);
  ctx.lineTo(9, 0);
  ctx.lineTo(3, 6.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawFans() {
  for (const fan of fans) {
    drawFanBody(fan);
    drawArrowCell(fan);
  }
}

export {arrowCell};
