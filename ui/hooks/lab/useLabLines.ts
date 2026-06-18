import { Chess } from 'chess.js';
import { useCallback, useEffect, useRef } from 'react';
import type { WorkspaceMode } from '@/lib/analysis-types';
import type { StoredMove } from '@/lib/chess-analysis-client';
import {
  appendStoredMoveFromUci,
  buildStoredMovesFromUciList,
  restoreGameFromHistory,
} from '@/lib/chess-analysis-client';
import type { ChessSoundKey } from '@/lib/chess-sounds';
import {
  DRILL_OPPONENT_DELAY_MS,
  delay,
  LINES_LINE_PREVIEW_DELAY_MS,
  type OpeningTreesPayload,
  readJsonResponse,
} from '@/lib/lab-helpers';
import {
  buildOpeningDrillExpected,
  buildReviewQueue,
  countTrainPliesInDrillPath,
  type DrillPathStep,
  findEarliestForkNodeId,
  findPathToNode,
  isStandardStartFenKey,
  listSiblingBranchEdges,
  normalizeOpeningFen,
  type OpeningSide,
  type OpeningTreeDetail,
  pickLearnBranch,
  prepareOpeningTreeAtFenWithBoard,
  prepareOpeningTreeForLines,
  replayToNodeUcis,
  resolveCanonicalRootNode,
} from '@/lib/opening-tree';
import type { LabState } from '../useLabState';
import type { useLinesSession } from './useLinesSession';

type LinesSessionApi = ReturnType<typeof useLinesSession>;

