// Tiny static file server for local play and testing: npm start
// YouTube players need a real http(s) address, so don't open index.html from disk.
import { fileURLToPath } from 'node:url';
import { serveStatic } from './static-server.mjs';

// Publish page assets only; update scripts and review files stay private.
const PUBLIC = ['index.html', 'landing.css', 'landing.js', 'favicon.svg', 'og.png', 'kpop/index.html', 'kpop/styles.css', 'kpop/entry.js', 'kpop/data/data.json', 'kpop/data/portraits.json', 'styles.css', 'src/', 'data/', 'art/', 'landing-art/',
  'pop/index.html', 'pop/styles.css', 'pop/src/', 'pop/data/',
  'anime/index.html', 'anime/styles.css', 'anime/entry.js', 'anime/src/', 'anime/data/',
  'bollywood/index.html', 'bollywood/styles.css', 'bollywood/entry.js',
  'bollywood/data/data.json', 'bollywood/data/portraits.json', 'bollywood/data/landing.json'];

await serveStatic({
  root: fileURLToPath(new URL('..', import.meta.url)),
  port: Number(process.env.PORT) || 5173,
  publicPaths: PUBLIC,
  redirects: new Map(['/kpop', '/pop', '/anime', '/bollywood'].map((side) => [side, side + '/'])),
  name: 'Bias Roulette',
});
