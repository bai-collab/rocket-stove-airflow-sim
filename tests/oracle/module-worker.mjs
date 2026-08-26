import {parentPort, workerData} from 'node:worker_threads';
import crypto from 'node:crypto';

const SCENARIOS = ['straight', 'baffle', 'twin-channel', 'sealed'];
const CHECKPOINTS = [1, 30, 120, 300, 600];
const FIELD_NAMES = [
  'u', 'v', 'pressure', 'divergence', 'temperature', 'oxygen', 'smoke',
  'brickTemp', 'unburnedGas', 'exhaustGas', 'ash', 'ashBed', 'charResidue',
  'flyAsh', 'secondaryResidence'
];
const SCALAR_NAMES = [
  'ashGeneratedTotal', 'ashDepositedTotal', 'ashOutTotal', 'ashBurnedTotal',
  'charGeneratedTotal', 'charBurnedTotal', 'flyAshOutTotal',
  'flyAshLiftedTotal', 'flyAshDepositedTotal', 'secondaryIndex',
  'smokeOutIndex', 'pressureResidual', 'pressureEquationResidual',
  'projectedInFlow', 'projectedOutFlow'
];

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function capture(step, scenario) {
  const fields = {};
  for (const name of FIELD_NAMES) {
    const field = globalThis.__oracleFields[name];
    if (!field || !field.buffer) throw new Error(`module field is not a typed array: ${name}`);
    const bytes = Buffer.from(field.buffer, field.byteOffset, field.byteLength);
    fields[name] = {
      length: field.length,
      byteLength: bytes.length,
      sha256: sha256(bytes),
      bytesBase64: bytes.toString('base64')
    };
  }

  const scalars = {};
  for (const name of SCALAR_NAMES) {
    const value = globalThis.__oracleScalars[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`module scalar is not finite: ${name}=${value}`);
    }
    scalars[name] = value;
  }
  return {step, fields, scalars};
}

try {
  if (!SCENARIOS.includes(workerData.scenario)) throw new Error(`unknown scenario: ${workerData.scenario}`);

  Math.random = mulberry32(0x1234ABCD);
  globalThis.__oracleNowMs = 0;
  globalThis.__oracleCurrentStep = 0;
  globalThis.__oracleTargetStep = 0;
  globalThis.__oracleFields = Object.create(null);
  globalThis.__oracleScalars = Object.create(null);

  const {createEngine, DT} = await import('../../js/engine.js');
  const engine = createEngine();
  engine.prepareScenario(workerData.scenario);

  const snapshots = {};
  for (const checkpoint of CHECKPOINTS) {
    globalThis.__oracleTargetStep = checkpoint;
    while (globalThis.__oracleCurrentStep < globalThis.__oracleTargetStep) {
      globalThis.__oracleCurrentStep += 1;
      globalThis.__oracleNowMs = globalThis.__oracleCurrentStep * (1000 / 30);
      engine.physicsStep(DT);
    }
    snapshots[String(checkpoint)] = capture(checkpoint, workerData.scenario);
  }

  parentPort.postMessage({ok: true, snapshot: {
    schema: 1,
    scenario: workerData.scenario,
    hooks: true,
    dt: 1 / 30,
    steps: 600,
    checkpoints: CHECKPOINTS,
    fields: FIELD_NAMES,
    scalars: SCALAR_NAMES,
    snapshots
  }});
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {message: error.message, stack: error.stack}
  });
  process.exitCode = 1;
}
