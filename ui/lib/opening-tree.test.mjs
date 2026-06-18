import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDrillPath,
  buildForkCoverage,
  buildOpeningDrillExpected,
  buildOpeningTrees,
  buildReviewQueue,
  chooseWeightedOpponentEdge,
  classifyBoardMoveAtHistoryIndex,
  classifyLinesMove,
  classifyLinesMoveAtHistoryIndex,
  classifyOpeningDrillMove,
  classifyRootPrefixMove,
  filterOpeningTreeForDisplay,
  filterOpeningTreeSummariesByIds,
  formatOpeningTreeDisplayName,
  LINES_MOVE_EVAL_GATE_CP,
  markForkEdgePlayed,
  mergeOpeningTreeDelta,
  normalizeOpeningFen,
  OPENING_TARGET_DEPTH_NORMAL,
  parseSanMoves,
  pickLearnBranch,
  pickNextUnplayedOpponentEdge,
  prepareOpeningTreeAtFenWithBoard,
  resolveAcceptedTrainMoveUcis,
  resolveOpeningLibrary,
  resolveOpeningNodeFromHistory,
  STANDARD_START_FEN_KEY,
  sliceOpeningForest,
} from './opening-tree.ts';

test('formatOpeningTreeDisplayName strips move suffixes and eco prefixes', () => {
  assert.equal(
    formatOpeningTreeDisplayName('Italian Game Two Knights Modern Bishops Opening 4...D5 5.Exd5 Nxd5 6.O O'),
    'Italian Game Two Knights Modern Bishops Opening',
  );
  assert.equal(formatOpeningTreeDisplayName('C50: Italian Game 4.e4 e5'), 'Italian Game');
  assert.equal(formatOpeningTreeDisplayName('Sicilian Defense'), 'Sicilian Defense');
});

