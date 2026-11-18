// Builds data/charts.json: the all-time K-pop Top 100 for the "Charts" mode.
//   npm run charts            (uses cached pages in .cache/kworb, fetches what is missing)
//   npm run charts -- --fresh (fetches every page again)
//
// Score = average of Spotify streams (all versions of the song) and the views of its
// official YouTube video. Both numbers come from kworb.net, which tracks them daily.
// The "New to K-pop" list is a hand-picked set of easy entry points (NEWBIE below),
// ranked by the same score.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { safeFetch } from './safe-fetch.mjs';
import { requestHash } from './safe-text.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, '.cache', 'kworb');
const fresh = process.argv.includes('--fresh');

// Acts and their Spotify artist ids (from kworb.net/spotify/artists.html).
// `names` are the spellings used in YouTube titles.
const ACTS = [
  ['BTS', '3Nrfpe0tUJi4K4DXYWgMUX', ['BTS', '방탄소년단']],
  ['BLACKPINK', '41MozSoPIsD1dJM0CLPjZF', ['BLACKPINK']],
  ['PSY', '2dd5mrQZvg6SmahdgVKDzh', ['PSY']],
  ['TWICE', '7n2Ycct7Beij7Dj7meI4X0', ['TWICE', '트와이스']],
  ['Stray Kids', '2dIgFjalVxs4ThymZ67YCE', ['Stray Kids']],
  ['NewJeans', '6HvZYsbFfjnjFrWF950C9d', ['NewJeans']],
  ['Jung Kook', '6HaGTQPmzraVmaVxvz6EUc', ['Jung Kook', '정국']],
  ['Jimin', '1oSPZhvZMIrWW5I41kPkkY', ['Jimin', '지민']],
  ['V', '3JsHnjpbhX4SnySpvpa9DK', ['V (뷔)', "V '", 'V "']],
  ['RM', '2auC28zjQyVTsiZKNgPRGs', ['RM ']],
  ['Jin', '5vV3bFXnN6D6N3Nj4xRvaV', ['진 (Jin)', 'Jin ']],
  ['j-hope', '0b1sIQumIAsNbqAoIClSpy', ['j-hope', '제이홉']],
  ['Agust D', '5RmQ8k4l3HZ8JoPb4mNsML', ['Agust D']],
  ['ROSÉ', '3eVa5w3URK5duf6eyVDbu9', ['ROSÉ', 'ROSE']],
  ['LISA', '5L1lO4eRHmJ7a0Q6csE5cT', ['LISA']],
  ['JENNIE', '250b0Wlc5Vk0CoUsaCY84M', ['JENNIE']],
  ['JISOO', '6UZ0ba50XreR4TM8u322gs', ['JISOO']],
  ['IVE', '6RHTUrRF63xao58xh9FXYJ', ['IVE']],
  ['aespa', '6YVMFz59CuY7ngCxTxjpxE', ['aespa']],
  ['LE SSERAFIM', '4SpbR6yFEvexJuaBpgAU5p', ['LE SSERAFIM']],
  ['i-dle', '2AfmfGFbe0A0WsTYm0SDTx', ['(G)I-DLE', 'i-dle', '(여자)아이들']],
  ['ITZY', '2KC9Qb60EaY0kW4eH68vr3', ['ITZY']],
  ['SEVENTEEN', '7nqOGRxlXj7N2JYbgNEjYH', ['SEVENTEEN', '세븐틴']],
  ['BIGBANG', '4Kxlr1PRlDKEB0ekOCyHgX', ['BIGBANG']],
  ['G-DRAGON', '30b9WulBM8sFuBo17nNq9c', ['G-DRAGON', 'GD X TAEYANG']],
  ['EXO', '3cjEqqelV9zb4BYE3qDQ4O', ['EXO']],
  ['Red Velvet', '1z4g3DjTBBZKhvAroFlhOM', ['Red Velvet', '레드벨벳']],
  ['TOMORROW X TOGETHER', '0ghlgldX5Dd6720Q3qFyQB', ['TXT', 'TOMORROW X TOGETHER']],
  ['ENHYPEN', '5t5FqBwTcgKTaWmfEbwQY9', ['ENHYPEN']],
  ['ATEEZ', '68KmkJeZGfwe1OUaivBa2L', ['ATEEZ']],
  ['NMIXX', '28ot3wh4oNmoFOdVajibBl', ['NMIXX']],
  ['ILLIT', '36cgvBn0aadzOijnjjwqMN', ['ILLIT']],
  ['BABYMONSTER', '1SIocsqdEefUTE6XKGUiVS', ['BABYMONSTER']],
  ['KATSEYE', '3c0gDdb9lhnHGFtP4prQpn', ['KATSEYE']],
  ['IU', '3HqSLMAZ3g3d5poNaI7GOU', ['IU', '아이유']],
  ['MAMAMOO', '0XATRDCYuuGhk0oE7C0o5G', ['MAMAMOO', '마마무']],
  ["Girls' Generation", '0Sadg1vgvaPqGTOjxu0N6c', ["Girls' Generation", '소녀시대']],
  ['TAEYEON', '3qNVuliS40BLgXGxhdBdqu', ['TAEYEON', '태연']],
  ['MONSTA X', '4TnGh5PKbSjpYqpIdlW5nz', ['MONSTA X']],
  ['NCT DREAM', '1gBUSTR3TyDdTVFIaQnc02', ['NCT DREAM']],
  ['NCT 127', '7f4ignuCJhLXfZ9giKT7rH', ['NCT 127']],
  ['NCT U', '3paGCCtX1Xr4Gx53mSeZuQ', ['NCT U']],
  ['HWASA', '7bmYpVgQub656uNTu6qGNQ', ['HWASA', '화사']],
  ['Jay Park', '4XDi67ZENZcbfKnvMnTYsI', ['Jay Park', '박재범']],
  ['HUNTR/X', '2yNNYQBChuox9A5Ka93BIn', ['HUNTR/X']],
  ['Saja Boys', '0BJ2EjOqcfgFvlZXNKrNbE', ['Saja Boys']],
  ['K/DA', '4gOc8TsQed9eqnqJct2c5v', ['K/DA']],
];

