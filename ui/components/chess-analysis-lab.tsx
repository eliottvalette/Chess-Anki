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
  buildChartOptions,
  buildGameReview,
  buildMoveUciHistory,
  buildStoredMovesFromSanList,
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

import { useLabState } from '../hooks/useLabState';
import {
  createEmptyTrainSessionStats,
  createEmptyWorkspaceSnapshot,
  normalizeWorkspaceSnapshot,
  buildTimelineReviews,
  getPositionCacheKey,
  getPositionAnalysisProfileKey,
  getTimelinePositionCacheKey,
  mergeDeckProgress,
  dedupeBoardArrows,
  isOpponentTurnFromFen,
  normalizeDeckLoadError,
  readStoredTrainingUsername,
  readStoredTrainingPassword,
  persistTrainingUsername,
  persistTrainingPassword,
  persistTrainingCredentials,
  readCookie,
  writeCookie,
  deleteCookie,
  delay,
  type CachedTimelineAnalysis,
  saveCachedTimelineAnalysis,
  isUsableCachedTimelineAnalysis,
  getRecentGameCacheKey,
  recentGameAnalysisMemoryCache,
  loadCachedTimelineAnalysis,
  DRILL_OPPONENT_DELAY_MS,
  parseJsonResponse,
  readJsonResponse,
  type TrainingDeckPayload,
  type OpeningTreesPayload,
  LAST_TRAINING_DECK_STORAGE_KEY,
} from '../lib/lab-helpers';
import {
  ImportIcon,
  FlipIcon,
  ArrowIcon,
  RefreshIcon,
  ResetIcon
} from './lab/lab-icons';
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
import { buildDrillPath, chooseWeightedOpponentEdge, type DrillPathStep, type OpeningTreeDetail, type OpeningTreeSummary } from '@/lib/opening-tree';
import styles from './chess-analysis-lab.module.css';
import { useRecentGames } from "../hooks/lab/useRecentGames";
import { useTrainingProfile } from "../hooks/lab/useTrainingProfile";
import { useLabAudio } from '../hooks/lab/useLabAudio';
import { useLabEngine } from '../hooks/lab/useLabEngine';
import { useLabGame } from '../hooks/lab/useLabGame';
import { useLabDeckManager } from '../hooks/lab/useLabDeckManager';
import { useLabReview } from '../hooks/lab/useLabReview';
import { useLabLines } from '../hooks/lab/useLabLines';
import { useLabTraining } from '../hooks/lab/useLabTraining';

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
const TRAINING_REPLAY_MOVE_MS = 200;
const RECENT_GAMES_PAGE_SIZE = 10;
const RECENT_GAMES_AUTO_REFRESH_MS = 90_000;
const RECENT_GAMES_INTERACTION_IDLE_MS = 2_500;
const RECENT_GAMES_PRELOAD_SCAN_MS = 1_000;
const GAME_ANALYSIS_CACHE_VERSION = 6;
const TIMELINE_ANALYSIS_PROFILE_KEY = `game-review-v${REVIEW_ANALYSIS_PROFILE.version}-d${REVIEW_ANALYSIS_PROFILE.depth}-pv${REVIEW_ANALYSIS_PROFILE.multipv}`;
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

function getPgnHash(pgn: string) {
  let hash = 5381;

  for (let index = 0; index < pgn.length; index += 1) {
    hash = (hash * 33) ^ pgn.charCodeAt(index);
  }

  return `pgn:${(hash >>> 0).toString(16)}`;
}

