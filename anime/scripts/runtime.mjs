// Projects anime/data/catalog.json into the slim anime/data/runtime.json loaded by the browser,
// keeping only the fields read by anime/src/app.js and anime/src/engine.js.

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const animeRoot = fileURLToPath(new URL('../', import.meta.url));

export function toRuntimeCatalog(catalog) {
  const songs = (catalog?.songs ?? [])
    .filter((song) => song.videos?.length)
    .map((song) => {
      const out = {
        id: song.id,
        kind: song.kind,
        use: song.use,
        title: song.title,
        artist: song.artist,
        year: song.year,
      };
      if (song.show !== undefined) out.show = song.show;
      if (song.source !== undefined) out.source = song.source;
      out.videos = song.videos.map((v) => ({
        id: v.id,
        kind: v.kind,
        source: v.source,
        views: Number(v.views) || 0,
      }));
      return out;
    });
  return { songs };
}

export async function writeRuntimeCatalog({ root = animeRoot, catalog } = {}) {
  const dataDir = join(root, 'data');
  const source = catalog ?? JSON.parse(await readFile(join(dataDir, 'catalog.json'), 'utf8'));
  const runtime = toRuntimeCatalog(source);
  const text = JSON.stringify(runtime);
  await writeFile(join(dataDir, 'runtime.json'), text, 'utf8');
  return { count: runtime.songs.length, bytes: Buffer.byteLength(text, 'utf8') };
}

if (process.argv[1] && pathToFileURL(resolvePath(process.argv[1])).href === import.meta.url) {
  writeRuntimeCatalog()
    .then(({ count, bytes }) => console.log(`anime runtime: ${count} songs, ${bytes} bytes.`))
    .catch((error) => { console.error(error.message || error); process.exitCode = 1; });
}
