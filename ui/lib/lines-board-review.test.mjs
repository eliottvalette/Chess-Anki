import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLinesBoardReviewCategory } from './lines-board-review.ts';

test('learn feedback overrides a misleading best classification with miss', () => {
  assert.equal(
    resolveLinesBoardReviewCategory({
      baseCategory: 'best',
      feedback: { pending: false, correct: false, playedUci: 'd4c5' },
      lastMoveUci: 'd4c5',
      studyMode: 'learn',
    }),
    'miss',
  );
});

test('learn feedback only applies to the move it graded', () => {
  assert.equal(
    resolveLinesBoardReviewCategory({
      baseCategory: 'book',
      feedback: { pending: false, correct: false, playedUci: 'd4c5' },
      lastMoveUci: 'e7e6',
      studyMode: 'learn',
    }),
    'book',
  );
});

test('review mode keeps the normal tree classification', () => {
  assert.equal(
    resolveLinesBoardReviewCategory({
      baseCategory: 'best',
      feedback: { pending: false, correct: false, playedUci: 'd4c5' },
      lastMoveUci: 'd4c5',
      studyMode: 'review',
    }),
    'best',
  );
});
