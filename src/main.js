// Wires the rules (game.js) to the page: rendering, animation timing, buttons.

import { Game } from './game.js';
import { buildCatalog } from './catalog.js';
import { Wheel } from './wheel.js';
import { Sound } from './sound.js';
import { VideoPlayer, loadApi } from './player.js';
import * as fx from './fx.js';
import { Charts, Crowd, toRgb, loadChartData, showToast } from './charts.js';
import { makeCard, cardBack, idolCard, songCard, artPlan, rouletteSongCard, chartIndex, playIn, collection, openBinder, hasArt } from './card.js';
import { createAutoAdvance } from './auto-advance.js';
import { CREDIT_HOSTS, isVideoId, safeUrl } from './validation.js';
import * as passport from './passport.js';

const $ = (id) => document.getElementById(id);
const CANDY = ['#ff5fa2', '#ffe45c', '#6ff2c8', '#b693ff', '#7fd0ff', '#ffb38a'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const store = {
  get(key, fallback) { try { return localStorage.getItem('bias-roulette.' + key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('bias-roulette.' + key, value); } catch { /* private mode */ } },
};
store.set('lastSide', 'kpop');

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

/** Blend a hex colour towards the night sky. */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift, to) => Math.round(((n >> shift) & 255) + (to - ((n >> shift) & 255)) * amount);
  return `rgb(${ch(16, 18)}, ${ch(8, 10)}, ${ch(0, 36)})`;
}

const sound = new Sound(store.get('sound', 'on') === 'on');
const wheel = new Wheel($('wheel'), {
  onTick: (i) => {
    sound.tick();
    const seg = wheel.segments[i];
    if (seg) $('readout').textContent = seg.readout;
  },
});
const player = new VideoPlayer({
  box: $('playerBox'), mountId: 'player', overlay: $('playOverlay'), fallback: $('playerFallback'),
  message: $('fallbackMsg'), link: $('watchLink'), hint: $('playHint'),
  onEnd: (token) => rouletteAuto.end(token),
  onFail: (token) => rouletteAuto.fail(token),
  onPlay: (token) => rouletteAuto.play(token),
  onBlocked: (token) => rouletteAuto.blocked(token),
});
// #top100/easy opens the Easy 100 list; the choice is remembered like any other.
if (location.hash === '#top100/easy') store.set('chart.list', 'new');
const charts = new Charts({ sound, store });
const wheelCrowd = new Crowd($('crowdWheel'));
let chartIdx = null; // Top 100 by act, for card power
let catalogIdols = [];
let chartSongsAll = [];
let portraits = null; // data/portraits.json, then the art plan: idol name -> {photo, credit}
const reduced = () => fx.prefersReducedMotion();
const forceVideo = new URLSearchParams(location.search).get('forceVideo'); // for testing the player, see README

let game = null;
let loadingRoulette = false;
let rouletteIdle = null;
let apiWarmed = false;
let busy = false;

function warmApi() {
  if (apiWarmed) return;
  apiWarmed = true;
  loadApi().catch(() => { apiWarmed = false; });
}

function cancelRouletteSchedule() {
  if (rouletteIdle === null) return;
  if (typeof cancelIdleCallback === 'function') cancelIdleCallback(rouletteIdle);
  else clearTimeout(rouletteIdle);
  rouletteIdle = null;
}

function ensureRoulette() {
  cancelRouletteSchedule();
  if (!game && !loadingRoulette) loadRoulette();
}

function scheduleRoulette() {
  if (game || loadingRoulette || rouletteIdle !== null) return;
  const kick = () => {
    rouletteIdle = null;
    if (mode === 'roulette') ensureRoulette();
  };
  requestAnimationFrame(() => {
    if (mode !== 'roulette' || game || loadingRoulette || rouletteIdle !== null) return;
    rouletteIdle = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(kick, { timeout: 1200 })
      : setTimeout(kick, 1);
  });
}

// ---------- rendering ----------
const announce = (text) => { $('announce').textContent = text; };
const nameOf = (stage, item) => (stage === 'idol' ? item.name : item.title);
const subOf = (stage, item) => (stage === 'idol' ? item.label : item.artist);

