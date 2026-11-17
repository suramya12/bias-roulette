// Collectible cards in a trading-card-game style: metallic frame by rarity, a power gem,
// two stat stones, keywords, foil that follows the pointer, and a reveal animation.
// Used for song cards (Top 100) and idol cards (Bias Roulette). Also keeps the
// viewer's collection in localStorage.

import { artNode } from './art.js';
const CARD_SIZES = { mini: '104px', mid: '150px', big: 'min(300px, 76vw)' }; // widest each card size gets, for srcset

const thumb = (id, size = 'hqdefault') => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${size}.jpg`;
export const short = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}B` : n >= 1e6 ? `${Math.round(n / 1e6)}M` : String(n));
export const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
const ALIAS = { gidle: 'idle', txt: 'tomorrowxtogether' };
const actKey = (a) => { const k = norm(a); return ALIAS[k] || k; };
/**
 * Ways an act may be credited on the chart, best first. Only the lead artist counts, so a
 * feature never lends another idol's hits: "ROSÉ & Bruno Mars" -> ROSÉ, "V BTS" -> V,
 * "LOONA HeeJin" -> HeeJin.
 */
function actKeys(artist) {
  const lead = String(artist).split(/\s+(?:feat\.?|ft\.|x|&|with)\s+|,\s*/i)[0].trim();
  const words = lead.split(/\s+/);
  const keys = [actKey(lead)];
  if (words.length > 1) keys.push(actKey(words.slice(0, -1).join(' ')), actKey(words.slice(1).join(' ')));
  return keys.filter((k, i) => k && keys.indexOf(k) === i);
}

/**
 * Illustrated covers: data/cardart.json maps a card key to a picture in art/, as
 * {song: {"ARTIST | TITLE": "art/song/x.webp"}, idol: {"Name": "art/idol/x.webp"}}.
 * A card listed there shows that picture as it is; every other card keeps its painted cover.
 */
let custom = {};
try {
  const r = await fetch(new URL('../data/cardart.json', import.meta.url), { cache: 'no-cache' });
  if (r.ok) custom = await r.json();
} catch { /* no file, or not in a browser: painted covers only */ }
function customArt(kind, key) {
  const path = custom[kind]?.[key];
  return path ? { kind: 'custom', src: new URL(`../${path}`, import.meta.url).href } : null;
}
export const hasArt = (kind, key) => Boolean(custom[kind]?.[key]);

export const TIERS = { legend: 'Legendary', epic: 'Epic', rare: 'Rare', common: 'Common' };
export const tierOf = (rank) => (!rank || rank > 100 ? 'common' : rank <= 10 ? 'legend' : rank <= 30 ? 'epic' : 'rare');
/** Rank among all songs (both lists share it), so a song is the same card everywhere. */
const overall = (s) => s.overall ?? s.rank;
const ART_WORDS = { 'HUNTR/X': 'demon hunt golden', 'Saja Boys': 'demon hunt', 'K/DA': 'legend game' };
const SOLO = new Set(['Jung Kook', 'Jimin', 'V', 'RM', 'Jin', 'j-hope', 'Agust D', 'ROSÉ', 'LISA', 'JENNIE', 'JISOO', 'PSY', 'IU', 'TAEYEON', 'HWASA', 'Jay Park', 'G-DRAGON']);
const SOUNDTRACK = { 'HUNTR/X': 'Soundtrack', 'Saja Boys': 'Soundtrack', 'K/DA': 'Game Anthem' };

/** A stable, bright colour per name, as "rgb(r, g, b)". */
export function colorOf(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  const s = 0.95, l = 0.64, a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return `rgb(${f(0)}, ${f(8)}, ${f(4)})`;
}

