import {ctx} from '../core/dom.js';
import {AMBIENT_T, H, NX, NY, clamp, idx} from '../core/grid.js';
import {
  ash,
  ashBed,
  charResidue,
  exhaustGas,
  flyAsh,
  smoke,
  solid,
  temperature
} from '../core/fields.js';

const STOPS = [
  {t:20,  c:[0,0,0],       a:0.00},
  {t:35,  c:[254,240,138], a:0.10},
  {t:50,  c:[253,224,71],  a:0.18},
  {t:70,  c:[251,191,36],  a:0.25},
  {t:100, c:[249,115,22],  a:0.31},
  {t:150, c:[239,68,68],   a:0.36},
  {t:220, c:[220,38,38],   a:0.40},
  {t:350, c:[153,27,27],   a:0.44},
  {t:550, c:[88,28,135],   a:0.47}
];

function mix(a, b, f) {
  return a + (b - a) * f;
}

export function colorAtTemp(temp) {
  if (temp <= STOPS[0].t) return {r:0, g:0, b:0, a:0};
  let hi = STOPS.length - 1;
  for (let i = 1; i < STOPS.length; i++) {
    if (temp <= STOPS[i].t) {
      hi = i;
      break;
    }
  }
  const lo = Math.max(0, hi - 1);
  const s0 = STOPS[lo], s1 = STOPS[hi];
  const f = clamp((temp - s0.t) / Math.max(1e-6, s1.t - s0.t), 0, 1);
  return {
    r: Math.round(mix(s0.c[0], s1.c[0], f)),
    g: Math.round(mix(s0.c[1], s1.c[1], f)),
    b: Math.round(mix(s0.c[2], s1.c[2], f)),
    a: mix(s0.a, s1.a, f)
  };
}

function drawContinuousTemperatureField() {
  if (!ctx) return;
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) continue;
      const c = colorAtTemp(temperature[i]);
      if (c.a <= 0.005) continue;
      ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${c.a.toFixed(3)})`;
      ctx.fillRect(x * H, y * H, H + 1, H + 1);
    }
  }
}

export function drawSmokeScalarOverlay() {
  if (!ctx) return;
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) continue;
      const s = smoke[i];
      if (s < 0.025) continue;
      const alpha = clamp(0.025 + s * 0.24, 0.025, 0.30);
      ctx.fillStyle = `rgba(31,41,55,${alpha})`;
      ctx.fillRect(x * H, y * H, H + 0.5, H + 0.5);
    }
  }
}

export function drawCharResidueOverlay() {
  if (!ctx) return;
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) continue;
      const c = charResidue[i];
      if (c < 0.02) continue;
      const alpha = clamp(0.36 + c * 0.20, 0.36, 0.76);
      const radius = clamp(1.4 + c * 0.95, 1.4, 3.2);
      ctx.fillStyle = `rgba(55,42,32,${alpha})`;
      ctx.beginPath();
      ctx.arc((x + 0.5) * H, (y + 0.5) * H, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawAshScalarOverlay() {
  if (!ctx) return;
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) continue;
      const a = ash[i];
      if (a < 0.015) continue;
      const alpha = clamp(0.62 + a * 0.18, 0.62, 0.90);
      const radius = clamp(1.8 + a * 1.2, 1.8, 3.8);
      ctx.fillStyle = `rgba(146,91,40,${alpha})`;
      ctx.beginPath();
      ctx.arc((x + 0.5) * H, (y + 0.5) * H, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawFlyAshScalarOverlay() {
  if (!ctx) return;
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) continue;
      const a = flyAsh[i];
      if (a < 0.012) continue;
      const alpha = clamp(0.28 + a * 0.16, 0.28, 0.68);
      const radius = clamp(1.2 + a * 0.75, 1.2, 2.7);
      ctx.fillStyle = `rgba(180,140,86,${alpha})`;
      ctx.beginPath();
      ctx.arc((x + 0.5) * H, (y + 0.5) * H, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawAshBedOverlay() {
  if (!ctx) return;
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i] || ashBed[i] < 0.015) continue;
      const alpha = clamp(0.56 + ashBed[i] * 0.16, 0.56, 0.88);
      const width = clamp(4 + ashBed[i] * 8, 4, H - 2);
      ctx.fillStyle = `rgba(92,64,38,${alpha})`;
      ctx.fillRect(x * H + (H - width) / 2, y * H + H * 0.68, width, H * 0.22);
    }
  }
}

export function drawExhaustGasHaze() {
  if (!ctx) return;
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const i = idx(x, y);
      if (solid[i]) continue;
      const e = exhaustGas[i];
      if (e < 0.02) continue;
      const alpha = clamp(0.018 + e * 0.085, 0.018, 0.16);
      ctx.fillStyle = `rgba(51,65,85,${alpha})`;
      ctx.fillRect(x * H, y * H, H + 0.5, H + 0.5);
    }
  }
}

export function drawTemperatureField() {
  drawContinuousTemperatureField();
  drawSmokeScalarOverlay();
  drawCharResidueOverlay();
  drawAshScalarOverlay();
  drawFlyAshScalarOverlay();
  drawAshBedOverlay();
  drawExhaustGasHaze();
}
