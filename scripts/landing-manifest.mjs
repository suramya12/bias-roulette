// Writes data/landing.json: the hub card stats and nine thumbnail ids per side.
//   npm run landing
// The counts come from each side's engine data through pop/src/deck.js, the same rules the
// pages use, so the hub, the wheel ("All N idols are on the wheel") and the Collection agree.
import { readFile, writeFile } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import { DECKS, collectible } from '../pop/src/deck.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const format = new Intl.NumberFormat('en');
const count = (n, noun) => `${format.format(n)} ${noun}${n === 1 ? '' : 's'}`;
const validIds = (ids) => [...new Set(ids.filter((id) => typeof id === 'string' && /^[\w-]{11}$/.test(id)))];

const manifest = {};
for (const [side, deck] of Object.entries(DECKS)) {
  const data = await readJson(`${side}/data/data.json`);
  const { artists, songs } = collectible(data, deck.pool);
  const ids = validIds(songs.map((s) => s.id));
  if (ids.length < 9) throw new Error(`Need nine playable video IDs for ${side}`);
  const thumbnails = Array.from({ length: 9 }, () => ids.splice(randomInt(ids.length), 1)[0]);
  manifest[side] = { stats: [count(artists.length, deck.noun), count(songs.length, 'song')], thumbnails };
}

const json = JSON.stringify(manifest) + '\n';
const bytes = Buffer.byteLength(json);
if (bytes >= 5000) throw new Error(`Landing manifest is too large (${bytes} bytes)`);
await writeFile(new URL('../data/landing.json', import.meta.url), json);
console.log(`Wrote data/landing.json (${bytes} bytes).`);
