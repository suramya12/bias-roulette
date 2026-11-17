// Each attempt owns its iframe and callbacks, so late YouTube events cannot affect its replacement.
let apiReady;
function loadApi() {
  if (!apiReady) {
    apiReady = new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = reject;
      document.head.append(script);
    }).catch((error) => { apiReady = null; throw error; });
  }
  return apiReady;
}

export function createPlayer(host, { onEnd, onFail, onPlay, onBlocked } = {}) {
  let player = null, generation = 0, pauseMessage = null;
  function clearAutoPaused() { pauseMessage?.remove(); pauseMessage = null; }
  function stop() {
    generation++;
    try { player?.destroy?.(); } catch {}
    player = null;
  }
  async function load(id, token, autoplay) {
    stop(); clearAutoPaused();
    const mine = generation;
    let failed = false;
    const valid = () => mine === generation;
    const fail = () => {
      if (!valid() || failed) return;
      failed = true;
      try { player?.destroy?.(); } catch {}
      player = null;
      host.replaceChildren();
      const f = document.createElement('div');
      f.className = 'fallback';
      f.style.backgroundImage = `linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.55)), url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)`;
      const a = document.createElement('a');
      a.href = `https://www.youtube.com/watch?v=${id}`;
      a.target = '_blank'; a.rel = 'noopener'; a.textContent = '▶ Watch on YouTube';
      f.append(a); host.append(f);
      onFail?.(token);
    };
    try {
      const YT = await loadApi();
      if (!valid()) return;
      host.replaceChildren();
      const mount = document.createElement('div'); host.append(mount);
      player = new YT.Player(mount, {
        videoId: id,
        playerVars: { autoplay: 0, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: (e) => { if (valid() && !failed && autoplay) e.target.playVideo(); },
          onStateChange: (e) => {
            if (!valid() || failed) return;
            if (e.data === 0) onEnd?.(token);
            if (e.data === 1) { host.querySelector('.tap-to-play')?.remove(); onPlay?.(token); }
          },
          onError: (e) => { if ([2, 5, 100, 101, 150, 153].includes(e.data)) fail(); },
          onAutoplayBlocked: (e) => {
            if (!valid() || failed) return;
            host.querySelector('.tap-to-play')?.remove();
            const button = document.createElement('button');
            button.className = 'tap-to-play'; button.type = 'button'; button.textContent = 'Tap to play';
            button.addEventListener('click', () => { if (valid()) e.target.playVideo(); });
            host.append(button); onBlocked?.(token);
          },
        },
      });
    } catch { fail(); }
  }
  return {
    play: (id, token) => load(id, token, true),
    cue: (id, token) => load(id, token, false),
    stop,
    showAutoPaused(resume) {
      clearAutoPaused();
      pauseMessage = document.createElement('p'); pauseMessage.className = 'auto-paused';
      pauseMessage.setAttribute('role', 'status');
      pauseMessage.append("3 videos in a row wouldn't play here. Auto paused. ");
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Resume';
      button.addEventListener('click', resume); pauseMessage.append(button);
      host.after(pauseMessage);
    },
    clearAutoPaused,
  };
}
