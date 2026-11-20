import { isLite } from './src/fx.js';
import * as passport from './src/passport.js';
import { videoThumbnail } from './src/validation.js';
import { shareCard } from './src/share-card.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SIDE_COLORS = { kpop: '#b693ff', pop: '#ffb020', anime: '#ff2d55', bollywood: '#22d3b0' };
const SIDE_LABELS = { kpop: 'K-pop', pop: 'Pop', anime: 'Anime', bollywood: 'Bollywood' };

const cards = [...document.querySelectorAll('.stage-card')];
const passportBar = document.getElementById('passportBar');
const passportSheet = document.getElementById('passportSheet');
const passportShare = document.getElementById('passportShare');
const passportClose = document.getElementById('passportClose');
const sheetRing = document.getElementById('sheetRing');
const sheetNumbers = document.getElementById('sheetNumbers');
const setsList = document.getElementById('setsList');
const introCard = document.querySelector('.intro-card');
const heading = document.querySelector('.stage-heading');
const figures = document.querySelectorAll('.card-figure');
const continueLink = document.querySelector('.continue');
const canvas = document.querySelector('.particles');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const phone = matchMedia('(width < 700px)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const still = () => reduced.matches || isLite();
const ease = 'cubic-bezier(.33, 1, .68, 1)';
const rand = (min, max) => min + Math.random() * (max - min);

async function loadManifest(path) {
  try {
    const response = await fetch(new URL(path, import.meta.url));
    if (!response?.ok) return;
    const manifest = await response.json();
    if (!manifest || typeof manifest !== 'object') return;
    for (const card of cards) {
      const stats = manifest[card.dataset.side]?.stats;
      if (!Array.isArray(stats) || !stats.length) continue;
      const stat = card.querySelector('.stat');
      if (!stat) continue;
      stat.textContent = stats.join(' · ');
      stat.hidden = false;
    }
  } catch {
    // Keep the card's static text if a manifest is missing or unreadable.
  }
}

function showContinue() {
  try {
    const side = localStorage.getItem('bias-roulette.lastSide');
    const card = cards.find((link) => link.dataset.side === side);
    if (!card) return;
    continueLink.href = card.href;
    continueLink.dataset.side = side;
    continueLink.textContent = `Continue: ${card.querySelector('h2').textContent} →`;
    continueLink.hidden = false;
  } catch { /* private mode */ }
}

const intro = [];
function finishIntro() {
  introCard.hidden = true;
  cards.forEach((card) => card.classList.remove('is-dealing'));
  intro.splice(0).forEach((animation) => animation.cancel());
  figures.forEach((figure) => {
    if (figure.dataset.srcset && !figure.srcset) figure.srcset = figure.dataset.srcset;
    if (figure.dataset.src && !figure.getAttribute('src')) figure.src = figure.dataset.src;
  });
}

function dealCards() {
  if (still() || !introCard.animate || document.hidden) {
    finishIntro();
    return;
  }
  const bounds = document.querySelector('.cards').getBoundingClientRect();
  introCard.hidden = false;
  const lift = introCard.animate([
    { transform: 'translate(-50%, -50%) scale(.88)', opacity: 0 },
    { transform: 'translate(-50%, -54%) scale(1.04)', opacity: 1, offset: .64 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
  ], { duration: 300, easing: ease });
  intro.push(lift);
  lift.onfinish = () => { introCard.hidden = true; };

  intro.push(heading.animate([
    { transform: 'translateY(12px)', opacity: 0 },
    { transform: 'translateY(0)', opacity: 1 },
  ], { delay: 240, duration: 430, easing: ease, fill: 'backwards' }));

  cards.forEach((card, index) => {
    const rect = card.getBoundingClientRect();
    const x = bounds.left + (bounds.width - rect.width) / 2 - rect.left;
    const y = bounds.top + (bounds.height - rect.height) / 2 - rect.top;
    const start = `translate(${x}px, ${y}px)`;
    card.classList.add('is-dealing');
    intro.push(card.animate([
      { transform: start, opacity: 0 },
      { opacity: 1, offset: .14 },
      { transform: 'translate(0, 0)', opacity: 1 },
    ], { delay: 240, duration: 430, easing: ease, fill: 'backwards' }));
    const flip = card.querySelector('.card-flip').animate(
      [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }],
      { delay: 670 + index * 60, duration: 350, easing: ease, fill: 'backwards' },
    );
    intro.push(flip);
    flip.onfinish = () => {
      card.classList.remove('is-dealing');
      if (index === cards.length - 1) finishIntro();
    };
  });
}

const accentByCard = new Map(cards.map((card) => [
  card, getComputedStyle(card).getPropertyValue('--accent').trim(),
]));
const accents = [...accentByCard.values()];
let hovered = null;
let focused = null;
let pointer = null;

for (const card of cards) {
  const releasePress = (event) => {
    if (event.pointerType === 'touch' && event.isPrimary) card.classList.remove('is-pressed');
  };
  card.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' && event.isPrimary) card.classList.add('is-pressed');
  });
  card.addEventListener('pointerup', releasePress);
  card.addEventListener('pointercancel', releasePress);
  card.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'touch' && finePointer.matches) hovered = card;
  });
  card.addEventListener('pointermove', (event) => {
    if (!finePointer.matches || event.pointerType === 'touch' || still()) return;
    const rect = card.getBoundingClientRect();
    const x = 2 * (event.clientX - rect.left) / rect.width - 1;
    const y = 2 * (event.clientY - rect.top) / rect.height - 1;
    const length = Math.max(1, Math.hypot(x, y));
    card.style.setProperty('--pointer-x', x / length);
    card.style.setProperty('--pointer-y', y / length);
    card.style.setProperty('--tilt-x', `${-y * 8 / length}deg`);
    card.style.setProperty('--tilt-y', `${x * 8 / length}deg`);
  });
  card.addEventListener('pointerleave', () => {
    if (hovered === card) hovered = null;
    card.style.removeProperty('--tilt-x');
    card.style.removeProperty('--tilt-y');
    card.style.removeProperty('--pointer-x');
    card.style.removeProperty('--pointer-y');
  });
  card.addEventListener('focus', () => {
    if (intro.length) finishIntro();
    focused = card;
  });
  card.addEventListener('blur', () => { if (focused === card) focused = null; });
}

addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'touch') pointer = { x: event.clientX, y: event.clientY };
}, { passive: true });
document.documentElement.addEventListener('pointerleave', () => { pointer = null; });
addEventListener('blur', () => { pointer = null; });

const context = canvas.getContext('2d');
let width = 0;
let height = 0;
let dots = [];
let frame = 0;
let previousTime = 0;
let activeAccent;
let fadeStart = 0;

function sizeCanvas() {
  if (!context || still()) return;
  width = innerWidth;
  height = innerHeight;
  const ratio = Math.min(devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  activeAccent = undefined;
  dots = Array.from({ length: phone.matches ? 60 : 140 }, () => {
    const opacity = rand(.25, .6);
    return {
      x: rand(0, width), y: rand(0, height), vx: rand(-.26, .26), vy: rand(-.28, -.08),
      dx: 0, dy: 0, radius: rand(.5, 1.2), color: accents[Math.floor(rand(0, accents.length))],
      opacity, idleOpacity: opacity, fromOpacity: opacity,
    };
  });
}

function paintParticles(time) {
  frame = 0;
  if (document.hidden || still()) return;
  const step = previousTime ? Math.min((time - previousTime) / 16.667, 2) : 1;
  previousTime = time;
  const accent = accentByCard.get(hovered || focused);
  if (accent !== activeAccent) {
    activeAccent = accent;
    fadeStart = time;
    for (const dot of dots) dot.fromOpacity = dot.opacity;
  }
  const progress = Math.min((time - fadeStart) / 400, 1);
  const blend = progress * progress * (3 - 2 * progress);
  context.clearRect(0, 0, width, height);
  for (const dot of dots) {
    dot.x += dot.vx * step;
    dot.y += dot.vy * step;
    if (dot.x < -8) dot.x = width + 8;
    if (dot.x > width + 8) dot.x = -8;
    if (dot.y < -8) dot.y = height + 8;

    let dx = 0;
    let dy = 0;
    if (pointer) {
      const x = dot.x - pointer.x;
      const y = dot.y - pointer.y;
      const distance = Math.hypot(x, y);
      if (distance > 0 && distance < 120) {
        const push = 62 * (1 - distance / 120) ** 2 / distance;
        dx = x * push;
        dy = y * push;
      }
    }
    dot.dx += (dx - dot.dx) * .08 * step;
    dot.dy += (dy - dot.dy) * .08 * step;
    const x = dot.x + dot.dx;
    const y = dot.y + dot.dy;
    const target = accent ? (dot.color === accent ? .9 : .15) : dot.idleOpacity;
    dot.opacity = dot.fromOpacity + (target - dot.fromOpacity) * blend;
    context.fillStyle = dot.color;
    context.globalAlpha = dot.opacity;
    context.beginPath();
    context.arc(x, y, dot.radius, 0, Math.PI * 2);
    context.fill();
  }
  frame = requestAnimationFrame(paintParticles);
}

function updateMotion() {
  cancelAnimationFrame(frame);
  frame = 0;
  previousTime = 0;
  document.body.classList.toggle('tab-hidden', document.hidden);
  if (still() && intro.length) finishIntro();
  if (!context || document.hidden || still()) return;
  if (width !== innerWidth || height !== innerHeight) sizeCanvas();
  frame = requestAnimationFrame(paintParticles);
}

addEventListener('resize', updateMotion);
document.addEventListener('visibilitychange', updateMotion);
reduced.addEventListener('change', updateMotion);

const departures = [];
let leaving = false;

async function animateDeparture(card, transform) {
  const options = { duration: 300, easing: ease, fill: 'forwards' };
  const expand = card.animate([{ transform: 'none' }, { transform }], options);
  departures.push(expand);
  for (const item of cards) {
    if (item !== card) departures.push(item.animate([{ opacity: 1 }, { opacity: 0 }], options));
  }
  await expand.finished;
}

async function openStage(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || still()) return;
  const card = cards.find((link) => link.dataset.side === event.currentTarget.dataset.side);
  if (!card?.animate) return;
  event.preventDefault();
  if (leaving) return;
  leaving = true;
  const href = event.currentTarget.href;
  if (intro.length) finishIntro();
  const rect = card.getBoundingClientRect();
  const x = (innerWidth - rect.width) / 2 - rect.left;
  const y = (innerHeight - rect.height) / 2 - rect.top;
  const scale = Math.max(innerWidth / rect.width, innerHeight / rect.height) * 1.04;
  const transform = `translate(${x}px, ${y}px) scale(${scale})`;
  const root = document.documentElement;
  root.classList.add('navigating');
  card.classList.add('is-selected');
  if (document.startViewTransition) {
    card.style.setProperty('--departure-transform', transform);
    const transition = document.startViewTransition(() => root.classList.add('has-expanded'));
    try {
      await transition.ready;
      await transition.finished;
    } catch {
      await transition.updateCallbackDone;
      root.classList.remove('has-expanded');
      await animateDeparture(card, transform);
    }
  } else {
    await animateDeparture(card, transform);
  }
  location.assign(href);
}

