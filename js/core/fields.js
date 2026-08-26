import {
  AMBIENT_O2,
  AMBIENT_T,
  N,
  bindSolidField
} from './grid.js';

// Every mutable simulation field has one allocation for the lifetime of the
// module graph.  Physics imports these live bindings; reset only fills them.
export const u = new Float32Array(N);
export const v = new Float32Array(N);
export const uPrev = new Float32Array(N);
export const vPrev = new Float32Array(N);
export const pressure = new Float32Array(N);
export const pressureNext = new Float32Array(N);
export const divergence = new Float32Array(N);
export const temperature = new Float32Array(N);
export const temperaturePrev = new Float32Array(N);
export const oxygen = new Float32Array(N);
export const oxygenPrev = new Float32Array(N);
export const smoke = new Float32Array(N);
export const smokePrev = new Float32Array(N);
export const brickTemp = new Float32Array(N);
export const brickTempNext = new Float32Array(N);
export const solid = new Uint8Array(N);
bindSolidField(solid);

export const unburnedGas = new Float32Array(N);
export const unburnedPrev = new Float32Array(N);
export const exhaustGas = new Float32Array(N);
export const exhaustPrev = new Float32Array(N);
export const ash = new Float32Array(N);
export const ashPrev = new Float32Array(N);
export const ashTransfer = new Float32Array(N);
export const ashBed = new Float32Array(N);
export const charResidue = new Float32Array(N);
export const charResiduePrev = new Float32Array(N);
export const flyAsh = new Float32Array(N);
export const flyAshPrev = new Float32Array(N);
export const flyAshTransfer = new Float32Array(N);
export const secondaryResidence = new Float32Array(N);
export const secondaryResidencePrev = new Float32Array(N);

// Stack diagnostics are simulation buffers too.  They live here so stack and
// the oracle share the same identity rather than allocating private copies.
export const stackPressure = new Float32Array(N);
export const stackNext = new Float32Array(N);
export const fixed = new Uint8Array(N);
export const fixedValue = new Float32Array(N);
export const boundaryU = new Float32Array(N);
export const boundaryV = new Float32Array(N);
export const boundaryMask = new Uint8Array(N);

export const FIELD_NAMES = [
  'u', 'v', 'uPrev', 'vPrev', 'pressure', 'pressureNext', 'divergence',
  'temperature', 'temperaturePrev', 'oxygen', 'oxygenPrev', 'smoke',
  'smokePrev', 'brickTemp', 'brickTempNext', 'solid', 'unburnedGas',
  'unburnedPrev', 'exhaustGas', 'exhaustPrev', 'ash', 'ashPrev',
  'ashTransfer', 'ashBed', 'charResidue', 'charResiduePrev', 'flyAsh',
  'flyAshPrev', 'flyAshTransfer', 'secondaryResidence',
  'secondaryResidencePrev', 'stackPressure', 'stackNext', 'fixed',
  'fixedValue', 'boundaryU', 'boundaryV', 'boundaryMask'
];

export function resetFields() {
  u.fill(0); v.fill(0);
  uPrev.fill(0); vPrev.fill(0);
  pressure.fill(0); pressureNext.fill(0); divergence.fill(0);
  temperature.fill(AMBIENT_T); temperaturePrev.fill(AMBIENT_T);
  oxygen.fill(AMBIENT_O2); oxygenPrev.fill(AMBIENT_O2);
  smoke.fill(0); smokePrev.fill(0);
  brickTemp.fill(AMBIENT_T); brickTempNext.fill(AMBIENT_T);

  unburnedGas.fill(0); unburnedPrev.fill(0);
  exhaustGas.fill(0); exhaustPrev.fill(0);
  ash.fill(0); ashPrev.fill(0); ashTransfer.fill(0); ashBed.fill(0);
  charResidue.fill(0); charResiduePrev.fill(0);
  flyAsh.fill(0); flyAshPrev.fill(0); flyAshTransfer.fill(0);
  secondaryResidence.fill(0); secondaryResidencePrev.fill(0);

  stackPressure.fill(0); stackNext.fill(0); fixed.fill(0);
  fixedValue.fill(0); boundaryU.fill(0); boundaryV.fill(0);
  boundaryMask.fill(0);
}

temperature.fill(AMBIENT_T);
oxygen.fill(AMBIENT_O2);
brickTemp.fill(AMBIENT_T);

function exposeOracleFields(registry) {
  if (!registry) return;
  for (const name of FIELD_NAMES) registry[name] = exportsByName[name];
}

// ES modules do not provide a CommonJS `exports` object.  Keep the map
// explicit so the registry remains a read-only view of the named bindings.
const exportsByName = {
  u, v, uPrev, vPrev, pressure, pressureNext, divergence,
  temperature, temperaturePrev, oxygen, oxygenPrev, smoke, smokePrev,
  brickTemp, brickTempNext, solid, unburnedGas, unburnedPrev, exhaustGas,
  exhaustPrev, ash, ashPrev, ashTransfer, ashBed, charResidue,
  charResiduePrev, flyAsh, flyAshPrev, flyAshTransfer, secondaryResidence,
  secondaryResidencePrev, stackPressure, stackNext, fixed, fixedValue,
  boundaryU, boundaryV, boundaryMask
};

if (globalThis.__oracleFields) exposeOracleFields(globalThis.__oracleFields);

export function exposeFields(registry = globalThis.__oracleFields) {
  exposeOracleFields(registry);
}
