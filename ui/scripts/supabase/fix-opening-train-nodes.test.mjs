import assert from 'node:assert/strict';
import test from 'node:test';

import { countTrainNodeGaps } from './fix-opening-train-nodes.mjs';

test('countTrainNodeGaps separates repertoire-backfill gaps from engine-only gaps', () => {
  const graph = {
    trainSide: 'black',
    nodes: [
      { id: 'train-with-edge', sideToMove: 'black', bestUci: null },
      { id: 'train-no-edge', sideToMove: 'black', bestUci: null },
      { id: 'opp', sideToMove: 'white', bestUci: null },
      { id: 'ok', sideToMove: 'black', bestUci: 'e7e5' },
    ],
    edges: [
      {
        id: 'edge-1',
        fromNodeId: 'train-with-edge',
        toNodeId: 'child',
        uci: 'e7e5',
        san: 'e5',
        recentCount: 1,
        cardCount: 0,
        mastersGames: 0,
        isEngineBest: false,
      },
    ],
  };

  const gaps = countTrainNodeGaps(graph);

  assert.equal(gaps.missingBestUci, 2);
  assert.equal(gaps.missingBestUciWithRepertoireOut, 1);
  assert.equal(gaps.engineCandidates, 1);
});
