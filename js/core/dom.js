// The only module allowed to touch the document, canvas, or slider elements.
// The headless fallback deliberately has the same dimensions as index.html.

const documentRef = globalThis.document;

const headlessCanvas = {
  width: 900,
  height: 560
};

export const canvas = documentRef?.getElementById?.('simCanvas') || headlessCanvas;
export const ctx = canvas?.getContext?.('2d') || null;

export const tools = documentRef?.querySelectorAll
  ? [...documentRef.querySelectorAll('.tool')]
  : [];
export const igniteBtn = documentRef?.getElementById?.('igniteBtn') || null;
export const pauseBtn = documentRef?.getElementById?.('pauseBtn') || null;
export const clearBtn = documentRef?.getElementById?.('clearBtn') || null;
export const particleSlider = documentRef?.getElementById?.('particleCount') || null;
export const fanPressureSlider = documentRef?.getElementById?.('fanPressure') || null;
export const flowScoreEl = documentRef?.getElementById?.('flowScore') || null;
export const avgSpeedEl = documentRef?.getElementById?.('avgSpeed') || null;
export const stagnantRateEl = documentRef?.getElementById?.('stagnantRate') || null;
export const oxygenRateEl = documentRef?.getElementById?.('oxygenRate') || null;
export const feedbackEl = documentRef?.getElementById?.('feedback') || null;

export function readParticleCount() {
  return particleSlider ? Number(particleSlider.value) || 240 : 240;
}

export function readFanPressure() {
  return fanPressureSlider ? Number(fanPressureSlider.value) || 0 : 2.0;
}
