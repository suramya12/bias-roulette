// Pure parsing and ranking helpers; no helper reads files or makes requests.
export const knownNames = [
  'Aniplex', 'Aniplex USA', 'TOHO animation', 'Crunchyroll', 'Netflix Anime',
  'MAPPA', 'KADOKAWA', 'avex', 'Sony Music (Japan)', 'Lantis', 'FlyingDog',
  'Pony Canyon', 'KING RECORDS', 'Warner Bros. Japan', 'Toei Animation',
  'Muse Asia', 'Ani-One Asia', 'TV TOKYO', 'NHK', 'Riot Games',
  'League of Legends', 'Blizzard', 'Overwatch',
];
const defaultChannels = { trusted: {}, blocked: {}, knownNames };

const normalize = value => String(value ?? '').normalize('NFKD')
  .replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function songKey(artist, song) {
  if (typeof artist === 'object') return songKey(artist.artist, artist.title);
  // Keep the artist/title boundary, so "A B | C" differs from "A | B C".
  return `${normalize(artist).replace(/ /g, '-')}|${normalize(song).replace(/ /g, '-')}`;
}

export function parseSeedLine(line, kind = 'theme') {
  const text = line.trim();
  if (!text || text.startsWith('#')) return null;
  const fields = text.split('|').map(part => part.trim());
  const [artist, title, source, use, year, aka] = fields;
  if (fields.length < 5 || fields.length > 6 || !artist || !title || !source ||
      !['OP', 'ED', 'IN', 'MV'].includes(use) || !/^\d{4}$/.test(year) ||
      (kind === 'theme' ? use === 'MV' : use !== 'MV') ||
      (aka !== undefined && !/^aka\s+\S/i.test(aka))) {
    throw new Error(`Invalid seed line: ${line}`);
  }
  const aliases = aka ? [...new Set(aka.replace(/^aka\s+/i, '').split(';')
    .map(alias => alias.trim()).filter(Boolean))] : [];
  return {
    id: songKey(artist, title), artist, title, aliases, kind,
    [kind === 'theme' ? 'show' : 'source']: source, use, year: Number(year),
  };
}

// Scan balanced braces rather than using a greedy regex: strings may contain
// braces, escaped quotes, or text that resembles another script assignment.
function extractAssignment(html, name) {
  const assignment = new RegExp(`(?:\\b${name}|window\\s*\\[\\s*["']${name}["']\\s*\\])\\s*=\\s*`, 'g');
  let match;
  while ((match = assignment.exec(html))) {
    const start = assignment.lastIndex;
    if (html[start] !== '{') continue;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < html.length; i++) {
      const char = html[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); }
        catch { break; }
      }
    }
  }
  throw new Error(`Missing or malformed ${name}`);
}

export const extractInitialData = html => extractAssignment(html, 'ytInitialData');
export const extractPlayerResponse = html => extractAssignment(html, 'ytInitialPlayerResponse');

export function playability(html) {
  try {
    const { playabilityStatus = {} } = extractPlayerResponse(html);
    const reasons = [playabilityStatus.reason, ...(playabilityStatus.messages ?? []),
      textOf(playabilityStatus.errorScreen?.playerErrorMessageRenderer?.reason),
      textOf(playabilityStatus.errorScreen?.playerErrorMessageRenderer?.subreason)]
      .filter(Boolean);
    return { status: playabilityStatus.status ?? 'UNKNOWN',
      embed: typeof playabilityStatus.playableInEmbed === 'boolean' ? playabilityStatus.playableInEmbed : null,
      reason: reasons.join('; '), parsed: true };
  } catch {
    return { status: 'UNKNOWN', embed: null, reason: 'Missing or malformed player response', parsed: false };
  }
}

export const COPY_POLICY = 'phase3b-1';

