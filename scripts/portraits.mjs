// Finds a freely licensed portrait for every idol: data/portraits.json.
//   npm run portraits            (cached in .cache/wiki)
//   npm run portraits -- --fresh
//
// For each idol: search English Wikipedia, accept the first article whose intro names
// both the idol and their group (or says singer/rapper for soloists), take its lead image,
// and keep it only if it is hosted on Wikimedia Commons (free licence). Author and licence
// are stored so the cards can credit the photo. Idols with no verified photo are listed;
// the app falls back to a music video still for them.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, '.cache', 'wiki');
const fresh = process.argv.includes('--fresh');
const UA = 'BiasRoulette-portraits/1.0 (static fan site; contact via repository)';
const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
// How group names appear in article text, when it differs from the roster label.
const GROUP_TEXT = { '(G)I-DLE': ['idle', 'gidle'], TXT: ['tomorrowxtogether'], 'NCT / WayV': ['nct', 'wayv'], VIVIZ: ['viviz', 'gfriend'], LOONA: ['loona', 'loona'], "Girls' Generation": ['girlsgeneration'] };
// Search hints for names that are ambiguous on their own.
const HINT = {};
// Exact articles, checked by hand, where search finds the wrong person or misses:
// "Jihoon" is TREASURE's Park Jihoon, not the Wanna One soloist.
const TITLE = {
  'Park Jihoon': 'Park Ji-hoon', Hanni: 'Hanni (singer)', Haerin: 'Haerin', Miyeon: 'Miyeon',
  Mingyu: 'Mingyu', Eunkwang: 'Seo Eun-kwang', Woojin: 'Park Woo-jin',
};

async function getJson(url, key) {
  const f = path.join(cacheDir, key.replace(/[^\w.-]+/g, '_').slice(0, 120) + '.json');
  if (!fresh) { try { return JSON.parse(await readFile(f, 'utf8')); } catch { /* not cached */ } }
  for (let attempt = 0; ; attempt++) {
    await new Promise((r) => setTimeout(r, 1100)); // stay well under Wikimedia's rate limits
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 8000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    await writeFile(f, JSON.stringify(json));
    return json;
  }
}

const strip = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function find(idol, group) {
  const solo = group.label === 'Solo';
  const groupWords = solo ? [] : (GROUP_TEXT[group.label] || [norm(group.label)]);
  const q = HINT[idol.name] || `${idol.name} ${solo ? '' : group.label} singer`;
  const exact = TITLE[idol.name];
  const url = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', prop: 'pageimages|extracts|info', inprop: 'url', piprop: 'name',
    exintro: '1', explaintext: '1', exsentences: '4', exlimit: 'max', redirects: '1',
    ...(exact ? { titles: exact } : { generator: 'search', gsrsearch: q, gsrlimit: '5' }),
  });
  const data = await getJson(url, exact ? `t_${exact}` : `s_${q}`);
  const pages = Object.values(data.query?.pages || {}).sort((a, b) => a.index - b.index);
  const name = norm(idol.name);
  for (const p of pages) {
    const text = norm(p.extract || '');
    // The article must be about the person, not their group.
    const title = norm(p.title.replace(/\(.*\)/, ''));
    const lead = norm((p.extract || '').split(/[.(]/)[0] + ' ' + (p.extract || '').slice(0, 220));
    const isGroupPage = groupWords.some((g) => title === g) || /\((?:[\w ]*group|[\w ]*band)\)/i.test(p.title);
    const nameOk = !isGroupPage && (title.includes(name) || name.includes(title) || lead.includes(name));
    const groupOk = solo ? /singer|rapper|entertainer/.test(p.extract || '') : groupWords.some((g) => text.includes(g));
    if (!exact && (!nameOk || !groupOk)) continue;
    if (!p.pageimage) return { page: p.fullurl, why: 'article has no image' };
    const info = await getJson('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
      action: 'query', format: 'json', titles: `File:${p.pageimage}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '480',
    }), `f_${p.pageimage}`);
    const ii = Object.values(info.query?.pages || {})[0]?.imageinfo?.[0];
    if (!ii) return { page: p.fullurl, why: 'image is not on Commons' };
    const meta = ii.extmetadata || {};
    return {
      src: ii.thumburl || ii.url,
      page: p.fullurl,
      file: ii.descriptionurl,
      author: strip(meta.Artist?.value) || 'Unknown',
      license: strip(meta.LicenseShortName?.value) || 'see file page',
      article: p.title,
    };
  }
  return { why: `no article matched (${pages.map((p) => p.title).join(', ') || 'no results'})` };
}

async function main() {
  await mkdir(cacheDir, { recursive: true });
  const roster = JSON.parse(await readFile(path.join(root, 'data', 'roster.json'), 'utf8'));
  const out = {};
  const misses = [];
  const seen = new Map();
  for (const idol of roster.idols) {
    const group = roster.groups.find((g) => g.id === idol.group);
    let r;
    try { r = await find(idol, group); } catch (e) { r = { why: e.message }; }
    if (r.src) {
      if (seen.has(r.src)) { misses.push(`${idol.name}: same photo as ${seen.get(r.src)} (${r.article})`); continue; }
      seen.set(r.src, idol.name);
      out[idol.name] = r;
    } else misses.push(`${idol.name} (${group.label}): ${r.why}`);
  }
  await writeFile(path.join(root, 'data', 'portraits.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(`Portraits: ${Object.keys(out).length} of ${roster.idols.length}.`);
  console.log('  ' + Object.entries(out).map(([n, r]) => `${n}=${r.article}`).join(' | '));
  if (misses.length) console.log(`\nNo photo (${misses.length}):\n  ` + misses.join('\n  '));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
