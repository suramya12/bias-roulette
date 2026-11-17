import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { eligible, franchise, pickNext, tierOf, copyQueue, copyLabel } from '../src/engine.js';

const kinds = [
  { id: 'theme', addon: false, default: true },
  { id: 'animated-mv', addon: true, default: true },
  { id: 'extra', addon: true, default: false },
];
const song = (id, show = id, rest = {}) => ({
  id, show, kind: 'theme', use: 'OP', videos: [{ id: `${id}-video`, kind: 'tv', source: 'fan' }], ...rest,
});
const pairs = (names) => names.flatMap((name) => [song(`${name}0`, name), song(`${name}1`, name)]);

test('eligible filters themes by use, excludes unknown kinds and requires actual copies', () => {
  const pool = [song('op'), song('ed', 'ed', { use: 'ED' }), song('in', 'in', { use: 'IN' }),
    song('unknown', 'unknown', { kind: 'missing' }), song('empty', 'empty', { videos: [], video: { id: 'legacy' } }),
    song('absent', 'absent', { videos: undefined })];
  assert.deepEqual(eligible(pool, { uses: new Set(['ED', 'IN']), kinds }).map((s) => s.id), ['ed', 'in']);
  assert.deepEqual(eligible(pool, { uses: new Set(), kinds }), []);
  assert.deepEqual(eligible(pool), []);
});

test('add-ons use kind defaults and explicit switches, independently of theme filters', () => {
  const pool = [song('theme'), song('mv', 'mv', { kind: 'animated-mv', use: 'MV' }),
    song('extra', 'extra', { kind: 'extra', use: 'MV' })];
  const options = { uses: new Set(), kinds };
  assert.deepEqual(eligible(pool, options).map((s) => s.id), ['mv']);
  assert.deepEqual(eligible(pool, { ...options, addons: { 'animated-mv': false, extra: true } }).map((s) => s.id), ['extra']);
  assert.deepEqual(eligible(pool, { kinds }).map((s) => s.id), ['theme', 'mv']);
});

test('franchise normalizes show/source; show takes precedence with nullish fallback', () => {
  assert.equal(franchise({ show: '  NARUTO  ', source: 'other' }), 'naruto');
  assert.equal(franchise({ source: ' K/DA ' }), 'k/da');
  assert.equal(franchise({ show: null, source: ' Arcane ' }), 'arcane');
  assert.equal(franchise({ show: '', source: 'other' }), '');
  assert.equal(franchise({}), '');
});

test('empty and one-song pools terminate; stale history ids are harmless', () => {
  assert.equal(pickNext([], [], () => { throw new Error('must not draw'); }), undefined);
  const only = song('only');
  assert.equal(pickNext([only], ['only', 'gone', 'only'], () => 0), only);
  assert.equal(pickNext([only], [], () => 0.99), only);
  assert.equal(pickNext([only], ['gone'], () => 0), only);
});

test('last franchise never repeats when an alternative exists, even against the song cooldown', () => {
  const pool = [song('a0', ' A '), song('a1', 'a'), song('b', 'B')];
  assert.equal(pickNext(pool, ['b', 'a0'], () => 0).id, 'b');
  assert.equal(pickNext(pool, ['a0'], () => 0).id, 'b');
});

test('a single-franchise pool still avoids recent songs', () => {
  const pool = [song('a', 'one'), song('b', 'one'), song('c', 'one')];
  assert.equal(pickNext(pool, ['a', 'b'], () => 0).id, 'c');
  assert.equal(pickNext(pool, ['c', 'a'], () => 0).id, 'b');
});

