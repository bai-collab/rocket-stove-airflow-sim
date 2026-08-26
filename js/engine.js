import {
  BUILD_CELL,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DT
} from './core/grid.js';
import {
  FIELD_NAMES as ALL_FIELD_NAMES,
  exposeFields
} from './core/fields.js';
import {
  chimneys,
  ensureGeometry,
  fans,
  fires,
  geometryDirty,
  ignited,
  inlets,
  particles,
  resetSceneCollections,
  running,
  setGeometryDirty,
  setGeometryPostProcessor,
  setIgnited,
  setRunning,
  walls
} from './core/state.js';
import {resetStackDiagnostics, resetStackGeometry, getStackDiagnostics} from './physics/stack-flow.js';
import {
  relocateTracersOutOfSolids,
  resetTracerDiagnostics,
  resetTracerGeometry,
  seedBaseTracers,
  seedStratifiedTracers,
  seedTracers,
  getTracerDiagnostics
} from './physics/tracer-recycle.js';
import {
  physicsStep,
  resetSecondaryState,
  reconcileSecondaryGeometry,
  getSecondaryScalars
} from './physics/secondary-combustion.js';
import {
  resetConservationDiagnostics,
  getConservationDiagnostics
} from './physics/conservation.js';

// The final legacy wrapper order is stack -> tracer -> secondary around the
// app's solid-mask operation.  Keep that order in the module graph too.
setGeometryPostProcessor(previousSolid => {
  relocateTracersOutOfSolids();
  resetStackGeometry();
  resetTracerGeometry();
  reconcileSecondaryGeometry(previousSolid);
});

function registerOracle() {
  if (globalThis.__oracleFields) exposeFields(globalThis.__oracleFields);

  const scalarRegistry = globalThis.__oracleScalars;
  if (!scalarRegistry) return;
  const secondary = getSecondaryScalars();
  const conservation = getConservationDiagnostics();
  for (const name of [
    'ashGeneratedTotal', 'ashDepositedTotal', 'ashOutTotal', 'ashBurnedTotal',
    'charGeneratedTotal', 'charBurnedTotal', 'flyAshOutTotal',
    'flyAshLiftedTotal', 'flyAshDepositedTotal', 'secondaryIndex', 'smokeOutIndex'
  ]) {
    Object.defineProperty(scalarRegistry, name, {
      configurable: true,
      enumerable: true,
      get: () => secondary[name]
    });
  }
  for (const name of [
    'pressureResidual', 'pressureEquationResidual',
    'projectedInFlow', 'projectedOutFlow'
  ]) {
    Object.defineProperty(scalarRegistry, name, {
      configurable: true,
      enumerable: true,
      get: () => conservation[name]
    });
  }
}

let initialized = false;

export function initializeRuntime() {
  if (initialized) return;
  registerOracle();
  ensureGeometry();
  // app-v2 seeds once, then stack-flow replaces the seed function and seeds
  // again.  Keep both calls so the deterministic RNG has the same lifecycle.
  seedBaseTracers();
  seedStratifiedTracers();
  initialized = true;
}

function cell(c, r) {
  return {x: c * BUILD_CELL, y: r * BUILD_CELL};
}

function buildWalls(builder) {
  const cells = new Map();
  const add = (c, r) => {
    if (c < 0 || r < 0 || c * BUILD_CELL >= CANVAS_WIDTH || r * BUILD_CELL >= CANVAS_HEIGHT) return;
    cells.set(`${c},${r}`, [c, r]);
  };
  const vertical = (c, from, to, gaps = []) => {
    for (let r = from; r <= to; r++) if (!gaps.includes(r)) add(c, r);
  };
  const horizontal = (r, from, to, gaps = []) => {
    for (let c = from; c <= to; c++) if (!gaps.includes(c)) add(c, r);
  };
  builder({add, vertical, horizontal});
  return [...cells.values()].map(([c, r]) => cell(c, r));
}