export function useLabLines(
  state: LabState,
  context: {
    playSound: (key: ChessSoundKey) => void;
    playSoundSequence: (keys: ChessSoundKey[]) => void;
    playDeckReplayToIndex: (
      targetIndex: number,
      trainSide: OpeningSide,
      startIndex?: number,
    ) => Promise<boolean | undefined>;
    clearSelection: () => void;
    clearVariation: () => void;
    positionRequestIdRef: React.MutableRefObject<number>;
    timelineRequestIdRef: React.MutableRefObject<number>;
    deckReplayInitialFenRef: React.MutableRefObject<string | null>;
    deckReplayMovesRef: React.MutableRefObject<StoredMove[]>;
    deckPlaybackRequestIdRef: React.MutableRefObject<number>;
    linesGameTimeoutRef: React.MutableRefObject<number | null>;
    modeRef: React.MutableRefObject<WorkspaceMode> | React.RefObject<WorkspaceMode>;
    linesSession: LinesSessionApi;
  },
) {
  const {
    activeOpeningTree,
    setOpeningTrees,
    setSelectedOpeningTreeId,
    setActiveOpeningTree,
    setActiveOpeningNodeId,
    setOpeningTreeActionError,
    setOpeningTreesLoading,
    setOpeningTreeActionLoading,
    setOpeningDrillActive,
    setOpeningDrillStatus,
    setOpeningDrillExpected,
    setDeckPlaybackBusy,
    deckPlaybackBusy,
    setInitialFen,
    setMoveHistory,
    setHistoryIndex,
    setGame,
    setMetadata,
    setFileName,
    setPositionAnalysis,
    setPreMoveAnalyses,
    setTimelineAnalyses,
    setTimelineError,
    setServerError,
    setOrientation,
    setShowArrow,
    setDeckFeedback,
    setDeckFeedbackArrowsVisible,
    setMode,
    drillPathRef,
    drillPathIndexRef,
    activeTrainSide,
    minForcedPlies,
    linesStudyMode,
    setLinesStudyMode,
    linesReviewQueue,
    setLinesReviewQueue,
    linesReviewIndex,
    setLinesReviewIndex,
    setLinesLearnBranchComplete,
    linesCompletedBranchEdgeIdsRef,
    setLinesTrainPlyCurrent,
    setLinesTrainPlyTotal,
    game,
    moveHistory,
    historyIndex,
    initialFen,
  } = state;

  const moveHistoryRef = useRef(moveHistory);
  const historyIndexRef = useRef(historyIndex);
  const initialFenRef = useRef(initialFen);

  useEffect(() => {
    moveHistoryRef.current = moveHistory;
    historyIndexRef.current = historyIndex;
    initialFenRef.current = initialFen;
  }, [historyIndex, initialFen, moveHistory]);

  const {
    playSound,
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
    linesSession,
  } = context;

  const drillTimeoutRef = useRef<number | null>(null);

  const cancelDrillOpponentMove = useCallback(() => {
    if (drillTimeoutRef.current) {
      window.clearTimeout(drillTimeoutRef.current);
      drillTimeoutRef.current = null;
    }

    if (linesGameTimeoutRef.current != null) {
      window.clearTimeout(linesGameTimeoutRef.current);
      linesGameTimeoutRef.current = null;
    }
  }, [linesGameTimeoutRef]);

  const replayMovesToIndex = useCallback(
    async (fullUcis: string[], trainSide: OpeningSide, targetIndex: number) => {
      const requestId = ++deckPlaybackRequestIdRef.current;
      cancelDrillOpponentMove();
      setDeckPlaybackBusy(true);
      setOpeningDrillStatus('Loading line...');
      clearSelection();

      await delay(LINES_LINE_PREVIEW_DELAY_MS);

      if (deckPlaybackRequestIdRef.current !== requestId) {
        setDeckPlaybackBusy(false);
        return false;
      }

      const moves = buildStoredMovesFromUciList(null, fullUcis);
      setInitialFen(null);
      setMoveHistory(moves);
      deckReplayInitialFenRef.current = null;
      deckReplayMovesRef.current = moves;
      setHistoryIndex(0);
      clearVariation();
      setGame(new Chess());
      setOpeningDrillExpected(null);
      setOpeningDrillStatus('');

      const completed = await playDeckReplayToIndex(targetIndex, trainSide, 0);

      if (completed) {
        setOpeningDrillStatus('Preview position.');
      }

      return completed;
    },
    [
      cancelDrillOpponentMove,
      clearSelection,
      clearVariation,
      deckPlaybackRequestIdRef,
      deckReplayInitialFenRef,
      deckReplayMovesRef,
      playDeckReplayToIndex,
      setDeckPlaybackBusy,
      setGame,
      setHistoryIndex,
      setInitialFen,
      setMoveHistory,
      setOpeningDrillExpected,
      setOpeningDrillStatus,
    ],
  );

  const loadOpeningTreeRootOnBoard = useCallback(
    (tree: OpeningTreeDetail) => {
      const rootNode =
        resolveCanonicalRootNode(tree, tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0)) ??
        tree.nodes[0] ??
        null;

      positionRequestIdRef.current += 1;
      timelineRequestIdRef.current += 1;
      setMode('lines');
      modeRef.current = 'lines';
      setMetadata(null);
      setFileName('');
      setPositionAnalysis(null);
      setPreMoveAnalyses([]);
      setTimelineAnalyses([]);
      setTimelineError('');
      setServerError('');
      setActiveOpeningNodeId(rootNode?.id ?? null);
      setOpeningDrillExpected(
        rootNode && rootNode.sideToMove === activeTrainSide ? buildOpeningDrillExpected(tree, rootNode.id) : null,
      );
      setOpeningDrillStatus('');
      if (rootNode) {
        setOrientation(activeTrainSide);
      }
      setShowArrow(false);
      clearSelection();
      void replayMovesToIndex(tree.rootUci, activeTrainSide, tree.rootUci.length);
    },
    [
      activeTrainSide,
      clearSelection,
      modeRef,
      positionRequestIdRef,
      replayMovesToIndex,
      setActiveOpeningNodeId,
      setFileName,
      setMetadata,
      setMode,
      setOpeningDrillExpected,
      setOpeningDrillStatus,
      setOrientation,
      setPositionAnalysis,
      setPreMoveAnalyses,
      setServerError,
      setShowArrow,
      setTimelineAnalyses,
      setTimelineError,
      timelineRequestIdRef,
    ],
  );

  const loadOpeningTreeDetail = useCallback(
    async (
      treeId: string,
      options: {
        syncBoard?: boolean;
        atFenKey?: string;
        boardHistory?: StoredMove[];
      } = {},
    ) => {
      setOpeningTreeActionError('');

      try {
        const response = await fetch(`/api/opening-trees?treeId=${encodeURIComponent(treeId)}`, {
          credentials: 'same-origin',
        });
        const payload = await readJsonResponse<OpeningTreesPayload>(response);

        if (!response.ok) {
          throw new Error(payload.error ?? `Opening tree fetch failed: HTTP ${response.status}`);
        }

        const tree = payload.tree ?? null;
        let displayTree = tree ? prepareOpeningTreeForLines(tree, minForcedPlies) : null;

        if (displayTree && options.atFenKey && options.boardHistory && options.boardHistory.length > 0) {
          const prepared = prepareOpeningTreeAtFenWithBoard(
            displayTree,
            options.atFenKey,
            options.boardHistory,
            options.boardHistory.length,
          );

          if (!prepared) {
            throw new Error(`No repertoire node for board position ${options.atFenKey}`);
          }

          displayTree = prepared;
        }

        setActiveOpeningTree(displayTree);

        if (displayTree && options.syncBoard) {
          loadOpeningTreeRootOnBoard(displayTree);
        } else if (displayTree && options.atFenKey) {
          const node =
            displayTree.nodes.find((candidate) => candidate.fenKey === options.atFenKey) ??
            resolveCanonicalRootNode(displayTree, displayTree.rootPly);
          setActiveOpeningNodeId(node?.id ?? null);
          setOpeningDrillExpected(null);
        } else {
          setActiveOpeningNodeId(displayTree?.nodes[0]?.id ?? null);
        }

        return displayTree;
      } catch (error) {
        setOpeningTreeActionError(error instanceof Error ? error.message : 'Unable to load opening tree.');
        setActiveOpeningTree(null);
        return null;
      }
    },
    [
      loadOpeningTreeRootOnBoard,
      minForcedPlies,
      setActiveOpeningNodeId,
      setActiveOpeningTree,
      setOpeningDrillExpected,
      setOpeningTreeActionError,
    ],
  );

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
    } catch (error) {
      setOpeningTreeActionError(error instanceof Error ? error.message : 'Unable to load opening trees.');
      setOpeningTrees([]);
    } finally {
      setOpeningTreesLoading(false);
    }
  }, [setOpeningTreeActionError, setOpeningTrees, setOpeningTreesLoading]);

  const importRecentOpeningTrees = useCallback(async () => {
    setOpeningTreeActionLoading(true);
    setOpeningTreeActionError('');

    try {
      const response = await fetch('/api/opening-trees', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'import_recent', mode: 'fast', timeClasses: ['bullet', 'blitz'] }),
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
  }, [loadOpeningTrees, setOpeningTreeActionError, setOpeningTreeActionLoading]);

  const activeBranchEdgeIdRef = useRef<string | null>(null);
  const advanceDrillToStepRef = useRef<
    (stepIndex: number, options?: { isOpponentMovePlayback?: boolean; syncOnly?: boolean }) => void
  >(() => {});
  const advanceReviewCardRef = useRef<() => void>(() => {});

  const advanceDrillToStep = useCallback(
    (stepIndex: number, options: { isOpponentMovePlayback?: boolean; syncOnly?: boolean } = {}) => {
      const isOpponentMovePlayback = options.isOpponentMovePlayback === true;
      const syncOnly = options.syncOnly === true;
      const path = drillPathRef.current;
      const step = path[stepIndex];

      if (!step) {
        if (!syncOnly && activeOpeningTree && linesStudyMode === 'learn') {
          if (activeBranchEdgeIdRef.current) {
            linesCompletedBranchEdgeIdsRef.current = [
              ...linesCompletedBranchEdgeIdsRef.current,
              activeBranchEdgeIdRef.current,
            ];
            activeBranchEdgeIdRef.current = null;
          }
          setLinesLearnBranchComplete(true);
          setLinesStudyMode('idle');
          setOpeningDrillExpected(null);
          setOpeningDrillStatus('Branch complete.');
          setOpeningDrillActive(false);
          return;
        }

        if (!syncOnly && activeOpeningTree && linesStudyMode === 'review') {
          advanceReviewCardRef.current();
          return;
        }

        setOpeningDrillExpected(null);
        setOpeningDrillStatus('');
        setOpeningDrillActive(false);
        return;
      }

      drillPathIndexRef.current = stepIndex;
      setLinesTrainPlyTotal(countTrainPliesInDrillPath(path));
      setLinesTrainPlyCurrent(path.slice(0, stepIndex + 1).filter((pathStep) => pathStep.isTrainTurn).length);

      setActiveOpeningNodeId(step.nodeId);

      if (!syncOnly && isOpponentMovePlayback && step.edgeUciFromParent) {
        const parentStep = path[stepIndex - 1];
        const connectingEdge =
          parentStep && activeOpeningTree
            ? activeOpeningTree.edges.find(
                (edge) => edge.fromNodeId === parentStep.nodeId && edge.toNodeId === step.nodeId,
              )
            : null;

        if (connectingEdge && parentStep) {
          linesSession.markEdgeSeen(parentStep.nodeId, connectingEdge.id);
        }

        const opponentUci = step.edgeUciFromParent;
        const currentHistory = moveHistoryRef.current;
        const currentIndex = historyIndexRef.current;
        const boardFen = restoreGameFromHistory(currentHistory, initialFenRef.current, currentIndex).fen();
        const appended = appendStoredMoveFromUci(currentHistory, boardFen, opponentUci);

        moveHistoryRef.current = appended.moveHistory;
        historyIndexRef.current = currentIndex + 1;
        setMoveHistory(appended.moveHistory);
        setHistoryIndex(currentIndex + 1);
        setGame(new Chess(appended.nextFen));
        playSound('move-opponent');
      }

      setPositionAnalysis(null);
      setServerError('');
      if (step.isTrainTurn) {
        setDeckFeedback(null);
        setDeckFeedbackArrowsVisible(false);
      }
      clearSelection();

      if (step.isTrainTurn) {
        const drillExpected = activeOpeningTree
          ? buildOpeningDrillExpected(activeOpeningTree, step.nodeId)
          : step.bestUci
            ? {
                nodeId: step.nodeId,
                uci: step.bestUci,
                san: step.bestSan,
                acceptedUcis: [step.bestUci],
              }
            : null;

        if (!drillExpected) {
          if (!syncOnly && activeOpeningTree && linesStudyMode === 'learn') {
            if (activeBranchEdgeIdRef.current) {
              linesCompletedBranchEdgeIdsRef.current = [
                ...linesCompletedBranchEdgeIdsRef.current,
                activeBranchEdgeIdRef.current,
              ];
              activeBranchEdgeIdRef.current = null;
            }
            setLinesLearnBranchComplete(true);
            setLinesStudyMode('idle');
            setOpeningDrillExpected(null);
            setOpeningDrillStatus('Branch complete.');
            setOpeningDrillActive(false);
            return;
          }

          if (!syncOnly && activeOpeningTree && linesStudyMode === 'review') {
            advanceReviewCardRef.current();
            return;
          }

          setOpeningDrillExpected(null);
          setOpeningDrillStatus('Line complete.');
          setOpeningDrillActive(false);
          return;
        }

        setOpeningDrillExpected(drillExpected);
        setOpeningDrillStatus('');
        setShowArrow(false);
      } else if (!syncOnly) {
        setOpeningDrillExpected(null);
        const nextIndex = stepIndex + 1;
        const nextStep = path[nextIndex];

        if (nextStep) {
          cancelDrillOpponentMove();
          drillTimeoutRef.current = window.setTimeout(() => {
            advanceDrillToStepRef.current(nextIndex, { isOpponentMovePlayback: true });
          }, DRILL_OPPONENT_DELAY_MS);
        } else if (activeOpeningTree && linesStudyMode === 'learn') {
          if (activeBranchEdgeIdRef.current) {
            linesCompletedBranchEdgeIdsRef.current = [
              ...linesCompletedBranchEdgeIdsRef.current,
              activeBranchEdgeIdRef.current,
            ];
            activeBranchEdgeIdRef.current = null;
          }
          setLinesLearnBranchComplete(true);
          setLinesStudyMode('idle');
          setOpeningDrillExpected(null);
          setOpeningDrillStatus('Branch complete.');
          setOpeningDrillActive(false);
        } else if (activeOpeningTree && linesStudyMode === 'review') {
          advanceReviewCardRef.current();
        } else {
          setOpeningDrillExpected(null);
          setOpeningDrillStatus('');
          setOpeningDrillActive(false);
        }
      } else {
        setOpeningDrillExpected(null);
        setOpeningDrillStatus('');
      }
    },
    [
      activeOpeningTree,
      activeTrainSide,
      linesStudyMode,
      cancelDrillOpponentMove,
      clearSelection,
      drillPathIndexRef,
      drillPathRef,
      linesCompletedBranchEdgeIdsRef,
      linesSession,
      playSound,
      setActiveOpeningNodeId,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setGame,
      setHistoryIndex,
      setLinesLearnBranchComplete,
      setLinesStudyMode,
      setLinesTrainPlyCurrent,
      setLinesTrainPlyTotal,
      setMoveHistory,
      setOpeningDrillExpected,
      setOpeningDrillStatus,
      setOpeningDrillActive,
      setPositionAnalysis,
      setServerError,
      setShowArrow,
    ],
  );

  advanceDrillToStepRef.current = advanceDrillToStep;

  const beginLearnDrill = useCallback(
    (tree: OpeningTreeDetail, trainSide: OpeningSide) => {
      const { path, branchEdgeId } = pickLearnBranch(tree, trainSide, linesCompletedBranchEdgeIdsRef.current);
      activeBranchEdgeIdRef.current = branchEdgeId;

      if (path.length === 0) {
        setOpeningDrillStatus('No trainable branch left in this tree.');
        return;
      }

      const firstTrainIndex = path.findIndex((step) => step.isTrainTurn);

      if (firstTrainIndex < 0) {
        setOpeningDrillStatus('No trainable nodes in this tree yet.');
        return;
      }

      linesSession.resetSession(tree, trainSide);
      drillPathRef.current = path;
      drillPathIndexRef.current = 0;
      setLinesTrainPlyTotal(countTrainPliesInDrillPath(path));
      setLinesTrainPlyCurrent(0);
      setLinesLearnBranchComplete(false);
      setLinesStudyMode('learn');
      setOpeningDrillActive(true);
      setDeckFeedback(null);
      setDeckFeedbackArrowsVisible(false);
      setShowArrow(false);
      setOrientation(trainSide);
      playSound('game-start');

      const fullUcis = [...tree.rootUci];

      if (firstTrainIndex > 0) {
        for (let index = 1; index <= firstTrainIndex; index += 1) {
          const uci = path[index]?.edgeUciFromParent;

          if (uci) {
            fullUcis.push(uci);
          }
        }
      }

      const targetStep = path[firstTrainIndex] ?? path[0]!;
      setActiveOpeningNodeId(targetStep.nodeId);
      setOpeningDrillStatus('');
      setOpeningDrillExpected(null);
      clearSelection();

      cancelDrillOpponentMove();
      drillTimeoutRef.current = window.setTimeout(async () => {
        const replayCompleted = await replayMovesToIndex(fullUcis, trainSide, fullUcis.length);

        if (replayCompleted === false) {
          return;
        }

        advanceDrillToStep(firstTrainIndex);
      }, 500);
    },
    [
      advanceDrillToStep,
      cancelDrillOpponentMove,
      clearSelection,
      drillPathIndexRef,
      drillPathRef,
      linesCompletedBranchEdgeIdsRef,
      linesSession,
      playSound,
      replayMovesToIndex,
      setActiveOpeningNodeId,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setLinesLearnBranchComplete,
      setLinesStudyMode,
      setOpeningDrillActive,
      setOpeningDrillExpected,
      setOpeningDrillStatus,
      setOrientation,
      setShowArrow,
    ],
  );

  const replayReviewNode = useCallback(
    async (tree: OpeningTreeDetail, nodeId: string, trainSide: OpeningSide) => {
      const fullUcis = replayToNodeUcis(tree, nodeId);
      const path = findPathToNode(tree, nodeId);
      const trainStepIndex = path.findIndex((step) => step.nodeId === nodeId);
      const drillPath: DrillPathStep[] = path.map((step) => ({
        ...step,
        isTrainTurn: tree.nodes.find((node) => node.id === step.nodeId)?.sideToMove === trainSide,
        trainSide,
      }));

      drillPathRef.current = drillPath;
      drillPathIndexRef.current = Math.max(0, trainStepIndex);
      setActiveOpeningNodeId(nodeId);
      setOpeningDrillActive(true);
      setOpeningDrillExpected(null);
      setOpeningDrillStatus('');
      cancelDrillOpponentMove();
      drillTimeoutRef.current = window.setTimeout(async () => {
        const replayCompleted = await replayMovesToIndex(fullUcis, trainSide, fullUcis.length);

        if (replayCompleted === false) {
          return;
        }

        advanceDrillToStep(Math.max(0, trainStepIndex));
      }, 500);
    },
    [
      advanceDrillToStep,
      cancelDrillOpponentMove,
      drillPathIndexRef,
      drillPathRef,
      replayMovesToIndex,
      setActiveOpeningNodeId,
      setOpeningDrillActive,
      setOpeningDrillExpected,
      setOpeningDrillStatus,
    ],
  );

  const advanceReviewCard = useCallback(() => {
    const tree = activeOpeningTree;

    if (!tree) {
      return;
    }

    const nextIndex = linesReviewIndex + 1;

    if (nextIndex >= linesReviewQueue.length) {
      setOpeningDrillStatus('Review complete.');
      setOpeningDrillActive(false);
      setOpeningDrillExpected(null);
      setLinesStudyMode('idle');
      setLinesReviewQueue([]);
      setLinesReviewIndex(0);
      return;
    }

    setLinesReviewIndex(nextIndex);
    setDeckFeedback(null);
    setDeckFeedbackArrowsVisible(false);
    void replayReviewNode(tree, linesReviewQueue[nextIndex]!, activeTrainSide);
  }, [
    activeOpeningTree,
    activeTrainSide,
    linesReviewIndex,
    linesReviewQueue,
    replayReviewNode,
    setDeckFeedback,
    setDeckFeedbackArrowsVisible,
    setLinesReviewIndex,
    setLinesReviewQueue,
    setLinesStudyMode,
    setOpeningDrillActive,
    setOpeningDrillExpected,
    setOpeningDrillStatus,
  ]);

  advanceReviewCardRef.current = advanceReviewCard;

  const startLinesLearn = useCallback(
    (overrideTree?: OpeningTreeDetail, overrideTrainSide?: OpeningSide) => {
      const tree = overrideTree ?? activeOpeningTree;

      if (!tree) {
        return;
      }

      const trainSide = overrideTrainSide ?? activeTrainSide;
      positionRequestIdRef.current += 1;
      timelineRequestIdRef.current += 1;
      setMode('lines');
      modeRef.current = 'lines';
      setMetadata(null);
      setFileName('');
      setPreMoveAnalyses([]);
      setTimelineAnalyses([]);
      setTimelineError('');
      setServerError('');
      beginLearnDrill(tree, trainSide);
    },
    [
      activeOpeningTree,
      activeTrainSide,
      beginLearnDrill,
      modeRef,
      positionRequestIdRef,
      setFileName,
      setMetadata,
      setMode,
      setPreMoveAnalyses,
      setServerError,
      setTimelineAnalyses,
      setTimelineError,
      timelineRequestIdRef,
    ],
  );

  const startLinesReview = useCallback(
    (overrideTree?: OpeningTreeDetail, overrideTrainSide?: OpeningSide) => {
      const tree = overrideTree ?? activeOpeningTree;

      if (!tree) {
        return;
      }

      const trainSide = overrideTrainSide ?? activeTrainSide;
      const queue = buildReviewQueue(tree, trainSide);

      if (queue.length === 0) {
        setOpeningDrillStatus('No review positions due.');
        return;
      }

      positionRequestIdRef.current += 1;
      timelineRequestIdRef.current += 1;
      setMode('lines');
      modeRef.current = 'lines';
      setMetadata(null);
      setFileName('');
      setPreMoveAnalyses([]);
      setTimelineAnalyses([]);
      setTimelineError('');
      setServerError('');
      setLinesStudyMode('review');
      setLinesReviewQueue(queue);
      setLinesReviewIndex(0);
      setLinesLearnBranchComplete(false);
      setDeckFeedback(null);
      setDeckFeedbackArrowsVisible(false);
      setOrientation(trainSide);
      setShowArrow(false);
      linesSession.resetSession(tree, trainSide);
      playSound('game-start');
      void replayReviewNode(tree, queue[0]!, trainSide);
    },
    [
      activeOpeningTree,
      activeTrainSide,
      linesSession,
      modeRef,
      playSound,
      positionRequestIdRef,
      replayReviewNode,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setFileName,
      setLinesLearnBranchComplete,
      setLinesReviewIndex,
      setLinesReviewQueue,
      setLinesStudyMode,
      setMetadata,
      setMode,
      setOpeningDrillStatus,
      setOrientation,
      setPreMoveAnalyses,
      setServerError,
      setShowArrow,
      setTimelineAnalyses,
      setTimelineError,
      timelineRequestIdRef,
    ],
  );

  const startNextLearnBranch = useCallback(() => {
    const tree = activeOpeningTree;

    if (!tree) {
      return;
    }

    setLinesLearnBranchComplete(false);
    beginLearnDrill(tree, activeTrainSide);
  }, [activeOpeningTree, activeTrainSide, beginLearnDrill, setLinesLearnBranchComplete]);

  const startOpeningDrill = startLinesLearn;

  const quitLinesSession = useCallback(() => {
    cancelDrillOpponentMove();
    setOpeningDrillActive(false);
    setOpeningDrillExpected(null);
    setDeckFeedback(null);
    setDeckFeedbackArrowsVisible(false);
    setShowArrow(false);
    setOpeningDrillStatus('');
    setLinesStudyMode('idle');
    setLinesLearnBranchComplete(false);
    setLinesReviewQueue([]);
    setLinesReviewIndex(0);
    drillPathRef.current = [];
    drillPathIndexRef.current = 0;
    linesSession.clearSession();
  }, [
    cancelDrillOpponentMove,
    drillPathIndexRef,
    drillPathRef,
    linesSession,
    setDeckFeedback,
    setDeckFeedbackArrowsVisible,
    setLinesLearnBranchComplete,
    setLinesReviewIndex,
    setLinesReviewQueue,
    setLinesStudyMode,
    setOpeningDrillActive,
    setOpeningDrillExpected,
    setOpeningDrillStatus,
    setShowArrow,
  ]);

  const stopOpeningDrill = quitLinesSession;

  const selectOpeningTree = useCallback(
    async (treeId: string) => {
      if (deckPlaybackBusy) {
        return;
      }

      cancelDrillOpponentMove();
      deckPlaybackRequestIdRef.current += 1;
      setDeckPlaybackBusy(false);

      if (!treeId) {
        quitLinesSession();
        setSelectedOpeningTreeId(null);
        setActiveOpeningNodeId(null);
        setActiveOpeningTree(null);
        setInitialFen(null);
        setMoveHistory([]);
        setHistoryIndex(0);
        setGame(new Chess());
        clearVariation();
        clearSelection();
        setTimelineAnalyses([]);
        setPreMoveAnalyses([]);
        return;
      }

      setSelectedOpeningTreeId(treeId);
      setOpeningDrillStatus('');
      setOpeningDrillExpected(null);
      linesCompletedBranchEdgeIdsRef.current = [];
      setLinesLearnBranchComplete(false);

      const boardFenKey = normalizeOpeningFen(game.fen());
      const keepBoard = historyIndex > 0 && !isStandardStartFenKey(boardFenKey);
      const tree = await loadOpeningTreeDetail(treeId, {
        syncBoard: !keepBoard,
        atFenKey: keepBoard ? boardFenKey : undefined,
        boardHistory: keepBoard ? moveHistory.slice(0, historyIndex) : undefined,
      });

      if (tree && !keepBoard) {
        loadOpeningTreeRootOnBoard(tree);
      }
    },
    [
      cancelDrillOpponentMove,
      clearSelection,
      clearVariation,
      deckPlaybackBusy,
      deckPlaybackRequestIdRef,
      game,
      historyIndex,
      loadOpeningTreeDetail,
      loadOpeningTreeRootOnBoard,
      moveHistory,
      quitLinesSession,
      setActiveOpeningNodeId,
      setActiveOpeningTree,
      setGame,
      setHistoryIndex,
      setInitialFen,
      setMoveHistory,
      setDeckPlaybackBusy,
      setOpeningDrillExpected,
      setOpeningDrillStatus,
      setPreMoveAnalyses,
      setSelectedOpeningTreeId,
      setTimelineAnalyses,
    ],
  );

  const selectOpeningNode = useCallback(
    (nodeId: string) => {
      if (linesStudyMode !== 'idle' || deckPlaybackBusy) {
        return;
      }

      const tree = activeOpeningTree;
      if (!tree) return;

      const node = tree.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;

      cancelDrillOpponentMove();
      deckPlaybackRequestIdRef.current += 1;
      setActiveOpeningNodeId(nodeId);
      const fullUcis = replayToNodeUcis(tree, nodeId);
      setOpeningDrillExpected(null);
      clearSelection();
      setOrientation(activeTrainSide);
      void replayMovesToIndex(fullUcis, activeTrainSide, fullUcis.length);
    },
    [
      activeOpeningTree,
      activeTrainSide,
      cancelDrillOpponentMove,
      clearSelection,
      deckPlaybackBusy,
      deckPlaybackRequestIdRef,
      linesStudyMode,
      replayMovesToIndex,
      setActiveOpeningNodeId,
      setOpeningDrillExpected,
      setOrientation,
    ],
  );

  return {
    loadOpeningTrees,
    importRecentOpeningTrees,
    advanceDrillToStep,
    advanceReviewCard,
    startLinesLearn,
    startLinesReview,
    startNextLearnBranch,
    startOpeningDrill,
    quitLinesSession,
    stopOpeningDrill,
    cancelDrillOpponentMove,
    selectOpeningTree,
    selectOpeningNode,
    countTrainPliesInDrillPath,
    findEarliestForkNodeId,
    listSiblingBranchEdges,
  };
}
