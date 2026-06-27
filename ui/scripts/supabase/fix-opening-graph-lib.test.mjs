import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchAllOpeningGraphRows,
  OPENING_GRAPH_PAGE_SIZE,
  resolveGraphBundleLoadRefusal,
  resolveStaleSyncRefusal,
} from './fix-opening-graph-lib.mjs';

test('resolveStaleSyncRefusal blocks empty in-memory graph when database still has nodes', () => {
  const refusal = resolveStaleSyncRefusal('opening-graph-d4-black', { nodes: 0, edges: 0 }, { nodes: 820, edges: 801 });

  assert.match(refusal, /loaded 0 nodes but database has 820/);
});

test('resolveStaleSyncRefusal blocks partial node reload', () => {
  const refusal = resolveStaleSyncRefusal(
    'opening-graph-e4-white',
    { nodes: 100, edges: 90 },
    { nodes: 915, edges: 534 },
  );

  assert.match(refusal, /loaded 100\/915 nodes/);
});

test('resolveStaleSyncRefusal allows complete reload', () => {
  const refusal = resolveStaleSyncRefusal(
    'opening-graph-e4-white',
    { nodes: 915, edges: 534 },
    { nodes: 915, edges: 534 },
  );

  assert.equal(refusal, null);
});

test('resolveGraphBundleLoadRefusal blocks truncated bundle load before mutation', () => {
  const refusal = resolveGraphBundleLoadRefusal(
    { id: 'opening-graph-d4-black', node_count: 820, edge_count: 801 },
    0,
    0,
  );

  assert.match(refusal, /loaded 0\/820 nodes/);
});

test('fetchAllOpeningGraphRows paginates past the supabase 1000-row page limit', async () => {
  const graphId = 'opening-graph-large';
  const rows = Array.from({ length: OPENING_GRAPH_PAGE_SIZE + 250 }, (_, index) => ({
    id: `node-${index}`,
    graph_id: graphId,
  }));

  let rangeCalls = 0;
  const supabase = {
    from(table) {
      assert.equal(table, 'opening_nodes');

      return {
        select() {
          return this;
        },
        in(column, graphIds) {
          assert.equal(column, 'graph_id');
          assert.deepEqual(graphIds, [graphId]);
          return this;
        },
        order(column) {
          assert.equal(column, 'id');
          return this;
        },
        async range(offset, end) {
          rangeCalls += 1;
          return { data: rows.slice(offset, end + 1), error: null };
        },
      };
    },
  };

  const loaded = await fetchAllOpeningGraphRows(supabase, 'opening_nodes', [graphId]);

  assert.equal(loaded.length, rows.length);
  assert.equal(rangeCalls, 2);
});
