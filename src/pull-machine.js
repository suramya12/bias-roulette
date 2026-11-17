import { cryptoInt } from './game.js';
import { confetti, isLite, prefersReducedMotion } from './fx.js';

const mod = (a, n) => ((a % n) + n) % n;
const lift = ' translateZ(70px) translateY(-6px) scale(1.12)';

/** Shared motion only; the caller owns selection, card faces and playback. */
export class PullMachine {
  constructor({ ring, hit, buttons = [], slots = 14, radius, renderSlot, sound,
    onLand, onReveal, tierOf, say }) {
    Object.assign(this, { ring, hit, buttons: Array.from(buttons), slotCount: slots,
      radiusOf: radius, renderSlot, sound, onLand, onReveal, tierOf, say });
    this.angle = 0;
    this.slots = [];
    this.items = [];
    this.generation = 0;
    this._state = 'inactive';
    this.active = false;
    this.destroyed = false;
    this.timers = new Set();
    this.labels = this.buttons.map((b) => b.textContent);
    this.hitLabel = hit.getAttribute('aria-label');
    hit.setAttribute('role', 'button');
    hit.tabIndex = 0;
    this.press = () => {
      if (this.destroyed) return;
      if (this.state === 'spinning') this.slamStop();
      else if (this.state === 'idle') this.pull();
    };
    this.key = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); // Suppress the native click, including repeated key presses.
      if (!e.repeat) this.press();
    };
    for (const el of new Set([hit, ...this.buttons])) {
      el.addEventListener('click', this.press);
      el.addEventListener('keydown', this.key);
    }
    this.resize = () => { if (!this.destroyed) this.#resize(); };
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(ring.parentElement);
    window.addEventListener('resize', this.resize);
    this.#status();
  }

  get state() { return this._state; }

  setPool(items, pick) {
    if (this.destroyed) return;
    this.#invalidate();
    this.items = Array.from(items);
    this.pick = pick;
    this.#build();
    this.#idle();
  }

  activate() {
    if (this.destroyed || this.active) return;
    this.active = true;
    this._state = 'idle';
    this.#resize();
    this.#idle();
  }

  deactivate() {
    this.active = false;
    this.#invalidate();
  }

  cancel() {
    this.#invalidate();
    if (!this.destroyed) { this.#resize(); this.#idle(); }
  }

  destroy() {
    this.active = false;
    this.destroyed = true;
    this.#invalidate();
    this.observer.disconnect();
    window.removeEventListener('resize', this.resize);
    for (const el of new Set([this.hit, ...this.buttons])) {
      el.removeEventListener('click', this.press);
      el.removeEventListener('keydown', this.key);
    }
  }

  #valid(token) { return !this.destroyed && this.active && token === this.generation; }

  #invalidate() {
    ++this.generation;
    const token = this.generation;
    const dropped = this.lifted;
    cancelAnimationFrame(this.raf);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.motion = null;
    this.winner = null;
    this.lifted = null;
    for (const slot of this.slots) {
      slot.el.classList.remove('incoming', 'lifted', 'settle');
      if (slot === dropped) slot.el.classList.add('settle');
      slot.el.style.transform = slot.base;
    }
    if (dropped && !this.destroyed) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (!this.destroyed && token === this.generation) dropped.el.classList.remove('settle');
      }, 700);
      this.timers.add(timer);
    }
    this._state = this.active && !this.destroyed ? 'idle' : 'inactive';
    this.#status();
  }

  #status() {
    const spinning = this.state === 'spinning';
    const disabled = this.state !== 'idle' && !spinning;
    this.ring.parentElement.classList.toggle('spinning', spinning);
    this.ring.dataset.pullState = this.state;
    this.buttons.forEach((b, i) => {
      b.textContent = spinning ? 'Stop' : this.labels[i];
      b.setAttribute('aria-disabled', String(disabled));
    });
    this.hit.setAttribute('aria-disabled', String(disabled));
    this.hit.setAttribute('aria-label', spinning ? 'Stop' : (this.hitLabel || 'Pull a card'));
  }

  #count() {
    return Math.max(1, Math.round(typeof this.slotCount === 'function' ? this.slotCount() : this.slotCount));
  }

  #build() {
    this.lifted = null;
    this.slots = [];
    this.ring.replaceChildren();
    for (let i = 0, n = this.#count(); i < n && this.items.length; i++) {
      const el = document.createElement('div');
      el.className = 'pull-slot';
      const slot = { el };
      this.slots.push(slot);
      this.ring.append(el);
      this.#fill(slot, this.#random());
    }
    this.#layout();
  }

  #fill(slot, item) {
    slot.item = item;
    this.renderSlot(slot.el, item);
    slot.el.dataset.tier = this.tierOf(item);
  }

  #random() {
    const showing = new Set(this.slots.map((s) => s.item));
    const pool = this.items.length > this.slots.length ? this.items.filter((s) => !showing.has(s)) : this.items;
    return pool[cryptoInt(pool.length)];
  }

  #resize() {
    // A breakpoint can change the count only after the committed pull finishes.
    if (this.slots.length !== this.#count() && ['idle', 'inactive'].includes(this.state)) {
      this.#build();
      this.#idle();
    }
    else this.#layout();
  }

  #layout() {
    const n = this.slots.length;
    if (!n) return;
    const w = this.slots[0].el.offsetWidth || 110;
    this.radius = typeof this.radiusOf === 'function' ? this.radiusOf(w, n)
      : this.radiusOf ?? Math.round((w * 1.14) / (2 * Math.tan(Math.PI / n)));
    this.step = 360 / n;
    // CSS pixels, Y is the turn axis; slot zero faces the viewer at angle zero.
    this.slots.forEach((slot, i) => {
      slot.base = `rotateY(${i * this.step}deg) translateZ(${this.radius}px)`;
      slot.el.style.transform = slot.base + (slot === this.lifted ? lift : '');
    });
    this.#applyAngle();
  }

  #applyAngle() {
    this.ring.style.transform = `translateZ(${-this.radius}px) rotateX(-7deg) rotateY(${this.angle}deg)`;
  }

  #front() { return mod(Math.round(-this.angle / this.step), this.slots.length); }

  #idle() {
    cancelAnimationFrame(this.raf);
    this.#status();
    if (this.state !== 'idle' || !this.active || !this.slots.length || this.lifted || prefersReducedMotion() || isLite()) return;
    const token = this.generation;
    let last = performance.now();
    const frame = (t) => {
      if (!this.#valid(token) || this.state !== 'idle' || prefersReducedMotion() || isLite()) return;
      this.angle -= (t - last) * 0.007;
      last = t;
      this.#applyAngle();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  pull() {
    if (this.destroyed || this.state !== 'idle' || !this.active || !this.items.length) return;
    this.#invalidate();
    const token = this.generation;
    this._state = 'spinning'; // Reserve the pull before calling side-owned selection.
    const item = this.pick();
    if (!this.#valid(token) || this.state !== 'spinning') return;
    if (!item) { this.cancel(); return; }
    this.sound?.unlock();
    const k = mod(this.#front() + Math.floor(this.slots.length / 2), this.slots.length);
    this.winner = this.slots[k];
    this.#fill(this.winner, item);
    this.reduced = prefersReducedMotion();
    const end = this.angle - ((this.reduced ? 0 : 3) * 360 + mod(this.angle + k * this.step, 360));
    this.#status();
    if (this.#valid(token)) this.say?.('Shuffling the deck…');
    if (!this.#valid(token)) return;
    this.#animate({ start: this.angle, end, duration: this.reduced ? 350 : 3600,
      at: performance.now(), pullAt: performance.now(), pullDuration: this.reduced ? 350 : 3600,
      tick: Math.floor(this.angle / this.step), token, item });
  }

  slamStop() {
    if (this.state !== 'spinning' || !this.motion || this.motion.stopped) return;
    cancelAnimationFrame(this.raf);
    this.#animate({ ...this.motion, start: this.angle, at: performance.now(),
      duration: Math.min(450, this.motion.duration - (performance.now() - this.motion.at)), stopped: true });
  }

  #animate(motion) {
    this.motion = motion;
    const frame = (t) => {
      if (!this.#valid(motion.token) || this.state !== 'spinning' || this.motion !== motion) return;
      const p = Math.min(1, Math.max(0, (t - motion.at) / Math.max(1, motion.duration)));
      this.angle = motion.start + (motion.end - motion.start) * (1 - (1 - p) ** 4);
      this.#applyAngle();
      const tick = Math.floor(this.angle / this.step);
      // Account for every crossed boundary, even when a frame covers several cards.
      while (motion.tick > tick) {
        --motion.tick;
        this.sound?.tick();
        const back = mod(Math.round(-(motion.tick * this.step) / this.step) + Math.floor(this.slots.length / 2), this.slots.length);
        if (this.slots[back] !== this.winner && (t - motion.pullAt) / motion.pullDuration < 0.8) {
          this.#fill(this.slots[back], this.#random());
        }
      }
      if (Math.abs(this.angle - motion.end) < this.step * 1.5) this.winner.el.classList.add('incoming');
      if (p < 1) this.raf = requestAnimationFrame(frame);
      else this.#land(motion);
    };
    this.raf = requestAnimationFrame(frame);
  }

  #land({ token, item }) {
    if (!this.#valid(token) || this.state !== 'spinning') return;
    this.motion = null;
    this._state = 'landing';
    const tier = this.tierOf(item);
    this.lifted = this.winner;
    this.lifted.el.classList.remove('incoming');
    this.lifted.el.classList.add('lifted');
    this.lifted.el.style.transform = this.lifted.base + lift;
    this.#status();
    if (this.#valid(token)) this.onLand?.(item, tier);
    if (!this.#valid(token)) return;
    this.#celebrate(tier);
    if (!this.#valid(token)) return;
    this._state = 'revealing';
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.#valid(token) || this.state !== 'revealing') return;
      if (this.#valid(token)) this.onReveal?.(item);
      if (!this.#valid(token)) return;
      this._state = 'idle';
      this.#resize();
      this.#idle();
    }, this.reduced ? 500 : 1300);
    this.timers.add(timer);
  }

  #celebrate(tier) {
    const layer = document.getElementById('fx');
    if (layer && tier !== 'common') {
      const r = this.ring.parentElement.getBoundingClientRect();
      const color = getComputedStyle(this.lifted.el).getPropertyValue('--c').trim();
      confetti(layer, r.left + r.width / 2, r.top + r.height * 0.4, color,
        tier === 'legendary' ? 1.6 : tier === 'rare' ? 0.35 : 1);
    }
    if (tier === 'legendary') this.sound?.clack();
    if (tier === 'common') this.sound?.chime();
    else this.sound?.fanfare(tier);
    if (!prefersReducedMotion()) navigator.vibrate?.(tier === 'legendary' ? [30, 40, 70]
      : tier === 'epic' ? 25 : tier === 'rare' ? 15 : 10);
  }
}
