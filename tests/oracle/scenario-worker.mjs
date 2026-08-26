import {parentPort, workerData} from 'node:worker_threads';
import {runLegacyScenario} from './legacy-harness.mjs';

try {
  const snapshot = runLegacyScenario(workerData.scenario, {
    hooks: workerData.hooks,
    execution: 'global'
  });
  parentPort.postMessage({ok: true, snapshot});
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {message: error.message, stack: error.stack}
  });
  process.exitCode = 1;
}
