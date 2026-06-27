import { Chess } from 'chess.js';

import { restoreGameFromHistory, type StoredMove } from './chess-analysis-client.ts';
import { buildOpeningTrees, mergeOpeningTreeDelta, reconstructOpeningPathToNode } from './opening-graph.ts';

export type OpeningLibrary = 'e4' | 'd4' | 'c4' | 'nf3' | 'other';
export type OpeningSide = 'white' | 'black';
export type OpeningEdgeSource = 'recent_game' | 'card' | 'lichess_masters' | 'engine_best' | 'mixed';

export type OpeningMove = {
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  color: OpeningSide;
  ply: number;
};

export type OpeningTreeBuildInput = {
  id: string;
  name: string;
  trainSide: OpeningSide;
  moves: string[];
  source: 'recent_game' | 'card';
  count?: number;
  outcome?: 'win' | 'loss' | 'draw' | 'unknown';
  scoreSwingCp?: number | null;
};

export type OpeningTreeDraft = {
  id: string;
  name: string;
  library: OpeningLibrary;
  rootFenKey: string;
  rootPly: number;
  rootSan: string[];
  rootUci: string[];
  sourceCount: number;
  targetDepth: number;
  trainSide: OpeningSide;
  nodes: OpeningNodeDraft[];
  edges: OpeningEdgeDraft[];
};

export type OpeningDrillExpectedMove = {
  nodeId: string;
  uci: string | null;
  san: string | null;
  acceptedUcis: string[];
};

export type AcceptedTrainMoves = {
  primaryUci: string | null;
  primarySan: string | null;
  acceptedUcis: string[];
};

export type OpeningNodeDraft = {
  id: string;
  fen: string;
  fenKey: string;
  ply: number;
  sideToMove: OpeningSide;
  trainSide?: OpeningSide;
  bestUci?: string | null;
  bestSan?: string | null;
  evalCp?: number | null;
  recentGames: number;
  cardCount: number;
  winCount?: number;
  lossCount?: number;
  drawCount?: number;
};

export type OpeningEdgeDraft = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  uci: string;
  san: string;
  moveBy: OpeningSide;
  source: OpeningEdgeSource;
  recentCount: number;
  cardCount: number;
  mastersGames: number;
  priority: number;
  isEngineBest: boolean;
};

export type OpeningTreeSummary = {
  id: string;
  name: string;
  library: OpeningLibrary;
  rootFenKey: string;
  rootPly: number;
  rootSan: string[];
  rootUci: string[];
  sourceCount: number;
  targetDepth: number;
  nodeCount: number;
  dueCount: number;
  masteryScore: number;
  linesWhite?: number;
  linesBlack?: number;
  winCount?: number;
  lossCount?: number;
  drawCount?: number;
  whiteWinCount?: number;
  whiteLossCount?: number;
  whiteDrawCount?: number;
  blackWinCount?: number;
  blackLossCount?: number;
  blackDrawCount?: number;
  presencePercent?: number;
  openingEvalCp?: number | null;
  updatedAt: string | null;
};

export type OpeningTreeDetail = OpeningTreeSummary & {
  nodes: OpeningTreeNode[];
  edges: OpeningTreeEdge[];
};

export type OpeningTreeNode = {
  id: string;
  fen: string;
  fenKey: string;
  ply: number;
  sideToMove: OpeningSide;
  bestUci: string | null;
  bestSan: string | null;
  evalCp: number | null;
  recentGames: number;
  cardCount: number;
  winCount?: number;
  lossCount?: number;
  drawCount?: number;
  masteryScore: number;
  seenCount: number;
  correctCount: number;
  missCount: number;
};

export type OpeningTreeEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  uci: string;
  san: string;
  moveBy: OpeningSide;
  source: OpeningEdgeSource;
  recentCount: number;
  cardCount: number;
  mastersGames: number;
  priority: number;
  isEngineBest: boolean;
};

export type OpeningDrillStep = {
  treeId: string;
  pathNodeIds: string[];
  pathEdgeIds: string[];
  activeNodeId: string;
  fen: string;
  sideToMove: OpeningSide;
  expectedUci: string | null;
  expectedSan: string | null;
  depthRemaining: number;
};

export const DEFAULT_OPENING_ROOT_PLY = 0;
export const OPENING_TARGET_DEPTH_FAST = 12;
export const OPENING_TARGET_DEPTH_NORMAL = 22;
export const OPENING_TARGET_DEPTH_DEEP = 28;
export const OPENING_TARGET_DEPTH_EXTEND_DELTA = 4;
export const DEFAULT_OPENING_TARGET_DEPTH = OPENING_TARGET_DEPTH_NORMAL;
export const LINES_MOVE_EVAL_GATE_CP = 25;
export const LINES_REVIEW_DUE_MASTERY_THRESHOLD = 80;
export const LINES_WEAK_NODE_MASTERY_THRESHOLD = 60;

export type LinesStudyMode = 'idle' | 'learn' | 'review';
export const OPENING_ENRICH_STALE_DAYS = 7;

export type LinesMoveCategory = 'best' | 'book' | 'miss';

export function getOpeningTreeRootLength(tree: Pick<OpeningTreeDetail, 'rootPly' | 'rootSan'>): number {
  return tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0);
}

function getOpeningTreeBoardRootLength(tree: Pick<OpeningTreeDetail, 'rootPly' | 'rootSan' | 'rootUci'>): number {
  return Math.max(getOpeningTreeRootLength(tree), tree.rootUci.length);
}

export function classifyRootPrefixMove(
  tree: Pick<OpeningTreeDetail, 'rootPly' | 'rootSan' | 'rootUci'>,
  moveIndex: number,
  playedUci: string,
): LinesMoveCategory | null {
  const rootLength = getOpeningTreeBoardRootLength(tree);

  if (moveIndex < 0 || moveIndex >= rootLength) {
    return null;
  }

  const expectedUci = tree.rootUci[moveIndex];

  if (!expectedUci) {
    return 'book';
  }

  return playedUci === expectedUci ? 'book' : 'miss';
}

export type OpeningBuildMode = 'fast' | 'normal' | 'backfill' | 'extend_depth';

export type OpeningBuildState = {
  profileId: string;
  timeClass: string;
  lastImportedAt: string | null;
  newestGameEndTime: string | null;
  oldestArchiveCursor: string | null;
  processedGameIds: string[];
  buildMode: OpeningBuildMode;
  targetDepth: number;
};

export type ForkCoverageEntry = {
  nodeId: string;
  playedEdgeIds: string[];
  remainingEdgeIds: string[];
};

export type ForkCoverageMap = Record<string, ForkCoverageEntry>;

export type LinesSessionPhase =
  | 'idle'
  | 'replaying'
  | 'awaiting_train'
  | 'showing_feedback'
  | 'playing_opponent'
  | 'fork_pause'
  | 'branch_complete';

export type LinesSessionState = {
  phase: LinesSessionPhase;
  trainSide: OpeningSide;
  activeNodeId: string | null;
  forkCoverage: ForkCoverageMap;
  schedulerMode: 'full_line' | 'layer';
  seed: number;
};

export type LinesSchedulerAction =
  | { type: 'await_user' }
  | { type: 'play_opponent'; edgeId: string; edgeUci: string; toNodeId: string }
  | { type: 'branch_complete' }
  | { type: 'ascend_fork'; nodeId: string };

export function formatOpeningTreeDisplayName(name: string) {
  const cleanName = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanName) {
    return 'Opening';
  }

  const withoutEco = cleanName.replace(/^[A-E]\d{2}(?:-\d{2})?\s*:\s*/i, '').trim();
  const withoutMoves = withoutEco.replace(/\s+\d+\.(?:\.{2})?.+$/, '').trim();

  return withoutMoves || withoutEco || cleanName;
}

export function roundMasteryScore(score: number) {
  return Math.round(score * 100) / 100;
}

export function formatMasteryScoreLabel(score: number) {
  const rounded = roundMasteryScore(score);
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');

  return `${text}/100`;
}

export function resolveAcceptedTrainMoveUcis(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>,
  nodeId: string,
): AcceptedTrainMoves {
  const node = tree.nodes.find((candidate) => candidate.id === nodeId);

  if (!node) {
    return { primaryUci: null, primarySan: null, acceptedUcis: [] };
  }

  const repertoireEdges = tree.edges.filter((edge) => edge.fromNodeId === nodeId && isRepertoireEdge(edge));
  const sortedEdges = [...repertoireEdges].sort(
    (left, right) =>
      right.priority - left.priority || right.recentCount + right.cardCount - (left.recentCount + left.cardCount),
  );
  const primaryEdge = sortedEdges.find((edge) => edge.isEngineBest) ?? sortedEdges[0] ?? null;
  const acceptedUcis = new Set<string>();

  for (const edge of repertoireEdges) {
    acceptedUcis.add(edge.uci);
  }

  if (node.bestUci) {
    acceptedUcis.add(node.bestUci);
  }

  return {
    primaryUci: node.bestUci ?? primaryEdge?.uci ?? null,
    primarySan: node.bestSan ?? primaryEdge?.san ?? null,
    acceptedUcis: [...acceptedUcis],
  };
}

