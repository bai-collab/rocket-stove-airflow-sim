/* Physics v2.5.2 tracer recycling + combustion-product visualization.
 *
 * Tracers visualize air motion; they are not oxygen molecules and do not
 * participate in the chemistry solver.
 *
 * Rules:
 * 1) Blue = fresh-air tracer (the same flow carries the oxygen scalar).
 * 2) Orange = fresh air that has been heated.
 * 3) Gray = tracer that has entered combustion-product gas (exhaustGas).
 * 4) Black smoke is rendered separately by the smoke scalar; gray is NOT soot.
 * 5) Tracers are never teleported while inside the canvas and reset to fresh
 *    only after they truly exit and re-enter from an outside boundary.
 */
(() => {
  const MIN_INFLOW = 0.03;
  const EDGE_INSET = 2.5;
  const EXHAUST_GAS_THRESHOLD = 0.035;
  const SMOKE_FALLBACK_THRESHOLD = 0.14;

  function inflowCandidates() {
    const c = [];

    for (let x = 0; x < NX; x++) {
      const top = idx(x, 0);
      if (!solid[top] && v[top] > MIN_INFLOW) {
        c.push({x:(x+.5)*H, y:EDGE_INSET, w:v[top]});
      }
      const bottom = idx(x, NY-1);
      if (!solid[bottom] && -v[bottom] > MIN_INFLOW) {
        c.push({x:(x+.5)*H, y:canvas.height-EDGE_INSET, w:-v[bottom]});
      }
    }

    for (let y = 0; y < NY; y++) {
      const left = idx(0, y);
      if (!solid[left] && u[left] > MIN_INFLOW) {
        c.push({x:EDGE_INSET, y:(y+.5)*H, w:u[left]});
      }
      const right = idx(NX-1, y);
      if (!solid[right] && -u[right] > MIN_INFLOW) {
        c.push({x:canvas.width-EDGE_INSET, y:(y+.5)*H, w:-u[right]});
      }
    }
    return c;
  }

  function weightedPick(candidates) {
    if (!candidates.length) return null;
    let sum = 0;
    for (const q of candidates) sum += Math.max(MIN_INFLOW, q.w);
    let r = Math.random() * sum;
    for (const q of candidates) {
      r -= Math.max(MIN_INFLOW, q.w);
      if (r <= 0) return {x:q.x,y:q.y};
    }
    const q = candidates[candidates.length-1];
    return {x:q.x,y:q.y};
  }

  function openBoundaryPoint() {
    const candidates = [];
    for (let x=0; x<NX; x++) {
      if (!solid[idx(x,0)]) candidates.push({x:(x+.5)*H,y:EDGE_INSET});
      if (!solid[idx(x,NY-1)]) candidates.push({x:(x+.5)*H,y:canvas.height-EDGE_INSET});
    }
    for (let y=0; y<NY; y++) {
      if (!solid[idx(0,y)]) candidates.push({x:EDGE_INSET,y:(y+.5)*H});
      if (!solid[idx(NX-1,y)]) candidates.push({x:canvas.width-EDGE_INSET,y:(y+.5)*H});
    }
    if (!candidates.length) return randomOpenPoint();
    return candidates[Math.floor(Math.random()*candidates.length)];
  }

  boundarySpawnForFlow = function() {
    return weightedPick(inflowCandidates()) || openBoundaryPoint();
  };

  function localExhaustAt(x, y) {
    const api = window.physicsV25;
    if (api && typeof api.sampleExhaustAt === 'function') {
      return api.sampleExhaustAt(x, y);
    }
    return 0;
  }

  function markCombustionProduct(p) {
    if (p.exhaust) return;
    const localExhaust = localExhaustAt(p.x, p.y);
    const localSmoke = sampleField(smoke, p.x, p.y, 0);
    if (localExhaust >= EXHAUST_GAS_THRESHOLD || localSmoke >= SMOKE_FALLBACK_THRESHOLD) {
      p.exhaust = true;
    }
  }

  function resetAfterTrueExit(p) {
    const q = boundarySpawnForFlow();
    p.x = q.x;
    p.y = q.y;
    p.vx = 0;
    p.vy = 0;
    p.exhaust = false;
  }

  updateTracers = function(dt) {
    const target = targetParticleCount();

    if (particles.length > target) particles.length = target;
    while (particles.length < target) {
      const q = ignited ? boundarySpawnForFlow() : randomOpenPoint();
      const p = makeTracer(q);
      p.exhaust = false;
      particles.push(p);
    }

    for (const p of particles) {
      if (p.exhaust == null) p.exhaust = false;
      markCombustionProduct(p);

      const vel = sampleVelocity(p.x,p.y);
      p.vx = Number.isFinite(vel.x) ? vel.x : 0;
      p.vy = Number.isFinite(vel.y) ? vel.y : 0;
      const nx = p.x + p.vx*dt;
      const ny = p.y + p.vy*dt;

      if (!Number.isFinite(nx) || !Number.isFinite(ny) || !inCanvas(nx,ny)) {
        resetAfterTrueExit(p);
        continue;
      }

      if (isSolidPoint(nx,ny)) {
        if (!isSolidPoint(nx,p.y)) p.x=nx;
        if (!isSolidPoint(p.x,ny)) p.y=ny;
        p.vx=0;
        p.vy=0;
      } else {
        p.x=nx;
        p.y=ny;
      }

      markCombustionProduct(p);
    }
  };

  drawTracers = function() {
    for (const p of particles) {
      const t = sampleField(temperature, p.x, p.y, AMBIENT_T);
      const localSmoke = sampleField(smoke, p.x, p.y, 0);
      const localO2 = sampleField(oxygen, p.x, p.y, AMBIENT_O2);
      const speed = Math.hypot(p.vx, p.vy);
      ctx.beginPath();
      ctx.arc(p.x, p.y, clamp(1.8 + speed / 90, 1.8, 4.2), 0, Math.PI * 2);

      if (p.exhaust) {
        const alpha = clamp(0.58 + localSmoke * 0.10, 0.58, 0.76);
        ctx.fillStyle = `rgba(75,85,99,${alpha})`;
      } else if (t > 40) {
        ctx.fillStyle = 'rgba(234,88,12,.72)';
      } else {
        const alpha = clamp(0.34 + localO2 * 0.22, 0.34, 0.56);
        ctx.fillStyle = `rgba(37,99,235,${alpha})`;
      }
      ctx.fill();
    }
  };
})();
