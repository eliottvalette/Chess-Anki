import { Chess } from 'chess.js';
import type { AnalysisResult } from './analysis-types';
import {
  classifyTimelineMoves,
  type GameMetadata,
  type StoredMove,
  type TimelineReview,
  toStoredMove
} from './chess-analysis-client';
export { toStoredMove };
import type { ChessComRecentGameSummary } from './chesscom';
import {
  DETERMINISTIC_ANALYSIS_PROFILE,
  REVIEW_ANALYSIS_PROFILE,
} from './analysis-profile';
import { resolveOpeningBookFlagsLocal } from './opening-book';
import type { DeckProgressMap } from './deck-progress';
import type { DeckCard, DeckFeedback } from './opening-training';
import type { TrainSessionStats } from '../components/chess-lab-panels';

export type PositionAnalysisProfile = 'review' | 'training';

export const RECENT_GAMES_PAGE_SIZE = 50;
export const GAME_ANALYSIS_CACHE_VERSION = 'v1';
export const TIMELINE_ANALYSIS_PROFILE_KEY = `game-review-v${REVIEW_ANALYSIS_PROFILE.version}-d${REVIEW_ANALYSIS_PROFILE.depth}-pv${REVIEW_ANALYSIS_PROFILE.multipv}`;

export const TRAINING_USERNAME_COOKIE = 'chess_training_user';
export const TRAINING_USERNAME_STORAGE_KEY = 'chess_training_user';
export const TRAINING_PASSWORD_COOKIE = 'chess_training_pass';
export const TRAINING_PASSWORD_STORAGE_KEY = 'chess_training_pass';
export const CHESSCOM_USERNAME_COOKIE = 'chesscom_user';
export const CHESSCOM_TIME_CLASS_COOKIE = 'chesscom_time_class';
export const DECK_PROGRESS_STORAGE_KEY = 'chess_training_progress';
export const LAST_TRAINING_DECK_STORAGE_KEY = 'chess_last_training_deck';

export type WorkspaceSnapshot = {
  initialFen: string | null;
  moveHistory: StoredMove[];
  historyIndex: number;
  variationBaseIndex: number | null;
  variationMoves: StoredMove[];
  metadata: GameMetadata | null;
  whiteAvatarUrl: string | null;
  blackAvatarUrl: string | null;
  fileName: string;
  orientation: 'white' | 'black';
  showArrow: boolean;
  reviewIndex: number;
  activeDeckCard: DeckCard | null;
  deckFeedback: DeckFeedback | null;
  deckIndex: number;
  trainAllSession: boolean;
  trainAllQueue: DeckCard[];
  trainSessionIndex: number;
  trainSessionStats: TrainSessionStats;
  positionAnalysis: AnalysisResult | null;
  preMoveAnalyses: AnalysisResult[];
  timelineAnalyses: AnalysisResult[];
  serverError: string;
  timelineError: string;
};

export function createEmptyTrainSessionStats(): TrainSessionStats {
  return {
    completed: 0,
    hits: 0,
    misses: 0,
  };
}

export function createEmptyWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    initialFen: null,
    moveHistory: [],
    historyIndex: 0,
    variationBaseIndex: null,
    variationMoves: [],
    metadata: null,
    whiteAvatarUrl: null,
    blackAvatarUrl: null,
    fileName: '',
    orientation: 'white',
    showArrow: true,
    reviewIndex: 0,
    activeDeckCard: null,
    deckFeedback: null,
    deckIndex: 0,
    trainAllSession: false,
    trainAllQueue: [],
    trainSessionIndex: 0,
    trainSessionStats: createEmptyTrainSessionStats(),
    positionAnalysis: null,
    preMoveAnalyses: [],
    timelineAnalyses: [],
    serverError: '',
    timelineError: '',
  };
}

export function normalizeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snapshot,
    moveHistory: [...snapshot.moveHistory],
    variationMoves: [...snapshot.variationMoves],
    preMoveAnalyses: [...snapshot.preMoveAnalyses],
    timelineAnalyses: [...snapshot.timelineAnalyses],
    trainAllQueue: [...snapshot.trainAllQueue],
    trainSessionStats: { ...snapshot.trainSessionStats },
  };
}

export function buildTimelineReviews(
  moves: StoredMove[],
  preMoveAnalyses: AnalysisResult[],
  timelineAnalyses: AnalysisResult[],
  requestInitialFen: string | null,
  requestMetadata: GameMetadata | null,
): TimelineReview[] {
  const reviewedMoveCount = Math.min(moves.length, preMoveAnalyses.length, timelineAnalyses.length);

  if (reviewedMoveCount === 0) {
    return [];
  }

  const reviewedMoves = moves.slice(0, reviewedMoveCount);
  const openingBookFlags = resolveOpeningBookFlagsLocal(reviewedMoves, requestInitialFen);

  return classifyTimelineMoves(
    reviewedMoves,
    preMoveAnalyses.slice(0, reviewedMoveCount),
    timelineAnalyses.slice(0, reviewedMoveCount),
    requestInitialFen,
    requestMetadata,
    openingBookFlags,
  );
}

