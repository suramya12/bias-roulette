// Data audit: run after rebuilding. Exits 1 if anything is wrong.
//   node scripts/audit.mjs
import { readJSON } from './lib.mjs';
import { ALL as ROSTER } from './roster.mjs';

const data = await readJSON('data/data.json');
const portraits = await readJSON('data/portraits.json');
const errors = [], notes = [];
const dupes = (list) => list.filter((x, i) => list.indexOf(x) !== i);

// Every video is one song, and every overall rank is one song.
const ids = data.songs.map((s) => s.id);
if (dupes(ids).length) errors.push(`video used for two songs: ${dupes(ids)}`);
if (dupes(data.songs.map((s) => s.o)).length) errors.push('two songs share an overall rank');
for (let o = 1; o <= 100; o++) if (!data.songs.some((s) => s.o === o)) errors.push(`Top 100 is missing rank ${o}`);

// No two cards share art: artist pictures are unique and never a song card's thumbnail.
const imgs = Object.entries(portraits).map(([, p]) => p.img);
if (dupes(imgs).length) errors.push(`artists share a picture: ${dupes(imgs)}`);
const songThumbs = new Set(ids.map((id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`));
for (const [n, p] of Object.entries(portraits)) if (songThumbs.has(p.img)) errors.push(`${n} uses a song card's art`);
for (const r of ROSTER) if (!portraits[r.name]) errors.push(`${r.name} has no picture`);
const frames = Object.entries(portraits).filter(([, p]) => p.mv).map(([n]) => n);
if (frames.length) notes.push(`MV-frame pictures (no free photo): ${frames.join(', ')}`);

// Stats: soloists are 0 / N; artist wheels never repeat a song; every song exists.
const byId = new Map(data.songs.map((s) => [s.id, s]));
for (const a of data.artists) {
  if (a.kind === 'person' && !a.bands.length && a.nBand) errors.push(`${a.name} is a soloist but has band songs`);
  if (dupes(a.songs).length) errors.push(`${a.name}'s wheel repeats a song`);
  for (const id of a.songs) if (!byId.has(id)) errors.push(`${a.name} lists unknown song ${id}`);
  if (!a.songs.length) (a.bias || a.main ? errors : notes).push(`${a.name} has no songs with an official MV, so cannot be on a wheel`);
  else if (a.songs.length < 3) notes.push(`${a.name} has only ${a.songs.length} songs on the wheel`);
  if (a.power < 1 || a.power > 10) errors.push(`${a.name} power ${a.power}`);
}

// The Bias Roulette list is complete, in order, and every main-roster artist is on the main wheel.
const biasCount = data.artists.filter((a) => a.bias).length;
if (biasCount !== 100) errors.push(`Bias list has ${biasCount} artists, expected 100`);
if (dupes(data.artists.filter((a) => a.bias).map((a) => a.bias)).length) errors.push('two bias artists share a position');
if (dupes(data.artists.map((a) => a.name)).length) errors.push(`artist listed twice: ${dupes(data.artists.map((a) => a.name))}`);

// Lead credit only: a song's artist must be a roster act or band that owns it.
const acts = new Set([...ROSTER.map((r) => r.name), ...ROSTER.flatMap((r) => r.bands)]);
for (const s of data.songs) if (!acts.has(s.by)) errors.push(`${s.t} credited to unknown act ${s.by}`);

console.log(`${data.songs.length} songs, ${data.artists.length} artists, ${Object.keys(portraits).length} pictures`);
for (const n of notes) console.log('note:', n);
for (const e of errors) console.error('ERROR:', e);
console.log(errors.length ? `${errors.length} problem(s)` : 'audit passed');
process.exitCode = errors.length ? 1 : 0;
