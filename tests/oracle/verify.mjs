import path from 'node:path';
import {
  CHECKPOINTS,
  FIELD_NAMES,
  GOLDEN_DIR,
  ROOT,
  SCALAR_NAMES,
  SCENARIOS,
  readSnapshotSet,
} from './legacy-harness.mjs';
import {runScenariosParallel} from './parallel-runner.mjs';

function option(name, fallback) {
  const prefix = `${name}=`;
  const inline = process.argv.find(argument => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function resolveDirectory(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function bitsAt(bytes, index) {
  if (index < 0 || index * 4 + 4 > bytes.length) return 'n/a';
  return `0x${bytes.readUInt32LE(index * 4).toString(16).padStart(8, '0')}`;
}

function firstByteDifference(actualBytes, expectedBytes) {
  const cellCount = Math.ceil(Math.max(actualBytes.length, expectedBytes.length) / 4);
  for (let index = 0; index < cellCount; index++) {
    const actualStart = index * 4;
    const expectedStart = index * 4;
    const actual = actualBytes.subarray(actualStart, actualStart + 4);
    const expected = expectedBytes.subarray(expectedStart, expectedStart + 4);
    if (actual.length !== expected.length || !actual.equals(expected)) {
      return {
        index,
        actualBits: bitsAt(actualBytes, index),
        expectedBits: bitsAt(expectedBytes, index)
      };
    }
  }
  return null;
}

function compareScenario(actual, expected, scenario, label) {
  for (const step of CHECKPOINTS) {
    const key = String(step);
    const actualSnapshot = actual?.snapshots?.[key];
    const expectedSnapshot = expected?.snapshots?.[key];
    if (!actualSnapshot || !expectedSnapshot) {
      return {label, scenario, step, kind: 'checkpoint', message: 'missing checkpoint'};
    }

    for (const field of FIELD_NAMES) {
      const actualField = actualSnapshot.fields?.[field];
      const expectedField = expectedSnapshot.fields?.[field];
      if (!actualField || !expectedField) {
        return {label, scenario, step, field, kind: 'field', message: 'missing field'};
      }
      const actualBytes = Buffer.from(actualField.bytesBase64 || '', 'base64');
      const expectedBytes = Buffer.from(expectedField.bytesBase64 || '', 'base64');
      if (actualField.sha256 !== expectedField.sha256 || !actualBytes.equals(expectedBytes)) {
        const difference = firstByteDifference(actualBytes, expectedBytes);
        return {
          label,
          scenario,
          step,
          field,
          kind: 'field',
          index: difference?.index ?? 0,
          actualBits: difference?.actualBits || 'n/a',
          expectedBits: difference?.expectedBits || 'n/a',
          message: `sha256 actual=${actualField.sha256} expected=${expectedField.sha256}`
        };
      }
    }

    for (const scalar of SCALAR_NAMES) {
      const actualValue = actualSnapshot.scalars?.[scalar];
      const expectedValue = expectedSnapshot.scalars?.[scalar];
      if (!Object.is(actualValue, expectedValue)) {
        return {
          label,
          scenario,
          step,
          scalar,
          kind: 'scalar',
          actualValue,
          expectedValue,
          message: `scalar actual=${String(actualValue)} expected=${String(expectedValue)}`
        };
      }
    }
  }
  return null;
}

function compareSets(actualSet, expectedSet, label) {
  for (const scenario of SCENARIOS) {
    const mismatch = compareScenario(actualSet[scenario], expectedSet[scenario], scenario, label);
    if (mismatch) return mismatch;
  }
  return null;
}

function countChecks() {
  return SCENARIOS.length * CHECKPOINTS.length * (FIELD_NAMES.length + SCALAR_NAMES.length);
}

function describeMismatch(mismatch) {
  if (mismatch.kind === 'field') {
    return `${mismatch.label}: scenario=${mismatch.scenario} step=${mismatch.step} ` +
      `field=${mismatch.field} index=${mismatch.index} ` +
      `actualBits=${mismatch.actualBits} expectedBits=${mismatch.expectedBits} ${mismatch.message}`;
  }
  if (mismatch.kind === 'scalar') {
    return `${mismatch.label}: scenario=${mismatch.scenario} step=${mismatch.step} ` +
      `scalar=${mismatch.scalar} actual=${String(mismatch.actualValue)} ` +
      `expected=${String(mismatch.expectedValue)}`;
  }
  return `${mismatch.label}: scenario=${mismatch.scenario} step=${mismatch.step} ${mismatch.message}`;
}

const goldenDirectory = resolveDirectory(option('--golden-dir', GOLDEN_DIR));
const snapshotDirectoryValue = option('--snapshot-dir', '');
const snapshotDirectory = snapshotDirectoryValue ? resolveDirectory(snapshotDirectoryValue) : null;
const skipHooksCheck = process.argv.includes('--skip-hooks-check');

try {
  const expectedSet = readSnapshotSet(goldenDirectory);
  const actualSet = {};

  if (snapshotDirectory) {
    Object.assign(actualSet, readSnapshotSet(snapshotDirectory));
    console.log(`verify: comparing snapshot set ${snapshotDirectory}`);
  } else {
    console.log('verify: fresh legacy run with oracle hooks enabled');
    Object.assign(actualSet, await runScenariosParallel(SCENARIOS, {hooks: true}));
    for (const scenario of SCENARIOS) console.log(`  captured ${scenario}`);
  }

  const goldenMismatch = compareSets(actualSet, expectedSet, 'golden compare');
  if (goldenMismatch) throw new Error(describeMismatch(goldenMismatch));
  console.log(`GREEN golden self-check: ${countChecks()} field/counter checks`);

  if (!snapshotDirectory && !skipHooksCheck) {
    console.log('verify: fresh legacy run with N1a registration disabled');
    const noHookSet = await runScenariosParallel(SCENARIOS, {hooks: false});
    for (const scenario of SCENARIOS) console.log(`  captured ${scenario}`);
    const hookMismatch = compareSets(noHookSet, actualSet, 'hooks on/off compare');
    if (hookMismatch) throw new Error(describeMismatch(hookMismatch));
    console.log(`GREEN hooks on/off: ${countChecks()} field/counter checks`);
  }

  console.log('GREEN verify complete');
} catch (error) {
  console.error(`RED verify: ${error.stack || error}`);
  process.exitCode = 1;
}