export function buildOpeningDrillExpected(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>,
  nodeId: string,
): OpeningDrillExpectedMove | null {
  const node = tree.nodes.find((candidate) => candidate.id === nodeId);

  if (!node) {
    return null;
  }

  const accepted = resolveAcceptedTrainMoveUcis(tree, nodeId);

  if (accepted.acceptedUcis.length === 0 && !accepted.primaryUci) {
    return null;
  }

  return {
    nodeId,
    uci: accepted.primaryUci,
    san: accepted.primarySan,
    acceptedUcis: accepted.acceptedUcis,
  };
}

export function buildLearnDrillExpectedFromStep(
  step: {
    nodeId: string;
    bestUci: string | null;
    bestSan: string | null;
  },
  tree?: Pick<OpeningTreeDetail, 'nodes' | 'edges'> | null,
): OpeningDrillExpectedMove | null {
  if (step.bestUci) {
    return {
      nodeId: step.nodeId,
      uci: step.bestUci,
      san: step.bestSan,
      acceptedUcis: [step.bestUci],
    };
  }

  if (!tree) {
    return null;
  }

  const accepted = resolveAcceptedTrainMoveUcis(tree, step.nodeId);

  if (!accepted.primaryUci) {
    return null;
  }

  return {
    nodeId: step.nodeId,
    uci: accepted.primaryUci,
    san: accepted.primarySan,
    acceptedUcis: [accepted.primaryUci],
  };
}

export function backfillTrainNodeBestUciFromRepertoire(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'> & { trainSide: OpeningSide },
): number {
  let updated = 0;

  for (const node of tree.nodes) {
    if (node.sideToMove !== tree.trainSide || node.bestUci) {
      continue;
    }

    const outgoing = tree.edges.filter((edge) => edge.fromNodeId === node.id && isRepertoireEdge(edge));

    if (outgoing.length === 0) {
      continue;
    }

    const ranked = [...outgoing].sort(
      (left, right) =>
        Number(right.isEngineBest) - Number(left.isEngineBest) ||
        right.recentCount - left.recentCount ||
        right.mastersGames - left.mastersGames ||
        right.cardCount - left.cardCount ||
        right.priority - left.priority,
    );
    const bestEdge = ranked[0];

    if (!bestEdge) {
      continue;
    }

    node.bestUci = bestEdge.uci;
    node.bestSan = bestEdge.san;
    updated += 1;
  }

  return updated;
}

export function isAcceptedOpeningDrillMove(_fenBefore: string, playedUci: string, acceptedUcis: string[]) {
  return acceptedUcis.includes(playedUci);
}

export function classifyOpeningDrillMove(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>,
  nodeId: string,
  _fenBefore: string,
  playedUci: string,
  expected: Pick<AcceptedTrainMoves, 'primaryUci' | 'acceptedUcis'> | null,
) {
  const lines = classifyLinesMove(tree, nodeId, playedUci, expected);
  return {
    correct: lines.category !== 'miss',
    exact: lines.category === 'best',
    category: lines.category,
    evalLossCp: lines.evalLossCp,
  };
}

export function isRepertoireEdge(
  edge: Pick<OpeningTreeEdge, 'recentCount' | 'cardCount' | 'mastersGames' | 'isEngineBest'>,
) {
  return edge.recentCount > 0 || edge.cardCount > 0 || edge.mastersGames > 0 || edge.isEngineBest;
}

export function resolveCanonicalRootNode(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'rootSan' | 'rootFenKey' | 'rootPly'>,
  rootPly: number = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : DEFAULT_OPENING_ROOT_PLY),
): OpeningTreeNode | null {
  if (tree.rootFenKey) {
    const byFenKey = tree.nodes.find((node) => node.fenKey === tree.rootFenKey && node.ply === rootPly);

    if (byFenKey) {
      return byFenKey;
    }
  }

  const candidates = tree.nodes.filter((node) => node.ply === rootPly);

  if (candidates.length === 0) {
    const fallbackPly = tree.rootPly ?? tree.rootSan.length;
    return tree.nodes.find((node) => node.ply === fallbackPly) ?? tree.nodes[0] ?? null;
  }

  return (
    [...candidates].sort(
      (left, right) => right.recentGames + right.cardCount - (left.recentGames + left.cardCount),
    )[0] ?? null
  );
}

export function isLegacyCatchAllOpeningTree(tree: Pick<OpeningTreeDetail, 'rootPly' | 'rootSan'>): boolean {
  const storedRootPly = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0);

  return storedRootPly === 0 && tree.rootSan.length === 0;
}

export function resolveOpeningTreeRootPly(
  tree: Pick<OpeningTreeDetail, 'rootPly' | 'rootSan'>,
  minForcedPlies: number,
): number {
  const storedRootPly = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0);

  if (storedRootPly === 0) {
    return storedRootPly;
  }

  const requestedForcedPlies = Math.max(1, minForcedPlies);

  return Math.min(storedRootPly, requestedForcedPlies);
}

export function filterOpeningTreeForDisplay(
  tree: OpeningTreeDetail,
  rootPly: number = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : DEFAULT_OPENING_ROOT_PLY),
): OpeningTreeDetail {
  const rootNode = resolveCanonicalRootNode(tree, rootPly);

  if (!rootNode) {
    return tree;
  }

  const repertoireEdges = tree.edges.filter((edge) => isRepertoireEdge(edge));
  const reachableNodeIds = new Set<string>([rootNode.id]);
  const queue = [rootNode.id];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const outgoing = repertoireEdges.filter((edge) => edge.fromNodeId === currentId);

    for (const edge of outgoing) {
      if (!reachableNodeIds.has(edge.toNodeId)) {
        reachableNodeIds.add(edge.toNodeId);
        queue.push(edge.toNodeId);
      }
    }
  }

  const nodes = tree.nodes.filter((node) => reachableNodeIds.has(node.id));
  const edges = repertoireEdges.filter(
    (edge) => reachableNodeIds.has(edge.fromNodeId) && reachableNodeIds.has(edge.toNodeId),
  );
  const trainNodes = nodes.filter((node) => node.masteryScore > 0 || node.seenCount > 0);
  const masteryScore =
    trainNodes.length > 0 ? trainNodes.reduce((sum, node) => sum + node.masteryScore, 0) / trainNodes.length : 0;

  return {
    ...tree,
    rootSan: tree.rootSan,
    rootUci: tree.rootUci,
    sourceCount: rootNode.recentGames + rootNode.cardCount,
    nodeCount: nodes.length,
    dueCount: nodes.filter((node) => node.masteryScore < LINES_REVIEW_DUE_MASTERY_THRESHOLD).length,
    masteryScore: roundMasteryScore(masteryScore),
    nodes,
    edges,
  };
}

export function pruneOpeningTreeDraft(draft: OpeningTreeDraft): OpeningTreeDraft {
  const rootNode = resolveCanonicalRootNode(
    {
      rootFenKey: draft.rootFenKey,
      rootPly: draft.rootPly,
      rootSan: draft.rootSan,
      nodes: draft.nodes.map((node) => ({
        ...node,
        bestUci: node.bestUci ?? null,
        bestSan: node.bestSan ?? null,
        evalCp: node.evalCp ?? null,
        masteryScore: 0,
        seenCount: 0,
        correctCount: 0,
        missCount: 0,
      })),
    },
    draft.rootPly,
  );

  if (!rootNode) {
    return draft;
  }

  const repertoireEdges = draft.edges.filter((edge) => isRepertoireEdge(edge));
  const reachableNodeIds = new Set<string>([rootNode.id]);
  const queue = [rootNode.id];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const outgoing = repertoireEdges.filter((edge) => edge.fromNodeId === currentId);

    for (const edge of outgoing) {
      if (!reachableNodeIds.has(edge.toNodeId)) {
        reachableNodeIds.add(edge.toNodeId);
        queue.push(edge.toNodeId);
      }
    }
  }

  draft.nodes = draft.nodes.filter((node) => reachableNodeIds.has(node.id));
  draft.edges = repertoireEdges.filter(
    (edge) => reachableNodeIds.has(edge.fromNodeId) && reachableNodeIds.has(edge.toNodeId),
  );

  return draft;
}

export function classifyLinesMove(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>,
  nodeId: string,
  playedUci: string,
  expected: Pick<AcceptedTrainMoves, 'primaryUci' | 'acceptedUcis'> | null = null,
): { category: LinesMoveCategory; evalLossCp: number | null } {
  const resolved = expected ?? resolveAcceptedTrainMoveUcis(tree, nodeId);
  const primaryUci = resolved.primaryUci;
  const edge = tree.edges.find((candidate) => candidate.fromNodeId === nodeId && candidate.uci === playedUci);

  if (primaryUci != null && playedUci === primaryUci) {
    return { category: 'best', evalLossCp: 0 };
  }

  if (expected != null && expected.acceptedUcis.length > 0 && !expected.acceptedUcis.includes(playedUci)) {
    return {
      category: 'miss',
      evalLossCp: computeTrainMoveEvalLossCp(tree, nodeId, playedUci, expected.acceptedUcis),
    };
  }

  if (edge && isRepertoireEdge(edge)) {
    return { category: 'book', evalLossCp: null };
  }

  if (resolved.acceptedUcis.includes(playedUci)) {
    return { category: 'book', evalLossCp: null };
  }

  const evalLossCp = computeTrainMoveEvalLossCp(tree, nodeId, playedUci, resolved.acceptedUcis);

  if (evalLossCp != null && evalLossCp <= LINES_MOVE_EVAL_GATE_CP) {
    return { category: 'book', evalLossCp };
  }

  return { category: 'miss', evalLossCp };
}