function intro() {
  const t = game.duelTarget;
  switch (game.phase) {
    case 'idolDraw': return `Round 1: spin to draw ${game.drawsNeeded('idol')} idols.`;
    case 'idolDuel': return `Round 2: idol showdown! First to ${t} hits wins.`;
    case 'songDraw': return `Round 3: draw ${game.drawsNeeded('song')} songs for ${game.idol.name}.`;
    case 'songDuel': return `Round 4: song showdown! First to ${t} hits wins.`;
    default: return '';
  }
}

function renderSteps() {
  const at = ['idolDraw', 'idolDuel', 'songDraw', 'songDuel', 'result'].indexOf(game.phase);
  [...$('steps').children].forEach((li, i) => {
    li.classList.toggle('done', i < at);
    li.classList.toggle('current', i === at);
    li.firstElementChild.textContent = i < at ? '✓' : String(i + 1);
    if (i === at) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });
}

function renderWheel() {
  const w = game.wheel();
  wheel.setSegments(w.segments.map((s, i) => ({
    label: nameOf(w.stage, s.item),
    readout: `${nameOf(w.stage, s.item)} · ${subOf(w.stage, s.item)}`,
    taken: s.taken,
    color: w.kind === 'duel' ? CANDY[s.finalist % CANDY.length]
      : w.stage === 'idol' ? shade(s.item.color, i % 2 ? 0.34 : 0.06)
        : CANDY[i % CANDY.length],
  })));
  $('wheelBtn').setAttribute('aria-label', `Spin the wheel: ${intro()}`);
}

function renderFinalists(flash = -1, flip = -1) {
  const stage = game.stage === 'result' ? 'song' : game.stage;
  const list = game.finalists(stage);
  const needed = game.drawsNeeded(stage);
  const duel = list.length === needed && needed > 1;
  const winner = game.phase === 'result' ? game.songIndex : null;

  $('finalistsTitle').textContent = stage === 'idol' ? 'Idol finalists' : 'Song finalists';
  const chip = $('idolChip');
  chip.hidden = !game.idol;
  if (game.idol) {
    chip.textContent = `♥ ${game.idol.name} · ${game.idol.label}`;
    chip.style.setProperty('--c', game.idol.color);
  }

  const rows = [];
  for (let i = 0; i < needed; i++) {
    const f = list[i];
    if (!f) {
      rows.push(el('li', { class: 'hand-slot empty' }, cardBack('mini', String(i + 1)),
        el('span', { class: 'hand-name', text: 'Not drawn yet' })));
      continue;
    }
    const data = stage === 'idol' ? idolCard(f.item, chartIdx, portraits) : rouletteSongCard(f.item, chartIdx);
    const card = makeCard(data, { size: 'mini' });
    const row = el('li', { class: 'hand-slot' + (f.index === winner ? ' winner' : '') + (i === flash ? ' flash' : '') },
      card, el('span', { class: 'hand-name', text: nameOf(stage, f.item) }), el('span', { class: 'hand-sub', text: subOf(stage, f.item) }));
    if (i === flip) playIn(card, { reduced: reduced() });
    if (duel) {
      const hearts = el('span', { class: 'hearts', role: 'img', 'aria-label': `${f.hits} of ${game.duelTarget} hits` });
      for (let h = 0; h < game.duelTarget; h++) {
        hearts.append(el('span', { class: (h < f.hits ? 'on' : '') + (i === flash && h === f.hits - 1 ? ' new' : ''), text: '♥', 'aria-hidden': 'true' }));
      }
      row.append(hearts);
    }
    rows.push(row);
  }
  $('finalists').replaceChildren(...rows);
}

function renderOptions() {
  $('soundBtn').setAttribute('aria-pressed', String(sound.enabled));
  $('soundBtn').textContent = sound.enabled ? 'Sound on' : 'Sound off';
  if (!game) return;
  $('t3').setAttribute('aria-pressed', String(game.target === 3));
  $('t2').setAttribute('aria-pressed', String(game.target === 2));
  $('soundBtn').setAttribute('aria-pressed', String(sound.enabled));
  $('soundBtn').textContent = sound.enabled ? 'Sound on' : 'Sound off';
}

function setBusy(on) {
  busy = on;
  $('wheelWrap').classList.toggle('spinning', on);
  $('wheelStage').classList.toggle('spinning', on);
  wheelCrowd.hype = on ? 1 : 0;
  for (const id of ['spinBtn', 'autoBtn', 'wheelBtn']) $(id).setAttribute('aria-disabled', String(on));
}

