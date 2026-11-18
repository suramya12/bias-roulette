// Builds data/data.json: every roster act's songs (Spotify totals across versions, lead
// credits only) matched to an official MV (YouTube views), scored and ranked.
//   node scripts/chart.mjs [--fresh]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { safeFetch } from '../../scripts/safe-fetch.mjs';
import { escapeRegExp, requestHash } from '../../scripts/safe-text.mjs';
import { getText, decode, fold, key, cleanTitle, num, writeJSON, readJSON, sleep, CACHE } from './lib.mjs';
import { ROSTER, ALL, BIAS, BANDS, EXCLUDE, EXTRA_VIDEOS, BAD_VIDEOS } from './roster.mjs';

const K = 'https://kworb.net';
const nameKey = (s) => fold(s).replace(/[^a-z0-9]+/g, '');

// ---- 1. kworb directories: Spotify artist ids, YouTube artist slugs ----
const spIds = new Map();
for (const m of (await getText(`${K}/spotify/artists.html`)).matchAll(/artist\/([A-Za-z0-9]{22})_songs\.html">([^<]+)</g))
  if (!spIds.has(nameKey(decode(m[2])))) spIds.set(nameKey(decode(m[2])), m[1]);
const ytSlugs = new Map();
for (const m of (await getText(`${K}/youtube/archive.html`)).matchAll(/href="artist\/([^".]+)\.html">([^<]+)</g))
  ytSlugs.set(nameKey(decode(m[2])), m[1]);

// ---- 2. Acts: solo persons, groups and bands ----
const acts = [];
for (const r of ALL) acts.push({ name: r.name, spotify: r.spotify === false ? null : r.spotify || r.name, spid: r.spid, yt: r.yt, latin: r.latin, isBand: false });
for (const [name, o] of Object.entries(BANDS)) {
  const card = acts.find((a) => a.name === name); // a band that is also a group card (Fifth Harmony)
  if (card) card.isBand = true;
  else acts.push({ name, spotify: o.spotify || name, spid: o.spid, yt: o.yt, latin: false, isBand: true });
}
for (const r of ALL) for (const b of r.bands) if (r.latin) acts.find((a) => a.name === b).latin = true;
const allNames = new Set(ALL.map((r) => r.name));
for (const n of BIAS) if (!allNames.has(n)) throw new Error(`BIAS name not in roster: ${n}`);

const REJECT = /\b(audio|lyrics?|letra|visuali[sz]er|teaser|trailer|dance practice|practice|live|en vivo|ao vivo|fan ?made|reaction|8d|karaoke|instrumental|slowed|sped up|cover|shorts|rehearsal|behind the scenes|making of|concert|tour|vertical|color coded|acoustic|official audio|animated|dance video|choreography|commentary|interview|documentary|full album|mashup|stadium|anniversary|fan edition|weekends with|unplugged|mtv|grammys?|awards|festival|glastonbury|coachella|snl|tiny desk|tiktok|compilation|speed up|sessions?|coke studio|relief|premios?|vevo presents|acustic[oa]|stripped|asl)\b/;

const FEAT = /\s+(?:ft\.?|feat\.?|featuring)\s[^-–—|]*/gi;
/** Title keys a video could stand for. Quoted title wins; otherwise split on separators. */
function videoKeys(title, actNameKeys) {
  const t = title.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const bare = t.replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(FEAT, ' ');
  const q = bare.match(/(?:^|\s)['"]([^'"]{1,80})['"](?=$|[\s,|.!-])/);
  if (q) return [key(q[1])];
  const parts = bare.split(/\s*[-–—|:]\s+|\s+[-–—]|[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) return [key(parts[0])];
  const keys = parts.map((p) => key(p)).filter(Boolean);
  // A part that is just an act's name never stands for a song (unless the song shares it, checked by caller).
  return keys.filter((k) => !actNameKeys.has(k) || keys.length === 1);
}
function rejected(title, songKey) {
  let f = fold(title).replace(/official (music )?video|music video/g, '');
  for (const n of rejectNames) f = f.replace(n, ''); // "The Asteroids Galaxy Tour" is not a tour video
  const m = f.match(REJECT);
  return m && !songKey.includes(m[1].replace(/[^a-z0-9]/g, ''));
}

const allVideos = new Map(); // id -> {id, title, views}
const actNameKeys = new Set(acts.map((a) => key(a.name)));
const rejectNames = acts.map((a) => fold(a.name)).filter((n) => REJECT.test(n));
const missing = [];
for (const a of acts) {
  const id = a.spotify && (a.spid || spIds.get(nameKey(a.spotify)));
  const slug = a.yt || ytSlugs.get(nameKey(a.name)) || nameKey(a.name);
  if (!id) { if (a.spotify) missing.push(`spotify:${a.name}`); a.songs = []; } else {
    const html = (await getText(`${K}/spotify/artist/${id}_songs.html`)) || '';
    if (!html) missing.push(`spotify page:${a.name} (${id})`);
    const groups = new Map();
    for (const m of html.matchAll(/<td class="text"><div>(\* )?<a href="https:\/\/open\.spotify\.com\/track\/[^"]+"[^>]*>([^<]+)<\/a><\/div><\/td><td>([\d,]+)</g)) {
      if (m[1]) continue; // featured only: never credit to this act
      const title = decode(m[2]), k = key(title), s = num(m[3]);
      if (!k || EXCLUDE.has(`${a.name}|${k}`)) continue;
      const g = groups.get(k) || { k, title: cleanTitle(title), best: 0, s: 0 };
      g.s += s;
      if (s > g.best) { g.best = s; g.title = cleanTitle(title); }
      groups.set(k, g);
    }
    // 20M+ streams; smaller artists keep their 8 biggest songs (500K+) so they still get a wheel.
    const all = [...groups.values()].sort((x, y) => y.s - x.s);
    a.songs = all.filter((g, i) => g.s >= 20e6 || (i < 8 && g.s >= 5e5));
  }
  const yt = await getText(`${K}/youtube/artist/${slug}.html`);
  if (!yt) missing.push(`youtube:${a.name} (${slug})`);
  a.videos = [];
  for (const m of (yt || '').matchAll(/href="\.\.\/video\/([\w-]{11})\.html">([^<]+)<\/a><\/div><\/td><td>([\d,]+)</g)) {
    const v = { id: m[1], title: decode(m[2]), views: num(m[3]) };
    a.videos.push(v);
    if (!allVideos.has(v.id) || allVideos.get(v.id).views < v.views) allVideos.set(v.id, v);
  }
}
for (const m of (await getText(K + '/youtube/topvideos.html')).matchAll(/href="video\/([\w-]{11})\.html">([^<]+)<\/a><\/div><\/td><td>([\d,]+)</g))
  if (!allVideos.has(m[1])) allVideos.set(m[1], { id: m[1], title: decode(m[2]), views: num(m[3]) });
if (missing.length) console.warn('Missing pages:', missing.join(', '));

// ---- 3. Match each song to its MV ----
const vids = [...allVideos.values()];
function findVideo(a, g) {
  const extra = EXTRA_VIDEOS[`${a.name}|${g.k}`];
  if (extra) return allVideos.get(extra) || { id: extra, title: '(manual)', views: 0 };
  if (!a.pool) {
    const ak = fold(a.name).replace(/[^a-z0-9]+/g, '');
    a.pool = [...new Set([...a.videos, ...vids.filter((v) => (v.f ??= fold(v.title).replace(/[^a-z0-9]+/g, '')).includes(ak))])];
  }
  return pickBest(a.pool, g, a);
}
/** "Other Artist - Song ft. This Act": this act is only featured, so the MV is not theirs. */
function featured(title, a) {
  const t = fold(title), n = fold(a.name);
  const [head, ...rest] = t.split(/\s[-|]\s/);
  if (!rest.length || head.includes(n)) return false;
  const ft = rest.join(' - ').match(/\b(?:ft|feat|featuring)\b\.?\s(.*)/);
  return !!ft && ft[1].includes(n);
}
/** Best official MV for a song: verified channel first, then views. */
function pickBest(pool, g, a) {
  let best = null;
  const rank = (v) => (v.verified ? 1 : 0);
  for (const v of pool) {
    if (BAD_VIDEOS.has(v.id) || rejected(v.title, g.k) || featured(v.title, a)) continue;
    // A remix video is not the song's MV (unless the song is the remix).
    if (/\bremix\b/i.test(v.title) && !g.k.includes('remix')) continue;
    // Search hits with far fewer views than the song's streams are re-uploads, not the official MV.
    if (v.src === 'search' && v.views < Math.max(1e5, g.s / 500)) continue;
    if (!(v.keys ??= videoKeys(v.title, actNameKeys)).includes(g.k)) continue;
    if (!best || rank(v) > rank(best) || (rank(v) === rank(best) && v.views > best.views)) best = v;
  }
  return best;
}
/** Fallback for songs kworb has no MV for: YouTube search "<act> <song> official music video". */
function ytSearch(a, g) { return ytQuery(a, `${a.name} ${g.title} official music video`); }
async function ytQuery(a, query) {
  const q = encodeURIComponent(query);
  const html = await getText(`https://www.youtube.com/results?search_query=${q}&hl=en&gl=US`, { delay: 400 });
  const ak = fold(a.name).replace(/[^a-z0-9]+/g, '');
  const str = (re, s) => { const m = s.match(re); return m ? JSON.parse(`"${m[1]}"`) : ''; };
  const out = [];
  for (const chunk of (html || '').split('"videoRenderer":{"videoId":"').slice(1, 12)) {
    const head = chunk.split('"lengthText"')[0];
    const title = str(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/, chunk);
    const channel = str(/"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/, chunk);
    const views = num((chunk.match(/"viewCountText":\{"simpleText":"([\d,]+) views"/) || [])[1] || 0);
    if (!title || !views) continue;
    // Official uploads only: the artist's own channel or VEVO, never "- Topic" art tracks or fan channels,
    // and the title must name the artist (art tracks are titled with the song alone).
    const chk = fold(channel).replace(/[^a-z0-9]+/g, '');
    if (!chk.includes(ak) || / - topic$/i.test(channel) || /fan/.test(chk.replace(ak, ''))) continue; // "ArtistFans", "Artist Fanpage"
    if (!fold(title).replace(/[^a-z0-9]+/g, '').includes(ak)) continue;
    // The artist's own channel may title MVs "Artist - Song" with no "official".
    const own = [ak, ak + 'vevo', ak + 'official', 'official' + ak].includes(chk);
    if (!own && !/official|oficial|video|\bmv\b/i.test(title)) continue;
    if (/\b(parody|legendado|subtitulad[oa]|traducid[oa]|tradu[cç][aã]o|spoken word|tonight show|fallon|kimmel|snl|late show|bbc|vevo dscvr|vevo lift|1 hour|extended)\b/i.test(title)) continue;
    out.push({ id: chunk.slice(0, 11), title, views, channel, src: 'search', verified: /BADGE_STYLE_TYPE_VERIFIED/.test(head) || /BADGE_STYLE_TYPE_VERIFIED/.test(chunk.slice(0, 4000)) });
  }
  return out;
}

// Acts kworb has no Spotify page for: songs come from their official MVs alone (streams unknown, shown as —).
for (const a of acts.filter((x) => x.spotify && !x.songs.length)) {
  const ak = key(a.name);
  a.videos.push(...(await ytQuery(a, `${a.name} official music video`).catch(() => [])));
  const groups = new Map();
  for (const v of [...a.videos].sort((x, y) => y.views - x.views)) {
    const k = (v.keys ??= videoKeys(v.title, actNameKeys)).find((x) => x && x !== ak);
    if (!k || v.views < 150e3 || groups.has(k) || rejected(v.title, k) || EXCLUDE.has(`${a.name}|${k}`)) continue;
    const bare = v.title.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(FEAT, ' ');
    const q = bare.match(/(?:^|\s)['"]([^'"]{1,80})['"](?=$|[\s,|.!-])/);
    const part = q ? q[1] : bare.split(/\s*[-–—|:]\s+|\s+[-–—]|[-–—]\s+/).find((p) => key(p) === k);
    const named = (part || k).replace(new RegExp(`^\\s*${escapeRegExp(a.name)}\\s*[-–—:|]\\s*`, 'i'), ''); // "Artist-Song" with no spaces
    groups.set(k, { k, title: cleanTitle(named), s: 0, yt: true });
  }
  a.songs = [...groups.values()].slice(0, 8);
  console.log(`YouTube-only songs for ${a.name}: ${a.songs.map((g) => g.title).join(' / ') || 'none'}`);
}

const byVideo = new Map();
const unmatched = [];
// Search YouTube (6 at a time) for big songs kworb has no MV for.
const found = new Map();
const need = [];
for (const a of acts) for (const g of a.songs) {
  const v = findVideo(a, g);
  if (v) found.set(g, v); else if (g.s >= 300e6) need.push([a, g]);
}
// Acts with few kworb MVs (smaller or older artists): also search their next biggest songs.
for (const a of acts) {
  const have = a.songs.filter((g) => found.has(g)).length;
  if (have >= 6) continue;
  const more = a.songs.filter((g) => !found.has(g) && g.s < 300e6 && g.s >= 2e6).sort((x, y) => y.s - x.s).slice(0, 8 - have);
  for (const g of more) need.push([a, g]);
}
console.log(`searching YouTube for ${need.length} songs…`);
for (let i = 0; i < need.length; i += 6)
  await Promise.all(need.slice(i, i + 6).map(async ([a, g]) => {
    const v = pickBest(await ytSearch(a, g).catch(() => []), g, a);
    if (v) found.set(g, v);
  }));
for (const a of acts) for (const g of a.songs) {
  const v = found.get(g);
  if (!v) { if (g.s >= 1e9) unmatched.push(`${a.name}|${g.k}  "${g.title}"  ${(g.s / 1e9).toFixed(2)}B streams`); continue; }
  const song = { id: v.id, t: g.title, by: a.name, s: g.s, v: v.views, vt: v.title, ch: v.channel, src: v.src, ver: v.verified, latin: a.latin, band: a.isBand };
  const prev = byVideo.get(v.id);
  if (!prev) { byVideo.set(v.id, song); continue; }
  if (prev.by === a.name) { prev.s += song.s; continue; } // two Spotify keys, one song
  if (key(prev.t) !== key(song.t)) { // one video, two different songs: keep the bigger
    console.warn(`video ${v.id} claimed by "${prev.t}" and "${song.t}"`);
    if (song.s > prev.s) byVideo.set(v.id, song);
    continue;
  }
  // Same song credited to two acts (A & B): lead = the name that comes first in the MV title.
  const ft = fold(v.title), pos = (n) => { const i = ft.indexOf(fold(n)); return i < 0 ? 1e9 : i; };
  if (pos(a.name) < pos(prev.by)) byVideo.set(v.id, { ...song, s: Math.max(song.s, prev.s) });
  else prev.s = Math.max(prev.s, song.s);
}

// ---- 3b. Newest official MV per artist (data/latest.json, written by scripts/latest.mjs) ----
// Each one is always on its artist's wheel. A song kworb does not list gets streams 0 and its
// YouTube view count, like the YouTube-only songs above.
const latest = await readJSON('data/latest.json').catch(() => ({}));
async function ytViews(id) {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const file = `${CACHE}/${requestHash(url)}.txt`;
  if (existsSync(file)) return Number(await readFile(file, 'utf8'));
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(300 * (attempt + 1));
    try {
      const r = await safeFetch(url, {
        hosts: ['www.youtube.com'], headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' },
      });
      const n = num(((await r.text()).match(/"viewCount":"(\d+)"/) || [])[1] || 0);
      if (n) { await mkdir(CACHE, { recursive: true }); await writeFile(file, String(n)); return n; }
    } catch { /* try again */ }
  }
  return 0;
}
/** Song title out of an MV title: the quoted part, else what is left after the act name and "Official Music Video". */
function songTitleOf(title, names) {
  const t = title.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const bare = t.replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(FEAT, ' ');
  const dq = bare.match(/(?:^|\s)"([^"]{1,80})"(?=$|[\s,|.!-])/); // "Pa' Que Llorar": the apostrophe is not a quote
  if (dq) return cleanTitle(dq[1]);
  const q = bare.match(/(?:^|\s)['"]([^'"]{1,80})['"](?=$|[\s,|.!-])/);
  if (q) return cleanTitle(q[1]);
  const nameKeys = new Set(names.map((n) => key(n)));
  // "Artist, Other Artist - Song": the song is what follows the first spaced dash.
  const segs = bare.split(/\s+[-–—]\s+/);
  const rest = segs.length > 1 ? segs.slice(1).join(' - ') : bare;
  const parts = rest.split(/\s*[|:]\s+|\s+[-–—]|[-–—]\s+/).map((p) => p.trim()).filter(Boolean)
    .filter((p) => !nameKeys.has(key(p)) && !/^(official )?(music )?video$|^official mv$/i.test(p));
  return cleanTitle(parts[0] || rest.trim() || title);
}
const mustHave = new Map(); // artist name -> video id that has to be on the wheel
for (const r of ALL) {
  const l = latest[r.name];
  if (!l?.id) continue;
  const ft = fold(l.title);
  const by = r.name; // a soloist only gets an MV credited to the soloist, never the band's
  const prev = byVideo.get(l.id);
  // The same song under another video id is not added a second time.
  const t0 = songTitleOf(l.title, [r.name]);
  const twin0 = !prev && [...byVideo.values()].find((x) => x.id !== l.id && (x.by === by || (r.kind !== 'group' ? r.bands : []).includes(x.by)) && key(x.t) === key(t0));
  if (twin0) { console.warn(`latest MV ${l.id} "${t0}" (${r.name}) skipped: same song as ${twin0.id}`); continue; }
  mustHave.set(r.name, l.id);
  if (prev) { // already scored (or added for another act): it only needs its wheel place
    // A duet found for two acts is credited to the name that comes first in the MV title.
    const pos = (n) => { const i = ft.indexOf(fold(n)); return i < 0 ? 1e9 : i; };
    if (prev.fresh && prev.by !== by && pos(by) < pos(prev.by)) Object.assign(prev, { by, latin: acts.find((x) => x.name === by).latin, band: acts.find((x) => x.name === by).isBand });
    continue;
  }
  const a = acts.find((x) => x.name === by);
  const views = allVideos.get(l.id)?.views || (await ytViews(l.id));
  if (!views) console.warn(`no view count for latest MV ${l.id} (${r.name})`);
  const t = t0;
  byVideo.set(l.id, { id: l.id, t, by, s: 0, v: views, vt: l.title, ch: l.channel, src: 'latest', ver: false, latin: a.latin, band: a.isBand, fresh: true });
  console.log(`latest MV added: ${by} | ${t} | ${l.published} | ${l.id} | ${views} views`);
}

// ---- 4. Score, rank, and keep what the game needs ----
const songs = [...byVideo.values()];
for (const s of songs) s.score = (s.s + s.v) / 2;
songs.sort((x, y) => y.score - x.score);
songs.forEach((s, i) => (s.o = i + 1));

const actSongs = new Map(acts.map((a) => [a.name, []]));
for (const s of songs) actSongs.get(s.by).push(s);
const PER_ACT = 15;
const keep = new Set(songs.filter((s) => s.o <= 100).map((s) => s.id));
for (const list of actSongs.values()) list.slice(0, PER_ACT).forEach((s) => keep.add(s.id));
for (const id of mustHave.values()) keep.add(id);

const mainNames = new Set(ROSTER.map((r) => r.name));
const artists = ALL.map((r) => {
  const solo = r.kind === 'group' ? [] : actSongs.get(r.name);
  const band = r.kind === 'group' ? actSongs.get(r.name) : r.bands.flatMap((b) => actSongs.get(b));
  // The newest-MV songs (no streams) do not count towards Power.
  const weight = solo.filter((s) => !s.fresh).reduce((t, s) => t + s.score, 0) + band.filter((s) => !s.fresh).reduce((t, s) => t + s.score, 0) / (r.kind === 'group' ? 1 : 3);
  const pool = [...solo, ...band].filter((s) => keep.has(s.id)).sort((x, y) => x.o - y.o);
  let top = pool.slice(0, 12);
  const must = mustHave.get(r.name);
  // The newest MV always makes the wheel; on a full wheel it takes the lowest-scored song's place.
  if (must && !top.some((s) => s.id === must)) {
    top = [...pool.slice(0, 11), byVideo.get(must)].sort((x, y) => x.o - y.o);
    console.log(`wheel: ${r.name} lost "${pool[11]?.t ?? '(none, wheel not full)'}" for the newest MV`);
  }
  return { name: r.name, kind: r.kind, latin: r.latin, bands: r.bands, main: mainNames.has(r.name), bias: BIAS.indexOf(r.name) + 1, nBand: band.length, nSolo: solo.length, weight, songs: top.map((s) => s.id) };
});
// Power 1-10 by rank: each step is a tenth of the artists (10 = top 10%).
const order = [...artists].sort((x, y) => x.weight - y.weight);
order.forEach((a, i) => { a.power = Math.min(10, 1 + Math.floor((10 * i) / order.length)); });
artists.forEach((a) => delete a.weight);

const out = songs.filter((s) => keep.has(s.id)).map(({ id, t, by, s, v, o, latin, band }) => ({ id, t, by, s, v, o, latin, band }));
await writeJSON('.cache/matches.json', songs.map(({ id, t, by, o, vt, ch, src, ver, v }) => ({ o, id, t, by, vt, ch, src, ver, v })));
const file = await writeJSON('data/data.json', { updated: new Date().toISOString().slice(0, 10), scored: songs.length, artists, songs: out });

console.log(`${songs.length} songs scored, ${out.length} kept, ${artists.length} artists -> ${file}`);
const empty = artists.filter((a) => a.songs.length < 3).map((a) => `${a.name}(${a.songs.length})`);
if (empty.length) console.warn('Artists with < 3 songs:', empty.join(', '));
if (unmatched.length) console.warn(`\nBig songs without an MV (add to EXTRA_VIDEOS):\n  ${unmatched.join('\n  ')}`);
