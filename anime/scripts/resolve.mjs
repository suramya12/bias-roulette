import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve as resolvePath, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parseSeedLine, extractInitialData, extractPlayerResponse, videosFromSearch,
  playability, classify, score, watchMetadata, copySource, copyGate, orderCopies, sameSong, COPY_POLICY,
} from './lib.mjs';

const animeRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const videoIdPattern = /^[\w-]{11}$/;
const usage = `Usage: node anime/scripts/resolve.mjs [--refresh] [--only "text"] [--help]

Resolve new or changed seed songs into anime/data/catalog.json and anime/REVIEW.md.
Collect up to four HD copies per song; video remains an alias for videos[0].
  --refresh       Re-search selected songs and bypass cached pages.
  --only "text"   Match artist, title, aliases, show/source, or kind (case-insensitive).
  --help, -h      Print this help without reading files or making requests.

Pages are cached in anime/.cache/. Requests are spaced at least 2.5 s apart.
Null overrides drop songs. Selected copies must pass embedding and HD gates.
Fans need 1,000,000 exact views OR publication at least three calendar years ago.
`;

export function parseArgs(args) {
  const options = { refresh: false, only: '', help: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--refresh') options.refresh = true;
    else if (args[i] === '--help' || args[i] === '-h') options.help = true;
    else if (args[i] === '--only' && args[i + 1] && !args[i + 1].startsWith('--')) options.only = args[++i];
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  return options;
}

export async function readJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}

