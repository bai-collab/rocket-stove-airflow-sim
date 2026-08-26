import {
  avgSpeedEl,
  feedbackEl,
  flowScoreEl,
  oxygenRateEl,
  stagnantRateEl
} from '../core/dom.js';
import {
  AMBIENT_O2,
  AMBIENT_T,
  BUILD_CELL,
  H,
  N,
  NX,
  NY,
  clamp,
  gridX,
  gridY,
  idx
} from '../core/grid.js';
import {
  ash,
  ashBed,
  charResidue,
  flyAsh,
  oxygen,
  smoke,
  solid,
  temperature,
  u,
  unburnedGas,
  v
} from '../core/fields.js';
import {
  fires,
  fireIntensity,
  fans,
  oxygenAroundFire
} from '../core/state.js';
import {plumeWeight} from '../physics/plume.js';
import {getConservationDiagnostics} from '../physics/conservation.js';
import {getContinuityBest} from '../physics/continuity.js';
import {getSecondaryScalars} from '../physics/secondary-combustion.js';
import {getStackDiagnostics} from '../physics/stack-flow.js';
import {getTracerDiagnostics} from '../physics/tracer-recycle.js';

const documentRef = globalThis.document;
const metricsPanel = documentRef?.querySelector?.('.panel.metrics') || null;
const primaryMetrics = documentRef?.getElementById?.('primaryMetrics') || null;
const advancedMetricsEl = documentRef?.getElementById?.('advancedMetrics') || null;
const metricElements = [];

function addCard(label, id, target, title = '') {
  if (!target) return null;
  const card = documentRef.createElement('div');
  card.className = 'metric-card';
  if (title) card.title = title;
  card.innerHTML = `<span>${label}</span><strong id="${id}">—</strong>`;
  target.appendChild(card);
  const element = card.querySelector(`#${id}`);
  metricElements.push(element);
  return element;
}

function addTemperatureLegend() {
  const card = documentRef?.querySelector?.('.simulation-card');
  const canvasEl = documentRef?.getElementById?.('simCanvas');
  if (!card || !canvasEl || documentRef.getElementById('temperatureLegend')) return;

  const legend = documentRef.createElement('div');
  legend.id = 'temperatureLegend';
  legend.setAttribute('aria-label', '背景溫度色階');
  legend.style.cssText = 'margin:10px 6px 2px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;color:#64748b;';
  const label = documentRef.createElement('strong');
  label.textContent = '背景溫度';
  label.style.cssText = 'font-size:13px;color:inherit;';
  const bar = documentRef.createElement('div');
  bar.style.cssText = 'width:min(360px,72vw);height:12px;border-radius:999px;border:1px solid rgba(100,116,139,.35);background:linear-gradient(90deg,rgba(254,240,138,.25) 0%,#fde047 14%,#fbbf24 25%,#f97316 38%,#ef4444 56%,#dc2626 70%,#991b1b 84%,#581c87 100%);';
  const scale = documentRef.createElement('span');
  scale.textContent = '20°  50°  70°  100°  150°  220°  350°C+';
  scale.style.cssText = 'white-space:pre;font-variant-numeric:tabular-nums;';
  legend.append(label, bar, scale);
  canvasEl.insertAdjacentElement('afterend', legend);
}

function addAshLegend() {
  const legend = documentRef?.querySelector?.('.legend');
  if (!legend || legend.querySelector('.ash-accounting')) return;
  const ashLegend = documentRef.createElement('span');
  ashLegend.className = 'ash-accounting';
  ashLegend.innerHTML = '<i class="dot ash"></i> 棕色點：礦物灰；深棕點：未燃碳／焦渣；淡棕點：高速氣流帶起的飛灰；深棕短線：已沉積礦物灰（仍計入剩餘）。';
  legend.appendChild(ashLegend);
}

function averageFireOxygen() {
  if (!fires.length) return 0;
  return fires.reduce((sum, fire) => sum + oxygenAroundFire(fire), 0) / fires.length;
}

