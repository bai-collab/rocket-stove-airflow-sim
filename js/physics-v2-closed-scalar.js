/* Physics v2.5.1: wall-safe scalar advection + sealed-region conservation.
 *
 * Why this patch exists:
 * The base semi-Lagrangian advector uses a fallback value when a backtrace
 * cannot sample a fluid cell.  For scalars that meant a sealed stove could
 * numerically gain ambient oxygen (fallback 1.0) and lose smoke (fallback 0)
 * next to a solid wall.
 *
 * Rules introduced here:
 * 1) Scalar characteristics may not cross solid cells.
 * 2) If a scalar backtrace hits a wall, keep the source value from the current
 *    fluid cell rather than sampling through / from the wall.
 * 3) In every fluid component that is completely sealed from the canvas edge,
 *    advection alone conserves the component integral.  Reactions and cooling
 *    may still change scalars before/after advection as intended.
 * 4) Open components remain free to exchange scalars with the outside world.
 *
 * This does not turn tracers into physical particles.  It only fixes scalar
 * transport for temperature, oxygen, smoke, unburned gas, and exhaust gas.
 */
(() => {
  const baseAdvectField = advectField;
  const TRACE_STEP = Math.max(2, H * 0.35);
  const EPS = 1e-10;
  let capturedUnburnedGas = null;
  let capturedExhaustGas = null;

  function traceBackStatus(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const distance = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(distance / TRACE_STEP));

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      if (!inCanvas(x, y)) return 'outside';
      if (isSolidPoint(x, y)) return 'solid';
    }
    return 'fluid';
  }

  function sampleFluidField(field, px, py, fallback = 0) {
    if (!inCanvas(px, py) || isSolidPoint(px, py)) return fallback;

    const gxFloat = px / H - 0.5;
    const gyFloat = py / H - 0.5;
    const x0 = Math.floor(gxFloat);
    const y0 = Math.floor(gyFloat);
    const tx = gxFloat - x0;
    const ty = gyFloat - y0;
    let sum = 0;
    let weightSum = 0;

    for (let oy = 0; oy <= 1; oy++) {
      for (let ox = 0; ox <= 1; ox++) {
        const x = x0 + ox;
        const y = y0 + oy;
        if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
        const weight = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty);
        if (weight <= 0) continue;
        const i = idx(x, y);
        if (solid[i]) continue;
        // Bilinear interpolation can otherwise select a fluid cell on the
        // opposite side of a two-cell brick wall. Keep only samples with a
        // clear segment from the back-traced point to that cell centre.
        if (!lineClear(px, py, (x + 0.5) * H, (y + 0.5) * H, false)) continue;
        sum += field[i] * weight;
        weightSum += weight;
      }
    }
    return weightSum > 1e-6 ? sum / weightSum : fallback;
  }

  function buildFluidComponents() {
    const labels = new Int32Array(N);
    labels.fill(-1);
    const components = [];
    const queue = new Int32Array(N);

    for (let start = 0; start < N; start++) {
      if (solid[start] || labels[start] >= 0) continue;

      const id = components.length;
      let head = 0;
      let tail = 0;
      let touchesBoundary = false;
      const cells = [];

      queue[tail++] = start;
      labels[start] = id;

      while (head < tail) {
        const i = queue[head++];
        cells.push(i);
        const x = i % NX;
        const y = Math.floor(i / NX);
        if (x === 0 || y === 0 || x === NX - 1 || y === NY - 1) {
          touchesBoundary = true;
        }

        if (x > 0) {
          const ni = i - 1;
          if (!solid[ni] && labels[ni] < 0) {
            labels[ni] = id;
            queue[tail++] = ni;
          }
        }
        if (x < NX - 1) {
          const ni = i + 1;
          if (!solid[ni] && labels[ni] < 0) {
            labels[ni] = id;
            queue[tail++] = ni;
          }
        }
        if (y > 0) {
          const ni = i - NX;
          if (!solid[ni] && labels[ni] < 0) {
            labels[ni] = id;
            queue[tail++] = ni;
          }
        }
        if (y < NY - 1) {
          const ni = i + NX;
          if (!solid[ni] && labels[ni] < 0) {
            labels[ni] = id;
            queue[tail++] = ni;
          }
        }
      }

      components.push({cells, touchesBoundary});
    }
    return components;
  }

  function conserveSealedComponent(src, dst, cells) {
    // Temperature is transported as sensible heat above ambient.  Other
    // scalars (oxygen / smoke / gases) conserve their direct integral.
    if (dst === temperature) {
      let before = 0;
      let after = 0;
      for (const i of cells) {
        before += Math.max(0, src[i] - AMBIENT_T);
        after += Math.max(0, dst[i] - AMBIENT_T);
      }
      if (before <= EPS) {
        for (const i of cells) dst[i] = AMBIENT_T;
        return;
      }
      if (after <= EPS) {
        // Numerical transport must never delete all heat in a sealed region.
        // Put the pre-advection field back rather than inventing a distribution.
        for (const i of cells) dst[i] = src[i];
        return;
      }
      const scale = before / after;
      for (const i of cells) {
        const excess = Math.max(0, dst[i] - AMBIENT_T) * scale;
        dst[i] = clamp(AMBIENT_T + excess, AMBIENT_T, MAX_T);
      }
      return;
    }

    let before = 0;
    let after = 0;
    for (const i of cells) {
      before += Math.max(0, src[i]);
      after += Math.max(0, dst[i]);
    }

    if (before <= EPS) {
      for (const i of cells) dst[i] = 0;
      return;
    }
    if (after <= EPS) {
      for (const i of cells) dst[i] = src[i];
      return;
    }

    const scale = before / after;
    for (const i of cells) {
      let value = Math.max(0, dst[i] * scale);
      if (dst === oxygen) value = clamp(value, 0, 1);
      else if (dst === smoke) value = clamp(value, 0, 1.5);
      dst[i] = value;
    }
  }

  advectField = function(dst, src, velocityU, velocityV, dt, fallback) {
    // Velocity advection remains exactly as the existing solver implemented it.
    // Scalar advection is recognizable because it uses the already-projected
    // current velocity field u/v.
    const scalarPass = velocityU === u && velocityV === v;
    if (!scalarPass) {
      baseAdvectField(dst, src, velocityU, velocityV, dt, fallback);
      return;
    }

    // v2.5 keeps unburned/exhaust arrays private inside its module. Capture
    // their object references from the known scalar pipeline so this patch can
    // visualize conserved combustion products without exposing mutable fields.
    if (fallback === 0 && dst !== smoke) {
      if (!capturedUnburnedGas) capturedUnburnedGas = dst;
      else if (dst !== capturedUnburnedGas && !capturedExhaustGas) capturedExhaustGas = dst;
    }

    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const i = idx(x, y);
        if (solid[i]) {
          dst[i] = fallback;
          continue;
        }

        const px = (x + 0.5) * H;
        const py = (y + 0.5) * H;
        const bx = px - velocityU[i] * dt;
        const by = py - velocityV[i] * dt;
        const status = traceBackStatus(px, py, bx, by);

        if (status === 'solid') {
          // No scalar can enter/leave through a brick wall.
          dst[i] = src[i];
        } else if (status === 'outside') {
          // Genuine inflow from the external atmosphere uses the scalar's
          // ambient fallback (T=ambient, O2=1, smoke/gases=0).
          dst[i] = fallback;
        } else {
          // If bilinear interpolation happens to have no fluid neighbor near a
          // wall, fall back to this cell's prior value, not ambient/zero.
          dst[i] = sampleFluidField(src, bx, by, src[i]);
        }
      }
    }

    // Semi-Lagrangian interpolation is not exactly conservative.  Correct only
    // sealed components; open regions are allowed to exchange mass with outside.
    const components = buildFluidComponents();
    for (const component of components) {
      if (!component.touchesBoundary) {
        conserveSealedComponent(src, dst, component.cells);
      }
    }
  };

  // A sealed stove should not look clean merely because soot was oxidized.
  // Dark smoke can be consumed by secondary combustion, but combustion-product
  // gas remains in the enclosure until it can physically flow out. Render that
  // conserved exhaust scalar as a lighter gray haze beneath/alongside black smoke.
  const baseDrawTemperatureFieldV251 = drawTemperatureField;
  drawTemperatureField = function() {
    baseDrawTemperatureFieldV251();
    if (!capturedExhaustGas) return;
    for (let y = 0; y < NY; y++) {
      for (let x = 0; x < NX; x++) {
        const i = idx(x, y);
        if (solid[i]) continue;
        const e = capturedExhaustGas[i];
        if (e < 0.02) continue;
        const alpha = clamp(0.018 + e * 0.085, 0.018, 0.16);
        ctx.fillStyle = `rgba(51,65,85,${alpha})`;
        ctx.fillRect(x * H, y * H, H + 0.5, H + 0.5);
      }
    }
  };

  // Small diagnostic for manual verification in DevTools.
  window.physicsV251 = {
    sealedComponents() {
      return buildFluidComponents().filter(c => !c.touchesBoundary).length;
    },
    get hasCapturedExhaustScalar() { return !!capturedExhaustGas; }
  };
})();
