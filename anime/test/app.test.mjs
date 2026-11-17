import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';

// Exercise the real wiring, PullMachine, Auto and Pop player with a controlled DOM/YouTube clock.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = new Map();
    this.style = { setProperty() {} }; this.classes = new Set(); this.hidden = false; this.offsetWidth = 96;
    this.classList = {
      add: (...names) => names.forEach((n) => this.classes.add(n)),
      remove: (...names) => names.forEach((n) => this.classes.delete(n)),
      toggle: (n, on) => on ? this.classes.add(n) : this.classes.delete(n),
    };
  }
  set className(value) { this.classes = new Set(value.split(' ')); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map((c) => typeof c === 'string' ? c : c.textContent).join(''); }
  append(...children) { for (const child of children) { this.children.push(child); if (typeof child === 'object') child.parentElement = this; } }
  replaceChildren(...children) { this.text = ''; this.children = []; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this); }
  after(child) { this.parentElement?.append(child); }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  fire(name, event = {}) { if (name === 'click' && this.disabled) return; for (const fn of this.listeners.get(name) || []) fn({ target: this, ...event }); }
  matches(selector) {
    if (selector === '[data-use]') return !!this.dataset.use;
    if (selector === '.card[data-song]') return this.classes.has('card') && !!this.dataset.song;
    return selector.startsWith('#') ? this.id === selector.slice(1) : this.classes.has(selector.slice(1));
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
  querySelectorAll(selector) { return this.children.filter((c) => typeof c === 'object').flatMap((c) => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 375, height: 300 }; }
  scrollIntoView() {}
}

let serial = 0, now, timers, frames, instances, refs, store, root, globalEvents;
const video = (id, kind = 'tv') => ({ id, kind, source: 'official' });
const song = (id, use, show, videos) => ({ id, title: `Title ${id}`, artist: 'Artist', kind: 'theme', use, show, year: 2004, videos });
const fixture = [song('a', 'OP', 'Naruto', [video('a1', 'creditless'), video('a2'), video('a3', 'mv')]),
  song('b', 'OP', 'One Piece', [video('b1'), video('b2')]), song('ed', 'ED', 'Bleach', [video('ed1')]),
  song('in', 'IN', 'Naruto', [video('in1')]), { ...song('mv', 'MV', undefined, [video('mv1', 'mv')]), source: 'Animated film', kind: 'animated-mv' }];
const kinds = [{ id: 'theme', addon: false, default: true }, { id: 'animated-mv', label: 'Animated MVs', addon: true, default: true }];

async function setup(saved = {}, { songs = fixture, failFetch = false, blockedStorage = false } = {}) {
  now = 0; timers = new Map(); frames = new Map(); instances = []; store = new Map(Object.entries(saved));
  root = new Element(); globalEvents = new Element(); refs = {};
  for (const id of ['genre', 'ring', 'ringBtn', 'pull', 'auto', 'autoState', 'sound', 'addons', 'songCount', 'pageStatus',
    'announce', 'result', 'songCard', 'player', 'nowTitle', 'nowMeta', 'copyLabel', 'swap', 'playStatus']) {
    refs[id] = Object.assign(new Element(), { id }); root.append(refs[id]);
  }
  refs.pull.textContent = 'Pull'; refs.ringBtn.setAttribute('aria-label', 'Pull a song');
  refs.result.hidden = true;
  const chips = ['OP', 'ED', 'IN'].map((use) => { const el = new Element('button'); el.dataset.use = use; root.append(el); return el; });
  const stage = new Element(); root.append(stage); refs.ring.remove(); stage.append(refs.ring);
  const media = () => ({ matches: true });
  globalThis.document = { hidden: false, visibilityState: 'visible', documentElement: new Element(), head: new Element(),
    createElement: (tag) => new Element(tag), getElementById: (id) => refs[id],
    querySelector: (s) => root.querySelector(s), querySelectorAll: (s) => root.querySelectorAll(s),
    addEventListener: (...args) => globalEvents.addEventListener(...args), removeEventListener: (...args) => globalEvents.removeEventListener(...args) };
  globalThis.window = { matchMedia: media, addEventListener: (...args) => globalEvents.addEventListener(...args),
    removeEventListener: (...args) => globalEvents.removeEventListener(...args), YT: { Player: class {
      constructor(mount, options) { this.id = options.videoId; this.events = options.events; this.plays = 0; instances.push(this); }
      destroy() { this.destroyed = true; }
      playVideo() { this.plays++; }
    } } };
  Object.assign(globalThis, {
    innerWidth: 375, matchMedia: media, location: { search: '?lite=1' },
    addEventListener: (...args) => globalEvents.addEventListener(...args),
    ResizeObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#ff2d55' }),
    fetch: async (path) => ({ ok: !failFetch, json: async () => path.endsWith('kinds.json') ? kinds : { songs } }),
    localStorage: { getItem(key) { if (blockedStorage) throw new Error('storage denied'); return store.get(key) ?? null; },
      setItem(key, value) { if (blockedStorage) throw new Error('storage denied'); store.set(key, String(value)); } },
    setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, due: now + delay, delay }); return id; },
    clearTimeout: (id) => timers.delete(id), requestAnimationFrame: (fn) => { const id = ++serial; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: (a) => a.fill(0) } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  await import(`../src/app.js?test=${++serial}`);
  return { chips };
}
function frame() { now += 350; const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(now)); }
async function time(delay) {
  now += delay;
  for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.fn(); }
  await settle();
}
async function pull() { refs.pull.fire('click'); frame(); await time(500); }
const latest = () => instances.at(-1);
const emit = (p, name, data) => p.events[name]({ target: p, data });
async function failAll() {
  let previous;
  while (latest() !== previous) {
    previous = latest(); emit(previous, 'onError', 101); await settle();
  }
}

