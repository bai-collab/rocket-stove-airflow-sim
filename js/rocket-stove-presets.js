/* Three educational rocket-stove construction presets.
 *
 * The presets change only the editable geometry and marker arrays. They do
 * not fake a secondary-combustion result: the existing solver still decides
 * whether temperature, oxygen, mixing, and residence time are sufficient.
 */
(() => {
  const CELL = BUILD_CELL;
  const presetButtons = [...document.querySelectorAll('[data-stove-preset]')];
  const presetStatus = document.getElementById('presetStatus');

  function cell(c, r) {
    return {x: c * CELL, y: r * CELL};
  }

  function buildWalls(builder) {
    const cells = new Map();
    const add = (c, r) => {
      if (c < 0 || r < 0 || c * CELL >= canvas.width || r * CELL >= canvas.height) return;
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
      subtitle: '延長高溫混合與停留',
      description: '交錯折流板讓煙氣左右轉向，再進入上方混合室；兩側開口補入二次空氣。',
      observation: '預期混合與停留較長、二次燃燒較穩；灰分仍要靠灰床收集，折流口過窄會降低排煙速度。',
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
      name: '雙通道預熱爐',
      subtitle: '側壁預熱・上置混合室',
      description: '受限中央火箱把一次空氣集中在火源下方；左右通道先讓二次空氣貼著熱壁上升，再從兩個槽口進入中央高溫升火筒。',
      observation: '預期二次空氣溫度較高、黑煙與飛灰外逸較低；構造較複雜，需要保持槽口暢通。',
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

  function loadPreset(id) {
    const preset = presets.find(item => item.id === id);
    if (!preset) return false;

    // Reuse the normal clear path so scalar fields, tracers, fans, and the
    // ash ledger all start from the same known state.
    clearBtn.click();
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
    geometryDirty = true;
    ensureGeometry();
    seedTracers();

    const wallButton = tools.find(button => button.dataset.tool === 'wall');
    if (wallButton) wallButton.click();
    presetButtons.forEach(button => {
      button.classList.toggle('active', button.dataset.stovePreset === preset.id);
    });
    if (presetStatus) {
      presetStatus.innerHTML = `<strong>${preset.code} ${preset.name}</strong>：${preset.description} ${preset.observation} 按「點火」後觀察二次燃燒指標。`;
    }
    feedbackEl.textContent = `${preset.code} ${preset.name} 已載入：${preset.subtitle}。按「點火」開始觀察。`;
    draw();
    return true;
  }

  presetButtons.forEach(button => {
    button.addEventListener('click', () => loadPreset(button.dataset.stovePreset));
  });

  window.rocketStovePresets = {
    list: presets.map(({id, code, name, subtitle, description, observation}) => ({
      id, code, name, subtitle, description, observation
    })),
    load: loadPreset
  };
})();