// Official videos that live outside kworb's Korean top-videos list (film and game channels,
// Western label channels). Each is [act, YouTube id]; views are read from kworb.
const EXTRA_VIDEOS = [
  ['ROSÉ', 'ekr2nIex040'], // APT.
  ['K/DA', 'UOxkGD8qRB4'], // POP/STARS
  ['K/DA', '3VTkBuxU4yk'], // MORE
];
// The KPop Demon Hunters songs come from Sony Animation's channel page on kworb.
const KDH_ACTS = { golden: 'HUNTR/X', 'how it\'s done': 'HUNTR/X', 'what it sounds like': 'HUNTR/X', takedown: 'HUNTR/X', free: 'HUNTR/X', 'soda pop': 'Saja Boys', 'your idol': 'Saja Boys' };

// Hand-picked easy entry points: English or bilingual hooks, crossover hits, viral dances,
// soundtrack songs. Keys are "Act | title" as they appear in the built chart.
export const NEWBIE = {
  'HUNTR/X | Golden': 'Movie anthem',
  'ROSÉ | APT.': 'Party chant',
  'PSY | Gangnam Style': 'The one that started it',
  'BTS | Dynamite': 'All-English disco',
  'BTS | Butter': 'All-English',
  'BTS | Permission to Dance': 'All-English',
  'BTS | Boy With Luv': 'Feel-good',
  'Jung Kook | Seven': 'English R&B pop',
  'Jung Kook | Standing Next to You': 'English funk',
  'Jimin | Like Crazy': 'Synth-pop',
  'BLACKPINK | Ice Cream': 'With Selena Gomez',
  'BLACKPINK | How You Like That': 'Big drop',
  'BLACKPINK | DDU-DU DDU-DU': 'Iconic hook',
  'BLACKPINK | Kill This Love': 'Marching hook',
  'BLACKPINK | Pink Venom': 'Hard-hitting',
  'BLACKPINK | JUMP': 'EDM rush',
  'BLACKPINK | BOOMBAYAH': 'Party starter',
  'TWICE | Feel Special': 'Uplifting',
  'HUNTR/X | Takedown': 'Movie anthem',
  'JENNIE | Mantra': 'Catchy',
  'Jung Kook | 3D': 'English R&B pop',
  'BTS | Life Goes On': 'Gentle',
  'LISA | Rockstar': 'Swagger',
  'JENNIE | like JENNIE': 'Club banger',
  'JENNIE | SOLO': 'Catchy solo',
  'JISOO | FLOWER': 'Easy hook',
  'Saja Boys | Soda Pop': 'Movie earworm',
  'Saja Boys | Your Idol': 'Movie villain bop',
  'HUNTR/X | How It\'s Done': 'Movie anthem',
  'HUNTR/X | What It Sounds Like': 'Movie ballad',
  'K/DA | POP/STARS': 'League of Legends',
  'K/DA | MORE': 'League of Legends',
  'NewJeans | Super Shy': 'Breezy',
  'NewJeans | Ditto': 'Dreamy',
  'NewJeans | Hype Boy': 'Breezy',
  'NewJeans | OMG': 'Breezy',
  'NewJeans | ETA': 'Upbeat',
  'TWICE | The Feels': 'All-English',
  'TWICE | TT': 'Cute classic',
  'TWICE | FANCY': 'Sweet synth',
  'TWICE | What is Love?': 'Bubblegum',
  'TWICE | Strategy': 'English hook',
  'Stray Kids | S-Class': 'Loud and fun',
  'Stray Kids | God\'s Menu': 'Loud and fun',
  'Stray Kids | MANIAC': 'Loud and fun',
  'Stray Kids | Chk Chk Boom': 'Loud and fun',
  'IVE | LOVE DIVE': 'Elegant pop',
  'IVE | I AM': 'Big chorus',
  'IVE | After LIKE': 'Disco sample',
  'aespa | Next Level': 'Futuristic',
  'aespa | Supernova': 'Futuristic',
  'aespa | Whiplash': 'Sleek',
  'aespa | Armageddon': 'Futuristic',
  'LE SSERAFIM | ANTIFRAGILE': 'Dance hook',
  'LE SSERAFIM | EASY': 'Smooth',
  'LE SSERAFIM | Perfect Night': 'All-English',
  'LE SSERAFIM | CRAZY': 'Club',
  'i-dle | Queencard': 'Sassy',
  'i-dle | TOMBOY': 'Rock-pop',
  'i-dle | Nxde': 'Theatrical',
  'ITZY | DALLA DALLA': 'Confident',
  'ITZY | WANNABE': 'Confident',
  'SEVENTEEN | Super': 'Epic choreo',
  'SEVENTEEN | HOT': 'Epic choreo',
  'TOMORROW X TOGETHER | Sugar Rush Ride': 'Smooth',
  'ENHYPEN | Bite Me': 'Dark pop',
  'KATSEYE | Gnarly': 'All-English',
  'KATSEYE | Touch': 'All-English',
  'KATSEYE | Gameboy': 'All-English',
  'ILLIT | Magnetic': 'Cute hook',
  'BABYMONSTER | SHEESH': 'Hype',
  'BABYMONSTER | DRIP': 'Hype',
  'BIGBANG | BANG BANG BANG': 'Classic banger',
  'BIGBANG | FANTASTIC BABY': 'Classic banger',
  'G-DRAGON | POWER': 'Swagger',
  'EXO | Love Shot': 'Smooth',
  'EXO | Growl': 'Classic',
  'Red Velvet | Psycho': 'Lush',
  'Red Velvet | Russian Roulette': 'Bright',
  'IU | Celebrity': 'Warm pop',
  'IU | Palette': 'Mellow',
  'PSY | Gentleman': 'Comedy dance',
  'PSY | DADDY': 'Comedy dance',
  'BTS | MIC Drop': 'Hype',
  'BTS | IDOL': 'Festival energy',
  'BTS | DNA': 'Bright',
  'BTS | FAKE LOVE': 'Emotional',
  'BTS | Spring Day': 'Emotional',
  'BTS | ON': 'Epic',
  'MAMAMOO | HIP': 'Sassy',
  "Girls' Generation | Gee": 'Classic',
  'NCT 127 | Kick It': 'Hype',
  'NCT DREAM | Candy': 'Retro',
  'ROSÉ | On The Ground': 'Soaring',
  'ROSÉ | toxic till the end': 'Bittersweet',
  'V | Love Me Again': 'Smooth',
  'V | FRI(END)S': 'Smooth',
  'Jimin | Who': 'Smooth',
  'Agust D | Haegeum': 'Hard rap',
  'j-hope | Chicken Noodle Soup': 'Dance',
};