function updateBaseMetrics() {
  let speedSum = 0, fluidCount = 0, stagnant = 0;
  for (let i = 0; i < N; i++) {
    if (solid[i]) continue;
    const speed = Math.hypot(u[i], v[i]);
    speedSum += speed;
    fluidCount++;
    if (speed < 2.0) stagnant++;
  }
  const avg = fluidCount ? speedSum / fluidCount : 0;
  const stagnantRate = fluidCount ? stagnant / fluidCount : 0;
  const o2 = averageFireOxygen();
  const burning = fires.some(fire => fireIntensity(fire) > 0);
  const score = Math.round(clamp(
    25 + Math.min(45, avg / 1.5) - stagnantRate * 25 + (burning ? 20 : 0),
    0,
    100
  ));

  if (flowScoreEl) flowScoreEl.textContent = score + ' / 100';
  if (avgSpeedEl) avgSpeedEl.textContent = avg.toFixed(1) + '（相對值）';
  if (stagnantRateEl) stagnantRateEl.textContent = Math.round(stagnantRate * 100) + '%';
  if (oxygenRateEl) oxygenRateEl.textContent = Math.round(o2 * 100) + '%';

  if (!feedbackEl) return;
  if (!fires.length) {
    feedbackEl.textContent = '目前沒有火源。';
  } else if (!burning) {
    feedbackEl.textContent = '燃燒區氧氣不足，火源已熄滅。封閉空間中的燃燒後氣體不會穿過磚牆。';
  } else {
    feedbackEl.textContent = 'Physics v2：火源先加熱溫度場，再由浮力與壓力場帶動空氣；磚牆會阻擋直火並透過導熱間接加熱另一側空氣。';
  }
}

function updateStackMetrics(stack, refs) {
  const strongest = stack.activeHeads.reduce(
    (best, head) => head.deltaP > best.deltaP ? head : best,
    {deltaP: 0, heightM: 0}
  );
  if (refs.stackPressure) refs.stackPressure.textContent = `${strongest.deltaP.toFixed(2)} Pa`;
  if (refs.stackHeight) refs.stackHeight.textContent = `${(strongest.heightM * 100).toFixed(0)} cm`;
  if (refs.stackFlux) refs.stackFlux.textContent = `${stack.boundaryInFlow.toFixed(1)} ／ ${stack.boundaryOutFlow.toFixed(1)} px²/s`;
}

function updateFanMetrics() {
  if (fans.length && feedbackEl) {
    const value = documentRef?.getElementById?.('fanPressure');
    const pressure = value ? Number(value.value) || 0 : 2.0;
    feedbackEl.textContent += ` 電風扇 ${fans.length} 個，設定壓升 ${pressure.toFixed(1)} Pa；箭頭可自由旋轉，磚牆仍會阻擋實際吸入與送風。`;
  }
}

function updateContinuityMetric(refs) {
  if (!refs.continuity) return;
  const best = getContinuityBest();
  if (!best) {
    refs.continuity.textContent = '未偵測到明顯縮口';
    return;
  }
  refs.continuity.textContent = `A₁/A₂ ${best.areaRatio.toFixed(2)}× · v₂/v₁ ${best.actualRatio.toFixed(2)}×`;
  refs.continuity.title = `質量守恆預期速度比約 ${best.expectedRatio.toFixed(2)}×；實際值同時受 Darcy 阻力、壓力場與熱密度變化影響。`;
}

function updateConservationMetrics(conservation, refs) {
  if (refs.pressure) refs.pressure.textContent = `${conservation.pressureResidual.toFixed(3)} s⁻¹`;
  if (refs.projectedFlux) refs.projectedFlux.textContent = `${conservation.projectedInFlow.toFixed(1)} ／ ${conservation.projectedOutFlow.toFixed(1)} px²/s`;
}

function visibleParticleCount(tracer) {
  return tracer.visibleParticleCount;
}

