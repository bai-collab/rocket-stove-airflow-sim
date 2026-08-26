import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const ORACLE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(ORACLE_DIR, '../..');
export const GOLDEN_DIR = path.join(ORACLE_DIR, 'golden');

export const SCRIPT_PATHS = [
  'js/app-v2.js',
  'js/physics-v2-plume-fix.js',
  'js/physics-v2-stack-flow.js',
  'js/physics-v2-fan-duct.js',
  'js/physics-v2-continuity.js',
  'js/physics-v2-conservation.js',
  'js/physics-v2-temperature-heatmap.js',
  'js/physics-v2-tracer-recycle.js',
  'js/physics-v2-secondary-combustion.js',
  'js/physics-v2-closed-scalar.js',
  'js/rocket-stove-presets.js'
];

export const SCENARIOS = ['straight', 'baffle', 'twin-channel', 'sealed'];
export const CHECKPOINTS = [1, 30, 120, 300, 600];
export const FIELD_NAMES = [
  'u', 'v', 'pressure', 'divergence', 'temperature', 'oxygen', 'smoke',
  'brickTemp', 'unburnedGas', 'exhaustGas', 'ash', 'ashBed', 'charResidue',
  'flyAsh', 'secondaryResidence'
];
export const SCALAR_NAMES = [
  'ashGeneratedTotal', 'ashDepositedTotal', 'ashOutTotal', 'ashBurnedTotal',
  'charGeneratedTotal', 'charBurnedTotal', 'flyAshOutTotal',
  'flyAshLiftedTotal', 'flyAshDepositedTotal', 'secondaryIndex',
  'smokeOutIndex', 'pressureResidual', 'pressureEquationResidual',
  'projectedInFlow', 'projectedOutFlow'
];

const EXPECTED_SCRIPT_RE = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readScriptSources() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const fromIndex = [...html.matchAll(EXPECTED_SCRIPT_RE)].map(match => match[1].split('?')[0]);
  assert(fromIndex.length === SCRIPT_PATHS.length,
    `index.html script count changed: expected ${SCRIPT_PATHS.length}, got ${fromIndex.length}`);
  assert(fromIndex.every((value, index) => value === SCRIPT_PATHS[index]),
    `index.html script order changed:\n${fromIndex.join('\n')}`);
  return SCRIPT_PATHS.map(relativePath => ({
    relativePath,
    source: fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
  }));
}

class ClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  replace(value) {
    this.values = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  add(...names) {
    for (const name of names) this.values.add(name);
    this.owner._className = [...this.values].join(' ');
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
    this.owner._className = [...this.values].join(' ');
  }

  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : Boolean(force);
    if (next) this.add(name);
    else this.remove(name);
    return next;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class ElementStub {
  constructor(ownerDocument, tagName = 'div') {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this._id = '';
    this._className = '';
    this._innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.style = {cssText: ''};
    this.attributes = new Map();
    this.dataset = Object.create(null);
    this.children = [];
    this.parentNode = null;
    this._listeners = new Map();
    this.classList = new ClassList(this);
  }

  get id() {
    return this._id;
  }

  set id(value) {
    this._id = String(value || '');
    if (this.ownerDocument) this.ownerDocument.register(this);
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value || '');
    this.classList.replace(this._className);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this.children.length = 0;
    const tagPattern = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
    for (const match of this._innerHTML.matchAll(tagPattern)) {
      const attributes = match[2];
      const idMatch = attributes.match(/\bid=["']([^"']+)["']/i);
      if (!idMatch) continue;
      const child = this.ownerDocument.createElement(match[1]);
      child.id = idMatch[1];
      const classMatch = attributes.match(/\bclass=["']([^"']+)["']/i);
      if (classMatch) child.className = classMatch[1];
      this.appendChild(child);
    }
  }

  addEventListener(type, listener) {
    const listeners = this._listeners.get(type) || [];
    listeners.push(listener);
    this._listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event?.type;
    const listeners = this._listeners.get(type) || [];
    const payload = typeof event === 'object' ? event : {type};
    if (!payload.target) payload.target = this;
    if (!payload.currentTarget) payload.currentTarget = this;
    for (const listener of [...listeners]) listener(payload);
    return true;
  }

  click() {
    return this.dispatchEvent({type: 'click'});
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild?.(child);
    child.parentNode = this;
    this.children.push(child);
    this.ownerDocument.registerTree(child);
    return child;
  }

  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild?.(child);
    child.parentNode = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    this.ownerDocument.registerTree(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  getBoundingClientRect() {
    return {left: 0, top: 0, width: 900, height: 560, right: 900, bottom: 560};
  }

  setPointerCapture() {}

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) ?? null;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  insertAdjacentElement(_position, element) {
    this.ownerDocument.registerTree(element);
    return element;
  }

