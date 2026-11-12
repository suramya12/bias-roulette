// Draws the wheel once per segment change and spins it with a CSS transform.
// It never decides an outcome: spinTo() is told which segment to land on.

const INK = '#2a1840';

export class Wheel {
  /** @param opts {onTick(segIndex)} — called whenever a new segment passes the pointer */
  constructor(canvas, { onTick } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onTick = onTick;
    this.segments = [];
    this.rot = 0; // degrees, clockwise
    this.raf = 0;
    new ResizeObserver(() => this.draw()).observe(canvas.parentElement);
  }

  /** @param segments [{label, color, taken}] */
  setSegments(segments) {
    this.segments = segments;
    this.draw();
  }

  /** Index of the segment under the pointer (top of the wheel). */
  atPointer(rot = this.rot) {
    const n = this.segments.length;
    if (!n) return -1;
    const theta = (((-90 - rot) % 360) + 360) % 360;
    return Math.min(n - 1, Math.floor(theta / (360 / n)));
  }

  draw() {
    const { canvas, ctx, segments } = this;
    const size = canvas.parentElement.clientWidth;
    if (!size) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const n = segments.length;
    if (!n) return;
    const R = size / 2;
    const a = (Math.PI * 2) / n;
    const dense = n > 40;

    ctx.save();
    ctx.translate(R, R);
    segments.forEach((seg, i) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, i * a, (i + 1) * a);
      ctx.closePath();
      ctx.fillStyle = seg.taken ? '#ddd6e6' : seg.color;
      ctx.fill();
      ctx.lineWidth = dense ? 0.6 : 2.5;
      ctx.strokeStyle = dense ? 'rgba(42,24,64,.45)' : INK;
      ctx.stroke();
    });

    // labels run along the radius, reading outwards
    const arc = a * R * 0.86;
    let font = n <= 12 ? 15 : Math.max(5, Math.min(13, arc * 0.74));
    const maxLen = R * (n <= 12 ? 0.6 : 0.63);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    segments.forEach((seg, i) => {
      ctx.save();
      ctx.rotate((i + 0.5) * a);
      let size2 = font;
      let text = seg.label;
      const fit = () => { ctx.font = `700 ${size2}px Fredoka, ui-rounded, system-ui, sans-serif`; return ctx.measureText(text).width <= maxLen; };
      while (!fit() && size2 > Math.max(5, font * 0.72)) size2 -= 0.5;
      while (!fit() && text.length > 4) text = text.slice(0, -2).trimEnd() + '…';
      ctx.fillStyle = seg.taken ? '#a79fb5' : INK;
      ctx.fillText(text, R * 0.95, 0);
      ctx.restore();
    });
    ctx.restore();
  }

  #apply() { this.canvas.style.transform = `rotate(${this.rot}deg)`; }

  /**
   * Spin so that `index` ends under the pointer.
   * @returns Promise resolved when the wheel has stopped.
   */
  spinTo(index, { duration = 3600, turns = 5 } = {}) {
    cancelAnimationFrame(this.raf);
    const n = this.segments.length;
    const seg = 360 / n;
    const jitter = (Math.random() - 0.5) * 0.64; // where inside the segment; looks only
    const want = -90 - (index + 0.5 + jitter) * seg;
    const from = this.rot;
    const delta = ((((want - from) % 360) + 360) % 360) + 360 * turns;
    let last = this.atPointer();
    const t0 = performance.now();
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(this.raf);
        this.rot = (((from + delta) % 360) + 360) % 360;
        this.#apply();
        resolve();
      };
      // Browsers pause animation frames in background tabs; a timer still ends the spin.
      setTimeout(finish, duration + 250);
      const frame = (now) => {
        if (finished) return;
        const t = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - t, 3.4);
        this.rot = from + delta * eased;
        this.#apply();
        const cur = this.atPointer();
        if (cur !== last) { last = cur; this.onTick?.(cur); }
        if (t < 1) this.raf = requestAnimationFrame(frame);
        else finish();
      };
      this.raf = requestAnimationFrame(frame);
    });
  }
}