// ---------- fetching ----------
async function page(url) {
  const f = path.join(cacheDir, requestHash(url) + '.html');
  if (!fresh) { try { return await readFile(f, 'utf8'); } catch { /* not cached */ } }
  const res = await safeFetch(url, { hosts: ['kworb.net'], headers: { 'User-Agent': 'Mozilla/5.0 (chart builder)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const html = await res.text();
  await writeFile(f, html);
  await new Promise((r) => setTimeout(r, 400)); // be gentle with kworb
  return html;
}

const num = (s) => Number(String(s).replace(/,/g, ''));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function videoRows(html) {
  const out = [];
  const re = /video\/([\w-]{11})\.html">([^<]*)<\/a><\/div><\/td><td>([\d,]+)/g;
  for (const m of html.matchAll(re)) out.push({ id: m[1], title: decode(m[2]), views: num(m[3]) });
  return out;
}

function trackRows(html) {
  const out = [];
  const re = /open\.spotify\.com\/track\/(\w+)" target="_blank">([^<]*)<\/a><\/div><\/td><td>([\d,]+)/g;
  for (const m of html.matchAll(re)) out.push({ id: m[1], title: decode(m[2]), streams: num(m[3]) });
  return out;
}

// ---------- matching ----------
const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
const SKIP_VERSION = /remix|sped|slowed|instrumental|acoustic|inst\.|karaoke|a cappella|live|demo|edit\)|japanese|english ver|korean ver|chinese|-jp ver|version\)|ver\.\)|mix\)/i;
const KEEP_VERSION = /explicit|clean/i;

