// Builds kpop/data/data.json + kpop/data/portraits.json in the Pop engine's shape
// (see pop/data/data.json), so the K-pop page can run on the Pop engine.
//   npm run data:kpop
//
// Wheel entries ("artists") are the idols. Each idol's songs are exactly what the K-pop
// roulette plays: idolSongs() from src/catalog.js (group songs, shared sets, solo songs)
// joined with data/videos.json (what src/main.js loads, via video-ids.json). Songs without a
// resolved video are left out; the roulette honours no other exclusion file (dropped songs and
// null overrides are already absent from videos.json), and neither do we.
//
// Song ranks: the 100 songs of data/charts.json "top" get o = overall (1..100), so
// G.top100(songs) returns the chart list. Every other song gets o >= 101: songs that appear
// in charts.json "newbie" (they carry streams and views) first, by score, then the rest in
// roster order. s and v are set only where charts.json has them; otherwise they are omitted.
//
// Power 1..10 (rule): a group's chart strength = sum of the chart score (streams+views)/2 of
// its group songs found in charts.json top/newbie (by video id, plus top entries whose artist
// is the group's act name). Idols inherit their group's strength. Groups are ranked by strength
// and cut into tenths of the idols, as Pop does: power = 1 + floor(10 * position / idols).
// Idols of one group share a block, so they all get the power of the block's middle.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { idolSongs } from '../src/catalog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = async (rel) => JSON.parse(await readFile(join(ROOT, rel), 'utf8'));
const write = async (rel, data) => {
  await mkdir(dirname(join(ROOT, rel)), { recursive: true });
  await writeFile(join(ROOT, rel), JSON.stringify(data));
};

const [roster, videos, charts, portraits] = await Promise.all([
  read('data/roster.json'), read('data/videos.json'), read('data/charts.json'), read('data/portraits.json'),
]);

const fold = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const chartKey = (artist, title) => `${fold(artist)}|${fold(title)}`;

// ---- chart lookups ----
const topById = new Map(charts.top.map((e) => [e.videoId, e]));
const topByKey = new Map(charts.top.map((e) => [chartKey(e.artist, e.title), e]));
const newbieById = new Map(charts.newbie.filter((e) => !topById.has(e.videoId)).map((e) => [e.videoId, e]));

// ---- one record per distinct video id ----
const songs = new Map(); // id -> song (o assigned below)
const order = []; // first-seen order, for tie-breaks
const swapped = new Set(); // roster videos replaced by the chart's id for the same song
function touch(id, artist, title) {
  if (songs.has(id)) return songs.get(id);
  const top = topById.get(id);
  const nb = newbieById.get(id);
  const src = top || nb;
  const s = { id, t: src ? src.title : title, by: src ? src.artist : artist };
  if (src) { s.s = src.streams; s.v = src.views; }
  if (top) s.o = top.overall;
  s.latin = false;
  s.band = false;
  songs.set(id, s);
  order.push(s);
  return s;
}
// The whole chart list is always present, even where roster videos differ or are missing.
for (const e of charts.top) touch(e.videoId, e.artist, e.title);

const groupOf = new Map(roster.groups.map((g) => [g.id, g]));
const artists = [];
const skipped = [];
const groupSongIds = new Map(); // group id -> Set of video ids of its own songs
for (const idol of roster.idols) {
  const g = groupOf.get(idol.group);
  const list = [];
  const seen = new Set();
  let nBand = 0;
  let nSolo = 0;
  for (const item of idolSongs(roster, idol)) {
    let id = videos[item.key]?.id;
    if (!id) continue;
    const topHit = topByKey.get(chartKey(item.artist, item.title));
    if (topHit && topHit.videoId !== id) { swapped.add(`${item.key}: ${id} -> ${topHit.videoId}`); id = topHit.videoId; }
    if (seen.has(id)) continue;
    seen.add(id);
    const s = touch(id, item.artist, item.title);
    const isBand = item.artist === g.act || (idol.also || []).some((sid) => roster.sets[sid].artist === item.artist);
    if (isBand) { nBand++; s.band = true; } else nSolo++;
    list.push(s);
    if (item.artist === g.act) {
      if (!groupSongIds.has(g.id)) groupSongIds.set(g.id, new Set());
      groupSongIds.get(g.id).add(id);
    }
  }
  if (!list.length) { skipped.push(idol.name); continue; }
  artists.push({ idol, g, list, nBand, nSolo });
}