// ---------- card data ----------
/** Card for a chart song: {rank, artist, title, videoId, streams, views, score, vibe?} */
export function songCard(s) {
  const kw = [];
  if (SOUNDTRACK[s.artist]) kw.push(SOUNDTRACK[s.artist]);
  if (s.streams >= 1e9 || s.views >= 1e9) kw.push('Billion Club');
  if (s.views > s.streams * 1.6) kw.push('Viral MV');
  else if (s.streams > s.views * 1.6) kw.push('Streaming Giant');
  if (SOLO.has(s.artist)) kw.push('Solo');
  return {
    kind: 'song', key: `${s.artist} | ${s.title}`, name: s.title, type: 'Song', act: s.artist, color: colorOf(s.artist),
    art: {
      seed: `song|${s.artist}|${s.title}`, kind: 'song', title: s.title, act: s.artist, color: colorOf(s.artist), tier: tierOf(overall(s)),
      words: `${s.title} ${s.vibe || ''} ${ART_WORDS[s.artist] || ''}`,
      photo: customArt('song', `${s.artist} | ${s.title}`) || { kind: 'mv', src: thumb(s.videoId) },
    },
    tier: tierOf(overall(s)), gem: overall(s), gemLabel: 'Rank',
    left: { value: short(s.streams), label: 'Streams', icon: '♫' },
    right: { value: short(s.views), label: 'Views', icon: '▶' },
    keywords: kw.slice(0, 3),
    flavor: s.vibe ? `“${s.vibe}.” Score ${short(s.score)}.` : `Score ${short(s.score)}: streams and MV views, averaged.`,
    credit: null,
  };
}

/** Index of chart songs by act, for idol power. */
export function chartIndex(top) {
  const byAct = new Map();
  for (const s of top || []) {
    const k = actKey(s.artist);
    if (!byAct.has(k)) byAct.set(k, []);
    byAct.get(k).push(s);
  }
  const songs = new Map((top || []).map((s) => [actKey(s.artist) + '|' + norm(s.title), s]));
  return { byAct, songs };
}

/** The chart entry for a roulette song, if it charted. */
export function chartSong(index, artist, title) {
  if (!index) return null;
  for (const k of actKeys(artist)) { const s = index.songs.get(k + '|' + norm(title)); if (s) return s; }
  return null;
}
/** Chart songs credited to this act (first credit form that matches). */
function actHits(index, artist) {
  for (const k of actKeys(artist)) { const list = index?.byAct.get(k); if (list) return list; }
  return [];
}

/**
 * Card for an idol: {name, label, color, songs:[{artist, title, videoId}]}.
 * Power comes from the Top 100: how much the idol's group and solo acts have charted.
 */
/**
 * Who gets which picture, decided for all idols at once so no two share one: their own
 * photo first; then a frame from an MV they lead (solo), not taken by anyone else; then an
 * unused group MV. Returns name -> {photo, credit}.
 */
export function artPlan(idols, portraits) {
  const plan = new Map(), used = new Set();
  for (const i of idols) {
    const p = portraits?.[i.name];
    if (p && !used.has(p.src)) { used.add(p.src); plan.set(i.name, { photo: { kind: 'portrait', src: p.src, focus: [0.5, 0.3] }, credit: { text: `Photo: ${p.author}, ${p.license}`, href: p.file } }); }
  }
  const take = (i, songs) => {
    for (const s of songs) {
      if (!s.videoId || used.has(s.videoId)) continue;
      used.add(s.videoId);
      plan.set(i.name, { photo: { kind: 'mv', src: thumb(s.videoId, 'hq2') }, credit: null }); // a mid-video frame, so it differs from the song card
      return true;
    }
    return false;
  };
  const rest = idols.filter((i) => !plan.has(i.name));
  const groupAct = (i) => i.songs[0]?.artist;
  for (const i of rest) take(i, i.label === 'Solo' ? i.songs : i.songs.filter((s) => s.artist !== groupAct(i)));
  for (const i of rest) if (!plan.has(i.name)) take(i, i.songs);
  return plan;
}