function showPlay() {
  rouletteAuto.invalidate();
  player.stop();
  $('result').hidden = true;
  $('play').hidden = false;
  $('stamp').hidden = true;
  $('readout').textContent = 'Tap the wheel or press Spin';
  renderSteps();
  renderWheel();
  renderFinalists();
  announce(intro());
}

function showResult() {
  const { idol, song } = game;
  fx.setSkyColor(idol.color);
  $('play').hidden = true;
  $('result').hidden = false;
  $('songTitle').textContent = song.title;
  $('songArtist').textContent = song.artist;
  $('drawnFor').textContent = `Drawn for ${idol.name} · ${idol.label}`;
  // Keep this idol, redo only the song rounds. Hidden when there is no other song to draw.
  $('anotherBtn').textContent = `Another ${idol.name} song`;
  $('anotherBtn').hidden = idol.songs.length < 2;
  setAccent(idol.color);
  const data = idolCard(idol, chartIdx, portraits);
  const isNew = collection.add('idol', data.key);
  const dust = passport.collected('kpop', { isNew, tier: data.tier });
  if (dust) showToast(`Duplicate · +${dust} ✦`);
  const card = makeCard(data, { isNew });
  updateBinder();
  reportPassport();
  $('idolCardSlot').replaceChildren(card);
  playIn(card, { reduced: reduced() });
  renderSteps();
  renderFinalists();
  announce(`Winner: ${song.title} by ${song.artist}, drawn for ${idol.name}.`);
  if (mode === 'roulette') player.show(isVideoId(forceVideo) ? forceVideo : song.videoId, rouletteAuto.begin());
  if (mode === 'roulette' && !document.hidden) $('result').scrollIntoView({ block: 'start', behavior: fx.prefersReducedMotion() ? 'auto' : 'smooth' });
}

function celebrate(text, color) {
  const stamp = $('stamp');
  stamp.textContent = text;
  stamp.hidden = true;
  void stamp.offsetWidth; // restart the stamp animation
  stamp.hidden = false;
  const r = $('wheelWrap').getBoundingClientRect();
  fx.confetti($('fx'), r.left + r.width / 2, r.top + r.height / 2, color);
  sound.fanfare();
}

// ---------- actions ----------
async function spin() {
  if (busy || !game || game.phase === 'result') return;
  rouletteAuto.invalidate();
  setBusy(true);
  sound.unlock();
  warmApi();
  $('stamp').hidden = true;

  const ev = game.spin(); // the outcome is decided here; the wheel only acts it out
  const reducedMotion = fx.prefersReducedMotion();
  await wheel.spinTo(ev.segment, reducedMotion ? { duration: 450, turns: 0 }
    : ev.kind === 'draw' ? { duration: 3400, turns: 5 } : { duration: 2700, turns: 4 });

  const name = nameOf(ev.stage, ev.item);
  $('readout').textContent = `${name} · ${subOf(ev.stage, ev.item)}`;

  if (ev.won) {
    renderFinalists(ev.finalist);
    if (ev.stage === 'idol') {
      announce(`${name} wins the idol showdown!`);
      fx.setSkyColor(ev.item.color);
      setAccent(ev.item.color);
      celebrate(name, ev.item.color);
      await sleep(reducedMotion ? 900 : 1900);
      showPlay();
    } else {
      announce(`${name} wins the song showdown!`);
      celebrate(name, game.idol.color);
      await sleep(reducedMotion ? 900 : 1700);
      showResult();
    }
  } else if (ev.kind === 'draw') {
    const what = ev.stage === 'idol' ? 'Finalist' : 'Song';
    announce(`${what} ${ev.count} of ${ev.needed}: ${name} (${subOf(ev.stage, ev.item)}).`);
    if (ev.phaseAfter !== ev.phase) {
      renderFinalists(-1, ev.count - 1);
      await sleep(900);
      showPlay();
    } else {
      renderWheel(); // greys out the segment that was just drawn
      renderFinalists(-1, ev.count - 1);
    }
  } else {
    announce(`${name} scores! ${ev.hits} of ${ev.target}.`);
    renderFinalists(ev.finalist);
  }
  setBusy(false);
}

function chooseForMe({ restart = false } = {}) {
  if (busy || !game) return;
  rouletteAuto.invalidate();
  sound.unlock();
  warmApi();
  if (restart) game.reset();
  game.chooseForMe();
  sound.fanfare();
  showResult();
}

