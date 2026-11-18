const USES = new Set(['OP', 'ED', 'IN']);

/** Song-level filters; add-ons have their own switches, independent of OP/ED/IN. */
export function eligible(songs, { uses = USES, addons = {}, kinds = [] } = {}) {
  const byKind = new Map(kinds.map((kind) => [kind.id, kind]));
  return songs.filter((song) => {
    if (!song.videos?.length) return false;
    const kind = byKind.get(song.kind);
    if (!kind) return false;
    return kind.addon ? !!(addons[kind.id] ?? kind.default) : uses.has(song.use);
  });
}

export const franchise = (song) => (song.show ?? song.source ?? '').toLowerCase().trim();

/** Optional catalogue resolves history after filters hide a previously played song. */
export function pickNext(pool, history = [], rand, catalog = pool) {
  if (!pool.length) return undefined;
  const byId = new Map(catalog.map((song) => [song.id, song]));
  const last = byId.get(history.at(-1));
  const lastFranchise = last && franchise(last);
  const different = last ? pool.filter((song) => franchise(song) !== lastFranchise) : [];
  // The immediate franchise exclusion wins if it conflicts with the song cooldown.
  const allowed = different.length ? different : pool;
  const window = Math.min(20, pool.length - 1);
  const recent = new Set(window ? history.slice(-window) : []);
  const fresh = allowed.filter((song) => !recent.has(song.id));
  const candidates = fresh.length ? fresh : allowed;
  let choices = candidates;
  for (const window of [10, 5, 1]) {
    const blocked = new Set(history.slice(-window).flatMap((id) => {
      const song = byId.get(id);
      return song ? [franchise(song)] : [];
    }));
    const remaining = candidates.filter((song) => !blocked.has(franchise(song)));
    if (remaining.length) { choices = remaining; break; }
  }
  const counts = new Map();
  for (const song of pool) {
    const key = franchise(song);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const weight = (song) => 1 / Math.sqrt(counts.get(franchise(song)));
  let ticket = rand() * choices.reduce((sum, song) => sum + weight(song), 0);
  for (const song of choices) {
    ticket -= weight(song);
    if (ticket < 0) return song;
  }
  return choices.at(-1);
}

export function tierOf(song) {
  const views = Math.max(0, ...(song.videos || []).map((video) => Number(video.views) || 0));
  return views >= 100_000_000 ? 'legendary' : views >= 20_000_000 ? 'epic'
    : views >= 3_000_000 ? 'rare' : 'common';
}

export function copyQueue(song, { preferredId, localStrikes = {} } = {}) {
  const copies = song.videos || [];
  const healthy = copies.filter((video) => typeof video.id !== 'string' || !(localStrikes[video.id] >= 3));
  const queue = [...(healthy.length ? healthy : copies)];
  const preferred = queue.findIndex((video) => video.id === preferredId);
  if (preferred > 0) queue.unshift(...queue.splice(preferred, 1));
  return queue;
}

export function copyLabel(video) {
  const kind = { creditless: 'Creditless', tv: 'TV version', mv: 'Music video' }[video.kind] || 'Video';
  return `${kind} · ${video.source === 'official' ? 'official' : 'fan upload'}`;
}
