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

test('collection loads own integer counts and rebuilds malformed buckets', async () => {
  const { collection } = await import('../src/card.js?malformed-storage');
  let saved = '{"idol":"broken","song":{"valid":3,"zero":0,"negative":-1,"decimal":1.5,"string":"3","infinite":1e309,"__proto__":2},"other":[1]}';
  globalThis.localStorage = {
    getItem() { return saved; },
    setItem(key, value) { saved = value; },
  };
  assert.equal(collection.times('song', 'valid'), 3);
  assert.equal(collection.has('song', 'toString'), false);
  assert.equal(collection.times('song', '__proto__'), 2);
  assert.equal(collection.add('idol', 'fresh'), true);
  assert.deepEqual(JSON.parse(saved), JSON.parse('{"song":{"valid":3,"zero":0,"__proto__":2},"idol":{"fresh":1}}'));
});