// ---------- autoplay ----------
// On: when the MV ends, play the next round by itself. Same idol: keep the idol, draw another of their songs.
const auto = { on: store.get('auto', 'off') === 'on', same: store.get('auto.same', 'off') === 'on' };
const rouletteAuto = createAutoAdvance({
  enabled: auto.on,
  isActive: () => mode === 'roulette' && !!game,
  advance: () => autoNext(),
  onPause: (paused) => {
    if (paused) player.showAutoPaused(() => rouletteAuto.resume());
    else player.clearAutoPaused();
    renderAuto();
  },
});

function renderAuto() {
  $('autoOn').checked = auto.on;
  $('autoSame').checked = auto.same;
  $('autoSame').disabled = !auto.on;
  $('autoplay').classList.toggle('is-on', auto.on);
  $('autoState').textContent = rouletteAuto.paused ? 'paused' : !auto.on ? 'off' : auto.same ? 'same idol' : 'on';
}

function autoNext() {
  if (mode !== 'roulette' || !game || busy) return;
  const { idol } = game;
  if (auto.same && idol?.songs.length > 1 && game.phase === 'result') {
    // Another song of the same idol, never the one that just played.
    const last = game.song.videoId;
    for (let i = 0; i < 12 && game.song.videoId === last; i++) { game.anotherSong(); game.chooseForMe(); }
    sound.fanfare();
    showResult();
  } else chooseForMe({ restart: true });
  announce(`Autoplay: ${game.song.title} by ${game.song.artist}.`);
}

function startOver() {
  if (busy || !game) return;
  game.reset();
  fx.setSkyColor(null);
  setAccent(null);
  showPlay();
}

function anotherSong() {
  if (busy || !game?.idol) return;
  game.anotherSong();
  showPlay();
  $('play').scrollIntoView({ block: 'nearest' });
}

function setTarget(n) {
  game.setTarget(n);
  store.set('target', String(n));
  renderOptions();
  if (game.duelTarget !== n) announce(`First to ${n} starts with the next showdown.`);
  else if (!busy && game.phase !== 'result') { renderFinalists(); announce(intro()); }
}

function setAccent(color) {
  const root = document.documentElement.style;
  if (color) root.setProperty('--accent', color); else root.removeProperty('--accent');
  wheelCrowd.setColor(color ? toRgb(color) : null);
}

// ---------- modes ----------
let mode = 'roulette';
let rouletteTicker = [];

function setTicker(items) {
  const track = $('ticker');
  track.replaceChildren(...[...items, ...items].map((n) => el('span', { text: `${n} ✦` })));
  track.style.setProperty('--dur', `${Math.max(12, Math.round(items.reduce((a, n) => a + n.length, 0) * 0.16))}s`);
}

function setMode(next, { defer = false } = {}) {
  mode = next === 'charts' ? 'charts' : 'roulette';
  store.set('mode', mode);
  const isCharts = mode === 'charts';
  $('modeRoulette').setAttribute('aria-pressed', String(!isCharts));
  $('modeCharts').setAttribute('aria-pressed', String(isCharts));
  $('roulette').hidden = isCharts;
  $('charts').hidden = !isCharts;
  $('rouletteTitle').hidden = isCharts;
  $('chartsTitle').hidden = !isCharts;
  $('homeLink').hidden = !isCharts;
  document.title = isCharts ? 'K-pop Top 100 · Bias Roulette' : 'Bias Roulette';
  syncUrl();
  updateBinder();
  if (isCharts) {
    cancelRouletteSchedule();
    rouletteAuto.invalidate();
    player.stop();
    fx.setSkyColor(null);
    charts.activate().then(() => { if (mode === 'charts') setTicker(charts.tickerItems()); });
    wheelCrowd.stop();
  } else {
    charts.deactivate();
    setAccent(game?.idol?.color || null);
    wheelCrowd.resize();
    wheelCrowd.start();
    if (rouletteTicker.length) setTicker(rouletteTicker);
    if (!game && !loadingRoulette) {
      if (defer) scheduleRoulette();
      else ensureRoulette();
    }
  }
}
charts.onListChange = () => { setTicker(charts.tickerItems()); syncUrl(); updateBinder(); };
charts.onCollect = () => { updateBinder(); reportPassport(); };
charts.onDataReady = () => {
  chartSongsAll = [...(charts.data?.top || []), ...(charts.data?.newbie || [])];
  reportPassport();
};

