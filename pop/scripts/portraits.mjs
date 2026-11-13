// Picks a freely licensed Wikimedia Commons photo for every artist card.
//   node scripts/portraits.mjs [--fresh]
// - Only the article about that person (pinned in roster.mjs) is used, never their band's.
// - Only files hosted on Commons are accepted; non-free local uploads are skipped.
// - Requests are batched (50 files per API call) and back off on HTTP 429.
// - Artists with no usable photo get a frame from an MV they lead; no two artists share a picture.
import { getJSON, fold, readJSON, writeJSON } from './lib.mjs';
import { ALL as ROSTER } from './roster.mjs';

// Pin an exact Commons file when the article's lead image is wrong: name -> 'File name.jpg'.
const FILE = {
  'Justin Bieber': 'Justin Bieber in 2015.jpg',
  'Travis Scott': 'TravisScott-byPhilipRomano (cropped).jpg',
};

const W = 'https://en.wikipedia.org';
const strip = (h = '') => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const NOT_PERSON = /\b(band|group|duo|trio|quartet|boy band|girl group|record label|album|song)\b/i;
const tokens = (name) => fold(name).split(/[^a-z0-9]+/).filter((t) => t.length > 2);
const norm = (f) => decodeURIComponent(f).replace(/^File:/, '').replace(/_/g, ' ');
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Commons file info for many files, 50 per request, through en.wikipedia ("shared" = on Commons). */
async function fileInfo(files) {
  const out = new Map();
  for (const part of chunks([...new Set(files.map(norm))], 15)) {
    const q = part.map((f) => 'File:' + f).join('|');
    const j = await getJSON(`${W}/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=600&titles=${encodeURIComponent(q)}`, { delay: 1500 });
    const alias = new Map((j?.query?.normalized || []).map((n) => [n.to, n.from]));
    for (const p of Object.values(j?.query?.pages || {})) {
      if (p.imagerepository !== 'shared' || !p.imageinfo) continue;
      const i = p.imageinfo[0], m = i.extmetadata || {};
      const info = { img: (i.thumburl || i.url).split('?')[0], file: p.title, page: i.descriptionurl, author: strip(m.Artist?.value) || 'Unknown', license: strip(m.LicenseShortName?.value) || 'see file page', w: i.width, h: i.height };
      out.set(norm(p.title), info);
      if (alias.has(p.title)) out.set(norm(alias.get(p.title)), info);
    }
  }
  return out;
}
const usable = (p) => p && p.w >= 200 && p.h >= 200 && p.w <= p.h * 2.2;

// 1. Article summaries (REST): checks it is about the person and gives the lead image.
const cand = new Map(); // name -> [file names in preference order]
const why = new Map();
for (const r of ROSTER) {
  const list = FILE[r.name] ? [FILE[r.name]] : [];
  const sum = await getJSON(`${W}/api/rest_v1/page/summary/${encodeURIComponent(r.wiki.replace(/ /g, '_'))}?redirect=true`, { delay: 120 });
  if (!sum || sum.type !== 'standard') why.set(r.name, `no article (${sum?.type})`);
  else if (r.kind === 'person' && NOT_PERSON.test(sum.description || '')) why.set(r.name, `article is not a person: ${sum.description}`);
  else {
    const lead = (sum.originalimage?.source || '').split('?')[0];
    if (lead.includes('/wikipedia/commons/')) r.lead = decodeURIComponent(lead.includes('/thumb/') ? lead.split('/').slice(-2, -1)[0] : lead.split('/').pop());
    r.article = sum.titles?.canonical || r.wiki;
  }
  cand.set(r.name, list);
}

