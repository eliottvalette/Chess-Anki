import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';

import { dedupeTrainingCards, isMoveInOpeningBook, qualifiesAsLineRootMistake } from './deck-mistake-filter.mjs';

test('qualifiesAsLineRootMistake accepts the first non-book suboptimal move', () => {
  assert.equal(
    qualifiesAsLineRootMistake({
      scoreSwingCp: 18,
      thresholdCp: 90,
      acceptableLossCp: 35,
      inBook: false,
      playedUci: 'g1f3',
      bestMoveUci: 'b1c3',
    }),
    true,
  );
});

test('qualifiesAsLineRootMistake rejects the engine best move', () => {
  assert.equal(
    qualifiesAsLineRootMistake({
      scoreSwingCp: 0,
      thresholdCp: 90,
      acceptableLossCp: 35,
      inBook: true,
      playedUci: 'e2e4',
      bestMoveUci: 'e2e4',
    }),
    false,
  );
});

test('qualifiesAsLineRootMistake accepts a later big blunder threshold', () => {
  assert.equal(
    qualifiesAsLineRootMistake({
      scoreSwingCp: 120,
      thresholdCp: 90,
      acceptableLossCp: 35,
      inBook: true,
      playedUci: 'd1h5',
      bestMoveUci: 'd1e2',
    }),
    true,
  );
});

test('dedupeTrainingCards keeps the strongest duplicate position', () => {
  const cards = dedupeTrainingCards([
    {
      side: 'white',
      fen: 'same-fen',
      answer_uci: 'e2e4',
      setup_moves: ['d4', 'd5'],
      score_swing_cp: 50,
      id: 'game-a',
    },
    {
      side: 'white',
      fen: 'same-fen',
      answer_uci: 'e2e4',
      setup_moves: ['d4', 'd5'],
      score_swing_cp: 120,
      id: 'game-b',
    },
  ]);

  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.score_swing_cp, 120);
  assert.match(cards[0]?.id ?? '', /^recent-fix-[a-f0-9]{12}$/);
});

test('isMoveInOpeningBook matches e5 after e4 even with en passant in fen', () => {
  const chess = new Chess();
  chess.move('e4');

  assert.equal(isMoveInOpeningBook(chess.fen(), 'e7e5'), true);
});
