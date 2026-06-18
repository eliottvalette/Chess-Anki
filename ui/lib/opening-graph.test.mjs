import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCatalogEntries,
  buildDynamicCatalogEntries,
  buildOpeningGraphForest,
  buildOpeningGraphId,
  buildOpeningNodeId,
  mergeOpeningGraphDraft,
  OPENING_CATALOG_PLY,
  projectCatalogSubgraph,
  projectCatalogToTreeDraft,
  projectTreeFromFenKey,
  resolveOpeningCatalogTreeIdsAtFenKey,
  resolveOpeningGraphScope,
} from './opening-graph.ts';
import {
  buildOpeningTrees,
  mergeOpeningTreeDelta,
  normalizeOpeningFen,
  parseSanMoves,
  resolveOpeningTreeRootPly,
} from './opening-tree.ts';

const FOUR_KNIGHTS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6'];

test('resolveOpeningGraphScope routes white e4 games into e4 graph at startpos', () => {
  const parsed = parseSanMoves(FOUR_KNIGHTS);
  const scope = resolveOpeningGraphScope(
    { id: 'g1', name: 'Italian', trainSide: 'white', moves: FOUR_KNIGHTS, source: 'recent_game' },
    parsed,
  );

  assert.equal(scope?.library, 'e4');
  assert.equal(scope?.trainSide, 'white');
  assert.equal(scope?.startMoveIndex, 0);
});

