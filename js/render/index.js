import {canvas, ctx} from '../core/dom.js';
import {drawGrid} from './grid.js';
import {drawTemperatureField} from './temperature.js';
import {drawBrickWalls, drawCells, drawFires} from './markers.js';
import {drawTracers} from './tracers.js';
import {drawFans} from './fans.js';
import {chimneys, inlets} from '../core/state.js';

export function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  drawTemperatureField();
  drawBrickWalls();
  drawCells(inlets, '#2563eb', '↔');
  drawFires();
  drawCells(chimneys, '#7c3aed', '↑');
  drawTracers();
  drawFans();
}

export {
  drawGrid,
  drawTemperatureField,
  drawBrickWalls,
  drawFires,
  drawCells,
  drawTracers,
  drawFans
};
