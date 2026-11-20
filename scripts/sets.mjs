// Builds data/sets.json by matching curated sets against each side's playable catalog.
// Usage: node scripts/sets.mjs [path/to/sets-source.json]

import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isVideoId } from '../src/validation.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCES = [
  resolve(ROOT, 'sets-source.json'),
  resolve(ROOT, 'data/sets-source.json'),
  'C:\\Users\\panig\\AppData\\Local\\Temp\\claude\\763ce1949dd1351e\\40d8aee1-a9f9-48e2-936b-7c238322547d\\scratchpad\\sets.json',
];

const fold = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '');

const alnum = (s) => fold(s).replace(/[^\p{L}\p{N}]+/gu, '');

const baseTitle = (s) => fold(s)
  .replace(/\([^)]*\)/g, ' ')
  .replace(/\[[^\]]*\]/g, ' ')
  .replace(/~[^~]*~/g, ' ')
  .replace(/\b(?:feat\.?|ft\.?|with)\b.*$/i, ' ')
  .replace(/\s+-\s+.*$/, ' ');

const ALIASES = new Map([
  ['gidle', 'idle'],
  ['txt', 'tomorrowxtogether'],
  ['snsd', 'girlsgeneration'],
  ['tvxq', 'dbsk'],
  ['suga', 'agustd'],
]);

function normArtist(name) {
  const k = alnum(name);
  return ALIASES.get(k) || k;
}

