export const PLUME_HEIGHT = 180;
export const PLUME_BASE_HALF_WIDTH = 18;
export const PLUME_SPREAD = 0.22;

export function plumeWeight(fx, fy, px, py) {
  // Canvas y grows downward, so positive height means the cell is above fire.
  const height = fy - py;
  if (height <= 0 || height > PLUME_HEIGHT) return 0;
  const halfWidth = PLUME_BASE_HALF_WIDTH + height * PLUME_SPREAD;
  const lateral = Math.abs(px - fx);
  if (lateral > halfWidth) return 0;
  const center = 1 - lateral / halfWidth;
  const vertical = Math.max(0.18, 1 - height / PLUME_HEIGHT);
  return center * vertical;
}
