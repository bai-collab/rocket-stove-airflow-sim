import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const index = read('index.html');
const app = read('js/app-v2.js');
const secondary = read('js/physics-v2-secondary-combustion.js');
const tracer = read('js/physics-v2-tracer-recycle.js');
const fan = read('js/physics-v2-fan-duct.js');
const stack = read('js/physics-v2-stack-flow.js');
const conservation = read('js/physics-v2-conservation.js');
const closedScalar = read('js/physics-v2-closed-scalar.js');
const continuity = read('js/physics-v2-continuity.js');

const javascriptFiles = fs.readdirSync(path.join(root, 'js'))
  .filter(name => name.endsWith('.js'))
  .map(name => path.join(root, 'js', name));

for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
  assert.equal(result.status, 0, `JavaScript syntax error: ${file}\n${result.stderr}`);
}

assert.match(index, /class="dot ash"/);
assert.match(index, /id="ashRate"|稻稈灰分/);
assert.match(index, /style\.css\?v=20260826-4/);
assert.match(index, /app-v2\.js\?v=20260826-4/);
assert.match(index, /physics-v2-tracer-recycle\.js\?v=20260826-5/);
assert.match(index, /physics-v2-secondary-combustion\.js\?v=20260826-5/);
assert.match(index, /physics-v2-conservation\.js\?v=20260826-3/);
assert.match(index, /rocket-stove-presets\.js\?v=20260826-2/);
assert.match(index, /快速載入三種爐型/);
assert.match(index, /示蹤粒子數（開放區基準）/);
assert.match(index, /id="primaryMetrics"/);
assert.match(index, /id="advancedDiagnostics"/);
assert.match(index, /<summary>進階診斷資訊<\/summary>/);
assert.match(index, /id="advancedMetrics"/);
const metricsMarkup = index.slice(index.indexOf('<aside class="panel metrics">'), index.indexOf('</aside>', index.indexOf('<aside class="panel metrics">')));
assert.ok(metricsMarkup.indexOf('id="primaryMetrics"') < metricsMarkup.indexOf('id="advancedDiagnostics"'),
  'primary metrics must precede advanced diagnostics');
assert.ok(metricsMarkup.indexOf('id="stagnantRate"') > metricsMarkup.indexOf('id="advancedMetrics"'),
  'secondary diagnostics must be inside the advanced metrics container');
const simulationMarkup = index.slice(index.indexOf('<section class="simulation-card">'), index.indexOf('<aside class="panel metrics">'));
const toolsMarkup = index.slice(index.indexOf('<aside class="panel tools">'), index.indexOf('<section class="simulation-card">'));
assert.match(simulationMarkup, /class="preset-panel"/);
assert.doesNotMatch(toolsMarkup, /class="preset-panel"/);
const presets = read('js/rocket-stove-presets.js');
for (const token of ["id: 'straight'", "id: 'baffle'", "id: 'twin-channel'", 'secondary: true', 'primaryAirFactor']) {
  assert.match(presets, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `preset guard missing: ${token}`);
}

for (const token of [
  'const ash = new Float32Array(N)',
  'const ashBed = new Float32Array(N)',
  'const charResidue = new Float32Array(N)',
  'const flyAsh = new Float32Array(N)',
  'PRIMARY_CHAR_BURN_RATE',
  'SECONDARY_CHAR_REACTIVITY',
  'const secondaryResidence = new Float32Array(N)',
  'function updateSecondaryResidence',
  'function secondaryZoneFactor',
  'SECONDARY_START_DISTANCE',
  'SECONDARY_AWAY_SPEED_SCALE',
  'function averageUnburnedAfterPrimary',
  'UNBURNED_OBSERVATION_RADIUS',
  'UNBURNED_PRIMARY_EXIT_RADIUS',
  'UNBURNED_ACTIVE_FLOOR',
  'function settleAsh',
  'function updateFlyAshEntrainment',
  'FLY_ASH_LIFT_THRESHOLD',
  'ashGeneratedTotal',
  'ashDepositedTotal',
  'ashOutTotal',
  'ashBurnedTotal',
  'charGeneratedTotal',
  'charBurnedTotal',
  'flyAshOutTotal',
  'flyAshLiftedTotal',
  'flyAshDepositedTotal',
  'function recordCharBoundaryLoss',
  'sampleAshAt(x, y)',
  'sampleCharAt(x, y)',
  'sampleFlyAshAt(x, y)',
  'advectField(ash, ashPrev, u, v, dt, 0)',
  'function applySecondaryAirPorts',
  'SECONDARY_PORT_EXCHANGE',
]) {
  assert.match(secondary, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `secondary combustion guard missing: ${token}`);
}

for (const token of [
  'function sampleVelocitySafe',
  'function moveTracer',
  'visibleParticleCount',
  '空氣示蹤',
  'lineClear(',
  'PARTICLE_SOURCE_TAU',
  'function buildFluidComponents',
  'touchesBoundary',
  'sourceAccumulator',
  'component.targetCount',
  'boundaryInjectedCount',
  'trimOpenPopulation',
  'targetDensity',
  'boundaryFluxIn',
  'densityResampleCount',
  'boundaryBandTargetCount',
  'rebalanceBoundaryBand',
]) {
  assert.match(tracer, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `tracer wall-safety guard missing: ${token}`);
}

assert.match(app, /window\.tracerV25\?\.trimOpenPopulation/);

assert.match(fan, /const FAN_REFERENCE_PRESSURE = 5/);
assert.match(fan, /return clamp\(ms\/Math\.max/);

for (const token of [
  'STACK_PRESSURE_ITERS = 80',
  'faceCount',
  'touchesBoundary',
  'updateBoundaryFlux',
  'boundaryInFlow',
  'window.stackFlowV26',
]) {
  assert.match(stack, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `stack conservation guard missing: ${token}`);
}

for (const token of [
  'PROJECTION_ITERS = 48',
  'computePressureEquationResidual',
  'computeVelocityDivergenceResidual',
  'boundaryUAt',
  'boundaryVAt',
  'balanceOpenBoundaryFlux',
  'pressureEquationResidual',
  'window.conservationV26',
]) {
  assert.match(conservation, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `pressure projection guard missing: ${token}`);
}

for (const token of [
  'function sampleFluidField',
  'lineClear(px, py',
  'dst[i] = sampleFluidField',
]) {
  assert.match(closedScalar, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `sealed scalar wall guard missing: ${token}`);
}

for (const token of [
  "document.getElementById('primaryMetrics')",
  "document.getElementById('advancedMetrics')",
  "'二次燃燒強度'",
  "'一次燃燒後未燃氣體（局部）'",
  "'稻稈礦物灰分（剩餘）'",
  "'礦物灰分生成'",
  "'未燃碳／焦渣（剩餘）'",
  "'飛灰（懸浮）'",
  "'飛灰排出'",
  "ashFateEl = makeCard('灰分去向（相對量）', 'ashFate')",
]) {
  assert.match(secondary, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `metrics hierarchy guard missing: ${token}`);
}

for (const source of [continuity, stack, conservation, tracer]) {
  assert.match(source, /document\.getElementById\('advancedMetrics'\)/,
    'non-student diagnostics must target the advanced metrics container');
}

console.log(`Static regression passed: ${javascriptFiles.length} JavaScript files checked.`);
