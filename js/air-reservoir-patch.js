/* Local open-air reservoir correction.
 * Open regions are connected to an effectively infinite atmosphere.
 * Tracers may only be CREATED at the canvas boundary, but replenishment is
 * driven by LOCAL density deficits rather than the total external count.
 */
(() => {
  const LOCAL_TARGET = 0.42;
  const SAMPLE_RADIUS = 2;
  const MAX_LOCAL_INFLOW = 8;

  function externalDeficitCells() {
    ensureConnectivity();
    const counts = buildDensity();
    const wallCells = wallCellSet();
    const deficits = [];

    for (let idx = 0; idx < regionMap.length; idx++) {
      if (wallCells.has(idx)) continue;
      const region = regionMap[idx];
      if (!region || !externalRegions.has(region)) continue;

      const cx = idx % GRID_COLS;
      const cy = Math.floor(idx / GRID_COLS);
      let total = 0, open = 0;
      for (let dy = -SAMPLE_RADIUS; dy <= SAMPLE_RADIUS; dy++) {
        for (let dx = -SAMPLE_RADIUS; dx <= SAMPLE_RADIUS; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= GRID_COLS || ny >= GRID_ROWS) continue;
          const ni = ny * GRID_COLS + nx;
          if (regionMap[ni] !== region || wallCells.has(ni)) continue;
          total += counts[ni];
          open++;
        }
      }
      if (!open) continue;
      const density = total / open;
      if (density < LOCAL_TARGET) deficits.push({idx, region, density, need: LOCAL_TARGET - density});
    }
    deficits.sort((a,b) => b.need - a.need);
    return deficits;
  }

  function spawnTowardCell(target) {
    const boundary = boundaryOpenCells().filter(i => regionMap[i] === target.region);
    if (!boundary.length) return false;
    const counts = buildDensity();
    const tx = target.idx % GRID_COLS, ty = Math.floor(target.idx / GRID_COLS);
    let best = -1, bestScore = Infinity;
    for (const i of boundary) {
      if (counts[i] >= MAX_PARTICLES_PER_CELL) continue;
      const bx = i % GRID_COLS, by = Math.floor(i / GRID_COLS);
      const score = Math.hypot(tx - bx, ty - by) + counts[i] * 3;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return false;

    const bx = best % GRID_COLS, by = Math.floor(best / GRID_COLS);
    let x = bx * CELL + CELL / 2, y = by * CELL + CELL / 2;
    if (bx === 0) x = 1;
    else if (bx === GRID_COLS - 1) x = canvas.width - 1;
    if (by === 0) y = 1;
    else if (by === GRID_ROWS - 1) y = canvas.height - 1;

    const targetPoint = pointInCell(target.idx);
    const dx = targetPoint.x - x, dy = targetPoint.y - y;
    const d = Math.hypot(dx,dy) || 1;
    const p = makeParticle({x,y}, 'fresh', 0);
    const entrySpeed = 14 + Math.min(16, d / 28);
    p.vx = dx / d * entrySpeed + (Math.random()-.5)*1.5;
    p.vy = dy / d * entrySpeed + (Math.random()-.5)*1.5;
    particles.push(p);
    return true;
  }

  // Replace the previous global-count reservoir controller.
  maintainExternalReservoir = function() {
    const deficits = externalDeficitCells();
    if (!deficits.length) return;
    let added = 0;
    // Spread entries among the strongest local deficits instead of repeatedly
    // feeding whichever canvas edge happens to be globally emptiest.
    const limit = Math.min(deficits.length, 24);
    for (let i = 0; i < limit && added < MAX_LOCAL_INFLOW; i++) {
      if (spawnTowardCell(deficits[i])) added++;
    }
  };
})();
