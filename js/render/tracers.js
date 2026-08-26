import {ctx} from '../core/dom.js';
import {AMBIENT_O2, AMBIENT_T, clamp, inCanvas} from '../core/grid.js';
import {
  ash,
  exhaustGas,
  oxygen,
  smoke,
  temperature
} from '../core/fields.js';
import {sampleFluidField} from '../physics/closed-scalar.js';
import {particles, isSolidPoint, sampleField, targetParticleCount} from '../core/state.js';

export function visibleParticleCount() {
  let count = 0;
  for (const p of particles) {
    if (inCanvas(p.x, p.y) && !isSolidPoint(p.x, p.y)) count++;
  }
  return count;
}

export function drawTracers() {
  if (!ctx) return;
  for (const p of particles) {
    const t = sampleField(temperature, p.x, p.y, AMBIENT_T);
    const localSmoke = sampleField(smoke, p.x, p.y, 0);
    const localAsh = sampleFluidField(ash, p.x, p.y, 0);
    const localExhaust = sampleFluidField(exhaustGas, p.x, p.y, 0);
    const localO2 = sampleField(oxygen, p.x, p.y, AMBIENT_O2);
    const speed = Math.hypot(p.vx, p.vy);
    const radius = clamp(2.5 + speed / 75, 2.5, 5.2);
    let fillStyle = '';
    let trailStyle = '';

    if (localAsh >= 0.015) {
      const alpha = clamp(0.82 + localAsh * 0.08, 0.82, 0.95);
      fillStyle = `rgba(146,91,40,${alpha})`;
      trailStyle = 'rgba(146,91,40,.42)';
    } else if (localSmoke >= 0.025) {
      const alpha = clamp(0.78 + localSmoke * 0.10, 0.78, 0.94);
      fillStyle = `rgba(55,65,81,${alpha})`;
      trailStyle = 'rgba(55,65,81,.38)';
    } else if (localExhaust >= 0.035) {
      const alpha = clamp(0.76 + localExhaust * 0.08, 0.76, 0.92);
      fillStyle = `rgba(75,85,99,${alpha})`;
      trailStyle = 'rgba(75,85,99,.36)';
    } else if (t > 40) {
      fillStyle = 'rgba(234,88,12,.90)';
      trailStyle = 'rgba(234,88,12,.42)';
    } else {
      const alpha = clamp(0.78 + localO2 * 0.14, 0.78, 0.94);
      fillStyle = `rgba(37,99,235,${alpha})`;
      trailStyle = 'rgba(37,99,235,.44)';
    }

    if (Number.isFinite(p.prevX) && Number.isFinite(p.prevY) &&
        Math.hypot(p.x - p.prevX, p.y - p.prevY) > 0.3) {
      ctx.strokeStyle = trailStyle;
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      ctx.moveTo(p.prevX, p.prevY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.62)';
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }

  const visible = visibleParticleCount();
  ctx.save();
  ctx.font = '12px system-ui';
  ctx.textBaseline = 'middle';
  const label = `空氣示蹤 ${visible}/${targetParticleCount()} 顆（開放基準）`;
  const width = ctx.measureText(label).width + 16;
  ctx.fillStyle = 'rgba(15,23,42,.76)';
  ctx.fillRect(8, 8, width, 24);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, 16, 20);
  ctx.restore();
}
