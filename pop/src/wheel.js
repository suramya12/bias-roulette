// Canvas wheel. Draw labels, spin to a chosen segment with a CSS transition.
import * as G from './game.js';
import { reduced } from './cards.js';

const FILLS = [
  ['#ff4fa3', '#b3135f'], ['#8b5cff', '#4a1fb8'], ['#3de8ff', '#0b7fa6'], ['#ffd76a', '#c27b00'],
  ['#ff7a3d', '#b33a00'], ['#38f2a5', '#0a8a5a'],
];

export function createWheel(canvas, fills = FILLS) {
  const ctx = canvas.getContext('2d');
  let labels = [], taken = [], rotation = 0;

  // Drawn at the screen's real pixel density, in CSS pixels, so labels stay sharp on phones.
  function draw() {
    const css = canvas.clientWidth, n = labels.length;
    if (!css || !n) return;
    const dpr = Math.min((window.devicePixelRatio || 1) * (canvas.currentCSSZoom || 1), 4);
    const px = Math.round(css * dpr);
    if (canvas.width !== px) canvas.width = canvas.height = px;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, css, css);
    const R = css / 2, seg = (Math.PI * 2) / n, dense = n > 36;
    const rim = R - 4;
    for (let i = 0; i < n; i++) {
      // segment i is centred at angle i*seg + seg/2 measured clockwise from the top
      const a0 = -Math.PI / 2 + i * seg, a1 = a0 + seg;
      const [c1, c2] = fills[(i + (n % fills.length === 1 && i === n - 1 ? 1 : 0)) % fills.length];
      const g = ctx.createRadialGradient(R, R, R * 0.15, R, R, R);
      g.addColorStop(0, c2); g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.globalAlpha = taken[i] ? 0.25 : 1; // already drawn as a finalist
      ctx.beginPath(); ctx.moveTo(R, R); ctx.arc(R, R, rim, a0, a1); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = dense ? 'rgba(11,7,22,.45)' : 'rgba(255,255,255,.55)'; ctx.lineWidth = dense ? 0.6 : 2; ctx.stroke();
    }
    // Labels read outwards along the radius. Font fits the slice at the rim, never under 7px.
    const base = n <= 12 ? Math.min(20, R * 0.09) : Math.max(7, Math.min(16, rim * 0.92 * seg * 0.8));
    const maxLen = R * 0.6;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.translate(R, R); ctx.rotate(-Math.PI / 2 + (i + 0.5) * seg);
      let size = base, t = labels[i];
      const fit = () => { ctx.font = `800 ${size}px "Baloo 2", system-ui, sans-serif`; return ctx.measureText(t).width <= maxLen; };
      while (!fit() && size > base * 0.75) size -= 0.5;
      while (!fit() && t.length > 4) t = t.slice(0, -2).trimEnd() + '…';
      const x = rim - (dense ? 6 : 14);
      if (!taken[i]) {
        // A dark outline instead of a blurred shadow: crisp at small sizes.
        ctx.lineWidth = Math.max(2, size * 0.28); ctx.strokeStyle = 'rgba(11,7,22,.85)';
        ctx.strokeText(t, x, 0);
      }
      ctx.fillStyle = taken[i] ? 'rgba(255,255,255,.35)' : '#fff';
      ctx.fillText(t, x, 0);
      ctx.restore();
    }
    // studs (only while there is room for them)
    for (let i = 0; i < (dense ? 0 : n); i++) {
      const a = -Math.PI / 2 + i * seg;
      ctx.fillStyle = '#fff6c8';
      ctx.beginPath(); ctx.arc(R + Math.cos(a) * (rim - 6), R + Math.sin(a) * (rim - 6), 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Redraw when the wheel changes size (rotation, window resize, or a hidden deck being shown).
  new ResizeObserver(() => draw()).observe(canvas);
  addEventListener("resize", () => draw()); // browser zoom changes pixel density

  return {
    set(list, flags = []) { labels = list; taken = flags; document.fonts?.ready.then(draw); draw(); canvas.setAttribute('aria-label', `Wheel: ${list.join(', ')}`); },
    /** Spin to segment `index`; resolves when it stops. onTick(label) names the slice under the pointer. */
    spin(index, onTick, fast = false) {
      rotation = G.spinAngle(rotation, index, labels.length, fast ? 1 : 5, Math.random() * 2 - 1);
      canvas.style.transitionDuration = fast ? '.7s' : '';
      canvas.style.transform = `rotate(${rotation}deg)`;
      const ms = reduced.matches ? 50 : fast ? 750 : 4700;
      let live = true;
      const tick = () => {
        if (!live) return;
        const m = new DOMMatrixReadOnly(getComputedStyle(canvas).transform);
        const deg = (Math.atan2(m.b, m.a) * 180) / Math.PI;
        const i = Math.floor((((-deg % 360) + 360) % 360) / (360 / labels.length)) % labels.length;
        onTick?.(labels[i]);
        requestAnimationFrame(tick);
      };
      if (onTick) tick();
      return new Promise((r) => setTimeout(() => { live = false; onTick?.(labels[index]); r(); }, ms));
    },
  };
}
