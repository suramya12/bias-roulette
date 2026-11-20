// Renders a 1080x1350 Passport share card PNG on an offscreen canvas and shares
// or downloads it via Web Share API / object URL.

import { SIDES } from './passport.js';
import { isVideoId, videoThumbnail } from './validation.js';

const WIDTH = 1080;
const HEIGHT = 1350;
const PANEL_W = 820;
const PANEL_H = 1060;
const PANEL_X = (WIDTH - PANEL_W) / 2;
const PANEL_Y = (HEIGHT - PANEL_H) / 2;
const PANEL_R = 28;

const SIDE_COLORS = Object.freeze({
  kpop: '#b693ff',
  pop: '#ffb020',
  anime: '#ff2d55',
  bollywood: '#22d3b0',
});

const SIDE_LABELS = Object.freeze({
  kpop: 'K-pop',
  pop: 'Pop & Latin',
  anime: 'Anime',
  bollywood: 'Bollywood',
});

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function pickCovers(summary, limit = 3) {
  const out = [];
  const seen = new Set();
  const push = (side, id) => {
    if (out.length >= limit || !isVideoId(id) || seen.has(id)) return;
    seen.add(id);
    out.push({ side, id });
  };
  if (Array.isArray(summary?.recent)) {
    for (const item of summary.recent) push(item?.side, item?.id);
  }
  const bySide = summary?.ids || {};
  for (const side of SIDES) {
    const list = Array.isArray(bySide[side]) ? bySide[side] : [];
    for (let i = list.length - 1; i >= 0 && out.length < limit; i--) {
      push(side, list[i]);
    }
  }
  return out;
}

function loadCoverImage(id, timeoutMs = 4000) {
  const src = videoThumbnail(id, 'mqdefault');
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    img.onload = () => finish(img.naturalWidth > 0 ? img : null);
    img.onerror = () => finish(null);
    img.src = src;
  });
}

function drawRing(ctx, cx, cy, r, lineWidth, summary) {
  const owned = summary?.owned || {};
  const total = summary?.total || {};
  const sumTotals = SIDES.reduce((sum, s) => sum + (total[s] || 0), 0);
  const activeSides = sumTotals > 0 ? SIDES.filter((s) => (total[s] || 0) > 0) : SIDES;
  const gapRad = activeSides.length > 1 ? 0.14 : 0;
  const availRad = Math.max(0.1, Math.PI * 2 - activeSides.length * gapRad);
  let start = -Math.PI / 2;

  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';

  for (const side of activeSides) {
    const sideTotal = total[side] || 0;
    const share = sumTotals > 0 ? sideTotal / sumTotals : 1 / activeSides.length;
    const sweep = Math.max(0.06, availRad * share);
    const color = SIDE_COLORS[side] || '#f2c14e';

    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + sweep);
    ctx.stroke();

    const ratio = sideTotal > 0 ? Math.min(1, (owned[side] || 0) / sideTotal) : 0;
    if (ratio > 0) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + Math.max(0.05, sweep * ratio));
      ctx.stroke();
    }
    start += sweep + gapRad;
  }

  ctx.restore();
}

