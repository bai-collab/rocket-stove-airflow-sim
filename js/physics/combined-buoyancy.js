import {addBuoyancyBase} from './solver-base.js';
import {applyStackBuoyancy} from './stack-flow.js';
import {applyFanLayer} from './fan-duct.js';
import {applyContinuity} from './continuity.js';

// This is the resolved wrapper chain from the legacy load order:
// app base -> stack correction -> fan/duct -> continuity contraction.
export function addBuoyancy(dt) {
  addBuoyancyBase(dt);
  applyStackBuoyancy(dt);
  applyFanLayer(dt);
  applyContinuity(dt);
}
