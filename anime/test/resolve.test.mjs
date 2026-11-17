import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSeedLine } from '../scripts/lib.mjs';
import { parseArgs, queriesFor, resolveSeed, runResolver, createPageLoader, reviewMarkdown, summary } from '../scripts/resolve.mjs';

const fixture = name => readFile(new URL(`fixtures/${name}.html`, import.meta.url), 'utf8');
const checked = '2026-11-17T00:00:00.000Z';
const seed = parseSeedLine('TK from Ling tosite sigure | unravel | Tokyo Ghoul | OP | 2014');
const channels = { trusted: { reviewed: 'Reviewed' }, blocked: {}, knownNames: ['Crunchyroll'] };
const id = n => String(n).padStart(11, '0');
const video = (n, extra = {}) => ({ id: id(n), title: 'unravel opening', channel: 'Reviewed', channelId: 'reviewed', seconds: 90, views: 10, ...extra });
function searchPage(videos) {
  const data = { contents: videos.map(v => ({ videoRenderer: {
    videoId: v.id, title: { simpleText: v.title },
    ownerText: { runs: [{ text: v.channel, navigationEndpoint: { browseEndpoint: { browseId: v.channelId } } }] },
    lengthText: { simpleText: `${Math.floor(v.seconds / 60)}:${String(v.seconds % 60).padStart(2, '0')}` },
    viewCountText: { simpleText: `${v.views} views` },
  } })) };
  return `var ytInitialData = ${JSON.stringify(data)};`;
}
const playerPage = (status, embed) => `var ytInitialPlayerResponse = ${JSON.stringify({ playabilityStatus: { status, playableInEmbed: embed }, videoDetails: { viewCount: '1000000' }, streamingData: { formats: [{ width: 1280, height: 720, qualityLabel: '720p' }] } })};`;
const quiet = () => {};

test('help exits offline and invalid options fail before doing work', () => {
  const cli = new URL('../scripts/resolve.mjs', import.meta.url);
  const out = execFileSync(process.execPath, [fileURLToPath(cli), '--help'], { encoding: 'utf8' });
  assert.match(out, /Usage:.*resolve\.mjs/);
  assert.match(out, /--refresh/);
  assert.deepEqual(parseArgs(['--refresh', '--only', 'Tokyo Ghoul']), { refresh: true, only: 'Tokyo Ghoul', help: false });
  assert.throws(() => parseArgs(['--only']), /incomplete/);
  assert.throws(() => parseArgs(['--bogus']), /Unknown/);
});

test('queries distinguish OP, ED, insert, and registry MV groups', () => {
  assert.equal(queriesFor(seed)[0], 'Tokyo Ghoul opening unravel creditless');
  assert.equal(queriesFor({ ...seed, use: 'ED' })[0], 'Tokyo Ghoul ending unravel creditless');
  assert.equal(queriesFor({ ...seed, use: 'IN' })[0], 'Tokyo Ghoul insert song unravel creditless');
  assert.deepEqual(queriesFor({ ...seed, kind: 'game-mv' }), [`${seed.artist} unravel official music video`]);
});

test('official TV ranks ahead of an eligible fan creditless copy', async () => {
  const search = searchPage([video(1, { title: 'unravel creditless', channelId: 'fan' }), video(2)]), ok = await fixture('watch-hd'), calls = [];
  const result = await resolveSeed(seed, { channels, overrides: {}, checked, loadPage: async url => {
    calls.push(url); return url.includes('/results?') ? search : ok;
  } });
  assert.equal(result.video.id, id(2));
  assert.equal(result.video.kind, 'tv');
  assert.equal(result.video.channel, 'Reviewed');
  assert.equal(result.videos.length, 2);
  assert.equal(result.video.checked, checked);
  assert.equal(result.flag, null);
  assert.equal(calls.filter(url => url.includes('/results?')).length, 2);
  assert.equal(calls.filter(url => url.includes('/watch?')).length, 2);
});

test('status OK without embed and non-OK with embed both fail; first playable candidate wins', async () => {
  const candidates = [video(1, { title: 'unravel creditless' }), video(2), video(3, { title: 'unravel MV' })];
  const watches = [];
  const result = await resolveSeed(seed, { channels, overrides: {}, checked, loadPage: async url => {
    if (url.includes('/results?')) return searchPage(candidates);
    watches.push(url);
    if (url.endsWith(id(1))) return playerPage('OK', false);
    if (url.endsWith(id(2))) return playerPage('LOGIN_REQUIRED', true);
    return playerPage('OK', true);
  } });
  assert.equal(result.video.id, id(3));
  assert.equal(result.flag, 'mv used for a theme');
  assert.deepEqual(watches.map(url => url.slice(-11)), [id(1), id(2), id(3)]);
});

