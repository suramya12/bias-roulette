let pending;

export function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pending) return pending;

  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const previous = window.onYouTubeIframeAPIReady;
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      script.onerror = null;
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous;
    };
    const fail = (message) => {
      if (settled) return;
      cleanup();
      script.remove();
      reject(new Error(message));
    };
    const ready = () => {
      if (settled || !window.YT?.Player) return;
      cleanup();
      resolve(window.YT);
      previous?.();
    };
    const timer = setTimeout(() => {
      if (window.YT?.Player) ready();
      else fail('YouTube API timed out');
    }, 8000);
    window.onYouTubeIframeAPIReady = ready;
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => fail('YouTube API request failed');
    document.head.append(script);
  }).finally(() => { pending = null; });
  return pending;
}
