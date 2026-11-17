// Tiny static file server for local play and testing:  npm start
// YouTube players need a real http(s) address, so don't open index.html from disk.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 5173;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' };
// Publish page assets only; update scripts and review files stay private.
const PUBLIC = ['index.html', 'landing.css', 'landing.js', 'favicon.svg', 'og.png', 'kpop/index.html', 'styles.css', 'src/', 'data/', 'art/', 'landing-art/',
  'pop/index.html', 'pop/styles.css', 'pop/src/', 'pop/data/',
  'anime/index.html', 'anime/styles.css', 'anime/src/', 'anime/data/'];

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const side = url.pathname.replace(/^\/+/, '');
  if (['kpop', 'pop', 'anime'].includes(side)) {
    res.writeHead(301, { Location: '/' + side + '/' + url.search }); return res.end();
  }
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, rel);
  const ok = file.startsWith(root + path.sep) && PUBLIC.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p)));
  try {
    if (!ok) throw new Error('not public');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, () => {
  console.log(`Bias Roulette is running:\n  On this computer:  http://localhost:${port}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  On your phone (same Wi-Fi):  http://${n.address}:${port}`);
  }
});
