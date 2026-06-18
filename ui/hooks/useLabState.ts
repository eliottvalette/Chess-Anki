import { Chess } from 'chess.js';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { AnalysisResult } from '@/lib/analysis-types';
import type { GameMetadata, ReviewSide, StoredMove } from '@/lib/chess-analysis-client';
import type { ChessComRecentGameSummary, ChessComRecentGameTimeClass } from '@/lib/chesscom';
import type { DeckProgressMap } from '@/lib/deck-progress';
import type { DeckCard, DeckFeedback, OpeningSeedLine } from '@/lib/opening-training';
import type {
  DrillPathStep,
  LearnBranchCompletion,
  OpeningDrillExpectedMove,
  OpeningTreeDetail,
  OpeningTreeSummary,
} from '@/lib/opening-tree';
import type { TrainingDeckSummary, TrainSessionStats, WorkspaceMode } from '../components/chess-lab-panels';
import type { TrainingProfile } from '../lib/analysis-types';
import type { LinesStudySessionLog } from '../lib/lines-study-session-log.ts';

function readStoredLinesFilter(storageKey: string, fallback: number) {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const saved = localStorage.getItem(storageKey);

  if (!saved) {
    return fallback;
  }

  const parsed = Number.parseInt(saved, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

export function useLabState() {
  const [game, setGame] = useState(() => new Chess());
  const [initialFen, setInitialFen] = useState<string | null>(null);
  const [moveHistory, setMoveHistory] = useState<StoredMove[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [variationBaseIndex, setVariationBaseIndex] = useState<number | null>(null);
  const [variationMoves, setVariationMoves] = useState<StoredMove[]>([]);
  const [variationIndex, setVariationIndex] = useState(0);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [squareStyles, setSquareStyles] = useState<Record<string, CSSProperties>>({});
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [showArrow, setShowArrow] = useState(true);
  const [mode, setMode] = useState<WorkspaceMode>('review');
  const [reviewSide, setReviewSide] = useState<ReviewSide>('both');
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
  const [minForcedPlies, setMinForcedPlies] = useState(() => readStoredLinesFilter('chess-lab-min-plies', 4));
  const [minNodes, setMinNodes] = useState(() => readStoredLinesFilter('chess-lab-min-nodes', 0));
  const [minDepth, setMinDepth] = useState(() => readStoredLinesFilter('chess-lab-min-depth', 0));
  const [learnMaxPly, setLearnMaxPly] = useState(() => readStoredLinesFilter('chess-lab-learn-max-ply', 0));

  useEffect(() => {
    localStorage.setItem('chess-lab-min-plies', minForcedPlies.toString());
  }, [minForcedPlies]);

  useEffect(() => {
    localStorage.setItem('chess-lab-min-nodes', minNodes.toString());
  }, [minNodes]);

  useEffect(() => {
    localStorage.setItem('chess-lab-min-depth', minDepth.toString());
  }, [minDepth]);

  useEffect(() => {
    localStorage.setItem('chess-lab-learn-max-ply', learnMaxPly.toString());
  }, [learnMaxPly]);

  const [activeOpeningTree, setActiveOpeningTree] = useState<OpeningTreeDetail | null>(null);
  const [openingTreesLoading, setOpeningTreesLoading] = useState(false);
  const [openingTreeActionLoading, setOpeningTreeActionLoading] = useState(false);
  const [openingTreeActionError, setOpeningTreeActionError] = useState('');
  const [selectedOpeningTreeId, setSelectedOpeningTreeId] = useState<string | null>(null);
  const [activeOpeningNodeId, setActiveOpeningNodeId] = useState<string | null>(null);
  const [openingDrillStatus, setOpeningDrillStatus] = useState('');
  const [openingDrillExpected, setOpeningDrillExpected] = useState<OpeningDrillExpectedMove | null>(null);
  const [openingDrillActive, setOpeningDrillActive] = useState(false);
  const [linesStudyMode, setLinesStudyMode] = useState<'idle' | 'learn' | 'review'>('idle');
  const [linesReviewQueue, setLinesReviewQueue] = useState<string[]>([]);
  const [linesReviewIndex, setLinesReviewIndex] = useState(0);
  const [linesLearnBranchComplete, setLinesLearnBranchComplete] = useState(false);
  const [linesCompletedLearnBranches, setLinesCompletedLearnBranches] = useState<LearnBranchCompletion[]>([]);
  const [linesActiveLearnBranch, setLinesActiveLearnBranch] = useState<LearnBranchCompletion | null>(null);
  const [linesStudySessionLog, setLinesStudySessionLog] = useState<LinesStudySessionLog | null>(null);
  const [linesTrainPlyCurrent, setLinesTrainPlyCurrent] = useState(0);
  const [linesTrainPlyTotal, setLinesTrainPlyTotal] = useState(0);
  const [linesBrowseOverrideTrees, setLinesBrowseOverrideTrees] = useState<OpeningTreeSummary[] | null>(null);
  const [linesPositionFilterLoading, setLinesPositionFilterLoading] = useState(false);
  const [activeTrainSide, setActiveTrainSide] = useState<'white' | 'black'>('white');
  const drillPathRef = useRef<DrillPathStep[]>([]);
  const drillPathIndexRef = useRef(0);
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

  return {
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
    variationIndex,
    setVariationIndex,
    selectedSquare,
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
    setReviewSide,
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
    setPgnDraft,
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
    timelineLoading,
    setTimelineLoading,
    timelineProgress,
    setTimelineProgress,
    serverError,
    setServerError,
    timelineError,
    setTimelineError,
    boardWidth,
    setBoardWidth,
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
    setOpeningLines,
    deckCards,
    setDeckCards,
    deckSummaries,
    setDeckSummaries,
    selectedDeckId,
    setSelectedDeckId,
    deckLibraryLoading,
    setDeckLibraryLoading,
    deckCardsLoading,
    setDeckCardsLoading,
    deckLoadError,
    setDeckLoadError,
    deckActionLoading,
    setDeckActionLoading,
    deckActionError,
    setDeckActionError,
    openingTrees,
    setOpeningTrees,
    minForcedPlies,
    setMinForcedPlies,
    minNodes,
    setMinNodes,
    minDepth,
    setMinDepth,
    learnMaxPly,
    setLearnMaxPly,
    activeOpeningTree,
    setActiveOpeningTree,
    openingTreesLoading,
    setOpeningTreesLoading,
    openingTreeActionLoading,
    setOpeningTreeActionLoading,
    openingTreeActionError,
    setOpeningTreeActionError,
    selectedOpeningTreeId,
    setSelectedOpeningTreeId,
    activeOpeningNodeId,
    setActiveOpeningNodeId,
    openingDrillStatus,
    setOpeningDrillStatus,
    openingDrillExpected,
    setOpeningDrillExpected,
    openingDrillActive,
    setOpeningDrillActive,
    linesStudyMode,
    setLinesStudyMode,
    linesReviewQueue,
    setLinesReviewQueue,
    linesReviewIndex,
    setLinesReviewIndex,
    linesLearnBranchComplete,
    setLinesLearnBranchComplete,
    linesCompletedLearnBranches,
    setLinesCompletedLearnBranches,
    linesActiveLearnBranch,
    setLinesActiveLearnBranch,
    linesStudySessionLog,
    setLinesStudySessionLog,
    linesTrainPlyCurrent,
    setLinesTrainPlyCurrent,
    linesTrainPlyTotal,
    setLinesTrainPlyTotal,
    linesBrowseOverrideTrees,
    setLinesBrowseOverrideTrees,
    linesPositionFilterLoading,
    setLinesPositionFilterLoading,
    drillPathRef,
    drillPathIndexRef,
    activeTrainSide,
    setActiveTrainSide,
    newDeckTitle,
    setNewDeckTitle,
    reviewDeckSaveStatus,
    setReviewDeckSaveStatus,
    deckProgress,
    setDeckProgress,
    chesscomUsername,
    setChesscomUsername,
    recentGameTimeClass,
    setRecentGameTimeClass,
    recentChessGames,
    setRecentChessGames,
    recentChessGamesLoading,
    setRecentChessGamesLoading,
    recentChessGamesHasMore,
    setRecentChessGamesHasMore,
    recentChessGamesNextOffset,
    setRecentChessGamesNextOffset,
    recentChessGamesNextCursor,
    setRecentChessGamesNextCursor,
    recentChessGamesError,
    setRecentChessGamesError,
    recentPreloadTick,
    setRecentPreloadTick,
    trainingProfile,
    setTrainingProfile,
    trainingProfileBootstrapping,
    setTrainingProfileBootstrapping,
    trainingProfileSubmitting,
    setTrainingProfileSubmitting,
    trainingProfileError,
    setTrainingProfileError,
    trainingUsername,
    setTrainingUsername,
    trainingPassword,
    setTrainingPassword,
    trainingCredentialsHydratedRef,
    focusTrainCreateDeck,
    setFocusTrainCreateDeck,
    saveReplayFromStart,
    deckPlaybackBusy,
    setDeckPlaybackBusy,
    trainAnalysisTick,
    setTrainAnalysisTick,
    boardStageRef,
    evalRailRef,
    positionRequestIdRef,
    timelineRequestIdRef,
    timelineRefineRequestIdRef,
    reviewPlaybackRequestIdRef,
    deckPlaybackRequestIdRef,
    deckReplayMovesRef,
    deckReplayInitialFenRef,
  };
}

export type LabState = ReturnType<typeof useLabState>;