export function getPositionAnalysisProfileKey(profile: PositionAnalysisProfile) {
  if (profile === 'training') {
    return `training-d${DETERMINISTIC_ANALYSIS_PROFILE.depth}-pv${DETERMINISTIC_ANALYSIS_PROFILE.multipv}`;
  }
  return `review-d${REVIEW_ANALYSIS_PROFILE.depth}-pv${REVIEW_ANALYSIS_PROFILE.multipv}`;
}

export function getPositionCacheKey(
  initialFen: string | null,
  moves: string[],
  profile: PositionAnalysisProfile = 'review',
) {
  return `analysis:v${GAME_ANALYSIS_CACHE_VERSION}:${getPositionAnalysisProfileKey(profile)}:${initialFen ?? 'startpos'}|${moves.join(' ')}`;
}

export function getTimelinePositionCacheKey(initialFen: string | null, moves: string[]) {
  return `timeline:${TIMELINE_ANALYSIS_PROFILE_KEY}:${initialFen ?? 'startpos'}|${moves.join(' ')}`;
}

export function mergeDeckProgress(serverProgress: DeckProgressMap, localProgress: DeckProgressMap) {
  const merged: DeckProgressMap = { ...serverProgress };

  for (const [cardId, localEntry] of Object.entries(localProgress)) {
    const serverEntry = serverProgress[cardId];

    if (!serverEntry) {
      merged[cardId] = localEntry;
    }
  }

  return merged;
}

export function dedupeBoardArrows(arrows: Array<{ startSquare: string; endSquare: string; color: string }>) {
  const unique = new Map<string, { startSquare: string; endSquare: string; color: string }>();

  for (const arrow of arrows) {
    unique.set(`${arrow.startSquare}-${arrow.endSquare}`, arrow);
  }

  return [...unique.values()];
}

export function isOpponentTurnFromFen(fen: string, side: 'white' | 'black') {
  const turn = fen.trim().split(/\s+/)[1];
  const playerTurn = turn === 'b' ? 'black' : 'white';
  return playerTurn !== side;
}

export function normalizeDeckLoadError(message: string) {
  if (
    message.includes('deck_cards.source_type') ||
    message.includes('deck_cards.validation_mode') ||
    message.includes('deck_cards.reference_eval_cp') ||
    message.includes('deck_cards.max_eval_loss_cp') ||
    message.includes('deck_cards.replay_from_start') ||
    message.includes('deck_cards.initial_fen') ||
    message.includes('deck_cards.setup_moves') ||
    message.includes('deck_cards.move_reviews')
  ) {
    return 'Supabase deck schema is outdated. Recreate the canonical deck tables and reseed.';
  }

  return message;
}

export function readStoredTrainingUsername() {
  if (typeof window === 'undefined') {
    return '';
  }

  const cookieValue = readCookie(TRAINING_USERNAME_COOKIE);
  const storageValue = window.localStorage.getItem(TRAINING_USERNAME_STORAGE_KEY);
  return cookieValue || storageValue || '';
}

export function readStoredTrainingPassword() {
  if (typeof window === 'undefined') {
    return '';
  }

  const cookieValue = readCookie(TRAINING_PASSWORD_COOKIE);
  const storageValue = window.localStorage.getItem(TRAINING_PASSWORD_STORAGE_KEY);
  return cookieValue || storageValue || '';
}

export function persistTrainingUsername(username: string) {
  writeCookie(TRAINING_USERNAME_COOKIE, username);
  window.localStorage.setItem(TRAINING_USERNAME_STORAGE_KEY, username);
}

export function persistTrainingPassword(password: string) {
  writeCookie(TRAINING_PASSWORD_COOKIE, password);
  window.localStorage.setItem(TRAINING_PASSWORD_STORAGE_KEY, password);
}

export function persistTrainingCredentials(username: string, password: string) {
  persistTrainingUsername(username);
  persistTrainingPassword(password);
}

export function readCookie(name: string) {
  if (typeof document === 'undefined') {
    return '';
  }

  const prefix = `${name}=`;
  const entry = document.cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(prefix));

  return entry ? decodeURIComponent(entry.slice(prefix.length)) : '';
}

