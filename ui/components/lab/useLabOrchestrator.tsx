'use client';

import { Chess } from 'chess.js';
import { type ChangeEvent, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceMode } from '@/components/chess-lab-panels';
import { buildDeterministicAnalyzeRequest } from '@/lib/analysis-profile';

import type { AnalysisResult } from '@/lib/analysis-types';
import {
  buildLiveTrainMoveReview,
  cardMoveReviewsFromTimeline,
  resolveTrainBoardMoveReview,
  resolveTrainReplayBestMoveUci,
  shouldUseLiveTrainMoveReview,
} from '@/lib/card-move-reviews';
import {
  analyzeSinglePosition,
  buildGameReview,
  buildMoveUciHistory,
  extractMetadataFromGame,
  filterReviewMoments,
  formatBestMove,
  formatEvalCpLabel,
  formatScoreLabel,
  type GameMetadata,
  getAdvantageMeter,
  getAdvantageMeterFromEvalCp,
  getBestMoveArrow,
  type ReviewCategory,
  restoreGameFromHistory,
  reviewCategoryMeta,
  type StoredMove,
  type TimelineReview,
  toStoredMove,
} from '@/lib/chess-analysis-client';
import { getMoveSoundSequence, getPrimaryMoveSound } from '@/lib/chess-sounds';
import type { ChessComRecentGameSummary } from '@/lib/chesscom';
import {
  getDeckProgressEntry,
  getDeckStudyQueue,
  sortCardsForReview,
  summarizeDeckProgress,
  summarizeLineMastery,
} from '@/lib/deck-progress';
import type { DeckCard, DeckFeedback } from '@/lib/opening-training';
import { sliceOpeningForest } from '@/lib/opening-tree';
import { resolvePostMoveVerifiedReviewCardAnswer } from '@/lib/review-card-answer';
import { useLabAudio } from '../../hooks/lab/useLabAudio';
import { useLabDeckManager } from '../../hooks/lab/useLabDeckManager';
import { useLabEngine } from '../../hooks/lab/useLabEngine';
import { useLabGame } from '../../hooks/lab/useLabGame';
import { useLabLines } from '../../hooks/lab/useLabLines';
import { useLabReview } from '../../hooks/lab/useLabReview';
import { useLabTraining } from '../../hooks/lab/useLabTraining';
import { useRecentGames } from '../../hooks/lab/useRecentGames';
import { useTrainingProfile } from '../../hooks/lab/useTrainingProfile';
import { useLabState } from '../../hooks/useLabState';
import {
  buildTimelineReviews,
  type CachedTimelineAnalysis,
  createEmptyTrainSessionStats,
  createEmptyWorkspaceSnapshot,
  dedupeBoardArrows,
  getPositionCacheKey,
  getRecentGameCacheKey,
  isOpponentTurnFromFen,
  isUsableCachedTimelineAnalysis,
  LAST_TRAINING_DECK_STORAGE_KEY,
  loadCachedTimelineAnalysis,
  normalizeWorkspaceSnapshot,
  persistTrainingCredentials,
  recentGameAnalysisMemoryCache,
  saveCachedTimelineAnalysis,
} from '../../lib/lab-helpers';

const TIMELINE_CACHE_PROGRESS = 4;
const TIMELINE_ENGINE_PROGRESS_OFFSET = 8;
const TIMELINE_ENGINE_PROGRESS_WEIGHT = 0.84;
const LAST_MOVE_STYLE = {
  backgroundColor: 'rgba(84, 173, 255, 0.26)',
  boxShadow: 'inset 0 0 0 2px rgba(181, 222, 255, 0.42)',
} satisfies CSSProperties;
const RECENT_GAMES_PRELOAD_SCAN_MS = 1_000;

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

  return CAPTURED_PIECE_ORDER.flatMap((piece) =>
    Array.from({ length: counts.get(piece) ?? 0 }, () => CAPTURED_PIECE_ICONS[capturedColor][piece] ?? ''),
  ).filter(Boolean);
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

