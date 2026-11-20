import { cryptoInt } from './game.js';
import { confetti, isLite, prefersReducedMotion } from './fx.js';

const mod = (a, n) => ((a % n) + n) % n;
const lift = ' translateZ(70px) translateY(-6px) scale(1.12)';

const MAX_NEW_LOADS = 4;

/** Shared motion only; the caller owns selection, card faces and playback. */
export class PullMachine {
  constructor({ ring, hit, buttons = [], slots = 14, radius, renderSlot, isLoaded, sound,
    onLand, onReveal, onPull, onCancel, tierOf, say }) {
    Object.assign(this, { ring, hit, buttons: Array.from(buttons), slotCount: slots,
      radiusOf: radius, renderSlot, isLoaded, sound, onLand, onReveal, onPull, onCancel, tierOf, say });
    this.angle = 0;
    this.slots = [];
    this.items = [];
    this.warm = [];
    this.warmSet = new Set();
    this.loaded = new Set();
    this.inFlight = new Map();
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
    this.visibility = () => {
      const motion = this.motion;
      if (!document.hidden || !motion?.short || this.state !== 'spinning') return;
      cancelAnimationFrame(this.raf);
      this.angle = motion.end;
      this.#applyAngle();
      this.#land(motion);
    };
    document.addEventListener?.('visibilitychange', this.visibility);
    this.#status();
  }

  get state() { return this._state; }

  setPool(items, pick) {
    if (this.destroyed) return;
    this.#invalidate();
    this.#clearInFlight();
    this.warm = [];
    this.warmSet = new Set();
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
    this.#clearInFlight();
    this.observer.disconnect();
    window.removeEventListener('resize', this.resize);
    document.removeEventListener?.('visibilitychange', this.visibility);
    for (const el of new Set([this.hit, ...this.buttons])) {
      el.removeEventListener('click', this.press);
      el.removeEventListener('keydown', this.key);
    }
  }

  #valid(token) { return !this.destroyed && this.active && token === this.generation; }

  #invalidate(notify = true) {
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
    if (notify) this.onCancel?.();
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

