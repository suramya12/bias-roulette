// The page shell every music page shares: header, Roulette and Top 100 sections, credits, collection dialog.
// Static markup is a template string; everything that comes from the side's config goes in with textContent.
// No inline scripts or handlers: the pages have a strict CSP.

const SIDES = [
  { id: 'kpop', label: 'K-pop', modes: true },
  { id: 'pop', label: 'Pop & Latin', modes: true },
  { id: 'anime', label: 'Anime', modes: true },
  { id: 'bollywood', label: 'Bollywood', modes: true },
];

const markup = (config) => `
  <header class="top">
    <details class="genre" id="genre">
      <summary id="genreSummary"><span id="genreFirst"></span><span class="long" id="genreRest"></span> <span aria-hidden="true">▾</span></summary>
      <div class="genre-menu">${SIDES.map((side) => (side.id === config.side
        ? `<a aria-current="page" href="#" data-side="${side.id}"></a>`
        : `<a ${side.modes ? `data-mode-link="${side.id}" ` : ''}href="../${side.id}/${side.modes ? '#roulette' : ''}" data-side="${side.id}"></a>`)).join('')}</div>
    </details>
    <div class="toggle" role="tablist" aria-label="Game mode">
      <button role="tab" id="tab-roulette" aria-selected="true" aria-controls="roulette" data-mode="roulette">Roulette</button>
      <button role="tab" id="tab-top100" aria-selected="false" aria-controls="top100" tabindex="-1" data-mode="top100">Top 100</button>
    </div>
    <button class="binder-btn" id="openBinder" aria-haspopup="dialog" aria-label="Collection"><span class="long">Collection</span><span class="icon" aria-hidden="true">\u{1F0CF}</span> <b id="binderCount">0</b></button>
    <a class="home-link" href="../">Bias Roulette</a>
  </header>

  <main>
    <h1 class="title" id="title"><span id="titleLabel"></span> <span class="title-accent" id="titleAccent">Roulette</span></h1>

    <section id="roulette" class="mode" role="tabpanel" aria-labelledby="tab-roulette">
      <p class="deck-note" id="deckNote"></p>
      <div class="deck" id="deck-${config.deck}"></div>
    </section>

    <template id="rouletteTpl">
      <ol class="steps" aria-label="Progress">
        <li data-step="artist" class="on">Artist</li>
        <li data-step="song">Song</li>
        <li data-step="mv">MV</li>
      </ol>
      <div class="wheel-zone">
        <div class="wheel-wrap">
          <div class="pointer" aria-hidden="true"></div>
          <canvas class="wheel-canvas" width="640" height="640" role="img" aria-label="Wheel"></canvas>
          <button class="spin">SPIN</button>
        </div>
        <div class="wheel-side">
          <p class="readout" aria-hidden="true"></p>
          <p class="hint" role="status">Loading…</p>
          <div class="hand"></div>
          <div class="row-btns">
            <button class="ghost another" hidden>Another song</button>
            <button class="ghost auto">Choose for me</button>
            <button class="ghost restart" hidden>Start over</button>
            <details class="autoplay">
              <summary class="ghost">Auto <span class="auto-state">off</span></summary>
              <div class="auto-menu">
                <label class="switch"><input type="checkbox" data-auto="on"><span>Autoplay<small>When the MV ends, the next round starts by itself</small></span></label>
                <label class="switch"><input type="checkbox" data-auto="same"><span>Same artist<small>Keep this artist and draw another of their songs</small></span></label>
              </div>
            </details>
          </div>
        </div>
      </div>
      <div class="result" hidden>
        <div class="big-slot"></div>
        <div class="player-slot">
          <div class="player"></div>
          <p class="now"></p>
        </div>
      </div>
    </template>

    <section id="top100" class="mode" role="tabpanel" aria-labelledby="tab-top100" hidden>
      <p class="announce" id="topAnnounce" role="status" aria-live="polite">Loading…</p>
      <div class="ring-stage">
        <div class="ring" id="ring" aria-hidden="true"></div>
        <button class="ring-hit" id="ringBtn" type="button" aria-label="Pull a card"></button>
        <div class="floor" aria-hidden="true"></div>
      </div>
      <div class="range" role="group" aria-label="Pull from">
        <span>Pull from</span>
        <button class="chip-btn" id="r10" type="button" aria-pressed="false">Top 10</button>
        <button class="chip-btn" id="r50" type="button" aria-pressed="false">Top 50</button>
        <button class="chip-btn" id="r100" type="button" aria-pressed="true">Top 100</button>
      </div>
      <div class="row-btns center chart-actions">
        <button class="pull" id="pull" type="button">Pull a card</button>
        <label class="ghost switch chart-auto"><input id="chartAuto" type="checkbox"> Auto <span class="auto-state">off</span></label>
        <button class="ghost" id="sound" type="button" aria-pressed="true">Sound on</button>
      </div>
      <div class="result" id="tResult" hidden>
        <div class="big-slot" id="tCard"></div>
        <div class="player-slot">
          <div class="player" id="tPlayer"></div>
          <dl class="stats" id="tStats" hidden></dl>
          <div class="row-btns result-actions">
            <button class="pull" id="tAgain" type="button">Pull again</button>
            <button class="ghost" id="tNext" type="button">Next</button>
            <button class="ghost" id="tJump" type="button">Full chart</button>
          </div>
        </div>
      </div>
      <details class="chart-box" id="chartBox">
        <summary><span id="chartName"></span> <small>tap a song to play it</small></summary>
        <p class="method" id="chartMethod"></p>
        <ol class="chart" id="chart"></ol>
      </details>
    </section>

    <footer class="credits">
      <p id="creditText"></p>
      <details id="credits">
        <summary>Photo credits</summary>
        <ul id="creditList"></ul>
      </details>
    </footer>
  </main>

  <dialog id="binder" aria-labelledby="binderTitle">
    <div class="binder-head">
      <h2 id="binderTitle">Collection</h2>
      <div class="toggle small" role="tablist">
        <button role="tab" aria-selected="true" data-bt="a"><span id="bAName"></span> <b id="bA"></b></button>
        <button role="tab" aria-selected="false" data-bt="s">Songs <b id="bS"></b></button>
      </div>
      <button class="close" id="closeBinder" aria-label="Close">✕</button>
    </div>
    <div class="grid" id="binderGrid"></div>
  </dialog>

  <div class="toast-stack" id="toastStack" role="status" aria-live="polite"></div>
  <div id="fx" aria-hidden="true"></div>`;

