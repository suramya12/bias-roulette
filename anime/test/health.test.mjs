import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { healthEvidence, recordCheck, runHealth } from '../scripts/health.mjs';
import { watchMetadata, fanEligible, copySource, classify, orderCopies, parseSeedLine } from '../scripts/lib.mjs';
import { resolveSeed, runResolver, createPageLoader } from '../scripts/resolve.mjs';

const checked = '2026-11-17T00:00:00.000Z';
const seed = parseSeedLine('Artist | Song | Show | OP | 2020');
const channels = { trusted: { official: 'Reviewed' }, blocked: { blocked: 'Blocked' }, knownNames: ['Reviewed'] };
const id = n => String(n).padStart(11, '0');
const page = player => `var ytInitialPlayerResponse = ${JSON.stringify(player)};`;
const hd = { formats: [{ width: 1280, height: 720, qualityLabel: '720p' }] };
const player = (extra = {}) => ({ playabilityStatus: { status: 'OK', playableInEmbed: true },
  videoDetails: { viewCount: '1000000' }, streamingData: hd, ...extra });
const candidate = (n, extra = {}) => ({ id: id(n), title: 'Song opening', channel: 'Reviewed',
  channelId: 'official', seconds: 90, views: 10, ...extra });
const search = videos => `var ytInitialData = ${JSON.stringify({ contents: videos.map(v => ({ videoRenderer: {
  videoId: v.id, title: { simpleText: v.title }, lengthText: { simpleText: '1:30' },
  viewCountText: { simpleText: `${v.views} views` }, ownerText: { runs: [{ text: v.channel,
    navigationEndpoint: { browseEndpoint: { browseId: v.channelId } } }] },
} })) })};`;
const copy = n => ({ ...candidate(n), kind: 'tv', source: 'official', hd: true,
  quality: { hd: true, width: 1280, height: 720, checked }, checked });
const quiet = () => {};

test('synthetic fixture reads progressive HD, exact views and publishDate; adaptive dimensions also work', async () => {
  const html = await readFile(new URL('fixtures/watch-hd.html', import.meta.url), 'utf8');
  const m = watchMetadata(html, checked);
  assert.equal(m.hd, true); assert.equal(m.quality.height, 1080);
  assert.equal(m.quality.label, '1080p'); assert.equal(m.quality.checked, checked);
  assert.equal(m.views, 1234567); assert.equal(m.published, '2020-02-29');
  const adaptive = watchMetadata(page(player({ streamingData: { formats: [{ width: 640, height: 360 }],
    adaptiveFormats: [{ width: 2560, height: 1440, qualityLabel: '1440p' }] } })), checked);
  assert.equal(adaptive.hd, true); assert.equal(adaptive.quality.height, 1440);
});

test('missing, audio-only and label-only formats stay unknown; dimensions override misleading labels', () => {
  for (const streamingData of [undefined, {}, { adaptiveFormats: [{ mimeType: 'audio/webm' }] },
    { formats: [{ qualityLabel: '1080p' }] }]) {
    assert.equal(watchMetadata(page(player({ streamingData })), checked).hd, null);
  }
  assert.equal(watchMetadata(page(player({ streamingData: { formats: [{ width: 640, height: 360, qualityLabel: '1080p' }] } })), checked).hd, false);
  const sparse = watchMetadata(page(player({ videoDetails: {}, microformat: { playerMicroformatRenderer: { publishDate: '2024-99-30' } } })), checked);
  assert.equal(sparse.views, null); assert.equal(sparse.published, null);
});

test('fan eligibility uses OR, exact threshold, calendar anniversary and leap-day clamp', () => {
  assert.equal(fanEligible({ views: 1_000_000, published: null }, checked), true);
  assert.equal(fanEligible({ views: null, published: '2023-11-17' }, checked), true);
  assert.equal(fanEligible({ views: 999_999, published: '2023-11-18' }, checked), false);
  assert.equal(fanEligible({ views: null, published: null }, checked), false);
  assert.equal(fanEligible({ views: 0, published: '2021-02-28' }, '2024-02-29T00:00:00Z'), true);
  assert.equal(fanEligible({ views: 0, published: '2021-03-01' }, '2024-02-29T00:00:00Z'), false);
});

