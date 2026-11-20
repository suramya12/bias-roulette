import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { safeFetch } from '../../scripts/safe-fetch.mjs';
import { escapeMarkdown as cell } from '../../scripts/safe-text.mjs';
import { extractInitialData, videosFromSearch, extractPlayerResponse, playability } from '../../anime/scripts/lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = join(root, '.cache');
await mkdir(cache, { recursive: true });
const parseCSV = text => {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const keys = rows.shift(); return rows.map(r => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
};
const rows = parseCSV(await readFile(join(root, 'data/seeds.csv'), 'utf8'));
const fold = s => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const phonetic = s => fold(s).replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/ei/g, 'e').replace(/w/g, 'v').replace(/(.)\1+/g, '$1').split(' ').map(w => w.length > 3 ? w.replace(/n$/, '') : w).join(' ');
const contains = (hay, needle) => !!needle && (` ${phonetic(hay)} `).includes(` ${phonetic(needle)} `);
const names = rows.filter(r => r.deck === 'STARS').map(r => r.name).filter((v, i, a) => a.indexOf(v) === i);
const singers = [...new Set(rows.flatMap(r => r.singers.split(',').map(s => s.trim()).filter(Boolean)))];
const films = [...new Set([...rows.map(r => r.film), 'Tera Mera Saath Rahe', 'Kahan Shuru Kahan Khatam'].filter(f => f.split(/\s+/).length >= 3 && f.length >= 12))];
function searchVideos(data) {
  const result = videosFromSearch(data), seen = new Set(result.map(v => v.id)), stack = [data];
  while (stack.length) {
    const node = stack.pop(); if (!node || typeof node !== 'object') continue;
    const v = node.lockupViewModel;
    if (v?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && v.contentId && !seen.has(v.contentId)) {
      const m = v.metadata?.lockupMetadataViewModel, avatar = m?.image?.decoratedAvatarViewModel;
      const parts = (m?.metadata?.contentMetadataViewModel?.metadataRows ?? []).flatMap(r => r.metadataParts ?? []);
      const channel = avatar?.a11yLabel?.replace(/^Go to channel /, '').replace(/ and d+ more$/, '') ?? '';
      const channelId = avatar?.rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint?.browseId ?? '';
      const duration = (v.contentImage?.thumbnailViewModel?.overlays ?? []).flatMap(o => o.thumbnailBottomOverlayViewModel?.badges ?? []).map(b => b.thumbnailBadgeViewModel?.text).find(t => /^\d+(?::\d{2}){1,2}$/.test(t ?? ''));
      const seconds = duration ? duration.split(':').reduce((n, p) => n * 60 + Number(p), 0) : 0;
      const viewsText = parts.map(p => p.text?.content ?? '').find(t => /^\d[\d,.]*\s*[KMB]?\s*(?:views?)?$/i.test(t));
      const match = viewsText?.match(/^([\d,.]+)\s*([KMB])?/i);
      const views = match ? Number(match[1].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase()] ?? 1) : 0;
      result.push({ id: v.contentId, title: m?.title?.content ?? '', channel, channelId, seconds, views }); seen.add(v.contentId);
    }
    for (const value of Object.values(node).reverse()) if (value && typeof value === 'object') stack.push(value);
  }
  return result;
}
const groups = new Map();
for (const row of rows) { const key = `${fold(row.song)}|${fold(row.film)}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
const allow = /^(?:T-Series|YRF|Yash Raj Films|Saregama Music|Saregama India|Saregama GenY|Saregama Hum Bhojpuri|Saregama Music Tamil|Sony Music India|Zee Music Company|Tips Official|Tips Music|Eros Now Music|Shemaroo Filmi Gaane|Venus|Venus Movies|Ultra Bollywood|Rajshri|Goldmines Gaane Sune Ansune|Red Chillies Entertainment|Dharma Productions|Excel Entertainment|Junglee Music|Ultra Classic|Shemaroo Romantic Songs|Universal Music India|Rajshri Music|Tips Films|Eros Now|Saregama Classics|Aditya Music|Lahari Music|Sony Music South|Think Music India|Saregama Tamil|Saregama Telugu|T-Series Telugu|T-Series Tamil|Mango Music|Sun TV|Divo Music|Sony Music Kannada|Zee Music South|Speed Records)$/i;
const reject = /\b(?:audio|lyrical|lyrics?|jukebox|teaser|trailer|unplugged|covers?|8d|slowed|reverb|lo[ -]?fi|mashup|karaoke|instrumental|status|shorts|making|live|concert|revival|remix|remake)\b|\b(?:lp|original) recording\b|behind[ -]the[ -]scenes/i;
let last = 0;
async function page(url) {
  const file = join(cache, createHash('sha256').update(url).digest('hex') + '.html');
  try { return await readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = 2500 - (Date.now() - last); if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try {
      last = Date.now(); const response = await safeFetch(url, { hosts: ['www.youtube.com'], headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en', Cookie: 'SOCS=CAI; CONSENT=YES+1' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (url.includes('/results?')) extractInitialData(html); else extractPlayerResponse(html);
      await writeFile(file, html); return html;
    } catch (e) { if (attempt === 3) throw e; console.warn(`retry ${attempt + 1}: ${e.message}`); await new Promise(r => setTimeout(r, [15000, 45000, 120000][attempt])); }
  }
}
function gate(v, seed, search = false) {
  if (!(search && !v.channel) && !allow.test(v.channel)) return false;
  const hindi = /[ऀ-ॿ]/;
  if (search && hindi.test(v.title)) return !v.seconds || (v.seconds >= 90 && v.seconds <= 600); // localized title: real check on the English watch page
  if (!contains(v.title, seed.song) || reject.test(v.title)) return false;
  if (/\breprise\b/i.test(v.title) && !/\breprise\b/i.test(seed.song)) return false;
  if (/\b(?:female|male) version\b/i.test(v.title) && !/\b(?:female|male) version\b/i.test(seed.song)) return false;
  const otherFilm = films.some(f => fold(f) !== fold(seed.film) && contains(v.title, f));
  if (otherFilm && !contains(v.title, seed.film)) return false;
  const titleSingers = singers.filter(n => contains(v.title, n) && !contains(seed.composer, n));
  if (titleSingers.length && !seed.singers.split(',').some(n => contains(v.title, n.trim()))) return false;
  return ((search && !v.seconds) || (v.seconds >= 90 && v.seconds <= 600)) && (contains(v.title, seed.film) || seed.picturised_on.split(',').some(s => contains(v.title, s.trim())) || /\b(?:full video|video song)\b/i.test(v.title));
}
const unknown = new Map(), output = [], dropped = [], flagged = [], used = new Set();
for (const [index, [key, group]] of [...groups].entries()) {
  const seed = group[0];
  const picks = [], checkedIds = new Set();
  for (const query of [`${seed.song} ${seed.film} official video song`, `${seed.song} ${seed.film}`]) {
    const candidates = searchVideos(extractInitialData(await page(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`)));
    if (!candidates.length) { console.warn(`No videos parsed for ${query}`); continue; }
    for (const v of candidates) if (!allow.test(v.channel)) unknown.set(`${v.channel}|${v.channelId}`, (unknown.get(`${v.channel}|${v.channelId}`) ?? 0) + 1);
    for (const candidate of candidates.filter(v => gate(v, seed, true)).sort((a, b) => (b.views ?? 0) - (a.views ?? 0))) {
      if (used.has(candidate.id) || checkedIds.has(candidate.id)) continue; checkedIds.add(candidate.id);
      let html = await page(`https://www.youtube.com/watch?v=${candidate.id}`);
      if (/[ऀ-ॿ]/.test(extractPlayerResponse(html).videoDetails?.title ?? '')) html = await page(`https://www.youtube.com/watch?v=${candidate.id}&hl=en&gl=US`);
      const check = playability(html), details = extractPlayerResponse(html).videoDetails ?? {};
      const actual = { ...candidate, title: details.title ?? '', channel: details.author ?? '', seconds: Number(details.lengthSeconds), views: Number(details.viewCount) || 0 };
      if (check.status === 'OK' && check.embed === true && gate(actual, seed)) picks.push(actual);
      if (picks.length === 3) break;
    }
    if (picks.length) break;
  }
  if (!picks.length) dropped.push({ seed, reason: 'No candidate passed channel, identity, duration and embed checks.' });
  else {
    picks.sort((a, b) => b.views - a.views); const best = picks[0]; used.add(best.id);
    const stars = [...new Set(group.flatMap(r => r.picturised_on.split(',').map(s => s.trim()).filter(Boolean)))];
    const titleStars = names.filter(n => contains(best.title, n));
    if (titleStars.length && !stars.some(n => contains(best.title, n))) flagged.push({ seed, reason: `Title names ${titleStars.join(', ')} but no listed star: ${best.title}` });
    output.push({ key, group, song: { id: best.id, t: seed.song, film: seed.film, year: Number(seed.year), singers: seed.singers.split(',').map(s => s.trim()).filter(Boolean), composer: seed.composer, stars, v: best.views, backups: picks.slice(1).map(p => p.id) }, channel: best.channel, title: best.title });
  }
  console.log(`${index + 1}/${groups.size}: ${seed.song} | ${seed.film}: ${picks.length ? picks[0].id : 'dropped'}`);
  await emit();
}
async function emit() {
  const songs = output.map(o => o.song).sort((a, b) => b.v - a.v || a.t.localeCompare(b.t)); songs.forEach((s, i) => { s.o = i + 1; });
  const artistMap = new Map();
  for (const item of output) for (const r of item.group) { const key = `${r.deck}|${r.name}`; if (!artistMap.has(key)) artistMap.set(key, { name: r.name, deck: r.deck.toLowerCase(), songs: [] }); const a = artistMap.get(key); if (!a.songs.includes(item.song.id)) a.songs.push(item.song.id); }
  for (const r of rows) { const key = `${r.deck}|${r.name}`; if (!artistMap.has(key)) artistMap.set(key, { name: r.name, deck: r.deck.toLowerCase(), songs: [] }); }
  const artists = [...artistMap.values()].filter(a => a.songs.length >= 3); const removed = [...artistMap.values()].filter(a => a.songs.length < 3);
  const byId = new Map(songs.map(s => [s.id, s])); const totals = artists.map(a => a.songs.reduce((n, id) => n + byId.get(id).v, 0)); const max = Math.max(1, ...totals);
  artists.forEach((a, i) => { a.power = Math.max(1, Math.min(10, Math.ceil(10 * Math.log1p(totals[i]) / Math.log1p(max)))); });
  await writeFile(join(process.env.BOLLY_OUT || root, 'data/data.json'), JSON.stringify({ updated: new Date().toISOString().slice(0, 10), artists, songs }));
  const line = x => `- ${cell(x.seed.song)} | ${cell(x.seed.film)}: ${cell(x.reason)}`;
  const report = [`# Bollywood resolution review`, ``, `Processed ${output.length + dropped.length} / ${groups.size}; resolved ${output.length}; flagged ${flagged.length}; dropped ${dropped.length}.`, `Artists: stars ${artists.filter(a => a.deck === 'stars').length}; voices ${artists.filter(a => a.deck === 'voices').length}; dropped ${removed.length}.`, `Unknown channels: ${unknown.size} unique channel/name pairs.`, '', '## Resolved', ...output.map(x => `- ${cell(x.song.t)} | ${cell(x.song.film)}: ${cell(x.song.id)} | ${cell(x.channel)} | ${cell(x.title)}`), '', '## Flagged', ...flagged.map(line), '', '## Dropped songs', ...dropped.map(line), '', '## Dropped artists (fewer than 3 resolved songs)', ...removed.map(a => `- ${cell(a.name)} (${cell(a.deck)}): ${a.songs.length}`), '', '## Unknown channels', ...[...unknown].sort((a, b) => b[1] - a[1]).map(([name, count]) => `- ${cell(name)}: ${count}`), ''];
  await writeFile(join(process.env.BOLLY_OUT || root, 'REVIEW.md'), report.join('\n'));
}
