import { start } from '../pop/src/app.js';
import * as G from '../pop/src/game.js';
import { videoThumbnail } from '../src/validation.js';

const fills = [['#ff2d55', '#8f0f2c'], ['#8b5cff', '#3d1d9e'], ['#3de8ff', '#0b6f96'], ['#ffd76a', '#b07400'], ['#ff7a3d', '#a33000'], ['#38f2a5', '#0a7a50']];
const USE = { OP: 'OP', ED: 'ED', IN: 'Insert', MV: 'MV' };
const useOf = (s) => USE[s.use] ?? s.use;

start({
  side: 'anime', label: 'Anime', noun: 'show', storage: 'anime', deck: 'shows', fills, photos: false,
  deckNote: 'Spin for an anime, then for one of its songs.',
  chartMethod: 'Ranked by official video views.',
  pool: (artists) => artists.filter((a) => a.main),
  songModel: (s) => ({
    kind: 'song', id: s.id, tier: G.songRarity(s.o), title: s.t, by: s.by,
    detail: [s.show, useOf(s)].filter(Boolean).join(' \u00B7 '), gem: '#' + s.o,
    img: videoThumbnail(s.id), yt: true, stats: [{ v: s.v, label: 'MV views' }],
    chips: [s.year && String(s.year)].filter(Boolean), flavour: '',
  }),
  // Shows have no photo: the card wears the still of the show's most-viewed song.
  artistModel: (a, portrait, songs) => {
    const best = [...songs].sort((x, y) => (y.v || 0) - (x.v || 0))[0];
    return {
      kind: 'artist', id: a.name, tier: G.artistRarity(a.power), title: a.name, by: 'Anime',
      gem: '\u26A1' + a.power, img: best && videoThumbnail(best.id), yt: true,
      stats: [{ v: a.songs.length, label: 'Songs', n: true }],
      chips: [...new Set(songs.map(useOf))], flavour: '',
    };
  },
  score: (s) => s.v,
  chartScore: (s) => (s.v > 0 ? G.fmt(s.v) + ' views' : ''),
  statStrip: (s) => [
    { label: 'MV views', value: s.v > 0 ? G.fmt(s.v) : '' },
    { label: 'Year', value: s.year ? String(s.year) : '' },
  ],
});
