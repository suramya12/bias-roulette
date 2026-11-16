// Decoration only: drifting background shapes, tap hearts, confetti, rim lights.

const GLYPHS = ['♥', '★', '✦', '♥', '✧', '★'];
const CANDY = ['#ff4fa3', '#ffe45c', '#6ff2c8', '#b693ff', '#7fd0ff'];
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const rand = (a, b) => a + Math.random() * (b - a);

export const prefersReducedMotion = () => reduced.matches;

// ---------- lite mode: slow devices keep the game but drop the ambient effects ----------
// On when the device says it is small or saving data, or when frames measure slow after load.
// ?lite=1 / ?lite=0 force it for testing.
const LITE_KEY = 'bias-roulette.lite';
const forced = new URLSearchParams(location.search).get('lite');
const remembered = (() => { try { if (forced === '0') localStorage.removeItem(LITE_KEY); return localStorage.getItem(LITE_KEY); } catch { return null; } })();
const nav = navigator;
let lite = forced === '1' || (forced !== '0' && (remembered === '1' || !!nav.connection?.saveData
  || (nav.deviceMemory > 0 && nav.deviceMemory <= 2) || (nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2)));
const applyLite = () => document.documentElement.classList.toggle('lite', lite);
applyLite();
export const isLite = () => lite;

if (!lite && forced !== '0') {
  // Sample ~90 frames once the page has settled; a median over 24 ms (under ~40 fps) means struggling.
  const sample = () => {
    if (document.visibilityState !== 'visible') { document.addEventListener('visibilitychange', sample, { once: true }); return; }
    const gaps = []; let last = 0;
    const frame = (t) => {
      if (document.visibilityState !== 'visible') return; // throttled background frames prove nothing
      if (last) gaps.push(t - last);
      last = t;
      if (gaps.length < 90) { requestAnimationFrame(frame); return; }
      gaps.sort((a, b) => a - b);
      if (gaps[45] > 24) {
        lite = true; applyLite();
        try { localStorage.setItem(LITE_KEY, '1'); } catch { /* private mode */ }
      }
    };
    requestAnimationFrame(frame);
  };
  addEventListener('load', () => setTimeout(sample, 2500), { once: true });
}

export function initSky(el, count = 18) {
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.textContent = GLYPHS[i % GLYPHS.length];
    const d = rand(11, 24);
    s.style.cssText = `--x:${rand(2, 94).toFixed(1)}%;--y:${rand(4, 92).toFixed(1)}vh;--s:${rand(16, 38).toFixed(0)}px;` +
      `--d:${d.toFixed(1)}s;--delay:-${rand(0, d).toFixed(1)}s;--c:${CANDY[i % CANDY.length]}`;
    el.append(s);
  }
}

/** Pass a colour to tint every drifting shape, or null to go back to the candy mix. */
export function setSkyColor(color) {
  const root = document.documentElement.style;
  if (color) root.setProperty('--float', color);
  else root.removeProperty('--float');
}

export function initRimLights(el, count = 24) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const dot = document.createElement('i');
    dot.style.cssText = `--lx:${(50 + 47.3 * Math.cos(a)).toFixed(2)}%;--ly:${(50 + 47.3 * Math.sin(a)).toFixed(2)}%;--ld:${(-1.44 + (i / count) * 1.44).toFixed(3)}s`;
    el.append(dot);
  }
}

function spray(layer, x, y, { count, spread, size, time, colors }) {
  if (reduced.matches) return;
  if (lite) count = Math.ceil(count / 3);
  const z = layer.currentCSSZoom || 1; // screen coordinates in, zoomed layer out
  x /= z; y /= z;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    const ang = rand(0, Math.PI * 2);
    const dist = rand(spread * 0.35, spread);
    s.textContent = GLYPHS[Math.floor(rand(0, GLYPHS.length))];
    s.style.cssText = `--x:${x}px;--y:${y}px;--dx:${(Math.cos(ang) * dist).toFixed(0)}px;--dy:${(Math.sin(ang) * dist - spread * 0.25).toFixed(0)}px;` +
      `--r:${rand(-200, 200).toFixed(0)}deg;--s:${rand(size * 0.6, size).toFixed(0)}px;--t:${rand(time * 0.7, time).toFixed(0)}ms;--c:${colors[i % colors.length]}`;
    s.addEventListener('animationend', () => s.remove(), { once: true });
    layer.append(s);
  }
}

export function tapBurst(layer, x, y) {
  spray(layer, x, y, { count: 5, spread: 60, size: 20, time: 600, colors: ['#ff4fa3', '#ff8ac4', '#ffe45c'] });
}

export function confetti(layer, x, y, color) {
  spray(layer, x, y, { count: 40, spread: 230, size: 34, time: 1300, colors: color ? [color, ...CANDY] : CANDY });
}
