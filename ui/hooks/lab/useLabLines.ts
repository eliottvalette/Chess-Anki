import { Chess } from 'chess.js';
import { startTransition, useCallback, useEffect, useRef } from 'react';
import type { WorkspaceMode } from '@/lib/analysis-types';
import type { StoredMove } from '@/lib/chess-analysis-client';
import {
  appendStoredMoveFromUci,
  buildStoredMovesFromUciList,
  restoreGameFromHistory,
} from '@/lib/chess-analysis-client';
import { type ChessSoundKey, getMoveSoundSequence } from '@/lib/chess-sounds';
import {
  DRILL_OPPONENT_DELAY_MS,
  delay,
  LINES_LINE_PREVIEW_DELAY_MS,
  LINES_ROOT_PREVIEW_MOVE_DELAY_MS,
  type OpeningTreesPayload,
  readJsonResponse,
} from '@/lib/lab-helpers';
import { appendLinesStudySessionEntry, createLinesStudySessionLog } from '@/lib/lines-study-session-log.ts';
import {
  alignOpeningTreeWithBoardPosition,
  buildLearnDrillExpectedFromStep,
  buildLearnDrillReplayUcis,
  buildLearnDrillStartupUcis,
  buildOpeningDrillExpected,
  buildReviewQueue,
  countTrainPliesInDrillPath,
  type DrillPathStep,
  ensureOpeningTreeRootPrefix,
  extendDrillPathFromNode,
  findEarliestForkNodeId,
  findPathToNode,
  isLearnBranchEdgeCompleted,
  isStandardStartFenKey,
  type LearnBranchCompletion,
  listSiblingBranchEdges,
  type OpeningSide,
  type OpeningTreeDetail,
  type OpeningTreeSummary,
  pickLearnBranch,
  prepareOpeningTreeAtFenWithBoard,
  prepareOpeningTreeForLines,
  replayToNodeUcis,
  resolveCanonicalRootNode,
  resolveLinesBoardContext,
  resolveLinesStudyOpeningTree,
  resolveReviewAdvance,
} from '@/lib/opening-tree';
import { invalidateOpeningTreesClientCache, requestOpeningTreesJson } from '@/lib/opening-trees-client';
import type { LabState } from '../useLabState';
import type { useLinesSession } from './useLinesSession';

type LinesSessionApi = ReturnType<typeof useLinesSession>;