export function watchMetadata(html, checked) {
  const player = extractPlayerResponse(html), details = player.videoDetails ?? {};
  const formats = [...(player.streamingData?.formats ?? []), ...(player.streamingData?.adaptiveFormats ?? [])];
  const dimensions = formats.filter(f => Number(f.width) > 0 && Number(f.height) > 0)
    .sort((a, b) => Math.min(b.width, b.height) - Math.min(a.width, a.height));
  const best = dimensions[0];
  const quality = { hd: best ? Math.min(best.width, best.height) >= 720 : null,
    width: best ? Number(best.width) : null, height: best ? Number(best.height) : null,
    label: best?.qualityLabel ?? null, source: 'watch-page-formats', checked };
  const rawViews = details.viewCount;
  // YouTube now sends full timestamps ("2006-09-25T14:53:27-07:00"); keep the calendar date.
  const rawPublished = player.microformat?.playerMicroformatRenderer?.publishDate
    ?? player.microformat?.playerMicroformatRenderer?.uploadDate;
  const published = typeof rawPublished === 'string' ? rawPublished.slice(0, 10) : rawPublished;
  const publishTime = Date.parse(`${published}T00:00:00Z`);
  return { title: details.title, channel: details.author, channelId: details.channelId,
    seconds: details.lengthSeconds === undefined ? undefined : Number(details.lengthSeconds),
    views: /^\d+$/.test(String(rawViews ?? '')) && Number.isSafeInteger(Number(rawViews)) ? Number(rawViews) : null,
    published: /^\d{4}-\d{2}-\d{2}$/.test(published ?? '') && Number.isFinite(publishTime) &&
      new Date(publishTime).toISOString().slice(0, 10) === published ? published : null,
    hd: quality.hd, quality };
}

export function copySource(video, channels = defaultChannels) {
  return Object.hasOwn(channels.trusted ?? {}, video.channelId) &&
    !Object.hasOwn(channels.blocked ?? {}, video.channelId) ? 'official' : 'fan';
}

export function fanEligible(video, checked) {
  const today = new Date(checked);
  const year = today.getUTCFullYear() - 3, month = today.getUTCMonth();
  // Clamp leap day to the last day of February in the anniversary year.
  const cutoff = new Date(Date.UTC(year, month, Math.min(today.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate())))
    .toISOString().slice(0, 10);
  return (video.views !== null && video.views >= 1_000_000) ||
    (typeof video.published === 'string' && video.published <= cutoff);
}

export function copyGate(video, seed, channels, checked) {
  const result = classify(video, seed, channels);
  if (result.reject) return result.reject;
  if (video.hd !== true) return video.hd === false ? 'SD source' : 'unknown HD quality';
  if (copySource(video, channels) === 'fan' && !fanEligible(video, checked)) return 'fan age/views gate unknown or unmet';
  return null;
}

export function orderCopies(videos) {
  const rank = v => ({ creditless: 3, tv: 2, mv: 1 })[v.kind] + (v.source === 'official' ? 3 : 0);
  return [...new Map(videos.map(v => [v.id, v])).values()].sort((a, b) => rank(b) - rank(a) ||
    Math.min(b.quality?.width ?? 0, b.quality?.height ?? 0) - Math.min(a.quality?.width ?? 0, a.quality?.height ?? 0) ||
    (b.views ?? 0) - (a.views ?? 0) || a.id.localeCompare(b.id)).slice(0, 4);
}

function textOf(value) {
  return value?.simpleText ?? value?.runs?.map(run => run.text ?? '').join('') ?? '';
}

function duration(value) {
  const text = textOf(value);
  if (!/^\d+(?::\d{2}){1,2}$/.test(text)) return 0;
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function viewCount(value) {
  const text = textOf(value).replace(/,/g, '');
  const short = text.match(/([\d.]+)\s*([KMB])\b/i);
  if (short) return Math.round(Number(short[1]) * ({ k: 1e3, m: 1e6, b: 1e9 })[short[2].toLowerCase()]);
  return Number(text.match(/\d+/)?.[0] ?? 0);
}

export function videosFromSearch(data) {
  const result = [], seen = new Set(), stack = [data];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const video = node.videoRenderer;
    if (video?.videoId && !seen.has(video.videoId)) {
      seen.add(video.videoId);
      const owner = video.ownerText ?? video.longBylineText ?? video.shortBylineText;
      const channelId = owner?.runs?.find(run => run.navigationEndpoint?.browseEndpoint?.browseId)
        ?.navigationEndpoint.browseEndpoint.browseId ?? '';
      const badges = video.ownerBadges ?? [];
      const styles = badges.map(badge => badge.metadataBadgeRenderer?.style ?? '');
      const labels = badges.map(badge => badge.metadataBadgeRenderer?.tooltip ??
        badge.metadataBadgeRenderer?.accessibilityData?.label ?? badge.metadataBadgeRenderer?.label ?? '');
      result.push({
        id: video.videoId, title: textOf(video.title), channel: textOf(owner), channelId,
        verified: styles.includes('BADGE_STYLE_TYPE_VERIFIED') || labels.some(label => /^verified$/i.test(label)),
        officialArtist: styles.includes('BADGE_STYLE_TYPE_VERIFIED_ARTIST') || labels.some(label => /official artist/i.test(label)),
        seconds: duration(video.lengthText), views: viewCount(video.viewCountText ?? video.shortViewCountText),
      });
    }
    for (const [key, value] of Object.entries(node).reverse()) {
      if (key !== 'videoRenderer' && value && typeof value === 'object') stack.push(value);
    }
  }
  return result;
}

