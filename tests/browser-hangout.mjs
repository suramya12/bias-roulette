// Optional dependency-free Chromium acceptance check: node tests/browser-hangout.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(root, '.cache', 'hangout-check');
await mkdir(cache, { recursive: true });
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const server = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: root, env: { ...process.env, PORT: '5174' }, windowsHide: true });
let browser, socket, browserLog = '';
const pending = new Map(); let serial = 0;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function outputMatch(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Startup timeout: ${output.slice(-800)}`)), 15000);
    const read = (data) => { output += data; const match = output.match(pattern); if (match) { clearTimeout(timeout); resolve(match); } };
    child.stdout?.on('data', read); child.stderr?.on('data', read);
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`Exited ${code}: ${output.slice(-800)}`)); });
  });
}
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}\n${browserLog.slice(-3000)}`)); }, 10000);
    pending.set(id, { resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
try {
  await outputMatch(server, /http:\/\/localhost:5174/);
  browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${path.join(cache, 'profile')}`, 'about:blank'], { windowsHide: true });
  browser.stderr.on('data', (data) => { browserLog += data; });
  const [, endpoint] = await outputMatch(browser, /DevTools listening on (ws:\/\/[^\s]+)/);
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  socket.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data), task = pending.get(msg.id);
    if (!task) return;
    pending.delete(msg.id);
    if (msg.error) task.reject(new Error(JSON.stringify(msg.error))); else task.resolve(msg.result);
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.bringToFront');
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp('Network.enable');
  await cdp('Network.setBlockedURLs', { urls: ['https://*'] });
  console.log('Chromium ready');
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('bias-roulette.chart.auto','off'); localStorage.setItem('encore.chartAuto','off');
    window.__yt = []; window.__advances = new Map();
    const timeout = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
    let serial = -1;
    window.setTimeout = (fn, ms, ...args) => {
      if (ms === 1200 || ms === 4000) { const id = serial--; __advances.set(id, { fn, ms }); return id; }
      return timeout(fn, ms, ...args);
    };
    window.clearTimeout = (id) => { __advances.delete(id); clear(id); };
    window.__due = () => { const pending = [...__advances.values()]; __advances.clear(); pending.forEach(({fn}) => fn()); };
    window.YT = { Player: class {
      constructor(mount, options) { this.events = options.events; this.videoId = options.videoId; this.plays = 0; this.state = -1; __yt.push(this); queueMicrotask(() => this.events.onReady({target:this})); }
      playVideo() { this.plays++; }
      stopVideo() {} destroy() { this.destroyed = true; }
      getPlayerState() { return this.state; }
    }};
    window.__emit = (name, data) => { const p = __yt.at(-1); if (name === 'onStateChange') p.state = data; p.events[name]({target:p,data}); };
  ` });
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression) {
    for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await delay(40); }
    throw new Error(`Timed out: ${expression}\n${JSON.stringify(errors)}\n${await evaluate("JSON.stringify({url:location.href,state:document.readyState,text:document.body?.innerText.slice(0,1800)})")}`);
  }
  async function shot(name) {
    const result = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(cache, `${name}.png`), Buffer.from(result.data, 'base64'));
  }
  for (const pop of [false, true]) {
    const side = pop ? 'pop' : 'kpop';
    await cdp('Page.navigate', { url: `http://localhost:5174/${pop ? 'pop/' : ''}#top100` });
    await until(`document.querySelector('#chartAuto') && !document.querySelector('#chartAuto').disabled && document.querySelectorAll('${pop ? '#chart li' : '#chartList li'}').length === 100`);
    assert.equal(await evaluate('__yt.length'), 0, `${side}: restored mode is silent`);
    await evaluate(`document.querySelector('#chartAuto').click()`);
    await until('__yt.length === 1');
    assert.equal(await evaluate(`document.querySelector('${pop ? '#tCard .stamp' : '#pullStamp:not([hidden])'}') !== null`), false, `${side}: short has no stamp`);
    await evaluate(`__emit('onAutoplayBlocked')`);
    assert.equal(await evaluate(`document.querySelector('${pop ? '#tPlayer .tap-to-play' : '#stageOverlay'}').hidden`), false);
    await evaluate(`document.querySelector('${pop ? '#tPlayer .tap-to-play' : '#stageOverlay'}').click(); __emit('onStateChange',1); __emit('onStateChange',0);`);
    assert.equal(await evaluate('__advances.size'), 1);
    // A manual Skip must beat the old ended callback and retain the full ceremony.
    await evaluate(`window.__staleAdvance = [...__advances.values()][0].fn; document.querySelector('${pop ? '#pull' : '#pullBtn'}').click(); __staleAdvance();`);
    await until('__yt.length === 2');
    assert.equal(await evaluate(`document.querySelector('${pop ? '#tCard .stamp' : '#pullStamp:not([hidden])'}') !== null`), true, `${side}: manual stamp remains`);
    // Three distinct attempts fail; duplicate error events cannot add strikes.
    for (let i = 0; i < 3; i++) {
      await evaluate(`__emit('onError',101); __emit('onError',101);`);
      if (i < 2) { await evaluate('__due()'); await until(`__yt.length === ${i + 3}`); }
    }
    assert.equal(await evaluate('__advances.size'), 0);
    assert.equal(await evaluate(`document.body.innerText.includes("3 videos in a row wouldn't play here. Auto paused.")`), true);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Resume').focus()`);
    assert.equal(await evaluate('document.activeElement.textContent'), 'Resume');
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until('__yt.length === 5');
    // Hidden endings must advance synchronously, without waiting for rAF or scrolling.
    await evaluate(`__emit('onStateChange',1); __emit('onStateChange',0); Object.defineProperty(document,'hidden',{configurable:true,value:true}); window.__scroll = scrollY; __due();`);
    await until('__yt.length === 6');
    assert.equal(await evaluate('scrollY === __scroll'), true);
    await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:false}); __emit('onStateChange',1); __emit('onStateChange',0); window.__awayAdvance=[...__advances.values()][0].fn; document.querySelector('${pop ? '[data-mode="roulette"]' : '#modeRoulette'}').click(); document.querySelector('${pop ? '[data-mode="top100"]' : '#modeCharts'}').click(); __awayAdvance();`);
    await delay(450);
    assert.equal(await evaluate('__yt.length'), 6, `${side}: returning mode does not revive pending advance`);
    await evaluate(`document.querySelector('#chartAuto').scrollIntoView({block:'center'})`);
    if (!pop) assert.equal(await evaluate(`Math.abs(document.querySelector('#chartAutoPill').getBoundingClientRect().top-document.querySelector('#pullBtn').getBoundingClientRect().top)<2`), true, 'K-pop Auto sits beside Pull');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${side}: no phone overflow`);
    await shot(`${side}-phone`);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await shot(`${side}-desktop`);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    console.log(`${side}: Auto startup, blocked start, manual Skip race, three strikes/Resume, hidden play, mode-away/back, responsive layout passed`);
    // Exercise the real Roulette wiring as well as Top 100.
    await evaluate(`document.querySelector('${pop ? '[data-mode="roulette"]' : '#modeRoulette'}').click()`);
    const autoSelector = pop ? '#deck-all .autoplay input[data-auto="on"]' : '#autoOn';
    assert.equal(await evaluate(`!document.querySelector('${autoSelector}').closest('[hidden]')`), true, `${side}: Roulette Auto is available from the first screen`);
    await evaluate(`document.querySelector('${autoSelector}').checked=false; document.querySelector('${autoSelector}').dispatchEvent(new Event('change')); document.querySelector('${autoSelector}').click();`);
    await until('__yt.length === 7');
    for (let i = 0; i < 3; i++) {
      await evaluate(`__emit('onError',101); __emit('onError',101);`);
      if (i < 2) { await evaluate('__due()'); await until(`__yt.length === ${i + 8}`); }
    }
    assert.equal(await evaluate(`document.body.innerText.includes("3 videos in a row wouldn't play here. Auto paused.")`), true, `${side}: Roulette strike pause`);
    assert.equal(await evaluate('__advances.size'), 0);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Resume' && !b.closest('[hidden]')).click()`);
    await until('__yt.length === 10');
    await evaluate(`__emit('onStateChange',1); __emit('onStateChange',0); Object.defineProperty(document,'hidden',{configurable:true,value:true}); __due();`);
    await until('__yt.length === 11');
    await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:false}); __emit('onStateChange',0); window.__rouletteStale=[...__advances.values()][0].fn; document.querySelector('${pop ? '[data-mode="top100"]' : '#modeCharts'}').click(); document.querySelector('${pop ? '[data-mode="roulette"]' : '#modeRoulette'}').click(); __rouletteStale();`);
    await delay(450); assert.equal(await evaluate('__yt.length'), 11);
    console.log(`${side}: Roulette startup, duplicate errors, three strikes/Resume, hidden play, mode-away/back passed`);
    await evaluate(`document.querySelector('${pop ? '[data-mode="top100"]' : '#modeCharts'}').click(); document.querySelector('${pop ? '#chart .row' : '#chartList .row'}').click();`);
    await until('__yt.length === 12');
    await evaluate(`__emit('onStateChange',1); __emit('onStateChange',0); window.__genreStale=[...__advances.values()][0].fn; dispatchEvent(new PageTransitionEvent('pagehide')); dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})); __genreStale();`);
    await delay(450); assert.equal(await evaluate('__yt.length'), 12, `${side}: genre navigation cancels advances across page cache restore`);
  }
  assert.deepEqual(errors, [], 'browser exceptions');
  await writeFile(path.join(cache, 'assets.txt'), 'Generated by tests/browser-hangout.mjs: kpop-phone.png, kpop-desktop.png, pop-phone.png, pop-desktop.png; profile/ is the isolated Chromium profile. No files downloaded.\n');
  console.log('Browser acceptance: 2 sides passed; 0 exceptions. Screenshots: .cache/hangout-check/');
} finally {
  try { if (socket?.readyState === WebSocket.OPEN) await Promise.race([send('Browser.close'), delay(500)]); } catch {}
  socket?.close(); browser?.kill(); server.kill();
}
