/* Physics v2.5.5: rice-straw combustion + secondary combustion.
 *
 * Educational goals:
 * - every fire tile represents burning rice straw
 * - rice straw releases combustible gases; incomplete combustion creates black smoke
 * - fresh-air tracers only visualize the air stream; the oxygen scalar actually controls combustion
 * - better oxygen supply lowers primary black-smoke formation
 * - hot, oxygen-rich, well-mixed gases can burn again (secondary combustion)
 * - black smoke and combustion-product gas are separate substances in the model
 * - mineral ash is a non-combustible solid residue with its own transport and settling
 * - char residue is a separate combustible solid that can burn out
 * - fly ash is a speed-dependent suspended fraction of mineral ash
 *
 * This is a reduced-order teaching model, NOT combustion CFD and NOT an
 * emissions predictor for CO, PM2.5, soot mass, or real stove efficiency.
 */
(() => {
  const unburnedGas = new Float32Array(N);
  const unburnedPrev = new Float32Array(N);
  const exhaustGas = new Float32Array(N);
  const exhaustPrev = new Float32Array(N);
  const ash = new Float32Array(N);
  const ashPrev = new Float32Array(N);
  const ashTransfer = new Float32Array(N);
  const ashBed = new Float32Array(N);
  const charResidue = new Float32Array(N);
  const charResiduePrev = new Float32Array(N);
  const flyAsh = new Float32Array(N);
  const flyAshPrev = new Float32Array(N);
  const flyAshTransfer = new Float32Array(N);
  const secondaryResidence = new Float32Array(N);
  const secondaryResidencePrev = new Float32Array(N);

  const FLAME_CORE_RADIUS = 34;
  const PLUME_HEIGHT = 180;
  const PLUME_BASE_HALF_WIDTH = 18;
  const PLUME_SPREAD = 0.22;
  const CORE_HEAT_RATE = 150;
  const PLUME_HEAT_RATE = 265;
  const REACTION_RADIUS = 48;

  const STRAW_GAS_RELEASE_RATE = 0.42;
  const PRIMARY_BURN_RATE = 3.2;
  const PRIMARY_O2_USE = 0.34;
  const PRIMARY_HEAT_GAIN = 185;
  const CLEAN_SOOT_YIELD = 0.025;
  const DIRTY_SOOT_YIELD = 0.62;

  const SECONDARY_T_START = 170;
  const SECONDARY_T_FULL = 430;
  const SECONDARY_RATE = 2.3;
  const SECONDARY_O2_USE = 0.30;
  const SECONDARY_HEAT_GAIN = 210;
  const SOOT_OXIDATION_FACTOR = 0.55;
  const PRIMARY_CHAR_RELEASE_YIELD = 0.18;
  const PRIMARY_CHAR_BURN_RATE = 1.35;
  const PRIMARY_CHAR_O2_USE = 0.44;
  const SECONDARY_CHAR_O2_USE = 0.42;
  const SECONDARY_CHAR_REACTIVITY = 0.72;
  const ASH_YIELD = 0.12;
  const ASH_SETTLING_RATE = 0.55;
  const ASH_MAX = 1.5;
  const ASH_BED_MAX = 2.0;
  const CHAR_MAX = 1.5;
  const FLY_ASH_LIFT_THRESHOLD = 12;
  const FLY_ASH_LIFT_SPEED = 24;
  const FLY_ASH_LIFT_RATE = 1.05;
  const FLY_ASH_SETTLING_RATE = 0.14;
  const SECONDARY_RESIDENCE_FULL = 0.75;
  const SECONDARY_RESIDENCE_GAIN = 1.25;
  const SECONDARY_RESIDENCE_DECAY = 2.4;
  const SECONDARY_START_DISTANCE = REACTION_RADIUS * 1.15;
  const SECONDARY_ZONE_WIDTH = 72;
  const SECONDARY_AWAY_SPEED_SCALE = 26;
  const UNBURNED_OBSERVATION_RADIUS = 240;
  const UNBURNED_PRIMARY_EXIT_RADIUS = REACTION_RADIUS * 1.05;
  const UNBURNED_ACTIVE_FLOOR = 0.0005;
  const SECONDARY_PORT_RADIUS = 84;
  const SECONDARY_PORT_EXCHANGE = 1.6;
  const SECONDARY_PORT_JET = 24;

  const SMOKE_FLUX_REFERENCE = 600;
  let secondaryIndex = 0;
  let smokeOutIndex = 0;
  let lastSecondaryRaw = 0;
  let ashGeneratedTotal = 0;
  let ashDepositedTotal = 0;
  let ashOutTotal = 0;
  let ashClearedTotal = 0;
  let ashNumericalCorrectionTotal = 0;
  let charGeneratedTotal = 0;
  let charBurnedTotal = 0;
  let charOutTotal = 0;
  let charClearedTotal = 0;
  let charNumericalCorrectionTotal = 0;
  let flyAshOutTotal = 0;
  let flyAshLiftedTotal = 0;
  let flyAshDepositedTotal = 0;
  const ashBurnedTotal = 0;

  function resetSecondaryState() {
    unburnedGas.fill(0);
    unburnedPrev.fill(0);
    exhaustGas.fill(0);
    exhaustPrev.fill(0);
    ash.fill(0);
    ashPrev.fill(0);
    ashTransfer.fill(0);
    ashBed.fill(0);
    charResidue.fill(0);
    charResiduePrev.fill(0);
    flyAsh.fill(0);
    flyAshPrev.fill(0);
    flyAshTransfer.fill(0);
    secondaryResidence.fill(0);
    secondaryResidencePrev.fill(0);
    secondaryIndex = 0;
    smokeOutIndex = 0;
    lastSecondaryRaw = 0;
    ashGeneratedTotal = 0;
    ashDepositedTotal = 0;
    ashOutTotal = 0;
    ashClearedTotal = 0;
    ashNumericalCorrectionTotal = 0;
    charGeneratedTotal = 0;
    charBurnedTotal = 0;
    charOutTotal = 0;
    charClearedTotal = 0;
    charNumericalCorrectionTotal = 0;
    flyAshOutTotal = 0;
    flyAshLiftedTotal = 0;
    flyAshDepositedTotal = 0;
  }

  const baseResetFields = resetFields;
  resetFields = function() {
    baseResetFields();
    resetSecondaryState();
  };

  const previousResetHook = window.physicsV26ResetDiagnostics;
  window.physicsV26ResetDiagnostics = function() {
    if (typeof previousResetHook === 'function') previousResetHook();
    resetSecondaryState();
  };

  const baseRebuildSolidMask = rebuildSolidMask;
  rebuildSolidMask = function() {
    const previousSolid = solid.slice();
    baseRebuildSolidMask();
    for (let i = 0; i < N; i++) {
      if (previousSolid[i] === solid[i]) continue;
      ashClearedTotal += ash[i] + flyAsh[i] + ashBed[i];
      charClearedTotal += charResidue[i];
      u[i] = 0;
      v[i] = 0;
      temperature[i] = AMBIENT_T;
      oxygen[i] = solid[i] ? 0 : AMBIENT_O2;
      smoke[i] = 0;
      unburnedGas[i] = 0;
      exhaustGas[i] = 0;
      ash[i] = 0;
      ashBed[i] = 0;
      charResidue[i] = 0;
      flyAsh[i] = 0;
      secondaryResidence[i] = 0;
    }
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

  applyFireAndRadiation = function(dt) {
    for (const fire of fires) {
      const fx = fire.x + BUILD_CELL / 2;
      const fy = fire.y + BUILD_CELL / 2;
      const intensity = fireIntensity(fire);
      const primaryAirFactor = clamp(
        fire.primaryAirFactor === undefined ? 1 : Number(fire.primaryAirFactor),
        0.25,
        1
      );
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

            const released = STRAW_GAS_RELEASE_RATE * w * intensity * dt;
            unburnedGas[i] = clamp(unburnedGas[i] + released, 0, 1.5);
            // Mineral ash is a non-combustible residue. It is not folded into
            // smoke or exhaustGas, and secondary combustion must never consume it.
            const generatedAsh = released * ASH_YIELD;
            ash[i] = clamp(ash[i] + generatedAsh, 0, ASH_MAX);
            ashGeneratedTotal += generatedAsh;

            // Char is a different residue: it is still combustible and should
            // respond to oxygen, temperature, residence time, and draft.
            const generatedChar = released * PRIMARY_CHAR_RELEASE_YIELD;
            charResidue[i] = clamp(charResidue[i] + generatedChar, 0, CHAR_MAX);
            charGeneratedTotal += generatedChar;

            const burnPotential = PRIMARY_BURN_RATE * w * intensity * o2Factor *
              primaryAirFactor * unburnedGas[i] * dt;
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

            const charBurnPotential = PRIMARY_CHAR_BURN_RATE * w * intensity *
              o2Factor * primaryAirFactor * charResidue[i] * dt;
            const charMaxByO2 = oxygen[i] / Math.max(1e-6, PRIMARY_CHAR_O2_USE);
            const actualCharBurn = Math.min(
              charResidue[i],
              charBurnPotential,
              charMaxByO2
            );
            charResidue[i] = Math.max(0, charResidue[i] - actualCharBurn);
            oxygen[i] = clamp(oxygen[i] - actualCharBurn * PRIMARY_CHAR_O2_USE, 0, 1);
            exhaustGas[i] = clamp(exhaustGas[i] + actualCharBurn, 0, 2);
            temperature[i] = clamp(
              temperature[i] + actualCharBurn * PRIMARY_HEAT_GAIN * 0.82,
              AMBIENT_T,
              MAX_T
            );
            charBurnedTotal += actualCharBurn;

            const burnFraction = clamp(actualBurn / Math.max(released, 1e-6), 0, 1);
            const completeness = clamp(o2Factor * (0.72 + 0.28 * burnFraction), 0, 1);
            const sootYield = CLEAN_SOOT_YIELD + DIRTY_SOOT_YIELD * Math.pow(1 - completeness, 1.35);
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
    return clamp(0.18 + speed / 95 + vorticity / 34, 0.18, 1);
  }

  function secondaryZoneFactor(gx, gy, i) {
    if (!fires.length) return 0;
    const px = (gx + 0.5) * H;
    const py = (gy + 0.5) * H;
    let best = 0;

    for (const fire of fires) {
      const fx = fire.x + BUILD_CELL / 2;
      const fy = fire.y + BUILD_CELL / 2;
      const dx = px - fx;
      const dy = py - fy;
      const distance = Math.hypot(dx, dy);
      if (distance <= SECONDARY_START_DISTANCE) continue;

      // Secondary combustion is a downstream approximation: the cell must be
      // outside the primary flame/reaction neighborhood, and its local flow
      // should at least be compatible with moving away from the fire. A soft
      // factor keeps turning chambers and recirculating corners observable
      // without counting the primary flame as a second reaction zone.
      const distanceFactor = smoothstep01(
        (distance - SECONDARY_START_DISTANCE) / SECONDARY_ZONE_WIDTH
      );
      const radialSpeed = (u[i] * dx + v[i] * dy) / Math.max(distance, H);
      const downstreamFactor = 0.35 + 0.65 * smoothstep01(
        (radialSpeed - 1.5) / SECONDARY_AWAY_SPEED_SCALE
      );
      best = Math.max(best, distanceFactor * downstreamFactor);
    }

    return clamp(best, 0, 1);
  }

  function applySecondaryCombustion(dt) {
    let reactedTotal = 0;
    let reactedCells = 0;

    for (let gy = 0; gy < NY; gy++) {
      for (let gx = 0; gx < NX; gx++) {
        const i = idx(gx, gy);
        if (solid[i]) continue;
        if (
          unburnedGas[i] < 0.002 &&
          smoke[i] < 0.002 &&
          charResidue[i] < 0.002
        ) continue;

        const zoneFactor = secondaryZoneFactor(gx, gy, i);
        if (zoneFactor <= 0) continue;

        const tempFactor = smoothstep01(
          (temperature[i] - SECONDARY_T_START) /
          (SECONDARY_T_FULL - SECONDARY_T_START)
        );
        const o2Factor = clamp((oxygen[i] - 0.05) / 0.65, 0, 1);
        if (tempFactor <= 0 || o2Factor <= 0) continue;

        const mixing = localMixingFactor(gx, gy, i);
        const gasReactive = unburnedGas[i];
        const charReactive = charResidue[i] * SECONDARY_CHAR_REACTIVITY;
        const sootReactive = smoke[i] * SOOT_OXIDATION_FACTOR;
        const reactive = gasReactive + charReactive + sootReactive;
        const residenceFactor = smoothstep01(
          secondaryResidence[i] / SECONDARY_RESIDENCE_FULL
        );
        let capacity = SECONDARY_RATE * reactive * tempFactor * o2Factor * mixing *
          residenceFactor * zoneFactor * dt;
        if (capacity <= 1e-7) continue;

        // One reaction budget is shared by volatile gas, char, and soot. This
        // keeps secondary combustion from consuming more material than the
        // available high-temperature reaction capacity.
        const gasBurn = Math.min(
          unburnedGas[i],
          capacity * gasReactive / Math.max(1e-6, reactive)
        );
        const charBurn = Math.min(
          charResidue[i],
          capacity * charReactive / Math.max(1e-6, reactive)
        );
        const sootBurn = Math.min(
          smoke[i],
          Math.max(0, capacity - gasBurn - charBurn)
        );
        let demandO2 = gasBurn * SECONDARY_O2_USE +
          charBurn * SECONDARY_CHAR_O2_USE +
          sootBurn * SECONDARY_O2_USE * 0.55;

        let scale = 1;
        if (demandO2 > oxygen[i] && demandO2 > 1e-8) scale = oxygen[i] / demandO2;
        const gBurn = gasBurn * scale;
        const cBurn = charBurn * scale;
        const sBurn = sootBurn * scale;
        demandO2 *= scale;

        unburnedGas[i] = Math.max(0, unburnedGas[i] - gBurn);
        charResidue[i] = Math.max(0, charResidue[i] - cBurn);
        smoke[i] = Math.max(0, smoke[i] - sBurn);
        oxygen[i] = clamp(oxygen[i] - demandO2, 0, 1);
        exhaustGas[i] = clamp(exhaustGas[i] + gBurn + cBurn + sBurn, 0, 2);
        temperature[i] = clamp(
          temperature[i] + (gBurn + cBurn + sBurn) * SECONDARY_HEAT_GAIN,
          AMBIENT_T,
          MAX_T
        );

        charBurnedTotal += cBurn;
        reactedTotal += gBurn + cBurn + sBurn;
        if (gBurn + cBurn + sBurn > 1e-7) reactedCells++;
      }
    }

    lastSecondaryRaw = reactedCells ? reactedTotal / reactedCells : 0;
    const target = clamp(lastSecondaryRaw * 2800, 0, 100);
    secondaryIndex += (target - secondaryIndex) * Math.min(1, dt * 4);
  }

  function updateSecondaryResidence(dt) {
    for (let i = 0; i < N; i++) {
      if (solid[i]) continue;
      const gx = i % NX;
      const gy = Math.floor(i / NX);
      const zoneFactor = secondaryZoneFactor(gx, gy, i);
      const tempReady = temperature[i] >= SECONDARY_T_START;
      const oxygenReady = oxygen[i] >= 0.05;
      const reactive = unburnedGas[i] +
        charResidue[i] * SECONDARY_CHAR_REACTIVITY +
        smoke[i] * SOOT_OXIDATION_FACTOR;
      const moving = Math.hypot(u[i], v[i]) >= 2;

      if (zoneFactor > 0 && tempReady && oxygenReady && reactive > 0.002 && moving) {
        secondaryResidence[i] = clamp(
          secondaryResidence[i] + SECONDARY_RESIDENCE_GAIN * zoneFactor * dt,
          0,
          2
        );
      } else {
        secondaryResidence[i] = Math.max(
          0,
          secondaryResidence[i] - SECONDARY_RESIDENCE_DECAY * dt
        );
      }
    }
  }

  // Preset blue arrows marked with `secondary: true` represent real open
  // secondary-air slots in the teaching model.  They exchange ambient air
  // locally and add a small directed jet; they do not directly burn smoke or
  // ash.  The normal temperature / oxygen / mixing / residence tests still
  // decide whether a reaction can occur downstream.
  function applySecondaryAirPorts(dt) {
    if (!Array.isArray(inlets) || !inlets.length) return;
    for (const port of inlets) {
      if (!port || !port.secondary) continue;
      const dx = Number(port.dx) || 0;
      const dy = Number(port.dy) || 0;
      const directionLength = Math.hypot(dx, dy);
      if (directionLength < 0.5) continue;
      const nx = dx / directionLength;
      const ny = dy / directionLength;
      const cx = port.x + BUILD_CELL / 2;
      const cy = port.y + BUILD_CELL / 2;
      const gx0 = gridX(cx - SECONDARY_PORT_RADIUS);
      const gx1 = gridX(cx + SECONDARY_PORT_RADIUS);
      const gy0 = gridY(cy - SECONDARY_PORT_RADIUS);
      const gy1 = gridY(cy + SECONDARY_PORT_RADIUS);

      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = idx(gx, gy);
          if (solid[i]) continue;
          const px = (gx + 0.5) * H;
          const py = (gy + 0.5) * H;
          const rx = px - cx;
          const ry = py - cy;
          const axial = rx * nx + ry * ny;
          const lateral = Math.abs(-rx * ny + ry * nx);
          if (axial < -H || axial > SECONDARY_PORT_RADIUS) continue;
          const halfWidth = BUILD_CELL * 0.65 + Math.max(0, axial) * 0.34;
          if (lateral > halfWidth) continue;
          if (!lineClear(cx, cy, px, py, false)) continue;

          const weight = Math.max(0, 1 - Math.max(0, axial) / SECONDARY_PORT_RADIUS) *
            Math.max(0, 1 - lateral / Math.max(1, halfWidth));
          const exchange = clamp(SECONDARY_PORT_EXCHANGE * weight * dt, 0, 0.24);
          if (exchange <= 1e-7) continue;

          oxygen[i] = clamp(oxygen[i] + (AMBIENT_O2 - oxygen[i]) * exchange, 0, 1);
          temperature[i] = clamp(
            temperature[i] + (AMBIENT_T - temperature[i]) * exchange * 0.22,
            AMBIENT_T,
            MAX_T
          );
          // This is ambient-air mixing, not a reaction sink.  The small
          // dilution prevents a port from creating an artificial smoke sink.
          smoke[i] = Math.max(0, smoke[i] * (1 - exchange * 0.12));
          unburnedGas[i] = Math.max(0, unburnedGas[i] * (1 - exchange * 0.08));
          u[i] += nx * SECONDARY_PORT_JET * weight * dt;
          v[i] += ny * SECONDARY_PORT_JET * weight * dt;
        }
      }
    }
  }

  function updateFlyAshEntrainment(dt) {
    for (let i = 0; i < N; i++) {
      if (solid[i] || ash[i] <= 0) continue;
      const speed = Math.hypot(u[i], v[i]);
      const speedLift = smoothstep01(
        (speed - FLY_ASH_LIFT_THRESHOLD) / FLY_ASH_LIFT_SPEED
      );
      const thermalLift = smoothstep01(
        (temperature[i] - (AMBIENT_T + 80)) / 220
      );
      const liftFactor = clamp(0.65 * speedLift + 0.35 * thermalLift, 0, 1);
      if (liftFactor <= 0) continue;

      // Hot, fast flow can lift the fine fraction from the mineral ash pool.
      // This is a transfer, not ash destruction: the mass moves to flyAsh and
      // can later settle, be captured, or leave through an open boundary.
      const hotFactor = 0.35 + 0.65 * smoothstep01(
        (temperature[i] - (AMBIENT_T + 30)) / 260
      );
      const amount = Math.min(
        ash[i],
        ash[i] * FLY_ASH_LIFT_RATE * liftFactor * hotFactor * dt
      );
      if (amount <= 1e-8) continue;
      ash[i] -= amount;
      flyAsh[i] = clamp(flyAsh[i] + amount, 0, ASH_MAX);
      flyAshLiftedTotal += amount;
    }
  }

  function settleAsh(dt) {
    ashTransfer.fill(0);
    flyAshTransfer.fill(0);
    const fraction = clamp(ASH_SETTLING_RATE * dt, 0, 0.35);
    const flyFraction = clamp(FLY_ASH_SETTLING_RATE * dt, 0, 0.18);
    let deposited = 0;
    let flyDeposited = 0;

    for (let gy = NY - 2; gy >= 0; gy--) {
      for (let gx = 0; gx < NX; gx++) {
        const source = idx(gx, gy);
        const target = idx(gx, gy + 1);
        if (solid[source] || ash[source] <= 0) continue;
        const amount = ash[source] * fraction;
        ash[source] -= amount;
        if (solid[target]) {
          // Keep residue visible on the fluid cell immediately above a brick.
          ashBed[source] = clamp(ashBed[source] + amount, 0, ASH_BED_MAX);
          deposited += amount;
        } else {
          ashTransfer[target] += amount;
        }
      }
    }

    // Fine particles settle more slowly. They remain visible as fly ash until
    // a low-speed region, a grate, or a solid surface captures them.
    for (let gy = NY - 2; gy >= 0; gy--) {
      for (let gx = 0; gx < NX; gx++) {
        const source = idx(gx, gy);
        const target = idx(gx, gy + 1);
        if (solid[source] || flyAsh[source] <= 0) continue;
        const amount = flyAsh[source] * flyFraction;
        flyAsh[source] -= amount;
        if (solid[target]) {
          ashBed[source] = clamp(ashBed[source] + amount, 0, ASH_BED_MAX);
          deposited += amount;
          flyDeposited += amount;
        } else {
          flyAshTransfer[target] += amount;
        }
      }
    }

    // Ash that reaches the bottom row settles locally before a later flow step
    // can carry it through an open boundary.
    for (let gx = 0; gx < NX; gx++) {
      const bottom = idx(gx, NY - 1);
      if (solid[bottom]) continue;
      if (ash[bottom] > 0) {
        const amount = ash[bottom] * fraction;
        ash[bottom] -= amount;
        ashBed[bottom] = clamp(ashBed[bottom] + amount, 0, ASH_BED_MAX);
        deposited += amount;
      }
      if (flyAsh[bottom] > 0) {
        const flyAmount = flyAsh[bottom] * flyFraction;
        flyAsh[bottom] -= flyAmount;
        ashBed[bottom] = clamp(ashBed[bottom] + flyAmount, 0, ASH_BED_MAX);
        deposited += flyAmount;
        flyDeposited += flyAmount;
      }
    }

    for (let i = 0; i < N; i++) {
      if (!solid[i]) ash[i] = clamp(ash[i] + ashTransfer[i], 0, ASH_MAX);
      if (!solid[i]) flyAsh[i] = clamp(flyAsh[i] + flyAshTransfer[i], 0, ASH_MAX);
    }
    ashDepositedTotal += deposited;
    flyAshDepositedTotal += flyDeposited;
  }

  coolAndMix = function(dt) {
    for (let i = 0; i < N; i++) {
      if (solid[i]) continue;
      temperature[i] += (AMBIENT_T - temperature[i]) * AIR_COOLING_RATE * dt;
      oxygen[i] = clamp(oxygen[i], 0, 1);
      smoke[i] = clamp(smoke[i], 0, 1.5);
      unburnedGas[i] = clamp(unburnedGas[i], 0, 1.5);
      exhaustGas[i] = clamp(exhaustGas[i], 0, 2);
      ash[i] = clamp(ash[i], 0, ASH_MAX);
      charResidue[i] = clamp(charResidue[i], 0, CHAR_MAX);
      flyAsh[i] = clamp(flyAsh[i], 0, ASH_MAX);
      ashBed[i] = clamp(ashBed[i], 0, ASH_BED_MAX);
      secondaryResidence[i] = clamp(secondaryResidence[i], 0, 2);
    }
  };

  copyFluidBoundaries = function() {
    const freshen = i => {
      temperature[i] = AMBIENT_T;
      oxygen[i] = AMBIENT_O2;
      smoke[i] = 0;
      unburnedGas[i] = 0;
      exhaustGas[i] = 0;
      ash[i] = 0;
      charResidue[i] = 0;
      flyAsh[i] = 0;
      ashBed[i] = 0;
      secondaryResidence[i] = 0;
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

  function ashMassRemaining() {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      if (solid[i]) continue;
      sum += ash[i] + flyAsh[i] + ashBed[i];
    }
    return sum;
  }

  function flyAshMassRemaining() {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      if (solid[i]) continue;
      sum += flyAsh[i];
    }
    return sum;
  }

  function charMassRemaining() {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      if (solid[i]) continue;
      sum += charResidue[i];
    }
    return sum;
  }

  function recordAshBoundaryLoss(before, generatedBefore, flyBefore, flyLiftedBefore, flyDepositedBefore) {
    const generated = ashGeneratedTotal - generatedBefore;
    const expected = before + generated;
    const current = ashMassRemaining();
    const excess = current - expected;
    if (excess > 1e-7) {
      const scale = clamp(expected / Math.max(1e-7, current), 0, 1);
      for (let i = 0; i < N; i++) {
        if (!solid[i]) {
          ash[i] *= scale;
          flyAsh[i] *= scale;
          ashBed[i] *= scale;
        }
      }
      ashNumericalCorrectionTotal += excess;
    }
    const flyExpected = Math.max(
      0,
      flyBefore + (flyAshLiftedTotal - flyLiftedBefore) -
      (flyAshDepositedTotal - flyDepositedBefore)
    );
    const flyMissing = flyExpected - flyAshMassRemaining();
    const missing = expected - ashMassRemaining();
    // Include fine ash in the total ledger without counting the same boundary
    // loss twice when the coarse and fine ledgers observe it together.
    const totalOut = Math.max(missing, flyMissing);
    if (totalOut > 1e-7) ashOutTotal += totalOut;
    if (flyMissing > 1e-7) flyAshOutTotal += flyMissing;
  }

  function recordCharBoundaryLoss(before, generatedBefore, burnedBefore) {
    const generated = charGeneratedTotal - generatedBefore;
    const burned = charBurnedTotal - burnedBefore;
    const expected = Math.max(0, before + generated - burned);
    const current = charMassRemaining();
    const excess = current - expected;
    if (excess > 1e-7) {
      const scale = clamp(expected / Math.max(1e-7, current), 0, 1);
      for (let i = 0; i < N; i++) {
        if (!solid[i]) charResidue[i] *= scale;
      }
      charNumericalCorrectionTotal += excess;
    }
    const missing = expected - charMassRemaining();
    if (missing > 1e-7) charOutTotal += missing;
  }

  physicsStep = function(dt) {
    ensureGeometry();
    const ashBefore = ashMassRemaining();
    const generatedBefore = ashGeneratedTotal;
    const flyBefore = flyAshMassRemaining();
    const flyLiftedBefore = flyAshLiftedTotal;
    const flyDepositedBefore = flyAshDepositedTotal;
    const charBefore = charMassRemaining();
    const generatedCharBefore = charGeneratedTotal;
    const burnedCharBefore = charBurnedTotal;
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
    ashPrev.set(ash);
    charResiduePrev.set(charResidue);
    flyAshPrev.set(flyAsh);
    secondaryResidencePrev.set(secondaryResidence);

    advectField(temperature, temperaturePrev, u, v, dt, AMBIENT_T);
    advectField(oxygen, oxygenPrev, u, v, dt, AMBIENT_O2);
    advectField(smoke, smokePrev, u, v, dt, 0);
    advectField(unburnedGas, unburnedPrev, u, v, dt, 0);
    advectField(exhaustGas, exhaustPrev, u, v, dt, 0);
    advectField(ash, ashPrev, u, v, dt, 0);
    advectField(charResidue, charResiduePrev, u, v, dt, 0);
    advectField(flyAsh, flyAshPrev, u, v, dt, 0);
    advectField(secondaryResidence, secondaryResidencePrev, u, v, dt, 0);

    coolAndMix(dt);
    applySecondaryAirPorts(dt);
    updateSecondaryResidence(dt);
    applySecondaryCombustion(dt);
    updateFlyAshEntrainment(dt);
    settleAsh(dt);
    copyFluidBoundaries();
    recordAshBoundaryLoss(
      ashBefore,
      generatedBefore,
      flyBefore,
      flyLiftedBefore,
      flyDepositedBefore
    );
    recordCharBoundaryLoss(charBefore, generatedCharBefore, burnedCharBefore);
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

  function drawAshScalarOverlay() {
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

  function drawCharResidueOverlay() {
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

  function drawFlyAshScalarOverlay() {
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

  function drawAshBedOverlay() {
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

  const baseDrawTemperatureField = drawTemperatureField;
  drawTemperatureField = function() {
    baseDrawTemperatureField();
    drawSmokeScalarOverlay();
    drawCharResidueOverlay();
    drawAshScalarOverlay();
    drawFlyAshScalarOverlay();
    drawAshBedOverlay();
  };

  const metricsPanel = document.querySelector('.panel.metrics');
  const primaryMetrics = document.getElementById('primaryMetrics');
  const advancedMetrics = document.getElementById('advancedMetrics');
  let secondaryEl = null;
  let unburnedEl = null;
  let smokeLevelEl = null;
  let smokeOutEl = null;
  let ashEl = null;
  let mineralAshGeneratedEl = null;
  let charEl = null;
  let flyAshSuspendedEl = null;
  let flyAshEl = null;
  let ashFateEl = null;

  const defaultMetricsTarget = advancedMetrics || metricsPanel;
  if (defaultMetricsTarget) {
    const makeCard = (label, id, target = defaultMetricsTarget, title = '') => {
      const card = document.createElement('div');
      card.className = 'metric-card';
      if (title) card.title = title;
      card.innerHTML = `<span>${label}</span><strong id="${id}">—</strong>`;
      target.appendChild(card);
      return card.querySelector(`#${id}`);
    };
    const primaryTarget = primaryMetrics || defaultMetricsTarget;
    secondaryEl = makeCard(
      '二次燃燒強度',
      'secondaryBurnRate',
      primaryTarget,
      '只計算火源外側下游的高溫、含氧、混合與停留區再次反應量。'
    );
    unburnedEl = makeCard(
      '一次燃燒後未燃氣體（局部）',
      'unburnedGasRate',
      primaryTarget,
      '只觀察一次火焰區外側下游仍存在的可燃揮發氣體；它不是黑煙，也不是熱空氣。'
    );
    smokeLevelEl = makeCard('相對黑煙濃度', 'smokeLevelRate', primaryTarget);
    smokeOutEl = makeCard('相對黑煙排出', 'smokeOutRate', primaryTarget);
    ashEl = makeCard(
      '稻稈礦物灰分（剩餘）',
      'ashRate',
      primaryTarget,
      '稻稈中不可燃的礦物灰分；抽氣不會把它燒掉，只會改變沉積與飛灰排出。'
    );
    mineralAshGeneratedEl = makeCard(
      '礦物灰分生成',
      'mineralAshGeneratedRate',
      defaultMetricsTarget,
      '由稻稈燃料灰分比例產生的不可燃礦物量，不因二次燃燒消失。'
    );
    charEl = makeCard(
      '未燃碳／焦渣（剩餘）',
      'charResidueRate',
      defaultMetricsTarget,
      '一次燃燒留下的可燃固體；氧氣、溫度、混合與停留時間足夠時會下降。'
    );
    flyAshSuspendedEl = makeCard(
      '飛灰（懸浮）',
      'flyAshSuspendedRate',
      defaultMetricsTarget,
      '礦物細灰被熱氣流帶起後仍在流場中的相對量；沉降或排出後會下降。'
    );
    flyAshEl = makeCard(
      '飛灰排出',
      'flyAshOutRate',
      defaultMetricsTarget,
      '高速煙氣帶走的細灰累計量；適中抽氣可維持燃燒，抽氣過強可能增加外逸。'
    );
    ashFateEl = makeCard('灰分去向（相對量）', 'ashFate');
    if (ashFateEl) {
      ashFateEl.style.display = 'block';
      ashFateEl.style.whiteSpace = 'pre-line';
      ashFateEl.style.fontSize = '.76rem';
      ashFateEl.style.lineHeight = '1.45';
    }
  }

  const legend = document.querySelector('.legend');
  if (legend && !legend.querySelector('.ash-accounting')) {
    const ashLegend = document.createElement('span');
    ashLegend.className = 'ash-accounting';
    ashLegend.innerHTML = '<i class="dot ash"></i> 棕色點：礦物灰；深棕點：未燃碳／焦渣；淡棕點：高速氣流帶起的飛灰；深棕短線：已沉積礦物灰（仍計入剩餘）。';
    legend.appendChild(ashLegend);
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (ashFateEl) ashFateEl.textContent = '使用者按「全部清除」：灰分帳本已歸零';
    });
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

  function averageFieldNearFires(field, radius = 84) {
    if (!fires.length) return averageScalar(field);
    let sum = 0, count = 0;
    for (const fire of fires) {
      const fx = fire.x + BUILD_CELL / 2;
      const fy = fire.y + BUILD_CELL / 2;
      const gx0 = gridX(fx - radius), gx1 = gridX(fx + radius);
      const gy0 = gridY(fy - radius), gy1 = gridY(fy + radius);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = idx(gx, gy);
          if (solid[i]) continue;
          const px = (gx + 0.5) * H;
          const py = (gy + 0.5) * H;
          if (Math.hypot(px - fx, py - fy) > radius) continue;
          sum += field[i];
          count++;
        }
      }
    }
    return count ? sum / count : 0;
  }

  function averageUnburnedAfterPrimary() {
    if (!fires.length) return averageScalar(unburnedGas);

    let sum = 0;
    let weightSum = 0;
    const observationSpan = UNBURNED_OBSERVATION_RADIUS - UNBURNED_PRIMARY_EXIT_RADIUS;

    for (let gy = 0; gy < NY; gy++) {
      for (let gx = 0; gx < NX; gx++) {
        const i = idx(gx, gy);
        if (solid[i] || unburnedGas[i] <= UNBURNED_ACTIVE_FLOOR) continue;

        const px = (gx + 0.5) * H;
        const py = (gy + 0.5) * H;
        let bestWeight = 0;

        for (const fire of fires) {
          const fx = fire.x + BUILD_CELL / 2;
          const fy = fire.y + BUILD_CELL / 2;
          const dx = px - fx;
          const dy = py - fy;
          const distance = Math.hypot(dx, dy);
          if (
            distance < UNBURNED_PRIMARY_EXIT_RADIUS ||
            distance > UNBURNED_OBSERVATION_RADIUS
          ) continue;

          const distanceFactor = 1 - smoothstep01(
            (distance - UNBURNED_PRIMARY_EXIT_RADIUS) / observationSpan
          );
          const radialSpeed = (u[i] * dx + v[i] * dy) / Math.max(distance, H);
          const downstreamFactor = 0.45 + 0.55 * smoothstep01(
            (radialSpeed - 1.5) / SECONDARY_AWAY_SPEED_SCALE
          );
          const hotFactor = 0.55 + 0.45 * smoothstep01(
            (temperature[i] - (AMBIENT_T + 15)) /
            (SECONDARY_T_START - (AMBIENT_T + 15))
          );
          const plumeFactor = 0.55 + 0.45 * clamp(
            plumeWeight(fx, fy, px, py),
            0,
            1
          );

          bestWeight = Math.max(
            bestWeight,
            distanceFactor * downstreamFactor * hotFactor * plumeFactor
          );
        }

        if (bestWeight <= 0) continue;
        sum += unburnedGas[i] * bestWeight;
        weightSum += bestWeight;
      }
    }

    return weightSum > 1e-6 ? sum / weightSum : 0;
  }

  function averageSmokeNearFires() {
    return averageFieldNearFires(smoke);
  }

  function averageAshNearFires() {
    if (!fires.length) {
      let sum = 0, count = 0;
      for (let i = 0; i < N; i++) {
        if (solid[i]) continue;
        sum += ash[i] + flyAsh[i] + ashBed[i];
        count++;
      }
      return count ? sum / count : 0;
    }
    let sum = 0, count = 0;
    const radius = 84;
    for (const fire of fires) {
      const fx = fire.x + BUILD_CELL / 2;
      const fy = fire.y + BUILD_CELL / 2;
      const gx0 = gridX(fx - radius), gx1 = gridX(fx + radius);
      const gy0 = gridY(fy - radius), gy1 = gridY(fy + radius);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = idx(gx, gy);
          if (solid[i]) continue;
          const px = (gx + 0.5) * H;
          const py = (gy + 0.5) * H;
          if (Math.hypot(px - fx, py - fy) > radius) continue;
          sum += ash[i] + flyAsh[i] + ashBed[i];
          count++;
        }
      }
    }
    return count ? sum / count : 0;
  }

  function averageCharNearFires() {
    return averageFieldNearFires(charResidue);
  }

  function sampleScalarWallSafe(field, px, py, fallback = 0) {
    if (!inCanvas(px, py) || isSolidPoint(px, py)) return fallback;
    const gxFloat = px / H - 0.5;
    const gyFloat = py / H - 0.5;
    const x0 = Math.floor(gxFloat), y0 = Math.floor(gyFloat);
    const tx = gxFloat - x0, ty = gyFloat - y0;
    let sum = 0, weightSum = 0;

    for (let oy = 0; oy <= 1; oy++) {
      for (let ox = 0; ox <= 1; ox++) {
        const x = x0 + ox, y = y0 + oy;
        if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
        const i = idx(x, y);
        if (solid[i]) continue;
        const w = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty);
        if (w <= 0 || !lineClear(px, py, (x + 0.5) * H, (y + 0.5) * H, false)) continue;
        sum += field[i] * w;
        weightSum += w;
      }
    }
    return weightSum > 1e-6 ? sum / weightSum : fallback;
  }

  function formatAsh(value) {
    return value.toFixed(2);
  }

  const baseUpdateMetrics = updateMetrics;
  updateMetrics = function() {
    baseUpdateMetrics();
    const localSmoke = averageSmokeNearFires();
    const localAsh = averageAshNearFires();
    const localUnburned = averageUnburnedAfterPrimary();
    const localChar = averageCharNearFires();
    const localFlyAsh = averageFieldNearFires(flyAsh);
    if (secondaryEl) secondaryEl.textContent = Math.round(secondaryIndex) + ' / 100';
    if (unburnedEl) unburnedEl.textContent = clamp(localUnburned * 100, 0, 100).toFixed(1) + ' / 100';
    if (smokeLevelEl) smokeLevelEl.textContent = Math.round(clamp(localSmoke * 135, 0, 100)) + ' / 100';
    if (smokeOutEl) smokeOutEl.textContent = Math.round(smokeOutIndex) + ' / 100';
    if (ashEl) ashEl.textContent = Math.round(clamp(localAsh * 180, 0, 100)) + ' / 100';
    if (mineralAshGeneratedEl) mineralAshGeneratedEl.textContent = formatAsh(ashGeneratedTotal) + '（模型量）';
    if (charEl) charEl.textContent = clamp(localChar * 120, 0, 100).toFixed(1) + ' / 100';
    if (flyAshSuspendedEl) flyAshSuspendedEl.textContent = clamp(localFlyAsh * 180, 0, 100).toFixed(1) + ' / 100';
    if (flyAshEl) flyAshEl.textContent = formatAsh(flyAshOutTotal) + '（模型量）';
    if (ashFateEl) {
      ashFateEl.textContent = `礦物灰：生成 ${formatAsh(ashGeneratedTotal)}｜剩餘 ${formatAsh(ashMassRemaining())}\n` +
        `沉積累計 ${formatAsh(ashDepositedTotal)}（仍計入剩餘）｜總排出 ${formatAsh(ashOutTotal)}｜清除 ${formatAsh(ashClearedTotal)}\n` +
        `飛灰排出 ${formatAsh(flyAshOutTotal)}｜礦物灰燃燒 ${formatAsh(ashBurnedTotal)}（不可燃）\n` +
        `可燃焦渣：生成 ${formatAsh(charGeneratedTotal)}｜剩餘 ${formatAsh(charMassRemaining())}｜燃燒 ${formatAsh(charBurnedTotal)}｜排出 ${formatAsh(charOutTotal)}｜清除 ${formatAsh(charClearedTotal)}\n` +
        `數值修正：礦物灰 ${formatAsh(ashNumericalCorrectionTotal)}、焦渣 ${formatAsh(charNumericalCorrectionTotal)}`;
    }

    if (feedbackEl && fires.length && fires.some(f => fireIntensity(f) > 0)) {
      const o2 = averageFireOxygen();
      if (o2 < 0.35 && localSmoke > 0.08) {
        feedbackEl.textContent = '稻稈燃燒區氧氣不足，不完全燃燒增加，黑煙正在累積。嘗試讓新鮮空氣更容易流入火源附近。';
      } else if (secondaryIndex >= 35 && smokeOutIndex < 35) {
        feedbackEl.textContent = '新鮮空氣帶入氧氣，高溫燃氣混合後出現明顯二次燃燒；黑煙進一步減少。';
      } else if (localChar > 0.08) {
        feedbackEl.textContent = `一次燃燒留下可燃焦渣 ${formatAsh(charMassRemaining())}；高溫、氧氣與混合足夠時，二次燃燒會消耗它。`;
      } else if (localUnburned > 0.12) {
        feedbackEl.textContent = '稻稈釋放的可燃氣體仍有部分沒有燒完。可嘗試讓新鮮空氣進入高溫煙氣區。';
      } else if (flyAshOutTotal > 0.08) {
        feedbackEl.textContent = `高速熱煙氣已帶走細灰 ${formatAsh(flyAshOutTotal)}；抽氣過強可能增加飛灰外逸。`;
      } else if (localAsh > 0.08 || ashGeneratedTotal > 0.02) {
        feedbackEl.textContent = `礦物灰帳本：生成 ${formatAsh(ashGeneratedTotal)}、剩餘 ${formatAsh(ashMassRemaining())}；沉積仍算在剩餘中。飛灰排出 ${formatAsh(flyAshOutTotal)}，礦物灰不會被燃燒消除。`;
      } else {
        feedbackEl.textContent = '藍色點只示蹤新鮮空氣流向；真正控制助燃的是同一股氣流攜帶的氧氣。觀察進氣是否讓黑煙濃度下降。';
      }
    }
  };

  window.physicsV25 = {
    get secondaryIndex() { return secondaryIndex; },
    get smokeOutIndex() { return smokeOutIndex; },
    get averageUnburnedGas() { return averageScalar(unburnedGas); },
    get averageUnburnedAfterPrimary() { return averageUnburnedAfterPrimary(); },
    get averageSmoke() { return averageScalar(smoke); },
    get averageAsh() { return averageScalar(ash); },
    get averageCharResidue() { return averageCharNearFires(); },
    get mineralAshGenerated() { return ashGeneratedTotal; },
    get ashGenerated() { return ashGeneratedTotal; },
    get ashRemaining() { return ashMassRemaining(); },
    get ashDeposited() { return ashDepositedTotal; },
    get ashOut() { return ashOutTotal; },
    get ashCleared() { return ashClearedTotal; },
    get ashNumericalCorrection() { return ashNumericalCorrectionTotal; },
    get ashBurned() { return ashBurnedTotal; },
    get charGenerated() { return charGeneratedTotal; },
    get charRemaining() { return charMassRemaining(); },
    get charBurned() { return charBurnedTotal; },
    get charOut() { return charOutTotal; },
    get flyAshSuspended() { return averageScalar(flyAsh); },
    get flyAshOut() { return flyAshOutTotal; },
    get flyAshLifted() { return flyAshLiftedTotal; },
    get flyAshDeposited() { return flyAshDepositedTotal; },
    get particleCount() { return window.tracerV25?.particleCount || particles.length; },
    get visibleParticleCount() { return window.tracerV25?.visibleParticleCount || 0; },
    reset: resetSecondaryState,
    sampleExhaustAt(x, y) { return sampleScalarWallSafe(exhaustGas, x, y, 0); },
    sampleUnburnedAt(x, y) { return sampleScalarWallSafe(unburnedGas, x, y, 0); },
    sampleAshAt(x, y) { return sampleScalarWallSafe(ash, x, y, 0); },
    sampleCharAt(x, y) { return sampleScalarWallSafe(charResidue, x, y, 0); },
    sampleFlyAshAt(x, y) { return sampleScalarWallSafe(flyAsh, x, y, 0); }
  };
})();
