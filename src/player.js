// YouTube IFrame Player wrapper.
// Checked against https://developers.google.com/youtube/iframe_api_reference :
//  - onError codes: 2 bad id, 5 HTML5 error, 100 removed/private, 101 and 150 embedding
//    not allowed by the owner, 153 no Referer (e.g. page opened from a file).
//  - onAutoplayBlocked fires when the browser refuses autoplay or a scripted playVideo().
// Autoplay with sound is up to the browser, so there is always a way out:
// a big play button if playback has not started, and a "Watch on YouTube" link on errors.

let apiPromise = null;

export function loadApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const fail = (why) => { apiPromise = null; reject(new Error(why)); };
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => fail('blocked');
    document.head.append(s);
    setTimeout(() => { if (!window.YT?.Player) fail('timeout'); }, 12000);
  });
  return apiPromise;
}

const MESSAGES = {
  2: 'This video link looks broken.',
  5: 'The player could not play this video.',
  100: 'This video has been removed or made private.',
  101: 'YouTube does not allow this video to play on other sites.',
  150: 'YouTube does not allow this video to play on other sites.',
  153: 'YouTube refused the player. Open this page from a web address, not from a file.',
  api: 'The YouTube player could not load. Check your connection or ad blocker.',
  file: 'YouTube players do not work when the page is opened from a file. Run it from a web address.',
};

export class VideoPlayer {
  constructor({ box, mountId, overlay, fallback, message, link, hint }) {
    Object.assign(this, { box, mountId, overlay, fallback, message, link, hint });
    this.player = null;
    this.ready = false;
    this.failed = false;
    this.videoId = null;
    this.seq = 0;
    this.timer = 0;
    overlay.addEventListener('click', () => this.#tapToPlay());
  }

  /** Load a video and try to start it. */
  async show(videoId) {
    const my = ++this.seq;
    this.videoId = videoId;
    this.failed = false;
    clearTimeout(this.timer);
    this.box.classList.remove('failed');
    this.overlay.hidden = true;
    this.fallback.hidden = true;
    this.hint.hidden = true;
    this.link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

    if (location.protocol === 'file:') return this.#fail('file');
    try { await loadApi(); } catch { if (my === this.seq) this.#fail('api'); return; }
    if (my !== this.seq) return;

    if (!this.player) {
      const first = videoId;
      this.player = new window.YT.Player(this.mountId, {
        width: '100%', height: '100%', videoId,
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: () => {
            this.ready = true;
            if (this.videoId !== first) this.player.loadVideoById(this.videoId);
            else this.player.playVideo();
            this.#watch();
          },
          onStateChange: (e) => this.#state(e.data),
          onError: (e) => this.#fail(e.data),
          onAutoplayBlocked: () => this.showPlayButton(),
        },
      });
    } else if (this.ready) {
      this.player.loadVideoById(videoId);
      this.#watch();
    }
  }

  stop() {
    this.seq++;
    clearTimeout(this.timer);
    this.overlay.hidden = true;
    try { if (this.ready) this.player.stopVideo(); } catch { /* player already gone */ }
  }

  // If nothing is playing a few seconds after loading, autoplay was refused quietly.
  #watch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const s = this.#playerState();
      if (s !== 1 && s !== 3) this.showPlayButton();
    }, 3000);
  }

  #playerState() {
    try { return this.player.getPlayerState(); } catch { return -1; }
  }

  #state(s) {
    if (s === 1) { // playing
      clearTimeout(this.timer);
      this.overlay.hidden = true;
      this.hint.hidden = true;
    }
  }

  showPlayButton() {
    if (this.failed || this.#playerState() === 1) return;
    this.overlay.hidden = false;
  }

  #tapToPlay() {
    try { this.player.playVideo(); } catch { /* ignore */ }
    // Some phones only accept a tap on the video itself: uncover it either way.
    setTimeout(() => {
      this.overlay.hidden = true;
      if (!this.failed && this.#playerState() !== 1) this.hint.hidden = false;
    }, 600);
  }

  #fail(code) {
    this.failed = true;
    clearTimeout(this.timer);
    this.overlay.hidden = true;
    this.hint.hidden = true;
    this.box.classList.add('failed');
    this.message.textContent = MESSAGES[code] || 'This video cannot be played here.';
    this.fallback.hidden = false;
    try { if (this.ready) this.player.stopVideo(); } catch { /* ignore */ }
  }
}