test('official requires reviewed channel ID; names and badges cannot establish it; edit markers are title scoped', () => {
  assert.equal(copySource(candidate(1), channels), 'official');
  assert.equal(copySource(candidate(1, { channelId: 'unknown', verified: true, officialArtist: true }), channels), 'fan');
  assert.equal(copySource(candidate(1, { channelId: 'official' }), { ...channels, blocked: { official: 'No' } }), 'fan');
  for (const marker of ['lyrics', 'nightcore', 'sped up', 'mirrored', 'extended', 'cover']) {
    assert.equal(classify(candidate(1, { title: `${marker} opening`, channel: 'Lyrics edits' }), { ...seed, title: marker }, channels).reject, undefined);
    assert.equal(classify(candidate(1, { title: `Song opening ${marker}` }), seed, channels).reject, 'excluded title');
  }
  assert.equal(classify(candidate(1, { title: 'Song full opening', channel: 'Lyrics edits' }), seed, channels).reject, undefined);
});

test('copy ordering keeps content/source tiers ahead of resolution; equal tiers prefer higher dimensions', () => {
  const items = [copy(1), { ...copy(2), kind: 'mv' }, { ...copy(3), source: 'fan', kind: 'creditless' },
    { ...copy(4), kind: 'creditless' }, { ...copy(5), quality: { width: 1920, height: 1080 } }];
  assert.deepEqual(orderCopies([...items, items[0]]).map(v => v.id), [id(4), id(5), id(1), id(2)]);
});

