import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReviewAnalyzeRequest,
  DETERMINISTIC_ANALYSIS_PROFILE,
  getDeterministicAnalysisCacheKey,
  REVIEW_ANALYSIS_PROFILE,
} from '../../lib/analysis-profile.ts';
import { buildAnalysisPayload, getDeterministicProfile } from './deterministic-runner.mjs';

test('deterministic profile defaults to fixed depth without movetime', () => {
  const profile = getDeterministicProfile({});
  const payload = buildAnalysisPayload({ fen: 'start-fen' }, profile);

  assert.equal(profile.version, DETERMINISTIC_ANALYSIS_PROFILE.version);
  assert.equal(profile.depth, 17);
  assert.equal(profile.multipv, 3);
  assert.equal(profile.movetimeMs, null);
  assert.equal(payload.depth, 17);
  assert.equal(payload.multipv, 3);
  assert.equal('movetimeMs' in payload, false);
});

test('review profile uses the benchmarked depth 14 multipv 3 profile', () => {
  const payload = buildReviewAnalyzeRequest({ fen: 'start-fen', depth: 17, multipv: 1, movetimeMs: 800 });

  assert.equal(REVIEW_ANALYSIS_PROFILE.depth, 14);
  assert.equal(REVIEW_ANALYSIS_PROFILE.multipv, 3);
  assert.equal(REVIEW_ANALYSIS_PROFILE.movetimeMs, null);
  assert.equal(payload.depth, 14);
  assert.equal(payload.multipv, 3);
  assert.equal('movetimeMs' in payload, false);
});

test('deterministic cache key includes version, depth, multipv and position', () => {
  const base = getDeterministicAnalysisCacheKey({
    fen: 'fen-a',
    moves: ['e2e4'],
    depth: 20,
    multipv: 3,
  });
  const differentDepth = getDeterministicAnalysisCacheKey({
    fen: 'fen-a',
    moves: ['e2e4'],
    depth: 18,
    multipv: 3,
  });
  const differentMultiPv = getDeterministicAnalysisCacheKey({
    fen: 'fen-a',
    moves: ['e2e4'],
    depth: 20,
    multipv: 1,
  });

  assert.match(base, /analysis:v4/);
  assert.notEqual(base, differentDepth);
  assert.notEqual(base, differentMultiPv);
});
