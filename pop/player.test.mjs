import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from './src/player.js';

class Element {
  constructor() { this.children = []; this.style = {}; this.listeners = {}; }
  append(...items) { for (const item of items) { this.children.push(item); if (typeof item === 'object') item.parent = this; } }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this); }
  after(item) { this.parent.append(item); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute(name, value) { this[name] = value; }
  querySelector(selector) { return this.children.find((item) => item.className === selector.slice(1)) || null; }
}

test('player handles blocked playback, duplicate errors, and stale attempt callbacks', async () => {
  const instances = [];
  globalThis.document = { createElement: () => new Element() };
  globalThis.window = { YT: { Player: class {
    constructor(mount, options) { this.events = options.events; this.plays = 0; instances.push(this); }
    playVideo() { this.plays++; }
    destroy() {}
  } } };
  const host = new Element(); const parent = new Element(); parent.append(host);
  const calls = [];
  const player = createPlayer(host, {
    onEnd: (t) => calls.push(['end', t]), onFail: (t) => calls.push(['fail', t]),
    onPlay: (t) => calls.push(['play', t]), onBlocked: (t) => calls.push(['blocked', t]),
  });
  await player.play('AAAAAAAAAAA', 1);
  const first = instances[0];
  first.events.onAutoplayBlocked({ target: first });
  host.querySelector('.tap-to-play').listeners.click();
  assert.equal(first.plays, 1);
  first.events.onStateChange({ data: 1 });
  first.events.onError({ data: 101 }); first.events.onError({ data: 101 });
  await player.play('BBBBBBBBBBB', 2);
  first.events.onReady({ target: first }); first.events.onStateChange({ data: 0 });
  first.events.onAutoplayBlocked({ target: first }); first.events.onError({ data: 101 });
  instances[1].events.onStateChange({ data: 1 });
  player.stop(); instances[1].events.onStateChange({ data: 0 });
  assert.deepEqual(calls, [['blocked', 1], ['play', 1], ['fail', 1], ['play', 2]]);
  let resumed = false;
  player.showAutoPaused(() => { resumed = true; });
  const message = parent.children.at(-1);
  assert.equal(message.role, 'status');
  assert.equal(message.children[1].textContent, 'Resume');
  message.children[1].listeners.click(); assert.equal(resumed, true);
});
