'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { Chess, type Square } from 'chess.js';

import type { AnalysisResult } from '@/lib/analysis-types';
import {
  DETERMINISTIC_ANALYSIS_PROFILE,
  REVIEW_ANALYSIS_PROFILE,
  buildDeterministicAnalyzeRequest,
  buildReviewAnalyzeRequest,
} from '@/lib/analysis-profile';
import { runTimelineAnalysisDedupe } from '@/lib/timeline-analysis-runner';
import {
  PgnImportDialog,
  LinesPanel,
  ReviewPanel,
  TrainPanel,
  TrainingProfilePanel,
  getModeLabel,
  type TrainingDeckSummary,
  type WorkspaceMode,
} from '@/components/chess-lab-panels';
import {
  analyzeGamePositions,
  analyzeSinglePosition,
  buildGameReview,
  buildMoveUciHistory,
  buildTimelineSequencePositions,
  classifyTimelineMoves,
  extractMetadataFromGame,
  filterReviewMoments,
  formatBestMove,
  formatEvalCpLabel,
  formatScoreLabel,
  getAdvantageMeter,
  getAdvantageMeterFromEvalCp,
  getBestMoveArrow,
  reviewCategoryMeta,
  restoreGameFromHistory,
  toStoredMove,
  type GameMetadata,
  type ReviewCategory,
  type ReviewSide,
  type StoredMove,
  type TimelineReview,
} from '@/lib/chess-analysis-client';
import {
  buildLiveTrainMoveReview,
  cardMoveReviewsFromTimeline,
  parseCardMoveReviews,
  resolveTrainBoardMoveReview,
  resolveTrainReplayBestMoveUci,
  shouldUseLiveTrainMoveReview,
} from '@/lib/card-move-reviews';
import { resolveOpeningBookFlagsLocal } from '@/lib/opening-book';
import { CHESS_SOUND_URLS, getMoveSoundSequence, getPrimaryMoveSound, type ChessSoundKey } from '@/lib/chess-sounds';
import {
  buildDeckCardStartState,
  buildPendingDeckFeedback,
  finalizeDeckFeedback,
  type DeckCard,
  type DeckFeedback,
  type OpeningSeedLine,
} from '@/lib/opening-training';
import { resolvePostMoveVerifiedReviewCardAnswer } from '@/lib/review-card-answer';
import {
  applyDeckAttempt,
  buildMixedTrainingQueue,
  getDeckProgressEntry,
  getDeckStudyQueue,
  sortCardsForReview,
  summarizeDeckProgress,
  summarizeLineMastery,
  type DeckProgressMap,
} from '@/lib/deck-progress';
import type { ChessComRecentGameSummary, ChessComRecentGameTimeClass } from '@/lib/chesscom';
import { chooseWeightedOpponentEdge, type OpeningTreeDetail, type OpeningTreeSummary } from '@/lib/opening-tree';
import styles from './chess-analysis-lab.module.css';

const Chessboard = dynamic(() => import('@/components/chessboard-client'), {
  ssr: false,
  loading: () => <div className={styles.boardFallback}>Loading board...</div>,
});

const TIMELINE_ANALYSIS_BATCH_SIZE = 4;
const TIMELINE_CACHE_PROGRESS = 4;
const TIMELINE_ENGINE_PROGRESS_OFFSET = 8;
const TIMELINE_ENGINE_PROGRESS_WEIGHT = 0.84;
const PRELOAD_AHEAD = 15;
const LAST_MOVE_STYLE = {
  backgroundColor: 'rgba(84, 173, 255, 0.26)',
  boxShadow: 'inset 0 0 0 2px rgba(181, 222, 255, 0.42)',
} satisfies CSSProperties;
const CHESSCOM_USERNAME_COOKIE = 'chesscom_username';
const CHESSCOM_TIME_CLASS_COOKIE = 'chesscom_time_class';
const TRAINING_USERNAME_COOKIE = 'training_profile_username';
const TRAINING_PASSWORD_COOKIE = 'training_profile_password';
const TRAINING_USERNAME_STORAGE_KEY = 'chess-lab-training-username-v1';
const TRAINING_PASSWORD_STORAGE_KEY = 'chess-lab-training-password-v1';
const DECK_PROGRESS_STORAGE_KEY = 'chess-lab-deck-progress-v1';
const LAST_TRAINING_DECK_STORAGE_KEY = 'chess-lab-last-training-deck-v1';
const TRAINING_REPLAY_MOVE_MS = 200;
const RECENT_GAMES_PAGE_SIZE = 10;
const RECENT_GAMES_AUTO_REFRESH_MS = 90_000;
const RECENT_GAMES_INTERACTION_IDLE_MS = 2_500;
const RECENT_GAMES_PRELOAD_SCAN_MS = 1_000;
const GAME_ANALYSIS_CACHE_VERSION = 6;
const TIMELINE_ANALYSIS_PROFILE_KEY = `game-review-v${REVIEW_ANALYSIS_PROFILE.version}-d${REVIEW_ANALYSIS_PROFILE.depth}-pv${REVIEW_ANALYSIS_PROFILE.multipv}`;

type CachedTimelineAnalysis = {
  quality: 'refined';
  version?: number;
  profileKey?: string;
  preMoveAnalyses: AnalysisResult[];
  timelineAnalyses: AnalysisResult[];
  updatedAt?: string;
};

const recentGameAnalysisMemoryCache = new Map<string, CachedTimelineAnalysis>();
const recentGameAnalysisInFlightCache = new Map<string, Promise<CachedTimelineAnalysis | null>>();
type PositionAnalysisProfile = 'review' | 'training';

function getReviewMoveStyle(category: ReviewCategory | null | undefined): CSSProperties {
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

function getBoardSquareCenter(square: string, orientation: 'white' | 'black', boardWidth: number) {
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

type BoardPlayerSummary = {
  color: 'white' | 'black';
  name: string;
  elo: string;
  avatarUrl: string | null;
  captured: string[];
  materialAdvantage: number;
};

const CAPTURED_PIECE_ORDER = ['q', 'r', 'b', 'n', 'p'] as const;
const CAPTURED_PIECE_VALUES: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
};
const CAPTURED_PIECE_ICONS: Record<'white' | 'black', Record<string, string>> = {
  white: {
    p: '♙',
    n: '♘',
    b: '♗',
    r: '♖',
    q: '♕',
  },
  black: {
    p: '♟',
    n: '♞',
    b: '♝',
    r: '♜',
    q: '♛',
  },
};

function buildCapturedPieces(moves: StoredMove[], playerColor: 'white' | 'black') {
  const playerMoveColor = playerColor === 'white' ? 'w' : 'b';
  const capturedColor = playerColor === 'white' ? 'black' : 'white';
  const counts = new Map<string, number>();

  for (const move of moves) {
    if (move.color !== playerMoveColor || !move.captured) {
      continue;
    }

    counts.set(move.captured, (counts.get(move.captured) ?? 0) + 1);
  }

  return CAPTURED_PIECE_ORDER.flatMap(piece => (
    Array.from({ length: counts.get(piece) ?? 0 }, () => CAPTURED_PIECE_ICONS[capturedColor][piece] ?? '')
  )).filter(Boolean);
}

function getCapturedMaterialValue(moves: StoredMove[], playerColor: 'white' | 'black') {
  const playerMoveColor = playerColor === 'white' ? 'w' : 'b';

  return moves.reduce((total, move) => {
    if (move.color !== playerMoveColor || !move.captured) {
      return total;
    }

    return total + (CAPTURED_PIECE_VALUES[move.captured] ?? 0);
  }, 0);
}

function mapTrainingDeckCard(card: TrainingDeckCardRow): DeckCard {
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
    setupMoves: Array.isArray(card.setup_moves) ? card.setup_moves.map(move => String(move)) : [],
    moveReviews: parseCardMoveReviews(card.move_reviews),
  };
}

function BoardPlayerBar({ player }: { player: BoardPlayerSummary }) {
  return (
    <div className={styles.boardPlayerBar}>
      <span className={`${styles.boardPlayerAvatar} ${player.color === 'black' ? styles.boardPlayerAvatarDark : ''}`} aria-hidden="true">
        {player.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className={styles.boardPlayerAvatarImage} src={player.avatarUrl} />
        ) : (
          player.color === 'white' ? '♙' : '♟'
        )}
      </span>
      <span className={styles.boardPlayerIdentity}>
        <strong className={styles.boardPlayerName}>{player.name}</strong>
        {player.elo ? <span className={styles.boardPlayerElo}>({player.elo})</span> : null}
      </span>
      <span className={styles.boardCapturedPieces} aria-label={`${player.name} captured pieces`}>
        {player.captured.map((piece, index) => (
          <span className={styles.boardCapturedPiece} key={`${piece}-${index}`}>{piece}</span>
        ))}
        {player.materialAdvantage > 0 ? <span className={styles.boardMaterialAdvantage}>+{player.materialAdvantage}</span> : null}
      </span>
    </div>
  );
}

function getRecentGameCacheKey(game: ChessComRecentGameSummary) {
  return `chesscom:v${GAME_ANALYSIS_CACHE_VERSION}:${game.link || game.url}`;
}

function getPgnHash(pgn: string) {
  let hash = 5381;

  for (let index = 0; index < pgn.length; index += 1) {
    hash = (hash * 33) ^ pgn.charCodeAt(index);
  }

  return `pgn:${(hash >>> 0).toString(16)}`;
}

function logRecentGamePreload(status: string, detail: string) {
  console.info(`[preload:game] ${status} ${detail}`);
}

function formatRecentGameLogLabel(game: ChessComRecentGameSummary) {
  const player = game.playerUsername ?? 'You';
  const opponent = game.opponentUsername ?? 'opponent';
  return game.playerColor === 'black' ? `${opponent} vs ${player}` : `${player} vs ${opponent}`;
}

function parseJsonResponse<T>(response: Response, bodyText: string): T {
  if (!bodyText.trim()) {
    throw new Error(`Empty response from ${response.url || 'API'} (HTTP ${response.status}).`);
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    throw new Error(`Invalid JSON from ${response.url || 'API'} (HTTP ${response.status}).`);
  }
}

async function readJsonResponse<T>(response: Response) {
  return parseJsonResponse<T>(response, await response.text());
}