export type TrainingProfile = {
  id: string;
  username: string;
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
  const labState = useLabState();
  const {
    game, setGame, initialFen, setInitialFen, moveHistory, setMoveHistory,
    historyIndex, setHistoryIndex, variationBaseIndex, setVariationBaseIndex,
    variationMoves, setVariationMoves, selectedSquare, setSelectedSquare,
    squareStyles, setSquareStyles, orientation, setOrientation, showArrow, setShowArrow,
    mode, setMode, reviewSide, reviewIndex, setReviewIndex, metadata, setMetadata,
    whiteAvatarUrl, setWhiteAvatarUrl, blackAvatarUrl, setBlackAvatarUrl,
    fileName, setFileName, pgnDraft, setPgnDraft, pgnDialogOpen, setPgnDialogOpen,
    positionAnalysis, setPositionAnalysis, preMoveAnalyses, setPreMoveAnalyses,
    timelineAnalyses, setTimelineAnalyses, positionLoading, setPositionLoading,
    timelineLoading, setTimelineLoading, timelineProgress, setTimelineProgress,
    serverError, setServerError, timelineError, setTimelineError, boardWidth, setBoardWidth,
    deckIndex, setDeckIndex, trainAllSession, setTrainAllSession, trainAllQueue, setTrainAllQueue,
    trainSessionIndex, setTrainSessionIndex, trainSessionStats, setTrainSessionStats,
    activeDeckCard, setActiveDeckCard, deckFeedback, setDeckFeedback,
    deckFeedbackArrowsVisible, setDeckFeedbackArrowsVisible, openingLines, setOpeningLines,
    deckCards, setDeckCards, deckSummaries, setDeckSummaries, selectedDeckId, setSelectedDeckId,
    deckLibraryLoading, setDeckLibraryLoading, deckCardsLoading, setDeckCardsLoading,
    deckLoadError, setDeckLoadError, deckActionLoading, setDeckActionLoading,
    deckActionError, setDeckActionError, openingTrees, setOpeningTrees,
    activeOpeningTree, setActiveOpeningTree, openingTreesLoading, setOpeningTreesLoading,
    openingTreeActionLoading, setOpeningTreeActionLoading, openingTreeActionError, setOpeningTreeActionError,
    selectedOpeningTreeId, setSelectedOpeningTreeId, activeOpeningNodeId, setActiveOpeningNodeId,
    openingDrillStatus, setOpeningDrillStatus, openingDrillExpected, setOpeningDrillExpected,
    openingDrillActive, setOpeningDrillActive, drillPathRef, drillPathIndexRef,
    newDeckTitle, setNewDeckTitle, reviewDeckSaveStatus, setReviewDeckSaveStatus,
    deckProgress, setDeckProgress, chesscomUsername, setChesscomUsername,
    recentGameTimeClass, setRecentGameTimeClass, recentChessGames, setRecentChessGames,
    recentChessGamesLoading, setRecentChessGamesLoading, recentChessGamesHasMore, setRecentChessGamesHasMore,
    recentChessGamesNextOffset, setRecentChessGamesNextOffset, recentChessGamesNextCursor, setRecentChessGamesNextCursor,
    recentChessGamesError, setRecentChessGamesError, recentPreloadTick, setRecentPreloadTick,
    trainingProfile, setTrainingProfile, trainingProfileBootstrapping, setTrainingProfileBootstrapping,
    trainingProfileSubmitting, setTrainingProfileSubmitting, trainingProfileError, setTrainingProfileError,
    trainingUsername, setTrainingUsername, trainingPassword, setTrainingPassword,
    trainingCredentialsHydratedRef, focusTrainCreateDeck, setFocusTrainCreateDeck,
    saveReplayFromStart, deckPlaybackBusy, setDeckPlaybackBusy, trainAnalysisTick, setTrainAnalysisTick,
    boardStageRef, evalRailRef, positionRequestIdRef, timelineRequestIdRef,
    timelineRefineRequestIdRef, reviewPlaybackRequestIdRef, deckPlaybackRequestIdRef,
    deckReplayMovesRef, deckReplayInitialFenRef
  } = labState;
  
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
  const lastDeckLibraryProfileIdRef = useRef<string | null>(null);

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
  const currentLineKey = useMemo(() => getPositionCacheKey(initialFen, currentMoveList, activeDeckCard ? 'training' : 'review'), [activeDeckCard, currentMoveList, initialFen]);

  const engineContext = useMemo(() => ({
    currentFen,
    currentMoveList,
    currentLineKey,
  }), [currentFen, currentLineKey, currentMoveList]);

  const {
    fetchCachedPositionAnalysis,
    analyzeTimelineDeep,
    clearEngineCache,
    positionCacheRef,
    positionInFlightRef,
    timelineBatchInFlightRef,
  } = useLabEngine(labState, engineContext);

  const recentGamesRefs = useMemo(() => ({
    modeRef,
    positionInFlightRef,
    lastReviewInteractionAtRef,
  }), [positionInFlightRef]);

  const {
    fetchRecentChessGames,
    preloadRecentGameAnalysis,
    cancelRecentPreload,
  } = useRecentGames(labState, recentGamesRefs, {
    analyzeTimelineDeep: (...args) => analyzeTimelineDeep(...args),
  });

      const trainingProfileRefs = useMemo(() => ({
        progressHydratedRef,
        progressSyncTimerRef,
        trainingCredentialsHydratedRef,
      }), []);

      const {
        saveTrainingProgress,
        saveTrainingAttempt,
        hydrateTrainingProgressRef,
      } = useTrainingProfile(labState, trainingProfileRefs);

      const { playSound, playSoundSequence } = useLabAudio();


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
    (activeDeckCard != null || mode === 'lines') && deckFeedback != null && !deckFeedback.pending;
  const isAtDeckFailureFeedbackView =
    isTrainCardFinished &&
    deckFeedback != null &&
    !deckFeedback.correct &&
    deckFeedbackArrowsVisible &&
    historyIndex === moveHistory.length;
  const isViewingDeckFailurePosition =
    isAtDeckFailureFeedbackView && activeDeckCard != null && isOpponentTurnFromFen(currentFen, activeDeckCard.side);
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
  const deckAnswerArrow = isAtDeckFailureFeedbackView ? getBestMoveArrow(deckFeedback?.expectedUci ?? activeDeckCard?.answerUci ?? null) : [];
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
  const boardArrows = mode === 'lines'
    ? []
    : activeDeckCard
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
      : mode === 'lines' && historyIndex > 0
        ? (historyIndex === moveHistory.length && deckFeedback != null ? (deckFeedback.correct ? 'excellent' : 'mistake') : 'book')
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
      : mode === 'lines' && historyIndex > 0
        ? (historyIndex === moveHistory.length && deckFeedback != null ? (deckFeedback.correct ? 'excellent' : 'mistake') : 'book')
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
    if (recentChessGames.length === 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void preloadRecentGameAnalysis();
    }, RECENT_GAMES_PRELOAD_SCAN_MS);

    return () => window.clearInterval(timer);
  }, [preloadRecentGameAnalysis, recentChessGames, recentPreloadTick, timelineAnalyses, timelineLoading, positionLoading]);



  const suppressSpaceKeyUpRef = useRef(false);
  const loadTrainingDeckRef = useRef<(deckId?: string | null, options?: { autoStart?: boolean; allDecks?: boolean; libraryLoading?: boolean }) => Promise<void>>(async () => undefined);
  const deckCardPromptStartedAtRef = useRef<number | null>(null);
  const advanceDrillToStepRef = useRef<(stepIndex: number) => void>(() => {});

  const gameContext = useMemo(() => ({
    advanceDrillToStepRef,
    playSoundSequence,
    playSound,
    saveTrainingAttempt,
    timelineRefineRequestIdRef,
    deckCardPromptStartedAtRef,
    modeRef,
    drillPathRef,
    drillPathIndexRef,
  }), [advanceDrillToStepRef, playSoundSequence, playSound, saveTrainingAttempt, timelineRefineRequestIdRef, deckCardPromptStartedAtRef, modeRef, drillPathRef, drillPathIndexRef]);

  const {
    clearSelection,
    clearVariation,
    highlightMoves,
    commitMove,
    tryMove,
    jumpToIndex,
  } = useLabGame(labState, gameContext);
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
  }, [clearSelection, clearVariation, setActiveDeckCard, setBlackAvatarUrl, setDeckFeedback, setDeckFeedbackArrowsVisible, setDeckIndex, setFileName, setGame, setHistoryIndex, setInitialFen, setMetadata, setMoveHistory, setOrientation, setPositionAnalysis, setPreMoveAnalyses, setReviewIndex, setServerError, setShowArrow, setTimelineAnalyses, setTimelineError, setTimelineReviews, setTrainAllQueue, setTrainAllSession, setTrainSessionIndex, setTrainSessionStats, setVariationBaseIndex, setVariationMoves, setWhiteAvatarUrl, setPositionLoading, setTimelineLoading, setSelectedSquare, setSquareStyles]);

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

  const switchWorkspaceMode = useCallback((nextMode: WorkspaceMode) => {
    if (modeRef.current === nextMode) {
      return;
    }

    if (modeRef.current === 'review') {
      persistReviewWorkspaceSnapshot();
    } else if (modeRef.current === 'train') {
      persistTrainWorkspaceSnapshot();
    }

    if (nextMode === 'review' && reviewWorkspaceSnapshotRef.current) {
      applyWorkspaceSnapshot(reviewWorkspaceSnapshotRef.current);
    } else if (nextMode === 'train' && trainWorkspaceSnapshotRef.current) {
      applyWorkspaceSnapshot(trainWorkspaceSnapshotRef.current);
    } else if (nextMode !== 'review' && nextMode !== 'train') {
      setActiveDeckCard(null);
      setDeckFeedback(null);
      setDeckFeedbackArrowsVisible(false);
    }

    setMode(nextMode);
  }, [applyWorkspaceSnapshot, setActiveDeckCard, setDeckFeedback, setDeckFeedbackArrowsVisible, setMode]);

  const openTrainCreateDeck = useCallback(() => {
    if (!trainingProfile) {
      setFocusTrainCreateDeck(true);
      return;
    }

    switchWorkspaceMode('train');
    setFocusTrainCreateDeck(true);
  }, [switchWorkspaceMode, trainingProfile]);

  const handleCreateDeckFocusHandled = useCallback(() => {
    setFocusTrainCreateDeck(false);
  }, []);
  const trainingContext = useMemo(() => ({
    playSound,
    playSoundSequence,
    clearVariation,
    clearSelection,
    persistReviewWorkspaceSnapshot,
    deckCardPromptStartedAtRef,
    deckReplayInitialFenRef,
    deckReplayMovesRef,
    timelineRefineRequestIdRef,
    modeRef,
  }), [clearSelection, clearVariation, modeRef, persistReviewWorkspaceSnapshot, playSound, playSoundSequence, timelineRefineRequestIdRef, deckCardPromptStartedAtRef]);

  const {
    beginDeckCardSession,
    playDeckReplayToIndex,
    startDeckCardWithReplay,
    loadTrainingDeck,
    deckLoadRequestIdRef,
    selectedDeckIdRef,
  } = useLabTraining(labState, trainingContext);

  const deckProgressRef = useRef(deckProgress);
  const deckFeedbackRef = useRef(deckFeedback);

  const linesContext = useMemo(() => ({
    playSound,
    playSoundSequence,
    playDeckReplayToIndex,
    clearSelection,
    clearVariation,
    positionRequestIdRef,
    timelineRequestIdRef,
    deckReplayInitialFenRef,
    deckReplayMovesRef,
    modeRef,
  }), [clearSelection, clearVariation, modeRef, playDeckReplayToIndex, playSound, playSoundSequence, positionRequestIdRef, timelineRequestIdRef]);

  const {
    loadOpeningTrees,
    importRecentOpeningTrees,
    advanceDrillToStep,
    startOpeningDrill,
    stopOpeningDrill,
    selectOpeningTree,
    selectOpeningNode,
  } = useLabLines(labState, linesContext);

  useEffect(() => {
    advanceDrillToStepRef.current = advanceDrillToStep;
  }, [advanceDrillToStep]);

  const {
    createTrainingDeck,
    generateRecentTrainingDeck,
    renameTrainingDeck,
    deleteTrainingDeck,
  } = useLabDeckManager(labState, { loadTrainingDeck });

  const {
    playToHistoryIndex,
    goToReviewMoment,
  } = useLabReview(labState, {
    reviewPlaybackRequestIdRef,
    playSoundSequence,
    jumpToIndex,
    activeDeckCard,
    reviewPlayerSide,
    orientation,
  });

  const handleGoToReviewMoment = useCallback((index: number) => {
    goToReviewMoment(index, reviewMoments, { clearVariation, clearSelection });
  }, [clearSelection, clearVariation, goToReviewMoment, reviewMoments]);

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
    setReviewIndex(value => Math.max(0, Math.min(value, Math.max(0, reviewMoments.length - 1))));
  }, [reviewMoments.length]);


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

      if (timelineRequestIdRef.current !== requestId) {
        setTimelineProgress(96);
      }

      setTimelineReviews(
        buildTimelineReviews(nextMoves, nextPreMoveAnalyses, nextTimelineAnalyses, nextInitialFen, nextMetadata),
      );

      if (timelineRequestIdRef.current !== requestId) {
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
      if (timelineRequestIdRef.current !== requestId) {
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
      await hydrateTrainingProgressRef.current({ saveMerged: false });
      await loadTrainingDeck(selectedDeckId);
    } catch (error) {
      setTrainingProfileError(error instanceof Error ? error.message : 'Unable to open training profile.');
    } finally {
      setTrainingProfileSubmitting(false);
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
    clearEngineCache();
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
                goToReviewMoment={handleGoToReviewMoment}
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
                deckFeedback={deckFeedback}
                drillActive={openingDrillActive}
                drillStatus={openingDrillStatus}
                expectedSan={openingDrillExpected?.san ?? (openingDrillExpected?.uci ? formatBestMove(currentFen, openingDrillExpected.uci) : null)}
                loading={openingTreesLoading}
                onImportRecent={() => void importRecentOpeningTrees()}
                onSelectNode={selectOpeningNode}
                onSelectTree={selectOpeningTree}
                onStartDrill={() => startOpeningDrill()}
                onStopDrill={stopOpeningDrill}
                trainSide={orientation}
                onChangeTrainSide={setOrientation}
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
                onCreateDeck={() => void createTrainingDeck(newDeckTitle)}
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

