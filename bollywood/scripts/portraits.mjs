import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeFetch } from '../../scripts/safe-fetch.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = join(root, '.cache'); await mkdir(cache, { recursive: true });
const seed = await readFile(join(root, 'data/seeds.csv'), 'utf8');
const names = [...new Set(seed.split(/\r?\n/).slice(1).filter(Boolean).map(line => line.match(/^(?:STARS|VOICES),([^,]+),/)?.[1]).filter(Boolean))];
const strip = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const fold = s => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const article = { Govinda: 'Govinda (actor)', Mukesh: 'Mukesh (singer)', Shaan: 'Shaan (singer)', KK: 'KK (singer)' };
let last = 0;
async function json(url) {
  const file = join(cache, createHash('sha256').update(url).digest('hex') + '.json');
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = 1500 - (Date.now() - last); if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try {
      last = Date.now(); const res = await safeFetch(url, { hosts: ['en.wikipedia.org'], headers: { 'User-Agent': 'BiasRouletteData/1.0 (static music game)' } });
      if (res.status === 404) return null; if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text(), parsed = JSON.parse(body); await writeFile(file, body); return parsed;
    } catch (e) { if (attempt === 3) throw e; console.warn(`retry ${e.message}`); await new Promise(r => setTimeout(r, [2000, 4000, 8000][attempt])); }
  }
}
const files = new Map(), missing = [];
for (const [i, name] of names.entries()) {
  const summary = await json(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent((article[name] ?? name).replace(/ /g, '_'))}?redirect=true`);
  const source = summary?.originalimage?.source?.split('?')[0];
  if (summary?.type !== 'standard' || !fold(summary.title ?? '').includes(fold(name)) || !/\b(?:actor|actress|singer|musician|composer)\b/i.test(summary.description ?? '') || /\b(?:band|group|duo|album|song|record label)\b/i.test(summary.description ?? '') || !source?.includes('/wikipedia/commons/')) missing.push(`${name}: no matching Commons lead portrait`);
  else {
    const file = decodeURIComponent(source.includes('/thumb/') ? source.split('/').slice(-2, -1)[0] : source.split('/').pop());
    if (/\.(?:jpe?g|png)$/i.test(file) && !/signature|logo|wax|memorial/i.test(file)) files.set(name, file); else missing.push(`${name}: lead image unsuitable`);
  }
  console.log(`${i + 1}/${names.length} ${name}`);
}
const info = new Map(), unique = [...new Set(files.values())];
for (let i = 0; i < unique.length; i += 15) {
  const titles = unique.slice(i, i + 15).map(f => `File:${f}`).join('|');
  const data = await json(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=600&titles=${encodeURIComponent(titles)}`);
  for (const p of Object.values(data?.query?.pages ?? {})) {
    const image = p.imageinfo?.[0], meta = image?.extmetadata ?? {};
    if (p.imagerepository !== 'shared' || !image || image.width < 200 || image.height < 200 || image.width > image.height * 2.2) continue;
    info.set(p.title.replace(/^File:/, '').replace(/_/g, ' '), { img: (image.thumburl || image.url).split('?')[0], file: p.title, page: image.descriptionurl, author: strip(meta.Artist?.value) || 'Unknown', license: strip(meta.LicenseShortName?.value) || 'see file page' });
  }
}
const out = {}, used = new Set();
for (const [name, file] of files) {
  const item = info.get(file.replace(/_/g, ' '));
  if (item && !used.has(item.file)) { out[name] = item; used.add(item.file); }
  else missing.push(`${name}: no usable unique Commons file`);
}
await writeFile(join(root, 'data/portraits.json'), JSON.stringify(out));
await writeFile(join(cache, 'portraits-report.txt'), `Portraits ${Object.keys(out).length}/${names.length}\n${missing.join('\n')}\n`);
console.log(`Portraits ${Object.keys(out).length}/${names.length}; details in .cache/portraits-report.txt`);
