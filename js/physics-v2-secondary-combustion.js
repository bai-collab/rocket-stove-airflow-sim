/* Physics v2.5: simplified biomass combustion + secondary combustion.
 *
 * Educational goals:
 * - openings in the geometry determine natural inflow/outflow; no inlet/chimney source is required
 * - smoke does not disappear with time by itself
 * - incomplete primary combustion produces unburned gas + smoke
 * - hot, oxygen-rich, well-mixed gas can burn again (secondary combustion)
 * - black-smoke visualization comes from the smoke scalar, not tracer density
 *
 * This is a reduced-order teaching model, NOT combustion CFD and NOT an
 * emissions predictor for CO, PM2.5, soot mass, or real stove efficiency.
 */
(() => {
  const unburnedGas = new Float32Array(N);
  const unburnedPrev = new Float32Array(N);
  const exhaustGas = new Float32Array(N);
  const exhaustPrev = new Float32Array(N);

  const FLAME_CORE_RADIUS = 34;
  const PLUME_HEIGHT = 180;
  const PLUME_BASE_HALF_WIDTH = 18;
  const PLUME_SPREAD = 0.22;
  const CORE_HEAT_RATE = 150;
  const PLUME_HEAT_RATE = 265;
  const REACTION_RADIUS = 48;

  const GAS_RELEASE_RATE = 0.42;        // relative scalar / s
  const PRIMARY_BURN_RATE = 3.2;        // s^-1
  const PRIMARY_O2_USE = 0.34;
  const PRIMARY_HEAT_GAIN = 185;
  const BASE_SOOT_YIELD = 0.08;
  const O2_DEFICIT_SOOT_YIELD = 0.52;

  const SECONDARY_T_START = 170;        // C, educational threshold
  const SECONDARY_T_FULL = 430;         // C
  const SECONDARY_RATE = 2.3;           // s^-1
  const SECONDARY_O2_USE = 0.30;
  const SECONDARY_HEAT_GAIN = 210;
  const SOOT_OXIDATION_FACTOR = 0.55;

  const SMOKE_FLUX_REFERENCE = 600;
  let secondaryIndex = 0;
  let smokeOutIndex = 0;
  let lastSecondaryRaw = 0;

  const baseResetFields = resetFields;
  resetFields = function() {
    baseResetFields();
    unburnedGas.fill(0);
    unburnedPrev.fill(0);
    exhaustGas.fill(0);
    exhaustPrev.fill(0);
    secondaryIndex = 0;
    smokeOutIndex = 0;
    lastSecondaryRaw = 0;
  };

  function plumeWeight(fx, fy, px, py) {
    const height = fy - py;
    if (height <= 0 || height > PLUME_HEIGHT) return 0;
    const halfWidth = PLUME_BASE_HALF_WIDTH + height * PLUME_SPREAD;
    const lateral = Math.abs(px - fx);
    if (lateral > halfWidth) return 0;
    const center = 1 - lateral / halfWidth;
    const vertical = Math.max(0.18, 1 - height / PLUME_HEIGHT);
    return center * vertical;
  }

  function primaryOxygenFactor(o2) {
    return clamp((o2 - 0.08) / 0.72, 0, 1);
  }

  // Replace the v2.1 plume source with an incomplete-combustion source.
  // The geometry of heating/radiation is intentionally kept close to v2.1.
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

          let heat = 0;
          if (d <= FLAME_CORE_RADIUS) {
            heat += CORE_HEAT_RATE * (1 - d / FLAME_CORE_RADIUS);
          }
          const pw = plumeWeight(fx, fy, px, py);
          if (pw > 0) heat += PLUME_HEAT_RATE * pw;
          if (heat > 0) {
            temperature[i] = clamp(
              temperature[i] + heat * intensity * dt,
              AMBIENT_T,
              MAX_T
            );
          }

          if (d <= REACTION_RADIUS) {
            const w = 1 - d / REACTION_RADIUS;
            const o2Factor = primaryOxygenFactor(oxygen[i]);

            // Biomass heating releases combustible volatiles first. A fraction
            // burns in the primary flame; oxygen deficit increases smoke yield.
            const released = GAS_RELEASE_RATE * w * intensity * dt;
            unburnedGas[i] = clamp(unburnedGas[i] + released, 0, 1.5);

            const burnPotential = PRIMARY_BURN_RATE * w * intensity * o2Factor * unburnedGas[i] * dt;
            const primaryBurn = Math.min(unburnedGas[i], burnPotential);
            const maxByO2 = oxygen[i] / Math.max(1e-6, PRIMARY_O2_USE);
            const actualBurn = Math.min(primaryBurn, maxByO2);

            unburnedGas[i] = Math.max(0, unburnedGas[i] - actualBurn);
            oxygen[i] = clamp(oxygen[i] - actualBurn * PRIMARY_O2_USE, 0, 1);
            exhaustGas[i] = clamp(exhaustGas[i] + actualBurn, 0, 2);
            temperature[i] = clamp(
              temperature[i] + actualBurn * PRIMARY_HEAT_GAIN,
              AMBIENT_T,
              MAX_T
            );

            const sootYield = BASE_SOOT_YIELD + O2_DEFICIT_SOOT_YIELD * (1 - o2Factor);
            smoke[i] = clamp(smoke[i] + released * sootYield, 0, 1.5);
          }
        }
      }
    }
  };

  function smoothstep01(x) {
    const t = clamp(x, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function localMixingFactor(gx, gy, i) {
    const speed = Math.hypot(u[i], v[i]);
    const left = gx > 0 ? idx(gx - 1, gy) : i;
    const right = gx < NX - 1 ? idx(gx + 1, gy) : i;
    const up = gy > 0 ? idx(gx, gy - 1) : i;
    const down = gy < NY - 1 ? idx(gx, gy + 1) : i;

    const dvdx = (v[right] - v[left]) / (2 * H);
    const dudy = (u[down] - u[up]) / (2 * H);
    const vorticity = Math.abs(dvdx - dudy) * H;

    // Some molecular/thermal mixing is always present; moving/shearing flow
    // raises the value, so secondary-air jets can improve combustion naturally.
    return clamp(0.18 + speed / 95 + vorticity / 34, 0.18, 1);
  }

  function applySecondaryCombustion(dt) {
    let reactedTotal = 0;
    let candidateCells = 0;

    for (let gy = 0; gy < NY; gy++) {
      for (let gx = 0; gx < NX; gx++) {
        const i = idx(gx, gy);
        if (solid[i]) continue;
        if (unburnedGas[i] < 0.002 && smoke[i] < 0.002) continue;

        const tempFactor = smoothstep01(
          (temperature[i] - SECONDARY_T_START) /
          (SECONDARY_T_FULL - SECONDARY_T_START)
        );
        const o2Factor = clamp((oxygen[i] - 0.05) / 0.65, 0, 1);
        if (tempFactor <= 0 || o2Factor <= 0) continue;

        const mixing = localMixingFactor(gx, gy, i);
        const reactive = unburnedGas[i] + smoke[i] * SOOT_OXIDATION_FACTOR;
        let capacity = SECONDARY_RATE * reactive * tempFactor * o2Factor * mixing * dt;
        if (capacity <= 1e-7) continue;

        const gasBurn = Math.min(unburnedGas[i], capacity);
        capacity -= gasBurn;
        const sootBurn = Math.min(smoke[i], capacity + gasBurn * SOOT_OXIDATION_FACTOR);
        let demandO2 = gasBurn * SECONDARY_O2_USE + sootBurn * SECONDARY_O2_USE * 0.55;

        let scale = 1;
        if (demandO2 > oxygen[i] && demandO2 > 1e-8) scale = oxygen[i] / demandO2;
        const gBurn = gasBurn * scale;
        const sBurn = sootBurn * scale;
        demandO2 *= scale;

        unburnedGas[i] = Math.max(0, unburnedGas[i] - gBurn);
        smoke[i] = Math.max(0, smoke[i] - sBurn);
        oxygen[i] = clamp(oxygen[i] - demandO2, 0, 1);
        exhaustGas[i] = clamp(exhaustGas[i] + gBurn + sBurn, 0, 2);
        temperature[i] = clamp(
          temperature[i] + (gBurn + sBurn) * SECONDARY_HEAT_GAIN,
          AMBIENT_T,
          MAX_T
        );

        reactedTotal += gBurn + sBurn;
        candidateCells++;
      }
    }

    lastSecondaryRaw = candidateCells ? reactedTotal / candidateCells : 0;
    const target = clamp(lastSecondaryRaw * 2800, 0, 100);
    secondaryIndex += (target - secondaryIndex) * Math.min(1, dt * 4);
  }

  // No global smoke decay. Pollutants leave by advection through the open
  // boundary or are consumed by secondary combustion.
  coolAndMix = function(dt) {
    for (let i = 0; i < N; i++) {
      if (solid[i]) continue;
      temperature[i] += (AMBIENT_T - temperature[i]) * AIR_COOLING_RATE * dt;
      oxygen[i] = clamp(oxygen[i], 0, 1);
      smoke[i] = clamp(smoke[i], 0, 1.5);
      unburnedGas[i] = clamp(unburnedGas[i], 0, 1.5);
      exhaustGas[i] = clamp(exhaustGas[i], 0, 2);
    }
  };

  // Ambient values are imposed ONLY where the solved velocity points inward.
  // Outflowing smoke/gas is not erased merely because it touches the boundary.
  copyFluidBoundaries = function() {
    const freshen = i => {
      temperature[i] = AMBIENT_T;
      oxygen[i] = AMBIENT_O2;
      smoke[i] = 0;
      unburnedGas[i] = 0;
      exhaustGas[i] = 0;
    };

    for (let x = 0; x < NX; x++) {
      const top = idx(x, 0), bottom = idx(x, NY - 1);
      if (!solid[top] && v[top] > 0) freshen(top);
      if (!solid[bottom] && v[bottom] < 0) freshen(bottom);
    }
    for (let y = 0; y < NY; y++) {
      const left = idx(0, y), right = idx(NX - 1, y);
      if (!solid[left] && u[left] > 0) freshen(left);
      if (!solid[right] && u[right] < 0) freshen(right);
    }
  };

  function updateSmokeOutflowMetric(dt) {
    let smokeFlux = 0;
    const add = (i, outward) => {
      if (solid[i] || outward <= 0) return;
      smokeFlux += smoke[i] * outward;
    };

    for (let x = 0; x < NX; x++) {
      add(idx(x, 0), -v[idx(x, 0)]);
      add(idx(x, NY - 1), v[idx(x, NY - 1)]);
    }
    for (let y = 0; y < NY; y++) {
      add(idx(0, y), -u[idx(0, y)]);
      add(idx(NX - 1, y), u[idx(NX - 1, y)]);
    }

    const target = clamp(smokeFlux / SMOKE_FLUX_REFERENCE * 100, 0, 100);
    smokeOutIndex += (target - smokeOutIndex) * Math.min(1, dt * 3);
  }

  // Extend the v2 physics pipeline with the two new advected scalars and the
  // secondary-combustion reaction after advection/mixing.
  physicsStep = function(dt) {
    ensureGeometry();
    applyFireAndRadiation(dt);
    updateBrickHeat(dt);
    addBuoyancy(dt);

    uPrev.set(u);
    vPrev.set(v);
    advectField(u, uPrev, uPrev, vPrev, dt, 0);
    advectField(v, vPrev, uPrev, vPrev, dt, 0);
    projectVelocity();

    temperaturePrev.set(temperature);
    oxygenPrev.set(oxygen);
    smokePrev.set(smoke);
    unburnedPrev.set(unburnedGas);
    exhaustPrev.set(exhaustGas);

    advectField(temperature, temperaturePrev, u, v, dt, AMBIENT_T);
    advectField(oxygen, oxygenPrev, u, v, dt, AMBIENT_O2);
    advectField(smoke, smokePrev, u, v, dt, 0);
    advectField(unburnedGas, unburnedPrev, u, v, dt, 0);
    advectField(exhaustGas, exhaustPrev, u, v, dt, 0);

    coolAndMix(dt);
    applySecondaryCombustion(dt);
    copyFluidBoundaries();
    updateSmokeOutflowMetric(dt);
    updateTracers(dt);
  };

  function drawSmokeScalarOverlay() {
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

  const baseDrawTemperatureField = drawTemperatureField;
  drawTemperatureField = function() {
    baseDrawTemperatureField();
    drawSmokeScalarOverlay();
  };

  const metricsPanel = document.querySelector('.panel.metrics');
  let secondaryEl = null;
  let unburnedEl = null;
  let smokeOutEl = null;

  if (metricsPanel) {
    const feedback = document.getElementById('feedback');
    const makeCard = (label, id) => {
      const card = document.createElement('div');
      card.className = 'metric-card';
      card.innerHTML = `<span>${label}</span><strong id="${id}">—</strong>`;
      metricsPanel.insertBefore(card, feedback || null);
      return card.querySelector(`#${id}`);
    };
    secondaryEl = makeCard('二次燃燒強度', 'secondaryBurnRate');
    unburnedEl = makeCard('未完全燃燒氣體', 'unburnedGasRate');
    smokeOutEl = makeCard('相對黑煙排出', 'smokeOutRate');
  }

  function averageScalar(field) {
    let sum = 0, count = 0;
    for (let i = 0; i < N; i++) {
      if (solid[i]) continue;
      sum += field[i];
      count++;
    }
    return count ? sum / count : 0;
  }

  const baseUpdateMetrics = updateMetrics;
  updateMetrics = function() {
    baseUpdateMetrics();
    if (secondaryEl) secondaryEl.textContent = Math.round(secondaryIndex) + ' / 100';
    if (unburnedEl) unburnedEl.textContent = Math.round(clamp(averageScalar(unburnedGas) * 100, 0, 100)) + ' / 100';
    if (smokeOutEl) smokeOutEl.textContent = Math.round(smokeOutIndex) + ' / 100';

    if (feedbackEl && fires.length && fires.some(f => fireIntensity(f) > 0)) {
      if (secondaryIndex >= 35 && smokeOutIndex < 35) {
        feedbackEl.textContent = '高溫燃氣與新鮮空氣混合良好，已出現明顯二次燃燒；相對黑煙排出較低。';
      } else if (averageScalar(unburnedGas) > 0.12) {
        feedbackEl.textContent = '未完全燃燒氣體正在累積。可嘗試讓外界空氣由開口進入高溫煙氣區，改善二次燃燒。';
      } else {
        feedbackEl.textContent = '觀察高溫、氧氣與氣流混合是否在火焰上方同時出現；開口位置會影響二次燃燒。';
      }
    }
  };

  // Expose read-only diagnostic access for debugging/tests without making the
  // new scalar arrays part of the student-facing API.
  window.physicsV25 = {
    get secondaryIndex() { return secondaryIndex; },
    get smokeOutIndex() { return smokeOutIndex; },
    get averageUnburnedGas() { return averageScalar(unburnedGas); }
  };
})();