function splitArtists(raw) {
  return String(raw || '')
    .split(/\s*(?:,|&|\/|\bx\b|\bfeat\.?\b|\bft\.?\b|\bwith\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function artistMatches(queryArtist, candidateArtists) {
  const qParts = splitArtists(queryArtist).map(normArtist).filter(Boolean);
  const qWhole = normArtist(queryArtist);
  const cSet = new Set();
  for (const raw of candidateArtists) {
    for (const p of splitArtists(raw)) {
      const k = normArtist(p);
      if (k) cSet.add(k);
    }
    const whole = normArtist(raw);
    if (whole) cSet.add(whole);
  }
  if (qWhole && cSet.has(qWhole)) return true;
  for (const q of qParts) {
    if (cSet.has(q)) return true;
    for (const c of cSet) {
      if (q.length >= 4 && c.length >= 4 && (c.includes(q) || q.includes(c))) return true;
    }
  }
  return false;
}

async function readJson(filePath, optional = false) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (err) {
    if (optional) return null;
    throw err;
  }
}

async function resolveSourcePath() {
  if (process.argv[2]) return resolve(process.argv[2]);
  for (const candidate of DEFAULT_SOURCES) {
    try {
      await access(candidate);
      return candidate;
    } catch { /* try next */ }
  }
  throw new Error(`Could not find sets source JSON. Pass a path: node scripts/sets.mjs <path>`);
}

async function loadCatalogs() {
  // K-pop: data/videos.json ('ARTIST | Song' -> { id }) + data/charts.json (top/newbie)
  const kpop = [];
  const kpopSeen = new Set();
  const addKpop = (artist, title, id) => {
    if (!isVideoId(id) || kpopSeen.has(`${artist}|${title}|${id}`)) return;
    kpopSeen.add(`${artist}|${title}|${id}`);
    kpop.push({ id, title, artists: [artist] });
  };
  const videos = await readJson(resolve(ROOT, 'data/videos.json'), true);
  if (videos && typeof videos === 'object') {
    for (const [key, rec] of Object.entries(videos)) {
      const [artist, ...rest] = key.split('|');
      const title = rest.join('|').trim();
      const id = typeof rec === 'string' ? rec : rec?.id;
      if (artist && title) addKpop(artist.trim(), title, id);
    }
  }
  const charts = await readJson(resolve(ROOT, 'data/charts.json'), true);
  for (const list of [charts?.top, charts?.newbie]) {
    for (const s of list || []) addKpop(s.artist, s.title, s.videoId);
  }

  // Pop: pop/data/data.json (songs[] with id, t, by)
  const popData = await readJson(resolve(ROOT, 'pop/data/data.json'), true);
  const pop = (popData?.songs || [])
    .filter((s) => isVideoId(s.id))
    .map((s) => ({ id: s.id, title: s.t, artists: [s.by || ''] }));

  // Bollywood: bollywood/data/data.json (songs[] with id, t, singers[], stars[], film)
  const bollyData = await readJson(resolve(ROOT, 'bollywood/data/data.json'), true);
  const bollywood = (bollyData?.songs || [])
    .filter((s) => isVideoId(s.id))
    .map((s) => ({
      id: s.id,
      title: s.t,
      artists: [...(s.singers || []), ...(s.stars || []), s.film].filter(Boolean),
    }));

  // Anime: anime/data/catalog.json ({ songs: [{ title, artist, show, source, videos: [{ id }] }] })
  const animeData = await readJson(resolve(ROOT, 'anime/data/catalog.json'), true);
  const anime = (animeData?.songs || [])
    .map((s) => {
      const video = (s.videos || []).find((v) => isVideoId(v?.id));
      if (!video) return null;
      return {
        id: video.id,
        title: s.title,
        artists: [s.show, s.source, s.artist].filter(Boolean),
      };
    })
    .filter(Boolean);

  return { kpop, pop, bollywood, anime };
}

function matchSong(catalog, entry) {
  const qExact = alnum(entry.song);
  const qBase = alnum(baseTitle(entry.song));

  // 1. Exact folded title + artist/show match
  for (const c of catalog) {
    if (alnum(c.title) === qExact && artistMatches(entry.artist, c.artists)) return c;
  }
  // 2. Base folded title (without parens/feat) + artist/show match
  if (qBase) {
    for (const c of catalog) {
      const cBase = alnum(baseTitle(c.title));
      if ((cBase === qBase || alnum(c.title) === qBase || cBase === qExact) && artistMatches(entry.artist, c.artists)) {
        return c;
      }
    }
  }
  // 3. Substring title match (min 5 chars) + artist/show match
  if (qBase.length >= 5) {
    for (const c of catalog) {
      const cBase = alnum(baseTitle(c.title));
      if (cBase.length >= 5 && (cBase.includes(qBase) || qBase.includes(cBase)) && artistMatches(entry.artist, c.artists)) {
        return c;
      }
    }
  }
  // 4. Unique exact title match for anime/bollywood (handles EN/JP show names & singer credit differences)
  if ((entry.side === 'anime' || entry.side === 'bollywood') && qExact.length >= 5) {
    const hits = catalog.filter((c) => alnum(c.title) === qExact || (qBase.length >= 6 && alnum(baseTitle(c.title)) === qBase));
    const uniqueIds = new Set(hits.map((h) => h.id));
    if (uniqueIds.size === 1) return hits[0];
  }
  return null;
}

async function main() {
  const sourcePath = await resolveSourcePath();
  const source = await readJson(sourcePath);
  if (!Array.isArray(source?.sets)) throw new Error('Source JSON must contain a sets[] array');

  const catalogs = await loadCatalogs();
  const kept = [];
  const droppedSets = [];
  const droppedSongs = [];

  for (const set of source.sets) {
    const items = [];
    const seen = new Set();
    for (const song of set.songs || []) {
      const catalog = catalogs[song.side];
      const hit = catalog ? matchSong(catalog, song) : null;
      if (!hit) {
        droppedSongs.push({ set: set.id, side: song.side, artist: song.artist, song: song.song });
        continue;
      }
      const key = `${song.side}:${hit.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ side: song.side, id: hit.id });
    }

    const isBridge = set.side === 'bridge';
    const distinctSides = new Set(items.map((i) => i.side)).size;
    const pass = isBridge ? (items.length >= 6 && distinctSides >= 3) : items.length >= 5;

    if (pass) {
      kept.push({
        id: set.id,
        side: set.side,
        name: set.name,
        blurb: set.blurb,
        items,
      });
    } else {
      droppedSets.push({
        id: set.id,
        side: set.side,
        matched: `${items.length}/${(set.songs || []).length}`,
        sides: distinctSides,
        reason: isBridge ? 'need >=6 across >=3 sides' : 'need >=5 matched',
      });
    }
  }

  const outPath = resolve(ROOT, 'data/sets.json');
  await writeFile(outPath, JSON.stringify({ sets: kept }, null, 2) + '\n', 'utf8');

  console.log(`Wrote ${kept.length}/${source.sets.length} sets to data/sets.json`);
  if (droppedSets.length) {
    console.log('\nDropped sets:');
    console.table(droppedSets);
  }
  if (droppedSongs.length) {
    console.log(`\nDropped songs (${droppedSongs.length}):`);
    console.table(droppedSongs);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
