import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsRoot = path.join(root, 'js');

const LEGACY_JS_FILES = [
  'js/app.js',
  'js/air-reservoir-patch.js',
  'js/app-v2.js',
  'js/rocket-stove-presets.js',
  'js/physics-v2-plume-fix.js',
  'js/physics-v2-stack-flow.js',
  'js/physics-v2-fan-duct.js',
  'js/physics-v2-continuity.js',
  'js/physics-v2-conservation.js',
  'js/physics-v2-temperature-heatmap.js',
  'js/physics-v2-tracer-recycle.js',
  'js/physics-v2-secondary-combustion.js',
  'js/physics-v2-closed-scalar.js'
];

const REQUIRED_FIELD_EXPORTS = [
  'u', 'v', 'uPrev', 'vPrev', 'pressure', 'pressureNext', 'divergence',
  'temperature', 'temperaturePrev', 'oxygen', 'oxygenPrev', 'smoke',
  'smokePrev', 'brickTemp', 'brickTempNext', 'solid', 'unburnedGas',
  'unburnedPrev', 'exhaustGas', 'exhaustPrev', 'ash', 'ashPrev',
  'ashTransfer', 'ashBed', 'charResidue', 'charResiduePrev', 'flyAsh',
  'flyAshPrev', 'flyAshTransfer', 'secondaryResidence',
  'secondaryResidencePrev'
];

const MONKEY_PATCH_NAMES = [
  'physicsStep', 'projectVelocity', 'coolAndMix', 'copyFluidBoundaries',
  'advectField', 'applyFireAndRadiation', 'updateTracers', 'drawTracers',
  'drawTemperatureField', 'updateMetrics', 'addBuoyancy', 'seedTracers',
  'draw', 'resetFields', 'applySecondaryAirPorts',
  'updateSecondaryResidence', 'applySecondaryCombustion',
  'updateFlyAshEntrainment', 'settleAsh', 'recordAshBoundaryLoss',
  'recordCharBoundaryLoss', 'updateSmokeOutflowMetric'
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function collectJavaScriptFiles(directory) {
  const files = [];
  const entries = fs.readdirSync(directory, {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectJavaScriptFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(file);
  }
  return files;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const index = read('index.html');
const scriptTags = [...index.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)]
  .map(match => match[0]);
assert.equal(scriptTags.length, 1,
  `index.html must contain exactly one script tag; found ${scriptTags.length}`);
assert.equal(
  scriptTags[0].replace(/\s+/g, ' ').trim(),
  '<script type="module" src="js/main.js"></script>',
  'index.html must use the single js/main.js module entry'
);
assert.doesNotMatch(index,
  /<script\b(?![^>]*\btype\s*=\s*["']module["'])[^>]*>/i,
  'index.html contains a classic script tag'
);

const javascriptFiles = collectJavaScriptFiles(jsRoot);
for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0,
    `JavaScript syntax error: ${path.relative(root, file)}\n${result.stderr || result.stdout || result.error}`);
}

const bareMonkeyPatch = new RegExp(
  `(?:^|[\\n;{}])[\\t ]*(?:${MONKEY_PATCH_NAMES.map(escapeRegExp).join('|')})[\\t ]*=`,
  'm'
);
const functionAssignment = /^\s*[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(?:async\s+)?function\b/m;
for (const file of javascriptFiles) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, bareMonkeyPatch,
    `global monkey-patch-style reassignment found: ${path.relative(root, file)}`);
  assert.doesNotMatch(source, functionAssignment,
    `bare function assignment found: ${path.relative(root, file)}`);
  assert.doesNotMatch(source, /capturedUnburnedGas/,
    `obsolete capturedUnburnedGas reference found: ${path.relative(root, file)}`);
}

for (const relativePath of LEGACY_JS_FILES) {
  assert.equal(fs.existsSync(path.join(root, relativePath)), false,
    `legacy file still exists: ${relativePath}`);
}
assert.equal(fs.existsSync(path.join(root, 'index.module.html')), false,
  'redundant index.module.html still exists');

const fields = read('js/core/fields.js');
for (const name of REQUIRED_FIELD_EXPORTS) {
  assert.match(fields,
    new RegExp(`\\bexport\\s+const\\s+${escapeRegExp(name)}\\s*=\\s*new\\s+(?:Float32Array|Uint8Array)\\(N\\)`),
    `simulation field is not exported from core/fields.js: ${name}`
  );
}

const packageJson = JSON.parse(read('package.json'));
assert.deepEqual(packageJson, {private: true, type: 'module'},
  'package.json must remain private, type=module, and dependency-free');

console.log(`GREEN static regression: ${javascriptFiles.length} recursive JavaScript files checked; module-only contracts verified.`);
