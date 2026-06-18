import assert from 'node:assert/strict';
import test from 'node:test';

import { isLinesBoardPlayAllowed } from './lines-board-guards.ts';

test('isLinesBoardPlayAllowed blocks idle browse on a loaded opening tree', () => {
  assert.equal(
    isLinesBoardPlayAllowed({
      mode: 'lines',
      hasOpeningTree: true,
      linesStudyMode: 'idle',
      linesLearnBranchComplete: false,
      deckPlaybackBusy: false,
    }),
    false,
  );
});

test('isLinesBoardPlayAllowed allows learn and review sessions', () => {
  assert.equal(
    isLinesBoardPlayAllowed({
      mode: 'lines',
      hasOpeningTree: true,
      linesStudyMode: 'learn',
      linesLearnBranchComplete: false,
      deckPlaybackBusy: false,
    }),
    true,
  );
  assert.equal(
    isLinesBoardPlayAllowed({
      mode: 'lines',
      hasOpeningTree: true,
      linesStudyMode: 'review',
      linesLearnBranchComplete: false,
      deckPlaybackBusy: false,
    }),
    true,
  );
});

test('isLinesBoardPlayAllowed blocks moves after learn branch complete', () => {
  assert.equal(
    isLinesBoardPlayAllowed({
      mode: 'lines',
      hasOpeningTree: true,
      linesStudyMode: 'idle',
      linesLearnBranchComplete: true,
      deckPlaybackBusy: false,
    }),
    false,
  );
});

test('isLinesBoardPlayAllowed ignores non-lines modes', () => {
  assert.equal(
    isLinesBoardPlayAllowed({
      mode: 'train',
      hasOpeningTree: true,
      linesStudyMode: 'idle',
      linesLearnBranchComplete: false,
      deckPlaybackBusy: false,
    }),
    true,
  );
});
