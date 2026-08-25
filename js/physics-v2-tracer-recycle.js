/* Physics v2.4.4: robust tracer recycling + persistent exhaust tracers.
 *
 * Tracers are visualization only. The fluid solver is NOT changed here.
 *
 * Rules:
 * 1) Tracers recycle only through solved/open boundary inflow locations.
 * 2) Requested tracer count is preserved exactly.
 * 3) Once a tracer enters combustion products (smoke scalar above threshold),
 *    it becomes an exhaust tracer and stays gray even after it leaves the
 *    locally smoky cell.
 * 4) An exhaust tracer returns to fresh/blue ONLY after it actually exits the
 *    canvas and is reintroduced from an external inflow boundary.
 */
(() => {
  const MIN_INFLOW = 0.03;      // px/s; visual detection threshold only
  const EDGE_INSET = 2.5;       // px inside canvas
  const EDGE_BAND = 5;          // px
  const EDGE_STUCK_TIME = 0.45; // s; applies only to fresh tracers
  const EXHAUST_SMOKE_THRESHOLD = 0.08;

  function inflowCandidates() {
    const c = [];

    for (let x = 0; x < NX; x++) {
      const top = idx(x, 0);
      if (!solid[top]) {
        const inward = v[top]; // +y enters from top
        if (inward > MIN_INFLOW) c.push({x:(x+.5)*H, y:EDGE_INSET, w:inward});
      }

      const bottom = idx(x, NY-1);
      if (!solid[bottom]) {
        const inward = -v[bottom]; // -y enters from bottom
        if (inward > MIN_INFLOW) c.push({x:(x+.5)*H, y:canvas.height-EDGE_INSET, w:inward});
      }
    }

    for (let y = 0; y < NY; y++) {
      const left = idx(0, y);
      if (!solid[left]) {
        const inward = u[left]; // +x enters from left
        if (inward > MIN_INFLOW) c.push({x:EDGE_INSET, y:(y+.5)*H, w:inward});
      }

      const right = idx(NX-1, y);
      if (!solid[right]) {
        const inward = -u[right]; // -x enters from right
        if (inward > MIN_INFLOW) c.push({x:canvas.width-EDGE_INSET, y:(y+.5)*H, w:inward});
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

  function weakestOutflowBoundaryPoint() {
    let best = null;
    const consider = (x,y,outward) => {
      if (isSolidPoint(x,y)) return;
      const score = Math.max(0, outward);
      if (!best || score < best.score) best = {x,y,score};
    };

    for (let x=0;x<NX;x++) {
      consider((x+.5)*H, EDGE_INSET, -v[idx(x,0)]);
      consider((x+.5)*H, canvas.height-EDGE_INSET, v[idx(x,NY-1)]);
    }
    for (let y=0;y<NY;y++) {
      consider(EDGE_INSET, (y+.5)*H, -u[idx(0,y)]);
      consider(canvas.width-EDGE_INSET, (y+.5)*H, u[idx(NX-1,y)]);
    }
    return best ? {x:best.x,y:best.y} : randomOpenPoint();
  }

  boundarySpawnForFlow = function() {
    const p = weightedPick(inflowCandidates());
    return p || weakestOutflowBoundaryPoint();
  };

  function nearEdge(p) {
    return p.x < EDGE_BAND || p.y < EDGE_BAND ||
           p.x > canvas.width-EDGE_BAND || p.y > canvas.height-EDGE_BAND;
  }

  function markCombustionProduct(p) {
    if (p.exhaust) return;
    const localSmoke = sampleField(smoke, p.x, p.y, 0);
    if (localSmoke >= EXHAUST_SMOKE_THRESHOLD) p.exhaust = true;
  }

  function resetAtExternalInflow(p) {
    const q = boundarySpawnForFlow();
    p.x = q.x;
    p.y = q.y;
    p.vx = 0;
    p.vy = 0;
    p.edgeAge = 0;
    // Only a true canvas exit represents leaving the system and being replaced
    // by fresh ambient air.
    p.exhaust = false;
  }

  updateTracers = function(dt) {
    const target = targetParticleCount();

    if (particles.length > target) particles.length = target;
    while (particles.length < target) {
      const q = ignited ? boundarySpawnForFlow() : randomOpenPoint();
      const p = makeTracer(q);
      p.edgeAge = 0;
      p.exhaust = false;
      particles.push(p);
    }

    for (const p of particles) {
      if (p.edgeAge == null) p.edgeAge = 0;
      if (p.exhaust == null) p.exhaust = false;

      // Capture combustion-product identity before movement, then again after
      // movement so a tracer crossing the reaction plume during this step is
      // marked immediately.
      markCombustionProduct(p);

      const vel = sampleVelocity(p.x,p.y);
      p.vx = Number.isFinite(vel.x) ? vel.x : 0;
      p.vy = Number.isFinite(vel.y) ? vel.y : 0;
      const nx = p.x + p.vx*dt;
      const ny = p.y + p.vy*dt;

      if (!Number.isFinite(nx) || !Number.isFinite(ny) || !inCanvas(nx,ny)) {
        resetAtExternalInflow(p);
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

      // Fresh tracers may be visually recycled if they repeatedly sit on a
      // neutral/outflow edge. Exhaust tracers are NEVER recycled while still
      // inside the canvas: they remain gray until they truly leave the canvas.
      if (p.exhaust) {
        p.edgeAge = 0;
      } else {
        if (nearEdge(p)) p.edgeAge += dt;
        else p.edgeAge = 0;
        if (p.edgeAge > EDGE_STUCK_TIME) {
          const q=boundarySpawnForFlow();
          p.x=q.x; p.y=q.y; p.vx=0; p.vy=0; p.edgeAge=0;
        }
      }
    }
  };

  // Persistent tracer color state: exhaust identity belongs to the tracer,
  // rather than being re-decided from the current cell every frame.
  drawTracers = function() {
    for (const p of particles) {
      const t = sampleField(temperature, p.x, p.y, AMBIENT_T);
      const localSmoke = sampleField(smoke, p.x, p.y, 0);
      const speed = Math.hypot(p.vx, p.vy);
      ctx.beginPath();
      ctx.arc(p.x, p.y, clamp(1.8 + speed / 90, 1.8, 4.2), 0, Math.PI * 2);

      if (p.exhaust) {
        const alpha = clamp(0.72 + localSmoke * 0.20, 0.72, 0.92);
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