function computeTrainMoveEvalLossCp(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>,
  nodeId: string,
  playedUci: string,
  acceptedUcis: string[],
): number | null {
  const node = tree.nodes.find((candidate) => candidate.id === nodeId);

  if (!node) {
    return null;
  }

  const swings = acceptedUcis
    .map((uci) => {
      const edge = tree.edges.find((candidate) => candidate.fromNodeId === nodeId && candidate.uci === uci);
      const target = edge ? tree.nodes.find((candidate) => candidate.id === edge.toNodeId) : null;
      return target ? evalSwingCp(node, target) : null;
    })
    .filter((swing): swing is number => swing != null);

  if (swings.length === 0) {
    return null;
  }

  const playedEdge = tree.edges.find((candidate) => candidate.fromNodeId === nodeId && candidate.uci === playedUci);
  const playedTarget = playedEdge ? tree.nodes.find((candidate) => candidate.id === playedEdge.toNodeId) : null;
  const playedSwing = playedTarget ? evalSwingCp(node, playedTarget) : null;

  if (playedSwing == null) {
    return null;
  }

  const bestSwing = Math.max(...swings);
  return Math.max(0, Math.round(bestSwing - playedSwing));
}

function evalSwingCp(
  node: OpeningTreeNode | OpeningNodeDraft,
  target: OpeningTreeNode | OpeningNodeDraft,
): number | null {
  if (node.evalCp == null || target.evalCp == null) {
    return null;
  }

  return node.sideToMove === 'white' ? target.evalCp - node.evalCp : node.evalCp - target.evalCp;
}

export function mapOpeningLibraryToDb(library: OpeningLibrary): string {
  switch (library) {
    case 'e4':
      return 'e4';
    case 'd4':
      return 'd4';
    case 'c4':
      return 'c4';
    case 'nf3':
      return 'nf3';
    case 'other':
      return 'other';
  }
}

export function mapOpeningLibraryFromDb(value: unknown): OpeningLibrary {
  if (value === 'e4' || value === 'd4' || value === 'c4' || value === 'nf3' || value === 'other') {
    return value;
  }

  if (value === 'white') {
    return 'e4';
  }

  if (value === 'black_vs_e4') {
    return 'e4';
  }

  if (value === 'black_vs_d4') {
    return 'd4';
  }

  if (value === 'black_vs_c4') {
    return 'c4';
  }

  if (value === 'black_vs_n_f3') {
    return 'nf3';
  }

  return 'other';
}

export function resolveTargetDepthForBuildMode(
  mode: OpeningBuildMode,
  currentDepth: number = DEFAULT_OPENING_TARGET_DEPTH,
): number {
  switch (mode) {
    case 'fast':
      return OPENING_TARGET_DEPTH_FAST;
    case 'normal':
      return OPENING_TARGET_DEPTH_NORMAL;
    case 'backfill':
      return OPENING_TARGET_DEPTH_DEEP;
    case 'extend_depth':
      return Math.min(OPENING_TARGET_DEPTH_DEEP, currentDepth + OPENING_TARGET_DEPTH_EXTEND_DELTA);
  }
}

export function buildForkCoverage(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>,
  trainSide: OpeningSide,
): ForkCoverageMap {
  const coverage: ForkCoverageMap = {};

  for (const node of tree.nodes) {
    if (node.sideToMove === trainSide) {
      continue;
    }

    const outgoing = tree.edges.filter((edge) => edge.fromNodeId === node.id);

    if (outgoing.length < 2) {
      continue;
    }

    coverage[node.id] = {
      nodeId: node.id,
      playedEdgeIds: [],
      remainingEdgeIds: outgoing.map((edge) => edge.id),
    };
  }

  return coverage;
}

export function markForkEdgePlayed(coverage: ForkCoverageMap, nodeId: string, edgeId: string): ForkCoverageMap {
  const entry = coverage[nodeId];

  if (!entry) {
    return coverage;
  }

  const playedEdgeIds = entry.playedEdgeIds.includes(edgeId) ? entry.playedEdgeIds : [...entry.playedEdgeIds, edgeId];
  const remainingEdgeIds = entry.remainingEdgeIds.filter((candidate) => candidate !== edgeId);

  return {
    ...coverage,
    [nodeId]: {
      ...entry,
      playedEdgeIds,
      remainingEdgeIds,
    },
  };
}

export function findNearestOpenFork(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>,
  coverage: ForkCoverageMap,
  fromNodeId: string,
): ForkCoverageEntry | null {
  const parentByChild = new Map<string, string>();

  for (const edge of tree.edges) {
    parentByChild.set(edge.toNodeId, edge.fromNodeId);
  }

  let currentId: string | null = fromNodeId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const entry = coverage[currentId];

    if (entry && entry.remainingEdgeIds.length > 0) {
      return entry;
    }

    currentId = parentByChild.get(currentId) ?? null;
  }

  return null;
}

export function pickNextUnplayedOpponentEdge(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>,
  coverage: ForkCoverageMap,
  nodeId: string,
  seed: number,
): OpeningTreeEdge | null {
  const entry = coverage[nodeId];

  if (!entry || entry.remainingEdgeIds.length === 0) {
    return null;
  }

  const remaining = tree.edges.filter((edge) => entry.remainingEdgeIds.includes(edge.id));
  return chooseWeightedOpponentEdge(remaining, seed);
}

export function pickFullLineTargetNodeId(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'targetDepth' | 'rootSan' | 'rootPly' | 'rootFenKey'>,
  options: { trainSide: OpeningSide; preferWeak?: boolean; seed?: number; startNodeId?: string },
): string | null {
  const path = buildDrillPath(tree, options);
  const lastStep = path[path.length - 1];
  return lastStep?.nodeId ?? null;
}

export function pickNextSchedulerAction(tree: OpeningTreeDetail, session: LinesSessionState): LinesSchedulerAction {
  const node = session.activeNodeId ? tree.nodes.find((candidate) => candidate.id === session.activeNodeId) : null;

  if (!node) {
    return { type: 'branch_complete' };
  }

  const openFork = findNearestOpenFork(tree, session.forkCoverage, node.id);

  if (openFork && openFork.remainingEdgeIds.length > 0 && session.schedulerMode === 'layer') {
    const edge = pickNextUnplayedOpponentEdge(tree, session.forkCoverage, openFork.nodeId, session.seed);

    if (edge) {
      return {
        type: 'play_opponent',
        edgeId: edge.id,
        edgeUci: edge.uci,
        toNodeId: edge.toNodeId,
      };
    }
  }

  if (node.sideToMove === session.trainSide) {
    return { type: 'await_user' };
  }

  const outgoing = tree.edges.filter((edge) => edge.fromNodeId === node.id);

  if (outgoing.length === 0) {
    const fork = findNearestOpenFork(tree, session.forkCoverage, node.id);

    if (fork) {
      return { type: 'ascend_fork', nodeId: fork.nodeId };
    }

    return { type: 'branch_complete' };
  }

  const forkEntry = session.forkCoverage[node.id];

  if (forkEntry && forkEntry.remainingEdgeIds.length > 0) {
    const edge = pickNextUnplayedOpponentEdge(tree, session.forkCoverage, node.id, session.seed);

    if (edge) {
      return {
        type: 'play_opponent',
        edgeId: edge.id,
        edgeUci: edge.uci,
        toNodeId: edge.toNodeId,
      };
    }
  }

  const edge = chooseWeightedOpponentEdge(outgoing, session.seed);

  if (!edge) {
    return { type: 'branch_complete' };
  }

  return {
    type: 'play_opponent',
    edgeId: edge.id,
    edgeUci: edge.uci,
    toNodeId: edge.toNodeId,
  };
}

export function resolveOpeningNodeFromHistory(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'rootSan' | 'rootPly' | 'rootFenKey' | 'rootUci'>,
  moveHistory: Array<{ uci: string }>,
  historyIndex: number,
): { nodeId: string | null; plyInTree: number } {
  const rootTreePly = getOpeningTreeRootLength(tree);
  const rootMoveCount = getOpeningTreeBoardRootLength(tree);
  const rootMoveOffset = Math.max(0, rootMoveCount - rootTreePly);
  const boundedIndex = Math.max(0, Math.min(historyIndex, moveHistory.length));

  for (let index = 0; index < boundedIndex && index < rootMoveCount; index += 1) {
    const move = moveHistory[index];
    const expectedUci = tree.rootUci[index];

    if (!move) {
      return { nodeId: null, plyInTree: index };
    }

    if (expectedUci && move.uci !== expectedUci) {
      break;
    }
  }

  if (boundedIndex < rootMoveCount) {
    const plyInTree = Math.max(0, boundedIndex - rootMoveOffset);
    const nodeAtPly = tree.nodes.find((candidate) => candidate.ply === plyInTree);

    if (nodeAtPly) {
      return { nodeId: nodeAtPly.id, plyInTree };
    }

    return { nodeId: null, plyInTree };
  }

  if (boundedIndex === rootMoveCount) {
    const rootNode = resolveCanonicalRootNode(tree, rootTreePly);

    return { nodeId: rootNode?.id ?? null, plyInTree: rootTreePly };
  }

  let currentNode = resolveCanonicalRootNode(tree, rootTreePly);

  for (let index = rootMoveCount; index < boundedIndex; index += 1) {
    const move = moveHistory[index];

    if (!move || !currentNode) {
      break;
    }

    const edge = tree.edges.find((candidate) => candidate.fromNodeId === currentNode!.id && candidate.uci === move.uci);
    const nextNode = edge ? tree.nodes.find((candidate) => candidate.id === edge.toNodeId) : null;

    if (!nextNode) {
      return { nodeId: currentNode.id, plyInTree: Math.max(0, index - rootMoveOffset) };
    }

    currentNode = nextNode;
  }

  return { nodeId: currentNode?.id ?? null, plyInTree: Math.max(0, boundedIndex - rootMoveOffset) };
}