// 2. Images in each article. Preference: lead image named after the person, then other files
//    named after them, then an unnamed lead image. Signatures, logos and band photos are skipped.
const named = (r, f) => tokens(r.name).some((t) => fold(f).includes(t));
const bad = (r, f) => /signature|_sig.|bsig.|autograph|logo|mugshot|tussauds|wax|memorial|memoriam|\.svg$|\.gif$/i.test(f) || (r.kind === 'person' && r.bands.some((b) => fold(f).includes(fold(b))) && !/crop/i.test(f));
const others = new Map(ROSTER.map((r) => [r.name, []]));
const withArticle = ROSTER.filter((r) => r.article);
for (const part of chunks(withArticle, 40)) {
  let cont = '';
  do {
    const j = await getJSON(`${W}/w/api.php?action=query&format=json&prop=images&imlimit=max&redirects=1&titles=${encodeURIComponent(part.map((r) => r.article.replace(/_/g, ' ')).join('|'))}${cont}`, { delay: 1500 });
    const redir = new Map((j?.query?.redirects || []).concat(j?.query?.normalized || []).map((x) => [x.to, x.from]));
    for (const p of Object.values(j?.query?.pages || {})) {
      const r = part.find((x) => [p.title, redir.get(p.title)].includes(x.article.replace(/_/g, ' ')));
      if (!r) continue;
      for (const im of p.images || []) {
        const n = im.title.replace(/^File:/, '');
        if (/\.(jpe?g|png)$/i.test(n) && named(r, n) && !bad(r, n)) others.get(r.name).push(n);
      }
    }
    cont = j?.continue ? `&imcontinue=${encodeURIComponent(j.continue.imcontinue)}&continue=${encodeURIComponent(j.continue.continue)}` : '';
  } while (cont);
}
for (const r of ROSTER) {
  const list = cand.get(r.name);
  // The infobox (lead) image is the editors' pick of the person, so it goes first.
  const lead = r.lead && !bad(r, r.lead) ? r.lead : null;
  if (lead) list.push(lead);
  const rank = (f) => (/crop/i.test(f) ? 2 : 0) + (/\b(19|20)\d\d\b/.test(f) ? 1 : 0) - (/\b(with|and|fans|crowd|tour|arena|stadium|beliebers|wants to see)\b|&/i.test(f) ? 3 : 0);
  list.push(...others.get(r.name).filter((f) => norm(f) !== norm(lead || '')).sort((a, b) => rank(b) - rank(a)));
}

// 3. Licence + author for every candidate, then assign (never the same file twice).
const info = await fileInfo([...cand.values()].flat());
const out = {};
const usedFiles = new Map();
const fallback = [];
for (const r of ROSTER) {
  const p = cand.get(r.name).map((f) => info.get(norm(f))).find((x) => usable(x) && !usedFiles.has(x.file));
  if (p) { usedFiles.set(p.file, r.name); const { w, h, ...keep } = p; out[r.name] = keep; }
  else fallback.push([r, why.get(r.name) || (cand.get(r.name).length ? 'no free/usable Commons file' : 'no Commons image')]);
}

// 4. MV-frame fallback, planned for all at once: own solo MVs first, then band MVs; never reused.
const data = await readJSON('data/data.json');
const songsById = new Map(data.songs.map((s) => [s.id, s]));
const usedVideos = new Set();
for (const [r, reason] of fallback) {
  const a = data.artists.find((x) => x.name === r.name);
  const songs = (a?.songs || []).map((id) => songsById.get(id)).sort((x, y) => (x.by === r.name ? 0 : 1) - (y.by === r.name ? 0 : 1) || x.o - y.o);
  const pick = songs.find((s) => !usedVideos.has(s.id));
  if (pick) {
    usedVideos.add(pick.id);
    out[r.name] = { img: `https://i.ytimg.com/vi/${pick.id}/hq2.jpg`, mv: pick.id, page: `https://www.youtube.com/watch?v=${pick.id}`, author: `Frame from the “${pick.t}” MV`, license: 'YouTube' };
  }
  console.warn(`${r.name}: ${reason} -> ${pick ? 'MV frame ' + pick.id : 'NO PICTURE'}`);
}

// Audit hint: Commons files whose name does not mention the person.
for (const r of ROSTER) {
  const p = out[r.name];
  if (p?.file && !tokens(r.name).some((t) => fold(p.file).includes(t))) console.warn(`check: ${r.name} -> ${p.file}`);
}
await writeJSON('data/portraits.json', out);
console.log(`${Object.keys(out).length}/${ROSTER.length} artists have a picture (${fallback.length} MV frames).`);
