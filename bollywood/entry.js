import { start } from '../pop/src/app.js';
import * as G from '../pop/src/game.js';
import { videoThumbnail } from '../src/validation.js';

const fills = [['#22d3b0', '#075b4b'], ['#0b614d', '#043328'], ['#f2c14e', '#80601b'], ['#148b75', '#064337']];
start({
  side: 'bollywood', label: 'Bollywood', noun: 'star', storage: 'bolly', deck: 'stars', fills,
  deckNote: 'Spin for a star, then for one of her songs.',
  chartMethod: 'Ranked by official video views.',
  pool: (artists) => artists.filter((a) => a.deck === 'stars'),
  prepare: (data) => { for (const s of data.songs) s.by = (s.singers || []).join(' · '); },
  songModel: (s, { chart } = {}) => ({
    kind: 'song', id: s.id, tier: G.songRarity(s.o), title: s.t,
    by: [s.film, s.year].filter(Boolean).join(' · '), detail: (s.singers || []).join(' · '), gem: '#' + s.o,
    img: videoThumbnail(s.id), yt: true, stats: [{ v: s.v, label: 'MV views' }],
    chips: (chart ? [s.film, s.year && String(s.year), s.composer] : [s.composer]).filter(Boolean), flavour: '',
  }),
  artistModel: (a, portrait, songs) => ({
    kind: 'artist', id: a.name, tier: G.artistRarity(a.power), title: a.name,
    by: 'Star', gem: '\u26A1' + a.power,
    img: portrait?.img || (songs?.[0] ? videoThumbnail(songs[0].id) : undefined), yt: portrait ? !!portrait.mv : !!songs?.[0], stats: [{ v: a.songs.length, label: 'Songs', n: true }],
    chips: [], flavour: '', portrait,
  }),
  score: (s) => s.v,
  chartScore: (s) => (s.v > 0 ? G.fmt(s.v) + ' views' : ''),
  statStrip: (s) => [{ label: 'MV views', value: s.v > 0 ? G.fmt(s.v) : '' }],
});