const HANGUL = /[ㄱ-ㆎ가-힣]/;
/**
 * "Seven (feat. Latto) (Explicit Ver.)" -> { title: "Seven", keys: ["seven"] }
 * "불장난 (PLAYING WITH FIRE)" -> { title: "PLAYING WITH FIRE", keys: [both] }
 */
function parseTitle(raw) {
  const t = raw.replace(/[’‘]/g, "'").replace(/\s+-\s+.*$/, '');
  const parens = [...t.matchAll(/\s+[([](.*?)[)\]]/g)].map((m) => m[1]).filter((p) => !/feat\.|with |ver\.|version|prod\./i.test(p));
  const base = t.replace(/\s+[([].*?[)\]]/g, '').trim() || t;
  const title = HANGUL.test(base) && parens[0] && !HANGUL.test(parens[0]) ? parens[0] : base;
  return { title, keys: [base, ...parens].map(norm).filter((k) => k.length >= 2) };
}

// Songs credited to a K-pop act but led by a Western artist: not counted.
const EXCLUDE = new Set(['BTS | My Universe', 'BTS | Left and Right', 'Jung Kook | Left and Right', 'JENNIE | One Of The Girls',
  'HWASA | Physical', 'BLACKPINK | Kiss And Make Up', 'LISA | SG', 'BLACKPINK | Sour Candy', 'BTS | Waste It On Me', 'Jung Kook | Dreamers']);
// Titles that differ between Spotify and YouTube, or that fans know by another name.
const ALIASES = { 'SEVENTEEN | Super': ['손오공'] };
const DISPLAY = { 'BTS | Burning Up': 'FIRE', 'BTS | Boy With Luv': 'Boy With Luv' };

