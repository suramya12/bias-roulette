// Cover art for every card, painted in the browser. Nothing is downloaded: each cover is
// composed from its own seed (the card's key), so every card is different and the same
// card always looks the same.
//
// The look borrows from painted 2D/3D animation:
//  - broken-colour brushwork: the finished picture is re-stroked with flat rectangular
//    strokes whose hue, saturation and value drift slightly (the "painted over 3D" look);
//  - motion frozen mid-frame: hair, ribbons and cloth still moving, motion ghosts,
//    out-of-focus foreground particles;
//  - light as a subject: liquid energy ribbons, bloom, sparks;
//  - graphic punch: dark grounds with one or two neon pops, giant cropped type;
//  - low camera, real perspective: floors and skylines with one vanishing point,
//    rim-lit cel-shaded figures.
// Figures are stylized, faceless silhouettes: never portraits of real people.

const TAU = Math.PI * 2;

// ---------- seeded randomness ----------
function hash(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- colour ----------
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = t < 0 ? t + 1 : t > 1 ? t - 1 : t; return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p); };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
const mixHue = (a, b, t) => { const d = ((((b - a) % 360) + 540) % 360) - 180; return a + d * t; };
function hueOf(color) {
  const m = String(color).match(/\d+/g);
  if (String(color).startsWith('#')) {
    const n = parseInt(color.slice(1).padEnd(6, '0'), 16);
    return rgbToHsl(n >> 16, (n >> 8) & 255, n & 255)[0];
  }
  return m ? rgbToHsl(+m[0], +m[1], +m[2])[0] : 300;
}
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const hsl = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${(clamp(s) * 100).toFixed(1)}%,${(clamp(l) * 100).toFixed(1)}%,${a})`;

// ---------- motifs: what the picture is about ----------
const MOTIFS = [
  ['sword', /hunt|demon|golden|takedown|soda|blade|fight|war|battle|kill|sword|villain|legend|kda|huntrx|saja/],
  ['disco', /disco|dynamite|party|groove|club|boogie|funk|apt|dance|butter|retro|80s|70s/],
  ['flame', /fire|burn|flame|hot|heat|spicy|fever|blaze|lava|inferno|red/],
  ['bolt', /shock|electric|bang|boom|thunder|power|energy|crazy|wild|attack|hype|venom|loud|rock|chaos|psycho|maniac/],
  ['wave', /sea|ocean|wave|dive|water|rain|tears|cry|swim|beach|island|aqua|splash/],
  ['planet', /space|galaxy|universe|cosmic|planet|alien|zero|gravity|orbit|rocket|mars|astro|supernova|nova/],
  ['snow', /snow|winter|ice|cold|christmas|december|frozen|white/],
  ['moon', /moon|night|dream|midnight|lonely|sleep|ballad|dark|blue|stay|miss|lullaby|eclipse/],
  ['flower', /flower|rose|blossom|bloom|spring|cherry|lily|petal|garden|bouquet|daisy|tulip/],
  ['butterfly', /butterfly|fly|wing|free|fairy|angel|feather/],
  ['crown', /queen|king|crown|royal|boss|god|best|top|number|first|empire|throne|icon/],
  ['gem', /diamond|gem|jewel|money|rich|luxury|crystal|pink|glass|shine|bling/],
  ['heart', /love|heart|kiss|lovesick|crush|darling|baby|sweet|cupid|like|romance|date/],
  ['star', /star|bright|super|idol|celebrity|light|glow|sparkle|wish|dream/],
  ['sun', /sun|summer|day|gold|morning|sunrise|happy|smile|bright|vacation|holiday/],
  ['mic', /sing|song|voice|mic|rap|hiphop|stage|concert|anthem|chant|shout|scream/],
  ['city', /city|seoul|street|town|run|drive|road|bus|subway|downtown|neon|tokyo/],
  ['note', /music|melody|tune|beat|rhythm|piano|radio|playlist|record/],
];
const FALLBACK = ['star', 'heart', 'moon', 'gem', 'flower', 'bolt', 'note', 'butterfly', 'crown', 'planet'];

function motifFor(words, R) {
  const w = String(words).toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, '');
  for (const [m, re] of MOTIFS) if (re.test(w)) return m;
  return FALLBACK[Math.floor(R() * FALLBACK.length)];
}

const SCENES = {
  sword: ['inferno', 'void', 'night'], flame: ['inferno', 'inferno', 'void'], bolt: ['void', 'inferno', 'stage'],
  wave: ['night', 'dream', 'dusk'], planet: ['night', 'void'], snow: ['night', 'dream'], moon: ['night', 'dusk', 'dream'],
  flower: ['dream', 'dusk', 'night'], butterfly: ['dream', 'dusk', 'night'], heart: ['dream', 'stage', 'dusk', 'void'],
  crown: ['dusk', 'stage', 'void'], gem: ['void', 'stage', 'dusk'], star: ['stage', 'night', 'void'], sun: ['dusk', 'dream'],
  disco: ['stage', 'stage', 'void'], mic: ['stage', 'void'], city: ['night', 'dusk'], note: ['stage', 'dream', 'void'],
};

function palette(h, scene, R) {
  const comp = h + 150 + R() * 60; // the Arcane-style teal/orange split: key light opposite the base hue
  switch (scene) {
    case 'inferno': return { scene, top: [h, 0.5, 0.06], mid: [12, 0.8, 0.22], low: [28, 0.95, 0.5], light: 30, accent: h, rim: [40, 1, 0.68], shadow: [h + 200, 0.4, 0.08], dark: true };
    case 'void': return { scene, top: [h, 0.35, 0.05], mid: [h + 10, 0.4, 0.08], low: [h + 20, 0.5, 0.12], light: comp, accent: h, rim: [comp, 1, 0.66], shadow: [h, 0.3, 0.05], dark: true };
    case 'dream': return { scene, top: [h + 30, 0.6, 0.7], mid: [h, 0.65, 0.78], low: [h - 40, 0.75, 0.86], light: h - 40, accent: comp, rim: [h - 30, 1, 0.92], shadow: [h + 40, 0.35, 0.3], dark: false };
    case 'dusk': return { scene, top: [h + 220, 0.45, 0.14], mid: [h + 330, 0.6, 0.4], low: [30 + R() * 20, 0.95, 0.66], light: 35, accent: h, rim: [40, 1, 0.74], shadow: [h + 220, 0.45, 0.1], dark: true };
    case 'stage': return { scene, top: [h, 0.55, 0.05], mid: [h + 15, 0.6, 0.14], low: [h + 30, 0.7, 0.3], light: comp, accent: h, rim: [comp, 1, 0.72], shadow: [h, 0.4, 0.06], dark: true };
    default: return { scene: 'night', top: [h + 200, 0.6, 0.06], mid: [h + 230, 0.55, 0.18], low: [h + 260, 0.6, 0.38], light: comp, accent: h, rim: [comp, 1, 0.72], shadow: [h + 210, 0.5, 0.07], dark: true };
  }
}
const c = (t, a = 1, dl = 0) => hsl(t[0], t[1], t[2] + dl, a);

// ---------- background ----------
function background(ctx, W, H, P, R, k) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, c(P.top)); g.addColorStop(k.hy / H * 0.8, c(P.mid)); g.addColorStop(k.hy / H, c(P.low)); g.addColorStop(1, c(P.shadow));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // the light source behind the subject
  const glow = ctx.createRadialGradient(k.lx, k.ly, 0, k.lx, k.ly, W * 0.75);
  glow.addColorStop(0, hsl(P.light, 1, P.dark ? 0.62 : 0.95, P.dark ? 0.55 : 0.8));
  glow.addColorStop(0.35, hsl(P.light, 0.9, 0.5, P.dark ? 0.18 : 0.3));
  glow.addColorStop(1, hsl(P.light, 0.9, 0.5, 0));
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  if (P.scene === 'dream' || P.scene === 'dusk' || P.scene === 'inferno') clouds(ctx, W, H, P, R, k);
  if (P.scene === 'night' || P.scene === 'void') stars(ctx, W, H * 0.7, R, P.scene === 'void' ? 40 : 90);
}

function stars(ctx, W, H, R, n) {
  for (let i = 0; i < n; i++) {
    const r = R() < 0.9 ? R() * 1.1 + 0.3 : R() * 2 + 1.2;
    ctx.fillStyle = `rgba(255,255,255,${0.25 + R() * 0.6})`;
    ctx.beginPath(); ctx.arc(R() * W, R() * H, r * W / 400, 0, TAU); ctx.fill();
  }
}

function clouds(ctx, W, H, P, R, k) {
  const smoke = P.scene === 'inferno';
  for (let b = 0; b < 5; b++) {
    const y = k.hy - H * (0.05 + R() * 0.45), x0 = R() * W, len = W * (0.4 + R() * 0.6);
    for (let i = 0; i < 9; i++) {
      const x = x0 + (i / 8 - 0.5) * len, r = W * (0.06 + R() * 0.09);
      const yy = y - Math.sin((i / 8) * Math.PI) * r * 0.9;
      const g = ctx.createRadialGradient(x - r * 0.3, yy - r * 0.4, r * 0.1, x, yy, r);
      const lit = smoke ? [20, 0.7, 0.32] : [P.light, 0.9, P.dark ? 0.62 : 0.97];
      const sh = smoke ? [h0(P), 0.25, 0.1] : [P.mid[0], P.mid[1] * 0.8, P.mid[2] * (P.dark ? 0.8 : 0.95)];
      g.addColorStop(0, c(lit, 0.75)); g.addColorStop(0.6, c(sh, 0.6)); g.addColorStop(1, c(sh, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, yy, r, 0, TAU); ctx.fill();
    }
  }
}
const h0 = (P) => P.shadow[0];

// One vanishing point: a stage floor with a grid, or a low-angle skyline.
function perspective(ctx, W, H, P, R, k, motif) {
  const vx = k.vx, hy = k.hy;
  if (motif === 'city' || (P.scene === 'night' && R() < 0.45)) return skyline(ctx, W, H, P, R, k);
  if (P.scene === 'dream' || P.scene === 'dusk') {
    // a painted ground: soft hills meeting the horizon
    for (let i = 0; i < 3; i++) {
      const y = hy + i * H * 0.07;
      ctx.fillStyle = c([P.shadow[0] + i * 10, P.shadow[1], P.dark ? 0.12 + i * 0.03 : 0.55 - i * 0.12], 1);
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += W / 12) ctx.lineTo(x, y + Math.sin(x / W * 5 + i * 2 + R()) * H * 0.025);
      ctx.lineTo(W, H); ctx.fill();
    }
    return;
  }
  const floor = ctx.createLinearGradient(0, hy, 0, H);
  floor.addColorStop(0, c(P.low, 1, -0.05)); floor.addColorStop(1, c(P.shadow));
  ctx.fillStyle = floor; ctx.fillRect(0, hy, W, H - hy);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = hsl(P.light, 1, 0.6, 0.22); ctx.lineWidth = Math.max(1, W / 360);
  for (let i = -10; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(vx, hy); ctx.lineTo(vx + i * W * 0.18, H); ctx.stroke(); }
  for (let j = 1; j < 9; j++) { const y = hy + (H - hy) * Math.pow(j / 9, 2.2); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // a reflection pool under the light
  const pool = ctx.createRadialGradient(k.lx, hy + (H - hy) * 0.35, 0, k.lx, hy + (H - hy) * 0.35, W * 0.5);
  pool.addColorStop(0, hsl(P.light, 1, 0.6, 0.35)); pool.addColorStop(1, hsl(P.light, 1, 0.6, 0));
  ctx.fillStyle = pool; ctx.fillRect(0, hy, W, H - hy);
  ctx.restore();
  if (P.scene === 'stage') beams(ctx, W, H, P, R, k);
}

function beams(ctx, W, H, P, R, k) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const n = 3 + Math.floor(R() * 4);
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n * W + (R() - 0.5) * W * 0.1, tx = k.cx + (R() - 0.5) * W * 0.5, spread = W * (0.06 + R() * 0.08);
    const g = ctx.createLinearGradient(x, 0, tx, H);
    const hue = i % 2 ? P.light : P.accent;
    g.addColorStop(0, hsl(hue, 1, 0.7, 0.4)); g.addColorStop(1, hsl(hue, 1, 0.6, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x - W * 0.01, -2); ctx.lineTo(x + W * 0.01, -2); ctx.lineTo(tx + spread, H); ctx.lineTo(tx - spread, H); ctx.fill();
  }
  ctx.restore();
}

function skyline(ctx, W, H, P, R, k) {
  // Low camera: towers lean in toward one vanishing point above the frame.
  const vy = -H * 1.6, base = k.hy + H * 0.12;
  for (let layer = 0; layer < 2; layer++) {
    let x = -W * 0.05;
    while (x < W * 1.05) {
      const w = W * (0.07 + R() * 0.1), h = H * (0.18 + R() * 0.32) * (layer ? 1.25 : 0.8) * (1 + Math.abs(x / W - 0.5) * 0.9);
      const top = base - h;
      const f = (base - top) / (base - vy);
      const tl = x + (k.vx - x) * f, tr = x + w + (k.vx - x - w) * f;
      ctx.fillStyle = c([P.shadow[0], P.shadow[1], layer ? P.shadow[2] : P.shadow[2] + 0.06]);
      ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x, base); ctx.lineTo(tl, top); ctx.lineTo(tr, top); ctx.lineTo(x + w, base); ctx.lineTo(x + w, H); ctx.fill();
      // rim of light on the side facing the light
      ctx.strokeStyle = hsl(P.light, 1, 0.65, layer ? 0.5 : 0.25); ctx.lineWidth = W / 300;
      ctx.beginPath(); if (x + w / 2 < k.lx) { ctx.moveTo(x + w, base); ctx.lineTo(tr, top); } else { ctx.moveTo(x, base); ctx.lineTo(tl, top); } ctx.stroke();
      // windows
      for (let wy = top + h * 0.06; wy < base; wy += h * 0.07) {
        if (R() < 0.45) continue;
        const f = (base - wy) / (base - vy), wx0 = x - (x - k.vx) * f, ww = w * (1 - f);
        ctx.fillStyle = hsl(R() < 0.7 ? P.light : P.accent, 1, 0.7, 0.55 + R() * 0.4);
        ctx.fillRect(wx0 + ww * (0.15 + R() * 0.6), wy, ww * 0.12, h * 0.025);
      }
      x += w * (0.85 + R() * 0.4);
    }
  }
}

// Giant cropped type and a halftone corner: the graphic layer.
function graphic(ctx, W, H, P, R, spec) {
  const word = (spec.title || '').toUpperCase().replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).join(' ') || '♥';
  ctx.save();
  ctx.translate(W * (0.5 + (R() - 0.5) * 0.2), H * (0.3 + R() * 0.35));
  ctx.rotate((R() - 0.5) * 0.5);
  const size = Math.min(W * 0.62, (W * 1.5) / Math.max(2, word.length * 0.62));
  ctx.font = `900 ${size}px "Arial Black", Impact, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.globalAlpha = P.dark ? 0.1 : 0.16;
  ctx.fillStyle = hsl(P.accent, 0.9, P.dark ? 0.6 : 0.4);
  ctx.fillText(word, 0, 0);
  ctx.globalAlpha = P.dark ? 0.35 : 0.3;
  ctx.lineWidth = Math.max(1, W / 220); ctx.strokeStyle = hsl(P.light, 1, P.dark ? 0.65 : 0.45);
  ctx.strokeText(word, size * 0.03, size * 0.03);
  ctx.restore();

  // halftone: dots shrinking away from a corner
  const cx = R() < 0.5 ? 0 : W, cy = R() < 0.5 ? 0 : H, step = W / 34;
  ctx.fillStyle = hsl(P.accent, 1, P.dark ? 0.65 : 0.45, P.dark ? 0.35 : 0.3);
  for (let y = step / 2; y < H; y += step) {
    for (let x = step / 2; x < W; x += step) {
      const d = Math.hypot(x - cx, y - cy) / (W * 0.55);
      const r = step * 0.42 * (1 - d);
      if (r > 0.3) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
    }
  }
}

