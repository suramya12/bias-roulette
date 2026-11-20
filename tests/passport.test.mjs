import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORE,
  report,
  collected,
  dailyPick,
  claim,
  spend,
  summary,
  isClaimedToday,
  checkSets,
  setProgress,
  normalizeState,
  normalizeTier,
  localDate,
  prevDate,
} from '../src/passport.js';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    _map: map,
  };
}

test('streak increments across consecutive days, stays same within a day, and resets after a skipped day', () => {
  globalThis.localStorage = makeStorage();

  const d1 = claim('kpop', '2026-05-01');
  assert.deepEqual(d1, { claimed: true, tour: false, dust: 0 });
  assert.equal(summary('2026-05-01').streak.count, 1);
  assert.equal(summary('2026-05-01').streak.best, 1);

  // Claiming a second side on the same day does not double-increment the streak.
  const d1b = claim('pop', '2026-05-01');
  assert.deepEqual(d1b, { claimed: true, tour: false, dust: 0 });
  assert.equal(summary('2026-05-01').streak.count, 1);

  // Re-claiming the same side on the same day is a no-op.
  const dup = claim('kpop', '2026-05-01');
  assert.deepEqual(dup, { claimed: false, tour: false, dust: 0 });

  // Consecutive day increments streak.
  claim('anime', '2026-05-02');
  assert.equal(summary('2026-05-02').streak.count, 2);
  assert.equal(summary('2026-05-02').streak.best, 2);

  // Another consecutive day.
  claim('bollywood', '2026-05-03');
  assert.equal(summary('2026-05-03').streak.count, 3);
  assert.equal(summary('2026-05-03').streak.best, 3);

  // Skip 2026-05-04: on 2026-05-05 before claiming, active streak is 0 while best stays 3.
  assert.equal(summary('2026-05-05').streak.count, 0);
  assert.equal(summary('2026-05-05').streak.best, 3);

  // Claiming on 2026-05-05 restarts streak at 1, preserving best = 3.
  claim('kpop', '2026-05-05');
  assert.equal(summary('2026-05-05').streak.count, 1);
  assert.equal(summary('2026-05-05').streak.best, 3);
});

test('world tour bonus (+50 dust) fires once when all four sides are sealed on the same day', () => {
  globalThis.localStorage = makeStorage();

  assert.equal(claim('kpop', '2026-06-10').tour, false);
  assert.equal(claim('pop', '2026-06-10').tour, false);
  assert.equal(claim('anime', '2026-06-10').tour, false);
  const fourth = claim('bollywood', '2026-06-10');
  assert.deepEqual(fourth, { claimed: true, tour: true, dust: 50 });
  assert.equal(summary('2026-06-10').dust, 50);
  assert.equal(summary('2026-06-10').tourComplete, true);
  assert.equal(isClaimedToday('bollywood', '2026-06-10'), true);

  // Repeating any side on the same day never awards the bonus again.
  assert.deepEqual(claim('bollywood', '2026-06-10'), { claimed: false, tour: false, dust: 0 });
  assert.equal(summary('2026-06-10').dust, 50);

  // Next day resets seals and allows a new world tour bonus.
  assert.equal(isClaimedToday('kpop', '2026-06-11'), false);
  claim('kpop', '2026-06-11');
  claim('pop', '2026-06-11');
  claim('anime', '2026-06-11');
  const nextTour = claim('bollywood', '2026-06-11');
  assert.deepEqual(nextTour, { claimed: true, tour: true, dust: 50 });
  assert.equal(summary('2026-06-11').dust, 100);
});

