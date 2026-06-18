import { useCallback, useRef, useState } from 'react';
import type { StoredMove } from '@/lib/chess-analysis-client';
import {
  createLinesSession,
  type ForkCoverageMap,
  findNearestOpenFork,
  type LinesSchedulerAction,
  type LinesSessionState,
  markForkEdgePlayed,
  type OpeningSide,
  type OpeningTreeDetail,
  pickNextSchedulerAction,
  resolveOpeningNodeFromHistory,
} from '@/lib/opening-tree';

export function useLinesSession() {
  const sessionRef = useRef<LinesSessionState | null>(null);
  const [forkCoverageRevision, setForkCoverageRevision] = useState(0);

  const resetSession = useCallback((tree: OpeningTreeDetail, trainSide: OpeningSide, startNodeId?: string | null) => {
    sessionRef.current = createLinesSession(tree, trainSide, startNodeId);
    setForkCoverageRevision((revision) => revision + 1);
    return sessionRef.current;
  }, []);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
    setForkCoverageRevision((revision) => revision + 1);
  }, []);

  const resyncFromHistory = useCallback(
    (
      tree: OpeningTreeDetail,
      moveHistory: StoredMove[],
      historyIndex: number,
      trainSide: OpeningSide,
    ): { nodeId: string | null; isTrainTurn: boolean } => {
      const resolved = resolveOpeningNodeFromHistory(tree, moveHistory, historyIndex);
      const node = resolved.nodeId ? tree.nodes.find((candidate) => candidate.id === resolved.nodeId) : null;
      const isTrainTurn = node?.sideToMove === trainSide;

      if (!sessionRef.current) {
        sessionRef.current = createLinesSession(tree, trainSide, resolved.nodeId);
      }

      sessionRef.current = {
        ...sessionRef.current,
        trainSide,
        activeNodeId: resolved.nodeId,
        phase: isTrainTurn ? 'awaiting_train' : 'playing_opponent',
      };

      return { nodeId: resolved.nodeId, isTrainTurn };
    },
    [],
  );

  const markEdgeSeen = useCallback((fromNodeId: string, edgeId: string) => {
    if (!sessionRef.current) {
      return;
    }

    sessionRef.current = {
      ...sessionRef.current,
      forkCoverage: markForkEdgePlayed(sessionRef.current.forkCoverage, fromNodeId, edgeId),
    };
    setForkCoverageRevision((revision) => revision + 1);
  }, []);

  const setActiveNode = useCallback((nodeId: string, phase: LinesSessionState['phase'] = 'awaiting_train') => {
    if (!sessionRef.current) {
      return;
    }

    sessionRef.current = {
      ...sessionRef.current,
      activeNodeId: nodeId,
      phase,
    };
  }, []);

  const switchToLayerMode = useCallback(() => {
    if (!sessionRef.current) {
      return;
    }

    sessionRef.current = {
      ...sessionRef.current,
      schedulerMode: 'layer',
    };
  }, []);

  const getSchedulerAction = useCallback((tree: OpeningTreeDetail): LinesSchedulerAction | null => {
    if (!sessionRef.current) {
      return null;
    }

    return pickNextSchedulerAction(tree, sessionRef.current);
  }, []);

  const getForkCoverage = useCallback((): ForkCoverageMap => {
    return sessionRef.current?.forkCoverage ?? {};
  }, []);

  const getActiveForkStats = useCallback(
    (tree: OpeningTreeDetail, nodeId: string | null): { played: number; total: number } | null => {
      if (!nodeId || !sessionRef.current) {
        return null;
      }

      const entry = sessionRef.current.forkCoverage[nodeId];

      if (!entry) {
        const outgoing = tree.edges.filter((edge) => edge.fromNodeId === nodeId);

        if (outgoing.length < 2) {
          return null;
        }

        return { played: 0, total: outgoing.length };
      }

      return {
        played: entry.playedEdgeIds.length,
        total: entry.playedEdgeIds.length + entry.remainingEdgeIds.length,
      };
    },
    [],
  );

  const findOpenForkAbove = useCallback((tree: OpeningTreeDetail, fromNodeId: string) => {
    if (!sessionRef.current) {
      return null;
    }

    return findNearestOpenFork(tree, sessionRef.current.forkCoverage, fromNodeId);
  }, []);

  const bumpSeed = useCallback(() => {
    if (!sessionRef.current) {
      return Date.now();
    }

    sessionRef.current = {
      ...sessionRef.current,
      seed: sessionRef.current.seed + 1,
    };

    return sessionRef.current.seed;
  }, []);

  return {
    sessionRef,
    forkCoverageRevision,
    resetSession,
    clearSession,
    resyncFromHistory,
    markEdgeSeen,
    setActiveNode,
    switchToLayerMode,
    getSchedulerAction,
    getForkCoverage,
    getActiveForkStats,
    findOpenForkAbove,
    bumpSeed,
  };
}
