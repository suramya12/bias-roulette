// Ticks and a fanfare, made with Web Audio. No audio files.

export class Sound {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
    this.lastTick = 0;
  }

  /** Call from a tap or key press: browsers only start audio after a gesture. */
  unlock() {
    if (!this.enabled) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!this.ctx && AC) this.ctx = new AC();
      if (this.ctx?.state === 'suspended') this.ctx.resume();
    } catch { /* no audio available */ }
  }

  #blip(freq, at, dur, gain, type) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  tick() {
    if (!this.enabled || !this.ctx) return;
    const now = performance.now();
    if (now - this.lastTick < 40) return; // a fast wheel would otherwise buzz
    this.lastTick = now;
    this.#blip(1250 + Math.random() * 150, this.ctx.currentTime, 0.035, 0.05, 'triangle');
  }

  clack() {
    if (!this.enabled || !this.ctx) return;
    this.#blip(90, this.ctx.currentTime, 0.07, 0.16, 'triangle');
    this.#blip(55, this.ctx.currentTime + 0.01, 0.09, 0.1, 'sine');
  }

  chime() {
    if (!this.enabled || !this.ctx) return;
    this.#blip(1046.5, this.ctx.currentTime, 0.3, 0.055, 'sine');
  }

  fanfare(tier) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    const octave = tier === 'legendary' ? 2 : 1;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.#blip(f * octave, t + i * 0.1, 0.18, 0.11, 'triangle'));
    [783.99, 1046.5, 1318.5].forEach((f) => this.#blip(f * octave, t + 0.44, 0.5, 0.07, 'triangle'));
  }
}
