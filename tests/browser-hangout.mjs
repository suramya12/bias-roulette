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
  await cdp('Log.enable');
  console.log('Chromium ready');
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const errors = [], consoleErrors = [], badResponses = [], localAssets = new Set();
  socket.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(msg.params.entry);
    if (msg.method === 'Network.responseReceived') {
      const { status, url } = msg.params.response;
      if (status >= 400) badResponses.push([status, url]);
      if (url.startsWith('http://localhost:5174/')) localAssets.add(url);
    }
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
    const scenario = new URLSearchParams(location.search).get('scenario');
    if (scenario === 'network-check') delete window.YT;
    if (scenario === 'data-retry') {
      const realFetch = window.fetch.bind(window);
      const failOnce = new Set(['/data/roster.json', '/data/charts.json', '/pop/data/data.json']);
      window.fetch = (url, options) => {
        const path = new URL(url, location.href).pathname;
        if (failOnce.delete(path)) return Promise.resolve(new Response('{}', { status: 503 }));
        if (path === '/pop/data/portraits.json') return new Promise((resolve) => {
          window.__releasePortraits = () => resolve(realFetch(url, options));
        });
        return realFetch(url, options);
      };
    }
    if (scenario === 'api-retry') {
      window.__workingYT = window.YT;
      delete window.YT;
      const append = Element.prototype.append;
      Element.prototype.append = function(...items) {
        append.call(this, ...items.filter((item) => item.src !== 'https://www.youtube.com/iframe_api'));
      };
      const setTimer = window.setTimeout;
      window.setTimeout = (fn, ms, ...args) => ms === 8000
        ? (window.__apiTimeout = fn, -8000)
        : setTimer(fn, ms, ...args);
    }
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
  const origin = 'http://localhost:5174/';
  const navigate = (page) => cdp('Page.navigate', { url: origin + page });
  const press = (selector, key) => evaluate('(() => { const tab = document.querySelector(' + JSON.stringify(selector)
    + '); tab.focus(); tab.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: ' + JSON.stringify(key) + ' })); })()');
  const checkHitAreas = async (selector) => {
    const missed = await evaluate('Array.from(document.querySelectorAll(' + JSON.stringify(selector) + ')).flatMap(node => {'
      + 'node.scrollIntoView({ block: "center" });'
      + 'const { x, y, width, height } = node.getBoundingClientRect();'
      + 'return [[0,-19.5],[0,19.5],[-19.5,0],[19.5,0]].flatMap(([dx,dy]) => {'
      + 'const hit = document.elementFromPoint(x + width/2 + dx, y + height/2 + dy);'
      + 'return node.contains(hit) ? [] : [{ label: node.textContent.trim(), dx, dy, x, y, width, height,'
      + 'hit: hit?.outerHTML.slice(0, 180), innerHeight, innerWidth }]; }); })');
    assert.deepEqual(missed, [], '40px tap targets for ' + selector);
  };

  for (const [page, ready, targetSelector] of [
    ['', 'document.querySelectorAll(".stat:not([hidden])").length === 3', '.continue'],
    ['kpop/', 'document.querySelector("#spinBtn") && !document.querySelector("#spinBtn").disabled && document.querySelector("#announce").textContent.startsWith("Round")', '.mode-btn'],
    ['pop/', 'document.querySelector("#deck-all .spin")', '.top [role=tab]'],
    ['anime/', 'document.querySelector("#pull") && !document.querySelector("#pull").disabled', '.filter-chip, .addon'],
  ]) {
    await navigate(page + '?scenario=network-check');
    await until(ready);
    await evaluate('document.fonts.ready.then(() => true)');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, page + ' phone overflow');
    if (!page) {
      const json = await evaluate('performance.getEntriesByType("resource").filter(x => x.name.endsWith(".json")).map(x => new URL(x.name).pathname)');
      assert.deepEqual(json, ['/data/landing.json']);
      await until('[...document.querySelectorAll(".card-face img")].filter(image => image.complete && image.naturalWidth).length === 6');
      await evaluate('localStorage.setItem("bias-roulette.lastSide","anime"); dispatchEvent(new PageTransitionEvent("pageshow", {persisted:true}))');
    }
    await until('document.querySelector(' + JSON.stringify(targetSelector) + ')?.getBoundingClientRect().height > 0');
    await checkHitAreas(targetSelector);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, page + ' small phone overflow');
    await checkHitAreas(targetSelector);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const smallText = await evaluate(`[...document.querySelectorAll("body *")].filter(node => {
      if (node.closest("[hidden], [aria-hidden=true], .sr-only, .tcg-back-mark") || !node.offsetWidth || !node.offsetHeight) return false;
      return [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())
        && parseFloat(getComputedStyle(node).fontSize) < 12;
    }).slice(0, 10).map(node => [node.className, node.textContent.trim().slice(0,50)])`);
    assert.deepEqual(smallText, [], page + ' visitor text below 12px');
    if (!page || page === 'anime/') {
      await evaluate('scrollTo(0, 0)');
      await shot(page ? 'anime-phone' : 'landing-phone');
    }
  }
  assert.deepEqual(badResponses, [], 'startup HTTP errors');
  assert.deepEqual(consoleErrors.map(({ text, url }) => ({ text, url })), [], 'startup console errors');
  console.log('Four pages started cleanly, ' + localAssets.size + ' distinct local URLs loaded');
  await cdp('Network.setBlockedURLs', { urls: ['https://*'] });

  await navigate('kpop/?scenario=data-retry#roulette');
  await until('document.querySelector("#announce button")?.textContent === "Retry"');
  assert.equal(await evaluate('["spinBtn","wheelBtn","autoBtn"].every(id => document.getElementById(id).disabled)'), true);
  await evaluate('document.querySelector("#announce button").click()');
  await until('!document.querySelector("#spinBtn").disabled');
  // Test chart recovery independently of Roulette's optional chart prefetch.
  await navigate('kpop/?scenario=data-retry&mode=chart#top100');
  await until('document.querySelector("#chartsAnnounce button")?.textContent === "Retry"');
  assert.equal(await evaluate('["pullBtn","ringBtn","quickBtn"].every(id => document.getElementById(id).disabled)'), true);
  await evaluate('document.querySelector("#chartsAnnounce button").click()');
  await until('!document.querySelector("#pullBtn").disabled');
  assert.equal(await evaluate('(() => { document.querySelector("#chart").scrollIntoView = ({behavior}) => window.__behavior = behavior; document.querySelector("#chartJump").click(); return window.__behavior; })()'), 'auto');

  await navigate('pop/?scenario=data-retry#roulette');
  await until('document.querySelector("main button")?.textContent === "Retry"');
  assert.equal(await evaluate('[...document.querySelectorAll(".top [role=tab], #openBinder")].every(button => button.disabled)'), true);
  await evaluate('document.querySelector("main button").click()');
  await until('document.querySelector("#deck-all .spin") && !document.querySelector("#openBinder").disabled');
  await press('#tab-roulette', 'ArrowRight');
  await until('document.activeElement.id === "tab-top100" && !document.querySelector("#top100").hidden');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".top [role=tab]")].map(tab => tab.tabIndex)'), [-1, 0]);
  await press('#tab-top100', 'Home');
  assert.equal(await evaluate('document.activeElement.id'), 'tab-roulette');
  await press('#tab-roulette', 'ArrowLeft');
  assert.equal(await evaluate('document.activeElement.id'), 'tab-top100');
  await press('#tab-top100', 'Home');
  await press('#tab-roulette', 'End');
  assert.equal(await evaluate('document.activeElement.id'), 'tab-top100');
  await evaluate('document.querySelector("#credits").open = true; __releasePortraits()');
  await until('document.querySelector("#creditList").children.length > 0');

  await navigate('anime/?scenario=api-retry');
  await until('document.querySelector("#pull") && !document.querySelector("#pull").disabled');
  await evaluate('localStorage.removeItem("anime.strikes"); document.querySelector("#pull").click()');
  await until('typeof window.__apiTimeout === "function"');
  const copy = await evaluate('document.querySelector("#copyLabel").textContent');
  await evaluate('__apiTimeout()');
  await until('document.querySelector("#playStatus button")?.textContent === "Retry"');
  const watch = await evaluate('document.querySelector("#player .fallback a").href');
  assert.equal(await evaluate('localStorage.getItem("anime.strikes")'), null);
  assert.equal(await evaluate('document.querySelector("#copyLabel").textContent'), copy);
  await evaluate('document.querySelector("#playStatus button").click(); window.YT = __workingYT; window.onYouTubeIframeAPIReady()');
  await until('__yt.length === 1');
  assert.equal(await evaluate('__yt[0].videoId'), new URL(watch).searchParams.get('v'));
  console.log('Catalog retries, delayed Pop portraits, tabs, reduced motion, and Anime API recovery passed');

  for (const pop of [false, true]) {
    const side = pop ? 'pop' : 'kpop';
    await cdp('Page.navigate', { url: `http://localhost:5174/${pop ? 'pop/' : 'kpop/'}#top100` });
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
  await writeFile(path.join(cache, 'assets.txt'), 'Generated by tests/browser-hangout.mjs: landing-phone.png, anime-phone.png, kpop-phone.png, kpop-desktop.png, pop-phone.png, pop-desktop.png; profile/ is the isolated Chromium profile.\n');
  console.log('Browser acceptance: all four pages passed; 0 exceptions. Screenshots: .cache/hangout-check/');
} finally {
  try { if (socket?.readyState === WebSocket.OPEN) await Promise.race([send('Browser.close'), delay(500)]); } catch {}
  socket?.close(); browser?.kill(); server.kill();
}
