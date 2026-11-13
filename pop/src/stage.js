// Canvas crowd: rows of swaying lightsticks and phone lights in pop/latin night colours.
import { reduced } from './cards.js';

const COLORS = ['#ff4fa3', '#3de8ff', '#ffd76a', '#8b5cff', '#ffffff', '#ff7a3d'];

export function startCrowd(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, fans = [], raf = 0;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2) * (canvas.currentCSSZoom || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(260, w / 5));
    fans = Array.from({ length: n }, () => {
      const depth = Math.random();
      return {
        x: Math.random() * w, depth,
        y: h * (0.35 + depth * 0.65),
        c: COLORS[(Math.random() * COLORS.length) | 0],
        ph: Math.random() * Math.PI * 2, sp: 1.6 + Math.random() * 1.6,
        len: 10 + depth * 18, phone: Math.random() < 0.25,
      };
    }).sort((a, b) => a.depth - b.depth);
    draw(0);
  };
  const draw = (t) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(7,6,26,0)');
    g.addColorStop(1, 'rgba(7,6,26,.95)');
    const beat = 0.5 + 0.5 * Math.sin(t / 1000 * Math.PI * 2 * 2); // ~120 bpm pulse
    for (const f of fans) {
      const sway = Math.sin(t / 1000 * f.sp + f.ph) * (0.35 + f.depth * 0.25);
      const x = f.x + Math.sin(t / 2600 + f.ph) * 4;
      // silhouette head
      ctx.fillStyle = `rgba(4,3,14,${0.6 + f.depth * 0.4})`;
      ctx.beginPath(); ctx.arc(x, f.y + 6 + f.depth * 8, 5 + f.depth * 9, 0, Math.PI * 2); ctx.fill();
      const tx = x + Math.sin(sway) * f.len, ty = f.y - Math.cos(sway) * f.len;
      ctx.globalAlpha = 0.45 + f.depth * 0.45 + beat * 0.1;
      if (f.phone) {
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#fff'; ctx.shadowBlur = 10;
        ctx.fillRect(tx - 2, ty - 3, 4, 6);
      } else {
        ctx.strokeStyle = f.c; ctx.lineWidth = 2 + f.depth * 2.5; ctx.lineCap = 'round';
        ctx.shadowColor = f.c; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(x, f.y); ctx.lineTo(tx, ty); ctx.stroke();
      }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  };
  const loop = (t) => { draw(t); raf = requestAnimationFrame(loop); };
  const run = () => {
    cancelAnimationFrame(raf);
    if (!reduced.matches && !document.hidden) raf = requestAnimationFrame(loop);
  };
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', run);
  reduced.addEventListener('change', run);
  resize();
  run();
}
