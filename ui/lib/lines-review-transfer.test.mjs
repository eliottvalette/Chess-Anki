import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLinesReviewTransfer } from './lines-review-transfer.ts';

const moves = [
  {
    captured: null,
    color: 'w',
    flags: 'b',
    from: 'e2',
    lan: 'e2e4',
    piece: 'p',
    promotion: null,
    san: 'e4',
    to: 'e4',
    uci: 'e2e4',
  },
  {
    captured: null,
    color: 'b',
    flags: 'b',
    from: 'c7',
    lan: 'c7c5',
    piece: 'p',
    promotion: null,
    san: 'c5',
    to: 'c5',
    uci: 'c7c5',
  },
];

test('buildLinesReviewTransfer preserves the displayed path and opens it at the current position', () => {
  const transfer = buildLinesReviewTransfer({
    initialFen: null,
    moves,
    trainSide: 'white',
    treeName: 'Sicilian Defense',
    username: 'losvalettos',
  });

  assert.deepEqual(transfer.moveHistory, moves);
  assert.notEqual(transfer.moveHistory, moves);
  assert.equal(transfer.historyIndex, 2);
  assert.equal(transfer.initialFen, null);
  assert.equal(transfer.orientation, 'white');
  assert.equal(transfer.metadata.whitePlayer, 'losvalettos');
  assert.equal(transfer.metadata.blackPlayer, 'Black');
  assert.equal(transfer.metadata.opening, 'Sicilian Defense');
});

test('buildLinesReviewTransfer assigns the Chess.com identity to the selected black side', () => {
  const transfer = buildLinesReviewTransfer({
    initialFen: 'custom-fen',
    moves,
    trainSide: 'black',
    treeName: '',
    username: 'LosValettos',
  });

  assert.equal(transfer.orientation, 'black');
  assert.equal(transfer.metadata.whitePlayer, 'White');
  assert.equal(transfer.metadata.blackPlayer, 'LosValettos');
  assert.equal(transfer.metadata.opening, 'Lines position');
  assert.equal(transfer.fileName, 'Lines position');
});