test('page boots at phone width, renders cards/metadata, pulls and swaps immediately with stale events ignored', async () => {
  await setup(); assert.equal(refs.songCount.textContent, '5 songs'); assert.equal(instances.length, 0);
  assert.equal(refs.ring.children.length, 10); assert.equal(refs.pull.disabled, false);
  await pull(); assert.equal(latest().id, 'a1');
  assert.equal(refs.nowTitle.textContent, 'Title a — Artist'); assert.equal(refs.nowMeta.textContent, 'Naruto · Opening · 2004');
  assert.equal(refs.copyLabel.textContent, 'Creditless · official'); assert.equal(refs.swap.textContent, 'Version 1/3 ⇄');
  const old = latest(); emit(old, 'onReady'); assert.equal(old.plays, 1);
  refs.swap.fire('click'); await settle(); assert.equal(latest().id, 'a2'); assert.equal(old.destroyed, true);
  assert.equal(store.get('anime.copy.a'), 'a2');
  for (const name of ['onStateChange', 'onError', 'onAutoplayBlocked']) emit(old, name, 101);
  assert.equal(store.has('anime.strikes'), false);
  refs.swap.fire('click'); await settle(); assert.equal(latest().id, 'a3');
  refs.swap.fire('click'); await settle(); assert.equal(latest().id, 'a1');
});

test('preferred copies and local strikes restore; successful backups do not count as failed songs', async () => {
  await setup({ 'anime.copy.a': 'a3', 'anime.strikes': JSON.stringify({ a1: 3 }), 'anime.auto': 'on' });
  await pull(); assert.equal(latest().id, 'a3'); assert.equal(refs.swap.textContent, 'Version 1/2 ⇄');
  const old = latest(); emit(old, 'onError', 150); emit(old, 'onError', 150); await settle();
  assert.equal(latest().id, 'a2'); assert.deepEqual(JSON.parse(store.get('anime.strikes')), { a1: 3, a3: 1 });
  emit(latest(), 'onStateChange', 1); assert.equal(refs.autoState.textContent, 'on');
  assert.equal([...timers.values()].some((t) => t.delay === 4000), false);
});

test('all copies fail once each; Auto counts songs, waits four seconds and pauses on the third with Resume', async () => {
  await setup({ 'anime.auto': 'on' }); await pull();
  await failAll(); assert.deepEqual(JSON.parse(store.get('anime.strikes')), { a1: 1, a2: 1, a3: 1 });
  assert.equal(root.querySelector('.fallback').children[0].href, 'https://www.youtube.com/watch?v=a3');
  assert.equal([...timers.values()].filter((t) => t.delay === 4000).length, 1);
  await time(3999); assert.equal(latest().id, 'a3');
  await time(1); frame(); await settle(); assert.equal(latest().id, 'b1');
  await failAll(); await time(4000); frame(); await settle(); assert.equal(latest().id, 'ed1');
  await failAll(); assert.equal(refs.autoState.textContent, 'paused');
  const message = root.querySelector('.auto-paused'); assert.ok(message);
  assert.equal([...timers.values()].some((t) => t.delay === 4000), false);
  message.children.at(-1).fire('click'); frame(); await settle();
  assert.equal(refs.autoState.textContent, 'on'); assert.equal(root.querySelector('.auto-paused'), null);
});

