import * as G from './game.js';
import { makeCard, reveal, songModel, artistModel, reduced, setCardImage, creditLine } from './cards.js';
import { createPlayer } from './player.js';
import { createRoulette, configureAutoplay } from './roulette.js';
import { renderShell } from './shell.js';
import { startCrowd } from './stage.js';
import { PullMachine } from '../../src/pull-machine.js';
import { Sound } from '../../src/sound.js';
import { createAutoAdvance } from '../../src/auto-advance.js';
import { CREDIT_HOSTS, IMAGE_HOSTS, isVideoId, safeUrl, videoThumbnail } from '../../src/validation.js';
import * as passport from '../../src/passport.js';
import { showToast } from '../../src/toast.js';

const $ = (s) => document.querySelector(s);
const RANGES = [10, 50, 100];
let config;
export async function start(options) {
  config = options;
  try { localStorage.setItem('bias-roulette.lastSide', config.side); } catch {}
  renderShell(config);
  configureAutoplay(config.storage + '.autoplay');
  await boot();
}

async function loadJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}

let portraitsReady;
async function boot() {
  const actions = [...document.querySelectorAll('.top .toggle button'), $('#openBinder')];
  portraitsReady = loadJson('data/portraits.json').catch(() => null);
  actions.forEach((button) => { button.disabled = true; });
  let data;
  try {
    data = await loadJson('data/data.json');
    if (!Array.isArray(data?.artists) || !Array.isArray(data?.songs)) throw new Error('Invalid game data');
    config.prepare?.(data);
  } catch (error) {
    console.warn(`Could not load ${config.label ?? 'Pop'} game data.`, error);
    const p = Object.assign(document.createElement('p'), { className: 'sub', role: 'status' });
    const retry = Object.assign(document.createElement('button'), { className: 'ghost', type: 'button', textContent: 'Retry' });
    retry.addEventListener('click', () => { p.remove(); boot(); });
    p.append('Could not load the game data. ', retry);
    $('main').prepend(p);
    return;
  }
  init(data);
  actions.forEach((button) => { button.disabled = false; });
}