function drawCoverTile(ctx, x, y, w, h, item, img) {
  const accent = SIDE_COLORS[item?.side] || '#f2c14e';
  const label = SIDE_LABELS[item?.side] || 'Bias Roulette';

  ctx.save();
  roundRectPath(ctx, x, y, w, h, 16);
  ctx.clip();

  if (img) {
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    const scrim = ctx.createLinearGradient(0, y + h * 0.5, 0, y + h);
    scrim.addColorStop(0, 'rgba(7, 6, 13, 0)');
    scrim.addColorStop(1, 'rgba(7, 6, 13, 0.65)');
    ctx.fillStyle = scrim;
    ctx.fillRect(x, y, w, h);
  } else {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#1a142d');
    grad.addColorStop(1, '#0c0916');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(x + w * 0.5, y + h * 0.45, h * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#d6cfe8';
    ctx.font = '600 18px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
  }

  ctx.fillStyle = accent;
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, x, y, w, h, 16);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawBreakdown(ctx, summary, startY) {
  const owned = summary?.owned || {};
  const total = summary?.total || {};
  const left = PANEL_X + 56;
  const right = PANEL_X + PANEL_W - 56;
  const barX = left + 204;
  const barW = 340;
  const barH = 8;
  const rowStep = 44;

  ctx.save();
  ctx.textBaseline = 'middle';

  SIDES.forEach((side, i) => {
    const y = startY + i * rowStep;
    const color = SIDE_COLORS[side] || '#f2c14e';
    const sideOwned = Number(owned[side]) || 0;
    const sideTotal = Number(total[side]) || 0;
    const ratio = sideTotal > 0 ? Math.min(1, sideOwned / sideTotal) : 0;

    // Accent dot
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(left + 6, y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Side name
    ctx.textAlign = 'left';
    ctx.fillStyle = '#faf6ff';
    ctx.font = '600 22px system-ui, -apple-system, sans-serif';
    ctx.fillText(SIDE_LABELS[side] || side, left + 22, y);

    // Thin progress bar
    ctx.save();
    roundRectPath(ctx, barX, y - barH / 2, barW, barH, barH / 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    if (ratio > 0) {
      roundRectPath(ctx, barX, y - barH / 2, Math.max(barH, barW * ratio), barH, barH / 2);
      ctx.globalAlpha = 1;
      ctx.fill();
    }
    ctx.restore();

    // Owned / total
    ctx.textAlign = 'right';
    ctx.fillStyle = '#c7bbd3';
    ctx.font = '600 20px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${sideOwned.toLocaleString()} / ${sideTotal.toLocaleString()}`, right, y);
  });

  ctx.restore();
}

function paintCard(ctx, summary, covers, images) {
  // Full-bleed background
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, '#07060d');
  bg.addColorStop(1, '#0f0c1e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(WIDTH / 2, 280, 20, WIDTH / 2, 280, 560);
  glow.addColorStop(0, 'rgba(182, 147, 255, 0.18)');
  glow.addColorStop(1, 'rgba(7, 6, 13, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Centred 820x1060 panel
  ctx.save();
  roundRectPath(ctx, PANEL_X, PANEL_Y, PANEL_W, PANEL_H, PANEL_R);
  ctx.fillStyle = '#110e1f';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(242, 193, 78, 0.5)';
  ctx.stroke();
  ctx.restore();

  // Header tag
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f2c14e';
  ctx.font = '700 20px system-ui, -apple-system, sans-serif';
  ctx.fillText('PASSPORT', WIDTH / 2, PANEL_Y + 46);

  // 360px 4-arc ring with big count inside
  const ringCy = PANEL_Y + 258;
  drawRing(ctx, WIDTH / 2, ringCy, 168, 22, summary);

  const totalOwned = Number(summary?.totalOwned) || 0;
  const totalCards = Number(summary?.totalCards) || 0;
  ctx.fillStyle = '#faf6ff';
  ctx.font = '800 96px system-ui, -apple-system, sans-serif';
  ctx.fillText(totalOwned.toLocaleString(), WIDTH / 2, ringCy - 14);

  ctx.fillStyle = '#a9a3c4';
  ctx.font = '600 28px system-ui, -apple-system, sans-serif';
  ctx.fillText(totalOwned === 1 ? 'card' : 'cards', WIDTH / 2, ringCy + 50);

  // Single-line meta: of M · streak · dust
  const streakCount = Number(summary?.streak?.count) || 0;
  const dust = Number(summary?.dust) || 0;
  const metaParts = [];
  if (totalCards > 0) metaParts.push(`of ${totalCards.toLocaleString()}`);
  if (streakCount > 0) metaParts.push(`${streakCount}-day streak`);
  metaParts.push(`✦ ${dust.toLocaleString()}`);
  ctx.fillStyle = '#f2c14e';
  ctx.font = '600 26px system-ui, -apple-system, sans-serif';
  ctx.fillText(metaParts.join('  ·  '), WIDTH / 2, PANEL_Y + 478);

  // 4-row per-side breakdown
  drawBreakdown(ctx, summary, PANEL_Y + 536);

  // Top 3 recent covers (larger, 16px radius, 2px side-accent underline)
  const tileW = 224;
  const tileH = 132;
  const tileGap = 18;
  const rowW = tileW * 3 + tileGap * 2;
  const startX = (WIDTH - rowW) / 2;
  const tileY = PANEL_Y + 748;
  const fallbackSides = ['kpop', 'pop', 'anime'];

  for (let i = 0; i < 3; i++) {
    const item = covers[i] || { side: fallbackSides[i], id: null };
    const img = covers[i] ? images[i] : null;
    drawCoverTile(ctx, startX + i * (tileW + tileGap), tileY, tileW, tileH, item, img);
  }

  // Divider hairline
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PANEL_X + 56, PANEL_Y + 920);
  ctx.lineTo(PANEL_X + PANEL_W - 56, PANEL_Y + 920);
  ctx.stroke();

  // Wordmark + site URL
  ctx.fillStyle = '#faf6ff';
  ctx.font = '800 36px system-ui, -apple-system, sans-serif';
  ctx.fillText('Bias Roulette', WIDTH / 2, PANEL_Y + 966);

  ctx.fillStyle = '#a9a3c4';
  ctx.font = '500 21px system-ui, -apple-system, sans-serif';
  ctx.fillText('suramya12.github.io/bias-roulette', WIDTH / 2, PANEL_Y + 1012);
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('toBlob returned null'));
      }, 'image/png');
    } catch (err) {
      reject(err);
    }
  });
}

/** Render the 1080x1350 Passport share card to a PNG Blob. */
export async function renderShareCard(summary, opts = {}) {
  if (document.fonts?.ready) {
    try { await document.fonts.ready; } catch { /* ignore font readiness errors */ }
  }
  const covers = pickCovers(summary, 3);
  const images = opts.skipImages
    ? covers.map(() => null)
    : await Promise.all(covers.map((item) => loadCoverImage(item.id)));

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');

  paintCard(ctx, summary, covers, images);
  try {
    return await canvasToPngBlob(canvas);
  } catch {
    // If a remote image tainted the canvas, repaint with graceful fallback tiles.
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    paintCard(ctx, summary, covers, covers.map(() => null));
    return canvasToPngBlob(canvas);
  }
}

/** Share via Web Share API when supported, otherwise download bias-roulette-passport.png. */
export async function shareCard(summary, opts = {}) {
  const blob = await renderShareCard(summary, opts);
  const filename = opts.filename || 'bias-roulette-passport.png';
  const file = new File([blob], filename, { type: 'image/png' });

  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] }) && typeof navigator.share === 'function') {
    try {
      await navigator.share({ files: [file], title: 'Bias Roulette Passport' });
      return { shared: true, blob };
    } catch (err) {
      if (err?.name === 'AbortError') return { shared: false, cancelled: true, blob };
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { shared: false, downloaded: true, blob };
}
