import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.attrs = {};
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => this.classes.add(n)),
      remove: (...names) => names.forEach((n) => this.classes.delete(n)),
      contains: (n) => this.classes.has(n),
      toggle: (n, on) => on ? this.classes.add(n) : this.classes.delete(n),
    };
    this.style = { setProperty() {} };
    this.offsetWidth = 110;
    this.textContent = '';
  }
  append(...els) { els.forEach((el) => { el.parentElement = this; this.children.push(el); }); }
  replaceChildren(...els) { this.children = []; this.append(...els); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(k, fn) { if (!this.listeners.has(k)) this.listeners.set(k, new Set()); this.listeners.get(k).add(fn); }
  removeEventListener(k, fn) { this.listeners.get(k)?.delete(fn); }
  fire(k, e = {}) { for (const fn of this.listeners.get(k) || []) fn(e); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 375, height: 300 }; }
}

let now = 0, serial = 0, rafs, timers, reduced = false, vibrations, layer;
const viewport = new Element();
globalThis.window = viewport;
window.matchMedia = () => ({ get matches() { return reduced; } });
globalThis.location = { search: '?lite=0' };
globalThis.localStorage = { getItem: () => null, removeItem() {} };
globalThis.document = {
  documentElement: new Element(),
  createElement: () => new Element(),
  getElementById: (id) => id === 'fx' ? layer : null,
};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { vibrate: (v) => vibrations.push(v) } });
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#ff4fa3' });
globalThis.addEventListener = () => {};
globalThis.ResizeObserver = class {
  constructor(fn) { this.fn = fn; }
  observe() {}
  disconnect() { this.disconnected = true; }
};
globalThis.requestAnimationFrame = (fn) => { rafs.set(++serial, fn); return serial; };
globalThis.cancelAnimationFrame = (id) => rafs.delete(id);
globalThis.setTimeout = (fn, ms) => { timers.set(++serial, { fn, at: now + ms }); return serial; };
globalThis.clearTimeout = (id) => timers.delete(id);

const { PullMachine } = await import('../src/pull-machine.js');
const { Sound } = await import('../src/sound.js');

beforeEach(() => {
  now = 0; rafs = new Map(); timers = new Map(); reduced = false; vibrations = []; layer = new Element();
});

function frame(at) {
  now = at;
  const pending = [...rafs.values()];
  rafs.clear();
  pending.forEach((fn) => fn(at));
}
function time(at) {
  now = at;
  for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
}
function setup(options = {}) {
  const ring = new Element(), hit = new Element(), button = new Element(), stage = new Element();
  stage.append(ring, hit);
  hit.setAttribute('aria-label', 'Pull a photocard');
  button.textContent = 'Pull a card';
  const events = [], fills = [];
  let picks = 0;
  const items = Array.from({ length: 100 }, (_, id) => ({ id, tier: options.tier || 'epic' }));
  const machine = new PullMachine({
    ring, hit, buttons: [button],
    renderSlot: (el, item) => { el.item = item; fills.push(item); },
    sound: Object.fromEntries(['unlock', 'tick', 'clack', 'chime', 'fanfare'].map((k) => [k, (...args) => events.push([k, ...args])])),
    tierOf: (s) => s.tier,
    onLand: (item, tier, meta) => events.push(['land', item, tier, meta]),
    onReveal: (item, meta) => events.push(['reveal', item, meta]),
    ...options,
  });
  machine.setPool(items, () => { ++picks; return items[7]; });
  machine.activate();
  return { machine, ring, hit, button, events, fills, items, picks: () => picks };
}

test('commits once, spins three turns plus offset with quartic easing, holds 1300ms', () => {
  const s = setup();
  s.machine.pull();
  const end = s.machine.motion.end;
  assert.equal(end, -1260);
  frame(1800);
  assert.equal(s.machine.angle, end * (1 - 0.5 ** 4));
  assert.equal(s.events.filter(([k]) => k === 'tick').length, 46);
  frame(3599);
  assert.equal(s.machine.state, 'spinning');
  frame(3600);
  assert.equal(s.machine.state, 'revealing');
  assert.equal(s.machine.lifted.el.item, s.items[7]);
  assert.match(s.machine.lifted.el.style.transform, /translateZ\(70px\).*scale\(1.12\)/);
  time(4899);
  assert.equal(s.events.some(([k]) => k === 'reveal'), false);
  time(4900);
  assert.equal(s.machine.state, 'idle');
  assert.equal(s.picks(), 1);
  assert.deepEqual(s.events.filter(([k]) => ['land', 'reveal'].includes(k)).map(([k]) => k), ['land', 'reveal']);
});