function updateTracerMetrics(stack, tracer, refs) {
  const openCount = stack.openComponents;
  const sealedCount = stack.sealedComponents;
  if (refs.particleStatus) {
    refs.particleStatus.textContent = `${visibleParticleCount(tracer)} / ${Math.max(80, Number(documentRef?.getElementById?.('particleCount')?.value) || 240)}｜實際 ${tracer.particleCount}｜重生 ${tracer.respawnCount}`;
  }
  if (refs.boundaryRate) refs.boundaryRate.textContent = tracer.boundarySourceRate.toFixed(1);
  if (refs.boundaryTopology) refs.boundaryTopology.textContent = `開放 ${openCount}｜密閉 ${sealedCount}`;
  if (refs.boundaryDensity) refs.boundaryDensity.textContent = tracer.boundaryParticleDensity.toFixed(3);
  if (refs.boundaryBand) {
    refs.boundaryBand.textContent = `${tracer.boundaryBandParticles} ／ ${Math.ceil(tracer.boundaryBandTargetCount)}｜視覺重分布 ${tracer.densityResampleCount}`;
    refs.boundaryBand.title = '邊界帶不足時只重分布示蹤粒子；不改變氧氣、黑煙、灰分或壓力場。';
  }
}

function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function averageScalar(field) {
  let sum = 0, count = 0;
  for (let i = 0; i < N; i++) {
    if (solid[i]) continue;
    sum += field[i];
    count++;
  }
  return count ? sum / count : 0;
}

function averageFieldNearFires(field, radius = 84) {
  if (!fires.length) return averageScalar(field);
  let sum = 0, count = 0;
  for (const fire of fires) {
    const fx = fire.x + BUILD_CELL / 2;
    const fy = fire.y + BUILD_CELL / 2;
    const gx0 = gridX(fx - radius), gx1 = gridX(fx + radius);
    const gy0 = gridY(fy - radius), gy1 = gridY(fy + radius);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = idx(gx, gy);
        if (solid[i]) continue;
        const px = (gx + 0.5) * H;
        const py = (gy + 0.5) * H;
        if (Math.hypot(px - fx, py - fy) > radius) continue;
        sum += field[i];
        count++;
      }
    }
  }
  return count ? sum / count : 0;
}

function averageUnburnedAfterPrimary() {
  if (!fires.length) return averageScalar(unburnedGas);
  let sum = 0;
  let weightSum = 0;
  const observationRadius = 240;
  const primaryExitRadius = 48 * 1.05;
  const observationSpan = observationRadius - primaryExitRadius;

  for (let gy = 0; gy < NY; gy++) {
    for (let gx = 0; gx < NX; gx++) {
      const i = idx(gx, gy);
      if (solid[i] || unburnedGas[i] <= 0.0005) continue;
      const px = (gx + 0.5) * H;
      const py = (gy + 0.5) * H;
      let bestWeight = 0;

      for (const fire of fires) {
        const fx = fire.x + BUILD_CELL / 2;
        const fy = fire.y + BUILD_CELL / 2;
        const dx = px - fx;
        const dy = py - fy;
        const distance = Math.hypot(dx, dy);
        if (distance < primaryExitRadius || distance > observationRadius) continue;

        const distanceFactor = 1 - smoothstep01((distance - primaryExitRadius) / observationSpan);
        const radialSpeed = (u[i] * dx + v[i] * dy) / Math.max(distance, H);
        const downstreamFactor = 0.45 + 0.55 * smoothstep01((radialSpeed - 1.5) / 26);
        const hotFactor = 0.55 + 0.45 * smoothstep01(
          (temperature[i] - (AMBIENT_T + 15)) / (170 - (AMBIENT_T + 15))
        );
        const plumeFactor = 0.55 + 0.45 * clamp(plumeWeight(fx, fy, px, py), 0, 1);
        bestWeight = Math.max(bestWeight, distanceFactor * downstreamFactor * hotFactor * plumeFactor);
      }

      if (bestWeight <= 0) continue;
      sum += unburnedGas[i] * bestWeight;
      weightSum += bestWeight;
    }
  }
  return weightSum > 1e-6 ? sum / weightSum : 0;
}

