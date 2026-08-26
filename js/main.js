import {createEngine, DT} from './engine.js';
import {ensureGeometry} from './core/state.js';
import {draw} from './render/index.js';
import {
  createControls,
  createMetrics,
  createPresets,
  createTools
} from './ui/index.js';

const engine = createEngine();
const metrics = createMetrics();
const tools = createTools();

let accumulator = 0;
let lastFrame = performance.now();

const controls = createControls({
  engine,
  metrics,
  onIgnite: () => {
    accumulator = 0;
    lastFrame = performance.now();
  },
  onPause: () => {
    lastFrame = performance.now();
  },
  onClear: () => {
    accumulator = 0;
  }
});

createPresets({
  clearScene: controls.clearScene,
  selectTool: tools.selectTool,
  draw
});

function frame(now) {
  const elapsed = Math.min(0.08, (now - lastFrame) / 1000);
  lastFrame = now;

  if (engine.state.running && engine.state.ignited) {
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= DT && steps < 3) {
      engine.physicsStep(DT);
      accumulator -= DT;
      steps++;
    }
    metrics.updateMetrics();
  }

  if (engine.state.geometryDirty) ensureGeometry();
  draw();
  requestAnimationFrame(frame);
}

if (engine.state.geometryDirty) ensureGeometry();
draw();
requestAnimationFrame(frame);

export {engine, frame};
