import { start } from '../pop/src/app.js';
import { DECKS } from '../pop/src/deck.js';
import * as G from '../pop/src/game.js';
import { videoThumbnail } from '../src/validation.js';

// The old K-pop page kept its cards under one shared key: { idol: { name: n }, song: { 'artist | title': n } }.
// Carry those over once, for the idols and songs that still exist.
function migrateCollection(data, key) {
  try {
    if (localStorage.getItem(key)) return;
    const old = JSON.parse(localStorage.getItem('bias-roulette.collection'));
    if (!old || typeof old !== 'object') return;
    const names = new Set(data.artists.map((a) => a.name));
    const bySong = new Map(data.songs.map((s) => [`${s.by} | ${s.t}`, s.id]));
    const a = Object.keys(old.idol ?? {}).filter((name) => old.idol[name] > 0 && names.has(name));
    const s = Object.keys(old.song ?? {}).filter((k) => old.song[k] > 0 && bySong.has(k)).map((k) => bySong.get(k));
    if (a.length || s.length) localStorage.setItem(key, JSON.stringify({ a, s }));
  } catch {}
}

start({
  side: 'kpop', label: 'K-pop', noun: 'idol', storage: 'kpop', deck: 'idols',
  deckNote: 'Spin for an idol, then for one of their songs.',
  chartMethod: 'Score = (Spotify streams + official music video views) / 2.',
  source: { name: 'kworb.net', href: 'https://kworb.net/' },
  fills: [['#ff4fa3', '#a1135c'], ['#b693ff', '#5a2fb8'], ['#ffe45c', '#b08a00'], ['#6ff2c8', '#0d8a69'], ['#7fd0ff', '#1a6aa8'], ['#ff8ad1', '#b0307e']],
  crowdColors: ['#ff4fa3', '#ffe45c', '#6ff2c8', '#b693ff', '#7fd0ff'],
  pool: DECKS.kpop.pool,
  prepare: (data) => migrateCollection(data, 'kpop.collection.v1'),
  artistModel: (a, portrait, songs) => ({
    kind: 'artist', id: a.name, tier: G.artistRarity(a.power), title: a.name,
    by: a.group || 'Soloist', gem: '\u26A1' + a.power,
    img: portrait?.img || (songs?.[0] ? videoThumbnail(songs[0].id) : undefined), yt: portrait ? !!portrait.mv : !!songs?.[0],
    stats: [{ v: a.nBand, label: 'Group songs', n: true }, { v: a.nSolo, label: 'Solo songs', n: true }],
    chips: G.artistKeywords(a, songs), flavour: G.artistFlavour(a), portrait,
  }),
  statStrip: (s) => [
    { label: 'Spotify streams', value: s.s > 0 ? G.fmt(s.s) : '' },
    { label: 'MV views', value: s.v > 0 ? G.fmt(s.v) : '' },
    { label: 'Score', value: G.score(s) > 0 ? G.fmt(G.score(s)) : '' },
  ],
});
