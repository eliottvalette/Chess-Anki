import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpeningTrees,
  chooseWeightedOpponentEdge,
  normalizeOpeningFen,
  parseSanMoves,
  resolveOpeningLibrary,
} from './opening-tree.ts';

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
    { ownerProfileId: 'profile-1', targetDepth: 8 },
  );

  assert.equal(trees.length, 1);
  assert.equal(trees[0].rootSan.join(' '), 'e4 e5 Nf3 Nc6');
  assert.equal(trees[0].sourceCount, 2);
});

test('resolveOpeningLibrary separates black repertoires by first white move', () => {
  const e4 = parseSanMoves(['e4', 'c5', 'Nf3', 'd6']);
  const d4 = parseSanMoves(['d4', 'Nf6', 'c4', 'g6']);

  assert.equal(resolveOpeningLibrary('black', e4), 'black_vs_e4');
  assert.equal(resolveOpeningLibrary('black', d4), 'black_vs_d4');
  assert.equal(resolveOpeningLibrary('white', e4), 'white');
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