test('candidate checks deduplicate queries and continue beyond four failures', async () => {
  const candidates = [video(9, { title: 'unravel creditless', channel: 'Human review', channelId: 'unknown' }),
    ...Array.from({ length: 6 }, (_, i) => video(i + 1, { views: 100 - i }))];
  let searches = 0, watches = 0;
  const result = await resolveSeed(seed, { channels, overrides: {}, checked, loadPage: async url => {
    if (url.includes('/results?')) { searches++; return searchPage(candidates); }
    watches++;
    return playerPage('UNPLAYABLE', false);
  } });
  assert.equal(searches, 2);
  assert.equal(watches, 7);
  assert.equal(result.video, null);
  assert.match(result.flag, /set aside: no eligible HD copy/);
  assert.equal(result.complete, true);
});

test('each query takes at most 15 candidates', async () => {
  const candidates = Array.from({ length: 15 }, (_, i) => video(i, { title: 'unravel cover' }));
  candidates.push(video(99));
  let watches = 0;
  const result = await resolveSeed(seed, { channels, overrides: {}, checked, loadPage: async url => {
    if (url.includes('/results?')) return searchPage(candidates);
    watches++;
    return playerPage('OK', true);
  } });
  assert.equal(watches, 0);
  assert.equal(result.video, null);
});

test('animated MVs issue one query and require an MV on a trusted channel', async () => {
  let searches = 0;
  const result = await resolveSeed({ ...seed, kind: 'animated-mv' }, { channels, overrides: {}, checked, loadPage: async url => {
    if (url.includes('/results?')) {
      searches++;
      return searchPage([video(1), video(2, { title: 'unravel official video' })]);
    }
    return playerPage('OK', true);
  } });
  assert.equal(searches, 1);
  assert.equal(result.video.id, id(2));
  assert.equal(result.video.kind, 'mv');
});

test('manual drop never fetches; manual picks bypass searches but still check embed', async () => {
  const key = `${seed.artist} | ${seed.title}`;
  const drop = await resolveSeed(seed, { channels, overrides: { [key]: null }, checked, loadPage: async () => assert.fail('drop fetched') });
  assert.equal(drop.flag, 'dropped by override');
  let calls = 0;
  const ok = (await fixture('watch-ok')).replace('"lengthSeconds":"90"', '"lengthSeconds":"90","viewCount":"1000000"').replace('};</script>', ',"streamingData":{"formats":[{"width":1280,"height":720}]}};</script>');
  const pick = await resolveSeed(seed, { channels, overrides: { [key]: 'WinBY_VCymA' }, checked, loadPage: async url => {
    calls++; assert.equal(url, 'https://www.youtube.com/watch?v=WinBY_VCymA'); return ok;
  } });
  assert.equal(calls, 1);
  assert.equal(pick.video.id, 'WinBY_VCymA');
  assert.equal(pick.video.seconds, 90);
  assert.equal(pick.video.hd, true);
  assert.equal(pick.video.source, 'fan');
  const blocked = await resolveSeed(seed, { channels, overrides: { [key]: '_k7gZaDjTTM' }, checked, loadPage: () => fixture('watch-blocked') });
  assert.equal(blocked.video, null);
  assert.match(blocked.flag, /override not playable: LOGIN_REQUIRED/);
});

test('network failures remain visible and retryable', async () => {
  const result = await resolveSeed(seed, { channels, overrides: {}, checked, loadPage: async () => { throw new Error('offline'); } });
  assert.equal(result.complete, false);
  assert.match(result.flag, /search failed: offline/);
});

test('raw-page cache avoids duplicate requests, refresh bypasses disk, and requests use a 2.5 s gap', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'anime-pages-'));
  let time = 1000, requests = 0;
  const starts = [], waits = [];
  const fetchImpl = async (_url, options) => {
    requests++; starts.push(time);
    assert.equal(options.headers['User-Agent'], 'Mozilla/5.0');
    assert.equal(options.headers['Accept-Language'], 'en');
    return { ok: true, text: async () => searchPage([video(1)]) };
  };
  const make = refresh => createPageLoader({ cacheDir, refresh, fetchImpl, now: () => time, sleep: async ms => { waits.push(ms); time += ms; } });
  const a = 'https://www.youtube.com/results?search_query=a', b = 'https://www.youtube.com/results?search_query=b';
  const loader = make(false);
  await loader(a); await loader(a); await loader(b);
  assert.equal(requests, 2);
  assert.deepEqual(starts, [1000, 3500]);
  assert.deepEqual(waits, [2500]);
  await make(false)(a);
  assert.equal(requests, 2);
  const fresh = make(true);
  await fresh(a); await fresh(a);
  assert.equal(requests, 3);
});