function init(data) {
  const portraits = Object.create(null);
  const artists = data.artists.filter((a) => a.songs.length);
  const songsOf = (a) => G.wheelSongs(a, songsById, 99);
  const TOP = G.top100(data.songs);

  const songsById = new Map(data.songs.map((s) => [s.id, s]));

  // ---------- collection (localStorage) ----------
  const KEY = config.storage + '.collection.v1';
  let col = {};
  try { col = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  // Keep only cards that still exist after a data rebuild, and survive a damaged value.
  {
    const names = new Set(data.artists.map((a) => a.name));
    col = {
      a: (Array.isArray(col?.a) ? col.a : []).filter((n) => names.has(n)),
      s: (Array.isArray(col?.s) ? col.s : []).filter((id) => songsById.has(id)),
    };
  }
  function reportPassport() {
    const owned = (col.a?.length || 0) + (col.s?.length || 0);
    const total = artists.length + binderSongs.length;
    const ids = (col.s || []).filter(isVideoId);
    passport.report(config.side, { owned, total, ids });
    passport.loadSets().then((sets) => {
      const { completed } = passport.checkSets(sets);
      for (const set of completed) showToast(`Set complete: ${set.name}`);
    });
  }
  function win(kind, id) {
    const r = G.collect(col, kind, id);
    col = r.col;
    try { localStorage.setItem(KEY, JSON.stringify(col)); } catch {}
    updateCount();
    reportPassport();
    return r.isNew;
  }
  const updateCount = () => ($('#binderCount').textContent = (col.a?.length || 0) + (col.s?.length || 0));

  function tunePortraitImg(card) {
    const img = card?.querySelector?.('.art img');
    if (!img) return;
    img.decoding = 'async';
    if (img.loading !== 'lazy') {
      const src = img.getAttribute('src');
      img.loading = 'lazy';
      if (src && !img.complete) {
        img.removeAttribute('src');
        img.setAttribute('src', src);
      }
    }
  }
  const artistCard = (a, o) => {
    const card = makeCard(config.artistModel ? config.artistModel(a, portraits[a.name], songsOf(a)) : artistModel(a, portraits[a.name], songsOf(a)), o);
    if (o?.lazy) {
      card.dataset.lazy = '1';
      tunePortraitImg(card);
    }
    return card;
  };
  const songCard = (s, o) => makeCard(config.songModel ? config.songModel(s, o) : songModel(s), o);

  // ---------- modes: #roulette, #top100 ----------
  const modes = { roulette: $('#roulette'), top100: $('#top100') };
  const modeTabs = [...document.querySelectorAll('.top .toggle button')];
  const stops = {};
  let chartRendered = false;
  let playingTopId = null;
  function ensureChart() {
    if (chartRendered) return;
    chartRendered = true;
    renderChart();
  }
  function scheduleChart() {
    if (chartRendered) return;
    requestAnimationFrame(() => {
      if (chartRendered) return;
      if (typeof requestIdleCallback === 'function') requestIdleCallback(ensureChart, { timeout: 1500 });
      else setTimeout(ensureChart, 1);
    });
  }
  function setMode(m, { deferChart = false } = {}) {
    for (const [k, sec] of Object.entries(modes)) sec.hidden = k !== m;
    for (const tab of modeTabs) {
      const selected = tab.dataset.mode === m;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    $('#titleAccent').textContent = m === 'top100' ? 'Top 100' : 'Roulette';
    if (m === 'top100') {
      if (!deferChart) ensureChart();
      machine.activate();
    }
    for (const [k, stop] of Object.entries(stops)) if (k !== m) stop();
    history.replaceState(null, '', '#' + m);
    // The genre switch lands on the same mode on sides with Roulette and Top 100.
    for (const link of document.querySelectorAll('[data-mode-link]')) {
      link.href = `../${link.dataset.modeLink}/#${m}`;
    }
  }
  modeTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
    tab.addEventListener('keydown', (event) => {
      let next;
      switch (event.key) {
        case 'ArrowLeft': next = (index - 1 + modeTabs.length) % modeTabs.length; break;
        case 'ArrowRight': next = (index + 1) % modeTabs.length; break;
        case 'Home': next = 0; break;
        case 'End': next = modeTabs.length - 1; break;
        default: return;
      }
      event.preventDefault();
      const target = modeTabs[next];
      setMode(target.dataset.mode);
      target.focus();
    });
  });
  $('#genre').addEventListener('keydown', (e) => e.key === 'Escape' && ($('#genre').open = false));
  document.addEventListener('click', (e) => !e.target.closest('#genre') && ($('#genre').open = false));

  // ---------- Mode 1: Roulette ----------
  stops.roulette = createRoulette($(`#deck-${config.deck}`), {
    songsById, portraits, win, artistCard, songCard,
    pool: config.pool(artists), fills: config.fills, noun: config.noun,
  }).stop;

  // ---------- Mode 2: Top 100 ----------
  const tPlayer = createPlayer($('#tPlayer'), {
    onEnd: (token) => topAuto.end(token), onFail: (token) => topAuto.fail(token),
    onPlay: (token) => topAuto.play(token), onBlocked: (token) => topAuto.blocked(token),
  });
  let chartAutoOn = false;
  try { chartAutoOn = localStorage.getItem(config.storage + '.chartAuto') === 'on'; } catch {}
  const topAuto = createAutoAdvance({
    enabled: chartAutoOn, isActive: () => !$('#top100').closest('[hidden]'),
    advance: () => machine.pull({ short: true, immediate: document.hidden }),
    onPause: (paused) => {
      $('#chartAuto').nextElementSibling.textContent = paused ? 'paused' : topAuto.enabled ? 'on' : 'off';
      if (paused) tPlayer.showAutoPaused(() => topAuto.resume()); else tPlayer.clearAutoPaused();
    },
  });
  const chartAutoInput = $('#chartAuto');
  chartAutoInput.checked = chartAutoOn;
  chartAutoInput.nextElementSibling.textContent = chartAutoOn ? 'on' : 'off';
  chartAutoInput.addEventListener('change', () => {
    try { localStorage.setItem(config.storage + '.chartAuto', chartAutoInput.checked ? 'on' : 'off'); } catch {}
    chartAutoInput.nextElementSibling.textContent = chartAutoInput.checked ? 'on' : 'off';
    topAuto.setEnabled(chartAutoInput.checked);
  });
  stops.top100 = () => { topAuto.invalidate(); machine.deactivate(); tPlayer.stop(); };
  function showBig(slot, card, extra = [], valid = () => true) {
    slot.replaceChildren(card, ...extra);
    if (document.hidden) { if (valid()) reveal(card); }
    else requestAnimationFrame(() => { if (valid()) reveal(card); });
  }
  const say = (text) => { $('#topAnnounce').textContent = text; };
  const shown = new Set();
  const ringSize = () => (innerWidth < 520 ? 10 : 12);
  let soundOn = true;
  try { soundOn = localStorage.getItem(config.storage + '.sound') !== 'off'; } catch {}
  const sound = new Sound(soundOn);
  function soundLabel() {
    $('#sound').textContent = sound.enabled ? 'Sound on' : 'Sound off';
    $('#sound').setAttribute('aria-pressed', String(sound.enabled));
  }
  $('#sound').addEventListener('click', () => {
    sound.enabled = !sound.enabled;
    if (sound.enabled) sound.unlock();
    try { localStorage.setItem(config.storage + '.sound', sound.enabled ? 'on' : 'off'); } catch {}
    soundLabel();
  });
  soundLabel();

  // "Pull from": the top 10, 50 or 100, remembered per side.
  let range = 100;
  try { const saved = Number(localStorage.getItem(config.storage + '.range')); if (RANGES.includes(saved)) range = saved; } catch {}
  const pool = () => TOP.slice(0, range);
  const intro = () => `Top ${range}: pull a card to play its video.`;
  const renderRange = () => { for (const n of RANGES) $(`#r${n}`).setAttribute('aria-pressed', String(range === n)); };
  let quiet = false; // a range change must not cancel Auto or stop the video that is playing
  const pick = () => {
    const song = G.dealRing(pool(), 1, shown)[0];
    if (song) shown.add(song.id);
    return song;
  };
  const machine = new PullMachine({
    ring: $('#ring'), hit: $('#ringBtn'), buttons: [$('#pull')], slots: ringSize,
    radius: (width, n) => Math.round((width / 2) / Math.tan(Math.PI / n) + 18),
    renderSlot: (slot, song) => {
      slot.classList.add('slot');
      slot.replaceChildren(songCard(song, { size: 'mini', faceDown: true }));
    },
    sound, tierOf: (song) => G.songRarity(song.o).id,
    onPull: () => { topAuto.invalidate(); tPlayer.stop(); tPlayer.clearAutoPaused(); },
    onCancel: () => { if (quiet) return; topAuto.invalidate(); tPlayer.stop(); },
    say,
    onLand: (song) => { say(`#${song.o} ${song.t} by ${song.by}!`); },
    onReveal: (song, { short } = {}) => {
      const token = machine.generation;
      const isNew = win('song', song.id);
      playTop(song, !short, isNew, () => machine.generation === token && machine.active, short);
    },
  });
  machine.setPool(pool(), pick);
  renderRange();
  say(intro());
  for (const n of RANGES) $(`#r${n}`).addEventListener('click', () => {
    if (['spinning', 'landing', 'revealing'].includes(machine.state) || range === n) return;
    range = n;
    try { localStorage.setItem(config.storage + '.range', String(n)); } catch {}
    shown.clear();
    quiet = true;
    try { machine.setPool(pool(), pick); } finally { quiet = false; }
    renderRange();
    say(intro());
  });

  /** Stats strip under the player: whatever config.statStrip(song) returns, nothing otherwise. */
  function renderStrip(song) {
    const items = (config.statStrip?.(song) ?? []).filter((x) => x && x.value != null && x.value !== '');
    const strip = $('#tStats');
    strip.hidden = !items.length;
    strip.replaceChildren(...items.map(({ label, value }) => {
      const cell = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value;
      cell.append(dt, dd);
      return cell;
    }));
  }
  const nextOf = (song) => {
    const i = TOP.findIndex((s) => s.id === song.id);
    return i < 0 || TOP.length < 2 ? null : TOP[(i + 1) % TOP.length];
  };
  let current = null;
  function playTop(song, pulled, isNew, valid, short = false) {
    current = song;
    const card = songCard(song, { size: 'big', chart: true });
    const extra = [];
    if (pulled) {
      const stamp = document.createElement('div');
      stamp.className = `stamp ${card.classList[1]}`;
      stamp.textContent = `#${song.o} ${G.songRarity(song.o).label}${isNew ? ' · New' : ''}`;
      extra.push(stamp);
    }
    $('#tResult').hidden = false;
    showBig($('#tCard'), card, extra, valid);
    renderStrip(song);
    const next = nextOf(song);
    $('#tNext').hidden = !next;
    if (next) $('#tNext').textContent = `Next: #${next.o} ${next.t}`;
    tPlayer.play(song.id, topAuto.begin());
    playingTopId = song.id;
    say(`Now playing #${song.o}: ${song.t} by ${song.by}.`);
    document.querySelectorAll('#chart li').forEach((li) => li.classList.toggle('playing', li.dataset.id === song.id));
    if (!short && !document.hidden) $('#tResult').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'nearest' });
  }
  /** Play a chart song in the result block (a row tap or "Next"). */
  function playFromChart(song) {
    machine.cancel();
    const token = machine.generation;
    playTop(song, false, undefined, () => machine.generation === token && machine.active);
  }
  $('#tAgain').addEventListener('click', () => {
    $('.ring-stage').scrollIntoView({ block: 'center', behavior: reduced.matches ? 'auto' : 'smooth' });
    if (machine.state === 'spinning') machine.slamStop(); else machine.pull();
  });
  $('#tNext').addEventListener('click', () => { const next = current && nextOf(current); if (next) playFromChart(next); });
  $('#tJump').addEventListener('click', () => {
    $('#chartBox').open = true;
    $('#chartBox').scrollIntoView({ block: 'start', behavior: reduced.matches ? 'auto' : 'smooth' });
  });

  function renderChart() {
    const scoreOf = (s) => (config.score ? config.score(s) : G.score(s));
    const topScore = Math.max(1, ...TOP.map(scoreOf));
    const frag = document.createDocumentFragment();
    for (const s of TOP) {
      const li = document.createElement('li');
      const tier = G.songRarity(s.o).id;
      li.className = s.id === playingTopId ? 'playing' : '';
      if (typeof s.id === 'string') li.dataset.id = s.id;
      li.innerHTML = `<button class="row" type="button"><span class="row-rank"></span><img class="row-thumb" alt="" width="64" height="36" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="row-text"><b></b><span></span></span><span class="row-score"><span class="bar"></span><small></small></span></button>`;
      li.querySelector('button').setAttribute('aria-label', `Play number ${s.o}: ${s.t} by ${s.by}`);
      const rank = li.querySelector('.row-rank');
      rank.textContent = s.o;
      rank.classList.add(tier);
      const src = videoThumbnail(s.id, 'mqdefault');
      if (src) li.querySelector('img').src = src;
      li.querySelector('.row-text b').textContent = s.t;
      li.querySelector('.row-text span').textContent = s.by;
      const bar = li.querySelector('.bar');
      bar.classList.add(tier);
      bar.style.setProperty('--w', `${Math.min(100, (scoreOf(s) / topScore) * 100).toFixed(1)}%`);
      li.querySelector('small').textContent = config.chartScore ? config.chartScore(s) : (scoreOf(s) ? G.fmt(scoreOf(s)) + ' pts' : '');
      li.querySelector('button').addEventListener('click', () => playFromChart(s));
      frag.append(li);
    }
    $('#chart').replaceChildren(frag);
    $('#chartMethod').textContent = config.chartMethod + (data.updated ? ` Data from ${data.updated}.` : '');
  }

  // ---------- collection ----------
  const binder = $('#binder');
  let binderTab = 'a';
  const binderSongs = (() => {
    const ids = new Set(TOP.map((s) => s.id));
    for (const a of artists) for (const id of a.songs.slice(0, 12)) ids.add(id);
    return [...ids].map((id) => songsById.get(id)).sort((a, b) => a.o - b.o);
  })();
  function renderBinder() {
    const have = new Set(binderTab === 'a' ? col.a : col.s);
    const list = binderTab === 'a' ? [...artists].sort((a, b) => b.power - a.power || a.name.localeCompare(b.name)) : binderSongs;
    $('#bA').textContent = `${col.a?.length || 0}/${artists.length}`;
    $('#bS').textContent = `${col.s?.length || 0}/${binderSongs.length}`;
    const gridWidth = $('#binderGrid').clientWidth || Math.min(innerWidth - 16, 1100);
    const firstRow = Math.max(2, Math.floor((gridWidth - 20) / 130));
    const frag = document.createDocumentFragment();
    list.forEach((x, index) => {
      const id = binderTab === 'a' ? x.name : x.id;
      const o = { size: 'mini', faceDown: !have.has(id), locked: true, lazy: index >= firstRow }; // uncollected: a plain back, no art loaded
      const card = binderTab === 'a' ? artistCard(x, o) : songCard(x, o);
      if (binderTab !== 'a' && o.lazy) tunePortraitImg(card);
      frag.append(card);
    });
    $('#binderGrid').replaceChildren(frag);
  }
  $('#openBinder').addEventListener('click', () => { renderBinder(); binder.showModal(); });
  $('#closeBinder').addEventListener('click', () => binder.close());
  binder.addEventListener('click', (e) => e.target === binder && binder.close());
  for (const b of binder.querySelectorAll('[data-bt]')) b.addEventListener('click', () => {
    binderTab = b.dataset.bt;
    binder.querySelectorAll('[data-bt]').forEach((x) => x.setAttribute('aria-selected', x === b));
    renderBinder();
  });

  // ---------- photo credits (built when opened) ----------
  function renderCredits() {
    if (!$('#credits').open || $('#creditList').children.length) return;
    const frag = document.createDocumentFragment();
    for (const [name, p] of Object.entries(portraits).sort(([a], [b]) => a.localeCompare(b))) {
      const li = document.createElement('li');
      if (!p) continue;
      const href = safeUrl(p.page, CREDIT_HOSTS);
      const text = p.mv ? 'still from an official music video' : `${p.author}, ${p.license}`;
      const credit = href ? Object.assign(document.createElement('a'), {
        href, target: '_blank', rel: 'noopener noreferrer', textContent: text,
      }) : text;
      li.append(`${name}: `, credit, p.mv ? '' : ' (cropped)');
      frag.append(li);
    }
    $('#creditList').replaceChildren(frag);
  }
  $('#credits').addEventListener('toggle', renderCredits);
  portraitsReady.then((index) => {
    if (!index || typeof index !== 'object' || Array.isArray(index)) return;
    Object.assign(portraits, index);
    document.querySelectorAll('.card[data-kind="artist"]').forEach((card) => {
      const portrait = portraits[card.dataset.id];
      if (!portrait) return;
      setCardImage(card.querySelector('.art'), { kind: 'artist', title: card.dataset.id, img: safeUrl(portrait.img, IMAGE_HOSTS), yt: portrait.mv },
        card.classList.contains('mini') ? 'mini' : 'big');
      if (card.dataset.lazy === '1') tunePortraitImg(card);
      if (card.nextElementSibling?.matches('.credit')) card.nextElementSibling.replaceWith(creditLine(portrait));
    });
    renderCredits();
  });

  // ---------- boot ----------
  if ($('#crowd')) startCrowd($('#crowd'), config.crowdColors);
  updateCount();
  reportPassport();
  /** #top100 or #roulette (also the old #top link). No hash: Roulette. */
  function modeFromHash(initial = false) {
    const h = location.hash.slice(1);
    setMode(h === 'top100' || h === 'top' ? 'top100' : 'roulette', { deferChart: initial });
  }
  addEventListener('hashchange', () => modeFromHash(false));
  addEventListener('pagehide', () => { for (const stop of Object.values(stops)) stop(); });
  addEventListener('pageshow', (e) => { if (e.persisted) modeFromHash(false); });
  modeFromHash(true);
  scheduleChart();
}
