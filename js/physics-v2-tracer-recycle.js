/* Physics v2.5 tracer recycling + persistent combustion-product tracers.
 *
 * Tracers are visualization only. The fluid solver is NOT changed here.
 *
 * Rules:
 * 1) Requested tracer count is preserved exactly.
 * 2) Tracers are never teleported while they remain inside the canvas.
 * 3) Once a tracer enters combustion products (smoke scalar above threshold),
 *    it stays gray until it truly exits the canvas.
 * 4) A tracer that exits is reintroduced from a solved inflow boundary. If no
 *    inflow currently exists, it waits on an open boundary until flow develops.
 */
(() => {
  const MIN_INFLOW = 0.03;
  const EDGE_INSET = 2.5;
  const EXHAUST_SMOKE_THRESHOLD = 0.08;

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

  function markCombustionProduct(p) {
    if (p.exhaust) return;
    const localSmoke = sampleField(smoke, p.x, p.y, 0);
    if (localSmoke >= EXHAUST_SMOKE_THRESHOLD) p.exhaust = true;
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
      const speed = Math.hypot(p.vx, p.vy);
      ctx.beginPath();
      ctx.arc(p.x, p.y, clamp(1.8 + speed / 90, 1.8, 4.2), 0, Math.PI * 2);

      if (p.exhaust) {
        const alpha = clamp(0.66 + localSmoke * 0.16, 0.66, 0.88);
        ctx.fillStyle = `rgba(75,85,99,${alpha})`;
      } else if (t > 40) {
        ctx.fillStyle = 'rgba(234,88,12,.72)';
      } else {
        ctx.fillStyle = 'rgba(37,99,235,.52)';
      }
      ctx.fill();
    }
  };
})();