// A diagonal film strip: frames of the same scene, offset in colour.
function filmStrip(ctx, W, H, P, R) {
  ctx.save();
  ctx.translate(W / 2, H * (0.25 + R() * 0.5));
  ctx.rotate((R() < 0.5 ? -1 : 1) * (0.25 + R() * 0.25));
  const bw = W * 1.8, bh = H * 0.2;
  ctx.fillStyle = 'rgba(8,6,14,.82)'; ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
  const fw = bh * 1.1;
  for (let x = -bw / 2 + fw * 0.2, i = 0; x < bw / 2; x += fw * 1.12, i++) {
    const g = ctx.createLinearGradient(x, -bh * 0.36, x + fw, bh * 0.36);
    g.addColorStop(0, hsl(P.accent + i * 25, 0.8, 0.45, 0.85)); g.addColorStop(1, hsl(P.light - i * 15, 0.9, 0.6, 0.85));
    ctx.fillStyle = g; ctx.fillRect(x, -bh * 0.36, fw, bh * 0.72);
  }
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  for (let x = -bw / 2; x < bw / 2; x += bh * 0.2) { ctx.fillRect(x, -bh * 0.47, bh * 0.1, bh * 0.06); ctx.fillRect(x, bh * 0.41, bh * 0.1, bh * 0.06); }
  ctx.restore();
}

