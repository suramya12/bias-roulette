// Game rules: pure functions, no DOM. Tested with `node --test`.

export const TIERS = [
  { id: 'legendary', label: 'Legendary', max: 10 },
  { id: 'epic', label: 'Epic', max: 30 },
  { id: 'rare', label: 'Rare', max: 100 },
  { id: 'common', label: 'Common', max: Infinity },
];

/** Rarity of a song from its overall rank (1 = biggest song of the genre). */
export const songRarity = (overall) => TIERS.find((t) => overall <= t.max);

/** Rarity of an artist from Power (1–10). */
export function artistRarity(power) {
  if (power >= 9) return TIERS[0];
  if (power >= 7) return TIERS[1];
  if (power >= 5) return TIERS[2];
  return TIERS[3];
}

/** Average of the streams and views that exist; a missing stat is skipped, never NaN. */
export function score(s) {
  const have = [s?.s, s?.v].filter((n) => Number.isFinite(n) && n > 0);
  return have.length ? have.reduce((a, b) => a + b, 0) / have.length : 0;
}

/** 1234567890 -> "1.23B". */
export function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 1 : 2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}

/** The Top 100: songs ordered by overall rank, no duplicates. */
export function top100(songs) {
  const seen = new Set();
  return songs
    .filter((s) => s.o <= 100)
    .sort((a, b) => a.o - b.o)
    .filter((s) => !seen.has(s.id) && seen.add(s.id));
}

/** Stat stones for an artist card: [band songs, solo songs]. A soloist is 0 / N. */
export function artistStats(a) {
  if (a.kind === 'group') return { band: a.nBand, solo: 0 };
  return { band: a.bands.length ? a.nBand : 0, solo: a.nSolo };
}

const SOUNDTRACK = /spider|frozen|fifty shades|barbie|top gun|furious|arcane|encanto|trolls|wicked|moana|lion king|bodyguard|titanic|greatest showman|a star is born|suicide squad/i;
export function songKeywords(s, soundtrackTitle = '') {
  const k = [];
  if (s.o <= 10) k.push('Hall of Fame');
  if (s.s >= 2.5e9) k.push('Streaming Giant');
  else if (s.s >= 1e9) k.push('Billion Club');
  if (s.v >= 3e9) k.push('MV Monster');
  else if (s.v >= 1e9) k.push('Viral MV');
  if (SOUNDTRACK.test(soundtrackTitle)) k.push('Soundtrack');
  if (s.latin) k.push('Latin Heat');
  if (s.band) k.push('Band Era');
  return k.slice(0, 3);
}

export function artistKeywords(a, songs) {
  const k = [];
  const billion = songs.filter((s) => s.s >= 1e9).length;
  if (a.power >= 10) k.push('Icon');
  if (billion >= 5) k.push('Hitmaker');
  else if (billion >= 1) k.push('Billion Club');
  if (a.kind === 'person' && a.bands.length && a.nSolo) k.push('Solo Era');
  if (a.kind === 'group') k.push('Band');
  if (a.latin) k.push('Latin Heat');
  if (songs.some((s) => s.v >= 1e9)) k.push('Viral MV');
  return k.slice(0, 3);
}

/** Small deterministic hash so flavour text stays the same for a card. */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const SONG_FLAVOUR = [
  'Every stadium knows the first note.',
  'Played somewhere on Earth right now.',
  'The chorus that refuses to leave.',
  'Car windows down, volume up.',
  'One hook, a billion replays.',
  'Built for the encore.',
  'Lights out. Phones up.',
  'The song the crowd sings back.',
];
const ARTIST_FLAVOUR = [
  'Walks on stage, the roof comes off.',
  'Every era a new headline.',
  'Charts bend around this name.',
  'From first single to sold-out tours.',
  'The voice you know in two seconds.',
  'Fans in every time zone.',
];
export const songFlavour = (s) => SONG_FLAVOUR[hash(typeof s.id === 'string' ? s.id : s.t) % SONG_FLAVOUR.length];
export const artistFlavour = (a) => ARTIST_FLAVOUR[hash(a.name) % ARTIST_FLAVOUR.length];

/** Seeded RNG (mulberry32) so tests are repeatable; the app passes Math.random. */
export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rand = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pick `n` distinct items. */
export const sample = (list, n, rand = Math.random) => shuffle(list, rand).slice(0, n);

/**
 * Wheel spin: where to stop so segment `index` of `n` sits under the pointer at the top.
 * Returns the final rotation in degrees (always ahead of `from` by at least `turns` turns).
 */
