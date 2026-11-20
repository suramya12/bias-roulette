// Generates 256x384 WebP (quality 0.84) variants under art/song/xs/ and art/idol/xs/
// from the 768x1152 originals using headless Chrome over CDP.
//
//   node scripts/art-variants.mjs           skip existing xs/ files
//   node scripts/art-variants.mjs --force   regenerate all xs/ files

import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = 256;
const HEIGHT = 384;
const QUALITY = 0.84;
const DIRS = ['art/song', 'art/idol'];
const DEFAULT_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const chromePath = process.env.CHROME_PATH || DEFAULT_CHROME;

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function collectJobs() {
  const jobs = [];
  let skipped = 0;
  for (const relDir of DIRS) {
    const absDir = path.join(root, relDir);
    let entries;
    try { entries = await readdir(absDir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.webp')) continue;
      const outPath = path.join(absDir, 'xs', entry.name);
      if (!force && await exists(outPath)) { skipped++; continue; }
      jobs.push({
        urlPath: `/${relDir}/${encodeURIComponent(entry.name)}`,
        outPath,
        label: `${relDir}/xs/${entry.name}`,
      });
    }
  }
  return { jobs, skipped };
}

function startServer() {
  const artRoot = path.resolve(root, 'art');
  const html = `<!doctype html><meta charset="utf-8"><canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas>`;
  const server = createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url || '/', 'http://127.0.0.1');
      if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (!pathname.startsWith('/art/')) { res.writeHead(404); res.end(); return; }
      const rel = decodeURIComponent(pathname.slice(5));
      const filePath = path.resolve(artRoot, rel);
      if (!filePath.startsWith(artRoot + path.sep)) { res.writeHead(403); res.end(); return; }
      const buf = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': 'image/webp' });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function launchChrome(profileDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error(`Timed out waiting for Chrome DevTools.\n${stderr}`));
    }, 20_000);

    proc.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    proc.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Chrome exited early (${code}).\n${stderr}`));
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on ws:\/\/([^\s/]+)\//);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ proc, debugOrigin: `http://${match[1]}` });
      }
    });
  });
}

async function findPageWs(debugOrigin) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${debugOrigin}/json/list`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Could not find Chrome page target');
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();

    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const id = nextId++;
        return new Promise((res, rej) => {
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      once(method) {
        return new Promise((res) => {
          const list = listeners.get(method) || [];
          list.push(res);
          listeners.set(method, list);
        });
      },
      close() { ws.close(); },
    }));
    ws.addEventListener('error', (e) => reject(e.error || new Error('CDP WebSocket error')));
    ws.addEventListener('close', () => {
      for (const { rej } of pending.values()) rej(new Error('CDP WebSocket closed'));
      pending.clear();
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
        else res(msg.result);
      } else if (msg.method && listeners.has(msg.method)) {
        const list = listeners.get(msg.method);
        listeners.delete(msg.method);
        for (const fn of list) fn(msg.params);
      }
    });
  });
}

async function main() {
  const { jobs, skipped } = await collectJobs();
  if (!jobs.length) {
    console.log(`art-variants: 0 written, ${skipped} skipped.`);
    return;
  }

  let server;
  let proc;
  let cdp;
  let profileDir;
  let written = 0;

  try {
    const started = await startServer();
    server = started.server;
    const { baseUrl } = started;
    profileDir = await mkdtemp(path.join(tmpdir(), 'art-variants-'));
    const launched = await launchChrome(profileDir);
    proc = launched.proc;
    const wsUrl = await findPageWs(launched.debugOrigin);
    cdp = await connectCdp(wsUrl);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: `${baseUrl}/` });
    await loaded;

    const prefix = 'data:image/webp;base64,';
    for (const job of jobs) {
      const expression = `(async () => {
        const img = new Image();
        img.src = ${JSON.stringify(baseUrl + job.urlPath)};
        await img.decode();
        const canvas = document.getElementById('c');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, ${WIDTH}, ${HEIGHT});
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, ${WIDTH}, ${HEIGHT});
        return canvas.toDataURL('image/webp', ${QUALITY});
      })()`;
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(`${job.label}: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
      }
      const dataUrl = result.result?.value;
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) {
        throw new Error(`${job.label}: unexpected canvas output`);
      }
      await mkdir(path.dirname(job.outPath), { recursive: true });
      await writeFile(job.outPath, Buffer.from(dataUrl.slice(prefix.length), 'base64'));
      written++;
    }
    console.log(`art-variants: ${written} written, ${skipped} skipped.`);
  } finally {
    cdp?.close();
    if (proc && proc.exitCode === null) {
      const exited = new Promise((r) => proc.once('exit', r));
      proc.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    }
    server?.close();
    if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
