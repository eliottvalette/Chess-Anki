'use client';

import {
  Background,
  type Edge,
  type Node as FlowNode,
  Handle,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import dagre from 'dagre';
import {
  type ChangeEvent,
  createContext,
  memo,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import '@xyflow/react/dist/style.css';

function OpeningTreeGraphAutoFollow({ activeNodeId, treeId }: { activeNodeId: string | null; treeId: string | null }) {
  const { fitView } = useReactFlow();
  const previousTreeIdRef = useRef<string | null>(null);
  const previousNodeIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!treeId) {
      return;
    }

    const treeChanged = previousTreeIdRef.current !== treeId;
    previousTreeIdRef.current = treeId;

    const nodeChanged = previousNodeIdRef.current !== activeNodeId;
    previousNodeIdRef.current = activeNodeId;

    if (!treeChanged && !nodeChanged) {
      return;
    }

    const runFollow = () => {
      if (activeNodeId) {
        void fitView({
          nodes: [{ id: activeNodeId }],
          maxZoom: 1.2,
          minZoom: 0.25,
          padding: treeChanged ? 0.5 : 0.35,
          duration: treeChanged ? 400 : 0,
        });
        return;
      }

      if (treeChanged) {
        void fitView({ padding: 0.5, duration: 400 });
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(runFollow);
    });
  }, [activeNodeId, fitView, treeId]);

  return null;
}

import type { AnalysisLine, AnalysisResult } from '@/lib/analysis-types';
import {
  type filterReviewMoments,
  formatBestMove,
  formatPrincipalVariation,
  type ReviewCategory,
  reviewCategoryMeta,
  type StoredMove,
  type TimelineReview,
  toChartScore,
} from '@/lib/chess-analysis-client';
import type { ChessComRecentGameSummary, ChessComRecentGameTimeClass } from '@/lib/chesscom';
import {
  type DeckProgressEntry,
  type DeckProgressSummary,
  getDeckCardOpeningGroup,
  getEffectiveMasteryScore,
  getMasteryGrade,
  type MasteryGrade,
} from '@/lib/deck-progress';
import {
  countReviewDueNodes,
  filterOpeningTreeSummaries,
  formatOpeningTreeDisplayName,
  type LinesStudyMode,
  type OpeningLibrary,
  type OpeningTreeDetail,
  type OpeningTreeSummary,
} from '@/lib/opening-tree';

export type TrainSessionStats = {
  completed: number;
  hits: number;
  misses: number;
};

import type { DeckCard, DeckFeedback } from '@/lib/opening-training';

const masteryGradeClassByGrade = {
  F: 'bg-[#d94b62] text-[#fff7f8]',
  E: 'bg-[#d94b62] text-[#fff7f8]',
  D: 'bg-[#d98a35] text-[#fff7ec]',
  C: 'bg-[#d98a35] text-[#fff7ec]',
  B: 'bg-[#4e93d8] text-[#f5fbff]',
  A: 'bg-[#35a979] text-[#f4fff9]',
  S: 'bg-[#35a979] text-[#f4fff9]',
} as const satisfies Record<string, string>;

const masteryToneClassByGrade = {
  F: 'border-[rgba(255,92,108,0.42)] bg-[rgba(130,38,54,0.2)]',
  E: 'border-[rgba(255,92,108,0.42)] bg-[rgba(130,38,54,0.2)]',
  D: 'border-[rgba(255,176,84,0.36)] bg-[rgba(130,82,32,0.18)]',
  C: 'border-[rgba(255,176,84,0.36)] bg-[rgba(130,82,32,0.18)]',
  B: 'border-[rgba(138,198,255,0.34)] bg-[rgba(42,82,126,0.18)]',
  A: 'border-[rgba(138,227,193,0.38)] bg-[rgba(38,118,90,0.18)]',
  S: 'border-[rgba(138,227,193,0.38)] bg-[rgba(38,118,90,0.18)]',
} as const satisfies Record<string, string>;

const masteryDistributionClassByGrade = {
  F: 'bg-[rgba(217,75,98,0.62)]',
  E: 'bg-[rgba(217,75,98,0.48)]',
  D: 'bg-[rgba(217,138,53,0.58)]',
  C: 'bg-[rgba(217,138,53,0.44)]',
  B: 'bg-[rgba(78,147,216,0.56)]',
  A: 'bg-[rgba(53,169,121,0.58)]',
  S: 'bg-[rgba(53,169,121,0.72)]',
} as const satisfies Record<string, string>;

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

export function getModeLabel(mode: WorkspaceMode) {
  switch (mode) {
    case 'review':
      return 'Review';
    case 'train':
      return 'Train';
    case 'lines':
      return 'Lines';
  }
}

function formatRecentGameTimeClassLabel(timeClass: 'bullet' | 'blitz' | 'rapid') {
  switch (timeClass) {
    case 'bullet':
      return 'Bullet';
    case 'blitz':
      return 'Blitz';
    case 'rapid':
      return 'Rapid';
  }
}

export function DrillFeedbackBlock({ deckFeedback }: { deckFeedback: DeckFeedback | null }) {
  if (!deckFeedback) {
    return null;
  }

  return (
    <div
      className={`${'flex flex-col gap-[5px] rounded-[8px] px-[10px] py-[9px] text-[12px] text-(--text) text-(--text-muted) px-[10px] py-[8px] text-[11px] leading-[1.35] block overflow-visible'} ${deckFeedback.pending ? 'border border-solid border-[rgba(152,184,255,0.3)] bg-[rgba(9,14,23,0.42)]' : deckFeedback.correct ? 'border border-solid border-[rgba(138,227,193,0.38)] bg-[rgba(56,148,115,0.14)]' : 'border border-solid border-[rgba(255,141,145,0.42)] bg-[rgba(180,58,66,0.16)]'}`}
    >
      <strong>{deckFeedback.pending ? 'Checking eval' : deckFeedback.correct ? 'Best move' : 'Miss'}</strong>
      <span>
        played {deckFeedback.playedSan} · best {deckFeedback.expectedSan}
        {deckFeedback.evalLossCp != null ? ` · loss ${formatCpSwing(deckFeedback.evalLossCp)}` : ''}
      </span>
      {!deckFeedback.pending && !deckFeedback.correct ? <span>← undo to retry</span> : null}
    </div>
  );
}

