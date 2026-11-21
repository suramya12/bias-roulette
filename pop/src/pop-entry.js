import { start } from './app.js';
import { DECKS } from './deck.js';
import * as G from './game.js';

start({
  side: 'pop', label: 'Pop & Latin', noun: 'artist', storage: 'encore', deck: 'all',
  deckNote: 'The biggest English and Latin pop acts. Spin for an artist, then for one of their songs.',
  chartMethod: 'Score = (Spotify streams + official MV views) / 2.',
  source: { name: 'kworb.net', href: 'https://kworb.net/' },
  pool: DECKS.pop.pool,
  statStrip: (s) => [
    { label: 'Spotify streams', value: s.s > 0 ? G.fmt(s.s) : '' },
    { label: 'MV views', value: s.v > 0 ? G.fmt(s.v) : '' },
    { label: 'Score', value: G.score(s) > 0 ? G.fmt(G.score(s)) : '' },
  ],
});
