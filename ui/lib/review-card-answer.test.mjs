import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePostMoveVerifiedReviewCardAnswer } from './review-card-answer.ts';

function analysis({ bestMove = null, lines = [], whiteCp = 0 } = {}) {
  return {
    bestMove,
    ponder: null,
    depth: 17,
    seldepth: null,
    timeMs: null,
    nodes: null,
    nps: null,
    multipv: lines.length || 1,
    pv: bestMove ? [bestMove] : [],
    raw: [],
    score: null,
    whitePerspective: { type: 'cp', value: whiteCp },
    wdl: null,
    whitePerspectiveWdl: null,
    lines: lines.map((line, index) => ({
      multipv: index + 1,
      bestMove: line.bestMove,
      depth: 17,
      pv: [line.bestMove],
      score: null,
      whitePerspective: { type: 'cp', value: line.whiteCp },
    })),
  };
}

test('manual review card answer is selected from post-move eval of the top three root candidates', async () => {
  const rootAnalysis = analysis({
    bestMove: 'd1d2',
    lines: [
      { bestMove: 'd1d2', whiteCp: 175 },
      { bestMove: 'b1c3', whiteCp: 171 },
      { bestMove: 'c1d2', whiteCp: 148 },
    ],
  });
  const postMoveScores = new Map([
    ['r1b1kbnr/pp1p1ppp/2n5/qN2p3/4P3/8/PPPQ1PPP/RNB1KB1R b KQkq - 3 6', 149],
    ['r1b1kbnr/pp1p1ppp/2n5/qN2p3/4P3/2N5/PPP2PPP/R1BQKB1R b KQkq - 3 6', 157],
    ['r1b1kbnr/pp1p1ppp/2n5/qN2p3/4P3/8/PPPB1PPP/RN1QKB1R b KQkq - 3 6', 120],
  ]);

  const result = await resolvePostMoveVerifiedReviewCardAnswer({
    fen: 'r1b1kbnr/pp1p1ppp/2n5/qN2p3/4P3/8/PPP2PPP/RNBQKB1R w KQkq - 2 6',
    side: 'white',
    rootAnalysis,
    analyzePosition: async (request) => analysis({ whiteCp: postMoveScores.get(request.fen) ?? -999 }),
  });

  assert.equal(result.answerUci, 'b1c3');
  assert.equal(result.answerSan, 'N1c3');
  assert.equal(result.referenceEvalCp, 157);
});

test('manual review card answer uses the deterministic profile for post-move evals', async () => {
  const rootAnalysis = analysis({
    bestMove: 'c1g5',
    lines: [
      { bestMove: 'c1g5', whiteCp: 152 },
      { bestMove: 'b1c3', whiteCp: 143 },
    ],
  });
  const requests = [];
  const postMoveScores = new Map([
    ['rnb1kbnr/ppp2ppp/3p1q2/4p1B1/3PP3/5N2/PPP2PPP/RN1QKB1R b KQkq - 2 4', 157],
    ['rnb1kbnr/ppp2ppp/3p1q2/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R b KQkq - 2 4', 160],
  ]);

  const result = await resolvePostMoveVerifiedReviewCardAnswer({
    fen: 'rnb1kbnr/ppp2ppp/3p1q2/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R w KQkq - 1 4',
    side: 'white',
    rootAnalysis,
    analyzePosition: async (request) => {
      requests.push(request);
      return analysis({ whiteCp: postMoveScores.get(request.fen) ?? -999 });
    },
  });

  assert.equal(result.answerUci, 'b1c3');
  assert.equal(result.answerSan, 'Nc3');
  assert.equal(result.referenceEvalCp, 160);
  assert.deepEqual([...new Set(requests.map((request) => request.multipv))], [3]);
  assert.deepEqual([...new Set(requests.map((request) => request.depth))], [17]);
});

test('manual review card answer minimizes white eval for black to move', async () => {
  const rootAnalysis = analysis({
    bestMove: 'e7e5',
    lines: [
      { bestMove: 'e7e5', whiteCp: -20 },
      { bestMove: 'c7c5', whiteCp: -10 },
      { bestMove: 'e7e6', whiteCp: 0 },
    ],
  });
  const postMoveScores = new Map([
    ['rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', -30],
    ['rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', -50],
    ['rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 10],
  ]);

  const result = await resolvePostMoveVerifiedReviewCardAnswer({
    fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    side: 'black',
    rootAnalysis,
    analyzePosition: async (request) => analysis({ whiteCp: postMoveScores.get(request.fen) ?? 999 }),
  });

  assert.equal(result.answerUci, 'c7c5');
  assert.equal(result.answerSan, 'c5');
  assert.equal(result.referenceEvalCp, 50);
});
