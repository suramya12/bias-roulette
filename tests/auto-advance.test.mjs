import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoAdvance } from '../src/auto-advance.js';
import { createStrikes } from '../src/strikes.js';

let timers, serial;
beforeEach(() => {
  timers = new Map(); serial = 0;
  globalThis.document = { hidden: false };
  globalThis.setTimeout = (fn, delay) => { timers.set(++serial, { fn, delay }); return serial; };
  globalThis.clearTimeout = (id) => timers.delete(id);
});
function setup(enabled = true) {
  let active = true;
  const advances = [], pauses = [];
  const auto = createAutoAdvance({ enabled, isActive: () => active,
    advance: (meta) => advances.push(meta), onPause: (value) => pauses.push(value) });
  return { auto, advances, pauses, active: (value) => { active = value; } };
}
function due() {
  const pending = [...timers.values()]; timers.clear(); pending.forEach(({ fn }) => fn());
}

test('strikes defaults to three; success resets; custom limits work', () => {
  const s = createStrikes();
  assert.equal(s.out, false);
  assert.equal(s.fail(), false); assert.equal(s.fail(), false);
  assert.equal(s.fail(), true); assert.equal(s.out, true);
  s.ok(); assert.equal(s.out, false); assert.equal(s.fail(), false);
  assert.equal(createStrikes(1).fail(), true);
});

test('restored preference does not start playback; explicit enable without a track starts once', () => {
  const s = setup(); assert.equal(s.advances.length, 0);
  s.auto.setEnabled(true); assert.equal(s.advances.length, 1);
  const token = s.auto.begin();
  s.auto.setEnabled(true); assert.equal(s.advances.length, 1);
  s.auto.blocked(token); s.auto.setEnabled(true);
  assert.equal(s.advances.length, 1);
});

test('duplicate errors count once and schedule only one 4000ms advance', () => {
  const s = setup(), token = s.auto.begin();
  s.auto.fail(token); s.auto.fail(token); s.auto.end(token);
  assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 4000);
  assert.equal(s.auto.paused, false); due(); assert.equal(s.advances.length, 1);
});

test('three consecutive attempts pause visibly; Resume resets and advances', () => {
  const s = setup();
  for (let i = 0; i < 3; i++) { s.auto.fail(s.auto.begin()); due(); }
  assert.equal(s.advances.length, 2); assert.equal(s.auto.paused, true);
  assert.deepEqual(s.pauses, [true]); assert.equal(timers.size, 0);
  s.auto.resume(); assert.equal(s.auto.paused, false); assert.equal(s.advances.length, 3);
  s.auto.fail(s.auto.begin()); assert.equal(s.auto.paused, false);
});

test('successful state 1 resets strikes; blocked autoplay never counts as failure', () => {
  const s = setup();
  s.auto.fail(s.auto.begin()); due(); s.auto.fail(s.auto.begin()); due();
  const token = s.auto.begin();
  s.auto.blocked(token); due(); assert.equal(s.advances.length, 2);
  s.auto.play(token); s.auto.fail(token);
  assert.equal(s.auto.paused, false); assert.equal(timers.size, 1);
});

for (const action of ['manual Skip', 'row', 'Quick', 'Next', 'pool change', 'mode exit']) {
  test(`${action} invalidates even an already queued advance and stale player callbacks`, () => {
    const s = setup(), old = s.auto.begin();
    s.auto.end(old);
    const stale = [...timers.values()][0].fn;
    s.auto.invalidate();
    const next = action === 'mode exit' ? null : s.auto.begin();
    stale(); s.auto.fail(old); s.auto.play(old); s.auto.end(old); due();
    assert.equal(s.advances.length, 0);
    if (next) { s.auto.end(next); due(); assert.equal(s.advances.length, 1); }
  });
}

test('one ended attempt owns one 1200ms timer; Auto off cancels it', () => {
  const s = setup(), token = s.auto.begin();
  s.auto.end(token); s.auto.end(token);
  assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 1200);
  const stale = [...timers.values()][0].fn;
  s.auto.setEnabled(false); stale(); due(); assert.equal(s.advances.length, 0);
});

test('hidden-tab due advance plays immediately; returning uses normal short pulls', () => {
  const s = setup(); s.auto.end(s.auto.begin()); document.hidden = true; due();
  assert.deepEqual(s.advances, [{ hidden: true }]);
  document.hidden = false; s.auto.end(s.auto.begin()); due();
  assert.deepEqual(s.advances[1], { hidden: false });
});

test('mode-away/back discards the timer and restores preference without starting', () => {
  const s = setup(); s.auto.end(s.auto.begin());
  const stale = [...timers.values()][0].fn;
  s.active(false); s.auto.invalidate(); s.active(true); stale(); due();
  assert.equal(s.auto.enabled, true); assert.equal(s.advances.length, 0);
});

test('inactive sections cannot start Auto or run a queued timer', () => {
  const s = setup(); s.auto.end(s.auto.begin()); s.active(false); due();
  s.auto.setEnabled(true); assert.equal(s.advances.length, 0);
});

test('a canceled callback cannot consume a replacement timer or resurrect after Auto off/on', () => {
  const s = setup(), old = s.auto.begin(); s.auto.end(old);
  const stale = [...timers.values()][0].fn;
  s.auto.invalidate(); const next = s.auto.begin(); s.auto.end(next);
  stale();
  assert.equal(s.advances.length, 0); assert.equal(timers.size, 1);
  due(); assert.equal(s.advances.length, 1);
  const token = s.auto.begin(); s.auto.end(token);
  const canceled = [...timers.values()][0].fn;
  s.auto.setEnabled(false); s.auto.setEnabled(true, { start: false }); canceled();
  assert.equal(s.advances.length, 1);
});
