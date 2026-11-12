// Game rules only: picking, scoring and phase changes. No DOM, no animation.
// The UI asks for a spin, gets back what happened, and animates towards it.

export const FINALISTS = 5;
export const PHASES = ['idolDraw', 'idolDuel', 'songDraw', 'songDuel', 'result'];

/** Unbiased integer in [0, n) from crypto.getRandomValues (rejection sampling, no modulo bias). */
export function cryptoInt(n) {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError('n must be a positive integer');
  const limit = 0x100000000 - (0x100000000 % n);
  const buf = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}

export class Game {
  /**
   * @param idols [{name, label, color, songs:[{title, artist, videoId}]}] — every idol needs at least one song
   * @param opts  {target: 2|3, randInt: (n) => int in [0,n)}
   */
  constructor(idols, { target = 3, randInt = cryptoInt } = {}) {
    if (!idols.length) throw new Error('No idols to play with');
    for (const i of idols) if (!i.songs?.length) throw new Error(`${i.name} has no songs`);
    this.idols = idols;
    this.randInt = randInt;
    this.target = target;
    this.reset();
  }

  reset() {
    this.phase = 'idolDraw';
    this.idolFinalists = []; // indexes into this.idols
    this.idolHits = [];
    this.idolIndex = null; // winner
    this.#clearSongs();
  }

  #clearSongs() {
    this.songFinalists = []; // indexes into idol.songs
    this.songHits = [];
    this.songIndex = null; // winner
    this.duelTarget = this.target;
  }

  /** Takes effect from the next showdown, never in the middle of one. */
  setTarget(n) {
    if (n !== 2 && n !== 3) throw new RangeError('target must be 2 or 3');
    this.target = n;
    if (this.phase === 'idolDraw' || this.phase === 'songDraw') this.duelTarget = n;
  }

  get idol() { return this.idolIndex === null ? null : this.idols[this.idolIndex]; }
  get song() { return this.songIndex === null ? null : this.idol.songs[this.songIndex]; }
  get stage() { return this.phase.startsWith('song') ? 'song' : this.phase === 'result' ? 'result' : 'idol'; }

  #pool(stage) { return stage === 'idol' ? this.idols : this.idol.songs; }
  #finalists(stage) { return stage === 'idol' ? this.idolFinalists : this.songFinalists; }
  #hits(stage) { return stage === 'idol' ? this.idolHits : this.songHits; }
  drawsNeeded(stage) { return Math.min(FINALISTS, this.#pool(stage).length); }

  /** Finalists of a stage ('idol' | 'song') with their hit counts, in draw order. */
  finalists(stage) {
    if (stage === 'song' && !this.idol) return [];
    const pool = this.#pool(stage);
    const hits = this.#hits(stage);
    return this.#finalists(stage).map((idx, i) => ({ index: idx, item: pool[idx], hits: hits[i] }));
  }

  /**
   * What the wheel shows right now.
   * draw: one segment per item, `taken` marks finalists that can't be drawn again.
   * duel: each finalist twice (finalist f sits at segments f and f + count).
   */
  wheel() {
    if (this.phase === 'result') return { kind: 'none', stage: 'result', segments: [] };
    const stage = this.stage;
    const pool = this.#pool(stage);
    const fin = this.#finalists(stage);
    if (this.phase.endsWith('Draw')) {
      const taken = new Set(fin);
      return { kind: 'draw', stage, segments: pool.map((item, index) => ({ item, index, taken: taken.has(index) })) };
    }
    const once = fin.map((index, finalist) => ({ item: pool[index], index, finalist, taken: false }));
    return { kind: 'duel', stage, segments: [...once, ...once] };
  }

  /** One spin. Returns what happened; the state has already moved on. */
  spin() {
    if (this.phase === 'result') throw new Error('The game is over');
    const before = this.phase;
    const stage = this.stage;
    const pool = this.#pool(stage);
    const fin = this.#finalists(stage);
    const hits = this.#hits(stage);
    let ev;

    if (before.endsWith('Draw')) {
      const taken = new Set(fin);
      const open = [];
      for (let i = 0; i < pool.length; i++) if (!taken.has(i)) open.push(i);
      const index = open[this.randInt(open.length)];
      fin.push(index);
      hits.push(0);
      ev = { kind: 'draw', stage, phase: before, segment: index, index, item: pool[index], finalist: fin.length - 1, count: fin.length, needed: this.drawsNeeded(stage), won: false };
      if (fin.length >= this.drawsNeeded(stage)) {
        this.duelTarget = this.target;
        if (fin.length === 1) { this.#win(stage, 0); ev.won = true; } // nothing to duel against
        else this.phase = stage === 'idol' ? 'idolDuel' : 'songDuel';
      }
    } else {
      const f = this.randInt(fin.length);
      const copy = this.randInt(2); // which of the finalist's two segments; looks only
      hits[f] += 1;
      ev = { kind: 'hit', stage, phase: before, segment: f + copy * fin.length, index: fin[f], item: pool[fin[f]], finalist: f, hits: hits[f], target: this.duelTarget, won: false };
      if (hits[f] >= this.duelTarget) { this.#win(stage, f); ev.won = true; }
    }
    ev.phaseAfter = this.phase;
    return ev;
  }

  #win(stage, finalist) {
    if (stage === 'idol') {
      this.idolIndex = this.idolFinalists[finalist];
      this.#clearSongs();
      this.phase = 'songDraw';
    } else {
      this.songIndex = this.songFinalists[finalist];
      this.phase = 'result';
    }
  }

  /** Plays every remaining round at once. Keeps whatever has been drawn so far. */
  chooseForMe() {
    const events = [];
    while (this.phase !== 'result') events.push(this.spin());
    return events;
  }

  /** Redo rounds 3 and 4 for the same idol. */
  anotherSong() {
    if (!this.idol) throw new Error('No idol has won yet');
    this.#clearSongs();
    this.phase = 'songDraw';
  }
}
