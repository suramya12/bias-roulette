export const IMAGE_HOSTS = Object.freeze(['i.ytimg.com', 'upload.wikimedia.org', 'thumb.wikimedia.org']);
export const CREDIT_HOSTS = Object.freeze(['commons.wikimedia.org', 'en.wikipedia.org', 'www.youtube.com']);

export function isVideoId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);
}

export function videoThumbnail(id, size = 'hqdefault') {
  return isVideoId(id) ? `https://i.ytimg.com/vi/${id}/${size}.jpg` : null;
}

export function safeUrl(value, hosts) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && hosts.includes(url.hostname)) return url.href;
  } catch { /* invalid URL */ }
  return null;
}

export function isCardArtPath(value) {
  return typeof value === 'string' && /^art\/(song|idol)\/[A-Za-z0-9._-]+\.webp$/.test(value);
}
