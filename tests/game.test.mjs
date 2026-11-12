import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Game, cryptoInt, FINALISTS } from '../src/game.js';
import { buildCatalog, idolSongs, allSongs, songKey } from '../src/catalog.js';

// Small seeded generator so failures can be replayed.
function seeded(seed) {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

function makeIdols(n = 12, songCounts = null) {
  return Array.from({ length: n }, (_, i) => ({
    name: `Idol ${i}`, label: `Group ${i % 4}`, color: '#fff',
    songs: Array.from({ length: songCounts ? songCounts[i % songCounts.length] : 8 }, (_, j) => ({
      title: `Song ${i}-${j}`, artist: `Group ${i % 4}`, videoId: `vid${i}_${j}`,
    })),
  }));
}

const unique = (arr) => new Set(arr).size === arr.length;

test('draws never repeat and never land on a taken segment', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const g = new Game(makeIdols(9, [1, 3, 5, 8, 20]), { randInt: seeded(seed) });
    while (g.phase !== 'result') {
      const wheel = g.wheel();
      const ev = g.spin();
      if (ev.kind === 'draw') {
        assert.equal(wheel.segments[ev.segment].taken, false, 'landed on a taken segment');
        assert.equal(wheel.segments[ev.segment].index, ev.index);
      }
    }
    assert.ok(unique(g.idolFinalists));
    assert.equal(g.idolFinalists.length, FINALISTS);
    assert.ok(unique(g.songFinalists));
    assert.equal(g.songFinalists.length, Math.min(FINALISTS, g.idol.songs.length));
    for (const s of g.songFinalists) assert.ok(s >= 0 && s < g.idol.songs.length);
  }
});

for (const target of [2, 3]) {
  test(`showdowns end exactly when someone reaches ${target}`, () => {
    for (let seed = 1; seed <= 300; seed++) {
      const g = new Game(makeIdols(), { target, randInt: seeded(seed * 7) });
      while (g.phase !== 'result') {
        const ev = g.spin();
        if (ev.kind !== 'hit') continue;
        const hits = ev.stage === 'idol' ? g.idolHits : g.songHits;
        const atTarget = hits.filter((h) => h >= target).length;
        if (ev.won) {
          assert.equal(ev.hits, target);
          assert.equal(atTarget, 1, 'exactly one finalist at the target');
          assert.notEqual(ev.phaseAfter, ev.phase, 'phase moved on');
        } else {
          assert.equal(atTarget, 0, 'nobody at the target while the showdown continues');
          assert.equal(ev.phaseAfter, ev.phase);
        }
        assert.ok(hits.every((h) => h <= target));
      }
      assert.equal(g.idolHits[g.idolFinalists.indexOf(g.idolIndex)], target);
      assert.equal(g.songHits[g.songFinalists.indexOf(g.songIndex)], target);
    }
  });
}

test('duel wheel shows each finalist twice and hits land on the right one', () => {
  const g = new Game(makeIdols(), { randInt: seeded(42) });
  while (g.phase === 'idolDraw') g.spin();
  const wheel = g.wheel();
  assert.equal(wheel.kind, 'duel');
  assert.equal(wheel.segments.length, FINALISTS * 2);
  for (let f = 0; f < FINALISTS; f++) {
    assert.equal(wheel.segments[f].index, wheel.segments[f + FINALISTS].index);
  }
  const ev = g.spin();
  assert.equal(wheel.segments[ev.segment].finalist, ev.finalist);
  assert.equal(wheel.segments[ev.segment].index, ev.index);
});

test('"Choose for me" from the start ends on a valid idol and one of her songs', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const idols = makeIdols(15, [1, 2, 4, 9]);
    const g = new Game(idols, { randInt: seeded(seed) });
    g.chooseForMe();
    assert.equal(g.phase, 'result');
    assert.ok(idols.includes(g.idol));
    assert.ok(g.idolFinalists.includes(g.idolIndex));
    assert.ok(g.idol.songs.includes(g.song), 'song belongs to the winning idol');
    assert.ok(g.songFinalists.includes(g.songIndex));
    assert.ok(g.song.videoId);
  }
});

test('"Choose for me" mid-game keeps what was already drawn', () => {
  for (let seed = 1; seed <= 200; seed++) {
    for (const spinsFirst of [1, 3, 5, 7, 12]) {
      const g = new Game(makeIdols(), { randInt: seeded(seed + spinsFirst * 1000) });
      for (let i = 0; i < spinsFirst && g.phase !== 'result'; i++) g.spin();
      const idolsBefore = [...g.idolFinalists];
      const idolHitsBefore = [...g.idolHits];
      const winnerBefore = g.idolIndex;
      const songsBefore = [...g.songFinalists];
      g.chooseForMe();
      assert.equal(g.phase, 'result');
      assert.deepEqual(g.idolFinalists.slice(0, idolsBefore.length), idolsBefore);
      idolHitsBefore.forEach((h, i) => assert.ok(g.idolHits[i] >= h));
      if (winnerBefore !== null) assert.equal(g.idolIndex, winnerBefore);
      assert.deepEqual(g.songFinalists.slice(0, songsBefore.length), songsBefore);
      assert.ok(g.idol.songs.includes(g.song));
    }
  }
});

