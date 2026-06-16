import { useCallback, useRef } from 'react';
import type { LabState } from '../useLabState';
import { Chess } from 'chess.js';
import {
  buildStoredMovesFromSanList,
  restoreGameFromHistory,
  toStoredMove,
} from '@/lib/chess-analysis-client';
import {
  buildDrillPath,
  type DrillPathStep,
  type OpeningTreeDetail,
  type OpeningTreeSummary,
} from '@/lib/opening-tree';
import { DRILL_OPPONENT_DELAY_MS, readJsonResponse, type OpeningTreesPayload } from '@/lib/lab-helpers';

export function useLabLines(
  state: LabState,
  context: {
    playSound: (key: any) => void;
    playSoundSequence: (keys: any[]) => void;
    playDeckReplayToIndex: (targetIndex: number, trainSide: any) => Promise<boolean | void>;
    clearSelection: () => void;
    clearVariation: () => void;
    positionRequestIdRef: React.MutableRefObject<number>;
    timelineRequestIdRef: React.MutableRefObject<number>;
    deckReplayInitialFenRef: React.MutableRefObject<string | null>;
    deckReplayMovesRef: React.MutableRefObject<any[]>;
    modeRef: React.MutableRefObject<any> | React.RefObject<any>;
  }
) {
  const {
    activeOpeningTree,
    selectedOpeningTreeId,
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
    openingTrees,
  } = state;

  const {
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
  } = context;


  const loadOpeningTreeRootOnBoard = useCallback((tree: OpeningTreeDetail) => {
    const rootMoves = buildStoredMovesFromSanList(null, tree.rootSan);
    const rootGame = restoreGameFromHistory(rootMoves, null, rootMoves.length);
    const rootNode = tree.nodes.find((node: any) => node.ply === tree.rootSan.length) ?? tree.nodes[0] ?? null;

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
    setOpeningDrillExpected(rootNode && rootNode.sideToMove === activeTrainSide ? { nodeId: rootNode.id, uci: rootNode.bestUci, san: rootNode.bestSan } : null);
    setOpeningDrillStatus('');
    if (rootNode) {
      setOrientation(activeTrainSide);
    }
    setShowArrow(false);
    clearSelection();
  }, [activeTrainSide, clearSelection, clearVariation, modeRef, positionRequestIdRef, setActiveOpeningNodeId, setFileName, setGame, setHistoryIndex, setInitialFen, setMetadata, setMode, setMoveHistory, setOpeningDrillExpected, setOpeningDrillStatus, setOrientation, setPositionAnalysis, setPreMoveAnalyses, setServerError, setShowArrow, setTimelineAnalyses, setTimelineError, timelineRequestIdRef]);

  const loadOpeningTreeDetail = useCallback(async (treeId: string, options: { syncBoard?: boolean } = {}) => {
    setOpeningTreeActionError('');

    try {
      const response = await fetch(`/api/opening-trees?treeId=${encodeURIComponent(treeId)}`, { credentials: 'same-origin' });
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
  }, [loadOpeningTreeRootOnBoard, setActiveOpeningNodeId, setActiveOpeningTree, setOpeningTreeActionError]);

  const loadOpeningTrees = useCallback(async () => {
    setOpeningTreesLoading(true);
    setOpeningTreeActionError('');

    try {
      const response = await fetch('/api/opening-trees?full=true', { credentials: 'same-origin' });
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

  const advanceDrillToStep = useCallback((stepIndex: number, isOpponentMovePlayback = false) => {
    const path = drillPathRef.current;
    const step = path[stepIndex];

    if (!step) {
      setOpeningDrillActive(false);
      setOpeningDrillStatus('Branch complete. Click Drill to start another path.');
      setOpeningDrillExpected(null);
      return;
    }

    drillPathIndexRef.current = stepIndex;
    const trainSteps = path.filter(pathStep => pathStep.isTrainTurn);
    const trainStepNumber = trainSteps.findIndex(pathStep => pathStep.nodeId === step.nodeId) + 1;
    const trainStepTotal = trainSteps.length;

    setActiveOpeningNodeId(step.nodeId);
    
    if (isOpponentMovePlayback && step.edgeUciFromParent) {
      let movePlayed: ReturnType<Chess['move']> | null = null;
      setGame(prevGame => {
        const nextGame = new Chess(prevGame.fen());
        try {
          movePlayed = nextGame.move({
            from: step.edgeUciFromParent!.substring(0, 2),
            to: step.edgeUciFromParent!.substring(2, 4),
            promotion: step.edgeUciFromParent!.length === 5 ? step.edgeUciFromParent![4] : undefined,
          });
        } catch (e) {
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
            setMoveHistory(prev => [...prev, toStoredMove(move)]);
            setHistoryIndex(prev => prev + 1);
            playSound('move');
          }
        } catch (e) {
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
      setOpeningDrillExpected({ nodeId: step.nodeId, uci: step.bestUci, san: step.bestSan });
      setOpeningDrillStatus(`Your move (${trainStepNumber}/${trainStepTotal}). Find the best move.`);
      setShowArrow(false);
    } else {
      setOpeningDrillExpected(null);
      const nextIndex = stepIndex + 1;
      const nextStep = path[nextIndex];

      if (nextStep) {
        const edgeSan = nextStep.edgeSanFromParent;
        setOpeningDrillStatus(edgeSan ? `Opponent plays ${edgeSan}...` : 'Opponent playing...');

        window.setTimeout(() => {
          advanceDrillToStep(nextIndex, true);
        }, DRILL_OPPONENT_DELAY_MS);
      } else {
        setOpeningDrillActive(false);
        setOpeningDrillStatus('Branch complete. Click Drill to start another path.');
      }
    }
  }, [clearSelection, playSound, setActiveOpeningNodeId, setDeckFeedback, setDeckFeedbackArrowsVisible, setGame, setHistoryIndex, setMoveHistory, setOpeningDrillActive, setOpeningDrillExpected, setOpeningDrillStatus, setPositionAnalysis, setServerError, setShowArrow]);

  const startOpeningDrill = useCallback((overrideTree?: OpeningTreeDetail) => {
    const tree = overrideTree ?? activeOpeningTree;

    if (!tree) {
      return;
    }

    const path = buildDrillPath(tree, { trainSide: activeTrainSide, preferWeak: true, seed: Date.now() });
    const firstTrainIndex = path.findIndex((step: any) => step.isTrainTurn);

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
    setOrientation(path[0]?.trainSide ?? activeTrainSide);
    setShowArrow(false);
    setOpeningDrillActive(true);
    playSound('game-start');

    const fullSans = [...tree.rootSan];
    if (firstTrainIndex > 0) {
      const sans = path.slice(1, firstTrainIndex + 1).map((step: any) => step.edgeSanFromParent).filter(Boolean) as string[];
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

      window.setTimeout(async () => {
        await playDeckReplayToIndex(moves.length, activeTrainSide);
        advanceDrillToStep(firstTrainIndex);
      }, 500);
      } catch (err) {
        console.error('Failed to parse drill opening moves', err);
        advanceDrillToStep(firstTrainIndex);
      }
  }, [activeOpeningTree, activeTrainSide, advanceDrillToStep, clearSelection, clearVariation, deckReplayInitialFenRef, deckReplayMovesRef, modeRef, playDeckReplayToIndex, playSound, positionRequestIdRef, setActiveOpeningNodeId, setFileName, setGame, setHistoryIndex, setInitialFen, setMetadata, setMode, setMoveHistory, setOpeningDrillActive, setOpeningDrillExpected, setOpeningDrillStatus, setOrientation, setPreMoveAnalyses, setServerError, setShowArrow, setTimelineAnalyses, setTimelineError, timelineRequestIdRef]);

  const stopOpeningDrill = useCallback(() => {
    setOpeningDrillActive(false);
    setOpeningDrillExpected(null);
    setDeckFeedback(null);
    setDeckFeedbackArrowsVisible(false);
    setShowArrow(false);
    setOpeningDrillStatus('');
    drillPathRef.current = [];
    drillPathIndexRef.current = 0;
  }, [setDeckFeedback, setDeckFeedbackArrowsVisible, setOpeningDrillActive, setOpeningDrillExpected, setOpeningDrillStatus, setShowArrow]);

  const selectOpeningTree = useCallback(async (treeId: string, treeObj?: OpeningTreeDetail) => {
    setSelectedOpeningTreeId(treeId);
    setOpeningDrillStatus('');
    setOpeningDrillExpected(null);
    
    if (!treeId) {
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

    let tree = treeObj;
    if (tree) {
      setActiveOpeningTree(tree);
      loadOpeningTreeRootOnBoard(tree);
    } else {
      tree = await loadOpeningTreeDetail(treeId, { syncBoard: true });
    }

    if (tree) {
      startOpeningDrill(tree);
    }
  }, [loadOpeningTreeDetail, loadOpeningTreeRootOnBoard, setActiveOpeningTree, setOpeningDrillExpected, setOpeningDrillStatus, setSelectedOpeningTreeId, startOpeningDrill]);

  const selectOpeningNode = useCallback((nodeId: string) => {
    const node = activeOpeningTree?.nodes.find(candidate => candidate.id === nodeId);

    setActiveOpeningNodeId(nodeId);
    setOpeningDrillActive(false);
    drillPathRef.current = [];
    drillPathIndexRef.current = 0;

    if (node) {
      setInitialFen(node.fen);
      setMoveHistory([]);
      setHistoryIndex(0);
      clearVariation();
      setGame(new Chess(node.fen));
      setOpeningDrillExpected(node.sideToMove === activeTrainSide ? { nodeId: node.id, uci: node.bestUci, san: node.bestSan } : null);
      setOpeningDrillStatus(node.sideToMove === activeTrainSide ? 'Find the best move from this node.' : 'Opponent node selected.');
      setOrientation(activeTrainSide);
      clearSelection();
    }
  }, [activeOpeningTree?.nodes, activeTrainSide, clearSelection, clearVariation, setActiveOpeningNodeId, setGame, setHistoryIndex, setInitialFen, setMoveHistory, setOpeningDrillActive, setOpeningDrillExpected, setOpeningDrillStatus, setOrientation]);

  return {
    loadOpeningTrees,
    importRecentOpeningTrees,
    advanceDrillToStep,
    startOpeningDrill,
    stopOpeningDrill,
    selectOpeningTree,
    selectOpeningNode,
  };
}
