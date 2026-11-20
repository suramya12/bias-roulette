import { start } from '../pop/src/app.js';
import * as G from '../pop/src/game.js';
import { videoThumbnail } from '../src/validation.js';

const fills = [['#22d3b0', '#075b4b'], ['#0b614d', '#043328'], ['#f2c14e', '#80601b'], ['#148b75', '#064337']];
start({
  side: 'bollywood', label: 'Bollywood', storage: 'bolly', decks: ['stars', 'voices'], nouns: ['star', 'voice'], fills: [fills, fills],
  rememberDeckInChart: true,
  deckNotes: { stars: 'Spin for an on-screen star, then for one of their songs.', voices: 'Spin for a playback singer, then for one of their songs.' },
  pool: (artists, key) => artists.filter((a) => a.deck === key),
  prepare: (data) => { for (const s of data.songs) s.by = (s.singers || []).join(' ? '); },
  songModel: (s, { chart } = {}) => ({
    kind: 'song', id: s.id, tier: G.songRarity(s.o), title: s.t,
    by: [s.film, s.year].filter(Boolean).join(' ? '), detail: (s.singers || []).join(' ? '), gem: '#' + s.o,
    img: videoThumbnail(s.id), yt: true, stats: [{ v: s.v, label: 'MV views' }],
    chips: (chart ? [s.film, s.year && String(s.year), s.composer] : [s.composer]).filter(Boolean), flavour: '',
  }),
  artistModel: (a, portrait) => ({
    kind: 'artist', id: a.name, tier: G.artistRarity(a.power), title: a.name,
    by: a.deck === 'stars' ? 'Star' : 'Voice', gem: '?' + a.power,
    img: portrait?.img, yt: !!portrait?.mv, stats: [{ v: a.songs.length, label: 'Songs', n: true }],
    chips: [], flavour: '', portrait,
  }),
  chartScore: (s) => G.fmt(s.v) + ' views', chartStats: () => '',
});