test('error 153 and autoplay blocking never strike or schedule a skip', async () => {
  await setup({ 'anime.auto': 'on' }); await pull();
  const first = latest(); emit(first, 'onAutoplayBlocked');
  const tap = refs.player.querySelector('.tap-to-play'); assert.ok(tap); tap.fire('click'); assert.equal(first.plays, 1);
  emit(first, 'onError', 153); await settle();
  assert.equal(store.has('anime.strikes'), false); assert.equal(instances.length, 1);
  assert.match(refs.playStatus.textContent, /153/); assert.equal(refs.autoState.textContent, 'on');
  assert.equal([...timers.values()].some((t) => t.delay === 4000), false);
});

test('ended Auto advances immediately in a hidden tab; manual swaps cancel pending end timers', async () => {
  await setup({ 'anime.auto': 'on' }); await pull();
  emit(latest(), 'onStateChange', 0); const stale = [...timers.values()].find((t) => t.delay === 1200).fn;
  refs.swap.fire('click'); await settle(); stale(); await settle(); assert.equal(latest().id, 'a2');
  emit(latest(), 'onStateChange', 1); emit(latest(), 'onStateChange', 0); emit(latest(), 'onStateChange', 0);
  document.hidden = true; await time(1200);
  assert.equal(latest().id, 'b1'); assert.equal(refs.ring.dataset.pullState, 'idle');
  assert.equal(frames.size, 0); assert.equal(refs.swap.textContent, 'Version 1/2 ⇄');
});

test('filters retain one theme use, persist add-ons and cancel playback; single copies hide swap', async () => {
  const { chips } = await setup(); await pull(); const old = latest();
  chips[0].fire('click'); chips[1].fire('click'); chips[2].fire('click');
  assert.deepEqual(JSON.parse(store.get('anime.uses')), ['IN']); assert.equal(refs.result.hidden, true);
  assert.equal(old.destroyed, true); emit(old, 'onError', 101); assert.equal(store.has('anime.strikes'), false);
  const addon = refs.addons.children[0].children[0]; addon.checked = false; addon.fire('change');
  assert.equal(store.get('anime.addon.animated-mv'), 'off'); assert.equal(refs.songCount.textContent, '1 song');
  await pull(); assert.equal(latest().id, 'in1'); assert.equal(refs.swap.hidden, true);
  assert.equal(refs.nowMeta.textContent, 'Naruto · Insert song · 2004');
});

test('empty results disable Pull and ring; data fetch failures display a retry message', async () => {
  await setup({ 'anime.uses': '["ED"]', 'anime.addon.animated-mv': 'off' }, { songs: fixture.filter((s) => s.use === 'OP') });
  assert.equal(refs.pull.disabled, true); assert.equal(refs.ringBtn.disabled, true);
  assert.equal(refs.pull.getAttribute('aria-disabled'), 'true');
  globalEvents.fire('resize'); assert.equal(refs.pull.getAttribute('aria-disabled'), 'true');
  assert.equal(refs.pageStatus.textContent, 'No songs match. Turn a filter back on.');
  refs.pull.fire('click'); assert.equal(instances.length, 0);
  await setup({}, { failFetch: true }); assert.equal(refs.pull.disabled, true);
  assert.equal(refs.pageStatus.textContent, 'Could not load the song data. Reload to try again.');
});

test('damaged or unavailable storage does not stop boot or playback; pagehide cancels stale callbacks', async () => {
  await setup({ 'anime.uses': '{}', 'anime.strikes': 'null' }); assert.equal(refs.songCount.textContent, '5 songs');
  await setup({}, { blockedStorage: true }); await pull(); const old = latest();
  emit(old, 'onStateChange', 0); globalEvents.fire('pagehide');
  await time(1200); emit(old, 'onError', 101); assert.equal(instances.length, 1);
  globalEvents.fire('pageshow', { persisted: true }); assert.equal(refs.pull.disabled, false);
  await pull(); assert.equal(instances.length, 2);
});