test('franchise window starts at ten and does not relax while any choice remains', () => {
  const pool = pairs(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  const history = ['a0', 'b0', 'c0', 'd0', 'e0', 'a0', 'b0', 'c0', 'd0', 'f0'];
  assert.equal(pickNext(pool, history, () => 0).id, 'g0');
  assert.equal(pickNext(pool, history, () => 0.99).id, 'g1');
});

test('franchise cooldown relaxes from ten to five, then to one', () => {
  const pool = pairs(['a', 'b', 'c', 'd', 'e', 'f']);
  const history = ['a0', 'b0', 'c0', 'd0', 'e0', 'a0', 'a0', 'a0', 'a0', 'f0'];
  assert.equal(pickNext(pool, history, () => 0).id, 'b1');
  const small = pairs(['a', 'b', 'c']);
  assert.equal(pickNext(small, ['a0', 'b0', 'c0', 'a0', 'b0', 'c0'], () => 0).id, 'a1');
});

test('song cooldown uses at most pool.length - 1 plays and caps at twenty', () => {
  const small = [song('a', 'one'), song('b', 'one'), song('c', 'one')];
  assert.equal(pickNext(small, ['a', 'b', 'c'], () => 0).id, 'a');
  const large = Array.from({ length: 23 }, (_, i) => song(String(i), 'one'));
  const history = Array.from({ length: 21 }, (_, i) => String(i));
  assert.equal(pickNext(large, history, () => 0).id, '0');
  assert.equal(pickNext(large, history, () => 0.5).id, '21');
});

test('unknown history ids occupy plays rather than extending the cooldown window', () => {
  const pool = [song('a', 'one'), song('b', 'one'), song('c', 'one')];
  assert.equal(pickNext(pool, ['a', 'gone', 'b'], () => 0).id, 'a');
});

test('full catalogue preserves franchise history when filters hide the previous song', () => {
  const hidden = song('opening', 'Naruto');
  const pool = [song('ending', ' NARUTO '), song('other', 'Bleach')];
  assert.equal(pickNext(pool, ['opening'], () => 0, [hidden, ...pool]).id, 'other');
});

test('weights are inverse square root of franchise population, using the whole pool', () => {
  const pool = [0, 1, 2, 3].map((i) => song(`a${i}`, 'A')).concat(song('b', 'B'));
  assert.equal(pickNext(pool, [], () => 0).id, 'a0');
  assert.equal(pickNext(pool, [], () => 0.65).id, 'a3');
  assert.equal(pickNext(pool, [], () => 0.67).id, 'b');
  assert.equal(pickNext(pool, [], () => 1 - Number.EPSILON).id, 'b');
});

test('selection and filtering do not mutate catalogue or history', () => {
  const pool = Object.freeze(pairs(['a', 'b']).map(Object.freeze));
  const history = Object.freeze(['a0']);
  const options = { kinds, uses: new Set(['OP']), addons: {} };
  const before = structuredClone({ pool, history, options });
  pickNext(pool, history, () => 0.3); eligible(pool, options);
  assert.deepEqual({ pool, history, options }, before);
});

for (const [views, tier] of [[0, 'common'], [2_999_999, 'common'], [3_000_000, 'rare'],
  [19_999_999, 'rare'], [20_000_000, 'epic'], [99_999_999, 'epic'], [100_000_000, 'legendary']]) {
  test(`tier boundary: ${views} views is ${tier}`, () => {
    assert.equal(tierOf({ videos: [{ views: 1 }, { views }, { views: 0 }] }), tier);
  });
}
test('tier ignores the legacy first-copy alias and handles missing views/copies', () => {
  assert.equal(tierOf({ videos: [{}, { views: '20000000' }], video: { views: 1e9 } }), 'epic');
  assert.equal(tierOf({ videos: [] }), 'common');
  assert.equal(tierOf({}), 'common');
});

test('copy queue preserves catalogue order, promotes preference, and drops copies at three strikes', () => {
  const s = { videos: ['a', 'b', 'c', 'd'].map((id) => Object.freeze({ id })) };
  Object.freeze(s.videos);
  assert.deepEqual(copyQueue(s).map((v) => v.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(copyQueue(s, { preferredId: 'c', localStrikes: { a: 3, b: 2, d: 9 } }).map((v) => v.id), ['c', 'b']);
  assert.deepEqual(copyQueue(s, { preferredId: 'a', localStrikes: { a: 3 } }).map((v) => v.id), ['b', 'c', 'd']);
  assert.deepEqual(copyQueue(s, { preferredId: 'missing' }).map((v) => v.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(s.videos.map((v) => v.id), ['a', 'b', 'c', 'd']);
});

test('all struck copies are retained as a last resort, still honoring preference', () => {
  const s = { videos: [{ id: 'a' }, { id: 'b' }] };
  assert.deepEqual(copyQueue(s, { preferredId: 'b', localStrikes: { a: 3, b: 5 } }).map((v) => v.id), ['b', 'a']);
  assert.deepEqual(copyQueue({ videos: [] }), []);
  assert.deepEqual(copyQueue({}), []);
});

test('copy labels distinguish all catalogue kinds and official/fan sources', () => {
  for (const [kind, label] of [['creditless', 'Creditless'], ['tv', 'TV version'], ['mv', 'Music video']]) {
    assert.equal(copyLabel({ kind, source: 'official' }), `${label} · official`);
    assert.equal(copyLabel({ kind, source: 'fan' }), `${label} · fan upload`);
  }
});

test('real catalogue has playable defaults, valid tiers and usable copy queues', async () => {
  const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  const liveKinds = JSON.parse(await readFile(new URL('../data/kinds.json', import.meta.url), 'utf8'));
  const pool = eligible(catalog.songs, { kinds: liveKinds });
  assert.ok(pool.length > 0);
  const history = [];
  let previous;
  for (let i = 0; i < 100; i++) {
    const next = pickNext(pool, history, () => (i * 0.61803398875) % 1);
    assert.ok(pool.includes(next));
    if (previous && pool.some((s) => franchise(s) !== franchise(previous))) assert.notEqual(franchise(next), franchise(previous));
    assert.ok(['common', 'rare', 'epic', 'legendary'].includes(tierOf(next)));
    assert.equal(copyQueue(next)[0], next.videos[0]);
    history.push(next.id); previous = next;
  }
});