// ---------- 2.5D shading helpers ----------
/** Fill a path like a lit solid: an extruded side, a gradient face, a rim and a specular glint. */
function solid(ctx, path, { x, y, s }, hue, P, k, { depth = 0.12, sat = 0.9, lum = 0.55, gloss = true } = {}) {
  const ldx = (k.lx - x) / s, ldy = (k.ly - y) / s, ll = Math.hypot(ldx, ldy) || 1;
  const ux = ldx / ll, uy = ldy / ll; // towards the light
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  // extrusion away from the light
  for (let i = 8; i >= 1; i--) {
    ctx.save(); ctx.translate(-ux * depth * i / 8, -uy * depth * i / 8 + depth * i / 16);
    ctx.fillStyle = hsl(hue, sat * 0.8, lum * 0.32 + i * 0.006); ctx.fill(path); ctx.restore();
  }
  // face
  const g = ctx.createLinearGradient(ux, uy, -ux, -uy);
  g.addColorStop(0, hsl(hue, sat, Math.min(0.92, lum + 0.25)));
  g.addColorStop(0.45, hsl(hue, sat, lum));
  g.addColorStop(1, hsl(hue + 15, sat, lum * 0.45));
  ctx.fillStyle = g; ctx.fill(path);
  // cel shadow: a hard second tone on the far side
  ctx.save(); ctx.clip(path);
  ctx.translate(-ux * 0.22, -uy * 0.22);
  ctx.fillStyle = hsl(hue + 20, sat, lum * 0.42, 0.55); ctx.fill(path);
  ctx.restore();
  // rim light
  ctx.save(); ctx.clip(path);
  ctx.translate(ux * 0.05, uy * 0.05);
  ctx.lineWidth = 0.05; ctx.strokeStyle = c(P.rim, 0.9); ctx.stroke(path);
  ctx.restore();
  if (gloss) {
    ctx.save(); ctx.clip(path);
    const sg = ctx.createRadialGradient(ux * 0.45, uy * 0.45, 0, ux * 0.45, uy * 0.45, 0.4);
    sg.addColorStop(0, 'rgba(255,255,255,.85)'); sg.addColorStop(0.3, 'rgba(255,255,255,.25)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg; ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
  }
  ctx.restore();
}

function poly(pts) { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p; }
function starPath(n, inner, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? inner : 1, a = rot + (i * Math.PI) / n; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return poly(pts);
}
function heartPath() {
  const p = new Path2D();
  p.moveTo(0, 0.95);
  p.bezierCurveTo(-0.55, 0.55, -1.05, 0.15, -0.95, -0.35);
  p.bezierCurveTo(-0.85, -0.85, -0.2, -0.95, 0, -0.45);
  p.bezierCurveTo(0.2, -0.95, 0.85, -0.85, 0.95, -0.35);
  p.bezierCurveTo(1.05, 0.15, 0.55, 0.55, 0, 0.95);
  p.closePath(); return p;
}

// ---------- motif painters (unit size ≈ radius) ----------
const PAINT = {
  heart(ctx, at, P, k, R) {
    solid(ctx, heartPath(), at, P.accent, P, k, { lum: 0.55 });
    if (R() < 0.5) { // a smaller twin, tumbling
      solid(ctx, heartPath(), { x: at.x + at.s * 0.95, y: at.y - at.s * 0.75, s: at.s * 0.32 }, P.accent + 25, P, k);
    }
  },
  star(ctx, at, P, k, R) {
    solid(ctx, starPath(5, 0.46), at, 48 + R() * 10, P, k, { lum: 0.6, sat: 1 });
    solid(ctx, starPath(4, 0.3, 0), { x: at.x - at.s * 0.85, y: at.y - at.s * 0.65, s: at.s * 0.22 }, P.light, P, k, { depth: 0.04 });
  },
  crown(ctx, at, P, k) {
    const p = poly([[-1, 0.55], [-1, -0.45], [-0.55, 0.05], [-0.3, -0.75], [0, -0.05], [0.3, -0.75], [0.55, 0.05], [1, -0.45], [1, 0.55]]);
    solid(ctx, p, at, 44, P, k, { lum: 0.58, sat: 1 });
    for (const [jx, jy, hh] of [[0, 0.3, P.accent], [-0.55, 0.32, P.light], [0.55, 0.32, P.light]]) {
      const j = new Path2D(); j.arc(0, 0, 1, 0, TAU);
      solid(ctx, j, { x: at.x + jx * at.s, y: at.y + jy * at.s, s: at.s * 0.13 }, hh, P, k, { depth: 0.2, lum: 0.5 });
    }
  },
  gem(ctx, at, P, k, R) {
    // faceted diamond: every facet its own value, which is what reads as 3D
    const top = -0.35, girdle = 0, tip = 1;
    const T = [[-0.6, top - 0.35], [-0.2, top - 0.42], [0.2, top - 0.42], [0.6, top - 0.35]];
    const facets = [
      [[-1, girdle], T[0], [-0.45, girdle]], [T[0], T[1], [-0.45, girdle]], [T[1], [0, girdle], [-0.45, girdle]], [T[1], T[2], [0, girdle]],
      [T[2], [0.45, girdle], [0, girdle]], [T[2], T[3], [0.45, girdle]], [T[3], [1, girdle], [0.45, girdle]],
      [[-1, girdle], [-0.45, girdle], [0, tip]], [[-0.45, girdle], [0, girdle], [0, tip]], [[0, girdle], [0.45, girdle], [0, tip]], [[0.45, girdle], [1, girdle], [0, tip]],
    ];
    ctx.save(); ctx.translate(at.x, at.y); ctx.scale(at.s, at.s);
    const hue = R() < 0.5 ? P.accent : P.light;
    facets.forEach((f, i) => {
      const lit = 0.3 + ((Math.sin(i * 2.3) + 1) / 2) * 0.55;
      ctx.fillStyle = hsl(hue + i * 6, 0.85, lit); ctx.fill(poly(f));
      ctx.strokeStyle = hsl(hue, 1, 0.9, 0.6); ctx.lineWidth = 0.015; ctx.stroke(poly(f));
    });
    ctx.restore();
  },
  moon(ctx, at, P, k, R) {
    const p = new Path2D(); p.arc(0, 0, 1, 0, TAU);
    const cut = new Path2D(); cut.arc(0.45, -0.25, 0.85, 0, TAU);
    ctx.save(); ctx.translate(at.x, at.y); ctx.scale(at.s, at.s);
    const halo = ctx.createRadialGradient(0, 0, 0.8, 0, 0, 2.2);
    halo.addColorStop(0, hsl(P.light, 0.8, 0.85, 0.45)); halo.addColorStop(1, hsl(P.light, 0.8, 0.85, 0));
    ctx.fillStyle = halo; ctx.fillRect(-3, -3, 6, 6);
    ctx.save(); ctx.clip(p);
    const g = ctx.createRadialGradient(-0.4, 0.3, 0.1, 0, 0, 1.1);
    g.addColorStop(0, hsl(P.light - 10, 0.5, 0.94)); g.addColorStop(1, hsl(P.light, 0.6, 0.7));
    ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = hsl(P.light, 0.4, 0.62, 0.45); ctx.beginPath(); ctx.arc(R() * 1.4 - 0.9, R() * 1.4 - 0.6, 0.05 + R() * 0.12, 0, TAU); ctx.fill(); }
    ctx.fillStyle = c(P.mid, 0.94); ctx.fill(cut); // the shadowed side
    ctx.restore(); ctx.restore();
  },
  sun(ctx, at, P, k, R) {
    ctx.save(); ctx.translate(at.x, at.y); ctx.scale(at.s, at.s);
    ctx.globalCompositeOperation = 'lighter';
    const rays = 14 + Math.floor(R() * 10);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * TAU + R() * 0.1, l = 1.4 + R() * 1.2;
      ctx.fillStyle = hsl(40, 1, 0.7, 0.18);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a - 0.05) * l, Math.sin(a - 0.05) * l); ctx.lineTo(Math.cos(a + 0.05) * l, Math.sin(a + 0.05) * l); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createRadialGradient(-0.3, -0.3, 0.05, 0, 0, 1);
    g.addColorStop(0, hsl(55, 1, 0.95)); g.addColorStop(0.5, hsl(42, 1, 0.66)); g.addColorStop(1, hsl(22, 1, 0.55));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 0.85, 0, TAU); ctx.fill();
    ctx.restore();
  },
  flower(ctx, at, P, k, R) {
    const n = 5 + Math.floor(R() * 4), hue = P.accent;
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + layer * (Math.PI / n), p = new Path2D();
        p.ellipse(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.55 - layer * 0.15, 0.3 - layer * 0.07, a, 0, TAU);
        solid(ctx, p, { x: at.x, y: at.y, s: at.s * (1 - layer * 0.25) }, hue + layer * 15, P, k, { depth: 0.06, lum: 0.62 + layer * 0.08, gloss: false });
      }
    }
    const ctr = new Path2D(); ctr.arc(0, 0, 1, 0, TAU);
    solid(ctx, ctr, { x: at.x, y: at.y, s: at.s * 0.2 }, 48, P, k, { depth: 0.1 });
  },
  butterfly(ctx, at, P, k, R) {
    const tilt = (R() - 0.5) * 0.6;
    ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(tilt); ctx.translate(-at.x, -at.y);
    for (const side of [-1, 1]) {
      const up = new Path2D(); up.ellipse(side * 0.5, -0.35, 0.55, 0.42, side * 0.5, 0, TAU);
      const lo = new Path2D(); lo.ellipse(side * 0.35, 0.35, 0.32, 0.38, -side * 0.4, 0, TAU);
      solid(ctx, up, at, P.accent, P, k, { depth: 0.05, lum: 0.58 });
      solid(ctx, lo, at, P.light, P, k, { depth: 0.05, lum: 0.6 });
    }
    const body = new Path2D(); body.ellipse(0, 0, 0.07, 0.55, 0, 0, TAU);
    solid(ctx, body, at, P.shadow[0], P, k, { lum: 0.15, depth: 0.04 });
    ctx.restore();
  },
  flame(ctx, at, P, k, R) {
    const tongue = (w, h, wob) => {
      const p = new Path2D(); p.moveTo(0, 0.9);
      p.bezierCurveTo(-w, 0.7, -w * 1.1, 0.1, -w * 0.5, -0.3 + wob);
      p.bezierCurveTo(-w * 0.2, -0.6, -w * 0.4, -h * 0.8, 0.05, -h);
      p.bezierCurveTo(w * 0.2, -h * 0.6, w * 1.1, -0.2, w * 0.8, 0.3);
      p.bezierCurveTo(w * 0.7, 0.7, w * 0.3, 0.9, 0, 0.9); return p;
    };
    ctx.save(); ctx.translate(at.x, at.y); ctx.scale(at.s, at.s);
    ctx.globalCompositeOperation = 'lighter';
    [[0.85, 1.25, 10, 0.55, 0.85], [0.6, 1.05, 28, 0.6, 0.9], [0.35, 0.75, 48, 0.75, 0.95]].forEach(([w, h, hue, l, a]) => {
      ctx.fillStyle = hsl(hue, 1, l, a); ctx.fill(tongue(w, h, (R() - 0.5) * 0.3));
    });
    ctx.restore();
  },
  bolt(ctx, at, P, k) {
    const p = poly([[0.15, -1], [-0.55, 0.1], [-0.05, 0.1], [-0.3, 1], [0.6, -0.2], [0.08, -0.2], [0.4, -1]]);
    ctx.save(); ctx.shadowColor = hsl(P.light, 1, 0.6); ctx.shadowBlur = at.s * 0.5;
    solid(ctx, p, at, 52, P, k, { lum: 0.62, sat: 1, depth: 0.16 });
    ctx.restore();
  },
  sword(ctx, at, P, k, R) {
    const blade = (len) => poly([[-0.07, 0.15], [-0.07, -len], [0, -len - 0.18], [0.07, -len], [0.07, 0.15]]);
    const guard = poly([[-0.38, 0.15], [0.38, 0.15], [0.3, 0.25], [-0.3, 0.25]]);
    const grip = poly([[-0.05, 0.25], [0.05, 0.25], [0.05, 0.62], [-0.05, 0.62]]);
    const pair = R() < 0.55;
    for (const side of pair ? [-1, 1] : [0]) {
      ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(side * 0.6 + (pair ? 0 : -0.5)); ctx.translate(-at.x, -at.y);
      ctx.save(); ctx.shadowColor = hsl(P.light, 1, 0.6); ctx.shadowBlur = at.s * 0.3;
      solid(ctx, blade(1.1), at, P.light, P, k, { lum: 0.78, sat: 0.4, depth: 0.05 });
      ctx.restore();
      solid(ctx, guard, at, 44, P, k, { lum: 0.5, sat: 1, depth: 0.06 });
      solid(ctx, grip, at, P.accent, P, k, { lum: 0.32, depth: 0.04, gloss: false });
      ctx.restore();
    }
  },
  disco(ctx, at, P, k, R) {
    ctx.save(); ctx.translate(at.x, at.y); ctx.scale(at.s, at.s);
    const p = new Path2D(); p.arc(0, 0, 1, 0, TAU);
    ctx.save(); ctx.clip(p);
    ctx.fillStyle = '#1c1830'; ctx.fillRect(-1, -1, 2, 2);
    const lx = (k.lx - at.x) / at.s, ly = (k.ly - at.y) / at.s;
    for (let lat = -8; lat < 8; lat++) {
      const y0 = Math.sin((lat / 8) * Math.PI / 2), y1 = Math.sin(((lat + 1) / 8) * Math.PI / 2), r = Math.cos(((lat + 0.5) / 8) * Math.PI / 2);
      const n = Math.max(4, Math.round(r * 16));
      for (let i = 0; i < n; i++) {
        const x0 = -r + (2 * r * i) / n, x1 = x0 + (2 * r) / n;
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, d = Math.hypot(mx - lx * 0.4, my - ly * 0.4);
        const flash = R() < 0.08 ? 0.35 : 0;
        ctx.fillStyle = hsl(R() < 0.3 ? P.accent : P.light, 0.6, clamp(0.85 - d * 0.42 + flash + (R() - 0.5) * 0.12, 0.12, 0.97));
        ctx.fillRect(x0 + 0.01, y0 + 0.01, x1 - x0 - 0.02, y1 - y0 - 0.02);
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) { // glints
      const a = R() * TAU, rr = R() * 0.9, gx = Math.cos(a) * rr, gy = Math.sin(a) * rr;
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath(); ctx.moveTo(gx - 0.2, gy); ctx.lineTo(gx, gy - 0.02); ctx.lineTo(gx + 0.2, gy); ctx.lineTo(gx, gy + 0.02); ctx.fill();
      ctx.beginPath(); ctx.moveTo(gx, gy - 0.2); ctx.lineTo(gx + 0.02, gy); ctx.lineTo(gx, gy + 0.2); ctx.lineTo(gx - 0.02, gy); ctx.fill();
    }
    ctx.restore();
  },
  mic(ctx, at, P, k) {
    ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(-0.45); ctx.translate(-at.x, -at.y);
    const handle = poly([[-0.14, 0.1], [0.14, 0.1], [0.08, 1.2], [-0.08, 1.2]]);
    solid(ctx, handle, at, P.shadow[0], P, k, { lum: 0.25, sat: 0.3, depth: 0.05 });
    const head = new Path2D(); head.arc(0, -0.28, 0.42, 0, TAU);
    solid(ctx, head, at, P.light, P, k, { lum: 0.7, sat: 0.25, depth: 0.08 });
    ctx.save(); ctx.translate(at.x, at.y); ctx.scale(at.s, at.s); ctx.clip(head);
    ctx.strokeStyle = 'rgba(20,16,30,.5)'; ctx.lineWidth = 0.02;
    for (let i = -6; i <= 6; i++) { ctx.beginPath(); ctx.moveTo(i * 0.07, -0.8); ctx.lineTo(i * 0.07 + 0.3, 0.2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i * 0.07, -0.8); ctx.lineTo(i * 0.07 - 0.3, 0.2); ctx.stroke(); }
    ctx.restore();
    const band = poly([[-0.2, 0.05], [0.2, 0.05], [0.16, 0.2], [-0.16, 0.2]]);
    solid(ctx, band, at, P.accent, P, k, { lum: 0.55, depth: 0.03 });
    ctx.restore();
  },
  wave(ctx, at, P, k, R) {
    // a curling crest with foam, in three painted bands
    ctx.save(); ctx.translate(at.x, at.y); ctx.scale(at.s * 1.3, at.s * 1.3);
    const bands = [[P.light, 0.35], [P.light + 15, 0.5], [P.light + 30, 0.7]];
    bands.forEach(([hue, l], i) => {
      const o = i * 0.18, p = new Path2D();
      p.moveTo(-1.6, 1); p.lineTo(-1.6, 0.2 + o);
      p.bezierCurveTo(-0.9, 0.1 + o, -0.4, -0.9 + o, 0.3, -0.8 + o);
      p.bezierCurveTo(0.9, -0.7 + o, 1.0, -0.15 + o, 0.55, -0.1 + o);
      p.bezierCurveTo(0.35, -0.4 + o, 0.0, -0.35 + o, 0.05, -0.05 + o);
      p.bezierCurveTo(0.2, 0.35 + o, 1.0, 0.4 + o, 1.6, 0.3 + o); p.lineTo(1.6, 1); p.closePath();
      ctx.fillStyle = hsl(hue, 0.8, l * (P.dark ? 0.9 : 1.15)); ctx.fill(p);
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 0.035; ctx.stroke(p);
    });
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < 26; i++) { const a = R() * Math.PI - Math.PI, r = 0.75 + R() * 0.3; ctx.beginPath(); ctx.arc(0.35 + Math.cos(a) * r * 0.6, -0.4 + Math.sin(a) * r * 0.5, 0.02 + R() * 0.05, 0, TAU); ctx.fill(); }
    ctx.restore();
  },
  planet(ctx, at, P, k, R) {
    const tilt = -0.35 + (R() - 0.5) * 0.3;
    const ring = (front) => {
      ctx.save(); ctx.translate(at.x, at.y); ctx.scale(at.s, at.s); ctx.rotate(tilt);
      ctx.beginPath(); ctx.ellipse(0, 0, 1.75, 0.42, 0, front ? 0 : Math.PI, front ? Math.PI : TAU);
      ctx.lineWidth = 0.16; ctx.strokeStyle = hsl(P.accent, 0.8, 0.7, 0.85); ctx.stroke();
      ctx.lineWidth = 0.04; ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.stroke();
      ctx.restore();
    };
    ring(false);
    const p = new Path2D(); p.arc(0, 0, 1, 0, TAU);
    solid(ctx, p, at, P.light, P, k, { depth: 0, lum: 0.55, sat: 0.7 });
    ctx.save(); ctx.translate(at.x, at.y); ctx.scale(at.s, at.s); ctx.clip(p); ctx.rotate(tilt);
    for (let i = -4; i <= 4; i++) { ctx.fillStyle = hsl(P.light + i * 12, 0.7, 0.5, 0.25); ctx.fillRect(-1.2, i * 0.22, 2.4, 0.09); }
    ctx.restore();
    ring(true);
  },
  snow(ctx, at, P, k, R) {
    ctx.save(); ctx.translate(at.x, at.y); ctx.scale(at.s, at.s); ctx.rotate(R());
    ctx.shadowColor = hsl(P.light, 1, 0.8); ctx.shadowBlur = at.s * 0.25;
    ctx.strokeStyle = hsl(P.light, 0.6, 0.92); ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      ctx.rotate(TAU / 6);
      ctx.lineWidth = 0.09; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -1); ctx.stroke();
      ctx.lineWidth = 0.06;
      for (const t of [0.4, 0.68]) { ctx.beginPath(); ctx.moveTo(-0.22 * (1.1 - t), -t - 0.18); ctx.lineTo(0, -t); ctx.lineTo(0.22 * (1.1 - t), -t - 0.18); ctx.stroke(); }
    }
    ctx.restore();
  },
  city(ctx, at, P, k, R) { PAINT.moon(ctx, { ...at, y: at.y - at.s * 0.5, s: at.s * 0.75 }, P, k, R); },
  note(ctx, at, P, k) {
    const p = new Path2D();
    p.ellipse(-0.55, 0.55, 0.3, 0.22, -0.4, 0, TAU); p.ellipse(0.45, 0.35, 0.3, 0.22, -0.4, 0, TAU);
    p.rect(-0.32, -0.75, 0.1, 1.3); p.rect(0.68, -0.95, 0.1, 1.3);
    p.moveTo(-0.32, -0.75); p.lineTo(0.78, -0.95); p.lineTo(0.78, -0.7); p.lineTo(-0.32, -0.5); p.closePath();
    solid(ctx, p, at, P.accent, P, k, { lum: 0.58, depth: 0.14 });
  },
};

