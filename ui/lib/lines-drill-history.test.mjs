import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';

import {
  appendStoredMoveFromUci,
  applyStoredMoveFromUci,
  buildStoredMovesFromUciList,
  linesJumpToHistoryIndex,
  restoreGameFromHistory,
} from './chess-analysis-client.ts';
import { buildDrillPath, replayToNodeUcis } from './opening-tree.ts';

const FOUR_KNIGHTS_ROOT_UCI = ['e2e4', 'e7e5', 'g1f3', 'b8c6'];

function simulateLearnReplayAndTrainLine(rootUcis, trainUci, opponentUci) {
  let moveHistory = buildStoredMovesFromUciList(null, rootUcis);
  let historyIndex = moveHistory.length;
  let game = restoreGameFromHistory(moveHistory, null, historyIndex);

  const trainApplied = applyStoredMoveFromUci(game.fen(), trainUci);
  moveHistory = [...moveHistory, trainApplied.stored];
  historyIndex += 1;
  game = restoreGameFromHistory(moveHistory, null, historyIndex);

  const opponentApplied = applyStoredMoveFromUci(game.fen(), opponentUci);
  moveHistory = [...moveHistory, opponentApplied.stored];
  historyIndex += 1;
  game = restoreGameFromHistory(moveHistory, null, historyIndex);

  return { moveHistory, historyIndex, game };
}

function undoOnePly(moveHistory, historyIndex, initialFen = null) {
  return linesJumpToHistoryIndex(moveHistory, initialFen, historyIndex, historyIndex - 1);
}

function appendOpponentLikeDrill(moveHistory, historyIndex, opponentUci, initialFen = null) {
  const boardFen = restoreGameFromHistory(moveHistory, initialFen, historyIndex).fen();

  return appendStoredMoveFromUci(moveHistory, boardFen, opponentUci);
}

test('restoreGameFromHistory throws on invalid stored move with move index', () => {
  const legal = buildStoredMovesFromUciList(null, FOUR_KNIGHTS_ROOT_UCI);
  const corrupted = [
    ...legal,
    {
      from: 'g7',
      to: 'g5',
      san: 'g5',
      lan: 'g7g5',
      promotion: null,
      piece: 'p',
      color: 'b',
      flags: 'b',
      captured: null,
      uci: 'g7g5',
    },
  ];

  assert.throws(() => restoreGameFromHistory(corrupted, null, corrupted.length), /Invalid history move at index 4/);
});

test('chess undo after loading fen cannot revert last move', () => {
  const moves = buildStoredMovesFromUciList(null, FOUR_KNIGHTS_ROOT_UCI);
  const game = restoreGameFromHistory(moves, null, moves.length);
  const fenOnly = new Chess(game.fen());

  assert.equal(fenOnly.undo(), null);
});

test('applyStoredMoveFromUci appends from current board fen not tree node fen', () => {
  const moves = buildStoredMovesFromUciList(null, [...FOUR_KNIGHTS_ROOT_UCI, 'f1b5']);
  const board = restoreGameFromHistory(moves, null, moves.length);
  const wrongTreeFen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 2';
  const wrongFromTree = applyStoredMoveFromUci(wrongTreeFen, 'g8f6');
  const correctFromBoard = applyStoredMoveFromUci(board.fen(), 'g8f6');

  assert.notEqual(wrongFromTree.nextFen, correctFromBoard.nextFen);
  assert.equal(correctFromBoard.stored.san, 'Nf6');
});

test('learn replay train opponent sequence restores after single undo', () => {
  const { moveHistory, historyIndex } = simulateLearnReplayAndTrainLine(FOUR_KNIGHTS_ROOT_UCI, 'f1b5', 'g8f6');

  assert.equal(historyIndex, 6);

  const undone = undoOnePly(moveHistory, historyIndex);

  assert.equal(undone.historyIndex, 5);
  assert.equal(undone.moveHistory.length, 5);
  assert.equal(undone.game.turn(), 'b');
  assert.equal(undone.moveHistory[4]?.uci, 'f1b5');
});