export function idolCard(idol, index, plan = null) {
  const acts = [...new Set(idol.songs.map((s) => s.artist))];
  const hits = [...new Set(acts.flatMap((a) => actHits(index, a)))].sort((a, b) => a.rank - b.rank);
  const groupHits = new Set(idol.label === 'Solo' ? [] : actHits(index, idol.songs[0]?.artist || ''));
  const groupHit = (s) => groupHits.has(s);
  const best = hits[0];
  const total = hits.reduce((n, s) => n + s.score, 0);
  // Power 1-10 on a log scale: solo hits count fully, group hits at a third.
  const soloTotal = hits.filter((s) => !groupHit(s)).reduce((n, s) => n + s.score, 0);
  const weighted = soloTotal + (total - soloTotal) / 3;
  const power = weighted > 0 ? Math.max(1, Math.min(10, Math.round(1 + (9 * Math.log10(Math.max(1, weighted / 5e7))) / Math.log10(200)))) : 1;
  const groupAct = idol.songs[0]?.artist;
  const soloist = idol.label === 'Solo'; // a soloist's "group" in the roster is their own act
  const group = soloist ? 0 : idol.songs.filter((s) => s.artist === groupAct).length;
  const own = idol.songs.length - group;
  const ownSong = idol.songs.find((s) => s.artist !== groupAct || soloist);
  const drawn = customArt('idol', idol.name);
  const pick = drawn ? { photo: drawn, credit: null } : plan?.get(idol.name) || null;
  const kw = [];
  if (best) kw.push(`#${best.rank} Peak`);
  if (hits.some((s) => s.streams >= 1e9 || s.views >= 1e9)) kw.push('Billion Club');
  if (own) kw.push('Solo Era');
  if (hits.length >= 5) kw.push('Hitmaker');
  if (!hits.length) kw.push('Hidden Gem');
  return {
    kind: 'idol', key: idol.name, name: idol.name, type: soloist ? 'Soloist' : 'Idol', act: soloist ? groupAct : idol.label, color: idol.color,
    art: {
      seed: `idol|${idol.name}|${idol.label}`, kind: 'idol', title: idol.name, act: idol.label, color: idol.color, tier: best ? tierOf(best.rank) : 'common',
      words: `${best?.title || ownSong?.title || ''} ${idol.name}`, photo: pick?.photo || null,
    },
    credit: pick?.credit || null,
    tier: best ? tierOf(best.rank) : 'common', gem: power, gemLabel: 'Power',
    left: { value: String(group), label: 'Group', icon: '♪' },
    right: { value: String(own), label: 'Solo', icon: '★' },
    keywords: kw.slice(0, 3),
    flavor: best
      ? `${hits.length} Top 100 hit${hits.length > 1 ? 's' : ''}. Biggest: ${best.title}.`
      : `${idol.songs.length} songs in the deck. Still waiting for a Top 100 hit.`,
  };
}

/** Small card for a roulette song (uses chart numbers when the song charted). */
export function rouletteSongCard(song, index) {
  const c = chartSong(index, song.artist, song.title);
  if (c) return songCard(c);
  return {
    kind: 'song', key: `${song.artist} | ${song.title}`, name: song.title, type: 'Song', act: song.artist, color: colorOf(song.artist),
    art: { seed: `song|${song.artist}|${song.title}`, kind: 'song', title: song.title, act: song.artist, color: colorOf(song.artist), tier: 'common', words: song.title, photo: customArt('song', `${song.artist} | ${song.title}`) || (song.videoId ? { kind: 'mv', src: thumb(song.videoId) } : null) },
    credit: null, tier: 'common', gem: '–', gemLabel: 'Rank',
    left: { value: '–', label: 'Streams', icon: '♫' }, right: { value: '–', label: 'Views', icon: '▶' },
    keywords: [], flavor: 'A deep cut: outside the all-time Top 100.',
  };
}

// ---------- DOM ----------
function el(tag, cls, ...children) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.append(...children.filter((c) => c != null && c !== false));
  return n;
}

