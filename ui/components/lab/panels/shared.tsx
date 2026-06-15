'use client';

import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode, type RefObject } from 'react';
import { Background, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node as FlowNode } from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';

function OpeningTreeGraphAutoFollow({ activeNodeId }: { activeNodeId: string | null }) {
  const { setCenter, getNode } = useReactFlow();

  useEffect(() => {
    if (activeNodeId) {
      const node = getNode(activeNodeId);
      if (node && node.position) {
        setCenter(node.position.x + (node.width ?? 156) / 2, node.position.y + (node.height ?? 58) / 2, { duration: 800, zoom: 0.8 });
      }
    }
  }, [activeNodeId, getNode, setCenter]);

  return null;
}

import type { AnalysisLine, AnalysisResult } from '@/lib/analysis-types';
import {
  filterReviewMoments,
  formatBestMove,
  formatPrincipalVariation,
  reviewCategoryMeta,
  toChartScore,
  type ReviewCategory,
  type StoredMove,
  type TimelineReview,
} from '@/lib/chess-analysis-client';
import type { ChessComRecentGameSummary, ChessComRecentGameTimeClass } from '@/lib/chesscom';
import {
  getDeckCardOpeningGroup,
  getEffectiveMasteryScore,
  getMasteryGrade,
  type DeckProgressEntry,
  type DeckProgressSummary,
  type MasteryGrade,
} from '@/lib/deck-progress';
import type { OpeningLibrary, OpeningTreeDetail, OpeningTreeSummary } from '@/lib/opening-tree';

export type TrainSessionStats = {
  completed: number;
  hits: number;
  misses: number;
};
import type { DeckCard, DeckFeedback } from '@/lib/opening-training';
import styles from './chess-analysis-lab.module.css';

export type WorkspaceMode = 'review' | 'train' | 'lines';

export type TrainingDeckSummary = {
  id: string;
  name: string;
  description: string;
  ownerProfileId: string | null;
  cardCount: number;
  newCount: number;
  learningCount: number;
  dueCount: number;
  ignoredCount: number;
  isOwned: boolean;
  canManage: boolean;
};

