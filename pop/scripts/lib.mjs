// Shared helpers for the data scripts: cached fetch, text normalising, HTML decoding.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { safeFetch } from '../../scripts/safe-fetch.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE = join(ROOT, '.cache');
export const FRESH = process.argv.includes('--fresh');
const UA = 'music-card-game-data-builder/1.0 (static hobby site; contact via repository)';
const hosts = ['kworb.net', 'www.youtube.com', 'en.wikipedia.org'];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET a URL as text, caching it in .cache/. Backs off on 429/5xx. Returns null on 404. */
export async function getText(url, { delay = 250, json = false } = {}) {
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, createHash('sha1').update(url).digest('hex') + (json ? '.json' : '.html'));
  if (!FRESH && existsSync(file)) {
    const body = await readFile(file, 'utf8');
    return body === '__404__' ? null : body;
  }
  for (let attempt = 0, wait = 2000; attempt < 6; attempt++, wait *= 2) {
    await sleep(delay);
    let res;
    try {
      res = await safeFetch(url, { hosts, headers: { 'user-agent': UA, 'api-user-agent': UA } });
    } catch (e) {
      await sleep(wait);
      continue;
    }
    if (res.status === 404) { await writeFile(file, '__404__'); return null; }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after')) * 1000;
      console.warn(`  ${res.status} on ${url}, waiting ${(ra || wait) / 1000}s`);
      await sleep(ra || wait);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const body = await res.text();
    await writeFile(file, body);
    return body;
  }
  throw new Error(`gave up on ${url}`);
}

export const getJSON = async (url, o = {}) => {
  const t = await getText(url, { ...o, json: true });
  return t == null ? null : JSON.parse(t);
};

export function decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** Lower-case, accent-free, curly-quote-free. */
export function fold(s) {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’‚‛′`´]/g, "'").replace(/[“”„‟″]/g, '"')
    .replace(/[–—]/g, '-').replace(/&/g, ' and ').replace(/\$/g, 's')
    .toLowerCase();
}

/** Remove (feat. …), (with …), - From "…", (Taylor's Version), remaster tags. Keeps the rest. */
export function cleanTitle(t) {
  let s = t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/\s*[([](?:feat\.?|ft\.?|featuring|with|con|prod\.?)\s[^)\]]*[)\]]/gi, '');
  s = s.replace(/\s+(?:feat\.?|ft\.?|featuring)\s.*$/i, '');
  s = s.replace(/\s*[([][^)\]]*(?:version|remaster|edit|mix|from |soundtrack|bonus|deluxe|live|demo|acoustic|sped up|slowed)[^)\]]*[)\]]/gi, '');
  s = s.replace(/\s+-\s+(?:from|remaster|radio|single|live|feat|with|bonus|sped|slowed|.*\bversion\b|.*\bremix\b|.*\bmix\b|.*\bedit\b).*$/i, '');
  s = s.replace(/\s*\[[^\]]*\]/g, '').replace(/\s+-\s+.*$/, '');
  return s.trim() || t.trim();
}

/** Matching key for a title: native script with an English name in brackets resolves to the English name. */
export function key(t) {
  let s = cleanTitle(t);
  const br = s.match(/^[^\x00-\x7F]+\s*[([]([\x00-\x7F]+)[)\]]$/);
  if (br) s = br[1];
  s = fold(s).replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(/\s+-\s.*$/, '');
  const k = s.replace(/[^a-z0-9\u0080-￿]+/g, '');
  return k || fold(t).replace(/[^a-z0-9\u0080-￿]+/g, '');
}

export const num = (s) => Number(String(s).replace(/[^0-9]/g, '')) || 0;

export async function writeJSON(rel, data) {
  const file = join(ROOT, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return file;
}
export const readJSON = async (rel) => JSON.parse(await readFile(join(ROOT, rel), 'utf8'));
