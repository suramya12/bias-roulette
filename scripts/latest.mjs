// Finds each act's newest official music video from its YouTube channel RSS feeds.
//
//   node scripts/latest.mjs [kpop|pop|both] [--fresh] [--asof YYYY-MM-DD]
//
// For every K-pop act (groups, shared sets, solo acts) and every Pop artist: take the
// channels that uploaded the act's existing videos, read their feeds (15 newest uploads
// each), and keep the newest upload that is an official MV, names the act, and was
// published on or before the as-of date. Writes data/latest.json (K-pop) and
// pop/data/latest.json (Pop). No yt-dlp needed. Pages are cached in .cache/latest/.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(root, '.cache', 'latest');
const args = process.argv.slice(2);
const FRESH = args.includes('--fresh');
const ASOF = args.includes('--asof') ? args[args.indexOf('--asof') + 1] : '2026-11-17';
const side = args.find((a) => ['kpop', 'pop', 'both'].includes(a)) || 'both';
const HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' };
const MAX_CHANNELS = 3;
const MAX_PROBES = 5; // videos opened per act to find its channels

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Requests start at least 300 ms apart, even when acts are processed in parallel.
let gateAt = 0;
async function gate() {
  const at = Math.max(Date.now(), gateAt);
  gateAt = at + 300;
  await sleep(at - Date.now());
}
const readJson = async (f, fallback) => {
  try { return JSON.parse(await readFile(path.join(root, f), 'utf8')); } catch { return fallback; }
};

// ---------- cached fetch ----------
async function get(url, { text = true } = {}) {
  await mkdir(CACHE, { recursive: true });
  const file = path.join(CACHE, createHash('sha1').update(url).digest('hex') + '.xml');
  if (!FRESH && existsSync(file)) {
    const body = await readFile(file, 'utf8');
    return body === '__404__' ? null : body;
  }
  for (let attempt = 0, wait = 2000; attempt < 6; attempt++, wait *= 2) {
    await gate();
    let res;
    try { res = await fetch(url, { headers: HEADERS }); } catch { await sleep(wait); continue; }
    if (res.status === 404) { await writeFile(file, '__404__'); return null; }
    if (res.status === 429 || res.status >= 500) { await sleep(wait); continue; }
    if (!res.ok) return null;
    const body = await res.text();
    await writeFile(file, body);
    return body;
  }
  return null;
}

// video id -> channel id. Watch pages are large, so only the id is kept.
const chanFile = path.join(CACHE, 'channels.json');
await mkdir(CACHE, { recursive: true });
const chanCache = existsSync(chanFile) ? JSON.parse(await readFile(chanFile, 'utf8')) : {};
let chanDirty = 0;
async function channelOf(videoId) {
  if (!FRESH && videoId in chanCache) return chanCache[videoId];
  let id = null;
  for (let attempt = 0, wait = 2000; attempt < 4; attempt++, wait *= 2) {
    await gate();
    try {
      const r = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: HEADERS });
      if (r.status === 429 || r.status >= 500) { await sleep(wait); continue; }
      const html = await r.text();
      id = (html.match(/"channelId":"(UC[\w-]{22})"/) || [])[1] || null;
      break;
    } catch { await sleep(wait); }
  }
  chanCache[videoId] = id;
  if (++chanDirty % 20 === 0) await writeFile(chanFile, JSON.stringify(chanCache));
  return id;
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

