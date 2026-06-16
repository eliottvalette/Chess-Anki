import { Chess } from 'chess.js';
import { useCallback, useRef } from 'react';
import type { WorkspaceMode } from '@/lib/analysis-types';
import type { StoredMove } from '@/lib/chess-analysis-client';
import { buildStoredMovesFromSanList, restoreGameFromHistory, toStoredMove } from '@/lib/chess-analysis-client';
import type { ChessSoundKey } from '@/lib/chess-sounds';
import {
  DRILL_OPPONENT_DELAY_MS,
  type OpeningTreesFullPayload,
  type OpeningTreesPayload,
  readJsonResponse,
} from '@/lib/lab-helpers';
import {
  buildDrillPath,
  buildOpeningDrillExpected,
  type DrillPathStep,
  findPathToNode,
  type OpeningSide,
  type OpeningTreeDetail,
  type OpeningTreeNode,
} from '@/lib/opening-tree';
import type { LabState } from '../useLabState';

export function useLabLines(
  state: LabState,
  context: {
    playSound: (key: ChessSoundKey) => void;
    playSoundSequence: (keys: ChessSoundKey[]) => void;
    playDeckReplayToIndex: (targetIndex: number, trainSide: OpeningSide) => Promise<boolean | undefined>;
    clearSelection: () => void;
    clearVariation: () => void;
    positionRequestIdRef: React.MutableRefObject<number>;
    timelineRequestIdRef: React.MutableRefObject<number>;
    deckReplayInitialFenRef: React.MutableRefObject<string | null>;
    deckReplayMovesRef: React.MutableRefObject<StoredMove[]>;
    deckPlaybackRequestIdRef: React.MutableRefObject<number>;
    linesGameTimeoutRef: React.MutableRefObject<number | null>;
    modeRef: React.MutableRefObject<WorkspaceMode> | React.RefObject<WorkspaceMode>;
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
  } = state;

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
  } = context;

  const loadOpeningTreeRootOnBoard = useCallback(
    (tree: OpeningTreeDetail) => {
      const rootMoves = buildStoredMovesFromSanList(null, tree.rootSan);
      const rootGame = restoreGameFromHistory(rootMoves, null, rootMoves.length);
      const rootNode =
        tree.nodes.find((node: OpeningTreeNode) => node.ply === tree.rootSan.length) ?? tree.nodes[0] ?? null;

      positionRequestIdRef.current += 1;
      timelineRequestIdRef.current += 1;
      setMode('lines');
      modeRef.current = 'lines';
      setInitialFen(null);
      setMoveHistory(rootMoves);
      setHistoryIndex(rootMoves.length);
      clearVariation();
      setGame(rootGame);
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
    },
    [
      activeTrainSide,
      clearSelection,
      clearVariation,
      modeRef,
      positionRequestIdRef,
      setActiveOpeningNodeId,
      setFileName,
      setGame,
      setHistoryIndex,
      setInitialFen,
      setMetadata,
      setMode,
      setMoveHistory,
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
    async (treeId: string, options: { syncBoard?: boolean } = {}) => {
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
        setActiveOpeningTree(tree);

        if (tree && options.syncBoard) {
          loadOpeningTreeRootOnBoard(tree);
        } else {
          setActiveOpeningNodeId(tree?.nodes[0]?.id ?? null);
        }

        return tree;
      } catch (error) {
        setOpeningTreeActionError(error instanceof Error ? error.message : 'Unable to load opening tree.');
        setActiveOpeningTree(null);
        return null;
      }
    },
    [loadOpeningTreeRootOnBoard, setActiveOpeningNodeId, setActiveOpeningTree, setOpeningTreeActionError],
  );

  const loadOpeningTrees = useCallback(async () => {
    setOpeningTreesLoading(true);
    setOpeningTreeActionError('');

    try {
      const response = await fetch('/api/opening-trees?full=true', { credentials: 'same-origin' });
      const payload = await readJsonResponse<OpeningTreesFullPayload>(response);

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
  }, [loadOpeningTrees, setOpeningTreeActionError, setOpeningTreeActionLoading]);

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

  const advanceDrillToStep = useCallback(
    (stepIndex: number, options: { isOpponentMovePlayback?: boolean; syncOnly?: boolean } = {}) => {
      const isOpponentMovePlayback = options.isOpponentMovePlayback === true;
      const syncOnly = options.syncOnly === true;
      const path = drillPathRef.current;
      const step = path[stepIndex];

      if (!step) {
        setOpeningDrillExpected(null);
        setOpeningDrillStatus('Branch complete.');
        setOpeningDrillActive(false);
        return;
      }

      drillPathIndexRef.current = stepIndex;
      const trainSteps = path.filter((pathStep) => pathStep.isTrainTurn);
      const trainStepNumber = trainSteps.findIndex((pathStep) => pathStep.nodeId === step.nodeId) + 1;
      const trainStepTotal = trainSteps.length;

      setActiveOpeningNodeId(step.nodeId);

      if (!syncOnly && isOpponentMovePlayback && step.edgeUciFromParent) {
        setGame((prevGame) => {
          const nextGame = new Chess(prevGame.fen());
          try {
            nextGame.move({
              from: step.edgeUciFromParent!.substring(0, 2),
              to: step.edgeUciFromParent!.substring(2, 4),
              promotion: step.edgeUciFromParent!.length === 5 ? step.edgeUciFromParent![4] : undefined,
            });
          } catch {
            return new Chess(step.fen);
          }
          return nextGame;
        });

        if (step.edgeUciFromParent) {
          // We just construct the move for the history independently to avoid side effects in setGame
          const tempGame = new Chess(path[stepIndex - 1]?.fen ?? step.fen);
          try {
            const move = tempGame.move({
              from: step.edgeUciFromParent.substring(0, 2),
              to: step.edgeUciFromParent.substring(2, 4),
              promotion: step.edgeUciFromParent.length === 5 ? step.edgeUciFromParent[4] : undefined,
            });
            if (move) {
              setMoveHistory((prev) => [...prev, toStoredMove(move)]);
              setHistoryIndex((prev) => prev + 1);
              playSound('move-opponent');
            }
          } catch {
            // ignore
          }
        }
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
          : {
              nodeId: step.nodeId,
              uci: step.bestUci,
              san: step.bestSan,
              acceptedUcis: step.bestUci ? [step.bestUci] : [],
            };
        setOpeningDrillExpected(drillExpected);
        setOpeningDrillStatus(`Your move (${trainStepNumber}/${trainStepTotal}). Find the best move.`);
        setShowArrow(false);
      } else if (!syncOnly) {
        setOpeningDrillExpected(null);
        const nextIndex = stepIndex + 1;
        const nextStep = path[nextIndex];

        if (nextStep) {
          const edgeSan = nextStep.edgeSanFromParent;
          setOpeningDrillStatus(edgeSan ? `Opponent plays ${edgeSan}...` : 'Opponent playing...');

          cancelDrillOpponentMove();
          drillTimeoutRef.current = window.setTimeout(() => {
            advanceDrillToStep(nextIndex, { isOpponentMovePlayback: true });
          }, DRILL_OPPONENT_DELAY_MS);
        } else {
          setOpeningDrillExpected(null);
          setOpeningDrillStatus('Branch complete.');
          setOpeningDrillActive(false);
        }
      } else {
        setOpeningDrillExpected(null);
        const edgeSan = step.edgeSanFromParent;
        setOpeningDrillStatus(edgeSan ? `Opponent to play ${edgeSan}.` : 'Opponent turn.');
      }
    },
    [
      activeOpeningTree,
      cancelDrillOpponentMove,
      clearSelection,
      drillPathIndexRef,
      drillPathRef,
      playSound,
      setActiveOpeningNodeId,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setGame,
      setHistoryIndex,
      setMoveHistory,
      setOpeningDrillExpected,
      setOpeningDrillStatus,
      setOpeningDrillActive,
      setPositionAnalysis,
      setServerError,
      setShowArrow,
    ],
  );

  const startOpeningDrill = useCallback(
    (overrideTree?: OpeningTreeDetail, overrideTrainSide?: OpeningSide) => {
      const tree = overrideTree ?? activeOpeningTree;

      if (!tree) {
        return;
      }

      const trainSide = overrideTrainSide ?? activeTrainSide;
      const path = buildDrillPath(tree, { trainSide, preferWeak: true, seed: Date.now() });
      const firstTrainIndex = path.findIndex((step: DrillPathStep) => step.isTrainTurn);

      if (firstTrainIndex < 0) {
        setOpeningDrillStatus('No trainable nodes in this tree yet.');
        return;
      }

      drillPathRef.current = path;
      drillPathIndexRef.current = 0;

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
      setOrientation(path[0]?.trainSide ?? trainSide);
      setShowArrow(false);
      setDeckFeedback(null);
      setDeckFeedbackArrowsVisible(false);
      setOpeningDrillActive(true);
      playSound('game-start');

      const fullSans = [...tree.rootSan];
      if (firstTrainIndex > 0) {
        const sans = path
          .slice(1, firstTrainIndex + 1)
          .map((step: DrillPathStep) => step.edgeSanFromParent)
          .filter(Boolean) as string[];
        fullSans.push(...sans);
      }

      const targetStep = path[firstTrainIndex] ?? path[0]!;
      setActiveOpeningNodeId(targetStep.nodeId);

      try {
        const moves = buildStoredMovesFromSanList(null, fullSans);
        setInitialFen(null);
        setMoveHistory(moves);
        deckReplayInitialFenRef.current = null;
        deckReplayMovesRef.current = moves;
        setHistoryIndex(0);
        clearVariation();
        setGame(new Chess());
        setOpeningDrillStatus('Playing opening moves...');
        setOpeningDrillExpected(null);
        clearSelection();

        cancelDrillOpponentMove();
        deckPlaybackRequestIdRef.current += 1;
        setDeckPlaybackBusy(false);
        drillTimeoutRef.current = window.setTimeout(async () => {
          const replayCompleted = await playDeckReplayToIndex(moves.length, trainSide);

          if (replayCompleted === false) {
            return;
          }

          advanceDrillToStep(firstTrainIndex);
        }, 500);
      } catch (err) {
        console.error('Failed to parse drill opening moves', err);
        advanceDrillToStep(firstTrainIndex);
      }
    },
    [
      activeOpeningTree,
      activeTrainSide,
      advanceDrillToStep,
      cancelDrillOpponentMove,
      clearSelection,
      clearVariation,
      deckPlaybackRequestIdRef,
      deckReplayInitialFenRef,
      deckReplayMovesRef,
      drillPathIndexRef,
      drillPathRef,
      modeRef,
      playDeckReplayToIndex,
      playSound,
      positionRequestIdRef,
      setActiveOpeningNodeId,
      setFileName,
      setGame,
      setHistoryIndex,
      setInitialFen,
      setMetadata,
      setMode,
      setMoveHistory,
      setDeckPlaybackBusy,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setOpeningDrillActive,
      setOpeningDrillExpected,
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

  const stopOpeningDrill = useCallback(() => {
    setOpeningDrillActive(false);
    setOpeningDrillExpected(null);
    setDeckFeedback(null);
    setDeckFeedbackArrowsVisible(false);
    setShowArrow(false);
    setOpeningDrillStatus('');
    drillPathRef.current = [];
    drillPathIndexRef.current = 0;
  }, [
    drillPathIndexRef,
    drillPathRef,
    setDeckFeedback,
    setDeckFeedbackArrowsVisible,
    setOpeningDrillActive,
    setOpeningDrillExpected,
    setOpeningDrillStatus,
    setShowArrow,
  ]);

  const selectOpeningTree = useCallback(
    async (treeId: string, treeObj?: OpeningTreeDetail) => {
      cancelDrillOpponentMove();
      deckPlaybackRequestIdRef.current += 1;
      setDeckPlaybackBusy(false);

      if (!treeId) {
        stopOpeningDrill();
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

      let tree: OpeningTreeDetail | null = treeObj ?? null;
      if (tree) {
        setActiveOpeningTree(tree);
        loadOpeningTreeRootOnBoard(tree);
      } else {
        tree = await loadOpeningTreeDetail(treeId, { syncBoard: true });
      }

      if (tree) {
        startOpeningDrill(tree);
      }
    },
    [
      cancelDrillOpponentMove,
      clearSelection,
      clearVariation,
      deckPlaybackRequestIdRef,
      loadOpeningTreeDetail,
      loadOpeningTreeRootOnBoard,
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
      startOpeningDrill,
      stopOpeningDrill,
    ],
  );

  const selectOpeningNode = useCallback(
    (nodeId: string) => {
      const tree = activeOpeningTree;
      if (!tree) return;

      const node = tree.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;

      setActiveOpeningNodeId(nodeId);

      const path = findPathToNode(tree, nodeId);
      if (path.length === 0) {
        // Fallback
        setOpeningDrillActive(false);
        drillPathRef.current = [];
        drillPathIndexRef.current = 0;
        setInitialFen(node.fen);
        setMoveHistory([]);
        setHistoryIndex(0);
        clearVariation();
        setGame(new Chess(node.fen));
        setOpeningDrillExpected(node.sideToMove === activeTrainSide ? buildOpeningDrillExpected(tree, node.id) : null);
        setOpeningDrillStatus(
          node.sideToMove === activeTrainSide ? 'Find the best move from this node.' : 'Opponent node selected.',
        );
        setOrientation(activeTrainSide);
        clearSelection();
        return;
      }

      const fullSans = [...tree.rootSan];
      const sans = path
        .slice(1)
        .map((step) => step.edgeSanFromParent)
        .filter(Boolean) as string[];
      fullSans.push(...sans);

      try {
        const moves = buildStoredMovesFromSanList(null, fullSans);
        setInitialFen(null);
        setMoveHistory(moves);
        deckReplayInitialFenRef.current = null;
        deckReplayMovesRef.current = moves;
        setHistoryIndex(0);
        clearVariation();
        setGame(new Chess());
        setOpeningDrillExpected(null);
        clearSelection();
        setOrientation(activeTrainSide);

        const nextPath = buildDrillPath(tree, {
          trainSide: activeTrainSide,
          preferWeak: true,
          seed: Date.now(),
          startNodeId: nodeId,
        });
        const fullDrillPath = [...path, ...nextPath.slice(1)];
        drillPathRef.current = fullDrillPath;
        const targetNodeIndex = path.length - 1;
        drillPathIndexRef.current = targetNodeIndex;

        if (nextPath.length > 0) {
          setOpeningDrillActive(true);
          setOpeningDrillStatus('Playing to selected node...');

          cancelDrillOpponentMove();
          deckPlaybackRequestIdRef.current += 1;
          setDeckPlaybackBusy(false);
          drillTimeoutRef.current = window.setTimeout(async () => {
            const replayCompleted = await playDeckReplayToIndex(moves.length, activeTrainSide);

            if (replayCompleted === false) {
              return;
            }

            advanceDrillToStep(targetNodeIndex);
          }, 500);
        } else {
          setOpeningDrillActive(false);
          setOpeningDrillExpected(
            node.sideToMove === activeTrainSide ? buildOpeningDrillExpected(tree, node.id) : null,
          );
          setOpeningDrillStatus(
            node.sideToMove === activeTrainSide ? 'Find the best move from this node.' : 'Opponent node selected.',
          );
          cancelDrillOpponentMove();
          deckPlaybackRequestIdRef.current += 1;
          setDeckPlaybackBusy(false);
          drillTimeoutRef.current = window.setTimeout(async () => {
            await playDeckReplayToIndex(moves.length, activeTrainSide);
          }, 500);
        }
      } catch (err) {
        console.error('Failed to parse selected node path', err);
      }
    },
    [
      activeOpeningTree,
      activeTrainSide,
      clearSelection,
      clearVariation,
      setActiveOpeningNodeId,
      setGame,
      setHistoryIndex,
      setInitialFen,
      setMoveHistory,
      setOpeningDrillExpected,
      setOpeningDrillStatus,
      setOrientation,
      cancelDrillOpponentMove,
      deckPlaybackRequestIdRef,
      playDeckReplayToIndex,
      advanceDrillToStep,
      deckReplayInitialFenRef,
      deckReplayMovesRef,
      drillPathRef,
      drillPathIndexRef,
      setDeckPlaybackBusy,
      setOpeningDrillActive,
    ],
  );

  return {
    loadOpeningTrees,
    importRecentOpeningTrees,
    advanceDrillToStep,
    startOpeningDrill,
    stopOpeningDrill,
    cancelDrillOpponentMove,
    selectOpeningTree,
    selectOpeningNode,
  };
}