[...cards, continueLink].forEach((link) => link.addEventListener('click', openStage));
addEventListener('pageshow', ({ persisted }) => {
  if (!persisted) return;
  departures.splice(0).forEach((animation) => animation.cancel());
  leaving = false;
  const selected = document.querySelector('.is-selected');
  selected?.classList.remove('is-selected');
  selected?.style.removeProperty('--departure-transform');
  document.documentElement.classList.remove('navigating', 'has-expanded');
  showContinue();
});

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function buildRing(info) {
  const svg = svgEl('svg', { class: 'passport-ring', viewBox: '0 0 44 44', width: 44, height: 44, 'aria-hidden': 'true' });
  const r = 18;
  const C = 2 * Math.PI * r;
  const g = svgEl('g', { transform: 'rotate(-90 22 22)' });

  const sumTotals = passport.SIDES.reduce((sum, side) => sum + (info.total[side] || 0), 0);
  const activeSides = sumTotals > 0
    ? passport.SIDES.filter((side) => (info.total[side] || 0) > 0)
    : passport.SIDES;
  const gap = activeSides.length > 1 ? 3 : 0;
  const avail = Math.max(1, C - activeSides.length * gap);
  let cursor = 0;

  for (const side of activeSides) {
    const sideTotal = info.total[side] || 0;
    const share = sumTotals > 0 ? sideTotal / sumTotals : 1 / activeSides.length;
    const arcLen = Math.max(1, avail * share);
    const color = SIDE_COLORS[side];

    g.append(svgEl('circle', {
      cx: 22, cy: 22, r, fill: 'none', stroke: color, 'stroke-width': 3.5,
      'stroke-opacity': 0.18, 'stroke-linecap': 'round',
      'stroke-dasharray': `${arcLen.toFixed(2)} ${C.toFixed(2)}`,
      'stroke-dashoffset': (-cursor).toFixed(2),
    }));

    const ratio = sideTotal > 0 ? Math.min(1, (info.owned[side] || 0) / sideTotal) : 0;
    if (ratio > 0) {
      const fillLen = Math.max(1.5, arcLen * ratio);
      g.append(svgEl('circle', {
        cx: 22, cy: 22, r, fill: 'none', stroke: color, 'stroke-width': 3.5,
        'stroke-linecap': 'round',
        'stroke-dasharray': `${fillLen.toFixed(2)} ${C.toFixed(2)}`,
        'stroke-dashoffset': (-cursor).toFixed(2),
      }));
    }
    cursor += arcLen + gap;
  }

  svg.append(g);
  return svg;
}

