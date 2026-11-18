import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/catalog.js';
import { CREDIT_HOSTS, IMAGE_HOSTS, isCardArtPath, isVideoId, safeUrl, videoThumbnail } from '../src/validation.js';

globalThis.matchMedia = () => ({ matches: false });
globalThis.window = { matchMedia };
globalThis.location = { search: '?lite=1' };
globalThis.document = { documentElement: { classList: { toggle() {} } } };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
const { chartRange } = await import('../src/charts.js');

test('video IDs and thumbnails only accept 11 ASCII letters, digits, underscores or hyphens', () => {
  assert.equal(isVideoId('Abcd_123-XY'), true);
  assert.equal(videoThumbnail('Abcd_123-XY', 'mqdefault'), 'https://i.ytimg.com/vi/Abcd_123-XY/mqdefault.jpg');
  for (const value of [null, 12345678901, ['Abcd_123-XY'], 'Abcd_123-X', 'Abcd_123-XYZ', 'Abcd!123-XY', 'Abcd_123-XY\n']) {
    assert.equal(isVideoId(value), false);
    assert.equal(videoThumbnail(value), null);
  }
});

test('image and credit URLs require HTTPS and an exact allow-listed host', () => {
  const image = 'https://i.ytimg.com/vi/Abcd_123-XY/hqdefault.jpg';
  const credit = 'https://commons.wikimedia.org/wiki/File:Artist.jpg';
  assert.equal(safeUrl(image, IMAGE_HOSTS), image);
  assert.equal(safeUrl(credit, CREDIT_HOSTS), credit);
  assert.equal(safeUrl(credit, IMAGE_HOSTS), null);
  for (const value of [null, '/photo.png', 'http://i.ytimg.com/x', 'https://i.ytimg.com.example.test/x', 'https://example.test/x']) {
    assert.equal(safeUrl(value, IMAGE_HOSTS), null);
  }
});

test('card art paths use the song or idol directory and a relative WebP filename', () => {
  assert.equal(isCardArtPath('art/song/a.b_2-C.webp'), true);
  assert.equal(isCardArtPath('art/idol/x.webp'), true);
  for (const value of [null, '/art/song/x.webp', 'art/other/x.webp', 'art/song/s/x.webp', 'art/song/x.webp?q=1', 'art/idol/x.png']) {
    assert.equal(isCardArtPath(value), false);
  }
});

test('catalog preserves six-digit hex accents and uses the existing default otherwise', () => {
  const roster = { groups: [{ id: 'g', act: 'Artist', label: 'Group', songs: ['Song'] }], idols: [{ name: 'Member', group: 'g' }] };
  const videos = { 'Artist | Song': { id: 'Abcd_123-XY' } };
  for (const [color, expected] of [['#aBc123', '#aBc123'], ['#abc', '#b693ff'], ['red', '#b693ff'], [null, '#b693ff']]) {
    roster.groups[0].color = color;
    assert.equal(buildCatalog(roster, videos).idols[0].color, expected);
  }
});

test('chart range accepts the supported values and defaults to 100', () => {
  for (const value of [10, 50, 100]) {
    assert.equal(chartRange(value), value);
    assert.equal(chartRange(String(value)), value);
  }
  for (const value of [null, false, 'Infinity', '0', '-1', '9', 'x']) assert.equal(chartRange(value), 100);
});

test('Pop restores only its two own boolean autoplay flags', async () => {
  const { normalizeAutoplay } = await import('../pop/src/roulette.js');
  assert.deepEqual(normalizeAutoplay({ on: true, same: false, extra: true }), { on: true, same: false });
  assert.deepEqual(normalizeAutoplay({ on: 'true', same: 1 }), { on: false, same: false });
  assert.deepEqual(normalizeAutoplay(Object.create({ on: true })), { on: false, same: false });
  assert.deepEqual(normalizeAutoplay(null), { on: false, same: false });
});
