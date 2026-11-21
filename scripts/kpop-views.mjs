// Builds data/kpop-views.json: YouTube view counts for every K-pop song video that the chart
// (data/charts.json) does not already score, so every card can show its MV views.
//   npm run kpop:views            (keeps known counts, fetches only the missing ones)
//   npm run kpop:views -- --fresh (fetches every count again)
// Then run npm run data:kpop to put the counts on the cards.
//
// Source: kworb.net's video page ("Total views"); when kworb does not track a video, the
// YouTube watch page's viewCount. Requests are spaced out and run three at a time.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { safeFetch } from './safe-fetch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'data', 'kpop-views.json');
const fresh = process.argv.includes('--fresh');
const ID = /^[\w-]{11}$/;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (bias-roulette stats builder)', 'Accept-Language': 'en' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(path.join(root, file), 'utf8')); } catch { return fallback; }
};

async function kworbViews(id) {
  const res = await safeFetch(`https://kworb.net/youtube/video/${id}.html`, { hosts: ['kworb.net'], headers: HEADERS });
  if (!res.ok) return 0;
  return Number((await res.text()).match(/Total views[^0-9]*([\d,]+)/)?.[1]?.replace(/,/g, '') || 0);
}

async function youtubeViews(id) {
  const res = await safeFetch(`https://www.youtube.com/watch?v=${id}`, { hosts: ['www.youtube.com'], headers: HEADERS });
  if (!res.ok) return 0;
  return Number((await res.text()).match(/"viewCount":"(\d+)"/)?.[1] || 0);
}

const [videos, charts, saved] = await Promise.all([
  readJson('data/videos.json', {}), readJson('data/charts.json', { top: [], newbie: [] }), readJson('data/kpop-views.json', {}),
]);
const scored = new Set([...charts.top, ...charts.newbie].map((e) => e.videoId));
const wanted = [...new Set(Object.values(videos).map((v) => v?.id).filter((id) => ID.test(id || '')))]
  .filter((id) => !scored.has(id));
const keep = new Set(wanted);
// Counts for videos no longer used (replaced, or now in the chart) are dropped.
const views = fresh ? {} : Object.fromEntries(Object.entries(saved.views || {}).filter(([id]) => keep.has(id)));
const todo = wanted.filter((id) => !views[id]);

console.log(`${todo.length} videos to look up (${Object.keys(views).length} already known).`);
let done = 0, fromKworb = 0, fromYoutube = 0;
const missing = [];
const save = () => writeFile(OUT, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), source: 'kworb.net, youtube.com', views }) + '\n');

async function worker() {
  while (todo.length) {
    const id = todo.shift();
    let n = 0;
    try { n = await kworbViews(id); if (n) fromKworb++; } catch { /* try YouTube */ }
    if (!n) {
      try { n = await youtubeViews(id); if (n) fromYoutube++; } catch { /* leave it out */ }
    }
    if (n) views[id] = n; else missing.push(id);
    if (++done % 50 === 0) { console.log(`${done} done`); await save(); }
    await sleep(350);
  }
}
await Promise.all([worker(), worker(), worker()]);
await save();
console.log(`Wrote data/kpop-views.json: ${Object.keys(views).length} counts (${fromKworb} kworb, ${fromYoutube} YouTube this run).`);
if (missing.length) console.log(`No count found (${missing.length}): ${missing.join(' ')}`);