// ---- overall rank for everything that is not in the chart top ----
const rest = order.filter((s) => s.o === undefined);
const scoreOf = (s) => (s.s !== undefined ? (s.s + s.v) / 2 : -1);
const pos = new Map(order.map((s, i) => [s.id, i]));
rest.sort((a, b) => scoreOf(b) - scoreOf(a) || pos.get(a.id) - pos.get(b.id));
rest.forEach((s, i) => { s.o = 101 + i; });

// ---- power by group chart strength ----
const chartScore = (id) => {
  const e = topById.get(id) || newbieById.get(id);
  return e ? (e.streams + e.views) / 2 : 0;
};
const strength = new Map();
for (const g of roster.groups) {
  const ids = new Set(groupSongIds.get(g.id) || []);
  for (const e of charts.top) if (fold(e.artist) === fold(g.act)) ids.add(e.videoId);
  strength.set(g.id, [...ids].reduce((t, id) => t + chartScore(id), 0));
}
const byStrength = [...artists].sort((a, b) => strength.get(a.g.id) - strength.get(b.g.id) || a.g.id.localeCompare(b.g.id));
const n = byStrength.length;
const block = new Map(); // group id -> [first, last] position
byStrength.forEach((a, i) => { const b = block.get(a.g.id) || [i, i]; b[1] = i; block.set(a.g.id, b); });
const powerOf = (gid) => { const [lo, hi] = block.get(gid); return Math.min(10, 1 + Math.floor((10 * ((lo + hi) / 2)) / n)); };

const out = artists.map(({ idol, g, list, nBand, nSolo }) => ({
  name: idol.name,
  group: g.label,
  color: g.color,
  kind: 'person',
  latin: false,
  bands: [g.label],
  main: true,
  bias: 0,
  nBand,
  nSolo,
  songs: [...list].sort((a, b) => a.o - b.o).map((s) => s.id),
  power: powerOf(g.id),
}));

// Only songs that something plays, plus the whole chart list.
const used = new Set(charts.top.map((e) => e.videoId));
for (const a of out) for (const id of a.songs) used.add(id);
const songList = order.filter((s) => used.has(s.id)).sort((a, b) => a.o - b.o);

await write('kpop/data/data.json', { updated: charts.updated, scored: songList.length, artists: out, songs: songList });

// ---- portraits: kpop {src,page,file,author,license,article} -> pop {img,file,page,author,license} ----
const popPortraits = {};
for (const [name, p] of Object.entries(portraits)) {
  if (!p?.src) continue;
  const fileUrl = String(p.file || '');
  const base = decodeURIComponent(fileUrl.split('/').pop() || '').replace(/_/g, ' ');
  popPortraits[name] = {
    img: p.src.split('?')[0],
    file: base.startsWith('File:') ? base : `File:${base}`,
    page: fileUrl,
    author: p.author,
    license: p.license,
  };
}
await write('kpop/data/portraits.json', popPortraits);

const few = out.filter((a) => a.songs.length < 3).map((a) => `${a.name}(${a.songs.length})`);
console.log(`kpop: ${out.length} idols, ${songList.length} songs, ${Object.keys(popPortraits).length} portraits -> kpop/data/`);
if (skipped.length) console.log(`skipped idols with no songs: ${skipped.join(', ')}`);
if (few.length) console.log(`idols with <3 songs: ${few.join(', ')}`);
if (swapped.size) console.log(`roster video replaced by chart video for the same song (${swapped.size}):\n  ${[...swapped].join('\n  ')}`);