export function classifyBoardMoveAtHistoryIndex(
  tree: OpeningTreeDetail,
  moveHistory: Array<{ uci: string }>,
  historyIndex: number,
  trainSide: OpeningSide,
): { moveUci: string; category: LinesMoveCategory; evalLossCp: number | null } | null {
  if (historyIndex <= 0 || historyIndex > moveHistory.length) {
    return null;
  }

  const moveIndex = historyIndex - 1;
  const move = moveHistory[moveIndex];

  if (!move) {
    return null;
  }

  const rootLength = getOpeningTreeBoardRootLength(tree);

  if (moveIndex < rootLength) {
    const prefixCategory = classifyRootPrefixMove(tree, moveIndex, move.uci);

    if (!prefixCategory) {
      return null;
    }

    return { moveUci: move.uci, category: prefixCategory, evalLossCp: null };
  }

  const { nodeId } = resolveOpeningNodeFromHistory(tree, moveHistory, moveIndex);

  if (!nodeId) {
    return null;
  }

  const node = tree.nodes.find((candidate) => candidate.id === nodeId);

  if (!node) {
    return null;
  }

  if (node.sideToMove === trainSide) {
    const classified = classifyLinesMove(tree, nodeId, move.uci);

    return {
      moveUci: move.uci,
      category: classified.category,
      evalLossCp: classified.evalLossCp,
    };
  }

  const edge = tree.edges.find((candidate) => candidate.fromNodeId === nodeId && candidate.uci === move.uci);

  return {
    moveUci: move.uci,
    category: edge ? 'book' : 'miss',
    evalLossCp: null,
  };
}

export function classifyLinesMoveAtHistoryIndex(
  tree: OpeningTreeDetail,
  moveHistory: Array<{ uci: string }>,
  historyIndex: number,
  trainSide: OpeningSide,
): { moveUci: string; category: LinesMoveCategory; evalLossCp: number | null } | null {
  return classifyBoardMoveAtHistoryIndex(tree, moveHistory, historyIndex, trainSide);
}

export function linesMoveCategoryToReviewCategory(category: LinesMoveCategory) {
  switch (category) {
    case 'best':
      return 'best' as const;
    case 'book':
      return 'book' as const;
    case 'miss':
      return 'miss' as const;
  }
}

export function createLinesSession(
  tree: OpeningTreeDetail,
  trainSide: OpeningSide,
  startNodeId?: string | null,
): LinesSessionState {
  const rootNode = startNodeId
    ? tree.nodes.find((node) => node.id === startNodeId)
    : resolveCanonicalRootNode(tree, tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0));

  return {
    phase: 'idle',
    trainSide,
    activeNodeId: rootNode?.id ?? null,
    forkCoverage: buildForkCoverage(tree, trainSide),
    schedulerMode: 'full_line',
    seed: Date.now(),
  };
}

export function maxLinePliesForTree(tree: Pick<OpeningTreeDetail, 'targetDepth' | 'rootSan' | 'rootPly'>): number {
  const rootPly = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0);

  return Math.max(0, tree.targetDepth - rootPly);
}

export type OpeningTreeDraftPreload = {
  draft: OpeningTreeDraft;
  nodeRows: Array<Record<string, unknown>>;
  edgeRows: Array<Record<string, unknown>>;
};

export function draftFromPreloadedTree(
  treeRow: Record<string, unknown>,
  nodeRows: Array<Record<string, unknown>>,
  edgeRows: Array<Record<string, unknown>>,
): OpeningTreeDraft {
  const treeId = String(treeRow.id);

  return {
    id: treeId,
    name: String(treeRow.name ?? 'Opening'),
    library: mapOpeningLibraryFromDb(treeRow.library),
    rootFenKey: String(treeRow.root_fen_key ?? treeRow.rootFenKey ?? ''),
    rootPly: Number(treeRow.root_ply ?? treeRow.rootPly ?? DEFAULT_OPENING_ROOT_PLY),
    rootSan: Array.isArray(treeRow.root_san) ? treeRow.root_san.map(String) : [],
    rootUci: Array.isArray(treeRow.root_uci) ? treeRow.root_uci.map(String) : [],
    sourceCount: Number(treeRow.source_count ?? 0),
    targetDepth: Number(treeRow.target_depth ?? DEFAULT_OPENING_TARGET_DEPTH),
    trainSide: 'white',
    nodes: nodeRows.map((row) => ({
      id: String(row.id),
      fen: String(row.fen),
      fenKey: String(row.fen_key),
      ply: Number(row.ply ?? 0),
      sideToMove: row.side_to_move === 'black' ? 'black' : 'white',
      trainSide: row.train_side === 'black' ? 'black' : 'white',
      bestUci: row.best_uci ? String(row.best_uci) : null,
      bestSan: row.best_san ? String(row.best_san) : null,
      evalCp: row.eval_cp == null ? null : Number(row.eval_cp),
      recentGames: Number(row.recent_games ?? 0),
      cardCount: Number(row.card_count ?? 0),
    })),
    edges: edgeRows.map((row) => ({
      id: String(row.id),
      fromNodeId: String(row.from_node_id),
      toNodeId: String(row.to_node_id),
      uci: String(row.uci),
      san: String(row.san),
      moveBy: row.move_by === 'black' ? 'black' : 'white',
      source:
        row.source === 'card' ||
        row.source === 'lichess_masters' ||
        row.source === 'engine_best' ||
        row.source === 'mixed'
          ? row.source
          : 'recent_game',
      recentCount: Number(row.recent_count ?? 0),
      cardCount: Number(row.card_count ?? 0),
      mastersGames: Number(row.masters_games ?? 0),
      priority: Number(row.priority ?? 0),
      isEngineBest: Boolean(row.is_engine_best),
    })),
  };
}

export { buildOpeningTrees, mergeOpeningTreeDelta };

export function shouldSkipNodeEnrichment(_node: OpeningNodeDraft, _staleBeforeMs: number): boolean {
  return false;
}

export function shouldEnrichNodeLazy(node: OpeningNodeDraft, trainSide: OpeningSide, mode: OpeningBuildMode): boolean {
  if (mode === 'fast') {
    return false;
  }

  return node.sideToMove === trainSide;
}

export function buildOpeningTreesIncremental(
  existing: OpeningTreeDraft,
  deltaInputs: OpeningTreeBuildInput[],
  options: { ownerProfileId: string; targetDepth: number; rootPly: number },
) {
  return mergeOpeningTreeDelta(existing, deltaInputs, options);
}

export function normalizeOpeningFen(fen: string) {
  return fen.trim().split(' ').slice(0, 4).join(' ');
}

export const STANDARD_START_FEN_KEY = normalizeOpeningFen(new Chess().fen());

export function isStandardStartFenKey(fenKey: string) {
  return fenKey === STANDARD_START_FEN_KEY;
}

export function resolveLinesBoardContext(
  boardFen: string,
  moveHistory: StoredMove[],
  historyIndex: number,
  initialFen: string | null = null,
): { fenKey: string; boardHistory: StoredMove[]; historyIndex: number } {
  const boardFenKey = normalizeOpeningFen(boardFen);
  const historyFenKey = normalizeOpeningFen(restoreGameFromHistory(moveHistory, initialFen, historyIndex).fen());

  if (historyFenKey === boardFenKey) {
    return {
      fenKey: boardFenKey,
      boardHistory: moveHistory.slice(0, historyIndex),
      historyIndex,
    };
  }

  for (let candidate = moveHistory.length; candidate >= 0; candidate -= 1) {
    const candidateFenKey = normalizeOpeningFen(restoreGameFromHistory(moveHistory, initialFen, candidate).fen());

    if (candidateFenKey === boardFenKey) {
      return {
        fenKey: boardFenKey,
        boardHistory: moveHistory.slice(0, candidate),
        historyIndex: candidate,
      };
    }
  }

  return {
    fenKey: boardFenKey,
    boardHistory: moveHistory.slice(0, historyIndex),
    historyIndex,
  };
}

export function filterOpeningTreeSummariesByIds(
  trees: OpeningTreeSummary[],
  treeIds: string[] | null,
): OpeningTreeSummary[] {
  if (treeIds == null) {
    return trees;
  }

  const allowedTreeIds = new Set(treeIds);

  return trees.filter((tree) => allowedTreeIds.has(tree.id));
}

export function prepareOpeningTreeAtFen(tree: OpeningTreeDetail, fenKey: string): OpeningTreeDetail | null {
  const node = tree.nodes.find((candidate) => candidate.fenKey === fenKey);

  if (!node) {
    if (tree.rootFenKey !== fenKey) {
      return null;
    }

    return tree;
  }

  const filtered = filterOpeningTreeForDisplay(tree, node.ply);

  return {
    ...filtered,
    rootPly: node.ply,
    rootFenKey: fenKey,
    rootSan: tree.rootSan,
    rootUci: tree.rootUci,
  };
}

