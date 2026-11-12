// Pure data helpers shared by the app, the tests and the resolver script.

export const songKey = (artist, title) => `${artist} | ${title}`;

/** Every song on an idol's wheel: group songs, shared sets, then solo songs. No duplicates. */
export function idolSongs(roster, idol) {
  const group = roster.groups.find((g) => g.id === idol.group);
  if (!group) throw new Error(`Unknown group "${idol.group}" for ${idol.name}`);
  const out = [];
  const seen = new Set();
  const add = (artist, title) => {
    const key = songKey(artist, title);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title, artist, key });
  };
  group.songs.forEach((t) => add(group.act, t));
  (idol.also || []).forEach((id) => {
    const set = roster.sets?.[id];
    if (!set) throw new Error(`Unknown set "${id}" for ${idol.name}`);
    set.songs.forEach((t) => add(set.artist, t));
  });
  (idol.solo || []).forEach((s) => s.songs.forEach((t) => add(s.artist, t)));
  return out;
}

/** Map of key -> {artist, title} for every distinct song in the roster. */
export function allSongs(roster) {
  const map = new Map();
  for (const idol of roster.idols) {
    for (const s of idolSongs(roster, idol)) {
      if (!map.has(s.key)) map.set(s.key, { artist: s.artist, title: s.title });
    }
  }
  return map;
}

/**
 * Join the roster with resolved videos. Songs without a video are left out,
 * and idols left with no songs are left out too (listed in `skipped`).
 */
export function buildCatalog(roster, videos) {
  const idols = [];
  const skipped = [];
  for (const idol of roster.idols) {
    const group = roster.groups.find((g) => g.id === idol.group);
    const songs = idolSongs(roster, idol)
      .filter((s) => videos[s.key]?.id)
      .map((s) => ({ title: s.title, artist: s.artist, key: s.key, videoId: videos[s.key].id }));
    if (!songs.length) {
      skipped.push(idol.name);
      continue;
    }
    idols.push({ name: idol.name, label: group.label, color: group.color, groupId: group.id, songs });
  }
  return { idols, skipped };
}
