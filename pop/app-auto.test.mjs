import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class Element {
  constructor() {
    this.children = []; this.listeners = {}; this.dataset = {}; this.hidden = false;
    this.classList = { add() {}, toggle() {} }; this.style = {}; this.open = false;
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  click() { this.listeners.click?.({ target: this }); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute() {}
  querySelector(selector) { this.parts ??= {}; return this.parts[selector] ||= new Element(); }
  querySelectorAll() { return []; }
  closest(selector) { return selector === '[hidden]' && (this.hidden || this.hiddenParent) ? this : null; }
  scrollIntoView() {}
}

test('Top 100 Auto skips stale timers, resumes after three failures, plays hidden, and stops on mode exit', async () => {
  const elements = new Map();
  const get = (selector) => {
    if (!elements.has(selector)) { const el = new Element(); el.parts = {}; elements.set(selector, el); }
    return elements.get(selector);
  };
  const chartAuto = get('#chartAuto'); chartAuto.nextElementSibling = new Element();
  const topMode = new Element(); topMode.dataset.mode = 'top100';
  const rouletteMode = new Element(); rouletteMode.dataset.mode = 'roulette';
  const doc = globalThis.document = {
    hidden: false, createElement: () => { const el = new Element(); el.parts = {}; return el; },
    createDocumentFragment: () => new Element(), querySelector: get,
    querySelectorAll: (s) => s === '.top .toggle button' ? [topMode, rouletteMode] : [],
    addEventListener() {},
  };
  globalThis.window = { addEventListener() {} };
  globalThis.addEventListener = () => {};
  globalThis.location = { hash: '#top100' };
  globalThis.history = { replaceState() {} };
  globalThis.innerWidth = 1000;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  let rafs = 0;
  globalThis.requestAnimationFrame = (fn) => { rafs++; fn(); };
  const timers = new Map(); let timerId = 0;
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; };
  globalThis.clearTimeout = (id) => timers.delete(id);
  const fire = () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); return timer.ms; };
  const song = { id: 'song', t: 'Song', by: 'Artist', o: 1 };
  globalThis.fetch = async (path) => ({ ok: true, json: async () => path.includes('portraits') ? {} : { artists: [], songs: [song], updated: 'today' } });
  const players = [];
  const h = globalThis.popHarness = {
    game: { top100: (s) => s, wheelSongs: () => [], dealRing: () => [song], songRarity: () => ({ id: 'gold', label: 'Gold' }), collect: (col) => ({ col, isNew: true }), fmt: String, score: () => 1 },
    cards: { makeCard: () => { const el = new Element(); el.classList = { 1: 'gold', add() {}, toggle() {} }; return el; }, reveal: () => { h.reveals++; }, songModel: () => ({}), artistModel: () => ({}), setCardImage() {}, creditLine() {}, reduced: { matches: false } },
    player: { createPlayer: (host, callbacks) => { const p = { callbacks, plays: [], play(id, token) { this.plays.push({ id, token }); }, stop() {}, showAutoPaused(resume) { this.resume = resume; }, clearAutoPaused() { this.resume = null; } }; players.push(p); return p; } },
    roulette: { createRoulette: () => ({ stop() {} }) }, stage: { startCrowd() {} },
    sound: { Sound: class { constructor(enabled) { this.enabled = enabled; } unlock() {} } },
    pull: { PullMachine: class {
      constructor(opts) { this.opts = opts; this.generation = 0; h.machine = this; }
      setPool() { this.opts.onCancel(); }
      activate() { this.active = true; }
      deactivate() { this.active = false; this.generation++; this.opts.onCancel(); }
      cancel() { this.generation++; this.opts.onCancel(); }
      pull(options = {}) { if (!this.active) return; this.generation++; this.opts.onPull(options); this.pulls ??= []; this.pulls.push(options); this.opts.onReveal(song, options); }
    } }, reveals: 0,
  };
  const stub = (key, names) => `data:text/javascript,${encodeURIComponent(names.map((name) => `export const ${name}=globalThis.popHarness.${key}.${name};`).join(''))}`;
  try {
    let source = await readFile(new URL('./src/app.js', import.meta.url), 'utf8');
    for (const [path, key, names] of [
      ['./game.js', 'game', Object.keys(h.game)], ['./cards.js', 'cards', Object.keys(h.cards)],
      ['./player.js', 'player', ['createPlayer']], ['./roulette.js', 'roulette', ['createRoulette']],
      ['./stage.js', 'stage', ['startCrowd']], ['../../src/pull-machine.js', 'pull', ['PullMachine']],
      ['../../src/sound.js', 'sound', ['Sound']],
    ]) source = source.replace(`'${path}'`, JSON.stringify(stub(key, names)));
    source = source.replace("'../../src/auto-advance.js'", JSON.stringify(new URL('../src/auto-advance.js', import.meta.url).href));
    await import(`data:text/javascript,${encodeURIComponent(source)}`);
    const p = players[0], m = h.machine;
    chartAuto.checked = true; chartAuto.listeners.change();
    assert.equal(p.plays.length, 1);
    p.callbacks.onEnd(p.plays.at(-1).token);
    assert.equal(timers.size, 1);
    m.pull(); // manual Skip invalidates the pending advance
    assert.equal(timers.size, 0);
    p.callbacks.onEnd(p.plays.at(-1).token);
    doc.hidden = true;
    const beforeRafs = rafs, beforeReveals = h.reveals;
    assert.equal(fire(), 1200);
    assert.deepEqual(m.pulls.at(-1), { short: true, immediate: true });
    assert.equal(rafs, beforeRafs); assert.equal(h.reveals, beforeReveals + 1);
    doc.hidden = false;
    for (let i = 0; i < 3; i++) {
      p.callbacks.onFail(p.plays.at(-1).token);
      if (i < 2) assert.equal(fire(), 4000);
    }
    assert.equal(chartAuto.nextElementSibling.textContent, 'paused');
    assert.equal(typeof p.resume, 'function'); p.resume();
    assert.equal(chartAuto.nextElementSibling.textContent, 'on');
    p.callbacks.onEnd(p.plays.at(-1).token);
    assert.equal(timers.size, 1);
    rouletteMode.click(); assert.equal(timers.size, 0);
    const count = p.plays.length;
    topMode.click(); assert.equal(p.plays.length, count);
  } finally {
    globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
  }
});
