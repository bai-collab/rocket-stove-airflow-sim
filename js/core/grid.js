import {canvas} from './dom.js';

export const CANVAS_WIDTH = canvas.width;
export const CANVAS_HEIGHT = canvas.height;

export const BUILD_CELL = 24;
export const H = 12;
export const NX = Math.ceil(CANVAS_WIDTH / H);
export const NY = Math.ceil(CANVAS_HEIGHT / H);
export const N = NX * NY;
export const DT = 1 / 30;
export const PRESSURE_ITERS = 22;
export const AMBIENT_T = 20;
export const AMBIENT_O2 = 1.0;
export const MAX_T = 700;
export const MAX_SPEED = 180;

export const G = 9.81;
export const BETA = 1 / 293.15;
export const PIXELS_PER_METER = 40;
export const BUOYANCY_DT_CAP = 140;

export const FIRE_AIR_RADIUS = 105;
export const FIRE_REACTION_RADIUS = 62;
export const FIRE_BRICK_RADIUS = 115;
export const FIRE_AIR_HEAT_RATE = 230;
export const FIRE_BRICK_HEAT_RATE = 150;
export const O2_CONSUMPTION_RATE = 0.10;
export const SMOKE_PRODUCTION_RATE = 0.16;
export const BRICK_CONDUCTION_RATE = 1.8;
export const BRICK_AIR_CONVECTION = 0.70;
export const AIR_COOLING_RATE = 0.035;
export const SMOKE_DECAY_OPEN = 0.025;

export const MAX_PARTICLES = 240;

let solidField = null;

export function bindSolidField(field) {
  solidField = field;
}

export function idx(x, y) {
  return y * NX + x;
}

export function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

export function gridX(px) {
  return clamp(Math.floor(px / H), 0, NX - 1);
}

export function gridY(py) {
  return clamp(Math.floor(py / H), 0, NY - 1);
}

export function inCanvas(x, y) {
  return x >= 0 && y >= 0 && x < CANVAS_WIDTH && y < CANVAS_HEIGHT;
}

export function isSolidPoint(x, y) {
  if (!inCanvas(x, y)) return false;
  return solidField ? solidField[idx(gridX(x), gridY(y))] === 1 : false;
}

export function snap(value) {
  return Math.floor(value / BUILD_CELL) * BUILD_CELL;
}
