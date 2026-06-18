import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPositionAnalysisCurrent,
  LINES_BOARD_NEUTRAL_WHITE_ADVANTAGE,
  resolveLinesBoardEvalCp,
  resolveLinesBoardScoreLabel,
  resolveLinesBoardWhiteAdvantage,
} from './lines-board-eval.ts';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function buildItalianEvalTree() {
  return {
    rootPly: 4,
    rootSan: ['e4', 'e5', 'Nf3', 'Nc6'],
    rootFenKey: 'after-nc6',
    rootUci: ['e2e4', 'e7e5', 'g1f3', 'b8c6'],
    nodes: [
      {
        id: 'root',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
        fenKey: 'after-nc6',
        ply: 4,
        sideToMove: 'white',
        evalCp: 25,
      },
      {
        id: 'after-d4',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq - 0 3',
        fenKey: 'after-d4',
        ply: 5,
        sideToMove: 'black',
        evalCp: 18,
      },
      {
        id: 'stale-node',
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        fenKey: 'start',
        ply: 0,
        sideToMove: 'white',
        evalCp: 99,
      },
    ],
    edges: [
      {
        id: 'edge-d4',
        fromNodeId: 'root',
        toNodeId: 'after-d4',
        uci: 'd2d4',
      },
    ],
  };
}

test('resolveLinesBoardEvalCp reads eval from repertoire history', () => {
  const tree = buildItalianEvalTree();
  const moveHistory = [{ uci: 'e2e4' }, { uci: 'e7e5' }, { uci: 'g1f3' }, { uci: 'b8c6' }, { uci: 'd2d4' }];

  assert.equal(resolveLinesBoardEvalCp(tree, moveHistory, 5, tree.nodes[1].fen, 'root'), 18);
});

test('resolveLinesBoardEvalCp ignores active node when board fen does not match', () => {
  const tree = buildItalianEvalTree();
  const moveHistory = [{ uci: 'e2e4' }];

  assert.equal(resolveLinesBoardEvalCp(tree, moveHistory, 1, tree.nodes[1].fen, 'stale-node'), null);
});

test('resolveLinesBoardEvalCp uses active node only when fen matches current board', () => {
  const tree = buildItalianEvalTree();

  assert.equal(resolveLinesBoardEvalCp(tree, [], 0, START_FEN, 'stale-node'), 99);
});

test('resolveLinesBoardEvalCp returns null when node eval is missing', () => {
  const tree = {
    ...buildItalianEvalTree(),
    nodes: [
      {
        id: 'root',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
        fenKey: 'after-nc6',
        ply: 4,
        sideToMove: 'white',
        evalCp: null,
      },
    ],
    edges: [],
  };

  assert.equal(
    resolveLinesBoardEvalCp(
      tree,
      [{ uci: 'e2e4' }, { uci: 'e7e5' }, { uci: 'g1f3' }, { uci: 'b8c6' }],
      4,
      tree.nodes[0].fen,
      'root',
    ),
    null,
  );
});

test('resolveLinesBoardWhiteAdvantage prefers tree eval over stale engine analysis', () => {
  const staleEngine = {
    depth: 18,
    whitePerspective: { type: 'cp', value: 300 },
    lines: [],
  };

  const meter = resolveLinesBoardWhiteAdvantage({
    linesBoardEvalCp: 25,
    currentEngineAnalysis: staleEngine,
    engineAnalysisIsCurrent: false,
  });

  assert.notEqual(meter, 50);
  assert.ok(meter > 50 && meter < 70);
});

test('resolveLinesBoardWhiteAdvantage resets to neutral when eval is unavailable', () => {
  assert.equal(
    resolveLinesBoardWhiteAdvantage({
      linesBoardEvalCp: null,
      currentEngineAnalysis: {
        depth: 18,
        whitePerspective: { type: 'cp', value: 300 },
        lines: [],
      },
      engineAnalysisIsCurrent: false,
    }),
    LINES_BOARD_NEUTRAL_WHITE_ADVANTAGE,
  );
});

test('resolveLinesBoardScoreLabel ignores stale engine and returns neutral score', () => {
  assert.equal(
    resolveLinesBoardScoreLabel({
      linesBoardEvalCp: null,
      orientation: 'white',
      currentEngineAnalysis: {
        depth: 18,
        whitePerspective: { type: 'cp', value: 300 },
        lines: [],
      },
      engineAnalysisIsCurrent: false,
    }),
    '0.00',
  );
});

test('isPositionAnalysisCurrent only accepts the cached analysis instance for this position', () => {
  const current = { depth: 12, whitePerspective: { type: 'cp', value: 20 }, lines: [] };
  const stale = { depth: 12, whitePerspective: { type: 'cp', value: 80 }, lines: [] };

  assert.equal(isPositionAnalysisCurrent(current, current), true);
  assert.equal(isPositionAnalysisCurrent(stale, current), false);
  assert.equal(isPositionAnalysisCurrent(null, current), false);
});