// ---------- the figure ----------
// Joints in figure units (pelvis at 0,0; about 1.65 tall). Faceless, rim-lit silhouettes.
const POSES = {
  reach: { h: [0.03, -0.72], rE: [0.25, -0.76], rH: [0.36, -0.95], lE: [-0.3, -0.5], lH: [-0.47, -0.42], lK: [-0.18, 0.3], lF: [-0.28, 0.62], rK: [0.16, 0.31], rF: [0.17, 0.64] },
  leap: { h: [0, -0.72], lE: [-0.3, -0.68], lH: [-0.44, -0.88], rE: [0.3, -0.68], rH: [0.44, -0.88], lK: [-0.22, 0.18], lF: [-0.14, 0.46], rK: [0.2, 0.24], rF: [0.42, 0.36] },
  mic: { h: [-0.03, -0.72], rE: [0.07, -0.4], rH: [0.0, -0.63], lE: [-0.28, -0.52], lH: [-0.48, -0.62], lK: [-0.12, 0.32], lF: [-0.2, 0.65], rK: [0.12, 0.3], rF: [0.07, 0.64] },
  power: { h: [0, -0.73], lE: [-0.24, -0.34], lH: [-0.3, -0.1], rE: [0.24, -0.34], rH: [0.3, -0.1], lK: [-0.2, 0.3], lF: [-0.33, 0.64], rK: [0.2, 0.3], rF: [0.33, 0.64] },
  kick: { h: [-0.04, -0.71], lE: [-0.3, -0.62], lH: [-0.42, -0.8], rE: [0.24, -0.42], rH: [0.4, -0.36], lK: [-0.06, 0.32], lF: [-0.08, 0.66], rK: [0.28, -0.03], rF: [0.53, -0.17] },
  spin: { h: [0.02, -0.72], lE: [-0.2, -0.4], lH: [0.02, -0.34], rE: [0.22, -0.68], rH: [0.1, -0.93], lK: [-0.05, 0.32], lF: [-0.03, 0.66], rK: [0.19, 0.2], rF: [0.02, 0.36] },
  cheer: { h: [0, -0.72], lE: [-0.24, -0.78], lH: [-0.32, -1.0], rE: [0.24, -0.78], rH: [0.32, -1.0], lK: [-0.09, 0.32], lF: [-0.12, 0.66], rK: [0.1, 0.32], rF: [0.14, 0.66] },
  lean: { h: [0.08, -0.7], lE: [-0.2, -0.3], lH: [-0.12, -0.08], rE: [0.3, -0.55], rH: [0.22, -0.74], lK: [-0.16, 0.3], lF: [-0.1, 0.64], rK: [0.16, 0.28], rF: [0.3, 0.6] },
};
const POSE_NAMES = Object.keys(POSES);
const HAIR = [[270, 0.15, 0.08], [40, 0.5, 0.86], [330, 0.85, 0.72], [215, 0.8, 0.66], [355, 0.7, 0.42], [25, 0.45, 0.26], [265, 0.6, 0.72], [45, 0.9, 0.62], [180, 0.5, 0.55], [0, 0, 0.92]];