function averageAshNearFires() {
  if (!fires.length) {
    let sum = 0, count = 0;
    for (let i = 0; i < N; i++) {
      if (solid[i]) continue;
      sum += ash[i] + flyAsh[i] + ashBed[i];
      count++;
    }
    return count ? sum / count : 0;
  }
  let sum = 0, count = 0;
  const radius = 84;
  for (const fire of fires) {
    const fx = fire.x + BUILD_CELL / 2;
    const fy = fire.y + BUILD_CELL / 2;
    const gx0 = gridX(fx - radius), gx1 = gridX(fx + radius);
    const gy0 = gridY(fy - radius), gy1 = gridY(fy + radius);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = idx(gx, gy);
        if (solid[i]) continue;
        const px = (gx + 0.5) * H;
        const py = (gy + 0.5) * H;
        if (Math.hypot(px - fx, py - fy) > radius) continue;
        sum += ash[i] + flyAsh[i] + ashBed[i];
        count++;
      }
    }
  }
  return count ? sum / count : 0;
}

function ashMassRemaining() {
  let sum = 0;
  for (let i = 0; i < N; i++) {
    if (solid[i]) continue;
    sum += ash[i] + flyAsh[i] + ashBed[i];
  }
  return sum;
}

function charMassRemaining() {
  let sum = 0;
  for (let i = 0; i < N; i++) {
    if (solid[i]) continue;
    sum += charResidue[i];
  }
  return sum;
}

function formatAsh(value) {
  return value.toFixed(2);
}