test('dust maths for duplicates across all tier names and spend()', () => {
  globalThis.localStorage = makeStorage();

  // New cards yield 0 dust.
  assert.equal(collected('kpop', { isNew: true, tier: 'legend' }), 0);
  assert.equal(summary().dust, 0);

  // Duplicates yield 5 / 10 / 20 / 40 across K-pop, Pop, Bollywood, and Anime tier ids.
  assert.equal(collected('kpop', { isNew: false, tier: 'common' }), 5);
  assert.equal(collected('pop', { isNew: false, tier: 'rare' }), 10);
  assert.equal(collected('anime', { isNew: false, tier: 'epic' }), 20);
  assert.equal(collected('kpop', { isNew: false, tier: 'legend' }), 40);
  assert.equal(collected('bollywood', { isNew: false, tier: 'legendary' }), 40);
  assert.equal(summary().dust, 115);

  assert.equal(normalizeTier({ id: 'legendary' }), 'legendary');
  assert.equal(normalizeTier('unknown'), 'common');

  // spend() checks balance and rejects invalid inputs.
  assert.equal(spend(-10), false);
  assert.equal(spend(1.5), false);
  assert.equal(spend(120), false);
  assert.equal(spend(60), true);
  assert.equal(summary().dust, 55);
  assert.equal(spend(60), false);
  assert.equal(spend(55), true);
  assert.equal(summary().dust, 0);
});

test('dailyPick is deterministic for date + side regardless of input array order', () => {
  const ids = ['id_c', 'id_a', 'id_d', 'id_b', 'id_e'];
  const reversed = [...ids].reverse();

  const pick1 = dailyPick('kpop', ids, '2026-07-04');
  const pick2 = dailyPick('kpop', reversed, '2026-07-04');
  assert.equal(pick1, pick2);
  assert.ok(ids.includes(pick1));

  // Different sides or dates vary (over a reasonable pool).
  const pool = Array.from({ length: 100 }, (_, i) => `song_${String(i).padStart(3, '0')}`);
  const kpopDay1 = dailyPick('kpop', pool, '2026-07-04');
  const popDay1 = dailyPick('pop', pool, '2026-07-04');
  const kpopDay2 = dailyPick('kpop', pool, '2026-07-05');
  assert.notEqual(kpopDay1, popDay1);
  assert.notEqual(kpopDay1, kpopDay2);
  assert.equal(dailyPick('kpop', [], '2026-07-04'), null);
});

test('tampered localStorage never throws and normalizes cleanly', () => {
  // Invalid JSON
  globalThis.localStorage = makeStorage({ [STORE]: '{not valid json' });
  const s1 = summary('2026-08-01');
  assert.equal(s1.dust, 0);
  assert.equal(s1.totalOwned, 0);
  assert.equal(s1.hasProfile, false);

  // Malicious / malformed structure with __proto__, negative numbers, floats, bad dates
  const tampered = '{"owned":{"kpop":-5,"pop":3.5,"anime":12,"__proto__":99},"total":{"anime":100,"bollywood":"50"},"dust":1e309,"streak":{"count":-2,"best":4,"last":"not-a-date"},"day":{"date":"2026-08-01","sealed":{"kpop":true,"evil":true,"pop":"yes"}},"tour":123,"ids":{"anime":["abc",123,"abc",""]},"completedSets":["set-1",42,"set-1"]}';
  globalThis.localStorage = makeStorage({ [STORE]: tampered });

  const s2 = summary('2026-08-01');
  assert.equal(s2.owned.kpop, 0);
  assert.equal(s2.owned.pop, 0);
  assert.equal(s2.owned.anime, 12);
  assert.equal(s2.total.anime, 100);
  assert.equal(s2.total.bollywood, 0);
  assert.equal(s2.dust, 0);
  assert.equal(s2.streak.count, 0);
  assert.equal(s2.streak.best, 4);
  assert.equal(s2.streak.last, null);
  assert.equal(s2.day.sealed.kpop, true);
  assert.equal(s2.day.sealed.pop, false);
  assert.equal(s2.tour, null);
  assert.deepEqual(s2.ids.anime, ['abc']);
  assert.deepEqual(s2.completedSets, ['set-1']);

  const norm = normalizeState(null);
  assert.equal(Object.getPrototypeOf(norm.owned), null);
  assert.equal(Object.getPrototypeOf(norm.day.sealed), null);
});

