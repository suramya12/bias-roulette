// Resolves every song in data/roster.json to one YouTube video ID.
//
//   node scripts/resolve.mjs                 resolve new songs only (cached ones are kept)
//   node scripts/resolve.mjs --refresh       search everything again
//   node scripts/resolve.mjs --retry-dropped search dropped songs again
//   node scripts/resolve.mjs --recheck-flagged  search flagged matches again
//   node scripts/resolve.mjs --only "IVE"    limit to keys containing the text
//
// Uses yt-dlp when installed, with a paced YouTube page fallback.
// Manual fixes live in data/overrides.json and always win.

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractInitialData, playability, videosFromSearch } from '../anime/scripts/lib.mjs';
import { createPageLoader } from '../anime/scripts/resolve.mjs';
import { allSongs } from '../src/catalog.js';
import { isVideoId } from '../src/validation.js';
import { MAX_BYTES, TIMEOUT_MS, safeFetch } from './safe-fetch.mjs';
import { escapeMarkdown as esc } from './safe-text.mjs';
import { writeVideoIds } from './video-ids.mjs';

const hosts = ['www.youtube.com'];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (f) => path.join(root, f);
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].toLowerCase() : null;
const CONCURRENCY = 5;

const readJson = async (f, fallback) => {
  try { return JSON.parse(await readFile(P(f), 'utf8')); } catch { return fallback; }
};

