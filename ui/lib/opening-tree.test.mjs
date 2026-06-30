import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alignOpeningTreeWithBoardPosition,
  applyLearnMaxPlyToOpeningTree,
  applyOpeningTreeNodeAttempt,
  buildDrillPath,
  buildForkCoverage,
  buildLearnDrillExpectedFromStep,
  buildLearnDrillReplayUcis,
  buildLearnDrillStartupUcis,
  buildOpeningDrillExpected,
  buildOpeningTrees,
  buildReviewQueue,
  chooseWeightedOpponentEdge,
  classifyBoardMoveAtHistoryIndex,
  classifyLinesMove,
  classifyLinesMoveAtHistoryIndex,
  classifyOpeningDrillMove,
  classifyRootPrefixMove,
  countLearnLines,
  ensureOpeningTreeRootPrefix,
  extendDrillPathFromNode,
  filterAndSortOpeningTreeSummariesByColor,
  filterOpeningTreeForDisplay,
  filterOpeningTreeSummariesByIds,
  filterOpeningTreeSummariesByMinForcedPlies,
  findLastTrainStepIndexInDrillPath,
  formatBrowseForcedRootLine,
  formatBrowseForcedRootSan,
  formatOpeningTreeDisplayName,
  hasRemainingLearnBranches,
  LINES_MOVE_EVAL_GATE_CP,
  listOpponentNodesForLichessEnrichment,
  listOpponentNodesNeedingBookEnrichment,
  markForkEdgePlayed,
  mergeOpeningTreeDelta,
  normalizeOpeningFen,
  OPENING_TARGET_DEPTH_NORMAL,
  openingTreeDetailToSummary,
  parseSanMoves,
  pickLearnBranch,
  pickNextUnplayedOpponentEdge,
  prepareOpeningTreeAtFenWithBoard,
  replayToNodeUcis,
  resolveAcceptedTrainMoveUcis,
  resolveLinesBoardContext,
  resolveLinesLiveProgressPublication,
  resolveLinesStudyActiveTree,
  resolveOpeningLibrary,
  resolveOpeningNodeFromHistory,
  resolveOpeningTreeOutcomeSummary,
  resolveOpeningTreeSelectionId,
  resolveRequestedOpeningTrainSide,
  STANDARD_START_FEN_KEY,
  sliceOpeningForest,
} from './opening-tree.ts';

test('resolveOpeningTreeSelectionId replaces an aggregated browse id with the loaded canonical id', () => {
  assert.equal(
    resolveOpeningTreeSelectionId('aggregate-line-id', { id: 'white-canonical-line-id' }),
    'white-canonical-line-id',
  );
  assert.equal(resolveOpeningTreeSelectionId('aggregate-line-id', null), 'aggregate-line-id');
});

test('openingTreeDetailToSummary preserves outcome rates and precomputed eval', () => {
  const tree = buildOpeningTrees(
    [
      {
        id: 'game-1',
        name: 'Italian',
        trainSide: 'white',
        moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
        source: 'recent_game',
        outcome: 'win',
      },
    ],
    { ownerProfileId: 'profile-1', targetDepth: 8, rootPly: 4 },
  )[0];
  tree.openingEvalCp = 31;

  const summary = openingTreeDetailToSummary(tree);

  assert.equal(summary.winCount, tree.winCount);
  assert.equal(summary.lossCount, tree.lossCount);
  assert.equal(summary.drawCount, tree.drawCount);
  assert.equal(summary.openingEvalCp, 31);
});

test('resolveOpeningTreeOutcomeSummary keeps aggregated side rates after canonical detail selection', () => {
  const aggregate = {
    id: 'aggregate-id',
    rootFenKey: 'shared-root',
    rootUci: ['e2e4', 'e7e5'],
    linesWhite: 4,
    linesBlack: 3,
    whiteWinCount: 3,
    whiteLossCount: 1,
    blackWinCount: 1,
    blackLossCount: 2,
  };

  const resolved = resolveOpeningTreeOutcomeSummary([aggregate], 'white-canonical-id', {
    rootFenKey: 'shared-root',
    rootUci: ['e2e4', 'e7e5'],
  });

  assert.equal(resolved, aggregate);
});

test('resolveRequestedOpeningTrainSide prioritizes an explicit side change', () => {
  assert.equal(resolveRequestedOpeningTrainSide('white', 'black'), 'black');
  assert.equal(resolveRequestedOpeningTrainSide('black'), 'black');
});

test('resolveLinesStudyActiveTree keeps the session source authoritative during learn undo', () => {
  const whiteTree = { id: 'white-tree' };
  const blackSessionTree = { id: 'black-tree' };

  assert.equal(resolveLinesStudyActiveTree(whiteTree, blackSessionTree, 'learn'), blackSessionTree);
  assert.equal(resolveLinesStudyActiveTree(whiteTree, blackSessionTree, 'idle'), whiteTree);
});

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

test('buildLearnDrillExpectedFromStep accepts only the drill line move', () => {
  const expected = buildLearnDrillExpectedFromStep({
    nodeId: 'after-d5',
    bestUci: 'e4d5',
    bestSan: 'exd5',
  });

  assert.deepEqual(expected, {
    nodeId: 'after-d5',
    uci: 'e4d5',
    san: 'exd5',
    acceptedUcis: ['e4d5'],
  });
});