test('resolver collects four distinct valid copies beyond four failed checks, ranks HD, and never fetches booted IDs', async () => {
  const candidates = Array.from({ length: 10 }, (_, i) => candidate(i + 1));
  const calls = [];
  const result = await resolveSeed(seed, { channels, overrides: {}, checked, health: { [id(10)]: { booted: { at: checked, reason: 'removed' } } },
    loadPage: async url => {
      if (url.includes('/results?')) return search(candidates);
      const n = Number(url.slice(-11)); calls.push(n);
      return page(player({ streamingData: n <= 4 ? { formats: [{ width: 640, height: 360 }] } :
        { formats: [{ width: n === 9 ? 1920 : 1280, height: n === 9 ? 1080 : 720 }] } }));
    } });
  assert.deepEqual(calls, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(result.videos.map(v => v.id), [id(9), id(5), id(6), id(7)]);
  assert.deepEqual(result.video, result.videos[0]);
});

test('fan gates use watch metadata, never rounded search views; blocked IDs and fan MVs stay excluded', async () => {
  const candidates = [candidate(1, { channelId: 'fan', views: 999999999 }), candidate(2, { channelId: 'fan' }),
    candidate(3, { channelId: 'fan' }), candidate(4, { channelId: 'fan', title: 'Song MV' }), candidate(5, { channelId: 'blocked' })];
  const calls = [];
  const result = await resolveSeed(seed, { channels, overrides: {}, checked, loadPage: async url => {
    if (url.includes('/results?')) return search(candidates);
    const n = Number(url.slice(-11)); calls.push(n);
    return page(player({ videoDetails: n === 2 ? { viewCount: '1000000' } : {},
      microformat: { playerMicroformatRenderer: { publishDate: n === 3 ? '2020-01-01' : '2026-01-01' } } }));
  } });
  assert.deepEqual(result.videos.map(v => v.id), [id(2), id(3)]);
  assert.ok(!calls.includes(4) && !calls.includes(5));
});

test('healthy existing copies survive search and watch network failure; null overrides cannot refill', async () => {
  const options = { channels, overrides: {}, checked, existing: [copy(1)], loadPage: async () => { throw new Error('offline'); } };
  const result = await resolveSeed(seed, options);
  assert.deepEqual(result.videos, [copy(1)]); assert.equal(result.complete, false);
  const watchFailure = await resolveSeed(seed, { ...options, loadPage: async url => {
    if (url.includes('/results?')) return search([candidate(1)]);
    throw new Error('throttle');
  } });
  assert.deepEqual(watchFailure.videos, [copy(1)]);
  const drop = await resolveSeed(seed, { ...options, overrides: { 'Artist | Song': null }, loadPage: async () => assert.fail('drop fetched') });
  assert.deepEqual(drop.videos, []); assert.equal(drop.video, null);
});

test('health bans specific failures immediately, while generic/region failures earn strikes', () => {
  for (const reason of ['This video is private', 'Video removed by uploader', 'Video deleted', 'Account terminated', 'Embedding disabled']) {
    assert.equal(healthEvidence(page(player({ playabilityStatus: { status: 'ERROR', reason } })), checked).action, 'boot', reason);
  }
  assert.equal(healthEvidence(page(player({ playabilityStatus: { status: 'OK', playableInEmbed: false } })), checked).action, 'boot');
  for (const reason of ['Video unavailable', 'Not available in your country']) {
    assert.equal(healthEvidence(page(player({ playabilityStatus: { status: 'UNPLAYABLE', playableInEmbed: false, reason } })), checked).action, 'strike');
  }
  for (const reason of ['Sign in to confirm you’re not a bot', 'Autoplay denied', 'Error 153: client configuration']) {
    assert.equal(healthEvidence(page(player({ playabilityStatus: { status: 'ERROR', reason } })), checked).action, 'unknown');
  }
  assert.equal(healthEvidence('<html>challenge</html>', checked).action, 'unknown');
  assert.equal(healthEvidence(page(player({ playabilityStatus: { status: 'OK' } })), checked).action, 'unknown');
  assert.equal(healthEvidence(page(player({ streamingData: undefined })), checked).action, 'unknown');
  assert.equal(healthEvidence(page(player({ streamingData: { formats: [{ width: 640, height: 360 }] } })), checked).action, 'strike');
});

test('strikes are cumulative across successes and unknown checks', () => {
  const ledger = {};
  for (const action of ['strike', 'healthy', 'unknown', 'strike', 'healthy', 'strike']) {
    recordCheck(ledger, id(1), { action, reason: action }, checked);
  }
  assert.equal(ledger[id(1)].strikes.length, 3); assert.ok(ledger[id(1)].booted);
  recordCheck(ledger, id(1), { action: 'strike', reason: 'again' }, checked);
  assert.equal(ledger[id(1)].strikes.length, 3);
});

async function sandbox(songs = [{ ...seed, videos: [copy(1)], video: copy(1), flag: null }]) {
  const root = await mkdtemp(join(tmpdir(), 'anime-health-'));
  await mkdir(join(root, 'data', 'seeds'), { recursive: true });
  const json = (name, data) => writeFile(join(root, 'data', name), `${JSON.stringify(data)}\n`, 'utf8');
  await Promise.all([json('kinds.json', [{ id: 'theme', seed: 'themes.txt' }]), json('channels.json', channels),
    json('overrides.json', {}), json('health.json', {}), json('catalog.json', { generated: checked, songs }),
    writeFile(join(root, 'data', 'seeds', 'themes.txt'), 'Artist | Song | Show | OP | 2020\n', 'utf8')]);
  const read = async name => JSON.parse(await readFile(join(root, 'data', name), 'utf8'));
  return { root, json, read };
}

test('health checks each shared ID once, boot excludes refill, and emptied songs appear as set aside without changing seeds', async () => {
  const env = await sandbox([{ ...seed, videos: [copy(1)], video: copy(1) }, { ...seed, id: 'duplicate-reference', videos: [copy(1)] }]);
  const before = await readFile(join(env.root, 'data', 'seeds', 'themes.txt'), 'utf8');
  let watches = 0;
  const catalog = await runHealth({ root: env.root, now: () => checked, log: quiet, loadPage: async url => {
    if (url.includes('/results?')) return search([candidate(1)]);
    watches++;
    return page(player({ playabilityStatus: { status: 'ERROR', reason: 'Video deleted' } }));
  } });
  assert.equal(watches, 1); assert.ok((await env.read('health.json'))[id(1)].booted);
  assert.deepEqual(catalog.songs[0].videos, []); assert.equal(catalog.songs[0].video, null);
  assert.match(await readFile(join(env.root, 'REVIEW.md'), 'utf8'), /## Set aside[\s\S]*Artist.*Song/);
  assert.equal(await readFile(join(env.root, 'data', 'seeds', 'themes.txt'), 'utf8'), before);
});

test('health network errors never strike or erase healthy copies; a later independent check adds one strike', async () => {
  const env = await sandbox();
  const run = loadPage => runHealth({ root: env.root, loadPage, now: () => checked, log: quiet });
  let catalog = await run(async () => { throw new Error('HTTP 429'); });
  assert.equal(catalog.songs[0].video.id, id(1)); assert.deepEqual(await env.read('health.json'), {});
  const load = async url => url.includes('/results?') ? search([]) : page(player({ playabilityStatus: { status: 'UNPLAYABLE', reason: 'Video unavailable' } }));
  await run(load); await run(async url => url.includes('/results?') ? search([]) : page(player()));
  await run(load);
  assert.equal((await env.read('health.json'))[id(1)].strikes.length, 2);
  catalog = await run(load);
  assert.equal((await env.read('health.json'))[id(1)].strikes.length, 3);
  assert.equal(catalog.songs[0].video, null);
});

test('health bypasses disk cache, retry/backoff produces one strike, and subsequent requests keep 2.5 s pacing', async () => {
  const env = await sandbox(), url = `https://www.youtube.com/watch?v=${id(1)}`;
  const cacheDir = join(env.root, '.cache'); await mkdir(cacheDir);
  await writeFile(join(cacheDir, `${createHash('sha256').update(url).digest('hex')}.html`), page(player()));
  let time = 0, watches = 0;
  const starts = [], waits = [];
  await runHealth({ root: env.root, now: () => checked, log: quiet, pageLoaderOptions: {
    now: () => time, sleep: async ms => { waits.push(ms); time += ms; }, fetchImpl: async (address, options) => {
      starts.push(time); assert.equal(options.redirect, 'manual');
      if (address.includes('/watch?') && ++watches <= 3) return { status: watches === 2 ? 429 : 302, headers: { get: () => '/sorry' } };
      return { status: 200, ok: true, text: async () => address.includes('/results?') ? search([]) :
        page(player({ playabilityStatus: { status: 'UNPLAYABLE', reason: 'Video unavailable' } })) };
    },
  } });
  assert.equal(watches, 4); assert.deepEqual(waits, [15000, 45000, 120000, 2500, 2500]);
  assert.deepEqual(starts, [0, 15000, 60000, 180000, 182500, 185000]);
  assert.equal((await env.read('health.json'))[id(1)].strikes.length, 1);
});

test('exhausted network retries cannot become health strikes', async () => {
  const env = await sandbox();
  const loader = createPageLoader({ cacheDir: join(env.root, '.cache'), refresh: true, sleep: async () => {},
    fetchImpl: async () => { throw new Error('offline'); } });
  const catalog = await runHealth({ root: env.root, loadPage: loader, now: () => checked, log: quiet });
  assert.deepEqual(await env.read('health.json'), {}); assert.equal(catalog.songs[0].video.id, id(1));
});

test('policy/health changes and missing state invalidate resolution; videos are excluded from seed comparison', async () => {
  const env = await sandbox(); let calls = 0;
  const run = () => runResolver({ root: env.root, log: quiet, now: () => checked, loadPage: async url => {
    calls++; return url.includes('/results?') ? search([candidate(1)]) : page(player());
  } });
  await run(); const first = calls; assert.ok(first > 0);
  await run(); assert.equal(calls, first);
  const statePath = join(env.root, '.cache', 'resolve-state.json');
  await writeFile(statePath, '{}'); await run(); assert.ok(calls > first);
  const second = calls;
  await env.json('health.json', { [id(1)]: { strikes: [], booted: { at: checked, reason: 'removed' } } });
  const catalog = await run(); assert.ok(calls > second); assert.equal(catalog.songs[0].video, null);
});

test('health --help runs offline and invalid arguments fail before requests', () => {
  const cli = fileURLToPath(new URL('../scripts/health.mjs', import.meta.url));
  assert.match(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }), /Usage:.*health\.mjs/);
  assert.throws(() => execFileSync(process.execPath, [cli, '--bogus'], { stdio: 'pipe' }), /Command failed/);
});