test('works in-memory when localStorage is completely blocked', async () => {
  const mod = await import('../src/passport.js?blocked-storage');
  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };

  mod.report('kpop', { owned: 10, total: 100, ids: ['vid12345678'] });
  assert.equal(mod.collected('kpop', { isNew: false, tier: 'epic' }), 20);
  assert.equal(mod.claim('kpop', '2026-09-01').claimed, true);
  const s = mod.summary('2026-09-01');
  assert.equal(s.owned.kpop, 10);
  assert.equal(s.dust, 20);
  assert.equal(s.streak.count, 1);
  assert.equal(s.day.sealed.kpop, true);
});

test('sets ownership, +150 dust on first completion, and nearly-complete-first sorting', () => {
  globalThis.localStorage = makeStorage();

  const sets = [
    { id: 'set-zero', side: 'kpop', name: 'Zero', blurb: 'b', items: [{ side: 'kpop', id: 'k1' }, { side: 'kpop', id: 'k2' }] },
    { id: 'set-near', side: 'kpop', name: 'Near', blurb: 'b', items: [{ side: 'kpop', id: 'k3' }, { side: 'kpop', id: 'k4' }] },
    { id: 'set-done', side: 'bridge', name: 'Bridge', blurb: 'b', items: [{ side: 'kpop', id: 'k3' }, { side: 'pop', id: 'p1' }] },
  ];

  report('kpop', { owned: 1, total: 10, ids: ['k3'] });
  report('pop', { owned: 1, total: 10, ids: ['p1'] });

  const first = checkSets(sets);
  assert.equal(first.completed.length, 1);
  assert.equal(first.completed[0].id, 'set-done');
  assert.equal(first.dust, 150);
  assert.equal(summary().dust, 150);

  // Calling checkSets again does not re-award dust.
  const second = checkSets(sets);
  assert.equal(second.completed.length, 0);
  assert.equal(second.dust, 0);
  assert.equal(summary().dust, 150);

  // Progress order: nearly-complete (1/2) -> empty (0/2) -> complete (2/2).
  const prog = setProgress(sets);
  assert.deepEqual(prog.map((s) => s.id), ['set-near', 'set-zero', 'set-done']);
  assert.equal(prog[0].ownedCount, 1);
  assert.equal(prog[2].complete, true);
});

test('date helpers handle month and leap-year boundaries', () => {
  assert.equal(prevDate('2026-03-01'), '2026-02-28');
  assert.equal(prevDate('2024-03-01'), '2024-02-29');
  assert.equal(prevDate('2026-01-01'), '2025-12-31');
  assert.equal(localDate('2026-11-20'), '2026-11-20');
});

test('recent covers track newly reported video ids in reverse chronological order and cap at 6', () => {
  globalThis.localStorage = makeStorage();

  report('kpop', { owned: 1, total: 10, ids: ['kpop0000001'] });
  report('pop', { owned: 1, total: 10, ids: ['pop00000001'] });
  report('anime', { owned: 1, total: 10, ids: ['anime000001'] });
  // Re-reporting existing ids should not reorder recent.
  report('kpop', { owned: 1, total: 10, ids: ['kpop0000001'] });

  assert.deepEqual(summary().recent, [
    { side: 'anime', id: 'anime000001' },
    { side: 'pop', id: 'pop00000001' },
    { side: 'kpop', id: 'kpop0000001' },
  ]);

  // Malformed recent entries are stripped on read.
  const norm = normalizeState({ recent: [{ side: 'evil', id: 'x' }, { side: 'kpop', id: 'ok123456789' }, null] });
  assert.deepEqual(norm.recent, [{ side: 'kpop', id: 'ok123456789' }]);
});