export function spinAngle(from, index, n, turns = 5, jitter = 0) {
  const seg = 360 / n;
  const target = 360 - (index * seg + seg / 2) + jitter * seg * 0.35;
  const base = from - (from % 360) + turns * 360;
  return base + ((target % 360) + 360) % 360;
}

/** The segment under the pointer for a rotation. */
export function segmentAt(rotation, n) {
  const seg = 360 / n;
  const a = ((360 - (rotation % 360)) + 360) % 360;
  return Math.floor(a / seg) % n;
}

/** Showdown finalists: the landed segment and its two neighbours, in wheel order. */
export function finalists(items, landed) {
  const n = items.length;
  if (n <= 3) return items.map((_, i) => i);
  return [(landed - 1 + n) % n, landed, (landed + 1) % n];
}

/**
 * Deal a ring of cards with no song shown twice. `pool` is the Top 100, `shown` the ids
 * already pulled this session (they come back only once the pool runs dry).
 */
export function dealRing(pool, size, shown = new Set(), rand = Math.random) {
  let fresh = pool.filter((s) => !shown.has(s.id));
  if (fresh.length < size) { shown.clear(); fresh = pool; }
  return sample(fresh, Math.min(size, fresh.length), rand);
}

/** Replace a pulled card in the ring with one not already in the ring or shown. */
export function refillRing(ring, pulledIdx, pool, shown, rand = Math.random) {
  const inRing = new Set(ring.map((s) => s.id));
  let options = pool.filter((s) => !inRing.has(s.id) && !shown.has(s.id));
  if (!options.length) { shown.clear(); options = pool.filter((s) => !inRing.has(s.id)); }
  const next = [...ring];
  if (options.length) next[pulledIdx] = options[Math.floor(rand() * options.length)];
  return next;
}

/** Collection stored as { a: [artist names], s: [song ids] }. */
export function collect(col, kind, id) {
  const key = kind === 'artist' ? 'a' : 's';
  const list = col[key] || [];
  const isNew = !list.includes(id);
  return { col: { ...col, [key]: isNew ? [...list, id] : list }, isNew };
}

/** Songs on an artist's wheel: their best-known songs, never the same song twice. */
export function wheelSongs(artist, songsById, max = 12) {
  const seen = new Set();
  return artist.songs
    .map((id) => songsById.get(id))
    .filter((s) => s && !seen.has(s.id) && seen.add(s.id))
    .slice(0, max);
}

/**
 * One roulette stage, the same rules as the K-pop side:
 * the wheel holds every item; spin to draw up to 5 finalists (each can be drawn once),
 * then the wheel holds only the finalists (each twice) and the first to `target` hits wins.
 */
export const FINALISTS = 5;
export class Duel {
  constructor(n, { target = 3, rand = Math.random } = {}) {
    if (n < 1) throw new Error('Nothing to spin');
    Object.assign(this, { n, target, rand, fin: [], hits: [], winner: null, phase: 'draw' });
    if (n === 1) { this.fin = [0]; this.hits = [0]; this.winner = 0; this.phase = 'done'; }
  }

  get needed() { return Math.min(FINALISTS, this.n); }

  /** Wheel slots. draw: every item, `taken` if already a finalist. duel: each finalist twice. */
  wheel() {
    if (this.phase === 'draw') return Array.from({ length: this.n }, (_, i) => ({ index: i, taken: this.fin.includes(i) }));
    const once = this.fin.map((index, finalist) => ({ index, finalist, taken: false }));
    return [...once, ...once];
  }

  /** One spin; the state has already moved on when it returns. */
  spin() {
    if (this.phase === 'done') throw new Error('This stage is over');
    const pick = (k) => Math.floor(this.rand() * k);
    if (this.phase === 'draw') {
      const open = [];
      for (let i = 0; i < this.n; i++) if (!this.fin.includes(i)) open.push(i);
      const index = open[pick(open.length)];
      this.fin.push(index); this.hits.push(0);
      const ev = { kind: 'draw', segment: index, index, finalist: this.fin.length - 1, count: this.fin.length, needed: this.needed, won: false };
      if (this.fin.length >= this.needed) this.phase = 'duel';
      return ev;
    }
    const f = pick(this.fin.length);
    this.hits[f] += 1;
    const ev = { kind: 'hit', segment: f + pick(2) * this.fin.length, index: this.fin[f], finalist: f, hits: this.hits[f], target: this.target, won: false };
    if (this.hits[f] >= this.target) { this.winner = this.fin[f]; this.phase = 'done'; ev.won = true; }
    return ev;
  }
}