test('buildLearnDrillExpectedFromStep falls back to the repertoire primary move when bestUci is missing', () => {
  const tree = {
    nodes: [
      {
        id: 'after-qe5',
        fen: 'rnbakb1r/pppp1ppp/5n2/4q3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 4 4',
        fenKey: 'after-qe5',
        ply: 7,
        sideToMove: 'white',
        bestUci: null,
        bestSan: null,
        evalCp: 0,
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
        id: 'edge-be2',
        fromNodeId: 'after-qe5',
        toNodeId: 'after-be2',
        uci: 'f1e2',
        san: 'Be2',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 0,
        cardCount: 0,
        mastersGames: 0,
        priority: 40,
        isEngineBest: true,
      },
    ],
  };
  const expected = buildLearnDrillExpectedFromStep(
    {
      nodeId: 'after-qe5',
      bestUci: null,
      bestSan: null,
    },
    tree,
  );

  assert.deepEqual(expected, {
    nodeId: 'after-qe5',
    uci: 'f1e2',
    san: 'Be2',
    acceptedUcis: ['f1e2'],
  });
});

test('learn drill classification rejects repertoire alternatives at the same node', () => {
  const tree = {
    nodes: [
      {
        id: 'after-d5',
        fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        fenKey: 'after-d5',
        ply: 2,
        sideToMove: 'white',
        bestUci: 'e4d5',
        bestSan: 'exd5',
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
        id: 'edge-exd5',
        fromNodeId: 'after-d5',
        toNodeId: 'after-exd5',
        uci: 'e4d5',
        san: 'exd5',
        moveBy: 'white',
        source: 'recent_game',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        priority: 1,
        isEngineBest: true,
      },
      {
        id: 'edge-nc3',
        fromNodeId: 'after-d5',
        toNodeId: 'after-nc3',
        uci: 'b1c3',
        san: 'Nc3',
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
  const learnExpected = buildLearnDrillExpectedFromStep({
    nodeId: 'after-d5',
    bestUci: 'e4d5',
    bestSan: 'exd5',
  });

  assert.equal(
    classifyLinesMove(tree, 'after-d5', 'e4d5', {
      primaryUci: learnExpected.uci,
      acceptedUcis: learnExpected.acceptedUcis,
    }).category,
    'best',
  );
  assert.equal(
    classifyLinesMove(tree, 'after-d5', 'b1c3', {
      primaryUci: learnExpected.uci,
      acceptedUcis: learnExpected.acceptedUcis,
    }).category,
    'miss',
  );
  assert.equal(classifyLinesMove(tree, 'after-d5', 'b1c3').category, 'book');
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

function buildOpponentForkLearnTree() {
  return {
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
        bestUci: 'd2d4',
        bestSan: 'd4',
        evalCp: 20,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 50,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-d4',
        fen: 'rnbqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq - 0 3',
        fenKey: 'after-d4',
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
        id: 'after-nf6',
        fen: 'fen-nf6',
        fenKey: 'after-nf6',
        ply: 6,
        sideToMove: 'white',
        bestUci: 'd4d5',
        bestSan: 'd5',
        evalCp: 20,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 10,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-be7',
        fen: 'fen-be7',
        fenKey: 'after-be7',
        ply: 6,
        sideToMove: 'white',
        bestUci: 'd4d5',
        bestSan: 'd5',
        evalCp: 20,
        recentGames: 0,
        cardCount: 0,
        masteryScore: 20,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
    ],
    edges: [
      {
        id: 'edge-d4',
        fromNodeId: 'root-node',
        toNodeId: 'after-d4',
        uci: 'd2d4',
        san: 'd4',
        moveBy: 'white',
        source: 'lichess_masters',
        recentCount: 10,
        cardCount: 0,
        mastersGames: 40,
        priority: 8,
        isEngineBest: true,
      },
      {
        id: 'edge-bc4',
        fromNodeId: 'root-node',
        toNodeId: 'after-be7',
        uci: 'f1c4',
        san: 'Bc4',
        moveBy: 'white',
        source: 'lichess_masters',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 5,
        priority: 8,
        isEngineBest: false,
      },
      {
        id: 'edge-nf6',
        fromNodeId: 'after-d4',
        toNodeId: 'after-nf6',
        uci: 'g8f6',
        san: 'Nf6',
        moveBy: 'black',
        source: 'lichess_masters',
        recentCount: 8,
        cardCount: 0,
        mastersGames: 30,
        priority: 8,
        isEngineBest: false,
      },
      {
        id: 'edge-be7',
        fromNodeId: 'after-d4',
        toNodeId: 'after-be7',
        uci: 'f8e7',
        san: 'Be7',
        moveBy: 'black',
        source: 'lichess_masters',
        recentCount: 3,
        cardCount: 0,
        mastersGames: 10,
        priority: 8,
        isEngineBest: false,
      },
    ],
  };
}

function buildDeepOffMainForkLearnTree() {
  const node = (id, ply, sideToMove, bestUci = null, masteryScore = 0) => ({
    id,
    fen: `fen-${id}`,
    fenKey: id,
    ply,
    sideToMove,
    bestUci,
    bestSan: bestUci,
    evalCp: 0,
    recentGames: 1,
    cardCount: 0,
    masteryScore,
    seenCount: 0,
    correctCount: 0,
    missCount: 0,
  });
  const edge = (id, fromNodeId, toNodeId, uci, moveBy, recentCount = 1) => ({
    id,
    fromNodeId,
    toNodeId,
    uci,
    san: uci,
    moveBy,
    source: 'recent_game',
    recentCount,
    cardCount: 0,
    mastersGames: 0,
    priority: 1,
    isEngineBest: false,
  });

  return {
    rootSan: [],
    rootPly: 0,
    rootFenKey: 'root',
    targetDepth: 8,
    nodes: [
      node('root', 0, 'white'),
      node('main-train', 1, 'black', 'main-best', 90),
      node('side-train', 1, 'black', 'side-best', 10),
      node('main-fork', 2, 'white'),
      node('side-fork', 2, 'white'),
      node('main-a', 3, 'black', null, 90),
      node('main-b', 3, 'black', null, 90),
      node('side-a', 3, 'black', null, 5),
      node('side-b', 3, 'black', null, 5),
    ],
    edges: [
      edge('root-main', 'root', 'main-train', 'root-main', 'white', 20),
      edge('root-side', 'root', 'side-train', 'root-side', 'white', 10),
      edge('main-best', 'main-train', 'main-fork', 'main-best', 'black'),
      edge('side-best', 'side-train', 'side-fork', 'side-best', 'black'),
      edge('main-a', 'main-fork', 'main-a', 'main-a', 'white', 8),
      edge('main-b', 'main-fork', 'main-b', 'main-b', 'white', 7),
      edge('side-a', 'side-fork', 'side-a', 'side-a', 'white', 6),
      edge('side-b', 'side-fork', 'side-b', 'side-b', 'white', 5),
    ],
  };
}

test('pickLearnBranch varies opponent replies on the main line while user keeps the best move', () => {
  const tree = buildOpponentForkLearnTree();
  const first = pickLearnBranch(tree, 'white', []);

  assert.equal(first.branchForkNodeId, 'after-d4');
  assert.equal(first.path[0]?.nodeId, 'root-node');
  assert.equal(first.path[1]?.edgeUciFromParent, 'd2d4');
  assert.ok(['g8f6', 'f8e7'].includes(first.branchEdgeUci ?? ''));

  const second = pickLearnBranch(tree, 'white', [
    {
      forkNodeId: first.branchForkNodeId,
      edgeId: first.branchEdgeId,
      edgeUci: first.branchEdgeUci,
    },
  ]);

  assert.equal(second.branchForkNodeId, 'after-d4');
  assert.notEqual(second.branchEdgeUci, first.branchEdgeUci);
  assert.equal(second.path[1]?.edgeUciFromParent, 'd2d4');
});

test('pickLearnBranch reaches a selected deep fork outside the default drill path', () => {
  const tree = buildDeepOffMainForkLearnTree();
  const completed = [
    { forkNodeId: 'root', edgeId: 'root-main', edgeUci: 'root-main' },
    { forkNodeId: 'root', edgeId: 'root-side', edgeUci: 'root-side' },
    { forkNodeId: 'main-fork', edgeId: 'main-a', edgeUci: 'main-a' },
    { forkNodeId: 'main-fork', edgeId: 'main-b', edgeUci: 'main-b' },
  ];

  const picked = pickLearnBranch(tree, 'black', completed);
  const forkStepIndex = picked.path.findIndex((step) => step.nodeId === picked.branchForkNodeId);

  assert.equal(picked.branchForkNodeId, 'side-fork');
  assert.ok(forkStepIndex >= 0);
  assert.equal(picked.path[forkStepIndex + 1]?.edgeUciFromParent, picked.branchEdgeUci);
  assert.deepEqual(
    picked.path.slice(0, forkStepIndex + 1).map((step) => step.nodeId),
    ['root', 'side-train', 'side-fork'],
  );
});

test('pickLearnBranch prioritizes the least-mastered reachable line across forks', () => {
  const tree = buildDeepOffMainForkLearnTree();
  const completed = [
    { forkNodeId: 'root', edgeId: 'root-main', edgeUci: 'root-main' },
    { forkNodeId: 'root', edgeId: 'root-side', edgeUci: 'root-side' },
    { forkNodeId: 'main-fork', edgeId: 'main-a', edgeUci: 'main-a' },
  ];

  const picked = pickLearnBranch(tree, 'black', completed);

  assert.equal(picked.branchForkNodeId, 'side-fork');
  assert.ok(['side-a', 'side-b'].includes(picked.branchEdgeUci ?? ''));
});

test('live learn attempts immediately reorder the least-mastered branch', () => {
  const tree = buildDeepOffMainForkLearnTree();
  const completed = [
    { forkNodeId: 'root', edgeId: 'root-main', edgeUci: 'root-main' },
    { forkNodeId: 'root', edgeId: 'root-side', edgeUci: 'root-side' },
    { forkNodeId: 'main-fork', edgeId: 'main-a', edgeUci: 'main-a' },
    { forkNodeId: 'side-fork', edgeId: 'side-a', edgeUci: 'side-a' },
  ];
  const scores = new Map([
    ['main-train', 30],
    ['main-b', 30],
    ['side-train', 20],
    ['side-b', 20],
  ]);
  const liveTree = {
    ...tree,
    nodes: tree.nodes.map((node) => ({ ...node, masteryScore: scores.get(node.id) ?? node.masteryScore })),
  };

  assert.equal(pickLearnBranch(liveTree, 'black', completed).branchForkNodeId, 'side-fork');

  const afterFirstCorrect = applyOpeningTreeNodeAttempt(liveTree, 'side-train', true);
  const afterLineCorrect = applyOpeningTreeNodeAttempt(afterFirstCorrect, 'side-b', true);

  assert.equal(afterLineCorrect.nodes.find((node) => node.id === 'side-train')?.masteryScore, 38);
  assert.equal(afterLineCorrect.nodes.find((node) => node.id === 'side-b')?.masteryScore, 38);
  assert.equal(pickLearnBranch(afterLineCorrect, 'black', completed).branchForkNodeId, 'main-fork');
  assert.equal(liveTree.nodes.find((node) => node.id === 'side-train')?.masteryScore, 20);
});

test('live learn progress stays in the session tree until the next branch publication', () => {
  const renderedTree = buildDeepOffMainForkLearnTree();
  const sessionTree = { ...renderedTree, id: 'session-tree' };
  const updatedSessionTree = applyOpeningTreeNodeAttempt(sessionTree, 'side-train', true);

  const publication = resolveLinesLiveProgressPublication(renderedTree, sessionTree, updatedSessionTree);

  assert.equal(publication.sessionTree, updatedSessionTree);
  assert.equal(publication.activeTree, renderedTree);
  assert.notEqual(publication.activeTree, updatedSessionTree);
});

test('countLearnLines follows opponent variants and the max learn ply cap', () => {
  const tree = buildDeepOffMainForkLearnTree();

  assert.equal(countLearnLines(tree, 'black', 0), 4);
  assert.equal(countLearnLines(tree, 'black', 2), 2);
  assert.equal(countLearnLines(tree, 'black', 1), 0);
});

test('hasRemainingLearnBranches ignores the branch currently in progress', () => {
  const tree = buildOpponentForkLearnTree();
  const first = pickLearnBranch(tree, 'white', []);

  assert.equal(
    hasRemainingLearnBranches(tree, 'white', [], {
      forkNodeId: first.branchForkNodeId,
      edgeId: first.branchEdgeId,
      edgeUci: first.branchEdgeUci,
    }),
    false,
  );

  assert.equal(hasRemainingLearnBranches(tree, 'white', []), true);
});

test('buildLearnDrillReplayUcis auto-plays opponent moves only, never train-side moves', () => {
  const tree = buildOpponentForkLearnTree();
  const { path } = pickLearnBranch(tree, 'white', []);

  assert.deepEqual(buildLearnDrillReplayUcis(path), []);
  assert.equal(path[0]?.isTrainTurn, true);
  assert.equal(path[0]?.nodeId, 'root-node');
});

test('listOpponentNodesNeedingBookEnrichment includes engine leaf nodes without outgoing edges', () => {
  const draft = {
    trainSide: 'white',
    nodes: [
      {
        id: 'after-bb5',
        fen: 'rn1qkbnr/ppp1pppp/8/1B1P1b2/8/8/PPPP1PPP/RNBQK1NR b KQkq - 2 3',
        fenKey: 'after-bb5',
        ply: 5,
        sideToMove: 'black',
        recentGames: 0,
        cardCount: 0,
      },
      {
        id: 'after-exd5',
        fen: 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq d6 0 2',
        fenKey: 'after-exd5',
        ply: 3,
        sideToMove: 'black',
        recentGames: 2,
        cardCount: 0,
      },
    ],
    edges: [
      {
        id: 'engine-bb5',
        fromNodeId: 'before-bb5',
        toNodeId: 'after-bb5',
        uci: 'f1b5',
        san: 'Bb5+',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 0,
        cardCount: 0,
        mastersGames: 0,
        priority: 40,
        isEngineBest: true,
      },
    ],
  };

  const enrichmentTargets = listOpponentNodesForLichessEnrichment(draft);
  const bookLeaves = listOpponentNodesNeedingBookEnrichment(draft);

  assert.equal(
    enrichmentTargets.some((node) => node.id === 'after-bb5'),
    true,
  );
  assert.equal(
    bookLeaves.some((node) => node.id === 'after-bb5'),
    true,
  );
});

test('buildDrillPath trailing opponent step edgeUciFromParent is the preceding train move', () => {
  const tree = {
    rootSan: [],
    rootPly: 0,
    rootFenKey: 'train-root',
    nodes: [
      {
        id: 'train-root',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1',
        fenKey: 'train-root',
        ply: 1,
        sideToMove: 'white',
        bestUci: 'g1f3',
        bestSan: 'Nf3',
        evalCp: 20,
        recentGames: 1,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-train',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 1',
        fenKey: 'after-train',
        ply: 2,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: 22,
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
        id: 'train-edge',
        fromNodeId: 'train-root',
        toNodeId: 'after-train',
        uci: 'g1f3',
        san: 'Nf3',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        priority: 40,
        isEngineBest: true,
      },
    ],
  };
  const path = buildDrillPath(tree, { trainSide: 'white' });
  const lastTrainIndex = findLastTrainStepIndexInDrillPath(path);
  const trailingOpponentStep = path[lastTrainIndex + 1];

  assert.equal(lastTrainIndex, 0);
  assert.equal(trailingOpponentStep?.isTrainTurn, false);
  assert.equal(trailingOpponentStep?.edgeUciFromParent, 'g1f3');
});

test('buildDrillPath follows bestUci on train turns even when another move is more frequent', () => {
  const node = (id, sideToMove, bestUci = null) => ({
    id,
    fen: id,
    fenKey: id,
    ply: id === 'root' ? 0 : 1,
    sideToMove,
    bestUci,
    bestSan: bestUci === 'e2e4' ? 'e4' : null,
    evalCp: null,
    recentGames: 1,
    cardCount: 0,
    masteryScore: 0,
    seenCount: 0,
    correctCount: 0,
    missCount: 0,
  });
  const edge = (id, toNodeId, uci, recentCount, isEngineBest = false) => ({
    id,
    fromNodeId: 'root',
    toNodeId,
    uci,
    san: uci === 'e2e4' ? 'e4' : 'd4',
    moveBy: 'white',
    source: isEngineBest ? 'engine_best' : 'recent_game',
    recentCount,
    cardCount: 0,
    mastersGames: 0,
    priority: 0,
    isEngineBest,
  });
  const tree = {
    rootSan: [],
    rootUci: [],
    rootPly: 0,
    rootFenKey: 'root',
    nodes: [node('root', 'white', 'e2e4'), node('after-e4', 'black'), node('after-d4', 'black')],
    edges: [edge('best', 'after-e4', 'e2e4', 1, true), edge('frequent', 'after-d4', 'd2d4', 20)],
  };

  const path = buildDrillPath(tree, { trainSide: 'white' });

  assert.equal(path[1]?.nodeId, 'after-e4');
  assert.equal(path[1]?.edgeUciFromParent, 'e2e4');
});

test('buildDrillPath follows repertoire primary move on train turns when bestUci is missing', () => {
  const tree = {
    rootSan: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
    rootUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'],
    rootPly: 5,
    rootFenKey: 'after-bc4',
    nodes: [
      {
        id: 'after-bc4',
        fen: 'rnbqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
        fenKey: 'after-bc4',
        ply: 5,
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
        id: 'after-nf6',
        fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
        fenKey: 'after-nf6',
        ply: 6,
        sideToMove: 'white',
        bestUci: 'e1g1',
        bestSan: 'O-O',
        evalCp: null,
        recentGames: 1,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-o-o',
        fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4',
        fenKey: 'after-o-o',
        ply: 7,
        sideToMove: 'black',
        bestUci: 'f8e7',
        bestSan: 'Be7',
        evalCp: null,
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
        id: 'nf6-edge',
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
      {
        id: 'oo-edge',
        fromNodeId: 'after-nf6',
        toNodeId: 'after-o-o',
        uci: 'e1g1',
        san: 'O-O',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        priority: 1,
        isEngineBest: true,
      },
    ],
  };

  const path = buildDrillPath(tree, { trainSide: 'black', startNodeId: 'after-bc4' });

  assert.equal(path.length, 3);
  assert.equal(path[0]?.nodeId, 'after-bc4');
  assert.equal(path[1]?.nodeId, 'after-nf6');
  assert.equal(path[1]?.edgeUciFromParent, 'g8f6');
  assert.equal(path[2]?.nodeId, 'after-o-o');
  assert.equal(path[2]?.edgeUciFromParent, 'e1g1');
});

test('extendDrillPathFromNode appends continuation when the initial path stops at a leaf', () => {
  const tree = {
    rootSan: [],
    rootPly: 0,
    rootFenKey: 'root',
    nodes: [
      {
        id: 'root',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        fenKey: 'root',
        ply: 0,
        sideToMove: 'white',
        bestUci: 'e2e4',
        bestSan: 'e4',
        evalCp: 20,
        recentGames: 1,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-nc3',
        fen: 'rnbqkbnr/pppppppp/8/8/8/2N5/PPPPPPPP/RNBQKB1R b KQkq - 1 1',
        fenKey: 'after-nc3',
        ply: 3,
        sideToMove: 'black',
        bestUci: null,
        bestSan: null,
        evalCp: 22,
        recentGames: 1,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'after-qe5',
        fen: 'rnbqkbnr/pppppppp/8/4q3/8/2N5/PPPPPPPP/RNBQKB1R w KQkq - 2 2',
        fenKey: 'after-qe5',
        ply: 4,
        sideToMove: 'white',
        bestUci: 'f1e2',
        bestSan: 'Be2',
        evalCp: 24,
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
        id: 'nc3-edge',
        fromNodeId: 'root',
        toNodeId: 'after-nc3',
        uci: 'b1c3',
        san: 'Nc3',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        priority: 40,
        isEngineBest: true,
      },
      {
        id: 'qe5-edge',
        fromNodeId: 'after-nc3',
        toNodeId: 'after-qe5',
        uci: 'd8e7',
        san: 'Qe5+',
        moveBy: 'black',
        source: 'masters',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 1,
        priority: 50,
        isEngineBest: false,
      },
    ],
  };
  const shortPath = buildDrillPath(tree, { trainSide: 'white', startNodeId: 'after-nc3' });
  const truncatedPath = shortPath.slice(0, 1);
  const extended = extendDrillPathFromNode(tree, truncatedPath, 'white');

  assert.equal(extended.length, 2);
  assert.equal(extended[1]?.nodeId, 'after-qe5');
  assert.equal(extended[1]?.bestUci, 'f1e2');
  assert.equal(extended[1]?.edgeUciFromParent, 'd8e7');
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

  const baseTree = trees[0];
  const tree = {
    ...baseTree,
    nodes: baseTree.nodes.map((node) => {
      const trainEdge = node.sideToMove === 'white' ? baseTree.edges.find((edge) => edge.fromNodeId === node.id) : null;

      return {
        ...node,
        bestUci: trainEdge?.uci ?? node.bestUci ?? null,
        bestSan: trainEdge?.san ?? node.bestSan ?? null,
        masteryScore: 40,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      };
    }),
    edges: baseTree.edges,
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

test('applyLearnMaxPlyToOpeningTree removes nodes deeper than the cap', () => {
  const tree = {
    id: 'tree-cap',
    name: 'Cap test',
    library: 'e4',
    rootFenKey: 'root',
    rootPly: 4,
    rootSan: ['e4', 'e5', 'Nf3', 'Nc6'],
    rootUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
    sourceCount: 1,
    targetDepth: 20,
    nodeCount: 4,
    dueCount: 0,
    masteryScore: 0,
    updatedAt: null,
    nodes: [
      {
        id: 'n4',
        fen: 'fen4',
        fenKey: 'k4',
        ply: 4,
        sideToMove: 'white',
        bestUci: 'd2d4',
        bestSan: 'd4',
        evalCp: 30,
        recentGames: 1,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'n5',
        fen: 'fen5',
        fenKey: 'k5',
        ply: 5,
        sideToMove: 'black',
        bestUci: 'd7d6',
        bestSan: 'd6',
        evalCp: 20,
        recentGames: 1,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'n6',
        fen: 'fen6',
        fenKey: 'k6',
        ply: 6,
        sideToMove: 'white',
        bestUci: 'f1b5',
        bestSan: 'Bb5',
        evalCp: 10,
        recentGames: 1,
        cardCount: 0,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      },
      {
        id: 'n7',
        fen: 'fen7',
        fenKey: 'k7',
        ply: 7,
        sideToMove: 'black',
        bestUci: 'a7a6',
        bestSan: 'a6',
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
        id: 'e45',
        fromNodeId: 'n4',
        toNodeId: 'n5',
        uci: 'd2d4',
        san: 'd4',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        priority: 1,
        isEngineBest: true,
      },
      {
        id: 'e56',
        fromNodeId: 'n5',
        toNodeId: 'n6',
        uci: 'd7d6',
        san: 'd6',
        moveBy: 'black',
        source: 'recent_game',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        priority: 1,
        isEngineBest: false,
      },
      {
        id: 'e67',
        fromNodeId: 'n6',
        toNodeId: 'n7',
        uci: 'f1b5',
        san: 'Bb5',
        moveBy: 'white',
        source: 'engine_best',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        priority: 1,
        isEngineBest: true,
      },
    ],
  };

  const capped = applyLearnMaxPlyToOpeningTree(tree, 5);

  assert.equal(capped.nodes.length, 2);
  assert.equal(capped.edges.length, 1);
  assert.equal(capped.targetDepth, 5);
  assert.deepEqual(
    capped.nodes.map((node) => node.ply),
    [4, 5],
  );
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
    evalLossCp: 0,
  });
});

test('classifyBoardMoveAtHistoryIndex classifies prefix train and opponent moves from history alone', () => {
  const prefixHistory = [{ uci: 'e2e4' }, { uci: 'e7e5' }, { uci: 'g1f3' }, { uci: 'b8c6' }];

  assert.deepEqual(classifyBoardMoveAtHistoryIndex(rootPrefixTree, prefixHistory, 1, 'white'), {
    moveUci: 'e2e4',
    category: 'book',
    evalLossCp: null,
  });
  assert.deepEqual(classifyBoardMoveAtHistoryIndex(rootPrefixTree, prefixHistory, 2, 'white'), {
    moveUci: 'e7e5',
    category: 'book',
    evalLossCp: null,
  });
  assert.deepEqual(classifyBoardMoveAtHistoryIndex(rootPrefixTree, prefixHistory, 3, 'white'), {
    moveUci: 'g1f3',
    category: 'book',
    evalLossCp: null,
  });

  const drillHistory = [...prefixHistory, { uci: 'f1c4' }, { uci: 'g8f6' }];

  assert.deepEqual(classifyBoardMoveAtHistoryIndex(italianDrillTree, drillHistory, 5, 'white'), {
    moveUci: 'f1c4',
    category: 'best',
    evalLossCp: 0,
  });
  assert.deepEqual(classifyBoardMoveAtHistoryIndex(italianDrillTree, drillHistory, 6, 'white'), {
    moveUci: 'g8f6',
    category: 'book',
    evalLossCp: null,
  });
  assert.deepEqual(classifyBoardMoveAtHistoryIndex(italianDrillTree, drillHistory, 5, 'white'), {
    moveUci: 'f1c4',
    category: 'best',
    evalLossCp: 0,
  });
});

test('classifyBoardMoveAtHistoryIndex handles black repertoire root offset', () => {
  const tree = {
    ...rootPrefixTree,
    rootPly: 1,
    rootSan: ['e4', 'd5'],
    rootUci: ['e2e4', 'd7d5'],
    rootFenKey: 'after-d5',
    nodes: [
      {
        ...rootPrefixTree.nodes[1],
        id: 'after-e4',
        ply: 0,
        fenKey: 'after-e4',
        sideToMove: 'black',
      },
      {
        ...rootPrefixTree.nodes[2],
        id: 'after-d5',
        ply: 1,
        fenKey: 'after-d5',
        sideToMove: 'white',
      },
    ],
    edges: [
      {
        ...rootPrefixTree.edges[1],
        id: 'edge-d5',
        fromNodeId: 'after-e4',
        toNodeId: 'after-d5',
        uci: 'd7d5',
        san: 'd5',
        moveBy: 'black',
      },
    ],
  };
  const history = [{ uci: 'e2e4' }, { uci: 'd7d5' }];

  assert.deepEqual(classifyBoardMoveAtHistoryIndex(tree, history, 1, 'black'), {
    moveUci: 'e2e4',
    category: 'book',
    evalLossCp: null,
  });
  assert.deepEqual(classifyBoardMoveAtHistoryIndex(tree, history, 2, 'black'), {
    moveUci: 'd7d5',
    category: 'book',
    evalLossCp: null,
  });
  assert.deepEqual(resolveOpeningNodeFromHistory(tree, history, 2), {
    nodeId: 'after-d5',
    plyInTree: 1,
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
    evalLossCp: null,
  });
  assert.deepEqual(classifyLinesMoveAtHistoryIndex(rootPrefixTree, moveHistory, 3, 'white'), {
    moveUci: 'g1f3',
    category: 'book',
    evalLossCp: null,
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

test('buildReviewQueue excludes weak spots reached through a non-best train move', () => {
  const node = (id, ply, sideToMove, masteryScore, bestUci = null) => ({
    id,
    fen: id,
    fenKey: id,
    ply,
    sideToMove,
    bestUci,
    bestSan: null,
    evalCp: null,
    recentGames: 1,
    cardCount: 0,
    masteryScore,
    seenCount: 0,
    correctCount: 0,
    missCount: 0,
  });
  const edge = (id, fromNodeId, toNodeId, uci, isEngineBest = false) => ({
    id,
    fromNodeId,
    toNodeId,
    uci,
    san: uci,
    moveBy: fromNodeId === 'root' ? 'white' : 'black',
    source: isEngineBest ? 'engine_best' : 'recent_game',
    recentCount: 1,
    cardCount: 0,
    mastersGames: 0,
    priority: 1,
    isEngineBest,
  });
  const tree = {
    rootSan: [],
    rootUci: [],
    rootPly: 0,
    rootFenKey: 'root',
    nodes: [
      node('root', 0, 'white', 90, 'e2e4'),
      node('after-best', 1, 'black', 0),
      node('after-old-move', 1, 'black', 0),
      node('reachable-weak', 2, 'white', 20, 'g1f3'),
      node('off-path-weak', 2, 'white', 10, 'b1c3'),
      node('after-reachable-answer', 3, 'black', 0),
      node('after-off-path-answer', 3, 'black', 0),
    ],
    edges: [
      edge('best', 'root', 'after-best', 'e2e4', true),
      edge('old', 'root', 'after-old-move', 'd2d4'),
      edge('reply-best', 'after-best', 'reachable-weak', 'e7e5'),
      edge('reply-old', 'after-old-move', 'off-path-weak', 'd7d5'),
      edge('reachable-answer', 'reachable-weak', 'after-reachable-answer', 'g1f3', true),
      edge('off-path-answer', 'off-path-weak', 'after-off-path-answer', 'b1c3', true),
    ],
  };

  assert.deepEqual(buildReviewQueue(tree, 'white'), ['reachable-weak']);
  assert.deepEqual(replayToNodeUcis(tree, 'reachable-weak', { trainSide: 'white', bestTrainMovesOnly: true }), [
    'e2e4',
    'e7e5',
  ]);
  assert.deepEqual(replayToNodeUcis(tree, 'off-path-weak', { trainSide: 'white', bestTrainMovesOnly: true }), []);
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

test('filterAndSortOpeningTreeSummariesByColor uses side-specific presence', () => {
  const trees = [
    { id: 'mixed', sourceCount: 10, linesWhite: 2, linesBlack: 8 },
    { id: 'white-only', sourceCount: 5, linesWhite: 5, linesBlack: 0 },
    { id: 'black-only', sourceCount: 4, linesWhite: 0, linesBlack: 4 },
    { id: 'legacy', sourceCount: 20 },
  ];

  assert.deepEqual(
    filterAndSortOpeningTreeSummariesByColor(trees, 'white').map((tree) => tree.id),
    ['white-only', 'mixed', 'legacy'],
  );
  assert.deepEqual(
    filterAndSortOpeningTreeSummariesByColor(trees, 'black').map((tree) => tree.id),
    ['mixed', 'black-only', 'legacy'],
  );
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

test('filterOpeningTreeSummariesByMinForcedPlies hides trees below requested forced depth', () => {
  const trees = [
    { id: 'a', rootPly: 4, rootSan: ['e4', 'e5', 'Nf3', 'Nc6'] },
    { id: 'b', rootPly: 4, rootSan: ['e4', 'c5', 'Nf3', 'Nc6'] },
  ];

  assert.deepEqual(
    filterOpeningTreeSummariesByMinForcedPlies(trees, 1).map((tree) => tree.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    filterOpeningTreeSummariesByMinForcedPlies(trees, 6).map((tree) => tree.id),
    [],
  );
});

test('formatBrowseForcedRootSan truncates displayed prefix to forced plies', () => {
  const tree = { rootPly: 4, rootSan: ['e4', 'e5', 'Nf3', 'Nc6'] };

  assert.equal(formatBrowseForcedRootSan(tree, 1), 'e4');
  assert.equal(formatBrowseForcedRootSan(tree, 3), 'e4 e5 Nf3');
  assert.equal(formatBrowseForcedRootSan(tree, 4), 'e4 e5 Nf3 Nc6');
});

test('formatBrowseForcedRootLine keeps catalog continuation visible when forced prefix is shorter', () => {
  const tree = { rootPly: 4, rootSan: ['e4', 'e5', 'Nf3', 'Nc6'] };

  assert.deepEqual(formatBrowseForcedRootLine(tree, 1), {
    forced: 'e4',
    continuation: 'e5 Nf3 Nc6',
  });
  assert.deepEqual(formatBrowseForcedRootLine(tree, 4), {
    forced: 'e4 e5 Nf3 Nc6',
    continuation: null,
  });
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

test('pickLearnBranch skips completed opponent branch edges', () => {
  const tree = buildOpponentForkLearnTree();

  const first = pickLearnBranch(tree, 'white', []);
  const second = pickLearnBranch(tree, 'white', [
    {
      forkNodeId: first.branchForkNodeId,
      edgeId: first.branchEdgeId,
      edgeUci: first.branchEdgeUci,
    },
  ]);

  assert.notEqual(first.branchEdgeUci, second.branchEdgeUci);
  assert.equal(second.branchForkNodeId, 'after-d4');
});

test('resolveLinesBoardContext matches board fen when history index lags behind played moves', () => {
  const afterD5Fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  const moveHistory = [
    { san: 'e4', uci: 'e2e4', from: 'e2', to: 'e4' },
    { san: 'd5', uci: 'd7d5', from: 'd7', to: 'd5' },
  ];
  const resolved = resolveLinesBoardContext(afterD5Fen, moveHistory, 1, null);

  assert.equal(resolved.historyIndex, 2);
  assert.deepEqual(
    resolved.boardHistory.map((move) => move.uci),
    ['e2e4', 'd7d5'],
  );
  assert.equal(resolved.fenKey, normalizeOpeningFen(afterD5Fen));
});

test('ensureOpeningTreeRootPrefix rebuilds a truncated rootUci from the graph', () => {
  const afterD5FenKey = normalizeOpeningFen('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  const tree = {
    id: 'tree-scandi',
    name: 'e4 d5',
    library: 'e4',
    rootFenKey: afterD5FenKey,
    rootPly: 2,
    rootSan: ['e4'],
    rootUci: ['e2e4'],
    sourceCount: 2,
    targetDepth: 12,
    nodeCount: 4,
    dueCount: 0,
    masteryScore: 0,
    updatedAt: null,
    nodes: [
      {
        id: 'start',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        fenKey: STANDARD_START_FEN_KEY,
        ply: 0,
        sideToMove: 'white',
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
      {
        id: 'after-e4',
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        fenKey: normalizeOpeningFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'),
        ply: 1,
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
        id: 'after-d5',
        fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        fenKey: afterD5FenKey,
        ply: 2,
        sideToMove: 'white',
        bestUci: 'e4d5',
        bestSan: 'exd5',
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
        id: 'edge-e4',
        fromNodeId: 'start',
        toNodeId: 'after-e4',
        uci: 'e2e4',
        san: 'e4',
        moveBy: 'white',
        source: 'recent_game',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        priority: 1,
        isEngineBest: false,
      },
      {
        id: 'edge-d5',
        fromNodeId: 'after-e4',
        toNodeId: 'after-d5',
        uci: 'd7d5',
        san: 'd5',
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

  const repaired = ensureOpeningTreeRootPrefix(tree);

  assert.deepEqual(repaired.rootSan, ['e4', 'd5']);
  assert.deepEqual(repaired.rootUci, ['e2e4', 'd7d5']);
});

test('ensureOpeningTreeRootPrefix tolerates graph-relative black rootUci', () => {
  const afterE4FenKey = normalizeOpeningFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  const afterD5FenKey = normalizeOpeningFen('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  const tree = {
    id: 'black-relative-scandi',
    name: 'd5',
    library: 'black_vs_e4',
    rootFenKey: afterD5FenKey,
    rootPly: 1,
    rootSan: ['d5'],
    rootUci: ['d7d5'],
    sourceCount: 1,
    targetDepth: 12,
    nodeCount: 2,
    dueCount: 0,
    masteryScore: 0,
    updatedAt: null,
    nodes: [
      {
        id: 'after-e4',
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        fenKey: afterE4FenKey,
        ply: 0,
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
        id: 'after-d5',
        fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        fenKey: afterD5FenKey,
        ply: 1,
        sideToMove: 'white',
        bestUci: 'e4d5',
        bestSan: 'exd5',
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
        id: 'edge-d5',
        fromNodeId: 'after-e4',
        toNodeId: 'after-d5',
        uci: 'd7d5',
        san: 'd5',
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

  const repaired = ensureOpeningTreeRootPrefix(tree);

  assert.deepEqual(repaired.rootSan, ['d5']);
  assert.deepEqual(repaired.rootUci, ['d7d5']);
});

test('buildLearnDrillStartupUcis replays through d5 before the first white train move', () => {
  const afterD5FenKey = normalizeOpeningFen('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  const tree = {
    id: 'tree-scandi',
    name: 'e4 d5',
    library: 'e4',
    rootFenKey: afterD5FenKey,
    rootPly: 2,
    rootSan: ['e4'],
    rootUci: ['e2e4'],
    sourceCount: 2,
    targetDepth: 12,
    nodeCount: 4,
    dueCount: 0,
    masteryScore: 0,
    updatedAt: null,
    nodes: [
      {
        id: 'start',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        fenKey: STANDARD_START_FEN_KEY,
        ply: 0,
        sideToMove: 'white',
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
      {
        id: 'after-e4',
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        fenKey: normalizeOpeningFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'),
        ply: 1,
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
        id: 'after-d5',
        fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        fenKey: afterD5FenKey,
        ply: 2,
        sideToMove: 'white',
        bestUci: 'e4d5',
        bestSan: 'exd5',
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
        id: 'edge-e4',
        fromNodeId: 'start',
        toNodeId: 'after-e4',
        uci: 'e2e4',
        san: 'e4',
        moveBy: 'white',
        source: 'recent_game',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        priority: 1,
        isEngineBest: false,
      },
      {
        id: 'edge-d5',
        fromNodeId: 'after-e4',
        toNodeId: 'after-d5',
        uci: 'd7d5',
        san: 'd5',
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
  const { path } = pickLearnBranch(tree, 'white', []);
  const firstTrainIndex = path.findIndex((step) => step.isTrainTurn);
  const startupUcis = buildLearnDrillStartupUcis(tree, path, firstTrainIndex);

  assert.equal(firstTrainIndex, 0);
  assert.deepEqual(startupUcis, ['e2e4', 'd7d5']);
});

test('alignOpeningTreeWithBoardPosition re-roots learn drill after free play e4 d5', () => {
  const afterD5FenKey = normalizeOpeningFen('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  const tree = {
    id: 'tree-scandi',
    name: 'e4 d5',
    library: 'e4',
    rootFenKey: 'after-e4',
    rootPly: 1,
    rootSan: ['e4'],
    rootUci: ['e2e4'],
    sourceCount: 2,
    targetDepth: 12,
    nodeCount: 3,
    dueCount: 0,
    masteryScore: 0,
    updatedAt: null,
    nodes: [
      {
        id: 'after-e4',
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        fenKey: 'after-e4',
        ply: 1,
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
        id: 'after-d5',
        fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        fenKey: afterD5FenKey,
        ply: 2,
        sideToMove: 'white',
        bestUci: 'e4d5',
        bestSan: 'exd5',
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
        id: 'edge-d5',
        fromNodeId: 'after-e4',
        toNodeId: 'after-d5',
        uci: 'd7d5',
        san: 'd5',
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
  const boardHistory = [
    { san: 'e4', uci: 'e2e4' },
    { san: 'd5', uci: 'd7d5' },
  ];
  const aligned = alignOpeningTreeWithBoardPosition(tree, boardHistory, 2);

  assert.ok(aligned);
  assert.deepEqual(aligned.rootSan, ['e4', 'd5']);
  assert.deepEqual(aligned.rootUci, ['e2e4', 'd7d5']);
  assert.equal(aligned.rootPly, 2);

  const { path } = pickLearnBranch(aligned, 'white', []);
  const firstTrainIndex = path.findIndex((step) => step.isTrainTurn);

  assert.equal(firstTrainIndex, 0);
  assert.equal(path[0]?.bestUci, 'e4d5');
  assert.deepEqual(buildLearnDrillReplayUcis(path), []);
});