const presets = [
  {
    id: 'straight',
    walls: buildWalls(({vertical, horizontal}) => {
      vertical(12, 14, 21, [14]);
      vertical(24, 14, 21, [14]);
      horizontal(21, 12, 24);
      horizontal(18, 17, 19, [18]);
      vertical(17, 18, 20);
      vertical(19, 18, 20);
      vertical(16, 9, 16, [12, 14]);
      vertical(20, 9, 16, [12, 14]);
      vertical(14, 3, 9);
      vertical(22, 3, 9);
      horizontal(9, 14, 22, [17, 18, 19]);
    }),
    inlets: [{c: 13, r: 14, dx: 1, dy: 0}, {c: 23, r: 14, dx: -1, dy: 0}],
    fires: [{c: 18, r: 20, primaryAirFactor: 0.46}],
    chimneys: [[18, 3]]
  },
  {
    id: 'baffle',
    walls: buildWalls(({vertical, horizontal}) => {
      vertical(11, 14, 21, [14]);
      vertical(25, 3, 21, [14]);
      horizontal(21, 11, 25, [15]);
      horizontal(17, 11, 24, [23, 24]);
      horizontal(13, 12, 24, [12, 13]);
      horizontal(9, 12, 22, [21, 22]);
      vertical(21, 3, 8);
    }),
    inlets: [{c: 12, r: 14, dx: 1, dy: 0}, {c: 24, r: 14, dx: -1, dy: 0}],
    fires: [{c: 15, r: 19}],
    chimneys: [[23, 4]]
  },
  {
    id: 'twin-channel',
    walls: buildWalls(({vertical, horizontal}) => {
      vertical(10, 14, 21, [14]);
      vertical(26, 14, 21, [14]);
      horizontal(21, 10, 26);
      horizontal(17, 10, 26, [16, 17, 18, 19, 20]);
      horizontal(18, 17, 19, [18]);
      vertical(17, 18, 20);
      vertical(19, 18, 20);
      vertical(14, 8, 16, [12, 15]);
      vertical(22, 8, 16, [12, 15]);
      vertical(17, 8, 16, [12, 15]);
      vertical(19, 8, 16, [12, 15]);
      horizontal(11, 14, 22, [16, 17, 18, 19, 20]);
      horizontal(8, 14, 22, [16, 17, 18, 19, 20]);
      vertical(14, 3, 8);
      vertical(22, 3, 8);
    }),
    inlets: [
      {c: 11, r: 12, dx: 1, dy: 0},
      {c: 25, r: 15, dx: -1, dy: 0},
      {c: 15, r: 12, dx: 1, dy: 0},
      {c: 21, r: 15, dx: -1, dy: 0}
    ],
    fires: [{c: 18, r: 20, primaryAirFactor: 0.42}],
    chimneys: [[18, 3]]
  }
];

export function clearScene() {
  resetSceneCollections();
  resetConservationDiagnostics();
  resetStackDiagnostics();
  resetTracerDiagnostics(true);
  resetSecondaryState();
  ensureGeometry();
  seedTracers();
}

export function loadPreset(id) {
  const preset = presets.find(item => item.id === id);
  if (!preset) return false;

  clearScene();
  walls.push(...preset.walls);
  inlets.push(...preset.inlets.map(port => ({
    ...cell(port.c, port.r),
    dx: port.dx,
    dy: port.dy,
    secondary: true
  })));
  fires.push(...preset.fires.map(fire => ({
    ...cell(fire.c, fire.r),
    primaryAirFactor: fire.primaryAirFactor
  })));
  chimneys.push(...preset.chimneys.map(([c, r]) => cell(c, r)));
  setGeometryDirty(true);
  ensureGeometry();
  seedTracers();
  return true;
}

function sealedGeometry() {
  const fire = {x: 432, y: 360};
  const sealedWalls = [];
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      if (dx === 0 && dy === 0) continue;
      sealedWalls.push({x: fire.x + dx * 24, y: fire.y + dy * 24});
    }
  }
  return {walls: sealedWalls, fire};
}

export function prepareScenario(scenario) {
  initializeRuntime();
  if (scenario !== 'sealed') {
    if (!loadPreset(scenario)) throw new Error(`preset failed to load: ${scenario}`);
  } else {
    const {walls: sealedWalls, fire} = sealedGeometry();
    clearScene();
    walls.push(...sealedWalls);
    fires.push(fire);
    setGeometryDirty(true);
    ensureGeometry();
    seedTracers();
  }
  setIgnited(true);
  setRunning(true);
}

export function createEngine() {
  initializeRuntime();
  return {
    dt: DT,
    physicsStep,
    loadPreset,
    prepareScenario,
    clearScene,
    ignite: () => {
      ensureGeometry();
      setIgnited(true);
      setRunning(true);
    },
    fields: globalThis.__oracleFields || null,
    scalars: globalThis.__oracleScalars || null,
    state: {
      walls,
      inlets,
      fires,
      chimneys,
      fans,
      get particles() { return particles; },
      get geometryDirty() { return geometryDirty; },
      get ignited() { return ignited; },
      get running() { return running; }
    },
    stack: getStackDiagnostics(),
    tracer: getTracerDiagnostics()
  };
}

export {
  ALL_FIELD_NAMES,
  DT,
  physicsStep,
  seedTracers,
  getSecondaryScalars,
  getConservationDiagnostics
};
