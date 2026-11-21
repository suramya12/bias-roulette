// A roulette deck, with the same rules as the K-pop side:
//  1. every artist is on the wheel; spin to draw 5 finalists,
//  2. showdown: the wheel holds only the finalists, first to 3 hits wins,
//  3. the winner's songs go on the wheel; draw 5, showdown, and the MV plays.
// One deck per side.
import * as G from './game.js';
import { reveal, creditLine, reduced } from './cards.js';
import { createWheel } from './wheel.js';
import { createPlayer } from './player.js';
import { createAutoAdvance } from '../../src/auto-advance.js';

const wait = (ms) => new Promise((r) => setTimeout(r, reduced.matches ? Math.min(ms, 60) : ms));
// A wheel stays readable up to about 24 slices (15° each). Bigger decks still draw from every
// entry; the wheel shows a fresh random 24 that always includes the one the draw picked.
export const MAX_SLICES = 24;

// Autoplay, kept in the browser. on: when the MV ends, the next round
// plays by itself. same: keep the artist and draw another of their songs.
let AUTO_KEY = 'encore.autoplay';
export function normalizeAutoplay(value) {
  const saved = value ?? {};
  return {
    on: Object.hasOwn(saved, 'on') && saved.on === true,
    same: Object.hasOwn(saved, 'same') && saved.same === true,
  };
}
let auto = normalizeAutoplay();
const controllers = [];
export function configureAutoplay(key) {
  AUTO_KEY = key;
  let savedAuto;
  try { savedAuto = JSON.parse(localStorage.getItem(AUTO_KEY)); } catch {}
  auto = normalizeAutoplay(savedAuto);
}

function renderAuto() {
  document.querySelectorAll('#roulette .autoplay').forEach((d) => {
    const [on, same] = d.querySelectorAll('input');
    on.checked = auto.on;
    same.checked = auto.same;
    same.disabled = !auto.on;
    d.classList.toggle('is-on', auto.on);
    d.querySelector('.auto-state').textContent = !auto.on ? 'off' : auto.same ? `same ${d.dataset.noun || 'artist'}` : 'on';
  });
}