export function prepareOpeningTreeAtFenWithBoard(
  tree: OpeningTreeDetail,
  fenKey: string,
  moveHistory: Array<{ san: string; uci: string }>,
  historyIndex: number,
): OpeningTreeDetail | null {
  const node = tree.nodes.find((candidate) => candidate.fenKey === fenKey);

  if (!node) {
    return null;
  }

  const filtered = filterOpeningTreeForDisplay(tree, node.ply);
  const boardSans = moveHistory.slice(0, historyIndex).map((move) => move.san);
  const boardUcis = moveHistory.slice(0, historyIndex).map((move) => move.uci);

  return {
    ...filtered,
    name: boardSans.length > 0 ? boardSans.join(' ') : tree.name,
    rootPly: node.ply,
    rootFenKey: fenKey,
    rootSan: boardSans,
    rootUci: boardUcis,
  };
}

export function alignOpeningTreeWithBoardPosition(
  tree: OpeningTreeDetail,
  moveHistory: Array<{ san: string; uci: string }>,
  historyIndex: number,
  initialFen: string | null = null,
): OpeningTreeDetail | null {
  if (historyIndex <= 0) {
    return tree;
  }

  const chess = initialFen ? new Chess(initialFen) : new Chess();

  for (let index = 0; index < historyIndex; index += 1) {
    const uci = moveHistory[index]?.uci;

    if (!uci) {
      return tree;
    }

    chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      ...(uci[4] ? { promotion: uci[4] } : {}),
    });
  }

  const fenKey = normalizeOpeningFen(chess.fen());
  const prepared = prepareOpeningTreeAtFenWithBoard(tree, fenKey, moveHistory, historyIndex);

  if (!prepared) {
    return null;
  }

  return ensureOpeningTreeRootPrefix(prepared);
}

export function ensureOpeningTreeRootPrefix(tree: OpeningTreeDetail): OpeningTreeDetail {
  const rootPly = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0);
  const rootNode = resolveCanonicalRootNode(tree, rootPly);

  if (!rootNode) {
    return tree;
  }

  const chess = new Chess();
  let rootUciMatchesRootFen = true;

  for (const uci of tree.rootUci) {
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        ...(uci[4] ? { promotion: uci[4] } : {}),
      });

      if (!move) {
        rootUciMatchesRootFen = false;
        break;
      }
    } catch {
      rootUciMatchesRootFen = false;
      break;
    }
  }

  const rootNodeFenKey = normalizeOpeningFen(rootNode.fen);

  if (rootUciMatchesRootFen && normalizeOpeningFen(chess.fen()) === rootNodeFenKey) {
    return tree;
  }

  const reconstructed = reconstructOpeningPathToNode(
    rootNode.id,
    tree.nodes,
    tree.edges.filter((edge) => isRepertoireEdge(edge)),
  );

  if (!reconstructed || reconstructed.uci.length !== rootNode.ply) {
    return tree;
  }

  return {
    ...tree,
    name: reconstructed.san.length > 0 ? reconstructed.san.join(' ') : tree.name,
    rootSan: reconstructed.san,
    rootUci: reconstructed.uci,
    rootFenKey: rootNode.fenKey,
    rootPly: rootNode.ply,
  };
}

export function buildLearnDrillStartupUcis(
  tree: OpeningTreeDetail,
  path: DrillPathStep[],
  firstTrainIndex: number,
): string[] {
  const treeReady = ensureOpeningTreeRootPrefix(tree);
  const targetStep = path[firstTrainIndex];

  if (!targetStep) {
    return [...treeReady.rootUci];
  }

  const targetFenKey = normalizeOpeningFen(targetStep.fen);
  const startupUcis = [...treeReady.rootUci];
  const chess = new Chess();

  for (const uci of startupUcis) {
    chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      ...(uci[4] ? { promotion: uci[4] } : {}),
    });
  }

  if (normalizeOpeningFen(chess.fen()) === targetFenKey) {
    return startupUcis;
  }

  const reconstructed = reconstructOpeningPathToNode(
    targetStep.nodeId,
    treeReady.nodes,
    treeReady.edges.filter((edge) => isRepertoireEdge(edge)),
  );

  if (reconstructed && reconstructed.uci.length > 0) {
    return reconstructed.uci;
  }

  for (let index = 1; index <= firstTrainIndex; index += 1) {
    const uci = path[index]?.edgeUciFromParent;

    if (!uci || startupUcis.includes(uci)) {
      continue;
    }

    startupUcis.push(uci);
    chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      ...(uci[4] ? { promotion: uci[4] } : {}),
    });

    if (normalizeOpeningFen(chess.fen()) === targetFenKey) {
      return startupUcis;
    }
  }

  return startupUcis;
}

