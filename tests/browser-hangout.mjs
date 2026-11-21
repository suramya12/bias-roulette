// Optional dependency-free Chromium acceptance check: node tests/browser-hangout.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(root, '.cache', 'hangout-check');
await mkdir(cache, { recursive: true });
const shots = process.env.HANGOUT_SHOTS_DIR;
const liveBollywood = process.argv.includes('--live-bollywood');
if (shots) await mkdir(shots, { recursive: true });
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
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push({ text: msg.params.args.map((arg) => arg.description ?? arg.value).join(' ') });
    }
    if (msg.method === 'Network.responseReceived') {
      const { status, url } = msg.params.response;
      if (status >= 400) badResponses.push([status, url]);
      if (url.startsWith('http://localhost:5174/')) localAssets.add(url);
    }
  });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    if (location.origin !== 'http://localhost:5174') return;
    localStorage.setItem('bias-roulette.chart.auto','off'); localStorage.setItem('encore.chartAuto','off'); localStorage.setItem('bolly.chartAuto','off');
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (event) => __csp.push([event.effectiveDirective, event.blockedURI]));
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
    if (scenario === 'network-check' || scenario === 'live-youtube') delete window.YT;
    if (scenario === 'live-youtube') {
      window.__playing = new Set();
      addEventListener('message', (event) => {
        if (event.origin !== 'https://www.youtube.com' || typeof event.data !== 'string') return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (!(message.event === 'onStateChange' && message.info === 1) &&
            !(message.event === 'infoDelivery' && message.info?.playerState === 1)) return;
        const frame = [...document.querySelectorAll('iframe')].find((iframe) => iframe.contentWindow === event.source);
        if (frame) __playing.add(frame.src);
      });
    }
    if (scenario === 'data-retry') {
      const realFetch = window.fetch.bind(window);
      const failOnce = new Set(['/pop/data/data.json', '/kpop/data/data.json', '/anime/data/data.json', '/bollywood/data/data.json']);
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
  })();` });
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression, timeout = 8000) {
    const end = Date.now() + timeout;
    do { if (await evaluate(expression)) return; await delay(40); } while (Date.now() < end);
    throw new Error(`Timed out: ${expression}\n${JSON.stringify(errors)}\n${await evaluate("JSON.stringify({url:location.href,state:document.readyState,text:document.body?.innerText.slice(0,1800)})")}`);
  }
  async function shot(name) {
    const result = await cdp('Page.captureScreenshot', { format: 'png' });
    const image = Buffer.from(result.data, 'base64');
    await writeFile(path.join(cache, `${name}.png`), image);
    if (shots && /^(landing|bolly)-(desktop|phone)$/.test(name)) {
      await writeFile(path.join(shots, `${name}.png`), image);
    }
  }
  const origin = 'http://localhost:5174/';
  const navigate = (page) => cdp('Page.navigate', { url: origin + page });
  const desktop = (height) => cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height, deviceScaleFactor: 1, mobile: false });
  const phone = () => cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const noScroll = 'document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight';
  const landingBoxes = () => evaluate(`[...document.querySelectorAll('.stage-card')].map(card => {
    const { x, y, width, height, right, bottom } = card.getBoundingClientRect();
    return { x, y, width, height, right, bottom };
  })`);
  const click = async (selector) => {
    const { x, y } = await evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      node.scrollIntoView({ block: 'center' });
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x, y });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x, y });
  };
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
    ['', 'document.querySelectorAll(".stat:not([hidden])").length === 4', '.continue'],
    ['kpop/', 'document.querySelector("#deck-idols .spin")', '.top [role=tab]'],
    ['pop/', 'document.querySelector("#deck-all .spin")', '.top [role=tab]'],
    ['anime/', 'document.querySelector("#deck-shows .spin")', '.top [role=tab]'],
    ['bollywood/', 'document.querySelector("#deck-stars .spin")', '.top [role=tab]'],
  ]) {
    await navigate(page + '?scenario=network-check' + (page ? '#roulette' : ''));
    await until(ready);
    await evaluate('document.fonts.ready.then(() => true)');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, page + ' phone overflow');
    if (!page) {
      const json = await evaluate('performance.getEntriesByType("resource").filter(x => x.name.endsWith(".json")).map(x => new URL(x.name).pathname)');
      assert.deepEqual(json.sort(), ['/data/landing.json']);
      assert.deepEqual(await evaluate('[...document.querySelectorAll(".stage-card")].map(card => card.dataset.side)'), ['kpop', 'pop', 'anime', 'bollywood']);
      await until('[...document.querySelectorAll(".card-face img")].filter(image => image.complete && image.naturalWidth).length >= 6');
      await evaluate('localStorage.setItem("bias-roulette.lastSide","bollywood"); dispatchEvent(new PageTransitionEvent("pageshow", {persisted:true}))');
      assert.equal(await evaluate('document.querySelector(".continue").href'), origin + 'bollywood/');
      assert.equal(await evaluate(noScroll), true, 'landing fits 390 × 844');
      const boxes = await landingBoxes();
      assert.ok(boxes.every(({ width, height, bottom }) => width >= 350 && height < 152 && bottom < 844), 'four full-width landing strips');
      assert.equal(new Set(boxes.map(({ y }) => y)).size, 4, 'landing phone cards stack');
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
    assert.deepEqual(await evaluate('__csp'), [], page + ' CSP violations');
    if (!page || page === 'anime/' || page === 'bollywood/') {
      await evaluate('scrollTo(0, 0)');
      const name = !page ? 'landing' : page === 'anime/' ? 'anime' : 'bolly';
      await shot(name + '-phone');
      if (page !== 'anime/') {
        await desktop(720);
        await until('innerWidth === 1280 && innerHeight === 720');
        if (!page) {
          assert.equal(await evaluate(noScroll), true, 'landing fits 1280 × 720');
          const boxes = await landingBoxes();
          assert.equal(new Set(boxes.map(({ y }) => y)).size, 1, 'landing desktop cards share a row');
          assert.ok(boxes.every(({ width, height, right, bottom }) => Math.abs(width / height - 5 / 7) < .01 && right < 1280 && bottom < 720), 'four proportional desktop cards');
        }
        await shot(name + '-desktop');
        await phone();
      }
    }
  }
  assert.deepEqual(badResponses, [], 'startup HTTP errors');
  assert.deepEqual(consoleErrors.map(({ text, url }) => ({ text, url })), [], 'startup console errors');
  console.log('Five pages started cleanly, ' + localAssets.size + ' distinct local URLs loaded');

  // One shared flow, run against every side: the engine and the features are identical, only the look differs.
  const SIDES = [
    { id: 'kpop', storage: 'kpop', deck: 'idols', label: 'K-pop', stats: ['Spotify streams', 'MV views', 'Score'] },
    { id: 'pop', storage: 'encore', deck: 'all', label: 'Pop & Latin', stats: ['Spotify streams', 'MV views', 'Score'] },
    { id: 'anime', storage: 'anime', deck: 'shows', label: 'Anime', stats: ['MV views', 'Year'] },
    { id: 'bollywood', storage: 'bolly', deck: 'stars', label: 'Bollywood', stats: ['MV views'] },
  ];
  const menu = (mode, current) => SIDES.map(({ id, label }) => `${label}|${id === current ? '#' : `../${id}/#${mode}`}|${id === current}`);
  const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  for (const side of SIDES) {
    const before = consoleErrors.length;
    const deck = `#deck-${side.deck}`;
    await navigate(`${side.id}/#roulette`);
    await until(`document.querySelector("${deck} .spin")`);
    assert.equal(await text('h1'), `${side.label} Roulette`, `${side.id}: Roulette heading`);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".genre-menu a")].map(a => a.textContent + "|" + a.getAttribute("href") + "|" + a.hasAttribute("aria-current"))'),
      menu('roulette', side.id), `${side.id}: genre menu links all four sides`);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".top [role=tab]")].map(tab => tab.textContent)'), ['Roulette', 'Top 100']);
    assert.equal(await evaluate('document.querySelector("#openBinder").getAttribute("aria-label")'), 'Collection');
    assert.equal(await evaluate('document.querySelector("#dailyDropBtn, #unseenBtn, #quickBtn, [data-deck]") === null && !/Today.s drop|Unseen pull|Just play one|Duplicate/.test(document.body.innerText)'), true, `${side.id}: no removed features`);
    // Roulette: Choose for me runs the whole round and ends with the MV playing. A few rounds on Anime, so single-song shows are met too.
    for (let round = 1; round <= (side.id === 'anime' ? 5 : 1); round++) {
      if (round > 1) await click(`${deck} .spin`); // AGAIN
      await click(`${deck} .auto`);
      await until(`__yt.length === ${round} && __yt[${round - 1}].plays > 0`);
      await evaluate('__emit("onStateChange", 1)');
      assert.equal(await evaluate(`document.querySelector("${deck} .result").hidden`), false, `${side.id}: result shown`);
      assert.match(await text(`${deck} .now`), /Now playing:/);
      assert.equal(await evaluate(`document.querySelector("${deck} .big-slot .card") !== null && document.querySelector("${deck} .player-slot").hidden`), false);
    }
    const rounds = await evaluate('__yt.length');
    await click('#openBinder');
    assert.equal(await evaluate('document.querySelector("#binder").open && document.querySelector("#binderGrid").childElementCount > 0'), true, `${side.id}: collection opens`);
    await click('#closeBinder');
    // Top 100: Pull reaches the card, the player, the stats strip and the three result buttons.
    await click('#tab-top100');
    await until('document.querySelectorAll("#chart li").length >= 90 && !document.querySelector("#pull").disabled');
    assert.equal(await text('h1'), `${side.label} Top 100`, `${side.id}: Top 100 heading`);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".genre-menu a")].map(a => a.getAttribute("href"))'),
      menu('top100', side.id).map((entry) => entry.split('|')[1]), `${side.id}: menu keeps the mode`);
    assert.equal(await evaluate('document.querySelector("#chartBox").open'), false, `${side.id}: chart starts collapsed`);
    assert.equal(await text('#chartName'), `The all-time ${side.label} Top 100`);
    assert.equal(await evaluate('[...document.querySelectorAll(".range button")].map(b => b.textContent).join()'), 'Top 10,Top 50,Top 100');
    await click('#r10');
    assert.equal(await evaluate(`localStorage.getItem("${side.storage}.range") + document.querySelector("#r10").getAttribute("aria-pressed")`), '10true');
    await click('#pull');
    await until(`__yt.length === ${rounds + 1} && __yt[${rounds}].plays > 0`);
    await evaluate('__emit("onStateChange", 1)');
    assert.equal(await evaluate('document.querySelector("#tResult").hidden'), false);
    assert.equal(await evaluate('document.querySelector("#tCard .card") !== null && document.querySelector("#tPlayer").childElementCount > 0'), true, `${side.id}: card and player`);
    assert.equal(await evaluate('+document.querySelector("#tCard .stamp").textContent.match(/#(\\d+)/)[1] <= 10'), true, `${side.id}: Top 10 pull stays in the top 10`);
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#tStats dt")].map(dt => dt.textContent)'), side.stats, `${side.id}: stats strip`);
    assert.equal(await evaluate('document.querySelectorAll("#chart li.playing").length'), 1, `${side.id}: playing row highlighted`);
    assert.match(await text('#topAnnounce'), /^Now playing #\d+: /);
    assert.deepEqual(await evaluate('["#tAgain", "#tNext", "#tJump"].map(s => document.querySelector(s).textContent.replace(/#\\d+ .*/, "#"))'), ['Pull again', 'Next: #', 'Full chart']);
    await click('#tNext');
    await until(`__yt.length === ${rounds + 2}`);
    assert.equal(await evaluate('document.querySelectorAll("#chart li.playing").length'), 1);
    await click('#tAgain');
    await until(`__yt.length === ${rounds + 3}`);
    await click('#tJump');
    assert.equal(await evaluate('document.querySelector("#chartBox").open'), true);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${side.id}: no phone overflow`);
    await click('#r100');
    assert.deepEqual(await evaluate('__csp'), [], `${side.id}: CSP violations`);
    assert.deepEqual(consoleErrors.slice(before).map(({ text, url }) => ({ text, url })), [], `${side.id}: console errors`);
    console.log(`${side.label}: genre menu, Choose for me, collection, Top 100 pull, stats strip, Next, Full chart passed`);
  }

  await cdp('Network.setBlockedURLs', { urls: ['https://*'] });

  for (const side of SIDES.filter((x) => x.id !== 'pop')) { // Pop's own retry, tabs and credits follow
    await navigate(`${side.id}/?scenario=data-retry#roulette`);
    await until('document.querySelector("main button")?.textContent === "Retry"');
    assert.equal(await evaluate('[...document.querySelectorAll(".top [role=tab], #openBinder")].every(button => button.disabled)'), true, `${side.id}: disabled while data is missing`);
    await evaluate('document.querySelector("main button").click()');
    await until(`document.querySelector("#deck-${side.deck} .spin") && !document.querySelector("#openBinder").disabled`);
  }
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

  console.log('Catalog retries, delayed portraits, tabs and reduced motion passed');

  // Auto, on every side: startup, blocked start, manual Skip race, three strikes and Resume, hidden play, mode-away/back.
  for (const side of SIDES) {
    const name = side.id;
    await cdp('Page.navigate', { url: `http://localhost:5174/${name}/#top100` });
    await until(`document.querySelector('#chartAuto') && !document.querySelector('#chartAuto').disabled && document.querySelectorAll('#chart li').length >= 90`);
    assert.equal(await evaluate('__yt.length'), 0, `${name}: restored mode is silent`);
    await evaluate(`document.querySelector('#chartAuto').click()`);
    await until('__yt.length === 1');
    assert.equal(await evaluate(`document.querySelector('#tCard .stamp') !== null`), false, `${name}: short has no stamp`);
    await evaluate(`__emit('onAutoplayBlocked')`);
    assert.equal(await evaluate(`document.querySelector('#tPlayer .tap-to-play').hidden`), false);
    await evaluate(`document.querySelector('#tPlayer .tap-to-play').click(); __emit('onStateChange',1); __emit('onStateChange',0);`);
    assert.equal(await evaluate('__advances.size'), 1);
    // A manual Skip must beat the old ended callback and retain the full ceremony.
    await evaluate(`window.__staleAdvance = [...__advances.values()][0].fn; document.querySelector('#pull').click(); __staleAdvance();`);
    await until('__yt.length === 2');
    assert.equal(await evaluate(`document.querySelector('#tCard .stamp') !== null`), true, `${name}: manual stamp remains`);
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
    await evaluate(`__emit('onStateChange',1); __emit('onStateChange',0); Object.defineProperty(document,'hidden',{configurable:true,value:true}); window.__scrolls = 0; const scroll = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function(...args) { __scrolls++; return scroll.apply(this, args); }; __due();`);
    await until('__yt.length === 6');
    assert.equal(await evaluate('__scrolls'), 0, name + ': hidden advance does not scroll');
    await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:false}); __emit('onStateChange',1); __emit('onStateChange',0); window.__awayAdvance=[...__advances.values()][0].fn; document.querySelector('[data-mode="roulette"]').click(); document.querySelector('[data-mode="top100"]').click(); __awayAdvance();`);
    await delay(450);
    assert.equal(await evaluate('__yt.length'), 6, `${name}: returning mode does not revive pending advance`);
    await evaluate(`document.querySelector('#chartAuto').scrollIntoView({block:'center'})`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${name}: no phone overflow`);
    await shot(`${name}-phone`);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await shot(`${name}-desktop`);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    // Exercise the real Roulette wiring as well as Top 100.
    await evaluate(`document.querySelector('[data-mode="roulette"]').click()`);
    const autoSelector = `#deck-${side.deck} .autoplay input[data-auto="on"]`;
    assert.equal(await evaluate(`!document.querySelector('${autoSelector}').closest('[hidden]')`), true, `${name}: Roulette Auto is available from the first screen`);
    await evaluate(`document.querySelector('${autoSelector}').checked=false; document.querySelector('${autoSelector}').dispatchEvent(new Event('change')); document.querySelector('${autoSelector}').click();`);
    await until('__yt.length === 7');
    for (let i = 0; i < 3; i++) {
      await evaluate(`__emit('onError',101); __emit('onError',101);`);
      if (i < 2) { await evaluate('__due()'); await until(`__yt.length === ${i + 8}`); }
    }
    assert.equal(await evaluate(`document.body.innerText.includes("3 videos in a row wouldn't play here. Auto paused.")`), true, `${name}: Roulette strike pause`);
    assert.equal(await evaluate('__advances.size'), 0);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Resume' && !b.closest('[hidden]')).click()`);
    await until('__yt.length === 10');
    await evaluate(`__emit('onStateChange',1); __emit('onStateChange',0); Object.defineProperty(document,'hidden',{configurable:true,value:true}); __due();`);
    await until('__yt.length === 11');
    await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:false}); __emit('onStateChange',0); window.__rouletteStale=[...__advances.values()][0].fn; document.querySelector('[data-mode="top100"]').click(); document.querySelector('[data-mode="roulette"]').click(); __rouletteStale();`);
    await delay(450); assert.equal(await evaluate('__yt.length'), 11);
    await evaluate(`document.querySelector('[data-mode="top100"]').click(); document.querySelector('#chart .row').click();`);
    await until('__yt.length === 12');
    await evaluate(`__emit('onStateChange',1); __emit('onStateChange',0); window.__genreStale=[...__advances.values()][0].fn; dispatchEvent(new PageTransitionEvent('pagehide')); dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})); __genreStale();`);
    await delay(450); assert.equal(await evaluate('__yt.length'), 12, `${name}: genre navigation cancels advances across page cache restore`);
    console.log(`${name}: Auto startup, blocked start, manual Skip race, three strikes/Resume, hidden play, mode-away/back, Roulette Auto and responsive layout passed`);
  }

  if (liveBollywood) {
    await cdp('Network.setBlockedURLs', { urls: [] });
    const liveErrors = consoleErrors.length;
    await desktop(720);
    await navigate('bollywood/?scenario=live-youtube#roulette');
    await until('document.querySelector("#deck-stars .auto:not(:disabled)")');
    const playLive = async (button, host) => {
      await click(button);
      const frame = `document.querySelector('${host} iframe')`;
      const tap = `${host} .tap-to-play`;
      const playing = `${frame} && __playing.has(${frame}.src)`;
      await until(`(${playing}) || document.querySelector('${tap}') || document.querySelector('${host} .fallback')`, 30000);
      if (await evaluate(`document.querySelector('${tap}') !== null`)) await click(tap);
      assert.equal(await evaluate(`document.querySelector('${host} .fallback') === null`), true, host + ' live YouTube failed');
      await until(playing, 30000);
    };
    await playLive('#deck-stars .auto', '#deck-stars .player');
    await click('#tab-top100');
    await until('document.querySelectorAll("#chart li").length >= 90 && !document.querySelector("#pull").disabled');
    await playLive('#pull', '#tPlayer');
    assert.deepEqual(await evaluate('__csp'), [], 'live Bollywood CSP violations');
    assert.deepEqual(consoleErrors.slice(liveErrors).map(({ text, url }) => ({ text, url })), [], 'live Bollywood console errors');
    console.log('Bollywood: live YouTube reported PLAYING in Roulette and Top 100. Zero CSP and console errors.');
  }
  assert.deepEqual(errors, [], 'browser exceptions');
  await writeFile(path.join(cache, 'assets.txt'), 'Generated by tests/browser-hangout.mjs: landing-phone.png, landing-desktop.png, bolly-phone.png, bolly-desktop.png, anime-phone.png, kpop-phone.png, kpop-desktop.png, pop-phone.png, pop-desktop.png; profile/ is the isolated Chromium profile.\n');
  console.log('Browser acceptance: all five pages passed; 0 exceptions. Screenshots: .cache/hangout-check/');
} finally {
  try { if (socket?.readyState === WebSocket.OPEN) await Promise.race([send('Browser.close'), delay(500)]); } catch {}
  socket?.close(); browser?.kill(); server.kill();
}