/** Build a card. size: 'big' | 'mid' | 'mini'. */
export function makeCard(d, { size = 'big', isNew = false } = {}) {
  const img = artNode(null, d.art, size === 'big' ? 'big' : 'small', 'tcg-canvas', CARD_SIZES[size] || CARD_SIZES.big);
  const name = el('b', 'tcg-name', d.name);
  if (d.name.length > 22) name.classList.add('xlong');
  else if (d.name.length > 13) name.classList.add('long');
  const stat = (side, s) => el('div', `tcg-stat ${side}`,
    el('i', '', el('small', 'tcg-ico', s.icon), el('b', 'tcg-num', s.value), el('small', 'tcg-lab', s.label)));

  const face = el('div', 'tcg-face',
    el('div', 'tcg-frame',
      el('div', 'tcg-body',
        el('div', 'tcg-art', img),
        el('div', 'tcg-arch'),
        el('div', 'tcg-banner', name, el('span', 'tcg-type', `${d.type} · ${d.act}`)),
        el('span', 'tcg-emblem', [...d.act.replace(/[^\p{L}\p{N}]/gu, '')][0]?.toUpperCase() || '♥'),
        el('div', 'tcg-text',
          el('div', 'tcg-kws', ...d.keywords.map((k, i) => { const s = el('span', 'kw', k); s.style.setProperty('--i', i); return s; })),
          el('p', 'tcg-flavor', d.flavor)),
        el('span', 'tcg-rarity'),
        el('div', 'tcg-foil'), el('div', 'tcg-glare'), el('div', 'tcg-shine'))),
    el('div', 'tcg-gem', el('i', '', el('b', 'tcg-num', String(d.gem))), el('small', '', d.gemLabel)),
    stat('left', d.left), stat('right', d.right));

  const fullArt = d.art.photo?.kind === 'custom'; // an illustrated cover fills the whole card
  const card = el('div', `tcg ${d.tier}${fullArt ? ' fullart' : ''}`, face, el('div', 'tcg-backface', cardBackArt()));
  card.style.setProperty('--ac', d.color);
  const wrap = el('div', `tcg-wrap ${size}`, card,
    d.tier === 'legend' && size === 'big' ? el('div', 'tcg-sparks', ...Array.from({ length: 10 }, (_, i) => { const s = el('i'); s.style.setProperty('--i', i); return s; })) : null,
    d.tier === 'legend' ? el('div', 'tcg-flare', `★ ${TIERS.legend} ★`) : null,
    isNew ? el('span', 'tcg-new', 'NEW!') : null);
  if (size === 'big' && d.credit) {
    const a = el('a', 'tcg-credit', d.credit.text);
    a.href = d.credit.href; a.target = '_blank'; a.rel = 'noopener';
    wrap.append(a);
  }
  wrap.dataset.tier = d.tier;
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${TIERS[d.tier]} ${d.type.toLowerCase()} card: ${d.name}, ${d.act}. ${d.gemLabel} ${d.gem}. ${d.left.label} ${d.left.value}, ${d.right.label} ${d.right.value}.${d.keywords.length ? ' ' + d.keywords.join(', ') + '.' : ''}`);
  if (size === 'big') attachTilt(wrap);
  return wrap;
}

function cardBackArt() {
  return el('div', 'tcg-back', el('span', 'tcg-back-mark', '♥'), el('small', '', 'BIAS ROULETTE'));
}

/** A face-down card (for undrawn finalists and uncollected slots). */
export function cardBack(size = 'mini', label = '') {
  const wrap = el('div', `tcg-wrap ${size} facedown`, el('div', 'tcg', el('div', 'tcg-face'), el('div', 'tcg-backface', cardBackArt())));
  if (label) wrap.append(el('span', 'tcg-slot', label));
  return wrap;
}

/** Pointer tilt, gloss and glare. */
export function attachTilt(wrap) {
  const card = wrap.firstElementChild;
  let at = null; // latest pointer, applied once per frame
  wrap.addEventListener('pointermove', (e) => { if (!at) requestAnimationFrame(apply); at = e; });
  function apply() {
    if (!at) return;
    const r = wrap.getBoundingClientRect();
    const px = (at.clientX - r.left) / r.width;
    const py = (at.clientY - r.top) / r.height;
    at = null;
    card.style.setProperty('--rx', `${((0.5 - py) * 20).toFixed(1)}deg`);
    card.style.setProperty('--ry', `${((px - 0.5) * 24).toFixed(1)}deg`);
    card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
  }
  wrap.addEventListener('pointerleave', () => { at = null; for (const p of ['--rx', '--ry', '--mx', '--my']) card.style.removeProperty(p); });
}

/** Reveal: flip in, sweep the shine, count the numbers up. Resolves when done. */
export function playIn(wrap, { reduced = false } = {}) {
  wrap.classList.remove('play-in');
  void wrap.offsetWidth;
  wrap.classList.add('play-in');
  if (!reduced) {
    for (const n of wrap.querySelectorAll('.tcg-num')) countUp(n, 900, 650);
  }
  return new Promise((r) => setTimeout(r, reduced ? 50 : 1500));
}

function countUp(node, duration, delay) {
  const text = node.textContent;
  const m = text.match(/^([\d.]+)([BMK]?)$/);
  if (!m) return;
  const target = parseFloat(m[1]);
  const decimals = (m[1].split('.')[1] || '').length;
  node.textContent = (0).toFixed(decimals) + m[2];
  const t0 = performance.now() + delay;
  const step = (t) => {
    const p = Math.max(0, Math.min(1, (t - t0) / duration));
    node.textContent = (target * (1 - Math.pow(1 - p, 3))).toFixed(decimals) + m[2];
    if (p < 1) requestAnimationFrame(step); else node.textContent = text;
  };
  requestAnimationFrame(step);
}

// ---------- collection ----------
const STORE = 'bias-roulette.collection';
let collectionSnapshot = {};
let unsavedCards = {};
function readAll() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    collectionSnapshot = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    for (const [kind, cards] of Object.entries(unsavedCards)) {
      const box = (collectionSnapshot[kind] ||= {});
      for (const [key, count] of Object.entries(cards)) box[key] = (box[key] || 0) + count;
    }
  } catch { /* keep the last readable collection and any in-memory changes */ }
  return collectionSnapshot;
}
export const collection = {
  has(kind, key) { return Boolean(readAll()[kind]?.[key]); },
  /** Returns true the first time a card is collected. */
  add(kind, key) {
    const all = readAll();
    const box = (all[kind] ||= {});
    const isNew = !box[key];
    box[key] = (box[key] || 0) + 1;
    const pending = (unsavedCards[kind] ||= {});
    pending[key] = (pending[key] || 0) + 1;
    try {
      localStorage.setItem(STORE, JSON.stringify(all));
      unsavedCards = {};
    } catch { /* keep this addition for the current visit */ }
    return isNew;
  },
  count(kind, keys) { const box = readAll()[kind] || {}; return keys.filter((k) => box[k]).length; },
  times(kind, key) { return readAll()[kind]?.[key] || 0; },
};

// ---------- binder (collection dialog) ----------
let binderBound = false;
/** Open the collection: every card in `cards`, face up if collected. */
export function openBinder({ title, kind, cards, reduced = false }) {
  const $ = (id) => document.getElementById(id);
  const dlg = $('binder');
  const view = $('binderView');
  if (!binderBound) {
    binderBound = true;
    $('binderClose').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    view.addEventListener('click', (e) => { if (e.target === view) view.hidden = true; });
    dlg.addEventListener('cancel', (e) => { if (!view.hidden) { e.preventDefault(); view.hidden = true; } });
  }
  const got = collection.count(kind, cards.map((c) => c.key));
  $('binderTitle').textContent = title;
  $('binderCount').textContent = `${got} of ${cards.length} collected${got ? '' : ': win some to fill the binder'}`;
  $('binderMeter').style.setProperty('--p', `${(got / Math.max(1, cards.length)) * 100}%`);
  view.hidden = true;
  const ordered = kind === 'idol' ? [...cards].sort((x, y) => collection.has(kind, y.key) - collection.has(kind, x.key)) : cards;
  $('binderGrid').replaceChildren(...ordered.map((c) => {
    const owned = collection.has(kind, c.key);
    const fig = el('figure', owned ? '' : 'locked');
    fig.style.margin = '0';
    if (owned) {
      const btn = el('button', '', makeCard(c, { size: 'mid' }));
      btn.type = 'button';
      btn.setAttribute('aria-label', `Open ${c.name}`);
      btn.addEventListener('click', () => {
        const big = makeCard(c, { size: 'big' });
        view.replaceChildren(big);
        view.hidden = false;
        playIn(big, { reduced });
      });
      fig.append(btn, el('figcaption', '', `${c.name} ×${collection.times(kind, c.key)}`));
    } else {
      fig.append(cardBack('mid', c.kind === 'song' ? `#${c.gem}` : '?'), el('figcaption', '', '???'));
    }
    return fig;
  }));
  dlg.showModal();
}
