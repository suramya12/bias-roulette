import * as G from './game.js';
import { makeCard, reveal, songModel, artistModel, reduced } from './cards.js';
import { createPlayer } from './player.js';
import { createRoulette } from './roulette.js';
import { startCrowd } from './stage.js';
import { PullMachine } from '../../src/pull-machine.js';
import { Sound } from '../../src/sound.js';

const $ = (s) => document.querySelector(s);

let data, portraits;
try {
  [data, portraits] = await Promise.all([
    fetch('data/data.json').then((r) => r.json()),
    fetch('data/portraits.json').then((r) => r.json()).catch(() => ({})),
  ]);
} catch {
  const p = Object.assign(document.createElement('p'), { className: 'sub', textContent: 'Could not load the game data. Reload to try again.' });
  $('main').replaceChildren(p);
  throw new Error('data/data.json failed to load');
}
const artists = data.artists.filter((a) => a.songs.length);
const songsOf = (a) => G.wheelSongs(a, songsById, 99);
const TOP = G.top100(data.songs);

const songsById = new Map(data.songs.map((s) => [s.id, s]));

// ---------- collection (localStorage) ----------
const KEY = 'encore.collection.v1';
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
function win(kind, id) {
  const r = G.collect(col, kind, id);
  col = r.col;
  try { localStorage.setItem(KEY, JSON.stringify(col)); } catch {}
  updateCount();
  return r.isNew;
}
const updateCount = () => ($('#binderCount').textContent = (col.a?.length || 0) + (col.s?.length || 0));

const artistCard = (a, o) => makeCard(artistModel(a, portraits[a.name], songsOf(a)), o);
const songCard = (s, o) => makeCard(songModel(s), o);

// ---------- modes: #roulette (deck all), #roulette/favs, #top100 ----------
const modes = { roulette: $('#roulette'), top100: $('#top100') };
const stops = {};
const DECK_NOTE = {
  all: 'The biggest English and Latin pop acts. Spin for an artist, then for one of their songs.',
  favs: 'A curated 100, from Beyoncé to Tate McRae. Spin for an artist, then for one of their songs.',
};
let deck = 'all';
function setMode(m, d = deck) {
  deck = d;
  for (const [k, sec] of Object.entries(modes)) sec.hidden = k !== m;
  for (const b of document.querySelectorAll('.top .toggle button')) b.setAttribute('aria-selected', b.dataset.mode === m);
  for (const b of document.querySelectorAll('[data-deck]')) b.setAttribute('aria-checked', b.dataset.deck === d);
  for (const k of ['all', 'favs']) $(`#deck-${k}`).hidden = k !== d;
  $('#deckNote').textContent = DECK_NOTE[d];
  if (m === 'top100') machine.activate();
  const live = m === 'roulette' ? d : m;
  for (const [k, stop] of Object.entries(stops)) if (k !== live) stop();
  history.replaceState(null, '', m === 'top100' ? '#top100' : d === 'favs' ? '#roulette/favs' : '#roulette');
  // The genre switch lands on the same mode in the K-pop app.
  $('#toKpop').href = m === 'top100' ? '../#top100' : '../#roulette';
  try { localStorage.setItem('encore.deck', d); } catch {}
}
for (const b of document.querySelectorAll('.top .toggle button')) b.addEventListener('click', () => setMode(b.dataset.mode));
for (const b of document.querySelectorAll('[data-deck]')) b.addEventListener('click', () => setMode('roulette', b.dataset.deck));
$('#genre').addEventListener('keydown', (e) => e.key === 'Escape' && ($('#genre').open = false));
document.addEventListener('click', (e) => !e.target.closest('#genre') && ($('#genre').open = false));

// ---------- Mode 1: Roulette, two decks ----------
const shared = { songsById, portraits, win, artistCard, songCard };
const mainPool = artists.filter((a) => a.main);
stops.all = createRoulette($('#deck-all'), { ...shared, pool: mainPool }).stop;
const BIAS_FILLS = [
  ['#ff6fb5', '#b3135f'], ['#ffd76a', '#c27b00'], ['#c18cff', '#6a2fd1'], ['#ff8fa0', '#b8304a'],
  ['#ffb3e1', '#c2367e'], ['#f7c873', '#9a6200'],
];
const biasPool = artists.filter((a) => a.bias).sort((a, b) => a.bias - b.bias);
stops.favs = createRoulette($('#deck-favs'), { ...shared, pool: biasPool, fills: BIAS_FILLS }).stop;
$('#nAll').textContent = mainPool.length;
$('#nFavs').textContent = biasPool.length;

