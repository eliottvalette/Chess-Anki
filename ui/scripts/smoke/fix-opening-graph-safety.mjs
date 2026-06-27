import assert from 'node:assert/strict';

import {
  OPENING_GRAPH_PAGE_SIZE,
  resolveGraphBundleLoadRefusal,
  resolveStaleSyncRefusal,
} from '../supabase/fix-opening-graph-lib.mjs';

const truncatedLoad = resolveGraphBundleLoadRefusal(
  { id: 'opening-graph-d4-black', node_count: 820, edge_count: 801 },
  0,
  0,
);
assert.ok(truncatedLoad, 'truncated bundle load must be refused before fix');

const destructiveSync = resolveStaleSyncRefusal(
  'opening-graph-d4-black',
  { nodes: 0, edges: 0 },
  { nodes: 820, edges: 801 },
);
assert.ok(destructiveSync, 'destructive stale sync must be refused');

const completeSync = resolveStaleSyncRefusal(
  'opening-graph-e4-white',
  { nodes: 915, edges: 534 },
  { nodes: 915, edges: 534 },
);
assert.equal(completeSync, null);

assert.equal(OPENING_GRAPH_PAGE_SIZE, 1000);

console.error('[smoke-fix-opening-graph-safety] ok');