export function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function deleteCookie(name: string) {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

export function delay(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}
export type CachedTimelineAnalysis = {
  quality: 'refined';
  version?: string;
  profileKey?: string;
  preMoveAnalyses: AnalysisResult[];
  timelineAnalyses: AnalysisResult[];
  updatedAt?: string;
};
export const recentGameAnalysisMemoryCache = new Map<string, CachedTimelineAnalysis>();
export const recentGameAnalysisInFlightCache = new Map<string, Promise<CachedTimelineAnalysis | null>>();
export function formatRecentGameLogLabel(game: ChessComRecentGameSummary) {
  const player = game.playerUsername ?? 'You';
  const opponent = game.opponentUsername ?? 'opponent';
  return game.playerColor === 'black' ? `${opponent} vs ${player}` : `${player} vs ${opponent}`;
}

export function getPgnHash(pgn: string) {
  let hash = 0;
  for (let i = 0; i < pgn.length; i++) {
    hash = (hash << 5) - hash + pgn.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

export function logRecentGamePreload(status: string, detail: string) {
  console.info(`[preload:game] ${status} ${detail}`);
}

export function getRecentGameCacheKey(game: ChessComRecentGameSummary) {
  return `chesscom:v${GAME_ANALYSIS_CACHE_VERSION}:${game.link || game.url}`;
}

export async function loadCachedTimelineAnalysis(
  cacheKey: string,
  { includeInFlight = true }: { includeInFlight?: boolean } = {},
): Promise<CachedTimelineAnalysis | null> {
  const memoryHit = recentGameAnalysisMemoryCache.get(cacheKey);

  if (memoryHit?.version === GAME_ANALYSIS_CACHE_VERSION && memoryHit.profileKey === TIMELINE_ANALYSIS_PROFILE_KEY) {
    return memoryHit;
  }

  const inFlightHit = recentGameAnalysisInFlightCache.get(cacheKey);

  if (includeInFlight && inFlightHit) {
    const analysis = await inFlightHit;
    return analysis?.version === GAME_ANALYSIS_CACHE_VERSION && analysis.profileKey === TIMELINE_ANALYSIS_PROFILE_KEY
      ? analysis
      : null;
  }

  try {
    const response = await fetch(`/api/game-analysis-cache?key=${encodeURIComponent(cacheKey)}`, { credentials: 'same-origin' });
    const payload = (await response.json()) as { analysis?: CachedTimelineAnalysis | null };
    const analysis = payload.analysis;

    if (
      response.ok &&
      analysis &&
      analysis.quality === 'refined' &&
      analysis.version === GAME_ANALYSIS_CACHE_VERSION &&
      analysis.profileKey === TIMELINE_ANALYSIS_PROFILE_KEY &&
      Array.isArray(analysis.preMoveAnalyses) &&
      Array.isArray(analysis.timelineAnalyses)
    ) {
      recentGameAnalysisMemoryCache.set(cacheKey, analysis);
      return analysis;
    }
  } catch {
    // Analysis cache is an optimization; misses should not affect review.
  }

  return null;
}

export async function saveCachedTimelineAnalysis({
  cacheKey,
  gameLink,
  pgn,
  preMoveAnalyses,
  timelineAnalyses,
}: {
  cacheKey: string;
  gameLink?: string | null;
  pgn?: string | null;
  preMoveAnalyses: AnalysisResult[];
  timelineAnalyses: AnalysisResult[];
}) {
  recentGameAnalysisMemoryCache.set(cacheKey, {
    quality: 'refined',
    version: GAME_ANALYSIS_CACHE_VERSION,
    profileKey: TIMELINE_ANALYSIS_PROFILE_KEY,
    preMoveAnalyses,
    timelineAnalyses,
    updatedAt: new Date().toISOString(),
  });

  try {
    await fetch('/api/game-analysis-cache', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: cacheKey,
        gameLink,
        pgnHash: pgn ? getPgnHash(pgn) : null,
      analysis: {
        quality: 'refined',
        version: GAME_ANALYSIS_CACHE_VERSION,
        profileKey: TIMELINE_ANALYSIS_PROFILE_KEY,
        preMoveAnalyses,
        timelineAnalyses,
      },
      }),
    });
  } catch {
    // Best-effort persistence only.
  }
}

export function isUsableCachedTimelineAnalysis(
  analysis: CachedTimelineAnalysis | null | undefined,
  moveCount: number,
): analysis is CachedTimelineAnalysis {
  if (
    !analysis ||
    analysis.version !== GAME_ANALYSIS_CACHE_VERSION ||
    analysis.profileKey !== TIMELINE_ANALYSIS_PROFILE_KEY
  ) {
    return false;
  }

  const analyzedPlies = analysis.timelineAnalyses.length;
  return (
    analyzedPlies > 0 &&
    analyzedPlies === moveCount &&
    analysis.preMoveAnalyses.length === analyzedPlies
  );
}
