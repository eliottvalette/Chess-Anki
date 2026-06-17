import { Chess } from 'chess.js';

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
  rootSan: string[];
  rootUci: string[];
  sourceCount: number;
  targetDepth: number;
  nodeCount: number;
  dueCount: number;
  masteryScore: number;
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
export const LINES_MOVE_EVAL_GATE_CP = 55;
export const OPENING_ENRICH_STALE_DAYS = 7;

export type LinesMoveCategory = 'best' | 'book' | 'miss';

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

export function resolveAcceptedTrainMoveUcis(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>,
  nodeId: string,
): AcceptedTrainMoves {
  const node = tree.nodes.find((candidate) => candidate.id === nodeId);

  if (!node) {
    return { primaryUci: null, primarySan: null, acceptedUcis: [] };
  }

  const acceptedUcis = new Set<string>();

  if (node.bestUci) {
    acceptedUcis.add(node.bestUci);
  }

  for (const edge of tree.edges) {
    if (edge.fromNodeId !== nodeId) {
      continue;
    }

    if (edge.isEngineBest || edge.mastersGames > 0) {
      acceptedUcis.add(edge.uci);
    }
  }

  return {
    primaryUci: node.bestUci,
    primarySan: node.bestSan,
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

  return {
    nodeId,
    uci: accepted.primaryUci,
    san: accepted.primarySan,
    acceptedUcis: accepted.acceptedUcis,
  };
}

export function isAcceptedOpeningDrillMove(_fenBefore: string, playedUci: string, acceptedUcis: string[]) {
  return acceptedUcis.includes(playedUci);
}

export function classifyOpeningDrillMove(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>,
  nodeId: string,
  fenBefore: string,
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

export function classifyLinesMove(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges'>,
  nodeId: string,
  playedUci: string,
  expected: Pick<AcceptedTrainMoves, 'primaryUci' | 'acceptedUcis'> | null = null,
): { category: LinesMoveCategory; evalLossCp: number | null } {
  const resolved = expected ?? resolveAcceptedTrainMoveUcis(tree, nodeId);
  const primaryUci = resolved.primaryUci;
  const node = tree.nodes.find((candidate) => candidate.id === nodeId);

  if (primaryUci != null && playedUci === primaryUci) {
    return { category: 'best', evalLossCp: 0 };
  }

  if (!resolved.acceptedUcis.includes(playedUci)) {
    return { category: 'miss', evalLossCp: null };
  }

  const evalLossCp = computeTrainMoveEvalLossCp(tree, nodeId, playedUci, resolved.acceptedUcis);

  if (evalLossCp == null || evalLossCp > LINES_MOVE_EVAL_GATE_CP) {
    return { category: 'miss', evalLossCp };
  }

  return { category: 'book', evalLossCp };
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
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'targetDepth' | 'rootSan'>,
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
  tree: OpeningTreeDetail,
  moveHistory: Array<{ uci: string }>,
  historyIndex: number,
): { nodeId: string | null; plyInTree: number } {
  const rootLength = tree.rootSan.length;
  const boundedIndex = Math.max(0, Math.min(historyIndex, moveHistory.length));

  if (boundedIndex < rootLength) {
    const rootNode = tree.nodes.find((node) => node.ply === rootLength) ?? tree.nodes[0] ?? null;
    return { nodeId: rootNode?.id ?? null, plyInTree: boundedIndex };
  }

  let currentNode = tree.nodes.find((node) => node.ply === rootLength) ?? tree.nodes[0] ?? null;

  for (let index = rootLength; index < boundedIndex; index += 1) {
    const move = moveHistory[index];

    if (!move || !currentNode) {
      break;
    }

    const edge = tree.edges.find((candidate) => candidate.fromNodeId === currentNode!.id && candidate.uci === move.uci);
    const nextNode = edge ? tree.nodes.find((candidate) => candidate.id === edge.toNodeId) : null;

    if (!nextNode) {
      return { nodeId: currentNode.id, plyInTree: index };
    }

    currentNode = nextNode;
  }

  return { nodeId: currentNode?.id ?? null, plyInTree: boundedIndex };
}

export function classifyLinesMoveAtHistoryIndex(
  tree: OpeningTreeDetail,
  moveHistory: Array<{ uci: string }>,
  historyIndex: number,
  trainSide: OpeningSide,
): { moveUci: string; category: LinesMoveCategory } | null {
  if (historyIndex <= 0 || historyIndex > moveHistory.length) {
    return null;
  }

  const move = moveHistory[historyIndex - 1];

  if (!move) {
    return null;
  }

  const { nodeId } = resolveOpeningNodeFromHistory(tree, moveHistory, historyIndex - 1);
  const node = nodeId ? tree.nodes.find((candidate) => candidate.id === nodeId) : null;

  if (!node || node.sideToMove !== trainSide) {
    return null;
  }

  const classified = classifyLinesMove(tree, nodeId!, move.uci);

  return {
    moveUci: move.uci,
    category: classified.category,
  };
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
    : (tree.nodes.find((node) => node.ply === tree.rootSan.length) ?? tree.nodes[0] ?? null);

  return {
    phase: 'idle',
    trainSide,
    activeNodeId: rootNode?.id ?? null,
    forkCoverage: buildForkCoverage(tree, trainSide),
    schedulerMode: 'full_line',
    seed: Date.now(),
  };
}

export function maxLinePliesForTree(tree: Pick<OpeningTreeDetail, 'targetDepth' | 'rootSan'>): number {
  return Math.max(0, tree.targetDepth - tree.rootSan.length);
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

export function mergeOpeningTreeDelta(
  existing: OpeningTreeDraft,
  deltaInputs: OpeningTreeBuildInput[],
  options: { ownerProfileId: string; targetDepth: number; rootPly: number },
): { draft: OpeningTreeDraft; newNodeIds: Set<string>; newEdgeIds: Set<string> } {
  const freshTrees = buildOpeningTrees(deltaInputs, {
    ownerProfileId: options.ownerProfileId,
    targetDepth: options.targetDepth,
    rootPly: options.rootPly,
  });
  const matching = freshTrees.find((tree) => tree.rootFenKey === existing.rootFenKey);

  if (!matching) {
    return { draft: existing, newNodeIds: new Set(), newEdgeIds: new Set() };
  }

  const nodeByFenKey = new Map(existing.nodes.map((node) => [node.fenKey, node]));
  const edgeByKey = new Map(existing.edges.map((edge) => [`${edge.fromNodeId}:${edge.uci}`, edge]));
  const newNodeIds = new Set<string>();
  const newEdgeIds = new Set<string>();

  for (const node of matching.nodes) {
    const current = nodeByFenKey.get(node.fenKey);

    if (!current) {
      existing.nodes.push({ ...node, trainSide: node.trainSide ?? existing.trainSide });
      nodeByFenKey.set(node.fenKey, node);
      newNodeIds.add(node.id);
      continue;
    }

    current.recentGames += node.recentGames;
    current.cardCount += node.cardCount;
  }

  for (const edge of matching.edges) {
    const key = `${edge.fromNodeId}:${edge.uci}`;
    const current = edgeByKey.get(key);

    if (!current) {
      existing.edges.push(edge);
      edgeByKey.set(key, edge);
      newEdgeIds.add(edge.id);
      continue;
    }

    current.recentCount += edge.recentCount;
    current.cardCount += edge.cardCount;
    current.priority = Math.max(current.priority, edge.priority);
    current.source =
      current.source === edge.source
        ? current.source
        : current.source === 'recent_game' || current.source === 'card'
          ? 'mixed'
          : current.source;
  }

  existing.sourceCount += matching.sourceCount;
  existing.targetDepth = Math.max(existing.targetDepth, options.targetDepth);
  existing.nodes.sort((left, right) => left.ply - right.ply || left.id.localeCompare(right.id));
  existing.edges.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));

  return { draft: existing, newNodeIds, newEdgeIds };
}

export function shouldSkipNodeEnrichment(_node: OpeningNodeDraft, _staleBeforeMs: number): boolean {
  return false;
}

export function shouldEnrichNodeLazy(node: OpeningNodeDraft, trainSide: OpeningSide, mode: OpeningBuildMode): boolean {
  if (mode === 'fast') {
    return false;
  }

  if (node.ply <= 16) {
    return true;
  }

  if (node.ply <= 22) {
    return node.recentGames >= 2 || (node.sideToMove === trainSide && (node.evalCp ?? 0) < 70);
  }

  return node.cardCount > 0;
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

export function buildOpeningTrees(
  inputs: OpeningTreeBuildInput[],
  options: { ownerProfileId: string; targetDepth?: number; rootPly?: number },
) {
  const rootPly = options.rootPly ?? DEFAULT_OPENING_ROOT_PLY;
  const targetDepth = options.targetDepth ?? DEFAULT_OPENING_TARGET_DEPTH;
  const groups = new Map<
    string,
    { input: OpeningTreeBuildInput; parsed: OpeningMove[]; library: OpeningLibrary; rootFenKey: string }[]
  >();

  for (const input of inputs) {
    const parsed = parseSanMoves(input.moves);

    if (parsed.length < rootPly) {
      continue;
    }

    const library = resolveOpeningLibrary(parsed);
    const rootFen = rootPly === 0 ? new Chess().fen() : parsed[rootPly - 1]?.fenAfter;

    if (!rootFen) {
      continue;
    }

    const rootFenKey = normalizeOpeningFen(rootFen);
    const key = rootFenKey;
    const bucket = groups.get(key) ?? [];
    bucket.push({ input, parsed, library, rootFenKey });
    groups.set(key, bucket);
  }

  return [...groups.values()].map((group) =>
    buildTreeForGroup(group, {
      ownerProfileId: options.ownerProfileId,
      rootPly,
      targetDepth,
    }),
  );
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
  tree: { nodes: OpeningTreeNode[]; edges: OpeningTreeEdge[]; rootSan: string[] },
  options: { trainSide: OpeningSide; preferWeak?: boolean; seed?: number; startNodeId?: string },
): DrillPathStep[] {
  const rootPly = tree.rootSan.length;
  const rootNode = options.startNodeId
    ? tree.nodes.find((node) => node.id === options.startNodeId)
    : (tree.nodes.find((node) => node.ply === rootPly) ?? tree.nodes[0]);

  if (!rootNode) {
    return [];
  }

  const path: DrillPathStep[] = [];
  const visited = new Set<string>();
  let currentNodeId = rootNode.id;
  let currentSeed = options.seed ?? Date.now();

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

    if (isTrainTurn) {
      const validMoves = outgoing.filter((edge) => {
        if (edge.isEngineBest || edge.mastersGames > 0) return true;
        const target = tree.nodes.find((n) => n.id === edge.toNodeId);
        if (!target || node.evalCp == null || target.evalCp == null) return true;
        const swing = node.sideToMove === 'white' ? target.evalCp - node.evalCp : node.evalCp - target.evalCp;
        return swing > -30;
      });

      if (validMoves.length > 0) {
        const sorted = [...validMoves].sort((a, b) => b.recentCount - a.recentCount);
        chosenEdge = sorted[0] ?? null;
      } else {
        chosenEdge = outgoing.find((edge) => edge.isEngineBest) ?? null;
      }
    } else {
      const roll = seededUnit(currentSeed) * 100;
      if (roll < 20) {
        const theoryEdges = [...outgoing].sort((a, b) => {
          if (a.isEngineBest !== b.isEngineBest) return a.isEngineBest ? -1 : 1;
          return b.mastersGames - a.mastersGames;
        });
        chosenEdge = theoryEdges[0] ?? null;
      } else {
        if (options.preferWeak) {
          const weakTargets = outgoing.filter((edge) => {
            const target = tree.nodes.find((candidate) => candidate.id === edge.toNodeId);
            return target && target.sideToMove === options.trainSide && target.masteryScore < 80;
          });

          if (weakTargets.length > 0) {
            chosenEdge = chooseWeightedOpponentEdge(weakTargets, currentSeed);
          }
        }

        if (!chosenEdge) {
          chosenEdge = chooseWeightedOpponentEdge(outgoing, currentSeed);
        }
      }
    }

    if (!chosenEdge) {
      break;
    }

    if (path.length > 0) {
      const lastStep = path[path.length - 1];

      if (lastStep) {
        lastStep.edgeSanFromParent = null;
      }
    }

    const nextStep = tree.nodes.find((candidate) => candidate.id === chosenEdge!.toNodeId);

    if (nextStep) {
      currentNodeId = nextStep.id;
      currentSeed += 1;
    } else {
      break;
    }
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

export function findPathToNode(tree: OpeningTreeDetail, targetNodeId: string): DrillPathStep[] {
  const rootPly = tree.rootSan.length;
  const rootNodes = tree.nodes.filter((n) => n.ply === rootPly);
  const queue: { nodeId: string; path: string[] }[] = [];
  const visited = new Set<string>();

  for (const root of rootNodes) {
    if (root.id === targetNodeId) {
      return [
        {
          nodeId: root.id,
          fen: root.fen,
          isTrainTurn: false,
          edgeSanFromParent: null,
          edgeUciFromParent: null,
          trainSide: 'white',
          sideToMove: root.sideToMove,
          bestUci: root.bestUci,
          bestSan: root.bestSan,
          masteryScore: root.masteryScore,
        },
      ];
    }
    queue.push({ nodeId: root.id, path: [root.id] });
    visited.add(root.id);
  }

  let finalPathIds: string[] | null = null;

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.nodeId === targetNodeId) {
      finalPathIds = current.path;
      break;
    }

    const outgoing = tree.edges.filter((e) => e.fromNodeId === current.nodeId);
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

function buildTreeForGroup(
  group: { input: OpeningTreeBuildInput; parsed: OpeningMove[]; library: OpeningLibrary; rootFenKey: string }[],
  options: { ownerProfileId: string; rootPly: number; targetDepth: number },
): OpeningTreeDraft {
  const first = group[0]!;
  const rootMoves = first.parsed.slice(0, options.rootPly);
  const treeId = `opening-tree-${shortHash(`${options.ownerProfileId}:${first.library}:${first.rootFenKey}`)}`;
  const nodes = new Map<string, OpeningNodeDraft>();
  const edges = new Map<string, OpeningEdgeDraft>();

  for (const item of group) {
    const count = item.input.count ?? 1;
    const boundedMoves = item.parsed.slice(0, options.targetDepth);

    for (let index = options.rootPly; index <= boundedMoves.length; index += 1) {
      const fen = index === 0 ? new Chess().fen() : boundedMoves[index - 1]?.fenAfter;

      if (!fen) {
        continue;
      }

      const fenKey = normalizeOpeningFen(fen);
      const nodeId = `opening-node-${shortHash(`${treeId}:${fenKey}`)}`;
      const node = nodes.get(nodeId) ?? {
        id: nodeId,
        fen,
        fenKey,
        ply: index,
        sideToMove: getSideToMove(fen),
        trainSide: item.input.trainSide,
        recentGames: 0,
        cardCount: 0,
      };

      if (item.input.source === 'recent_game') {
        node.recentGames += count;
      } else {
        node.cardCount += count;
      }

      nodes.set(nodeId, node);
    }

    for (let index = options.rootPly; index < boundedMoves.length; index += 1) {
      const move = boundedMoves[index];
      const fromFen = boundedMoves[index - 1]?.fenAfter;

      if (!move || !fromFen) {
        continue;
      }

      const fromNodeId = `opening-node-${shortHash(`${treeId}:${normalizeOpeningFen(fromFen)}`)}`;
      const toNodeId = `opening-node-${shortHash(`${treeId}:${normalizeOpeningFen(move.fenAfter)}`)}`;
      const edgeId = `opening-edge-${shortHash(`${treeId}:${fromNodeId}:${move.uci}`)}`;
      const edge = edges.get(edgeId) ?? {
        id: edgeId,
        fromNodeId,
        toNodeId,
        uci: move.uci,
        san: move.san,
        moveBy: move.color,
        source: item.input.source,
        recentCount: 0,
        cardCount: 0,
        mastersGames: 0,
        priority: 0,
        isEngineBest: false,
      };

      if (item.input.source === 'recent_game') {
        edge.recentCount += item.input.count ?? 1;
      } else {
        edge.cardCount += item.input.count ?? 1;
      }

      edge.priority = edge.recentCount * 3 + edge.cardCount * 8 + Math.max(0, item.input.scoreSwingCp ?? 0) / 40;
      edge.source = edge.recentCount > 0 && edge.cardCount > 0 ? 'mixed' : edge.source;
      edges.set(edgeId, edge);
    }
  }

  return {
    id: treeId,
    name: deriveOpeningName(first.input.name, rootMoves),
    library: first.library,
    rootFenKey: first.rootFenKey,
    rootPly: options.rootPly,
    rootSan: rootMoves.map((move) => move.san),
    rootUci: rootMoves.map((move) => move.uci),
    sourceCount: group.reduce((total, item) => total + (item.input.count ?? 1), 0),
    targetDepth: options.targetDepth,
    trainSide: first.input.trainSide,
    nodes: [...nodes.values()].sort((left, right) => left.ply - right.ply || left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id)),
  };
}

function deriveOpeningName(name: string, rootMoves: OpeningMove[]) {
  const formattedName = formatOpeningTreeDisplayName(name);

  if (formattedName && formattedName !== 'Opening') {
    return formattedName.slice(0, 96);
  }

  return (
    rootMoves
      .map((move) => move.san)
      .join(' ')
      .slice(0, 96) || 'Opening'
  );
}

function getSideToMove(fen: string): OpeningSide {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function seededUnit(seed: number) {
  const value = Math.sin(seed) * 10000;
  return value - Math.floor(value);
}

function shortHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash).toString(16).padStart(8, '0');
}

export function sliceOpeningForest(forest: OpeningTreeDetail[], minForcedPlies: number): OpeningTreeDetail[] {
  const sliced: OpeningTreeDetail[] = [];

  for (const tree of forest) {
    const rootNodes = tree.nodes.filter((node) => node.ply === minForcedPlies);

    for (const rootNode of rootNodes) {
      const rootSan: string[] = [];
      const rootUci: string[] = [];
      let currentId = rootNode.id;

      for (let i = 0; i < minForcedPlies; i++) {
        const edge = tree.edges.find((e) => e.toNodeId === currentId);
        if (!edge) {
          break;
        }
        rootSan.unshift(edge.san);
        rootUci.unshift(edge.uci);
        currentId = edge.fromNodeId;
      }

      rootSan.unshift(...tree.rootSan);
      rootUci.unshift(...tree.rootUci);

      const reachableNodeIds = new Set<string>();
      const reachableEdgeIds = new Set<string>();
      const queue = [rootNode.id];
      reachableNodeIds.add(rootNode.id);

      while (queue.length > 0) {
        const currId = queue.shift()!;
        const outgoingEdges = tree.edges.filter((e) => e.fromNodeId === currId);
        for (const edge of outgoingEdges) {
          reachableEdgeIds.add(edge.id);
          if (!reachableNodeIds.has(edge.toNodeId)) {
            reachableNodeIds.add(edge.toNodeId);
            queue.push(edge.toNodeId);
          }
        }
      }

      const nodes = tree.nodes.filter((n) => reachableNodeIds.has(n.id));
      const edges = tree.edges.filter((e) => reachableEdgeIds.has(e.id));

      if (nodes.length === 0) {
        continue;
      }

      const sourceCount = rootNode.recentGames + rootNode.cardCount;
      if (sourceCount === 0) {
        continue;
      }

      const trainNodes = nodes.filter((n) => n.masteryScore > 0 || n.seenCount > 0);
      const masteryScore =
        trainNodes.length > 0 ? trainNodes.reduce((sum, n) => sum + n.masteryScore, 0) / trainNodes.length : 0;

      sliced.push({
        id: `sliced-${rootNode.id}`,
        name: tree.name,
        library: tree.library,
        rootSan,
        rootUci,
        sourceCount,
        targetDepth: tree.targetDepth,
        nodeCount: nodes.length,
        dueCount: 0,
        masteryScore,
        updatedAt: tree.updatedAt,
        nodes,
        edges,
      });
    }
  }

  return sliced.sort((a, b) => b.sourceCount - a.sourceCount);
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
