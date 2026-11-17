// YouTube IFrame player with a "Watch on YouTube" fallback for videos that can't be embedded.
let apiReady;
function loadApi() {
  apiReady ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = reject;
    document.head.append(s);
  });
  return apiReady;
}

/** onEnd: the video played to the end. onFail: it can't be embedded (both used by autoplay). */
export function createPlayer(host, { onEnd, onFail } = {}) {
  // wantPlay is false after stop() or cue(): a player that is still loading must not start on its own.
  let player = null, current = null, wantPlay = false;
  const fallback = (id) => {
    host.replaceChildren();
    const f = document.createElement('div');
    f.className = 'fallback';
    f.style.backgroundImage = `linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.55)), url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)`;
    const a = document.createElement('a');
    a.href = `https://www.youtube.com/watch?v=${id}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '▶ Watch on YouTube';
    f.append(a);
    host.append(f);
    player = null;
    onFail?.();
  };
  async function load(id, autoplay) {
    current = id;
    wantPlay = autoplay;
    try {
      const YT = await loadApi();
      if (current !== id) return;
      if (player?.loadVideoById) return wantPlay ? player.loadVideoById(id) : player.cueVideoById(id);
      host.replaceChildren();
      const mount = document.createElement('div');
      host.append(mount);
      player = new YT.Player(mount, {
        videoId: id,
        playerVars: { autoplay: 0, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: (e) => wantPlay && e.target.playVideo(),
          onStateChange: (e) => e.data === 0 && onEnd?.(),
          onError: (e) => [2, 5, 100, 101, 150].includes(e.data) && fallback(current),
        },
      });
    } catch {
      fallback(id);
    }
  }
  return {
    play: (id) => load(id, true),
    /** Load the video without starting it (used when its section is hidden). */
    cue: (id) => load(id, false),
    stop() { wantPlay = false; try { player?.pauseVideo?.(); } catch {} },
  };
}