// ---------- text matching ----------
const strip = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = (s) => strip(s).replace(/['’`]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const squash = (s) => tokens(s).join('');

function titleMatches(song, videoTitle) {
  const a = tokens(song);
  const b = tokens(videoTitle);
  if (!a.length) return false;
  for (let i = 0; i + a.length <= b.length; i++) {
    if (a.every((t, j) => b[i + j] === t)) return true;
  }
  const sq = a.join('');
  if (b.includes(sq) || (sq.length >= 5 && b.join('').includes(sq))) return true;
  // "The fifth season (SSFWL)" should match on its main part too
  const main = song.replace(/\([^)]*\)/g, ' ').trim();
  return main !== song && tokens(main).length >= 2 && titleMatches(main, videoTitle);
}

const REJECT = /\b(audio|lyrics?|visuali[sz]er|track video|reaction|react|cover|fancam|fan ?cam|teaser|trailer|behind|making|practice|karaoke|instrumental|inst|sped up|slowed|nightcore|1 ?hour|fan ?made|fmv|line distribution|colou?r ?coded|medley|preview|concept|eng sub|han\/rom|romanized|mashup|remix|8d|bass boosted|live|stage|showcase|comeback show|inkigayo|music bank|m ?countdown|music core|show champion|shorts|dance break|relay dance|choreography|compilation|playlist|full album|ranking|explained|review|tutorial|mirrored|vlog|interview|encore|concert|tour|fan ?meeting|recording|jacket|unboxing|commentary|sketch|challenge|parody|ai cover|mr removed|studio choom|be original|it's live|dingo|killing voice)\b/i;
const REJECT_KO = /직캠|(^|[\s\[(])가사|티저|안무|연습|응원법|리액션|커버|교차편집|무대/;
const MV_MARK = /\bm\/?v\b|music video|official video|performance video|performance ver|special video|special clip|뮤직비디오/i;
const ALT_VER = /japanese|jp ver|chinese ver|english ver|\bver\b|version|dance ver|performance/i;
const LABELS = ['hybelabels', 'bighitlabels', 'smtown', 'jypentertainment', 'ygentertainment', '1thek', 'stonemusicentertainment',
  'starshiptv', 'starship', 'unitedcube', 'cubeentertainment', 'kqentertainment', 'pledis', 'wmentertainment', 'fncent',
  'rbw', 'geniemusic', 'woollim', 'fantagio', 'dspmedia', 'topmedia', 'theblacklabel', 'aomgofficial', 'h1ghrmusic',
  'pnation', 'abysscompany', 'konnectentertainment', 'swingentertainment', 'mnhentertainment', 'kozentertainment',
  'labelsj', 'beliftlab', 'sourcemusic', 'braveentertainment', 'warnermusickorea', 'sonymusickorea', 'universalmusic',
  'blockberrycreative', 'modhaus', 'ador', 'yuehuaentertainment', 'jelliment', 'jellyfishentertainment', 'sevenseasons',
  'edam', 'loenent', 'kakaoentertainment', 'bangtantv', 'cjenmmusic', 'mnetkpop_no', 'interscope', 'atlanticrecords',
  'lloud', 'bpmentertainment', 'bigplanetmade', 'thel1ve', 'oddatelier', 'blissoo', 'morevision', 'attrakt', 'ist', 'playm', 'happyfaceentertainment', 'dreamcatchercompany'];

const BROADCAST = /mnet|kbs|mbc|sbs|mtv|arirang|jtbc|tvn|zjstv|kpopchannel|allthekpop|thechoom|studiochoom|vevolive|billboard|grammy|genius/;

function judge(song, c, index) {
  const title = c.title || '';
  const chan = c.channel || c.uploader || '';
  const rest = strip(title).replace(strip(song.title), ' ');
  const reject = REJECT.test(rest) || REJECT_KO.test(title) || / - topic$/i.test(chan);
  const dur = c.duration || 0;
  const badLength = dur && (dur < 90 || dur > 600);
  const match = titleMatches(song.title, title);
  const marker = MV_MARK.test(title);
  const chanSq = squash(chan);
  const artistTok = tokens(song.artist).filter((t) => t.length >= 3);
  const official = !!c.channel_is_verified || LABELS.some((l) => chanSq.includes(l)) ||
    artistTok.some((t) => chanSq.includes(t)) || /official/i.test(chan);
  const alt = ALT_VER.test(rest) && !/official (m\/?v|music video)/i.test(title);
  // Without "MV" in the title it must still name the artist: a bare song title on an
  // artist channel is an auto-generated audio track, and TV channels post stage clips.
  const titleTok = tokens(title);
  const namesArtist = tokens(song.artist).some((t) => t.length >= 2 && titleTok.includes(t));
  const broadcaster = BROADCAST.test(chanSq);
  const qualifies = !reject && !badLength && !(broadcaster && !marker) &&
    ((match && marker) || (match && official && namesArtist) || (official && marker));
  const score = (match ? 5 : 0) + (marker ? 4 : 0) + (official ? 4 : 0) + (c.channel_is_verified ? 1 : 0) -
    (alt ? 3 : 0) + (8 - index) * 0.3 + Math.log10((c.view_count || 1) + 1) * 0.3;
  const flags = [];
  if (!match) flags.push('title mismatch');
  if (!official) flags.push('unofficial channel');
  if (!marker) flags.push('no MV marker in title');
  if (alt) flags.push('alternate version');
  return { qualifies, score, flags, title, channel: chan, id: c.id, verified: !!c.channel_is_verified };
}

// ---------- network ----------
function ytSearch(query, n = 8) {
  return new Promise((resolve) => {
    execFile('python', ['-m', 'yt_dlp', `ytsearch${n}:${query}`, '--flat-playlist', '-J', '--no-warnings'], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BYTES,
    }, (error, stdout, stderr) => {
      if (error?.killed || error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve({ error: error.message });
      try { resolve({ entries: JSON.parse(stdout).entries || [] }); }
      catch { resolve({ error: stderr.trim().split('\n').pop() || error?.message || 'yt-dlp returned no data' }); }
    });
  });
}

function hasYtDlp() {
  return new Promise((resolve) => {
    execFile('python', ['-m', 'yt_dlp', '--version'], { timeout: TIMEOUT_MS }, (error) => resolve(!error));
  });
}

const loadPage = createPageLoader({
  cacheDir: P('.cache/resolve'),
  refresh: flag('--refresh') || flag('--retry-dropped') || flag('--recheck-flagged'),
  fetchImpl: (url, { headers }) => safeFetch(url, { hosts, headers }),
});

async function pageSearch(query) {
  try {
    const html = await loadPage(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
    const entries = videosFromSearch(extractInitialData(html)).filter(({ id }) => isVideoId(id)).slice(0, 8)
      .map((video) => ({
        ...video, duration: video.seconds, view_count: video.views,
        channel_is_verified: video.verified || video.officialArtist,
      }));
    return { entries };
  } catch (error) {
    return { error: error.message };
  }
}

/** 'ok' | 'blocked' | 'unknown' — can this video play in an embedded player? */
async function embedStatus(id) {
  try {
    const r = await safeFetch(`https://www.youtube.com/embed/${id}`, { hosts, headers: { Referer: 'https://example.com/', 'Accept-Language': 'en' } });
    const html = await r.text();
    const m = html.match(/previewPlayabilityStatus\\":\{\\"status\\":\\"([A-Z_]+)\\"(?:,\\"playableInEmbed\\":(true|false))?/);
    if (m) return m[1] === 'OK' && m[2] !== 'false' ? 'ok' : 'blocked';
  } catch { /* fall through */ }
  try {
    const r = await safeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, { hosts });
    if (r.status === 401 || r.status === 403 || r.status === 404) return 'blocked';
  } catch { /* ignore */ }
  return 'unknown';
}

async function watchEmbedStatus(id) {
  const html = await loadPage(`https://www.youtube.com/watch?v=${id}`);
  const { status, embed, reason } = playability(html);
  if (/captcha|challenge|unusual traffic|confirm you.re not a bot|consent/i.test(reason)) throw new Error(reason);
  if (status === 'UNKNOWN' || (status === 'OK' && embed === null)) return 'unknown';
  return status === 'OK' && embed === true ? 'ok' : 'blocked';
}

async function oembed(id) {
  try {
    const r = await safeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, { hosts });
    if (r.ok) { const j = await r.json(); return { title: j.title, channel: j.author_name }; }
  } catch { /* ignore */ }
  return {};
}

const parseId = (v) => (String(v).match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/) || String(v).match(/^([\w-]{11})$/) || [])[1];

// ---------- per-song work ----------
function namesAct(candidate, artist) {
  const name = tokens(artist);
  return [candidate.title, candidate.channel].some((text) => {
    const words = tokens(text || '');
    return words.includes(name.join('')) || words.some((_, i) => name.every((word, j) => word === words[i + j]));
  });
}

async function resolveSong(song, { search, checkEmbed, requireEvidence }) {
  const rank = (r) => r.entries.map((entry, index) => {
    if (!entry?.id || (requireEvidence && !namesAct(entry, song.artist))) return null;
    return judge(song, entry, index);
  }).filter((j) => j?.qualifies).sort((a, b) => b.score - a.score);
  // Try a few phrasings: some queries come back empty or only with fan uploads.
  let res = null;
  let ranked = [];
  let lastError = 'search returned nothing';
  for (const q of [`${song.artist} ${song.title} MV`, `${song.artist} ${song.title} official music video`, `${song.artist} ${song.title}`]) {
    if (res && q.endsWith(song.title)) break; // the bare query is only for searches that came back empty
    const r = await search(q);
    if (r.error) { lastError = r.error; continue; }
    if (!r.entries.length) continue;
    const got = rank(r);
    if (!res || (got.length && (!ranked.length || got[0].flags.length < ranked[0].flags.length))) { res = r; ranked = got; }
    if (ranked.length && !ranked[0].flags.length) break;
  }
  if (!res) return { error: lastError };
  if (!ranked.length) {
    const top = res.entries[0];
    return { drop: 'no qualifying music video found' + (top ? ` (top result: "${top.title}" by ${top.channel})` : '') };
  }
  const blocked = [];
  let checkError;
  for (const cand of ranked.slice(0, 3)) {
    let st;
    try { st = await checkEmbed(cand.id); }
    catch (error) { checkError = error.message; continue; }
    if (st === 'blocked') { blocked.push(cand.id); continue; }
    if (st === 'unknown' && requireEvidence) { checkError = 'embed check inconclusive'; continue; }
    if (st === 'unknown') cand.flags.push('embed check inconclusive');
    return { video: { id: cand.id, title: cand.title, channel: cand.channel, verified: cand.verified, flags: cand.flags, source: 'search' } };
  }
  if (checkError) return { error: checkError };
  return { drop: `embedding disabled or unavailable (${blocked.map((b) => 'https://youtu.be/' + b).join(', ')})` };
}

async function resolveOverride(key, value) {
  const id = parseId(value);
  if (!id) return { drop: `override value "${value}" is not a YouTube URL or ID` };
  const [meta, st] = await Promise.all([oembed(id), embedStatus(id)]);
  const flags = [];
  if (st === 'blocked') flags.push('EMBEDDING BLOCKED - will show the Watch on YouTube link');
  return { video: { id, title: meta.title || '(title unavailable)', channel: meta.channel || '', flags, source: 'override' } };
}

// ---------- main ----------
const roster = await readJson('data/roster.json');
const overrides = await readJson('data/overrides.json', {});
let videos = flag('--refresh') ? {} : await readJson('data/videos.json', {});
let dropped = flag('--refresh') || flag('--retry-dropped') ? {} : await readJson('data/dropped.json', {});
const songs = allSongs(roster);

// forget songs that left the roster
for (const k of Object.keys(videos)) if (!songs.has(k)) delete videos[k];
for (const k of Object.keys(dropped)) if (!songs.has(k)) delete dropped[k];

const todo = [];
for (const [key, song] of songs) {
  if (only && !key.toLowerCase().includes(only)) continue;
  if (Object.hasOwn(overrides, key)) {
    const value = overrides[key];
    const isDrop = value === null || value === 'drop';
    const unchanged = isDrop
      ? dropped[key] === 'dropped by hand in overrides.json'
      : videos[key]?.source === 'override' && videos[key].id === parseId(value);
    if (!unchanged || only || (flag('--recheck-flagged') && videos[key]?.flags.length)) todo.push([key, song, 'override']);
    continue;
  }
  if (videos[key]?.source === 'override') delete videos[key]; // override was removed
  if (flag('--recheck-flagged') && videos[key]?.flags.length) delete videos[key];
  if (videos[key] || dropped[key]) continue;
  todo.push([key, song, 'search']);
}

const save = async () => {
  await writeFile(P('data/videos.json'), JSON.stringify(videos, null, 1));
  await writeFile(P('data/dropped.json'), JSON.stringify(dropped, null, 1));
};

console.log(`${songs.size} songs in roster, ${todo.length} to resolve`);
const usePages = todo.some(([, , mode]) => mode === 'search') && !(await hasYtDlp());
const backend = usePages
  ? { search: pageSearch, checkEmbed: watchEmbedStatus, requireEvidence: true }
  : { search: ytSearch, checkEmbed: embedStatus };
if (usePages) console.log('yt-dlp unavailable; using paced YouTube page checks.');
let done = 0;
let errors = 0;
async function worker() {
  while (todo.length) {
    const [key, song, mode] = todo.shift();
    let r;
    if (mode === 'override') {
      const v = overrides[key];
      r = v === null || v === 'drop' ? { drop: 'dropped by hand in overrides.json' } : await resolveOverride(key, v);
    } else {
      r = await resolveSong(song, backend);
      if (r.error) r = await resolveSong(song, backend); // one retry
    }
    if (r.video) { videos[key] = r.video; delete dropped[key]; }
    else if (r.drop) { dropped[key] = r.drop; delete videos[key]; }
    else { errors++; console.log(`  ! ${key}: ${r.error}`); }
    if (++done % 25 === 0) { console.log(`  ${done} done, ${todo.length} left`); await save(); }
  }
}
await Promise.all(Array.from({ length: usePages ? 1 : CONCURRENCY }, worker));

// one video must not stand in for two different songs
const byId = new Map();
for (const [key, v] of Object.entries(videos)) byId.set(v.id, [...(byId.get(v.id) || []), key]);
for (const [id, keys] of byId) {
  if (keys.length < 2) continue;
  const bad = keys.filter((k) => videos[k].flags.includes('title mismatch') && videos[k].source !== 'override');
  for (const k of bad.length < keys.length ? bad : bad.slice(1)) {
    dropped[k] = `matched the same video as "${keys.find((x) => x !== k)}" (https://youtu.be/${id})`;
    delete videos[k];
  }
}
await save();
await writeVideoIds({ root, videos });

// ---------- reports ----------
const row = (key) => {
  const v = videos[key];
  const [artist, ...t] = key.split(' | ');
  const title = esc(v.title);
  const video = isVideoId(v.id) ? `[${title}](https://youtu.be/${v.id})` : title;
  return `| ${esc(artist)} | ${esc(t.join(' | '))} | ${video} | ${esc(v.channel)}${v.verified ? ' ✔' : ''} | ${esc(v.flags.join('; ')) || (v.source === 'override' ? 'manual override' : '')} |`;
};
const head = '| Artist | Song | Matched video | Channel (✔ = verified) | Flags |\n|---|---|---|---|---|';
const keys = Object.keys(videos).sort((a, b) => a.localeCompare(b));
const flagged = keys.filter((k) => videos[k].flags.length);
const review = [
  '# Video matches', '',
  `${keys.length} songs matched, ${flagged.length} flagged for a look, ${Object.keys(dropped).length} dropped (see DROPPED.md).`, '',
  'To fix a match: open `data/overrides.json`, add a line `"ARTIST | SONG": "youtube link or ID"` (use `null` to drop the song),',
  'then run `npm run resolve`. Overrides are never overwritten by a re-run.', '',
  `## Flagged (${flagged.length})`, '', head, ...flagged.map(row), '',
  `## All matches (${keys.length})`, '', head, ...keys.map(row), '',
].join('\n');
await writeFile(P('REVIEW.md'), review);

const dk = Object.keys(dropped).sort((a, b) => a.localeCompare(b));
await writeFile(P('DROPPED.md'), [
  '# Dropped songs', '',
  `${dk.length} songs are not in the game because no qualifying, embeddable music video was found.`,
  'To bring one back, add `"ARTIST | SONG": "youtube link"` to `data/overrides.json` and run `npm run resolve`.', '',
  '| Artist \\| Song | Reason |', '|---|---|', ...dk.map((k) => `| ${esc(k)} | ${esc(dropped[k])} |`), '',
].join('\n'));

console.log(`Done: ${keys.length} matched (${flagged.length} flagged), ${dk.length} dropped, ${errors} errors.`);
if (errors) console.log('Run again to retry the errors.');
