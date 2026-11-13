// A roulette mode: spin a wheel of artists, showdown, spin that artist's songs, showdown, MV.
// Used twice: Artist Roulette (main roster) and Bias Roulette (the bias list).
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
  let stage = 'artist', items = [], chosen = null, busy = false;

  const steps = (on) => section.querySelectorAll('.steps li').forEach((li, i) => {
    const idx = ['artist', 'song', 'mv'].indexOf(on);
    li.classList.toggle('on', i === idx);
    li.classList.toggle('done', i < idx);
  });

  /** keepResult: after a finished round the MV keeps playing below; otherwise clear the old result. */
  function newArtistWheel(keepResult = false) {
    if (!keepResult) { player.stop(); $('.result').hidden = true; }
    stage = 'artist'; chosen = null;
    items = G.sample(pool, Math.min(12, pool.length));
    wheel.set(items.map((a) => a.name));
    $('.hint').textContent = `Spin the wheel to pick your ${noun}.`;
    $('.hand').replaceChildren();
    $('.spin').textContent = 'SPIN';
    $('.reshuffle').hidden = false;
    $('.restart').hidden = true;
    steps('artist');
  }

  async function showdown(fins, make) {
    const hand = $('.hand');
    const cards = fins.map((i) => make(items[i], { size: 'mini', faceDown: true }));
    hand.replaceChildren(...cards);
    for (const c of cards) { await wait(160); reveal(c); }
    await wait(500);
    const winner = Math.floor(Math.random() * cards.length);
    // Reduced motion: no rapid highlight hopping, just light the winner.
    const hops = reduced.matches ? -1 : cards.length * 3 + winner;
    if (reduced.matches) cards[winner].classList.add('lit');
    for (let k = 0; k <= hops; k++) {
      cards.forEach((c, i) => c.classList.toggle('lit', i === k % cards.length));
      await wait(90 + k * k * 4);
    }
    cards.forEach((c, i) => c.classList.toggle('lose', i !== winner));
    await wait(450);
    return items[fins[winner]];
  }

  function showBig(card, extra = []) {
    $('.big-slot').replaceChildren(card, ...extra);
    requestAnimationFrame(() => reveal(card));
  }

  async function spin() {
    if (busy) return;
    if (stage === 'done') { newArtistWheel(true); return; }
    busy = true;
    $('.spin').disabled = true;
    try { await round(); } finally { $('.spin').disabled = false; busy = false; }
  }

  async function round() {
    $('.reshuffle').hidden = true;
    $('.hint').textContent = 'Spinning…';
    const index = Math.floor(Math.random() * items.length);
    await wheel.spin(index);
    const fins = G.finalists(items, index);
    $('.hint').textContent = 'Showdown!';
    if (stage === 'artist') {
      chosen = await showdown(fins, artistCard);
      $('.result').hidden = false;
      player.stop();
      $('.player-slot').hidden = true;
      showBig(artistCard(chosen, { size: 'big' }), [creditLine(portraits[chosen.name])]);
      const isNew = win('artist', chosen.name);
      stage = 'song';
      items = G.wheelSongs(chosen, songsById, 12);
      wheel.set(items.map((s) => s.t));
      $('.hint').textContent = `${chosen.name}${isNew ? ' joins your binder!' : ''} Now spin for a song.`;
      $('.restart').hidden = false;
      steps('song');
    } else {
      const song = await showdown(fins, songCard);
      showBig(songCard(song, { size: 'big' }));
      const isNew = win('song', song.id);
      $('.player-slot').hidden = false;
      // The user may have switched tabs during the spin: never start sound in a hidden section.
      if (section.closest('[hidden]')) player.cue(song.id); else player.play(song.id);
      $('.now').replaceChildren('Now playing: ', Object.assign(document.createElement('b'), { textContent: song.t }), ` · ${song.by} · #${song.o}`);
      $('.hint').textContent = isNew ? 'New card collected! Spin again?' : 'Already in your binder. Spin again?';
      stage = 'done';
      $('.spin').textContent = 'AGAIN';
      steps('mv');
      $('.result').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'nearest' });
    }
  }

  $('.spin').addEventListener('click', spin);
  $('.reshuffle').addEventListener('click', () => !busy && newArtistWheel());
  $('.restart').addEventListener('click', () => !busy && newArtistWheel());
  newArtistWheel();
  return { stop: () => player.stop() };
}
