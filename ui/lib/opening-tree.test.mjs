import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpeningTrees,
  chooseWeightedOpponentEdge,
  classifyOpeningDrillMove,
  formatOpeningTreeDisplayName,
  normalizeOpeningFen,
  parseSanMoves,
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
  });
  assert.deepEqual(classifyOpeningDrillMove(tree, 'train-node', fenBefore, 'b1c3', expected), {
    correct: true,
    exact: false,
  });
  assert.deepEqual(classifyOpeningDrillMove(tree, 'train-node', fenBefore, 'd2d4', expected), {
    correct: false,
    exact: false,
  });
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