export function LinesPanel({
  actionError,
  actionLoading,
  activeNodeId,
  activeTree,
  activeTreeId,
  deckFeedback,
  deckPlaybackBusy,
  drillActive,
  forkCoverage,
  hasNextLearnBranch,
  learnBranchComplete,
  linesStudyMode,
  loading,
  onChangeTrainSide,
  onImportRecent,
  onNextLearnBranch,
  onQuitSession,
  onSelectNode,
  onSelectTree,
  onStartLearn,
  onStartReview,
  reviewIndex,
  reviewQueueLength,
  sessionTrainPlyCurrent,
  sessionTrainPlyTotal,
  studyDebugSnapshot,
  trainSide,
  trees,
  minForcedPlies,
  setMinForcedPlies,
  minNodes,
  setMinNodes,
  minDepth,
  setMinDepth,
  learnMaxPly,
  setLearnMaxPly,
  positionFilterActive,
  positionFilterLoading,
  onClearBoardPosition,
}: {
  actionError: string;
  actionLoading: boolean;
  activeNodeId: string | null;
  activeTree: OpeningTreeDetail | null;
  activeTreeId: string | null;
  deckFeedback: DeckFeedback | null;
  deckPlaybackBusy: boolean;
  drillActive: boolean;
  forkCoverage?: Record<string, { playedEdgeIds: string[]; remainingEdgeIds: string[] }>;
  hasNextLearnBranch: boolean;
  learnBranchComplete: boolean;
  linesStudyMode: LinesStudyMode;
  loading: boolean;
  onChangeTrainSide: (side: 'white' | 'black') => void;
  onImportRecent: () => void;
  onNextLearnBranch: () => void;
  onQuitSession: () => void;
  onSelectNode: (nodeId: string) => void;
  onSelectTree: (treeId: string) => void;
  onStartLearn: () => void;
  onStartReview: () => void;
  reviewIndex: number;
  reviewQueueLength: number;
  sessionTrainPlyCurrent: number;
  sessionTrainPlyTotal: number;
  studyDebugSnapshot: string;
  trainSide: 'white' | 'black';
  trees: OpeningTreeSummary[];
  minForcedPlies: number;
  setMinForcedPlies: (value: number) => void;
  minNodes: number;
  setMinNodes: (value: number) => void;
  minDepth: number;
  setMinDepth: (value: number) => void;
  learnMaxPly: number;
  setLearnMaxPly: (value: number) => void;
  positionFilterActive: boolean;
  positionFilterLoading: boolean;
  onClearBoardPosition: () => void;
}) {
  const catalogTrees = useMemo(() => filterOpeningTreeSummaries(trees), [trees]);
  const filteredTrees = useMemo(
    () => catalogTrees.filter((tree) => tree.nodeCount >= minNodes && tree.targetDepth >= minDepth),
    [catalogTrees, minDepth, minNodes],
  );
  const groupedTrees = useMemo(() => groupOpeningTrees(filteredTrees), [filteredTrees]);
  const graphLayout = useMemo(() => layoutOpeningTreeGraph(activeTree), [activeTree]);
  const graphNodes = useMemo(
    () => buildOpeningTreeGraphNodes(activeTree, graphLayout, trainSide),
    [activeTree, graphLayout, trainSide],
  );
  const graphEdges = useMemo(
    () => buildOpeningTreeGraphEdges(activeTree, drillActive, forkCoverage ?? {}),
    [activeTree, drillActive, forkCoverage],
  );
  const graphInteraction = useMemo(
    () => ({ drillActive: linesStudyMode !== 'idle' || drillActive, onSelectNode }),
    [drillActive, linesStudyMode, onSelectNode],
  );
  const graphReadOnly = linesStudyMode !== 'idle';
  const reviewDueCount = useMemo(
    () => (activeTree ? countReviewDueNodes(activeTree, trainSide) : 0),
    [activeTree, trainSide],
  );
  const inSession = linesStudyMode !== 'idle';
  const atLearnLineEnd =
    linesStudyMode === 'learn' &&
    sessionTrainPlyTotal > 0 &&
    sessionTrainPlyCurrent >= sessionTrainPlyTotal &&
    deckFeedback?.correct === true;
  const showNextLearnBranch = hasNextLearnBranch && (atLearnLineEnd || (learnBranchComplete && !inSession));
  const [copyDebugLabel, setCopyDebugLabel] = useState('Copy');

  const handleCopyStudyDebug = async () => {
    await navigator.clipboard.writeText(studyDebugSnapshot);
    setCopyDebugLabel('Copied!');
    window.setTimeout(() => {
      setCopyDebugLabel('Copy');
    }, 2000);
  };

  const graph = useMemo(
    () => ({
      nodes: graphNodes.map((node) => ({
        ...node,
        selected: node.id === activeNodeId,
      })),
      edges: graphEdges,
    }),
    [graphNodes, graphEdges, activeNodeId],
  );
  const activeForkStats = useMemo(() => {
    if (!activeTree || !activeNodeId) {
      return null;
    }

    const entry = forkCoverage?.[activeNodeId];

    if (entry) {
      return {
        played: entry.playedEdgeIds.length,
        total: entry.playedEdgeIds.length + entry.remainingEdgeIds.length,
      };
    }

    const outgoing = activeTree.edges?.filter((edge) => edge.fromNodeId === activeNodeId) ?? [];

    if (outgoing.length < 2) {
      return null;
    }

    return { played: 0, total: outgoing.length };
  }, [activeNodeId, activeTree, forkCoverage]);

  const browseFilters = (
    <div className="flex flex-row gap-3 rounded-[10px] border border-(--border-soft) bg-(--surface-strong) px-3 py-2.5">
      <label className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[10px] font-normal text-(--text-soft)">
          Browse ply{positionFilterActive ? ' (board)' : ''}
        </span>
        <input
          className={`w-full rounded-md border border-(--border-soft) bg-transparent px-2 py-1 text-[13px] text-(--text) outline-none transition-[border-color] duration-150 focus:border-(--accent) ${positionFilterActive ? 'cursor-not-allowed opacity-50' : ''}`}
          disabled={positionFilterActive}
          id="filter-min-forced-plies"
          min={1}
          onChange={(event) => setMinForcedPlies(Math.max(1, Number(event.target.value) || 1))}
          type="number"
          value={minForcedPlies}
        />
      </label>
      <label className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[10px] font-normal text-(--text-soft)">Min nodes</span>
        <input
          className="w-full rounded-md border border-(--border-soft) bg-transparent px-2 py-1 text-[13px] text-(--text) outline-none transition-[border-color] duration-150 focus:border-(--accent)"
          id="filter-min-nodes"
          min={0}
          onChange={(event) => setMinNodes(Math.max(0, Number(event.target.value) || 0))}
          type="number"
          value={minNodes}
        />
      </label>
      <label className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[10px] font-normal text-(--text-soft)">Min depth</span>
        <input
          className="w-full rounded-md border border-(--border-soft) bg-transparent px-2 py-1 text-[13px] text-(--text) outline-none transition-[border-color] duration-150 focus:border-(--accent)"
          id="filter-min-depth"
          min={0}
          onChange={(event) => setMinDepth(Math.max(0, Number(event.target.value) || 0))}
          type="number"
          value={minDepth}
        />
      </label>
    </div>
  );

  return (
    <>
      {!activeTree ? (
        <section
          className={`relative min-h-0 rounded-xl border border-(--border-soft) bg-(--surface) p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg backdrop-saturate-[1.16] flex flex-col gap-[18px] overflow-visible`}
        >
          <div className="flex min-w-0 items-center justify-between gap-3.5">
            <h2 className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] font-normal leading-[1.15] tracking-normal text-(--text)">
              Lines
            </h2>
            <span className="text-sm leading-[1.45] text-(--text-muted)">
              {loading || positionFilterLoading
                ? 'loading'
                : `${filteredTrees.length}${catalogTrees.length !== filteredTrees.length ? ` / ${catalogTrees.length}` : ''} openings`}
            </span>
          </div>
          {catalogTrees.length === 0 ? (
            <p className="m-0 text-sm leading-[1.45] text-(--text-muted)">
              Import your recent games to build opening graphs, then browse them at any ply depth.
            </p>
          ) : (
            <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto overflow-x-hidden pr-[3px] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {browseFilters}
              {positionFilterActive ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-(--text-soft)">Filtered by board position</span>
                  <button
                    className="cursor-pointer rounded-md border border-(--border-soft) bg-transparent px-2 py-1 text-[11px] text-(--text-muted) transition-[border-color] duration-150 hover:border-(--accent)"
                    onClick={onClearBoardPosition}
                    type="button"
                  >
                    Reset board
                  </button>
                </div>
              ) : null}
              {filteredTrees.length === 0 ? (
                <p className="m-0 text-sm leading-[1.45] text-(--text-muted)">No openings match the current filters.</p>
              ) : (
                <>
                  <span className="text-[11px] text-(--text-soft)">
                    {filteredTrees.length} / {catalogTrees.length} openings
                  </span>
                  {OPENING_LIBRARY_ORDER.map((library) => {
                    const libraryTrees = groupedTrees.get(library) ?? [];

                    if (libraryTrees.length === 0) {
                      return null;
                    }

                    return (
                      <section className="flex min-w-0 flex-col gap-2" key={library}>
                        <h3 className="m-0 text-[11px] font-normal text-(--text-soft)">
                          {formatOpeningLibrary(library)}
                        </h3>
                        <div className="flex min-h-0 flex-col gap-2">
                          {libraryTrees.map((tree) => (
                            <button
                              className={`flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-[10px] border px-3 py-[11px] text-left transition-[border-color,background-color] duration-150 ${tree.id === activeTreeId ? 'border-[rgba(198,215,255,0.58)] bg-[rgba(46,58,82,0.58)] text-(--text) shadow-[inset_0_0_0_1px_rgba(198,215,255,0.1)]' : 'border-[rgba(214,226,244,0.18)] bg-[rgba(9,14,23,0.4)] text-(--text-muted) hover:border-[rgba(214,226,244,0.28)]'}`}
                              key={tree.id}
                              onClick={() => onSelectTree(tree.id)}
                              type="button"
                            >
                              <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 [&_strong]:min-w-0 [&_strong]:text-[13px] [&_strong]:leading-tight [&_strong]:text-(--text) wrap-anywhere">
                                <strong>{formatOpeningTreeDisplayName(tree.name)}</strong>
                                <span className="flex-none text-[11px] font-normal leading-none text-(--text-soft) [&+strong]:min-w-0">
                                  {tree.masteryScore > 0 ? `${tree.masteryScore}/100` : 'New'}
                                </span>
                              </span>
                              <span className="block font-mono text-[11px] leading-[1.35] text-(--text-muted) wrap-anywhere">
                                {tree.rootSan.join(' ') || 'Starting position'}
                              </span>
                              <span className="flex flex-wrap gap-2.5 [&_span]:text-[10px] font-normal leading-none text-(--text-soft)">
                                <span>{tree.sourceCount} sources</span>
                                <span>{tree.nodeCount} nodes</span>
                                {tree.dueCount > 0 ? <span>{tree.dueCount} weak</span> : null}
                              </span>
                            </button>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </>
              )}
            </div>
          )}
          {actionError ? <p className="m-0 text-sm leading-[1.45] text-[#ffb4b2]">{actionError}</p> : null}
        </section>
      ) : null}

      {activeTree ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="flex w-full shrink-0 items-stretch gap-2">
            <button
              className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(255,120,120,0.34)] bg-[rgba(120,28,28,0.18)] px-3.5 text-xs font-normal text-[#ffc8c6] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(255,120,120,0.52)] hover:bg-[rgba(120,28,28,0.28)] hover:text-[#ffe0df] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full min-w-0 self-stretch`}
              onClick={() => (inSession ? onQuitSession() : onSelectTree(''))}
              type="button"
            >
              {inSession ? 'Quit' : 'Back'}
            </button>
          </div>
          {!inSession ? (
            <div className="flex shrink-0 flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <p className="m-0 text-[10px] font-medium uppercase tracking-[0.08em] text-(--text-muted)">
                  Your color
                </p>
                <div className="flex w-full items-stretch gap-2">
                  <button
                    className={`${trainSide === 'white' ? 'box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full min-w-0 self-stretch' : 'box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-(--border) bg-[rgba(9,14,23,0.38)] px-3.5 text-xs font-normal text-(--text) shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full min-w-0 self-stretch'}`}
                    onClick={() => onChangeTrainSide('white')}
                    type="button"
                  >
                    White
                  </button>
                  <button
                    className={`${trainSide === 'black' ? 'box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full min-w-0 self-stretch' : 'box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-(--border) bg-[rgba(9,14,23,0.38)] px-3.5 text-xs font-normal text-(--text) shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full min-w-0 self-stretch'}`}
                    onClick={() => onChangeTrainSide('black')}
                    type="button"
                  >
                    Black
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="m-0 text-[10px] font-medium uppercase tracking-[0.08em] text-(--text-muted)">
                  Study mode
                </p>
                <div className="flex w-full items-stretch gap-2">
                  <button
                    className="box-border flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[10px] border border-[rgba(138,227,193,0.42)] bg-[rgba(56,148,115,0.18)] px-3 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-[border-color,background-color] duration-150 hover:border-[rgba(138,227,193,0.62)] hover:bg-[rgba(56,148,115,0.28)]"
                    onClick={onStartLearn}
                    type="button"
                  >
                    <span className="text-[13px] font-medium text-[#d8f8ec]">Learn line</span>
                    <span className="text-[10px] text-[#9fd9c0]">Full branch, step by step</span>
                  </button>
                  <button
                    className="box-border flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[10px] border border-[rgba(152,184,255,0.38)] bg-[rgba(72,98,168,0.2)] px-3 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-[border-color,background-color] duration-150 hover:border-[rgba(152,184,255,0.58)] hover:bg-[rgba(72,98,168,0.32)] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={reviewDueCount === 0}
                    onClick={onStartReview}
                    type="button"
                  >
                    <span className="text-[13px] font-medium text-[#e8eeff]">Review weak spots</span>
                    <span className="text-[10px] text-[#b8c8f0]">{reviewDueCount} positions due</span>
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="m-0 text-[10px] font-medium uppercase tracking-[0.08em] text-(--text-muted)">
                  Learn depth cap
                </p>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-[10px] font-normal text-(--text-soft)">Max ply (0 = full tree)</span>
                  <input
                    className="w-full rounded-md border border-(--border-soft) bg-transparent px-2 py-1.5 text-[13px] text-(--text) outline-none transition-[border-color] duration-150 focus:border-(--accent) disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={inSession}
                    id="learn-max-ply"
                    min={0}
                    onChange={(event) => setLearnMaxPly(Math.max(0, Number(event.target.value) || 0))}
                    type="number"
                    value={learnMaxPly}
                  />
                </label>
              </div>
            </div>
          ) : (
            <button
              className="box-border flex min-h-[42px] w-full shrink-0 items-center justify-center rounded-[10px] border border-[rgba(152,184,255,0.38)] bg-[rgba(39,51,75,0.72)] px-3.5 text-xs font-medium text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color] duration-150 hover:border-[rgba(152,184,255,0.58)] hover:bg-[rgba(46,58,82,0.58)]"
              onClick={() => void handleCopyStudyDebug()}
              type="button"
            >
              {copyDebugLabel}
            </button>
          )}
          {showNextLearnBranch ? (
            <button
              className="box-border flex min-h-[48px] w-full shrink-0 items-center justify-center rounded-[10px] border border-[rgba(138,227,193,0.52)] bg-[rgba(56,148,115,0.34)] px-4 text-sm font-medium text-[#d8f8ec] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color] duration-150 hover:border-[rgba(138,227,193,0.72)] hover:bg-[rgba(56,148,115,0.48)]"
              onClick={onNextLearnBranch}
              type="button"
            >
              Next branch
            </button>
          ) : (learnBranchComplete || atLearnLineEnd) && !showNextLearnBranch ? (
            <p className="m-0 shrink-0 rounded-[10px] border border-[rgba(138,227,193,0.28)] bg-[rgba(56,148,115,0.12)] px-3 py-2 text-xs text-[#d8f8ec]">
              Branch complete.
            </p>
          ) : null}

          <section
            className={`relative flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl border border-(--border-soft) bg-(--surface) p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg backdrop-saturate-[1.16] ${drillActive ? (deckFeedback?.correct ? 'border border-[rgba(138,227,193,0.38)] bg-[rgba(56,148,115,0.14)]' : deckFeedback?.pending === false ? 'border border-[rgba(255,141,145,0.42)] bg-[rgba(180,58,66,0.16)]' : 'border border-[rgba(152,184,255,0.3)] bg-[rgba(9,14,23,0.42)]') : ''}`}
          >
            <div className="flex min-w-0 shrink-0 items-center justify-between gap-2.5">
              <div className="flex min-w-0 flex-col gap-1">
                <strong className="text-base leading-[1.2] tracking-normal text-(--text) wrap-anywhere">
                  {formatOpeningTreeDisplayName(activeTree.name)}
                </strong>
                {inSession ? (
                  <span
                    className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      linesStudyMode === 'learn'
                        ? 'border border-[rgba(138,227,193,0.42)] bg-[rgba(56,148,115,0.2)] text-[#d8f8ec]'
                        : 'border border-[rgba(152,184,255,0.38)] bg-[rgba(72,98,168,0.22)] text-[#e8eeff]'
                    }`}
                  >
                    {linesStudyMode === 'learn'
                      ? `Learn · move ${sessionTrainPlyCurrent}/${sessionTrainPlyTotal}${learnMaxPly > 0 ? ` · ≤${learnMaxPly}` : ''}`
                      : `Review · ${reviewIndex + 1}/${reviewQueueLength}`}
                  </span>
                ) : null}
              </div>
            </div>

            <DrillFeedbackBlock deckFeedback={deckFeedback} />

            <div className="flex shrink-0 items-center justify-between gap-2.5 text-xs text-(--text-soft)">
              <span>depth {activeTree.targetDepth}</span>
              {learnMaxPly > 0 && linesStudyMode !== 'review' ? <span>cap ply {learnMaxPly}</span> : null}
              <span>{activeTree.nodes?.length ?? activeTree.nodeCount} nodes</span>
              {activeTree.dueCount > 0 ? <span>{activeTree.dueCount} weak</span> : null}
              {activeForkStats ? (
                <span>
                  {activeForkStats.played}/{activeForkStats.total} replies
                </span>
              ) : null}
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden rounded-[10px] border border-(--border) bg-[radial-gradient(circle_at_18%_16%,rgba(152,184,255,0.1),transparent_28%),rgba(4,8,15,0.58)] [&_.react-flow]:size-full [&_.react-flow__pane]:cursor-grab [&_.react-flow__pane.dragging]:cursor-grabbing [&_.react-flow__viewport]:cursor-grab [&_.react-flow__edge-text]:fill-[#eef5ff] [&_.react-flow__edge-text]:text-[11px] [&_.react-flow__edge-text]:font-normal [&_.react-flow__edge-textbg]:fill-[rgba(5,10,17,0.88)] [&_.react-flow__edge-textbg]:stroke-[rgba(214,226,244,0.18)] [&_.react-flow__edge-path]:stroke-[rgba(143,156,178,0.68)] [&_.react-flow__edge-path]:stroke-[1.7] [&_.react-flow__node-default]:p-0 [&_.react-flow__node-default]:text-(--text)">
              {deckPlaybackBusy && !inSession ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[rgba(4,8,15,0.58)] text-sm text-(--text-muted)">
                  Loading line...
                </div>
              ) : null}
              <OpeningTreeGraphInteractionContext.Provider value={graphInteraction}>
                <ReactFlowProvider key={activeTreeId ?? 'none'}>
                  <ReactFlow
                    edges={graph.edges}
                    minZoom={0.25}
                    nodeTypes={openingTreeGraphNodeTypes}
                    nodes={graph.nodes}
                    onlyRenderVisibleElements
                    nodesDraggable={false}
                    panOnDrag
                    selectNodesOnDrag={false}
                    zoomOnScroll={false}
                    panOnScroll={false}
                    zoomOnDoubleClick={false}
                    nodesConnectable={false}
                    onNodeClick={graphReadOnly ? undefined : (_, node) => onSelectNode(node.id)}
                    proOptions={{ hideAttribution: true }}
                  >
                    <Background />
                    <OpeningTreeGraphAutoFollow activeNodeId={activeNodeId} treeId={activeTreeId} />
                  </ReactFlow>
                </ReactFlowProvider>
              </OpeningTreeGraphInteractionContext.Provider>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

const OPENING_LIBRARY_ORDER: OpeningLibrary[] = ['e4', 'd4', 'c4', 'nf3', 'other'];

function groupOpeningTrees(trees: OpeningTreeSummary[]) {
  const groups = new Map<OpeningLibrary, OpeningTreeSummary[]>();

  for (const tree of trees) {
    const group = groups.get(tree.library) ?? [];
    group.push(tree);
    groups.set(tree.library, group);
  }

  return groups;
}

function formatOpeningLibrary(library: OpeningLibrary) {
  switch (library) {
    case 'e4':
      return 'vs 1.e4';
    case 'd4':
      return 'vs 1.d4';
    case 'c4':
      return 'vs 1.c4';
    case 'nf3':
      return 'vs 1.Nf3';
    case 'other':
      return 'Other';
  }
}

function layoutOpeningTreeGraph(tree: OpeningTreeDetail | null) {
  if (!tree?.nodes?.length) {
    return new Map<string, { x: number; y: number }>();
  }

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'TB', nodesep: 32, ranksep: 64 });

  for (const node of tree.nodes) {
    graph.setNode(node.id, { width: 156, height: 58 });
  }

  for (const edge of tree.edges ?? []) {
    graph.setEdge(edge.fromNodeId, edge.toNodeId);
  }

  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();

  for (const node of tree.nodes) {
    const point = graph.node(node.id) ?? { x: 0, y: 0 };
    positions.set(node.id, { x: point.x - 78, y: point.y - 29 });
  }

  return positions;
}

type OpeningTreeGraphNodeData = {
  ply: number;
  sideToMove: 'white' | 'black';
  trainSide: 'white' | 'black';
  bestSan: string | null;
  recentGames: number;
  seenCount: number;
  masteryScore: number;
};

type OpeningTreeGraphInteraction = {
  drillActive: boolean;
  onSelectNode: (nodeId: string) => void;
};

const OpeningTreeGraphInteractionContext = createContext<OpeningTreeGraphInteraction>({
  drillActive: false,
  onSelectNode: () => undefined,
});

const OpeningTreeGraphNode = memo(function OpeningTreeGraphNode({ id, data, selected }: NodeProps) {
  const nodeData = data as OpeningTreeGraphNodeData;
  const { drillActive, onSelectNode } = useContext(OpeningTreeGraphInteractionContext);
  const isTrainTurn = nodeData.sideToMove === nodeData.trainSide;
  const isWeak = nodeData.masteryScore < 60 && isTrainTurn;
  const showAnswer = isTrainTurn && nodeData.bestSan && !drillActive;

  return (
    <div className="relative">
      <Handle className="opacity-0" position={Position.Top} type="target" />
      <button
        className={[
          'flex min-h-[58px] w-[156px] cursor-pointer flex-col justify-center gap-1 rounded-[10px] border px-2.5 py-2 text-left text-(--text) shadow-[0_8px_20px_rgba(0,0,0,0.24)] [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_strong]:text-[13px] [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap [&_span]:text-[10px] font-normal text-(--text-soft)',
          selected
            ? 'border-[rgba(198,215,255,0.78)] shadow-[0_8px_22px_rgba(0,0,0,0.28),0_0_0_2px_rgba(198,215,255,0.16)]'
            : 'border-[rgba(214,226,244,0.24)]',
          isTrainTurn
            ? 'border-[rgba(138,198,255,0.34)] bg-[rgba(42,82,126,0.2)]'
            : 'border-[rgba(214,226,244,0.2)] bg-[rgba(13,20,32,0.94)]',
          isWeak ? 'border-[rgba(255,176,84,0.36)] bg-[rgba(130,82,32,0.18)]' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => {
          if (!drillActive) {
            onSelectNode(id);
          }
        }}
        type="button"
      >
        <strong>{isTrainTurn && showAnswer ? `Best: ${nodeData.bestSan}` : `Ply ${nodeData.ply}`}</strong>
        <span>
          {isTrainTurn
            ? nodeData.seenCount > 0
              ? `${nodeData.masteryScore}/100`
              : nodeData.recentGames > 0
                ? `${nodeData.recentGames} games`
                : 'New'
            : 'Opponent'}
        </span>
      </button>
      <Handle className="opacity-0" position={Position.Bottom} type="source" />
    </div>
  );
});

const openingTreeGraphNodeTypes = {
  openingTreeNode: OpeningTreeGraphNode,
};

function buildOpeningTreeGraphNodes(
  tree: OpeningTreeDetail | null,
  layout: Map<string, { x: number; y: number }>,
  trainSide: 'white' | 'black',
): FlowNode[] {
  if (!tree?.nodes?.length) {
    return [];
  }

  return tree.nodes.map((node) => ({
    id: node.id,
    type: 'openingTreeNode',
    position: layout.get(node.id) ?? { x: 0, y: 0 },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: {
      ply: node.ply,
      sideToMove: node.sideToMove,
      trainSide,
      bestSan: node.bestSan,
      recentGames: node.recentGames,
      seenCount: node.seenCount,
      masteryScore: node.masteryScore,
    },
    draggable: false,
  }));
}

function buildOpeningTreeGraphEdges(
  tree: OpeningTreeDetail | null,
  drillActive: boolean,
  forkCoverage: Record<string, { playedEdgeIds: string[]; remainingEdgeIds: string[] }>,
): Edge[] {
  if (!tree?.edges?.length || !tree?.nodes?.length) {
    return [];
  }

  const nodeIds = new Set(tree.nodes.map((node) => node.id));

  return tree.edges
    .filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId))
    .map((edge) => {
      const fromCoverage = forkCoverage[edge.fromNodeId];
      const isPlayed = fromCoverage?.playedEdgeIds.includes(edge.id) ?? false;
      const isRemaining = fromCoverage?.remainingEdgeIds.includes(edge.id) ?? false;
      const forkEdgeStyle =
        drillActive && (isPlayed || isRemaining)
          ? {
              stroke: isPlayed ? 'rgba(138, 227, 193, 0.95)' : 'rgba(152, 184, 255, 0.55)',
              strokeWidth: isPlayed ? 2.8 : 2.2,
              opacity: isRemaining ? 1 : 0.72,
            }
          : edge.isEngineBest
            ? { stroke: 'rgba(138, 227, 193, 0.95)', strokeWidth: 2.8 }
            : undefined;

      return {
        id: edge.id,
        source: edge.fromNodeId,
        target: edge.toNodeId,
        animated: edge.isEngineBest || isRemaining,
        label: edge.san,
        style: forkEdgeStyle,
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 6,
        labelShowBg: true,
      } satisfies Edge;
    });
}

export function ReviewPanel({
  activeReviewMoment,
  blackReviewName,
  chesscomUsername,
  goToReviewMoment,
  hasLoadedGame,
  historyIndex,
  jumpToIndex,
  loadRecentGame,
  moveHistoryLength,
  movePairs,
  onBack,
  onChesscomUsernameChange,
  onRecentGameTimeClassChange,
  onFetchRecentGames,
  onLoadMoreRecentGames,
  recentGames,
  recentGamesError,
  recentGamesHasMore,
  recentGamesLoading,
  recentGameTimeClass,
  reviewDeckSaveStatus,
  reviewMoments,
  reviewSaveMoveSan,
  positionLoading,
  canSaveReviewCard,
  deckSummaries,
  onSaveReviewCard,
  onGoCreateDeck,
  onSelectSaveDeck,
  selectedDeckId,
  setShowArrow,
  timelineAnalyses,
  timelineAnalysesLength,
  timelineError,
  timelineLoading,
  timelineProgress,
  timelineReviews,
  whiteReviewName,
}: {
  activeReviewMoment: ReturnType<typeof filterReviewMoments>[number] | null;
  blackReviewName: string;
  chesscomUsername: string;
  goToReviewMoment: (index: number) => void;
  hasLoadedGame: boolean;
  historyIndex: number;
  jumpToIndex: (index: number) => void;
  loadRecentGame: (game: ChessComRecentGameSummary) => void;
  moveHistoryLength: number;
  movePairs: Array<{
    moveNumber: number;
    white: StoredMove | null;
    whitePly: number;
    black: StoredMove | null;
    blackPly: number;
  }>;
  onBack: () => void;
  onChesscomUsernameChange: (value: string) => void;
  onRecentGameTimeClassChange: (value: ChessComRecentGameTimeClass) => void;
  onFetchRecentGames: () => void;
  onLoadMoreRecentGames: () => void;
  recentGames: ChessComRecentGameSummary[];
  recentGamesError: string;
  recentGamesHasMore: boolean;
  recentGamesLoading: boolean;
  recentGameTimeClass: ChessComRecentGameTimeClass;
  reviewDeckSaveStatus: string;
  reviewMoments: ReturnType<typeof filterReviewMoments>;
  reviewSaveMoveSan: string | null;
  positionLoading: boolean;
  canSaveReviewCard: boolean;
  deckSummaries: TrainingDeckSummary[];
  onSaveReviewCard: () => void;
  onGoCreateDeck: () => void;
  onSelectSaveDeck: (deckId: string) => void;
  selectedDeckId: string | null;
  setShowArrow: (value: boolean) => void;
  timelineAnalyses: AnalysisResult[];
  timelineAnalysesLength: number;
  timelineError: string;
  timelineLoading: boolean;
  timelineProgress: number | null;
  timelineReviews: TimelineReview[];
  whiteReviewName: string;
}) {
  const reviewPanelProps = {
    activeReviewMoment,
    blackReviewName,
    chesscomUsername,
    goToReviewMoment,
    historyIndex,
    jumpToIndex,
    loadRecentGame,
    movePairs,
    moveHistoryLength,
    onChesscomUsernameChange,
    onRecentGameTimeClassChange,
    onFetchRecentGames,
    onLoadMoreRecentGames,
    recentGames,
    recentGamesError,
    recentGamesHasMore,
    recentGamesLoading,
    recentGameTimeClass,
    reviewDeckSaveStatus,
    reviewMoments,
    reviewSaveMoveSan,
    positionLoading,
    canSaveReviewCard,
    deckSummaries,
    onSaveReviewCard,
    onGoCreateDeck,
    onSelectSaveDeck,
    selectedDeckId,
    setShowArrow,
    timelineAnalyses,
    timelineAnalysesLength,
    timelineError,
    timelineLoading,
    timelineProgress,
    timelineReviews,
    whiteReviewName,
  };

  if (!hasLoadedGame) {
    return <GameReviewPanel {...reviewPanelProps} hasLoadedGame={false} />;
  }

  return (
    <div className="min-h-0 h-full grid grid-rows-[auto_minmax(0,1fr)] gap-[10px]">
      <section className="min-h-0 flex-[0_0_auto]">
        <button
          className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(255,120,120,0.34)] bg-[rgba(120,28,28,0.18)] px-3.5 text-xs font-normal text-[#ffc8c6] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(255,120,120,0.52)] hover:bg-[rgba(120,28,28,0.28)] hover:text-[#ffe0df] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full min-w-0 self-stretch`}
          onClick={onBack}
          type="button"
        >
          Back
        </button>
      </section>
      <GameReviewPanel {...reviewPanelProps} hasLoadedGame={true} />
    </div>
  );
}

export function TrainPanel({
  activeCard,
  activeCardProgress,
  deckActionError,
  deckActionLoading,
  deckCounterSan,
  deckLoadError,
  deckBusy,
  deckLibraryLoading,
  deckSummaries,
  deckFeedback,
  deckPlaybackBusy,
  deckStats,
  deckLineMastery,
  canDeleteCard,
  deleteCardLabel,
  newDeckTitle,
  nextCard,
  onBack,
  onCreateDeck,
  onGenerateRecentDeck,
  onNext,
  onDeleteCard,
  onTrainDeck,
  onTrainAll,
  onRenameDeck,
  onDeleteDeck,
  focusCreateDeck,
  onCreateDeckFocusHandled,
  onNewDeckTitleChange,
  selectedDeckId,
  trainAllSession,
  trainSessionCardCurrent,
  trainSessionCardTotal,
}: {
  activeCard: DeckCard | null;
  activeCardProgress: DeckProgressEntry | null;
  deckLineMastery: ReturnType<typeof import('@/lib/deck-progress').summarizeLineMastery>;
  deckActionError: string;
  deckActionLoading: boolean;
  deckCounterSan: string | null;
  deckLoadError: string;
  deckBusy: boolean;
  deckLibraryLoading: boolean;
  deckSummaries: TrainingDeckSummary[];
  deckFeedback: DeckFeedback | null;
  deckPlaybackBusy: boolean;
  deckStats: DeckProgressSummary;
  canDeleteCard: boolean;
  deleteCardLabel: string;
  newDeckTitle: string;
  nextCard: DeckCard | null;
  onBack: () => void;
  onCreateDeck: () => void;
  onGenerateRecentDeck: () => void;
  onNext: () => void;
  onDeleteCard: () => void;
  onTrainDeck: (deckId: string) => void;
  onTrainAll: () => void;
  onRenameDeck: (deckId: string, name: string) => void;
  onDeleteDeck: (deckId: string) => void;
  focusCreateDeck: boolean;
  onCreateDeckFocusHandled: () => void;
  onNewDeckTitleChange: (value: string) => void;
  selectedDeckId: string | null;
  trainAllSession: boolean;
  trainSessionCardCurrent: number;
  trainSessionCardTotal: number;
  trainSessionStats: TrainSessionStats;
}) {
  if (!activeCard) {
    return (
      <LearnPanel
        deckActionError={deckActionError}
        deckActionLoading={deckActionLoading}
        deckLoadError={deckLoadError}
        deckBusy={deckBusy}
        deckLibraryLoading={deckLibraryLoading}
        deckSummaries={deckSummaries}
        focusCreateDeck={focusCreateDeck}
        newDeckTitle={newDeckTitle}
        onCreateDeck={onCreateDeck}
        onCreateDeckFocusHandled={onCreateDeckFocusHandled}
        onGenerateRecentDeck={onGenerateRecentDeck}
        onNewDeckTitleChange={onNewDeckTitleChange}
        onTrainDeck={onTrainDeck}
        onTrainAll={onTrainAll}
        onRenameDeck={onRenameDeck}
        onDeleteDeck={onDeleteDeck}
        selectedDeckId={selectedDeckId}
      />
    );
  }

  return (
    <>
      <div className="flex w-full items-stretch gap-[8px]">
        <button
          className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(255,120,120,0.34)] bg-[rgba(120,28,28,0.18)] px-3.5 text-xs font-normal text-[#ffc8c6] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(255,120,120,0.52)] hover:bg-[rgba(120,28,28,0.28)] hover:text-[#ffe0df] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full min-w-0 self-stretch`}
          onClick={onBack}
          type="button"
        >
          Back
        </button>
      </div>
      <DeckPanel
        activeCard={activeCard}
        activeCardProgress={activeCardProgress}
        deckLineMastery={deckLineMastery}
        deckCounterSan={deckCounterSan}
        deckLoadError={deckLoadError}
        deckLoading={deckBusy}
        deckFeedback={deckFeedback}
        deckPlaybackBusy={deckPlaybackBusy}
        deckStats={deckStats}
        canDeleteCard={canDeleteCard}
        deleteCardLabel={deleteCardLabel}
        deckActionLoading={deckActionLoading}
        nextCard={nextCard}
        onDeleteCard={onDeleteCard}
        onNext={onNext}
        trainAllSession={trainAllSession}
        trainSessionCardCurrent={trainSessionCardCurrent}
        trainSessionCardTotal={trainSessionCardTotal}
      />
    </>
  );
}

export function TrainingProfilePanel({
  bootstrapping,
  error,
  submitting,
  password,
  setPassword,
  setUsername,
  username,
  onSubmit,
}: {
  bootstrapping: boolean;
  error: string;
  submitting: boolean;
  password: string;
  setPassword: (value: string) => void;
  setUsername: (value: string) => void;
  username: string;
  onSubmit: () => void;
}) {
  const profileBusy = bootstrapping || submitting;
  const statusText = bootstrapping ? 'syncing' : submitting ? 'signing in' : 'required';

  return (
    <section
      className={`relative min-h-0 rounded-xl border border-(--border-soft) bg-(--surface) p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg backdrop-saturate-[1.16] flex flex-[0_0_auto] flex-col gap-[18px] overflow-visible`}
    >
      <div className="min-w-0 flex items-center justify-between gap-[14px]">
        <h2 className="m-0 min-w-0 text-(--text) font-normal tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]">
          Training Profile
        </h2>
        <span className="text-[14px] leading-[1.45] text-(--text-muted)">{statusText}</span>
      </div>
      <form
        className="grid grid-cols-2 gap-[8px] grid-cols-1fr"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input
          className={`${'w-full min-w-0 box-border min-h-[42px] border border-solid border-(--border) rounded-[10px] bg-[rgba(7,12,20,0.72)] text-(--text) px-[12px] py-0 font-inherit outline-none border-[rgba(198,215,255,0.4)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.08)] text-(--text-soft)'} ${'col-span-full'}`}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoCorrect="off"
          disabled={profileBusy}
          name="training_profile_username"
          placeholder="username"
          spellCheck={false}
        />
        <input
          className={`${'w-full min-w-0 box-border min-h-[42px] border border-solid border-(--border) rounded-[10px] bg-[rgba(7,12,20,0.72)] text-(--text) px-[12px] py-0 font-inherit outline-none border-[rgba(198,215,255,0.4)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.08)] text-(--text-soft)'} ${'col-span-full'}`}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          disabled={profileBusy}
          name="training_profile_password"
          placeholder="password"
          type="password"
        />
        <button
          className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none col-span-full w-full`}
          disabled={profileBusy || username.trim().length < 3 || password.length < 4}
          type="submit"
        >
          {submitting ? 'Opening profile' : 'Open profile'}
        </button>
      </form>
      {error ? <p className="text-[14px] leading-[1.45] m-0 text-[#ffb4b2]">{error}</p> : null}
    </section>
  );
}

export function AnalyzePanel({
  currentFen,
  historyIndex,
  jumpToIndex,
  movePairs,
  positionAnalysis,
  positionLoading,
}: {
  currentFen: string;
  historyIndex: number;
  jumpToIndex: (index: number) => void;
  movePairs: Array<{
    moveNumber: number;
    white: StoredMove | null;
    whitePly: number;
    black: StoredMove | null;
    blackPly: number;
  }>;
  positionAnalysis: AnalysisResult | null;
  positionLoading: boolean;
}) {
  const engineLines = getDisplayEngineLines(positionAnalysis);

  return (
    <>
      {engineLines.length > 0 ? (
        <EngineLinesSection
          currentFen={currentFen}
          lines={engineLines}
          positionAnalysis={positionAnalysis}
          positionLoading={positionLoading}
        />
      ) : null}
      <section
        className={`relative min-h-0 rounded-xl border border-(--border-soft) bg-(--surface) p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg backdrop-saturate-[1.16]`}
      >
        <div className="min-w-0 flex items-center justify-between gap-[14px]">
          <h2 className="m-0 min-w-0 text-(--text) font-normal tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]">
            Line
          </h2>
          <span className="text-[14px] leading-[1.45] text-(--text-muted)">
            {movePairs.length ? `${movePairs.length} moves` : 'manual board'}
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto overflow-x-hidden rounded-xl border border-[rgba(214,226,244,0.12)] bg-[rgba(6,10,17,0.38)] pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {movePairs.length === 0 ? (
            <p className="text-[14px] leading-[1.45] text-(--text-muted) m-0">Play on the board or import a PGN.</p>
          ) : (
            <>
              <div
                className="grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-0 min-h-[30px] px-[10px] py-0 border-b border-b-[rgba(214,226,244,0.1)] bg-[rgba(255,255,255,0.03)] text-(--text-soft) text-[11px] font-normal"
                aria-hidden="true"
              >
                <span />
                <span>White</span>
                <span>Black</span>
              </div>
              {movePairs.map((pair) => (
                <div
                  className="grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)] gap-0 items-center min-h-[42px] px-[10px] py-0 border-b border-b-[rgba(214,226,244,0.07)] border-b-0"
                  key={pair.moveNumber}
                >
                  <span className="text-[14px] leading-[1.45] text-[13px] font-normal text-(--text-soft)">
                    {pair.moveNumber}.
                  </span>
                  <button
                    className={`${'min-w-0 min-h-[42px] grid grid-cols-[1.5em_0.72em_minmax(0,1fr)] items-center px-[12px] py-0 border-0 rounded-none bg-transparent text-(--text) text-[15px] font-normal text-left overflow-hidden text-ellipsis whitespace-nowrap shadow-[none] bg-[rgba(255,255,255,0.035)] op-34'} ${historyIndex === pair.whitePly ? 'bg-[rgba(198,215,255,0.14)] text-(--accent-strong) shadow-[inset_0_-2px_0_rgba(198,215,255,0.7)]' : ''}`}
                    onClick={() => jumpToIndex(pair.whitePly)}
                    type="button"
                  >
                    {pair.white ? renderMoveFigurine(pair.white.san) : '...'}
                  </button>
                  <button
                    className={`${'min-w-0 min-h-[42px] grid grid-cols-[1.5em_0.72em_minmax(0,1fr)] items-center px-[12px] py-0 border-0 rounded-none bg-transparent text-(--text) text-[15px] font-normal text-left overflow-hidden text-ellipsis whitespace-nowrap shadow-[none] bg-[rgba(255,255,255,0.035)] op-34'} ${historyIndex === pair.blackPly ? 'bg-[rgba(198,215,255,0.14)] text-(--accent-strong) shadow-[inset_0_-2px_0_rgba(198,215,255,0.7)]' : ''}`}
                    onClick={() => jumpToIndex(pair.blackPly)}
                    disabled={!pair.black}
                    type="button"
                  >
                    {pair.black ? renderMoveFigurine(pair.black.san) : ''}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </section>
    </>
  );
}

export function GameReviewPanel({
  activeReviewMoment,
  blackReviewName,
  chesscomUsername,
  goToReviewMoment,
  hasLoadedGame,
  historyIndex,
  jumpToIndex,
  loadRecentGame,
  movePairs,
  moveHistoryLength,
  onChesscomUsernameChange,
  onRecentGameTimeClassChange,
  onFetchRecentGames,
  onLoadMoreRecentGames,
  recentGames,
  recentGamesError,
  recentGamesHasMore,
  recentGamesLoading,
  recentGameTimeClass,
  reviewDeckSaveStatus,
  reviewMoments,
  reviewSaveMoveSan,
  positionLoading,
  canSaveReviewCard,
  deckSummaries,
  onSaveReviewCard,
  onGoCreateDeck,
  onSelectSaveDeck,
  selectedDeckId,
  setShowArrow,
  timelineAnalyses,
  timelineAnalysesLength,
  timelineError,
  timelineLoading,
  timelineProgress,
  timelineReviews,
  whiteReviewName,
}: {
  activeReviewMoment: ReturnType<typeof filterReviewMoments>[number] | null;
  blackReviewName: string;
  chesscomUsername: string;
  goToReviewMoment: (index: number) => void;
  hasLoadedGame: boolean;
  historyIndex: number;
  jumpToIndex: (index: number) => void;
  loadRecentGame: (game: ChessComRecentGameSummary) => void;
  movePairs: Array<{
    moveNumber: number;
    white: StoredMove | null;
    whitePly: number;
    black: StoredMove | null;
    blackPly: number;
  }>;
  moveHistoryLength: number;
  onChesscomUsernameChange: (value: string) => void;
  onRecentGameTimeClassChange: (value: ChessComRecentGameTimeClass) => void;
  onFetchRecentGames: () => void;
  onLoadMoreRecentGames: () => void;
  recentGames: ChessComRecentGameSummary[];
  recentGamesError: string;
  recentGamesHasMore: boolean;
  recentGamesLoading: boolean;
  recentGameTimeClass: ChessComRecentGameTimeClass;
  reviewDeckSaveStatus: string;
  reviewMoments: ReturnType<typeof filterReviewMoments>;
  reviewSaveMoveSan: string | null;
  positionLoading: boolean;
  canSaveReviewCard: boolean;
  deckSummaries: TrainingDeckSummary[];
  onSaveReviewCard: () => void;
  onGoCreateDeck: () => void;
  onSelectSaveDeck: (deckId: string) => void;
  selectedDeckId: string | null;
  setShowArrow: (value: boolean) => void;
  timelineAnalyses: AnalysisResult[];
  timelineAnalysesLength: number;
  timelineError: string;
  timelineLoading: boolean;
  timelineProgress: number | null;
  timelineReviews: TimelineReview[];
  whiteReviewName: string;
}) {
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  const activeRowRef = useRef<HTMLTableRowElement | null>(null);
  const currentReview = historyIndex > 0 ? (timelineReviews[historyIndex - 1] ?? null) : null;
  const activeMomentIsQueued =
    activeReviewMoment != null &&
    (historyIndex === Math.max(0, activeReviewMoment.ply - 1) || historyIndex === activeReviewMoment.ply);
  const coachReview = activeMomentIsQueued ? activeReviewMoment : (currentReview ?? activeReviewMoment);
  const coachBadgeSrc = coachReview ? getReviewBadgeSrc(coachReview) : null;
  const displayActivePly = activeMomentIsQueued && activeReviewMoment ? activeReviewMoment.ply : historyIndex;
  const nextMomentIndex = useMemo(
    () => reviewMoments.findIndex((moment) => moment.ply > historyIndex),
    [historyIndex, reviewMoments],
  );
  const hasNextReviewStep = nextMomentIndex >= 0 || historyIndex < moveHistoryLength;

  useLayoutEffect(() => {
    if (!hasLoadedGame) {
      return;
    }

    const scroller = historyScrollRef.current;
    if (!scroller) {
      return;
    }

    if (displayActivePly <= 0) {
      scroller.scrollTo({ top: 0 });
      return;
    }

    const activeRow = activeRowRef.current;
    if (!activeRow) {
      return;
    }

    const scrollTop = scroller.scrollTop + activeRow.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTo({ top: scrollTop });
  }, [displayActivePly, hasLoadedGame, historyIndex]);

  if (!hasLoadedGame) {
    return (
      <>
        <section
          className={`relative min-h-0 rounded-xl border border-(--border-soft) bg-(--surface) p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg backdrop-saturate-[1.16] flex flex-[0_0_auto] flex-col gap-[18px] overflow-visible`}
        >
          <div className="min-w-0 flex items-center justify-between gap-[14px]">
            <h2 className="m-0 min-w-0 text-(--text) font-normal tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]">
              Game Review
            </h2>
            <span className="text-[14px] leading-[1.45] text-(--text-muted)">
              {recentGamesLoading ? 'loading' : recentGames.length ? `${recentGames.length} games` : 'ready'}
            </span>
          </div>
          <p className="text-[14px] leading-[1.45] text-(--text-muted) m-0">
            Use your Chess.com username to pull recent public games.
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-[8px]">
            <input
              className="w-full min-w-0 box-border min-h-[42px] border border-solid border-(--border) rounded-[10px] bg-[rgba(7,12,20,0.72)] text-(--text) px-[12px] py-0 font-inherit outline-none border-[rgba(198,215,255,0.4)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.08)] text-(--text-soft)"
              value={chesscomUsername}
              onChange={(event) => onChesscomUsernameChange(event.target.value)}
              autoComplete="off"
              autoCorrect="off"
              name="chesscom_lookup_handle"
              placeholder=""
              spellCheck={false}
            />
            <button
              className="box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-(--border) bg-[rgba(9,14,23,0.38)] px-3.5 text-xs font-normal text-(--text) shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none"
              onClick={() => onChesscomUsernameChange('')}
              disabled={!chesscomUsername}
              type="button"
            >
              Clear
            </button>
            <button
              className={`${chesscomUsername.trim() && !recentGamesLoading ? 'box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(138,227,193,0.42)] bg-[rgba(56,148,115,0.28)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(138,227,193,0.58)] hover:bg-[rgba(56,148,115,0.38)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none col-span-full w-full' : 'box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-(--border) bg-[rgba(9,14,23,0.38)] px-3.5 text-xs font-normal text-(--text) shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none col-span-full w-full'}`}
              disabled={!chesscomUsername.trim() || recentGamesLoading}
              onClick={onFetchRecentGames}
              type="button"
            >
              {recentGamesLoading ? 'Loading' : 'Fetch games'}
            </button>
          </div>
          <div className="grid gap-[8px] grid-cols-3">
            {(['bullet', 'blitz', 'rapid'] as const).map((timeClass) => (
              <button
                className={`${recentGameTimeClass === timeClass ? 'box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full' : 'box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-(--border) bg-[rgba(9,14,23,0.38)] px-3.5 text-xs font-normal text-(--text) shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full'}`}
                key={timeClass}
                onClick={() => onRecentGameTimeClassChange(timeClass)}
                type="button"
              >
                {formatRecentGameTimeClassLabel(timeClass)}
              </button>
            ))}
          </div>
          {recentGamesError ? (
            <p className="text-[14px] leading-[1.45] m-0 text-[#ffb4b2]">{recentGamesError}</p>
          ) : null}
        </section>
        {recentGames.length ? (
          <section
            className={`relative min-h-0 rounded-xl border border-(--border-soft) bg-(--surface) p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg backdrop-saturate-[1.16] flex min-h-0 max-h-[calc(100svh-250px)] flex-[0_1_auto] flex-col gap-2.5`}
          >
            <div className="flex min-w-0 items-center justify-between gap-3.5">
              <h2 className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] font-normal leading-[1.15] tracking-normal text-(--text)">
                Recent {capitalizeRecentGameTimeClass(recentGameTimeClass)}
              </h2>
              <span className="text-sm leading-[1.45] text-(--text-muted)">click to review</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-[3px] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {recentGames.map((game) => (
                <button
                  className={`grid min-h-[44px] min-w-0 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[10px] border border-(--border) bg-[rgba(9,14,23,0.38)] px-3 py-2 text-[13px] text-(--text-muted) transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) ${
                    game.outcome === 'win'
                      ? 'border-[rgba(138,227,193,0.42)] bg-[rgba(56,148,115,0.12)] hover:border-[rgba(138,227,193,0.56)] hover:bg-[rgba(56,148,115,0.24)]'
                      : game.outcome === 'loss'
                        ? 'border-[rgba(255,141,145,0.42)] bg-[rgba(180,58,66,0.12)] hover:border-[rgba(255,141,145,0.56)] hover:bg-[rgba(180,58,66,0.24)]'
                        : 'border-[rgba(152,184,255,0.28)] hover:border-[rgba(152,184,255,0.44)] hover:bg-[rgba(46,58,82,0.34)]'
                  }`}
                  key={game.link}
                  onClick={() => loadRecentGame(game)}
                  type="button"
                >
                  <span className="justify-self-start text-left text-xs text-(--text-soft)">
                    {formatRecentGameAge(game)}
                  </span>
                  <strong className="min-w-0 justify-self-center truncate text-center text-[13px] text-(--text)">
                    {formatRecentGamePlayers(game)}
                  </strong>
                  <span className="justify-self-end text-right text-xs text-(--text-soft)">
                    {game.moveCount ? `${game.moveCount} moves` : '-'}
                  </span>
                </button>
              ))}
            </div>
            {recentGamesHasMore ? (
              <button
                className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-(--border) bg-[rgba(9,14,23,0.38)] px-3.5 text-xs font-normal text-(--text) shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full min-w-0 self-stretch`}
                onClick={onLoadMoreRecentGames}
                disabled={recentGamesLoading}
                type="button"
              >
                {recentGamesLoading ? 'Loading' : 'Load 10 more'}
              </button>
            ) : null}
          </section>
        ) : null}
      </>
    );
  }

  return (
    <section className="min-h-0 h-full grid grid-rows-[clamp(132px,16svh,148px)_minmax(0,1fr)_clamp(44px,8svh,62px)] gap-[10px] overflow-hidden">
      <div className="border border-solid border-[rgba(214,226,244,0.14)] rounded-[10px] bg-[rgba(8,12,19,0.78)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] min-h-0 flex flex-col gap-[7px] p-[9px] overflow-hidden">
        <div className="min-w-0 flex items-center justify-between gap-[14px] text-(--text) text-[15px] overflow-hidden text-ellipsis whitespace-nowrap">
          <div className="min-w-0 flex items-center gap-[8px] text-(--text) text-[15px] font-normal overflow-hidden text-ellipsis whitespace-nowrap">
            {coachBadgeSrc ? (
              <span
                aria-label={coachReview?.label ?? 'Review'}
                className="inline-block h-[17px] w-[17px] shrink-0 bg-contain bg-center bg-no-repeat drop-shadow-[0_2px_3px_rgba(0,0,0,0.28)]"
                style={{ backgroundImage: `url(${coachBadgeSrc})` }}
              />
            ) : coachReview ? null : (
              <span className="shrink-0 text-[11px] font-normal text-(--text-muted)">Review</span>
            )}
            <strong>{coachReview ? coachReview.moveLabel : `${whiteReviewName} vs ${blackReviewName}`}</strong>
          </div>
          <span className="text-[14px] leading-[1.45] text-(--text-muted)">
            {timelineLoading ? formatTimelineProgress(timelineProgress) : `${reviewMoments.length} moments`}
          </span>
        </div>
        {coachReview ? (
          <p className="m-0 min-h-[calc(12.5px*1.2*2)] text-(--text-muted) text-[12.5px] leading-[1.2] box line-clamp-2 [-webkit-box-orient:vertical] overflow-hidden">
            {compactCoachText(coachReview)}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-[8px] mt-auto min-h-[36px]">
          <button
            className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(138,227,193,0.42)] bg-[rgba(56,148,115,0.28)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(138,227,193,0.58)] hover:bg-[rgba(56,148,115,0.38)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none disabled:opacity-[0.42]`}
            onClick={() => {
              setShowArrow(true);
              if (coachReview) {
                jumpToIndex(Math.max(0, coachReview.ply - 1));
              }
            }}
            disabled={!coachReview?.bestMoveSan}
            type="button"
          >
            Show Best
          </button>
          <button
            className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none`}
            onClick={() => goToReviewMoment(nextMomentIndex >= 0 ? nextMomentIndex : reviewMoments.length)}
            disabled={!hasNextReviewStep}
            type="button"
          >
            Next
          </button>
        </div>
      </div>

      <div
        className="min-h-0 overflow-y-auto overflow-x-hidden px-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        ref={historyScrollRef}
      >
        <table className="w-full table-fixed border-collapse" aria-label="Reviewed moves">
          <tbody>
            {movePairs.map((pair) => {
              const isActiveRow = pair.whitePly === displayActivePly || pair.blackPly === displayActivePly;

              return (
                <tr
                  className="h-[38px] bg-[rgba(255,255,255,0.026)]"
                  key={pair.moveNumber}
                  ref={isActiveRow ? activeRowRef : undefined}
                >
                  <th
                    className="text-(--text-soft) text-[12px] font-normal text-right w-[34px] pt-0 pb-0 pl-[2px] pr-[8px] align-middle"
                    scope="row"
                  >
                    {pair.moveNumber}.
                  </th>
                  <ReviewMoveBadgeCell review={timelineReviews[pair.whitePly - 1] ?? null} />
                  <td className="p-0 align-middle">
                    <ReviewMoveButton
                      activePly={displayActivePly}
                      jumpToIndex={jumpToIndex}
                      move={pair.white}
                      ply={pair.whitePly}
                      review={timelineReviews[pair.whitePly - 1] ?? null}
                    />
                  </td>
                  <ReviewMoveBadgeCell review={timelineReviews[pair.blackPly - 1] ?? null} />
                  <td className="p-0 align-middle">
                    <ReviewMoveButton
                      activePly={displayActivePly}
                      jumpToIndex={jumpToIndex}
                      move={pair.black}
                      ply={pair.blackPly}
                      review={timelineReviews[pair.blackPly - 1] ?? null}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ReviewTimelineStrip
        historyIndex={historyIndex}
        jumpToIndex={jumpToIndex}
        moveHistoryLength={moveHistoryLength}
        timelineAnalyses={timelineAnalyses}
        timelineAnalysesLength={timelineAnalysesLength}
        timelineError={timelineError}
        timelineLoading={timelineLoading}
        timelineProgress={timelineProgress}
        timelineReviews={timelineReviews}
      />

      {hasLoadedGame ? (
        <ReviewSaveDeckPanel
          canSaveReviewCard={canSaveReviewCard}
          deckSummaries={deckSummaries}
          onGoCreateDeck={onGoCreateDeck}
          onSaveReviewCard={onSaveReviewCard}
          onSelectSaveDeck={onSelectSaveDeck}
          reviewDeckSaveStatus={reviewDeckSaveStatus}
          reviewSaveMoveSan={reviewSaveMoveSan}
          positionLoading={positionLoading}
          selectedDeckId={selectedDeckId}
        />
      ) : null}
    </section>
  );
}

function ReviewSaveDeckPanel({
  canSaveReviewCard,
  deckSummaries,
  onGoCreateDeck,
  onSaveReviewCard,
  onSelectSaveDeck,
  positionLoading,
  reviewDeckSaveStatus,
  reviewSaveMoveSan,
  selectedDeckId,
}: {
  canSaveReviewCard: boolean;
  deckSummaries: TrainingDeckSummary[];
  onGoCreateDeck: () => void;
  onSaveReviewCard: () => void;
  onSelectSaveDeck: (deckId: string) => void;
  positionLoading: boolean;
  reviewDeckSaveStatus: string;
  reviewSaveMoveSan: string | null;
  selectedDeckId: string | null;
}) {
  const ownedDecks = deckSummaries.filter((deck) => deck.isOwned);
  const hasOwnedDeck = ownedDecks.length > 0;
  const activeDeckId =
    selectedDeckId && ownedDecks.some((deck) => deck.id === selectedDeckId)
      ? selectedDeckId
      : (ownedDecks[0]?.id ?? '');
  const saveButtonLabel =
    reviewDeckSaveStatus === 'Saving' ? 'Adding' : reviewDeckSaveStatus === 'Saved' ? 'Added' : 'Add card';

  useEffect(() => {
    if (!hasOwnedDeck || !activeDeckId || activeDeckId === selectedDeckId) {
      return undefined;
    }

    onSelectSaveDeck(activeDeckId);

    return undefined;
  }, [activeDeckId, hasOwnedDeck, onSelectSaveDeck, selectedDeckId]);

  return (
    <section
      className={`relative min-h-0 rounded-xl border border-(--border-soft) bg-(--surface) p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg backdrop-saturate-[1.16] flex flex-[0_0_auto] flex-col gap-[18px] overflow-visible`}
    >
      {positionLoading ? (
        <p className="text-[14px] leading-[1.45] text-(--text-muted) m-0">
          Engine is finding the best move for this position.
        </p>
      ) : reviewSaveMoveSan ? (
        <p className="text-[14px] leading-[1.45] text-(--text-muted) m-0">
          Create a training card where the answer is{' '}
          <span className="inline-block rounded-[6px] border border-[rgba(138,227,193,0.38)] bg-[rgba(56,148,115,0.14)] px-[7px] py-px text-[11px] font-normal text-[#f8fbff]">
            {reviewSaveMoveSan}
          </span>
          .
        </p>
      ) : (
        <p className="text-[14px] leading-[1.45] text-(--text-muted) m-0">
          No best move is available for this position yet.
        </p>
      )}

      {hasOwnedDeck ? (
        <label className="flex flex-col gap-[6px] min-w-0">
          <span className="text-(--text-soft) text-[11px] font-normal">Target deck</span>
          <select
            className={`${'w-full min-w-0 box-border min-h-[42px] border border-solid border-(--border) rounded-[10px] bg-[rgba(7,12,20,0.72)] text-(--text) px-[12px] py-0 font-inherit outline-none border-[rgba(198,215,255,0.4)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.08)] text-(--text-soft)'} ${'appearance-none bg-[linear-gradient(45deg,transparent_50%,rgba(214,226,244,0.72)_50%),linear-gradient(135deg,rgba(214,226,244,0.72)_50%,transparent_50%)] bg-position-[calc(100%-18px)_calc(50%+2px),calc(100%-12px)_calc(50%+2px)] bg-size-[6px_6px,6px_6px] bg-no-repeat cursor-pointer pr-[34px] outline-none border-[rgba(198,215,255,0.42)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.12)]'}`}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => onSelectSaveDeck(event.target.value)}
            value={activeDeckId}
          >
            {ownedDecks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-[14px] leading-[1.45] text-(--text-muted) m-0">
          Create a personal deck in Train, then come back here to save this position.
        </p>
      )}

      {hasOwnedDeck ? (
        <button
          className={`${reviewDeckSaveStatus === 'Saved' ? 'box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(138,227,193,0.38)] bg-[rgba(56,148,115,0.14)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(138,227,193,0.52)] hover:bg-[rgba(56,148,115,0.22)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full min-w-0 self-stretch' : 'box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full min-w-0 self-stretch'}`}
          disabled={!canSaveReviewCard}
          onClick={onSaveReviewCard}
          type="button"
        >
          {saveButtonLabel}
        </button>
      ) : (
        <button
          className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full min-w-0 self-stretch`}
          onClick={onGoCreateDeck}
          type="button"
        >
          Create a deck
        </button>
      )}
    </section>
  );
}

function ReviewMoveButton({
  activePly,
  jumpToIndex,
  move,
  ply,
  review,
}: {
  activePly: number;
  jumpToIndex: (index: number) => void;
  move: StoredMove | null;
  ply: number;
  review: TimelineReview | null;
}) {
  if (!move) {
    return <span className="w-full min-w-0 min-h-[30px]" />;
  }

  const isActive = activePly === ply;
  const moveColor = getReviewMoveColor(review);

  return (
    <button
      className={`w-full min-w-0 min-h-[30px] relative inline-flex items-center justify-start gap-[6px] border border-solid border-transparent rounded-[7px] bg-transparent pt-0 pb-0 pl-[2px] pr-[8px] font-inherit text-[15px] font-normal text-left cursor-pointer text-(--text-muted) hover:bg-[rgba(255,255,255,0.06)] hover:text-(--text) ${isActive ? 'bg-[rgba(198,215,255,0.14)] text-(--text)' : ''}`}
      onClick={() => jumpToIndex(ply)}
      style={moveColor ? { color: moveColor } : undefined}
      type="button"
    >
      <span className="flex-[1_1_auto] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {renderMoveFigurine(move.san)}
      </span>
    </button>
  );
}

function ReviewMoveBadgeCell({ review }: { review: TimelineReview | null }) {
  const badgeSrc = getReviewBadgeSrc(review);

  return (
    <td className="w-[24px] p-0 text-center align-middle">
      {badgeSrc ? (
        <span
          aria-hidden="true"
          className="inline-block h-[17px] w-[17px] align-middle bg-contain bg-center bg-no-repeat drop-shadow-[0_2px_3px_rgba(0,0,0,0.28)] pointer-events-none"
          style={{ backgroundImage: `url(${badgeSrc})` }}
        />
      ) : null}
    </td>
  );
}

function ReviewTimelineStrip({
  historyIndex,
  jumpToIndex,
  moveHistoryLength,
  timelineAnalyses,
  timelineAnalysesLength,
  timelineError,
  timelineLoading,
  timelineProgress,
  timelineReviews,
}: {
  historyIndex: number;
  jumpToIndex: (index: number) => void;
  moveHistoryLength: number;
  timelineAnalyses: AnalysisResult[];
  timelineAnalysesLength: number;
  timelineError: string;
  timelineLoading: boolean;
  timelineProgress: number | null;
  timelineReviews: TimelineReview[];
}) {
  const scores = timelineAnalyses.map((analysis) => Math.max(-10, Math.min(10, toChartScore(analysis))));
  const pointCount = Math.max(1, scores.length);
  const cursorX =
    moveHistoryLength <= 1 ? 0 : ((Math.max(1, historyIndex) - 1) / Math.max(1, moveHistoryLength - 1)) * 100;
  const progressValue = getTimelineProgressValue(timelineProgress);
  const timelinePoints = scores.map((score, index) => {
    const x = pointCount <= 1 ? 0 : (index / (pointCount - 1)) * 100;
    const y = 14 - Math.tanh(score / 4) * 10.5;
    return { x, y };
  });
  const boundaryPath = timelinePoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const whiteAreaPath = timelinePoints.length
    ? `M 0 28 L ${timelinePoints.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')} L 100 28 Z`
    : '';
  const loadingAreaPath =
    'M 0 28 L 0 11.8 L 9 13.2 L 18 10.4 L 29 15.6 L 41 12.6 L 53 17.2 L 66 11.4 L 78 14.8 L 90 9.8 L 100 12.8 L 100 28 Z';
  const loadingBoundaryPath =
    'M 0 11.8 L 9 13.2 L 18 10.4 L 29 15.6 L 41 12.6 L 53 17.2 L 66 11.4 L 78 14.8 L 90 9.8 L 100 12.8';
  const hasTimeline = timelineAnalysesLength > 0;

  return (
    <div className="border border-solid border-[rgba(214,226,244,0.14)] rounded-[10px] bg-[rgba(8,12,19,0.78)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] relative min-h-0 p-0 overflow-hidden">
      <div
        className={`relative h-[62px] w-full min-h-0 overflow-hidden rounded-[10px] bg-[#3a3631] ${timelineLoading ? 'blur-[1.6px] saturate-[0.9] scale-[1.01]' : ''}`}
      >
        <svg
          className="block h-full w-full cursor-pointer overflow-hidden rounded-[7px]"
          viewBox="0 0 100 28"
          preserveAspectRatio="none"
          aria-label="Evaluation timeline"
        >
          <rect className="fill-[#3d3934] opacity-100" x="0" y="0" width="100" height="28" />
          <path className="fill-[#f5f2e8] opacity-[0.96]" d={hasTimeline ? whiteAreaPath : loadingAreaPath} />
          <line className="stroke-[rgba(245,242,232,0.22)] stroke-0.55" x1="0" x2="100" y1="14" y2="14" />
          <path
            className="fill-none stroke-[rgba(245,242,232,0.88)] [stroke-linecap:round] [stroke-linejoin:round] stroke-1.1 [vector-effect:non-scaling-stroke]"
            d={hasTimeline ? boundaryPath : loadingBoundaryPath}
          />
          <line
            className="stroke-[rgba(255,196,128,0.95)] stroke-1.4"
            x1={cursorX}
            x2={cursorX}
            y1="0"
            y2="28"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {hasTimeline
          ? timelineReviews.map((review) => {
              const dotColor = getReviewDotColor(review);

              if (!dotColor) {
                return null;
              }

              const point = timelinePoints[review.ply - 1] ?? { x: 0, y: 14 };

              return (
                <button
                  aria-label={`Go to ${review.moveLabel}`}
                  className="absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-[999px] border-0 p-0 shadow-none"
                  key={review.ply}
                  onClick={() => jumpToIndex(review.ply)}
                  style={{
                    backgroundColor: `color-mix(in srgb, ${dotColor} 62%, white)`,
                    left: `${point.x}%`,
                    top: `${(point.y / 28) * 100}%`,
                  }}
                  type="button"
                />
              );
            })
          : null}
      </div>
      {timelineLoading ? (
        <div
          className="absolute left-[12px] right-[12px] top-[50%] flex flex-col gap-[7px] px-[11px] py-[10px] border border-solid border-[rgba(245,242,232,0.18)] rounded-[9px] bg-[rgba(12,15,20,0.62)] shadow-[0_12px_34px_rgba(0,0,0,0.22)] translate-y-[-50%] backdrop-blur-[14px]"
          role="status"
          aria-label={`Analysis ${formatTimelineProgress(progressValue)}`}
        >
          <div className="flex items-center justify-between gap-[10px] text-[rgba(245,242,232,0.78)] text-[11px] font-normal text-[#f8f3e8] text-[13px] tracking-0">
            <span>Deep analysis</span>
            <strong>{formatTimelineProgress(progressValue)}</strong>
          </div>
          <div className="relative h-[8px] overflow-hidden rounded-[999px] bg-[rgba(245,242,232,0.12)]">
            <span
              className="absolute inset-[0_auto_0_0] min-w-[8px] rounded-[inherit] bg-gradient-linear bg-gradient-[90deg,#e65d55_0%,#f09a45_48%] shadow-[0_0_18px_rgba(240,154,69,0.34)] transition-width duration-180 ease-[ease]"
              style={{ width: `${progressValue}%` }}
            />
          </div>
        </div>
      ) : null}
      {!timelineLoading && timelineAnalysesLength === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-[rgba(13,17,24,0.7)] text-[12px] font-normal">
          No review yet.
        </div>
      ) : null}
      {timelineError ? (
        <span className="absolute left-[10px] right-[10px] bottom-[8px] text-(--danger) text-[11px] leading-[1.2] overflow-hidden text-ellipsis whitespace-nowrap">
          {timelineError}
        </span>
      ) : null}
    </div>
  );
}

function formatTimelineProgress(progress: number | null) {
  return `${getTimelineProgressValue(progress)}%`;
}

function getTimelineProgressValue(progress: number | null) {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(progress)));
}

function compactCoachText(review: TimelineReview) {
  if (review.category === 'book') {
    return `${review.moveLabel} stays in book.`;
  }

  if (review.category === 'best') {
    return `${review.moveLabel} matches the engine's top move.`;
  }

  if (
    (review.category === 'mistake' || review.category === 'blunder' || review.category === 'inaccuracy') &&
    review.bestMoveSan
  ) {
    return `${review.moveLabel} is ${review.label?.toLowerCase() ?? 'imprecise'}. Best was ${review.bestMoveSan}.`;
  }

  return review.coachText;
}

function getReviewDotColor(review: TimelineReview | null) {
  if (!review?.category) {
    return null;
  }

  if (!REVIEW_DOT_CATEGORIES.has(review.category)) {
    return null;
  }

  return review.colorHex ?? '#b8f7a1';
}

function getReviewMoveColor(review: TimelineReview | null) {
  if (!review?.category) {
    return null;
  }

  return review.colorHex ?? reviewCategoryMeta[review.category]?.color ?? null;
}

function getReviewBadgeSrc(review: TimelineReview | null) {
  if (!review?.category) {
    return null;
  }

  return reviewCategoryMeta[review.category]?.badge ?? null;
}

const REVIEW_DOT_CATEGORIES = new Set<ReviewCategory>([
  'brilliant',
  'great',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
]);

function formatRecentGamePlayers(game: ChessComRecentGameSummary) {
  const player = game.playerUsername ?? 'You';
  const opponent = game.opponentUsername ?? 'opponent';
  return game.playerColor === 'black' ? `${opponent} vs ${player}` : `${player} vs ${opponent}`;
}

function formatRecentGameAge(game: ChessComRecentGameSummary) {
  const playedAt = getRecentGameTime(game);

  if (!playedAt) {
    return 'recent';
  }

  const elapsedMs = Date.now() - playedAt.getTime();
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60_000));

  if (elapsedMinutes < 1) {
    return 'now';
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} min`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours} h`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);

  if (elapsedDays < 30) {
    return `${elapsedDays} d`;
  }

  const elapsedMonths = Math.floor(elapsedDays / 30);

  if (elapsedMonths < 12) {
    return `${elapsedMonths} mo`;
  }

  return `${Math.floor(elapsedMonths / 12)} y`;
}

function getRecentGameTime(game: ChessComRecentGameSummary) {
  if (typeof game.endTime === 'number') {
    return new Date(game.endTime * 1000);
  }

  if (game.utcDate) {
    const normalizedDate = game.utcDate.replaceAll('.', '-');
    const normalizedTime = game.utcTime ?? '00:00:00';
    const date = new Date(`${normalizedDate}T${normalizedTime}Z`);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

function capitalizeRecentGameTimeClass(value: ChessComRecentGameTimeClass) {
  if (value === 'all') {
    return 'Games';
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

const MASTERY_GRADE_ORDER: MasteryGrade[] = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];

function buildMasteryGradeDistribution(lines: ReturnType<typeof import('@/lib/deck-progress').summarizeLineMastery>) {
  const counts = new Map<MasteryGrade, number>();

  for (const grade of MASTERY_GRADE_ORDER) {
    counts.set(grade, 0);
  }

  for (const line of lines) {
    counts.set(line.grade, (counts.get(line.grade) ?? 0) + 1);
  }

  const total = lines.length;

  if (total === 0) {
    return [];
  }

  return MASTERY_GRADE_ORDER.flatMap((grade) => {
    const count = counts.get(grade) ?? 0;

    if (count === 0) {
      return [];
    }

    return [
      {
        grade,
        count,
        percent: Math.round((count / total) * 100),
      },
    ];
  });
}

function getMasteryGradeClass(grade: MasteryGrade) {
  return masteryGradeClassByGrade[grade];
}

function getMasteryToneClass(grade: MasteryGrade) {
  return masteryToneClassByGrade[grade];
}

function getOpeningDisplayName(card: DeckCard) {
  return getDeckCardOpeningGroup(card).name;
}

function formatNextReview(progress: DeckProgressEntry | null) {
  if (!progress || progress.seenCount === 0 || !progress.dueAt) {
    return 'not scheduled';
  }

  const due = Date.parse(progress.dueAt);
  const deltaMs = due - Date.now();

  if (!Number.isFinite(due) || deltaMs <= 0) {
    return 'due now';
  }

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (deltaMs < hour) {
    return `in ${Math.max(1, Math.round(deltaMs / minute))} min`;
  }

  if (deltaMs < day) {
    return `in ${Math.max(1, Math.round(deltaMs / hour))} h`;
  }

  return `in ${Math.max(1, Math.round(deltaMs / day))} d`;
}

function DeckLibraryItem({
  deck,
  deckActionLoading,
  deckBusy,
  isSelected,
  onDeleteDeck,
  onRenameDeck,
  onTrainDeck,
}: {
  deck: TrainingDeckSummary;
  deckActionLoading: boolean;
  deckBusy: boolean;
  isSelected: boolean;
  onDeleteDeck: (deckId: string) => void;
  onRenameDeck: (deckId: string, name: string) => void;
  onTrainDeck: (deckId: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const selectDisabled = deckBusy || deckActionLoading || deck.cardCount === 0;

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const closeMenu = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }

      setMenuOpen(false);
    };

    window.addEventListener('pointerdown', closeMenu);

    return () => {
      window.removeEventListener('pointerdown', closeMenu);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!renaming) {
      return undefined;
    }

    renameInputRef.current?.focus();
    renameInputRef.current?.select();

    return undefined;
  }, [renaming]);

  function startRename() {
    setMenuOpen(false);
    setRenameDraft(deck.name);
    setRenaming(true);
  }

  function cancelRename() {
    setRenaming(false);
    setRenameDraft(deck.name);
  }

  function submitRename() {
    const trimmedName = renameDraft.trim();

    if (!trimmedName) {
      cancelRename();
      return;
    }

    if (trimmedName !== deck.name) {
      onRenameDeck(deck.id, trimmedName);
    }

    setRenaming(false);
  }

  function handleDeleteDeck() {
    setMenuOpen(false);
    onDeleteDeck(deck.id);
  }

  return (
    <div className="relative min-w-0">
      <button
        aria-current={isSelected ? 'true' : undefined}
        className={`flex w-full min-w-0 flex-col gap-[9px] rounded-[10px] border py-[11px] pl-3 pr-11 text-left shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color] duration-150 disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) ${isSelected ? 'border-[rgba(198,215,255,0.58)] bg-[rgba(46,58,82,0.58)] text-(--text) shadow-[inset_0_0_0_1px_rgba(198,215,255,0.1)] hover:border-[rgba(198,215,255,0.72)] hover:bg-[rgba(52,68,98,0.66)]' : 'border-(--border) bg-[rgba(9,14,23,0.38)] text-(--text-muted) hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-(--text)'}`}
        disabled={selectDisabled}
        onClick={() => onTrainDeck(deck.id)}
        type="button"
      >
        <span className="flex min-w-0 items-center justify-between gap-2.5 [&_strong]:min-w-0 [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_strong]:text-sm [&_strong]:leading-[1.15] [&_strong]:text-(--text) [&_span]:text-[11px] text-(--text-soft)">
          {renaming ? (
            <input
              className={`${'w-full min-w-0 box-border min-h-[42px] border border-solid border-(--border) rounded-[10px] bg-[rgba(7,12,20,0.72)] text-(--text) px-[12px] py-0 font-inherit outline-none border-[rgba(198,215,255,0.4)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.08)] text-(--text-soft)'} ${'min-h-[34px] px-[10px] py-0 text-[14px] font-normal'}`}
              onBlur={submitRename}
              onChange={(event) => setRenameDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitRename();
                }

                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelRename();
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
              ref={renameInputRef}
              value={renameDraft}
            />
          ) : (
            <strong>{deck.name}</strong>
          )}
          <span>{deck.cardCount} cards</span>
        </span>
        <span className="flex min-w-0 items-center justify-between gap-2.5 [&_span]:whitespace-nowrap [&_span]:text-[11px] text-(--text-soft)">
          <span>{deck.newCount} new</span>
          <span>{deck.learningCount} learning</span>
          <span>{deck.dueCount} due</span>
        </span>
      </button>

      {deck.canManage ? (
        <div className="absolute top-2 right-2 z-2" ref={menuRef}>
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={`Deck options for ${deck.name}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-(--border) bg-[rgba(9,14,23,0.72)] text-(--text-muted) transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.82)] hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-45"
            disabled={deckBusy || deckActionLoading}
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((open) => !open);
            }}
            type="button"
          >
            <DeckMoreIcon />
          </button>

          {menuOpen ? (
            <div
              className="absolute top-[calc(100%+4px)] right-0 z-5 flex min-w-[148px] flex-col gap-1 rounded-[10px] border border-[rgba(214,226,244,0.18)] bg-[rgba(8,12,19,0.96)] p-1.5 shadow-[0_10px_28px_rgba(0,0,0,0.34)]"
              role="menu"
            >
              <button
                className="min-h-[34px] rounded-lg border border-transparent bg-transparent px-2.5 text-left text-xs text-(--text) transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.16)] hover:bg-[rgba(4,8,15,0.72)]"
                onClick={startRename}
                role="menuitem"
                type="button"
              >
                Rename
              </button>
              <button
                className="min-h-[34px] rounded-lg border border-transparent bg-transparent px-2.5 text-left text-xs text-[#ffc8c6] transition-[border-color,background-color,color] duration-150 hover:border-[rgba(255,120,120,0.28)] hover:bg-[rgba(120,28,28,0.22)] hover:text-[#ffe0df]"
                onClick={handleDeleteDeck}
                role="menuitem"
                type="button"
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DeckMoreIcon() {
  return (
    <svg className="w-[16px] h-[16px] block" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="19" cy="12" r="1.8" fill="currentColor" />
    </svg>
  );
}

export function LearnPanel({
  deckActionError,
  deckActionLoading,
  deckBusy,
  deckLibraryLoading,
  deckLoadError,
  deckSummaries,
  focusCreateDeck,
  newDeckTitle,
  onCreateDeck,
  onCreateDeckFocusHandled,
  onGenerateRecentDeck,
  onNewDeckTitleChange,
  onTrainDeck,
  onTrainAll,
  onRenameDeck,
  onDeleteDeck,
  selectedDeckId,
}: {
  deckActionError: string;
  deckActionLoading: boolean;
  deckBusy: boolean;
  deckLibraryLoading: boolean;
  deckLoadError: string;
  deckSummaries: TrainingDeckSummary[];
  focusCreateDeck: boolean;
  newDeckTitle: string;
  onCreateDeck: () => void;
  onCreateDeckFocusHandled: () => void;
  onGenerateRecentDeck: () => void;
  onNewDeckTitleChange: (value: string) => void;
  onTrainDeck: (deckId: string) => void;
  onTrainAll: () => void;
  onRenameDeck: (deckId: string, name: string) => void;
  onDeleteDeck: (deckId: string) => void;
  selectedDeckId: string | null;
}) {
  const createDeckInputRef = useRef<HTMLInputElement | null>(null);
  const createDeckSectionRef = useRef<HTMLElement | null>(null);
  const totalCardCount = deckSummaries.reduce((total, deck) => total + deck.cardCount, 0);
  const canTrainAll = totalCardCount > 0 && !deckBusy && !deckActionLoading;

  useEffect(() => {
    if (!focusCreateDeck) {
      return undefined;
    }

    createDeckSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    createDeckInputRef.current?.focus();
    createDeckInputRef.current?.select();
    const timer = window.setTimeout(() => onCreateDeckFocusHandled(), 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [focusCreateDeck, onCreateDeckFocusHandled]);

  return (
    <>
      <section
        className={`relative min-h-0 rounded-xl border border-(--border-soft) bg-(--surface) p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg backdrop-saturate-[1.16] flex flex-[0_0_auto] flex-col gap-[18px] overflow-visible`}
      >
        <div className="min-w-0 flex items-center justify-between gap-[14px]">
          <h2 className="m-0 min-w-0 text-(--text) font-normal tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]">
            Decks
          </h2>
          <span className="text-[14px] leading-[1.45] text-(--text-muted)">
            {deckLibraryLoading ? 'loading' : `${deckSummaries.length} decks`}
          </span>
        </div>
        {deckSummaries.length === 0 ? (
          <p className="text-[14px] leading-[1.45] text-(--text-muted) m-0">
            {deckLibraryLoading
              ? 'Loading decks.'
              : deckLoadError
                ? 'Learning setup is empty. Create a deck or reseed Supabase.'
                : 'Create a deck, then add cards from Review.'}
          </p>
        ) : (
          <div className="min-h-0 flex flex-col gap-[8px]">
            {deckSummaries.map((deck) => (
              <DeckLibraryItem
                deck={deck}
                deckActionLoading={deckActionLoading}
                deckBusy={deckBusy}
                isSelected={deck.id === selectedDeckId}
                key={deck.id}
                onDeleteDeck={onDeleteDeck}
                onRenameDeck={onRenameDeck}
                onTrainDeck={onTrainDeck}
              />
            ))}
          </div>
        )}
        {deckLoadError ? <p className="text-[14px] leading-[1.45] m-0 text-[#ffb4b2]">{deckLoadError}</p> : null}
        {deckSummaries.length > 0 ? (
          <button
            className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-(--border) bg-[rgba(9,14,23,0.38)] px-3.5 text-xs font-normal text-(--text) shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full min-w-0 self-stretch`}
            disabled={!canTrainAll}
            onClick={onTrainAll}
            type="button"
          >
            Cram all decks
          </button>
        ) : null}
      </section>
      <section
        className={`relative min-h-0 rounded-xl border border-(--border-soft) bg-(--surface) p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg backdrop-saturate-[1.16] flex flex-[0_0_auto] flex-col gap-[18px] overflow-visible ${focusCreateDeck ? 'border-[rgba(198,215,255,0.58)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_0_0_1px_rgba(198,215,255,0.14)]' : ''}`}
        ref={createDeckSectionRef}
      >
        <div className="min-w-0 flex items-center justify-between gap-[14px]">
          <h2 className="m-0 min-w-0 text-(--text) font-normal tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]">
            Create deck
          </h2>
          <span className="text-[14px] leading-[1.45] text-(--text-muted)">manual</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-[8px]">
          <input
            className="w-full min-w-0 box-border min-h-[42px] border border-solid border-(--border) rounded-[10px] bg-[rgba(7,12,20,0.72)] text-(--text) px-[12px] py-0 font-inherit outline-none border-[rgba(198,215,255,0.4)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.08)] text-(--text-soft)"
            onChange={(event) => onNewDeckTitleChange(event.target.value)}
            placeholder="Deck title"
            ref={createDeckInputRef}
            value={newDeckTitle}
          />
          <button
            className={`${newDeckTitle.trim() && !deckActionLoading ? 'box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(138,227,193,0.42)] bg-[rgba(56,148,115,0.28)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(138,227,193,0.58)] hover:bg-[rgba(56,148,115,0.38)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none col-span-full w-full' : 'box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-(--border) bg-[rgba(9,14,23,0.38)] px-3.5 text-xs font-normal text-(--text) shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none col-span-full w-full'}`}
            disabled={deckActionLoading || !newDeckTitle.trim()}
            onClick={onCreateDeck}
            type="button"
          >
            Create
          </button>
        </div>
      </section>
      <button
        className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full min-w-0 self-stretch`}
        onClick={onGenerateRecentDeck}
        disabled={deckActionLoading}
        type="button"
      >
        {deckActionLoading ? 'Generating' : 'Generate automatic deck your last 50 games'}
      </button>
      {deckActionError ? <p className="text-[14px] leading-[1.45] m-0 text-[#ffb4b2]">{deckActionError}</p> : null}
    </>
  );
}

export function DeckPanel({
  activeCard,
  activeCardProgress,
  deckCounterSan,
  deckLoadError,
  deckLoading,
  deckFeedback,
  deckPlaybackBusy,
  deckStats,
  canDeleteCard,
  deleteCardLabel,
  deckActionLoading,
  nextCard,
  onNext,
  onDeleteCard,
  trainAllSession,
  trainSessionCardCurrent,
  trainSessionCardTotal,
  deckLineMastery,
}: {
  activeCard: DeckCard | null;
  activeCardProgress: DeckProgressEntry | null;
  deckLineMastery: ReturnType<typeof import('@/lib/deck-progress').summarizeLineMastery>;
  deckCounterSan: string | null;
  deckLoadError: string;
  deckLoading: boolean;
  deckFeedback: DeckFeedback | null;
  deckPlaybackBusy: boolean;
  deckStats: DeckProgressSummary;
  canDeleteCard: boolean;
  deleteCardLabel: string;
  deckActionLoading: boolean;
  nextCard: DeckCard | null;
  onNext: () => void;
  onDeleteCard: () => void;
  trainAllSession: boolean;
  trainSessionCardCurrent: number;
  trainSessionCardTotal: number;
}) {
  const card = activeCard ?? nextCard;
  const sessionProgressPercent =
    trainSessionCardTotal > 0 ? Math.round((trainSessionCardCurrent / trainSessionCardTotal) * 100) : 0;
  const cardGrade = activeCardProgress ? getMasteryGrade(activeCardProgress) : 'F';
  const cardScore = activeCardProgress ? getEffectiveMasteryScore(activeCardProgress) : 0;
  const activeOpeningGroup = card ? getDeckCardOpeningGroup(card) : null;
  const activeLineMastery = activeOpeningGroup
    ? deckLineMastery.find((line) => line.id === activeOpeningGroup.id)
    : null;
  const gradeDistribution = useMemo(() => buildMasteryGradeDistribution(deckLineMastery), [deckLineMastery]);

  return (
    <>
      <section
        className={`relative min-h-0 rounded-xl border border-(--border-soft) bg-(--surface) p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg backdrop-saturate-[1.16] flex max-h-none flex-col gap-2.5 overflow-visible rounded-[10px] p-3 ${getMasteryToneClass(cardGrade)}`}
      >
        {card ? (
          <>
            <div className="flex items-center justify-between gap-[10px] min-w-0">
              <div className="flex min-w-0 flex-col gap-[4px]">
                <strong className="text-(--text) text-[16px] leading-[1.2] tracking-0 wrap-anywhere text-[15px] leading-[1.15]">
                  {getOpeningDisplayName(card)}
                </strong>
                <span className="text-(--text-muted) text-[11px] leading-[1.1] leading-[1.3]">Active card</span>
              </div>
              <span
                className={`${'inline-flex items-center justify-center min-w-[30px] h-[30px] rounded-[6px] text-[15px] font-normal tracking-0 min-w-[28px] h-[28px] text-[14px]'} ${getMasteryGradeClass(cardGrade)}`}
                title="Active card grade"
              >
                {cardGrade}
              </span>
            </div>
            <div
              className="w-full h-[6px] rounded-[999px] bg-[rgba(214,226,244,0.08)] overflow-hidden h-[5px]"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-[inherit] bg-[rgba(138,227,193,0.72)] transition-width duration-180 ease-[ease]"
                style={{ width: `${cardScore}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-[10px] text-(--text-soft) text-[12px] text-[11px] leading-[1.3]">
              <span>Card {cardScore}/100</span>
              <span>
                {trainAllSession
                  ? `${trainSessionCardCurrent}/${trainSessionCardTotal}`
                  : `${deckStats.due + deckStats.new} cards`}
              </span>
            </div>
            {trainAllSession ? (
              <div
                className="w-full h-[6px] rounded-[999px] bg-[rgba(214,226,244,0.08)] overflow-hidden h-[5px]"
                role="status"
                aria-label="Cram progress"
              >
                <div
                  className="h-full rounded-[inherit] bg-[rgba(138,227,193,0.72)] transition-width duration-180 ease-[ease]"
                  style={{ width: `${sessionProgressPercent}%` }}
                />
              </div>
            ) : null}
            {deckFeedback ? (
              <div
                className={`${'flex flex-col gap-[5px] rounded-[8px] px-[10px] py-[9px] text-[12px] text-(--text) text-(--text-muted) px-[10px] py-[8px] text-[11px] leading-[1.35] block overflow-visible'} ${deckFeedback.pending ? 'border border-solid border-[rgba(152,184,255,0.3)] bg-[rgba(9,14,23,0.42)]' : deckFeedback.correct ? 'border border-solid border-[rgba(138,227,193,0.38)] bg-[rgba(56,148,115,0.14)]' : 'border border-solid border-[rgba(255,141,145,0.42)] bg-[rgba(180,58,66,0.16)]'}`}
              >
                <strong>{deckFeedback.pending ? 'Checking eval' : deckFeedback.correct ? 'Best move' : 'Miss'}</strong>
                <span>
                  played {deckFeedback.playedSan} · best {deckFeedback.expectedSan}
                  {deckFeedback.evalLossCp != null ? ` · loss ${formatCpSwing(deckFeedback.evalLossCp)}` : ''}
                  {deckFeedback.maxEvalLossCp != null ? ` / ${formatCpSwing(deckFeedback.maxEvalLossCp)}` : ''}
                  {deckFeedback.scoreSwingCp != null ? ` · swing ${formatCpSwing(deckFeedback.scoreSwingCp)}` : ''}
                </span>
                {!deckFeedback.pending ? (
                  <span>
                    {trainAllSession
                      ? 'Cram only · grade unchanged'
                      : `${activeCardProgress ? `${getMasteryGrade(activeCardProgress)} · ${getEffectiveMasteryScore(activeCardProgress)}/100` : ''} · ${formatNextReview(activeCardProgress)}`}
                  </span>
                ) : null}
                {!deckFeedback.pending && !deckFeedback.correct && deckCounterSan ? (
                  <span>counter {deckCounterSan}</span>
                ) : null}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-[6px] min-h-[38px] px-[8px] py-0 text-[11px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-w-0 min-h-[34px] overflow-hidden text-ellipsis whitespace-nowrap">
              <button
                className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(255,120,120,0.34)] bg-[rgba(120,28,28,0.18)] px-3.5 text-xs font-normal text-[#ffc8c6] shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(255,120,120,0.52)] hover:bg-[rgba(120,28,28,0.28)] hover:text-[#ffe0df] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none`}
                disabled={!card || !canDeleteCard || deckActionLoading}
                onClick={onDeleteCard}
                type="button"
              >
                {deleteCardLabel}
              </button>
              <button
                className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none`}
                disabled={deckPlaybackBusy}
                onClick={onNext}
                type="button"
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[14px] leading-[1.45] text-(--text-muted) m-0">
              {deckLoading
                ? 'Loading learning cards from Supabase.'
                : trainAllSession
                  ? 'No cram cards loaded.'
                  : 'Nothing to study right now in this deck.'}
            </p>
            {deckLoadError ? <p className="text-[14px] leading-[1.45] m-0 text-[#ffb4b2]">{deckLoadError}</p> : null}
          </>
        )}
      </section>
      {!trainAllSession && activeLineMastery ? (
        <section
          className={`relative min-h-0 rounded-xl border border-(--border-soft) bg-(--surface) p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg backdrop-saturate-[1.16] flex flex-col gap-2.5 rounded-[10px] p-3 ${getMasteryToneClass(activeLineMastery.grade)}`}
        >
          <div className="flex items-center justify-between gap-[10px] min-w-0">
            <div className="flex min-w-0 flex-col gap-[4px]">
              <strong className="text-(--text) text-[13px] leading-[1.2]">Opening mastery</strong>
              <span className="text-(--text-muted) text-[11px] leading-tight wrap-anywhere">
                {activeLineMastery.cardCount} cards in {getOpeningDisplayName(card!)}
              </span>
            </div>
            <span
              className={`${'inline-flex items-center justify-center min-w-[30px] h-[30px] rounded-[6px] text-[15px] font-normal tracking-0 min-w-[28px] h-[28px] text-[14px]'} ${getMasteryGradeClass(activeLineMastery.grade)}`}
              title="Line metric grade"
            >
              {activeLineMastery.grade}
            </span>
          </div>
          <div
            className="w-full h-[6px] rounded-[999px] bg-[rgba(214,226,244,0.08)] overflow-hidden h-[5px]"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-[inherit] bg-[rgba(138,227,193,0.72)] transition-width duration-180 ease-[ease]"
              style={{ width: `${activeLineMastery.masteryScore}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-[10px] text-(--text-soft) text-[12px] text-[11px] leading-[1.3]">
            <span>Opening {activeLineMastery.masteryScore}/100</span>
            <span>{activeLineMastery.newCount + activeLineMastery.dueCount} due/new</span>
          </div>
        </section>
      ) : null}
      {!trainAllSession && gradeDistribution.length > 0 ? (
        <section
          className={`relative min-h-0 rounded-xl border border-(--border-soft) bg-(--surface) p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg backdrop-saturate-[1.16] flex flex-col gap-2.5 rounded-[10px] bg-[rgba(9,14,23,0.34)] p-3`}
        >
          <div className="flex items-center justify-between gap-[10px] text-(--text-soft) text-[12px] text-(--text-muted) text-[11px]">
            <span>Opening spread</span>
            <span>{deckLineMastery.length} openings</span>
          </div>
          <div
            aria-label={`Line metric spread: ${gradeDistribution.map((segment) => `${segment.grade} ${segment.percent}%`).join(', ')}`}
            className="flex w-full min-h-[12px] gap-[4px] rounded-[999px] p-[3px] bg-[rgba(214,226,244,0.07)]"
            role="img"
          >
            {gradeDistribution.map((segment) => (
              <div
                className={`${'min-w-[8px] rounded-[999px] transition-flex duration-220 ease-[ease]'} ${masteryDistributionClassByGrade[segment.grade]}`}
                key={segment.grade}
                style={{ flex: `${segment.count} ${segment.count} 0` }}
                title={`${segment.grade} · ${segment.count} line${segment.count === 1 ? '' : 's'} · ${segment.percent}%`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-8px 12px">
            {gradeDistribution.map((segment) => (
              <span
                className="inline-flex items-center gap-[6px] text-(--text-soft) text-[11px] text-(--text-muted)"
                key={segment.grade}
              >
                <span
                  className={`${'w-[8px] h-[8px] rounded-[50%] flex-[0_0_auto]'} ${masteryDistributionClassByGrade[segment.grade]}`}
                />
                <span>{segment.grade}</span>
                <span>{segment.percent}%</span>
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

export function PgnImportDialog({
  fileName,
  handlePgnPaste,
  handleUpload,
  onClose,
  pgnDraft,
  setPgnDraft,
}: {
  fileName: string;
  handlePgnPaste: () => void;
  handleUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
  pgnDraft: string;
  setPgnDraft: (value: string) => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop closes on click outside dialog
    <div
      className="fixed inset-0 z-20 flex items-center justify-center p-[18px] bg-[rgba(1,5,12,0.62)] backdrop-blur-[10px]"
      onMouseDown={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose();
        }
      }}
    >
      <section
        className="w-[min(680px,calc(100vw-36px))] max-h-min(720px,calc(100svh min-h-0 grid grid-rows-[auto_auto_minmax(220px,1fr)_auto] gap-[14px] overflow-hidden border border-solid border-(--border) rounded-[16px] bg-[rgba(12,18,29,0.9)] shadow-(--glass-shadow) p-[18px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pgn-import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="min-w-0 flex items-center justify-between gap-[14px]">
          <div>
            <h2
              className="m-0 min-w-0 text-(--text) font-normal tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]"
              id="pgn-import-title"
            >
              Import PGN
            </h2>
            <p className="text-[14px] leading-[1.45] text-(--text-muted) m-0 text-(--text) font-normal">
              Use this only when you want full-game review.
            </p>
          </div>
          <button
            className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-(--border) bg-[rgba(9,14,23,0.38)] p-0 font-normal text-(--text) shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none"
            onClick={onClose}
            title="Close import"
            type="button"
          >
            X
          </button>
        </div>
        <div className="grid gap-[8px] grid-cols-2 grid-cols-1fr">
          <label
            className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-[rgba(198,215,255,0.38)] bg-[rgba(39,51,75,0.72)] px-3.5 text-xs font-normal text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none`}
            htmlFor="pgn-upload"
          >
            Load file
          </label>
          <button
            className={`box-border flex min-h-[42px] items-center justify-center rounded-[10px] border border-(--border) bg-[rgba(9,14,23,0.38)] px-3.5 text-xs font-normal text-(--text) shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none w-full`}
            onClick={() => void handlePgnPaste()}
            disabled={!pgnDraft.trim()}
            type="button"
          >
            Paste PGN
          </button>
        </div>
        <input className="hidden" id="pgn-upload" type="file" accept=".pgn" onChange={handleUpload} />
        <textarea
          className="box-border h-full min-h-0 w-full resize-none overflow-auto rounded-[10px] border border-(--border) bg-[rgba(7,12,20,0.72)] p-3 font-mono text-xs leading-[1.55] text-(--text) outline-none focus:border-(--accent) focus:shadow-[0_0_0_3px_rgba(152,184,255,0.16)] placeholder:text-(--text-disabled) [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          value={pgnDraft}
          onChange={(event) => setPgnDraft(event.target.value)}
          placeholder={'[Event "Live Chess"]\n[White "LosValettos"]\n[Black "rafaelpiresrj"]\n\n1. e4 e5 2. Nf3 Nc6'}
          spellCheck={false}
        />
        <p className="text-[14px] leading-[1.45] text-(--text-muted) m-0 text-(--text) font-normal">
          {fileName || 'No PGN loaded'}
        </p>
      </section>
    </div>
  );
}

function EngineLinesSection({
  currentFen,
  lines,
  positionAnalysis,
  positionLoading,
}: {
  currentFen: string;
  lines: AnalysisLine[];
  positionAnalysis: AnalysisResult | null;
  positionLoading: boolean;
}) {
  return (
    <section
      className={`relative min-h-0 rounded-xl border border-(--border-soft) bg-(--surface) p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg backdrop-saturate-[1.16]`}
    >
      <div className="min-w-0 flex items-center justify-between gap-[14px]">
        <h2 className="m-0 min-w-0 text-(--text) font-normal tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]">
          Engine
        </h2>
        <span className="text-[14px] leading-[1.45] text-(--text-muted)">
          {positionLoading ? 'updating' : `depth ${positionAnalysis?.depth ?? '--'}`}
        </span>
      </div>
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto overflow-x-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {lines.map((line) => (
          <div
            className="border border-solid border-[rgba(214,226,244,0.16)] rounded-[8px] bg-[rgba(7,12,20,0.44)] p-[10px]"
            key={line.multipv}
          >
            <div className="min-w-0 flex items-center justify-between gap-[14px] grid grid-cols-[auto_minmax(0,1fr)_auto] text-(--text-muted) text-[13px] gap-[10px] text-(--text) text-[16px] overflow-hidden text-ellipsis whitespace-nowrap">
              <span className="text-(--accent-strong) font-normal">#{line.multipv}</span>
              <strong>{line.bestMove ? formatBestMove(currentFen, line.bestMove) : '--'}</strong>
              <span>{formatLineScore(line)}</span>
            </div>
            <p className="mx-0 mt-[8px] mb-0 text-(--text-muted) text-[12px] leading-[1.45] whitespace-nowrap overflow-hidden text-ellipsis">
              {formatPvLine(currentFen, line.pv)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function getDisplayEngineLines(positionAnalysis: AnalysisResult | null) {
  if (!positionAnalysis || positionAnalysis.depth <= 0) {
    return [];
  }

  return (positionAnalysis.lines ?? []).filter((line) => Boolean(line.bestMove) || line.pv.length > 0).slice(0, 3);
}

function formatCpSwing(value: number) {
  return `${(value / 100).toFixed(2)} pawns`;
}

function formatLineScore(line: AnalysisLine) {
  const score = line.whitePerspective;

  if (!score) {
    return '--';
  }

  if (score.type === 'mate') {
    return score.value > 0 ? `#${score.value}` : `-#${Math.abs(score.value)}`;
  }

  const pawns = score.value / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

function formatPvLine(fen: string, pv: string[]) {
  if (pv.length === 0) {
    return 'No principal variation yet.';
  }

  const line = formatPrincipalVariation(fen, pv);

  if (line === 'No principal variation yet.') {
    return line;
  }

  return formatMoveFigurine(line).replaceAll(' ', '  →  ');
}

function formatMoveFigurine(san: string) {
  const pieces: Record<string, string> = {
    K: '♔',
    Q: '♕',
    R: '♖',
    B: '♗',
    N: '♘',
  };

  return san.replace(/^[KQRBN]/, (piece) => pieces[piece] ?? piece);
}

function renderMoveFigurine(san: string): ReactNode {
  const pieces: Record<string, string> = {
    K: '♔',
    Q: '♕',
    R: '♖',
    B: '♗',
    N: '♘',
  };

  const pieceCode = san[0] ?? '';
  const icon = pieces[pieceCode];

  if (!icon) {
    return <>{san}</>;
  }

  return (
    <>
      <span className="text-[1.95em] leading-none text-center">{icon}</span>
      <span className="w-[0.72em]" aria-hidden="true" />
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{san.slice(1)}</span>
    </>
  );
}