test('slam-stop keeps the committed winner and endpoint, lands only once after 450ms', () => {
  const s = setup();
  s.hit.fire('click');
  const stale = [...rafs.values()][0];
  const end = s.machine.motion.end;
  frame(300);
  const ticks = s.events.length;
  s.button.fire('click');
  s.machine.slamStop();
  stale(3600); // A canceled browser frame must not finish the previous motion.
  frame(749);
  assert.equal(s.machine.state, 'spinning');
  frame(750);
  assert.equal(s.machine.angle, end);
  assert.equal(s.picks(), 1);
  assert.ok(s.events.length > ticks);
  s.hit.fire('click'); s.button.fire('click');
  time(2050);
  assert.equal(s.events.filter(([k]) => k === 'land').length, 1);
  assert.equal(s.events.filter(([k]) => k === 'reveal').length, 1);
});

test('short pull turns once plus offset in 1200ms; lands, lifts and reveals without celebrations or hold', () => {
  const s = setup({ tier: 'legendary' });
  s.machine.pull({ short: true });
  assert.equal(s.machine.motion.end, -540);
  assert.equal(s.machine.motion.duration, 1200);
  frame(600);
  assert.equal(s.machine.angle, -540 * (1 - 0.5 ** 4));
  assert.ok(s.events.some(([k]) => k === 'tick'));
  frame(1000);
  assert.equal(s.machine.winner.el.classList.contains('incoming'), true);
  frame(1199);
  assert.equal(s.events.some(([k]) => k === 'land'), false);
  frame(1200); time(9999);
  assert.equal(s.machine.state, 'idle');
  assert.deepEqual(s.events.filter(([k]) => ['land', 'reveal'].includes(k)).map(([k]) => k), ['land', 'reveal']);
  assert.deepEqual(s.events.find(([k]) => k === 'land')[3], { short: true });
  assert.deepEqual(s.events.find(([k]) => k === 'reveal')[2], { short: true });
  assert.ok(s.machine.lifted.el.classList.contains('lifted'));
  assert.equal(s.events.some(([k]) => ['clack', 'chime', 'fanfare'].includes(k)), false);
  assert.equal(layer.children.length, 0);
  assert.equal(vibrations.length, 0);
  assert.equal(s.picks(), 1);
});

test('cancel mid-short-pull suppresses stale landing, reveal and celebration', () => {
  const s = setup();
  s.machine.pull({ short: true }); frame(500);
  const stale = [...rafs.values()][0];
  s.machine.cancel(); stale(1200); frame(1200); time(10000);
  assert.equal(s.events.some(([k]) => ['land', 'reveal', 'fanfare'].includes(k)), false);
});

test('reduced short pull lasts 350ms with no hold or celebrations', () => {
  reduced = true;
  const s = setup(); s.machine.pull({ short: true });
  assert.equal(s.machine.motion.end, -180);
  frame(349);
  assert.equal(s.events.some(([k]) => k === 'reveal'), false);
  frame(350);
  assert.equal(s.events.filter(([k]) => k === 'reveal').length, 1);
  assert.equal(s.events.some(([k]) => ['fanfare', 'chime'].includes(k)), false);
});

test('hidden short pull selects and reveals synchronously without animation frames', () => {
  const s = setup(); s.machine.pull({ short: true, immediate: true });
  assert.equal(s.machine.motion, null);
  assert.equal(s.picks(), 1);
  assert.deepEqual(s.events.filter(([k]) => ['land', 'reveal'].includes(k)).map(([k]) => k), ['land', 'reveal']);
});