async function loadCachedTimelineAnalysis(
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

async function saveCachedTimelineAnalysis({
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

function isUsableCachedTimelineAnalysis(
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

type TrainingProfile = {
  id: string;
  username: string;
};

type TrainingDeckPayload = {
  decks?: TrainingDeckSummary[];
  deck?: TrainingDeckSummary | null;
  lines?: Array<{ id: string; name: string; eco: string; side: string; moves: string[] | null }>;
  cards?: TrainingDeckCardRow[];
  error?: string;
};

type OpeningTreesPayload = {
  trees?: OpeningTreeSummary[];
  tree?: OpeningTreeDetail;
  imported?: number;
  nodes?: number;
  edges?: number;
  nodeId?: string;
  masteryScore?: number;
  error?: string;
};

type TrainingDeckCardRow = {
  id: string;
  kind: string;
  line_id: string | null;
  line_name: string;
  eco: string;
  side: string;
  ply: number;
  fen: string;
  answer_uci: string;
  answer_san: string;
  prompt: string;
  context: string;
  source_type?: string | null;
  validation_mode?: string | null;
  reference_eval_cp?: number | null;
  max_eval_loss_cp?: number | null;
  opponent_move_uci?: string | null;
  opponent_move_san?: string | null;
  score_swing_cp?: number | null;
  replay_from_start?: boolean | null;
  initial_fen?: string | null;
  setup_moves?: string[] | null;
  move_reviews?: unknown;
};

type TrainSessionStats = {
  completed: number;
  hits: number;
  misses: number;
};

type WorkspaceSnapshot = {
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

export function ChessAnalysisLab() {
  const [game, setGame] = useState(() => new Chess());
  const [initialFen, setInitialFen] = useState<string | null>(null);
  const [moveHistory, setMoveHistory] = useState<StoredMove[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [variationBaseIndex, setVariationBaseIndex] = useState<number | null>(null);
  const [variationMoves, setVariationMoves] = useState<StoredMove[]>([]);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [squareStyles, setSquareStyles] = useState<Record<string, CSSProperties>>({});
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [showArrow, setShowArrow] = useState(true);
  const [mode, setMode] = useState<WorkspaceMode>('review');
  const [reviewSide] = useState<ReviewSide>('both');
  const [reviewIndex, setReviewIndex] = useState(0);
  const [metadata, setMetadata] = useState<GameMetadata | null>(null);
  const [whiteAvatarUrl, setWhiteAvatarUrl] = useState<string | null>(null);
  const [blackAvatarUrl, setBlackAvatarUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [pgnDraft, setPgnDraft] = useState('');
  const [pgnDialogOpen, setPgnDialogOpen] = useState(false);
  const [positionAnalysis, setPositionAnalysis] = useState<AnalysisResult | null>(null);
  const [preMoveAnalyses, setPreMoveAnalyses] = useState<AnalysisResult[]>([]);
  const [timelineAnalyses, setTimelineAnalyses] = useState<AnalysisResult[]>([]);
  const [positionLoading, setPositionLoading] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineProgress, setTimelineProgress] = useState<number | null>(null);
  const [serverError, setServerError] = useState('');
  const [timelineError, setTimelineError] = useState('');
  const [boardWidth, setBoardWidth] = useState(640);
  const [deckIndex, setDeckIndex] = useState(0);
  const [trainAllSession, setTrainAllSession] = useState(false);
  const [trainAllQueue, setTrainAllQueue] = useState<DeckCard[]>([]);
  const [trainSessionIndex, setTrainSessionIndex] = useState(0);
  const [trainSessionStats, setTrainSessionStats] = useState<TrainSessionStats>({ completed: 0, hits: 0, misses: 0 });
  const [activeDeckCard, setActiveDeckCard] = useState<DeckCard | null>(null);
  const [deckFeedback, setDeckFeedback] = useState<DeckFeedback | null>(null);
  const [deckFeedbackArrowsVisible, setDeckFeedbackArrowsVisible] = useState(false);
  const [openingLines, setOpeningLines] = useState<OpeningSeedLine[]>([]);
  const [deckCards, setDeckCards] = useState<DeckCard[]>([]);
  const [deckSummaries, setDeckSummaries] = useState<TrainingDeckSummary[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [deckLibraryLoading, setDeckLibraryLoading] = useState(false);
  const [deckCardsLoading, setDeckCardsLoading] = useState(false);
  const [deckLoadError, setDeckLoadError] = useState('');
  const [deckActionLoading, setDeckActionLoading] = useState(false);
  const [deckActionError, setDeckActionError] = useState('');
  const [openingTrees, setOpeningTrees] = useState<OpeningTreeSummary[]>([]);
  const [activeOpeningTree, setActiveOpeningTree] = useState<OpeningTreeDetail | null>(null);
  const [openingTreesLoading, setOpeningTreesLoading] = useState(false);
  const [openingTreeActionLoading, setOpeningTreeActionLoading] = useState(false);
  const [openingTreeActionError, setOpeningTreeActionError] = useState('');
  const [selectedOpeningTreeId, setSelectedOpeningTreeId] = useState<string | null>(null);
  const [activeOpeningNodeId, setActiveOpeningNodeId] = useState<string | null>(null);
  const [openingDrillStatus, setOpeningDrillStatus] = useState('');
  const [openingDrillExpected, setOpeningDrillExpected] = useState<{ nodeId: string; uci: string | null; san: string | null } | null>(null);
  const [newDeckTitle, setNewDeckTitle] = useState('');
  const [reviewDeckSaveStatus, setReviewDeckSaveStatus] = useState('');
  const [deckProgress, setDeckProgress] = useState<DeckProgressMap>({});
  const [chesscomUsername, setChesscomUsername] = useState('');
  const [recentGameTimeClass, setRecentGameTimeClass] = useState<ChessComRecentGameTimeClass>('blitz');
  const [recentChessGames, setRecentChessGames] = useState<ChessComRecentGameSummary[]>([]);
  const [recentChessGamesLoading, setRecentChessGamesLoading] = useState(false);
  const [recentChessGamesHasMore, setRecentChessGamesHasMore] = useState(false);
  const [recentChessGamesNextOffset, setRecentChessGamesNextOffset] = useState(0);
  const [recentChessGamesNextCursor, setRecentChessGamesNextCursor] = useState<string | null>(null);
  const [recentChessGamesError, setRecentChessGamesError] = useState('');
  const [recentPreloadTick, setRecentPreloadTick] = useState(0);
  const [trainingProfile, setTrainingProfile] = useState<TrainingProfile | null>(null);
  const [trainingProfileBootstrapping, setTrainingProfileBootstrapping] = useState(true);
  const [trainingProfileSubmitting, setTrainingProfileSubmitting] = useState(false);
  const [trainingProfileError, setTrainingProfileError] = useState('');
  const [trainingUsername, setTrainingUsername] = useState('');
  const [trainingPassword, setTrainingPassword] = useState('');
  const trainingCredentialsHydratedRef = useRef(false);
  const [focusTrainCreateDeck, setFocusTrainCreateDeck] = useState(false);
  const saveReplayFromStart = true;
  const [deckPlaybackBusy, setDeckPlaybackBusy] = useState(false);
  const [trainAnalysisTick, setTrainAnalysisTick] = useState(0);

  const boardStageRef = useRef<HTMLDivElement | null>(null);
  const evalRailRef = useRef<HTMLDivElement | null>(null);
  const positionRequestIdRef = useRef(0);
  const timelineRequestIdRef = useRef(0);
  const timelineRefineRequestIdRef = useRef(0);
  const reviewPlaybackRequestIdRef = useRef(0);
  const deckPlaybackRequestIdRef = useRef(0);
  const deckReplayMovesRef = useRef<StoredMove[]>([]);
  const deckReplayInitialFenRef = useRef<string | null>(null);
  const deckCardPromptStartedAtRef = useRef<number | null>(null);
  const suppressSpaceKeyUpRef = useRef(false);
  const deckProgressRef = useRef(deckProgress);
  const deckFeedbackRef = useRef(deckFeedback);
  const soundPlayersRef = useRef<Partial<Record<ChessSoundKey, HTMLAudioElement>>>({});
  const positionCacheRef = useRef(new Map<string, AnalysisResult>());
  const positionInFlightRef = useRef(new Map<string, Promise<AnalysisResult>>());
  const timelineBatchInFlightRef = useRef(new Map<string, Promise<AnalysisResult[]>>());
  const recentFetchRequestIdRef = useRef(0);
  const recentAutoFetchStartedRef = useRef(false);
  const recentPreloadBusyRef = useRef(false);
  const recentPreloadRequestIdRef = useRef(0);
  const recentPreloadAbortRef = useRef<AbortController | null>(null);
  const recentPreloadedKeysRef = useRef(new Set<string>());
  const activeRecentGameCacheKeyRef = useRef<string | null>(null);
  const activeRecentGameLinkRef = useRef<string | null>(null);
  const activeRecentGamePgnRef = useRef<string | null>(null);
  const lastReviewInteractionAtRef = useRef(Date.now());
  const progressHydratedRef = useRef(false);
  const progressSyncTimerRef = useRef<number | null>(null);
  const selectedDeckIdRef = useRef<string | null>(null);
  const loadTrainingDeckRef = useRef<(deckId?: string | null, options?: { autoStart?: boolean; allDecks?: boolean; libraryLoading?: boolean }) => Promise<void>>(async () => undefined);
  const lastDeckLibraryProfileIdRef = useRef<string | null>(null);
  const deckLoadRequestIdRef = useRef(0);
  const reviewWorkspaceSnapshotRef = useRef<WorkspaceSnapshot | null>(null);
  const trainWorkspaceSnapshotRef = useRef<WorkspaceSnapshot | null>(null);
  const workspaceStateRef = useRef<WorkspaceSnapshot>(createEmptyWorkspaceSnapshot());
  const modeRef = useRef<WorkspaceMode>('review');

  const currentFen = useMemo(() => game.fen(), [game]);
  const hasLoadedGame = moveHistory.length > 0 && metadata !== null;
  const currentMoves = useMemo(() => {
    if (variationBaseIndex != null) {
      return [...moveHistory.slice(0, variationBaseIndex), ...variationMoves];
    }

    return moveHistory.slice(0, historyIndex);
  }, [historyIndex, moveHistory, variationBaseIndex, variationMoves]);
  const currentMoveList = useMemo(() => buildMoveUciHistory(currentMoves), [currentMoves]);
  const currentLineKey = currentMoveList.join(' ');
  const trainAnswerFeedback = useMemo(
    () =>
      deckFeedback && !deckFeedback.pending
        ? {
            correct: deckFeedback.correct,
            playedUci: deckFeedback.playedUci,
            evalLossCp: deckFeedback.evalLossCp,
          }
        : null,
    [deckFeedback],
  );
  const trainPositionAnalyses = useMemo(() => {
    const analyses: Array<AnalysisResult | null> = [];

    for (let moveCount = 0; moveCount <= currentMoves.length; moveCount += 1) {
      const moveList = buildMoveUciHistory(currentMoves.slice(0, moveCount));
      const cacheKey = getPositionCacheKey(initialFen, moveList, 'training');
      analyses[moveCount] = positionCacheRef.current.get(cacheKey) ?? null;
    }

    if (positionAnalysis) {
      analyses[historyIndex] = positionAnalysis;
    }

    return analyses;
  }, [currentMoves, historyIndex, initialFen, positionAnalysis, trainAnalysisTick]);
  const activeTrainMoveReview = useMemo(() => {
    if (!activeDeckCard || historyIndex <= 0) {
      return null;
    }

    const moveIndex = historyIndex - 1;

    if (shouldUseLiveTrainMoveReview(activeDeckCard, currentMoves, moveIndex, trainAnswerFeedback)) {
      return buildLiveTrainMoveReview(moveIndex, currentMoves, trainPositionAnalyses, initialFen);
    }

    return resolveTrainBoardMoveReview(
      activeDeckCard,
      moveIndex,
      currentMoves,
      initialFen,
      trainAnswerFeedback,
    );
  }, [activeDeckCard, currentMoves, historyIndex, initialFen, trainAnswerFeedback, trainPositionAnalyses]);
  const trainUsesLivePositionEval = useMemo(() => {
    if (!activeDeckCard || historyIndex <= 0) {
      return false;
    }

    return shouldUseLiveTrainMoveReview(activeDeckCard, currentMoves, historyIndex - 1, trainAnswerFeedback);
  }, [activeDeckCard, currentMoves, historyIndex, trainAnswerFeedback]);
  const reviewDisplayAnalysis = useMemo(() => {
    if (!hasLoadedGame || activeDeckCard || variationBaseIndex != null) {
      return null;
    }

    return preMoveAnalyses[historyIndex] ?? null;
  }, [activeDeckCard, hasLoadedGame, historyIndex, preMoveAnalyses, variationBaseIndex]);
  const displayAnalysis = reviewDisplayAnalysis ?? positionAnalysis;
  const whiteAdvantage = useMemo(() => {
    if (!trainUsesLivePositionEval && activeTrainMoveReview?.whiteEvalCp != null) {
      return getAdvantageMeterFromEvalCp(activeTrainMoveReview.whiteEvalCp);
    }

    if (displayAnalysis) {
      return getAdvantageMeter(displayAnalysis);
    }

    if (activeDeckCard && historyIndex > 0) {
      const whiteEvalCp = activeDeckCard.moveReviews[historyIndex - 1]?.whiteEvalCp;

      if (whiteEvalCp != null) {
        return getAdvantageMeterFromEvalCp(whiteEvalCp);
      }
    }

    return getAdvantageMeter(displayAnalysis);
  }, [activeDeckCard, activeTrainMoveReview, displayAnalysis, historyIndex, trainUsesLivePositionEval]);
  const boardScoreLabel = useMemo(() => {
    if (!trainUsesLivePositionEval && activeTrainMoveReview?.whiteEvalCp != null) {
      return formatEvalCpLabel(activeTrainMoveReview.whiteEvalCp, orientation);
    }

    if (displayAnalysis) {
      return formatScoreLabel(displayAnalysis, orientation);
    }

    if (activeDeckCard && historyIndex > 0) {
      const whiteEvalCp = activeDeckCard.moveReviews[historyIndex - 1]?.whiteEvalCp;

      if (whiteEvalCp != null) {
        return formatEvalCpLabel(whiteEvalCp, orientation);
      }
    }

    return formatScoreLabel(displayAnalysis, orientation);
  }, [activeDeckCard, activeTrainMoveReview, displayAnalysis, historyIndex, orientation, trainUsesLivePositionEval]);
  const isTrainCardFinished =
    activeDeckCard != null && deckFeedback != null && !deckFeedback.pending;
  const isAtDeckFailureFeedbackView =
    activeDeckCard != null &&
    isTrainCardFinished &&
    deckFeedback != null &&
    !deckFeedback.correct &&
    deckFeedbackArrowsVisible &&
    historyIndex === moveHistory.length;
  const isViewingDeckFailurePosition =
    isAtDeckFailureFeedbackView && isOpponentTurnFromFen(currentFen, activeDeckCard.side);
  const trainReplayBestMoveUci = useMemo(() => {
    if (!isTrainCardFinished || !activeDeckCard) {
      return null;
    }

    return resolveTrainReplayBestMoveUci(
      activeDeckCard,
      historyIndex,
      moveHistory,
      trainPositionAnalyses,
      positionAnalysis,
    );
  }, [activeDeckCard, historyIndex, isTrainCardFinished, moveHistory, positionAnalysis, trainPositionAnalyses]);
  const reviewBestMoveArrow = showArrow && !activeDeckCard ? getBestMoveArrow(displayAnalysis?.bestMove ?? null) : [];
  const deckAnswerArrow = isAtDeckFailureFeedbackView ? getBestMoveArrow(activeDeckCard.answerUci) : [];
  const trainBestMoveArrow =
    isTrainCardFinished && !isAtDeckFailureFeedbackView
      ? getBestMoveArrow(trainReplayBestMoveUci)
      : [];
  const deckOpponentArrow =
    isViewingDeckFailurePosition && !positionLoading && positionAnalysis?.bestMove
      ? getBestMoveArrow(positionAnalysis?.bestMove ?? null, '#ff456f')
      : [];
  const deckOpponentBestSan =
    isViewingDeckFailurePosition && !positionLoading && positionAnalysis?.bestMove
      ? formatBestMove(currentFen, positionAnalysis.bestMove)
      : null;
  const boardArrows = activeDeckCard
    ? dedupeBoardArrows([...trainBestMoveArrow, ...deckAnswerArrow, ...deckOpponentArrow])
    : reviewBestMoveArrow;
  const whiteReviewName = metadata?.whitePlayer ?? 'White';
  const blackReviewName = metadata?.blackPlayer ?? 'Black';
  const whiteBoardPlayer = useMemo(
    () => ({
      color: 'white' as const,
      name: whiteReviewName,
      elo: metadata?.whiteElo ?? '',
      avatarUrl: whiteAvatarUrl,
      captured: buildCapturedPieces(currentMoves, 'white'),
      materialAdvantage: Math.max(0, getCapturedMaterialValue(currentMoves, 'white') - getCapturedMaterialValue(currentMoves, 'black')),
    }),
    [currentMoves, metadata?.whiteElo, whiteAvatarUrl, whiteReviewName],
  );
  const blackBoardPlayer = useMemo(
    () => ({
      color: 'black' as const,
      name: blackReviewName,
      elo: metadata?.blackElo ?? '',
      avatarUrl: blackAvatarUrl,
      captured: buildCapturedPieces(currentMoves, 'black'),
      materialAdvantage: Math.max(0, getCapturedMaterialValue(currentMoves, 'black') - getCapturedMaterialValue(currentMoves, 'white')),
    }),
    [blackAvatarUrl, blackReviewName, currentMoves, metadata?.blackElo],
  );
  const topBoardPlayer = orientation === 'white' ? blackBoardPlayer : whiteBoardPlayer;
  const bottomBoardPlayer = orientation === 'white' ? whiteBoardPlayer : blackBoardPlayer;
  const sortedDeckCards = useMemo(
    () => sortCardsForReview(deckCards, deckProgress),
    [deckCards, deckProgress],
  );
  const availableDeckCards = useMemo(
    () => getDeckStudyQueue(sortedDeckCards, deckProgress),
    [deckProgress, sortedDeckCards],
  );
  const trainStatsCards = trainAllSession ? trainAllQueue : deckCards;
  const deckStats = useMemo(() => summarizeDeckProgress(trainStatsCards, deckProgress), [deckProgress, trainStatsCards]);
  const trainSessionCardTotal = trainAllSession ? trainAllQueue.length : availableDeckCards.length;
  const trainSessionCardCurrent = trainAllSession
    ? trainSessionIndex + 1
    : Math.max(
        1,
        (activeDeckCard ? availableDeckCards.findIndex(card => card.id === activeDeckCard.id) : deckIndex) + 1,
      );
  const nextDeckCard = availableDeckCards[deckIndex % Math.max(1, availableDeckCards.length)] ?? null;
  const viewedDeckCard = activeDeckCard ?? nextDeckCard;
  const selectedDeck = useMemo(
    () => deckSummaries.find(deck => deck.id === selectedDeckId) ?? null,
    [deckSummaries, selectedDeckId],
  );
  const activeDeckProgress = useMemo(
    () => (viewedDeckCard ? getDeckProgressEntry(deckProgress, viewedDeckCard.id) : null),
    [deckProgress, viewedDeckCard],
  );
  const deckLineMastery = useMemo(
    () => summarizeLineMastery(deckCards, deckProgress),
    [deckCards, deckProgress],
  );
  const reviewPlayerSide = useMemo(() => {
    if (!metadata) {
      return null;
    }

    const username = chesscomUsername.trim().toLowerCase();

    if (!username) {
      return null;
    }

    if (metadata.whitePlayer.trim().toLowerCase() === username) {
      return 'white' as const;
    }

    if (metadata.blackPlayer.trim().toLowerCase() === username) {
      return 'black' as const;
    }

    return null;
  }, [chesscomUsername, metadata]);

  const [timelineReviews, setTimelineReviews] = useState<TimelineReview[]>([]);

  const gameReview = useMemo(() => buildGameReview(timelineReviews, metadata), [metadata, timelineReviews]);
  const reviewMoments = useMemo(
    () => filterReviewMoments(gameReview.keyMoments, reviewSide),
    [gameReview.keyMoments, reviewSide],
  );
  const activeReviewMoment = reviewMoments[reviewIndex] ?? null;
  const boardSquareStyles = useMemo(() => {
    const nextStyles: Record<string, CSSProperties> = {};
    const lastMove = currentMoves[currentMoves.length - 1];
    const reviewCategory = activeDeckCard
      ? activeTrainMoveReview?.category ?? null
      : hasLoadedGame && variationBaseIndex == null && historyIndex > 0
        ? timelineReviews[historyIndex - 1]?.category
        : null;
    const lastMoveStyle = getReviewMoveStyle(reviewCategory);

    if (lastMove) {
      nextStyles[lastMove.from] = lastMoveStyle;
      nextStyles[lastMove.to] = lastMoveStyle;
    }

    return {
      ...nextStyles,
      ...squareStyles,
    };
  }, [activeDeckCard, activeTrainMoveReview, currentMoves, hasLoadedGame, historyIndex, squareStyles, timelineReviews, variationBaseIndex]);
  const boardReviewBadge = useMemo(() => {
    if (historyIndex <= 0 || variationBaseIndex != null) {
      return null;
    }

    const lastMove = currentMoves[currentMoves.length - 1];
    const category = activeDeckCard
      ? activeTrainMoveReview?.category ?? null
      : hasLoadedGame
        ? timelineReviews[historyIndex - 1]?.category
        : null;

    if (!lastMove || !category) {
      return null;
    }

    const meta = reviewCategoryMeta[category];
    const placement = getBoardSquareCenter(lastMove.to, orientation, boardWidth);

    if (!meta?.badge || !placement) {
      return null;
    }

    return {
      badge: meta.badge,
      color: meta.color,
      ...placement,
    };
  }, [activeDeckCard, activeTrainMoveReview, boardWidth, currentMoves, hasLoadedGame, historyIndex, orientation, timelineReviews, variationBaseIndex]);

  const movePairs = useMemo(() => {
    const pairs: Array<{
      moveNumber: number;
      white: StoredMove | null;
      whitePly: number;
      black: StoredMove | null;
      blackPly: number;
    }> = [];

    for (let index = 0; index < moveHistory.length; index += 2) {
      pairs.push({
        moveNumber: index / 2 + 1,
        white: moveHistory[index] ?? null,
        whitePly: index + 1,
        black: moveHistory[index + 1] ?? null,
        blackPly: index + 2,
      });
    }

    return pairs;
  }, [moveHistory]);

  const playSound = useCallback((soundKey: ChessSoundKey) => {
    const base = soundPlayersRef.current[soundKey];

    if (!base) {
      return;
    }

    const player = base.cloneNode(true) as HTMLAudioElement;
    player.currentTime = 0;
    void player.play().catch(() => undefined);
  }, []);

  const playSoundSequence = useCallback(
    (soundKeys: ChessSoundKey[]) => {
      soundKeys.forEach((soundKey, index) => {
        window.setTimeout(() => playSound(soundKey), index * 110);
      });
    },
    [playSound],
  );

  const fetchCachedPositionAnalysis = useCallback(
    (
      cacheKey: string,
      fen: string,
      moves: string[],
      requestInitialFen = initialFen,
      profile: PositionAnalysisProfile = 'review',
    ) => {
      const cachedAnalysis = positionCacheRef.current.get(cacheKey);

      if (cachedAnalysis) {
        return Promise.resolve(cachedAnalysis);
      }

      const inFlight = positionInFlightRef.current.get(cacheKey);

      if (inFlight) {
        return inFlight;
      }

      const buildRequest = profile === 'training' ? buildDeterministicAnalyzeRequest : buildReviewAnalyzeRequest;
      const request = analyzeSinglePosition(
        buildRequest({
          fen,
          initialFen: requestInitialFen,
          moves,
        }),
      )
        .then(analysis => {
          positionCacheRef.current.set(cacheKey, analysis);
          return analysis;
        })
        .finally(() => {
          positionInFlightRef.current.delete(cacheKey);
        });

      positionInFlightRef.current.set(cacheKey, request);
      return request;
    },
    [initialFen],
  );

  const analyzeTimelineDeep = useCallback(
    async (
      moves: StoredMove[],
      requestInitialFen: string | null,
      onProgress?: (progress: number) => void,
      label = 'review',
      signal?: AbortSignal,
    ) => {
      const positions = buildTimelineSequencePositions(moves, requestInitialFen);

      return runTimelineAnalysisDedupe({
        label,
        positions,
        signal,
        cache: positionCacheRef.current,
        positionInFlight: positionInFlightRef.current,
        batchInFlight: timelineBatchInFlightRef.current,
        batchSize: TIMELINE_ANALYSIS_BATCH_SIZE,
        getCacheKey: position => getTimelinePositionCacheKey(requestInitialFen, position.moves ?? []),
        buildRequest: position => buildReviewAnalyzeRequest({
          ...position,
          initialFen: requestInitialFen,
        }),
        analyzeBatch: async (batchPositions, batchSignal) => {
          const response = await analyzeGamePositions({
            positions: batchPositions,
            depth: REVIEW_ANALYSIS_PROFILE.depth,
          }, batchSignal);
          return response.analyses ?? [];
        },
        onProgress,
      });
    },
    [],
  );

  const cancelRecentPreload = useCallback((reason: string) => {
    const hadPreload = recentPreloadBusyRef.current || recentPreloadAbortRef.current != null;
    recentPreloadRequestIdRef.current += 1;
    recentPreloadAbortRef.current?.abort();
    recentPreloadAbortRef.current = null;
    recentPreloadBusyRef.current = false;
    timelineBatchInFlightRef.current.clear();
    positionInFlightRef.current.clear();
    if (hadPreload) {
      logRecentGamePreload('cancel', reason);
    }
  }, []);

  useEffect(() => {
    const stage = boardStageRef.current;

    if (!stage || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      const railRect = evalRailRef.current?.getBoundingClientRect();
      const stageWidth = entry.contentRect.width;
      const stageHeight = entry.contentRect.height;
      const gap = 26;
      const railWidth = railRect?.width ?? 0;
      const railHeight = railRect?.height ?? 0;
      const isHorizontalRail = railWidth > railHeight * 1.6;
      const availableWidth = isHorizontalRail ? stageWidth - 12 : stageWidth - railWidth - gap;
      const playerChromeHeight = 84;
      const availableHeight = (isHorizontalRail ? stageHeight - railHeight - gap : stageHeight - 12) - playerChromeHeight;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth || stageWidth;
      const isMobileViewport = viewportWidth <= 720;
      const mobileWidthLimit = isMobileViewport ? viewportWidth - 16 : Number.POSITIVE_INFINITY;
      const heightLimit = isMobileViewport ? Number.POSITIVE_INFINITY : Math.max(0, availableHeight);

      setBoardWidth(Math.max(
        188,
        Math.floor(Math.min(
          Math.max(0, availableWidth),
          heightLimit,
          mobileWidthLimit,
        )),
      ));
    });

    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const fetchRecentChessGames = useCallback(
    async (usernameOverride?: string, timeClassOverride?: ChessComRecentGameTimeClass, append = false, quiet = false) => {
      const requestId = ++recentFetchRequestIdRef.current;
      const username = (usernameOverride ?? chesscomUsername).trim().toLowerCase();
      const timeClass = timeClassOverride ?? recentGameTimeClass;
      const offset = append && !recentChessGamesNextCursor ? recentChessGamesNextOffset : 0;
      const cursor = append ? recentChessGamesNextCursor : null;

      if (!username) {
        setRecentChessGames([]);
        setRecentChessGamesHasMore(false);
        setRecentChessGamesNextOffset(0);
        setRecentChessGamesNextCursor(null);
        setRecentChessGamesError('Enter a Chess.com username.');
        return;
      }

      if (!quiet) {
        setRecentChessGamesLoading(true);
      }
      if (!append) {
        setRecentChessGamesError('');
      }

      try {
        writeCookie(CHESSCOM_USERNAME_COOKIE, username);
        writeCookie(CHESSCOM_TIME_CLASS_COOKIE, timeClass);
        const params = new URLSearchParams({
          username,
          timeClass,
          count: String(RECENT_GAMES_PAGE_SIZE),
          offset: String(offset),
        });

        if (cursor) {
          params.set('cursor', cursor);
        }

        const response = await fetch(`/api/chesscom/recent-games?${params.toString()}`);
        const payload = (await response.json()) as {
          error?: string;
          games?: ChessComRecentGameSummary[];
          hasMore?: boolean;
          nextCursor?: string | null;
          nextOffset?: number;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? `Chess.com fetch failed: HTTP ${response.status}`);
        }

        if (recentFetchRequestIdRef.current !== requestId) {
          return;
        }

        const nextGames = Array.isArray(payload.games) ? payload.games : [];
        setRecentChessGames(current => {
          const merged = append ? [...current, ...nextGames] : nextGames;
          return [...new Map(merged.map(game => [game.link || game.url, game])).values()].sort(
            (left, right) => Number(right.endTime ?? 0) - Number(left.endTime ?? 0),
          );
        });
        setRecentChessGamesHasMore(Boolean(payload.hasMore));
        setRecentChessGamesNextCursor(payload.nextCursor ?? null);
        setRecentChessGamesNextOffset(typeof payload.nextOffset === 'number' ? payload.nextOffset : offset + nextGames.length);
      } catch (error) {
        if (recentFetchRequestIdRef.current !== requestId) {
          return;
        }
        setRecentChessGamesError(error instanceof Error ? error.message : 'Unable to fetch Chess.com games.');
      } finally {
        if (recentFetchRequestIdRef.current === requestId && !quiet) {
          setRecentChessGamesLoading(false);
        }
      }
    },
    [chesscomUsername, recentChessGamesNextCursor, recentChessGamesNextOffset, recentGameTimeClass],
  );

  const saveTrainingProgress = useCallback(async (progress: DeckProgressMap) => {
    try {
      await fetch('/api/training-progress', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ progress }),
      });
    } catch {
      // Local storage remains the fallback when server sync is unavailable.
    }
  }, []);

  const saveTrainingAttempt = useCallback(async (card: DeckCard, feedback: DeckFeedback) => {
    try {
      await fetch('/api/training-progress', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          attempt: {
            cardId: card.id,
            playedUci: feedback.playedUci,
            playedSan: feedback.playedSan,
            expectedUci: card.answerUci,
            expectedSan: feedback.expectedSan,
            correct: feedback.correct,
            exact: feedback.exact,
            evalLossCp: feedback.evalLossCp ?? null,
          },
        }),
      });
    } catch {
      // Progress still syncs separately; attempts are best-effort telemetry.
    }
  }, []);

  const hydrateTrainingProgressRef = useRef<(options: { saveMerged: boolean }) => Promise<void>>(async () => undefined);

  const hydrateTrainingProgress = useCallback(
    async (options: { saveMerged: boolean }) => {
      try {
        const response = await fetch('/api/training-progress', { credentials: 'same-origin' });
        const payload = (await response.json()) as { progress?: DeckProgressMap; error?: string };
        const serverProgress = response.ok && payload.progress ? payload.progress : {};

        if (!response.ok && typeof window !== 'undefined') {
          window.localStorage.removeItem(DECK_PROGRESS_STORAGE_KEY);
        }
        let mergedProgress: DeckProgressMap | null = null;

        setDeckProgress(current => {
          mergedProgress = mergeDeckProgress(serverProgress, current);

          if (typeof window !== 'undefined' && deckCards.length > 0) {
            const validCardIds = new Set(deckCards.map(card => card.id));
            mergedProgress = Object.fromEntries(
              Object.entries(mergedProgress).filter(([cardId]) => validCardIds.has(cardId)),
            );
          }

          return mergedProgress;
        });

        progressHydratedRef.current = true;

        if (options.saveMerged && mergedProgress) {
          await saveTrainingProgress(mergedProgress);
        }
      } catch {
        progressHydratedRef.current = true;
      }
    },
    [deckCards, saveTrainingProgress],
  );

  useEffect(() => {
    hydrateTrainingProgressRef.current = hydrateTrainingProgress;
  }, [hydrateTrainingProgress]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(DECK_PROGRESS_STORAGE_KEY);

      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as DeckProgressMap;
      setDeckProgress(parsed && typeof parsed === 'object' ? parsed : {});
    } catch {
      setDeckProgress({});
    }
  }, []);

  useLayoutEffect(() => {
    if (trainingCredentialsHydratedRef.current) {
      return;
    }

    trainingCredentialsHydratedRef.current = true;
    const savedUsername = readStoredTrainingUsername();
    const savedPassword = readStoredTrainingPassword();

    if (savedUsername) {
      setTrainingUsername(savedUsername);
    }

    if (savedPassword) {
      setTrainingPassword(savedPassword);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (trainingUsername.trim()) {
      persistTrainingUsername(trainingUsername.trim());
    }
  }, [trainingUsername]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (trainingPassword) {
      persistTrainingPassword(trainingPassword);
    }
  }, [trainingPassword]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(DECK_PROGRESS_STORAGE_KEY, JSON.stringify(deckProgress));
  }, [deckProgress]);

  useEffect(() => {
    let cancelled = false;

    async function restoreTrainingProfile(username: string, password: string) {
      const response = await fetch('/api/training-profile', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json()) as { profile?: TrainingProfile | null; error?: string };

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? 'Unable to restore training profile.');
      }

      return payload.profile;
    }

    async function loadTrainingProfile() {
      setTrainingProfileError('');

      const savedUsername = readStoredTrainingUsername();
      const savedPassword = readStoredTrainingPassword();

      if (savedUsername) {
        setTrainingUsername(savedUsername);
      }

      if (savedPassword) {
        setTrainingPassword(savedPassword);
      }

      try {
        const response = await fetch('/api/training-profile', { credentials: 'same-origin' });
        const payload = (await response.json()) as { profile?: TrainingProfile | null };

        if (cancelled) {
          return;
        }

        if (payload.profile) {
          setTrainingProfile(payload.profile);
          setTrainingUsername(payload.profile.username);
          await hydrateTrainingProgressRef.current({ saveMerged: false });
          return;
        }

        if (savedUsername && savedPassword) {
          const profile = await restoreTrainingProfile(savedUsername, savedPassword);

          if (cancelled) {
            return;
          }

          setTrainingProfile(profile);
          setTrainingUsername(profile.username);
          await hydrateTrainingProgressRef.current({ saveMerged: false });
          return;
        }

        setTrainingProfile(null);
      } catch (error) {
        if (!cancelled) {
          setTrainingProfile(null);
          setTrainingProfileError(error instanceof Error ? error.message : 'Unable to load training profile.');
        }
      } finally {
        progressHydratedRef.current = true;

        if (!cancelled) {
          setTrainingProfileBootstrapping(false);
        }
      }
    }

    void loadTrainingProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!trainingProfile || !progressHydratedRef.current) {
      return undefined;
    }

    if (progressSyncTimerRef.current != null) {
      window.clearTimeout(progressSyncTimerRef.current);
    }

    progressSyncTimerRef.current = window.setTimeout(() => {
      void saveTrainingProgress(deckProgress);
    }, 450);

    return () => {
      if (progressSyncTimerRef.current != null) {
        window.clearTimeout(progressSyncTimerRef.current);
      }
    };
  }, [deckProgress, saveTrainingProgress, trainingProfile]);

  useEffect(() => {
    const savedUsername = readCookie(CHESSCOM_USERNAME_COOKIE);
    const savedTimeClass = readCookie(CHESSCOM_TIME_CLASS_COOKIE);

    if (savedUsername) {
      setChesscomUsername(savedUsername);
    }

    if (savedTimeClass === 'all' || savedTimeClass === 'bullet' || savedTimeClass === 'blitz' || savedTimeClass === 'rapid') {
      setRecentGameTimeClass(savedTimeClass);
    }
  }, []);

  useEffect(() => {
    const markInteraction = () => {
      lastReviewInteractionAtRef.current = Date.now();
    };

    window.addEventListener('pointerdown', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction);

    return () => {
      window.removeEventListener('pointerdown', markInteraction);
      window.removeEventListener('keydown', markInteraction);
    };
  }, []);

  useEffect(() => {
    const username = chesscomUsername.trim().toLowerCase();

    if (!username || recentAutoFetchStartedRef.current) {
      return;
    }

    recentAutoFetchStartedRef.current = true;
    void fetchRecentChessGames(username, recentGameTimeClass, false, true);
  }, [chesscomUsername, fetchRecentChessGames, recentGameTimeClass]);

  useEffect(() => {
    if (!chesscomUsername.trim()) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      if (modeRef.current !== 'review' || document.visibilityState !== 'visible') {
        return;
      }

      void fetchRecentChessGames(undefined, undefined, false, true);
    }, RECENT_GAMES_AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [chesscomUsername, fetchRecentChessGames]);

  const preloadRecentGameAnalysis = useCallback(async () => {
    if (recentPreloadBusyRef.current) {
      return;
    }

    if (
      modeRef.current !== 'review' ||
      document.visibilityState !== 'visible' ||
      timelineLoading ||
      positionLoading ||
      positionInFlightRef.current.size > 0 ||
      Date.now() - lastReviewInteractionAtRef.current < RECENT_GAMES_INTERACTION_IDLE_MS
    ) {
      return;
    }

    const nextGame = [...recentChessGames]
      .sort((left, right) => Number(right.endTime ?? 0) - Number(left.endTime ?? 0))
      .find(game => {
        const cacheKey = getRecentGameCacheKey(game);
        return cacheKey !== activeRecentGameCacheKeyRef.current && !recentPreloadedKeysRef.current.has(cacheKey);
      });

    if (!nextGame?.pgn) {
      return;
    }

    const cacheKey = getRecentGameCacheKey(nextGame);
    recentPreloadedKeysRef.current.add(cacheKey);
    recentPreloadBusyRef.current = true;
    let requestId = 0;
    let preloadAbortController: AbortController | null = null;

    try {
      const cached = await loadCachedTimelineAnalysis(cacheKey);
      if (cached) {
        logRecentGamePreload('cache', `${formatRecentGameLogLabel(nextGame)} ${cached.timelineAnalyses.length} plies`);
        setRecentPreloadTick(tick => tick + 1);
        return;
      }

      requestId = ++recentPreloadRequestIdRef.current;
      preloadAbortController = new AbortController();
      recentPreloadAbortRef.current = preloadAbortController;
      const preloadPromise = (async (): Promise<CachedTimelineAnalysis | null> => {
        const preloadGame = new Chess();
        preloadGame.loadPgn(nextGame.pgn);
        const nextInitialFen = preloadGame.header().FEN ?? null;
        const nextHistory = preloadGame.history({ verbose: true }).map(toStoredMove);

        if (nextHistory.length === 0) {
          return null;
        }

        logRecentGamePreload('start', `${formatRecentGameLogLabel(nextGame)} ${nextHistory.length} plies`);
        const sequence = await analyzeTimelineDeep(
          nextHistory,
          nextInitialFen,
          undefined,
          `preload:${formatRecentGameLogLabel(nextGame)}`,
          preloadAbortController.signal,
        );

        if (recentPreloadRequestIdRef.current !== requestId) {
          return null;
        }

        const analysis = {
          quality: 'refined',
          version: GAME_ANALYSIS_CACHE_VERSION,
          preMoveAnalyses: sequence.slice(0, -1),
          timelineAnalyses: sequence.slice(1),
        } satisfies CachedTimelineAnalysis;

        await saveCachedTimelineAnalysis({
          cacheKey,
          gameLink: nextGame.link || nextGame.url,
          pgn: nextGame.pgn,
          preMoveAnalyses: analysis.preMoveAnalyses,
          timelineAnalyses: analysis.timelineAnalyses,
        });
        return analysis;
      })();

      recentGameAnalysisInFlightCache.set(cacheKey, preloadPromise);

      const analysis = await preloadPromise;
      if (analysis) {
        recentGameAnalysisMemoryCache.set(cacheKey, analysis);
        logRecentGamePreload('done', `${formatRecentGameLogLabel(nextGame)} ${analysis.timelineAnalyses.length} plies`);
      } else {
        logRecentGamePreload('skip', `${formatRecentGameLogLabel(nextGame)} stale`);
      }
      setRecentPreloadTick(tick => tick + 1);
    } catch (error) {
      recentPreloadedKeysRef.current.delete(cacheKey);
      const message = error instanceof Error ? error.message : String(error);
      logRecentGamePreload(message === 'Analysis aborted.' ? 'cancel' : 'fail', `${formatRecentGameLogLabel(nextGame)} ${message}`);
    } finally {
      if (requestId === 0 || recentPreloadRequestIdRef.current === requestId) {
        recentPreloadBusyRef.current = false;
        if (preloadAbortController && recentPreloadAbortRef.current === preloadAbortController) {
          recentPreloadAbortRef.current = null;
        }
      }
      recentGameAnalysisInFlightCache.delete(cacheKey);
    }
  }, [analyzeTimelineDeep, positionLoading, recentChessGames, timelineLoading]);

  useEffect(() => {
    if (recentChessGames.length === 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void preloadRecentGameAnalysis();
    }, RECENT_GAMES_PRELOAD_SCAN_MS);

    return () => window.clearInterval(timer);
  }, [preloadRecentGameAnalysis, recentChessGames, recentPreloadTick, timelineAnalyses, timelineLoading, positionLoading]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const players = Object.fromEntries(
      Object.entries(CHESS_SOUND_URLS).map(([key, url]) => {
        const audio = new Audio(url);
        audio.preload = 'auto';
        return [key, audio];
      }),
    ) as Partial<Record<ChessSoundKey, HTMLAudioElement>>;

    soundPlayersRef.current = players;
  }, []);

  const beginDeckCardSession = useCallback((card: DeckCard, lines: OpeningSeedLine[]) => {
    persistReviewWorkspaceSnapshot();
    deckCardPromptStartedAtRef.current = null;
    const deckState = buildDeckCardStartState(card, lines);

    setInitialFen(deckState.initialFen);
    setMoveHistory(deckState.moveHistory);
    setHistoryIndex(deckState.historyIndex);
    clearVariation();
    setGame(deckState.game);
    setMetadata(null);
    setFileName('');
    setPreMoveAnalyses([]);
    timelineRefineRequestIdRef.current += 1;
    setMode('train');
    modeRef.current = 'train';
    setActiveDeckCard(card);
    setDeckFeedback(null);
    setDeckFeedbackArrowsVisible(false);
    setOrientation(card.side);
    setShowArrow(false);
    setPositionAnalysis(null);
    setTimelineAnalyses([]);
    setTimelineError('');
    clearSelection();
    deckReplayMovesRef.current = deckState.moveHistory;
    deckReplayInitialFenRef.current = deckState.initialFen;

    if (deckState.replayTargetIndex > 0) {
      playSound('game-start');
      return deckState.replayTargetIndex;
    }

    playSound('game-start');
    return 0;
  }, [playSound]);

  const playDeckReplayToIndex = useCallback(async (targetIndex: number, trainSide: DeckCard['side']) => {
    const requestId = ++deckPlaybackRequestIdRef.current;
    const moves = deckReplayMovesRef.current;
    const startFen = deckReplayInitialFenRef.current;
    const boundedTarget = Math.max(0, Math.min(targetIndex, moves.length));

    if (boundedTarget === 0) {
      return true;
    }

    setDeckPlaybackBusy(true);

    for (let nextIndex = 1; nextIndex <= boundedTarget; nextIndex += 1) {
      if (deckPlaybackRequestIdRef.current !== requestId) {
        setDeckPlaybackBusy(false);
        return false;
      }

      const nextGame = restoreGameFromHistory(moves, startFen, nextIndex);
      const replayedMove = moves[nextIndex - 1];

      if (replayedMove) {
        const isSelfMove =
          (trainSide === 'white' && replayedMove.color === 'w') || (trainSide === 'black' && replayedMove.color === 'b');

        playSoundSequence(
          getMoveSoundSequence({
            move: replayedMove,
            isSelfMove,
            isCheck: nextGame.isCheck(),
            isCheckmate: nextGame.isCheckmate(),
            isGameOver: nextGame.isGameOver(),
          }),
        );
      }

      setHistoryIndex(nextIndex);
      setDeckFeedbackArrowsVisible(false);
      clearVariation();
      setGame(nextGame);
      clearSelection();
      await delay(TRAINING_REPLAY_MOVE_MS);
    }

    if (deckPlaybackRequestIdRef.current === requestId) {
      setDeckPlaybackBusy(false);
      return true;
    }

    return false;
  }, [clearSelection, playSoundSequence]);

  const startDeckCardWithReplay = useCallback(async (card: DeckCard, lines: OpeningSeedLine[]) => {
    deckPlaybackRequestIdRef.current += 1;
    const replayTargetIndex = beginDeckCardSession(card, lines);

    if (replayTargetIndex > 0) {
      const replayCompleted = await playDeckReplayToIndex(replayTargetIndex, card.side);

      if (!replayCompleted) {
        return;
      }
    }

    deckCardPromptStartedAtRef.current = Date.now();
  }, [beginDeckCardSession, playDeckReplayToIndex]);

  const loadTrainingDeck = useCallback(async (deckId?: string | null, options?: { autoStart?: boolean; allDecks?: boolean; libraryLoading?: boolean }) => {
    const resolvedDeckId = deckId ?? selectedDeckIdRef.current;
    const libraryLoading = options?.libraryLoading !== false;
    const requestId = ++deckLoadRequestIdRef.current;

    if (libraryLoading) {
      setDeckLibraryLoading(true);
    } else {
      setDeckCardsLoading(true);
    }

    setDeckLoadError('');

    try {
      const query = options?.allDecks ? '?scope=all' : resolvedDeckId ? `?deckId=${encodeURIComponent(resolvedDeckId)}` : '';
      const response = await fetch(`/api/training-deck${query}`, { credentials: 'same-origin' });
      const payload = await readJsonResponse<TrainingDeckPayload>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? `Training deck fetch failed: HTTP ${response.status}`);
      }

      setDeckSummaries(payload.decks ?? []);

      if (
        typeof window !== 'undefined' &&
        resolvedDeckId &&
        !(payload.decks ?? []).some(deck => deck.id === resolvedDeckId)
      ) {
        window.localStorage.removeItem(LAST_TRAINING_DECK_STORAGE_KEY);
      }

      const lines = (payload.lines ?? []).map(line => ({
        id: String(line.id),
        name: String(line.name),
        eco: String(line.eco),
        side: (line.side === 'black' ? 'black' : 'white') as OpeningSeedLine['side'],
        moves: Array.isArray(line.moves) ? line.moves.map(move => String(move)) : [],
      }));
      const cards = (payload.cards ?? []).map(mapTrainingDeckCard);

      if (options?.allDecks) {
        const mixedCards = buildMixedTrainingQueue(cards, deckProgressRef.current);
        setTrainAllQueue(mixedCards);
        setTrainSessionIndex(0);
        setTrainSessionStats(createEmptyTrainSessionStats());
        setOpeningLines(lines);
        setDeckCards(cards);
        setDeckIndex(0);

        if (options.autoStart && mixedCards.length > 0) {
          setTrainAllSession(true);
          await startDeckCardWithReplay(mixedCards[0], lines);
        }

        return;
      }

      if (!payload.deck) {
        setOpeningLines([]);
        setDeckCards([]);
        setSelectedDeckId(null);
        return;
      }

      setSelectedDeckId(payload.deck.id);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LAST_TRAINING_DECK_STORAGE_KEY, payload.deck.id);
      }
      setOpeningLines(lines);
      setDeckCards(cards);
      setDeckIndex(0);

      if (options?.autoStart && cards.length > 0) {
        const nextCard = getDeckStudyQueue(cards, deckProgressRef.current)[0] ?? null;

        if (nextCard) {
          await startDeckCardWithReplay(nextCard, lines);
        }
      }
    } catch (error) {
      setOpeningLines([]);
      setDeckCards([]);

      if (libraryLoading) {
        setDeckSummaries([]);
      }

      setDeckLoadError(normalizeDeckLoadError(error instanceof Error ? error.message : 'Unable to load Supabase deck.'));
    } finally {
      if (requestId !== deckLoadRequestIdRef.current) {
        return;
      }

      if (libraryLoading) {
        setDeckLibraryLoading(false);
      } else {
        setDeckCardsLoading(false);
      }
    }
  }, [startDeckCardWithReplay]);

  const loadOpeningTreeDetail = useCallback(async (treeId: string) => {
    setOpeningTreeActionError('');

    try {
      const response = await fetch(`/api/opening-trees?treeId=${encodeURIComponent(treeId)}`, { credentials: 'same-origin' });
      const payload = await readJsonResponse<OpeningTreesPayload>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? `Opening tree fetch failed: HTTP ${response.status}`);
      }

      setActiveOpeningTree(payload.tree ?? null);
      setActiveOpeningNodeId(payload.tree?.nodes[0]?.id ?? null);
    } catch (error) {
      setOpeningTreeActionError(error instanceof Error ? error.message : 'Unable to load opening tree.');
      setActiveOpeningTree(null);
    }
  }, []);

  const loadOpeningTrees = useCallback(async () => {
    setOpeningTreesLoading(true);
    setOpeningTreeActionError('');

    try {
      const response = await fetch('/api/opening-trees', { credentials: 'same-origin' });
      const payload = await readJsonResponse<OpeningTreesPayload>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? `Opening trees fetch failed: HTTP ${response.status}`);
      }

      const nextTrees = payload.trees ?? [];
      setOpeningTrees(nextTrees);
      const nextSelectedId = selectedOpeningTreeId && nextTrees.some(tree => tree.id === selectedOpeningTreeId)
        ? selectedOpeningTreeId
        : nextTrees[0]?.id ?? null;

      setSelectedOpeningTreeId(nextSelectedId);

      if (nextSelectedId) {
        await loadOpeningTreeDetail(nextSelectedId);
      } else {
        setActiveOpeningTree(null);
        setActiveOpeningNodeId(null);
      }
    } catch (error) {
      setOpeningTreeActionError(error instanceof Error ? error.message : 'Unable to load opening trees.');
      setOpeningTrees([]);
    } finally {
      setOpeningTreesLoading(false);
    }
  }, [loadOpeningTreeDetail, selectedOpeningTreeId]);

  const importRecentOpeningTrees = useCallback(async () => {
    setOpeningTreeActionLoading(true);
    setOpeningTreeActionError('');

    try {
      const response = await fetch('/api/opening-trees', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'import_recent' }),
      });
      const payload = await readJsonResponse<OpeningTreesPayload>(response);

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to import opening trees.');
      }

      await loadOpeningTrees();
    } catch (error) {
      setOpeningTreeActionError(error instanceof Error ? error.message : 'Unable to import opening trees.');
    } finally {
      setOpeningTreeActionLoading(false);
    }
  }, [loadOpeningTrees]);

  const selectOpeningTree = useCallback((treeId: string) => {
    setSelectedOpeningTreeId(treeId);
    setOpeningDrillStatus('');
    setOpeningDrillExpected(null);
    void loadOpeningTreeDetail(treeId);
  }, [loadOpeningTreeDetail]);

  const startOpeningDrill = useCallback(() => {
    if (!activeOpeningTree) {
      return;
    }

    const firstTrainNode =
      activeOpeningTree.nodes.find(node => node.sideToMove === node.trainSide && node.masteryScore < 80) ??
      activeOpeningTree.nodes.find(node => node.sideToMove === node.trainSide) ??
      activeOpeningTree.nodes[0] ??
      null;

    if (!firstTrainNode) {
      setOpeningDrillStatus('No trainable node in this tree yet.');
      return;
    }

    positionRequestIdRef.current += 1;
    timelineRequestIdRef.current += 1;
    setMode('lines');
    modeRef.current = 'lines';
    setInitialFen(firstTrainNode.fen);
    setMoveHistory([]);
    setHistoryIndex(0);
    clearVariation();
    setGame(new Chess(firstTrainNode.fen));
    setMetadata(null);
    setFileName('');
    setPositionAnalysis(null);
    setPreMoveAnalyses([]);
    setTimelineAnalyses([]);
    setTimelineError('');
    setServerError('');
    setActiveOpeningNodeId(firstTrainNode.id);
    setOpeningDrillExpected({
      nodeId: firstTrainNode.id,
      uci: firstTrainNode.bestUci,
      san: firstTrainNode.bestSan,
    });
    setOrientation(firstTrainNode.trainSide);
    setShowArrow(false);
    setOpeningDrillStatus(firstTrainNode.bestSan ? 'Find the best move in this opening node.' : 'Analyze this node, then play the best move.');
    clearSelection();
    playSound('game-start');
  }, [activeOpeningTree, clearSelection, playSound]);

  const selectOpeningNode = useCallback((nodeId: string) => {
    const node = activeOpeningTree?.nodes.find(candidate => candidate.id === nodeId);

    setActiveOpeningNodeId(nodeId);

    if (node) {
      setInitialFen(node.fen);
      setMoveHistory([]);
      setHistoryIndex(0);
      clearVariation();
      setGame(new Chess(node.fen));
      setOpeningDrillExpected(node.sideToMove === node.trainSide ? { nodeId: node.id, uci: node.bestUci, san: node.bestSan } : null);
      setOpeningDrillStatus(node.sideToMove === node.trainSide ? 'Find the best move from this node.' : 'Opponent node selected.');
      setOrientation(node.trainSide);
      clearSelection();
    }
  }, [activeOpeningTree, clearSelection]);

  loadTrainingDeckRef.current = loadTrainingDeck;

  useEffect(() => {
    deckProgressRef.current = deckProgress;
  }, [deckProgress]);

  useEffect(() => {
    deckFeedbackRef.current = deckFeedback;
  }, [deckFeedback]);

  useEffect(() => {
    selectedDeckIdRef.current = selectedDeckId;
  }, [selectedDeckId]);

  useEffect(() => {
    if (!trainingProfile?.id || trainingProfileBootstrapping || trainAllSession) {
      if (!trainingProfile?.id) {
        lastDeckLibraryProfileIdRef.current = null;
      }

      return;
    }

    if (lastDeckLibraryProfileIdRef.current === trainingProfile.id) {
      return;
    }

    lastDeckLibraryProfileIdRef.current = trainingProfile.id;
    const storedDeckId = typeof window === 'undefined' ? null : window.localStorage.getItem(LAST_TRAINING_DECK_STORAGE_KEY);

    void loadTrainingDeckRef.current(storedDeckId, { libraryLoading: true });
  }, [trainingProfile?.id, trainingProfileBootstrapping, trainAllSession]);

  useEffect(() => {
    if (!trainingProfile?.id || trainingProfileBootstrapping) {
      setOpeningTrees([]);
      setActiveOpeningTree(null);
      setSelectedOpeningTreeId(null);
      setActiveOpeningNodeId(null);
      return;
    }

    void loadOpeningTrees();
  }, [loadOpeningTrees, trainingProfile?.id, trainingProfileBootstrapping]);

  useEffect(() => {
    const requestId = ++positionRequestIdRef.current;
    const positionProfile: PositionAnalysisProfile = activeDeckCard ? 'training' : 'review';
    const cacheKey = getPositionCacheKey(initialFen, currentMoveList, positionProfile);
    const cachedAnalysis = positionCacheRef.current.get(cacheKey);

    if (cachedAnalysis) {
      setPositionAnalysis(cachedAnalysis);
      setPositionLoading(false);
      setServerError('');
      return undefined;
    }

    setPositionLoading(true);
    setServerError('');
    setPositionAnalysis(null);

    fetchCachedPositionAnalysis(cacheKey, currentFen, currentMoveList, initialFen, positionProfile)
      .then(analysis => {
        if (positionRequestIdRef.current === requestId) {
          setPositionAnalysis(analysis);
        }
      })
      .catch(error => {
        if (positionRequestIdRef.current === requestId) {
          setPositionAnalysis(null);
          setServerError(error.message);
        }
      })
      .finally(() => {
        if (positionRequestIdRef.current === requestId) {
          setPositionLoading(false);
        }
      });

    return undefined;
  }, [activeDeckCard, currentFen, currentLineKey, currentMoveList, fetchCachedPositionAnalysis, initialFen]);

  useEffect(() => {
    if (!activeDeckCard || historyIndex <= 0) {
      return undefined;
    }

    const moveIndex = historyIndex - 1;
    const answerFeedback =
      deckFeedback && !deckFeedback.pending
        ? {
            correct: deckFeedback.correct,
            playedUci: deckFeedback.playedUci,
            evalLossCp: deckFeedback.evalLossCp,
          }
        : null;

    if (!shouldUseLiveTrainMoveReview(activeDeckCard, currentMoves, moveIndex, answerFeedback)) {
      return undefined;
    }

    const beforeMoveList = buildMoveUciHistory(currentMoves.slice(0, moveIndex));
    const beforeKey = getPositionCacheKey(initialFen, beforeMoveList, 'training');

    if (positionCacheRef.current.has(beforeKey)) {
      return undefined;
    }

    const beforeGame = restoreGameFromHistory(currentMoves, initialFen, moveIndex);

    void fetchCachedPositionAnalysis(beforeKey, beforeGame.fen(), beforeMoveList, initialFen, 'training')
      .then(() => {
        setTrainAnalysisTick(tick => tick + 1);
      })
      .catch(() => undefined);

    return undefined;
  }, [activeDeckCard, currentMoves, deckFeedback, fetchCachedPositionAnalysis, historyIndex, initialFen]);

  useEffect(() => {
    if (!activeDeckCard || !deckFeedback || deckFeedback.pending) {
      return undefined;
    }

    for (let index = 0; index <= moveHistory.length; index += 1) {
      const moves = buildMoveUciHistory(moveHistory.slice(0, index));
      const cacheKey = getPositionCacheKey(initialFen, moves, 'training');

      if (positionCacheRef.current.has(cacheKey) || positionInFlightRef.current.has(cacheKey)) {
        continue;
      }

      const game = restoreGameFromHistory(moveHistory, initialFen, index);

      void fetchCachedPositionAnalysis(cacheKey, game.fen(), moves, initialFen, 'training')
        .then(() => {
          setTrainAnalysisTick(tick => tick + 1);
        })
        .catch(() => undefined);
    }

    return undefined;
  }, [activeDeckCard, deckFeedback, fetchCachedPositionAnalysis, initialFen, moveHistory]);

  useEffect(() => {
    if (timelineLoading || moveHistory.length === 0 || historyIndex >= moveHistory.length) {
      return;
    }

    const timer = window.setTimeout(() => {
      const positionProfile: PositionAnalysisProfile = activeDeckCard ? 'training' : 'review';

      for (let index = historyIndex + 1; index <= Math.min(moveHistory.length, historyIndex + PRELOAD_AHEAD); index += 1) {
        const moves = buildMoveUciHistory(moveHistory.slice(0, index));
        const cacheKey = getPositionCacheKey(initialFen, moves, positionProfile);

        if (positionCacheRef.current.has(cacheKey) || positionInFlightRef.current.has(cacheKey)) {
          continue;
        }

        const nextGame = restoreGameFromHistory(moveHistory, initialFen, index);
        void fetchCachedPositionAnalysis(cacheKey, nextGame.fen(), moves, initialFen, positionProfile).catch(() => undefined);
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [activeDeckCard, fetchCachedPositionAnalysis, historyIndex, initialFen, moveHistory, timelineLoading]);

  useEffect(() => {
    setReviewIndex(value => Math.max(0, Math.min(value, Math.max(0, reviewMoments.length - 1))));
  }, [reviewMoments.length]);

  function clearSelection() {
    setSelectedSquare(null);
    setSquareStyles({});
  }

  function clearVariation() {
    setVariationBaseIndex(null);
    setVariationMoves([]);
  }

  const applyWorkspaceSnapshot = useCallback((snapshot: WorkspaceSnapshot) => {
    positionRequestIdRef.current += 1;
    timelineRequestIdRef.current += 1;
    timelineRefineRequestIdRef.current += 1;
    const nextGame = restoreGameFromHistory(snapshot.moveHistory, snapshot.initialFen, snapshot.historyIndex);

    setInitialFen(snapshot.initialFen);
    setMoveHistory(snapshot.moveHistory);
    setHistoryIndex(snapshot.historyIndex);
    setVariationBaseIndex(snapshot.variationBaseIndex);
    setVariationMoves(snapshot.variationMoves);
    setGame(nextGame);
    setMetadata(snapshot.metadata);
    setWhiteAvatarUrl(snapshot.whiteAvatarUrl);
    setBlackAvatarUrl(snapshot.blackAvatarUrl);
    setFileName(snapshot.fileName);
    setOrientation(snapshot.orientation);
    setShowArrow(snapshot.showArrow);
    setReviewIndex(snapshot.reviewIndex);
    setActiveDeckCard(snapshot.activeDeckCard);
    setDeckFeedback(snapshot.deckFeedback);
    setDeckFeedbackArrowsVisible(false);
    setDeckIndex(snapshot.deckIndex);
    setTrainAllSession(snapshot.trainAllSession);
    setTrainAllQueue([...(snapshot.trainAllQueue ?? [])]);
    setTrainSessionIndex(snapshot.trainSessionIndex ?? 0);
    setTrainSessionStats({ ...(snapshot.trainSessionStats ?? createEmptyTrainSessionStats()) });
    setPositionAnalysis(snapshot.positionAnalysis);
    setPreMoveAnalyses(snapshot.preMoveAnalyses);
    setTimelineAnalyses(snapshot.timelineAnalyses);
    setTimelineReviews(
      buildTimelineReviews(
        snapshot.moveHistory,
        snapshot.preMoveAnalyses,
        snapshot.timelineAnalyses,
        snapshot.initialFen,
        snapshot.metadata,
      ),
    );
    setPositionLoading(false);
    setTimelineLoading(false);
    setServerError(snapshot.serverError);
    setTimelineError(snapshot.timelineError);
    setSelectedSquare(null);
    setSquareStyles({});
  }, []);

  const switchWorkspaceMode = useCallback((nextMode: WorkspaceMode) => {
    if (nextMode === modeRef.current) {
      return;
    }

    const snapshot = normalizeWorkspaceSnapshot(workspaceStateRef.current);

    if (modeRef.current === 'review') {
      reviewWorkspaceSnapshotRef.current = snapshot;
    } else if (modeRef.current === 'train') {
      trainWorkspaceSnapshotRef.current = snapshot;
    }

    const restoreTarget =
      nextMode === 'review'
        ? reviewWorkspaceSnapshotRef.current
        : nextMode === 'train'
          ? trainWorkspaceSnapshotRef.current
          : null;

    setMode(nextMode);
    modeRef.current = nextMode;
    applyWorkspaceSnapshot(restoreTarget ?? createEmptyWorkspaceSnapshot());
  }, [applyWorkspaceSnapshot]);

  const openTrainCreateDeck = useCallback(() => {
    if (modeRef.current !== 'train') {
      switchWorkspaceMode('train');
    }

    setActiveDeckCard(null);
    setDeckFeedback(null);
    setDeckFeedbackArrowsVisible(false);
    setFocusTrainCreateDeck(true);
  }, [switchWorkspaceMode]);

  const handleCreateDeckFocusHandled = useCallback(() => {
    setFocusTrainCreateDeck(false);
  }, []);

  function persistReviewWorkspaceSnapshot() {
    if (modeRef.current !== 'review' || workspaceStateRef.current.metadata == null) {
      return;
    }

    reviewWorkspaceSnapshotRef.current = normalizeWorkspaceSnapshot(workspaceStateRef.current);
  }

  function persistTrainWorkspaceSnapshot() {
    if (modeRef.current !== 'train') {
      return;
    }

    trainWorkspaceSnapshotRef.current = normalizeWorkspaceSnapshot(workspaceStateRef.current);
  }

  function highlightMoves(square: string) {
    const nextStyles: Record<string, CSSProperties> = {
      [square]: {
        boxShadow: 'inset 0 0 0 3px rgba(152, 184, 255, 0.9)',
        backgroundColor: 'rgba(152, 184, 255, 0.18)',
      },
    };

    const moves = game.moves({ square: square as Square, verbose: true });

    for (const move of moves) {
      nextStyles[move.to] = game.get(move.to)
        ? {
            boxShadow: 'inset 0 0 0 2px rgba(242, 243, 245, 0.34)',
            background:
              'radial-gradient(circle, rgba(152, 184, 255, 0.28) 0%, rgba(152, 184, 255, 0.08) 54%, transparent 56%)',
          }
        : {
            background:
              'radial-gradient(circle, rgba(242, 243, 245, 0.5) 0%, rgba(242, 243, 245, 0.32) 16%, transparent 18%)',
          };
    }

    setSquareStyles(nextStyles);
  }

  const commitMove = useCallback(
    (nextGame: Chess, move: StoredMove) => {
      if (deckPlaybackBusy) {
        return;
      }

      if (modeRef.current === 'lines' && activeOpeningNodeId) {
        const expectedUci = openingDrillExpected?.uci ?? positionAnalysis?.bestMove ?? null;
        const expectedSan = openingDrillExpected?.san ?? (expectedUci ? formatBestMove(currentFen, expectedUci) : null);
        const correct = expectedUci ? move.uci === expectedUci : true;
        const nodeId = activeOpeningNodeId;
        const nextNodeEdge = activeOpeningTree?.edges.find(edge => edge.fromNodeId === nodeId && edge.uci === (expectedUci ?? move.uci));
        const nextNode = nextNodeEdge ? activeOpeningTree?.nodes.find(node => node.id === nextNodeEdge.toNodeId) ?? null : null;

        setMoveHistory([move]);
        setHistoryIndex(1);
        clearVariation();
        setGame(nextGame);
        setPositionAnalysis(null);
        setServerError('');
        setSelectedSquare(null);
        setSquareStyles({});
        setOpeningDrillStatus(correct ? 'Correct. Continuing the branch.' : `Miss. Best was ${expectedSan ?? expectedUci ?? 'unknown'}.`);
        setOpeningDrillExpected(null);
        playSoundSequence(
          getMoveSoundSequence({
            move,
            isSelfMove: true,
            isCheck: nextGame.isCheck(),
            isCheckmate: nextGame.isCheckmate(),
            isGameOver: nextGame.isGameOver(),
          }),
        );

        void fetch('/api/opening-trees', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'attempt', nodeId, playedUci: move.uci, expectedUci, correct }),
        });

        if (nextNode) {
          setActiveOpeningNodeId(nextNode.id);

          if (nextNode.sideToMove === nextNode.trainSide) {
            setInitialFen(nextNode.fen);
            setMoveHistory([]);
            setHistoryIndex(0);
            setGame(new Chess(nextNode.fen));
            setOpeningDrillExpected({ nodeId: nextNode.id, uci: nextNode.bestUci, san: nextNode.bestSan });
            setOpeningDrillStatus('Next node. Find the best move.');
          } else {
            const opponentEdges = activeOpeningTree?.edges.filter(edge => edge.fromNodeId === nextNode.id) ?? [];
            const opponentEdge = chooseWeightedOpponentEdge(opponentEdges, Date.now());
            const afterOpponent = opponentEdge ? activeOpeningTree?.nodes.find(node => node.id === opponentEdge.toNodeId) ?? null : null;

            if (afterOpponent) {
              setInitialFen(afterOpponent.fen);
              setMoveHistory([]);
              setHistoryIndex(0);
              setGame(new Chess(afterOpponent.fen));
              setActiveOpeningNodeId(afterOpponent.id);
              setOpeningDrillExpected({ nodeId: afterOpponent.id, uci: afterOpponent.bestUci, san: afterOpponent.bestSan });
              setOpeningDrillStatus(`Opponent played ${opponentEdge?.san ?? 'a branch'}. Find the best move.`);
            }
          }
        }

        return;
      }

      if (hasLoadedGame && !activeDeckCard) {
        const baseIndex = variationBaseIndex ?? historyIndex;
        const nextVariationMoves = [...variationMoves, move];

        setVariationBaseIndex(baseIndex);
        setVariationMoves(nextVariationMoves);
        setGame(nextGame);
        setPositionAnalysis(null);
        setServerError('');
        setSelectedSquare(null);
        setSquareStyles({});
        playSoundSequence(
          getMoveSoundSequence({
            move,
            isSelfMove: true,
            isCheck: nextGame.isCheck(),
            isCheckmate: nextGame.isCheckmate(),
            isGameOver: nextGame.isGameOver(),
          }),
        );
        return;
      }

      const nextHistory = [...moveHistory.slice(0, historyIndex), move];

      setMoveHistory(nextHistory);
      setHistoryIndex(nextHistory.length);
      clearVariation();
      setGame(nextGame);
      setPositionAnalysis(null);
      setTimelineAnalyses([]);
      timelineRefineRequestIdRef.current += 1;
      setServerError('');
      setTimelineError('');
      setSelectedSquare(null);
      setSquareStyles({});
      if (activeDeckCard && deckFeedback != null && !deckFeedback.pending) {
        setDeckFeedbackArrowsVisible(false);
      }
      playSoundSequence(
        getMoveSoundSequence({
          move,
          isSelfMove: true,
          isCheck: nextGame.isCheck(),
          isCheckmate: nextGame.isCheckmate(),
          isGameOver: nextGame.isGameOver(),
        }),
      );

      if (activeDeckCard && deckFeedback == null) {
        const nextFeedback = buildPendingDeckFeedback(activeDeckCard, move.uci, move.san);
        const gradedFeedback = finalizeDeckFeedback(activeDeckCard, nextFeedback);
        setDeckFeedback(gradedFeedback);
        setDeckFeedbackArrowsVisible(!gradedFeedback.correct);
        setShowArrow(true);
        if (!trainAllSession) {
          const promptStartedAt = deckCardPromptStartedAtRef.current;
          const responseMs = promptStartedAt == null ? null : Date.now() - promptStartedAt;
          const attemptQuality = {
            responseMs,
            exact: gradedFeedback.exact,
            evalLossCp: gradedFeedback.evalLossCp ?? null,
          };
          const seenAt = new Date().toISOString();
          setDeckProgress(progress => applyDeckAttempt(progress, activeDeckCard.id, gradedFeedback.correct, seenAt, attemptQuality));
        }
        void saveTrainingAttempt(activeDeckCard, gradedFeedback);
      }
    },
    [activeDeckCard, activeOpeningNodeId, activeOpeningTree, currentFen, deckFeedback, deckPlaybackBusy, hasLoadedGame, historyIndex, moveHistory, openingDrillExpected, playSoundSequence, positionAnalysis?.bestMove, saveTrainingAttempt, trainAllSession, variationBaseIndex, variationMoves],
  );

  const tryMove = useCallback(
    (from: string, to: string, promotion = 'q') => {
      if (deckPlaybackBusy) {
        return false;
      }

      const nextGame = new Chess(currentFen);
      const move = (() => {
        try {
          return nextGame.move({ from, to, promotion });
        } catch {
          return null;
        }
      })();

      if (!move) {
        playSound('illegal');
        return false;
      }

      commitMove(nextGame, toStoredMove(move));
      return true;
    },
    [commitMove, currentFen, deckPlaybackBusy, playSound],
  );

  function jumpToIndex(index: number) {
    const boundedIndex = Math.max(0, Math.min(index, moveHistory.length));
    const nextGame = restoreGameFromHistory(moveHistory, initialFen, boundedIndex);

    setHistoryIndex(boundedIndex);
    if (activeDeckCard) {
      setDeckFeedbackArrowsVisible(false);
    }
    clearVariation();
    setGame(nextGame);
    clearSelection();
  }

  const loadDeckCard = useCallback(async (card: DeckCard | null) => {
    if (!card) {
      return;
    }

    await startDeckCardWithReplay(card, openingLines);
  }, [openingLines, startDeckCardWithReplay]);

  const finishDeckTrainingSession = useCallback(() => {
    const wasTrainAllSession = trainAllSession;
    const restoreDeckId =
      selectedDeckId ??
      (typeof window !== 'undefined' ? window.localStorage.getItem(LAST_TRAINING_DECK_STORAGE_KEY) : null);

    setTrainAllSession(false);
    setTrainAllQueue([]);
    setTrainSessionIndex(0);
    setTrainSessionStats(createEmptyTrainSessionStats());
    setActiveDeckCard(null);
    setDeckFeedback(null);
    setDeckFeedbackArrowsVisible(false);
    positionRequestIdRef.current += 1;
    setGame(new Chess());
    setInitialFen(null);
    setMoveHistory([]);
    setHistoryIndex(0);
    clearVariation();
    setMetadata(null);
    setWhiteAvatarUrl(null);
    setBlackAvatarUrl(null);
    setFileName('');
    setPositionAnalysis(null);
    setPreMoveAnalyses([]);
    setTimelineAnalyses([]);
    setPositionLoading(false);
    setTimelineLoading(false);
    setServerError('');
    setTimelineError('');
    clearSelection();

    if (wasTrainAllSession) {
      void loadTrainingDeck(restoreDeckId, { autoStart: false, libraryLoading: false });
    }
  }, [loadTrainingDeck, selectedDeckId, trainAllSession]);

  const deckBusy = deckLibraryLoading || deckCardsLoading;

  const trainDeckFromLibrary = useCallback(async (deckId: string) => {
    setTrainAllSession(false);
    setTrainAllQueue([]);
    setTrainSessionIndex(0);
    setTrainSessionStats(createEmptyTrainSessionStats());
    setActiveDeckCard(null);
    setDeckFeedback(null);
    setDeckFeedbackArrowsVisible(false);
    setSelectedDeckId(deckId);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LAST_TRAINING_DECK_STORAGE_KEY, deckId);
    }

    if (deckId === selectedDeckId && deckCards.length > 0 && !deckBusy) {
      const nextCard = getDeckStudyQueue(deckCards, deckProgress)[0] ?? null;

      if (nextCard) {
        setDeckIndex(0);
        await startDeckCardWithReplay(nextCard, openingLines);
      }

      return;
    }

    await loadTrainingDeck(deckId, { autoStart: true, libraryLoading: false });
  }, [deckBusy, deckCards, deckProgress, loadTrainingDeck, openingLines, selectedDeckId, startDeckCardWithReplay]);

  const trainAllDecks = useCallback(async () => {
    setTrainAllSession(true);
    setActiveDeckCard(null);
    setDeckFeedback(null);
    setDeckFeedbackArrowsVisible(false);
    await loadTrainingDeck(undefined, { autoStart: true, allDecks: true });
  }, [loadTrainingDeck]);

  function selectSaveDeck(deckId: string) {
    setSelectedDeckId(deckId);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LAST_TRAINING_DECK_STORAGE_KEY, deckId);
    }
  }

  const advanceDeckCard = useCallback(() => {
    deckPlaybackRequestIdRef.current += 1;
    setDeckPlaybackBusy(false);
    const feedback = deckFeedbackRef.current;

    if (feedback && !feedback.pending) {
      setTrainSessionStats(previous => ({
        completed: previous.completed + 1,
        hits: previous.hits + (feedback.correct ? 1 : 0),
        misses: previous.misses + (feedback.correct ? 0 : 1),
      }));
    }

    if (trainAllSession) {
      if (trainAllQueue.length === 0) {
        return;
      }

      if (trainSessionIndex >= trainAllQueue.length - 1) {
        finishDeckTrainingSession();
        return;
      }

      const nextIndex = trainSessionIndex + 1;
      setTrainSessionIndex(nextIndex);
      loadDeckCard(trainAllQueue[nextIndex]);
      return;
    }

    const sessionCards = availableDeckCards;

    if (sessionCards.length === 0) {
      return;
    }

    const currentCardId = activeDeckCard?.id ?? null;
    const nextPriorityCard = sessionCards.find(card => card.id !== currentCardId) ?? sessionCards[0];
    const nextIndex = sessionCards.findIndex(card => card.id === nextPriorityCard.id);

    setDeckIndex(nextIndex);
    loadDeckCard(nextPriorityCard);
  }, [activeDeckCard, availableDeckCards, finishDeckTrainingSession, loadDeckCard, trainAllQueue, trainAllSession, trainSessionIndex]);

  const deleteActiveDeckCard = useCallback(async () => {
    const card = activeDeckCard ?? nextDeckCard;

    if (!card || !selectedDeckId) {
      return;
    }

    setDeckActionLoading(true);
    setDeckActionError('');

    try {
      const response = await fetch('/api/training-deck', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_card',
          deckId: selectedDeckId,
          cardId: card.id,
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to delete card.');
      }

      const remainingCards = deckCards.filter(entry => entry.id !== card.id);
      const nextProgress = { ...deckProgress };
      delete nextProgress[card.id];

      setDeckCards(remainingCards);
      setDeckProgress(nextProgress);
      setActiveDeckCard(null);
      setDeckFeedback(null);
      setDeckFeedbackArrowsVisible(false);

      const nextTrainingCard = getDeckStudyQueue(remainingCards, nextProgress)[0] ?? null;

      if (nextTrainingCard) {
        loadDeckCard(nextTrainingCard);
      } else {
        positionRequestIdRef.current += 1;
        setGame(new Chess());
        setInitialFen(null);
        setMoveHistory([]);
        setHistoryIndex(0);
        clearVariation();
        setMetadata(null);
        setFileName('');
        setPositionAnalysis(null);
        setPreMoveAnalyses([]);
        setTimelineAnalyses([]);
        clearSelection();
      }

      await loadTrainingDeck(selectedDeckId);
    } catch (error) {
      setDeckActionError(error instanceof Error ? error.message : 'Unable to delete card.');
    } finally {
      setDeckActionLoading(false);
    }
  }, [
    activeDeckCard,
    deckCards,
    deckProgress,
    loadDeckCard,
    loadTrainingDeck,
    nextDeckCard,
    selectedDeckId,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if (isTyping || pgnDialogOpen) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        event.stopPropagation();
        suppressSpaceKeyUpRef.current = true;

        if (mode === 'train' && activeDeckCard) {
          if (deckPlaybackBusy) {
            return;
          }

          if (activeDeckCard && deckFeedback && !deckFeedback.pending) {
            advanceDeckCard();
          }

          return;
        }

        const bestMove = positionAnalysis?.bestMove;

        if (bestMove && bestMove.length >= 4) {
          tryMove(bestMove.slice(0, 2), bestMove.slice(2, 4), bestMove[4]);
        }

        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();

        const boundedIndex = Math.max(0, Math.min(historyIndex - 1, moveHistory.length));
        const nextGame = restoreGameFromHistory(moveHistory, initialFen, boundedIndex);

        if (boundedIndex === historyIndex - 1) {
          const replayedMove = moveHistory[boundedIndex];

          if (replayedMove) {
            const playerSide = activeDeckCard?.side ?? reviewPlayerSide;
            const isSelfMove =
              playerSide == null
                ? orientation === 'white'
                : (playerSide === 'white' && replayedMove.color === 'w') || (playerSide === 'black' && replayedMove.color === 'b');

            playSoundSequence([getPrimaryMoveSound(replayedMove, isSelfMove)]);
          }
        }

        setHistoryIndex(boundedIndex);
        if (activeDeckCard) {
          setDeckFeedbackArrowsVisible(false);
        }
        clearVariation();
        setGame(nextGame);
        clearSelection();
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();

        const boundedIndex = Math.max(0, Math.min(historyIndex + 1, moveHistory.length));
        const nextGame = restoreGameFromHistory(moveHistory, initialFen, boundedIndex);

        if (boundedIndex === historyIndex + 1) {
          const replayedMove = moveHistory[historyIndex];

          if (replayedMove) {
            const playerSide = activeDeckCard?.side ?? reviewPlayerSide;
            const isSelfMove =
              playerSide == null
                ? orientation === 'white'
                : (playerSide === 'white' && replayedMove.color === 'w') || (playerSide === 'black' && replayedMove.color === 'b');

            playSoundSequence(
              getMoveSoundSequence({
                move: replayedMove,
                isSelfMove,
                isCheck: nextGame.isCheck(),
                isCheckmate: nextGame.isCheckmate(),
                isGameOver: nextGame.isGameOver(),
              }),
            );
          }
        }

        setHistoryIndex(boundedIndex);
        if (activeDeckCard) {
          setDeckFeedbackArrowsVisible(false);
        }
        clearVariation();
        setGame(nextGame);
        clearSelection();
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();

        const boundedIndex = moveHistory.length;
        const nextGame = restoreGameFromHistory(moveHistory, initialFen, boundedIndex);

        setHistoryIndex(boundedIndex);
        if (activeDeckCard) {
          setDeckFeedbackArrowsVisible(false);
        }
        clearVariation();
        setGame(nextGame);
        clearSelection();
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();

        const boundedIndex = moveHistory.length > 0 ? 1 : 0;
        const nextGame = restoreGameFromHistory(moveHistory, initialFen, boundedIndex);

        setHistoryIndex(boundedIndex);
        if (activeDeckCard) {
          setDeckFeedbackArrowsVisible(false);
        }
        clearVariation();
        setGame(nextGame);
        clearSelection();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !suppressSpaceKeyUpRef.current) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      suppressSpaceKeyUpRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [activeDeckCard, advanceDeckCard, deckFeedback, historyIndex, initialFen, mode, moveHistory, orientation, pgnDialogOpen, playSoundSequence, positionAnalysis?.bestMove, reviewPlayerSide, tryMove]);

  function goToReviewMoment(index: number) {
    if (index >= reviewMoments.length) {
      setMode('review');
      setReviewIndex(Math.max(0, reviewMoments.length - 1));
      void playToHistoryIndex(moveHistory.length);
      return;
    }

    const boundedIndex = Math.max(0, Math.min(index, Math.max(0, reviewMoments.length - 1)));
    const moment = reviewMoments[boundedIndex] ?? null;

    setMode('review');
    setReviewIndex(boundedIndex);

    if (!moment) {
      return;
    }

    void playToHistoryIndex(moment.ply);
  }

  async function playToHistoryIndex(targetIndex: number) {
    const requestId = ++reviewPlaybackRequestIdRef.current;
    const boundedTarget = Math.max(0, Math.min(targetIndex, moveHistory.length));

    if (boundedTarget <= historyIndex) {
      jumpToIndex(boundedTarget);
      return;
    }

    for (let nextIndex = historyIndex + 1; nextIndex <= boundedTarget; nextIndex += 1) {
      if (reviewPlaybackRequestIdRef.current !== requestId) {
        return;
      }

      const nextGame = restoreGameFromHistory(moveHistory, initialFen, nextIndex);
      const replayedMove = moveHistory[nextIndex - 1];

      if (replayedMove) {
        const playerSide = activeDeckCard?.side ?? reviewPlayerSide;
        const isSelfMove =
          playerSide == null
            ? orientation === 'white'
            : (playerSide === 'white' && replayedMove.color === 'w') || (playerSide === 'black' && replayedMove.color === 'b');

        playSoundSequence(
          getMoveSoundSequence({
            move: replayedMove,
            isSelfMove,
            isCheck: nextGame.isCheck(),
            isCheckmate: nextGame.isCheckmate(),
            isGameOver: nextGame.isGameOver(),
          }),
        );
      }

      setHistoryIndex(nextIndex);
      clearVariation();
      setGame(nextGame);
      clearSelection();

      await delay(210);
    }
  }

  async function runTimelineAnalysis(
    nextMoves = moveHistory,
    nextInitialFen = initialFen,
    nextMetadata: GameMetadata | null = metadata,
  ) {
    cancelRecentPreload('interactive review started');
    const requestId = ++timelineRequestIdRef.current;
    timelineRefineRequestIdRef.current += 1;

    if (nextMoves.length === 0) {
      setPreMoveAnalyses([]);
      setTimelineAnalyses([]);
      setTimelineReviews([]);
      setTimelineError('');
      setTimelineLoading(false);
      setTimelineProgress(null);
      return;
    }

    setTimelineLoading(true);
    setTimelineProgress(TIMELINE_ENGINE_PROGRESS_OFFSET);
    setTimelineError('');

    try {
      const sequence = await analyzeTimelineDeep(nextMoves, nextInitialFen, progress => {
        if (timelineRequestIdRef.current === requestId) {
          setTimelineProgress(TIMELINE_ENGINE_PROGRESS_OFFSET + progress * TIMELINE_ENGINE_PROGRESS_WEIGHT);
        }
      }, 'review');

      if (timelineRequestIdRef.current !== requestId) {
        return;
      }

      const nextPreMoveAnalyses = sequence.slice(0, -1);
      const nextTimelineAnalyses = sequence.slice(1);
      setPreMoveAnalyses(nextPreMoveAnalyses);
      setTimelineAnalyses(nextTimelineAnalyses);

      if (timelineRequestIdRef.current === requestId) {
        setTimelineProgress(96);
      }

      setTimelineReviews(
        buildTimelineReviews(nextMoves, nextPreMoveAnalyses, nextTimelineAnalyses, nextInitialFen, nextMetadata),
      );

      if (timelineRequestIdRef.current === requestId) {
        setTimelineProgress(100);
      }

      if (activeRecentGameCacheKeyRef.current) {
        void saveCachedTimelineAnalysis({
          cacheKey: activeRecentGameCacheKeyRef.current,
          gameLink: activeRecentGameLinkRef.current,
          pgn: activeRecentGamePgnRef.current,
          preMoveAnalyses: nextPreMoveAnalyses,
          timelineAnalyses: nextTimelineAnalyses,
        });
      }
    } catch (error) {
      if (timelineRequestIdRef.current !== requestId) {
        return;
      }

      setPreMoveAnalyses([]);
      setTimelineAnalyses([]);
      setTimelineReviews([]);
      setTimelineError(error instanceof Error ? error.message : 'Unable to analyze the line.');
    } finally {
      if (timelineRequestIdRef.current === requestId) {
        setTimelineLoading(false);
        setTimelineProgress(null);
      }
    }
  }

  async function loadPgnText(
    name: string,
    content: string,
    preferredOrientation?: 'white' | 'black',
    options?: {
      cachedAnalysis?: CachedTimelineAnalysis | null;
      cacheKey?: string | null;
      gameLink?: string | null;
      skipAnalysis?: boolean;
      whiteAvatarUrl?: string | null;
      blackAvatarUrl?: string | null;
    },
  ) {
    cancelRecentPreload('game opened');
    persistTrainWorkspaceSnapshot();
    reviewWorkspaceSnapshotRef.current = null;
    timelineRefineRequestIdRef.current += 1;
    activeRecentGameCacheKeyRef.current = options?.cacheKey ?? null;
    activeRecentGameLinkRef.current = options?.gameLink ?? null;
    activeRecentGamePgnRef.current = options?.cacheKey ? content : null;

    try {
      const loadedGame = new Chess();
      loadedGame.loadPgn(content);

      const nextInitialFen = loadedGame.header().FEN ?? null;
      const nextHistory = loadedGame.history({ verbose: true }).map(toStoredMove);
      const nextGame = restoreGameFromHistory(nextHistory, nextInitialFen, 0);
      const requestedCachedAnalysis = options?.cachedAnalysis ?? null;
      const cachedAnalysis =
        isUsableCachedTimelineAnalysis(requestedCachedAnalysis, nextHistory.length) ? requestedCachedAnalysis : null;

      const nextMetadata = extractMetadataFromGame(loadedGame);

      setInitialFen(nextInitialFen);
      setMoveHistory(nextHistory);
      setHistoryIndex(0);
      clearVariation();
      setGame(nextGame);
      setMetadata(nextMetadata);
      setWhiteAvatarUrl(options?.whiteAvatarUrl ?? null);
      setBlackAvatarUrl(options?.blackAvatarUrl ?? null);
      setFileName(name);
      setMode('review');
      modeRef.current = 'review';
      setReviewIndex(0);
      setActiveDeckCard(null);
      setDeckFeedback(null);
      setDeckFeedbackArrowsVisible(false);
      setPositionAnalysis(null);
      setPreMoveAnalyses(cachedAnalysis?.preMoveAnalyses ?? []);
      setTimelineAnalyses(cachedAnalysis?.timelineAnalyses ?? []);
      setTimelineError('');
      setTimelineProgress(null);
      setServerError('');
      setPgnDialogOpen(false);
      if (preferredOrientation) {
        setOrientation(preferredOrientation);
      }
      clearSelection();
      playSound('game-start');

      if (cachedAnalysis) {
        setTimelineReviews(
          buildTimelineReviews(
            nextHistory,
            cachedAnalysis.preMoveAnalyses,
            cachedAnalysis.timelineAnalyses,
            nextInitialFen,
            nextMetadata,
          ),
        );
      } else {
        setTimelineReviews([]);
      }

      if (!cachedAnalysis && options?.skipAnalysis) {
        setTimelineLoading(false);
        setTimelineProgress(null);
      } else if (!cachedAnalysis) {
        await runTimelineAnalysis(nextHistory, nextInitialFen, nextMetadata);
      }
    } catch (error) {
      setTimelineAnalyses([]);
      setTimelineError('Invalid PGN file.');
      setServerError(error instanceof Error ? error.message : 'Unable to load PGN.');
    }
  }

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async loadEvent => {
      await loadPgnText(file.name, String(loadEvent.target?.result ?? ''));
    };

    reader.readAsText(file);
    event.target.value = '';
  }

  async function handlePgnPaste() {
    if (!pgnDraft.trim()) {
      return;
    }

    await loadPgnText('Pasted PGN', pgnDraft.trim());
  }

  async function loadRecentChessGame(gameSummary: ChessComRecentGameSummary) {
    lastReviewInteractionAtRef.current = Date.now();

    const cacheKey = getRecentGameCacheKey(gameSummary);
    const memoryCachedAnalysis = recentGameAnalysisMemoryCache.get(cacheKey) ?? null;
    const parsedGame = new Chess();
    parsedGame.loadPgn(gameSummary.pgn);
    const nextInitialFen = parsedGame.header().FEN ?? null;
    const nextHistory = parsedGame.history({ verbose: true }).map(toStoredMove);
    const nextMetadata = extractMetadataFromGame(parsedGame);

    await loadPgnText(
      gameSummary.link,
      gameSummary.pgn,
      gameSummary.playerColor === 'black' ? 'black' : 'white',
      {
        cachedAnalysis: memoryCachedAnalysis,
        cacheKey,
        gameLink: gameSummary.link || gameSummary.url,
        skipAnalysis: !memoryCachedAnalysis,
        whiteAvatarUrl: gameSummary.whiteAvatar,
        blackAvatarUrl: gameSummary.blackAvatar,
      },
    );

    if (!memoryCachedAnalysis) {
      void (async () => {
        setTimelineLoading(true);
        setTimelineProgress(TIMELINE_CACHE_PROGRESS);
        const analysis = await loadCachedTimelineAnalysis(cacheKey, { includeInFlight: false });

        if (activeRecentGameCacheKeyRef.current !== cacheKey) {
          return;
        }

        if (isUsableCachedTimelineAnalysis(analysis, nextHistory.length)) {
          setPreMoveAnalyses(analysis.preMoveAnalyses);
          setTimelineAnalyses(analysis.timelineAnalyses);
          setTimelineReviews(
            buildTimelineReviews(
              nextHistory,
              analysis.preMoveAnalyses,
              analysis.timelineAnalyses,
              nextInitialFen,
              nextMetadata,
            ),
          );
          setTimelineProgress(100);
          return;
        }

        await runTimelineAnalysis(nextHistory, nextInitialFen, nextMetadata);
      })().finally(() => {
          if (activeRecentGameCacheKeyRef.current === cacheKey) {
            setTimelineLoading(false);
            setTimelineProgress(null);
          }
        });
    }
  }

  async function openTrainingProfile() {
    setTrainingProfileSubmitting(true);
    setTrainingProfileError('');

    try {
      const response = await fetch('/api/training-profile', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: trainingUsername, password: trainingPassword }),
      });
      const payload = (await response.json()) as { profile?: TrainingProfile; error?: string };

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? 'Unable to open training profile.');
      }

      setTrainingProfile(payload.profile);
      setTrainingUsername(payload.profile.username);
      persistTrainingCredentials(payload.profile.username, trainingPassword);
      setTrainingPassword(trainingPassword);
      await hydrateTrainingProgress({ saveMerged: true });
      await loadTrainingDeck(selectedDeckId);
    } catch (error) {
      setTrainingProfileError(error instanceof Error ? error.message : 'Unable to open training profile.');
    } finally {
      setTrainingProfileSubmitting(false);
    }
  }

  async function createTrainingDeck() {
    setDeckActionLoading(true);
    setDeckActionError('');

    try {
      const response = await fetch('/api/training-deck', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: newDeckTitle }),
      });
      const payload = (await response.json()) as { deck?: TrainingDeckSummary; error?: string };

      if (!response.ok || !payload.deck) {
        throw new Error(payload.error ?? 'Unable to create deck.');
      }

      setNewDeckTitle('');
      setSelectedDeckId(payload.deck.id);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LAST_TRAINING_DECK_STORAGE_KEY, payload.deck.id);
      }
      await loadTrainingDeck(payload.deck.id);
    } catch (error) {
      setDeckActionError(error instanceof Error ? error.message : 'Unable to create deck.');
    } finally {
      setDeckActionLoading(false);
    }
  }

  async function generateRecentTrainingDeck() {
    setDeckActionLoading(true);
    setDeckActionError('');

    try {
      const response = await fetch('/api/training-deck', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_recent',
          username: chesscomUsername || trainingProfile?.username || trainingUsername,
          count: 50,
          timeClass: recentGameTimeClass,
        }),
      });
      const payload = (await response.json()) as { deckId?: string; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to generate deck.');
      }

      if (payload.deckId) {
        setSelectedDeckId(payload.deckId);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(LAST_TRAINING_DECK_STORAGE_KEY, payload.deckId);
        }
      }
      await loadTrainingDeck(payload.deckId ?? selectedDeckId);
    } catch (error) {
      setDeckActionError(error instanceof Error ? error.message : 'Unable to generate deck.');
    } finally {
      setDeckActionLoading(false);
    }
  }

  async function renameTrainingDeck(deckId: string, name: string) {
    setDeckActionLoading(true);
    setDeckActionError('');

    try {
      const response = await fetch('/api/training-deck', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'rename_deck', deckId, name }),
      });
      const payload = (await response.json()) as { deck?: TrainingDeckSummary; error?: string };

      if (!response.ok || !payload.deck) {
        throw new Error(payload.error ?? 'Unable to rename deck.');
      }

      await loadTrainingDeck(selectedDeckId === deckId ? deckId : selectedDeckId);
    } catch (error) {
      setDeckActionError(error instanceof Error ? error.message : 'Unable to rename deck.');
    } finally {
      setDeckActionLoading(false);
    }
  }

  async function deleteTrainingDeck(deckId: string) {
    setDeckActionLoading(true);
    setDeckActionError('');

    try {
      const response = await fetch('/api/training-deck', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete_deck', deckId }),
      });
      const payload = (await response.json()) as { deckId?: string; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to delete deck.');
      }

      if (selectedDeckId === deckId) {
        setSelectedDeckId(null);
        setActiveDeckCard(null);
        setDeckFeedback(null);
        setDeckFeedbackArrowsVisible(false);
        setDeckCards([]);
        setOpeningLines([]);

        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(LAST_TRAINING_DECK_STORAGE_KEY);
        }
      }

      await loadTrainingDeck(selectedDeckId === deckId ? null : selectedDeckId);
    } catch (error) {
      setDeckActionError(error instanceof Error ? error.message : 'Unable to delete deck.');
    } finally {
      setDeckActionLoading(false);
    }
  }

  async function saveReviewPositionToDeck() {
    setReviewDeckSaveStatus('Saving');
    setDeckActionError('');

    try {
      const rootAnalysis = displayAnalysis;
      const side = game.turn() === 'b' ? 'black' : 'white';

      if (!selectedDeckId || !rootAnalysis?.bestMove) {
        throw new Error('Choose a deck and wait for analysis before saving.');
      }

      const verifiedRootAnalysis = await analyzeSinglePosition(
        buildDeterministicAnalyzeRequest({
          fen: currentFen,
        }),
      );

      const verifiedAnswer = await resolvePostMoveVerifiedReviewCardAnswer({
        fen: currentFen,
        side,
        rootAnalysis: verifiedRootAnalysis,
        analyzePosition: request => analyzeSinglePosition(request),
      });
      const setupMoves = saveReplayFromStart ? currentMoves.map(move => move.san) : [];
      const replayFromStart = saveReplayFromStart && setupMoves.length > 0;
      const moveReviews = replayFromStart ? cardMoveReviewsFromTimeline(timelineReviews, setupMoves.length) : [];

      const response = await fetch('/api/training-deck', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'add_card',
          deckId: selectedDeckId,
          card: {
            lineName: `${whiteReviewName} vs ${blackReviewName}`,
            eco: metadata?.eco ?? 'GAME',
            side,
            ply: historyIndex,
            fen: currentFen,
            answerUci: verifiedAnswer.answerUci,
            answerSan: verifiedAnswer.answerSan,
            prompt: `${side === 'white' ? 'White' : 'Black'} to move: find the best response.`,
            context: currentMoves.length > 0 ? currentMoves.map(move => move.san).join(' ') : 'Starting position',
            referenceEvalCp: verifiedAnswer.referenceEvalCp,
            replayFromStart,
            initialFen: replayFromStart ? initialFen : null,
            setupMoves,
            moveReviews,
          },
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to save card.');
      }

      setReviewDeckSaveStatus('Saved');
      await loadTrainingDeck(selectedDeckId);
      window.setTimeout(() => setReviewDeckSaveStatus(''), 1200);
    } catch (error) {
      setReviewDeckSaveStatus('');
      setDeckActionError(error instanceof Error ? error.message : 'Unable to save card.');
    }
  }

  function resetWorkspace() {
    positionRequestIdRef.current += 1;
    timelineRequestIdRef.current += 1;
    timelineRefineRequestIdRef.current += 1;
    reviewWorkspaceSnapshotRef.current = null;
    trainWorkspaceSnapshotRef.current = null;
    setGame(new Chess());
    setInitialFen(null);
    setMoveHistory([]);
    setHistoryIndex(0);
    clearVariation();
    setMetadata(null);
    setFileName('');
    setMode('review');
    modeRef.current = 'review';
    setReviewIndex(0);
    setPositionAnalysis(null);
    setPreMoveAnalyses([]);
    setTimelineAnalyses([]);
    setPositionLoading(false);
    setTimelineLoading(false);
    setServerError('');
    setTimelineError('');
    setActiveDeckCard(null);
    setDeckFeedback(null);
    setDeckFeedbackArrowsVisible(false);
    positionCacheRef.current.clear();
    positionInFlightRef.current.clear();
    timelineBatchInFlightRef.current.clear();
    clearSelection();
    playSound('game-start');
  }

  modeRef.current = mode;
  workspaceStateRef.current = {
    initialFen,
    moveHistory,
    historyIndex,
    variationBaseIndex,
    variationMoves,
    metadata,
    whiteAvatarUrl,
    blackAvatarUrl,
    fileName,
    orientation,
    showArrow,
    reviewIndex,
    activeDeckCard,
    deckFeedback,
    deckIndex,
    trainAllSession,
    trainAllQueue,
    trainSessionIndex,
    trainSessionStats,
    positionAnalysis,
    preMoveAnalyses,
    timelineAnalyses,
    serverError,
    timelineError,
  };

  const pageClassName = [
    styles.page,
    mode === 'train' ? styles.trainMode : '',
    mode === 'train' && activeDeckCard ? styles.trainSessionMode : '',
  ].filter(Boolean).join(' ');

  return (
    <main className={pageClassName}>
      <div className={styles.appShell}>
        <section className={`${styles.panel} ${styles.boardPanel}`}>
          <div className={styles.boardWorkspace}>
            <div className={styles.boardTools} aria-label="Board tools">
              <button className={styles.iconButton} onClick={() => setPgnDialogOpen(true)} title="Import PGN">
                <ImportIcon />
              </button>
              <button className={styles.iconButton} onClick={() => setOrientation(value => (value === 'white' ? 'black' : 'white'))} title="Flip board">
                <FlipIcon />
              </button>
              <button
                className={styles.iconButton}
                onClick={() => setShowArrow(value => !value)}
                disabled={Boolean(activeDeckCard && !isTrainCardFinished)}
                title={
                  activeDeckCard && !isTrainCardFinished
                    ? 'Best arrow hidden during deck review'
                    : showArrow
                      ? 'Hide best arrow'
                      : 'Show best arrow'
                }
              >
                <ArrowIcon off={!showArrow || Boolean(activeDeckCard && !isTrainCardFinished)} />
              </button>
              <button className={styles.iconButton} onClick={() => void runTimelineAnalysis()} disabled={timelineLoading || moveHistory.length === 0} title="Refresh analysis">
                <RefreshIcon />
              </button>
              <button className={styles.iconButton} onClick={resetWorkspace} title="Reset board">
                <ResetIcon />
              </button>
            </div>

            <div className={styles.boardStage} ref={boardStageRef}>
              <div className={styles.evalRail} ref={evalRailRef}>
                <div
                  className={`${styles.evalShell} ${orientation === 'black' ? styles.evalShellFlipped : ''}`}
                  style={{ ['--white-share' as string]: `${whiteAdvantage}%` }}
                >
                  <div className={styles.evalBlack} />
                  <div className={styles.evalWhite} />
                  <div className={styles.evalDivider} />
                </div>
                <div className={styles.evalCopy}>
                  <span className={styles.score}>{boardScoreLabel}</span>
                </div>
              </div>

              <div className={styles.boardStack} style={{ width: `${boardWidth}px` }}>
                <BoardPlayerBar player={topBoardPlayer} />
                <div className={styles.boardFrame} style={{ width: `${boardWidth}px`, height: `${boardWidth}px` }}>
                  <Chessboard
                    options={{
                      id: 'analysis-board',
                      position: currentFen,
                      boardOrientation: orientation,
                      boardStyle: {
                        width: `${boardWidth}px`,
                        maxWidth: '100%',
                        height: `${boardWidth}px`,
                        borderRadius: '10px',
                      },
                      onPieceDrop: ({ sourceSquare, targetSquare }) =>
                        targetSquare ? tryMove(sourceSquare, targetSquare) : false,
                      onSquareClick: ({ square }) => {
                        if (selectedSquare) {
                          const movePlayed = tryMove(selectedSquare, square);

                          if (!movePlayed) {
                            clearSelection();
                          }

                          return;
                        }

                        const piece = game.get(square as Square);

                        if (!piece || piece.color !== game.turn()) {
                          return;
                        }

                        setSelectedSquare(square);
                        highlightMoves(square);
                      },
                      onSquareRightClick: () => clearSelection(),
                      squareStyles: boardSquareStyles,
                      arrows: boardArrows,
                      lightSquareStyle: { backgroundColor: '#728092' },
                      darkSquareStyle: { backgroundColor: '#253140' },
                      animationDurationInMs: 180,
                      showNotation: true,
                    }}
                  />
                  {boardReviewBadge ? (
                    <span
                      aria-hidden="true"
                      className={styles.boardReviewBadge}
                      style={
                        {
                          '--board-review-badge-url': `url(${boardReviewBadge.badge})`,
                          '--board-review-badge-color': boardReviewBadge.color,
                          '--board-square-size': `${boardReviewBadge.squareSize}px`,
                          left: `${boardReviewBadge.left}px`,
                          top: `${boardReviewBadge.top}px`,
                        } as CSSProperties
                      }
                    />
                  ) : null}
                </div>
                <BoardPlayerBar player={bottomBoardPlayer} />
              </div>
              <div className={styles.boardStageSpacer} aria-hidden="true" />
            </div>
          </div>

          {serverError ? <p className={styles.error}>{serverError}</p> : null}
        </section>

        <aside className={`${styles.panel} ${styles.contextPanel}`}>
          <section className={styles.modeTabs}>
            {(['review', 'train', 'lines'] satisfies WorkspaceMode[]).map(nextMode => (
              <button
                className={`${styles.modeTab} ${mode === nextMode ? styles.activeModeTab : ''}`}
                key={nextMode}
                onClick={() => switchWorkspaceMode(nextMode)}
                type="button"
              >
                {getModeLabel(nextMode)}
              </button>
            ))}
          </section>

          <div className={`${styles.panelScroll} ${mode === 'review' && hasLoadedGame ? styles.reviewPanelScroll : ''}`}>
            {mode === 'review' ? (
              <ReviewPanel
                activeReviewMoment={activeReviewMoment}
                blackReviewName={blackReviewName}
                chesscomUsername={chesscomUsername}
                goToReviewMoment={goToReviewMoment}
                hasLoadedGame={hasLoadedGame}
                historyIndex={historyIndex}
                jumpToIndex={jumpToIndex}
                loadRecentGame={loadRecentChessGame}
                moveHistoryLength={moveHistory.length}
                movePairs={movePairs}
                onBack={() => {
                  reviewWorkspaceSnapshotRef.current = null;
                  positionRequestIdRef.current += 1;
                  timelineRequestIdRef.current += 1;
                  setGame(new Chess());
                  setInitialFen(null);
                  setMoveHistory([]);
                  setHistoryIndex(0);
                  clearVariation();
                  setMetadata(null);
                  setFileName('');
                  setReviewIndex(0);
                  setPositionAnalysis(null);
                  setPreMoveAnalyses([]);
                  setTimelineAnalyses([]);
                  setPositionLoading(false);
                  setTimelineLoading(false);
                  setServerError('');
                  setTimelineError('');
                  setActiveDeckCard(null);
                  setDeckFeedback(null);
                  setDeckFeedbackArrowsVisible(false);
                  positionCacheRef.current.clear();
                  positionInFlightRef.current.clear();
                  timelineBatchInFlightRef.current.clear();
                  clearSelection();
                }}
                onChesscomUsernameChange={value => {
                  setChesscomUsername(value);

                  if (!value.trim()) {
                    deleteCookie(CHESSCOM_USERNAME_COOKIE);
                    setRecentChessGames([]);
                    setRecentChessGamesHasMore(false);
                    setRecentChessGamesNextOffset(0);
                    setRecentChessGamesNextCursor(null);
                    setRecentChessGamesError('');
                  }
                }}
                onRecentGameTimeClassChange={timeClass => {
                  setRecentGameTimeClass(timeClass);
                  writeCookie(CHESSCOM_TIME_CLASS_COOKIE, timeClass);
                  setRecentChessGames([]);
                  setRecentChessGamesHasMore(false);
                  setRecentChessGamesNextOffset(0);
                  setRecentChessGamesNextCursor(null);
                  void fetchRecentChessGames(undefined, timeClass);
                }}
                onFetchRecentGames={() => void fetchRecentChessGames()}
                recentGames={recentChessGames}
                recentGamesError={recentChessGamesError}
                recentGamesHasMore={recentChessGamesHasMore}
                recentGamesLoading={recentChessGamesLoading}
                recentGameTimeClass={recentGameTimeClass}
                deckSummaries={deckSummaries}
                reviewDeckSaveStatus={reviewDeckSaveStatus}
                reviewSaveMoveSan={
                  displayAnalysis?.bestMove
                    ? formatBestMove(currentFen, displayAnalysis.bestMove)
                    : null
                }
                positionLoading={positionLoading}
                reviewMoments={reviewMoments}
                canSaveReviewCard={Boolean(
                  trainingProfile &&
                  selectedDeck?.isOwned &&
                  displayAnalysis?.bestMove &&
                  !positionLoading &&
                  (!saveReplayFromStart || currentMoves.length > 0),
                )}
                onSaveReviewCard={() => void saveReviewPositionToDeck()}
                onGoCreateDeck={openTrainCreateDeck}
                onSelectSaveDeck={selectSaveDeck}
                onLoadMoreRecentGames={() => void fetchRecentChessGames(undefined, undefined, true)}
                selectedDeckId={selectedDeckId}
                setShowArrow={setShowArrow}
                timelineAnalyses={timelineAnalyses}
                timelineAnalysesLength={timelineAnalyses.length}
                timelineError={timelineError}
                timelineLoading={timelineLoading}
                timelineProgress={timelineProgress}
                timelineReviews={timelineReviews}
                whiteReviewName={whiteReviewName}
              />
            ) : !trainingProfile ? (
              <TrainingProfilePanel
                bootstrapping={trainingProfileBootstrapping}
                error={trainingProfileError}
                submitting={trainingProfileSubmitting}
                password={trainingPassword}
                setPassword={setTrainingPassword}
                setUsername={setTrainingUsername}
                username={trainingUsername}
                onSubmit={() => void openTrainingProfile()}
              />
            ) : mode === 'lines' ? (
              <LinesPanel
                actionError={openingTreeActionError}
                actionLoading={openingTreeActionLoading}
                activeNodeId={activeOpeningNodeId}
                activeTree={activeOpeningTree}
                activeTreeId={selectedOpeningTreeId}
                drillStatus={openingDrillStatus}
                expectedSan={openingDrillExpected?.san ?? (openingDrillExpected?.uci ? formatBestMove(currentFen, openingDrillExpected.uci) : null)}
                loading={openingTreesLoading}
                onImportRecent={() => void importRecentOpeningTrees()}
                onSelectNode={selectOpeningNode}
                onSelectTree={selectOpeningTree}
                onStartDrill={startOpeningDrill}
                trees={openingTrees}
              />
            ) : (
              <TrainPanel
                activeCard={activeDeckCard}
                activeCardProgress={activeDeckProgress}
                deckActionError={deckActionError}
                deckActionLoading={deckActionLoading}
                deckCounterSan={deckOpponentBestSan}
                deckLoadError={deckLoadError}
                deckBusy={deckBusy}
                deckLibraryLoading={deckLibraryLoading}
                deckSummaries={deckSummaries}
                deckFeedback={deckFeedback}
                deckPlaybackBusy={deckPlaybackBusy}
                deckStats={deckStats}
                deckLineMastery={deckLineMastery}
                trainAllSession={trainAllSession}
                trainSessionCardCurrent={trainSessionCardCurrent}
                trainSessionCardTotal={trainSessionCardTotal}
                trainSessionStats={trainSessionStats}
                canDeleteCard={Boolean(trainingProfile && (activeDeckCard ?? nextDeckCard))}
                deleteCardLabel="Delete"
                newDeckTitle={newDeckTitle}
                nextCard={nextDeckCard}
                onBack={() => {
                  const wasTrainAllSession = trainAllSession;
                  const restoreDeckId =
                    selectedDeckId ??
                    (typeof window !== 'undefined' ? window.localStorage.getItem(LAST_TRAINING_DECK_STORAGE_KEY) : null);
                  positionRequestIdRef.current += 1;
                  timelineRequestIdRef.current += 1;
                  setGame(new Chess());
                  setInitialFen(null);
                  setMoveHistory([]);
                  setHistoryIndex(0);
                  clearVariation();
                  setMetadata(null);
                  setFileName('');
                  setPositionAnalysis(null);
                  setPreMoveAnalyses([]);
                  setTimelineAnalyses([]);
                  setPositionLoading(false);
                  setTimelineLoading(false);
                  setServerError('');
                  setTimelineError('');
                  setActiveDeckCard(null);
                  setDeckFeedback(null);
                  setDeckFeedbackArrowsVisible(false);
                  setTrainAllSession(false);
                  setTrainAllQueue([]);
                  setTrainSessionIndex(0);
                  setTrainSessionStats(createEmptyTrainSessionStats());
                  positionCacheRef.current.clear();
                  positionInFlightRef.current.clear();
                  timelineBatchInFlightRef.current.clear();
                  clearSelection();

                  if (wasTrainAllSession) {
                    void loadTrainingDeck(restoreDeckId, { autoStart: false, libraryLoading: false });
                  }
                }}
                onCreateDeck={() => void createTrainingDeck()}
                onGenerateRecentDeck={() => void generateRecentTrainingDeck()}
                onDeleteCard={() => void deleteActiveDeckCard()}
                onNext={advanceDeckCard}
                onNewDeckTitleChange={setNewDeckTitle}
                onTrainDeck={deckId => void trainDeckFromLibrary(deckId)}
                onTrainAll={() => void trainAllDecks()}
                onRenameDeck={(deckId, name) => void renameTrainingDeck(deckId, name)}
                onDeleteDeck={deckId => void deleteTrainingDeck(deckId)}
                focusCreateDeck={focusTrainCreateDeck}
                onCreateDeckFocusHandled={handleCreateDeckFocusHandled}
                selectedDeckId={selectedDeckId}
              />
            )}
          </div>
        </aside>
      </div>

      {pgnDialogOpen ? (
        <PgnImportDialog
          fileName={fileName}
          handlePgnPaste={handlePgnPaste}
          handleUpload={handleUpload}
          onClose={() => setPgnDialogOpen(false)}
          pgnDraft={pgnDraft}
          setPgnDraft={setPgnDraft}
        />
      ) : null}
    </main>
  );
}

