import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

export function relativeInside(root, file) {
  const rel = path.relative(root, file);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

export async function serveStatic({ root, port, publicPaths, redirects, name, home = '' }) {
  root = await realpath(root);
  const lan = process.argv.includes('--lan') || process.env.LAN === '1';
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    let url, pathname;
    try {
      url = new URL(req.url, 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Bad request');
    }

    const redirect = redirects.get(pathname);
    if (redirect) {
      res.writeHead(301, { Location: redirect + url.search });
      return res.end();
    }

    let rel = pathname.replace(/^\/+/, '');
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    try {
      const candidate = path.resolve(root, rel);
      if (!relativeInside(root, candidate)) throw new Error('Outside root');
      const file = await realpath(candidate);
      const resolved = relativeInside(root, file);
      if (!resolved || !publicPaths.some((entry) => resolved === entry || (entry.endsWith('/') && resolved.startsWith(entry)))) {
        throw new Error('Outside public paths');
      }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      return res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
  });

  return server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`${name} is running:\n  On this computer:  http://localhost:${port}${home}`);
    if (!lan) {
      console.log('  For phone access on the same Wi-Fi, use npm run lan.');
      return;
    }
    for (const list of Object.values(networkInterfaces())) {
      for (const address of list || []) {
        if (address.family === 'IPv4' && !address.internal) {
          console.log(`  On your phone (same Wi-Fi):  http://${address.address}:${port}${home}`);
        }
      }
    }
  });
}
