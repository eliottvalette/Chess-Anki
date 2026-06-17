import assert from 'node:assert/strict';

import { buildOpeningGraphForest, OPENING_CATALOG_PLY } from '../../lib/opening-graph.ts';
import { buildOpeningTrees } from '../../lib/opening-tree.ts';

const SAMPLE_LINES = [
  {
    id: 'line-1',
    name: 'Two Knights',
    trainSide: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'],
    source: 'recent_game',
  },
  {
    id: 'line-2',
    name: 'Petrov',
    trainSide: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5'],
    source: 'recent_game',
  },
  {
    id: 'line-3',
    name: 'Scotch',
    trainSide: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'],
    source: 'recent_game',
  },
];

const forest = buildOpeningGraphForest(SAMPLE_LINES, {
  ownerProfileId: 'smoke-profile',
  targetDepth: 16,
  catalogPly: OPENING_CATALOG_PLY,
});

assert.equal(forest.graphs.length, 1);
const graph = forest.graphs[0];
assert.ok(graph);
assert.ok(graph.nodes.length >= 8);
assert.ok(forest.catalogs.length >= 2);

const trees = buildOpeningTrees(SAMPLE_LINES, {
  ownerProfileId: 'smoke-profile',
  targetDepth: 16,
  rootPly: OPENING_CATALOG_PLY,
});

assert.ok(trees.length >= 2);
assert.ok(trees.every((tree) => tree.rootPly === OPENING_CATALOG_PLY));

console.error(
  `[smoke-opening-rebuild] graphs=${forest.graphs.length} catalogs=${forest.catalogs.length} trees=${trees.length}`,
);