test('hiding a running short pull finishes it once instead of waiting for a hidden rAF', () => {
  const s = setup(); s.machine.pull({ short: true }); frame(400);
  const stale = [...rafs.values()][0];
  document.hidden = true; s.machine.visibility(); document.hidden = false;
  stale(1200); time(10000);
  assert.equal(s.events.filter(([k]) => k === 'reveal').length, 1);
  assert.equal(s.machine.motion, null);
});

test('manual controls and Stop preserve ceremony while lifecycle hooks cancel pending advances', () => {
  const hooks = [];
  const s = setup({ onPull: (meta) => hooks.push(meta), onCancel: () => hooks.push('cancel') });
  hooks.length = 0;
  s.hit.fire('click');
  assert.deepEqual(hooks, [{ short: false }]);
  s.button.fire('click'); frame(450); time(1750);
  assert.equal(s.events.some(([k]) => k === 'fanfare'), true);
  assert.deepEqual(s.events.find(([k]) => k === 'reveal')[2], { short: false });
  s.machine.cancel();
  assert.deepEqual(hooks, [{ short: false }, 'cancel']);
});

for (const action of ['cancel', 'deactivate', 'setPool', 'destroy']) {
  for (const phase of ['spinning', 'revealing']) {
    test(`${action} invalidates even already-queued callbacks during ${phase}`, () => {
      const s = setup();
      s.machine.pull();
      if (phase === 'revealing') frame(3600);
      const stale = phase === 'spinning' ? [...rafs.values()][0] : [...timers.values()][0].fn;
      const count = s.events.length;
      if (action === 'setPool') s.machine.setPool(s.items, () => s.items[3]);
      else s.machine[action]();
      stale(9999);
      frame(9999); time(20000);
      assert.equal(s.events.length, count);
      assert.equal(s.machine.state, ['cancel', 'setPool'].includes(action) ? 'idle' : 'inactive');
      assert.equal(s.button.textContent, 'Pull a card');
      assert.equal(s.ring.children.some((el) => el.classList.contains('lifted')), false);
    });
  }
}

test('onLand cancellation prevents celebration and reveal', () => {
  const s = setup({ onLand: () => s.machine.cancel() });
  s.machine.pull(); frame(3600); time(10000);
  assert.equal(s.events.some(([k]) => ['reveal', 'fanfare', 'clack'].includes(k)), false);
  assert.equal(timers.size, 0);
});

test('local keyboard controls ignore auto-repeat and show Stop until landing', () => {
  const s = setup();
  const key = (el, value, repeat = false) => el.fire('keydown', { key: value, repeat, preventDefault() {} });
  key(s.hit, ' ', true);
  assert.equal(s.picks(), 0);
  key(s.hit, ' ');
  assert.equal(s.hit.tabIndex, 0);
  assert.equal(s.hit.getAttribute('role'), 'button');
  assert.equal(s.button.textContent, 'Stop');
  assert.equal(s.button.getAttribute('aria-disabled'), 'false');
  key(s.button, 'Enter', true);
  assert.equal(s.machine.motion.stopped, undefined);
  key(s.button, 'Enter');
  frame(450);
  assert.equal(s.button.textContent, 'Pull a card');
  assert.equal(s.button.getAttribute('aria-disabled'), 'true');
  time(1750);
  assert.equal(s.button.getAttribute('aria-disabled'), 'false');
  s.machine.destroy(); key(s.hit, 'Enter');
  assert.equal(s.picks(), 1);
  assert.equal(s.machine.observer.disconnected, true);
});

test('idle drifts at 7 degrees per second and incoming starts within 1.5 steps', () => {
  const s = setup();
  frame(1000);
  assert.equal(s.machine.angle, -7);
  s.machine.pull();
  frame(2500);
  assert.equal(s.machine.winner.el.classList.contains('incoming'), false);
  frame(3500);
  assert.ok(Math.abs(s.machine.angle - s.machine.motion.end) < 1.5 * s.machine.step);
  assert.equal(s.machine.winner.el.classList.contains('incoming'), true);
  assert.equal(s.machine.winner.el.dataset.tier, 'epic');
});