/** The YouTube title with the quoted song name removed, so "Permission to Dance" is not a dance video. */
const shell = (t) => t.replace(/['‘’"“”「][^'‘’"“”」]+['‘’"“”」]/g, '');
const isOfficial = (t) => {
  if (/official lyric video|song clip \| kpop demon hunters|\(official music video\)|music video - league of legends/i.test(t)) return true;
  const s = shell(t);
  return /(\bM\/?V\b|music video)/i.test(s)
    && !/(dance|practice|choreo|teaser|behind|relay|live|reaction|making|special video|visualizer|color coded|8d|performance video)/i.test(s);
};

function actOf(title) {
  // Collaborations: credit the act named first in the title.
  let best = null;
  for (const [act, , names] of ACTS) {
    for (const n of names) {
      const i = title.indexOf(n);
      if (i >= 0 && (!best || i < best.i || (i === best.i && n.length > best.len))) best = { act, i, len: n.length };
    }
  }
  return best && best.i < 40 ? best.act : null;
}

async function main() {
  await mkdir(cacheDir, { recursive: true });

  // Spotify: group each act's versions of a song under its base title.
  const songsByAct = new Map();
  for (const [act, id] of ACTS) {
    const html = await page(`https://kworb.net/spotify/artist/${id}_songs.html`);
    const songs = new Map();
    for (const t of trackRows(html)) {
      if (SKIP_VERSION.test(t.title) && !KEEP_VERSION.test(t.title)) continue;
      const p = parseTitle(t.title);
      const k = norm(p.title);
      if (!k || EXCLUDE.has(`${act} | ${p.title}`)) continue;
      const s = songs.get(k) || { title: DISPLAY[`${act} | ${p.title}`] || p.title, streams: 0, keys: new Set(), spotifyId: t.id };
      s.streams += t.streams;
      for (const x of [...p.keys, ...(ALIASES[`${act} | ${p.title}`] || []).map(norm)]) s.keys.add(x);
      songs.set(k, s);
    }
    songsByAct.set(act, songs);
  }

  // YouTube: Korean top videos + Sony's KPop Demon Hunters page + extras.
  const videos = videoRows(await page('https://kworb.net/youtube/topvideos_korean.html'));
  for (const v of videoRows(await page('https://kworb.net/youtube/artist/kpopdemonhunters.html'))) {
    const song = Object.keys(KDH_ACTS).find((k) => norm(v.title).includes(norm(k)));
    if (song && isOfficial(v.title)) videos.push({ ...v, act: KDH_ACTS[song] });
  }
  for (const [act, id] of EXTRA_VIDEOS) {
    const html = await page(`https://kworb.net/youtube/video/${id}.html`);
    const title = decode(html.match(/<title>YouTube Stats of ([^<]*)/)?.[1] || id);
    const views = num(html.match(/Total views[^0-9]*([\d,]+)/)?.[1] || 0);
    videos.push({ id, title, views, act });
  }

  // Each official MV is matched to the act's song whose title it contains (longest wins).
  const entries = new Map();
  const unmatched = [];
  for (const v of videos) {
    if (!isOfficial(v.title)) continue;
    const act = v.act || actOf(v.title);
    if (!act) continue;
    const songs = songsByAct.get(act);
    const vt = norm(v.title.replace(/\(feat[^)]*\)/gi, ''));
    // The quoted song name decides first ("NewJeans 'OMG' MV" is OMG, not the song "New Jeans");
    // the whole title is only searched when nothing is quoted or the quote matched nothing.
    const quoted = [...v.title.matchAll(/['‘’"“”「]([^'‘’"“”」]+)['‘’"“”」]/g)].map((m) => norm(m[1])).filter(Boolean);
    const find = (hay, exact) => {
      let hit = null;
      for (const s of songs.values()) {
        for (const k of s.keys) {
          if (hay.some((h) => (exact ? h === k : h.includes(k))) && (!hit || k.length > hit.k.length)) hit = { k, s };
        }
      }
      return hit;
    };
    const best = (quoted.length && (find(quoted, true) || find(quoted, false))) || find([vt], false);
    if (!best) { unmatched.push(`${act} | ${v.title} (${v.views.toLocaleString('en-US')})`); continue; }
    const key = `${act} | ${best.s.title}`;
    const prev = entries.get(key);
    if (prev && prev.views >= v.views) continue; // keep the most-viewed official video
    entries.set(key, { artist: act, title: best.s.title, videoId: v.id, views: v.views, streams: best.s.streams });
  }

  // Big songs (and newbie picks) whose video is not in kworb's lists: take the video id the
  // idol-mode resolver already verified (data/videos.json) and read its views from kworb.
  const known = JSON.parse(await readFile(path.join(root, 'data', 'videos.json'), 'utf8'));
  const knownId = (act, title) => {
    const want = norm(title);
    for (const [k, v] of Object.entries(known)) {
      const [a, t] = k.split(' | ');
      if (v?.id && norm(t) === want && (a === act || a.startsWith(act + ' ') || norm(a) === norm(act))) return v.id;
    }
    return null;
  };
  const picks = new Set(Object.keys(NEWBIE).map((k) => k.toLowerCase()));
  for (const [act, songs] of songsByAct) {
    for (const s of songs.values()) {
      const key = `${act} | ${s.title}`;
      if (entries.has(key) || (s.streams < 250e6 && !picks.has(key.toLowerCase()))) continue;
      const id = knownId(act, s.title);
      if (!id) continue;
      const html = await page(`https://kworb.net/youtube/video/${id}.html`).catch(() => '');
      const views = num(html.match(/Total views[^0-9]*([\d,]+)/)?.[1] || 0);
      if (views) entries.set(key, { artist: act, title: s.title, videoId: id, views, streams: s.streams });
    }
  }

  const all = [...entries.values()]
    .map((e) => ({ ...e, score: Math.round((e.views + e.streams) / 2) }))
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, overall: i + 1 })); // rank among every scored song, for card rarity
  const top = all.slice(0, 100).map((e, i) => ({ rank: i + 1, ...e }));

  const keyOf = (e) => `${e.artist} | ${e.title}`;
  const byKey = new Map(all.map((e) => [keyOf(e).toLowerCase(), e]));
  const newbie = [];
  const missing = [];
  for (const [k, vibe] of Object.entries(NEWBIE)) {
    const e = byKey.get(k.toLowerCase());
    if (e) newbie.push({ ...e, vibe }); else missing.push(k);
  }
  newbie.sort((a, b) => b.score - a.score);

  const out = {
    updated: new Date().toISOString().slice(0, 10),
    source: 'kworb.net (Spotify streams, YouTube views)',
    method: 'Score = (Spotify streams + official video views) / 2',
    top,
    newbie: newbie.map((e, i) => ({ rank: i + 1, ...e })),
  };
  await writeFile(path.join(root, 'data', 'charts.json'), JSON.stringify(out, null, 1) + '\n');

  console.log(`Top 100 written (${all.length} candidates). #1 ${keyOf(top[0])}, #100 ${keyOf(top[99])} (${top[99].score.toLocaleString('en-US')}).`);
  console.log(`New to K-pop: ${newbie.length} songs.`);
  if (missing.length) console.log(`\nNEWBIE picks not found (${missing.length}):\n  ` + missing.join('\n  '));
  const bigUnmatched = unmatched.filter((u) => num(u.match(/\(([\d,]+)\)$/)[1]) > 300e6);
  if (bigUnmatched.length) console.log(`\nOfficial videos over 300M views with no Spotify match:\n  ` + bigUnmatched.join('\n  '));
  // Big Spotify songs with no video in the lists: candidates for EXTRA_VIDEOS.
  const have = new Set(all.map((e) => keyOf(e)));
  const orphans = [];
  for (const [act, songs] of songsByAct) for (const s of songs.values()) if (s.streams > 600e6 && !have.has(`${act} | ${s.title}`)) orphans.push(`${act} | ${s.title} (${s.streams.toLocaleString('en-US')})`);
  if (orphans.length) console.log(`\nSongs over 600M streams with no official video found:\n  ` + orphans.join('\n  '));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
