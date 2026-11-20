import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class Element {
  constructor() {
    this.children = []; this.listeners = {}; this.dataset = {}; this.hidden = false;
    this.classList = { add() {}, toggle() {} }; this.style = { setProperty() {} }; this.open = false;
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
  const stored = {};
  globalThis.localStorage = { getItem: (k) => stored[k] ?? null, setItem(k, v) { stored[k] = String(v); } };
  globalThis.requestIdleCallback = (fn) => fn();
  let rafs = 0;
  globalThis.requestAnimationFrame = (fn) => { rafs++; fn(); };
  const timers = new Map(); let timerId = 0;
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; };
  globalThis.clearTimeout = (id) => timers.delete(id);
  const fire = () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); return timer.ms; };
  const songs = [1, 2, 3].map((o) => ({ id: 'song' + o, t: 'Song ' + o, by: 'Artist', o }));
  const song = songs[0];
  globalThis.fetch = async (path) => ({ ok: true, json: async () => path.includes('portraits') ? {} : { artists: [], songs, updated: 'today' } });
  const players = [];
  const h = globalThis.popHarness = {
    game: { top100: (s) => s, wheelSongs: () => [], dealRing: (pool) => [pool[0]], songRarity: () => ({ id: 'gold', label: 'Gold' }), collect: (col) => ({ col, isNew: true }), fmt: String, score: () => 1 },
    cards: { makeCard: () => { const el = new Element(); el.classList = { 1: 'gold', add() {}, toggle() {} }; return el; }, reveal: () => { h.reveals++; }, songModel: () => ({}), artistModel: () => ({}), setCardImage() {}, creditLine() {}, reduced: { matches: false } },
    player: { createPlayer: (host, callbacks) => { const p = { callbacks, plays: [], stops: 0, play(id, token) { this.plays.push({ id, token }); }, stop() { this.stops++; }, showAutoPaused(resume) { this.resume = resume; }, clearAutoPaused() { this.resume = null; } }; players.push(p); return p; } },
    roulette: { createRoulette: () => ({ stop() {} }), configureAutoplay() {} }, stage: { startCrowd() {} }, shell: { renderShell() {} },
    passport: { report() {}, loadSets: async () => [], checkSets: () => ({ completed: [] }) }, toast: { showToast() {} },
    sound: { Sound: class { constructor(enabled) { this.enabled = enabled; } unlock() {} } },
    pull: { PullMachine: class {
      constructor(opts) { this.opts = opts; this.generation = 0; h.machine = this; }
      setPool(items) { this.pool = items; this.opts.onCancel(); }
      activate() { this.active = true; }
      deactivate() { this.active = false; this.generation++; this.opts.onCancel(); }
      cancel() { this.generation++; this.opts.onCancel(); }
      pull(options = {}) { if (!this.active) return; this.generation++; this.opts.onPull(options); this.pulls ??= []; this.pulls.push(options); this.opts.onReveal(song, options); }
    } }, reveals: 0,
  };
  const stub = (key, names) => `data:text/javascript,${encodeURIComponent(names.map((name) => `export const ${name}=globalThis.popHarness.${key}.${name};`).join(''))}`;
  try {
    const appUrl = new URL('./src/app.js', import.meta.url);
    const stubs = {
      './game.js': ['game', Object.keys(h.game)], './cards.js': ['cards', Object.keys(h.cards)],
      './player.js': ['player', ['createPlayer']], './roulette.js': ['roulette', ['createRoulette', 'configureAutoplay']],
      './shell.js': ['shell', ['renderShell']], './stage.js': ['stage', ['startCrowd']],
      '../../src/pull-machine.js': ['pull', ['PullMachine']], '../../src/sound.js': ['sound', ['Sound']],
      '../../src/passport.js': ['passport', ['report', 'loadSets', 'checkSets']], '../../src/toast.js': ['toast', ['showToast']],
    };
    const source = (await readFile(appUrl, 'utf8')).replace(/from '(\.[^']+)'/g, (_, path) => {
      const stubbed = stubs[path];
      return 'from ' + JSON.stringify(stubbed ? stub(stubbed[0], stubbed[1]) : new URL(path, appUrl).href);
    });
    const app = await import(`data:text/javascript,${encodeURIComponent(source)}`);
    await app.start({
      side: 'pop', label: 'Pop', noun: 'artist', storage: 'test', deck: 'all', deckNote: '', chartMethod: 'Method.',
      pool: () => [], statStrip: (s) => [{ label: 'Views', value: '1' }, { label: 'Score', value: '' }],
    });
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
    // Result block: stats strip drops empty stats, Next walks the chart and wraps, Pull from is remembered.
    topMode.click(); // back on Top 100 (the pull above plays song 1 first)
    m.pull();
    const strip = get('#tStats');
    assert.equal(strip.hidden, false); assert.equal(strip.children.length, 1);
    assert.match(get('#tNext').textContent, /^Next: #2 Song 2$/);
    get('#tNext').click(); assert.equal(p.plays.at(-1).id, 'song2');
    get('#tNext').click(); assert.match(get('#tNext').textContent, /^Next: #1 Song 1$/);
    assert.equal(p.plays.at(-1).id, 'song3');
    get('#tNext').click(); assert.equal(p.plays.at(-1).id, 'song1'); // wraps
    const stops = p.stops;
    get('#r10').click();
    assert.equal(stored['test.range'], '10'); assert.equal(m.pool.length, 3);
    assert.equal(p.stops, stops, 'changing the range leaves the playing video alone');
  } finally {
    globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
  }
});