test('buildOpeningTrees groups openings by normalized position after 4 plies', () => {
  const trees = buildOpeningTrees(
    [
      {
        id: 'game-1',
        name: 'Italian',
        trainSide: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'],
        source: 'recent_game',
      },
      {
        id: 'game-2',
        name: 'Italian again',
        trainSide: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'],
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 8, rootPly: 4 },
  );

  assert.equal(trees.length, 1);
  assert.equal(trees[0].rootSan.join(' '), 'e4 e5 Nf3 Nc6');
  assert.equal(trees[0].sourceCount, 2);
});

test('resolveOpeningLibrary groups by first white move', () => {
  const e4 = parseSanMoves(['e4', 'c5', 'Nf3', 'd6']);
  const d4 = parseSanMoves(['d4', 'Nf6', 'c4', 'g6']);

  assert.equal(resolveOpeningLibrary(e4), 'e4');
  assert.equal(resolveOpeningLibrary(d4), 'd4');
});

test('resolveAcceptedTrainMoveUcis keeps all repertoire edges', () => {
  const tree = {
    nodes: [
      {
        id: 'train-node',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
        fenKey: 'root',
        ply: 1,
        sideToMove: 'white',
        bestUci: 'g1f3',
        bestSan: 'Nf3',
        evalCp: 20,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 50,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [
      {
        id: 'engine-edge',
        fromNodeId: 'train-node',
        toNodeId: 'after-best',
        uci: 'g1f3',
        san: 'Nf3',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 0,
        cardCount: 0,
        mastersGames: 0,
        priority: 40,
        isEngineBest: true,
      },
      {
        id: 'recent-edge',
        fromNodeId: 'train-node',
        toNodeId: 'after-recent',
        uci: 'd2d4',
        san: 'd4',
        moveBy: 'white',
        source: 'recent_game',
        recentCount: 3,
        cardCount: 0,
        mastersGames: 0,
        priority: 9,
        isEngineBest: false,
      },
      {
        id: 'masters-edge',
        fromNodeId: 'train-node',
        toNodeId: 'after-masters',
        uci: 'b1c3',
        san: 'Nc3',
        moveBy: 'white',
        source: 'lichess_masters',
        recentCount: 0,
        cardCount: 0,
        mastersGames: 120,
        priority: 8,
        isEngineBest: false,
      },
    ],
  };

  const accepted = resolveAcceptedTrainMoveUcis(tree, 'train-node');

  assert.deepEqual(accepted.acceptedUcis.sort(), ['b1c3', 'd2d4', 'g1f3']);
  assert.equal(accepted.primaryUci, 'g1f3');
});

test('buildOpeningDrillExpected returns null on terminal node without repertoire edges', () => {
  const tree = {
    nodes: [
      {
        id: 'leaf-node',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 1',
        fenKey: 'leaf',
        ply: 2,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: 22,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [],
  };

  assert.equal(buildOpeningDrillExpected(tree, 'leaf-node'), null);
});

test('classifyOpeningDrillMove marks best, book, and miss', () => {
  const tree = {
    nodes: [
      {
        id: 'train-node',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
        fenKey: 'root',
        ply: 1,
        sideToMove: 'white',
        bestUci: 'g1f3',
        bestSan: 'Nf3',
        evalCp: 20,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 50,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-best',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 1',
        fenKey: 'after-best',
        ply: 2,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: 22,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-masters',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/RNBQKB1R b KQkq - 1 1',
        fenKey: 'after-masters',
        ply: 2,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: 21,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [
      {
        id: 'engine-edge',
        fromNodeId: 'train-node',
        toNodeId: 'after-best',
        uci: 'g1f3',
        san: 'Nf3',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 0,
        cardCount: 0,
        mastersGames: 0,
        priority: 40,
        isEngineBest: true,
      },
      {
        id: 'masters-edge',
        fromNodeId: 'train-node',
        toNodeId: 'after-masters',
        uci: 'b1c3',
        san: 'Nc3',
        moveBy: 'white',
        source: 'lichess_masters',
        recentCount: 0,
        cardCount: 0,
        mastersGames: 120,
        priority: 8,
        isEngineBest: false,
      },
    ],
  };
  const fenBefore = tree.nodes[0].fen;
  const expected = { primaryUci: 'g1f3', acceptedUcis: ['g1f3', 'b1c3'] };

  assert.deepEqual(classifyOpeningDrillMove(tree, 'train-node', fenBefore, 'g1f3', expected), {
    correct: true,
    exact: true,
    category: 'best',
    evalLossCp: 0,
  });
  assert.deepEqual(classifyOpeningDrillMove(tree, 'train-node', fenBefore, 'b1c3', expected), {
    correct: true,
    exact: false,
    category: 'book',
    evalLossCp: null,
  });
  assert.deepEqual(classifyOpeningDrillMove(tree, 'train-node', fenBefore, 'd2d4', expected), {
    correct: false,
    exact: false,
    category: 'miss',
    evalLossCp: null,
  });
});

test('classifyLinesMove accepts repertoire masters move as book', () => {
  const tree = {
    nodes: [
      {
        id: 'train-node',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
        fenKey: 'root',
        ply: 1,
        sideToMove: 'white',
        bestUci: 'g1f3',
        bestSan: 'Nf3',
        evalCp: 20,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 50,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-best',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 1',
        fenKey: 'after-best',
        ply: 2,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: 25,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-masters',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/RNBQKB1R b KQkq - 1 1',
        fenKey: 'after-masters',
        ply: 2,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: -40,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [
      {
        id: 'engine-edge',
        fromNodeId: 'train-node',
        toNodeId: 'after-best',
        uci: 'g1f3',
        san: 'Nf3',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 0,
        cardCount: 0,
        mastersGames: 0,
        priority: 40,
        isEngineBest: true,
      },
      {
        id: 'masters-edge',
        fromNodeId: 'train-node',
        toNodeId: 'after-masters',
        uci: 'b1c3',
        san: 'Nc3',
        moveBy: 'white',
        source: 'lichess_masters',
        recentCount: 0,
        cardCount: 0,
        mastersGames: 120,
        priority: 8,
        isEngineBest: false,
      },
    ],
  };

  const classified = classifyLinesMove(tree, 'train-node', 'b1c3');
  assert.equal(classified.category, 'book');
  assert.equal(classified.evalLossCp, null);
});

test('fork coverage tracks opponent edges and picks unplayed branch', () => {
  const tree = {
    nodes: [
      {
        id: 'opponent-node',
        fen: 'fen',
        fenKey: 'fen',
        ply: 5,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: 0,
        recentGames: 1,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [
      {
        id: 'edge-a',
        fromNodeId: 'opponent-node',
        toNodeId: 'child-a',
        uci: 'd7d5',
        san: 'd5',
        moveBy: 'black',
        source: 'recent_game',
        recentCount: 2,
        cardCount: 0,
        mastersGames: 0,
        priority: 1,
        isEngineBest: false,
      },
      {
        id: 'edge-b',
        fromNodeId: 'opponent-node',
        toNodeId: 'child-b',
        uci: 'g8f6',
        san: 'Nf6',
        moveBy: 'black',
        source: 'recent_game',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        priority: 1,
        isEngineBest: false,
      },
    ],
  };

  let coverage = buildForkCoverage(tree, 'white');
  const entry = coverage['opponent-node'];
  assert.equal(entry.remainingEdgeIds.length, 2);
  coverage = markForkEdgePlayed(coverage, 'opponent-node', 'edge-a');
  const nextEdge = pickNextUnplayedOpponentEdge(tree, coverage, 'opponent-node', 42);
  assert.equal(nextEdge?.id, 'edge-b');
});

test('buildDrillPath at depth 22 spans more than 15 train plies on long line input', () => {
  const moves = [
    'e4',
    'e5',
    'Nf3',
    'Nc6',
    'Bc4',
    'Bc5',
    'c3',
    'Nf6',
    'd4',
    'exd4',
    'cxd4',
    'Bb4+',
    'Bd2',
    'Bxd2+',
    'Nbxd2',
    'd5',
  ];
  const trees = buildOpeningTrees(
    [
      {
        id: 'long-line',
        name: 'Italian',
        trainSide: 'white',
        moves,
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: OPENING_TARGET_DEPTH_NORMAL, rootPly: 4 },
  );

  const tree = {
    ...trees[0],
    nodes: trees[0].nodes.map((node) => ({
      ...node,
      masteryScore: 40,
      seenCount: 0,
      correctCount: 0,
      missCount: 0,
    })),
    edges: trees[0].edges,
  };
  const path = buildDrillPath(tree, { trainSide: 'white', preferWeak: true, seed: 7 });
  const maxPly = Math.max(...tree.nodes.map((node) => node.ply));
  assert.ok(maxPly > 15);
  assert.ok(path.length > 10);
});

test('mergeOpeningTreeDelta appends new edges without rebuilding existing counts from scratch', () => {
  const existing = buildOpeningTrees(
    [
      {
        id: 'game-1',
        name: 'Italian',
        trainSide: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, rootPly: 4 },
  )[0];
  const beforeEdgeCount = existing.edges.length;
  const merged = mergeOpeningTreeDelta(
    existing,
    [
      {
        id: 'game-2',
        name: 'Italian alt',
        trainSide: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
        source: 'recent_game',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 12, rootPly: 4 },
  );

  assert.ok(merged.draft.edges.length >= beforeEdgeCount);
  assert.ok(merged.newEdgeIds.size > 0 || merged.draft.sourceCount > 1);
});

test('classifyLinesMove marks repertoire edges as book without eval data', () => {
  const tree = {
    nodes: [
      {
        id: 'train-node',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
        fenKey: 'root',
        ply: 1,
        sideToMove: 'white',
        bestUci: 'g1f3',
        bestSan: 'Nf3',
        evalCp: null,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-recent',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/2N5/PPPP1PPP/RNBQKB1R b KQkq - 1 1',
        fenKey: 'after-recent',
        ply: 2,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: null,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [
      {
        id: 'recent-edge',
        fromNodeId: 'train-node',
        toNodeId: 'after-recent',
        uci: 'b1c3',
        san: 'Nc3',
        moveBy: 'white',
        source: 'recent_game',
        recentCount: 4,
        cardCount: 0,
        mastersGames: 0,
        priority: 12,
        isEngineBest: false,
      },
    ],
  };

  assert.equal(classifyLinesMove(tree, 'train-node', 'b1c3').category, 'book');
});

test('filterOpeningTreeForDisplay keeps only repertoire-connected nodes', () => {
  const tree = {
    id: 'tree-1',
    name: 'Test',
    library: 'e4',
    rootFenKey: 'fen-root',
    rootPly: 4,
    rootSan: ['e4', 'e5', 'Nf3', 'Nc6'],
    rootUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
    sourceCount: 3,
    targetDepth: 10,
    nodeCount: 4,
    dueCount: 0,
    masteryScore: 0,
    updatedAt: null,
    nodes: [
      {
        id: 'root',
        fen: 'fen-root',
        fenKey: 'fen-root',
        ply: 4,
        sideToMove: 'white',
        bestUci: null,
        bestSan: null,
        evalCp: null,
        recentGames: 3,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'child',
        fen: 'fen-child',
        fenKey: 'fen-child',
        ply: 5,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: null,
        recentGames: 2,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'orphan',
        fen: 'fen-orphan',
        fenKey: 'fen-orphan',
        ply: 5,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: null,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [
      {
        id: 'edge-main',
        fromNodeId: 'root',
        toNodeId: 'child',
        uci: 'f1b5',
        san: 'Bb5',
        moveBy: 'white',
        source: 'recent_game',
        recentCount: 2,
        cardCount: 0,
        mastersGames: 0,
        priority: 6,
        isEngineBest: false,
      },
      {
        id: 'edge-orphan',
        fromNodeId: 'root',
        toNodeId: 'orphan',
        uci: 'f1c4',
        san: 'Bc4',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 0,
        cardCount: 0,
        mastersGames: 0,
        priority: 1,
        isEngineBest: false,
      },
    ],
  };

  const filtered = filterOpeningTreeForDisplay(tree, 4);
  assert.equal(filtered.nodes.length, 2);
  assert.equal(filtered.edges.length, 1);
  assert.equal(filtered.edges[0]?.id, 'edge-main');
});

test('sliceOpeningForest skips legacy catch-all trees when specific trees exist', () => {
  const legacyTree = {
    id: 'legacy-tree',
    name: 'All e4',
    library: 'e4',
    rootFenKey: 'startpos',
    rootPly: 0,
    rootSan: [],
    rootUci: [],
    sourceCount: 500,
    targetDepth: 10,
    nodeCount: 900,
    dueCount: 0,
    masteryScore: 0,
    updatedAt: null,
    nodes: [
      {
        id: 'root',
        fen: 'start',
        fenKey: 'startpos',
        ply: 0,
        sideToMove: 'white',
        bestUci: null,
        bestSan: null,
        evalCp: null,
        recentGames: 200,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'child',
        fen: 'after-e4',
        fenKey: 'after-e4',
        ply: 1,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: null,
        recentGames: 100,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [
      {
        id: 'e4-edge',
        fromNodeId: 'root',
        toNodeId: 'child',
        uci: 'e2e4',
        san: 'e4',
        moveBy: 'white',
        source: 'recent_game',
        recentCount: 100,
        cardCount: 0,
        mastersGames: 0,
        priority: 10,
        isEngineBest: false,
      },
    ],
  };

  const specificTree = {
    id: 'specific-tree',
    name: 'Italian',
    library: 'e4',
    rootFenKey: 'italian-root',
    rootPly: 4,
    rootSan: ['e4', 'e5', 'Nf3', 'Nc6'],
    rootUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
    sourceCount: 12,
    targetDepth: 22,
    nodeCount: 3,
    dueCount: 0,
    masteryScore: 0,
    updatedAt: null,
    nodes: [
      {
        id: 'italian-root',
        fen: 'italian',
        fenKey: 'italian-root',
        ply: 4,
        sideToMove: 'white',
        bestUci: null,
        bestSan: null,
        evalCp: null,
        recentGames: 8,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'italian-child',
        fen: 'italian-child',
        fenKey: 'italian-child',
        ply: 5,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: null,
        recentGames: 4,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [
      {
        id: 'italian-edge',
        fromNodeId: 'italian-root',
        toNodeId: 'italian-child',
        uci: 'f1c4',
        san: 'Bc4',
        moveBy: 'white',
        source: 'recent_game',
        recentCount: 4,
        cardCount: 0,
        mastersGames: 0,
        priority: 4,
        isEngineBest: false,
      },
    ],
  };

  const sliced = sliceOpeningForest([legacyTree, specificTree], 4);
  assert.equal(sliced.length, 1);
  assert.equal(sliced[0]?.id, 'specific-tree');
  assert.equal(sliced[0]?.nodes.length, 2);
});

test('chooseWeightedOpponentEdge prefers higher-priority branches deterministically for a seed', () => {
  const selected = chooseWeightedOpponentEdge(
    [
      { id: 'low', priority: 1, recentCount: 0, cardCount: 0, isEngineBest: false },
      { id: 'high', priority: 100, recentCount: 10, cardCount: 2, isEngineBest: true },
    ],
    1,
  );

  assert.equal(selected?.id, 'high');
});

test('normalizeOpeningFen ignores clocks and move counters', () => {
  assert.equal(
    normalizeOpeningFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'),
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -',
  );
});

const rootPrefixTree = {
  id: 'italian-tree',
  name: 'Italian',
  library: 'e4',
  rootFenKey: 'italian-root',
  rootPly: 4,
  rootSan: ['e4', 'e5', 'Nf3', 'Nc6'],
  rootUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
  sourceCount: 12,
  targetDepth: 22,
  nodeCount: 2,
  dueCount: 0,
  masteryScore: 0,
  updatedAt: null,
  nodes: [
    {
      id: 'italian-root',
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      fenKey: 'italian-root',
      ply: 4,
      sideToMove: 'white',
      bestUci: 'f1c4',
      bestSan: 'Bc4',
      evalCp: 25,
      recentGames: 12,
      cardCount: 0,
      masteryScore: 0,
      seenCount: 0,
      correctCount: 0,
      missCount: 0,
    },
    {
      id: 'italian-child',
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
      fenKey: 'italian-child',
      ply: 5,
      sideToMove: 'black',
      bestUci: null,
      bestSan: null,
      evalCp: 20,
      recentGames: 0,
      cardCount: 0,
      masteryScore: 0,
      seenCount: 0,
      correctCount: 0,
      missCount: 0,
    },
  ],
  edges: [
    {
      id: 'bc4-edge',
      fromNodeId: 'italian-root',
      toNodeId: 'italian-child',
      uci: 'f1c4',
      san: 'Bc4',
      moveBy: 'white',
      source: 'recent_game',
      recentCount: 8,
      cardCount: 0,
      mastersGames: 0,
      priority: 10,
      isEngineBest: false,
    },
  ],
};

const italianDrillTree = {
  ...rootPrefixTree,
  nodes: [
    ...rootPrefixTree.nodes,
    {
      id: 'italian-grandchild',
      fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
      fenKey: 'italian-grandchild',
      ply: 6,
      sideToMove: 'white',
      bestUci: 'e1g1',
      bestSan: 'O-O',
      evalCp: 18,
      recentGames: 0,
      cardCount: 0,
      masteryScore: 0,
      seenCount: 0,
      correctCount: 0,
      missCount: 0,
    },
  ],
  edges: [
    ...rootPrefixTree.edges,
    {
      id: 'nf6-edge',
      fromNodeId: 'italian-child',
      toNodeId: 'italian-grandchild',
      uci: 'g8f6',
      san: 'Nf6',
      moveBy: 'black',
      source: 'recent_game',
      recentCount: 3,
      cardCount: 0,
      mastersGames: 0,
      priority: 8,
      isEngineBest: false,
    },
  ],
};

test('classifyRootPrefixMove marks matching forced plies as book and deviations as miss', () => {
  assert.equal(classifyRootPrefixMove(rootPrefixTree, 0, 'e2e4'), 'book');
  assert.equal(classifyRootPrefixMove(rootPrefixTree, 2, 'g1f3'), 'book');
  assert.equal(classifyRootPrefixMove(rootPrefixTree, 2, 'b1c3'), 'miss');
  assert.equal(classifyRootPrefixMove(rootPrefixTree, 4, 'f1c4'), null);
});

test('classifyBoardMoveAtHistoryIndex works without an active learn or review session', () => {
  const moveHistory = [{ uci: 'e2e4' }, { uci: 'e7e5' }, { uci: 'g1f3' }, { uci: 'b8c6' }, { uci: 'f1c4' }];

  assert.deepEqual(classifyBoardMoveAtHistoryIndex(rootPrefixTree, moveHistory, 5, 'white'), {
    moveUci: 'f1c4',
    category: 'best',
  });
});

test('classifyBoardMoveAtHistoryIndex classifies prefix train and opponent moves from history alone', () => {
  const prefixHistory = [{ uci: 'e2e4' }, { uci: 'e7e5' }, { uci: 'g1f3' }, { uci: 'b8c6' }];

  assert.deepEqual(classifyBoardMoveAtHistoryIndex(rootPrefixTree, prefixHistory, 1, 'white'), {
    moveUci: 'e2e4',
    category: 'book',
  });
  assert.deepEqual(classifyBoardMoveAtHistoryIndex(rootPrefixTree, prefixHistory, 2, 'white'), {
    moveUci: 'e7e5',
    category: 'book',
  });
  assert.deepEqual(classifyBoardMoveAtHistoryIndex(rootPrefixTree, prefixHistory, 3, 'white'), {
    moveUci: 'g1f3',
    category: 'book',
  });

  const drillHistory = [...prefixHistory, { uci: 'f1c4' }, { uci: 'g8f6' }];

  assert.deepEqual(classifyBoardMoveAtHistoryIndex(italianDrillTree, drillHistory, 5, 'white'), {
    moveUci: 'f1c4',
    category: 'best',
  });
  assert.deepEqual(classifyBoardMoveAtHistoryIndex(italianDrillTree, drillHistory, 6, 'white'), {
    moveUci: 'g8f6',
    category: 'book',
  });
  assert.deepEqual(classifyBoardMoveAtHistoryIndex(italianDrillTree, drillHistory, 5, 'white'), {
    moveUci: 'f1c4',
    category: 'best',
  });
});

test('classifyLinesMoveAtHistoryIndex delegates to board history classifier', () => {
  const moveHistory = [
    { uci: 'e2e4', san: 'e4' },
    { uci: 'e7e5', san: 'e5' },
    { uci: 'g1f3', san: 'Nf3' },
    { uci: 'b8c6', san: 'Nc6' },
  ];

  assert.deepEqual(classifyLinesMoveAtHistoryIndex(rootPrefixTree, moveHistory, 1, 'white'), {
    moveUci: 'e2e4',
    category: 'book',
  });
  assert.deepEqual(classifyLinesMoveAtHistoryIndex(rootPrefixTree, moveHistory, 3, 'white'), {
    moveUci: 'g1f3',
    category: 'book',
  });
});

test('resolveOpeningNodeFromHistory maps root plies without jumping to the canonical root node', () => {
  const moveHistory = [{ uci: 'e2e4' }, { uci: 'e7e5' }, { uci: 'g1f3' }, { uci: 'b8c6' }];

  assert.deepEqual(resolveOpeningNodeFromHistory(rootPrefixTree, moveHistory, 0), {
    nodeId: null,
    plyInTree: 0,
  });
  assert.deepEqual(resolveOpeningNodeFromHistory(rootPrefixTree, moveHistory, 2), {
    nodeId: null,
    plyInTree: 2,
  });
  assert.deepEqual(resolveOpeningNodeFromHistory(rootPrefixTree, moveHistory, 4), {
    nodeId: 'italian-root',
    plyInTree: 4,
  });
});

test('buildReviewQueue returns trainable train-side nodes below mastery threshold sorted ascending', () => {
  const tree = {
    nodes: [
      { id: 'weak', sideToMove: 'white', masteryScore: 12, ply: 5, bestUci: 'e2e4' },
      { id: 'due', sideToMove: 'white', masteryScore: 55, ply: 7, bestUci: 'g1f3' },
      { id: 'no-repertoire', sideToMove: 'white', masteryScore: 10, ply: 6 },
      { id: 'strong', sideToMove: 'white', masteryScore: 90, ply: 8, bestUci: 'd2d4' },
      { id: 'opponent', sideToMove: 'black', masteryScore: 0, ply: 6 },
    ],
    edges: [
      {
        id: 'edge-weak',
        fromNodeId: 'weak',
        toNodeId: 'after-weak',
        uci: 'e2e4',
        san: 'e4',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        isEngineBest: true,
        priority: 1,
      },
    ],
  };

  assert.deepEqual(buildReviewQueue(tree, 'white'), ['weak', 'due']);
});

test('classifyLinesMove accepts engine-tolerant moves within gate', () => {
  const tree = {
    nodes: [
      {
        id: 'train-node',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
        fenKey: 'root',
        ply: 1,
        sideToMove: 'white',
        bestUci: 'g1f3',
        bestSan: 'Nf3',
        evalCp: 20,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 50,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-best',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 1',
        fenKey: 'after-best',
        ply: 2,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: 22,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-d4',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/4P3/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        fenKey: 'after-d4',
        ply: 2,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: 18,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [
      {
        id: 'engine-edge',
        fromNodeId: 'train-node',
        toNodeId: 'after-best',
        uci: 'g1f3',
        san: 'Nf3',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 0,
        cardCount: 0,
        mastersGames: 0,
        priority: 40,
        isEngineBest: true,
      },
      {
        id: 'off-edge',
        fromNodeId: 'train-node',
        toNodeId: 'after-d4',
        uci: 'd2d4',
        san: 'd4',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 0,
        cardCount: 0,
        mastersGames: 0,
        priority: 1,
        isEngineBest: false,
      },
    ],
  };

  const classified = classifyLinesMove(tree, 'train-node', 'd2d4');
  assert.equal(classified.category, 'book');
  assert.ok(classified.evalLossCp != null && classified.evalLossCp <= LINES_MOVE_EVAL_GATE_CP);
});

test('filterOpeningTreeSummariesByIds keeps only matching tree ids when filter is active', () => {
  const trees = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
  ];

  assert.deepEqual(
    filterOpeningTreeSummariesByIds(trees, null).map((tree) => tree.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    filterOpeningTreeSummariesByIds(trees, ['b', 'c']).map((tree) => tree.id),
    ['b', 'c'],
  );
});

test('prepareOpeningTreeAtFenWithBoard re-roots tree prefix from board history', () => {
  const tree = {
    id: 'tree-1',
    name: 'Italian',
    library: 'e4',
    rootFenKey: 'italian-root',
    rootPly: 4,
    rootSan: ['e4', 'e5', 'Nf3', 'Nc6'],
    rootUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
    sourceCount: 1,
    targetDepth: 12,
    nodeCount: 3,
    dueCount: 0,
    masteryScore: 0,
    updatedAt: null,
    nodes: [
      {
        id: 'root',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 2',
        fenKey: 'italian-root',
        ply: 4,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: null,
        recentGames: 1,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-bc4',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
        fenKey: 'after-bc4',
        ply: 5,
        sideToMove: 'black',
        bestUci: 'g8f6',
        bestSan: 'Nf6',
        evalCp: 20,
        recentGames: 1,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [
      {
        id: 'edge-bc4',
        fromNodeId: 'root',
        toNodeId: 'after-bc4',
        uci: 'f1c4',
        san: 'Bc4',
        moveBy: 'white',
        source: 'recent_game',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        priority: 1,
        isEngineBest: false,
      },
    ],
  };

  const prepared = prepareOpeningTreeAtFenWithBoard(
    tree,
    'after-bc4',
    [
      { san: 'e4', uci: 'e2e4' },
      { san: 'e5', uci: 'e7e5' },
      { san: 'Nf3', uci: 'g1f3' },
      { san: 'Nc6', uci: 'b8c6' },
      { san: 'Bc4', uci: 'f1c4' },
    ],
    5,
  );

  assert.ok(prepared);
  assert.equal(prepared.rootPly, 5);
  assert.equal(prepared.rootFenKey, 'after-bc4');
  assert.deepEqual(prepared.rootSan, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
  assert.equal(STANDARD_START_FEN_KEY, normalizeOpeningFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
});

test('pickLearnBranch skips completed branch edges', () => {
  const tree = {
    rootSan: ['e4', 'e5', 'Nf3', 'Nc6'],
    rootPly: 4,
    rootFenKey: 'root',
    targetDepth: 12,
    nodes: [
      {
        id: 'root-node',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
        fenKey: 'root',
        ply: 4,
        sideToMove: 'white',
        bestUci: 'f1b5',
        bestSan: 'Bb5',
        evalCp: 20,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 50,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-bb5',
        fen: 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
        fenKey: 'after-bb5',
        ply: 5,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: 18,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-bc4',
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
        fenKey: 'after-bc4',
        ply: 5,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: 19,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [
      {
        id: 'branch-bb5',
        fromNodeId: 'root-node',
        toNodeId: 'after-bb5',
        uci: 'f1b5',
        san: 'Bb5',
        moveBy: 'white',
        source: 'lichess_masters',
        recentCount: 2,
        cardCount: 0,
        mastersGames: 40,
        priority: 8,
        isEngineBest: false,
      },
      {
        id: 'branch-bc4',
        fromNodeId: 'root-node',
        toNodeId: 'after-bc4',
        uci: 'f1c4',
        san: 'Bc4',
        moveBy: 'white',
        source: 'lichess_masters',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 30,
        priority: 8,
        isEngineBest: false,
      },
    ],
  };

  const first = pickLearnBranch(tree, 'white', []);
  const second = pickLearnBranch(tree, 'white', [
    {
      forkNodeId: first.branchForkNodeId,
      edgeId: first.branchEdgeId,
      edgeUci: first.branchEdgeUci,
    },
  ]);

  assert.equal(first.branchEdgeId, 'branch-bb5');
  assert.equal(second.branchEdgeId, 'branch-bc4');
  assert.notEqual(first.branchEdgeUci, second.branchEdgeUci);
});