export function createPageLoader({
  cacheDir, refresh = false, fetchImpl = globalThis.fetch, delayMs = 2500,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now,
}) {
  let lastRequest = -Infinity;
  const pages = new Map();
  // The resolver calls this serially. Only network requests consume the delay.
  return async function loadPage(url) {
    if (pages.has(url)) return pages.get(url);
    const path = join(cacheDir, `${hash(url)}.html`);
    if (!refresh) {
      try {
        const html = await readFile(path, 'utf8');
        pages.set(url, html);
        return html;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const wait = delayMs - (now() - lastRequest);
    if (wait > 0) await sleep(wait);
    lastRequest = now();
    // YouTube throttles fast scripted runs by redirecting (consent / "sorry" pages, often in a loop).
    // Don't follow redirects: treat them, and network hiccups, as "slow down" and back off.
    let response, html;
    for (let attempt = 0; ; attempt++) {
      let problem;
      try {
        lastRequest = now();
        response = await fetchImpl(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en', Cookie: 'SOCS=CAI; CONSENT=YES+1' },
          redirect: 'manual',
          signal: AbortSignal.timeout(30_000),
        });
        if (response.status >= 300 && response.status < 400) problem = `redirected to ${response.headers.get('location') ?? '?'}`;
        else if (response.status === 429) problem = 'HTTP 429';
        else if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for ${url}`), { final: true });
        else {
          html = await response.text();
          // A 200 can still be a consent/challenge page: treat a page without the data as throttling,
          // and never cache it as a successful result.
          try {
            if (url.includes('/results?')) extractInitialData(html);
            else extractPlayerResponse(html);
            break;
          } catch (error) { problem = error.message; }
        }
      } catch (error) {
        if (error.final) throw error;
        problem = `${error.message}${error.cause ? ` (${error.cause.code ?? error.cause.message})` : ''}`;
      }
      if (attempt >= 3) throw new Error(problem);
      const pause = [15_000, 45_000, 120_000][attempt];
      console.warn(`  throttled (${problem.slice(0, 80)}); waiting ${pause / 1000}s`);
      await sleep(pause);
    }
    await mkdir(cacheDir, { recursive: true });
    await writeFile(path, html, 'utf8');
    pages.set(url, html);
    return html;
  };
}

export function queriesFor(seed) {
  if (seed.kind !== 'theme') return [`${seed.artist} ${seed.title} official music video`, `${seed.artist} ${seed.title}`];
  const use = { OP: 'opening', ED: 'ending', IN: 'insert song' }[seed.use];
  return [`${seed.show} ${use} ${seed.title} creditless`, `${seed.artist} ${seed.title} ${seed.show}`, `${seed.show} ${use} ${seed.title}`];
}

const watchURL = id => `https://www.youtube.com/watch?v=${id}`;
const searchURL = query => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

function pickedVideo(candidate, kind, checked, channels) {
  return {
    id: candidate.id, kind, channel: candidate.channel, channelId: candidate.channelId,
    title: candidate.title, source: copySource(candidate, channels), seconds: candidate.seconds,
    views: candidate.views, published: candidate.published, hd: candidate.hd, quality: candidate.quality, checked,
  };
}

async function manualPick(seed, id, channels, loadPage, checked, health) {
  if (id === null) return { videos: [], video: null, flag: 'dropped by override', complete: true };
  if (typeof id !== 'string' || !videoIdPattern.test(id)) throw new Error(`Invalid override for ${seed.artist} | ${seed.title}`);
  const failed = (flag, complete = true) => ({ videos: [], video: null, flag, complete });
  if (health[id]?.booted) return failed('override is booted by health');
  try {
    const html = await loadPage(watchURL(id));
    const { status, embed } = playability(html);
    if (status !== 'OK' || embed !== true) return failed(`override not playable: ${status}, embed=${embed}`);
    const details = extractPlayerResponse(html).videoDetails ?? {};
    const candidate = {
      id, title: details.title ?? '', channel: details.author ?? '',
      channelId: details.channelId ?? '', seconds: Number(details.lengthSeconds ?? 0),
      verified: false, officialArtist: false, ...watchMetadata(html, checked),
    };
    const result = classify(candidate, seed, channels);
    const gate = copyGate(candidate, seed, channels, checked, { manual: true });
    if (gate) return failed(`override rejected: ${gate}`);
    const video = pickedVideo(candidate, result.kind, checked, channels);
    return { videos: [video], video,
      flag: seed.kind === 'theme' && result.kind === 'mv' ? 'mv used for a theme' : null, complete: true };
  } catch (error) {
    return failed(`override check failed: ${error.message}`, false);
  }
}

export async function resolveSeed(seed, { channels, overrides, loadPage, checked, health = {}, existing = [] }) {
  const key = `${seed.artist} | ${seed.title}`;
  if (Object.hasOwn(overrides, key)) {
    const result = await manualPick(seed, overrides[key], channels, loadPage, checked, health);
    if (!result.complete) {
      result.videos = existing.filter(v => v.id === overrides[key] && !health[v.id]?.booted &&
        !Object.hasOwn(channels.blocked ?? {}, v.channelId));
      result.video = result.videos[0] ?? null;
    }
    return result;
  }
  const candidates = new Map(), errors = [];
  for (const query of queriesFor(seed)) {
    try {
      const data = extractInitialData(await loadPage(searchURL(query)));
      for (const candidate of videosFromSearch(data).slice(0, 15)) {
        if (videoIdPattern.test(candidate.id) && !candidates.has(candidate.id)) candidates.set(candidate.id, candidate);
      }
    } catch (error) { errors.push(`search failed: ${error.message}`); }
  }
  const ranked = [...candidates.values()].sort((a, b) => score(b, seed, channels) - score(a, seed, channels) || a.id.localeCompare(b.id));
  const copies = new Map(existing.filter(v => !health[v.id]?.booted &&
    !Object.hasOwn(channels.blocked ?? {}, v.channelId) &&
    !copyGate({ ...v, title: v.title ?? `${seed.title} ${v.kind === 'tv' ? 'opening' : v.kind}` }, seed, channels, checked))
    .map(v => [v.id, { ...v, source: copySource(v, channels) }]));
  // Check distinct candidates beyond the old four-watch budget. Search pages
  // remain bounded (15 each); gather all eligible copies before quality ranking.
  for (const candidate of ranked.filter(video => !classify(video, seed, channels).reject && sameSong(video, seed) && !health[video.id]?.booted)) {
    try {
      const html = await loadPage(watchURL(candidate.id));
      const { status, embed } = playability(html);
      if (status !== 'OK' || embed !== true) continue;
      const metadata = watchMetadata(html, checked);
      const exact = { ...candidate, ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)) };
      const rejection = copyGate(exact, seed, channels, checked);
      if (rejection) { errors.push(`${candidate.id}: ${rejection}`); continue; }
      const kind = classify(exact, seed, channels).kind;
      copies.set(candidate.id, pickedVideo(exact, kind, checked, channels));
    } catch (error) { errors.push(`watch failed (${candidate.id}): ${error.message}`); }
  }
  const videos = orderCopies([...copies.values()]), video = videos[0] ?? null;
  const flags = video ? [] : ['set aside: no eligible HD copy'];
  if (video?.kind === 'mv' && seed.kind === 'theme') flags.push('mv used for a theme');
  if (errors.length) flags.push(...new Set(errors));
  return { videos, video, flag: flags.join('; ') || null, complete: errors.length === 0 };
}

const cell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const songName = song => cell(`${song.artist} — ${song.title}`);

export function reviewMarkdown(catalog) {
  const lines = ['# Anime resolver review', '', `Generated: ${catalog.generated}`, '', '## Flagged', '',
    '| Song | Reason |', '| --- | --- |'];
  const flagged = catalog.songs.filter(song => song.flag);
  for (const song of flagged) lines.push(`| ${songName(song)} | ${cell(song.flag)} |`);
  if (!flagged.length) lines.push('| — | No flagged songs |');
  lines.push('', '## Set aside', '', '| Song | Reason |', '| --- | --- |');
  const setAside = catalog.songs.filter(song => !(song.videos ?? (song.video ? [song.video] : [])).length && song.flag !== 'dropped by override');
  for (const song of setAside) lines.push(`| ${songName(song)} | ${cell(song.flag || 'no eligible HD copy')} |`);
  if (!setAside.length) lines.push('| — | None |');
  lines.push('', '## All songs', '', '| Song | Video | Channel | Kind | Seconds |', '| --- | --- | --- | --- | --- |');
  for (const song of catalog.songs) {
    const video = song.video;
    lines.push(`| ${songName(song)} | ${video ? `[${video.id}](${watchURL(video.id)})` : '—'} | ${cell(video?.channel ?? '—')} | ${video?.kind ?? '—'} | ${video?.seconds ?? '—'} |`);
  }
  return `${lines.join('\n')}\n`;
}

export function summary(catalog) {
  const songs = catalog.songs, playable = songs.filter(song => song.video);
  const byKind = [...new Set(songs.map(song => song.kind))].map(kind => `${kind} ${playable.filter(song => song.kind === kind).length}/${songs.filter(song => song.kind === kind).length}`).join(', ');
  const byVideo = ['creditless', 'tv', 'mv'].map(kind => `${kind} ${playable.filter(song => song.video.kind === kind).length}`).join(', ');
  return `playable ${playable.length} / ${songs.length}\nby kind: ${byKind || 'none'}\nby video kind: ${byVideo}\nflagged ${songs.filter(song => song.flag).length}`;
}

export function seedFields(song) {
  const { video, videos, flag, ...seed } = song;
  return seed;
}

function fingerprint(seed, overrides, channels, health) {
  const key = `${seed.artist} | ${seed.title}`;
  return hash(JSON.stringify({ policy: COPY_POLICY, seed, override: Object.hasOwn(overrides, key) ? overrides[key] : 'absent', channels, health }));
}

export async function runResolver({ root = animeRoot, refresh = false, only = '', refill = false, loadPage, log = console.log, now = () => new Date().toISOString() } = {}) {
  const dataDir = join(root, 'data'), cacheDir = join(root, '.cache');
  const [kinds, overrides, channels, previous, state, health] = await Promise.all([
    readJSON(join(dataDir, 'kinds.json')), readJSON(join(dataDir, 'overrides.json')),
    readJSON(join(dataDir, 'channels.json')), readJSON(join(dataDir, 'catalog.json'), { songs: [] }),
    readJSON(join(cacheDir, 'resolve-state.json'), {}),
    readJSON(join(dataDir, 'health.json'), {}),
  ]);
  const seeds = [], ids = new Set(), kindIds = new Set();
  for (const kind of kinds) {
    if (!kind.id || kindIds.has(kind.id) || !kind.seed) throw new Error(`Invalid or duplicate kind: ${kind.id}`);
    kindIds.add(kind.id);
    const lines = (await readFile(join(dataDir, 'seeds', kind.seed), 'utf8')).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      let seed;
      try { seed = parseSeedLine(line, kind.id); }
      catch (error) { throw new Error(`${kind.seed}:${index + 1}: ${error.message}`); }
      if (!seed) continue;
      if (ids.has(seed.id)) throw new Error(`Duplicate song: ${seed.artist} | ${seed.title}`);
      ids.add(seed.id);
      seeds.push(seed);
    }
  }
  // Validate all overrides before fetching or writing any output.
  for (const [key, id] of Object.entries(overrides)) {
    if (id !== null && (typeof id !== 'string' || !videoIdPattern.test(id))) throw new Error(`Invalid override for ${key}`);
  }
  const oldSongs = new Map(previous.songs.map(song => [song.id, song]));
  const nextState = {}, songs = [];
  const loader = loadPage ?? createPageLoader({ cacheDir, refresh });
  for (const seed of seeds) {
    const old = oldSongs.get(seed.id), stamp = fingerprint(seed, overrides, channels, health);
    const overrideKey = `${seed.artist} | ${seed.title}`;
    const hasOverride = Object.hasOwn(overrides, overrideKey);
    const oldCopies = orderCopies((hasOverride && overrides[overrideKey] === null ? [] : old?.videos ?? (old?.video ? [old.video] : []))
      .filter(v => !health[v.id]?.booted && !Object.hasOwn(channels.blocked ?? {}, v.channelId))
      .map(v => ({ ...v, source: copySource(v, channels) })));
    const selected = !only || [seed.artist, seed.title, seed.show ?? seed.source, seed.kind, ...seed.aliases]
      .join(' | ').toLowerCase().includes(only.toLowerCase());
    const sameSeed = old && JSON.stringify(seedFields(old)) === JSON.stringify(seed);
    // Old catalogues without policy state must be checked under the new gates.
    const sameOverride = hasOverride
      ? overrides[overrideKey] === null ? old?.flag === 'dropped by override' : old?.video?.id === overrides[overrideKey]
      : !/^(?:dropped by override|override |manual override)/.test(old?.flag ?? '');
    const unchanged = sameSeed && sameOverride && state[seed.id] === stamp;
    const fullQueue = !hasOverride && oldCopies.length >= 4 && oldCopies.every(v => !copyGate(v, seed, channels, now()));
    if (!selected || (refill ? fullQueue : !refresh && unchanged)) {
      songs.push(old ? { ...old, videos: oldCopies, video: oldCopies[0] ?? null } : { ...seed, videos: [], video: null, flag: 'not resolved' });
      if (state[seed.id]) nextState[seed.id] = state[seed.id];
      continue;
    }
    log(`Resolving ${seed.artist} | ${seed.title}`);
    const { videos, video, flag, complete } = await resolveSeed(seed, { channels, overrides, loadPage: loader, checked: now(), health, existing: oldCopies });
    songs.push({ ...seed, videos, video, flag });
    // Failed requests are retryable on the next run; successful no-match results
    // are incremental and require --refresh or a seed/policy change to retry.
    if (complete) nextState[seed.id] = stamp;
    else nextState[seed.id] = 'retry';
  }
  const catalog = { generated: now(), songs };
  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(dataDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await writeFile(join(root, 'REVIEW.md'), reviewMarkdown(catalog), 'utf8');
  await writeFile(join(cacheDir, 'resolve-state.json'), `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
  log(summary(catalog));
  return catalog;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) { console.log(usage); return; }
  await runResolver(options);
}

if (process.argv[1] && pathToFileURL(resolvePath(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