test('learn replay train opponent sequence restores after double undo', () => {
  const { moveHistory, historyIndex } = simulateLearnReplayAndTrainLine(FOUR_KNIGHTS_ROOT_UCI, 'f1b5', 'g8f6');

  const once = undoOnePly(moveHistory, historyIndex);
  const twice = undoOnePly(once.moveHistory, once.historyIndex);

  assert.equal(twice.historyIndex, 4);
  assert.equal(twice.moveHistory.length, 4);
  assert.equal(twice.moveHistory.map((move) => move.uci).join(' '), FOUR_KNIGHTS_ROOT_UCI.join(' '));
});

test('miss train move undo returns to quiz position', () => {
  let moveHistory = buildStoredMovesFromUciList(null, FOUR_KNIGHTS_ROOT_UCI);
  let historyIndex = moveHistory.length;
  const game = restoreGameFromHistory(moveHistory, null, historyIndex);

  const miss = applyStoredMoveFromUci(game.fen(), 'f1c4');
  moveHistory = [...moveHistory, miss.stored];
  historyIndex += 1;

  const undone = undoOnePly(moveHistory, historyIndex);

  assert.equal(undone.historyIndex, 4);
  assert.equal(undone.game.fen(), game.fen());
});

test('appendStoredMoveFromUci keeps history replayable for drill opponent moves', () => {
  let moveHistory = buildStoredMovesFromUciList(null, FOUR_KNIGHTS_ROOT_UCI);
  let game = restoreGameFromHistory(moveHistory, null, moveHistory.length);

  const train = appendStoredMoveFromUci(moveHistory, game.fen(), 'f1b5');
  moveHistory = train.moveHistory;
  game = restoreGameFromHistory(moveHistory, null, moveHistory.length);

  const opponent = appendStoredMoveFromUci(moveHistory, game.fen(), 'a7a6');
  moveHistory = opponent.moveHistory;

  const restored = restoreGameFromHistory(moveHistory, null, moveHistory.length);

  assert.equal(restored.turn(), 'w');
  assert.equal(moveHistory[5]?.uci, 'a7a6');
});