test('health refills after an immediate boot, keeps healthy copies and does not recheck a booted override', async () => {
  const env = await sandbox([{ ...seed, videos: [copy(1), copy(2), copy(3), copy(4)], video: copy(1) }]);
  const calls = [];
  const catalog = await runHealth({ root: env.root, now: () => checked, log: quiet, loadPage: async url => {
    if (url.includes('/results?')) return search([candidate(1), candidate(5)]);
    const n = Number(url.slice(-11)); calls.push(n);
    return page(player(n === 1 ? { playabilityStatus: { status: 'ERROR', reason: 'This video is private' } } : {}));
  } });
  assert.deepEqual(catalog.songs[0].videos.map(v => v.id), [id(2), id(3), id(4), id(5)]);
  assert.deepEqual(calls, [1, 2, 3, 4, 5]);
  const manual = await resolveSeed(seed, { channels, overrides: { 'Artist | Song': id(1) }, checked,
    health: await env.read('health.json'), loadPage: async () => assert.fail('booted override fetched') });
  assert.equal(manual.video, null); assert.match(manual.flag, /booted/);
});

test('health keeps full healthy queues without searches; null overrides skip checks and refill', async () => {
  const env = await sandbox([{ ...seed, videos: [copy(1), copy(2), copy(3), copy(4)], video: copy(1) }]);
  let watches = 0;
  const catalog = await runHealth({ root: env.root, now: () => checked, log: quiet, loadPage: async url => {
    assert.ok(url.includes('/watch?')); watches++; return page(player());
  } });
  assert.equal(watches, 4); assert.equal(catalog.songs[0].videos.length, 4);
  await env.json('overrides.json', { 'Artist | Song': null });
  const dropped = await runHealth({ root: env.root, now: () => checked, log: quiet,
    loadPage: async () => assert.fail('null override fetched') });
  assert.equal(dropped.songs[0].video, null); assert.deepEqual(dropped.songs[0].videos, []);
});

