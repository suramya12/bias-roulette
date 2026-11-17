import { readFile, writeFile } from 'node:fs/promises';
import { randomInt } from 'node:crypto';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const [charts, roster, pop, anime] = await Promise.all([
  readJson('data/charts.json'), readJson('data/roster.json'),
  readJson('pop/data/data.json'), readJson('anime/data/catalog.json'),
]);

const format = new Intl.NumberFormat('en');
const count = (n, noun) => `${format.format(n)} ${noun}${n === 1 ? '' : 's'}`;
const validIds = (ids) => [...new Set(ids.filter((id) => typeof id === 'string' && /^[\w-]{11}$/.test(id)))];
const animeIds = validIds(anime.songs.flatMap((song) => song.videos.map((video) => video.id)));

const sides = {
  kpop: {
    stats: [count(charts.top.length, 'chart song'), count(roster.idols.length, 'idol')],
    ids: validIds([...charts.top, ...charts.newbie].map((song) => song.videoId)),
  },
  pop: {
    stats: [count(pop.songs.length, 'song'), count(pop.artists.filter((artist) => artist.songs.length).length, 'artist')],
    ids: validIds(pop.songs.map((song) => song.id)),
  },
  anime: {
    stats: [count(anime.songs.filter((song) => song.videos.length).length, 'song'), count(animeIds.length, 'video')],
    ids: animeIds,
  },
};

const manifest = {};
for (const [side, { stats, ids }] of Object.entries(sides)) {
  if (ids.length < 9) throw new Error(`Need nine playable video IDs for ${side}`);
  const thumbnails = Array.from({ length: 9 }, () => ids.splice(randomInt(ids.length), 1)[0]);
  manifest[side] = { stats, thumbnails };
}

const json = JSON.stringify(manifest) + '\n';
const bytes = Buffer.byteLength(json);
if (bytes >= 5000) throw new Error(`Landing manifest is too large (${bytes} bytes)`);
await writeFile(new URL('../data/landing.json', import.meta.url), json);
console.log(`Wrote data/landing.json (${bytes} bytes).`);
