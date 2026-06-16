'use client';

import {
  Background,
  type Edge,
  type Node as FlowNode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import dagre from 'dagre';
import { type ChangeEvent, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import styles from './chess-analysis-lab.module.css';
import '@xyflow/react/dist/style.css';

function OpeningTreeGraphAutoFollow({ activeNodeId }: { activeNodeId: string | null }) {
  const { setCenter, getNode } = useReactFlow();

  useEffect(() => {
    if (activeNodeId) {
      const node = getNode(activeNodeId);
      if (node?.position) {
        requestAnimationFrame(() => {
          setCenter(node.position.x + (node.width ?? 156) / 2, node.position.y + (node.height ?? 58) / 2, {
            duration: 800,
            zoom: 1.2,
          });
        });
      }
    }
  }, [activeNodeId, getNode, setCenter]);

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
  formatOpeningTreeDisplayName,
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

export function LinesPanel({
  actionError,
  actionLoading,
  activeNodeId,
  activeTree,
  activeTreeId,
  deckFeedback,
  drillActive,
  expectedSan: _expectedSan,
  loading,
  onImportRecent,
  onSelectNode,
  onSelectTree,
  onStartDrill: _onStartDrill,
  trainSide,
  onChangeTrainSide,
  undoMove: _undoMove,
  trees,
  minForcedPlies,
  setMinForcedPlies,
  minNodes,
  setMinNodes,
  minDepth,
  setMinDepth,
}: {
  actionError: string;
  actionLoading: boolean;
  activeNodeId: string | null;
  activeTree: OpeningTreeDetail | null;
  activeTreeId: string | null;
  deckFeedback: DeckFeedback | null;
  drillActive: boolean;
  expectedSan: string | null;
  loading: boolean;
  onImportRecent: () => void;
  onSelectNode: (nodeId: string) => void;
  onSelectTree: (treeId: string) => void;
  onStartDrill: () => void;
  trainSide: 'white' | 'black';
  onChangeTrainSide: (side: 'white' | 'black') => void;
  undoMove: () => void;
  trees: OpeningTreeSummary[];
  minForcedPlies: number;
  setMinForcedPlies: (v: number) => void;
  minNodes: number;
  setMinNodes: (v: number) => void;
  minDepth: number;
  setMinDepth: (v: number) => void;
}) {
  const filteredTrees = useMemo(
    () => trees.filter((tree) => tree.nodeCount >= minNodes && tree.targetDepth >= minDepth),
    [trees, minNodes, minDepth],
  );
  const groupedTrees = useMemo(() => groupOpeningTrees(filteredTrees), [filteredTrees]);
  const _selectedNode = useMemo(
    () => activeTree?.nodes.find((node) => node.id === activeNodeId) ?? null,
    [activeNodeId, activeTree],
  );
  const graph = useMemo(
    () => buildOpeningTreeGraph(activeTree, activeNodeId, trainSide, onSelectNode, drillActive),
    [activeTree, activeNodeId, trainSide, onSelectNode, drillActive],
  );

  return (
    <>
      {!activeTree ? (
        <section className={`${styles.card} ${styles.emptyStateCard}`}>
          <div className={styles.panelHeader}>
            <h2 className={styles.sectionTitle}>Lines</h2>
            <span className={styles.statusText}>{loading ? 'loading' : `${trees.length} openings`}</span>
          </div>
          {trees.length === 0 ? (
            <p className={styles.copy}>
              Import your recent games to build opening trees grouped by the position after 4 plies.
            </p>
          ) : (
            <div className={styles.linesLibrary}>
              <div className={styles.linesFilters}>
                <label className={styles.linesFilterItem}>
                  <span className={styles.linesFilterLabel}>Min forced plies (X)</span>
                  <input
                    className={styles.linesFilterInput}
                    id="filter-min-forced-plies"
                    min={1}
                    onChange={(event) => setMinForcedPlies(Math.max(1, Number(event.target.value) || 1))}
                    type="number"
                    value={minForcedPlies}
                  />
                </label>
                <label className={styles.linesFilterItem}>
                  <span className={styles.linesFilterLabel}>Min nodes</span>
                  <input
                    className={styles.linesFilterInput}
                    id="filter-min-nodes"
                    min={0}
                    onChange={(event) => setMinNodes(Math.max(0, Number(event.target.value) || 0))}
                    type="number"
                    value={minNodes}
                  />
                </label>
                <label className={styles.linesFilterItem}>
                  <span className={styles.linesFilterLabel}>Min depth</span>
                  <input
                    className={styles.linesFilterInput}
                    id="filter-min-depth"
                    min={0}
                    onChange={(event) => setMinDepth(Math.max(0, Number(event.target.value) || 0))}
                    type="number"
                    value={minDepth}
                  />
                </label>
              </div>
              <span className={styles.linesFilterCount}>
                {filteredTrees.length} / {trees.length} openings
              </span>
              {OPENING_LIBRARY_ORDER.map((library) => {
                const libraryTrees = groupedTrees.get(library) ?? [];

                if (libraryTrees.length === 0) {
                  return null;
                }

                return (
                  <section className={styles.linesLibraryGroup} key={library}>
                    <h3 className={styles.linesLibraryTitle}>{formatOpeningLibrary(library)}</h3>
                    <div className={styles.openingTreeList}>
                      {libraryTrees.map((tree) => (
                        <button
                          className={`${styles.openingTreeItem} ${tree.id === activeTreeId ? styles.openingTreeItemActive : ''}`}
                          key={tree.id}
                          onClick={() => onSelectTree(tree.id)}
                          type="button"
                        >
                          <span className={styles.openingTreeItemHead}>
                            <strong>{formatOpeningTreeDisplayName(tree.name)}</strong>
                            <span className={styles.openingTreeMastery}>{tree.masteryScore}/100</span>
                          </span>
                          <span className={styles.openingTreeItemRoot}>
                            {tree.rootSan.join(' ') || 'Starting position'}
                          </span>
                          <span className={styles.openingTreeItemStats}>
                            <span>{tree.sourceCount} sources</span>
                            <span>{tree.nodeCount} nodes</span>
                            <span>{tree.dueCount} weak</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          <button
            className={`${styles.action} ${styles.primary} ${styles.fullWidthAction}`}
            disabled={actionLoading}
            onClick={onImportRecent}
            type="button"
          >
            {actionLoading ? 'Loading...' : 'Refresh opening trees'}
          </button>
          {actionError ? <p className={styles.error}>{actionError}</p> : null}
        </section>
      ) : null}

      {activeTree ? (
        <>
          <div className={styles.trainBackRow}>
            <button
              className={`${styles.action} ${styles.fullWidthAction} ${styles.backAction}`}
              onClick={() => onSelectTree('')}
              type="button"
            >
              Back
            </button>
          </div>
          <div className={styles.trainBackRow} style={{ marginTop: '-4px' }}>
            <button
              className={`${styles.action} ${styles.fullWidthAction} ${trainSide === 'white' ? styles.primary : ''}`}
              onClick={() => onChangeTrainSide('white')}
              type="button"
            >
              White
            </button>
            <button
              className={`${styles.action} ${styles.fullWidthAction} ${trainSide === 'black' ? styles.primary : ''}`}
              onClick={() => onChangeTrainSide('black')}
              type="button"
            >
              Black
            </button>
          </div>

          <section
            className={`${styles.card} ${styles.openingTreeCard} ${drillActive ? (deckFeedback?.correct ? styles.feedbackGood : deckFeedback?.pending === false ? styles.feedbackBad : styles.feedbackPending) : ''}`}
          >
            <div className={styles.trainingCardHead}>
              <div className={styles.trainingCardTitleBlock}>
                <strong className={styles.trainingCardTitle}>{formatOpeningTreeDisplayName(activeTree.name)}</strong>
              </div>
            </div>

            <div className={styles.trainingCardMeta}>
              <span>depth {activeTree.targetDepth}</span>
              <span>{activeTree.nodeCount} nodes</span>
              <span>{activeTree.dueCount} weak</span>
            </div>

            <div className={styles.openingTreeCanvas}>
              <ReactFlowProvider key={activeTreeId ?? 'none'}>
                <ReactFlow
                  edges={graph.edges}
                  fitView
                  fitViewOptions={{ padding: 0.5 }}
                  minZoom={0.25}
                  nodes={graph.nodes}
                  nodesDraggable={false}
                  panOnDrag
                  selectNodesOnDrag={false}
                  zoomOnScroll={false}
                  panOnScroll={false}
                  zoomOnDoubleClick={false}
                  nodesConnectable={false}
                  onNodeClick={(_, node) => onSelectNode(node.id)}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background />
                  <OpeningTreeGraphAutoFollow activeNodeId={activeNodeId} />
                </ReactFlow>
              </ReactFlowProvider>
            </div>
          </section>
        </>
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

function buildOpeningTreeGraph(
  tree: OpeningTreeDetail | null,
  activeNodeId: string | null,
  trainSide: 'white' | 'black',
  onSelectNode: (nodeId: string) => void,
  drillActive = false,
) {
  if (!tree) {
    return { nodes: [], edges: [] } satisfies { nodes: FlowNode[]; edges: Edge[] };
  }

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'TB', nodesep: 32, ranksep: 64 });

  for (const node of tree.nodes) {
    graph.setNode(node.id, { width: 156, height: 58 });
  }

  for (const edge of tree.edges) {
    graph.setEdge(edge.fromNodeId, edge.toNodeId);
  }

  dagre.layout(graph);

  const nodes = tree.nodes.map((node) => {
    const point = graph.node(node.id) ?? { x: 0, y: 0 };
    const isActive = node.id === activeNodeId;
    const isTrainTurn = node.sideToMove === trainSide;
    const isWeak = node.masteryScore < 60 && isTrainTurn;
    const showAnswer = isTrainTurn && node.bestSan && !drillActive;

    return {
      id: node.id,
      position: { x: point.x - 78, y: point.y - 29 },
      data: {
        label: (
          <button className={styles.openingTreeNodeButton} onClick={() => onSelectNode(node.id)} type="button">
            <strong>{isTrainTurn && showAnswer ? `Best: ${node.bestSan}` : `Ply ${node.ply}`}</strong>
            <span>{isTrainTurn ? `${node.masteryScore}/100` : 'Opponent'}</span>
          </button>
        ),
      },
      draggable: false,
      className: [
        styles.openingTreeNode,
        isActive ? styles.openingTreeNodeActive : '',
        isTrainTurn ? styles.openingTreeNodeTrain : styles.openingTreeNodeOpponent,
        isWeak ? styles.openingTreeNodeWeak : '',
      ]
        .filter(Boolean)
        .join(' '),
      type: 'default',
    } satisfies FlowNode;
  });
  const edges = tree.edges.map(
    (edge) =>
      ({
        id: edge.id,
        source: edge.fromNodeId,
        target: edge.toNodeId,
        animated: edge.isEngineBest,
        label: edge.san,
        className: edge.isEngineBest ? styles.openingTreeEdgeBest : undefined,
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 6,
        labelShowBg: true,
      }) satisfies Edge,
  );

  return { nodes, edges };
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
          className={`${styles.action} ${styles.fullWidthAction} ${styles.backAction}`}
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
          className={`${styles.action} ${styles.fullWidthAction} ${styles.backAction}`}
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
      className={`${'min-h-0 relative border-[1px] border-solid border-[var(--border-soft)] rounded-[12px] bg-[var(--surface)] p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-16px) saturate(1.16'} ${'flex flex-col gap-[13px] flex-[0_0_auto] gap-[18px] overflow-visible gap-[16px]'}`}
    >
      <div className="min-w-0 flex items-center justify-between gap-[14px]">
        <h2 className="m-0 min-w-0 text-[var(--text)] font-[weight:560] tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]">
          Training Profile
        </h2>
        <span className="text-[14px] leading-[1.45] text-[var(--text-muted)]">{statusText}</span>
      </div>
      <form
        className="grid grid-cols-2 gap-[8px] grid-cols-1fr"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input
          className={`${'w-full min-w-0 box-border min-h-[42px] border-[1px] border-solid border-[var(--border)] rounded-[10px] bg-[rgba(7,12,20,0.72)] text-[var(--text)] px-[12px] py-0 font-inherit outline-none border-[rgba(198,215,255,0.4)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.08)] text-[var(--text-soft)]'} ${'col-span-full'}`}
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
          className={`${'w-full min-w-0 box-border min-h-[42px] border-[1px] border-solid border-[var(--border)] rounded-[10px] bg-[rgba(7,12,20,0.72)] text-[var(--text)] px-[12px] py-0 font-inherit outline-none border-[rgba(198,215,255,0.4)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.08)] text-[var(--text-soft)]'} ${'col-span-full'}`}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          disabled={profileBusy}
          name="training_profile_password"
          placeholder="password"
          type="password"
        />
        <button
          className={`${styles.action} ${styles.primary} ${styles.profileFormWide}`}
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
        className={`${'min-h-0 relative border-[1px] border-solid border-[var(--border-soft)] rounded-[12px] bg-[var(--surface)] p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-16px) saturate(1.16'} ${'flex flex-col gap-[13px] flex-[0_0_auto]'}`}
      >
        <div className="min-w-0 flex items-center justify-between gap-[14px]">
          <h2 className="m-0 min-w-0 text-[var(--text)] font-[weight:560] tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]">
            Line
          </h2>
          <span className="text-[14px] leading-[1.45] text-[var(--text-muted)]">
            {movePairs.length ? `${movePairs.length} moves` : 'manual board'}
          </span>
        </div>
        <div className={styles.moveList}>
          {movePairs.length === 0 ? (
            <p className="text-[14px] leading-[1.45] text-[var(--text-muted)] m-0">
              Play on the board or import a PGN.
            </p>
          ) : (
            <>
              <div
                className="grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-0 min-h-[30px] px-[10px] py-0 border-b-[1px] border-b-[rgba(214,226,244,0.1)] bg-[rgba(255,255,255,0.03)] text-[var(--text-soft)] text-[11px] font-[weight:400] tracking-[0.08em] uppercase"
                aria-hidden="true"
              >
                <span />
                <span>White</span>
                <span>Black</span>
              </div>
              {movePairs.map((pair) => (
                <div
                  className="grid grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)] gap-0 items-center min-h-[42px] px-[10px] py-0 border-b-[1px] border-b-[rgba(214,226,244,0.07)] border-b-0"
                  key={pair.moveNumber}
                >
                  <span className="text-[14px] leading-[1.45] text-[13px] font-[weight:400] text-[var(--text-soft)]">
                    {pair.moveNumber}.
                  </span>
                  <button
                    className={`${'min-w-0 min-h-[42px] grid grid-cols-[1.5em_0.72em_minmax(0,1fr)] items-center px-[12px] py-0 border-0 rounded-[0] bg-transparent text-[var(--text)] text-[15px] font-[weight:650] text-left overflow-hidden text-ellipsis whitespace-nowrap shadow-[none] bg-[rgba(255,255,255,0.035)] op-34'} ${historyIndex === pair.whitePly ? 'bg-[rgba(198,215,255,0.14)] text-[var(--accent-strong)] shadow-[inset_0_-2px_0_rgba(198,215,255,0.7)]' : ''}`}
                    onClick={() => jumpToIndex(pair.whitePly)}
                    type="button"
                  >
                    {pair.white ? renderMoveFigurine(pair.white.san) : '...'}
                  </button>
                  <button
                    className={`${'min-w-0 min-h-[42px] grid grid-cols-[1.5em_0.72em_minmax(0,1fr)] items-center px-[12px] py-0 border-0 rounded-[0] bg-transparent text-[var(--text)] text-[15px] font-[weight:650] text-left overflow-hidden text-ellipsis whitespace-nowrap shadow-[none] bg-[rgba(255,255,255,0.035)] op-34'} ${historyIndex === pair.blackPly ? 'bg-[rgba(198,215,255,0.14)] text-[var(--accent-strong)] shadow-[inset_0_-2px_0_rgba(198,215,255,0.7)]' : ''}`}
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
  const activeMoveButtonRef = useRef<HTMLButtonElement | null>(null);
  const currentReview = historyIndex > 0 ? (timelineReviews[historyIndex - 1] ?? null) : null;
  const activeMomentIsQueued =
    activeReviewMoment != null &&
    (historyIndex === Math.max(0, activeReviewMoment.ply - 1) || historyIndex === activeReviewMoment.ply);
  const coachReview = activeMomentIsQueued ? activeReviewMoment : (currentReview ?? activeReviewMoment);
  const displayActivePly = activeMomentIsQueued && activeReviewMoment ? activeReviewMoment.ply : historyIndex;
  const nextMomentIndex = useMemo(
    () => reviewMoments.findIndex((moment) => moment.ply > historyIndex),
    [historyIndex, reviewMoments],
  );
  const hasNextReviewStep = nextMomentIndex >= 0 || historyIndex < moveHistoryLength;

  useEffect(() => {
    if (!hasLoadedGame) {
      return;
    }

    activeMoveButtonRef.current?.scrollIntoView({ block: 'start', inline: 'nearest' });
  }, [hasLoadedGame]);

  if (!hasLoadedGame) {
    return (
      <>
        <section
          className={`${'min-h-0 relative border-[1px] border-solid border-[var(--border-soft)] rounded-[12px] bg-[var(--surface)] p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-16px) saturate(1.16'} ${'flex flex-col gap-[13px] flex-[0_0_auto] gap-[18px] overflow-visible gap-[16px]'}`}
        >
          <div className="min-w-0 flex items-center justify-between gap-[14px]">
            <h2 className="m-0 min-w-0 text-[var(--text)] font-[weight:560] tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]">
              Game Review
            </h2>
            <span className="text-[14px] leading-[1.45] text-[var(--text-muted)]">
              {recentGamesLoading ? 'loading' : recentGames.length ? `${recentGames.length} games` : 'ready'}
            </span>
          </div>
          <p className="text-[14px] leading-[1.45] text-[var(--text-muted)] m-0">
            Use your Chess.com username to pull recent public games.
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-[8px]">
            <input
              className="w-full min-w-0 box-border min-h-[42px] border-[1px] border-solid border-[var(--border)] rounded-[10px] bg-[rgba(7,12,20,0.72)] text-[var(--text)] px-[12px] py-0 font-inherit outline-none border-[rgba(198,215,255,0.4)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.08)] text-[var(--text-soft)]"
              value={chesscomUsername}
              onChange={(event) => onChesscomUsernameChange(event.target.value)}
              autoComplete="off"
              autoCorrect="off"
              name="chesscom_lookup_handle"
              placeholder=""
              spellCheck={false}
            />
            <button
              className={styles.action}
              onClick={() => onChesscomUsernameChange('')}
              disabled={!chesscomUsername}
              type="button"
            >
              Clear
            </button>
            <button
              className={`${styles.action} ${styles.inlineFormWide} ${chesscomUsername.trim() && !recentGamesLoading ? styles.confirmAction : ''}`}
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
                className={`${styles.action} ${recentGameTimeClass === timeClass ? styles.primary : styles.secondary}`}
                key={timeClass}
                onClick={() => onRecentGameTimeClassChange(timeClass)}
                type="button"
              >
                {timeClass}
              </button>
            ))}
          </div>
          {recentGamesError ? (
            <p className="text-[14px] leading-[1.45] m-0 text-[#ffb4b2]">{recentGamesError}</p>
          ) : null}
        </section>
        {recentGames.length ? (
          <section className={`${styles.card} ${styles.openingListCard}`}>
            <div className={styles.panelHeader}>
              <h2 className={styles.sectionTitle}>Recent {capitalizeRecentGameTimeClass(recentGameTimeClass)}</h2>
              <span className={styles.statusText}>click to review</span>
            </div>
            <div className={styles.openingList}>
              {recentGames.map((game) => (
                <button
                  className={`${styles.openingButton} ${styles.recentGameButton} ${
                    game.outcome === 'win'
                      ? styles.recentGameWin
                      : game.outcome === 'loss'
                        ? styles.recentGameLoss
                        : styles.recentGameDraw
                  }`}
                  key={game.link}
                  onClick={() => loadRecentGame(game)}
                  type="button"
                >
                  <span className={styles.recentGameDate}>{formatRecentGameAge(game)}</span>
                  <strong className={styles.recentGamePlayers}>{formatRecentGamePlayers(game)}</strong>
                  <span className={styles.recentGameMoves}>{game.moveCount ? `${game.moveCount} moves` : '-'}</span>
                  <span className={styles.recentGameMeta}>{formatRecentGameMeta(game)}</span>
                </button>
              ))}
            </div>
            {recentGamesHasMore ? (
              <button
                className={`${styles.action} ${styles.fullWidthAction}`}
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
      <div className="border-[1px] border-solid border-[rgba(214,226,244,0.14)] rounded-[10px] bg-[rgba(8,12,19,0.78)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] min-h-0 flex flex-col gap-[7px] p-[9px] overflow-hidden">
        <div className="min-w-0 flex items-center justify-between gap-[14px] text-[var(--text)] text-[15px] overflow-hidden text-ellipsis whitespace-nowrap">
          <div className="min-w-0 flex items-center gap-[8px] text-[var(--text)] text-[15px] font-[weight:550] overflow-hidden text-ellipsis whitespace-nowrap">
            <span
              className="flex-[0_0_auto] px-[8px] py-[5px] rounded-[999px] bg-color-mix(in bg-srgb,var(--review-color) bg-[rgba(9,14,23,0.42)] border-[1px] border-solid border-color-mix(in border-srgb,var(--review-color) border-50%,rgba(214,226,244,0.18)) text-[var(--text)] text-[11px] font-[weight:550] tracking-[0.06em] uppercase"
              style={{ ['--review-color' as string]: coachReview?.colorHex ?? '#98b8ff' }}
            >
              {coachReview?.label ?? 'Review'}
            </span>
            <strong>
              {coachReview ? `${coachReview.moveLabel} ${coachReview.san}` : `${whiteReviewName} vs ${blackReviewName}`}
            </strong>
          </div>
          <span className="text-[14px] leading-[1.45] text-[var(--text-muted)]">
            {timelineLoading ? formatTimelineProgress(timelineProgress) : `${reviewMoments.length} moments`}
          </span>
        </div>
        {coachReview ? (
          <p className="m-0 min-h-[calc(12.5px*1.2*2)] text-[var(--text-muted)] text-[12.5px] leading-[1.2] box line-clamp-2 [-webkit-box-orient:vertical] overflow-hidden">
            {compactCoachText(coachReview)}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-[8px] mt-auto min-h-[36px]">
          <button
            className={`${styles.action} ${styles.actionBest}`}
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
            className={`${styles.action} ${styles.primary}`}
            onClick={() => goToReviewMoment(nextMomentIndex >= 0 ? nextMomentIndex : reviewMoments.length)}
            disabled={!hasNextReviewStep}
            type="button"
          >
            Next
          </button>
        </div>
      </div>

      <div className={styles.reviewMoveTableScroller}>
        <table className={styles.reviewMoveTable} aria-label="Reviewed moves">
          <tbody>
            {movePairs.map((pair) => (
              <tr className="h-[38px] bg-[rgba(255,255,255,0.026)]" key={pair.moveNumber}>
                <th
                  className="text-[var(--text-soft)] text-[12px] font-[weight:550] text-right w-[34px] pt-0 pb-0 pl-[2px] pr-[8px] align-middle"
                  scope="row"
                >
                  {pair.moveNumber}.
                </th>
                <ReviewMoveBadgeCell review={timelineReviews[pair.whitePly - 1] ?? null} />
                <td className="p-0 align-middle">
                  <ReviewMoveButton
                    activeMoveButtonRef={activeMoveButtonRef}
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
                    activeMoveButtonRef={activeMoveButtonRef}
                    activePly={displayActivePly}
                    jumpToIndex={jumpToIndex}
                    move={pair.black}
                    ply={pair.blackPly}
                    review={timelineReviews[pair.blackPly - 1] ?? null}
                  />
                </td>
              </tr>
            ))}
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
      className={`${'min-h-0 relative border-[1px] border-solid border-[var(--border-soft)] rounded-[12px] bg-[var(--surface)] p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-16px) saturate(1.16'} ${'flex flex-col gap-[13px] flex-[0_0_auto] gap-[18px] overflow-visible gap-[16px]'}`}
    >
      {positionLoading ? (
        <p className="text-[14px] leading-[1.45] text-[var(--text-muted)] m-0">
          Engine is finding the best move for this position.
        </p>
      ) : reviewSaveMoveSan ? (
        <p className="text-[14px] leading-[1.45] text-[var(--text-muted)] m-0">
          Create a training card where the answer is{' '}
          <span className="inline-block border-[1px] border-solid border-[rgba(184,247,161,0.42)] rounded-[6px] bg-[rgba(184,247,161,0.1)] text-[#d8f5cc] font-[weight:550] px-[7px] py-[1px]">
            {reviewSaveMoveSan}
          </span>
          .
        </p>
      ) : (
        <p className="text-[14px] leading-[1.45] text-[var(--text-muted)] m-0">
          No best move is available for this position yet.
        </p>
      )}

      {hasOwnedDeck ? (
        <label className="flex flex-col gap-[6px] min-w-0">
          <span className="text-[var(--text-soft)] text-[11px] font-[weight:400] tracking-[0.04em] uppercase">
            Target deck
          </span>
          <select
            className={`${'w-full min-w-0 box-border min-h-[42px] border-[1px] border-solid border-[var(--border)] rounded-[10px] bg-[rgba(7,12,20,0.72)] text-[var(--text)] px-[12px] py-0 font-inherit outline-none border-[rgba(198,215,255,0.4)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.08)] text-[var(--text-soft)]'} ${'appearance-none bg-[linear-gradient(45deg,transparent_50%,rgba(214,226,244,0.72)_50%),linear-gradient(135deg,rgba(214,226,244,0.72)_50%,transparent_50%)] bg-[position:calc(100%-18px)_calc(50%+2px),calc(100%-12px)_calc(50%+2px)] bg-[length:6px_6px,6px_6px] bg-no-repeat cursor-pointer pr-[34px] outline-none border-[rgba(198,215,255,0.42)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.12)]'}`}
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
        <p className="text-[14px] leading-[1.45] text-[var(--text-muted)] m-0">
          Create a personal deck in Train, then come back here to save this position.
        </p>
      )}

      {hasOwnedDeck ? (
        <button
          className={`${styles.action} ${styles.primary} ${styles.fullWidthAction} ${reviewDeckSaveStatus === 'Saved' ? styles.saveAdded : ''}`}
          disabled={!canSaveReviewCard}
          onClick={onSaveReviewCard}
          type="button"
        >
          {saveButtonLabel}
        </button>
      ) : (
        <button
          className={`${styles.action} ${styles.primary} ${styles.fullWidthAction}`}
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
  activeMoveButtonRef,
  activePly,
  jumpToIndex,
  move,
  ply,
  review,
}: {
  activeMoveButtonRef: RefObject<HTMLButtonElement | null>;
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
      className={`${'w-full min-w-0 min-h-[30px] relative inline-flex items-center justify-start gap-[6px] border-[1px] border-solid border-transparent rounded-[7px] bg-transparent text-[var(--text-muted)] pt-0 pb-0 pl-[2px] pr-[8px] font-inherit text-[15px] font-[weight:550] text-left cursor-pointer bg-[rgba(255,255,255,0.06)] text-[var(--text)]'} ${moveColor ? 'text-[var(--move-dot-color,var(--text))]' : ''} ${isActive ? 'bg-[rgba(198,215,255,0.14)] text-[var(--text)] text-[var(--move-dot-color,var(--text))]' : ''}`}
      onClick={() => jumpToIndex(ply)}
      ref={isActive ? activeMoveButtonRef : undefined}
      style={{
        ...(moveColor ? { ['--move-dot-color' as string]: moveColor } : {}),
      }}
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
          className="inline-block w-[17px] h-[17px] align-middle bg-[var(--review-badge-url)] bg-[position:center] bg-no-repeat bg-[length:contain] drop-shadow-[0_2px_3px_rgba(0,0,0,0.28)] pointer-events-none"
          style={{ ['--review-badge-url' as string]: `url(${badgeSrc})` }}
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
    <div className="border-[1px] border-solid border-[rgba(214,226,244,0.14)] rounded-[10px] bg-[rgba(8,12,19,0.78)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] relative min-h-0 p-0 overflow-hidden">
      <div
        className={`${'relative w-full h-full min-h-0 rounded-[10px] overflow-hidden bg-[#3a3631]'} ${timelineLoading ? 'blur-1.6px) saturate(0.9 scale-[101%]' : ''}`}
      >
        <svg
          className="w-full h-full block rounded-[7px] overflow-hidden cursor-pointer"
          viewBox="0 0 100 28"
          preserveAspectRatio="none"
          aria-label="Evaluation timeline"
        >
          <rect className="fill-[#3d3934] op-100" x="0" y="0" width="100" height="28" />
          <path className="fill-[#f5f2e8] op-96" d={hasTimeline ? whiteAreaPath : loadingAreaPath} />
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
                  className="absolute w-[9px] h-[9px] p-0 border-0 rounded-[999px] bg-color-mix(in bg-srgb,var(--timeline-point-color,#ff954a) bg-62%,white) shadow-[none] translate-[-50%] cursor-pointer"
                  key={review.ply}
                  onClick={() => jumpToIndex(review.ply)}
                  style={{
                    ['--timeline-point-color' as string]: dotColor,
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
          className="absolute left-[12px] right-[12px] top-[50%] flex flex-col gap-[7px] px-[11px] py-[10px] border-[1px] border-solid border-[rgba(245,242,232,0.18)] rounded-[9px] bg-[rgba(12,15,20,0.62)] shadow-[0_12px_34px_rgba(0,0,0,0.22)] translate-y-[-50%] backdrop-blur-[14px]"
          role="status"
          aria-label={`Analysis ${formatTimelineProgress(progressValue)}`}
        >
          <div className="flex items-center justify-between gap-[10px] text-[rgba(245,242,232,0.78)] text-[11px] font-[weight:550] tracking-[0.04em] uppercase text-[#f8f3e8] text-[13px] tracking-0 normal-case">
            <span>Deep analysis</span>
            <strong>{formatTimelineProgress(progressValue)}</strong>
          </div>
          <div className="relative h-[8px] overflow-hidden rounded-[999px] bg-[rgba(245,242,232,0.12)]">
            <span
              className="absolute [inset:0_auto_0_0] min-w-[8px] rounded-[inherit] bg-gradient-linear bg-gradient-[90deg,#e65d55_0%,#f09a45_48%] shadow-[0_0_18px_rgba(240,154,69,0.34)] transition-width duration-[180ms] ease-[ease]"
              style={{ width: `${progressValue}%` }}
            />
          </div>
        </div>
      ) : null}
      {!timelineLoading && timelineAnalysesLength === 0 ? (
        <div className="absolute [inset:0] flex items-center justify-center text-[rgba(13,17,24,0.7)] text-[12px] font-[weight:550]">
          No review yet.
        </div>
      ) : null}
      {timelineError ? (
        <span className="absolute left-[10px] right-[10px] bottom-[8px] text-[var(--danger)] text-[11px] leading-[1.2] overflow-hidden text-ellipsis whitespace-nowrap">
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
    return `${review.san} stays in book.`;
  }

  if (review.category === 'best') {
    return `${review.san} matches the engine's top move.`;
  }

  if (
    (review.category === 'mistake' || review.category === 'blunder' || review.category === 'inaccuracy') &&
    review.bestMoveSan
  ) {
    return `${review.san} is ${review.label?.toLowerCase() ?? 'imprecise'}. Best was ${review.bestMoveSan}.`;
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

function formatRecentGameMeta(game: ChessComRecentGameSummary) {
  const eco = game.eco ?? 'game';
  const color = game.playerColor;
  return `${eco} · ${color}`;
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
    <div className={`${styles.deckLibraryItemWrap} ${isSelected ? styles.activeDeckLibraryItemWrap : ''}`}>
      <button
        aria-current={isSelected ? 'true' : undefined}
        className={`${styles.deckLibraryItem} ${isSelected ? styles.activeDeckLibraryItem : ''}`}
        disabled={selectDisabled}
        onClick={() => onTrainDeck(deck.id)}
        type="button"
      >
        <span className={styles.deckLibraryHead}>
          {renaming ? (
            <input
              className={`${'w-full min-w-0 box-border min-h-[42px] border-[1px] border-solid border-[var(--border)] rounded-[10px] bg-[rgba(7,12,20,0.72)] text-[var(--text)] px-[12px] py-0 font-inherit outline-none border-[rgba(198,215,255,0.4)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.08)] text-[var(--text-soft)]'} ${'min-h-[34px] px-[10px] py-0 text-[14px] font-[weight:550]'}`}
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
        <span className={styles.deckLibraryMeta}>
          <span>{deck.newCount} new</span>
          <span>{deck.learningCount} learning</span>
          <span>{deck.dueCount} due</span>
        </span>
      </button>

      {deck.canManage ? (
        <div className={styles.deckLibraryMenuAnchor} ref={menuRef}>
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={`Deck options for ${deck.name}`}
            className={styles.deckLibraryMenuButton}
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
            <div className={styles.deckLibraryMenu} role="menu">
              <button className={styles.deckLibraryMenuOption} onClick={startRename} role="menuitem" type="button">
                Rename
              </button>
              <button
                className={`${styles.deckLibraryMenuOption} ${styles.deckLibraryMenuOptionDanger}`}
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
        className={`${'min-h-0 relative border-[1px] border-solid border-[var(--border-soft)] rounded-[12px] bg-[var(--surface)] p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-16px) saturate(1.16'} ${'flex flex-col gap-[13px] flex-[0_0_auto] gap-[18px] overflow-visible gap-[16px]'}`}
      >
        <div className="min-w-0 flex items-center justify-between gap-[14px]">
          <h2 className="m-0 min-w-0 text-[var(--text)] font-[weight:560] tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]">
            Decks
          </h2>
          <span className="text-[14px] leading-[1.45] text-[var(--text-muted)]">
            {deckLibraryLoading ? 'loading' : `${deckSummaries.length} decks`}
          </span>
        </div>
        {deckSummaries.length === 0 ? (
          <p className="text-[14px] leading-[1.45] text-[var(--text-muted)] m-0">
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
            className={`${styles.action} ${styles.fullWidthAction}`}
            disabled={!canTrainAll}
            onClick={onTrainAll}
            type="button"
          >
            Cram all decks
          </button>
        ) : null}
      </section>
      <section
        className={`${'min-h-0 relative border-[1px] border-solid border-[var(--border-soft)] rounded-[12px] bg-[var(--surface)] p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-16px) saturate(1.16'} ${'flex flex-col gap-[13px] flex-[0_0_auto] gap-[18px] overflow-visible gap-[16px]'} ${focusCreateDeck ? 'border-[rgba(198,215,255,0.58)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_0_0_1px_rgba(198,215,255,0.14)]' : ''}`}
        ref={createDeckSectionRef}
      >
        <div className="min-w-0 flex items-center justify-between gap-[14px]">
          <h2 className="m-0 min-w-0 text-[var(--text)] font-[weight:560] tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]">
            Create deck
          </h2>
          <span className="text-[14px] leading-[1.45] text-[var(--text-muted)]">manual</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-[8px]">
          <input
            className="w-full min-w-0 box-border min-h-[42px] border-[1px] border-solid border-[var(--border)] rounded-[10px] bg-[rgba(7,12,20,0.72)] text-[var(--text)] px-[12px] py-0 font-inherit outline-none border-[rgba(198,215,255,0.4)] shadow-[inset_0_0_0_1px_rgba(198,215,255,0.08)] text-[var(--text-soft)]"
            onChange={(event) => onNewDeckTitleChange(event.target.value)}
            placeholder="Deck title"
            ref={createDeckInputRef}
            value={newDeckTitle}
          />
          <button
            className={`${styles.action} ${styles.inlineFormWide} ${newDeckTitle.trim() && !deckActionLoading ? styles.confirmAction : ''}`}
            disabled={deckActionLoading || !newDeckTitle.trim()}
            onClick={onCreateDeck}
            type="button"
          >
            Create
          </button>
        </div>
      </section>
      <button
        className={`${styles.action} ${styles.primary} ${styles.fullWidthAction}`}
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
        className={`${'min-h-0 relative border-[1px] border-solid border-[var(--border-soft)] rounded-[12px] bg-[var(--surface)] p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-16px) saturate(1.16'} ${'flex flex-[0_1_auto] flex-col gap-[10px] min-h-0 max-h-[calc(100svh-250px)]'} ${'max-h-none rounded-[10px] border-[rgba(255,92,108,0.42)] bg-[rgba(130,38,54,0.2)] border-[rgba(255,176,84,0.36)] bg-[rgba(130,82,32,0.18)] border-[rgba(138,198,255,0.34)] bg-[rgba(42,82,126,0.18)] border-[rgba(138,227,193,0.38)] bg-[rgba(38,118,90,0.18)] gap-[10px] p-[12px] overflow-visible'} ${getMasteryToneClass(cardGrade)}`}
      >
        {card ? (
          <>
            <div className="flex items-center justify-between gap-[10px] min-w-0">
              <div className="flex min-w-0 flex-col gap-[4px]">
                <strong className="text-[var(--text)] text-[16px] leading-[1.2] tracking-0 wrap-anywhere text-[15px] leading-[1.15]">
                  {getOpeningDisplayName(card)}
                </strong>
                <span className="text-[var(--text-muted)] text-[11px] leading-[1.1] tracking-[0.06em] uppercase leading-[1.3]">
                  Active card
                </span>
              </div>
              <span
                className={`${'inline-flex items-center justify-center min-w-[30px] h-[30px] rounded-[6px] text-[15px] font-[weight:500] tracking-0 min-w-[28px] h-[28px] text-[14px]'} ${getMasteryGradeClass(cardGrade)}`}
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
                className="h-full rounded-[inherit] bg-[rgba(138,227,193,0.72)] transition-width duration-[180ms] ease-[ease]"
                style={{ width: `${cardScore}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-[10px] text-[var(--text-soft)] text-[12px] text-[11px] leading-[1.3]">
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
                  className="h-full rounded-[inherit] bg-[rgba(138,227,193,0.72)] transition-width duration-[180ms] ease-[ease]"
                  style={{ width: `${sessionProgressPercent}%` }}
                />
              </div>
            ) : null}
            {deckFeedback ? (
              <div
                className={`${'flex flex-col gap-[5px] rounded-[8px] px-[10px] py-[9px] text-[12px] text-[var(--text)] text-[var(--text-muted)] px-[10px] py-[8px] text-[11px] leading-[1.35] block overflow-visible'} ${deckFeedback.pending ? 'border-[1px] border-solid border-[rgba(152,184,255,0.3)] bg-[rgba(9,14,23,0.42)]' : deckFeedback.correct ? 'border-[1px] border-solid border-[rgba(138,227,193,0.38)] bg-[rgba(56,148,115,0.14)]' : 'border-[1px] border-solid border-[rgba(255,141,145,0.42)] bg-[rgba(180,58,66,0.16)]'}`}
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
                className={`${styles.action} ${styles.deleteAction}`}
                disabled={!card || !canDeleteCard || deckActionLoading}
                onClick={onDeleteCard}
                type="button"
              >
                {deleteCardLabel}
              </button>
              <button
                className={`${styles.action} ${styles.primary}`}
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
            <p className="text-[14px] leading-[1.45] text-[var(--text-muted)] m-0">
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
          className={`${'min-h-0 relative border-[1px] border-solid border-[var(--border-soft)] rounded-[12px] bg-[var(--surface)] p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-16px) saturate(1.16'} ${'flex flex-col gap-[10px] p-[12px] rounded-[10px]'} ${getMasteryToneClass(activeLineMastery.grade)}`}
        >
          <div className="flex items-center justify-between gap-[10px] min-w-0">
            <div className="flex min-w-0 flex-col gap-[4px]">
              <strong className="text-[var(--text)] text-[13px] leading-[1.2]">Opening mastery</strong>
              <span className="text-[var(--text-muted)] text-[11px] leading-tight wrap-anywhere">
                {activeLineMastery.cardCount} cards in {getOpeningDisplayName(card!)}
              </span>
            </div>
            <span
              className={`${'inline-flex items-center justify-center min-w-[30px] h-[30px] rounded-[6px] text-[15px] font-[weight:500] tracking-0 min-w-[28px] h-[28px] text-[14px]'} ${getMasteryGradeClass(activeLineMastery.grade)}`}
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
              className="h-full rounded-[inherit] bg-[rgba(138,227,193,0.72)] transition-width duration-[180ms] ease-[ease]"
              style={{ width: `${activeLineMastery.masteryScore}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-[10px] text-[var(--text-soft)] text-[12px] text-[11px] leading-[1.3]">
            <span>Opening {activeLineMastery.masteryScore}/100</span>
            <span>{activeLineMastery.newCount + activeLineMastery.dueCount} due/new</span>
          </div>
        </section>
      ) : null}
      {!trainAllSession && gradeDistribution.length > 0 ? (
        <section
          className={`${'min-h-0 relative border-[1px] border-solid border-[var(--border-soft)] rounded-[12px] bg-[var(--surface)] p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-16px) saturate(1.16'} ${'flex flex-col gap-[10px] p-[12px] rounded-[10px] bg-[rgba(9,14,23,0.34)]'}`}
        >
          <div className="flex items-center justify-between gap-[10px] text-[var(--text-soft)] text-[12px] text-[var(--text-muted)] text-[11px]">
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
                className={`${'min-w-[8px] rounded-[999px] transition-flex duration-[220ms] ease-[ease]'} ${masteryDistributionClassByGrade[segment.grade]}`}
                key={segment.grade}
                style={{ flex: `${segment.count} ${segment.count} 0` }}
                title={`${segment.grade} · ${segment.count} line${segment.count === 1 ? '' : 's'} · ${segment.percent}%`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-8px 12px">
            {gradeDistribution.map((segment) => (
              <span
                className="inline-flex items-center gap-[6px] text-[var(--text-soft)] text-[11px] text-[var(--text-muted)]"
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
      className="fixed [inset:0] z-20 flex items-center justify-center p-[18px] bg-[rgba(1,5,12,0.62)] backdrop-blur-[10px]"
      onMouseDown={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose();
        }
      }}
    >
      <section
        className="w-[min(680px,calc(100vw-36px))] max-h-min(720px,calc(100svh min-h-0 grid grid-rows-[auto_auto_minmax(220px,1fr)_auto] gap-[14px] overflow-hidden border-[1px] border-solid border-[var(--border)] rounded-[16px] bg-[rgba(12,18,29,0.9)] shadow-[var(--glass-shadow)] p-[18px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pgn-import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="min-w-0 flex items-center justify-between gap-[14px]">
          <div>
            <h2
              className="m-0 min-w-0 text-[var(--text)] font-[weight:560] tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]"
              id="pgn-import-title"
            >
              Import PGN
            </h2>
            <p className="text-[14px] leading-[1.45] text-[var(--text-muted)] m-0 text-[var(--text)] font-[weight:550]">
              Use this only when you want full-game review.
            </p>
          </div>
          <button className={styles.iconButton} onClick={onClose} title="Close import" type="button">
            X
          </button>
        </div>
        <div className="grid gap-[8px] grid-cols-2 grid-cols-1fr">
          <label className={`${styles.action} ${styles.primary}`} htmlFor="pgn-upload">
            Load file
          </label>
          <button
            className={`${styles.action} ${styles.secondary}`}
            onClick={() => void handlePgnPaste()}
            disabled={!pgnDraft.trim()}
            type="button"
          >
            Paste PGN
          </button>
        </div>
        <input className="hidden" id="pgn-upload" type="file" accept=".pgn" onChange={handleUpload} />
        <textarea
          className={styles.pgnInput}
          value={pgnDraft}
          onChange={(event) => setPgnDraft(event.target.value)}
          placeholder={'[Event "Live Chess"]\n[White "LosValettos"]\n[Black "rafaelpiresrj"]\n\n1. e4 e5 2. Nf3 Nc6'}
          spellCheck={false}
        />
        <p className="text-[14px] leading-[1.45] text-[var(--text-muted)] m-0 text-[var(--text)] font-[weight:550]">
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
      className={`${'min-h-0 relative border-[1px] border-solid border-[var(--border-soft)] rounded-[12px] bg-[var(--surface)] p-[15px] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-16px) saturate(1.16'} ${'flex flex-col gap-[13px] flex-[0_0_auto]'}`}
    >
      <div className="min-w-0 flex items-center justify-between gap-[14px]">
        <h2 className="m-0 min-w-0 text-[var(--text)] font-[weight:560] tracking-0 overflow-hidden text-ellipsis whitespace-nowrap text-[19px] leading-[1.15]">
          Engine
        </h2>
        <span className="text-[14px] leading-[1.45] text-[var(--text-muted)]">
          {positionLoading ? 'updating' : `depth ${positionAnalysis?.depth ?? '--'}`}
        </span>
      </div>
      <div className={styles.engineLines}>
        {lines.map((line) => (
          <div
            className="border-[1px] border-solid border-[rgba(214,226,244,0.16)] rounded-[8px] bg-[rgba(7,12,20,0.44)] p-[10px]"
            key={line.multipv}
          >
            <div className="min-w-0 flex items-center justify-between gap-[14px] grid grid-cols-[auto_minmax(0,1fr)_auto] text-[var(--text-muted)] text-[13px] gap-[10px] text-[var(--text)] text-[16px] overflow-hidden text-ellipsis whitespace-nowrap">
              <span className="text-[var(--accent-strong)] font-[weight:550]">#{line.multipv}</span>
              <strong>{line.bestMove ? formatBestMove(currentFen, line.bestMove) : '--'}</strong>
              <span>{formatLineScore(line)}</span>
            </div>
            <p className="mx-0 mt-[8px] mb-0 text-[var(--text-muted)] text-[12px] leading-[1.45] whitespace-nowrap overflow-hidden text-ellipsis">
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