/** Add a polygon wound clockwise, like canvas arcs, so overlapping parts always union. */
function addPoly(p, pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; area += x1 * y2 - x2 * y1; }
  const list = area < 0 ? [...pts].reverse() : pts;
  list.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath();
}
function capsule(p, a, b, ra, rb) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1e-6, nx = -dy / l, ny = dx / l;
  addPoly(p, [[a[0] + nx * ra, a[1] + ny * ra], [b[0] + nx * rb, b[1] + ny * rb], [b[0] - nx * rb, b[1] - ny * rb], [a[0] - nx * ra, a[1] - ny * ra]]);
  p.moveTo(a[0] + ra, a[1]); p.arc(a[0], a[1], ra, 0, TAU);
  p.moveTo(b[0] + rb, b[1]); p.arc(b[0], b[1], rb, 0, TAU);
}

/** A tapered ribbon along a quadratic-ish path: hair strands, scarves, coat tails. */
function ribbon(p, pts, w0, w1) {
  const n = pts.length, left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1e-6, w = w0 + (w1 - w0) * (i / (n - 1));
    left.push([pts[i][0] - (dy / l) * w, pts[i][1] + (dx / l) * w]); right.push([pts[i][0] + (dy / l) * w, pts[i][1] - (dx / l) * w]);
  }
  addPoly(p, [...left, ...right.reverse()]);
}
function curve(a, wind, len, bend, steps = 10) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([a[0] + wind[0] * len * t + Math.sin(t * Math.PI * 1.5 + bend) * 0.06 * t, a[1] + wind[1] * len * t + Math.cos(t * Math.PI * 1.2 + bend) * 0.05 * t + t * t * 0.05]);
  }
  return pts;
}