function updateSecondaryMetrics(secondary, refs) {
  const localSmoke = averageFieldNearFires(smoke);
  const localAsh = averageAshNearFires();
  const localUnburned = averageUnburnedAfterPrimary();
  const localChar = averageFieldNearFires(charResidue);
  const localFlyAsh = averageFieldNearFires(flyAsh);
  if (refs.secondary) refs.secondary.textContent = Math.round(secondary.secondaryIndex) + ' / 100';
  if (refs.unburned) refs.unburned.textContent = clamp(localUnburned * 100, 0, 100).toFixed(1) + ' / 100';
  if (refs.smokeLevel) refs.smokeLevel.textContent = Math.round(clamp(localSmoke * 135, 0, 100)) + ' / 100';
  if (refs.smokeOut) refs.smokeOut.textContent = Math.round(secondary.smokeOutIndex) + ' / 100';
  if (refs.ash) refs.ash.textContent = Math.round(clamp(localAsh * 180, 0, 100)) + ' / 100';
  if (refs.mineralAshGenerated) refs.mineralAshGenerated.textContent = formatAsh(secondary.ashGeneratedTotal) + '（模型量）';
  if (refs.char) refs.char.textContent = clamp(localChar * 120, 0, 100).toFixed(1) + ' / 100';
  if (refs.flyAshSuspended) refs.flyAshSuspended.textContent = clamp(localFlyAsh * 180, 0, 100).toFixed(1) + ' / 100';
  if (refs.flyAsh) refs.flyAsh.textContent = formatAsh(secondary.flyAshOutTotal) + '（模型量）';

  if (refs.ashFate) {
    const ashCleared = secondary.ashClearedTotal ?? 0;
    const ashCorrection = secondary.ashNumericalCorrectionTotal ?? 0;
    const charOut = secondary.charOutTotal ?? 0;
    const charCleared = secondary.charClearedTotal ?? 0;
    const charCorrection = secondary.charNumericalCorrectionTotal ?? 0;
    refs.ashFate.textContent = `礦物灰：生成 ${formatAsh(secondary.ashGeneratedTotal)}｜剩餘 ${formatAsh(ashMassRemaining())}\n` +
      `沉積累計 ${formatAsh(secondary.ashDepositedTotal)}（仍計入剩餘）｜總排出 ${formatAsh(secondary.ashOutTotal)}｜清除 ${formatAsh(ashCleared)}\n` +
      `飛灰排出 ${formatAsh(secondary.flyAshOutTotal)}｜礦物灰燃燒 ${formatAsh(secondary.ashBurnedTotal)}（不可燃）\n` +
      `可燃焦渣：生成 ${formatAsh(secondary.charGeneratedTotal)}｜剩餘 ${formatAsh(charMassRemaining())}｜燃燒 ${formatAsh(secondary.charBurnedTotal)}｜排出 ${formatAsh(charOut)}｜清除 ${formatAsh(charCleared)}\n` +
      `數值修正：礦物灰 ${formatAsh(ashCorrection)}、焦渣 ${formatAsh(charCorrection)}`;
  }

  if (feedbackEl && fires.length && fires.some(fire => fireIntensity(fire) > 0)) {
    const o2 = averageFireOxygen();
    if (o2 < 0.35 && localSmoke > 0.08) {
      feedbackEl.textContent = '稻稈燃燒區氧氣不足，不完全燃燒增加，黑煙正在累積。嘗試讓新鮮空氣更容易流入火源附近。';
    } else if (secondary.secondaryIndex >= 35 && secondary.smokeOutIndex < 35) {
      feedbackEl.textContent = '新鮮空氣帶入氧氣，高溫燃氣混合後出現明顯二次燃燒；黑煙進一步減少。';
    } else if (localChar > 0.08) {
      feedbackEl.textContent = `一次燃燒留下可燃焦渣 ${formatAsh(charMassRemaining())}；高溫、氧氣與混合足夠時，二次燃燒會消耗它。`;
    } else if (localUnburned > 0.12) {
      feedbackEl.textContent = '稻稈釋放的可燃氣體仍有部分沒有燒完。可嘗試讓新鮮空氣進入高溫煙氣區。';
    } else if (secondary.flyAshOutTotal > 0.08) {
      feedbackEl.textContent = `高速熱煙氣已帶走細灰 ${formatAsh(secondary.flyAshOutTotal)}；抽氣過強可能增加飛灰外逸。`;
    } else if (localAsh > 0.08 || secondary.ashGeneratedTotal > 0.02) {
      feedbackEl.textContent = `礦物灰帳本：生成 ${formatAsh(secondary.ashGeneratedTotal)}、剩餘 ${formatAsh(ashMassRemaining())}；沉積仍算在剩餘中。飛灰排出 ${formatAsh(secondary.flyAshOutTotal)}，礦物灰不會被燃燒消除。`;
    } else {
      feedbackEl.textContent = '藍色點只示蹤新鮮空氣流向；真正控制助燃的是同一股氣流攜帶的氧氣。觀察進氣是否讓黑煙濃度下降。';
    }
  }
}