test('HTTP errors and malformed challenge responses are not cached', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'anime-errors-'));
  const url = 'https://www.youtube.com/results?search_query=x';
  const badHTTP = createPageLoader({ cacheDir, fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(badHTTP(url), /HTTP 503/);
  const challenge = createPageLoader({ cacheDir, fetchImpl: async () => ({ ok: true, text: async () => '<html>challenge</html>' }) });
  await assert.rejects(challenge(url), /Missing or malformed/);
});

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'anime-resolver-'));
  await mkdir(join(root, 'data', 'seeds'), { recursive: true });
  const json = (name, data) => writeFile(join(root, 'data', name), JSON.stringify(data), 'utf8');
  await json('kinds.json', [{ id: 'theme', seed: 'themes.txt' }]);
  await json('channels.json', channels);
  await json('overrides.json', {});
  const lines = ['TK from Ling tosite sigure | unravel | Tokyo Ghoul | OP | 2014', 'FLOW | GO!!! | Naruto | OP | 2004 | aka Fighting Dreamers'];
  const seeds = () => writeFile(join(root, 'data', 'seeds', 'themes.txt'), `${lines.join('\n')}\n`, 'utf8');
  await seeds();
  let requests = 0;
  const loadPage = async url => {
    requests++;
    if (url.includes('/results?')) return searchPage([video(1)]);
    return playerPage('OK', true);
  };
  const run = options => runResolver({ root, loadPage, log: quiet, now: () => checked, ...options });
  return { root, json, lines, seeds, run, requests: () => requests };
}

test('incremental resolver searches changed seeds only; refresh/only, aliases, and override changes work', async () => {
  const env = await sandbox();
  const beforeSeeds = await readFile(join(env.root, 'data', 'seeds', 'themes.txt'), 'utf8');
  await env.run();
  assert.equal(env.requests(), 6);
  await env.run();
  assert.equal(env.requests(), 6);
  env.lines[0] = env.lines[0].replace('2014', '2015'); await env.seeds();
  let catalog = await env.run();
  assert.equal(env.requests(), 9);
  assert.equal(catalog.songs[0].year, 2015);
  catalog = await env.run({ refresh: true, only: 'fighting dreamers' });
  assert.equal(env.requests(), 12);
  assert.equal(catalog.songs.length, 2);
  await env.json('overrides.json', { 'FLOW | GO!!!': null });
  catalog = await env.run();
  assert.equal(env.requests(), 12);
  assert.equal(catalog.songs[1].flag, 'dropped by override');
  assert.equal(await readFile(join(env.root, 'data', 'overrides.json'), 'utf8'), '{"FLOW | GO!!!":null}');
  await env.json('overrides.json', {});
  catalog = await env.run();
  assert.equal(env.requests(), 15);
  assert.ok(catalog.songs[1].video);
  const saved = JSON.parse(await readFile(join(env.root, 'data', 'catalog.json'), 'utf8'));
  assert.deepEqual(saved, catalog);
  const review = await readFile(join(env.root, 'REVIEW.md'), 'utf8');
  assert.match(review, /\[00000000001\]\(https:\/\/www.youtube.com\/watch\?v=00000000001\)/);
  assert.match(summary(catalog), /playable 2 \/ 2/);
  assert.match(summary(catalog), /by kind: theme 2\/2/);
  assert.match(beforeSeeds, /2014/);
});

test('only on a fresh catalogue keeps unresolved rows available for a later full run', async () => {
  const env = await sandbox();
  let catalog = await env.run({ only: 'Naruto' });
  assert.equal(env.requests(), 3);
  assert.equal(catalog.songs[0].flag, 'not resolved');
  assert.ok(catalog.songs[1].video);
  catalog = await env.run();
  assert.equal(env.requests(), 6);
  assert.ok(catalog.songs[0].video);
});

test('stale sidecar state cannot skip missing catalogue rows', async () => {
  const env = await sandbox();
  await env.run();
  await env.json('catalog.json', { generated: checked, songs: [] });
  const catalog = await env.run();
  assert.equal(env.requests(), 12);
  assert.ok(catalog.songs.every(song => song.video));
});

test('channel policy changes re-evaluate existing rows; bad overrides fail before requests', async () => {
  const env = await sandbox();
  await env.run();
  await env.json('channels.json', { ...channels, blocked: { reviewed: 'blocked' } });
  const catalog = await env.run();
  assert.equal(env.requests(), 10);
  assert.ok(catalog.songs.every(song => !song.video));
  await env.json('overrides.json', { 'FLOW | GO!!!': 'invalid' });
  await assert.rejects(env.run(), /Invalid override/);
  assert.equal(env.requests(), 10);
});

test('review puts flags first, escapes table cells, and lists every row', () => {
  const catalog = { generated: checked, songs: [
    { ...seed, video: { ...video(1), kind: 'tv' }, flag: null },
    { ...seed, title: 'A | B', video: null, flag: 'needs review' },
  ] };
  const markdown = reviewMarkdown(catalog);
  assert.ok(markdown.indexOf('needs review') < markdown.indexOf('## All songs'));
  assert.match(markdown, /A \\\| B/);
  assert.match(summary(catalog), /flagged 1/);
});
