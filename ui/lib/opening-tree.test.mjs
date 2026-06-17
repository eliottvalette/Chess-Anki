import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDrillPath,
  buildForkCoverage,
  buildOpeningTrees,
  chooseWeightedOpponentEdge,
  classifyLinesMove,
  classifyOpeningDrillMove,
  formatOpeningTreeDisplayName,
  LINES_MOVE_EVAL_GATE_CP,
  markForkEdgePlayed,
  mergeOpeningTreeDelta,
  normalizeOpeningFen,
  OPENING_TARGET_DEPTH_NORMAL,
  parseSanMoves,
  pickNextUnplayedOpponentEdge,
  resolveAcceptedTrainMoveUcis,
  resolveOpeningLibrary,
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

test('resolveAcceptedTrainMoveUcis keeps engine best and masters edges only', () => {
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

  assert.deepEqual(accepted.acceptedUcis.sort(), ['b1c3', 'g1f3']);
  assert.equal(accepted.primaryUci, 'g1f3');
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
    evalLossCp: 1,
  });
  assert.deepEqual(classifyOpeningDrillMove(tree, 'train-node', fenBefore, 'd2d4', expected), {
    correct: false,
    exact: false,
    category: 'miss',
    evalLossCp: null,
  });
});

test('classifyLinesMove rejects masters move when eval loss exceeds gate', () => {
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
  assert.equal(classified.category, 'miss');
  assert.ok(classified.evalLossCp != null && classified.evalLossCp > LINES_MOVE_EVAL_GATE_CP);
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
