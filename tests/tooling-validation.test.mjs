import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { safeFetch } from '../scripts/safe-fetch.mjs';
import { escapeMarkdown, escapeRegExp, requestHash } from '../scripts/safe-text.mjs';
import { relativeInside } from '../scripts/static-server.mjs';

const start = 'https://example.test/start';
const hosts = ['example.test', 'other.test'];
const redirect = (location) => new Response(null, { status: 302, headers: { location } });

test('static files must resolve beneath the root and use relative POSIX paths', () => {
  const root = path.resolve('site');
  assert.equal(relativeInside(root, path.join(root, 'src', 'app.js')), 'src/app.js');
  assert.equal(relativeInside(root, root), null);
  assert.equal(relativeInside(root, path.resolve('site-sibling', 'app.js')), null);
});

test('safeFetch allows five manual HTTPS redirects and retains the final response', async () => {
  const seen = [];
  const response = await safeFetch(start, { hosts, fetchImpl: async (url, options) => {
    assert.equal(options.redirect, 'manual');
    seen.push(url.href);
    if (seen.length === 1) return redirect('https://other.test/next');
    if (seen.length <= 5) return redirect('/' + seen.length);
    return new Response('good', { headers: { 'content-type': 'text/plain' } });
  } });
  assert.equal(seen.length, 6);
  assert.equal(seen.at(-1), 'https://other.test/5');
  assert.equal(response.headers.get('content-type'), 'text/plain');
  assert.equal(await response.text(), 'good');
});

test('safeFetch rejects disallowed redirect destinations and stops after five redirects', async () => {
  for (const location of ['http://example.test/next', 'https://unlisted.test/next']) {
    let calls = 0;
    await assert.rejects(safeFetch(start, { hosts, fetchImpl: async () => { calls++; return redirect(location); } }), /not allowed/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(safeFetch(start, { hosts, fetchImpl: async () => { calls++; return redirect('/next'); } }), /excessive redirects/);
  assert.equal(calls, 6);
});

test('safeFetch aborts an oversized response with or without a content length', async () => {
  for (const headers of [{ 'content-length': '4' }, {}]) {
    let signal;
    const fetchImpl = async (url, options) => { signal = options.signal; return new Response('abcd', { headers }); };
    await assert.rejects(safeFetch(start, { hosts, maxBytes: 3, fetchImpl }), /exceeds 3 bytes/);
    assert.equal(signal.aborted, true);
  }
});

test('safeFetch keeps the timeout active while a response streams', async () => {
  const fetchImpl = async (url, { signal }) => new Response(new ReadableStream({
    start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }); },
  }));
  await assert.rejects(safeFetch(start, { hosts, timeoutMs: 10, fetchImpl }), /timed out/);
});

test('request hashes include the complete URL and use a safe SHA-256 basename', () => {
  const digest = requestHash(start + '?v=1');
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, requestHash(start + '?v=1'));
  assert.notEqual(digest, requestHash(start + '?v=2'));
});

test('Markdown escaping prefixes every listed metacharacter and flattens line breaks', () => {
  const special = '\\`*_{}[]()#+!|<>';
  const escaped = [...special].map((character) => '\\' + character).join('');
  assert.equal(escapeMarkdown(special + '\r\nnext\u2028line'), escaped + ' next line');
});

test('roster names with regex metacharacters match literally', () => {
  const name = 'A.C (Live)+';
  const pattern = new RegExp('^' + escapeRegExp(name) + '-');
  assert.equal(pattern.test(name + '-Song'), true);
  assert.equal(pattern.test('ABC Live-Song'), false);
});
