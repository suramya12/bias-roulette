import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { playability, watchMetadata } from './lib.mjs';
import { createPageLoader, readJSON, runResolver } from './resolve.mjs';

const animeRoot = fileURLToPath(new URL('../', import.meta.url));
const usage = `Usage: node anime/scripts/health.mjs [--help]

Re-check stored copies with fresh watch pages, record cumulative strikes in
anime/data/health.json, remove booted copies, and refill queues below four.
Network, throttle, challenge and parsing errors never earn strikes.
Requests use the resolver's 2.5 s pacing and 15/45/120 s backoff.
  --help, -h   Print help without reading files or making requests.
`;

// Only specific evidence can ban immediately. Generic unavailability and
// regional restrictions receive one strike per run, regardless of retries.
export function healthEvidence(html, checked) {
  const p = playability(html), reason = p.reason || p.status;
  if (!p.parsed || /captcha|challenge|unusual traffic|confirm you.re not a bot|sign in to confirm|consent|autoplay|\b153\b|client configuration/i.test(reason)) {
    return { action: 'unknown', reason };
  }
  if (/country|region|geograph|location/i.test(reason)) return { action: 'strike', reason };
  if (/\bprivate\b|\b(?:deleted|removed)\b|account.{0,40}terminated|(?:embedding|playback on other websites).{0,40}(?:disabled|not allowed)/i.test(reason) ||
      (p.status === 'OK' && p.embed === false)) return { action: 'boot', reason: p.reason || 'embedding explicitly disabled' };
  if (p.status !== 'OK' && p.status !== 'UNKNOWN') return { action: 'strike', reason };
  if (p.status !== 'OK' || p.embed !== true) return { action: 'unknown', reason: 'missing playability/embed evidence' };
  const metadata = watchMetadata(html, checked);
  if (metadata.hd === false) return { action: 'strike', reason: 'SD source', metadata };
  if (metadata.hd === null) return { action: 'unknown', reason: 'unknown HD quality', metadata };
  return { action: 'healthy', reason: 'playable HD', metadata };
}

export function recordCheck(ledger, id, evidence, at) {
  const entry = ledger[id] ??= { strikes: [] };
  entry.strikes ??= [];
  if (entry.booted) return entry;
  if (evidence.action === 'strike') entry.strikes.push({ at, reason: evidence.reason });
  if (evidence.action === 'boot' || entry.strikes.length >= 3) {
    entry.booted = { at, reason: evidence.action === 'boot' ? evidence.reason : `3 total strikes: ${evidence.reason}` };
  }
  return entry;
}

export async function runHealth({ root = animeRoot, loadPage, pageLoaderOptions = {}, log = console.log,
  now = () => new Date().toISOString() } = {}) {
  const dataDir = join(root, 'data');
  const [catalog, ledger, overrides] = await Promise.all([
    readJSON(join(dataDir, 'catalog.json'), { songs: [] }),
    readJSON(join(dataDir, 'health.json'), {}), readJSON(join(dataDir, 'overrides.json'), {}),
  ]);
  // One loader for checks and refill keeps pacing continuous and each ID's
  // evidence independent of request retries. Disk cache is always bypassed.
  const loader = loadPage ?? createPageLoader({ ...pageLoaderOptions, cacheDir: join(root, '.cache'), refresh: true });
  const copies = new Map();
  for (const song of catalog.songs) {
    if (Object.hasOwn(overrides, `${song.artist} | ${song.title}`) && overrides[`${song.artist} | ${song.title}`] === null) continue;
    for (const video of song.videos ?? (song.video ? [song.video] : [])) copies.set(video.id, video);
  }
  const results = new Map();
  for (const [id] of copies) {
    if (ledger[id]?.booted) continue;
    const checked = now();
    try {
      const evidence = healthEvidence(await loader(`https://www.youtube.com/watch?v=${id}`), checked);
      recordCheck(ledger, id, evidence, checked);
      results.set(id, evidence);
      log(`${id}: ${evidence.action} (${evidence.reason})`);
    } catch (error) { log(`${id}: check skipped (${error.message})`); }
  }
  for (const song of catalog.songs) {
    const dropped = Object.hasOwn(overrides, `${song.artist} | ${song.title}`) && overrides[`${song.artist} | ${song.title}`] === null;
    song.videos = dropped ? [] : (song.videos ?? (song.video ? [song.video] : []))
      .filter(v => !ledger[v.id]?.booted).map(v => {
        const evidence = results.get(v.id);
        return evidence?.action === 'healthy' ? { ...v,
          ...Object.fromEntries(Object.entries(evidence.metadata).filter(([, value]) => value !== undefined)),
          checked: evidence.metadata.quality.checked } : v;
      });
    song.video = song.videos[0] ?? null;
    if (dropped) song.flag = 'dropped by override';
    else if (!song.video) song.flag = 'set aside: no eligible HD copy';
  }
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, 'health.json'), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  await writeFile(join(dataDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  return runResolver({ root, refill: true, loadPage: loader, log, now });
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--help', '-h'].includes(arg))) throw new Error(`Unknown argument: ${args.find(arg => !['--help', '-h'].includes(arg))}`);
  if (args.length) { console.log(usage); return; }
  await runHealth();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
