const REDIRECTS = new Set([301, 302, 303, 307, 308]);
export const MAX_BYTES = 15 * 1024 * 1024;
export const TIMEOUT_MS = 30_000;

export async function safeFetch(url, {
  hosts, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, headers, fetchImpl = globalThis.fetch,
}) {
  let target = new URL(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Fetch timed out')), timeoutMs);
  try {
    for (let redirects = 0; ; redirects++) {
      if (target.protocol !== 'https:' || !hosts.includes(target.hostname)) {
        throw new Error(`Fetch host or protocol not allowed: ${target.origin}`);
      }
      const response = await fetchImpl(target, { headers, signal: controller.signal, redirect: 'manual' });
      if (!REDIRECTS.has(response.status)) {
        const body = await readBody(response, maxBytes);
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 5) throw new Error('Invalid or excessive redirects');
      target = new URL(location, target);
    }
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(response, maxBytes) {
  if (!response.body) return null;
  const oversize = () => new Error(`Fetch response exceeds ${maxBytes} bytes`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw oversize();
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, bytes);
      bytes += value.byteLength;
      if (bytes > maxBytes) throw oversize();
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}
