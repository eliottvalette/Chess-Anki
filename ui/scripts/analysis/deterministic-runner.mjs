import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import {
  buildDeterministicAnalyzeRequest,
  DETERMINISTIC_ANALYSIS_PROFILE,
  getDeterministicAnalysisCacheKey,
} from '../../lib/analysis-profile.ts';
import {
  buildTimelineSequencePositions,
  classifyTimelineMoves,
  extractMetadataFromGame,
  restoreGameFromHistory,
  toStoredMove,
} from '../../lib/chess-analysis-client.ts';

export const DEFAULT_ANALYZE_BASE_URL = 'http://localhost:3000';
export const DEFAULT_BATCH_SIZE = 4;
const openingBookKeys = new Set(
  JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../lib/opening-book-keys.json'), 'utf8')),
);

export function getDeterministicProfile() {
  return {
    version: DETERMINISTIC_ANALYSIS_PROFILE.version,
    depth: DETERMINISTIC_ANALYSIS_PROFILE.depth,
    multipv: DETERMINISTIC_ANALYSIS_PROFILE.multipv,
    movetimeMs: DETERMINISTIC_ANALYSIS_PROFILE.movetimeMs,
  };
}

export function buildAnalysisPayload(request, profile = getDeterministicProfile()) {
  const payload = buildDeterministicAnalyzeRequest(request, {
    depth: profile.depth,
    multipv: request.multipv ?? profile.multipv,
  });

  if (profile.movetimeMs != null) {
    payload.movetimeMs = profile.movetimeMs;
  } else {
    delete payload.movetimeMs;
  }

  return payload;
}

export async function assertAnalyzeApi(baseUrl, profile = getDeterministicProfile()) {
  const analysis = await analyzePosition(baseUrl, {
    fen: new Chess().fen(),
    depth: Math.min(6, profile.depth),
    multipv: 1,
  });

  if (!analysis?.bestMove) {
    throw new Error(`Analyze API is not ready at ${baseUrl}.`);
  }
}

export async function analyzeTimelineForPgn({
  pgn,
  baseUrl,
  profile = getDeterministicProfile(),
  cache = new Map(),
  batchSize = DEFAULT_BATCH_SIZE,
}) {
  const game = new Chess();
  game.loadPgn(pgn);
  const initialFen = game.header().FEN ?? null;
  const moves = game.history({ verbose: true }).map(toStoredMove);
  const positions = buildTimelineSequencePositions(moves, initialFen);
  const analyses = await analyzePositionsCached(baseUrl, {
    positions,
    profile,
    cache,
    batchSize,
  });
  const preMoveAnalyses = analyses.slice(0, -1);
  const postMoveAnalyses = analyses.slice(1);
  const openingBookFlags = resolveOpeningBookFlagsLocal(moves, initialFen);
  const metadata = extractMetadataFromGame(game);
  const reviews = classifyTimelineMoves(
    moves,
    preMoveAnalyses,
    postMoveAnalyses,
    initialFen,
    metadata,
    openingBookFlags,
  );

  return {
    initialFen,
    moves,
    positions,
    analyses,
    preMoveAnalyses,
    postMoveAnalyses,
    timelineAnalyses: postMoveAnalyses,
    reviews,
    metadata,
  };
}

export async function analyzePositionsCached(
  baseUrl,
  { positions, profile = getDeterministicProfile(), cache = new Map(), batchSize = DEFAULT_BATCH_SIZE },
) {
  const analyses = new Array(positions.length);
  const missing = [];

  for (const [index, position] of positions.entries()) {
    const payload = buildAnalysisPayload(position, profile);
    const cacheKey = getDeterministicAnalysisCacheKey(payload);
    const cached = cache.get(cacheKey);

    if (cached) {
      analyses[index] = cached;
      continue;
    }

    missing.push({ index, payload, cacheKey });
  }

  for (let start = 0; start < missing.length; start += batchSize) {
    const batch = missing.slice(start, start + batchSize);
    const fetched = await analyzeGame(baseUrl, {
      positions: batch.map((item) => item.payload),
      depth: profile.depth,
      ...(profile.movetimeMs != null ? { movetimeMs: profile.movetimeMs } : {}),
    });

    fetched.forEach((analysis, offset) => {
      const item = batch[offset];
      cache.set(item.cacheKey, analysis);
      analyses[item.index] = analysis;
    });
  }

  return analyses;
}

export async function analyzeSingleCached(
  baseUrl,
  { position, profile = getDeterministicProfile(), cache = new Map() },
) {
  const analyses = await analyzePositionsCached(baseUrl, {
    positions: [position],
    profile,
    cache,
    batchSize: 1,
  });

  return analyses[0] ?? null;
}

export function buildCacheAnalysisPayload({ preMoveAnalyses, timelineAnalyses }) {
  return {
    quality: 'refined',
    version: DETERMINISTIC_ANALYSIS_PROFILE.version,
    preMoveAnalyses,
    timelineAnalyses,
    updatedAt: new Date().toISOString(),
  };
}

export function buildPgnHash(pgn) {
  let hash = 0;

  for (let index = 0; index < pgn.length; index += 1) {
    hash = (Math.imul(31, hash) + pgn.charCodeAt(index)) | 0;
  }

  return String(hash >>> 0);
}

export function buildStoredMovesFromSans(setupMoves, initialFen = null) {
  const game = initialFen ? new Chess(initialFen) : new Chess();

  return setupMoves.map((san) => {
    const move = game.move(san);

    if (!move) {
      throw new Error(`Invalid SAN in setup moves: ${san}`);
    }

    return toStoredMove(move);
  });
}

export function restoreFenFromMoves(moves, initialFen = null, upto = moves.length) {
  return restoreGameFromHistory(moves, initialFen, upto).fen();
}

async function analyzePosition(baseUrl, payload) {
  const response = await postJson(`${baseUrl}/api/analyze-position`, payload);
  return response;
}

async function analyzeGame(baseUrl, payload) {
  const response = await postJson(`${baseUrl}/api/analyze-game`, payload);
  return Array.isArray(response.analyses) ? response.analyses : [];
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}`);
  }
}

function resolveOpeningBookFlagsLocal(moves, initialFen) {
  const chess = initialFen ? new Chess(initialFen) : new Chess();

  return moves.map((move) => {
    const fenBefore = chess.fen().trim().split(' ').slice(0, 4).join(' ');
    const inBook = openingBookKeys.has(`${fenBefore}|${move.uci}`);
    chess.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    });
    return inBook;
  });
}
