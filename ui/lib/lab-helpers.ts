import type { CSSProperties } from 'react';
import type { AnalysisResult } from './analysis-types';
import {
  classifyTimelineMoves,
  type GameMetadata,
  type ReviewCategory,
  reviewCategoryMeta,
  type StoredMove,
  type TimelineReview,
  toStoredMove,
} from './chess-analysis-client';
import { lruMapGet, lruMapSet } from './lru-map.ts';

const LAST_MOVE_STYLE: CSSProperties = {
  backgroundColor: 'rgba(255, 255, 0, 0.4)',
};

export { toStoredMove };

import { parseCardMoveReviews } from '@/lib/card-move-reviews';
import type { DeckCard, DeckFeedback } from '@/lib/opening-training';
import type { TrainingDeckSummary, TrainSessionStats } from '../components/chess-lab-panels';
import { DETERMINISTIC_ANALYSIS_PROFILE, REVIEW_ANALYSIS_PROFILE } from './analysis-profile';
import type { ChessComRecentGameSummary } from './chesscom';
import type { DeckProgressMap } from './deck-progress';
import { resolveOpeningBookFlagsLocal } from './opening-book';
import type { OpeningTreeDetail, OpeningTreeSummary } from './opening-tree';

export type TrainingDeckCardRow = {
  id: string;
  kind: string;
  line_id: string | null;
  line_name: string | null;
  eco: string | null;
  side: string;
  ply: number;
  fen: string;
  answer_uci: string;
  answer_san: string;
  prompt: string;
  context: string;
  source_type: string;
  validation_mode: string;
  reference_eval_cp: number | null;
  max_eval_loss_cp: number | null;
  opponent_move_uci: string | null;
  opponent_move_san: string | null;
  score_swing_cp: number | null;
  replay_from_start?: boolean | null;
  initial_fen?: string | null;
  setup_moves?: string[] | null;
  move_reviews?: unknown;
};

export function mapTrainingDeckCard(card: TrainingDeckCardRow): DeckCard {
  return {
    id: String(card.id),
    kind: card.kind === 'repertoire_choice' ? 'repertoire_choice' : 'punish_mistake',
    lineId: card.line_id ? String(card.line_id) : '',
    lineName: String(card.line_name),
    eco: String(card.eco),
    side: card.side === 'black' ? 'black' : 'white',
    ply: Number(card.ply),
    fen: String(card.fen),
    answerUci: String(card.answer_uci),
    answerSan: String(card.answer_san),
    prompt: String(card.prompt),
    context: String(card.context),
    sourceType: card.source_type === 'recent_game' || card.source_type === 'review' ? card.source_type : 'opening_seed',
    validationMode: card.validation_mode === 'within_eval_loss' ? 'within_eval_loss' : 'strict_best',
    referenceEvalCp: typeof card.reference_eval_cp === 'number' ? card.reference_eval_cp : undefined,
    maxEvalLossCp: typeof card.max_eval_loss_cp === 'number' ? card.max_eval_loss_cp : undefined,
    opponentMoveUci: card.opponent_move_uci ? String(card.opponent_move_uci) : undefined,
    opponentMoveSan: card.opponent_move_san ? String(card.opponent_move_san) : undefined,
    scoreSwingCp: typeof card.score_swing_cp === 'number' ? card.score_swing_cp : undefined,
    replayFromStart: Boolean(card.replay_from_start),
    initialFen: card.initial_fen ? String(card.initial_fen) : null,
    setupMoves: Array.isArray(card.setup_moves) ? card.setup_moves.map((move) => String(move)) : [],
    moveReviews: parseCardMoveReviews(card.move_reviews),
  };
}

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
  variationIndex: number;
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
    variationIndex: 0,
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
    variationIndex: snapshot.variationIndex ?? snapshot.variationMoves.length,
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
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  return entry ? decodeURIComponent(entry.slice(prefix.length)) : '';
}