export function parseSanMoves(moves: string[], initialFen: string | null = null): OpeningMove[] {
  const chess = initialFen ? new Chess(initialFen) : new Chess();
  const parsed: OpeningMove[] = [];

  for (const rawMove of moves) {
    const token = String(rawMove ?? '').trim();

    if (!token) {
      continue;
    }

    const fenBefore = chess.fen();
    const sideToMove = chess.turn() === 'w' ? 'white' : 'black';
    const move = chess.move(token);

    if (!move) {
      break;
    }

    parsed.push({
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion ?? ''}`,
      fenBefore,
      fenAfter: chess.fen(),
      color: sideToMove,
      ply: parsed.length + 1,
    });
  }

  return parsed;
}

export function tokenizePgnMoves(text: string) {
  return text
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\{[^}]*}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/^\d+\.(\.\.)?$/.test(token))
    .filter((token) => !/^\d+\.\.\.$/.test(token))
    .filter((token) => !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token))
    .map((token) => token.replace(/^\d+\.+/, ''))
    .filter(Boolean);
}

export function resolveOpeningLibrary(parsedMoves: OpeningMove[]): OpeningLibrary {
  const firstMove = parsedMoves[0]?.uci;

  if (firstMove === 'e2e4') {
    return 'e4';
  }

  if (firstMove === 'd2d4') {
    return 'd4';
  }

  if (firstMove === 'c2c4') {
    return 'c4';
  }

  if (firstMove === 'g1f3') {
    return 'nf3';
  }

  return 'other';
}

export function chooseWeightedOpponentEdge(edges: OpeningTreeEdge[], seed = Date.now()) {
  const weighted = edges.map((edge) => ({
    edge,
    weight: Math.max(1, edge.priority + edge.recentCount * 3 + edge.cardCount * 6 + (edge.isEngineBest ? 4 : 0)),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = seededUnit(seed) * total;

  for (const item of weighted) {
    roll -= item.weight;

    if (roll <= 0) {
      return item.edge;
    }
  }

  return weighted[0]?.edge ?? null;
}

export function rankOpponentEdgesForDrill(outgoing: OpeningTreeEdge[]): OpeningTreeEdge[] {
  const repertoire = outgoing.filter((edge) => isRepertoireEdge(edge));
  const pool = repertoire.length > 0 ? repertoire : outgoing;

  return [...pool].sort(
    (left, right) =>
      right.recentCount - left.recentCount ||
      right.mastersGames - left.mastersGames ||
      Number(right.isEngineBest) - Number(left.isEngineBest) ||
      right.priority - left.priority,
  );
}

export function listOpponentNodesForLichessEnrichment(
  draft: Pick<OpeningTreeDraft, 'nodes' | 'edges' | 'trainSide'>,
): OpeningNodeDraft[] {
  return draft.nodes.filter((node) => {
    if (node.sideToMove === draft.trainSide) {
      return false;
    }

    if (node.recentGames > 0) {
      return true;
    }

    return draft.edges.some((edge) => edge.toNodeId === node.id && isRepertoireEdge(edge));
  });
}

export function listOpponentNodesNeedingBookEnrichment(
  draft: Pick<OpeningTreeDraft, 'nodes' | 'edges' | 'trainSide'>,
): OpeningNodeDraft[] {
  return listOpponentNodesForLichessEnrichment(draft).filter(
    (node) => !draft.edges.some((edge) => edge.fromNodeId === node.id && isRepertoireEdge(edge)),
  );
}

function rankTrainEdgesForDrill(
  outgoing: OpeningTreeEdge[],
  _tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>,
  node: OpeningTreeNode,
): OpeningTreeEdge[] {
  const bestEdge = node.bestUci ? outgoing.find((edge) => edge.uci === node.bestUci) : null;

  if (!bestEdge) {
    return [];
  }

  return [bestEdge];
}

function pickDrillOutgoingEdge(
  outgoing: OpeningTreeEdge[],
  options: {
    isTrainTurn: boolean;
    forcedUci?: string;
    visited: Set<string>;
    tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>;
    node: OpeningTreeNode;
  },
): OpeningTreeEdge | null {
  if (options.forcedUci) {
    const forcedEdge = outgoing.find((edge) => edge.uci === options.forcedUci) ?? null;

    if (!forcedEdge || options.visited.has(forcedEdge.toNodeId)) {
      return null;
    }

    return forcedEdge;
  }

  const ranked = options.isTrainTurn
    ? rankTrainEdgesForDrill(outgoing, options.tree, options.node)
    : rankOpponentEdgesForDrill(outgoing);

  for (const edge of ranked) {
    if (!options.visited.has(edge.toNodeId)) {
      return edge;
    }
  }

  return ranked.find((edge) => edge.isEngineBest) ?? null;
}

export function countTrainPliesInDrillPath(path: DrillPathStep[]): number {
  return path.filter((step) => step.isTrainTurn).length;
}

export function findLastTrainStepIndexInDrillPath(path: DrillPathStep[]): number {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (path[index]?.isTrainTurn) {
      return index;
    }
  }

  return -1;
}

export function isTrainableReviewNode(tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>, nodeId: string): boolean {
  return resolveAcceptedTrainMoveUcis(tree, nodeId).acceptedUcis.length > 0;
}

type ReviewTree = Pick<OpeningTreeDetail, 'nodes' | 'edges'> &
  Partial<Pick<OpeningTreeDetail, 'rootFenKey' | 'rootPly' | 'rootSan'>>;

export type ReviewPathOptions = {
  trainSide: OpeningSide;
  bestTrainMovesOnly: true;
};

function isReviewPathEdge(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>,
  edge: OpeningTreeEdge,
  trainSide: OpeningSide,
) {
  if (!isRepertoireEdge(edge)) {
    return false;
  }

  const sourceNode = tree.nodes.find((node) => node.id === edge.fromNodeId);

  if (!sourceNode || sourceNode.sideToMove !== trainSide) {
    return true;
  }

  const expectedUci = sourceNode.bestUci ?? resolveAcceptedTrainMoveUcis(tree, sourceNode.id).primaryUci;
  return expectedUci != null && edge.uci === expectedUci;
}

function collectReviewReachableNodeIds(tree: ReviewTree, trainSide: OpeningSide): Set<string> | null {
  const rootPly = tree.rootPly ?? tree.rootSan?.length;

  if (rootPly == null) {
    return null;
  }

  const rootNode = tree.rootFenKey
    ? tree.nodes.find((node) => node.fenKey === tree.rootFenKey && node.ply === rootPly)
    : tree.nodes.find((node) => node.ply === rootPly);

  if (!rootNode) {
    return null;
  }

  const reachable = new Set<string>([rootNode.id]);
  const queue = [rootNode.id];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;

    for (const edge of tree.edges) {
      if (edge.fromNodeId !== nodeId || reachable.has(edge.toNodeId) || !isReviewPathEdge(tree, edge, trainSide)) {
        continue;
      }

      reachable.add(edge.toNodeId);
      queue.push(edge.toNodeId);
    }
  }

  return reachable;
}

export function countReviewDueNodes(tree: ReviewTree, trainSide: OpeningSide): number {
  return buildReviewQueue(tree, trainSide).length;
}

export function buildReviewQueue(tree: ReviewTree, trainSide: OpeningSide): string[] {
  const reachableNodeIds = collectReviewReachableNodeIds(tree, trainSide);

  return tree.nodes
    .filter(
      (node) =>
        (reachableNodeIds == null || reachableNodeIds.has(node.id)) &&
        node.sideToMove === trainSide &&
        node.masteryScore < LINES_REVIEW_DUE_MASTERY_THRESHOLD &&
        isTrainableReviewNode(tree, node.id),
    )
    .sort((left, right) => left.masteryScore - right.masteryScore || left.ply - right.ply)
    .map((node) => node.id);
}

export function resolveReviewAdvance(
  queue: string[],
  currentIndex: number,
): { kind: 'complete' } | { kind: 'next'; nextIndex: number; nextNodeId: string } {
  const nextIndex = currentIndex + 1;

  if (nextIndex >= queue.length) {
    return { kind: 'complete' };
  }

  const nextNodeId = queue[nextIndex];

  if (!nextNodeId) {
    return { kind: 'complete' };
  }

  return { kind: 'next', nextIndex, nextNodeId };
}

export function replayToNodeUcis(tree: OpeningTreeDetail, nodeId: string, options?: ReviewPathOptions): string[] {
  const path = findPathToNode(tree, nodeId, options);

  if (path.length === 0) {
    return [];
  }

  const fullUcis = [...tree.rootUci];

  for (let index = 1; index < path.length; index += 1) {
    const uci = path[index]?.edgeUciFromParent;

    if (uci) {
      fullUcis.push(uci);
    }
  }

  return fullUcis;
}

export function replayToNode(tree: OpeningTreeDetail, nodeId: string): string[] {
  const path = findPathToNode(tree, nodeId);
  const fullSans = [...tree.rootSan];

  for (let index = 1; index < path.length; index += 1) {
    const san = path[index]?.edgeSanFromParent;

    if (san) {
      fullSans.push(san);
    }
  }

  return fullSans;
}

export function listRepertoireForkNodeIds(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'rootSan' | 'rootPly' | 'rootFenKey'>,
): string[] {
  const rootPly = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0);
  const rootNode = resolveCanonicalRootNode(tree, rootPly);

  if (!rootNode) {
    return [];
  }

  const forkNodeIds: string[] = [];
  const queue = [rootNode.id];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;

    if (visited.has(nodeId)) {
      continue;
    }

    visited.add(nodeId);
    const repertoireOutgoing = tree.edges.filter((edge) => edge.fromNodeId === nodeId && isRepertoireEdge(edge));

    if (repertoireOutgoing.length >= 2) {
      forkNodeIds.push(nodeId);
    }

    for (const edge of repertoireOutgoing) {
      queue.push(edge.toNodeId);
    }
  }

  return forkNodeIds;
}

export function listOpponentForkNodeIds(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'rootSan' | 'rootPly' | 'rootFenKey'>,
  trainSide: OpeningSide,
): string[] {
  const rootPly = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0);
  const rootNode = resolveCanonicalRootNode(tree, rootPly);

  if (!rootNode) {
    return [];
  }

  const forkNodeIds: string[] = [];
  const queue = [rootNode.id];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;

    if (visited.has(nodeId)) {
      continue;
    }

    visited.add(nodeId);
    const node = tree.nodes.find((candidate) => candidate.id === nodeId);

    if (!node) {
      continue;
    }

    const repertoireOutgoing = tree.edges.filter((edge) => edge.fromNodeId === nodeId && isRepertoireEdge(edge));

    if (node.sideToMove !== trainSide && repertoireOutgoing.length >= 2) {
      forkNodeIds.push(nodeId);
    }

    for (const edge of repertoireOutgoing) {
      queue.push(edge.toNodeId);
    }
  }

  return forkNodeIds;
}

export function listOpponentForksOnMainLine(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'rootSan' | 'rootPly' | 'rootFenKey' | 'targetDepth'>,
  trainSide: OpeningSide,
): string[] {
  const mainPath = buildDrillPath(tree, { trainSide });
  const forkNodeIds: string[] = [];

  for (const step of mainPath) {
    if (step.sideToMove === trainSide) {
      continue;
    }

    const repertoireOutgoing = tree.edges.filter((edge) => edge.fromNodeId === step.nodeId && isRepertoireEdge(edge));

    if (repertoireOutgoing.length >= 2) {
      forkNodeIds.push(step.nodeId);
    }
  }

  return forkNodeIds;
}

function listLearnBranchForkCandidates(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'rootSan' | 'rootPly' | 'rootFenKey' | 'targetDepth'>,
  trainSide: OpeningSide,
): string[] {
  const mainLineForks = listOpponentForksOnMainLine(tree, trainSide);
  const allOpponentForks = listOpponentForkNodeIds(tree, trainSide);
  const orderedForks: string[] = [];

  for (const forkNodeId of mainLineForks) {
    if (!orderedForks.includes(forkNodeId)) {
      orderedForks.push(forkNodeId);
    }
  }

  for (const forkNodeId of allOpponentForks) {
    if (!orderedForks.includes(forkNodeId)) {
      orderedForks.push(forkNodeId);
    }
  }

  return orderedForks;
}

export type LearnBranchCompletion = {
  forkNodeId: string;
  edgeId: string;
  edgeUci: string;
};

export function isLearnBranchEdgeCompleted(
  forkNodeId: string,
  edge: Pick<OpeningTreeEdge, 'id' | 'uci'>,
  completedBranches: LearnBranchCompletion[],
): boolean {
  return completedBranches.some(
    (entry) => entry.edgeId === edge.id || (entry.forkNodeId === forkNodeId && entry.edgeUci === edge.uci),
  );
}

export function findEarliestForkNodeId(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'rootSan' | 'rootPly' | 'rootFenKey' | 'targetDepth'>,
  trainSide: OpeningSide,
): string | null {
  const forkNodeIds = listOpponentForksOnMainLine(tree, trainSide);

  return forkNodeIds[0] ?? listOpponentForkNodeIds(tree, trainSide)[0] ?? null;
}

function scoreBranchEdge(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'rootSan' | 'rootPly' | 'rootFenKey' | 'targetDepth'>,
  trainSide: OpeningSide,
  forkNodeId: string,
  edge: OpeningTreeEdge,
): { weakNodes: number; recentCount: number } {
  const path = buildDrillPath(tree, {
    trainSide,
    forcedEdges: { [forkNodeId]: edge.uci },
  });
  const weakNodes = path.filter(
    (step) => step.isTrainTurn && step.masteryScore < LINES_WEAK_NODE_MASTERY_THRESHOLD,
  ).length;

  return { weakNodes, recentCount: edge.recentCount };
}

function attachDrillPathParentEdges(
  tree: Pick<OpeningTreeDetail, 'edges'>,
  path: DrillPathStep[],
  startIndex = 1,
): void {
  for (let index = Math.max(1, startIndex); index < path.length; index += 1) {
    const step = path[index]!;
    const parentStep = path[index - 1]!;
    const connectingEdge = tree.edges.find(
      (edge) => edge.fromNodeId === parentStep.nodeId && edge.toNodeId === step.nodeId,
    );
    step.edgeSanFromParent = connectingEdge?.san ?? null;
    step.edgeUciFromParent = connectingEdge?.uci ?? null;
  }
}

export function extendDrillPathFromNode(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'rootSan' | 'rootPly' | 'rootFenKey'>,
  path: DrillPathStep[],
  trainSide: OpeningSide,
): DrillPathStep[] {
  const lastStep = path.at(-1);

  if (!lastStep) {
    return path;
  }

  const continuation = buildDrillPath(tree, { trainSide, startNodeId: lastStep.nodeId });

  if (continuation.length <= 1) {
    return path;
  }

  const merged = [...path];
  const seenNodeIds = new Set(path.map((step) => step.nodeId));

  for (const continuationStep of continuation.slice(1)) {
    if (seenNodeIds.has(continuationStep.nodeId)) {
      break;
    }

    merged.push({
      ...continuationStep,
      edgeSanFromParent: null,
      edgeUciFromParent: null,
    });
    seenNodeIds.add(continuationStep.nodeId);
  }

  if (merged.length === path.length) {
    return path;
  }

  attachDrillPathParentEdges(tree, merged, path.length);

  return merged;
}

export function pickLearnBranch(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'rootSan' | 'rootPly' | 'rootFenKey' | 'targetDepth'>,
  trainSide: OpeningSide,
  completedBranches: LearnBranchCompletion[],
): {
  path: DrillPathStep[];
  branchEdgeId: string | null;
  branchForkNodeId: string | null;
  branchEdgeUci: string | null;
} {
  const forkNodeIds = listLearnBranchForkCandidates(tree, trainSide);

  if (forkNodeIds.length === 0) {
    const path = buildDrillPath(tree, { trainSide });

    return {
      path: extendDrillPathFromNode(tree, path, trainSide),
      branchEdgeId: null,
      branchForkNodeId: null,
      branchEdgeUci: null,
    };
  }

  for (const forkNodeId of forkNodeIds) {
    const candidates = tree.edges.filter(
      (edge) =>
        edge.fromNodeId === forkNodeId &&
        isRepertoireEdge(edge) &&
        !isLearnBranchEdgeCompleted(forkNodeId, edge, completedBranches),
    );

    if (candidates.length === 0) {
      continue;
    }

    const ranked = [...candidates].sort((left, right) => {
      const leftScore = scoreBranchEdge(tree, trainSide, forkNodeId, left);
      const rightScore = scoreBranchEdge(tree, trainSide, forkNodeId, right);

      if (rightScore.weakNodes !== leftScore.weakNodes) {
        return rightScore.weakNodes - leftScore.weakNodes;
      }

      return rightScore.recentCount - leftScore.recentCount;
    });
    const chosen = ranked[0]!;

    const path = buildDrillPath(tree, { trainSide, forcedEdges: { [forkNodeId]: chosen.uci } });

    return {
      path: extendDrillPathFromNode(tree, path, trainSide),
      branchEdgeId: chosen.id,
      branchForkNodeId: forkNodeId,
      branchEdgeUci: chosen.uci,
    };
  }

  return { path: [], branchEdgeId: null, branchForkNodeId: null, branchEdgeUci: null };
}

export function listSiblingBranchEdges(
  tree: Pick<OpeningTreeDetail, 'edges'>,
  forkNodeId: string,
  completedBranches: LearnBranchCompletion[],
): OpeningTreeEdge[] {
  return tree.edges.filter(
    (edge) =>
      edge.fromNodeId === forkNodeId &&
      isRepertoireEdge(edge) &&
      !isLearnBranchEdgeCompleted(forkNodeId, edge, completedBranches),
  );
}

export function hasRemainingLearnBranches(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'rootSan' | 'rootPly' | 'rootFenKey' | 'targetDepth'>,
  trainSide: OpeningSide,
  completedBranches: LearnBranchCompletion[],
  activeBranch?: Pick<LearnBranchCompletion, 'forkNodeId' | 'edgeId' | 'edgeUci'> | null,
): boolean {
  const nextBranch = pickLearnBranch(tree, trainSide, completedBranches);

  if (!nextBranch.branchEdgeId || !nextBranch.branchForkNodeId || !nextBranch.branchEdgeUci) {
    return false;
  }

  if (
    activeBranch &&
    activeBranch.forkNodeId === nextBranch.branchForkNodeId &&
    activeBranch.edgeUci === nextBranch.branchEdgeUci
  ) {
    return false;
  }

  return true;
}

export function applyOpeningAttemptScore(currentScore: number, correct: boolean) {
  return Math.max(0, Math.min(100, currentScore + (correct ? 18 : -22)));
}

export type DrillPathStep = {
  nodeId: string;
  fen: string;
  sideToMove: OpeningSide;
  trainSide: OpeningSide;
  bestUci: string | null;
  bestSan: string | null;
  masteryScore: number;
  isTrainTurn: boolean;
  edgeSanFromParent: string | null;
  edgeUciFromParent: string | null;
};

export function buildDrillPath(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'rootSan' | 'rootPly' | 'rootFenKey'>,
  options: {
    trainSide: OpeningSide;
    preferWeak?: boolean;
    seed?: number;
    startNodeId?: string;
    forcedEdges?: Record<string, string>;
  },
): DrillPathStep[] {
  const rootPly = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0);
  const rootNode = options.startNodeId
    ? tree.nodes.find((node) => node.id === options.startNodeId)
    : resolveCanonicalRootNode(tree, rootPly);

  if (!rootNode) {
    return [];
  }

  const path: DrillPathStep[] = [];
  const visited = new Set<string>();
  let currentNodeId = rootNode.id;

  while (currentNodeId && !visited.has(currentNodeId)) {
    visited.add(currentNodeId);
    const node = tree.nodes.find((candidate) => candidate.id === currentNodeId);

    if (!node) {
      break;
    }

    const isTrainTurn = node.sideToMove === options.trainSide;
    path.push({
      nodeId: node.id,
      fen: node.fen,
      sideToMove: node.sideToMove,
      trainSide: options.trainSide,
      bestUci: node.bestUci,
      bestSan: node.bestSan,
      masteryScore: node.masteryScore,
      isTrainTurn,
      edgeSanFromParent: null,
      edgeUciFromParent: null,
    });

    const outgoing = tree.edges.filter((edge) => edge.fromNodeId === currentNodeId);

    if (outgoing.length === 0) {
      break;
    }

    let chosenEdge: OpeningTreeEdge | null = null;
    const forcedUci = options.forcedEdges?.[currentNodeId];

    chosenEdge = pickDrillOutgoingEdge(outgoing, {
      isTrainTurn,
      forcedUci,
      visited,
      tree,
      node,
    });

    if (!chosenEdge) {
      break;
    }

    const nextStep = tree.nodes.find((candidate) => candidate.id === chosenEdge!.toNodeId);

    if (nextStep) {
      currentNodeId = nextStep.id;
    } else {
      break;
    }
  }

  attachDrillPathParentEdges(tree, path);

  return path;
}

export function buildLearnDrillReplayUcis(path: DrillPathStep[]): string[] {
  const firstTrainIndex = path.findIndex((step) => step.isTrainTurn);

  if (firstTrainIndex < 0) {
    return [];
  }

  const replayUcis: string[] = [];

  for (let index = 1; index <= firstTrainIndex; index += 1) {
    const parentStep = path[index - 1];

    if (!parentStep || parentStep.isTrainTurn) {
      continue;
    }

    const uci = path[index]?.edgeUciFromParent;

    if (uci) {
      replayUcis.push(uci);
    }
  }

  return replayUcis;
}

export function resolveDrillPathStepIndexFromHistory(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'rootSan' | 'rootPly' | 'rootFenKey' | 'rootUci'>,
  path: DrillPathStep[],
  moveHistory: Array<{ uci: string }>,
  historyIndex: number,
): number {
  if (path.length === 0) {
    return 0;
  }

  const { nodeId } = resolveOpeningNodeFromHistory(tree, moveHistory, historyIndex);

  if (!nodeId) {
    return 0;
  }

  const stepIndex = path.findIndex((step) => step.nodeId === nodeId);

  return stepIndex >= 0 ? stepIndex : 0;
}

export function findPathToNode(
  tree: OpeningTreeDetail,
  targetNodeId: string,
  options?: ReviewPathOptions,
): DrillPathStep[] {
  const rootPly = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0);
  const rootNode = resolveCanonicalRootNode(tree, rootPly);
  const queue: { nodeId: string; path: string[] }[] = [];
  const visited = new Set<string>();

  if (rootNode) {
    if (rootNode.id === targetNodeId) {
      return [
        {
          nodeId: rootNode.id,
          fen: rootNode.fen,
          isTrainTurn: false,
          edgeSanFromParent: null,
          edgeUciFromParent: null,
          trainSide: 'white',
          sideToMove: rootNode.sideToMove,
          bestUci: rootNode.bestUci,
          bestSan: rootNode.bestSan,
          masteryScore: rootNode.masteryScore,
        },
      ];
    }
    queue.push({ nodeId: rootNode.id, path: [rootNode.id] });
    visited.add(rootNode.id);
  }

  let finalPathIds: string[] | null = null;

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.nodeId === targetNodeId) {
      finalPathIds = current.path;
      break;
    }

    const outgoing = tree.edges.filter(
      (edge) =>
        edge.fromNodeId === current.nodeId &&
        (!options?.bestTrainMovesOnly || isReviewPathEdge(tree, edge, options.trainSide)),
    );
    for (const edge of outgoing) {
      if (!visited.has(edge.toNodeId)) {
        visited.add(edge.toNodeId);
        queue.push({ nodeId: edge.toNodeId, path: [...current.path, edge.toNodeId] });
      }
    }
  }

  if (!finalPathIds) {
    return [];
  }

  const path: DrillPathStep[] = [];
  for (let i = 0; i < finalPathIds.length; i++) {
    const stepNode = tree.nodes.find((n) => n.id === finalPathIds![i]);
    if (!stepNode) continue;

    path.push({
      nodeId: stepNode.id,
      fen: stepNode.fen,
      isTrainTurn: false, // will be overridden by caller if needed
      trainSide: 'white',
      sideToMove: stepNode.sideToMove,
      bestUci: stepNode.bestUci,
      bestSan: stepNode.bestSan,
      masteryScore: stepNode.masteryScore,
      edgeSanFromParent: null,
      edgeUciFromParent: null,
    });
  }

  for (let index = 1; index < path.length; index += 1) {
    const step = path[index]!;
    const parentStep = path[index - 1]!;
    const connectingEdge = tree.edges.find(
      (edge) => edge.fromNodeId === parentStep.nodeId && edge.toNodeId === step.nodeId,
    );
    step.edgeSanFromParent = connectingEdge?.san ?? null;
    step.edgeUciFromParent = connectingEdge?.uci ?? null;
  }

  return path;
}

function seededUnit(seed: number) {
  const value = Math.sin(seed) * 10000;
  return value - Math.floor(value);
}

export function shortHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash).toString(16).padStart(8, '0');
}

export function prepareOpeningTreeForLines(tree: OpeningTreeDetail): OpeningTreeDetail {
  const rootPly = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0);

  return filterOpeningTreeForDisplay(tree, rootPly);
}

export function resolveOpeningTreeSelectionId(
  requestedTreeId: string,
  loadedTree: Pick<OpeningTreeDetail, 'id'> | null,
) {
  return loadedTree?.id ?? requestedTreeId;
}

export function openingTreeDetailToSummary(tree: OpeningTreeDetail): OpeningTreeSummary {
  const { edges: _edges, nodes: _nodes, ...summary } = tree;
  return summary;
}

export function applyLearnMaxPlyToOpeningTree(tree: OpeningTreeDetail, maxPly: number): OpeningTreeDetail {
  if (maxPly <= 0) {
    return tree;
  }

  const nodes = tree.nodes.filter((node) => node.ply <= maxPly);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = tree.edges.filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId));

  return {
    ...tree,
    nodes,
    edges,
    nodeCount: nodes.length,
    targetDepth: Math.min(tree.targetDepth, maxPly),
  };
}

export function resolveLinesStudyOpeningTree(
  tree: OpeningTreeDetail | null,
  linesStudyMode: 'idle' | 'learn' | 'review',
  learnMaxPly: number,
): OpeningTreeDetail | null {
  if (!tree) {
    return null;
  }

  if (linesStudyMode !== 'learn' || learnMaxPly <= 0) {
    return tree;
  }

  return applyLearnMaxPlyToOpeningTree(tree, learnMaxPly);
}

export function filterOpeningTreeSummaries(trees: OpeningTreeSummary[]): OpeningTreeSummary[] {
  const withoutLegacy = trees.filter((tree) => !isLegacyCatchAllOpeningTree(tree));
  const sourceForest = withoutLegacy.length > 0 ? withoutLegacy : trees;

  return sourceForest.filter((tree) => tree.nodeCount >= 2).sort((left, right) => right.sourceCount - left.sourceCount);
}

export function filterOpeningTreeSummariesByMinForcedPlies(
  trees: OpeningTreeSummary[],
  minForcedPlies: number,
): OpeningTreeSummary[] {
  const requestedForcedPlies = Math.max(1, minForcedPlies);

  return trees.filter((tree) => {
    const storedRootPly = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0);

    if (storedRootPly === 0) {
      return true;
    }

    return storedRootPly >= requestedForcedPlies;
  });
}

export function formatBrowseForcedRootSan(
  tree: Pick<OpeningTreeSummary, 'rootSan' | 'rootPly'>,
  minForcedPlies: number,
): string {
  const storedRootPly = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0);

  if (storedRootPly === 0 || tree.rootSan.length === 0) {
    return 'Starting position';
  }

  const forcedPlies = resolveOpeningTreeRootPly(tree, minForcedPlies);

  return tree.rootSan.slice(0, forcedPlies).join(' ');
}

export function formatBrowseForcedRootLine(
  tree: Pick<OpeningTreeSummary, 'rootSan' | 'rootPly'>,
  minForcedPlies: number,
): { forced: string; continuation: string | null } {
  const storedRootPly = tree.rootPly ?? (tree.rootSan.length > 0 ? tree.rootSan.length : 0);

  if (storedRootPly === 0 || tree.rootSan.length === 0) {
    return { forced: 'Starting position', continuation: null };
  }

  const forcedPlies = resolveOpeningTreeRootPly(tree, minForcedPlies);
  const forced = tree.rootSan.slice(0, forcedPlies).join(' ');
  const continuation = forcedPlies < tree.rootSan.length ? tree.rootSan.slice(forcedPlies).join(' ') : null;

  return { forced, continuation };
}

export function sliceOpeningForest(forest: OpeningTreeDetail[], minForcedPlies: number): OpeningTreeDetail[] {
  const withoutLegacy = forest.filter((tree) => !isLegacyCatchAllOpeningTree(tree));
  const sourceForest = withoutLegacy.length > 0 ? withoutLegacy : forest;
  const sliced: OpeningTreeDetail[] = [];

  for (const tree of sourceForest) {
    const rootPly = resolveOpeningTreeRootPly(tree, minForcedPlies);
    const rootNode = resolveCanonicalRootNode(tree, rootPly);

    if (!rootNode || rootNode.recentGames + rootNode.cardCount === 0) {
      continue;
    }

    const filtered = filterOpeningTreeForDisplay(tree, rootPly);

    if (filtered.nodes.length < 2) {
      continue;
    }

    sliced.push({
      ...filtered,
      id: tree.id,
      name: tree.name,
      library: tree.library,
      rootPly,
      rootFenKey: tree.rootFenKey,
    });
  }

  return sliced.sort((left, right) => right.sourceCount - left.sourceCount);
}

export function ensureDraftEdge(
  draft: OpeningTreeDraft,
  fromNode: OpeningTreeDraft['nodes'][number],
  uci: string,
  source: 'lichess_masters' | 'engine_best',
  options: { mastersGames?: number; priority?: number; isEngineBest?: boolean },
) {
  const chess = new Chess(fromNode.fen);
  const move = (() => {
    try {
      return chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        ...(uci[4] ? { promotion: uci[4] } : {}),
      });
    } catch {
      return null;
    }
  })();

  if (!move) {
    return;
  }

  const toFen = chess.fen();
  const toFenKey = normalizeOpeningFen(toFen);
  let toNode = draft.nodes.find((node) => node.fenKey === toFenKey);

  if (!toNode) {
    toNode = {
      id: `opening-node-${shortHash(`${draft.id}:${toFenKey}`)}`,
      fen: toFen,
      fenKey: toFenKey,
      ply: fromNode.ply + 1,
      sideToMove: toFen.split(' ')[1] === 'b' ? 'black' : 'white',
      recentGames: 0,
      cardCount: 0,
    };
    draft.nodes.push(toNode);
  }

  let edge = draft.edges.find((candidate) => candidate.fromNodeId === fromNode.id && candidate.uci === uci);

  if (!edge) {
    edge = {
      id: `opening-edge-${shortHash(`${draft.id}:${fromNode.id}:${uci}`)}`,
      fromNodeId: fromNode.id,
      toNodeId: toNode.id,
      uci,
      san: move.san,
      moveBy: fromNode.sideToMove,
      source,
      recentCount: 0,
      cardCount: 0,
      mastersGames: 0,
      priority: 0,
      isEngineBest: false,
    };
    draft.edges.push(edge);
  }

  edge.source =
    edge.source === source ? source : edge.source === 'recent_game' || edge.source === 'card' ? 'mixed' : edge.source;
  edge.mastersGames += options.mastersGames ?? 0;
  edge.priority += options.priority ?? 0;
  edge.isEngineBest ||= Boolean(options.isEngineBest);
}

export function buildOpeningTreeNodeByFenKey(tree: OpeningTreeDetail): Map<string, string> {
  return new Map(tree.nodes.map((node) => [node.fenKey, node.id]));
}