test('a full queue cannot bypass changed channel policy during refill', async () => {
  const env = await sandbox([{ ...seed, videos: [copy(1), copy(2), copy(3), copy(4)], video: copy(1) }]);
  await env.json('channels.json', { ...channels, trusted: {} });
  const catalog = await runResolver({ root: env.root, refill: true, now: () => checked, log: quiet,
    loadPage: async url => { assert.ok(url.includes('/results?')); return search([]); } });
  // These old copies have no exact age/views evidence and no reviewed channel.
  assert.deepEqual(catalog.songs[0].videos, []);
});

test('unknown HD cannot enter new queues or bypass gates through overrides', async () => {
  const loadPage = async url => url.includes('/results?') ? search([candidate(1)]) : page(player({
    videoDetails: { title: 'Song opening', author: 'Reviewed', channelId: 'official', lengthSeconds: '90' }, streamingData: undefined,
  }));
  const options = { channels, overrides: {}, checked, loadPage };
  const automatic = await resolveSeed(seed, options);
  assert.equal(automatic.video, null); assert.match(automatic.flag, /unknown HD quality/);
  const manual = await resolveSeed(seed, { ...options, overrides: { 'Artist | Song': id(1) } });
  assert.equal(manual.video, null); assert.match(manual.flag, /unknown HD quality/);
});

test('shipped catalog retains legacy playback fields, unknown metadata and compatibility aliases', async () => {
  const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  for (const song of catalog.songs) {
    assert.ok(Array.isArray(song.videos)); assert.ok(song.videos.length <= 4);
    assert.deepEqual(song.video, song.videos[0] ?? null);
    for (const video of song.videos) {
      assert.ok(['official', 'fan'].includes(video.source));
      assert.ok(Object.hasOwn(video, 'views') && Object.hasOwn(video, 'published'));
      if (video.quality?.source === 'unverified-legacy') {
        assert.equal(video.hd, null); assert.equal(video.quality.checked, null);
      }
    }
  }
});
