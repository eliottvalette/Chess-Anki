import assert from 'node:assert/strict';
import test from 'node:test';

import { invalidateOpeningTreesClientCache, requestOpeningTreesJson } from './opening-trees-client.ts';

test('requestOpeningTreesJson deduplicates concurrent GET requests', async (context) => {
  invalidateOpeningTreesClientCache();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    fetchCount += 1;
    await Promise.resolve();
    return new Response(JSON.stringify({ trees: ['cached'] }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
  };

  const [first, second] = await Promise.all([
    requestOpeningTreesJson('/api/opening-trees?browsePly=4'),
    requestOpeningTreesJson('/api/opening-trees?browsePly=4'),
  ]);

  assert.equal(fetchCount, 1);
  assert.deepEqual(first, { trees: ['cached'] });
  assert.deepEqual(second, first);
});

test('requestOpeningTreesJson retries after an HTTP failure', async (context) => {
  invalidateOpeningTreesClientCache();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify(fetchCount === 1 ? { error: 'temporary' } : { tree: { id: 'ok' } }), {
      headers: { 'content-type': 'application/json' },
      status: fetchCount === 1 ? 503 : 200,
    });
  };

  await assert.rejects(requestOpeningTreesJson('/api/opening-trees?treeId=test'), /temporary/);
  assert.deepEqual(await requestOpeningTreesJson('/api/opening-trees?treeId=test'), { tree: { id: 'ok' } });
  assert.equal(fetchCount, 2);
});