export function useLabLines(
  state: LabState,
  context: {
    playSound: (key: ChessSoundKey) => void;
    playSoundSequence: (keys: ChessSoundKey[]) => void;
    cancelSoundSequence: () => void;
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
    learnBranchForkConfirmedRef: React.MutableRefObject<boolean>;
    linesBoardFilterPreviewKeyRef: React.MutableRefObject<string | null>;
  },
) {
  const {
    activeOpeningTree,
    openingTrees,
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
    chesscomUsername,
    minForcedPlies,
    learnMaxPly,
    linesStudyMode,
    setLinesStudyMode,
    linesReviewQueue,
    setLinesReviewQueue,
    linesReviewIndex,
    setLinesReviewIndex,
    setLinesLearnBranchComplete,
    linesCompletedLearnBranches,
    setLinesCompletedLearnBranches,
    setLinesActiveLearnBranch,
    setLinesStudySessionLog,
    setLinesTrainPlyCurrent,
    setLinesTrainPlyTotal,
    selectedOpeningTreeId,
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
    cancelSoundSequence,
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
    linesSession,
    linesBoardFilterPreviewKeyRef,
  } = context;

  const { learnBranchForkConfirmedRef } = context;

  const drillTimeoutRef = useRef<number | null>(null);
  const learnSourceTreeRef = useRef<OpeningTreeDetail | null>(null);
  const openingTreeDetailRequestIdRef = useRef(0);

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
        boardHistoryIndex?: number;
        browsePly?: number;
        initialFen?: string | null;
        requestId?: number;
        rootPrefix?: Pick<OpeningTreeSummary, 'rootFenKey' | 'rootSan' | 'rootUci'>;
      } = {},
    ) => {
      const requestId = options.requestId ?? null;
      const isStaleRequest = () => requestId != null && openingTreeDetailRequestIdRef.current !== requestId;

      setOpeningTreeActionLoading(true);
      setOpeningTreeActionError('');

      try {
        let displayTree: OpeningTreeDetail | null = null;

        if (options.atFenKey && options.boardHistory && options.boardHistory.length > 0) {
          const projectedPayload = await requestOpeningTreesJson<OpeningTreesPayload>(
            `/api/opening-trees?atFenKey=${encodeURIComponent(options.atFenKey)}`,
          ).catch(() => null);

          if (isStaleRequest()) {
            return null;
          }

          if (projectedPayload?.tree) {
            displayTree = prepareOpeningTreeForLines(projectedPayload.tree);
            const boardHistoryIndex = options.boardHistoryIndex ?? options.boardHistory.length;
            const aligned = alignOpeningTreeWithBoardPosition(
              displayTree,
              options.boardHistory,
              boardHistoryIndex,
              options.initialFen ?? null,
            );

            if (aligned) {
              displayTree = aligned;
            }
          }
        }

        if (!displayTree) {
          const effectiveBrowsePly = options.browsePly ?? minForcedPlies;
          const params = new URLSearchParams({
            treeId,
            browsePly: String(effectiveBrowsePly),
          });
          const normalizedChesscomUsername = chesscomUsername.trim().toLowerCase();

          if (normalizedChesscomUsername) {
            params.set('username', normalizedChesscomUsername);
          }

          const payload = await requestOpeningTreesJson<OpeningTreesPayload>(`/api/opening-trees?${params.toString()}`);

          if (isStaleRequest()) {
            return null;
          }

          const tree = payload.tree ?? null;
          displayTree = tree ? prepareOpeningTreeForLines(tree) : null;

          if (displayTree && options.atFenKey && options.boardHistory && options.boardHistory.length > 0) {
            const boardHistoryIndex = options.boardHistoryIndex ?? options.boardHistory.length;
            const prepared =
              prepareOpeningTreeAtFenWithBoard(
                displayTree,
                options.atFenKey,
                options.boardHistory,
                boardHistoryIndex,
              ) ??
              alignOpeningTreeWithBoardPosition(
                displayTree,
                options.boardHistory,
                boardHistoryIndex,
                options.initialFen ?? null,
              );

            if (!prepared) {
              throw new Error(`No repertoire node for board position ${options.atFenKey}`);
            }

            displayTree = prepared;
          }
        }

        if (displayTree) {
          if (
            options.rootPrefix &&
            options.rootPrefix.rootFenKey === displayTree.rootFenKey &&
            options.rootPrefix.rootUci.length >= displayTree.rootUci.length
          ) {
            displayTree = {
              ...displayTree,
              rootSan: options.rootPrefix.rootSan,
              rootUci: options.rootPrefix.rootUci,
            };
          }

          displayTree = ensureOpeningTreeRootPrefix(displayTree);
        }

        if (isStaleRequest()) {
          return null;
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
        if (isStaleRequest()) {
          return null;
        }

        const message = error instanceof Error ? error.message : 'Unable to load opening tree.';
        console.error('[lines] opening tree detail failed', { treeId, error });
        setOpeningTreeActionError(message);
        setActiveOpeningTree(null);
        return null;
      } finally {
        if (!isStaleRequest()) {
          setOpeningTreeActionLoading(false);
        }
      }
    },
    [
      loadOpeningTreeRootOnBoard,
      chesscomUsername,
      minForcedPlies,
      setActiveOpeningNodeId,
      setActiveOpeningTree,
      setOpeningDrillExpected,
      setOpeningTreeActionError,
      setOpeningTreeActionLoading,
    ],
  );

  const loadOpeningTrees = useCallback(async () => {
    setOpeningTreesLoading(true);
    setOpeningTreeActionError('');

    try {
      const params = new URLSearchParams({ browsePly: String(minForcedPlies) });
      const normalizedChesscomUsername = chesscomUsername.trim().toLowerCase();

      if (normalizedChesscomUsername) {
        params.set('username', normalizedChesscomUsername);
      }

      const payload = await requestOpeningTreesJson<OpeningTreesPayload>(`/api/opening-trees?${params.toString()}`);

      const nextTrees = payload.trees ?? [];
      setOpeningTrees(nextTrees);
    } catch (error) {
      setOpeningTreeActionError(error instanceof Error ? error.message : 'Unable to load opening trees.');
      setOpeningTrees([]);
    } finally {
      setOpeningTreesLoading(false);
    }
  }, [chesscomUsername, minForcedPlies, setOpeningTreeActionError, setOpeningTrees, setOpeningTreesLoading]);

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

      invalidateOpeningTreesClientCache();
      await loadOpeningTrees();
    } catch (error) {
      setOpeningTreeActionError(error instanceof Error ? error.message : 'Unable to import opening trees.');
    } finally {
      setOpeningTreeActionLoading(false);
    }
  }, [loadOpeningTrees, setOpeningTreeActionError, setOpeningTreeActionLoading]);

  const activeBranchEdgeIdRef = useRef<string | null>(null);
  const activeLearnBranchRef = useRef<LearnBranchCompletion | null>(null);
  const advanceDrillToStepRef = useRef<
    (stepIndex: number, options?: { isOpponentMovePlayback?: boolean; syncOnly?: boolean }) => void
  >(() => {});
  const advanceReviewCardRef = useRef<() => void>(() => {});

  const appendStudySessionLog = useCallback(
    (kind: string, detail: Record<string, string | number | boolean | string[]>) => {
      setLinesStudySessionLog((current) => {
        if (!current) {
          return current;
        }

        return appendLinesStudySessionEntry(current, kind, detail);
      });
    },
    [setLinesStudySessionLog],
  );

  const markCurrentLearnBranchCompleted = useCallback(
    (options?: { allowWithoutForkConfirm?: boolean }) => {
      const branch = activeLearnBranchRef.current;

      if (!branch) {
        return;
      }

      if (!learnBranchForkConfirmedRef.current && !options?.allowWithoutForkConfirm) {
        appendStudySessionLog('branch_complete_skipped', {
          reason: 'opponent_branch_not_played',
          forkNodeId: branch.forkNodeId,
          edgeId: branch.edgeId,
          edgeUci: branch.edgeUci,
        });
        return;
      }

      appendStudySessionLog('branch_complete', {
        forkNodeId: branch.forkNodeId,
        edgeId: branch.edgeId,
        edgeUci: branch.edgeUci,
      });

      setLinesCompletedLearnBranches((current) => {
        if (isLearnBranchEdgeCompleted(branch.forkNodeId, { id: branch.edgeId, uci: branch.edgeUci }, current)) {
          return current;
        }

        return [...current, branch];
      });
      activeLearnBranchRef.current = null;
      activeBranchEdgeIdRef.current = null;
      setLinesActiveLearnBranch(null);
    },
    [appendStudySessionLog, learnBranchForkConfirmedRef, setLinesActiveLearnBranch, setLinesCompletedLearnBranches],
  );

  const advanceDrillToStep = useCallback(
    (stepIndex: number, options: { isOpponentMovePlayback?: boolean; syncOnly?: boolean } = {}) => {
      const isOpponentMovePlayback = options.isOpponentMovePlayback === true;
      const syncOnly = options.syncOnly === true;
      const path = drillPathRef.current;
      const step = path[stepIndex];

      if (syncOnly && linesStudyMode !== 'idle') {
        setOpeningDrillActive(true);
      }

      if (!step) {
        if (!syncOnly) {
          const treeForPathExtension =
            resolveLinesStudyOpeningTree(learnSourceTreeRef.current ?? activeOpeningTree, 'learn', learnMaxPly) ??
            learnSourceTreeRef.current ??
            activeOpeningTree;

          if (treeForPathExtension) {
            const extended = extendDrillPathFromNode(treeForPathExtension, path, activeTrainSide);

            if (extended.length > path.length) {
              drillPathRef.current = extended;
              advanceDrillToStepRef.current(stepIndex);
              return;
            }
          }
        }

        if (!syncOnly && activeOpeningTree && linesStudyMode === 'learn') {
          markCurrentLearnBranchCompleted({ allowWithoutForkConfirm: true });
          setLinesLearnBranchComplete(true);
          setLinesStudyMode('idle');
          setOpeningDrillExpected(null);
          setOpeningDrillStatus('Branch complete.');
          setOpeningDrillActive(false);
          setDeckFeedback(null);
          setDeckFeedbackArrowsVisible(false);
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
      startTransition(() => {
        setLinesTrainPlyTotal(countTrainPliesInDrillPath(path));
        setLinesTrainPlyCurrent(path.slice(0, stepIndex + 1).filter((pathStep) => pathStep.isTrainTurn).length);
        setActiveOpeningNodeId(step.nodeId);
      });

      const parentStep = path[stepIndex - 1];
      const shouldPlayOpponentMove =
        !syncOnly && isOpponentMovePlayback && step.edgeUciFromParent && parentStep && !parentStep.isTrainTurn;

      if (shouldPlayOpponentMove) {
        const connectingEdge =
          parentStep && activeOpeningTree
            ? activeOpeningTree.edges.find(
                (edge) => edge.fromNodeId === parentStep.nodeId && edge.toNodeId === step.nodeId,
              )
            : null;

        if (connectingEdge) {
          linesSession.markEdgeSeen(parentStep.nodeId, connectingEdge.id);
        }

        const activeBranch = activeLearnBranchRef.current;

        if (
          activeBranch &&
          step.edgeUciFromParent === activeBranch.edgeUci &&
          parentStep.nodeId === activeBranch.forkNodeId
        ) {
          learnBranchForkConfirmedRef.current = true;
          appendStudySessionLog('opponent_branch_played', {
            forkNodeId: activeBranch.forkNodeId,
            edgeId: activeBranch.edgeId,
            edgeUci: activeBranch.edgeUci,
          });
        }

        const opponentUci = step.edgeUciFromParent!;
        const currentHistory = moveHistoryRef.current;
        const currentIndex = historyIndexRef.current;
        const boardFen = restoreGameFromHistory(currentHistory, initialFenRef.current, currentIndex).fen();
        const appended = appendStoredMoveFromUci(currentHistory, boardFen, opponentUci);

        const nextGame = new Chess(appended.nextFen);
        const replayedMove = appended.moveHistory[appended.moveHistory.length - 1];

        moveHistoryRef.current = appended.moveHistory;
        historyIndexRef.current = currentIndex + 1;
        startTransition(() => {
          setMoveHistory(appended.moveHistory);
          setHistoryIndex(currentIndex + 1);
          setGame(nextGame);
        });

        if (replayedMove) {
          playSoundSequence(
            getMoveSoundSequence({
              move: replayedMove,
              isSelfMove: false,
              isCheck: nextGame.isCheck(),
              isCheckmate: nextGame.isCheckmate(),
              isGameOver: nextGame.isGameOver(),
            }),
          );
        } else {
          playSound('move-opponent');
        }
      }

      setServerError('');
      if (step.isTrainTurn) {
        setDeckFeedback(null);
        setDeckFeedbackArrowsVisible(false);
      }
      clearSelection();

      if (step.isTrainTurn) {
        const drillExpected =
          linesStudyMode === 'learn'
            ? buildLearnDrillExpectedFromStep(step, path[stepIndex + 1] ?? null)
            : activeOpeningTree
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
            markCurrentLearnBranchCompleted({ allowWithoutForkConfirm: true });
            setLinesLearnBranchComplete(true);
            setLinesStudyMode('idle');
            setOpeningDrillExpected(null);
            setOpeningDrillStatus('Branch complete.');
            setOpeningDrillActive(false);
            setDeckFeedback(null);
            setDeckFeedbackArrowsVisible(false);
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

        if (!nextStep) {
          const treeForPathExtension =
            resolveLinesStudyOpeningTree(learnSourceTreeRef.current ?? activeOpeningTree, 'learn', learnMaxPly) ??
            learnSourceTreeRef.current ??
            activeOpeningTree;

          if (treeForPathExtension) {
            const extended = extendDrillPathFromNode(treeForPathExtension, path, activeTrainSide);

            if (extended.length > path.length) {
              drillPathRef.current = extended;
              setLinesTrainPlyTotal(countTrainPliesInDrillPath(extended));
              cancelDrillOpponentMove();
              drillTimeoutRef.current = window.setTimeout(() => {
                advanceDrillToStepRef.current(nextIndex, { isOpponentMovePlayback: true });
              }, DRILL_OPPONENT_DELAY_MS);
              return;
            }
          }
        }

        if (nextStep) {
          cancelDrillOpponentMove();
          drillTimeoutRef.current = window.setTimeout(() => {
            advanceDrillToStepRef.current(nextIndex, { isOpponentMovePlayback: true });
          }, DRILL_OPPONENT_DELAY_MS);
        } else if (activeOpeningTree && linesStudyMode === 'learn') {
          markCurrentLearnBranchCompleted({ allowWithoutForkConfirm: true });
          setLinesLearnBranchComplete(true);
          setLinesStudyMode('idle');
          setOpeningDrillExpected(null);
          setOpeningDrillStatus('Branch complete.');
          setOpeningDrillActive(false);
          setDeckFeedback(null);
          setDeckFeedbackArrowsVisible(false);
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
      linesSession,
      learnMaxPly,
      markCurrentLearnBranchCompleted,
      appendStudySessionLog,
      learnBranchForkConfirmedRef,
      playSound,
      playSoundSequence,
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
      setServerError,
      setShowArrow,
    ],
  );

  advanceDrillToStepRef.current = advanceDrillToStep;

  const beginLearnDrill = useCallback(
    (tree: OpeningTreeDetail, trainSide: OpeningSide, pickTrigger: 'initial' | 'next' = 'initial') => {
      const sourceTree = pickTrigger === 'next' ? (learnSourceTreeRef.current ?? tree) : tree;
      const alignedTree =
        pickTrigger === 'next'
          ? sourceTree
          : (alignOpeningTreeWithBoardPosition(
              tree,
              moveHistoryRef.current,
              historyIndexRef.current,
              initialFenRef.current,
            ) ?? tree);
      const treeForDrill = ensureOpeningTreeRootPrefix(alignedTree);

      if (pickTrigger === 'initial') {
        learnSourceTreeRef.current = treeForDrill;
      }

      if (pickTrigger === 'initial' && treeForDrill !== tree) {
        setActiveOpeningTree(treeForDrill);
      } else if (pickTrigger === 'next' && learnSourceTreeRef.current) {
        setActiveOpeningTree(learnSourceTreeRef.current);
      }

      const completedBefore = linesCompletedLearnBranches;
      const { path, branchEdgeId, branchForkNodeId, branchEdgeUci } = pickLearnBranch(
        treeForDrill,
        trainSide,
        completedBefore,
      );
      activeBranchEdgeIdRef.current = branchEdgeId;
      activeLearnBranchRef.current =
        branchEdgeId && branchForkNodeId && branchEdgeUci
          ? { forkNodeId: branchForkNodeId, edgeId: branchEdgeId, edgeUci: branchEdgeUci }
          : null;
      setLinesActiveLearnBranch(activeLearnBranchRef.current);
      learnBranchForkConfirmedRef.current = false;

      if (path.length === 0) {
        appendStudySessionLog('branch_pick_failed', { reason: 'no_path', trigger: pickTrigger });
        setOpeningDrillStatus('No trainable branch left in this tree.');
        return;
      }

      const firstTrainIndex = path.findIndex((step) => step.isTrainTurn);

      if (firstTrainIndex < 0) {
        appendStudySessionLog('branch_pick_failed', { reason: 'no_train_turn', trigger: pickTrigger });
        setOpeningDrillStatus('No trainable nodes in this tree yet.');
        return;
      }

      const forkStepIndex = branchForkNodeId ? path.findIndex((step) => step.nodeId === branchForkNodeId) : -1;
      const replayUcis = buildLearnDrillReplayUcis(path);
      const replayThroughIndex =
        replayUcis.length > 0 ? path.findIndex((step) => step.edgeUciFromParent === replayUcis.at(-1)) : -1;

      const remainingAtFork =
        branchForkNodeId != null ? listSiblingBranchEdges(treeForDrill, branchForkNodeId, completedBefore) : [];
      appendStudySessionLog('branch_picked', {
        trigger: pickTrigger,
        forkNodeId: branchForkNodeId ?? 'none',
        edgeId: branchEdgeId ?? 'none',
        edgeUci: branchEdgeUci ?? 'none',
        completedBeforeCount: completedBefore.length,
        completedBeforeUcis: completedBefore.map((branch) => branch.edgeUci),
        remainingAtFork: remainingAtFork.length,
        remainingUcisAtFork: remainingAtFork.map((edge) => edge.uci),
        replayUcis,
        pathLength: path.length,
        firstTrainIndex,
        forkStepIndex,
        replayThroughIndex,
        pathNodeIds: path.map((step) => step.nodeId),
      });

      linesSession.resetSession(treeForDrill, trainSide);
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

      const fullUcis = buildLearnDrillStartupUcis(treeForDrill, path, firstTrainIndex);

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
      appendStudySessionLog,
      cancelDrillOpponentMove,
      clearSelection,
      drillPathIndexRef,
      drillPathRef,
      learnBranchForkConfirmedRef,
      linesCompletedLearnBranches,
      linesSession,
      playSound,
      replayMovesToIndex,
      setActiveOpeningNodeId,
      setActiveOpeningTree,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setLinesActiveLearnBranch,
      setLinesLearnBranchComplete,
      setLinesStudyMode,
      setLinesTrainPlyCurrent,
      setLinesTrainPlyTotal,
      setOpeningDrillActive,
      setOpeningDrillExpected,
      setOpeningDrillStatus,
      setOrientation,
      setShowArrow,
    ],
  );

  const replayReviewNode = useCallback(
    async (
      tree: OpeningTreeDetail,
      nodeId: string,
      trainSide: OpeningSide,
      reviewCardIndex?: number,
      reviewQueueLength?: number,
    ) => {
      if (reviewCardIndex != null) {
        appendStudySessionLog('review_card', {
          index: reviewCardIndex,
          total: reviewQueueLength ?? linesReviewQueue.length,
          nodeId,
        });
      }

      const reviewPathOptions = { trainSide, bestTrainMovesOnly: true } as const;
      const fullUcis = replayToNodeUcis(tree, nodeId, reviewPathOptions);
      const path = findPathToNode(tree, nodeId, reviewPathOptions);
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
      appendStudySessionLog,
      cancelDrillOpponentMove,
      drillPathIndexRef,
      drillPathRef,
      linesReviewQueue.length,
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

    const advance = resolveReviewAdvance(linesReviewQueue, linesReviewIndex);

    if (advance.kind === 'complete') {
      appendStudySessionLog('review_complete', { cards: linesReviewQueue.length });
      setOpeningDrillStatus('Review complete.');
      setOpeningDrillActive(false);
      setOpeningDrillExpected(null);
      setLinesStudyMode('idle');
      setLinesReviewQueue([]);
      setLinesReviewIndex(0);
      return;
    }

    setLinesReviewIndex(advance.nextIndex);
    setDeckFeedback(null);
    setDeckFeedbackArrowsVisible(false);
    void replayReviewNode(tree, advance.nextNodeId, activeTrainSide, advance.nextIndex, linesReviewQueue.length);
  }, [
    activeOpeningTree,
    activeTrainSide,
    appendStudySessionLog,
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
      const alignedTree = alignOpeningTreeWithBoardPosition(tree, moveHistory, historyIndex, initialFen) ?? tree;
      const treeForLearn = resolveLinesStudyOpeningTree(alignedTree, 'learn', learnMaxPly) ?? alignedTree;

      if (treeForLearn !== tree) {
        setActiveOpeningTree(treeForLearn);
      }
      setLinesCompletedLearnBranches([]);
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
      setLinesStudySessionLog(createLinesStudySessionLog(treeForLearn.id, 'learn', trainSide));
      beginLearnDrill(treeForLearn, trainSide, 'initial');
    },
    [
      activeOpeningTree,
      activeTrainSide,
      beginLearnDrill,
      historyIndex,
      initialFen,
      learnMaxPly,
      moveHistory,
      setLinesCompletedLearnBranches,
      setActiveOpeningTree,
      setLinesStudySessionLog,
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
      setLinesStudySessionLog(
        appendLinesStudySessionEntry(createLinesStudySessionLog(tree.id, 'review', trainSide), 'review_queue', {
          count: queue.length,
          nodeIds: queue,
        }),
      );
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
      void replayReviewNode(tree, queue[0]!, trainSide, 0, queue.length);
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
      setLinesStudySessionLog,
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
    const tree = learnSourceTreeRef.current ?? activeOpeningTree;

    if (!tree) {
      return;
    }

    const treeForLearn = resolveLinesStudyOpeningTree(tree, 'learn', learnMaxPly) ?? tree;

    const previousBranch = activeLearnBranchRef.current;

    if (previousBranch) {
      appendStudySessionLog('next_branch_clicked', {
        forkNodeId: previousBranch.forkNodeId,
        edgeId: previousBranch.edgeId,
        edgeUci: previousBranch.edgeUci,
        completedCountBefore: linesCompletedLearnBranches.length,
      });
    } else {
      appendStudySessionLog('next_branch_clicked', {
        forkNodeId: 'none',
        edgeId: 'none',
        edgeUci: 'none',
        completedCountBefore: linesCompletedLearnBranches.length,
      });
    }

    markCurrentLearnBranchCompleted();
    cancelDrillOpponentMove();
    setDeckFeedback(null);
    setDeckFeedbackArrowsVisible(false);
    setOpeningDrillStatus('');
    setLinesLearnBranchComplete(false);
    beginLearnDrill(treeForLearn, activeTrainSide, 'next');
  }, [
    activeOpeningTree,
    activeTrainSide,
    appendStudySessionLog,
    beginLearnDrill,
    learnMaxPly,
    cancelDrillOpponentMove,
    linesCompletedLearnBranches.length,
    markCurrentLearnBranchCompleted,
    setDeckFeedback,
    setDeckFeedbackArrowsVisible,
    setLinesLearnBranchComplete,
    setOpeningDrillStatus,
  ]);

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
    setLinesCompletedLearnBranches([]);
    setLinesStudySessionLog(null);
    setLinesActiveLearnBranch(null);
    activeLearnBranchRef.current = null;
    activeBranchEdgeIdRef.current = null;
    drillPathRef.current = [];
    drillPathIndexRef.current = 0;
    learnSourceTreeRef.current = null;
    linesSession.clearSession();
  }, [
    cancelDrillOpponentMove,
    drillPathIndexRef,
    drillPathRef,
    linesSession,
    setDeckFeedback,
    setDeckFeedbackArrowsVisible,
    setLinesLearnBranchComplete,
    setLinesCompletedLearnBranches,
    setLinesActiveLearnBranch,
    setLinesStudySessionLog,
    setLinesReviewIndex,
    setLinesReviewQueue,
    setLinesStudyMode,
    setOpeningDrillActive,
    setOpeningDrillExpected,
    setOpeningDrillStatus,
    setShowArrow,
  ]);

  const stopOpeningDrill = quitLinesSession;

  const previewOpeningTreeRoot = useCallback(
    (tree: OpeningTreeSummary) => {
      cancelDrillOpponentMove();
      cancelSoundSequence();
      const requestId = ++deckPlaybackRequestIdRef.current;
      openingTreeDetailRequestIdRef.current += 1;
      setOpeningTreeActionLoading(false);
      linesBoardFilterPreviewKeyRef.current = tree.rootUci.join(' ');

      setOpeningDrillActive(false);
      setDeckFeedback(null);
      setDeckFeedbackArrowsVisible(false);
      setShowArrow(false);
      setOpeningDrillExpected(null);
      setOpeningDrillStatus('');
      setLinesStudyMode('idle');
      setLinesLearnBranchComplete(false);
      setLinesReviewQueue([]);
      setLinesReviewIndex(0);
      setLinesCompletedLearnBranches([]);
      setLinesStudySessionLog(null);
      setLinesActiveLearnBranch(null);
      activeLearnBranchRef.current = null;
      activeBranchEdgeIdRef.current = null;
      drillPathRef.current = [];
      drillPathIndexRef.current = 0;
      learnSourceTreeRef.current = null;
      linesSession.clearSession();

      setSelectedOpeningTreeId(null);
      setActiveOpeningNodeId(null);
      setActiveOpeningTree(null);
      setInitialFen(null);
      moveHistoryRef.current = [];
      historyIndexRef.current = 0;
      initialFenRef.current = null;
      setMoveHistory([]);
      deckReplayInitialFenRef.current = null;
      deckReplayMovesRef.current = [];
      setHistoryIndex(0);
      setGame(new Chess());
      setDeckPlaybackBusy(tree.rootUci.length > 0);
      clearVariation();
      clearSelection();

      void (async () => {
        if (tree.rootUci.length === 0) {
          setDeckPlaybackBusy(false);
          return;
        }

        let previewMoves: StoredMove[] = [];
        let previewFen = new Chess().fen();

        for (const uci of tree.rootUci) {
          await delay(LINES_ROOT_PREVIEW_MOVE_DELAY_MS);

          if (deckPlaybackRequestIdRef.current !== requestId) {
            cancelSoundSequence();
            return;
          }

          let appended: ReturnType<typeof appendStoredMoveFromUci>;

          try {
            appended = appendStoredMoveFromUci(previewMoves, previewFen, uci);
          } catch {
            cancelSoundSequence();
            setDeckPlaybackBusy(false);
            return;
          }

          previewMoves = appended.moveHistory;
          previewFen = appended.nextFen;

          const nextGame = new Chess(previewFen);
          const nextHistoryIndex = previewMoves.length;

          moveHistoryRef.current = previewMoves;
          historyIndexRef.current = nextHistoryIndex;
          deckReplayMovesRef.current = previewMoves;

          startTransition(() => {
            setMoveHistory(previewMoves);
            setHistoryIndex(nextHistoryIndex);
            setGame(nextGame);
          });

          playSoundSequence(
            getMoveSoundSequence({
              move: appended.stored,
              isSelfMove: false,
              isCheck: nextGame.isCheck(),
              isCheckmate: nextGame.isCheckmate(),
              isGameOver: nextGame.isGameOver(),
            }),
          );
        }

        if (deckPlaybackRequestIdRef.current === requestId) {
          setDeckPlaybackBusy(false);
        }
      })();
    },
    [
      cancelDrillOpponentMove,
      cancelSoundSequence,
      clearSelection,
      clearVariation,
      deckPlaybackRequestIdRef,
      deckReplayInitialFenRef,
      deckReplayMovesRef,
      drillPathIndexRef,
      drillPathRef,
      linesSession,
      linesBoardFilterPreviewKeyRef,
      playSoundSequence,
      setActiveOpeningNodeId,
      setActiveOpeningTree,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setDeckPlaybackBusy,
      setGame,
      setHistoryIndex,
      setInitialFen,
      setLinesActiveLearnBranch,
      setLinesCompletedLearnBranches,
      setLinesLearnBranchComplete,
      setLinesReviewIndex,
      setLinesReviewQueue,
      setLinesStudyMode,
      setLinesStudySessionLog,
      setMoveHistory,
      setOpeningDrillActive,
      setOpeningDrillExpected,
      setOpeningDrillStatus,
      setOpeningTreeActionLoading,
      setSelectedOpeningTreeId,
      setShowArrow,
    ],
  );

  const selectOpeningTree = useCallback(
    async (treeId: string) => {
      cancelDrillOpponentMove();
      cancelSoundSequence();
      deckPlaybackRequestIdRef.current += 1;
      setDeckPlaybackBusy(false);
      const detailRequestId = ++openingTreeDetailRequestIdRef.current;
      const isRootPreviewPosition = linesBoardFilterPreviewKeyRef.current != null;
      linesBoardFilterPreviewKeyRef.current = null;

      if (!treeId) {
        setOpeningTreeActionLoading(false);
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
      if (treeId !== selectedOpeningTreeId) {
        setLinesCompletedLearnBranches([]);
        setLinesLearnBranchComplete(false);
      }

      const boardContext = resolveLinesBoardContext(game.fen(), moveHistory, historyIndex, initialFen);
      const keepBoard =
        !isRootPreviewPosition && boardContext.historyIndex > 0 && !isStandardStartFenKey(boardContext.fenKey);
      const effectiveBrowsePly = keepBoard ? Math.max(minForcedPlies, boardContext.historyIndex) : minForcedPlies;
      const selectedSummary = openingTrees.find((tree) => tree.id === treeId);
      const tree = await loadOpeningTreeDetail(treeId, {
        syncBoard: !keepBoard,
        atFenKey: keepBoard ? boardContext.fenKey : undefined,
        boardHistory: keepBoard ? boardContext.boardHistory : undefined,
        boardHistoryIndex: keepBoard ? boardContext.historyIndex : undefined,
        browsePly: effectiveBrowsePly,
        initialFen,
        requestId: detailRequestId,
        rootPrefix: selectedSummary
          ? {
              rootFenKey: selectedSummary.rootFenKey,
              rootSan: selectedSummary.rootSan,
              rootUci: selectedSummary.rootUci,
            }
          : undefined,
      });

      if (openingTreeDetailRequestIdRef.current !== detailRequestId) {
        return;
      }

      if (!tree) {
        setSelectedOpeningTreeId(null);
        setActiveOpeningNodeId(null);
        return;
      }

      if (keepBoard && boardContext.historyIndex !== historyIndex) {
        setHistoryIndex(boardContext.historyIndex);
      }

      if (!keepBoard) {
        loadOpeningTreeRootOnBoard(tree);
      }
    },
    [
      cancelDrillOpponentMove,
      cancelSoundSequence,
      clearSelection,
      clearVariation,
      deckPlaybackRequestIdRef,
      game,
      historyIndex,
      initialFen,
      linesBoardFilterPreviewKeyRef,
      minForcedPlies,
      loadOpeningTreeDetail,
      loadOpeningTreeRootOnBoard,
      moveHistory,
      openingTrees,
      quitLinesSession,
      selectedOpeningTreeId,
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
      setLinesCompletedLearnBranches,
      setLinesLearnBranchComplete,
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
      const moves = buildStoredMovesFromUciList(null, fullUcis);
      setInitialFen(null);
      setMoveHistory(moves);
      deckReplayInitialFenRef.current = null;
      deckReplayMovesRef.current = moves;
      setHistoryIndex(moves.length);
      clearVariation();
      setGame(restoreGameFromHistory(moves, null, moves.length));
      setOpeningDrillExpected(null);
      setOpeningDrillStatus('');
      setDeckPlaybackBusy(false);
      clearSelection();
      setOrientation(activeTrainSide);
    },
    [
      activeOpeningTree,
      activeTrainSide,
      cancelDrillOpponentMove,
      clearSelection,
      clearVariation,
      deckPlaybackBusy,
      deckPlaybackRequestIdRef,
      deckReplayInitialFenRef,
      deckReplayMovesRef,
      linesStudyMode,
      setActiveOpeningNodeId,
      setDeckPlaybackBusy,
      setGame,
      setHistoryIndex,
      setInitialFen,
      setMoveHistory,
      setOpeningDrillExpected,
      setOpeningDrillStatus,
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
    previewOpeningTreeRoot,
    selectOpeningTree,
    selectOpeningNode,
    countTrainPliesInDrillPath,
    findEarliestForkNodeId,
    listSiblingBranchEdges,
  };
}