test('refills behind the ring before 80%, protects winner, then stops refilling', () => {
  const s = setup();
  s.machine.pull();
  const first = s.fills.length;
  frame(1000);
  assert.ok(s.fills.length > first);
  assert.equal(s.machine.winner.item, s.items[7]);
  const count = s.fills.length;
  frame(2900); frame(3600);
  assert.equal(s.fills.length, count);
});

test('reduced motion: zero turns, 350ms spin, 500ms hold, no drift, confetti or vibration', () => {
  reduced = true;
  const s = setup({ tier: 'legendary' });
  assert.equal(rafs.size, 0);
  s.machine.pull();
  assert.equal(s.machine.motion.end, -180);
  frame(349);
  assert.equal(s.machine.state, 'spinning');
  frame(350); time(849);
  assert.equal(s.events.some(([k]) => k === 'reveal'), false);
  time(850);
  assert.equal(s.events.filter(([k]) => k === 'reveal').length, 1);
  assert.equal(vibrations.length, 0);
  assert.equal(layer.children.length, 0);
});

for (const [tier, count, buzz, sounds] of [
  ['legendary', 64, [30, 40, 70], ['clack', 'fanfare']],
  ['epic', 40, 25, ['fanfare']], ['rare', 14, 15, ['fanfare']], ['common', 0, 10, ['chime']],
]) {
  test(`${tier} celebration has tier-scaled confetti, sound and haptics`, () => {
    const s = setup({ tier });
    s.machine.pull(); frame(3600);
    assert.equal(layer.children.length, count);
    assert.deepEqual(vibrations, [buzz]);
    assert.deepEqual(s.events.filter(([k]) => ['clack', 'chime', 'fanfare'].includes(k)).map(([k]) => k), sounds);
    if (tier !== 'common') assert.ok(s.events.some(([k, arg]) => k === 'fanfare' && arg === tier));
  });
}

test('breakpoint rebuilds when idle, defers during spin, preserves endpoint on resize', () => {
  let width = 375;
  const s = setup({ slots: () => width < 520 ? 10 : 12, radius: (w, n) => w + n });
  assert.equal(s.ring.children.length, 10);
  width = 600; s.machine.observer.fn();
  assert.equal(s.ring.children.length, 12);
  s.machine.pull(); frame(900);
  const end = s.machine.motion.end, at = s.machine.motion.at;
  width = 375;
  s.ring.children[0].offsetWidth = 96;
  s.machine.observer.fn();
  assert.equal(s.ring.children.length, 12);
  assert.equal(s.machine.radius, 108);
  assert.equal(s.machine.motion.at, at);
  frame(3600);
  assert.equal(s.machine.angle, end);
  time(4900);
  assert.equal(s.ring.children.length, 10);
  assert.equal(s.events.filter(([k]) => k === 'reveal').length, 1);
});

test('empty pool and inactive machine cannot pick or spin', () => {
  const s = setup();
  s.machine.deactivate(); s.machine.pull();
  s.machine.setPool([], () => assert.fail('empty pick'));
  s.machine.activate(); s.machine.pull();
  assert.equal(s.ring.children.length, 0);
  assert.equal(s.picks(), 0);
});

test('default fanfare stays identical; legendary doubles every frequency; clack/chime respect mute', () => {
  const notes = [];
  const sound = new Sound();
  const parameter = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  sound.ctx = {
    currentTime: 0, destination: {},
    createOscillator: () => ({ frequency: { setValueAtTime: (f) => notes.push(f) },
      connect: (gain) => gain, start() {}, stop() {} }),
    createGain: () => ({ gain: parameter, connect() {} }),
  };
  sound.fanfare();
  const normal = [...notes]; notes.length = 0;
  assert.deepEqual(normal, [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5]);
  sound.fanfare('legendary');
  assert.deepEqual(notes, normal.map((f) => f * 2));
  notes.length = 0; sound.clack(); sound.chime();
  assert.deepEqual(notes, [90, 55, 1046.5]);
  sound.enabled = false; sound.clack(); sound.chime(); sound.fanfare();
  assert.equal(notes.length, 3);
});