async function feedOf(channelId) {
  const xml = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (!xml) return { channel: '', items: [] };
  const channel = decode((xml.match(/<author>\s*<name>([^<]*)<\/name>/) || [])[1] || '');
  const items = [];
  for (const e of xml.split('<entry>').slice(1)) {
    const id = (e.match(/<yt:videoId>([\w-]{11})</) || [])[1];
    const title = decode((e.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
    const published = (e.match(/<published>([^<]*)</) || [])[1] || '';
    if (id && title && published) items.push({ id, title, published, channel });
  }
  return { channel, items };
}

// ---------- embed check (same as scripts/resolve.mjs) ----------
/** 'ok' | 'blocked' | 'unknown': can this video play in an embedded player? */
async function embedStatus(id) {
  try {
    const r = await fetch(`https://www.youtube.com/embed/${id}`, { headers: { Referer: 'https://example.com/', 'Accept-Language': 'en' } });
    const html = await r.text();
    const m = html.match(/previewPlayabilityStatus\\":{\\"status\\":\\"([A-Z_]+)\\"(?:,\\"playableInEmbed\\":(true|false))?/);
    if (m) return m[1] === 'OK' && m[2] !== 'false' ? 'ok' : 'blocked';
  } catch { /* fall through */ }
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
    if (r.status === 401 || r.status === 403 || r.status === 404) return 'blocked';
  } catch { /* ignore */ }
  return 'unknown';
}

// ---------- title rules ----------
const fold = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’‚‛′`´]/g, "'")
  .replace(/&/g, ' and ').replace(/\$/g, 's').toLowerCase();
const toks = (s) => fold(s).replace(/'/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const IS_MV = /official music video|official video|official m\/?v|(^|[\s(\[|\-])m\/?v(?![\p{L}\p{N}])|\(mv\)|\[mv\]/iu;
const REJECT = /\b(lyrics?|audio|visuali[sz]er|teasers?|trailers?|performance|live|en vivo|ao vivo|dance practice|behind|making|reaction|shorts?|expanded|remix|special clip|choreography|highlight)\b/i;
const REJECT_KO = /티저|가사|직캠|안무|연습|비하인드|하이라이트/;

/** Is this upload an official MV for an act whose existing song titles are `songTitles`? */
function isOfficialMv(title, songTitles) {
  if (!IS_MV.test(title)) return false;
  if (REJECT_KO.test(title)) return false;
  const f = fold(title);
  const m = f.match(REJECT);
  if (!m) return true;
  const w = m[1];
  // A remix MV is fine when the act's own songs are remixes; "(Live)" etc. never are.
  return w === 'remix' && songTitles.some((t) => fold(t).includes('remix'));
}

/**
 * How strongly `title` names the act (any alias; case- and accent-insensitive; whole words).
 * 0 = not at all, else the length of the longest alias found. `featOk`: the alias may be the featured act.
 */
function mentions(title, aliases, featOk = false) {
  const t = toks(title);
  const joined = ' ' + t.join(' ') + ' ';
  const sq = new Set(t);
  const f = fold(title);
  let best = 0;
  for (const a of aliases) {
    const at = toks(a);
    if (!at.length) continue;
    let hit = joined.includes(' ' + at.join(' ') + ' ') || sq.has(at.join(''));
    if (hit && !featOk) {
      // "Other - Song ft. Act": the act is only featured, so the MV is not theirs.
      const [head, ...rest] = f.split(/\s[-|]\s/);
      const n = fold(a);
      if (rest.length && !head.includes(n)) {
        const ft = rest.join(' - ').match(/\b(?:ft|feat|featuring)\b\.?\s(.*)/);
        if (ft && ft[1].includes(n)) hit = false;
      }
    }
    if (!hit && /[\u3131-\uD79D]/.test(a) && title.includes(a)) hit = true; // Hangul has no word boundaries
    if (hit) best = Math.max(best, a.length);
  }
  return best;
}

/** Korean names an act uses in its existing video titles (outside the quoted song title), e.g. "엔시티 127". */
function koreanAliases(titles) {
  const count = new Map();
  const generic = /뮤직비디오|공식|엠브이|뮤비|신곡|티저/g;
  for (const t of titles) {
    const outside = t.replace(/['"‘’“”][^'"‘’“”]*['"‘’“”]/g, ' ').replace(generic, ' ');
    for (const w of new Set(outside.match(/[\u3131-\uD79D]+(?: [\u3131-\uD79D\d]+)*/g) || [])) count.set(w, (count.get(w) || 0) + 1);
  }
  const need = Math.max(1, Math.ceil(titles.length / 2));
  return [...count].filter(([, n]) => n >= need).map(([w]) => w);
}

// ---------- same-song check ----------
const squash = (s) => fold(s).replace(/[^\p{L}\p{N}]+/gu, '');
/** Keys a song title stands for: the title without (...) tags, and each English name in brackets. */
function songKeys(t) {
  const keys = new Set();
  const plain = t.replace(/\s*[([][^)\]]*[)\]]/g, ' ');
  if (squash(plain)) keys.add(squash(plain));
  if (/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(plain)) for (const m of t.matchAll(/[([]([^)\]]*)[)\]]/g)) if (!/^(feat|ft|with|prod)/i.test(m[1].trim()) && squash(m[1]).length >= 3) keys.add(squash(m[1]));
  keys.add(squash(t));
  keys.delete('');
  return keys;
}
/** The song named in an MV title: the quoted part, else what follows "Artist - ". */
function songTitleKeys(title, names) {
  const t = title.replace(/[‘’“”]/g, (c) => (/[“”]/.test(c) ? '"' : "'"));
  const nameKeys = new Set(names.map(squash));
  const noFeat = t.replace(/\s+(?:ft\.?|feat\.?|featuring)\s[^-–—|]*/gi, ' ');
  const dq = noFeat.match(/(?:^|\s)"([^"]{1,80})"(?=$|[\s,|.!-])/) || noFeat.match(/(?:^|\s)'([^']{1,80})'(?=$|[\s,|.!-])/);
  if (dq) return [...songKeys(dq[1])];
  const segs = noFeat.split(/\s+[-–—]\s+/);
  let rest = segs.length > 1 ? segs.slice(1).join(' - ') : noFeat;
  rest = rest.replace(/\s*[([](?:official|4k|hd|mv|m\/v|music video|video|lyric)[^)\]]*[)\]]/gi, ' ');
  const parts = rest.split(/\s*[|:]\s+/).map((p) => p.trim()).filter((p) => p && !nameKeys.has(squash(p)));
  return [...songKeys(parts[0] || rest)];
}

/** How strongly a title names the act: every alias list in `act.need` must be found. 0 = no. */
const strength = (act, title) => {
  let sum = 0;
  for (const [i, list] of act.need.entries()) {
    const m = mentions(title, i === 0 ? [...list, ...koreanAliases(act.titles)] : list, act.featOk);
    if (!m) return 0;
    sum += m;
  }
  return sum;
};

/**
 * act: {name, need:[alias lists], videoIds (known videos, preferred first), usedIds:Set, songTitles, titles}
 * The act's qualifying uploads from its channels, newest first: [{...video, strength}].
 */
async function candidatesOf(act) {
  const channels = [];
  let probes = 0;
  for (const id of act.videoIds) {
    if (channels.length >= MAX_CHANNELS || probes >= MAX_PROBES) break;
    probes++;
    const c = await channelOf(id);
    if (c && !channels.includes(c)) channels.push(c);
  }
  const pool = [];
  for (const c of channels) pool.push(...(await feedOf(c)).items);
  const list = [];
  for (const v of pool) {
    if (v.published.slice(0, 10) > ASOF || !isOfficialMv(v.title, act.songTitles)) continue;
    const st = strength(act, v.title);
    if (st) list.push({ ...v, strength: st });
  }
  return list.sort((a, b) => b.published.localeCompare(a.published));
}

async function runSide(label, acts, outFile) {
  const out = {};
  const none = [], current = [], blocked = {}, failed = [];
  const cand = new Map();
  let i = 0;
  const queue = [...acts];
  const worker = async () => {
    while (queue.length) {
      const act = queue.shift();
      try { cand.set(act, await candidatesOf(act)); } catch (e) { failed.push(act.name); console.log(`  ! ${act.name}: ${e.message}`); }
      if (++i % 20 === 0) { console.log(`${label}: ${i}/${acts.length}`); await writeFile(chanFile, JSON.stringify(chanCache)); }
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  await writeFile(chanFile, JSON.stringify(chanCache));
  // A video that names several acts goes to the act it names most specifically (NCT DREAM's MV is not NCT 127's).
  const top = new Map();
  for (const list of cand.values()) for (const v of list) top.set(v.id, Math.max(top.get(v.id) || 0, v.strength));
  const P = (x) => ({ id: x.id, title: x.title, published: x.published.slice(0, 10), channel: x.channel });
  const prev = await readJson(outFile, {}); // a find that was already integrated stays in the file
  const duplicates = {};
  for (const act of acts) {
    if (!cand.has(act)) continue;
    const v = cand.get(act).find((c) => c.strength >= top.get(c.id));
    const same = v && songTitleKeys(v.title, act.need.flat()).find((k) => act.songs.some((s) => s.id !== v.id && s.keys.has(k)));
    if (!v) none.push(act.name);
    else if (same) duplicates[act.name] = { ...P(v), sameSongAs: act.songs.find((s) => s.id !== v.id && s.keys.has(same)).title };
    else if (prev[act.name]?.id === v.id) out[act.name] = P(v);
    else if (act.usedIds.has(v.id)) current.push(act.name);
    else if ((await embedStatus(v.id)) === 'blocked') blocked[act.name] = P(v);
    else out[act.name] = P(v);
  }
  const file = path.join(root, outFile);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ asOf: ASOF, ...out, _none: none, _current: current, _blocked: blocked, _duplicates: duplicates, _failed: failed }, null, 1));
  console.log(`${label}: ${acts.length} acts, ${Object.keys(out).length} new, ${current.length} up to date, ${none.length} none, ${Object.keys(blocked).length} embed-blocked, ${Object.keys(duplicates).length} same song already there, ${failed.length} failed -> ${outFile}`);
  for (const [a, d] of Object.entries(duplicates)) console.log(`  duplicate: ${a} | "${d.title}" is "${d.sameSongAs}"`);
}

// ---------- K-pop acts ----------
async function kpopActs() {
  const roster = await readJson('data/roster.json');
  const videos = await readJson('data/videos.json', {});
  const names = [];
  const add = (n) => { if (n && !names.includes(n)) names.push(n); };
  roster.groups.forEach((g) => add(g.act));
  Object.values(roster.sets || {}).forEach((s) => add(s.artist));
  roster.idols.forEach((i) => (i.solo || []).forEach((s) => s.songs.length && add(s.artist)));
  const groupNames = roster.groups.map((g) => g.act).filter((n) => n.length >= 3);
  return names.map((name) => {
    const own = Object.entries(videos).filter(([k]) => k.startsWith(name + ' | ')).map(([k, v]) => ({ title: k.slice(name.length + 3), v }));
    const feat = name.match(/^(.*?)\s+(?:feat\.?|ft\.?)\s+(.*)$/i);
    let need;
    if (feat) need = [[feat[1].trim()], [feat[2].trim()]]; // both names must be in the title
    else {
      const aliases = new Set([name]);
      if (/ - /.test(name)) { aliases.add(name.split(' - ').slice(1).join(' - ').trim()); aliases.delete(name); }
      // "V BTS", "KARINA aespa": their MVs are titled with the member's name alone.
      for (const g of groupNames) {
        if (name.startsWith(g + ' ')) aliases.add(name.slice(g.length + 1).trim());
        if (name.endsWith(' ' + g)) aliases.add(name.slice(0, -g.length - 1).trim());
      }
      need = [[...aliases]];
    }
    return {
      name, need, featOk: !!feat,
      videoIds: own.map((o) => o.v.id).reverse(),
      usedIds: new Set(own.map((o) => o.v.id)),
      songTitles: own.map((o) => o.title),
      songs: own.map((o) => ({ id: o.v.id, title: o.title, keys: songKeys(o.title) })),
      titles: own.map((o) => o.v.title || ''),
    };
  });
}

// ---------- Pop acts ----------
async function popActs() {
  const { ALL } = await import(pathToFileURL(path.join(root, 'pop/scripts/roster.mjs')).href);
  const data = await readJson('pop/data/data.json');
  const byAct = new Map();
  for (const s of data.songs) byAct.set(s.by, [...(byAct.get(s.by) || []), s]);
  const byId = new Map(data.songs.map((s) => [s.id, s]));
  const scored = await readJson('pop/.cache/matches.json', []);
  return ALL.map((r) => {
    const a = data.artists.find((x) => x.name === r.name);
    const wheel = a ? a.songs : [];
    const owned = [r.name, ...r.bands].flatMap((n) => byAct.get(n) || []).map((s) => s.id);
    const ids = [...new Set([...wheel, ...owned])];
    const songs = ids.map((id) => byId.get(id)).filter(Boolean);
    return {
      name: r.name, need: [[r.name]], // a soloist only gets an MV credited to the soloist, never the band's
      videoIds: ids,
      usedIds: new Set(wheel),
      songTitles: songs.map((s) => s.t),
      // for the same-song check: every song chart.mjs scored for the act, not only the kept ones
      songs: [...songs.map((s) => ({ id: s.id, t: s.t })), ...scored.filter((s) => s.by === r.name || r.bands.includes(s.by))]
        .map((s) => ({ id: s.id, title: s.t, keys: songKeys(s.t) })),
      titles: [],
    };
  });
}

if (side === 'kpop' || side === 'both') await runSide('K-pop', await kpopActs(), 'data/latest.json');
if (side === 'pop' || side === 'both') await runSide('Pop', await popActs(), 'pop/data/latest.json');