test('buildOpeningGraphForest merges transpositions into one graph node id', () => {
  const forest = buildOpeningGraphForest(
    [
      {
        id: 'g1',
        name: 'Italian',
        trainSide: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
        source: 'recent_game',
      },
      {
        id: 'g2',
        name: 'Italian alt',
        trainSide: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, catalogPly: 4 },
  );

  assert.equal(forest.graphs.length, 1);
  const graph = forest.graphs[0];
  assert.ok(graph);
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  assert.equal(nodeIds.size, graph.nodes.length);
  assert.ok(graph.edges.some((edge) => edge.uci === 'f1c4'));
  assert.ok(graph.edges.some((edge) => edge.uci === 'f1b5'));
  assert.ok(forest.catalogs.length >= 1);
});

test('stable node ids are derived from profile library and fen key', () => {
  const nodeId = buildOpeningNodeId('profile-1', { trainSide: 'white', library: 'e4' }, 'fen-key');
  const graphId = buildOpeningGraphId('profile-1', { trainSide: 'white', library: 'e4' });

  assert.match(nodeId, /^opening-node-/);
  assert.match(graphId, /^opening-graph-/);
  assert.equal(buildOpeningNodeId('profile-1', { trainSide: 'white', library: 'e4' }, 'fen-key'), nodeId);
});

test('mergeOpeningGraphDraft appends new repertoire edges incrementally', () => {
  const forest = buildOpeningGraphForest(
    [
      {
        id: 'g1',
        name: 'Italian',
        trainSide: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, catalogPly: 4 },
  );
  const graph = forest.graphs[0];
  assert.ok(graph);
  const beforeEdgeCount = graph.edges.length;
  const merged = mergeOpeningGraphDraft(
    graph,
    [
      {
        id: 'g2',
        name: 'Italian alt',
        trainSide: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12 },
  );

  assert.ok(merged.draft.edges.length >= beforeEdgeCount);
  assert.ok(merged.newEdgeIds.size > 0 || merged.draft.edges.length > beforeEdgeCount);
});

test('buildOpeningTrees exposes catalog projections compatible with drill path', () => {
  const trees = buildOpeningTrees(
    [
      {
        id: 'g1',
        name: 'Four Knights',
        trainSide: 'white',
        moves: FOUR_KNIGHTS,
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, rootPly: OPENING_CATALOG_PLY },
  );

  assert.equal(trees.length, 1);
  const tree = trees[0];
  assert.ok(tree);
  assert.ok(tree.nodes.length >= 2);
  assert.equal(tree.rootPly, OPENING_CATALOG_PLY);
});

test('mergeOpeningTreeDelta keeps catalog projection mergeable', () => {
  const existing = buildOpeningTrees(
    [
      {
        id: 'g1',
        name: 'Italian',
        trainSide: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, rootPly: 4 },
  )[0];
  assert.ok(existing);
  const merged = mergeOpeningTreeDelta(
    existing,
    [
      {
        id: 'g2',
        name: 'Italian alt',
        trainSide: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, rootPly: 4 },
  );

  assert.ok(
    merged.newEdgeIds.size > 0 ||
      merged.draft.edges.some((edge) => edge.uci === 'f1b5') ||
      merged.draft.sourceCount >= existing.sourceCount,
  );
});

test('projectCatalogSubgraph re-roots drill tree at catalog entry', () => {
  const forest = buildOpeningGraphForest(
    [
      {
        id: 'g1',
        name: 'Four Knights',
        trainSide: 'white',
        moves: FOUR_KNIGHTS,
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, catalogPly: 4 },
  );
  const graph = forest.graphs[0];
  const catalog = forest.catalogs[0];
  assert.ok(graph);
  assert.ok(catalog);
  const projected = projectCatalogSubgraph(graph, graph.nodes, graph.edges, catalog, new Map());

  assert.equal(projected.rootFenKey, catalog.fenKey);
  assert.equal(projected.rootPly, catalog.catalogPly);
  assert.ok(projected.nodes.every((node) => node.ply >= catalog.catalogPly));
});

test('catalog entries are precomputed at requested ply', () => {
  const forest = buildOpeningGraphForest(
    [
      {
        id: 'g1',
        name: 'Four Knights',
        trainSide: 'white',
        moves: FOUR_KNIGHTS,
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, catalogPly: 4 },
  );
  const graph = forest.graphs[0];
  assert.ok(graph);
  const catalogs = buildCatalogEntries(
    graph,
    [
      {
        input: {
          id: 'g1',
          name: 'Four Knights',
          trainSide: 'white',
          moves: FOUR_KNIGHTS,
          source: 'recent_game',
        },
        parsed: parseSanMoves(FOUR_KNIGHTS),
      },
    ],
    { catalogPly: 4, catalogMinSources: 1 },
  );

  assert.ok(catalogs.every((entry) => entry.catalogPly === 4));
  assert.ok(catalogs.every((entry) => entry.displayUci.length === 4));
});

test('projectCatalogToTreeDraft keeps opening tree draft shape for legacy upsert helpers', () => {
  const forest = buildOpeningGraphForest(
    [
      {
        id: 'g1',
        name: 'Four Knights',
        trainSide: 'white',
        moves: FOUR_KNIGHTS,
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, catalogPly: 4 },
  );
  const graph = forest.graphs[0];
  const catalog = forest.catalogs[0];
  assert.ok(graph);
  assert.ok(catalog);
  const draft = projectCatalogToTreeDraft(graph, catalog);

  assert.ok(draft.id);
  assert.ok(draft.nodes.length > 0);
  assert.ok(draft.edges.length > 0);
  assert.equal(draft.rootSan.length, 4);
});

test('resolveOpeningCatalogTreeIdsAtFenKey matches catalogs on ancestor positions before catalog ply', () => {
  const forest = buildOpeningGraphForest(
    [
      {
        id: 'g1',
        name: 'Italian',
        trainSide: 'white',
        moves: FOUR_KNIGHTS,
        source: 'recent_game',
      },
      {
        id: 'g2',
        name: 'Sicilian',
        trainSide: 'white',
        moves: ['e4', 'c5', 'Nf3', 'd6'],
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, catalogPly: 4 },
  );
  const graph = forest.graphs[0];
  assert.ok(graph);

  const catalogs = forest.catalogs.map((catalog) => ({
    id: catalog.id,
    graphId: catalog.graphId,
    entryNodeId: catalog.entryNodeId,
    fenKey: catalog.fenKey,
  }));
  const nodes = graph.nodes.map((node) => ({
    id: node.id,
    graphId: graph.id,
    fenKey: node.fenKey,
  }));
  const edges = graph.edges.map((edge) => ({
    graphId: graph.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
  }));
  const sicilianParsed = parseSanMoves(['e4', 'c5']);
  const afterSicilianFenKey = normalizeOpeningFen(sicilianParsed[1].fenAfter);
  const afterSicilianNode = graph.nodes.find((node) => node.fenKey === afterSicilianFenKey);

  assert.ok(afterSicilianNode);

  const treeIdsAtStart = resolveOpeningCatalogTreeIdsAtFenKey(
    graph.nodes.find((node) => node.ply === 0).fenKey,
    catalogs,
    nodes,
    edges,
  );
  assert.equal(treeIdsAtStart.length, catalogs.length);

  const treeIdsAfterSicilian = resolveOpeningCatalogTreeIdsAtFenKey(afterSicilianNode.fenKey, catalogs, nodes, edges);
  assert.equal(treeIdsAfterSicilian.length, 1);
});

test('resolveOpeningCatalogTreeIdsAtFenKey matches catalogs after catalog ply', () => {
  const forest = buildOpeningGraphForest(
    [
      {
        id: 'g1',
        name: 'Italian',
        trainSide: 'white',
        moves: FOUR_KNIGHTS,
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, catalogPly: 4 },
  );
  const graph = forest.graphs[0];
  assert.ok(graph);

  const catalogs = forest.catalogs.map((catalog) => ({
    id: catalog.id,
    graphId: catalog.graphId,
    entryNodeId: catalog.entryNodeId,
    fenKey: catalog.fenKey,
  }));
  const nodes = graph.nodes.map((node) => ({
    id: node.id,
    graphId: graph.id,
    fenKey: node.fenKey,
  }));
  const edges = graph.edges.map((edge) => ({
    graphId: graph.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
  }));
  const afterItalianParsed = parseSanMoves(FOUR_KNIGHTS);
  const afterBb5FenKey = normalizeOpeningFen(afterItalianParsed[4].fenAfter);

  const treeIdsAfterBb5 = resolveOpeningCatalogTreeIdsAtFenKey(afterBb5FenKey, catalogs, nodes, edges);
  assert.equal(treeIdsAfterBb5.length, 1);
  assert.equal(treeIdsAfterBb5[0], catalogs[0].id);
});

test('buildDynamicCatalogEntries groups unique prefixes at the requested browse ply', () => {
  const forest = buildOpeningGraphForest(
    [
      {
        id: 'g1',
        name: 'Italian',
        trainSide: 'white',
        moves: FOUR_KNIGHTS,
        source: 'recent_game',
      },
      {
        id: 'g2',
        name: 'Sicilian',
        trainSide: 'white',
        moves: ['e4', 'c5', 'Nf3', 'd6'],
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, catalogPly: 4 },
  );
  const graph = forest.graphs[0];
  assert.ok(graph);

  const plyOneEntries = buildDynamicCatalogEntries(graph, 1);
  assert.equal(plyOneEntries.length, 1);
  assert.equal(plyOneEntries[0].name, 'e4');
  assert.deepEqual(plyOneEntries[0].displaySan, ['e4']);

  const plyTwoEntries = buildDynamicCatalogEntries(graph, 2);
  assert.equal(plyTwoEntries.length, 2);
  assert.deepEqual(plyTwoEntries.map((entry) => entry.displaySan.join(' ')).sort(), ['e4 c5', 'e4 e5']);
});

test('projectTreeFromFenKey projects the continuation tree from a played position', () => {
  const forest = buildOpeningGraphForest(
    [
      {
        id: 'g1',
        name: 'Italian',
        trainSide: 'white',
        moves: FOUR_KNIGHTS,
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, catalogPly: 4 },
  );
  const graph = forest.graphs[0];
  assert.ok(graph);
  const afterItalianParsed = parseSanMoves(FOUR_KNIGHTS);
  const afterBb5FenKey = normalizeOpeningFen(afterItalianParsed[4].fenAfter);
  const projected = projectTreeFromFenKey([graph], afterBb5FenKey, new Map());

  assert.ok(projected);
  assert.equal(projected.rootSan.join(' '), 'e4 e5 Nf3 Nc6 Bb5');
  assert.ok(projected.nodes.some((node) => node.ply > projected.rootPly));
});

test('buildDynamicCatalogEntries skips nodes that are not reachable from the graph root', () => {
  const forest = buildOpeningGraphForest(
    [
      {
        id: 'g1',
        name: 'Italian',
        trainSide: 'white',
        moves: FOUR_KNIGHTS,
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, catalogPly: 4 },
  );
  const graph = forest.graphs[0];
  assert.ok(graph);

  const orphanNode = {
    ...graph.nodes[graph.nodes.length - 1],
    id: 'opening-node-orphan',
    ply: 2,
    fenKey: 'orphan-fen-key',
    recentGames: 9,
    cardCount: 0,
  };
  const graphWithOrphan = {
    ...graph,
    nodes: [...graph.nodes, orphanNode],
  };

  const entries = buildDynamicCatalogEntries(graphWithOrphan, 2);
  assert.ok(entries.every((entry) => entry.entryNodeId !== orphanNode.id));
  assert.ok(entries.length > 0);
});

test('resolveOpeningTreeRootPly clamps forced plies to the requested value below catalog ply', () => {
  assert.equal(resolveOpeningTreeRootPly({ rootPly: 4, rootSan: ['e4', 'e5', 'Nf3', 'Nc6'] }, 3), 3);
  assert.equal(resolveOpeningTreeRootPly({ rootPly: 4, rootSan: ['e4', 'e5', 'Nf3', 'Nc6'] }, 4), 4);
  assert.equal(resolveOpeningTreeRootPly({ rootPly: 4, rootSan: ['e4', 'e5', 'Nf3', 'Nc6'] }, 6), 4);
});
