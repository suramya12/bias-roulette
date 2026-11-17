import { createStrikes } from './strikes.js';

/** One pending advance per playback attempt. Callers own selection and visibility. */
export function createAutoAdvance({ enabled = false, isActive, advance, onPause = () => {} }) {
  const strikes = createStrikes();
  let current = null, timer = null, paused = false, revision = 0;
  const clear = () => { ++revision; clearTimeout(timer); timer = null; };
  const ready = () => enabled && !paused && isActive();
  const unpause = () => { paused = false; onPause(false); };
  const go = () => {
    if (!ready()) return;
    clear();
    current = null;
    advance({ hidden: typeof document !== 'undefined' && document.hidden });
  };
  function schedule(token, delay) {
    if (!ready() || timer !== null || token.scheduled) return;
    token.scheduled = true;
    const mine = ++revision;
    timer = setTimeout(() => {
      if (mine !== revision) return;
      timer = null;
      if (token === current && ready()) go();
    }, delay);
  }
  return {
    begin() {
      clear();
      current = { failed: false, ended: false, scheduled: false, state: 'loading' };
      return current;
    },
    invalidate() { clear(); current = null; },
    setEnabled(value, { start = true } = {}) {
      clear();
      enabled = !!value;
      // An explicit toggle can re-arm an ended/failed attempt.
      if (current) current.scheduled = false;
      if (!enabled) { unpause(); return; }
      if (start && !paused && (!current || ['ended', 'failed'].includes(current.state))) go();
    },
    play(token) {
      if (!token || token !== current || token.failed) return;
      clear();
      token.state = 'playing';
      strikes.ok();
      if (paused) unpause();
    },
    end(token) {
      if (!token || token !== current || token.ended || token.failed) return;
      token.ended = true;
      token.state = 'ended';
      schedule(token, 1200);
    },
    fail(token) {
      if (!token || token !== current || token.failed) return;
      token.failed = true;
      token.state = 'failed';
      clear();
      token.scheduled = false;
      const out = strikes.fail();
      if (enabled && out) { paused = true; onPause(true); }
      else schedule(token, 4000);
    },
    blocked(token) {
      if (!token || token !== current || token.failed) return;
      clear();
      token.state = 'blocked';
    },
    resume() {
      clear();
      strikes.ok();
      unpause();
      go();
    },
    get enabled() { return enabled; },
    get paused() { return paused; },
  };
}
