import {feedbackEl, presetStatus} from '../core/dom.js';
import {BUILD_CELL, CANVAS_HEIGHT, CANVAS_WIDTH} from '../core/grid.js';
import {resetFields} from '../core/fields.js';
import {
  chimneys,
  fires,
  inlets,
  setGeometryDirty,
  walls,
  ensureGeometry
} from '../core/state.js';
import {seedTracers} from '../physics/tracer-recycle.js';

const documentRef = globalThis.document;
const presetButtons = documentRef?.querySelectorAll?.('[data-stove-preset]')
  ? [...documentRef.querySelectorAll('[data-stove-preset]')]
  : [];

function cell(c, r) {
  return {x: c * BUILD_CELL, y: r * BUILD_CELL};
}

function buildWalls(builder) {
  const cells = new Map();
  const add = (c, r) => {
    if (c < 0 || r < 0 || c * BUILD_CELL >= CANVAS_WIDTH || r * BUILD_CELL >= CANVAS_HEIGHT) return;
    cells.set(`${c},${r}`, [c, r]);
  };
  const vertical = (c, from, to, gaps = []) => {
    for (let r = from; r <= to; r++) if (!gaps.includes(r)) add(c, r);
  };
  const horizontal = (r, from, to, gaps = []) => {
    for (let c = from; c <= to; c++) if (!gaps.includes(c)) add(c, r);
  };
  builder({add, vertical, horizontal});
  return [...cells.values()].map(([c, r]) => cell(c, r));
}

const presets = [
  {
    id: 'straight',
    code: 'A',
    name: '垂直升火筒',
    subtitle: '雙側二次空氣槽',
    description: '受限火箱把一次空氣集中在火源下方；直立窄升火筒讓熱煙快速上升，左右空氣槽在高溫柱兩側補入二次空氣。',
    observation: '預期二次燃燒較快出現；黑煙下降，灰分主要在火源下方灰床沉積。',
    walls: buildWalls(({vertical, horizontal}) => {
      vertical(12, 14, 21, [14]);
      vertical(24, 14, 21, [14]);
      horizontal(21, 12, 24);
      horizontal(18, 17, 19, [18]);
      vertical(17, 18, 20);
      vertical(19, 18, 20);
      vertical(16, 9, 16, [12, 14]);
      vertical(20, 9, 16, [12, 14]);
      vertical(14, 3, 9);
      vertical(22, 3, 9);
      horizontal(9, 14, 22, [17, 18, 19]);
    }),
    inlets: [{c: 13, r: 14, dx: 1, dy: 0}, {c: 23, r: 14, dx: -1, dy: 0}],
    fires: [{c: 18, r: 20, primaryAirFactor: 0.46}],
    chimneys: [[18, 3]]
  },
  {
    id: 'baffle',
    code: 'B',
    name: 'Z 型折流爐',
    subtitle: '擾流增加混合與停留時間',
    description: '折流牆讓熱煙改變方向並增加停留時間；高溫燃氣在轉折處與二次空氣混合，適合觀察幾何如何改變流動。',
    observation: '預期折流處的混合與停留時間增加；但若進氣受阻，火源仍可能因氧氣不足而變弱。',
    walls: buildWalls(({vertical, horizontal}) => {
      vertical(11, 14, 21, [14]);
      vertical(25, 3, 21, [14]);
      horizontal(21, 11, 25, [15]);
      horizontal(17, 11, 24, [23, 24]);
      horizontal(13, 12, 24, [12, 13]);
      horizontal(9, 12, 22, [21, 22]);
      vertical(21, 3, 8);
    }),
    inlets: [{c: 12, r: 14, dx: 1, dy: 0}, {c: 24, r: 14, dx: -1, dy: 0}],
    fires: [{c: 15, r: 19}],
    chimneys: [[23, 4]]
  },
  {
    id: 'twin-channel',
    code: 'C',
    name: '雙通道分流爐',
    subtitle: '雙通道與多點二次空氣',
    description: '雙通道把氣流分成兩股並在上方匯合；多點二次空氣讓高溫煙氣有更多混合機會，適合比較分流與匯流。',
    observation: '預期兩條通道的流速與溫度不同；轉折、匯流與多個進氣口會共同影響二次燃燒。',
    walls: buildWalls(({vertical, horizontal}) => {
      vertical(10, 14, 21, [14]);
      vertical(26, 14, 21, [14]);
      horizontal(21, 10, 26);
      horizontal(17, 10, 26, [16, 17, 18, 19, 20]);
      horizontal(18, 17, 19, [18]);
      vertical(17, 18, 20);
      vertical(19, 18, 20);
      vertical(14, 8, 16, [12, 15]);
      vertical(22, 8, 16, [12, 15]);
      vertical(17, 8, 16, [12, 15]);
      vertical(19, 8, 16, [12, 15]);
      horizontal(11, 14, 22, [16, 17, 18, 19, 20]);
      horizontal(8, 14, 22, [16, 17, 18, 19, 20]);
      vertical(14, 3, 8);
      vertical(22, 3, 8);
    }),
    inlets: [
      {c: 11, r: 12, dx: 1, dy: 0},
      {c: 25, r: 15, dx: -1, dy: 0},
      {c: 15, r: 12, dx: 1, dy: 0},
      {c: 21, r: 15, dx: -1, dy: 0}
    ],
    fires: [{c: 18, r: 20, primaryAirFactor: 0.42}],
    chimneys: [[18, 3]]
  }
];

export function createPresets({clearScene, selectTool, draw}) {
  function loadPreset(id) {
    const preset = presets.find(item => item.id === id);
    if (!preset) return false;

    clearScene();
    walls.push(...preset.walls);
    inlets.push(...preset.inlets.map(port => ({
      ...cell(port.c, port.r),
      dx: port.dx,
      dy: port.dy,
      secondary: true
    })));
    fires.push(...preset.fires.map(fire => ({
      ...cell(fire.c, fire.r),
      primaryAirFactor: fire.primaryAirFactor
    })));
    chimneys.push(...preset.chimneys.map(([c, r]) => cell(c, r)));
    setGeometryDirty(true);
    ensureGeometry();
    seedTracers();

    selectTool('wall');
    for (const button of presetButtons) {
      button.classList.toggle('active', button.dataset.stovePreset === preset.id);
    }
    if (presetStatus) {
      presetStatus.innerHTML = `<strong>${preset.code} ${preset.name}</strong>：${preset.description} ${preset.observation} 按「點火」後觀察二次燃燒指標。`;
    }
    if (feedbackEl) feedbackEl.textContent = `${preset.code} ${preset.name} 已載入：${preset.subtitle}。按「點火」開始觀察。`;
    draw();
    return true;
  }

  for (const button of presetButtons) {
    button.addEventListener('click', () => loadPreset(button.dataset.stovePreset));
  }

  globalThis.rocketStovePresets = {
    list: presets.map(({id, code, name, subtitle, description, observation}) => ({
      id, code, name, subtitle, description, observation
    })),
    load: loadPreset
  };

  return {loadPreset, presets};
}
