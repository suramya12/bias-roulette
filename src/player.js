// YouTube IFrame Player wrapper.
// Checked against https://developers.google.com/youtube/iframe_api_reference :
//  - onError codes: 2 bad id, 5 HTML5 error, 100 removed/private, 101 and 150 embedding
//    not allowed by the owner, 153 no Referer (e.g. page opened from a file).
//  - onAutoplayBlocked fires when the browser refuses autoplay or a scripted playVideo().
// Autoplay with sound is up to the browser, so there is always a way out:
// a big play button if playback has not started, and a "Watch on YouTube" link on errors.

import { loadApi } from './youtube-api.js';
import { isVideoId } from './validation.js';
export { loadApi };

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
  /** onEnd: the video played to the end. onFail: it cannot play here (both used by autoplay). */
  constructor({ box, mountId, overlay, fallback, message, link, hint, onEnd, onFail, onPlay, onBlocked }) {
    Object.assign(this, { box, mountId, overlay, fallback, message, link, hint, onEnd, onFail, onPlay, onBlocked });
    this.player = null;
    this.ready = false;
    this.failed = false;
    this.videoId = null;
    this.seq = 0;
    this.timer = 0;
    overlay.addEventListener('click', () => this.#tapToPlay());
  }

  /** Load a video and try to start it. */
  async show(videoId, attempt) {
    const my = ++this.seq;
    this.attempt = attempt;
    try { this.player?.destroy(); } catch { /* already removed */ }
    this.player = null;
    this.ready = false;
    this.videoId = isVideoId(videoId) ? videoId : null;
    this.ended = false;
    this.failed = false;
    this.clearAutoPaused();
    clearTimeout(this.timer);
    this.box.classList.remove('failed');
    this.overlay.hidden = true;
    this.fallback.hidden = true;
    this.hint.hidden = true;
    this.link.hidden = this.videoId === null;
    if (!this.videoId) {
      this.link.removeAttribute('href');
      return this.#fail(2, my);
    }
    this.link.href = `https://www.youtube.com/watch?v=${videoId}`;

    if (location.protocol === 'file:') return this.#fail('file', my);
    try { await loadApi(); } catch { this.#fail('api', my); return; }
    if (my !== this.seq) return;

    // Each iframe owns one attempt, including when the same video is picked twice.
    // YouTube's error/blocked events carry no video identity on a reused iframe.
    document.getElementById(this.mountId)?.remove();
    const mount = document.createElement('div');
    mount.id = this.mountId;
    this.box.prepend(mount);
    this.player = new window.YT.Player(mount, {
        width: '100%', height: '100%', videoId,
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onReady: (e) => {
            if (!this.#valid(my)) return;
            this.ready = true;
            e.target.playVideo();
            this.#watch(my);
          },
          onStateChange: (e) => this.#state(e.data, my),
          onError: (e) => this.#fail(e.data, my),
          onAutoplayBlocked: () => {
            if (!this.#valid(my)) return;
            clearTimeout(this.timer);
            this.showPlayButton();
            this.onBlocked?.(attempt);
          },
        },
      });
  }

  stop() {
    this.seq++;
    this.videoId = null;
    clearTimeout(this.timer);
    this.overlay.hidden = true;
    try { if (this.ready) this.player.stopVideo(); } catch { /* player already gone */ }
  }

  // If nothing is playing a few seconds after loading, autoplay was refused quietly.
  #valid(my) { return my === this.seq && this.videoId !== null && !this.failed; }

  #watch(my) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.#valid(my)) return;
      const s = this.#playerState();
      if (s !== 1 && s !== 3) {
        this.showPlayButton();
        this.onBlocked?.(this.attempt);
      }
    }, 3000);
  }

  #playerState() {
    try { return this.player.getPlayerState(); } catch { return -1; }
  }

  #state(s, my) {
    if (!this.#valid(my)) return;
    if (s === 1) { // playing
      clearTimeout(this.timer);
      this.overlay.hidden = true;
      this.hint.hidden = true;
      this.onPlay?.(this.attempt);
    } else if (s === 0 && !this.ended) {
      clearTimeout(this.timer);
      this.ended = true;
      this.onEnd?.(this.attempt);
    }
  }

  showPlayButton() {
    if (!this.videoId || this.failed || this.#playerState() === 1) return;
    this.overlay.hidden = false;
  }

  #tapToPlay() {
    const my = this.seq;
    if (!this.#valid(my)) return;
    try { this.player.playVideo(); } catch { /* ignore */ }
    // Some phones only accept a tap on the video itself: uncover it either way.
    setTimeout(() => {
      if (!this.#valid(my)) return;
      this.overlay.hidden = true;
      if (!this.failed && this.#playerState() !== 1) this.hint.hidden = false;
    }, 600);
  }

  showAutoPaused(resume) {
    this.autoPaused = true;
    this.message.textContent = "3 videos in a row wouldn't play here. Auto paused.";
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-pink';
    button.textContent = 'Resume';
    button.addEventListener('click', resume);
    this.message.append(' ', button);
    this.message.setAttribute('role', 'status');
    this.fallback.hidden = false;
    this.box.classList.add('failed');
  }

  clearAutoPaused() {
    if (!this.autoPaused) return;
    this.autoPaused = false;
    this.message.textContent = this.lastMessage || '';
  }

  #fail(code, my) {
    if (my !== this.seq || this.failed) return;
    this.failed = true;
    clearTimeout(this.timer);
    this.overlay.hidden = true;
    this.hint.hidden = true;
    this.box.classList.add('failed');
    this.lastMessage = MESSAGES[code] || 'This video cannot be played here.';
    this.message.textContent = this.lastMessage;
    this.fallback.hidden = false;
    try { if (this.ready) this.player.stopVideo(); } catch { /* ignore */ }
    this.onFail?.(this.attempt);
  }
}
