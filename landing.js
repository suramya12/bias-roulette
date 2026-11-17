import { isLite } from './src/fx.js';

const cards = [...document.querySelectorAll('.stage-card')];
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

async function loadManifest() {
  try {
    const response = await fetch(new URL('data/landing.json', import.meta.url));
    if (!response.ok) return;
    const manifest = await response.json();
    for (const card of cards) {
      const stats = manifest[card.dataset.side]?.stats;
      if (!Array.isArray(stats)) continue;
      const stat = card.querySelector('.stat');
      stat.textContent = stats.join(' · ');
      stat.hidden = false;
    }
  } catch {
    // The links work without stats.
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
  figures.forEach((figure) => { figure.src = figure.dataset.src; });
}

function dealCards() {
  if (still() || !introCard.animate || document.hidden) {
    finishIntro();
    return;
  }
  const center = cards[1].getBoundingClientRect();
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
    const start = `translate(${center.left - rect.left}px, ${center.top - rect.top}px)`;
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

showContinue();
dealCards();
updateMotion();
loadManifest();