function figure(ctx, W, H, P, R, k, { scale, x, y }) {
  const pose = { ...POSES[POSE_NAMES[Math.floor(R() * POSE_NAMES.length)]] };
  const flip = R() < 0.5 ? -1 : 1;
  const lean = (R() - 0.5) * 0.3;
  const J = { p: [0, 0], n: [0, -0.62], lS: [-0.13, -0.56], rS: [0.13, -0.56], lHip: [-0.075, 0.02], rHip: [0.075, 0.02], ...pose };
  // low camera: legs grow, the head shrinks a little; then lean and mirror
  for (const key of Object.keys(J)) {
    let [jx, jy] = J[key];
    if (jy > 0) { jy *= 1.12; jx *= 1 + jy * 0.12; } else { jy *= 0.94; }
    const cs = Math.cos(lean), sn = Math.sin(lean);
    J[key] = [(jx * cs - jy * sn) * flip, jx * sn + jy * cs];
  }
  const wind = [-flip * (0.8 + R() * 0.4), -0.15 - R() * 0.35];
  const body = new Path2D();
  // torso
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const tor = [[J.lS[0] * 1.15, J.lS[1] - 0.01], [J.rS[0] * 1.15, J.rS[1] - 0.01], mix(J.rS, J.rHip, 0.55), [J.rHip[0] * 1.9, J.rHip[1] + 0.03], [J.lHip[0] * 1.9, J.lHip[1] + 0.03], mix(J.lS, J.lHip, 0.55)];
  addPoly(body, tor);
  capsule(body, J.n, J.h, 0.04, 0.035);
  capsule(body, J.lS, J.lE, 0.052, 0.04); capsule(body, J.lE, J.lH, 0.04, 0.03);
  capsule(body, J.rS, J.rE, 0.052, 0.04); capsule(body, J.rE, J.rH, 0.04, 0.03);
  capsule(body, J.lHip, J.lK, 0.085, 0.056); capsule(body, J.lK, J.lF, 0.056, 0.036);
  capsule(body, J.rHip, J.rK, 0.085, 0.056); capsule(body, J.rK, J.rF, 0.056, 0.036);
  for (const f of [J.lF, J.rF]) capsule(body, f, [f[0] + 0.09 * flip, f[1] + 0.02], 0.036, 0.026);
  body.moveTo(J.h[0] + 0.08, J.h[1]); body.ellipse(J.h[0], J.h[1], 0.078, 0.092, lean * flip, 0, TAU);

  // hair: a cap plus strands still swinging
  const hc = HAIR[Math.floor(R() * HAIR.length)];
  const hair = new Path2D();
  hair.moveTo(J.h[0] + 0.1, J.h[1] - 0.02); hair.ellipse(J.h[0] - wind[0] * 0.015, J.h[1] - 0.025, 0.1, 0.092, 0, 0, TAU);
  const strands = 12 + Math.floor(R() * 8), long = 0.18 + R() * 0.4;
  for (let i = 0; i < strands; i++) {
    const a = -Math.PI * (0.15 + R() * 0.75);
    const root = [J.h[0] + Math.cos(a) * 0.07, J.h[1] + Math.sin(a) * 0.075];
    ribbon(hair, curve(root, wind, long * (0.6 + R() * 0.6), R() * 3), 0.035 + R() * 0.02, 0.003);
  }
  // a ribbon or scarf and a coat tail: the pop colour, and the motion
  const cloth = new Path2D();
  ribbon(cloth, curve([J.n[0], J.n[1] + 0.04], wind, 0.45 + R() * 0.35, R() * 3, 14), 0.035, 0.012);
  if (R() < 0.7) ribbon(cloth, curve([J.p[0], -0.12], [wind[0], wind[1] * 0.3 + 0.25], 0.35 + R() * 0.2, R() * 3, 12), 0.11, 0.05);

  const ux = Math.sign(k.lx - x) || 1, uy = -0.6; // light comes from behind, above
  const rim = scale * 0.011, band = scale * 0.035;
  const draw = (path, mid, shade, rimCol, alpha = 1) => {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.save(); ctx.translate((ux * rim) / scale, (uy * rim) / scale);
    ctx.shadowColor = rimCol; ctx.shadowBlur = scale * 0.05; ctx.fillStyle = rimCol; ctx.fill(path); ctx.restore();
    ctx.fillStyle = mid; ctx.fill(path);
    ctx.save(); ctx.clip(path); ctx.translate((-ux * band) / scale, (-uy * band) / scale); ctx.fillStyle = shade; ctx.fill(path); ctx.restore();
    ctx.restore();
  };
  const rimCol = c(P.rim);
  // motion ghosts: the frame before
  for (let g = 3; g >= 1; g--) {
    ctx.save(); ctx.translate(-wind[0] * scale * 0.035 * g, -wind[1] * scale * 0.02 * g);
    draw(body, hsl(P.light, 0.8, 0.6, 1), hsl(P.light, 0.8, 0.6, 1), hsl(P.light, 1, 0.7), 0.06 * (4 - g));
    ctx.restore();
  }
  draw(cloth, hsl(P.accent, 0.95, 0.5), hsl(P.accent + 15, 0.9, 0.3), rimCol);
  draw(body, hsl(P.shadow[0] + 10, 0.35, P.dark ? 0.22 : 0.3), hsl(P.shadow[0], 0.45, P.dark ? 0.09 : 0.16), rimCol);
  draw(hair, hsl(hc[0], hc[1], hc[2]), hsl(hc[0] + 10, hc[1], hc[2] * 0.45), rimCol);
  return { wind, head: [x + J.h[0] * scale, y + J.h[1] * scale] };
}

// ---------- the paint pass ----------
/** Re-stroke the picture with flat rectangular strokes that sample it, jitter its colour and follow its edges. */
function brushwork(ctx, W, H, R, photo = false) {
  const data = ctx.getImageData(0, 0, W, H).data;
  const at = (x, y) => { x = clamp(Math.round(x), 0, W - 1); y = clamp(Math.round(y), 0, H - 1); return (y * W + x) * 4; };
  const lum = (i) => data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
  const pass = (count, size, edgesOnly) => {
    for (let n = 0; n < count; n++) {
      const x = R() * W, y = R() * H, i = at(x, y), d = 2;
      const gx = lum(at(x + d, y)) - lum(at(x - d, y)), gy = lum(at(x, y + d)) - lum(at(x, y - d)), mag = Math.hypot(gx, gy);
      if (edgesOnly && mag < 18) continue;
      if (photo && !edgesOnly && mag > 22) continue; // keep eyes, mouths and outlines crisp
      const ang = (mag > 6 ? Math.atan2(gy, gx) + Math.PI / 2 : 0.7) + (R() - 0.5) * 0.5;
      let [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      h += (R() - 0.5) * 16; s = clamp(s * (0.92 + R() * 0.3)); l = clamp(l + (R() - 0.5) * 0.08);
      const len = size * (0.6 + R() * 0.8) * (mag > 40 ? 0.55 : 1);
      ctx.setTransform(Math.cos(ang), Math.sin(ang), -Math.sin(ang), Math.cos(ang), x, y);
      ctx.globalAlpha = photo ? 0.3 + R() * 0.35 : 0.45 + R() * 0.45;
      ctx.fillStyle = hsl(h, s, l);
      ctx.fillRect(-len / 2, -len * 0.21, len, len * 0.42);
    }
  };
  ctx.save();
  if (photo) { pass(Math.round((W * H) / 60), W / 42, false); pass(Math.round((W * H) / 50), W / 130, true); }
  else { pass(Math.round((W * H) / 70), W / 26, false); pass(Math.round((W * H) / 40), W / 70, true); }
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
}

// ---------- repainting a real photo or MV frame ----------
/**
 * Turn a photo into a painted layer: cel-shaded value bands, split-toned shadows and lights
 * in the card's palette, stronger colour, and an ink layer traced from its edges.
 */
function stylize(img, W, H, P, photo) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (photo.kind === 'mv') { const bar = sh * 0.125; sy = bar; sh -= 2 * bar; } // hqdefault is letterboxed
  const sc = Math.max(W / sw, H / sh), dw = sw * sc, dh = sh * sc;
  const [fx, fy] = photo.focus || [0.5, 0.5];
  const dx = clamp(W / 2 - dw * fx, W - dw, 0), dy = clamp(H / 2 - dh * fy, H - dh, 0);
  // A digital-illustration finish, not paint: skin and fabric smoothed into clean gradients,
  // features kept sharp, values stepped into cel tones, and crisp line art on top.
  cx.filter = `blur(${Math.max(1.5, W / 110).toFixed(1)}px)`;
  cx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  const soft = cx.getImageData(0, 0, W, H).data;
  cx.filter = 'none';
  cx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  const id = cx.getImageData(0, 0, W, H), d = id.data;
  const L = new Float32Array(W * H);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) L[p] = soft[i] * 0.3 + soft[i + 1] * 0.59 + soft[i + 2] * 0.11;
  const M = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      const gx = L[p - W + 1] + 2 * L[p + 1] + L[p + W + 1] - L[p - W - 1] - 2 * L[p - 1] - L[p + W - 1];
      const gy = L[p + W - 1] + 2 * L[p + W] + L[p + W + 1] - L[p - W - 1] - 2 * L[p - W] - L[p - W + 1];
      M[p] = Math.hypot(gx, gy);
    }
  }
  const ink = document.createElement('canvas'); ink.width = W; ink.height = H;
  const ic = ink.getContext('2d'), inkData = ic.createImageData(W, H), o = inkData.data;
  const [ir, ig, ib] = hslToRgb(P.shadow[0], 0.55, 0.1);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const e = clamp((M[p] - 30) / 70); // 0 on smooth surfaces, 1 on features
    let [h, s, l] = rgbToHsl(soft[i] + (d[i] - soft[i]) * e, soft[i + 1] + (d[i + 1] - soft[i + 1]) * e, soft[i + 2] + (d[i + 2] - soft[i + 2]) * e);
    const t = l * 4, q = Math.floor(t), f = t - q;
    l = clamp((q + clamp((f - 0.42) / 0.16)) / 4 * 0.55 + l * 0.45) * 0.94;   // cel steps with clean, narrow transitions
    const shade = (1 - l) * (1 - l), lit = l * l;
    h = mixHue(h, P.shadow[0], shade * 0.5 * (s < 0.15 ? 1 : 0.55)); // cool shadows
    h = mixHue(h, P.light, lit * 0.22);                               // warm lights
    s = clamp(s * 1.35 + 0.1 * shade);
    if (l > 0.8) l = clamp(l + 0.03);                                 // glossy highlights
    const [r, g, b] = hslToRgb(h, s, l);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
    const a = clamp((M[p] - (W < 300 ? 58 : 42)) / (W < 300 ? 90 : 70)) * (W < 300 ? 0.8 : 1); // lighter lines on small cards
    if (a > 0) { o[i] = ir; o[i + 1] = ig; o[i + 2] = ib; o[i + 3] = a * 235; }
  }
  cx.putImageData(id, 0, 0);
  ic.putImageData(inkData, 0, 0);
  return { color: cv, ink };
}

