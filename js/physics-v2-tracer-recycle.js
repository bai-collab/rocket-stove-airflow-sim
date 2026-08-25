/* Physics v2.4.3: robust tracer recycling at open boundaries.
 *
 * Tracers are visualization only. The fluid solver is NOT changed here.
 *
 * Problem fixed:
 * The base v2 tracer recycler used a relatively high inflow threshold and then
 * fell back to a random boundary. During a strong hot plume, a tracer could be
 * recycled onto an outflow boundary and immediately leave again, so over time
 * most visible tracers could appear to vanish at the edges.
 *
 * This patch:
 * 1) detects even weak inward boundary flow;
 * 2) chooses inflow locations weighted by inward speed;
 * 3) avoids repeatedly recycling a tracer onto an outflow boundary;
 * 4) preserves the requested tracer count exactly.
 */
(() => {
  const MIN_INFLOW = 0.03;      // px/s; visual detection threshold only
  const EDGE_INSET = 2.5;       // px inside canvas
  const EDGE_BAND = 5;          // px
  const EDGE_STUCK_TIME = 0.45; // s before recycling a boundary-cycling tracer

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
    // Only used when the solved field has essentially no inward boundary cell.
    // Choose the most neutral/open edge instead of a random strong outflow.
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

  updateTracers = function(dt) {
    const target = targetParticleCount();

    // Keep the visualization count exact. New visual tracers are introduced
    // only at an outer boundary when the user raises the tracer slider.
    if (particles.length > target) particles.length = target;
    while (particles.length < target) {
      const q = ignited ? boundarySpawnForFlow() : randomOpenPoint();
      const p = makeTracer(q);
      p.edgeAge = 0;
      particles.push(p);
    }

    for (const p of particles) {
      if (p.edgeAge == null) p.edgeAge = 0;
      const vel = sampleVelocity(p.x,p.y);
      p.vx = Number.isFinite(vel.x) ? vel.x : 0;
      p.vy = Number.isFinite(vel.y) ? vel.y : 0;
      const nx = p.x + p.vx*dt;
      const ny = p.y + p.vy*dt;

      if (!Number.isFinite(nx) || !Number.isFinite(ny) || !inCanvas(nx,ny)) {
        const q = boundarySpawnForFlow();
        p.x=q.x; p.y=q.y; p.vx=0; p.vy=0; p.edgeAge=0;
        continue;
      }

      if (isSolidPoint(nx,ny)) {
        if (!isSolidPoint(nx,p.y)) p.x=nx;
        if (!isSolidPoint(p.x,ny)) p.y=ny;
        p.vx=0; p.vy=0;
      } else {
        p.x=nx; p.y=ny;
      }

      // A tracer repeatedly sitting on an edge usually means it was recycled
      // onto an outflow/near-neutral cell. Recycle it to a solved inflow edge.
      if (nearEdge(p)) p.edgeAge += dt;
      else p.edgeAge = 0;
      if (p.edgeAge > EDGE_STUCK_TIME) {
        const q=boundarySpawnForFlow();
        p.x=q.x; p.y=q.y; p.vx=0; p.vy=0; p.edgeAge=0;
      }
    }
  };
})();
