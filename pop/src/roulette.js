// A roulette deck, with the same rules as the K-pop side:
//  1. every artist is on the wheel; spin to draw 5 finalists,
//  2. showdown: the wheel holds only the finalists, first to 3 hits wins,
//  3. the winner's songs go on the wheel; draw 5, showdown, and the MV plays.
// Used twice: the All deck (main roster) and the Favourites deck (the bias list).
import * as G from './game.js';
import { reveal, creditLine, reduced } from './cards.js';
import { createWheel } from './wheel.js';
import { createPlayer } from './player.js';

const wait = (ms) => new Promise((r) => setTimeout(r, reduced.matches ? Math.min(ms, 60) : ms));

export function createRoulette(section, { pool, songsById, portraits, win, artistCard, songCard, fills, noun = 'artist' }) {
  section.append(document.querySelector('#rouletteTpl').content.cloneNode(true));
  const $ = (s) => section.querySelector(s);
  const wheel = createWheel($('.wheel-canvas'), fills);
  const player = createPlayer($('.player'));
  // stage: 'artist' | 'song' | 'done'. items: what the current stage spins over. duel: its rules.
  let stage = 'artist', items = [], duel = null, chosen = null, busy = false, slots = [];

  const label = (it) => (stage === 'artist' ? it.name : it.t);
  const make = (it, opts) => (stage === 'artist' ? artistCard : songCard)(it, opts);
  const hint = (t) => { $('.hint').textContent = t; };

  const steps = (on) => section.querySelectorAll('.steps li').forEach((li, i) => {
    const idx = ['artist', 'song', 'mv'].indexOf(on);
    li.classList.toggle('on', i === idx);
    li.classList.toggle('done', i < idx);
  });

  function drawWheel() {
    const w = duel.wheel();
    wheel.set(w.map((s) => label(items[s.index])), w.map((s) => s.taken));
  }

  function pips(f) {
    const n = duel.hits[f];
    return '●'.repeat(n) + '○'.repeat(Math.max(0, duel.target - n));
  }

  /** Put a stage's pool on the wheel: every artist, or every song of the chosen artist. */
  function startStage(next, list) {
    stage = next; items = list; duel = new G.Duel(list.length); slots = [];
    $('.hand').replaceChildren();
    $('.readout').textContent = '';
    drawWheel();
    const what = stage === 'artist' ? `${noun}s` : 'songs';
    hint(`All ${list.length} ${what} are on the wheel. Spin to draw ${duel.needed} finalists.`);
  }

  /** keepResult: after a finished round the MV keeps playing below; otherwise clear the old result. */
  function newGame(keepResult = false) {
    if (!keepResult) { player.stop(); $('.result').hidden = true; }
    chosen = null;
    $('.spin').textContent = 'SPIN';
    $('.auto').hidden = false;
    $('.restart').hidden = true;
    steps('artist');
    startStage('artist', G.shuffle(pool));
  }

  async function addFinalist(ev, fast) {
    const box = document.createElement('div');
    box.className = 'fin';
    const card = make(items[ev.index], { size: 'mini', faceDown: true });
    const p = Object.assign(document.createElement('span'), { className: 'pips', textContent: '' });
    box.append(card, p);
    $('.hand').append(box);
    slots.push({ card, p });
    if (!fast) await wait(80);
    reveal(card);
  }

  function showBig(card, extra = []) {
    $('.big-slot').replaceChildren(card, ...extra);
    requestAnimationFrame(() => reveal(card));
  }

  async function finishArtist() {
    chosen = items[duel.winner];
    $('.result').hidden = false;
    player.stop();
    $('.player-slot').hidden = true;
    showBig(artistCard(chosen, { size: 'big' }), [creditLine(portraits[chosen.name])]);
    const isNew = win('artist', chosen.name);
    $('.restart').hidden = false;
    steps('song');
    startStage('song', G.wheelSongs(chosen, songsById, Infinity));
    hint(`${chosen.name} wins${isNew ? ' and joins your binder' : ''}! ${$('.hint').textContent}`);
    if (duel.phase === 'done') await finishSong(); // only one song: nothing to spin for
  }

  async function finishSong() {
    const song = items[duel.winner];
    showBig(songCard(song, { size: 'big' }));
    const isNew = win('song', song.id);
    $('.player-slot').hidden = false;
    // The user may have switched tabs during the spin: never start sound in a hidden section.
    if (section.closest('[hidden]')) player.cue(song.id); else player.play(song.id);
    $('.now').replaceChildren('Now playing: ', Object.assign(document.createElement('b'), { textContent: song.t }), ` · ${song.by} · #${song.o}`);
    hint(isNew ? 'New card collected! Spin again?' : 'Already in your binder. Spin again?');
    stage = 'done';
    $('.spin').textContent = 'AGAIN';
    $('.auto').hidden = true;
    steps('mv');
    $('.result').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'nearest' });
  }

  /** One spin of the current stage. */
  async function step(fast = false) {
    const ev = duel.spin();
    await wheel.spin(ev.segment, (t) => { $('.readout').textContent = t; }, fast);
    const name = label(items[ev.index]);
    if (ev.kind === 'draw') {
      await addFinalist(ev, fast);
      if (duel.phase === 'duel') {
        drawWheel();
        slots.forEach((s, f) => { s.p.textContent = pips(f); });
        hint(`Showdown! First to ${duel.target} hits wins.`);
      } else hint(`${name} drawn (${ev.count} of ${ev.needed}). Spin again.`);
      return;
    }
    slots.forEach((s, f) => { s.card.classList.toggle('lit', f === ev.finalist); s.p.textContent = pips(f); });
    if (!ev.won) { hint(`${name}: ${ev.hits} of ${ev.target}. Spin again.`); return; }
    slots.forEach((s, f) => s.card.classList.toggle('lose', f !== ev.finalist));
    await wait(fast ? 300 : 600);
    if (stage === 'artist') await finishArtist(); else await finishSong();
  }

  async function run(fn) {
    if (busy) return;
    busy = true;
    $('.spin').disabled = $('.auto').disabled = true;
    try { await fn(); } finally { $('.spin').disabled = $('.auto').disabled = false; busy = false; }
  }

  $('.spin').addEventListener('click', () => run(async () => {
    if (stage === 'done') { newGame(true); return; }
    hint('Spinning…');
    await step();
  }));
  // Plays every remaining spin quickly, keeping whatever has been drawn so far.
  $('.auto').addEventListener('click', () => run(async () => {
    while (stage !== 'done') await step(true);
  }));
  $('.restart').addEventListener('click', () => !busy && newGame());
  newGame();
  return { stop: () => player.stop() };
}
