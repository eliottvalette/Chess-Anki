import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGameReview,
  classifyReviewCategory,
  classifyTimelineMoves,
  getCpLoss,
  getMateForColor,
  getScoreCpForColor,
} from './chess-analysis-client.ts';

test('classifyReviewCategory marks Scotch d4 as book from bundled opening data', () => {
  assert.equal(
    classifyReviewCategory({
      openingBookMove: true,
      san: 'd4',
      bestMovePlayed: true,
      sacrifice: false,
      afterWinning: false,
      beforeCompletelyWinning: false,
      decisiveMove: false,
      expectedPointsLost: 0,
      beforeExpected: 0.5,
      afterExpected: 0.5,
      cpLossCp: 10,
      beforeMate: null,
      afterMate: null,
      secondBestGapCp: 20,
      ratingFlex: 0.02,
    }),
    'book',
  );
});

test('classifyReviewCategory marks opening book moves from explorer lookup', () => {
  assert.equal(
    classifyReviewCategory({
      openingBookMove: true,
      san: 'Bb5',
      bestMovePlayed: true,
      sacrifice: false,
      afterWinning: false,
      beforeCompletelyWinning: false,
      decisiveMove: false,
      expectedPointsLost: 0,
      beforeExpected: 0.5,
      afterExpected: 0.5,
      cpLossCp: 10,
      beforeMate: null,
      afterMate: null,
      secondBestGapCp: 20,
      ratingFlex: 0.02,
    }),
    'book',
  );
});

test('classifyReviewCategory does not let book status hide a significant engine loss', () => {
  assert.equal(
    classifyReviewCategory({
      openingBookMove: true,
      san: 'Nc6',
      bestMovePlayed: false,
      sacrifice: false,
      afterWinning: false,
      beforeCompletelyWinning: false,
      decisiveMove: false,
      expectedPointsLost: 0.184,
      beforeExpected: 0.47,
      afterExpected: 0.29,
      cpLossCp: 69,
      beforeMate: null,
      afterMate: null,
      secondBestGapCp: 21,
      ratingFlex: 0.02,
    }),
    'mistake',
  );
});

test('classifyReviewCategory does not infer book from early ply alone', () => {
  assert.equal(
    classifyReviewCategory({
      openingBookMove: false,
      san: 'd6',
      bestMovePlayed: true,
      sacrifice: false,
      afterWinning: false,
      beforeCompletelyWinning: false,
      decisiveMove: false,
      expectedPointsLost: 0,
      beforeExpected: 0.5,
      afterExpected: 0.49,
      cpLossCp: 20,
      beforeMate: null,
      afterMate: null,
      secondBestGapCp: 20,
      ratingFlex: 0.02,
    }),
    'best',
  );
});

test('cp helpers normalize centipawns and mate from the player perspective', () => {
  const before = { whitePerspective: { type: 'cp', value: 33 } };
  const after = { whitePerspective: { type: 'cp', value: -164 } };
  const mate = { whitePerspective: { type: 'mate', value: 12 } };

  assert.equal(getScoreCpForColor(before, 'w'), 33);
  assert.equal(getScoreCpForColor(before, 'b'), -33);
  assert.equal(getCpLoss(before, after, 'w'), 197);
  assert.equal(getMateForColor(mate, 'w'), 12);
  assert.equal(getMateForColor(mate, 'b'), -12);
});

test('cp loss ignores positive deltas that can be artifacts of score bounds', () => {
  assert.equal(
    getCpLoss(
      { whitePerspective: { type: 'cp', value: 100, bound: 'upperbound' } },
      { whitePerspective: { type: 'cp', value: 50, bound: 'exact' } },
      'w',
    ),
    null,
  );

  assert.equal(
    getCpLoss(
      { whitePerspective: { type: 'cp', value: 100, bound: 'exact' } },
      { whitePerspective: { type: 'cp', value: 50, bound: 'lowerbound' } },
      'w',
    ),
    null,
  );

  assert.equal(
    getCpLoss(
      { whitePerspective: { type: 'cp', value: 50, bound: 'upperbound' } },
      { whitePerspective: { type: 'cp', value: 100, bound: 'exact' } },
      'w',
    ),
    0,
  );

  assert.equal(
    getCpLoss(
      { whitePerspective: { type: 'cp', value: -100, bound: 'lowerbound' } },
      { whitePerspective: { type: 'cp', value: -50, bound: 'exact' } },
      'b',
    ),
    null,
  );
});