export function createRoulette(section, { pool, songsById, portraits, win, artistCard, songCard, fills, noun = 'artist', sound = null }) {
  section.append(document.querySelector('#rouletteTpl').content.cloneNode(true));
  const $ = (s) => section.querySelector(s);
  $('.autoplay').dataset.noun = noun;
  if (noun !== 'artist') {
    $('[data-step=artist]').textContent = noun[0].toUpperCase() + noun.slice(1);
    const same = $('[data-auto=same]').parentElement.querySelector('span');
    same.firstChild.textContent = `Same ${noun}`;
    same.querySelector('small').textContent = `Keep this ${noun} and draw another of their songs`;
  }
  if (!pool.length) {
    $('.spin').disabled = true;
    $('.auto').disabled = true;
    $('.autoplay').hidden = true;
    $('.hint').textContent = `No ${noun}s are available in this deck yet.`;
    return { stop() {} };
  }
  const wheel = createWheel($('.wheel-canvas'), fills);
  const player = createPlayer($('.player'), {
    onEnd: (token) => autoplay.end(token),
    onFail: (token) => autoplay.fail(token),
    onPlay: (token) => autoplay.play(token),
    onBlocked: (token) => autoplay.blocked(token),
  });
  let roundGeneration = 0;
  const autoplay = createAutoAdvance({
    enabled: auto.on, isActive: () => !section.closest('[hidden]'),
    advance: () => autoNext(),
    onPause: (paused) => paused ? player.showAutoPaused(() => autoplay.resume()) : player.clearAutoPaused(),
  });
  controllers.push(autoplay);
  function invalidate(stopPlayback = true) { roundGeneration++; autoplay.invalidate(); if (stopPlayback) player.stop(); }
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

  /** Big draw: more open entries than the wheel can show legibly. */
  const windowed = () => duel.phase === 'draw' && duel.n - duel.fin.length > MAX_SLICES;
  let view = null; // item indexes on the wheel while windowed, else null

  function drawWheel() {
    if (windowed()) { showWindow(null); return; }
    view = null;
    const w = duel.wheel();
    wheel.set(w.map((s) => label(items[s.index])), w.map((s) => s.taken));
  }

  /** A random MAX_SLICES of the entries not drawn yet, with `target` (the draw's pick) among them. */
  function showWindow(target) {
    const open = [];
    for (let i = 0; i < items.length; i++) if (i !== target && !duel.fin.includes(i)) open.push(i);
    view = G.shuffle(open).slice(0, MAX_SLICES - (target == null ? 0 : 1));
    if (target != null) view.splice(Math.floor(Math.random() * (view.length + 1)), 0, target);
    wheel.set(view.map((i) => label(items[i])), view.map(() => false));
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
    hint(view
      ? `All ${list.length} ${what} are in the draw; the wheel shows ${MAX_SLICES} at a time. Spin to draw ${duel.needed} finalists.`
      : `All ${list.length} ${what} are on the wheel. Spin to draw ${duel.needed} finalists.`);
  }

  /** keepResult: after a finished round the MV keeps playing below; otherwise clear the old result. */
  function newGame(keepResult = false) {
    if (!keepResult) { player.stop(); $('.result').hidden = true; }
    chosen = null;
    $('.spin').textContent = 'SPIN';
    $('.auto').hidden = false;
    $('.another').hidden = true;
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
    if (document.hidden) reveal(card); else requestAnimationFrame(() => reveal(card));
  }

  async function finishArtist(fast = false) {
    const generation = roundGeneration;
    chosen = items[duel.winner];
    $('.result').hidden = false;
    player.stop();
    $('.player-slot').hidden = true;
    showBig(artistCard(chosen, { size: 'big' }), [creditLine(portraits[chosen.name])]);
    const isNew = win('artist', chosen.name);
    sound?.chime();
    $('.restart').hidden = false;
    steps('song');
    const songs = G.wheelSongs(chosen, songsById, Infinity);
    if (songs.length === 1) {
      // One song: no wheel to spin. Let the winner's card land, then reveal that song and play it.
      stage = 'song'; items = songs; duel = new G.Duel(1); slots = [];
      $('.hand').replaceChildren();
      $('.readout').textContent = '';
      hint(`${chosen.name} wins${isNew ? ' and joins your collection' : ''}! Its only song plays next.`);
      if (!document.hidden) await wait(fast ? 500 : 1100);
      if (generation !== roundGeneration) return;
      await finishSong();
      return;
    }
    startStage('song', songs);
    hint(`${chosen.name} wins${isNew ? ' and joins your collection' : ''}! ${$('.hint').textContent}`);
  }

  async function finishSong() {
    const song = items[duel.winner];
    // The winner of round one stays named next to its song instead of vanishing.
    const drawnFor = Object.assign(document.createElement('p'), { className: 'drawn-for' });
    drawnFor.append('♥ Drawn for ', Object.assign(document.createElement('b'), { textContent: chosen.name }));
    showBig(songCard(song, { size: 'big' }), [drawnFor]);
    sound?.fanfare(song.o <= 10 ? 'legendary' : undefined);
    const isNew = win('song', song.id);
    $('.player-slot').hidden = false;
    // The user may have switched tabs during the spin: never start sound in a hidden section.
    const token = autoplay.begin();
    if (section.closest('[hidden]')) player.cue(song.id, token); else player.play(song.id, token);
    $('.now').replaceChildren('Now playing: ', Object.assign(document.createElement('b'), { textContent: song.t }), ` · ${song.by} · #${song.o}`);
    hint(isNew ? 'New card collected! Spin again?' : 'Already in your collection. Spin again?');
    stage = 'done';
    $('.spin').textContent = 'AGAIN';
    $('.auto').hidden = true;
    $('.another').hidden = G.wheelSongs(chosen, songsById, Infinity).length < 2; // one song: nothing to redo
    $('.another').textContent = `Another ${chosen.name} song`;
    steps('mv');
    // Land with the result's top just under the sticky header (html scroll-padding-top), never behind it.
    if (!document.hidden) $('.result').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
  }

  /** One spin of the current stage. */
  async function step(fast = false) {
    const generation = roundGeneration;
    const wasWindowed = windowed();
    const ev = duel.spin();
    hint('Spinning…'); // the old result never sits beside a new spin
    const name = label(items[ev.index]);
    let segment = ev.segment;
    if (wasWindowed) { showWindow(ev.index); segment = view.indexOf(ev.index); }
    let last = '';
    const onTick = (t) => {
      $('.readout').textContent = t;
      if (t !== last) { last = t; sound?.tick(); }
    };
    // Hidden tab: no animation, but the wheel and title still land on the result so they never disagree with the hint.
    if (!document.hidden) await wheel.spin(segment, onTick, fast);
    else { wheel.spin(segment, null, true); $('.readout').textContent = name; }
    if (generation !== roundGeneration) return;
    if (ev.kind === 'draw') {
      await addFinalist(ev, fast);
      if (generation !== roundGeneration) return;
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
    if (!document.hidden) await wait(fast ? 300 : 600);
    if (generation !== roundGeneration) return;
    if (stage === 'artist') await finishArtist(fast); else await finishSong();
  }

  async function run(fn) {
    if (busy) return;
    busy = true;
    sound?.unlock();
    $('.spin').disabled = $('.auto').disabled = true;
    try { await fn(); } finally { $('.spin').disabled = $('.auto').disabled = false; busy = false; }
  }

  $('.spin').addEventListener('click', () => run(async () => {
    invalidate(false);
    if (stage === 'done') { newGame(true); return; }
    await step();
  }));
  // Plays every remaining spin quickly, keeping whatever has been drawn so far.
  $('.auto').addEventListener('click', () => run(async () => {
    invalidate(false);
    const generation = roundGeneration;
    while (stage !== 'done' && generation === roundGeneration) await step(true);
  }));
  $('.restart').addEventListener('click', () => { if (!busy) { invalidate(); newGame(); } });

  /** Same artist, new song: redo the song draw and showdown. skipId leaves that song off the wheel. */
  function againSameArtist(skipId) {
    $('.spin').textContent = 'SPIN';
    $('.auto').hidden = false;
    $('.another').hidden = true;
    steps('song');
    const songs = G.wheelSongs(chosen, songsById, Infinity);
    startStage('song', skipId ? songs.filter((s) => s.id !== skipId) : songs);
    hint(`Still ${chosen.name}. ${$('.hint').textContent}`);
  }
  // The current MV keeps playing until a new song wins.
  $('.another').addEventListener('click', () => {
    if (busy || !chosen) return;
    invalidate(false);
    againSameArtist();
    $('.wheel-zone').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'nearest' });
  });

  /** After the MV ends: play the next round quickly, like Choose for me. Only in the deck on screen. */
  function autoNext() {
    if (section.closest('[hidden]')) return;
    run(async () => {
      const generation = roundGeneration;
      if (stage === 'done' && auto.same && chosen && G.wheelSongs(chosen, songsById, Infinity).length > 1) {
        againSameArtist(items[duel.winner].id); // never the song that just played
        if (duel.phase === 'done') { await finishSong(); return; } // one song left: nothing to spin
      } else if (stage === 'done') newGame(true);
      while (stage !== 'done' && generation === roundGeneration) await step(true);
    });
  }

  const menu = $('.autoplay');
  menu.querySelectorAll('input').forEach((input) => input.addEventListener('change', () => {
    auto[input.dataset.auto] = input.checked;
    try { localStorage.setItem(AUTO_KEY, JSON.stringify(auto)); } catch {}
    if (input.dataset.auto === 'on') controllers.forEach((controller) => controller.setEnabled(auto.on));
    renderAuto();
  }));
  document.addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
  });
  renderAuto();
  newGame();
  return { stop: () => { invalidate(); if (busy) newGame(); } };
}