function createEmptyTrainSessionStats(): TrainSessionStats {
  return {
    completed: 0,
    hits: 0,
    misses: 0,
  };
}

function createEmptyWorkspaceSnapshot(): WorkspaceSnapshot {
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

function normalizeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
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

function buildTimelineReviews(
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

function getPositionCacheKey(
  initialFen: string | null,
  moves: string[],
  profile: PositionAnalysisProfile = 'review',
) {
  return `analysis:v${GAME_ANALYSIS_CACHE_VERSION}:${getPositionAnalysisProfileKey(profile)}:${initialFen ?? 'startpos'}|${moves.join(' ')}`;
}

function getPositionAnalysisProfileKey(profile: PositionAnalysisProfile) {
  if (profile === 'training') {
    return `training-d${DETERMINISTIC_ANALYSIS_PROFILE.depth}-pv${DETERMINISTIC_ANALYSIS_PROFILE.multipv}`;
  }

  return `review-d${REVIEW_ANALYSIS_PROFILE.depth}-pv${REVIEW_ANALYSIS_PROFILE.multipv}`;
}

function getTimelinePositionCacheKey(initialFen: string | null, moves: string[]) {
  return `timeline:${TIMELINE_ANALYSIS_PROFILE_KEY}:${initialFen ?? 'startpos'}|${moves.join(' ')}`;
}

function mergeDeckProgress(serverProgress: DeckProgressMap, localProgress: DeckProgressMap) {
  const merged: DeckProgressMap = { ...serverProgress };

  for (const [cardId, localEntry] of Object.entries(localProgress)) {
    const serverEntry = serverProgress[cardId];

    if (!serverEntry) {
      merged[cardId] = localEntry;
    }
  }

  return merged;
}

function dedupeBoardArrows(arrows: Array<{ startSquare: string; endSquare: string; color: string }>) {
  const unique = new Map<string, { startSquare: string; endSquare: string; color: string }>();

  for (const arrow of arrows) {
    unique.set(`${arrow.startSquare}-${arrow.endSquare}`, arrow);
  }

  return [...unique.values()];
}

function isOpponentTurnFromFen(fen: string, side: 'white' | 'black') {
  const turn = fen.trim().split(/\s+/)[1];
  const playerTurn = turn === 'b' ? 'black' : 'white';
  return playerTurn !== side;
}

function normalizeDeckLoadError(message: string) {
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

function readStoredTrainingUsername() {
  if (typeof window === 'undefined') {
    return '';
  }

  const cookieValue = readCookie(TRAINING_USERNAME_COOKIE);
  const storageValue = window.localStorage.getItem(TRAINING_USERNAME_STORAGE_KEY);
  return cookieValue || storageValue || '';
}

function readStoredTrainingPassword() {
  if (typeof window === 'undefined') {
    return '';
  }

  const cookieValue = readCookie(TRAINING_PASSWORD_COOKIE);
  const storageValue = window.localStorage.getItem(TRAINING_PASSWORD_STORAGE_KEY);
  return cookieValue || storageValue || '';
}

function persistTrainingUsername(username: string) {
  writeCookie(TRAINING_USERNAME_COOKIE, username);
  window.localStorage.setItem(TRAINING_USERNAME_STORAGE_KEY, username);
}

function persistTrainingPassword(password: string) {
  writeCookie(TRAINING_PASSWORD_COOKIE, password);
  window.localStorage.setItem(TRAINING_PASSWORD_STORAGE_KEY, password);
}

function persistTrainingCredentials(username: string, password: string) {
  persistTrainingUsername(username);
  persistTrainingPassword(password);
}

function readCookie(name: string) {
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

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

function deleteCookie(name: string) {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

function delay(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function ImportIcon() {
  return (
    <svg className={styles.toolIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v10" />
      <path d="m8 9 4 4 4-4" />
      <path d="M5 15v4h14v-4" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg className={styles.toolIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h8.5a4.5 4.5 0 0 1 4.5 4.5v0A4.5 4.5 0 0 1 15.5 16H9" />
      <path d="M7 7l3-3M7 7l3 3M17 17H8.5A4.5 4.5 0 0 1 4 12.5v0A4.5 4.5 0 0 1 8.5 8H15" />
      <path d="M17 17l-3-3M17 17l-3 3" />
    </svg>
  );
}

function ArrowIcon({ off }: { off: boolean }) {
  return (
    <svg className={styles.toolIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19 18 6" />
      <path d="M10 6h8v8" />
      {off ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className={styles.toolIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11a8 8 0 0 0-14.5-4.6L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.5 4.6L20 16" />
      <path d="M20 20v-4h-4" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg className={styles.toolIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}
