import { eligible, pickNext, tierOf, copyQueue, copyLabel } from './engine.js';
import { PullMachine } from '../../src/pull-machine.js';
import { Sound } from '../../src/sound.js';
import { createAutoAdvance } from '../../src/auto-advance.js';
import { createPlayer } from '../../pop/src/player.js';

const $ = (selector) => document.querySelector(selector);
const get = (key, fallback = null) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
const put = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
put('bias-roulette.lastSide', 'anime');
const read = (key, fallback) => { try { return JSON.parse(get(key)) ?? fallback; } catch { return fallback; } };
const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;

async function boot() {
  const load = async (path) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not load ${path}`);
    return response.json();
  };
  const [{ songs }, kinds] = await Promise.all([load('data/catalog.json'), load('data/kinds.json')]);
  const savedUses = read('anime.uses', ['OP', 'ED', 'IN']);
  const uses = new Set((Array.isArray(savedUses) ? savedUses : []).filter((use) => ['OP', 'ED', 'IN'].includes(use)));
  if (!uses.size) ['OP', 'ED', 'IN'].forEach((use) => uses.add(use));
  const addons = Object.fromEntries(kinds.filter((kind) => kind.addon).map((kind) => [kind.id,
    get(`anime.addon.${kind.id}`, kind.default ? 'on' : 'off') === 'on']));
  const savedStrikes = read('anime.strikes', {});
  const localStrikes = Object.fromEntries(Object.entries(savedStrikes && typeof savedStrikes === 'object' ? savedStrikes : {})
    .filter(([, count]) => Number.isFinite(count) && count >= 0));
  const history = [];
  let pool = [], attempt = null, playingId = null;

  const sound = new Sound(get('anime.sound', 'on') !== 'off');
  const soundLabel = () => {
    $('#sound').textContent = sound.enabled ? 'Sound on' : 'Sound off';
    $('#sound').setAttribute('aria-pressed', String(sound.enabled));
  };
  $('#sound').addEventListener('click', () => {
    sound.enabled = !sound.enabled;
    if (sound.enabled) sound.unlock();
    put('anime.sound', sound.enabled ? 'on' : 'off');
    soundLabel();
  });
  soundLabel();

  function playing(id) {
    playingId = id;
    document.querySelectorAll('.card[data-song]').forEach((card) => card.classList.toggle('playing', card.dataset.song === id));
  }
  function card(song) {
    const el = document.createElement('div');
    el.className = 'card'; el.dataset.song = song.id;
    el.classList.toggle('playing', song.id === playingId);
    const image = Object.assign(document.createElement('img'), {
      src: `https://i.ytimg.com/vi/${song.videos[0].id}/mqdefault.jpg`, alt: '', draggable: false,
    });
    const label = Object.assign(document.createElement('span'), { className: 'slot-label', textContent: song.use });
    const year = Object.assign(document.createElement('span'), { className: 'card-year', textContent: song.year });
    const caption = Object.assign(document.createElement('div'), { className: 'card-caption' });
    caption.append(Object.assign(document.createElement('h3'), { className: 'card-title', textContent: song.title }),
      Object.assign(document.createElement('div'), { className: 'card-source', textContent: song.show ?? song.source }));
    el.append(image, label, year, caption);
    return el;
  }
  const status = (text = '') => {
    $('#playStatus').textContent = text;
    $('#playStatus').hidden = !text;
  };
  const current = (token) => token && attempt === token.attempt && attempt.current === token && !token.failed && !token.ended;
  const player = createPlayer($('#player'), {
    onPlay: (token) => {
      if (!current(token)) return;
      playing(attempt.song.id); status(); auto.play(attempt.autoToken);
    },
    onEnd: (token) => {
      if (!current(token)) return;
      token.ended = true;
      playing(null); auto.end(attempt.autoToken);
    },
    onBlocked: (token) => {
      if (current(token)) auto.blocked(attempt.autoToken);
    },
    onFail: (token, { code } = {}) => {
      if (!current(token)) return;
      token.failed = true; playing(null);
      if (code === 'api') {
        auto.blocked(attempt.autoToken);
        status("YouTube's player couldn't load. Watch on YouTube or retry.");
        const retry = Object.assign(document.createElement('button'), { type: 'button', className: 'ghost', textContent: 'Retry' });
        retry.addEventListener('click', () => {
          if (attempt?.current !== token) return;
          attempt.autoToken = auto.begin();
          loadCopy(token.video);
        });
        $('#playStatus').append(' ', retry);
        return;
      }
      // A missing Referer/client identity is a page configuration problem, not a bad copy.
      if (code === 153) {
        auto.blocked(attempt.autoToken);
        status("YouTube couldn't verify this page (error 153). Reload from the site's web address.");
        return;
      }
      localStrikes[token.video.id] = (localStrikes[token.video.id] || 0) + 1;
      put('anime.strikes', JSON.stringify(localStrikes));
      const next = attempt.queue.find((video) => !attempt.tried.has(video.id));
      if (next) { loadCopy(next); return; }
      status("Can't play here. Watch on YouTube or pull another song.");
      auto.fail(attempt.autoToken); // One failed song, regardless of its number of copies.
    },
  });
  const auto = createAutoAdvance({
    enabled: get('anime.auto') === 'on',
    isActive: () => machine.active && pool.length > 0,
    advance: () => machine.pull({ short: true, immediate: document.hidden }),
    onPause: (paused) => {
      $('#autoState').textContent = paused ? 'paused' : auto.enabled ? 'on' : 'off';
      if (paused) player.showAutoPaused(() => auto.resume()); else player.clearAutoPaused();
    },
  });
  $('#auto').checked = auto.enabled;
  $('#autoState').textContent = auto.enabled ? 'on' : 'off';
  $('#auto').addEventListener('change', () => {
    put('anime.auto', $('#auto').checked ? 'on' : 'off');
    $('#autoState').textContent = $('#auto').checked ? 'on' : 'off';
    auto.setEnabled($('#auto').checked);
  });

  function stop() {
    attempt = null; playing(null); auto.invalidate(); player.stop(); player.clearAutoPaused(); status();
    $('#swap').disabled = true;
  }
  const machine = new PullMachine({
    ring: $('#ring'), hit: $('#ringBtn'), buttons: [$('#pull')], slots: () => innerWidth < 520 ? 10 : 12,
    radius: (width, n) => Math.round((width / 2) / Math.tan(Math.PI / n) + 18),
    renderSlot: (slot, song) => { slot.classList.add('slot'); slot.replaceChildren(card(song)); },
    sound, tierOf, onPull: stop, onCancel: stop,
    say: (text) => { $('#announce').textContent = text; },
    onLand: (song, tier) => { $('#announce').textContent = `${song.title} — ${song.artist}, ${tier}`; },
    onReveal: (song, { short } = {}) => {
      history.push(song.id);
      if (history.length > 20) history.shift();
      attempt = {
        song, queue: withForced(copyQueue(song, { preferredId: get(`anime.copy.${song.id}`), localStrikes })),
        tried: new Set(), autoToken: auto.begin(), current: null,
      };
      $('#result').hidden = false;
      $('#songCard').replaceChildren(card(song));
      $('#nowTitle').textContent = `${song.title} — ${song.artist}`;
      const use = { OP: 'Opening', ED: 'Ending', IN: 'Insert song', MV: 'Animated MV' }[song.use];
      $('#nowMeta').textContent = `${song.show ?? song.source} · ${use} · ${song.year}`;
      loadCopy(attempt.queue[0]);
      if (!short && !document.hidden) $('#result').scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest',
      });
    },
  });
  // Test hook, like K-pop: ?forceVideo=ID puts that video first in every queue ('_k7gZaDjTTM' is embed-blocked).
  function withForced(queue) {
    const id = new URLSearchParams(location.search).get('forceVideo');
    return id ? [{ id, kind: 'tv', source: 'fan' }, ...queue] : queue;
  }
  function loadCopy(video) {
    const token = { attempt, video };
    attempt.current = token; attempt.tried.add(video.id);
    playing(null); status();
    $('#copyLabel').textContent = copyLabel(video);
    const next = (attempt.queue.indexOf(video) + 1) % attempt.queue.length;
    $('#swap').hidden = attempt.queue.length < 2;
    $('#swap').disabled = false;
    $('#swap').textContent = `Version ${attempt.queue.indexOf(video) + 1}/${attempt.queue.length} ⇄`;
    $('#swap').setAttribute('aria-label', `Play version ${next + 1} of ${attempt.queue.length} from the start`);
    player.play(video.id, token);
  }
  $('#swap').addEventListener('click', () => {
    if (!attempt || attempt.queue.length < 2) return;
    const index = attempt.queue.indexOf(attempt.current.video);
    const video = attempt.queue[(index + 1) % attempt.queue.length];
    put(`anime.copy.${attempt.song.id}`, video.id);
    // An explicit retry starts a fresh attempt; never carry an ended/failed Auto timer into it.
    attempt.tried = new Set(); attempt.autoToken = auto.begin();
    loadCopy(video);
  });

  function filter() {
    pool = eligible(songs, { uses, addons, kinds });
    machine.setPool(pool, () => pickNext(pool, history, random, songs));
    if (pool.length) machine.activate(); else machine.deactivate();
    $('#pull').disabled = $('#ringBtn').disabled = !pool.length;
    $('#pull').setAttribute('aria-disabled', String(!pool.length));
    $('#ringBtn').setAttribute('aria-disabled', String(!pool.length));
    $('#songCount').textContent = `${pool.length} ${pool.length === 1 ? 'song' : 'songs'}`;
    $('#pageStatus').textContent = pool.length ? '' : 'No songs match. Turn a filter back on.';
    $('#pageStatus').hidden = !!pool.length;
    $('#result').hidden = true;
    document.querySelectorAll('[data-use]').forEach((button) => {
      button.setAttribute('aria-pressed', String(uses.has(button.dataset.use)));
      button.setAttribute('aria-disabled', String(uses.size === 1 && uses.has(button.dataset.use)));
    });
  }
  document.querySelectorAll('[data-use]').forEach((button) => button.addEventListener('click', () => {
    const use = button.dataset.use;
    if (uses.has(use)) { if (uses.size === 1) return; uses.delete(use); } else uses.add(use);
    put('anime.uses', JSON.stringify([...uses])); filter();
  }));
  for (const kind of kinds.filter((kind) => kind.addon)) {
    const label = Object.assign(document.createElement('label'), { className: 'switch addon' });
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: addons[kind.id] });
    input.addEventListener('change', () => {
      addons[kind.id] = input.checked; put(`anime.addon.${kind.id}`, input.checked ? 'on' : 'off'); filter();
    });
    label.append(input, Object.assign(document.createElement('span'), { textContent: `+ ${kind.label}` }));
    $('#addons').append(label);
  }
  $('#genre').addEventListener('keydown', (event) => { if (event.key === 'Escape') $('#genre').open = false; });
  document.addEventListener('click', (event) => { if (!event.target.closest('#genre')) $('#genre').open = false; });
  addEventListener('pagehide', () => machine.deactivate());
  addEventListener('pageshow', (event) => { if (event.persisted) filter(); });
  filter();
}

try { await boot(); } catch {
  $('#pageStatus').hidden = false;
  $('#pageStatus').textContent = 'Could not load the song data. Reload to try again.';
  $('#pull').disabled = $('#ringBtn').disabled = true;
}
