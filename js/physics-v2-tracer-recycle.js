/* Physics v2.6 tracer recycling + open-boundary air-source visualization.
 *
 * Tracers visualize air motion; they are not oxygen molecules and do not
 * participate in the chemistry solver.
 *
 * Rules:
 * 1) Blue = fresh-air tracer (the same flow carries the oxygen scalar).
 * 2) Orange = fresh air that has been heated.
 * 3) Slate = local combustion-product gas (exhaustGas).
 * 4) Brown = local non-combustible rice-straw ash; dark gray = black smoke.
 * 5) Tracers are never teleported while inside the canvas and reset to fresh
 *    only after they truly exit.
 * 6) A fluid component touching the canvas boundary is open to an infinite
 *    ambient reservoir. Its particle deficit is replenished from that edge
 *    with a fractional source formula; sealed components receive no source.
 * 7) Boundary injection uses the actual inward face flux and target tracer
 *    density. A small boundary-band resampling keeps a finite visual sample
 *    observable when numerical flow traps every sample in the firebox; it is
 *    reported separately and never changes oxygen, smoke, ash, or pressure.
 */
(() => {
  const MIN_INFLOW = 0.03;
  const EDGE_INSET = 2.5;
  const TRACE_STEP = Math.max(2, H * 0.35);
  const PARTICLE_SOURCE_TAU = 0.85;
  const BOUNDARY_FLOW_REFERENCE = 240;
  const BACKGROUND_BOUNDARY_WEIGHT = 0.22;
  const BOUNDARY_BAND_CELLS = 5;
  const BOUNDARY_RESERVE_RATIO = 0.28;
  const MAX_DENSITY_RESAMPLES_PER_STEP = 2;
  let respawnCount = 0;
  let visualSeedCount = 0;
  let boundaryInjectedCount = 0;
  let densityResampleCount = 0;
  let boundarySourceRate = 0;
  let boundaryParticleDensity = 0;
  let boundaryBandParticles = 0;
  let boundaryBandTargetCount = 0;
  let boundaryFluxIn = 0;
  let boundaryFluxOut = 0;
  let boundaryModel = null;

  function resetTracerDiagnostics(resetModel = false) {
    respawnCount = 0;
    visualSeedCount = 0;
    boundaryInjectedCount = 0;
    densityResampleCount = 0;
    boundarySourceRate = 0;
    boundaryParticleDensity = 0;
    boundaryBandParticles = 0;
    boundaryBandTargetCount = 0;
    boundaryFluxIn = 0;
    boundaryFluxOut = 0;
    if (resetModel) boundaryModel = null;
  }

  const baseResetFields = resetFields;
  resetFields = function() {
    baseResetFields();
    resetTracerDiagnostics();
    if (boundaryModel) {
      for (const component of boundaryModel.components) component.sourceAccumulator = 0;
    }
  };

  const baseRebuildSolidMask = rebuildSolidMask;
  rebuildSolidMask = function() {
    baseRebuildSolidMask();
    boundaryModel = null;
    boundarySourceRate = 0;
    boundaryParticleDensity = 0;
    boundaryBandParticles = 0;
    boundaryBandTargetCount = 0;
    boundaryFluxIn = 0;
    boundaryFluxOut = 0;
  };

  const baseSeedTracers = seedTracers;
  seedTracers = function() {
    boundaryModel = null;
    boundaryInjectedCount = 0;
    densityResampleCount = 0;
    boundarySourceRate = 0;
    boundaryParticleDensity = 0;
    boundaryBandParticles = 0;
    boundaryBandTargetCount = 0;
    boundaryFluxIn = 0;
    boundaryFluxOut = 0;
    baseSeedTracers();
  };

  const previousResetHook = window.physicsV26ResetDiagnostics;
  window.physicsV26ResetDiagnostics = function() {
    if (typeof previousResetHook === 'function') previousResetHook();
    resetTracerDiagnostics(true);
  };

  function buildFluidComponents() {
    const componentByCell = new Int32Array(N);
    componentByCell.fill(-1);
    const components = [];
    const queue = new Int32Array(N);

    for (let start = 0; start < N; start++) {
      if (solid[start] || componentByCell[start] >= 0) continue;

      const id = components.length;
      const cells = [];
      const boundaryCells = [];
      const boundaryBandCells = [];
      let head = 0;
      let tail = 0;
      componentByCell[start] = id;
      queue[tail++] = start;

      while (head < tail) {
        const i = queue[head++];
        const x = i % NX;
        const y = Math.floor(i / NX);
        cells.push(i);
        if (x === 0 || y === 0 || x === NX - 1 || y === NY - 1) {
          boundaryCells.push(i);
        }
        if (Math.min(x, y, NX - 1 - x, NY - 1 - y) <= BOUNDARY_BAND_CELLS) {
          boundaryBandCells.push(i);
        }

        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
          const ni = idx(nx, ny);
          if (solid[ni] || componentByCell[ni] >= 0) continue;
          componentByCell[ni] = id;
          queue[tail++] = ni;
        }
      }

      components.push({
        id,
        cells,
        boundaryCells,
        boundaryBandCells,
        touchesBoundary: boundaryCells.length > 0,
        particleCount: 0,
        boundaryBandCount: 0,
        targetCount: 0,
        targetDensity: 0,
        boundaryTargetCount: 0,
        boundaryFlux: 0,
        boundaryFluxIn: 0,
        boundaryFluxOut: 0,
        deficitSourceRate: 0,
        fluxSourceRate: 0,
        sourceRate: 0,
        sourceAccumulator: 0
      });
    }

    return {componentByCell, components};
  }

  function getBoundaryModel() {
    if (!boundaryModel) boundaryModel = buildFluidComponents();
    return boundaryModel;
  }

  function componentAtPoint(x, y) {
    if (!inCanvas(x, y)) return -1;
    return getBoundaryModel().componentByCell[idx(gridX(x), gridY(y))];
  }

  function isBoundaryBandCell(cell) {
    const x = cell % NX;
    const y = Math.floor(cell / NX);
    return Math.min(x, y, NX - 1 - x, NY - 1 - y) <= BOUNDARY_BAND_CELLS;
  }

  function nearestOpenPointInComponent(x, y, componentId) {
    const model = getBoundaryModel();
    const component = model.components[componentId];
    if (!component) return null;
    if (componentId === componentAtPoint(x, y)) return {x, y};

    const gx = gridX(x), gy = gridY(y);
    for (let radius = 1; radius <= 8; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = gx + dx, ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
          if (model.componentByCell[idx(nx, ny)] === componentId) {
            return {x: (nx + 0.5) * H, y: (ny + 0.5) * H};
          }
        }
      }
    }

    const first = component.cells[0];
    return first === undefined ? null : {
      x: (first % NX + 0.5) * H,
      y: (Math.floor(first / NX) + 0.5) * H
    };
  }

  function collectBoundaryCandidates() {
    const model = getBoundaryModel();
    const candidates = [];
    for (const component of model.components) {
      component.boundaryFlux = 0;
      component.boundaryFluxIn = 0;
      component.boundaryFluxOut = 0;
      component.sourceRate = 0;
    }

    function add(x, y, inwardSpeed) {
      const i = idx(x, y);
      if (solid[i]) return;
      const componentId = model.componentByCell[i];
      const component = model.components[componentId];
      if (!component || !component.touchesBoundary) return;
      const inward = Math.max(0, Number(inwardSpeed) || 0);
      const outward = Math.max(0, -(Number(inwardSpeed) || 0));
      component.boundaryFlux += inward;
      component.boundaryFluxIn += inward;
      component.boundaryFluxOut += outward;
      candidates.push({
        x: (x + 0.5) * H,
        y: (y + 0.5) * H,
        w: BACKGROUND_BOUNDARY_WEIGHT + inward,
        componentId
      });
    }

    for (let x = 0; x < NX; x++) {
      const top = idx(x, 0);
      const bottom = idx(x, NY - 1);
      if (!solid[top]) add(x, 0, v[top]);
      if (!solid[bottom]) add(x, NY - 1, -v[bottom]);
    }
    for (let y = 0; y < NY; y++) {
      const left = idx(0, y);
      const right = idx(NX - 1, y);
      if (!solid[left]) add(0, y, u[left]);
      if (!solid[right]) add(NX - 1, y, -u[right]);
    }
    return candidates;
  }

  function componentCandidates(candidates, componentId) {
    return candidates.filter(q => q.componentId === componentId);
  }

  function weightedPick(candidates) {
    if (!candidates.length) return null;
    let sum = 0;
    for (const q of candidates) sum += Math.max(MIN_INFLOW, q.w);
    let r = Math.random() * sum;
    for (const q of candidates) {
      r -= Math.max(MIN_INFLOW, q.w);
      if (r <= 0) return jitterSpawn(q);
    }
    const q = candidates[candidates.length-1];
    return jitterSpawn(q);
  }

  function jitterSpawn(q) {
    const p = {
      x: clamp(q.x + (Math.random() - 0.5) * H * 0.65, EDGE_INSET, canvas.width - EDGE_INSET),
      y: clamp(q.y + (Math.random() - 0.5) * H * 0.65, EDGE_INSET, canvas.height - EDGE_INSET)
    };
    if (!isSolidPoint(p.x, p.y)) return p;
    return nearestOpenPointInComponent(q.x, q.y, q.componentId) || p;
  }

  boundarySpawnForFlow = function(componentId = null) {
    const model = getBoundaryModel();
    const candidates = collectBoundaryCandidates();
    const filtered = componentId === null
      ? candidates
      : componentCandidates(candidates, componentId);

    if (filtered.length) return weightedPick(filtered);
    if (componentId !== null) {
      const component = model.components[componentId];
      if (!component || !component.touchesBoundary) return null;
    }
    const openCandidates = candidates.filter(q => model.components[q.componentId]?.touchesBoundary);
    if (openCandidates.length) return weightedPick(openCandidates);
    visualSeedCount++;
    return null;
  };

  function localExhaustAt(x, y) {
    const api = window.physicsV25;
    if (api && typeof api.sampleExhaustAt === 'function') {
      return api.sampleExhaustAt(x, y);
    }
    return 0;
  }

  function localAshAt(x, y) {
    const api = window.physicsV25;
    if (api && typeof api.sampleAshAt === 'function') {
      return api.sampleAshAt(x, y);
    }
    return 0;
  }

  function sampleVelocitySafe(px, py) {
    if (!inCanvas(px, py) || isSolidPoint(px, py)) return {x:0, y:0};

    const gxFloat = px / H - 0.5;
    const gyFloat = py / H - 0.5;
    const x0 = Math.floor(gxFloat), y0 = Math.floor(gyFloat);
    const tx = gxFloat - x0, ty = gyFloat - y0;
    let sumU = 0, sumV = 0, weightSum = 0;

    for (let oy = 0; oy <= 1; oy++) {
      for (let ox = 0; ox <= 1; ox++) {
        const x = x0 + ox, y = y0 + oy;
        if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
        const i = idx(x, y);
        if (solid[i]) continue;
        const w = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty);
        if (w <= 0) continue;

        const cx = (x + 0.5) * H;
        const cy = (y + 0.5) * H;
        if (!lineClear(px, py, cx, cy, false)) continue;
        sumU += u[i] * w;
        sumV += v[i] * w;
        weightSum += w;
      }
    }

    if (weightSum > 1e-6) return {x:sumU / weightSum, y:sumV / weightSum};
    const i = idx(gridX(px), gridY(py));
    return solid[i] ? {x:0, y:0} : {x:u[i], y:v[i]};
  }

  function moveTracer(p, dx, dy) {
    const distance = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(distance / TRACE_STEP));
    const stepX = dx / steps, stepY = dy / steps;

    for (let step = 0; step < steps; step++) {
      const startX = p.x, startY = p.y;
      const targetX = startX + stepX, targetY = startY + stepY;
      if (!inCanvas(targetX, targetY)) return false;

      const canX = !isSolidPoint(targetX, startY) &&
        lineClear(startX, startY, targetX, startY, false);
      const canY = !isSolidPoint(startX, targetY) &&
        lineClear(startX, startY, startX, targetY, false);
      const canDiagonal = !isSolidPoint(targetX, targetY) &&
        lineClear(startX, startY, targetX, targetY, false);

      if (canDiagonal) {
        p.x = targetX;
        p.y = targetY;
      } else {
        // If a diagonal step hits a corner, slide along only one free axis;
        // moving both axes independently would cut through an L-shaped wall.
        if (Math.abs(stepX) >= Math.abs(stepY)) {
          if (canX) p.x = targetX;
          else if (canY) p.y = targetY;
        } else if (canY) {
          p.y = targetY;
        } else if (canX) {
          p.x = targetX;
        }
        if (!canX && !canY) {
          p.vx = 0;
          p.vy = 0;
          return true;
        }
      }
    }
    return true;
  }

  function resetAfterTrueExit(p, componentId) {
    const q = boundarySpawnForFlow(componentId);
    if (!q) {
      // A sealed component must never be replaced by an ambient particle. A
      // true exit should be impossible there, so keep the tracer at its last
      // safe in-component position if a coarse step reports one.
      const safe = nearestOpenPointInComponent(p.prevX, p.prevY, componentId);
      if (!safe) return;
      p.x = safe.x;
      p.y = safe.y;
    } else {
      p.x = q.x;
      p.y = q.y;
    }
    p.vx = 0;
    p.vy = 0;
    p.prevX = p.x;
    p.prevY = p.y;
    respawnCount++;
  }

  function refreshComponentPopulations(model, target) {
    const cellCounts = new Uint16Array(N);
    boundaryBandParticles = 0;
    boundaryBandTargetCount = 0;
    for (const component of model.components) {
      component.particleCount = 0;
      component.boundaryBandCount = 0;
      component.targetCount = 0;
      component.targetDensity = 0;
      component.boundaryTargetCount = 0;
    }

    for (const p of particles) {
      const componentId = componentAtPoint(p.x, p.y);
      if (componentId < 0) continue;
      const component = model.components[componentId];
      component.particleCount++;
      const cell = idx(gridX(p.x), gridY(p.y));
      cellCounts[cell]++;
      if (isBoundaryBandCell(cell)) {
        component.boundaryBandCount++;
        if (component.touchesBoundary) boundaryBandParticles++;
      }
    }

    const openComponents = model.components.filter(component => component.touchesBoundary);
    const openArea = openComponents.reduce((sum, component) => sum + component.cells.length, 0);
    boundaryParticleDensity = openArea > 0 ? target / openArea : 0;
    for (const component of openComponents) {
      component.targetCount = openArea > 0
        ? target * component.cells.length / openArea
        : 0;
      component.targetDensity = boundaryParticleDensity;
      component.boundaryTargetCount = Math.max(2, component.targetCount * BOUNDARY_RESERVE_RATIO);
      boundaryBandTargetCount += component.boundaryTargetCount;
    }
    return {openComponents, cellCounts};
  }

  function replenishOpenBoundary(dt) {
    const model = getBoundaryModel();
    const target = targetParticleCount();
    const population = refreshComponentPopulations(model, target);
    const openComponents = population.openComponents;
    const candidates = collectBoundaryCandidates();
    boundarySourceRate = 0;
    boundaryFluxIn = 0;
    boundaryFluxOut = 0;

    for (const component of openComponents) {
      const deficit = Math.max(0, component.targetCount - component.particleCount);
      const flowFactor = 1 + Math.min(
        component.boundaryFluxIn / BOUNDARY_FLOW_REFERENCE,
        1
      );
      const fluxDensityRate = component.boundaryFluxIn * component.targetDensity / Math.max(1, H);
      // Formula used by the teaching model:
      // ΔN = [deficit / τ * (1 + min(Qin/Qref, 1)) +
      //       Qin * targetTracerDensity / H] * dt
      // The second term converts the measured boundary face flux into the
      // number of tracer samples represented by that swept cell area. True
      // exits already replace one tracer with one boundary tracer in
      // resetAfterTrueExit(), so only the deficit term is accumulated into a
      // new particle. The flux term is still reported as external-air
      // exchange and is not allowed to grow the finite visual pool.
      component.deficitSourceRate = deficit > 0
        ? deficit / PARTICLE_SOURCE_TAU * flowFactor
        : 0;
      component.fluxSourceRate = fluxDensityRate;
      component.sourceRate = component.deficitSourceRate + component.fluxSourceRate;
      boundarySourceRate += component.sourceRate;
      boundaryFluxIn += component.boundaryFluxIn;
      boundaryFluxOut += component.boundaryFluxOut;
      component.sourceAccumulator += component.deficitSourceRate * dt;

      const choices = componentCandidates(candidates, component.id);
      while (component.sourceAccumulator >= 1 && choices.length) {
        const q = weightedPick(choices);
        if (!q) break;
        particles.push(makeTracer(q));
        component.particleCount++;
        component.sourceAccumulator -= 1;
        boundaryInjectedCount++;
      }
      // Do not bank a source request after the population has caught up; the
      // next deficit should be based on the current state, not old demand.
      if (component.particleCount >= component.targetCount) {
        component.sourceAccumulator = 0;
      }
    }

    rebalanceBoundaryBand(model, openComponents, candidates, population.cellCounts);
  }

  function rebalanceBoundaryBand(model, openComponents, candidates, cellCounts) {
    let remaining = MAX_DENSITY_RESAMPLES_PER_STEP;
    if (remaining <= 0) return;

    for (const component of openComponents) {
      if (remaining <= 0) break;
      if (component.boundaryFluxIn <= 0) continue;
      let deficit = Math.ceil(component.boundaryTargetCount - component.boundaryBandCount);
      if (deficit <= 0) continue;

      const choices = componentCandidates(candidates, component.id);
      while (deficit > 0 && remaining > 0 && choices.length) {
        const donor = findOverrepresentedTracer(component, cellCounts);
        const q = weightedPick(choices);
        if (!donor || !q) break;
        donor.x = q.x;
        donor.y = q.y;
        donor.vx = 0;
        donor.vy = 0;
        donor.prevX = donor.x;
        donor.prevY = donor.y;
        densityResampleCount++;
        remaining--;
        deficit--;
        component.boundaryBandCount++;
      }
    }
  }

  function findOverrepresentedTracer(component, cellCounts) {
    let best = null;
    let bestScore = 0;
    for (const p of particles) {
      const componentId = componentAtPoint(p.x, p.y);
      if (componentId !== component.id) continue;
      const cell = idx(gridX(p.x), gridY(p.y));
      if (isBoundaryBandCell(cell)) continue;
      const score = cellCounts[cell] - component.targetDensity * 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  function trimOpenPopulation(target) {
    const model = getBoundaryModel();
    let openCount = 0;
    for (const p of particles) {
      const componentId = componentAtPoint(p.x, p.y);
      if (componentId >= 0 && model.components[componentId].touchesBoundary) openCount++;
    }
    let excess = Math.max(0, openCount - target);
    if (!excess) return;

    // The slider controls the open-field baseline. Preserve every tracer in
    // a sealed component; only surplus open-boundary tracers may be removed.
    const kept = [];
    for (const p of particles) {
      const componentId = componentAtPoint(p.x, p.y);
      const isOpen = componentId >= 0 && model.components[componentId].touchesBoundary;
      if (isOpen && excess > 0) {
        excess--;
        continue;
      }
      kept.push(p);
    }
    particles = kept;
  }

  updateTracers = function(dt) {
    const target = targetParticleCount();

    trimOpenPopulation(target);
    while (particles.length < target) {
      const q = ignited ? boundarySpawnForFlow() : randomOpenPoint();
      const p = makeTracer(q || randomOpenPoint());
      particles.push(p);
    }

    for (const p of particles) {
      if (!Number.isFinite(p.prevX) || !Number.isFinite(p.prevY)) {
        p.prevX = p.x;
        p.prevY = p.y;
      }
      p.prevX = p.x;
      p.prevY = p.y;
      const componentId = componentAtPoint(p.x, p.y);
      const vel = sampleVelocitySafe(p.x, p.y);
      p.vx = Number.isFinite(vel.x) ? vel.x : 0;
      p.vy = Number.isFinite(vel.y) ? vel.y : 0;

      if (!Number.isFinite(p.vx) || !Number.isFinite(p.vy) ||
          !moveTracer(p, p.vx * dt, p.vy * dt)) {
        resetAfterTrueExit(p, componentId);
      }
    }

    // Open components get a continuous boundary source. Sealed components
    // are intentionally absent from this call and therefore cannot receive
    // ambient particles merely because their local pool became small.
    replenishOpenBoundary(dt);
  };

  drawTracers = function() {
    for (const p of particles) {
      const t = sampleField(temperature, p.x, p.y, AMBIENT_T);
      const localSmoke = sampleField(smoke, p.x, p.y, 0);
      const localAsh = localAshAt(p.x, p.y);
      const localExhaust = localExhaustAt(p.x, p.y);
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

    // Keep the tracer population visible as a diagnostic on the Canvas, not
    // only in the right-hand metrics panel, which may be below the fold.
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
  };

  const metricsPanel = document.querySelector('.panel.metrics');
  const advancedMetrics = document.getElementById('advancedMetrics');
  let particleStatusEl = null;
  let boundaryRateEl = null;
  let boundaryTopologyEl = null;
  let boundaryDensityEl = null;
  let boundaryBandEl = null;
  const metricsTarget = advancedMetrics || metricsPanel;
  if (metricsTarget) {
    const card = document.createElement('div');
    card.className = 'metric-card';
    card.innerHTML = '<span>空氣示蹤粒子（可見／開放基準）</span><strong id="particleStatus">—</strong>';
    metricsTarget.appendChild(card);
    particleStatusEl = card.querySelector('#particleStatus');

    const sourceCard = document.createElement('div');
    sourceCard.className = 'metric-card';
    sourceCard.innerHTML = '<span>開放邊界空氣交換（示蹤等效粒／秒）</span><strong id="boundaryAirRate">—</strong>';
    metricsTarget.appendChild(sourceCard);
    boundaryRateEl = sourceCard.querySelector('#boundaryAirRate');

    const topologyCard = document.createElement('div');
    topologyCard.className = 'metric-card';
    topologyCard.innerHTML = '<span>空氣連通區</span><strong id="boundaryTopology">—</strong>';
    metricsTarget.appendChild(topologyCard);
    boundaryTopologyEl = topologyCard.querySelector('#boundaryTopology');

    const densityCard = document.createElement('div');
    densityCard.className = 'metric-card';
    densityCard.innerHTML = '<span>開放區示蹤密度（顆／格）</span><strong id="boundaryDensity">—</strong>';
    metricsTarget.appendChild(densityCard);
    boundaryDensityEl = densityCard.querySelector('#boundaryDensity');

    const bandCard = document.createElement('div');
    bandCard.className = 'metric-card';
    bandCard.innerHTML = '<span>邊界帶粒子（目前／目標）</span><strong id="boundaryBandStatus">—</strong>';
    metricsTarget.appendChild(bandCard);
    boundaryBandEl = bandCard.querySelector('#boundaryBandStatus');
  }

  function visibleParticleCount() {
    let count = 0;
    for (const p of particles) {
      if (inCanvas(p.x, p.y) && !isSolidPoint(p.x, p.y)) count++;
    }
    return count;
  }

  const baseUpdateMetrics = updateMetrics;
  updateMetrics = function() {
    baseUpdateMetrics();
    const model = getBoundaryModel();
    const openCount = model.components.filter(component => component.touchesBoundary).length;
    const sealedCount = model.components.length - openCount;
    if (particleStatusEl) {
      particleStatusEl.textContent = `${visibleParticleCount()} / ${targetParticleCount()}｜實際 ${particles.length}｜重生 ${respawnCount}`;
    }
    if (boundaryRateEl) boundaryRateEl.textContent = boundarySourceRate.toFixed(1);
    if (boundaryTopologyEl) boundaryTopologyEl.textContent = `開放 ${openCount}｜密閉 ${sealedCount}`;
    if (boundaryDensityEl) boundaryDensityEl.textContent = boundaryParticleDensity.toFixed(3);
    if (boundaryBandEl) {
      boundaryBandEl.textContent = `${boundaryBandParticles} ／ ${Math.ceil(boundaryBandTargetCount)}｜視覺重分布 ${densityResampleCount}`;
      boundaryBandEl.title = '邊界帶不足時只重分布示蹤粒子；不改變氧氣、黑煙、灰分或壓力場。';
    }
  };

  window.tracerV25 = {
    get particleCount() { return particles.length; },
    get visibleParticleCount() { return visibleParticleCount(); },
    get respawnCount() { return respawnCount; },
    get visualSeedCount() { return visualSeedCount; },
    get boundaryInjectedCount() { return boundaryInjectedCount; },
    get boundarySourceRate() { return boundarySourceRate; },
    get densityResampleCount() { return densityResampleCount; },
    get boundaryParticleDensity() { return boundaryParticleDensity; },
    get boundaryBandParticles() { return boundaryBandParticles; },
    get boundaryBandTargetCount() { return boundaryBandTargetCount; },
    get boundaryFluxIn() { return boundaryFluxIn; },
    get boundaryFluxOut() { return boundaryFluxOut; },
    resetDiagnostics: () => resetTracerDiagnostics(true),
    trimOpenPopulation,
    get openComponents() {
      return getBoundaryModel().components.filter(component => component.touchesBoundary).length;
    },
    get sealedComponents() {
      return getBoundaryModel().components.filter(component => !component.touchesBoundary).length;
    }
  };
})();
