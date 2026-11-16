// "K-pop Top 100" mode: a ring of photocards on a concert stage. Pull one and it flies out,
// flips over as a holographic card, the lightstick crowd turns its colour and the MV plays.
// Data comes from data/charts.json (built by scripts/charts.mjs).

import { cryptoInt } from './game.js';
import { VideoPlayer } from './player.js';
import * as fx from './fx.js';
import { makeCard, songCard, playIn, collection, openBinder } from './card.js';
import { artNode } from './art.js';

const $ = (id) => document.getElementById(id);
const SLOTS = 14;
const STEP = 360 / SLOTS;
const CANDY = ['#ff4fa3', '#ffe45c', '#6ff2c8', '#b693ff', '#7fd0ff'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mod = (a, n) => ((a % n) + n) % n;
let chartFetch = null;
/** data/charts.json, fetched once and shared by both screens. */
export const loadChartData = () => (chartFetch ??= fetch('data/charts.json', { cache: 'no-cache' })
  .then((r) => { if (!r.ok) throw new Error('charts'); return r.json(); })
  .catch((e) => { chartFetch = null; throw e; }));

const thumb = (id, size = 'mqdefault') => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${size}.jpg`;
export const short = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}B` : `${Math.round(n / 1e6)}M`);
export const tierOf = (rank) => (!rank || rank > 100 ? 'common' : rank <= 10 ? 'legend' : rank <= 30 ? 'epic' : 'rare');
const overall = (s) => s.overall ?? s.rank;
const TIER_LABEL = { legend: 'LEGEND', epic: 'EPIC', rare: 'RARE' };

/** A stable, bright colour per artist. */
export function colorOf(artist) {
  let h = 0;
  for (const ch of artist) h = (h * 31 + ch.codePointAt(0)) % 360;
  return hslToRgb(h, 0.95, 0.64);
}
function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
/** "#rrggbb" or "rgb(r, g, b)" -> [r, g, b] */
export const toRgb = (c) => (c.startsWith('#') ? hexToRgb(c) : c.match(/d+/g).slice(0, 3).map(Number));
const hexToRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const css = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