function reportPassport() {
  const uniqueSongs = new Map();
  for (const s of chartSongsAll) {
    const key = songCard(s).key;
    if (!uniqueSongs.has(key)) uniqueSongs.set(key, s.videoId);
  }
  const ownedSongIds = [];
  for (const key of collection.keys('song')) {
    const id = uniqueSongs.get(key);
    if (isVideoId(id)) ownedSongIds.push(id);
  }
  const total = catalogIdols.length + uniqueSongs.size;
  const payload = { owned: collection.totalUnique(), ids: ownedSongIds };
  if (total > 0) payload.total = total;
  passport.report('kpop', payload);
  passport.loadSets().then((sets) => {
    const { completed } = passport.checkSets(sets);
    for (const set of completed) showToast(`Set complete: ${set.name}`);
  });
}

/** The hash that names the current screen. */
const hashFor = () => (mode === 'charts' ? (charts.list === 'new' ? '#top100/easy' : '#top100') : '#roulette');
function syncUrl() {
  const hash = hashFor();
  if (location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash);
  $('toKpop').setAttribute('href', hash); // already here: a no-op link
  $('toPop').setAttribute('href', '../pop/' + hash.split('/')[0]); // pop has no Easy list
  $('toBollywood').setAttribute('href', '../bollywood/' + hash.split('/')[0]);
}

/** Collection button in the header: the count for whatever deck is on screen. */
function updateBinder() {
  const n = mode === 'charts' ? charts.collectedCount()
    : collection.count('idol', catalogIdols.map((i) => idolCard(i, chartIdx, portraits).key));
  $('binderCount').textContent = String(n);
  $('openBinder').setAttribute('aria-label', `Open your ${mode === 'charts' ? 'song' : 'idol'} collection, ${n} collected`);
}
function openCollection() {
  if (mode === 'charts') return charts.openCollection();
  if (!catalogIdols.length) return undefined;
  return openBinder({
    title: 'Idol cards', kind: 'idol', cards: catalogIdols.map((i) => idolCard(i, chartIdx, portraits)), reduced: reduced(),
  });
}

/** #roulette, #top100, #top100/easy. No hash: the stored mode. Unknown hash: roulette, as before. */
function applyHash({ navigated = false } = {}) {
  const h = location.hash;
  if (h === '#top100/easy') charts.chooseList('new');
  else if (h === '#top100' && navigated) charts.chooseList('pro'); // at load, #top100 keeps the stored list
  const next = h.startsWith('#top100') ? 'charts' : h ? 'roulette' : store.get('mode', 'roulette');
  if (!navigated || next !== mode) setMode(next, { defer: !navigated });
  else syncUrl();
}

// ---------- photo credits (built when first opened) ----------
async function buildCredits() {
  const box = $('creditList');
  if (!$('credits').open || box.children.length) return;
  let all;
  try { all = await fetch(new URL('../data/portraits.json', import.meta.url)).then((r) => { if (!r.ok) throw new Error(); return r.json(); }); } catch {
    box.replaceChildren(el('li', { text: 'Could not load the credits.' }));
    return;
  }
  box.replaceChildren(...Object.entries(all).sort(([a], [b]) => a.localeCompare(b)).map(([name, p]) => {
    const href = safeUrl(p?.file || p?.page, CREDIT_HOSTS);
    const text = [p?.author, p?.license].filter(Boolean).join(', ') || 'Wikimedia Commons';
    const credit = href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer', text }) : text;
    return el('li', {}, `${name}: `, credit, ' (cropped)');
  }));
}