function flameIcon() {
  const svg = svgEl('svg', { class: 'passport-ico', viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true' });
  svg.append(svgEl('path', {
    d: 'M8.7 1.6c.4 2.2-1 3.5-1.7 4.4-.6.8-.9 1.5-.7 2.4.1.6.5 1 .9 1.2-.2-1 .3-1.8 1.2-2.4.4 1.3 1.6 2 1.6 3.5 0 1.4-1 2.7-2.7 2.7-1.9 0-3.3-1.5-3.3-3.5 0-1.9 1.1-3.3 2.2-4.6.9-1 1.8-2.1 2.5-3.7Z',
    fill: 'currentColor',
  }));
  return svg;
}

function checkIcon() {
  const svg = svgEl('svg', { viewBox: '0 0 12 12', width: 10, height: 10, 'aria-hidden': 'true' });
  svg.append(svgEl('path', {
    d: 'M2.2 6.2 4.8 8.8 9.8 3.4',
    fill: 'none', stroke: '#07060d', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
  return svg;
}

function renderSeals(info) {
  for (const card of cards) {
    const seal = card.querySelector('.card-seal');
    if (!seal) continue;
    const claimed = Boolean(info.day.sealed[card.dataset.side]);
    seal.classList.toggle('is-claimed', claimed);
    seal.setAttribute('aria-label', claimed ? "Today's drop: claimed" : "Today's drop: ready");
    if (claimed) seal.replaceChildren(checkIcon());
    else seal.replaceChildren();
  }
}

function renderPassport() {
  const info = passport.summary();
  renderSeals(info);
  if (!passportBar) return;

  if (!info.hasProfile) {
    const copy = document.createElement('span');
    copy.className = 'passport-empty';
    copy.textContent = "Start your passport: open today's drop on any side";
    passportBar.replaceChildren(buildRing(info), copy);
    return;
  }

  const main = document.createElement('span');
  main.className = 'passport-main';
  const count = document.createElement('strong');
  count.className = 'passport-count';
  count.textContent = `${info.totalOwned.toLocaleString()} ${info.totalOwned === 1 ? 'card' : 'cards'}`;
  main.append(count);
  if (info.totalCards > 0) {
    const of = document.createElement('span');
    of.className = 'passport-of';
    of.textContent = `of ${info.totalCards.toLocaleString()}`;
    main.append(of);
  }

  const meta = document.createElement('span');
  meta.className = 'passport-meta';
  if (info.streak.count > 0) {
    const streak = document.createElement('span');
    streak.className = 'passport-streak';
    streak.append(flameIcon(), `${info.streak.count}-day streak`);
    meta.append(streak);
  }
  const dust = document.createElement('span');
  dust.className = 'passport-dust';
  dust.textContent = `✦ ${info.dust.toLocaleString()}`;
  meta.append(dust);

  passportBar.replaceChildren(buildRing(info), main, meta);
}

async function openPassportSheet() {
  if (!passportSheet) return;
  const info = passport.summary();
  sheetRing.replaceChildren(buildRing(info));
  const parts = [`${info.totalOwned.toLocaleString()} ${info.totalOwned === 1 ? 'card' : 'cards'}`];
  if (info.totalCards > 0) parts[0] += ` of ${info.totalCards.toLocaleString()}`;
  if (info.streak.count > 0) parts.push(`${info.streak.count}-day streak`);
  parts.push(`✦ ${info.dust.toLocaleString()}`);
  sheetNumbers.textContent = parts.join(' · ');

  setsList.replaceChildren(Object.assign(document.createElement('p'), { className: 'sets-empty', textContent: 'Loading sets…' }));
  passportSheet.showModal();

  const sets = await passport.loadSets();
  if (!sets.length) {
    setsList.replaceChildren(Object.assign(document.createElement('p'), { className: 'sets-empty', textContent: 'No sets available yet.' }));
    return;
  }

  const rows = passport.setProgress(sets).map((set) => {
    const row = document.createElement('article');
    row.className = 'set-row' + (set.complete ? ' is-complete' : '');

    const top = document.createElement('div');
    top.className = 'set-top';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'set-title-wrap';

    const dots = document.createElement('span');
    dots.className = 'set-dots';
    const distinctSides = set.side === 'bridge'
      ? [...new Set(set.items.map((i) => i.side))]
      : [set.side];
    for (const s of distinctSides) {
      const dot = document.createElement('i');
      dot.className = 'set-dot';
      dot.style.setProperty('--dot', SIDE_COLORS[s] || '#f2c14e');
      dots.append(dot);
    }

    const name = document.createElement('h4');
    name.className = 'set-name';
    name.textContent = set.name;
    titleWrap.append(dots, name);

    const status = document.createElement('span');
    status.className = 'set-status';
    status.textContent = set.complete ? 'Complete' : `${set.ownedCount} / ${set.totalCount}`;
    top.append(titleWrap, status);

    const blurb = document.createElement('p');
    blurb.className = 'set-blurb';
    blurb.textContent = set.blurb;

    const bar = document.createElement('div');
    bar.className = 'set-bar';
    const fill = document.createElement('i');
    fill.style.setProperty('--p', `${(set.ratio * 100).toFixed(1)}%`);
    bar.append(fill);

    const items = document.createElement('div');
    items.className = 'set-items';
    for (const item of set.items) {
      if (item.owned) {
        const thumb = document.createElement('img');
        thumb.className = 'set-thumb';
        thumb.alt = `${SIDE_LABELS[item.side] || item.side} song`;
        thumb.loading = 'lazy';
        thumb.decoding = 'async';
        const src = videoThumbnail(item.id, 'mqdefault');
        if (src) thumb.src = src;
        items.append(thumb);
      } else {
        const missing = document.createElement('span');
        missing.className = 'set-missing';
        missing.style.setProperty('--side', SIDE_COLORS[item.side] || '#a9a3c4');
        missing.textContent = SIDE_LABELS[item.side] || item.side;
        items.append(missing);
      }
    }

    row.append(top, blurb, bar, items);
    return row;
  });
  setsList.replaceChildren(...rows);
}

passportBar?.addEventListener('click', openPassportSheet);
passportShare?.addEventListener('click', async () => {
  passportShare.disabled = true;
  try { await shareCard(passport.summary()); } finally { passportShare.disabled = false; }
});
passportClose?.addEventListener('click', () => passportSheet?.close());
passportSheet?.addEventListener('click', (e) => { if (e.target === passportSheet) passportSheet.close(); });
addEventListener('pageshow', ({ persisted }) => { if (persisted) renderPassport(); });

showContinue();
renderPassport();
dealCards();
updateMotion();
loadManifest('data/landing.json').catch(() => {});
loadManifest('bollywood/data/landing.json').catch(() => {});
