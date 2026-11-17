import test from 'node:test';
import assert from 'node:assert/strict';
import { collection } from '../src/card.js';

test('collection retains unsaved wins and merges them with later stored data', () => {
  let saved = JSON.stringify({ idol: { saved: 1 } });
  let blocked = true;
  globalThis.localStorage = {
    getItem() { if (blocked) throw new Error('read blocked'); return saved; },
    setItem(key, value) { if (blocked) throw new Error('write blocked'); saved = value; },
  };
  assert.equal(collection.add('idol', 'first'), true);
  assert.equal(collection.add('idol', 'first'), false);
  assert.equal(collection.has('idol', 'first'), true);
  assert.equal(collection.times('idol', 'first'), 2);
  assert.equal(collection.count('idol', ['first', 'saved']), 1);
  blocked = false;
  assert.equal(collection.count('idol', ['first', 'saved']), 2);
  assert.equal(collection.add('idol', 'saved'), false);
  assert.deepEqual(JSON.parse(saved), { idol: { saved: 2, first: 2 } });

  globalThis.localStorage.setItem = () => { throw new Error('quota'); };
  collection.add('song', 'single');
  assert.equal(collection.has('song', 'single'), true);
});
