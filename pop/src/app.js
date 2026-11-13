import * as G from './game.js';
import { makeCard, reveal, songModel, artistModel, reduced } from './cards.js';
import { createPlayer } from './player.js';
import { createRoulette } from './roulette.js';
import { startCrowd } from './stage.js';

const $ = (s) => document.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, reduced.matches ? Math.min(ms, 60) : ms));

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
stops.top100 = () => tPlayer.stop();
function showBig(slot, card, extra = []) {
  slot.replaceChildren(card, ...extra);
  requestAnimationFrame(() => reveal(card));
}
const ringEl = $('#ring');
const shown = new Set();
const ringSize = () => (innerWidth < 520 ? 10 : 12);
let ring = [];

function layoutRing() {
  const n = ring.length;
  const w = innerWidth < 520 ? 96 : 132;
  const R = Math.round((w / 2) / Math.tan(Math.PI / n) + 18);
  [...ringEl.children].forEach((slot, i) => (slot.style.transform = `rotateY(${(360 / n) * i}deg) translateZ(${R}px)`));
}
function slotFor(song, i) {
  const slot = document.createElement('div');
  slot.className = 'slot';
  const b = document.createElement('button');
  b.setAttribute('aria-label', `Pull card ${i + 1}`);
  b.append(songCard(song, { size: 'mini', faceDown: true }));
  b.addEventListener('click', () => pull(i));
  slot.append(b);
  return slot;
}
function dealRing() {
  ring = G.dealRing(TOP, ringSize(), shown);
  ringEl.replaceChildren(...ring.map(slotFor));
  layoutRing();
}
let pulling = false;
/** The slot currently facing the audience (random when the ring is not turning). */
function frontSlot() {
  const anim = ringEl.getAnimations()[0];
  if (!anim || reduced.matches) return Math.floor(Math.random() * ring.length);
  const progress = (anim.currentTime % 40000) / 40000;
  return Math.round(progress * ring.length) % ring.length;
}
async function pull(i = frontSlot()) {
  if (pulling) return;
  pulling = true;
  try {
    const song = ring[i];
    shown.add(song.id);
    ringEl.children[i].classList.add('pulled');
    const isNew = win('song', song.id);
    playTop(song, true, isNew);
    await wait(650);
    ring = G.refillRing(ring, i, TOP, shown);
    ringEl.replaceChild(slotFor(ring[i], i), ringEl.children[i]);
    layoutRing();
  } finally {
    pulling = false;
  }
}
function playTop(song, pulled, isNew) {
  const card = songCard(song, { size: 'big' });
  const extra = [];
  if (pulled) {
    const stamp = document.createElement('div');
    stamp.className = `stamp ${card.classList[1]}`;
    stamp.textContent = `#${song.o} ${G.songRarity(song.o).label}${isNew ? ' · New' : ''}`;
    extra.push(stamp);
  }
  $('#tResult').hidden = false;
  showBig($('#tCard'), card, extra);
  tPlayer.play(song.id);
  $('#tNow').replaceChildren('Now playing: ', Object.assign(document.createElement('b'), { textContent: song.t }), ` · ${song.by} · #${song.o}`);
  document.querySelectorAll('.chart li').forEach((li) => li.classList.toggle('playing', li.dataset.id === song.id));
  $('#tResult').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'nearest' });
}
$('#pull').addEventListener('click', () => pull());
addEventListener('resize', () => { if (pulling) return; if (ring.length !== ringSize()) dealRing(); else layoutRing(); });

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
    li.querySelector('button').addEventListener('click', () => playTop(s, false));
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
dealRing();
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