export function createMetrics() {
  const refs = {};
  const defaultTarget = advancedMetricsEl || metricsPanel;

  refs.stackPressure = addCard('煙囪壓差（表壓）', 'stackPressureValue', defaultTarget);
  refs.stackHeight = addCard('有效熱柱高度', 'stackHeightValue', defaultTarget);
  refs.stackFlux = addCard('邊界通量（進／出）', 'stackFluxValue', defaultTarget);
  refs.continuity = addCard('縮口連續方程式', 'continuityValue', defaultTarget);
  refs.pressure = addCard('壓力投影殘差', 'pressureResidualValue', defaultTarget);
  refs.projectedFlux = addCard('實際邊界通量（進／出）', 'projectedFluxValue', defaultTarget);
  refs.particleStatus = addCard('空氣示蹤粒子（可見／開放基準）', 'particleStatus', defaultTarget);
  refs.boundaryRate = addCard('開放邊界空氣交換（示蹤等效粒／秒）', 'boundaryAirRate', defaultTarget);
  refs.boundaryTopology = addCard('空氣連通區', 'boundaryTopology', defaultTarget);
  refs.boundaryDensity = addCard('開放區示蹤密度（顆／格）', 'boundaryDensity', defaultTarget);
  refs.boundaryBand = addCard('邊界帶粒子（目前／目標）', 'boundaryBandStatus', defaultTarget);

  addTemperatureLegend();

  const primaryTarget = primaryMetrics || defaultTarget;
  refs.secondary = addCard('二次燃燒強度', 'secondaryBurnRate', primaryTarget, '只計算火源外側下游的高溫、含氧、混合與停留區再次反應量。');
  refs.unburned = addCard('一次燃燒後未燃氣體（局部）', 'unburnedGasRate', primaryTarget, '只觀察一次火焰區外側下游仍存在的可燃揮發氣體；它不是黑煙，也不是熱空氣。');
  refs.smokeLevel = addCard('相對黑煙濃度', 'smokeLevelRate', primaryTarget);
  refs.smokeOut = addCard('相對黑煙排出', 'smokeOutRate', primaryTarget);
  refs.ash = addCard('稻稈礦物灰分（剩餘）', 'ashRate', primaryTarget, '稻稈中不可燃的礦物灰分；抽氣不會把它燒掉，只會改變沉積與飛灰排出。');
  refs.mineralAshGenerated = addCard('礦物灰分生成', 'mineralAshGeneratedRate', defaultTarget, '由稻稈燃料灰分比例產生的不可燃礦物量，不因二次燃燒消失。');
  refs.char = addCard('未燃碳／焦渣（剩餘）', 'charResidueRate', defaultTarget, '一次燃燒留下的可燃固體；氧氣、溫度、混合與停留時間足夠時會下降。');
  refs.flyAshSuspended = addCard('飛灰（懸浮）', 'flyAshSuspendedRate', defaultTarget, '礦物細灰被熱氣流帶起後仍在流場中的相對量；沉降或排出後會下降。');
  refs.flyAsh = addCard('飛灰排出', 'flyAshOutRate', defaultTarget, '高速煙氣帶走的細灰累計量；適中抽氣可維持燃燒，抽氣過強可能增加外逸。');
  refs.ashFate = addCard('灰分去向（相對量）', 'ashFate', defaultTarget);
  if (refs.ashFate) {
    refs.ashFate.style.display = 'block';
    refs.ashFate.style.whiteSpace = 'pre-line';
    refs.ashFate.style.fontSize = '.76rem';
    refs.ashFate.style.lineHeight = '1.45';
  }
  addAshLegend();

  const stack = getStackDiagnostics();
  const conservation = getConservationDiagnostics();
  const tracer = getTracerDiagnostics();
  const secondary = getSecondaryScalars();

  function updateMetrics() {
    updateBaseMetrics();
    updateStackMetrics(stack, refs);
    updateFanMetrics();
    updateContinuityMetric(refs);
    updateConservationMetrics(conservation, refs);
    updateTracerMetrics(stack, tracer, refs);
    updateSecondaryMetrics(secondary, refs);
  }

  function resetMetrics({clearMessage = false} = {}) {
    if (flowScoreEl) flowScoreEl.textContent = '—';
    if (avgSpeedEl) avgSpeedEl.textContent = '—';
    if (stagnantRateEl) stagnantRateEl.textContent = '—';
    if (oxygenRateEl) oxygenRateEl.textContent = '—';
    for (const element of metricElements) if (element) element.textContent = '—';
    if (clearMessage && refs.ashFate) refs.ashFate.textContent = '使用者按「全部清除」：灰分帳本已歸零';
    if (clearMessage && feedbackEl) feedbackEl.textContent = 'Physics v2 已重置。先建立爐體，再按「點火」。';
  }

  return {updateMetrics, resetMetrics, refs};
}
