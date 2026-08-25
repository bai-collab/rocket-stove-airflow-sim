/* Physics v2.1 fire-plume correction.
 * The base v2 solver already owns velocity/pressure/temperature fields.
 * This patch changes ONLY the fire source distribution:
 *   - direct air heating = flame core + upward convective plume
 *   - no broad radial heating of outside air
 *   - brick heating remains line-of-sight radiation
 *   - oxygen/smoke reaction stays near the flame core
 */
(() => {
  const FLAME_CORE_RADIUS = 34;
  const PLUME_HEIGHT = 180;
  const PLUME_BASE_HALF_WIDTH = 18;
  const PLUME_SPREAD = 0.22;
  const CORE_HEAT_RATE = 165;
  const PLUME_HEAT_RATE = 285;
  const REACTION_RADIUS = 48;

  function plumeWeight(fx, fy, px, py) {
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

  applyFireAndRadiation = function(dt) {
    for (const fire of fires) {
      const fx = fire.x + BUILD_CELL / 2;
      const fy = fire.y + BUILD_CELL / 2;
      const intensity = fireIntensity(fire);
      if (intensity <= 0) continue;

      const radius = Math.max(FIRE_BRICK_RADIUS, PLUME_HEIGHT);
      const gx0 = gridX(fx - radius), gx1 = gridX(fx + radius);
      const gy0 = gridY(fy - PLUME_HEIGHT), gy1 = gridY(fy + FIRE_BRICK_RADIUS);

      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = idx(gx, gy);
          const px = (gx + 0.5) * H;
          const py = (gy + 0.5) * H;
          const dx = px - fx, dy = py - fy;
          const d = Math.hypot(dx, dy);

          if (solid[i]) {
            // Thermal radiation to visible brick.  Brick then conducts heat to
            // its far side; air behind the brick is NOT heated directly.
            if (d <= FIRE_BRICK_RADIUS && lineClear(fx, fy, px, py, true)) {
              const view = 1 / (1 + Math.pow(d / 52, 2));
              brickTemp[i] = clamp(
                brickTemp[i] + FIRE_BRICK_HEAT_RATE * view * intensity * dt,
                AMBIENT_T,
                550
              );
            }
            continue;
          }

          if (!lineClear(fx, fy, px, py, false)) continue;

          // Small flame core: direct heating can occur close to the flame in
          // every direction, but it falls off quickly.
          let heat = 0;
          if (d <= FLAME_CORE_RADIUS) {
            heat += CORE_HEAT_RATE * (1 - d / FLAME_CORE_RADIUS);
          }

          // Main convective heat transfer follows the rising fire plume.
          const pw = plumeWeight(fx, fy, px, py);
          if (pw > 0) heat += PLUME_HEAT_RATE * pw;

          if (heat > 0) {
            temperature[i] = clamp(
              temperature[i] + heat * intensity * dt,
              AMBIENT_T,
              MAX_T
            );
          }

          // Combustion chemistry stays local to the flame instead of turning
          // every line-of-sight air cell into combustion products.
          if (d <= REACTION_RADIUS) {
            const w = 1 - d / REACTION_RADIUS;
            oxygen[i] = clamp(
              oxygen[i] - O2_CONSUMPTION_RATE * w * intensity * dt,
              0,
              1
            );
            smoke[i] = clamp(
              smoke[i] + SMOKE_PRODUCTION_RATE * w * intensity * dt,
              0,
              1
            );
          }
        }
      }
    }
  };
})();
