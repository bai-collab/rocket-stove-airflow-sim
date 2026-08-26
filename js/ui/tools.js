import {canvas, feedbackEl, tools} from '../core/dom.js';
import {BUILD_CELL, CANVAS_HEIGHT, CANVAS_WIDTH, snap} from '../core/grid.js';
import {
  chimneys,
  fans,
  fires,
  hasRect,
  inlets,
  setGeometryDirty,
  walls
} from '../core/state.js';

let selectedTool = 'wall';
let drawing = false;

function pointerPos(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height
  };
}

function arrowCell(fan, dirIndex = fan.dir) {
  const direction = [
    {x:1, y:0},
    {x:0, y:1},
    {x:-1, y:0},
    {x:0, y:-1}
  ][dirIndex] || {x:1, y:0};
  return {x: fan.x + direction.x * BUILD_CELL, y: fan.y + direction.y * BUILD_CELL};
}

function fanOccupiesCell(fan, x, y, dirIndex = fan.dir) {
  if (fan.x === x && fan.y === y) return true;
  const arrow = arrowCell(fan, dirIndex);
  return arrow.x === x && arrow.y === y;
}

function fanAtEitherCell(x, y) {
  return fans.find(fan => fanOccupiesCell(fan, x, y));
}

function cellInsideCanvas(x, y) {
  return x >= 0 && y >= 0 &&
    x + BUILD_CELL <= CANVAS_WIDTH && y + BUILD_CELL <= CANVAS_HEIGHT;
}

function isWallBuildCell(x, y) {
  return walls.some(wall => wall.x === x && wall.y === y);
}

function fanBodyPlacementValid(fan) {
  if (!cellInsideCanvas(fan.x, fan.y)) return false;
  if (isWallBuildCell(fan.x, fan.y)) return false;
  return !fans.some(other => other.x === fan.x && other.y === fan.y);
}

function setTransientFanMessage(message) {
  if (!feedbackEl) return;
  const prior = feedbackEl.textContent;
  feedbackEl.textContent = message;
  globalThis.setTimeout(() => {
    if (feedbackEl.textContent === message) feedbackEl.textContent = prior;
  }, 1200);
}

function placeAt(position) {
  const x = snap(position.x);
  const y = snap(position.y);

  if (selectedTool === 'wall') {
    if (!hasRect(walls, x, y)) {
      walls.push({x, y});
      setGeometryDirty(true);
    }
    return;
  }

  if (selectedTool === 'erase') {
    for (const arr of [walls, inlets, fires, chimneys]) {
      const index = arr.findIndex(item => item.x === x && item.y === y);
      if (index >= 0) {
        arr.splice(index, 1);
        if (arr === walls) setGeometryDirty(true);
      }
    }
    return;
  }

  const arr = {inlet: inlets, fire: fires, chimney: chimneys}[selectedTool];
  if (arr && !hasRect(arr, x, y)) arr.push({x, y});
}

function placeFanOrRotate(position) {
  const x = snap(position.x);
  const y = snap(position.y);
  if (selectedTool !== 'fan') return;

  const existing = fanAtEitherCell(x, y);
  if (existing) {
    // Rotation is intentionally unrestricted by the visual arrow footprint.
    existing.dir = (existing.dir + 1) % 4;
    return;
  }

  const candidate = {x, y, dir: 0};
  if (fanBodyPlacementValid(candidate)) {
    fans.push(candidate);
  } else {
    setTransientFanMessage('風扇本體不能放在磚牆、另一個風扇本體或畫布外。箭頭方向之後可自由旋轉。');
  }
}

export function createTools() {
  const selectTool = tool => {
    selectedTool = tool;
    for (const button of tools) {
      button.classList.toggle('active', button.dataset.tool === tool);
    }
  };

  for (const button of tools) {
    button.addEventListener('click', () => selectTool(button.dataset.tool));
  }

  canvas.addEventListener('pointerdown', event => {
    drawing = true;
    canvas.setPointerCapture?.(event.pointerId);
    placeAt(pointerPos(event));
  });
  canvas.addEventListener('pointerdown', event => {
    placeFanOrRotate(pointerPos(event));
    if (selectedTool === 'erase') {
      const position = pointerPos(event);
      const x = snap(position.x), y = snap(position.y);
      const index = fans.findIndex(fan => fanOccupiesCell(fan, x, y));
      if (index >= 0) fans.splice(index, 1);
    }
  });
  canvas.addEventListener('pointermove', event => {
    if (drawing && (selectedTool === 'wall' || selectedTool === 'erase')) {
      placeAt(pointerPos(event));
    }
  });
  canvas.addEventListener('pointerup', () => drawing = false);
  canvas.addEventListener('pointercancel', () => drawing = false);

  selectTool('wall');
  return {
    selectTool,
    get selectedTool() { return selectedTool; }
  };
}
