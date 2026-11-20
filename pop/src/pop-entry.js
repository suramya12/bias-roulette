import { start } from './app.js';
start({
  side: 'pop', storage: 'encore', decks: ['all', 'favs'],
  deckNotes: {
    all: 'The biggest English and Latin pop acts. Spin for an artist, then for one of their songs.',
    favs: 'A curated 100, from Beyonc? to Tate McRae. Spin for an artist, then for one of their songs.',
  },
  pool: (artists, key) => key === 'all' ? artists.filter((a) => a.main) : artists.filter((a) => a.bias).sort((a, b) => a.bias - b.bias),
  fills: [undefined, [ ['#ff6fb5', '#b3135f'], ['#ffd76a', '#c27b00'], ['#c18cff', '#6a2fd1'], ['#ff8fa0', '#b8304a'], ['#ffb3e1', '#c2367e'], ['#f7c873', '#9a6200'] ]],
});
