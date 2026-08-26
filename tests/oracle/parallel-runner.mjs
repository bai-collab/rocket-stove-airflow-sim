import {Worker} from 'node:worker_threads';

function runWorker(scenario, hooks) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./scenario-worker.mjs', import.meta.url), {
      workerData: {scenario, hooks}
    });
    let received = false;
    worker.on('message', message => {
      received = true;
      if (message.ok) resolve(message.snapshot);
      else reject(new Error(message.error?.stack || message.error?.message || 'oracle worker failed'));
    });
    worker.on('error', reject);
    worker.on('exit', code => {
      if (!received && code !== 0) reject(new Error(`oracle worker exited with code ${code}`));
    });
  });
}

export async function runScenariosParallel(scenarios, {hooks}) {
  const snapshots = await Promise.all(scenarios.map(scenario => runWorker(scenario, hooks)));
  return Object.fromEntries(snapshots.map(snapshot => [snapshot.scenario, snapshot]));
}
