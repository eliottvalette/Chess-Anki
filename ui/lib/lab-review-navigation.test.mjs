import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { toStoredMove } from './chess-analysis-client.ts';
import {
  planReviewHistoryBack,
  planReviewHistoryForward,
  resolveReviewGameAtHistoryIndex,
} from './lab-review-navigation.ts';

function buildMainLine(moveSans) {
  const chess = new Chess();
  const moves = [];

  for (const san of moveSans) {
    const applied = chess.move(san);
    moves.push(toStoredMove(applied));
  }

  return moves;
}

test('planReviewHistoryBack undoes variation moves before main line', () => {
  const step = planReviewHistoryBack(2, {
    variationBaseIndex: 2,
    variationMoves: buildMainLine(['Nf3']),
    variationIndex: 1,
  });

  assert.deepEqual(step, { kind: 'variation', variationIndex: 0 });
});

test('planReviewHistoryBack is noop at start position', () => {
  const step = planReviewHistoryBack(0, {
    variationBaseIndex: 0,
    variationMoves: buildMainLine(['e4']),
    variationIndex: 0,
  });

  assert.equal(step.kind, 'noop');
});

test('planReviewHistoryBack keeps variation stack when leaving branch on main line', () => {
  const step = planReviewHistoryBack(3, {
    variationBaseIndex: 3,
    variationMoves: [{ uci: 'b1c3', san: 'Nc3', from: 'b1', to: 'c3', color: 'w' }],
    variationIndex: 0,
  });

  assert.deepEqual(step, { kind: 'main', historyIndex: 2 });
});

test('planReviewHistoryForward redoes undone variation moves at branch', () => {
  const variationMoves = buildMainLine(['d4']);
  const step = planReviewHistoryForward(buildMainLine(['e4', 'e5']), 0, {
    variationBaseIndex: 0,
    variationMoves,
    variationIndex: 0,
  });

  assert.deepEqual(step, { kind: 'variation', variationIndex: 1 });
});

test('planReviewHistoryForward is noop at end of main line', () => {
  const mainLine = buildMainLine(['e4', 'e5']);
  const step = planReviewHistoryForward(mainLine, mainLine.length, {
    variationBaseIndex: null,
    variationMoves: [],
    variationIndex: 0,
  });

  assert.equal(step.kind, 'noop');
});

test('planReviewHistoryForward advances main line after variation redo is exhausted', () => {
  const mainLine = buildMainLine(['e4', 'e5', 'Nf3']);
  const step = planReviewHistoryForward(mainLine, 2, {
    variationBaseIndex: 2,
    variationMoves: buildMainLine(['Nc3']),
    variationIndex: 1,
  });

  assert.deepEqual(step, { kind: 'main', historyIndex: 3 });
});

test('resolveReviewGameAtHistoryIndex restores partial variation on branch', () => {
  const mainLine = buildMainLine(['e4', 'e5']);
  const variationMoves = buildMainLine(['d4']);
  const expected = new Chess();
  expected.move('e4');
  expected.move('e5');
  expected.move('d4');
  const game = resolveReviewGameAtHistoryIndex(mainLine, null, mainLine.length, {
    variationBaseIndex: mainLine.length,
    variationMoves,
    variationIndex: 1,
  });

  assert.equal(game.fen(), expected.fen());
});
