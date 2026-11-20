// Collectible card DOM: frame by rarity, art, gem, stat stones, chips, flavour.
// Foil and glare follow the pointer; reveal flips the card in and counts the numbers up.
import * as G from './game.js';
import { CREDIT_HOSTS, IMAGE_HOSTS, safeUrl, videoThumbnail } from '../../src/validation.js';

export const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** Card model for a song. */
export function songModel(s) {
  const tier = G.songRarity(s.o);
  return {
    kind: 'song', id: s.id, tier, title: s.t, by: s.by, gem: '#' + s.o,
    img: videoThumbnail(s.id), yt: true,
    stats: [{ v: s.s, label: 'Streams' }, { v: s.v, label: 'MV views' }],
    chips: G.songKeywords(s, s.t), flavour: G.songFlavour(s),
  };
}

/** Card model for an artist. */
export function artistModel(a, portrait, songs) {
  const st = G.artistStats(a);
  return {
    kind: 'artist', id: a.name, tier: G.artistRarity(a.power), title: a.name,
    by: a.kind === 'group' ? 'Group' : a.bands.length ? `of ${a.bands.join(' · ')}` : 'Solo artist',
    gem: '⚡' + a.power, img: portrait?.img, yt: !!portrait?.mv,
    stats: [{ v: st.band, label: 'Band songs', n: true }, { v: st.solo, label: 'Solo songs', n: true }],
    chips: G.artistKeywords(a, songs), flavour: G.artistFlavour(a), portrait,
  };
}

const fmtStat = (st, v = st.v) => (st.n ? String(Math.round(v)) : st.v ? G.fmt(v) : '—'); // — = unknown (no Spotify page)

/** Wikimedia thumbs come at 960px; mini cards only need 330px. Originals are left alone. */
const smaller = (url) => url.replace(/\/960px-/, '/330px-');

export function setCardImage(art, model, size) {
  const src = safeUrl(model.img, IMAGE_HOSTS);
  if (!art || !src || art.querySelector('img')) return;
  const img = el('img', model.yt ? 'yt' : '');
  img.alt = model.kind === 'artist' ? `Photo of ${model.title}` : `${model.title} music video still`;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.src = size === 'mini' ? smaller(src) : src;
  art.prepend(img);
}

/** Build a card element. size: 'big' | 'mini'. */
export function makeCard(m, { size = 'big', faceDown = false, locked = false } = {}) {
  const card = el('div', `card ${m.tier.id} ${size}${faceDown ? ' face-down' : ''}`);
  card.dataset.kind = m.kind;
  if (typeof m.id === 'string') card.dataset.id = m.id;
  const inner = el('div', 'card-inner');
  // A locked card (uncollected, in the Binder) is never revealed: only build its back, load no art.
  if (faceDown && locked) {
    inner.append(el('div', 'face back'));
    card.append(inner);
    card.setAttribute('aria-label', 'Not collected yet');
    return card;
  }
  const front = el('div', 'face front');
  const frame = el('div', 'frame');
  const panel = el('div', 'panel');
  const art = el('div', 'art');
  setCardImage(art, m, size);
  art.append(el('div', 'gem', m.gem), el('div', 'tier', m.tier.label));
  panel.append(art, el('div', 'name', m.title), el('div', 'by', m.by));
  if (m.detail) panel.append(el('div', 'by detail', m.detail));
  const chips = el('div', 'chips');
  for (const c of m.chips) chips.append(el('span', '', c));
  const stones = el('div', 'stones');
  for (const st of m.stats) {
    const s = el('div', 'stone');
    const b = el('b', '', fmtStat(st));
    b.dataset.v = st.v;
    b.dataset.n = st.n ? 1 : '';
    s.append(b, el('span', '', st.label));
    stones.append(s);
  }
  panel.append(chips, stones, el('p', 'flavour', m.flavour));
  frame.append(panel);
  front.append(frame, el('div', 'foil'), el('div', 'glare'));
  inner.append(front, el('div', 'face back'));
  card.append(inner);
  card.setAttribute('aria-label', faceDown ? 'Face-down card' : `${m.tier.label} card: ${m.title}`);
  if (size === 'big') attachTilt(card);
  return card;
}

/** 3D tilt + foil/glare that follow the pointer. */
export function attachTilt(card) {
  if (reduced.matches) return;
  const inner = card.querySelector('.card-inner');
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--ry', `${(x - 0.5) * 22}deg`);
    card.style.setProperty('--rx', `${(0.5 - y) * 22}deg`);
    card.style.setProperty('--mx', `${x * 100}%`);
    card.style.setProperty('--my', `${y * 100}%`);
    card.classList.add('live');
  });
  card.addEventListener('pointerleave', () => {
    card.classList.remove('live');
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  });
  // Wait for the last reveal animation (the shine sweep), not the first one that ends.
  inner.addEventListener('animationend', (e) => e.animationName === 'shine' && card.classList.remove('reveal'));
}

/** Flip the card in, sweep a shine, count numbers up; Legendary adds sparks and a flare. */
export function reveal(card) {
  card.classList.remove('face-down');
  if (reduced.matches) return;
  card.classList.add('reveal');
  for (const b of card.querySelectorAll('.stone b')) countUp(b);
  if (card.classList.contains('legendary') && card.classList.contains('big')) {
    const host = card.parentElement;
    host.querySelector('.flare')?.remove();
    const flare = el('div', 'flare');
    host.prepend(flare);
    setTimeout(() => sparks(card), 700);
  }
}

function countUp(b) {
  const target = Number(b.dataset.v), n = !!b.dataset.n, t0 = performance.now(), dur = 1200;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    b.textContent = n ? String(Math.round(target * e)) : target ? G.fmt(target * e) : '—';
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function sparks(card) {
  for (let i = 0; i < 26; i++) {
    const s = el('span', 'spark');
    const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 140;
    s.style.left = 50 + (Math.random() - 0.5) * 30 + '%';
    s.style.top = 40 + (Math.random() - 0.5) * 30 + '%';
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    s.style.animationDelay = Math.random() * 0.25 + 's';
    card.append(s);
    setTimeout(() => s.remove(), 1700);
  }
}

/** Photographer + licence line for an artist card, linked to the file page. */
export function creditLine(portrait) {
  const p = el('p', 'credit');
  if (!portrait) return p;
  const href = safeUrl(portrait.page, CREDIT_HOSTS);
  const text = portrait.mv ? portrait.author : `Photo: ${portrait.author}`;
  if (href) {
    const a = el('a', '', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    p.append(a);
  } else {
    p.append(text);
  }
  if (!portrait.mv) p.append(` · ${portrait.license} · Wikimedia Commons · cropped`);
  return p;
}
