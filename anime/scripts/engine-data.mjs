// Builds anime/data/data.json in the Pop engine's shape (see pop/data/data.json), so the
// Anime page can run on the Pop engine.
//   npm run data:anime-engine
//
// Wheel entries ("artists") are the shows (field `show`; add-on kinds that have no show use
// their `source`, e.g. the game or film an animated MV belongs to). Each song is one catalog
// song, played from its chosen `video`. Same playable rules as anime/scripts/runtime.mjs and
// anime/src/engine.js: a song needs at least one video; null entries in overrides.json drop a
// song; booted videos or videos with 3+ strikes in health.json are not used (the first healthy
// copy takes over, and a song with none left is dropped).
//
// o = rank by the chosen video's views, descending (ties keep catalog order).
// Power 1..10 by the show's total views: shows sorted ascending, cut into tenths of the shows
// (as Pop does): power = 1 + floor(10 * position / shows). Shows with equal totals share the
// middle position of their block.
// Song field `s` is omitted: there are no stream counts for anime.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (rel, fallback) => {
  try { return JSON.parse(await readFile(join(ROOT, rel), 'utf8')); } catch (e) { if (fallback !== undefined) return fallback; throw e; }
};

const [catalog, overrides, health] = await Promise.all([
  readJson('data/catalog.json'), readJson('data/overrides.json', {}), readJson('data/health.json', {}),
]);

const unhealthy = (v) => !!health[v.id]?.booted || (health[v.id]?.strikes?.length || 0) >= 3;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const songs = [];
const seen = new Set();
let dropped = 0;
for (const song of catalog.songs) {
  if (!song.videos?.length) continue;
  const key = `${song.artist} | ${song.title}`;
  if (Object.hasOwn(overrides, key) && overrides[key] === null) { dropped++; continue; }
  const copies = [song.video, ...song.videos].filter((v) => v && VIDEO_ID.test(v.id || ''));
  const video = copies.find((v) => !unhealthy(v));
  const show = song.show ?? song.source;
  if (!video || !show || seen.has(video.id)) { dropped++; continue; }
  seen.add(video.id);
  songs.push({
    id: video.id, t: song.title, by: song.artist, v: Number(video.views) || 0,
    show, use: song.use, year: song.year, latin: false, band: false,
  });
}

songs.forEach((s, i) => { s.i = i; });
songs.sort((a, b) => b.v - a.v || a.i - b.i);
songs.forEach((s, i) => { s.o = i + 1; delete s.i; });

const byShow = new Map();
for (const s of songs) {
  if (!byShow.has(s.show)) byShow.set(s.show, []);
  byShow.get(s.show).push(s);
}
const shows = [...byShow].map(([show, list]) => ({ show, list, total: list.reduce((t, s) => t + s.v, 0) }));
const asc = [...shows].sort((a, b) => a.total - b.total || a.show.localeCompare(b.show));
const n = asc.length;
const block = new Map();
asc.forEach((a, i) => { const b = block.get(a.total) || [i, i]; b[1] = i; block.set(a.total, b); });

const artists = shows.map(({ show, list, total }) => {
  const [lo, hi] = block.get(total);
  return {
    name: show, show, kind: 'show', latin: false, bands: [], main: true, bias: 0,
    nBand: 0, nSolo: list.length,
    songs: list.map((s) => s.id), // already ordered by o
    power: Math.min(10, 1 + Math.floor((10 * ((lo + hi) / 2)) / n)),
  };
});

await mkdir(join(ROOT, 'data'), { recursive: true });
await writeFile(join(ROOT, 'data/data.json'), JSON.stringify({
  updated: String(catalog.generated || '').slice(0, 10), scored: songs.length, artists, songs,
}));
if (!existsSync(join(ROOT, 'data/portraits.json'))) await writeFile(join(ROOT, 'data/portraits.json'), '{}');

const few = artists.filter((a) => a.songs.length < 3).length;
console.log(`anime: ${artists.length} shows, ${songs.length} songs, ${few} shows with <3 songs, ${dropped} dropped -> anime/data/data.json`);
