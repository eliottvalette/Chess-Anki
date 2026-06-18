import assert from 'node:assert/strict';
import test from 'node:test';

import { AsyncTtlCache } from './async-ttl-cache.ts';

test('AsyncTtlCache reuses a value until its ttl expires', async () => {
  let now = 1_000;
  let loads = 0;
  const cache = new AsyncTtlCache({ maxEntries: 2, now: () => now, ttlMs: 100 });
  const loader = async () => ++loads;

  assert.deepEqual(await cache.get('tree', loader), { status: 'miss', value: 1 });
  assert.deepEqual(await cache.get('tree', loader), { status: 'hit', value: 1 });

  now += 101;
  assert.deepEqual(await cache.get('tree', loader), { status: 'miss', value: 2 });
});

test('AsyncTtlCache deduplicates concurrent loads', async () => {
  let resolveLoad;
  let loads = 0;
  const cache = new AsyncTtlCache({ maxEntries: 2, ttlMs: 100 });
  const loader = () => {
    loads += 1;
    return new Promise((resolve) => {
      resolveLoad = resolve;
    });
  };

  const first = cache.get('tree', loader);
  const second = cache.get('tree', loader);
  resolveLoad('forest');

  assert.deepEqual(await first, { status: 'miss', value: 'forest' });
  assert.deepEqual(await second, { status: 'deduped', value: 'forest' });
  assert.equal(loads, 1);
});

test('AsyncTtlCache invalidates entries and evicts the least recently used key', async () => {
  let loads = 0;
  const cache = new AsyncTtlCache({ maxEntries: 2, ttlMs: 1_000 });
  const load = async () => ++loads;

  await cache.get('a', load);
  await cache.get('b', load);
  await cache.get('a', load);
  await cache.get('c', load);

  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('c'), true);

  cache.invalidate('a');
  assert.equal(cache.has('a'), false);
  assert.deepEqual(await cache.get('a', load), { status: 'miss', value: 4 });
});

test('AsyncTtlCache does not retain failed loads', async () => {
  let attempts = 0;
  const cache = new AsyncTtlCache({ maxEntries: 2, ttlMs: 100 });
  const loader = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary');
    return 'ok';
  };

  await assert.rejects(cache.get('tree', loader), /temporary/);
  assert.deepEqual(await cache.get('tree', loader), { status: 'miss', value: 'ok' });
});