/** Fade a layer out toward the edges, so it melts into the painted scene. */
function feather(layer, W, H, shape) {
  const t = document.createElement('canvas'); t.width = W; t.height = H;
  const tc = t.getContext('2d');
  tc.drawImage(layer, 0, 0);
  tc.globalCompositeOperation = 'destination-in';
  if (shape === 'mv') {
    const g = tc.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.78);
    g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,.15)');
    tc.fillStyle = g;
    tc.fillRect(0, 0, W, H);
  } else {
    tc.translate(W / 2, H * 0.46); tc.scale(1, (H / W) * 1.05);
    const g = tc.createRadialGradient(0, 0, W * 0.26, 0, 0, W * 0.56);
    g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    tc.fillStyle = g;
    tc.fillRect(-W, -H, W * 2, H * 2);
  }
  return t;
}

// ---------- light and motion effects (painted after the brushwork, so they stay crisp) ----------
function energy(ctx, W, H, P, R, k, count, minRad = 0) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let r = 0; r < count; r++) {
    const a0 = R() * TAU, rad = Math.max(minRad, W * (0.25 + R() * 0.3)), sweep = 1.6 + R() * 2.2;
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, a = a0 + sweep * t, rr = rad * (1 + 0.25 * Math.sin(t * 5 + r));
      pts.push([k.cx + Math.cos(a) * rr, k.cy + Math.sin(a) * rr * 0.62 - t * H * 0.08]);
    }
    const hue = r % 2 ? P.light : P.accent;
    for (const [w, a] of [[W / 22, 0.07], [W / 55, 0.2], [W / 160, 0.85]]) {
      ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.strokeStyle = a > 0.5 ? hsl(hue, 1, 0.92, a) : hsl(hue, 1, 0.6, a);
      ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
    }
    // the ribbon breaking apart into droplets at its end
    const [ex, ey] = pts[pts.length - 1];
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = hsl(hue, 1, 0.75, 0.8 - i * 0.05);
      ctx.beginPath(); ctx.arc(ex + (R() - 0.3) * W * 0.12, ey + (R() - 0.5) * W * 0.08, W * (0.004 + R() * 0.008), 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}

const inside = (e, x, y) => e && ((x - e.x) / e.rx) ** 2 + ((y - e.y) / e.ry) ** 2 < 1;
function particles(ctx, W, H, P, R, motif, wind, avoid = null) {
  ctx.save();
  const kind = { flower: 'petal', butterfly: 'petal', heart: 'petal', snow: 'snow', flame: 'ember', sword: 'ember', bolt: 'spark', disco: 'confetti', star: 'spark', gem: 'spark', crown: 'spark', wave: 'bubble' }[motif] || (P.scene === 'inferno' ? 'ember' : 'spark');
  const n = kind === 'confetti' ? 60 : 45;
  for (let i = 0; i < n; i++) {
    const x = R() * W, y = R() * H, s = W * (0.006 + R() * 0.014), a = Math.atan2(wind[1], wind[0]);
    if (inside(avoid, x, y)) continue;
    ctx.globalCompositeOperation = kind === 'ember' || kind === 'spark' ? 'lighter' : 'source-over';
    if (kind === 'petal' || kind === 'confetti') {
      ctx.save(); ctx.translate(x, y); ctx.rotate(R() * TAU);
      ctx.fillStyle = kind === 'petal' ? hsl(P.accent + R() * 20, 0.8, 0.78, 0.9) : hsl(R() * 360, 0.9, 0.62, 0.95);
      ctx.beginPath(); ctx.ellipse(0, 0, s * 1.4, s * 0.7, 0, 0, TAU); ctx.fill(); ctx.restore();
      ctx.strokeStyle = hsl(P.accent, 0.8, 0.8, 0.18); ctx.lineWidth = s;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(a) * s * 6, y - Math.sin(a) * s * 6); ctx.stroke();
    } else if (kind === 'snow' || kind === 'bubble') {
      ctx.fillStyle = kind === 'snow' ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.18)';
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = s * 0.2;
      ctx.beginPath(); ctx.arc(x, y, s * (kind === 'bubble' ? 1.6 : 0.7), 0, TAU); ctx.fill(); if (kind === 'bubble') ctx.stroke();
    } else {
      const hue = kind === 'ember' ? 25 + R() * 20 : P.light;
      ctx.strokeStyle = hsl(hue, 1, 0.7, 0.9); ctx.lineWidth = s * 0.45; ctx.lineCap = 'round';
      const up = kind === 'ember' ? -Math.PI / 2 + (R() - 0.5) : a + Math.PI;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(up) * s * 3, y + Math.sin(up) * s * 3); ctx.stroke();
    }
  }
  ctx.restore();
}

function speedLines(ctx, W, H, P, R, wind, avoid = null) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const a = Math.atan2(wind[1], wind[0]);
  for (let i = 0; i < 26; i++) {
    const x = R() * W, y = R() * H, l = W * (0.15 + R() * 0.35);
    if (inside(avoid, x, y) || inside(avoid, x + Math.cos(a) * l, y + Math.sin(a) * l)) continue;
    ctx.strokeStyle = hsl(P.light, 0.8, 0.85, 0.08 + R() * 0.14); ctx.lineWidth = W * (0.002 + R() * 0.004);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  ctx.restore();
}