test('"Another song" keeps the idol and redraws songs', () => {
  const g = new Game(makeIdols(), { randInt: seeded(5) });
  g.chooseForMe();
  const idol = g.idol;
  g.anotherSong();
  assert.equal(g.phase, 'songDraw');
  assert.equal(g.idol, idol);
  assert.deepEqual(g.songFinalists, []);
  assert.equal(g.song, null);
  g.chooseForMe();
  assert.equal(g.idol, idol);
  assert.ok(idol.songs.includes(g.song));
});

test('reset goes back to round 1 with nothing drawn', () => {
  const g = new Game(makeIdols(), { randInt: seeded(9) });
  g.chooseForMe();
  g.reset();
  assert.equal(g.phase, 'idolDraw');
  assert.deepEqual(g.idolFinalists, []);
  assert.equal(g.idol, null);
  assert.throws(() => g.anotherSong());
});

test('an idol with a single song skips the song showdown', () => {
  const g = new Game(makeIdols(6, [1]), { randInt: seeded(3) });
  g.chooseForMe();
  assert.equal(g.songFinalists.length, 1);
  assert.equal(g.song, g.idol.songs[0]);
});

test('changing the target mid-showdown only applies to the next showdown', () => {
  const g = new Game(makeIdols(), { target: 3, randInt: seeded(11) });
  while (g.phase === 'idolDraw') g.spin();
  g.spin();
  g.setTarget(2);
  while (g.phase === 'idolDuel') g.spin();
  assert.equal(Math.max(...g.idolHits), 3);
  g.chooseForMe();
  assert.equal(Math.max(...g.songHits), 2);
});

test('cryptoInt stays in range and is roughly uniform', () => {
  const counts = new Array(7).fill(0);
  const N = 70000;
  for (let i = 0; i < N; i++) {
    const v = cryptoInt(7);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 7);
    counts[v]++;
  }
  for (const c of counts) assert.ok(Math.abs(c - N / 7) < N / 7 * 0.06, `bucket ${c} too far from ${N / 7}`);
  assert.equal(cryptoInt(1), 0);
  assert.throws(() => cryptoInt(0));
});

test('every open item has an equal chance in a draw', () => {
  const idols = makeIdols(10);
  const first = new Array(10).fill(0);
  const N = 30000;
  for (let i = 0; i < N; i++) first[new Game(idols).spin().index]++;
  for (const c of first) assert.ok(Math.abs(c - N / 10) < N / 10 * 0.08);
});

test('catalog: joins roster with videos and leaves out songs without one', () => {
  const roster = {
    groups: [{ id: 'g', act: 'G', label: 'G', color: '#000', songs: ['A', 'B'] }, { id: 'h', act: 'H', label: 'Solo', color: '#111', songs: ['Z'] }],
    sets: { duo: { artist: 'Duo', songs: ['D'] } },
    idols: [
      { name: 'One', group: 'g', also: ['duo'], solo: [{ artist: 'ONE', songs: ['S', 'S'] }, { artist: 'G', songs: ['A'] }] },
      { name: 'Two', group: 'h' },
    ],
  };
  assert.deepEqual(idolSongs(roster, roster.idols[0]).map((s) => s.key), ['G | A', 'G | B', 'Duo | D', 'ONE | S']);
  const videos = { [songKey('G', 'A')]: { id: 'aaaaaaaaaaa' }, [songKey('ONE', 'S')]: { id: 'sssssssssss' } };
  const { idols, skipped } = buildCatalog(roster, videos);
  assert.deepEqual(idols.map((i) => i.name), ['One']);
  assert.deepEqual(idols[0].songs.map((s) => s.videoId), ['aaaaaaaaaaa', 'sssssssssss']);
  assert.deepEqual(skipped, ['Two']);
});

test('the real roster is well formed', async () => {
  const roster = JSON.parse(await readFile(new URL('../data/roster.json', import.meta.url), 'utf8'));
  assert.ok(unique(roster.idols.map((i) => i.name)), 'idol names are unique');
  assert.ok(unique(roster.groups.map((g) => g.id)), 'group ids are unique');
  for (const idol of roster.idols) assert.ok(idolSongs(roster, idol).length > 0, `${idol.name} has songs`);
  for (const g of roster.groups) assert.ok(unique(g.songs), `${g.act} has no duplicate titles`);
  assert.ok(allSongs(roster).size > 500);
});
