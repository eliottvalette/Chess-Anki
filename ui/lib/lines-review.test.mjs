import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendStoredMoveFromUci,
  buildStoredMovesFromUciList,
  restoreGameFromHistory,
} from './chess-analysis-client.ts';
import {
  buildOpeningDrillExpected,
  buildReviewQueue,
  classifyLinesMove,
  countReviewDueNodes,
  findPathToNode,
  hasRemainingLearnBranches,
  isLearnBranchEdgeCompleted,
  isTrainableReviewNode,
  LINES_REVIEW_DUE_MASTERY_THRESHOLD,
  pickLearnBranch,
  replayToNodeUcis,
  resolveDrillPathStepIndexFromHistory,
  resolveReviewAdvance,
} from './opening-tree.ts';

function buildItalianReviewTree() {
  return {
    rootSan: ['e4', 'e5', 'Nf3', 'Nc6'],
    rootUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
    rootPly: 4,
    rootFenKey: 'italian-root',
    targetDepth: 22,
    nodes: [
      {
        id: 'italian-root',
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 4',
        fenKey: 'italian-root',
        ply: 4,
        sideToMove: 'white',
        bestUci: 'f1c4',
        bestSan: 'Bc4',
        evalCp: 20,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 85,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-bc4',
        fen: 'r1bqkbnr/pppp1ppp/2n5/2B1p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 4',
        fenKey: 'after-bc4',
        ply: 5,
        sideToMove: 'black',
        bestUci: 'g8f6',
        bestSan: 'Nf6',
        evalCp: 18,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 85,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'weak-d3',
        fen: 'r1bqkb1r/pppp1ppp/2n2n2/2b1p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 5',
        fenKey: 'weak-d3',
        ply: 6,
        sideToMove: 'white',
        bestUci: 'd2d3',
        bestSan: 'd3',
        evalCp: 22,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 25,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-d3',
        fen: 'r1bqkb1r/pppp1ppp/2n2n2/2b1p3/4P3/3P1N2/PPP2PPP/RNBQKB1R b KQkq - 0 5',
        fenKey: 'after-d3',
        ply: 7,
        sideToMove: 'black',
        bestUci: 'f8e7',
        bestSan: 'Be7',
        evalCp: 20,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 85,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'weak-castles',
        fen: 'r1bqk2r/ppppbppp/2n2n2/2b1p3/4P3/3P1N2/PPP2PPP/RNBQKB1R w KQkq - 2 6',
        fenKey: 'weak-castles',
        ply: 8,
        sideToMove: 'white',
        bestUci: 'e1g1',
        bestSan: 'O-O',
        evalCp: 21,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 55,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'mastered-node',
        fen: 'r1bqk2r/ppppbppp/2n2n2/2b1p3/4P3/3P1N2/PPP2PPP/RNBQKB1R w KQkq - 2 6',
        fenKey: 'mastered-node',
        ply: 10,
        sideToMove: 'white',
        bestUci: 'c2c3',
        bestSan: 'c3',
        evalCp: 19,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 92,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'terminal-weak',
        fen: 'r1bqkb1r/pppp1ppp/2n2n2/2b1p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 5',
        fenKey: 'terminal-weak',
        ply: 6,
        sideToMove: 'white',
        bestUci: null,
        bestSan: null,
        evalCp: 0,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 5,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [
      {
        id: 'edge-bc4',
        fromNodeId: 'italian-root',
        toNodeId: 'after-bc4',
        uci: 'f1c4',
        san: 'Bc4',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 5,
        cardCount: 0,
        mastersGames: 0,
        priority: 10,
        isEngineBest: true,
      },
      {
        id: 'edge-nf6',
        fromNodeId: 'after-bc4',
        toNodeId: 'weak-d3',
        uci: 'g8f6',
        san: 'Nf6',
        moveBy: 'black',
        source: 'lichess_masters',
        recentCount: 8,
        cardCount: 0,
        mastersGames: 100,
        priority: 8,
        isEngineBest: false,
      },
      {
        id: 'edge-d3',
        fromNodeId: 'weak-d3',
        toNodeId: 'after-d3',
        uci: 'd2d3',
        san: 'd3',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 2,
        cardCount: 0,
        mastersGames: 0,
        priority: 10,
        isEngineBest: true,
      },
      {
        id: 'edge-be7',
        fromNodeId: 'after-d3',
        toNodeId: 'weak-castles',
        uci: 'f8e7',
        san: 'Be7',
        moveBy: 'black',
        source: 'recent_game',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        priority: 5,
        isEngineBest: false,
      },
      {
        id: 'edge-oo',
        fromNodeId: 'weak-castles',
        toNodeId: 'mastered-node',
        uci: 'e1g1',
        san: 'O-O',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 4,
        cardCount: 0,
        mastersGames: 0,
        priority: 10,
        isEngineBest: true,
      },
    ],
  };
}

function buildReviewDrillPath(tree, nodeId, trainSide) {
  const path = findPathToNode(tree, nodeId);

  return path.map((step) => ({
    ...step,
    isTrainTurn: tree.nodes.find((node) => node.id === step.nodeId)?.sideToMove === trainSide,
    trainSide,
  }));
}

test('buildReviewQueue keeps only train-side weak trainable nodes sorted by mastery', () => {
  const tree = buildItalianReviewTree();

  assert.deepEqual(buildReviewQueue(tree, 'white'), ['weak-d3', 'weak-castles']);
  assert.equal(countReviewDueNodes(tree, 'white'), 2);
  assert.equal(isTrainableReviewNode(tree, 'weak-d3'), true);
  assert.equal(isTrainableReviewNode(tree, 'terminal-weak'), false);
  assert.equal(isTrainableReviewNode(tree, 'mastered-node'), true);
});

test('buildReviewQueue excludes nodes at or above review mastery threshold', () => {
  const tree = buildItalianReviewTree();

  assert.ok(tree.nodes.find((node) => node.id === 'mastered-node').masteryScore >= LINES_REVIEW_DUE_MASTERY_THRESHOLD);
  assert.equal(buildReviewQueue(tree, 'white').includes('mastered-node'), false);
});

test('buildReviewQueue returns empty queue for train side with no due nodes', () => {
  const tree = buildItalianReviewTree();

  assert.deepEqual(buildReviewQueue(tree, 'black'), []);
});

test('replayToNodeUcis builds a legal path to each review card', () => {
  const tree = buildItalianReviewTree();
  const queue = buildReviewQueue(tree, 'white');

  for (const nodeId of queue) {
    const fullUcis = replayToNodeUcis(tree, nodeId);

    assert.doesNotThrow(() => {
      restoreGameFromHistory(buildStoredMovesFromUciList(null, fullUcis), null, fullUcis.length);
    });
  }

  const firstCardUcis = replayToNodeUcis(tree, queue[0]);
  const secondCardUcis = replayToNodeUcis(tree, queue[1]);

  assert.equal(firstCardUcis.length, 6);
  assert.equal(secondCardUcis.length, 8);
  assert.notDeepEqual(firstCardUcis, secondCardUcis);
});

test('review drill expected move is available on due nodes only', () => {
  const tree = buildItalianReviewTree();

  assert.deepEqual(buildOpeningDrillExpected(tree, 'weak-d3'), {
    nodeId: 'weak-d3',
    uci: 'd2d3',
    san: 'd3',
    acceptedUcis: ['d2d3'],
  });
  assert.equal(buildOpeningDrillExpected(tree, 'terminal-weak'), null);
});

test('classifyLinesMove grades review answers as best or miss', () => {
  const tree = buildItalianReviewTree();
  const expected = buildOpeningDrillExpected(tree, 'weak-d3');

  assert.equal(
    classifyLinesMove(tree, 'weak-d3', 'd2d3', {
      primaryUci: expected.uci,
      acceptedUcis: expected.acceptedUcis,
    }).category,
    'best',
  );
  assert.equal(
    classifyLinesMove(tree, 'weak-d3', 'f1b5', {
      primaryUci: expected.uci,
      acceptedUcis: expected.acceptedUcis,
    }).category,
    'miss',
  );
});

test('resolveReviewAdvance walks the queue then completes', () => {
  const queue = ['weak-d3', 'weak-castles', 'extra'];

  assert.deepEqual(resolveReviewAdvance(queue, 0), {
    kind: 'next',
    nextIndex: 1,
    nextNodeId: 'weak-castles',
  });
  assert.deepEqual(resolveReviewAdvance(queue, 1), {
    kind: 'next',
    nextIndex: 2,
    nextNodeId: 'extra',
  });
  assert.deepEqual(resolveReviewAdvance(queue, 2), { kind: 'complete' });
});

test('review session simulation advances through cards after correct answers', () => {
  const tree = buildItalianReviewTree();
  const trainSide = 'white';
  const queue = buildReviewQueue(tree, trainSide);
  let reviewIndex = 0;

  while (reviewIndex < queue.length) {
    const nodeId = queue[reviewIndex];
    const fullUcis = replayToNodeUcis(tree, nodeId);
    const moveHistory = buildStoredMovesFromUciList(null, fullUcis);
    const board = restoreGameFromHistory(moveHistory, null, moveHistory.length);
    const expected = buildOpeningDrillExpected(tree, nodeId);

    assert.notEqual(expected, null);

    const played = appendStoredMoveFromUci(moveHistory, board.fen(), expected.uci);
    const classified = classifyLinesMove(tree, nodeId, expected.uci, {
      primaryUci: expected.uci,
      acceptedUcis: expected.acceptedUcis,
    });

    assert.equal(classified.category, 'best');
    assert.doesNotThrow(() => {
      restoreGameFromHistory(played.moveHistory, null, played.moveHistory.length);
    });

    const advance = resolveReviewAdvance(queue, reviewIndex);

    if (advance.kind === 'complete') {
      break;
    }

    reviewIndex = advance.nextIndex;
    assert.equal(advance.nextNodeId, queue[reviewIndex]);
  }

  assert.equal(reviewIndex, queue.length - 1);
});

test('review study undo keeps full history so redo stays legal', () => {
  const tree = buildItalianReviewTree();
  const nodeId = buildReviewQueue(tree, 'white')[0];
  const fullUcis = replayToNodeUcis(tree, nodeId);
  let moveHistory = buildStoredMovesFromUciList(null, fullUcis);
  let historyIndex = moveHistory.length;

  const board = restoreGameFromHistory(moveHistory, null, historyIndex);
  const trainMove = appendStoredMoveFromUci(moveHistory, board.fen(), 'd2d3');
  moveHistory = trainMove.moveHistory;
  historyIndex = moveHistory.length;

  const undoTarget = historyIndex - 1;
  const undoneBoard = restoreGameFromHistory(moveHistory, null, undoTarget);

  assert.equal(undoneBoard.turn(), 'w');
  assert.equal(moveHistory.length, fullUcis.length + 1);
  assert.equal(historyIndex, fullUcis.length + 1);

  const redoBoard = restoreGameFromHistory(moveHistory, null, historyIndex);

  assert.equal(redoBoard.fen(), trainMove.nextFen);
});

test('resolveDrillPathStepIndexFromHistory tracks review drill path position', () => {
  const tree = buildItalianReviewTree();
  const trainSide = 'white';
  const nodeId = 'weak-castles';
  const drillPath = buildReviewDrillPath(tree, nodeId, trainSide);
  const fullUcis = replayToNodeUcis(tree, nodeId);
  const moveHistory = buildStoredMovesFromUciList(null, fullUcis);
  const historyIndex = moveHistory.length;

  const stepIndex = resolveDrillPathStepIndexFromHistory(tree, drillPath, moveHistory, historyIndex);

  assert.equal(drillPath[stepIndex]?.nodeId, nodeId);
});

test('pickLearnBranch excludes completed branches by uci even with a different edge id', () => {
  const tree = {
    rootSan: ['e4', 'e5', 'Nf3', 'Nc6'],
    rootPly: 4,
    rootFenKey: 'root',
    targetDepth: 22,
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
        id: 'branch-bb5-a',
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
  const completed = [
    {
      forkNodeId: 'root-node',
      edgeId: 'duplicate-id',
      edgeUci: first.branchEdgeUci,
    },
  ];

  assert.equal(isLearnBranchEdgeCompleted('root-node', { id: 'branch-bb5-a', uci: 'f1b5' }, completed), true);

  const second = pickLearnBranch(tree, 'white', completed);

  assert.notEqual(second.branchEdgeUci, first.branchEdgeUci);
  assert.equal(
    hasRemainingLearnBranches(tree, 'white', [
      ...completed,
      {
        forkNodeId: second.branchForkNodeId,
        edgeId: second.branchEdgeId,
        edgeUci: second.branchEdgeUci,
      },
    ]),
    false,
  );
});