// ---------- start ----------
function start() {
  fx.initSky($('sky'));
  fx.initRimLights($('rim'));
  document.addEventListener('pointerdown', (e) => fx.tapBurst($('fx'), e.clientX, e.clientY));
  $('modeRoulette').addEventListener('click', () => {
    if (mode !== 'roulette') setMode('roulette');
    else ensureRoulette();
  });
  $('modeCharts').addEventListener('click', () => mode !== 'charts' && setMode('charts'));
  $('roulette').addEventListener('pointerdown', ensureRoulette, { once: true, capture: true });
  $('roulette').addEventListener('keydown', ensureRoulette, { once: true, capture: true });
  $('soundBtn').addEventListener('click', () => {
    sound.enabled = !sound.enabled;
    store.set('sound', sound.enabled ? 'on' : 'off');
    sound.unlock();
    renderOptions();
  });
  renderOptions();
  applyHash();
  addEventListener('hashchange', () => applyHash({ navigated: true }));
  addEventListener('pagehide', () => { rouletteAuto.invalidate(); player.stop(); charts.deactivate(); });
  addEventListener('pageshow', (e) => { if (e.persisted && mode === 'charts') charts.activate(); });
  $('openBinder').addEventListener('click', openCollection);
  const genre = $('genre');
  document.addEventListener('click', (e) => { if (genre.open && !genre.contains(e.target)) genre.open = false; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && genre.open) { genre.open = false; genre.querySelector('summary').focus(); }
  });
  $('toKpop').addEventListener('click', () => { genre.open = false; });
  $('credits').addEventListener('toggle', buildCredits);

}

async function loadRoulette() {
  loadingRoulette = true;
  const actions = ['spinBtn', 'autoBtn', 'wheelBtn', 't3', 't2', 'resetBtn'];
  for (const id of actions) $(id).disabled = true;
  announce('Loading…');
  let catalog;
  try {
    const load = (f) => fetch(new URL(`../data/${f}`, import.meta.url), { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(f); return r.json(); });
    const chartData = loadChartData().catch(() => null); // in parallel with the rest
    const [roster, videos] = await Promise.all([load('roster.json'), load('video-ids.json')]);
    // Photos are only painted for idols without an illustrated cover.
    const needPhotos = (roster.idols || []).some((i) => !hasArt('idol', i.name));
    let top;
    [top, portraits] = await Promise.all([chartData, needPhotos ? load('portraits.json').catch(() => null) : null]);
    chartIdx = chartIndex(top?.top);
    if (top) chartSongsAll = [...(top.top || []), ...(top.newbie || [])];
    catalog = buildCatalog(roster, videos);
    if (!catalog.idols.length) throw new Error('No songs have videos');
  } catch (error) {
    loadingRoulette = false;
    console.warn('Could not load Roulette data. Serve the site with npm start and generate video data with npm run resolve.', error);
    announce('Could not load the song data. ');
    const retry = el('button', { type: 'button', class: 'btn btn-small', text: 'Retry' });
    retry.addEventListener('click', loadRoulette);
    $('announce').append(retry);
    return;
  }
  catalogIdols = catalog.idols;
  portraits = artPlan(catalog.idols, portraits);

  game = new Game(catalog.idols, { target: store.get('target', '3') === '2' ? 2 : 3 });
  loadingRoulette = false;
  for (const id of actions) $(id).disabled = false;

  rouletteTicker = catalog.idols.map((i) => i.name);
  if (mode === 'roulette') setTicker(rouletteTicker);

  $('spinBtn').addEventListener('click', spin);
  $('wheelBtn').addEventListener('click', spin);
  $('autoBtn').addEventListener('click', () => chooseForMe());
  $('againBtn').addEventListener('click', () => chooseForMe({ restart: true }));
  $('anotherBtn').addEventListener('click', anotherSong);
  $('restartBtn').addEventListener('click', startOver);
  $('resetBtn').addEventListener('click', startOver);
  $('autoOn').addEventListener('change', (e) => { auto.on = e.target.checked; store.set('auto', auto.on ? 'on' : 'off'); rouletteAuto.setEnabled(auto.on); renderAuto(); });
  $('autoSame').addEventListener('change', (e) => { auto.same = e.target.checked; store.set('auto.same', auto.same ? 'on' : 'off'); renderAuto(); });
  const autoMenu = $('autoplay');
  document.addEventListener('click', (e) => { if (autoMenu.open && !autoMenu.contains(e.target)) autoMenu.open = false; });
  autoMenu.addEventListener('keydown', (e) => { if (e.key === 'Escape' && autoMenu.open) { autoMenu.open = false; autoMenu.querySelector('summary').focus(); } });
  renderAuto();
  $('t3').addEventListener('click', () => setTarget(3));
  $('t2').addEventListener('click', () => setTarget(2));
  renderOptions();
  updateBinder();
  reportPassport();
  showPlay();
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __game: game, __player: player });
}

start();
