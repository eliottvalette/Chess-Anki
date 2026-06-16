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
  drillStatus,
  expectedSan: _expectedSan,
  loading,
  onImportRecent,
  onSelectNode,
  onSelectTree,
  onStartDrill: _onStartDrill,
  onStopDrill,
  trainSide,
  onChangeTrainSide,
  undoMove: _undoMove,
  trees,
  minForcedPlies,
  setMinForcedPlies,
}: {
  actionError: string;
  actionLoading: boolean;
  activeNodeId: string | null;
  activeTree: OpeningTreeDetail | null;
  activeTreeId: string | null;
  deckFeedback: DeckFeedback | null;
  drillActive: boolean;
  drillStatus: string;
  expectedSan: string | null;
  loading: boolean;
  onImportRecent: () => void;
  onSelectNode: (nodeId: string) => void;
  onSelectTree: (treeId: string) => void;
  onStartDrill: () => void;
  onStopDrill: () => void;
  trainSide: 'white' | 'black';
  onChangeTrainSide: (side: 'white' | 'black') => void;
  undoMove: () => void;
  trees: OpeningTreeSummary[];
  minForcedPlies: number;
  setMinForcedPlies: (v: number) => void;
}) {
  const [minNodes, setMinNodes] = useState(0);
  const [minDepth, setMinDepth] = useState(0);

  useEffect(() => {
    const savedNodes = localStorage.getItem('chess-lab-min-nodes');
    const savedDepth = localStorage.getItem('chess-lab-min-depth');
    if (savedNodes) setMinNodes(parseInt(savedNodes, 10) || 0);
    if (savedDepth) setMinDepth(parseInt(savedDepth, 10) || 0);
  }, []);

  useEffect(() => {
    localStorage.setItem('chess-lab-min-nodes', minNodes.toString());
  }, [minNodes]);

  useEffect(() => {
    localStorage.setItem('chess-lab-min-depth', minDepth.toString());
  }, [minDepth]);

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
                            <strong>{tree.name}</strong>
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
          {drillActive ? (
            <>
              <div className={styles.trainBackRow}>
                <button
                  className={`${styles.action} ${styles.fullWidthAction} ${styles.backAction}`}
                  onClick={onStopDrill}
                  type="button"
                >
                  Back
                </button>
              </div>
              <div className={styles.trainBackRow} style={{ marginTop: '-4px', marginBottom: '16px' }}>
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
            </>
          ) : (
            <div className={styles.trainBackRow} style={{ marginBottom: '16px' }}>
              <button
                className={`${styles.action} ${styles.fullWidthAction} ${styles.backAction}`}
                onClick={() => onSelectTree('')}
                type="button"
              >
                Back
              </button>
            </div>
          )}

          <section
            className={`${styles.card} ${styles.openingTreeCard} ${drillActive ? (deckFeedback?.correct ? styles.tonePositive : deckFeedback?.pending === false ? styles.toneNegative : styles.toneNeutral) : ''}`}
          >
            {!drillActive ? (
              <div className={styles.panelHeader}>
                <h2 className={styles.sectionTitle}>{activeTree.name}</h2>
                <span className={styles.statusText}>{formatOpeningLibrary(activeTree.library)}</span>
              </div>
            ) : (
              <div className={styles.trainingCardHead}>
                <div className={styles.trainingCardTitleBlock}>
                  <strong className={styles.trainingCardTitle}>{activeTree.name}</strong>
                  <span className={styles.trainingCardEco}>{formatOpeningLibrary(activeTree.library)}</span>
                </div>
              </div>
            )}

            {drillActive && (drillStatus || deckFeedback) ? (
              <div
                className={`${styles.feedbackBox} ${deckFeedback?.pending ? styles.feedbackPending : deckFeedback?.correct ? styles.feedbackGood : deckFeedback ? styles.feedbackBad : styles.feedbackPending}`}
                style={{ margin: '0 0 16px 0', padding: '16px', borderRadius: '12px' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <strong>
                    {!deckFeedback
                      ? 'Drill Step'
                      : deckFeedback.pending
                        ? 'Checking eval'
                        : deckFeedback.correct
                          ? 'Best move'
                          : 'Miss'}
                  </strong>
                  <span>
                    {!deckFeedback
                      ? drillStatus
                      : `played ${deckFeedback.playedSan} · best ${deckFeedback.expectedSan}${deckFeedback.evalLossCp != null ? ` · loss ${formatCpSwing(deckFeedback.evalLossCp)}` : ''}`}
                  </span>
                </div>
              </div>
            ) : null}

            <div className={styles.trainingCardMeta}>
              <span>depth {activeTree.targetDepth}</span>
              <span>{activeTree.nodeCount} nodes</span>
              <span>{activeTree.dueCount} weak</span>
            </div>

            <div className={styles.openingTreeCanvas}>
              <ReactFlowProvider>
                <ReactFlow
                  edges={graph.edges}
                  fitView
                  fitViewOptions={{ padding: 0.5 }}
                  minZoom={0.25}
                  nodes={graph.nodes}
                  nodesDraggable={false}
                  zoomOnScroll={false}
                  panOnScroll={false}
                  zoomOnDoubleClick={false}
                  panOnDrag={false}
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
      draggable: true,
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
    <div className={styles.reviewLoadedPanel}>
      <section className={styles.reviewLoadedTop}>
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
      <div className={styles.trainBackRow}>
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
    <section className={`${styles.card} ${styles.emptyStateCard}`}>
      <div className={styles.panelHeader}>
        <h2 className={styles.sectionTitle}>Training Profile</h2>
        <span className={styles.statusText}>{statusText}</span>
      </div>
      <form
        className={styles.profileForm}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input
          className={`${styles.inlineInput} ${styles.profileFormWide}`}
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
          className={`${styles.inlineInput} ${styles.profileFormWide}`}
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
      {error ? <p className={styles.error}>{error}</p> : null}
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
      <section className={`${styles.card} ${styles.movesCard}`}>
        <div className={styles.panelHeader}>
          <h2 className={styles.sectionTitle}>Line</h2>
          <span className={styles.statusText}>{movePairs.length ? `${movePairs.length} moves` : 'manual board'}</span>
        </div>
        <div className={styles.moveList}>
          {movePairs.length === 0 ? (
            <p className={styles.empty}>Play on the board or import a PGN.</p>
          ) : (
            <>
              <div className={styles.moveTableHeader} aria-hidden="true">
                <span />
                <span>White</span>
                <span>Black</span>
              </div>
              {movePairs.map((pair) => (
                <div className={styles.moveRow} key={pair.moveNumber}>
                  <span className={styles.moveNumber}>{pair.moveNumber}.</span>
                  <button
                    className={`${styles.moveCellButton} ${historyIndex === pair.whitePly ? styles.activeMoveCell : ''}`}
                    onClick={() => jumpToIndex(pair.whitePly)}
                    type="button"
                  >
                    {pair.white ? renderMoveFigurine(pair.white.san) : '...'}
                  </button>
                  <button
                    className={`${styles.moveCellButton} ${historyIndex === pair.blackPly ? styles.activeMoveCell : ''}`}
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
        <section className={`${styles.card} ${styles.emptyStateCard}`}>
          <div className={styles.panelHeader}>
            <h2 className={styles.sectionTitle}>Game Review</h2>
            <span className={styles.statusText}>
              {recentGamesLoading ? 'loading' : recentGames.length ? `${recentGames.length} games` : 'ready'}
            </span>
          </div>
          <p className={styles.copy}>Use your Chess.com username to pull recent public games.</p>
          <div className={styles.inlineForm}>
            <input
              className={styles.inlineInput}
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
          <div className={styles.reviewSideTabs}>
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
          {recentGamesError ? <p className={styles.error}>{recentGamesError}</p> : null}
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
    <section className={styles.reviewGamePanel}>
      <div className={styles.reviewCoach}>
        <div className={styles.coachHeader}>
          <div className={styles.coachTitle}>
            <span
              className={styles.reviewBadge}
              style={{ ['--review-color' as string]: coachReview?.colorHex ?? '#98b8ff' }}
            >
              {coachReview?.label ?? 'Review'}
            </span>
            <strong>
              {coachReview ? `${coachReview.moveLabel} ${coachReview.san}` : `${whiteReviewName} vs ${blackReviewName}`}
            </strong>
          </div>
          <span className={styles.statusText}>
            {timelineLoading ? formatTimelineProgress(timelineProgress) : `${reviewMoments.length} moments`}
          </span>
        </div>
        {coachReview ? <p className={styles.coachText}>{compactCoachText(coachReview)}</p> : null}
        <div className={styles.reviewCoachActions}>
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
              <tr className={styles.reviewMoveRow} key={pair.moveNumber}>
                <th className={styles.reviewMoveNumber} scope="row">
                  {pair.moveNumber}.
                </th>
                <ReviewMoveBadgeCell review={timelineReviews[pair.whitePly - 1] ?? null} />
                <td className={styles.reviewMoveColumn}>
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
                <td className={styles.reviewMoveColumn}>
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
    <section className={`${styles.card} ${styles.emptyStateCard}`}>
      {positionLoading ? (
        <p className={styles.copy}>Engine is finding the best move for this position.</p>
      ) : reviewSaveMoveSan ? (
        <p className={styles.copy}>
          Create a training card where the answer is <span className={styles.saveMoveAnswer}>{reviewSaveMoveSan}</span>.
        </p>
      ) : (
        <p className={styles.copy}>No best move is available for this position yet.</p>
      )}

      {hasOwnedDeck ? (
        <label className={styles.labeledField}>
          <span className={styles.fieldLabel}>Target deck</span>
          <select
            className={`${styles.inlineInput} ${styles.deckSelect}`}
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
        <p className={styles.copy}>Create a personal deck in Train, then come back here to save this position.</p>
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
    return <span className={styles.reviewMoveEmpty} />;
  }

  const isActive = activePly === ply;
  const moveColor = getReviewMoveColor(review);

  return (
    <button
      className={`${styles.reviewMoveCell} ${moveColor ? styles.reviewMoveCellClassified : ''} ${isActive ? styles.activeReviewMoveCell : ''}`}
      onClick={() => jumpToIndex(ply)}
      ref={isActive ? activeMoveButtonRef : undefined}
      style={{
        ...(moveColor ? { ['--move-dot-color' as string]: moveColor } : {}),
      }}
      type="button"
    >
      <span className={styles.reviewMoveSan}>{renderMoveFigurine(move.san)}</span>
    </button>
  );
}

function ReviewMoveBadgeCell({ review }: { review: TimelineReview | null }) {
  const badgeSrc = getReviewBadgeSrc(review);

  return (
    <td className={styles.reviewMoveBadgeColumn}>
      {badgeSrc ? (
        <span
          aria-hidden="true"
          className={styles.reviewMoveBadge}
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
    <div className={styles.reviewTimeline}>
      <div className={`${styles.reviewTimelineGraph} ${timelineLoading ? styles.reviewTimelineGraphLoading : ''}`}>
        <svg
          className={styles.reviewTimelineSvg}
          viewBox="0 0 100 28"
          preserveAspectRatio="none"
          aria-label="Evaluation timeline"
        >
          <rect className={styles.reviewTimelineBlack} x="0" y="0" width="100" height="28" />
          <path className={styles.reviewTimelineWhite} d={hasTimeline ? whiteAreaPath : loadingAreaPath} />
          <line className={styles.reviewTimelineMidline} x1="0" x2="100" y1="14" y2="14" />
          <path className={styles.reviewTimelinePath} d={hasTimeline ? boundaryPath : loadingBoundaryPath} />
          <line
            className={styles.reviewTimelineCursor}
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
                  className={styles.reviewTimelinePoint}
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
          className={styles.reviewTimelineProgress}
          role="status"
          aria-label={`Analysis ${formatTimelineProgress(progressValue)}`}
        >
          <div className={styles.reviewTimelineProgressTop}>
            <span>Deep analysis</span>
            <strong>{formatTimelineProgress(progressValue)}</strong>
          </div>
          <div className={styles.reviewTimelineProgressTrack}>
            <span className={styles.reviewTimelineProgressFill} style={{ width: `${progressValue}%` }} />
          </div>
        </div>
      ) : null}
      {!timelineLoading && timelineAnalysesLength === 0 ? (
        <div className={styles.reviewTimelineFallback}>No review yet.</div>
      ) : null}
      {timelineError ? <span className={styles.reviewTimelineError}>{timelineError}</span> : null}
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
  return styles[`masteryGrade${grade}`];
}

function getMasteryToneClass(grade: MasteryGrade) {
  return styles[`masteryTone${grade}`];
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
              className={`${styles.inlineInput} ${styles.deckRenameInput}`}
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
    <svg className={styles.deckMenuIcon} viewBox="0 0 24 24" aria-hidden="true">
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
      <section className={`${styles.card} ${styles.emptyStateCard}`}>
        <div className={styles.panelHeader}>
          <h2 className={styles.sectionTitle}>Decks</h2>
          <span className={styles.statusText}>{deckLibraryLoading ? 'loading' : `${deckSummaries.length} decks`}</span>
        </div>
        {deckSummaries.length === 0 ? (
          <p className={styles.copy}>
            {deckLibraryLoading
              ? 'Loading decks.'
              : deckLoadError
                ? 'Learning setup is empty. Create a deck or reseed Supabase.'
                : 'Create a deck, then add cards from Review.'}
          </p>
        ) : (
          <div className={styles.deckLibrary}>
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
        {deckLoadError ? <p className={styles.error}>{deckLoadError}</p> : null}
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
        className={`${styles.card} ${styles.emptyStateCard} ${focusCreateDeck ? styles.createDeckSectionFocus : ''}`}
        ref={createDeckSectionRef}
      >
        <div className={styles.panelHeader}>
          <h2 className={styles.sectionTitle}>Create deck</h2>
          <span className={styles.statusText}>manual</span>
        </div>
        <div className={styles.inlineForm}>
          <input
            className={styles.inlineInput}
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
      {deckActionError ? <p className={styles.error}>{deckActionError}</p> : null}
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
        className={`${styles.card} ${styles.deckCard} ${styles.trainingDeckCard} ${getMasteryToneClass(cardGrade)}`}
      >
        {card ? (
          <>
            <div className={styles.trainingCardHead}>
              <div className={styles.trainingCardTitleBlock}>
                <strong className={styles.trainingCardTitle}>{getOpeningDisplayName(card)}</strong>
                <span className={styles.trainingCardEco}>Active card</span>
              </div>
              <span
                className={`${styles.masteryGradeBadge} ${getMasteryGradeClass(cardGrade)}`}
                title="Active card grade"
              >
                {cardGrade}
              </span>
            </div>
            <div className={styles.trainSessionProgress} aria-hidden="true">
              <div className={styles.trainSessionProgressFill} style={{ width: `${cardScore}%` }} />
            </div>
            <div className={styles.trainingCardMeta}>
              <span>Card {cardScore}/100</span>
              <span>
                {trainAllSession
                  ? `${trainSessionCardCurrent}/${trainSessionCardTotal}`
                  : `${deckStats.due + deckStats.new} cards`}
              </span>
            </div>
            {trainAllSession ? (
              <div className={styles.trainSessionProgress} role="status" aria-label="Cram progress">
                <div className={styles.trainSessionProgressFill} style={{ width: `${sessionProgressPercent}%` }} />
              </div>
            ) : null}
            {deckFeedback ? (
              <div
                className={`${styles.feedbackBox} ${deckFeedback.pending ? styles.feedbackPending : deckFeedback.correct ? styles.feedbackGood : styles.feedbackBad}`}
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
            <div className={styles.deckActions}>
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
            <p className={styles.empty}>
              {deckLoading
                ? 'Loading learning cards from Supabase.'
                : trainAllSession
                  ? 'No cram cards loaded.'
                  : 'Nothing to study right now in this deck.'}
            </p>
            {deckLoadError ? <p className={styles.error}>{deckLoadError}</p> : null}
          </>
        )}
      </section>
      {!trainAllSession && activeLineMastery ? (
        <section className={`${styles.card} ${styles.lineMetricCard} ${getMasteryToneClass(activeLineMastery.grade)}`}>
          <div className={styles.lineMetricHead}>
            <div className={styles.trainingCardTitleBlock}>
              <strong className={styles.lineMetricTitle}>Opening mastery</strong>
              <span className={styles.lineMetricSubtitle}>
                {activeLineMastery.cardCount} cards in {getOpeningDisplayName(card!)}
              </span>
            </div>
            <span
              className={`${styles.masteryGradeBadge} ${getMasteryGradeClass(activeLineMastery.grade)}`}
              title="Line metric grade"
            >
              {activeLineMastery.grade}
            </span>
          </div>
          <div className={styles.trainSessionProgress} aria-hidden="true">
            <div className={styles.trainSessionProgressFill} style={{ width: `${activeLineMastery.masteryScore}%` }} />
          </div>
          <div className={styles.trainingCardMeta}>
            <span>Opening {activeLineMastery.masteryScore}/100</span>
            <span>{activeLineMastery.newCount + activeLineMastery.dueCount} due/new</span>
          </div>
        </section>
      ) : null}
      {!trainAllSession && gradeDistribution.length > 0 ? (
        <section className={`${styles.card} ${styles.masteryDistributionCard}`}>
          <div className={styles.masteryDistributionHeader}>
            <span>Opening spread</span>
            <span>{deckLineMastery.length} openings</span>
          </div>
          <div
            aria-label={`Line metric spread: ${gradeDistribution.map((segment) => `${segment.grade} ${segment.percent}%`).join(', ')}`}
            className={styles.masteryDistributionBar}
            role="img"
          >
            {gradeDistribution.map((segment) => (
              <div
                className={`${styles.masteryDistributionSegment} ${styles[`masteryDistribution${segment.grade}`]}`}
                key={segment.grade}
                style={{ flex: `${segment.count} ${segment.count} 0` }}
                title={`${segment.grade} · ${segment.count} line${segment.count === 1 ? '' : 's'} · ${segment.percent}%`}
              />
            ))}
          </div>
          <div className={styles.masteryDistributionLegend}>
            {gradeDistribution.map((segment) => (
              <span className={styles.masteryDistributionLegendItem} key={segment.grade}>
                <span className={`${styles.masteryDistributionDot} ${styles[`masteryDistribution${segment.grade}`]}`} />
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
      className={styles.modalLayer}
      onMouseDown={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose();
        }
      }}
    >
      <section
        className={styles.importDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pgn-import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.sectionTitle} id="pgn-import-title">
              Import PGN
            </h2>
            <p className={styles.support}>Use this only when you want full-game review.</p>
          </div>
          <button className={styles.iconButton} onClick={onClose} title="Close import" type="button">
            X
          </button>
        </div>
        <div className={styles.pgnControls}>
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
        <input className={styles.hiddenInput} id="pgn-upload" type="file" accept=".pgn" onChange={handleUpload} />
        <textarea
          className={styles.pgnInput}
          value={pgnDraft}
          onChange={(event) => setPgnDraft(event.target.value)}
          placeholder={'[Event "Live Chess"]\n[White "LosValettos"]\n[Black "rafaelpiresrj"]\n\n1. e4 e5 2. Nf3 Nc6'}
          spellCheck={false}
        />
        <p className={styles.support}>{fileName || 'No PGN loaded'}</p>
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
    <section className={`${styles.card} ${styles.engineCard}`}>
      <div className={styles.panelHeader}>
        <h2 className={styles.sectionTitle}>Engine</h2>
        <span className={styles.statusText}>
          {positionLoading ? 'updating' : `depth ${positionAnalysis?.depth ?? '--'}`}
        </span>
      </div>
      <div className={styles.engineLines}>
        {lines.map((line) => (
          <div className={styles.engineLine} key={line.multipv}>
            <div className={styles.engineLineHead}>
              <span className={styles.engineRank}>#{line.multipv}</span>
              <strong>{line.bestMove ? formatBestMove(currentFen, line.bestMove) : '--'}</strong>
              <span>{formatLineScore(line)}</span>
            </div>
            <p className={styles.enginePv}>{formatPvLine(currentFen, line.pv)}</p>
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
      <span className={styles.movePieceIcon}>{icon}</span>
      <span className={styles.movePieceGap} aria-hidden="true" />
      <span className={styles.movePieceText}>{san.slice(1)}</span>
    </>
  );
}
