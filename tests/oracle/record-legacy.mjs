import path from 'node:path';
import {
  GOLDEN_DIR,
  ROOT,
  SCENARIOS,
  writeSnapshot
} from './legacy-harness.mjs';
import {runScenariosParallel} from './parallel-runner.mjs';

function option(name, fallback) {
  const prefix = `${name}=`;
  const inline = process.argv.find(argument => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const requestedOutput = option('--out-dir', GOLDEN_DIR);
const outputDirectory = path.isAbsolute(requestedOutput)
  ? requestedOutput
  : path.resolve(ROOT, requestedOutput);

try {
  console.log(`record-legacy: output=${outputDirectory}`);
  const snapshots = await runScenariosParallel(SCENARIOS, {hooks: true});
  for (const scenario of SCENARIOS) {
    const snapshot = snapshots[scenario];
    const result = writeSnapshot(snapshot, outputDirectory);
    console.log(`GREEN ${scenario} ${result.digest} ${result.file}`);
  }
} catch (error) {
  console.error(`RED record-legacy: ${error.stack || error}`);
  process.exitCode = 1;
}