export function useLabOrchestrator() {
  const labState = useLabState();
  const {
    game,
    setGame,
    initialFen,
    setInitialFen,
    moveHistory,
    setMoveHistory,
    historyIndex,
    setHistoryIndex,
    variationBaseIndex,
    setVariationBaseIndex,
    variationMoves,
    setVariationMoves,
    setSelectedSquare,
    squareStyles,
    setSquareStyles,
    orientation,
    setOrientation,
    showArrow,
    setShowArrow,
    mode,
    setMode,
    reviewSide,
    reviewIndex,
    setReviewIndex,
    metadata,
    setMetadata,
    whiteAvatarUrl,
    setWhiteAvatarUrl,
    blackAvatarUrl,
    setBlackAvatarUrl,
    fileName,
    setFileName,
    pgnDraft,
    pgnDialogOpen,
    setPgnDialogOpen,
    positionAnalysis,
    setPositionAnalysis,
    preMoveAnalyses,
    setPreMoveAnalyses,
    timelineAnalyses,
    setTimelineAnalyses,
    positionLoading,
    setPositionLoading,
    setTimelineLoading,
    setTimelineProgress,
    serverError,
    setServerError,
    timelineError,
    setTimelineError,
    boardWidth,
    deckIndex,
    setDeckIndex,
    trainAllSession,
    setTrainAllSession,
    trainAllQueue,
    setTrainAllQueue,
    trainSessionIndex,
    setTrainSessionIndex,
    trainSessionStats,
    setTrainSessionStats,
    activeDeckCard,
    setActiveDeckCard,
    deckFeedback,
    setDeckFeedback,
    deckFeedbackArrowsVisible,
    setDeckFeedbackArrowsVisible,
    openingLines,
    deckCards,
    setDeckCards,
    selectedDeckId,
    setSelectedDeckId,
    deckLibraryLoading,
    deckCardsLoading,
    setDeckActionLoading,
    setDeckActionError,
    setOpeningTrees,
    setActiveOpeningTree,
    setSelectedOpeningTreeId,
    setActiveOpeningNodeId,
    openingDrillActive,
    drillPathRef,
    drillPathIndexRef,
    setReviewDeckSaveStatus,
    deckProgress,
    setDeckProgress,
    chesscomUsername,
    recentChessGames,
    trainingProfile,
    setTrainingProfile,
    trainingProfileBootstrapping,
    setTrainingProfileSubmitting,
    setTrainingProfileError,
    trainingUsername,
    setTrainingUsername,
    trainingPassword,
    setTrainingPassword,
    trainingCredentialsHydratedRef,
    setFocusTrainCreateDeck,
    saveReplayFromStart,
    deckPlaybackBusy,
    setDeckPlaybackBusy,
    trainAnalysisTick,
    boardStageRef,
    evalRailRef,
    positionRequestIdRef,
    timelineRequestIdRef,
    timelineRefineRequestIdRef,
    reviewPlaybackRequestIdRef,
    deckPlaybackRequestIdRef,
    deckReplayMovesRef,
    deckReplayInitialFenRef,
  } = labState;

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
  const currentLineKey = useMemo(
    () => getPositionCacheKey(initialFen, currentMoveList, activeDeckCard ? 'training' : 'review'),
    [activeDeckCard, currentMoveList, initialFen],
  );

  const engineContext = useMemo(
    () => ({
      currentFen,
      currentMoveList,
      currentLineKey,
    }),
    [currentFen, currentLineKey, currentMoveList],
  );

  const { analyzeTimelineDeep, clearEngineCache, positionCacheRef, positionInFlightRef, timelineBatchInFlightRef } =
    useLabEngine(labState, engineContext);

  const recentGamesRefs = useMemo(
    () => ({
      modeRef,
      positionInFlightRef,
      lastReviewInteractionAtRef,
    }),
    [positionInFlightRef],
  );

  const { fetchRecentChessGames, preloadRecentGameAnalysis, cancelRecentPreload } = useRecentGames(
    labState,
    recentGamesRefs,
    {
      analyzeTimelineDeep: (...args) => analyzeTimelineDeep(...args),
    },
  );

  const trainingProfileRefs = useMemo(
    () => ({
      progressHydratedRef,
      progressSyncTimerRef,
      trainingCredentialsHydratedRef,
    }),
    [trainingCredentialsHydratedRef],
  );

  const { saveTrainingAttempt, hydrateTrainingProgressRef } = useTrainingProfile(labState, trainingProfileRefs);

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
    // trainAnalysisTick busts stale reads from positionCacheRef after async analysis completes.
  }, [currentMoves, historyIndex, initialFen, positionAnalysis, trainAnalysisTick, positionCacheRef]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeTrainMoveReview = useMemo(() => {
    if (!activeDeckCard || historyIndex <= 0) {
      return null;
    }

    const moveIndex = historyIndex - 1;

    if (shouldUseLiveTrainMoveReview(activeDeckCard, currentMoves, moveIndex, trainAnswerFeedback)) {
      return buildLiveTrainMoveReview(moveIndex, currentMoves, trainPositionAnalyses, initialFen);
    }

    return resolveTrainBoardMoveReview(activeDeckCard, moveIndex, currentMoves, initialFen, trainAnswerFeedback);
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
  const deckAnswerArrow = isAtDeckFailureFeedbackView
    ? getBestMoveArrow(deckFeedback?.expectedUci ?? activeDeckCard?.answerUci ?? null)
    : [];
  const trainBestMoveArrow =
    isTrainCardFinished && !isAtDeckFailureFeedbackView ? getBestMoveArrow(trainReplayBestMoveUci) : [];
  const deckOpponentArrow =
    isViewingDeckFailurePosition && !positionLoading && positionAnalysis?.bestMove
      ? getBestMoveArrow(positionAnalysis?.bestMove ?? null, '#ff456f')
      : [];
  const deckOpponentBestSan =
    isViewingDeckFailurePosition && !positionLoading && positionAnalysis?.bestMove
      ? formatBestMove(currentFen, positionAnalysis.bestMove)
      : null;
  const reviewSaveMoveSan =
    !activeDeckCard && hasLoadedGame && !positionLoading && displayAnalysis?.bestMove
      ? formatBestMove(currentFen, displayAnalysis.bestMove)
      : null;
  const boardArrows =
    mode === 'lines'
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
      materialAdvantage: Math.max(
        0,
        getCapturedMaterialValue(currentMoves, 'white') - getCapturedMaterialValue(currentMoves, 'black'),
      ),
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
      materialAdvantage: Math.max(
        0,
        getCapturedMaterialValue(currentMoves, 'black') - getCapturedMaterialValue(currentMoves, 'white'),
      ),
    }),
    [blackAvatarUrl, blackReviewName, currentMoves, metadata?.blackElo],
  );
  const topBoardPlayer = orientation === 'white' ? blackBoardPlayer : whiteBoardPlayer;
  const bottomBoardPlayer = orientation === 'white' ? whiteBoardPlayer : blackBoardPlayer;
  const sortedDeckCards = useMemo(() => sortCardsForReview(deckCards, deckProgress), [deckCards, deckProgress]);
  const availableDeckCards = useMemo(
    () => getDeckStudyQueue(sortedDeckCards, deckProgress),
    [deckProgress, sortedDeckCards],
  );
  const trainStatsCards = trainAllSession ? trainAllQueue : deckCards;
  const deckStats = useMemo(
    () => summarizeDeckProgress(trainStatsCards, deckProgress),
    [deckProgress, trainStatsCards],
  );
  const trainSessionCardTotal = trainAllSession ? trainAllQueue.length : availableDeckCards.length;
  const trainSessionCardCurrent = trainAllSession
    ? trainSessionIndex + 1
    : Math.max(
        1,
        (activeDeckCard ? availableDeckCards.findIndex((card) => card.id === activeDeckCard.id) : deckIndex) + 1,
      );
  const nextDeckCard = availableDeckCards[deckIndex % Math.max(1, availableDeckCards.length)] ?? null;
  const viewedDeckCard = activeDeckCard ?? nextDeckCard;
  const activeDeckProgress = useMemo(
    () => (viewedDeckCard ? getDeckProgressEntry(deckProgress, viewedDeckCard.id) : null),
    [deckProgress, viewedDeckCard],
  );
  const deckLineMastery = useMemo(() => summarizeLineMastery(deckCards, deckProgress), [deckCards, deckProgress]);
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
  const linesBoardClassification = useMemo(() => {
    if (mode !== 'lines' || !openingDrillActive || historyIndex !== moveHistory.length || deckFeedback == null) {
      return null;
    }

    const classifiedMove =
      currentMoves.find((move) => move.uci === deckFeedback.playedUci) ?? currentMoves[currentMoves.length - 1] ?? null;

    if (!classifiedMove) {
      return null;
    }

    return {
      move: classifiedMove,
      category: deckFeedback.correct ? (deckFeedback.exact ? ('best' as const) : ('book' as const)) : ('miss' as const),
    };
  }, [currentMoves, deckFeedback, historyIndex, mode, moveHistory.length, openingDrillActive]);
  const boardSquareStyles = useMemo(() => {
    const nextStyles: Record<string, CSSProperties> = {};
    const lastMove = currentMoves[currentMoves.length - 1];
    const reviewCategory = activeDeckCard
      ? (activeTrainMoveReview?.category ?? null)
      : linesBoardClassification
        ? linesBoardClassification.category
        : mode === 'lines' && historyIndex > 0
          ? historyIndex === moveHistory.length && deckFeedback != null
            ? deckFeedback.correct
              ? 'excellent'
              : 'mistake'
            : 'book'
          : hasLoadedGame && variationBaseIndex == null && historyIndex > 0
            ? timelineReviews[historyIndex - 1]?.category
            : null;
    const styledMove = linesBoardClassification?.move ?? lastMove;
    const lastMoveStyle = getReviewMoveStyle(reviewCategory);

    if (styledMove) {
      nextStyles[styledMove.from] = lastMoveStyle;
      nextStyles[styledMove.to] = lastMoveStyle;
    }

    return {
      ...nextStyles,
      ...squareStyles,
    };
  }, [
    activeDeckCard,
    activeTrainMoveReview,
    currentMoves,
    deckFeedback,
    hasLoadedGame,
    historyIndex,
    linesBoardClassification,
    mode,
    moveHistory.length,
    squareStyles,
    timelineReviews,
    variationBaseIndex,
  ]);
  const boardReviewBadge = useMemo(() => {
    if (historyIndex <= 0 || variationBaseIndex != null) {
      return null;
    }

    const lastMove = currentMoves[currentMoves.length - 1];
    const category = activeDeckCard
      ? (activeTrainMoveReview?.category ?? null)
      : linesBoardClassification
        ? linesBoardClassification.category
        : mode === 'lines' && historyIndex > 0
          ? historyIndex === moveHistory.length && deckFeedback != null
            ? deckFeedback.correct
              ? 'excellent'
              : 'mistake'
            : 'book'
          : hasLoadedGame
            ? timelineReviews[historyIndex - 1]?.category
            : null;

    const badgeMove = linesBoardClassification?.move ?? lastMove;

    if (!badgeMove || !category) {
      return null;
    }

    const meta = reviewCategoryMeta[category];
    const placement = getBoardSquareCenter(badgeMove.to, orientation, boardWidth);

    if (!meta?.badge || !placement) {
      return null;
    }

    return {
      badge: meta.badge,
      color: meta.color,
      ...placement,
    };
  }, [
    activeDeckCard,
    activeTrainMoveReview,
    boardWidth,
    currentMoves,
    deckFeedback,
    hasLoadedGame,
    historyIndex,
    linesBoardClassification,
    mode,
    moveHistory.length,
    orientation,
    timelineReviews,
    variationBaseIndex,
  ]);

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
  }, [preloadRecentGameAnalysis, recentChessGames]);

  const suppressSpaceKeyUpRef = useRef(false);
  const loadTrainingDeckRef = useRef<
    (
      deckId?: string | null,
      options?: { autoStart?: boolean; allDecks?: boolean; libraryLoading?: boolean },
    ) => Promise<void>
  >(async () => undefined);
  const deckCardPromptStartedAtRef = useRef<number | null>(null);
  const advanceDrillToStepRef = useRef<
    (stepIndex: number, options?: { isOpponentMovePlayback?: boolean; syncOnly?: boolean }) => void
  >(() => {});
  const cancelDrillOpponentMoveRef = useRef<() => void>(() => {});
  const linesGameTimeoutRef = useRef<number | null>(null);

  const gameContext = useMemo(
    () => ({
      advanceDrillToStepRef,
      cancelDrillOpponentMoveRef,
      linesGameTimeoutRef,
      playSoundSequence,
      playSound,
      saveTrainingAttempt,
      timelineRefineRequestIdRef,
      deckCardPromptStartedAtRef,
      modeRef,
      drillPathRef,
      drillPathIndexRef,
    }),
    [playSoundSequence, playSound, saveTrainingAttempt, timelineRefineRequestIdRef, drillPathRef, drillPathIndexRef],
  );

  const { clearSelection, clearVariation, highlightMoves, tryMove, jumpToIndex, undoMove } = useLabGame(
    labState,
    gameContext,
  );
  const applyWorkspaceSnapshot = useCallback(
    (snapshot: WorkspaceSnapshot) => {
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
    },
    [
      setActiveDeckCard,
      setBlackAvatarUrl,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setDeckIndex,
      setFileName,
      setGame,
      setHistoryIndex,
      setInitialFen,
      setMetadata,
      setMoveHistory,
      setOrientation,
      setPositionAnalysis,
      setPreMoveAnalyses,
      setReviewIndex,
      setServerError,
      setShowArrow,
      setTimelineAnalyses,
      setTimelineError,
      setTrainAllQueue,
      setTrainAllSession,
      setTrainSessionIndex,
      setTrainSessionStats,
      setVariationBaseIndex,
      setVariationMoves,
      setWhiteAvatarUrl,
      setPositionLoading,
      setTimelineLoading,
      setSelectedSquare,
      setSquareStyles,
      timelineRefineRequestIdRef,
      timelineRequestIdRef,
      positionRequestIdRef,
    ],
  );

  const persistReviewWorkspaceSnapshot = useCallback(() => {
    if (modeRef.current !== 'review' || workspaceStateRef.current.metadata == null) {
      return;
    }

    reviewWorkspaceSnapshotRef.current = normalizeWorkspaceSnapshot(workspaceStateRef.current);
  }, []);

  const persistTrainWorkspaceSnapshot = useCallback(() => {
    if (modeRef.current !== 'train') {
      return;
    }

    trainWorkspaceSnapshotRef.current = normalizeWorkspaceSnapshot(workspaceStateRef.current);
  }, []);

  const switchWorkspaceMode = useCallback(
    (nextMode: WorkspaceMode) => {
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
    },
    [
      applyWorkspaceSnapshot,
      setActiveDeckCard,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setMode,
      persistTrainWorkspaceSnapshot,
      persistReviewWorkspaceSnapshot,
    ],
  );

  const openTrainCreateDeck = useCallback(() => {
    if (!trainingProfile) {
      setFocusTrainCreateDeck(true);
      return;
    }

    switchWorkspaceMode('train');
    setFocusTrainCreateDeck(true);
  }, [switchWorkspaceMode, trainingProfile, setFocusTrainCreateDeck]);

  const trainingContext = useMemo(
    () => ({
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
    }),
    [
      clearSelection,
      clearVariation,
      persistReviewWorkspaceSnapshot,
      playSound,
      playSoundSequence,
      timelineRefineRequestIdRef,
      deckReplayInitialFenRef,
      deckReplayMovesRef,
    ],
  );

  const { playDeckReplayToIndex, startDeckCardWithReplay, loadTrainingDeck, selectedDeckIdRef } = useLabTraining(
    labState,
    trainingContext,
  );

  const deckProgressRef = useRef(deckProgress);
  const deckFeedbackRef = useRef(deckFeedback);

  const linesContext = useMemo(
    () => ({
      playSound,
      playSoundSequence,
      playDeckReplayToIndex,
      clearSelection,
      clearVariation,
      positionRequestIdRef,
      timelineRequestIdRef,
      deckReplayInitialFenRef,
      deckReplayMovesRef,
      deckPlaybackRequestIdRef,
      linesGameTimeoutRef,
      modeRef,
    }),
    [
      clearSelection,
      clearVariation,
      playDeckReplayToIndex,
      playSound,
      playSoundSequence,
      positionRequestIdRef,
      timelineRequestIdRef,
      deckReplayMovesRef,
      deckReplayInitialFenRef,
      deckPlaybackRequestIdRef,
      linesGameTimeoutRef,
    ],
  );

  const {
    loadOpeningTrees,
    importRecentOpeningTrees,
    advanceDrillToStep,
    startOpeningDrill,
    stopOpeningDrill,
    cancelDrillOpponentMove,
    selectOpeningTree,
    selectOpeningNode,
  } = useLabLines(labState, linesContext);

  useEffect(() => {
    cancelDrillOpponentMoveRef.current = cancelDrillOpponentMove;
  }, [cancelDrillOpponentMove]);

  useEffect(() => {
    advanceDrillToStepRef.current = advanceDrillToStep;
  }, [advanceDrillToStep]);

  const { createTrainingDeck, generateRecentTrainingDeck, renameTrainingDeck, deleteTrainingDeck } = useLabDeckManager(
    labState,
    { loadTrainingDeck },
  );

  const { goToReviewMoment, cancelReviewPlayback } = useLabReview(labState, {
    reviewPlaybackRequestIdRef,
    playSoundSequence,
    jumpToIndex,
    activeDeckCard,
    reviewPlayerSide,
    orientation,
  });

  const jumpToReviewIndex = useCallback(
    (index: number) => {
      if (mode === 'review' && !activeDeckCard) {
        cancelReviewPlayback();
      }
      jumpToIndex(index);
    },
    [activeDeckCard, cancelReviewPlayback, jumpToIndex, mode],
  );

  const handleGoToReviewMoment = useCallback(
    (index: number) => {
      goToReviewMoment(index, reviewMoments, { clearVariation, clearSelection });
    },
    [clearSelection, clearVariation, goToReviewMoment, reviewMoments],
  );

  loadTrainingDeckRef.current = loadTrainingDeck;

  useEffect(() => {
    deckProgressRef.current = deckProgress;
  }, [deckProgress]);

  useEffect(() => {
    deckFeedbackRef.current = deckFeedback;
  }, [deckFeedback]);

  useEffect(() => {
    selectedDeckIdRef.current = selectedDeckId;
  }, [selectedDeckId, selectedDeckIdRef]);

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
    const storedDeckId =
      typeof window === 'undefined' ? null : window.localStorage.getItem(LAST_TRAINING_DECK_STORAGE_KEY);

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
  }, [
    loadOpeningTrees,
    trainingProfile?.id,
    trainingProfileBootstrapping,
    setOpeningTrees,
    setSelectedOpeningTreeId,
    setActiveOpeningTree,
    setActiveOpeningNodeId,
  ]);

  useEffect(() => {
    setReviewIndex((value) => Math.max(0, Math.min(value, Math.max(0, reviewMoments.length - 1))));
  }, [reviewMoments.length, setReviewIndex]);

  const loadDeckCard = useCallback(
    async (card: DeckCard | null) => {
      if (!card) {
        return;
      }

      await startDeckCardWithReplay(card, openingLines);
    },
    [openingLines, startDeckCardWithReplay],
  );

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
  }, [
    loadTrainingDeck,
    selectedDeckId,
    trainAllSession,
    setTrainAllQueue,
    setDeckFeedback,
    positionRequestIdRef,
    setMoveHistory,
    setTrainAllSession,
    setFileName,
    setTimelineLoading,
    setTimelineError,
    clearSelection,
    setTrainSessionIndex,
    setWhiteAvatarUrl,
    setTimelineAnalyses,
    setHistoryIndex,
    setActiveDeckCard,
    setGame,
    setDeckFeedbackArrowsVisible,
    setPositionLoading,
    setTrainSessionStats,
    setPositionAnalysis,
    setPreMoveAnalyses,
    setBlackAvatarUrl,
    setServerError,
    setMetadata,
    setInitialFen,
    clearVariation,
  ]);

  const deckBusy = deckLibraryLoading || deckCardsLoading;

  const trainDeckFromLibrary = useCallback(
    async (deckId: string) => {
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
    },
    [
      deckBusy,
      deckCards,
      deckProgress,
      loadTrainingDeck,
      openingLines,
      selectedDeckId,
      startDeckCardWithReplay,
      setTrainAllQueue,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setTrainSessionStats,
      setSelectedDeckId,
      setDeckIndex,
      setTrainSessionIndex,
      setTrainAllSession,
      setActiveDeckCard,
    ],
  );

  const trainAllDecks = useCallback(async () => {
    setTrainAllSession(true);
    setActiveDeckCard(null);
    setDeckFeedback(null);
    setDeckFeedbackArrowsVisible(false);
    await loadTrainingDeck(undefined, { autoStart: true, allDecks: true });
  }, [loadTrainingDeck, setActiveDeckCard, setDeckFeedbackArrowsVisible, setTrainAllSession, setDeckFeedback]);

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
      setTrainSessionStats((previous) => ({
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
    const nextPriorityCard = sessionCards.find((card) => card.id !== currentCardId) ?? sessionCards[0];
    const nextIndex = sessionCards.findIndex((card) => card.id === nextPriorityCard.id);

    setDeckIndex(nextIndex);
    loadDeckCard(nextPriorityCard);
  }, [
    activeDeckCard,
    availableDeckCards,
    finishDeckTrainingSession,
    loadDeckCard,
    trainAllQueue,
    trainAllSession,
    trainSessionIndex,
    setTrainSessionIndex,
    setTrainSessionStats,
    setDeckPlaybackBusy,
    setDeckIndex,
    deckPlaybackRequestIdRef,
  ]);

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

      const remainingCards = deckCards.filter((entry) => entry.id !== card.id);
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
    setPositionAnalysis,
    setDeckActionError,
    setMetadata,
    setTimelineAnalyses,
    setGame,
    setDeckFeedbackArrowsVisible,
    setActiveDeckCard,
    setDeckActionLoading,
    setMoveHistory,
    setFileName,
    setPreMoveAnalyses,
    setInitialFen,
    setDeckFeedback,
    setDeckCards,
    setDeckProgress,
    clearVariation,
    positionRequestIdRef,
    setHistoryIndex,
    clearSelection,
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

        if (mode === 'review' && !activeDeckCard && !openingDrillActive) {
          cancelReviewPlayback();
        }

        if (openingDrillActive) {
          jumpToIndex(historyIndex - 1);
          return;
        }

        const boundedIndex = Math.max(0, Math.min(historyIndex - 1, moveHistory.length));
        const nextGame = restoreGameFromHistory(moveHistory, initialFen, boundedIndex);

        if (boundedIndex === historyIndex - 1) {
          const replayedMove = moveHistory[boundedIndex];

          if (replayedMove) {
            const playerSide = activeDeckCard?.side ?? reviewPlayerSide;
            const isSelfMove =
              playerSide == null
                ? orientation === 'white'
                : (playerSide === 'white' && replayedMove.color === 'w') ||
                  (playerSide === 'black' && replayedMove.color === 'b');

            playSoundSequence([getPrimaryMoveSound(replayedMove, isSelfMove)]);
          }
        }

        setHistoryIndex(boundedIndex);
        if (activeDeckCard || openingDrillActive) {
          setDeckFeedbackArrowsVisible(false);
          setDeckFeedback(null);
        }
        clearVariation();
        setGame(nextGame);
        clearSelection();
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();

        if (mode === 'review' && !activeDeckCard && !openingDrillActive) {
          cancelReviewPlayback();
        }

        if (openingDrillActive) {
          jumpToIndex(historyIndex + 1);
          return;
        }

        const boundedIndex = Math.max(0, Math.min(historyIndex + 1, moveHistory.length));
        const nextGame = restoreGameFromHistory(moveHistory, initialFen, boundedIndex);

        if (boundedIndex === historyIndex + 1) {
          const replayedMove = moveHistory[historyIndex];

          if (replayedMove) {
            const playerSide = activeDeckCard?.side ?? reviewPlayerSide;
            const isSelfMove =
              playerSide == null
                ? orientation === 'white'
                : (playerSide === 'white' && replayedMove.color === 'w') ||
                  (playerSide === 'black' && replayedMove.color === 'b');

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

        if (mode === 'review' && !activeDeckCard && !openingDrillActive) {
          cancelReviewPlayback();
        }

        if (openingDrillActive) {
          jumpToIndex(moveHistory.length);
          return;
        }

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

        if (mode === 'review' && !activeDeckCard && !openingDrillActive) {
          cancelReviewPlayback();
        }

        if (openingDrillActive) {
          jumpToIndex(moveHistory.length > 0 ? 1 : 0);
          return;
        }

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
  }, [
    activeDeckCard,
    advanceDeckCard,
    cancelReviewPlayback,
    clearSelection,
    clearVariation,
    deckFeedback,
    deckPlaybackBusy,
    historyIndex,
    initialFen,
    jumpToIndex,
    mode,
    moveHistory,
    openingDrillActive,
    orientation,
    pgnDialogOpen,
    playSoundSequence,
    positionAnalysis?.bestMove,
    reviewPlayerSide,
    setDeckFeedback,
    setDeckFeedbackArrowsVisible,
    setGame,
    setHistoryIndex,
    tryMove,
  ]);

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
      const sequence = await analyzeTimelineDeep(
        nextMoves,
        nextInitialFen,
        (progress) => {
          if (timelineRequestIdRef.current === requestId) {
            setTimelineProgress(TIMELINE_ENGINE_PROGRESS_OFFSET + progress * TIMELINE_ENGINE_PROGRESS_WEIGHT);
          }
        },
        'review',
      );

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
      const cachedAnalysis = isUsableCachedTimelineAnalysis(requestedCachedAnalysis, nextHistory.length)
        ? requestedCachedAnalysis
        : null;

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
    reader.onload = async (loadEvent) => {
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

    await loadPgnText(gameSummary.link, gameSummary.pgn, gameSummary.playerColor === 'black' ? 'black' : 'white', {
      cachedAnalysis: memoryCachedAnalysis,
      cacheKey,
      gameLink: gameSummary.link || gameSummary.url,
      skipAnalysis: !memoryCachedAnalysis,
      whiteAvatarUrl: gameSummary.whiteAvatar,
      blackAvatarUrl: gameSummary.blackAvatar,
    });

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
        analyzePosition: (request) => analyzeSinglePosition(request),
      });
      const setupMoves = saveReplayFromStart ? currentMoves.map((move) => move.san) : [];
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
            context: currentMoves.length > 0 ? currentMoves.map((move) => move.san).join(' ') : 'Starting position',
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

  function cancelPendingAnalysisRequests() {
    positionRequestIdRef.current += 1;
    timelineRequestIdRef.current += 1;
  }

  function resetWorkspace() {
    cancelPendingAnalysisRequests();
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
    'chess-lab min-h-svh h-svh overflow-hidden p-[18px] text-(--text)',
    'max-[980px]:h-auto max-[980px]:min-h-svh max-[980px]:overflow-auto max-[720px]:p-3',
    mode === 'train' ? 'chess-lab--train' : '',
    mode === 'train' && activeDeckCard ? 'chess-lab--train-session max-[720px]:overflow-auto max-[720px]:p-1' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const pageStyle = {
    backgroundColor: '#07101b',
    backgroundImage: 'linear-gradient(180deg, rgba(7, 12, 20, 0.34) 0%, rgba(5, 9, 15, 0.7) 100%), url("/bg.png")',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed',
  } satisfies CSSProperties;

  const slicedTrees = useMemo(
    () => sliceOpeningForest(labState.openingTrees, labState.minForcedPlies),
    [labState.openingTrees, labState.minForcedPlies],
  );

  const overriddenLabState = useMemo(
    () => ({
      ...labState,
      openingTrees: slicedTrees,
      activeOpeningTree: slicedTrees.find((t) => t.id === labState.selectedOpeningTreeId) ?? null,
    }),
    [labState, slicedTrees],
  );

  const handleSelectOpeningTree = useCallback(
    (treeId: string) => {
      const treeObj = slicedTrees.find((t) => t.id === treeId);
      return selectOpeningTree(treeId, treeObj);
    },
    [selectOpeningTree, slicedTrees],
  );

  return {
    labState: overriddenLabState,
    gameContext,
    linesContext,
    trainingContext,
    tryMove,
    jumpToIndex,
    jumpToReviewIndex,
    cancelReviewPlayback,
    undoMove,
    highlightMoves,
    clearSelection,
    clearVariation,
    createTrainingDeck,
    generateRecentTrainingDeck,
    renameTrainingDeck,
    deleteTrainingDeck,
    goToReviewMoment,
    handleGoToReviewMoment,
    advanceDeckCard,
    trainDeckFromLibrary,
    trainAllDecks,
    finishDeckTrainingSession,
    loadTrainingDeck,
    selectOpeningTree: handleSelectOpeningTree,
    selectOpeningNode,
    startOpeningDrill,
    stopOpeningDrill,
    importRecentOpeningTrees,
    currentFen,
    currentMoves,
    hasLoadedGame,
    isTrainCardFinished,
    displayAnalysis,
    reviewMoments,
    activeReviewMoment,
    timelineReviews,
    boardSquareStyles,
    boardArrows,
    boardReviewBadge,
    movePairs,
    topBoardPlayer,
    bottomBoardPlayer,
    boardScoreLabel,
    whiteAdvantage,
    deckOpponentBestSan,
    reviewSaveMoveSan,
    deckBusy,
    deckStats,
    deckLineMastery,
    trainSessionCardCurrent,
    trainSessionCardTotal,
    nextDeckCard,
    activeDeckProgress,
    whiteReviewName,
    blackReviewName,
    pageClassName,
    pageStyle,
    applyWorkspaceSnapshot,
    persistReviewWorkspaceSnapshot,
    persistTrainWorkspaceSnapshot,
    switchWorkspaceMode,
    openTrainCreateDeck,
    resetWorkspace,
    cancelPendingAnalysisRequests,
    runTimelineAnalysis,
    loadPgnText,
    handleUpload,
    handlePgnPaste,
    loadRecentChessGame,
    openTrainingProfile,
    saveReviewPositionToDeck,
    selectSaveDeck,
    fetchRecentChessGames,
    deleteActiveDeckCard,
    // Refs needed by JSX
    boardStageRef,
    evalRailRef,
  };
}