test('classifyTimelineMoves scores played moves against the pre-move MultiPV line when available', () => {
  const beforeScotchCaptureFen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R w KQkq - 2 4';
  const reviews = classifyTimelineMoves(
    [
      {
        from: 'd4',
        to: 'e5',
        san: 'dxe5',
        lan: 'd4e5',
        promotion: null,
        piece: 'p',
        color: 'w',
        flags: 'c',
        captured: 'p',
        uci: 'd4e5',
      },
    ],
    [
      makeAnalysis({
        scoreCp: 142,
        bestMove: 'd4b5',
        lines: [makeLine({ bestMove: 'd4b5', scoreCp: 142 }), makeLine({ bestMove: 'd4e5', scoreCp: 130 })],
      }),
    ],
    [makeAnalysis({ scoreCp: 94, bestMove: 'c6e5' })],
    beforeScotchCaptureFen,
    null,
    [false],
  );

  assert.equal(reviews[0]?.cpLossCp, 12);
  assert.equal(reviews[0]?.category, 'excellent');
});

test('classifyTimelineMoves gives bounded-loss moves a visible fallback category', () => {
  const reviews = classifyTimelineMoves(
    [
      {
        from: 'g1',
        to: 'f3',
        san: 'Nf3',
        lan: 'g1f3',
        promotion: null,
        piece: 'n',
        color: 'w',
        flags: 'n',
        captured: null,
        uci: 'g1f3',
      },
    ],
    [makeAnalysis({ scoreCp: 120, bestMove: 'd2d4' })],
    [
      {
        ...makeAnalysis({ scoreCp: -40, bestMove: 'd7d5' }),
        whitePerspective: { type: 'cp', value: -40, bound: 'lowerbound' },
      },
    ],
    null,
    null,
    [false],
  );

  assert.notEqual(reviews[0]?.category, null);
  assert.equal(reviews[0]?.colorHex != null, true);
});

test('classifyReviewCategory uses expected points loss for mistakes and blunders', () => {
  assert.equal(
    classifyReviewCategory({
      openingBookMove: false,
      san: 'Qg5',
      bestMovePlayed: false,
      sacrifice: false,
      afterWinning: false,
      beforeCompletelyWinning: false,
      decisiveMove: false,
      expectedPointsLost: 0.491,
      beforeExpected: 0.55,
      afterExpected: 0.06,
      cpLossCp: 197,
      beforeMate: null,
      afterMate: null,
      secondBestGapCp: 20,
      ratingFlex: 0.02,
    }),
    'blunder',
  );

  assert.equal(
    classifyReviewCategory({
      openingBookMove: false,
      san: 'Nxb1',
      bestMovePlayed: false,
      sacrifice: false,
      afterWinning: false,
      beforeCompletelyWinning: false,
      decisiveMove: false,
      expectedPointsLost: 0.343,
      beforeExpected: 0.2,
      afterExpected: 0.01,
      cpLossCp: 305,
      beforeMate: null,
      afterMate: null,
      secondBestGapCp: 40,
      ratingFlex: 0.02,
    }),
    'blunder',
  );

  assert.equal(
    classifyReviewCategory({
      openingBookMove: false,
      san: 'Qh4',
      bestMovePlayed: false,
      sacrifice: false,
      afterWinning: false,
      beforeCompletelyWinning: false,
      decisiveMove: false,
      expectedPointsLost: 0.5,
      beforeExpected: 0.2,
      afterExpected: 0,
      cpLossCp: 420,
      beforeMate: null,
      afterMate: null,
      secondBestGapCp: 40,
      ratingFlex: 0.02,
    }),
    'blunder',
  );
});

test('classifyReviewCategory falls back to cp loss when expected points are unavailable', () => {
  assert.equal(
    classifyReviewCategory({
      openingBookMove: false,
      san: 'Qg5',
      bestMovePlayed: false,
      sacrifice: false,
      afterWinning: false,
      beforeCompletelyWinning: false,
      decisiveMove: false,
      expectedPointsLost: null,
      beforeExpected: null,
      afterExpected: null,
      cpLossCp: 197,
      beforeMate: null,
      afterMate: null,
      secondBestGapCp: 20,
      ratingFlex: 0.02,
    }),
    'mistake',
  );
});