// ---------- Mode 2: Top 100 ----------
const tPlayer = createPlayer($('#tPlayer'));
stops.top100 = () => { machine.deactivate(); tPlayer.stop(); };
function showBig(slot, card, extra = [], valid = () => true) {
  slot.replaceChildren(card, ...extra);
  requestAnimationFrame(() => { if (valid()) reveal(card); });
}
const shown = new Set();
const ringSize = () => (innerWidth < 520 ? 10 : 12);
let soundOn = true;
try { soundOn = localStorage.getItem('encore.sound') !== 'off'; } catch {}
const sound = new Sound(soundOn);
function soundLabel() {
  $('#sound').textContent = sound.enabled ? 'Sound on' : 'Sound off';
  $('#sound').setAttribute('aria-pressed', String(sound.enabled));
}
$('#sound').addEventListener('click', () => {
  sound.enabled = !sound.enabled;
  if (sound.enabled) sound.unlock();
  try { localStorage.setItem('encore.sound', sound.enabled ? 'on' : 'off'); } catch {}
  soundLabel();
});
soundLabel();
const machine = new PullMachine({
  ring: $('#ring'), hit: $('#ringBtn'), buttons: [$('#pull')], slots: ringSize,
  radius: (width, n) => Math.round((width / 2) / Math.tan(Math.PI / n) + 18),
  renderSlot: (slot, song) => {
    slot.classList.add('slot');
    slot.replaceChildren(songCard(song, { size: 'mini', faceDown: true }));
  },
  sound, tierOf: (song) => G.songRarity(song.o).id,
  say: (text) => { $('#topAnnounce').textContent = text; },
  onLand: (song, tier) => { $('#topAnnounce').textContent = `#${song.o} ${song.t} ? ${tier}!`; },
  onReveal: (song) => {
    const token = machine.generation;
    const isNew = win('song', song.id);
    playTop(song, true, isNew, () => machine.generation === token && machine.active);
  },
});
machine.setPool(TOP, () => {
  const song = G.dealRing(TOP, 1, shown)[0];
  if (song) shown.add(song.id);
  return song;
});
function playTop(song, pulled, isNew, valid) {
  const card = songCard(song, { size: 'big' });
  const extra = [];
  if (pulled) {
    const stamp = document.createElement('div');
    stamp.className = `stamp ${card.classList[1]}`;
    stamp.textContent = `#${song.o} ${G.songRarity(song.o).label}${isNew ? ' · New' : ''}`;
    extra.push(stamp);
  }
  $('#tResult').hidden = false;
  showBig($('#tCard'), card, extra, valid);
  tPlayer.play(song.id);
  $('#tNow').replaceChildren('Now playing: ', Object.assign(document.createElement('b'), { textContent: song.t }), ` · ${song.by} · #${song.o}`);
  document.querySelectorAll('.chart li').forEach((li) => li.classList.toggle('playing', li.dataset.id === song.id));
  $('#tResult').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'nearest' });
}

function renderChart() {
  const frag = document.createDocumentFragment();
  for (const s of TOP) {
    const li = document.createElement('li');
    li.className = G.songRarity(s.o).id;
    li.dataset.id = s.id;
    li.innerHTML = `<button class="row"><span class="rk"></span><img alt="" loading="lazy" referrerpolicy="no-referrer"><span class="tt"><b></b><span></span></span><span class="nums"><b></b><br></span></button>`;
    li.querySelector('button').setAttribute('aria-label', `Play number ${s.o}: ${s.t} by ${s.by}`);
    li.querySelector('.rk').textContent = s.o;
    li.querySelector('img').src = `https://i.ytimg.com/vi/${s.id}/mqdefault.jpg`;
    li.querySelector('.tt b').textContent = s.t;
    li.querySelector('.tt span').textContent = s.by;
    li.querySelector('.nums b').textContent = G.fmt(G.score(s)) + ' pts';
    li.querySelector('.nums').append(`${s.s ? G.fmt(s.s) : '—'} streams · ${G.fmt(s.v)} views`);
    li.querySelector('button').addEventListener('click', () => {
      machine.cancel();
      const token = machine.generation;
      playTop(s, false, undefined, () => machine.generation === token && machine.active);
    });
    frag.append(li);
  }
  $('#chart').replaceChildren(frag);
  $('#updated').textContent = `data from ${data.updated}`;
}

// ---------- binder ----------
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
  const frag = document.createDocumentFragment();
  for (const x of list) {
    const id = binderTab === 'a' ? x.name : x.id;
    const o = { size: 'mini', faceDown: !have.has(id), locked: true }; // uncollected: a plain back, no art loaded
    frag.append(binderTab === 'a' ? artistCard(x, o) : songCard(x, o));
  }
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
$('#credits').addEventListener('toggle', () => {
  if (!$('#credits').open || $('#creditList').children.length) return;
  const frag = document.createDocumentFragment();
  for (const [name, p] of Object.entries(portraits).sort(([a], [b]) => a.localeCompare(b))) {
    const li = document.createElement('li');
    const a = Object.assign(document.createElement('a'), {
      href: p.page, target: '_blank', rel: 'noopener',
      textContent: p.mv ? 'still from an official music video' : `${p.author}, ${p.license}`,
    });
    li.append(`${name}: `, a, p.mv ? '' : ' (cropped)');
    frag.append(li);
  }
  $('#creditList').replaceChildren(frag);
});

// ---------- boot ----------
startCrowd($('#crowd'));
renderChart();
updateCount();
/** #top100, #roulette, #roulette/favs; old #top and #bias links still work. No hash: last deck used. */
function modeFromHash() {
  const h = location.hash.slice(1);
  let saved = 'all';
  try { saved = localStorage.getItem('encore.deck') === 'favs' ? 'favs' : 'all'; } catch {}
  if (h === 'top100' || h === 'top') return setMode('top100');
  if (h === 'roulette/favs' || h === 'bias') return setMode('roulette', 'favs');
  if (h === 'roulette') return setMode('roulette', 'all');
  setMode('roulette', saved);
}
addEventListener('hashchange', modeFromHash);
modeFromHash();
