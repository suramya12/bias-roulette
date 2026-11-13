// Canvas wheel. Draw labels, spin to a chosen segment with a CSS transition.
import * as G from './game.js';
import { reduced } from './cards.js';

const FILLS = [
  ['#ff4fa3', '#b3135f'], ['#8b5cff', '#4a1fb8'], ['#3de8ff', '#0b7fa6'], ['#ffd76a', '#c27b00'],
  ['#ff7a3d', '#b33a00'], ['#38f2a5', '#0a8a5a'],
];

export function createWheel(canvas, fills = FILLS) {
  const ctx = canvas.getContext('2d');
  let labels = [], rotation = 0;

  function draw() {
    const S = canvas.width, R = S / 2, n = labels.length;
    ctx.clearRect(0, 0, S, S);
    const seg = (Math.PI * 2) / n;
    for (let i = 0; i < n; i++) {
      // segment i is centred at angle i*seg + seg/2 measured clockwise from the top
      const a0 = -Math.PI / 2 + i * seg, a1 = a0 + seg;
      const [c1, c2] = fills[(i + (n % fills.length === 1 && i === n - 1 ? 1 : 0)) % fills.length];
      const g = ctx.createRadialGradient(R, R, R * 0.15, R, R, R);
      g.addColorStop(0, c2); g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(R, R); ctx.arc(R, R, R - 6, a0, a1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.save();
      ctx.translate(R, R); ctx.rotate(a0 + seg / 2);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 6;
      const size = Math.max(16, Math.min(30, 300 / n + 8));
      ctx.font = `800 ${size}px "Baloo 2", system-ui, sans-serif`;
      let t = labels[i];
      while (ctx.measureText(t).width > R * 0.62 && t.length > 4) t = t.slice(0, -2).trimEnd() + '…';
      if (t !== labels[i] && !t.endsWith('…')) t += '…';
      ctx.fillText(t, R - 26, 0);
      ctx.restore();
    }
    // studs
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + i * seg;
      ctx.fillStyle = '#fff6c8';
      ctx.beginPath(); ctx.arc(R + Math.cos(a) * (R - 16), R + Math.sin(a) * (R - 16), 5, 0, Math.PI * 2); ctx.fill();
    }
  }

  return {
    set(list) { labels = list; document.fonts?.ready.then(draw); draw(); canvas.setAttribute('aria-label', `Wheel: ${list.join(', ')}`); },
    /** Spin to segment `index`; resolves when it stops. */
    spin(index) {
      rotation = G.spinAngle(rotation, index, labels.length, 5, Math.random() * 2 - 1);
      canvas.style.transform = `rotate(${rotation}deg)`;
      const ms = reduced.matches ? 50 : 4700;
      return new Promise((r) => setTimeout(r, ms));
    },
  };
}