  #clearInFlight() {
    for (const slot of this.slots) { slot._cleanup?.(); slot._cleanup = null; }
    this.inFlight.clear();
  }

  #isItemLoaded(item) {
    return this.loaded.has(item) || Boolean(this.isLoaded?.(item));
  }

  #remember(item) {
    if (!item || this.warmSet.has(item)) return;
    const cap = Math.max(this.slots.length + 6, 20);
    if (this.warm.length >= cap) {
      const drop = this.warm.findIndex((x) => x !== this.winner?.item && !this.slots.some((s) => s.item === x));
      if (drop >= 0) this.warmSet.delete(this.warm.splice(drop, 1)[0]);
    }
    this.warmSet.add(item);
    this.warm.push(item);
  }

  #trackSlot(slot, item) {
    slot._cleanup?.();
    slot._cleanup = null;
    this.inFlight.delete(slot);
    this.#remember(item);
    if (this.#isItemLoaded(item)) { this.loaded.add(item); return; }
    const img = slot.el.querySelector?.('img');
    if (!img) { this.loaded.add(item); return; }
    if (img.complete && img.naturalWidth > 0) {
      this.loaded.add(item);
      return;
    }
    this.inFlight.set(slot, item);
    const cleanup = () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      if (slot._cleanup === cleanup) slot._cleanup = null;
    };
    const onLoad = () => {
      cleanup();
      const done = () => {
        if (this.inFlight.get(slot) === item) this.inFlight.delete(slot);
        this.loaded.add(item);
      };
      if (typeof img.decode === 'function') img.decode().then(done, done);
      else done();
    };
    const onError = () => {
      cleanup();
      if (this.inFlight.get(slot) === item) this.inFlight.delete(slot);
    };
    slot._cleanup = cleanup;
    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });
  }

  #build() {
    this.#clearInFlight();
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
    this.#trackSlot(slot, item);
  }

  #refill(slot, motion) {
    if (this.inFlight.has(slot)) return;
    const idx = this.slots.indexOf(slot);
    const prev = this.slots[mod(idx - 1, this.slots.length)]?.item;
    const next = this.slots[mod(idx + 1, this.slots.length)]?.item;
    const ready = this.warm.filter((x) => x !== slot.item && x !== this.winner?.item && this.#isItemLoaded(x));
    const distinct = ready.filter((x) => x !== prev && x !== next);
    const pool = distinct.length ? distinct : ready;
    if (pool.length) {
      this.#fill(slot, pool[cryptoInt(pool.length)]);
      return;
    }
    if (motion.newLoads >= MAX_NEW_LOADS || this.inFlight.size >= MAX_NEW_LOADS) return;
    const candidate = this.#random();
    if (!candidate || candidate === slot.item || candidate === this.winner?.item) return;
    if (!this.#isItemLoaded(candidate)) motion.newLoads++;
    this.#fill(slot, candidate);
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

  pull({ short = false, immediate = false } = {}) {
    if (this.destroyed || this.state !== 'idle' || !this.active || !this.items.length) return;
    this.#invalidate(false);
    const token = this.generation;
    this._state = 'spinning'; // Reserve the pull before calling side-owned selection.
    this.onPull?.({ short });
    if (!this.#valid(token)) return;
    const item = this.pick();
    if (!this.#valid(token) || this.state !== 'spinning') return;
    if (!item) { this.cancel(); return; }
    this.sound?.unlock();
    const k = mod(this.#front() + Math.floor(this.slots.length / 2), this.slots.length);
    this.winner = this.slots[k];
    const winnerWasLoaded = this.#isItemLoaded(item);
    this.#fill(this.winner, item);
    this.reduced = prefersReducedMotion();
    const end = this.angle - ((this.reduced ? 0 : short ? 1 : 3) * 360 + mod(this.angle + k * this.step, 360));
    this.#status();
    if (this.#valid(token)) this.say?.('Shuffling the deck…');
    if (!this.#valid(token)) return;
    if (immediate && short) {
      this.angle = end;
      this.#applyAngle();
      this.#land({ token, item, short });
      return;
    }
    const duration = this.reduced ? 350 : short ? 1200 : 3600;
    this.#animate({ start: this.angle, end, duration,
      at: performance.now(), pullAt: performance.now(), pullDuration: duration,
      tick: Math.floor(this.angle / this.step), newLoads: winnerWasLoaded ? 0 : 1, token, item, short });
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
          this.#refill(this.slots[back], motion);
        }
      }
      if (Math.abs(this.angle - motion.end) < this.step * 1.5) this.winner.el.classList.add('incoming');
      if (p < 1) this.raf = requestAnimationFrame(frame);
      else this.#land(motion);
    };
    this.raf = requestAnimationFrame(frame);
  }

  #land({ token, item, short = false }) {
    if (!this.#valid(token) || this.state !== 'spinning') return;
    this.motion = null;
    this._state = 'landing';
    const tier = this.tierOf(item);
    this.lifted = this.winner;
    this.lifted.el.classList.remove('incoming');
    this.lifted.el.classList.add('lifted');
    this.lifted.el.style.transform = this.lifted.base + lift;
    this.#status();
    if (this.#valid(token)) this.onLand?.(item, tier, { short });
    if (!this.#valid(token)) return;
    if (!short) this.#celebrate(tier);
    if (!this.#valid(token)) return;
    this._state = 'revealing';
    const reveal = () => {
      if (!this.#valid(token) || this.state !== 'revealing') return;
      if (this.#valid(token)) this.onReveal?.(item, { short });
      if (!this.#valid(token)) return;
      this._state = 'idle';
      this.#resize();
      this.#idle();
    };
    if (short) { reveal(); return; }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      reveal();
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