  matches(selector) {
    let query = selector.trim();
    if (query.includes(',')) return query.split(',').some(part => this.matches(part));

    const tag = query.match(/^[a-zA-Z][\w-]*/)?.[0];
    if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;

    const id = query.match(/#([\w-]+)/)?.[1];
    if (id && this.id !== id) return false;

    const classes = [...query.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
    if (classes.some(name => !this.classList.contains(name))) return false;

    const attribute = query.match(/^\[data-([\w-]+)(?:=["']?([^\]"']+)["']?)?\]$/);
    if (attribute) {
      const key = attribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      if (!(key in this.dataset)) return false;
      if (attribute[2] !== undefined && this.dataset[key] !== attribute[2]) return false;
    }

    return Boolean(tag || id || classes.length || attribute);
  }

  querySelectorAll(selector) {
    const result = [];
    const visit = node => {
      for (const child of node.children) {
        if (child.matches(selector)) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

class CanvasStub extends ElementStub {
  constructor(ownerDocument, context) {
    super(ownerDocument, 'canvas');
    this.width = 900;
    this.height = 560;
    this.context = context;
  }

  getContext(type) {
    return type === '2d' ? this.context : null;
  }
}

function makeNoopContext() {
  const target = {
    measureText(value) {
      return {width: String(value).length * 7};
    }
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      if (typeof property === 'symbol') return undefined;
      const noOp = () => {};
      object[property] = noOp;
      return noOp;
    }
  });
}

class DocumentStub {
  constructor() {
    this.elements = [];
    this.byId = new Map();
    this.canvas = new CanvasStub(this, makeNoopContext());
    this.canvas.id = 'simCanvas';
    this.register(this.canvas);
    this.createStaticElements();
  }

  register(element) {
    if (!this.elements.includes(element)) this.elements.push(element);
    if (element.id) this.byId.set(element.id, element);
  }

  registerTree(element) {
    this.register(element);
    for (const child of element.children) this.registerTree(child);
  }

  createElement(tagName) {
    const element = new ElementStub(this, tagName);
    this.register(element);
    return element;
  }

  add(tagName, options = {}) {
    const element = tagName === 'canvas' ? this.canvas : this.createElement(tagName);
    if (options.id) element.id = options.id;
    if (options.className) element.className = options.className;
    if (options.value !== undefined) element.value = String(options.value);
    for (const [key, value] of Object.entries(options.dataset || {})) element.dataset[key] = value;
    return element;
  }

  createStaticElements() {
    this.add('div', {className: 'panel metrics'});
    this.add('div', {id: 'advancedMetrics'});
    this.add('div', {className: 'simulation-card'});
    this.add('div', {id: 'presetStatus'});

    for (const [id, value] of [
      ['igniteBtn', ''], ['pauseBtn', ''], ['clearBtn', ''],
      ['flowScore', '—'], ['avgSpeed', '—'], ['stagnantRate', '—'],
      ['oxygenRate', '—'], ['feedback', ''], ['fanPressureValue', '2.0 Pa']
    ]) this.add('button', {id, value}).textContent = value;

    this.add('input', {id: 'particleCount', value: 240});
    this.add('input', {id: 'fanPressure', value: 2});

    for (const tool of ['wall', 'fire', 'fan', 'erase']) {
      this.add('button', {className: tool === 'wall' ? 'tool active' : 'tool', dataset: {tool}});
    }
    for (const preset of ['straight', 'baffle', 'twin-channel']) {
      this.add('button', {className: 'preset-button', dataset: {stovePreset: preset}});
    }

    this.add('canvas');
  }

  getElementById(id) {
    return this.byId.get(id) || null;
  }

  querySelectorAll(selector) {
    return this.elements.filter(element => element.matches(selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function addProbeBridge(source) {
  const close = source.lastIndexOf('})();');
  assert(close >= 0, 'secondary combustion script has no IIFE terminator');
  const bridge = `
  if (globalThis.__oracleProbe) {
    const probeFields = globalThis.__oracleProbe.fields;
    probeFields.unburnedGas = unburnedGas;
    probeFields.exhaustGas = exhaustGas;
    probeFields.ash = ash;
    probeFields.ashBed = ashBed;
    probeFields.charResidue = charResidue;
    probeFields.flyAsh = flyAsh;
    probeFields.secondaryResidence = secondaryResidence;
    const probeScalars = globalThis.__oracleProbe.scalars;
    Object.defineProperty(probeScalars, 'secondaryIndex', {
      configurable: true, enumerable: true, get: () => secondaryIndex
    });
    Object.defineProperty(probeScalars, 'smokeOutIndex', {
      configurable: true, enumerable: true, get: () => smokeOutIndex
    });
    Object.defineProperty(probeScalars, 'ashGeneratedTotal', {
      configurable: true, enumerable: true, get: () => ashGeneratedTotal
    });
    Object.defineProperty(probeScalars, 'ashDepositedTotal', {
      configurable: true, enumerable: true, get: () => ashDepositedTotal
    });
    Object.defineProperty(probeScalars, 'ashOutTotal', {
      configurable: true, enumerable: true, get: () => ashOutTotal
    });
    Object.defineProperty(probeScalars, 'ashBurnedTotal', {
      configurable: true, enumerable: true, get: () => ashBurnedTotal
    });
    Object.defineProperty(probeScalars, 'charGeneratedTotal', {
      configurable: true, enumerable: true, get: () => charGeneratedTotal
    });
    Object.defineProperty(probeScalars, 'charBurnedTotal', {
      configurable: true, enumerable: true, get: () => charBurnedTotal
    });
    Object.defineProperty(probeScalars, 'flyAshOutTotal', {
      configurable: true, enumerable: true, get: () => flyAshOutTotal
    });
    Object.defineProperty(probeScalars, 'flyAshLiftedTotal', {
      configurable: true, enumerable: true, get: () => flyAshLiftedTotal
    });
    Object.defineProperty(probeScalars, 'flyAshDepositedTotal', {
      configurable: true, enumerable: true, get: () => flyAshDepositedTotal
    });
  }
`;
  return source.slice(0, close) + bridge + source.slice(close);
}

function makeRuntime({hooks, execution = 'context'}) {
  const document = new DocumentStub();
  const deterministicRandom = mulberry32(0x1234ABCD);

  const bindings = {
    document,
    requestAnimationFrame: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
    __oracleNowMs: 0,
    __oracleCurrentStep: 0,
    __oracleTargetStep: 0
  };
  if (hooks) {
    bindings.__oracleFields = Object.create(null);
    bindings.__oracleScalars = Object.create(null);
  } else {
    bindings.__oracleProbe = {
      fields: Object.create(null),
      scalars: Object.create(null)
    };
  }

  let context = null;
  let realm = null;
  let runCode;
  let runScript;
  if (execution === 'global') {
    // Each worker performs exactly one global-realm load, so top-level classic
    // lexical declarations cannot collide with a second bundle in that worker.
    realm = globalThis;
    Object.assign(realm, bindings);
    realm.window = realm;
    realm.performance = {now: () => realm.__oracleNowMs};
    realm.__oracleRandom = deterministicRandom;
    vm.runInThisContext(
      'Math.random = __oracleRandom; delete globalThis.__oracleRandom;',
      {filename: 'legacy-random-injection.js'}
    );
    runCode = code => vm.runInThisContext(code, {filename: 'legacy-harness-eval.js'});
    runScript = script => script.runInThisContext();
  } else {
    const sandbox = {...bindings};
    sandbox.window = sandbox;
    sandbox.performance = {now: () => sandbox.__oracleNowMs};
    context = vm.createContext(sandbox);
    context.__oracleRandom = deterministicRandom;
    vm.runInContext('Math.random = __oracleRandom; delete globalThis.__oracleRandom;', context);
    realm = context;
    runCode = code => vm.runInContext(code, context, {filename: 'legacy-harness-eval.js'});
    runScript = script => script.runInContext(context);
  }

  const sources = readScriptSources();
  const program = sources.map(({relativePath, source}) => {
    const loadedSource = !hooks && relativePath === 'js/physics-v2-secondary-combustion.js'
      ? addProbeBridge(source)
      : source;
    return `\n/* classic script: ${relativePath} */\n${loadedSource}\n`;
  }).join('\n');
  if (execution === 'global') {
    vm.runInThisContext(program, {filename: 'legacy-classic-bundle.js'});
  } else {
    vm.runInContext(program, context, {filename: 'legacy-classic-bundle.js'});
  }

  const apiTypes = runCode(`({
    stack: typeof window.stackFlowV26,
    conservation: typeof window.conservationV26,
    physics: typeof window.physicsV25,
    physics251: typeof window.physicsV251,
    tracer: typeof window.tracerV25,
    presets: typeof window.rocketStovePresets
  })`);
  for (const [name, type] of Object.entries(apiTypes)) {
    assert(type === 'object', `legacy patch did not resolve: ${name}=${type}`);
  }

  return {
    hooks,
    execution,
    context,
    realm,
    runCode,
    runScript,
    document,
    fields: bindings.__oracleFields,
    scalars: bindings.__oracleScalars,
    probe: bindings.__oracleProbe
  };
}

function hasOwn(object, key) {
  return object && Object.prototype.hasOwnProperty.call(object, key);
}

function readField(runtime, name) {
  if (runtime.hooks && hasOwn(runtime.fields, name)) return runtime.fields[name];
  if (!runtime.hooks && hasOwn(runtime.probe.fields, name)) return runtime.probe.fields[name];
  return runtime.runCode(name);
}

function readScalar(runtime, name) {
  if (runtime.hooks && hasOwn(runtime.scalars, name)) return runtime.scalars[name];
  if (!runtime.hooks && hasOwn(runtime.probe.scalars, name)) return runtime.probe.scalars[name];
  return runtime.runCode(`window.conservationV26[${JSON.stringify(name)}]`);
}

function capture(runtime, step, scenario) {
  const fields = {};
  for (const name of FIELD_NAMES) {
    const field = readField(runtime, name);
    assert(field && field.buffer && Number.isInteger(field.byteLength),
      `field is not a typed array: ${name}`);
    const bytes = Buffer.from(field.buffer, field.byteOffset, field.byteLength);
    fields[name] = {
      length: field.length,
      byteLength: bytes.length,
      sha256: sha256(bytes),
      bytesBase64: bytes.toString('base64')
    };
  }

  const scalars = {};
  for (const name of SCALAR_NAMES) {
    const value = readScalar(runtime, name);
    assert(typeof value === 'number' && Number.isFinite(value),
      `scalar is not a finite number: ${name}=${value}`);
    scalars[name] = value;
  }

  return {step, fields, scalars};
}

function sealedGeometry() {
  const fire = {x: 432, y: 360};
  const walls = [];
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      if (dx === 0 && dy === 0) continue;
      walls.push({x: fire.x + dx * 24, y: fire.y + dy * 24});
    }
  }
  return {walls, fire};
}

function prepareScenario(runtime, scenario) {
  if (scenario !== 'sealed') {
    const loaded = runtime.runCode(
      `window.rocketStovePresets.load(${JSON.stringify(scenario)})`
    );
    assert(loaded === true, `preset failed to load: ${scenario}`);
  } else {
    const {walls, fire} = sealedGeometry();
    runtime.runCode(`
      clearBtn.click();
      walls.push(...${JSON.stringify(walls)});
      fires.push(${JSON.stringify(fire)});
      geometryDirty = true;
      ensureGeometry();
      seedTracers();
    `);
  }
  runtime.runCode('igniteBtn.click()');
}

export function runLegacyScenario(scenario, {
  hooks = true,
  maxSteps = 600,
  skipTracers = false,
  execution = 'context'
} = {}) {
  assert(SCENARIOS.includes(scenario), `unknown scenario: ${scenario}`);
  assert(Number.isInteger(maxSteps) && maxSteps > 0 && maxSteps <= 600,
    `maxSteps must be an integer in 1..600: ${maxSteps}`);
  const runtime = makeRuntime({hooks, execution});
  prepareScenario(runtime, scenario);
  if (skipTracers) runtime.runCode('updateTracers = () => {}');
  const segmentScript = new vm.Script(`
    while (__oracleCurrentStep < __oracleTargetStep) {
      __oracleCurrentStep += 1;
      __oracleNowMs = __oracleCurrentStep * (1000 / 30);
      physicsStep(DT);
    }
  `);
  const snapshots = {};
  for (const checkpoint of CHECKPOINTS) {
    if (checkpoint > maxSteps) break;
    runtime.realm.__oracleTargetStep = checkpoint;
    runtime.runScript(segmentScript);
    snapshots[String(checkpoint)] = capture(runtime, checkpoint, scenario);
  }

  return {
    schema: 1,
    scenario,
    hooks,
    dt: 1 / 30,
    steps: maxSteps,
    checkpoints: CHECKPOINTS,
    fields: FIELD_NAMES,
    scalars: SCALAR_NAMES,
    snapshots
  };
}

export function writeSnapshot(snapshot, outputDirectory) {
  fs.mkdirSync(outputDirectory, {recursive: true});
  const file = path.join(outputDirectory, `${snapshot.scenario}.json`);
  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  fs.writeFileSync(file, text, 'utf8');
  return {file, digest: sha256(Buffer.from(text, 'utf8'))};
}

export function readSnapshotSet(directory) {
  return Object.fromEntries(SCENARIOS.map(scenario => {
    const file = path.join(directory, `${scenario}.json`);
    return [scenario, JSON.parse(fs.readFileSync(file, 'utf8'))];
  }));
}

export function snapshotDigest(snapshot) {
  return sha256(Buffer.from(JSON.stringify(snapshot), 'utf8'));
}