/** Out-of-focus shapes in front of the lens. */
function bokeh(ctx, W, H, P, R) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const edge = R() < 0.5, x = edge ? (R() < 0.5 ? R() * W * 0.18 : W - R() * W * 0.18) : R() * W, y = edge ? R() * H : (R() < 0.5 ? R() * H * 0.15 : H - R() * H * 0.15);
    const r = W * (0.06 + R() * 0.12);
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    const hue = R() < 0.5 ? P.light : P.accent;
    g.addColorStop(0, hsl(hue, 1, 0.7, 0.22)); g.addColorStop(0.75, hsl(hue, 1, 0.65, 0.12)); g.addColorStop(1, hsl(hue, 1, 0.6, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function flare(ctx, W, H, P, k) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(0, k.ly, W, k.ly);
  g.addColorStop(0, hsl(P.light, 1, 0.7, 0)); g.addColorStop(0.5, hsl(P.light, 1, 0.85, 0.55)); g.addColorStop(1, hsl(P.light, 1, 0.7, 0));
  ctx.fillStyle = g; ctx.fillRect(0, k.ly - H * 0.006, W, H * 0.012);
  const s = ctx.createRadialGradient(k.lx, k.ly, 0, k.lx, k.ly, W * 0.12);
  s.addColorStop(0, 'rgba(255,255,255,.95)'); s.addColorStop(0.2, hsl(P.light, 1, 0.8, 0.5)); s.addColorStop(1, hsl(P.light, 1, 0.7, 0));
  ctx.fillStyle = s; ctx.fillRect(k.lx - W * 0.12, k.ly - W * 0.12, W * 0.24, W * 0.24);
  ctx.restore();
}

let grainTile = null;
function finish(ctx, W, H, P, glow) {
  // bloom: a blurred, contrasty copy screened back over
  const t = document.createElement('canvas'); t.width = W; t.height = H;
  const tc = t.getContext('2d');
  tc.filter = `blur(${Math.round(W / 40)}px) brightness(.95) contrast(1.7)`;
  tc.drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = glow;
  ctx.drawImage(t, 0, 0);
  ctx.restore();
  // vignette
  const v = ctx.createRadialGradient(W / 2, H * 0.45, W * 0.3, W / 2, H * 0.5, W * 0.85);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, P.dark ? 'rgba(4,2,10,.6)' : 'rgba(40,20,60,.28)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  // grain
  if (!grainTile) {
    grainTile = document.createElement('canvas'); grainTile.width = grainTile.height = 96;
    const g = grainTile.getContext('2d'), d = g.createImageData(96, 96);
    for (let i = 0; i < d.data.length; i += 4) { const n = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = n; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.09;
  ctx.fillStyle = ctx.createPattern(grainTile, 'repeat'); ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---------- composition ----------
const TIER_FX = { common: 0, rare: 1, epic: 2, legend: 3 };

/**
 * Paint one cover. spec: {seed, title, act, words, color, tier, kind: 'song'|'idol'}
 */
export function paint(ctx, W, H, spec, img = null) {
  const R = rng(hash(spec.seed));
  const fxLevel = TIER_FX[spec.tier] ?? 0;
  const motif = motifFor(spec.words || spec.title, R);
  const scenes = SCENES[motif] || ['night'];
  const P = palette(hueOf(spec.color) + (R() - 0.5) * 40, scenes[Math.floor(R() * scenes.length)], R);
  if (img && spec.photo.kind === 'custom') return paintCustom(ctx, W, H, img);
  if (img) return paintPhoto(ctx, W, H, spec, img, R, fxLevel, motif, scenes);
  const withFigure = spec.kind === 'idol' || R() < 0.5;
  const side = R() < 0.5 ? -1 : 1;
  const k = {
    hy: H * (0.62 + R() * 0.12), vx: W * (0.5 + (R() - 0.5) * 0.3),
    cx: W * 0.5, cy: H * (withFigure ? 0.42 : 0.47),
  };
  k.lx = withFigure ? W * (0.5 + side * (0.12 + R() * 0.15)) : W * (0.5 + side * 0.25);
  k.ly = H * (0.18 + R() * 0.2);

  background(ctx, W, H, P, R, k);
  perspective(ctx, W, H, P, R, k, motif);
  if (P.scene === 'void' || R() < 0.45) graphic(ctx, W, H, P, R, spec);
  if (R() < 0.18 || (motif === 'note' && R() < 0.5)) filmStrip(ctx, W, H, P, R);

  // the hero object: big behind a figure, or the whole subject on its own
  const at = withFigure
    ? { x: W * (0.5 - side * (0.25 + R() * 0.06)), y: H * (0.22 + R() * 0.08), s: W * (0.17 + R() * 0.05) }
    : { x: W * (0.5 + (R() - 0.5) * 0.1), y: H * (0.44 + (R() - 0.5) * 0.06), s: W * (0.27 + R() * 0.07) };
  if (!withFigure && motif !== 'sun' && motif !== 'moon') { // a cast shadow on the ground sells the 3D
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.filter = `blur(${Math.round(W / 60)}px)`;
    ctx.beginPath(); ctx.ellipse(at.x + (at.x - k.lx) * 0.15, Math.max(k.hy, at.y + at.s * 1.15), at.s * 0.9, at.s * 0.16, 0, 0, TAU); ctx.fill(); ctx.restore();
  }
  (PAINT[motif] || PAINT.star)(ctx, at, P, k, R);

  let wind = [R() < 0.5 ? -1 : 1, -0.3];
  if (withFigure) {
    const big = spec.kind === 'idol';
    const scale = H * (big ? 0.5 : 0.36) * (0.9 + R() * 0.15);
    const f = figure(ctx, W, H, P, R, k, { scale, x: W * (0.5 + side * 0.1 + (R() - 0.5) * 0.06), y: H * (big ? 0.6 : 0.64) });
    wind = f.wind;
  }

  brushwork(ctx, W, H, R);

  if (fxLevel >= 1 || R() < 0.5) speedLines(ctx, W, H, P, R, wind);
  if (fxLevel >= 2 || motif === 'bolt' || (motif === 'sword' && R() < 0.6)) energy(ctx, W, H, P, R, k, fxLevel >= 3 ? 3 : 2);
  particles(ctx, W, H, P, R, motif, wind);
  bokeh(ctx, W, H, P, R);
  if (fxLevel >= 3 || R() < 0.25) flare(ctx, W, H, P, k);
  finish(ctx, W, H, P, 0.25 + fxLevel * 0.08);
  return { motif, scene: P.scene };
}

/** An illustrated cover (data/cardart.json): shown as it is, scaled to cover the canvas, kept to the top. */
function paintCustom(ctx, W, H, img) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const sw = W / s, sh = H / s;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) * 0.1, sw, sh, 0, 0, W, H);
  return { custom: true };
}

/** A real photo (idols) or MV frame (songs), repainted, inside a painted scene. */
function paintPhoto(ctx, W, H, spec, img, R, fxLevel, motif, scenes) {
  const P = palette(hueOf(spec.color) + (R() - 0.5) * 40, scenes[Math.floor(R() * scenes.length)], R);
  const mv = spec.photo.kind === 'mv';
  const side = R() < 0.5 ? -1 : 1;
  const k = { hy: H * (0.66 + R() * 0.1), vx: W * 0.5, cx: W * 0.5, cy: H * 0.45, lx: W * (0.5 + side * 0.3), ly: H * (0.12 + R() * 0.12) };
  background(ctx, W, H, P, R, k);
  perspective(ctx, W, H, P, R, k, motif);
  graphic(ctx, W, H, P, R, spec);
  const layer = stylize(img, W, H, P, spec.photo);
  ctx.drawImage(feather(layer.color, W, H, mv ? 'mv' : 'portrait'), 0, 0);
  // the song's emblem, small, like a sticker in the corner opposite the light
  (PAINT[motif] || PAINT.star)(ctx, { x: W * (0.5 - side * 0.36), y: H * 0.14, s: W * 0.1 }, P, k, R);
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.9;
  ctx.drawImage(feather(layer.ink, W, H, mv ? 'mv' : 'portrait'), 0, 0); ctx.restore();
  // a wash of the key light over the subject
  ctx.save(); ctx.globalCompositeOperation = 'soft-light';
  const wash = ctx.createLinearGradient(k.lx, k.ly, W - k.lx, H);
  wash.addColorStop(0, hsl(P.light, 1, 0.65, 0.45)); wash.addColorStop(1, hsl(P.shadow[0], 0.8, 0.2, 0.55));
  ctx.fillStyle = wash; ctx.fillRect(0, 0, W, H); ctx.restore();
  const wind = [side, -0.3];
  // effects stay off the face: they frame the subject instead of crossing it
  const face = { x: W / 2, y: H * 0.4, rx: W * 0.3, ry: H * 0.26 };
  if (fxLevel >= 1) speedLines(ctx, W, H, P, R, wind, face);
  particles(ctx, W, H, P, R, motif, wind, face);
  bokeh(ctx, W, H, P, R);
  if (fxLevel >= 3) flare(ctx, W, H, P, k);
  finish(ctx, W, H, P, 0.14 + fxLevel * 0.05);
  return { motif, scene: P.scene, photo: true };
}

// ---------- scheduling: paint on demand, a few per frame, cached ----------
const SIZES = { big: [520, 500], small: [240, 320] };
const CUSTOM_SIZES = { big: [640, 960], small: [256, 384] }; // illustrated covers keep their 2:3 shape
const sizeOf = (spec, size) => (spec.photo?.kind === 'custom' ? CUSTOM_SIZES : SIZES)[size];
const cache = new Map(); // key -> canvas, least recently used first
const CACHE_MAX = 160;
const queue = [];
const images = new Map();
/** Load a cross-origin image for pixel access. Resolves null if it fails. */
export function loadImage(src) {
  if (!images.has(src)) {
    images.set(src, new Promise((done) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; img.decoding = 'async';
      img.onload = () => done(img.naturalWidth > 130 ? img : null); // YouTube's 120px placeholder means no thumbnail
      img.onerror = () => done(null);
      img.src = src;
    }));
  }
  return images.get(src);
}
let pumping = false;

function remember(key, canvas) {
  cache.delete(key); cache.set(key, canvas);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

function run() {
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < 12) {
    const job = queue.shift();
    if (job.canvas.dataset.art !== job.key) continue; // the slot shows something else now
    let src = cache.get(job.key);
    if (!src && job.spec.photo && job.img === undefined) { // fetch the photo, then come back
      loadImage(job.spec.photo.src).then((img) => { job.img = img; queue.push(job); if (!pumping) { pumping = true; requestAnimationFrame(run); } });
      continue;
    }
    if (!src) {
      const [w, h] = job.img ? sizeOf(job.spec, job.size) : SIZES[job.size]; // a cover that failed to load falls back to a painted one
      src = document.createElement('canvas'); src.width = w; src.height = h;
      if (job.canvas.width !== w) job.canvas.width = w;
      if (job.canvas.height !== h) job.canvas.height = h;
      const g = src.getContext('2d', { willReadFrequently: true });
      try { paint(g, w, h, job.spec, job.img); } catch { g.reset?.(); paint(g, w, h, job.spec, null); } // a tainted or broken photo
    }
    remember(job.key, src);
    job.canvas.getContext('2d').drawImage(src, 0, 0);
    job.canvas.classList.add('painted');
  }
  if (queue.length) requestAnimationFrame(run); else pumping = false;
}

const seen = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      const job = e.target._artJob;
      if (job) { job.size === 'big' ? queue.unshift(job) : queue.push(job); if (!pumping) { pumping = true; requestAnimationFrame(run); } }
    }
  }, { rootMargin: '200px' })
  : null;

/** Show a card's cover in this canvas. size: 'big' | 'small'. Paints when the canvas is on screen. */
export function showArt(canvas, spec, size = 'small') {
  const key = `${spec.seed}@${size}`;
  const done = cache.get(key);
  const [w, h] = done ? [done.width, done.height] : sizeOf(spec, size);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.dataset.art = key;
  if (done) { remember(key, done); canvas.getContext('2d').drawImage(done, 0, 0); canvas.classList.add('painted'); return; }
  canvas.classList.remove('painted');
  canvas.getContext('2d').clearRect(0, 0, w, h);
  const job = { canvas, spec, size, key };
  canvas._artJob = job;
  if (seen) { seen.unobserve(canvas); seen.observe(canvas); }
  else { queue.push(job); if (!pumping) { pumping = true; requestAnimationFrame(run); } }
}