const contains = (haystack, needle) => !!needle && ` ${haystack} `.includes(` ${needle} `);

export function trustLevel(video, seed, channels = defaultChannels) {
  if (Object.hasOwn(channels.blocked ?? {}, video.channelId) || /(?:^|[\s-])topic\s*$/i.test(video.channel)) return 0;
  if (Object.hasOwn(channels.trusted ?? {}, video.channelId)) return 4;
  if (video.verified || video.officialArtist) return 3;
  const channel = normalize(video.channel), artist = normalize(seed.artist);
  if (contains(channel, artist)) return 2;
  if ((channels.knownNames ?? []).some(name => contains(channel, normalize(name)))) return 1;
  return 0;
}

function videoKind(video, seed) {
  const mv = /\bmusic\s+video\b|\bMV\b|\bofficial\s+video\b/i.test(video.title) || video.officialArtist;
  if (seed.kind !== 'theme' && mv) return 'mv';
  if (/creditless|non[\s-]?credit(?:ed|s)?|\bNC(?:OP|ED)\b|clean\s+(?:opening|ending)|ノンクレジット/i.test(video.title)) return 'creditless';
  if (/(?:\b(?:opening|ending|OP|ED)\b|主題歌)/i.test(video.title) && video.seconds >= 60 && video.seconds <= 150) return 'tv';
  if (mv) return 'mv';
  return 'other';
}

export function classify(video, seed, channels = defaultChannels) {
  const kind = videoKind(video, seed);
  const rejected = reason => ({ kind, reject: reason });
  let outside = ` ${normalize(video.title)} `;
  for (const name of [seed.title, seed.show ?? seed.source, ...(seed.aliases ?? [])].filter(Boolean)
    .map(normalize).sort((a, b) => b.length - a.length)) outside = outside.replaceAll(` ${name} `, ' ');
  const unwanted = /\b(?:AMVs?|covers?|lyrics?|nightcore|slowed|reverb|reactions?|piano|guitar|drums?|karaoke|instrumental|8D|fan\s*made|edits?|mirrored|extended)\b|\bsped\s+up\b|\b(?:1|10)\s*(?:hours?|hrs?)\b/i;
  if (unwanted.test(outside)) return rejected('excluded title');
  if (/\b(?:live|concert)\b/i.test(outside)) return rejected('live/concert');
  if (!Number.isFinite(video.seconds) || video.seconds < 45) return rejected('short or unknown duration');
  if (video.seconds > 720) return rejected('over 12 minutes');
  if (Object.hasOwn(channels.blocked ?? {}, video.channelId)) return rejected('blocked channel');
  if (/(?:^|[\s-])topic\s*$/i.test(video.channel)) return rejected('Topic channel');
  if (seed.kind === 'theme' && kind === 'mv' && copySource(video, channels) === 'fan') return rejected('fan MV for a theme');
  if (seed.kind !== 'theme' && kind !== 'mv') return rejected('not a music video');
  if (kind === 'other') return rejected('unrecognised video kind');
  return { kind };
}

export function score(video, seed, channels = defaultChannels) {
  const { kind, reject } = classify(video, seed, channels);
  if (reject) return -Infinity;
  const preference = (seed.kind === 'theme' ? ({ creditless: 3, tv: 2, mv: 1, other: 0 })[kind] : kind === 'mv' ? 1 : 0) +
    (copySource(video, channels) === 'official' ? 3 : 0);
  const title = normalize(video.title);
  const relevance = (contains(title, normalize(seed.title)) || (seed.aliases ?? []).some(alias => contains(title, normalize(alias))) ? 4 : 0) +
    (contains(title, normalize(seed.show ?? seed.source)) ? 2 : 0) + (contains(title, normalize(seed.artist)) ? 1 : 0);
  // Views cannot cross a trust tier; trust breaks equal content scores.
  const views = Math.min(Math.max(video.views || 0, 0), 999_999_999_999) / 1e12;
  return preference * 1000 + relevance * 10 + trustLevel(video, seed, channels) + views;
}
