// Writes the compact runtime index data/video-ids.json = {"ARTIST | Song": "videoId"}
// from data/videos.json, leaving the resolver's full metadata records intact.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function extractVideoIds(videos) {
  const out = {};
  for (const [key, entry] of Object.entries(videos || {})) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (typeof id === 'string' && id) out[key] = id;
  }
  return out;
}

export async function writeVideoIds({ root = defaultRoot, videos } = {}) {
  const source = videos ?? JSON.parse(await readFile(path.join(root, 'data/videos.json'), 'utf8'));
  const ids = extractVideoIds(source);
  const text = JSON.stringify(ids);
  await writeFile(path.join(root, 'data/video-ids.json'), text, 'utf8');
  return { count: Object.keys(ids).length, bytes: Buffer.byteLength(text, 'utf8') };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  writeVideoIds()
    .then(({ count, bytes }) => console.log(`video-ids: ${count} songs, ${bytes} bytes.`))
    .catch((error) => { console.error(error.message || error); process.exitCode = 1; });
}