// ---------- lightstick crowd ----------
export class Crowd {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sticks = [];
    this.hype = 0; // 0 calm .. 1 spinning
    this.pulse = -1e9;
    this.running = false;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width; this.h = r.height;
    const old = this.sticks;
    this.sticks = [];
    for (let row = 0; row < 3; row++) {
      const gap = 13 + row * 7;
      for (let x = (row % 2) * gap / 2 - 4; x < this.w + 8; x += gap) {
        const i = this.sticks.length;
        const c = old[i]?.to || hexToRgb(CANDY[i % CANDY.length]);
        this.sticks.push({ x: x + (Math.random() - 0.5) * 6, row, phase: Math.random() * 6.28, from: c, to: c, at: 0, delay: 0 });
      }
    }
    if (!this.running) this.draw(performance.now());
  }

  /** Sweep a colour across the crowd from left to right (null = mixed candy colours). */
  setColor(rgb) {
    const now = performance.now();
    this.sticks.forEach((s, i) => {
      s.from = this.colorAt(s, now);
      s.to = rgb || hexToRgb(CANDY[i % CANDY.length]);
      s.at = now;
      s.delay = (s.x / Math.max(this.w, 1)) * 700;
    });
    this.pulse = now;
    if (!this.running) this.draw(now + 2000);
  }

  colorAt(s, now) {
    const t = Math.max(0, Math.min(1, (now - s.at - s.delay) / 350));
    return t >= 1 ? s.to : mix(s.from, s.to, t);
  }

  start() {
    if (fx.prefersReducedMotion() || fx.isLite()) { this.draw(performance.now() + 2000); return; }
    this.running = true;
    if (!this.io && typeof IntersectionObserver === 'function') { // no drawing while scrolled out of view
      this.onScreen = true;
      this.io = new IntersectionObserver(([e]) => { this.onScreen = e.isIntersecting; if (this.onScreen) this.#tick(); });
      this.io.observe(this.canvas);
    }
    this.#tick();
  }

  #tick() {
    if (this.ticking || !this.running || this.onScreen === false) return;
    this.ticking = true;
    let last = 0;
    const loop = (t) => {
      if (!this.running || this.onScreen === false || fx.isLite()) { this.ticking = false; if (fx.isLite()) { this.running = false; this.draw(t + 2000); } return; }
      if (t - last >= 30) { last = t; this.draw(t); } // ~30 fps is plenty for swaying light sticks
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  draw(now) {
    const { ctx, w, h } = this;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const speed = 0.0022 + this.hype * 0.006;
    const amp = 4 + this.hype * 7;
    const since = now - this.pulse;
    for (const s of this.sticks) {
      const size = 2.2 + s.row * 1.5;
      const base = h * (0.3 + s.row * 0.24);
      // A "wave" ripples from left to right after each reveal.
      const wave = since < 2200 ? Math.max(0, Math.sin(Math.min(Math.PI, (since - (s.x / w) * 900) / 260))) * 16 : 0;
      const sway = Math.sin(now * speed + s.phase + s.x * 0.015) * amp;
      const x = s.x + sway * 0.6;
      const y = base - Math.abs(sway) * 0.4 - wave;
      const c = this.colorAt(s, now);
      const alpha = 0.45 + s.row * 0.22;
      ctx.strokeStyle = `rgba(255,255,255,${0.12 + s.row * 0.08})`;
      ctx.lineWidth = 1 + s.row * 0.6;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - sway * 0.25, y + size * 5); ctx.stroke();
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.12 * alpha})`;
      ctx.beginPath(); ctx.arc(x, y, size * 3.2, 0, 6.283); ctx.fill();
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.4 * alpha})`;
      ctx.beginPath(); ctx.arc(x, y, size * 1.7, 0, 6.283); ctx.fill();
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
      ctx.beginPath(); ctx.arc(x, y, size, 0, 6.283); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.7 * alpha})`;
      ctx.beginPath(); ctx.arc(x, y, size * 0.45, 0, 6.283); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ---------- the mode ----------
export class Charts {
  constructor({ sound, store }) {
    this.sound = sound;
    this.store = store;
    this.data = null;
    this.list = store.get('chart.list', 'pro') === 'new' ? 'new' : 'pro';
    this.range = Number(store.get('chart.range', '100')) || 100;
    this.angle = 0;
    this.slots = [];
    this.current = null;
    this.recent = [];
    this.busy = false;
    this.active = false;
    this.idleRaf = 0;
    this.player = new VideoPlayer({
      box: $('stageBox'), mountId: 'stagePlayer', overlay: $('stageOverlay'), fallback: $('stageFallback'),
      message: $('stageMsg'), link: $('stageLink'), hint: $('stageHint'),
    });
    this.crowd = new Crowd($('crowd'));
    this.#bind();
  }

  get songs() { return this.data ? (this.list === 'new' ? this.data.newbie : this.data.top) : []; }
  get pool() { return this.songs.slice(0, this.range); }

  async load() {
    if (this.data) return true;
    try {
      this.data = await loadChartData();
    } catch {
      this.#say('Could not load the chart. Run "npm run charts", then reload.');
      return false;
    }
    this.#buildRing();
    this.#renderControls();
    this.#renderList();
    this.#say(this.#intro());
    return true;
  }

  /** Ticker text for the header. */
  tickerItems() {
    return this.songs.slice(0, 20).map((s) => `#${s.rank} ${s.title} · ${s.artist}`);
  }

  async activate() {
    this.active = true;
    if (!(await this.load())) return;
    this.crowd.resize();
    this.crowd.start();
    this.#idleSpin();
  }

  deactivate() {
    this.active = false;
    this.crowd.stop();
    cancelAnimationFrame(this.idleRaf);
    this.player.stop();
  }

  // ---------- rendering ----------
  #say(text) { $('chartsAnnounce').textContent = text; }

  #intro() {
    const what = this.list === 'new' ? 'Easy 100' : 'Real 100';
    return `${what} · Top ${this.range}: pull a photocard to play its music video.`;
  }

  #renderControls() {
    $('listPro').setAttribute('aria-checked', String(this.list === 'pro'));
    $('listNew').setAttribute('aria-checked', String(this.list === 'new'));
    $('listPro').tabIndex = this.list === 'pro' ? 0 : -1;
    $('listNew').tabIndex = this.list === 'new' ? 0 : -1;
    $('listNote').textContent = this.list === 'new' ? 'Hand-picked first loves.' : 'The all-time chart, by streams and views.';
    for (const n of [10, 50, 100]) $(`r${n}`).setAttribute('aria-pressed', String(this.range === n));
    $('chartName').textContent = this.list === 'new' ? 'New to K-pop: 100 easy first loves' : 'The all-time K-pop Top 100';
    $('method').textContent = this.list === 'new'
      ? 'Hand-picked entry points (English hooks, crossover hits, viral dances, soundtrack songs), ordered by the same score as the Top 100.'
      : `Ranked by the average of Spotify streams and official music video views on YouTube. Source: kworb.net, ${this.data.updated}.`;
  }

  #renderList() {
    const top = this.songs[0]?.score || 1;
    const rows = this.songs.map((s) => {
      const btn = el('button', { class: 'row', type: 'button', 'aria-label': `Play number ${s.rank}: ${s.title} by ${s.artist}` },
        el('span', { class: `row-rank ${tierOf(overall(s))}`, text: String(s.rank) }),
        el('img', { class: 'row-thumb', src: thumb(s.videoId), alt: '', loading: 'lazy', width: '64', height: '36' }),
        el('span', { class: 'row-text' },
          el('b', { text: s.title }),
          el('span', { text: s.vibe ? `${s.artist} · ${s.vibe}` : s.artist })),
        el('span', { class: 'row-score' },
          el('span', { class: 'bar', style: `--w:${((s.score / top) * 100).toFixed(1)}%;--c:${css(colorOf(s.artist))}` }),
          el('small', { text: `${short(s.streams)} ▸ ${short(s.views)}` })));
      btn.addEventListener('click', () => { this.sound.unlock(); this.reveal(s, { fromList: true }); });
      return el('li', {}, btn);
    });
    $('chartList').replaceChildren(...rows);
  }

  #buildRing() {
    const ring = $('ring');
    ring.replaceChildren();
    this.slots = [];
    for (let i = 0; i < SLOTS; i++) {
      const img = el('canvas', { class: 'pc-art' });
      const rank = el('span', { class: 'pc-rank' });
      const card = el('div', { class: 'pc' },
        el('div', { class: 'pc-front' }, img, el('span', { class: 'pc-shine' }), rank),
        el('div', { class: 'pc-back' }, el('span', { text: '♥' })));
      ring.append(card);
      const slot = { card, img, rank, song: null };
      this.slots.push(slot);
      this.#fill(slot, this.#randomSong());
    }
    this.#layoutRing();
    new ResizeObserver(() => this.#layoutRing()).observe($('stage'));
  }

  #layoutRing() {
    const w = this.slots[0]?.card.offsetWidth || 110;
    this.radius = Math.round((w * 1.14) / (2 * Math.tan(Math.PI / SLOTS)));
    this.slots.forEach((s, i) => { s.base = `rotateY(${i * STEP}deg) translateZ(${this.radius}px)`; s.card.style.transform = s.base; });
    this.#applyAngle();
  }

  #applyAngle() {
    $('ring').style.transform = `translateZ(${-this.radius}px) rotateX(-7deg) rotateY(${this.angle}deg)`;
  }

  #fill(slot, song) {
    slot.song = song;
    slot.img = artNode(slot.img, songCard(song).art, 'small', 'pc-art', '122px');
    slot.rank.textContent = `#${song.rank}`;
    slot.card.style.setProperty('--c', css(colorOf(song.artist)));
    slot.card.dataset.tier = tierOf(overall(song));
  }

  #randomSong() {
    // No song twice on the ring when the list is big enough.
    const showing = new Set(this.slots.map((s) => s.song));
    const pool = this.pool.length > SLOTS ? this.pool.filter((s) => !showing.has(s)) : this.pool;
    return pool[cryptoInt(pool.length)];
  }

  #frontIndex() { return mod(Math.round(-this.angle / STEP), SLOTS); }

  #idleSpin() {
    cancelAnimationFrame(this.idleRaf);
    if (fx.prefersReducedMotion()) return;
    let last = performance.now();
    const loop = (t) => {
      if (!this.active) return;
      if (!this.busy && !this.current?.lifted) {
        this.angle -= ((t - last) / 1000) * 7;
        this.#applyAngle();
      }
      last = t;
      this.idleRaf = requestAnimationFrame(loop);
    };
    this.idleRaf = requestAnimationFrame(loop);
  }

  // ---------- actions ----------
  #pick() {
    const pool = this.pool;
    let i;
    for (let tries = 0; tries < 8; tries++) {
      i = cryptoInt(pool.length);
      if (!this.recent.includes(pool[i].rank) || pool.length <= this.recent.length) break;
    }
    this.recent = [pool[i].rank, ...this.recent].slice(0, Math.min(6, pool.length - 1));
    return pool[i];
  }

  async pull() {
    if (this.busy || !this.data) return;
    this.busy = true;
    this.sound.unlock();
    $('stage').classList.add('spinning');
    $('pullStamp').hidden = true;
    for (const id of ['pullBtn', 'quickBtn', 'ringBtn']) $(id).setAttribute('aria-disabled', 'true');
    this.#dropLift();

    const song = this.#pick();
    // Put the winner on the card at the back of the ring, then spin it round to the front.
    const k = mod(this.#frontIndex() + SLOTS / 2, SLOTS);
    this.#fill(this.slots[k], song);
    const reduced = fx.prefersReducedMotion();
    const start = this.angle;
    const target = -k * STEP;
    const turns = reduced ? 0 : 3;
    const end = start - (turns * 360 + mod(start - target, 360));
    const duration = reduced ? 350 : 3600;
    this.crowd.hype = 1;
    this.#say('Shuffling the deck…');

    await new Promise((done) => {
      const t0 = performance.now();
      let lastTick = Math.floor(start / STEP);
      const frame = (t) => {
        const p = Math.min(1, (t - t0) / duration);
        const e = 1 - Math.pow(1 - p, 4);
        this.angle = start + (end - start) * e;
        this.#applyAngle();
        const tick = Math.floor(this.angle / STEP);
        if (tick !== lastTick) {
          lastTick = tick;
          this.sound.tick();
          // Cards passing behind the ring get a fresh song, so the deck feels like 100 cards.
          const back = mod(this.#frontIndex() + SLOTS / 2, SLOTS);
          if (back !== k && p < 0.8) this.#fill(this.slots[back], this.#randomSong());
        }
        if (p < 1) requestAnimationFrame(frame); else done();
      };
      requestAnimationFrame(frame);
    });

    this.crowd.hype = 0;
    const slot = this.slots[k];
    slot.card.classList.add('lifted');
    slot.card.style.transform = `${slot.base} translateZ(70px) translateY(-6px) scale(1.12)`;
    this.current = { slot, lifted: true };
    $('stage').classList.remove('spinning');

    const tier = tierOf(overall(song));
    const stamp = $('pullStamp');
    stamp.textContent = `${TIER_LABEL[tier]} PULL!`;
    stamp.dataset.tier = tier;
    stamp.hidden = false;
    this.#setAccent(song);
    const r = $('stage').getBoundingClientRect();
    fx.confetti($('fx'), r.left + r.width / 2, r.top + r.height * 0.4, css(colorOf(song.artist)));
    this.sound.fanfare();
    this.#say(`#${song.rank}: ${song.title} by ${song.artist}!`);
    await sleep(reduced ? 500 : 1300);
    for (const id of ['pullBtn', 'quickBtn', 'ringBtn']) $(id).setAttribute('aria-disabled', 'false');
    this.busy = false;
    this.reveal(song);
  }

  quick() {
    if (this.busy || !this.data) return;
    this.sound.unlock();
    this.#dropLift();
    const song = this.#pick();
    this.sound.fanfare();
    this.reveal(song, { fromList: true });
  }

  #dropLift() {
    if (this.current?.slot) {
      const { slot } = this.current;
      slot.card.classList.add('settle');
      slot.card.classList.remove('lifted');
      slot.card.style.transform = slot.base;
      setTimeout(() => slot.card.classList.remove('settle'), 700);
    }
    this.current = null;
  }

  #setAccent(song) {
    const rgb = colorOf(song.artist);
    document.documentElement.style.setProperty('--accent', css(rgb));
    this.crowd.setColor(rgb);
  }

  /** Show the holographic card for a song and play its video. */
  reveal(song, { fromList = false } = {}) {
    this.song = song;
    if (fromList) { this.#dropLift(); this.#setAccent(song); }
    const data = songCard(song);
    const card = makeCard(data, { isNew: collection.add('song', data.key) });
    this.onCollect?.();
    $('songCardSlot').replaceChildren(card);
    playIn(card, { reduced: fx.prefersReducedMotion() });

    const stat = (label, value, note) => [el('dt', { text: label }), el('dd', {}, el('b', { text: value }), note ? el('small', { text: note }) : '')];
    $('stats').replaceChildren(
      ...stat('Spotify streams', short(song.streams)),
      ...stat('MV views', short(song.views)),
      ...stat('Score', short(song.score), 'average of both'),
    );
    const next = this.songs[song.rank]; // rank is 1-based, so this is the next one down
    $('nextPull').hidden = !next;
    if (next) $('nextPull').textContent = `Next: #${next.rank} ${next.title}`;

    $('pull').hidden = false;
    this.player.show(new URLSearchParams(location.search).get('forceVideo') || song.videoId);
    this.#say(`Now playing #${song.rank}: ${song.title} by ${song.artist}.`);
    $('pull').scrollIntoView({ block: 'start', behavior: fx.prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  /** Switch list from outside (URL hash). Before the chart has loaded it only records the choice. */
  chooseList(list) {
    if (list !== 'pro' && list !== 'new') return;
    if (this.data) this.#setList(list);
    else { this.list = list; this.store.set('chart.list', list); }
  }

  /** Songs of the current list the viewer has collected. */
  collectedCount() { return this.data ? collection.count('song', this.songs.map((s) => songCard(s).key)) : 0; }

  openCollection() {
    if (!this.data) return;
    openBinder({
      title: this.list === 'new' ? 'Easy 100 cards' : 'Top 100 cards',
      kind: 'song', cards: this.songs.map(songCard), reduced: fx.prefersReducedMotion(),
    });
  }

  #setList(list) {
    if (this.busy || this.list === list) return;
    this.list = list;
    this.store.set('chart.list', list);
    this.recent = [];
    this.#renderControls();
    this.#renderList();
    this.slots.forEach((s) => this.#fill(s, this.#randomSong()));
    this.onListChange?.();
    this.#say(this.#intro());
  }

  #setRange(n) {
    if (this.busy) return;
    this.range = n;
    this.store.set('chart.range', String(n));
    this.recent = [];
    this.#renderControls();
    this.slots.forEach((s) => this.#fill(s, this.#randomSong()));
    this.#say(this.#intro());
  }

  #bind() {
    $('pullBtn').addEventListener('click', () => this.pull());
    $('ringBtn').addEventListener('click', () => this.pull());
    $('quickBtn').addEventListener('click', () => this.quick());
    $('againPull').addEventListener('click', () => {
      $('stage').scrollIntoView({ block: 'center', behavior: fx.prefersReducedMotion() ? 'auto' : 'smooth' });
      this.pull();
    });
    $('nextPull').addEventListener('click', () => { const n = this.songs[this.song?.rank]; if (n) this.reveal(n, { fromList: true }); });
    $('chartJump').addEventListener('click', () => { $('chart').open = true; $('chart').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
    $('listPro').addEventListener('click', () => this.#setList('pro'));
    $('listNew').addEventListener('click', () => this.#setList('new'));
    for (const [id, other] of [['listPro', 'new'], ['listNew', 'pro']]) {
      $(id).addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        this.#setList(other);
        $(other === 'new' ? 'listNew' : 'listPro').focus();
      });
    }
    for (const n of [10, 50, 100]) $(`r${n}`).addEventListener('click', () => this.#setRange(n));

    document.addEventListener('visibilitychange', () => {
      if (!this.active) return;
      if (document.hidden) this.crowd.stop(); else this.crowd.start();
    });
  }
}