test('classifyReviewCategory reserves best for the engine top move', () => {
  assert.equal(
    classifyReviewCategory({
      openingBookMove: false,
      san: 'Bc4',
      bestMovePlayed: false,
      sacrifice: false,
      afterWinning: false,
      beforeCompletelyWinning: false,
      decisiveMove: false,
      expectedPointsLost: -0.02,
      beforeExpected: 0.54,
      afterExpected: 0.56,
      cpLossCp: 0,
      beforeMate: null,
      afterMate: null,
      secondBestGapCp: 20,
      ratingFlex: 0.02,
    }),
    'excellent',
  );

  assert.equal(
    classifyReviewCategory({
      openingBookMove: false,
      san: 'Bc4',
      bestMovePlayed: false,
      sacrifice: false,
      afterWinning: false,
      beforeCompletelyWinning: false,
      decisiveMove: false,
      expectedPointsLost: null,
      beforeExpected: null,
      afterExpected: null,
      cpLossCp: -35,
      beforeMate: null,
      afterMate: null,
      secondBestGapCp: 20,
      ratingFlex: 0.02,
    }),
    'excellent',
  );
});

test('classifyReviewCategory treats mate swings against the player as blunders', () => {
  assert.equal(
    classifyReviewCategory({
      openingBookMove: false,
      san: 'Rxc2',
      bestMovePlayed: true,
      sacrifice: false,
      afterWinning: false,
      beforeCompletelyWinning: false,
      decisiveMove: false,
      expectedPointsLost: 0,
      beforeExpected: 0.98,
      afterExpected: 0,
      cpLossCp: 99616,
      beforeMate: null,
      afterMate: -12,
      secondBestGapCp: 0,
      ratingFlex: 0.02,
    }),
    'blunder',
  );
});

test('buildGameReview keeps key moments sparse and includes only the last book move', () => {
  const reviews = [
    makeReview({ ply: 1, category: 'book' }),
    makeReview({ ply: 2, category: 'book' }),
    makeReview({ ply: 3, category: 'inaccuracy', isKeyMoment: false, cpLossCp: 130, expectedPointsLost: 0.13 }),
    makeReview({ ply: 4, category: 'mistake', isKeyMoment: false, cpLossCp: 150, expectedPointsLost: 0.11 }),
    makeReview({ ply: 5, category: 'great', isKeyMoment: true }),
    makeReview({ ply: 6, category: 'blunder', isKeyMoment: true, cpLossCp: 360, expectedPointsLost: 0.32 }),
    makeReview({ ply: 7, category: 'miss', isKeyMoment: true, cpLossCp: 230, expectedPointsLost: 0.16 }),
  ];

  const review = buildGameReview(reviews, null);

  assert.deepEqual(
    review.keyMoments.map((moment) => moment.ply),
    [2, 5, 6, 7],
  );
  assert.equal(review.opening.lastBookPly, 2);
});

function makeReview({
  ply,
  category,
  isKeyMoment = category === 'great' || category === 'brilliant',
  cpLossCp = 0,
  expectedPointsLost = 0,
}) {
  return {
    ply,
    color: ply % 2 === 1 ? 'w' : 'b',
    category,
    label: category,
    colorHex: null,
    pointStyle: 'circle',
    moveLabel: `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '...'}`,
    san: 'e4',
    playedMove: 'e2e4',
    bestMove: null,
    bestMoveSan: null,
    beforeExpected: 0.5,
    afterExpected: 0.5 - expectedPointsLost,
    expectedPointsLost,
    beforeCp: 0,
    afterCp: -cpLossCp,
    cpLossCp,
    beforeMate: null,
    afterMate: null,
    moveAccuracy: null,
    isKeyMoment,
    coachText: '',
    fenBefore: 'start',
    fenAfter: 'after',
  };
}

function makeAnalysis({ scoreCp, bestMove, lines = [] }) {
  return {
    bestMove,
    ponder: null,
    depth: 12,
    seldepth: null,
    timeMs: null,
    nodes: null,
    nps: null,
    multipv: Math.max(1, lines.length),
    pv: bestMove ? [bestMove] : [],
    raw: [],
    score: scoreCp == null ? null : { type: 'cp', value: scoreCp, bound: 'exact' },
    whitePerspective: scoreCp == null ? null : { type: 'cp', value: scoreCp, bound: 'exact' },
    wdl: null,
    whitePerspectiveWdl: null,
    lines,
  };
}

function makeLine({ bestMove, scoreCp }) {
  return {
    multipv: 1,
    bestMove,
    depth: 12,
    pv: bestMove ? [bestMove] : [],
    score: { type: 'cp', value: scoreCp, bound: 'exact' },
    whitePerspective: { type: 'cp', value: scoreCp, bound: 'exact' },
  };
}