export function renderShell(config) {
  document.querySelector('.stage-bg').insertAdjacentHTML('afterend', markup(config));
  const $ = (selector) => document.querySelector(selector);
  const [first, ...rest] = config.label.split(' ');
  $('#genreFirst').textContent = first;
  $('#genreRest').textContent = rest.length ? ' ' + rest.join(' ') : '';
  $('#genreSummary').setAttribute('aria-label', `Music: ${config.label}. Switch music`);
  for (const link of document.querySelectorAll('.genre-menu a')) {
    link.textContent = SIDES.find((side) => side.id === link.dataset.side).label;
  }
  $('#titleLabel').textContent = config.label;
  $('#deckNote').textContent = config.deckNote;
  $('#chartName').textContent = `The all-time ${config.label} Top 100`;
  $('#chartMethod').textContent = config.chartMethod;
  const noun = config.noun[0].toUpperCase() + config.noun.slice(1);
  $('#bAName').textContent = `${noun}s`;
  const credit = $('#creditText');
  credit.append('Fan project, not affiliated with any artist or label. ');
  if (config.source) {
    const link = Object.assign(document.createElement('a'), {
      href: config.source.href, target: '_blank', rel: 'noopener noreferrer', textContent: config.source.name,
    });
    credit.append('Stream and view counts: ', link, '. ');
  }
  const photos = config.photos !== false; // anime cards use video stills, so no photo credits
  credit.append(`Videos play from YouTube.${photos ? ` ${noun} photos: Wikimedia Commons, each under its own licence.` : ''}`);
  $('#credits').hidden = !photos;
}
