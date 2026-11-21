// One source of truth for what each side counts: who is on the Roulette wheel and which cards
// can be collected. Used by the page (app.js) and by the landing manifest (scripts/landing-manifest.mjs),
// so the hub, the wheel and the Collection always show the same numbers.
import { top100, wheelSongs } from './game.js';

export const DECKS = {
  kpop: { noun: 'idol', pool: (artists) => artists.filter((a) => a.main) },
  pop: { noun: 'artist', pool: (artists) => artists.filter((a) => a.main) },
  anime: { noun: 'title', pool: (artists) => artists.filter((a) => a.main) },
  bollywood: { noun: 'star', pool: (artists) => artists.filter((a) => a.deck === 'stars') },
};

/**
 * Everything a player can win on a side: the wheel's artists (Roulette) and every song that
 * either Roulette (any song of a wheel artist) or Top 100 (a pull) can award, in rank order.
 */
export function collectible(data, pool) {
  const songsById = new Map(data.songs.map((s) => [s.id, s]));
  const artists = pool(data.artists.filter((a) => a.songs.length));
  const ids = new Set(top100(data.songs).map((s) => s.id));
  for (const a of artists) for (const s of wheelSongs(a, songsById, Infinity)) ids.add(s.id);
  const songs = [...ids].map((id) => songsById.get(id)).sort((a, b) => a.o - b.o);
  return { artists, songs };
}
