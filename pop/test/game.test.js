import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/game.js';

test('rarity tiers follow overall rank', () => {
  assert.equal(G.songRarity(1).id, 'legendary');
  assert.equal(G.songRarity(10).id, 'legendary');
  assert.equal(G.songRarity(11).id, 'epic');
  assert.equal(G.songRarity(30).id, 'epic');
  assert.equal(G.songRarity(31).id, 'rare');
  assert.equal(G.songRarity(100).id, 'rare');
  assert.equal(G.songRarity(101).id, 'common');
});

test('number formatting', () => {
  assert.equal(G.fmt(9_169_793_729), '9.17B');
  assert.equal(G.fmt(12_400_000_000), '12.4B');
  assert.equal(G.fmt(845_000_000), '845M');
  assert.equal(G.fmt(45_300_000), '45.3M');
});

test('soloist shows 0 / N, group shows N / 0, member shows both', () => {
  assert.deepEqual(G.artistStats({ kind: 'person', bands: [], nBand: 0, nSolo: 12 }), { band: 0, solo: 12 });
  assert.deepEqual(G.artistStats({ kind: 'group', bands: [], nBand: 30, nSolo: 0 }), { band: 30, solo: 0 });
  assert.deepEqual(G.artistStats({ kind: 'person', bands: ['X'], nBand: 20, nSolo: 8 }), { band: 20, solo: 8 });
});

test('top100 is ordered and unique', () => {
  const songs = [{ id: 'b', o: 2 }, { id: 'a', o: 1 }, { id: 'a', o: 1 }, { id: 'c', o: 101 }];
  assert.deepEqual(G.top100(songs).map((s) => s.id), ['a', 'b']);
});

test('wheel lands on the chosen segment', () => {
  for (const n of [3, 7, 12]) for (let i = 0; i < n; i++) {
    const r = G.spinAngle(1234, i, n, 5, 0.8);
    assert.equal(G.segmentAt(r, n), i, `n=${n} i=${i}`);
    assert.ok(r - 1234 >= 4 * 360);
  }
});

test('finalists are the landed segment and its neighbours', () => {
  assert.deepEqual(G.finalists([1, 2, 3, 4, 5], 0), [4, 0, 1]);
  assert.deepEqual(G.finalists([1, 2], 1), [0, 1]);
});

test('ring never shows the same song twice', () => {
  const pool = Array.from({ length: 100 }, (_, i) => ({ id: 'v' + i }));
  const rand = G.rng(7);
  const shown = new Set();
  let ring = G.dealRing(pool, 12, shown, rand);
  for (let k = 0; k < 60; k++) {
    assert.equal(new Set(ring.map((s) => s.id)).size, ring.length);
    const idx = k % ring.length;
    shown.add(ring[idx].id);
    ring = G.refillRing(ring, idx, pool, shown, rand);
  }
});

test('collect marks new cards once', () => {
  let { col, isNew } = G.collect({}, 'song', 'x');
  assert.ok(isNew);
  ({ col, isNew } = G.collect(col, 'song', 'x'));
  assert.ok(!isNew);
  assert.deepEqual(col.s, ['x']);
});

test('wheelSongs dedupes and caps', () => {
  const byId = new Map([['a', { id: 'a' }], ['b', { id: 'b' }]]);
  assert.deepEqual(G.wheelSongs({ songs: ['a', 'a', 'b', 'zz'] }, byId).map((s) => s.id), ['a', 'b']);
});

test('keywords and flavour are deterministic', () => {
  const s = { id: 'abc', o: 5, s: 3e9, v: 4e9, latin: true };
  assert.deepEqual(G.songKeywords(s), ['Hall of Fame', 'Streaming Giant', 'MV Monster']);
  assert.equal(G.songFlavour(s), G.songFlavour({ ...s }));
});

test('the ring keeps changing after every song has been shown', () => {
  const pool = Array.from({ length: 20 }, (_, i) => ({ id: 's' + i }));
  const shown = new Set();
  let ring = G.dealRing(pool, 6, shown);
  for (let k = 0; k < 150; k++) {
    const before = ring[k % 6].id;
    shown.add(before);
    ring = G.refillRing(ring, k % 6, pool, shown);
    assert.notEqual(ring[k % 6].id, before);
    assert.equal(new Set(ring.map((s) => s.id)).size, 6);
  }
});

test('Duel: draw 5 distinct finalists, then first to 3 wins', () => {
  const d = new G.Duel(100, { rand: G.rng(7) });
  for (let k = 0; k < 5; k++) assert.equal(d.spin().kind, 'draw');
  assert.equal(new Set(d.fin).size, 5);
  assert.equal(d.phase, 'duel');
  assert.equal(d.wheel().length, 10);
  let ev;
  do { ev = d.spin(); assert.equal(ev.kind, 'hit'); assert.equal(d.wheel()[ev.segment].index, ev.index); } while (!ev.won);
  assert.equal(Math.max(...d.hits), 3);
  assert.ok(d.fin.includes(d.winner));
});

test('Duel: small pools draw everything, one item wins at once', () => {
  const d = new G.Duel(3, { rand: G.rng(1) });
  for (let k = 0; k < 3; k++) d.spin();
  assert.equal(d.phase, 'duel');
  assert.equal(new G.Duel(1).winner, 0);
});

test('score averages the stats that exist and never returns NaN', () => {
  assert.equal(G.score({ s: 4, v: 2 }), 3);
  assert.equal(G.score({ v: 2 }), 2);
  assert.equal(G.score({ s: 6, v: 0 }), 6);
  assert.equal(G.score({}), 0);
});
