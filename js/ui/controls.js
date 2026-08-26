import {
  clearBtn,
  fanPressureSlider,
  igniteBtn,
  particleSlider,
  pauseBtn,
  fanPressureValueEl
} from '../core/dom.js';
import {resetFields} from '../core/fields.js';
import {
  ignited,
  particles,
  running,
  setRunning,
  targetParticleCount
} from '../core/state.js';
import {boundarySpawnForFlow, makeTracer, randomOpenPoint, trimOpenPopulation} from '../physics/tracer-recycle.js';

function updateFanPressureLabel() {
  if (fanPressureValueEl) {
    const pressure = fanPressureSlider ? Number(fanPressureSlider.value) || 0 : 2.0;
    fanPressureValueEl.textContent = pressure.toFixed(1) + ' Pa';
  }
}

function resizeParticlePopulation() {
  const target = targetParticleCount();
  if (particles.length > target) {
    trimOpenPopulation(target);
  } else {
    while (particles.length < target) {
      const point = ignited ? boundarySpawnForFlow() : randomOpenPoint();
      particles.push(makeTracer(point || randomOpenPoint()));
    }
  }
}

export function createControls({engine, metrics, onIgnite, onPause, onClear}) {
  const clearScene = () => {
    // The module engine owns secondary fields and diagnostics. Reset the base
    // fields here as part of the browser clear button's complete reset path.
    resetFields();
    engine.clearScene();
    metrics.resetMetrics({clearMessage: true});
    if (igniteBtn) igniteBtn.textContent = '🔥 點火';
    if (pauseBtn) pauseBtn.textContent = '暫停';
    onClear?.();
  };

  igniteBtn?.addEventListener('click', () => {
    engine.ignite();
    if (igniteBtn) igniteBtn.textContent = '🔥 已點火';
    if (pauseBtn) pauseBtn.textContent = '暫停';
    onIgnite?.();
  });

  pauseBtn?.addEventListener('click', () => {
    if (!engine.state.ignited) return;
    setRunning(!running);
    if (pauseBtn) pauseBtn.textContent = running ? '暫停' : '繼續';
    onPause?.();
  });

  clearBtn?.addEventListener('click', clearScene);
  particleSlider?.addEventListener('input', resizeParticlePopulation);
  fanPressureSlider?.addEventListener('input', updateFanPressureLabel);
  updateFanPressureLabel();

  return {clearScene, resizeParticlePopulation};
}
