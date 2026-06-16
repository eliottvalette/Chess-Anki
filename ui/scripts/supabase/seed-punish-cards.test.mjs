import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzePosition,
  assertAnalyzeApi,
  buildTrainingCandidates,
  moveFromFen,
  scoreToCpForSide,
} from './seed-punish-cards.mjs';

test('buildTrainingCandidates includes opening contexts for both white and black repertoires', () => {
  const candidates = buildTrainingCandidates();

  assert.ok(candidates.length > 0);
  assert.deepEqual(
    candidates.find((candidate) => candidate.id === 'italian-main-candidate-2'),
    {
      id: 'italian-main-candidate-2',
      lineId: 'italian-main',
      lineName: 'Italian Game',
      eco: 'C50',
      side: 'white',
      ply: 2,
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      context: 'e4',
    },
  );
  assert.equal(
    candidates.find((candidate) => candidate.id === 'sicilian-najdorf-candidate-1')?.context,
    'Starting position',
  );
});

test('scoreToCpForSide normalizes centipawn and mate scores from the trainee perspective', () => {
  assert.equal(scoreToCpForSide({ type: 'cp', value: 42 }, 'white'), 42);
  assert.equal(scoreToCpForSide({ type: 'cp', value: 42 }, 'black'), -42);
  assert.equal(scoreToCpForSide({ type: 'mate', value: 3 }, 'white'), 100000);
  assert.equal(scoreToCpForSide({ type: 'mate', value: -2 }, 'black'), 100000);
  assert.equal(scoreToCpForSide(null, 'white'), null);
});

test('moveFromFen converts UCI moves into SAN and returns null for illegal moves', () => {
  const move = moveFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4');

  assert.equal(move?.san, 'e4');
  assert.equal(move?.afterFen, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  assert.equal(moveFromFen('8/8/8/8/8/8/8/8 w - - 0 1', 'e2e4'), null);
});

test('assertAnalyzeApi surfaces a precise local-server error when fetch itself fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    await assert.rejects(
      assertAnalyzeApi('http://localhost:3000'),
      /Analyze API is unreachable at http:\/\/localhost:3000\. Start the local app or set ANALYZE_BASE_URL\. fetch failed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('analyzePosition surfaces HTTP bodies from the analysis endpoint', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('bad request', {
      status: 400,
    });

  try {
    await assert.rejects(analyzePosition('http://localhost:3000', { fen: 'bad' }), /HTTP 400 bad request/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
