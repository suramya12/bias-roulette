import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { VideoPlayer } from '../src/player.js';
import { createAutoAdvance } from '../src/auto-advance.js';

class Element {
  constructor() {
    this.children = []; this.hidden = true; this.listeners = {}; this.attrs = {};
    this.classes = new Set();
    this.classList = { add: (v) => this.classes.add(v), remove: (v) => this.classes.delete(v) };
  }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text || ''; }
  append(...items) { for (const item of items) { this.children.push(item); if (typeof item === 'object') item.parent = this; } }
  prepend(item) { this.children.unshift(item); item.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, fn) { this.listeners[k] = fn; }
}
let instances, timers, serial, box;
beforeEach(() => {
  instances = []; timers = new Map(); serial = 0;
  globalThis.setTimeout = (fn, ms) => { timers.set(++serial, { fn, ms }); return serial; };
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.location = { protocol: 'http:', origin: 'http://localhost' };
  globalThis.document = { createElement: () => new Element(),
    getElementById: (id) => box?.children.find((el) => el.id === id) };
  globalThis.window = { YT: { Player: class {
    constructor(mount, options) { this.events = options.events; this.state = -1; this.plays = 0; instances.push(this); }
    playVideo() { this.plays++; }
    stopVideo() {}
    destroy() { this.destroyed = true; }
    getPlayerState() { return this.state; }
  } } };
});
function setup(callbacks = {}) {
  box = new Element();
  const overlay = new Element(), fallback = new Element(), message = new Element(), hint = new Element();
  const calls = [];
  const player = new VideoPlayer({ box, mountId: 'mount', overlay, fallback, message, hint, link: new Element(),
    onEnd: (t) => calls.push(['end', t]), onFail: (t) => calls.push(['fail', t]),
    onPlay: (t) => calls.push(['play', t]), onBlocked: (t) => calls.push(['blocked', t]), ...callbacks });
  return { player, overlay, fallback, message, hint, calls };
}
const emit = (p, event, data) => p.events[event]({ target: p, data });

test('blocked autoplay offers Tap to play, never fails, and state 1 reports a successful start', async () => {
  const s = setup(); await s.player.show('one', 1);
  const p = instances[0]; emit(p, 'onReady'); emit(p, 'onAutoplayBlocked');
  assert.equal(s.overlay.hidden, false); assert.deepEqual(s.calls, [['blocked', 1]]);
  s.overlay.listeners.click(); assert.equal(p.plays, 2);
  p.state = 1; emit(p, 'onStateChange', 1);
  assert.equal(s.overlay.hidden, true); assert.deepEqual(s.calls.at(-1), ['play', 1]);
});

test('duplicate errors and ended events are counted once; stopped and replaced attempts cannot report', async () => {
  const s = setup(); await s.player.show('same', 1); const first = instances[0];
  emit(first, 'onStateChange', 0); emit(first, 'onStateChange', 0);
  emit(first, 'onError', 101); emit(first, 'onError', 101);
  await s.player.show('same', 2); const second = instances[1];
  for (const event of ['onReady', 'onStateChange', 'onError', 'onAutoplayBlocked']) emit(first, event, 1);
  assert.equal(first.destroyed, true); assert.equal(first.plays, 0);
  emit(second, 'onStateChange', 1); s.player.stop();
  for (const event of ['onReady', 'onStateChange', 'onError', 'onAutoplayBlocked']) emit(second, event, 0);
  assert.deepEqual(s.calls, [['end', 1], ['fail', 1], ['play', 2]]);
  assert.equal(s.overlay.hidden, true);
});

test('late quiet-block and tap timers cannot uncover a stopped attempt', async () => {
  const s = setup(); await s.player.show('one', 1);
  emit(instances[0], 'onReady'); const watch = [...timers.values()][0].fn;
  s.overlay.listeners.click(); const tap = [...timers.values()].at(-1).fn;
  s.player.stop(); watch(); tap();
  assert.equal(s.overlay.hidden, true); assert.equal(s.hint.hidden, true);
  assert.deepEqual(s.calls, []);
});

test('wrapper and Auto integration pauses on third distinct failure and exposes a real Resume button', async () => {
  let advances = 0;
  const auto = createAutoAdvance({ enabled: true, isActive: () => true, advance: () => advances++,
    onPause: (paused) => paused ? s.player.showAutoPaused(() => auto.resume()) : s.player.clearAutoPaused() });
  const s = setup({ onFail: (t) => auto.fail(t), onPlay: (t) => auto.play(t), onBlocked: (t) => auto.blocked(t) });
  for (let i = 0; i < 3; i++) {
    await s.player.show(`v${i}`, auto.begin());
    emit(instances.at(-1), 'onError', 150); emit(instances.at(-1), 'onError', 150);
  }
  assert.equal(auto.paused, true); assert.equal(s.fallback.hidden, false);
  assert.equal(s.message.textContent, "3 videos in a row wouldn't play here. Auto paused.");
  const resume = s.message.children.at(-1);
  assert.equal(resume.type, 'button'); assert.equal(resume.textContent, 'Resume');
  resume.listeners.click(); assert.equal(auto.paused, false); assert.equal(advances, 1);
  await s.player.show('recovered', auto.begin()); emit(instances.at(-1), 'onStateChange', 1);
  await s.player.show('another-fail', auto.begin()); emit(instances.at(-1), 'onError', 101);
  assert.equal(auto.paused, false);
});