test('replayToNodeUcis history is legal for restore at every prefix', () => {
  const tree = {
    rootUci: FOUR_KNIGHTS_ROOT_UCI,
    rootSan: ['e4', 'e5', 'Nf3', 'Nc6'],
    rootPly: 4,
    rootFenKey: 'four-knights-root',
    targetDepth: 12,
    nodes: [
      {
        id: 'root',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 2',
        fenKey: 'four-knights-root',
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
      {
        id: 'after-nf6',
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
        fenKey: 'after-nf6',
        ply: 6,
        sideToMove: 'white',
        bestUci: 'e1g1',
        bestSan: 'O-O',
        evalCp: 15,
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
        id: 'e-bc4',
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
      {
        id: 'e-nf6',
        fromNodeId: 'after-bc4',
        toNodeId: 'after-nf6',
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

  const fullUcis = replayToNodeUcis(tree, 'after-nf6');
  const moves = buildStoredMovesFromUciList(null, fullUcis);

  for (let index = 0; index <= moves.length; index += 1) {
    const restored = restoreGameFromHistory(moves, null, index);
    assert.ok(restored.fen());
  }

  const path = buildDrillPath(tree, { trainSide: 'white', startNodeId: 'root' });
  assert.ok(path.length >= 2);
});

test('corrupted opponent move from stale tree fen fails restore', () => {
  const moves = buildStoredMovesFromUciList(null, [...FOUR_KNIGHTS_ROOT_UCI, 'f1b5']);
  const staleFen = restoreGameFromHistory(moves, null, FOUR_KNIGHTS_ROOT_UCI.length).fen();

  assert.throws(() => applyStoredMoveFromUci(staleFen, 'g7g5'));

  const board = restoreGameFromHistory(moves, null, moves.length);
  const appended = appendStoredMoveFromUci(moves, board.fen(), 'g8f6');
  assert.doesNotThrow(() => restoreGameFromHistory(appended.moveHistory, null, appended.moveHistory.length));
});

test('linesJumpToHistoryIndex mirrors single-step undo used by keyboard', () => {
  const { moveHistory, historyIndex } = simulateLearnReplayAndTrainLine(FOUR_KNIGHTS_ROOT_UCI, 'f1b5', 'g8f6');

  const jumped = linesJumpToHistoryIndex(moveHistory, null, historyIndex, historyIndex - 1);

  assert.equal(jumped.historyIndex, 5);
  assert.equal(jumped.moveHistory.length, 5);
  assert.equal(jumped.game.turn(), 'b');
  assert.doesNotThrow(() => restoreGameFromHistory(jumped.moveHistory, null, jumped.historyIndex));
});

test('stale closure uses pre-train snapshot and cannot append black reply after train ply', () => {
  let moveHistory = buildStoredMovesFromUciList(null, FOUR_KNIGHTS_ROOT_UCI);
  let historyIndex = moveHistory.length;

  const train = appendOpponentLikeDrill(moveHistory, historyIndex, 'f1b5');
  moveHistory = train.moveHistory;
  historyIndex = train.moveHistory.length;

  const staleHistory = buildStoredMovesFromUciList(null, FOUR_KNIGHTS_ROOT_UCI);
  const staleFen = restoreGameFromHistory(staleHistory, null, staleHistory.length).fen();

  assert.throws(() => applyStoredMoveFromUci(staleFen, 'g8f6'));

  const correct = appendOpponentLikeDrill(moveHistory, historyIndex, 'g8f6');
  assert.equal(correct.moveHistory.length, 6);
  assert.doesNotThrow(() => restoreGameFromHistory(correct.moveHistory, null, correct.moveHistory.length));
});

test('multi-ply undo through learn train and opponent sequence stays legal', () => {
  const { moveHistory, historyIndex } = simulateLearnReplayAndTrainLine(FOUR_KNIGHTS_ROOT_UCI, 'f1b5', 'g8f6');

  let currentHistory = moveHistory;
  let currentIndex = historyIndex;

  for (let target = historyIndex - 1; target >= 0; target -= 1) {
    const jumped = linesJumpToHistoryIndex(currentHistory, null, currentIndex, target);
    assert.doesNotThrow(() => restoreGameFromHistory(jumped.moveHistory, null, jumped.historyIndex));
    currentHistory = jumped.moveHistory;
    currentIndex = jumped.historyIndex;
  }

  assert.equal(currentIndex, 0);
  assert.equal(currentHistory.length, 0);
});

test('undo after miss then correct train and opponent keeps replayable history', () => {
  let moveHistory = buildStoredMovesFromUciList(null, FOUR_KNIGHTS_ROOT_UCI);
  let historyIndex = moveHistory.length;

  const miss = appendOpponentLikeDrill(moveHistory, historyIndex, 'f1c4');
  moveHistory = miss.moveHistory;
  historyIndex = miss.moveHistory.length;

  const afterMissUndo = linesJumpToHistoryIndex(moveHistory, null, historyIndex, historyIndex - 1);
  moveHistory = afterMissUndo.moveHistory;
  historyIndex = afterMissUndo.historyIndex;

  const train = appendOpponentLikeDrill(moveHistory, historyIndex, 'f1b5');
  moveHistory = train.moveHistory;
  historyIndex = train.moveHistory.length;

  const opponent = appendOpponentLikeDrill(moveHistory, historyIndex, 'g8f6');
  moveHistory = opponent.moveHistory;
  historyIndex = opponent.moveHistory.length;

  const undoOpponent = linesJumpToHistoryIndex(moveHistory, null, historyIndex, historyIndex - 1);
  const undoTrain = linesJumpToHistoryIndex(
    undoOpponent.moveHistory,
    null,
    undoOpponent.historyIndex,
    undoOpponent.historyIndex - 1,
  );

  assert.equal(undoTrain.historyIndex, 4);
  assert.equal(undoTrain.moveHistory.map((move) => move.uci).join(' '), FOUR_KNIGHTS_ROOT_UCI.join(' '));
});

test('branching history truncates on undo when index trails stored moves', () => {
  const root = buildStoredMovesFromUciList(null, FOUR_KNIGHTS_ROOT_UCI);
  const branch = appendOpponentLikeDrill(root, root.length, 'f1c4');
  const full = appendOpponentLikeDrill(branch.moveHistory, branch.moveHistory.length, 'g8f6');
  const jumped = linesJumpToHistoryIndex(full.moveHistory, null, 5, 4);

  assert.equal(jumped.historyIndex, 4);
  assert.equal(jumped.moveHistory.length, 4);
  assert.equal(jumped.moveHistory.map((move) => move.uci).join(' '), FOUR_KNIGHTS_ROOT_UCI.join(' '));
});