export function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') {
    return;
  }

  // biome-ignore lint/suspicious/noDocumentCookie: lightweight client preference storage
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function deleteCookie(name: string) {
  if (typeof document === 'undefined') {
    return;
  }

  // biome-ignore lint/suspicious/noDocumentCookie: lightweight client preference storage
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

export function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export const DRILL_OPPONENT_DELAY_MS = 200;
export const LINES_LINE_PREVIEW_DELAY_MS = 300;
export const LINES_ROOT_PREVIEW_MOVE_DELAY_MS = 85;

export { isLinesBoardPlayAllowed } from './lines-board-guards';

export function parseJsonResponse<T>(response: Response, bodyText: string): T {
  if (!bodyText.trim()) {
    throw new Error(`Empty response from ${response.url || 'API'} (HTTP ${response.status}).`);
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new Error(`Invalid JSON from ${response.url || 'API'} (HTTP ${response.status}).`);
  }
}

export async function readJsonResponse<T>(response: Response) {
  return parseJsonResponse<T>(response, await response.text());
}

export type TrainingDeckPayload = {
  decks?: TrainingDeckSummary[];
  deck?: TrainingDeckSummary | null;
  lines?: Array<{ id: string; name: string; eco: string; side: string; moves: string[] | null }>;
  cards?: TrainingDeckCardRow[];
  error?: string;
};

export type OpeningTreesPayload = {
  trees?: OpeningTreeSummary[];
  tree?: OpeningTreeDetail;
  imported?: number;
  nodes?: number;
  edges?: number;
  nodeId?: string;
  masteryScore?: number;
  error?: string;
};

export type OpeningTreesFullPayload = Omit<OpeningTreesPayload, 'trees'> & {
  trees?: OpeningTreeDetail[];
};

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
const RECENT_GAME_MEMORY_CACHE_LIMIT = 6;

export function rememberRecentGameAnalysis(cacheKey: string, analysis: CachedTimelineAnalysis) {
  lruMapSet(recentGameAnalysisMemoryCache, cacheKey, analysis, RECENT_GAME_MEMORY_CACHE_LIMIT);
}

export function readRecentGameAnalysis(cacheKey: string) {
  return lruMapGet(recentGameAnalysisMemoryCache, cacheKey);
}
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
  const memoryHit = readRecentGameAnalysis(cacheKey);

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
    const response = await fetch(`/api/game-analysis-cache?key=${encodeURIComponent(cacheKey)}`, {
      credentials: 'same-origin',
    });
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
      rememberRecentGameAnalysis(cacheKey, analysis);
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
  rememberRecentGameAnalysis(cacheKey, {
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
  return analyzedPlies > 0 && analyzedPlies === moveCount && analysis.preMoveAnalyses.length === analyzedPlies;
}

export function getReviewMoveStyle(category: ReviewCategory | null | undefined): CSSProperties {
  if (!category) {
    return LAST_MOVE_STYLE;
  }

  const color = reviewCategoryMeta[category]?.color;

  if (!color) {
    return LAST_MOVE_STYLE;
  }

  return {
    backgroundColor: `color-mix(in srgb, ${color} 38%, transparent)`,
    boxShadow: `inset 0 0 0 2px color-mix(in srgb, ${color} 62%, transparent)`,
  };
}

export function getBoardSquareCenter(square: string, orientation: 'white' | 'black', boardWidth: number) {
  const fileIndex = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);

  if (fileIndex < 0 || fileIndex > 7 || !Number.isInteger(rank) || rank < 1 || rank > 8) {
    return null;
  }

  const visualFile = orientation === 'white' ? fileIndex : 7 - fileIndex;
  const visualRank = orientation === 'white' ? 8 - rank : rank - 1;
  const squareSize = boardWidth / 8;

  return {
    left: visualFile * squareSize + squareSize * 0.78,
    top: visualRank * squareSize + squareSize * 0.22,
    squareSize,
  };
}

export type BoardPlayerSummary = {
  color: 'white' | 'black';
  name: string;
  elo: string;
  avatarUrl: string | null;
  captured: string[];
  materialAdvantage: number;
};
