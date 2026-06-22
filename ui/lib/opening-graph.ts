import { Chess } from 'chess.js';

import type {
  OpeningEdgeDraft,
  OpeningLibrary,
  OpeningMove,
  OpeningNodeDraft,
  OpeningSide,
  OpeningTreeBuildInput,
  OpeningTreeDetail,
  OpeningTreeDraft,
  OpeningTreeEdge,
  OpeningTreeNode,
  OpeningTreeSummary,
} from './opening-tree.ts';
import {
  DEFAULT_OPENING_TARGET_DEPTH,
  filterOpeningTreeForDisplay,
  formatOpeningTreeDisplayName,
  mapOpeningLibraryFromDb,
  mapOpeningLibraryToDb,
  normalizeOpeningFen,
  parseSanMoves,
  resolveOpeningLibrary,
  shortHash,
} from './opening-tree.ts';

export const OPENING_CATALOG_PLY = 4;
export const OPENING_CATALOG_MIN_SOURCES = 1;

export type OpeningGraphScope = {
  library: OpeningLibrary;
  trainSide: OpeningSide;
  graphRootFen: string;
  graphRootFenKey: string;
  startMoveIndex: number;
};

export type OpeningGraphDraft = {
  id: string;
  library: OpeningLibrary;
  trainSide: OpeningSide;
  graphRootFenKey: string;
  targetDepth: number;
  nodes: OpeningNodeDraft[];
  edges: OpeningEdgeDraft[];
};

export type OpeningCatalogDraft = {
  id: string;
  graphId: string;
  entryNodeId: string;
  catalogPly: number;
  library: OpeningLibrary;
  fenKey: string;
  name: string;
  displaySan: string[];
  displayUci: string[];
  sourceCount: number;
  subgraphNodeCount: number;
};

export type OpeningGraphForest = {
  graphs: OpeningGraphDraft[];
  catalogs: OpeningCatalogDraft[];
};

export type OpeningGraphProgressEntry = {
  seenCount: number;
  correctCount: number;
  missCount: number;
  masteryScore: number;
};

function libraryFirstMoveUci(library: OpeningLibrary): string | null {
  switch (library) {
    case 'e4':
      return 'e2e4';
    case 'd4':
      return 'd2d4';
    case 'c4':
      return 'c2c4';
    case 'nf3':
      return 'g1f3';
    case 'other':
      return null;
  }
}

export function resolveOpeningGraphScope(
  input: OpeningTreeBuildInput,
  parsed: OpeningMove[],
): OpeningGraphScope | null {
  if (parsed.length === 0) {
    return null;
  }

  const library = resolveOpeningLibrary(parsed);
  const expectedFirstMove = libraryFirstMoveUci(library);

  if (expectedFirstMove && parsed[0]?.uci !== expectedFirstMove) {
    return null;
  }

  if (input.trainSide === 'white') {
    const graphRootFen = new Chess().fen();

    return {
      library,
      trainSide: 'white',
      graphRootFen,
      graphRootFenKey: normalizeOpeningFen(graphRootFen),
      startMoveIndex: 0,
    };
  }

  if (parsed.length < 1) {
    return null;
  }

  const graphRootFen = parsed[0]!.fenAfter;

  return {
    library,
    trainSide: 'black',
    graphRootFen,
    graphRootFenKey: normalizeOpeningFen(graphRootFen),
    startMoveIndex: 1,
  };
}

export function buildOpeningGraphId(ownerProfileId: string, scope: Pick<OpeningGraphScope, 'trainSide' | 'library'>) {
  return `opening-graph-${shortHash(`${ownerProfileId}:${scope.trainSide}:${scope.library}`)}`;
}

export function buildOpeningNodeId(
  ownerProfileId: string,
  scope: Pick<OpeningGraphScope, 'trainSide' | 'library'>,
  fenKey: string,
) {
  return `opening-node-${shortHash(`${ownerProfileId}:${scope.trainSide}:${scope.library}:${fenKey}`)}`;
}

export function buildOpeningCatalogId(graphId: string, fenKey: string, catalogPly: number) {
  return `opening-catalog-${shortHash(`${graphId}:${fenKey}:${catalogPly}`)}`;
}

function deriveCatalogName(name: string, displaySan: string[]) {
  const formattedName = formatOpeningTreeDisplayName(name);

  if (formattedName && formattedName !== 'Opening') {
    return formattedName.slice(0, 96);
  }

  return displaySan.join(' ').slice(0, 96) || 'Opening';
}

export function collectReachableNodeIdsFromNode(
  startNodeId: string,
  edges: Array<{ fromNodeId: string; toNodeId: string }>,
): Set<string> {
  const reachable = new Set<string>([startNodeId]);
  const queue = [startNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    for (const edge of edges) {
      if (edge.fromNodeId !== currentId || reachable.has(edge.toNodeId)) {
        continue;
      }

      reachable.add(edge.toNodeId);
      queue.push(edge.toNodeId);
    }
  }

  return reachable;
}

export function resolveOpeningCatalogTreeIdsAtFenKey(
  fenKey: string,
  catalogs: Array<{ id: string; graphId: string; entryNodeId: string; fenKey: string }>,
  nodes: Array<{ id: string; graphId: string; fenKey: string }>,
  edges: Array<{ graphId: string; fromNodeId: string; toNodeId: string }>,
): string[] {
  const treeIds = new Set<string>();
  const edgesByGraph = new Map<string, Array<{ fromNodeId: string; toNodeId: string }>>();

  for (const edge of edges) {
    const bucket = edgesByGraph.get(edge.graphId) ?? [];
    bucket.push({ fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId });
    edgesByGraph.set(edge.graphId, bucket);
  }

  for (const catalog of catalogs) {
    if (catalog.fenKey === fenKey) {
      treeIds.add(catalog.id);
    }
  }

  for (const node of nodes) {
    if (node.fenKey !== fenKey) {
      continue;
    }

    const graphEdges = edgesByGraph.get(node.graphId) ?? [];
    const forwardFromNode = collectReachableNodeIdsFromNode(node.id, graphEdges);
    const graphCatalogs = catalogs.filter((catalog) => catalog.graphId === node.graphId);

    for (const catalog of graphCatalogs) {
      if (forwardFromNode.has(catalog.entryNodeId)) {
        treeIds.add(catalog.id);
        continue;
      }

      const forwardFromEntry = collectReachableNodeIdsFromNode(catalog.entryNodeId, graphEdges);

      if (forwardFromEntry.has(node.id)) {
        treeIds.add(catalog.id);
      }
    }
  }

  return [...treeIds];
}

export function reconstructOpeningPathToNode(
  nodeId: string,
  nodes: Array<{ id: string; ply: number }>,
  edges: Array<{ fromNodeId: string; toNodeId: string; san: string; uci: string }>,
): { san: string[]; uci: string[] } | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const targetNode = nodeById.get(nodeId);

  if (!targetNode) {
    return null;
  }

  if (targetNode.ply === 0) {
    return { san: [], uci: [] };
  }

  const rootNodes = nodes.filter((node) => node.ply === 0);

  if (rootNodes.length === 0) {
    return null;
  }

  const outgoing = new Map<string, Array<{ fromNodeId: string; toNodeId: string; san: string; uci: string }>>();

  for (const edge of edges) {
    const bucket = outgoing.get(edge.fromNodeId) ?? [];
    bucket.push(edge);
    outgoing.set(edge.fromNodeId, bucket);
  }

  type PathState = { nodeId: string; san: string[]; uci: string[] };
  const queue: PathState[] = rootNodes.map((node) => ({ nodeId: node.id, san: [], uci: [] }));
  const bestPathByNodeId = new Map<string, { san: string[]; uci: string[] }>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentNode = nodeById.get(current.nodeId);

    if (!currentNode) {
      continue;
    }

    const previous = bestPathByNodeId.get(current.nodeId);

    if (previous && previous.san.length <= current.san.length) {
      continue;
    }

    bestPathByNodeId.set(current.nodeId, { san: current.san, uci: current.uci });

    if (current.nodeId === nodeId && current.san.length === targetNode.ply) {
      return { san: current.san, uci: current.uci };
    }

    if (current.san.length >= targetNode.ply) {
      continue;
    }

    for (const edge of outgoing.get(current.nodeId) ?? []) {
      const childNode = nodeById.get(edge.toNodeId);

      if (!childNode || childNode.ply !== currentNode.ply + 1) {
        continue;
      }

      queue.push({
        nodeId: edge.toNodeId,
        san: [...current.san, edge.san],
        uci: [...current.uci, edge.uci],
      });
    }
  }

  const fallbackPath = bestPathByNodeId.get(nodeId);

  if (!fallbackPath || fallbackPath.san.length !== targetNode.ply) {
    return null;
  }

  return fallbackPath;
}

export function deriveDynamicCatalogName(pathSan: string[]): string {
  if (pathSan.length === 0) {
    return 'Starting position';
  }

  return pathSan.join(' ');
}

export function buildDynamicCatalogEntryForNode(
  graph: OpeningGraphDraft,
  node: OpeningNodeDraft,
  path: { san: string[]; uci: string[] },
): OpeningCatalogDraft {
  const sourceCount = node.recentGames + node.cardCount;
  const reachableNodeCount = collectReachableNodeIdsFromNode(
    node.id,
    graph.edges.map((edge) => ({ fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId })),
  ).size;

  return {
    id: buildOpeningCatalogId(graph.id, node.fenKey, node.ply),
    graphId: graph.id,
    entryNodeId: node.id,
    catalogPly: node.ply,
    library: graph.library,
    fenKey: node.fenKey,
    name: deriveDynamicCatalogName(path.san),
    displaySan: path.san,
    displayUci: path.uci,
    sourceCount,
    subgraphNodeCount: reachableNodeCount,
  };
}

export function buildDynamicCatalogEntries(
  graph: OpeningGraphDraft,
  browsePly: number,
  options: { catalogMinSources?: number } = {},
): OpeningCatalogDraft[] {
  const minSources = options.catalogMinSources ?? OPENING_CATALOG_MIN_SOURCES;
  const catalogs: OpeningCatalogDraft[] = [];

  for (const node of graph.nodes) {
    if (node.ply !== browsePly) {
      continue;
    }

    const sourceCount = node.recentGames + node.cardCount;

    if (sourceCount < minSources) {
      continue;
    }

    const path = reconstructOpeningPathToNode(node.id, graph.nodes, graph.edges);

    if (!path || path.san.length !== browsePly) {
      continue;
    }

    catalogs.push(buildDynamicCatalogEntryForNode(graph, node, path));
  }

  return catalogs.sort((left, right) => right.sourceCount - left.sourceCount);
}

export function buildDynamicBrowseSummaries(
  graphs: OpeningGraphDraft[],
  browsePly: number,
  progress: Map<string, OpeningGraphProgressEntry>,
): OpeningTreeSummary[] {
  const summaries: OpeningTreeSummary[] = [];

  for (const graph of graphs) {
    for (const catalog of buildDynamicCatalogEntries(graph, browsePly)) {
      summaries.push(catalogToSummary(graph, catalog, progress, graph.nodes, graph.edges));
    }
  }

  return summaries.sort((left, right) => right.sourceCount - left.sourceCount);
}

export function findDynamicCatalogEntry(
  graphs: OpeningGraphDraft[],
  treeId: string,
  browsePly: number,
): { graph: OpeningGraphDraft; catalog: OpeningCatalogDraft } | null {
  for (const graph of graphs) {
    for (const catalog of buildDynamicCatalogEntries(graph, browsePly)) {
      if (catalog.id === treeId) {
        return { graph, catalog };
      }
    }
  }

  return null;
}

export function findDynamicCatalogEntryById(
  graphs: OpeningGraphDraft[],
  treeId: string,
): { graph: OpeningGraphDraft; catalog: OpeningCatalogDraft } | null {
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      const sourceCount = node.recentGames + node.cardCount;

      if (sourceCount < OPENING_CATALOG_MIN_SOURCES) {
        continue;
      }

      const path = reconstructOpeningPathToNode(node.id, graph.nodes, graph.edges);

      if (!path) {
        continue;
      }

      const catalog = buildDynamicCatalogEntryForNode(graph, node, path);

      if (catalog.id === treeId) {
        return { graph, catalog };
      }
    }
  }

  return null;
}

export function projectTreeFromFenKey(
  graphs: OpeningGraphDraft[],
  fenKey: string,
  progress: Map<string, OpeningGraphProgressEntry>,
): OpeningTreeDetail | null {
  let best: { graph: OpeningGraphDraft; catalog: OpeningCatalogDraft } | null = null;

  for (const graph of graphs) {
    const node = graph.nodes.find((candidate) => candidate.fenKey === fenKey);

    if (!node) {
      continue;
    }

    const path = reconstructOpeningPathToNode(node.id, graph.nodes, graph.edges);

    if (!path) {
      continue;
    }

    const catalog = buildDynamicCatalogEntryForNode(graph, node, path);

    if (!best || catalog.sourceCount > best.catalog.sourceCount) {
      best = { graph, catalog };
    }
  }

  if (!best) {
    return null;
  }

  return projectCatalogSubgraph(best.graph, best.graph.nodes, best.graph.edges, best.catalog, progress);
}

function countReachableNodes(entryNodeId: string, nodes: OpeningNodeDraft[], edges: OpeningEdgeDraft[]): number {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const repertoireEdges = edges.filter((edge) => edge.recentCount > 0 || edge.cardCount > 0 || edge.mastersGames > 0);
  const reachable = new Set<string>([entryNodeId]);
  const queue = [entryNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    for (const edge of repertoireEdges) {
      if (edge.fromNodeId !== currentId || !nodeIds.has(edge.toNodeId)) {
        continue;
      }

      if (!reachable.has(edge.toNodeId)) {
        reachable.add(edge.toNodeId);
        queue.push(edge.toNodeId);
      }
    }
  }

  return reachable.size;
}

export function buildOpeningGraphForest(
  inputs: OpeningTreeBuildInput[],
  options: {
    ownerProfileId: string;
    targetDepth?: number;
    catalogPly?: number;
    catalogMinSources?: number;
  },
): OpeningGraphForest {
  const targetDepth = options.targetDepth ?? DEFAULT_OPENING_TARGET_DEPTH;
  const catalogPly = options.catalogPly ?? OPENING_CATALOG_PLY;
  const catalogMinSources = options.catalogMinSources ?? OPENING_CATALOG_MIN_SOURCES;
  const groups = new Map<
    string,
    {
      scope: OpeningGraphScope;
      items: Array<{ input: OpeningTreeBuildInput; parsed: OpeningMove[] }>;
    }
  >();

  for (const input of inputs) {
    const parsed = parseSanMoves(input.moves);
    const scope = resolveOpeningGraphScope(input, parsed);

    if (!scope) {
      continue;
    }

    const key = `${scope.trainSide}:${scope.library}`;
    const bucket = groups.get(key) ?? { scope, items: [] };
    bucket.items.push({ input, parsed });
    groups.set(key, bucket);
  }

  const graphs: OpeningGraphDraft[] = [];
  const catalogs: OpeningCatalogDraft[] = [];

  for (const group of groups.values()) {
    const graph = buildGraphForScope(group.scope, group.items, {
      ownerProfileId: options.ownerProfileId,
      targetDepth,
    });
    graphs.push(graph);
    catalogs.push(
      ...buildCatalogEntries(graph, group.items, {
        catalogPly,
        catalogMinSources,
      }),
    );
  }

  return { graphs, catalogs };
}

function buildGraphForScope(
  scope: OpeningGraphScope,
  items: Array<{ input: OpeningTreeBuildInput; parsed: OpeningMove[] }>,
  options: { ownerProfileId: string; targetDepth: number },
): OpeningGraphDraft {
  const graphId = buildOpeningGraphId(options.ownerProfileId, scope);
  const nodes = new Map<string, OpeningNodeDraft>();
  const edges = new Map<string, OpeningEdgeDraft>();
  const pathCounts = new Map<string, number>();
  const pathByFenKey = new Map<string, { san: string[]; uci: string[] }>();

  const rootNodeId = buildOpeningNodeId(options.ownerProfileId, scope, scope.graphRootFenKey);
  nodes.set(rootNodeId, {
    id: rootNodeId,
    fen: scope.graphRootFen,
    fenKey: scope.graphRootFenKey,
    ply: 0,
    sideToMove: getSideToMove(scope.graphRootFen),
    trainSide: items[0]?.input.trainSide ?? scope.trainSide,
    recentGames: 0,
    cardCount: 0,
  });
  pathByFenKey.set(scope.graphRootFenKey, { san: [], uci: [] });

  for (const item of items) {
    const count = item.input.count ?? 1;
    const boundedMoves = item.parsed.slice(0, options.targetDepth);
    const pathSan: string[] = [];
    const pathUci: string[] = [];

    for (let gameIndex = scope.startMoveIndex; gameIndex <= boundedMoves.length; gameIndex += 1) {
      const graphPly = gameIndex - scope.startMoveIndex;
      const fen =
        graphPly === 0
          ? (boundedMoves[scope.startMoveIndex]?.fenBefore ?? scope.graphRootFen)
          : boundedMoves[gameIndex - 1]?.fenAfter;

      if (!fen) {
        continue;
      }

      const fenKey = normalizeOpeningFen(fen);
      const nodeId = buildOpeningNodeId(options.ownerProfileId, scope, fenKey);
      const node = nodes.get(nodeId) ?? {
        id: nodeId,
        fen,
        fenKey,
        ply: graphPly,
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

      if (gameIndex > scope.startMoveIndex) {
        const move = boundedMoves[gameIndex - 1];

        if (move) {
          pathSan.push(move.san);
          pathUci.push(move.uci);
        }
      }

      const pathKey = pathUci.join(' ');
      const nextPathCount = (pathCounts.get(`${fenKey}:${pathKey}`) ?? 0) + count;
      pathCounts.set(`${fenKey}:${pathKey}`, nextPathCount);
      const currentBest = pathByFenKey.get(fenKey);
      const currentBestCount = currentBest ? (pathCounts.get(`${fenKey}:${currentBest.uci.join(' ')}`) ?? 0) : 0;

      if (!currentBest || nextPathCount >= currentBestCount) {
        pathByFenKey.set(fenKey, { san: [...pathSan], uci: [...pathUci] });
      }
    }

    for (let gameIndex = scope.startMoveIndex; gameIndex < boundedMoves.length; gameIndex += 1) {
      const move = boundedMoves[gameIndex]!;

      if (!move) {
        continue;
      }

      const fromFenKey = normalizeOpeningFen(move.fenBefore);
      const toFenKey = normalizeOpeningFen(move.fenAfter);
      const fromNodeId = buildOpeningNodeId(options.ownerProfileId, scope, fromFenKey);
      const toNodeId = buildOpeningNodeId(options.ownerProfileId, scope, toFenKey);
      const edgeId = `opening-edge-${shortHash(`${graphId}:${fromNodeId}:${move.uci}`)}`;
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
    id: graphId,
    library: scope.library,
    trainSide: scope.trainSide,
    graphRootFenKey: scope.graphRootFenKey,
    targetDepth: options.targetDepth,
    nodes: [...nodes.values()].sort((left, right) => left.ply - right.ply || left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id)),
  };
}

export function buildCatalogEntries(
  graph: OpeningGraphDraft,
  items: Array<{ input: OpeningTreeBuildInput; parsed: OpeningMove[] }>,
  options: { catalogPly: number; catalogMinSources: number },
): OpeningCatalogDraft[] {
  const pathByFenKey = new Map<string, { san: string[]; uci: string[]; weight: number }>();

  for (const item of items) {
    const parsed = item.parsed;
    const count = item.input.count ?? 1;
    const scope = resolveOpeningGraphScope(item.input, parsed);

    if (!scope) {
      continue;
    }

    const pathSan: string[] = [];
    const pathUci: string[] = [];

    for (let gameIndex = scope.startMoveIndex; gameIndex <= parsed.length; gameIndex += 1) {
      const graphPly = gameIndex - scope.startMoveIndex;
      const fen =
        graphPly === 0
          ? (parsed[scope.startMoveIndex]?.fenBefore ?? scope.graphRootFen)
          : parsed[gameIndex - 1]?.fenAfter;

      if (!fen) {
        continue;
      }

      const fenKey = normalizeOpeningFen(fen);

      if (gameIndex > scope.startMoveIndex) {
        const move = parsed[gameIndex - 1];

        if (move) {
          pathSan.push(move.san);
          pathUci.push(move.uci);
        }
      }

      const current = pathByFenKey.get(fenKey);
      const nextWeight = (current?.weight ?? 0) + count;

      if (!current || nextWeight >= current.weight) {
        pathByFenKey.set(fenKey, { san: [...pathSan], uci: [...pathUci], weight: nextWeight });
      }
    }
  }

  const catalogs: OpeningCatalogDraft[] = [];

  for (const node of graph.nodes) {
    if (node.ply !== options.catalogPly) {
      continue;
    }

    const sourceCount = node.recentGames + node.cardCount;

    if (sourceCount < options.catalogMinSources) {
      continue;
    }

    const path = pathByFenKey.get(node.fenKey) ?? { san: [], uci: [], weight: 0 };
    const dominantName =
      items.find((item) => formatOpeningTreeDisplayName(item.input.name) !== 'Opening')?.input.name ?? 'Opening';

    catalogs.push({
      id: buildOpeningCatalogId(graph.id, node.fenKey, options.catalogPly),
      graphId: graph.id,
      entryNodeId: node.id,
      catalogPly: options.catalogPly,
      library: graph.library,
      fenKey: node.fenKey,
      name: deriveCatalogName(dominantName, path.san),
      displaySan: path.san,
      displayUci: path.uci,
      sourceCount,
      subgraphNodeCount: countReachableNodes(node.id, graph.nodes, graph.edges),
    });
  }

  return catalogs.sort((left, right) => right.sourceCount - left.sourceCount);
}

export function mergeOpeningGraphDraft(
  existing: OpeningGraphDraft,
  deltaInputs: OpeningTreeBuildInput[],
  options: { ownerProfileId: string; targetDepth: number },
): { draft: OpeningGraphDraft; newNodeIds: Set<string>; newEdgeIds: Set<string> } {
  const scopeItems = deltaInputs
    .map((input) => {
      const parsed = parseSanMoves(input.moves);
      const scope = resolveOpeningGraphScope(input, parsed);

      if (!scope || scope.trainSide !== existing.trainSide || scope.library !== existing.library) {
        return null;
      }

      return { input, parsed, scope };
    })
    .filter((item): item is { input: OpeningTreeBuildInput; parsed: OpeningMove[]; scope: OpeningGraphScope } =>
      Boolean(item),
    );

  if (scopeItems.length === 0) {
    return { draft: existing, newNodeIds: new Set(), newEdgeIds: new Set() };
  }

  const fresh = buildGraphForScope(
    {
      library: existing.library,
      trainSide: existing.trainSide,
      graphRootFen: existing.nodes.find((node) => node.ply === 0)?.fen ?? new Chess().fen(),
      graphRootFenKey: existing.graphRootFenKey,
      startMoveIndex: existing.trainSide === 'white' ? 0 : 1,
    },
    scopeItems.map((item) => ({ input: item.input, parsed: item.parsed })),
    options,
  );

  const nodeByFenKey = new Map(existing.nodes.map((node) => [node.fenKey, node]));
  const edgeByKey = new Map(existing.edges.map((edge) => [`${edge.fromNodeId}:${edge.uci}`, edge]));
  const newNodeIds = new Set<string>();
  const newEdgeIds = new Set<string>();

  for (const node of fresh.nodes) {
    const current = nodeByFenKey.get(node.fenKey);

    if (!current) {
      existing.nodes.push(node);
      nodeByFenKey.set(node.fenKey, node);
      newNodeIds.add(node.id);
      continue;
    }

    current.recentGames += node.recentGames;
    current.cardCount += node.cardCount;
  }

  for (const edge of fresh.edges) {
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

  existing.targetDepth = Math.max(existing.targetDepth, options.targetDepth);
  existing.nodes.sort((left, right) => left.ply - right.ply || left.id.localeCompare(right.id));
  existing.edges.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));

  return { draft: existing, newNodeIds, newEdgeIds };
}

export function graphDraftFromRows(
  graphRow: Record<string, unknown>,
  nodeRows: Array<Record<string, unknown>>,
  edgeRows: Array<Record<string, unknown>>,
): OpeningGraphDraft {
  return {
    id: String(graphRow.id),
    library: mapOpeningLibraryFromDb(graphRow.library),
    trainSide: graphRow.train_side === 'black' ? 'black' : 'white',
    graphRootFenKey: String(graphRow.root_fen_key ?? ''),
    targetDepth: Number(graphRow.target_depth ?? DEFAULT_OPENING_TARGET_DEPTH),
    nodes: nodeRows.map((row) => ({
      id: String(row.id),
      fen: String(row.fen),
      fenKey: String(row.fen_key),
      ply: Number(row.ply ?? row.min_ply ?? 0),
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

export function catalogDraftFromRow(row: Record<string, unknown>): OpeningCatalogDraft {
  return {
    id: String(row.id),
    graphId: String(row.graph_id),
    entryNodeId: String(row.entry_node_id),
    catalogPly: Number(row.catalog_ply ?? OPENING_CATALOG_PLY),
    library: mapOpeningLibraryFromDb(row.library),
    fenKey: String(row.fen_key),
    name: String(row.name ?? 'Opening'),
    displaySan: Array.isArray(row.display_san) ? row.display_san.map(String) : [],
    displayUci: Array.isArray(row.display_uci) ? row.display_uci.map(String) : [],
    sourceCount: Number(row.source_count ?? 0),
    subgraphNodeCount: Number(row.subgraph_node_count ?? 0),
  };
}

export function projectCatalogToTreeDraft(graph: OpeningGraphDraft, catalog: OpeningCatalogDraft): OpeningTreeDraft {
  const detail = projectCatalogSubgraph(graph, graph.nodes, graph.edges, catalog, new Map());
  return {
    id: catalog.id,
    name: catalog.name,
    library: graph.library,
    rootFenKey: catalog.fenKey,
    rootPly: catalog.catalogPly,
    rootSan: catalog.displaySan,
    rootUci: catalog.displayUci,
    sourceCount: catalog.sourceCount,
    targetDepth: graph.targetDepth,
    trainSide: graph.trainSide,
    nodes: detail.nodes.map((node) => ({
      id: node.id,
      fen: node.fen,
      fenKey: node.fenKey,
      ply: node.ply,
      sideToMove: node.sideToMove,
      trainSide: graph.trainSide,
      bestUci: node.bestUci,
      bestSan: node.bestSan,
      evalCp: node.evalCp,
      recentGames: node.recentGames,
      cardCount: node.cardCount,
    })),
    edges: detail.edges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      uci: edge.uci,
      san: edge.san,
      moveBy: edge.moveBy,
      source: edge.source,
      recentCount: edge.recentCount,
      cardCount: edge.cardCount,
      mastersGames: edge.mastersGames,
      priority: edge.priority,
      isEngineBest: edge.isEngineBest,
    })),
  };
}

export function projectCatalogSubgraph(
  graph: Pick<OpeningGraphDraft, 'library' | 'trainSide' | 'targetDepth'>,
  graphNodes: OpeningNodeDraft[] | OpeningTreeNode[],
  graphEdges: OpeningEdgeDraft[] | OpeningTreeEdge[],
  catalog: OpeningCatalogDraft,
  progress: Map<string, OpeningGraphProgressEntry>,
): OpeningTreeDetail {
  const nodes: OpeningTreeNode[] = graphNodes.map((node) => {
    const entry = progress.get(node.id);

    return {
      id: node.id,
      fen: node.fen,
      fenKey: node.fenKey,
      ply: node.ply,
      sideToMove: node.sideToMove,
      bestUci: node.bestUci ?? null,
      bestSan: node.bestSan ?? null,
      evalCp: node.evalCp ?? null,
      recentGames: node.recentGames,
      cardCount: node.cardCount,
      masteryScore: entry?.masteryScore ?? 0,
      seenCount: entry?.seenCount ?? 0,
      correctCount: entry?.correctCount ?? 0,
      missCount: entry?.missCount ?? 0,
    };
  });
  const edges: OpeningTreeEdge[] = graphEdges.map((edge) => ({
    id: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    uci: edge.uci,
    san: edge.san,
    moveBy: edge.moveBy,
    source: edge.source,
    recentCount: edge.recentCount,
    cardCount: edge.cardCount,
    mastersGames: edge.mastersGames,
    priority: edge.priority,
    isEngineBest: edge.isEngineBest,
  }));
  const fullTree: OpeningTreeDetail = {
    id: catalog.id,
    name: catalog.name,
    library: graph.library,
    rootFenKey: catalog.fenKey,
    rootPly: catalog.catalogPly,
    rootSan: catalog.displaySan,
    rootUci: catalog.displayUci,
    sourceCount: catalog.sourceCount,
    targetDepth: graph.targetDepth,
    nodeCount: nodes.length,
    dueCount: 0,
    masteryScore: 0,
    updatedAt: null,
    nodes,
    edges,
  };

  const sliced = filterOpeningTreeForDisplay(fullTree, catalog.catalogPly);
  const trainNodes = sliced.nodes.filter((node) => node.masteryScore > 0 || node.seenCount > 0);
  const rawMasteryScore =
    trainNodes.length > 0 ? trainNodes.reduce((sum, node) => sum + node.masteryScore, 0) / trainNodes.length : 0;
  const masteryScore = Number(rawMasteryScore.toFixed(2));
  const dueCount = sliced.nodes.filter((node) => node.masteryScore < 80).length;

  return {
    ...sliced,
    id: catalog.id,
    name: catalog.name,
    rootFenKey: catalog.fenKey,
    rootPly: catalog.catalogPly,
    rootSan: catalog.displaySan,
    rootUci: catalog.displayUci,
    sourceCount: catalog.sourceCount,
    nodeCount: sliced.nodes.length,
    dueCount,
    masteryScore,
  };
}

export function catalogToSummary(
  graph: Pick<OpeningGraphDraft, 'library' | 'trainSide' | 'targetDepth'>,
  catalog: OpeningCatalogDraft,
  progress: Map<string, OpeningGraphProgressEntry>,
  graphNodes: OpeningNodeDraft[] | OpeningTreeNode[],
  graphEdges: OpeningEdgeDraft[] | OpeningTreeEdge[],
): OpeningTreeSummary {
  const subgraph = projectCatalogSubgraph(graph, graphNodes, graphEdges, catalog, progress);

  return {
    id: catalog.id,
    name: catalog.name,
    library: graph.library,
    rootFenKey: catalog.fenKey,
    rootPly: catalog.catalogPly,
    rootSan: catalog.displaySan,
    rootUci: catalog.displayUci,
    sourceCount: catalog.sourceCount,
    targetDepth: graph.targetDepth,
    nodeCount: catalog.subgraphNodeCount,
    dueCount: subgraph.dueCount,
    masteryScore: subgraph.masteryScore,
    updatedAt: new Date().toISOString(),
  };
}

function getSideToMove(fen: string): OpeningSide {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

export function buildOpeningTrees(
  inputs: OpeningTreeBuildInput[],
  options: { ownerProfileId: string; targetDepth?: number; rootPly?: number; catalogPly?: number },
): OpeningTreeDraft[] {
  const catalogPly =
    options.catalogPly ?? (options.rootPly != null && options.rootPly > 0 ? options.rootPly : OPENING_CATALOG_PLY);
  const forest = buildOpeningGraphForest(inputs, {
    ownerProfileId: options.ownerProfileId,
    targetDepth: options.targetDepth,
    catalogPly,
  });
  const graphById = new Map(forest.graphs.map((graph) => [graph.id, graph]));

  return forest.catalogs
    .map((catalog) => {
      const graph = graphById.get(catalog.graphId);

      if (!graph) {
        return null;
      }

      return projectCatalogToTreeDraft(graph, catalog);
    })
    .filter((draft): draft is OpeningTreeDraft => draft != null);
}

export function mergeOpeningTreeDelta(
  existing: OpeningTreeDraft,
  deltaInputs: OpeningTreeBuildInput[],
  options: { ownerProfileId: string; targetDepth: number; rootPly: number },
): { draft: OpeningTreeDraft; newNodeIds: Set<string>; newEdgeIds: Set<string> } {
  const existingGraph: OpeningGraphDraft = {
    id: buildOpeningGraphId(options.ownerProfileId, {
      trainSide: existing.trainSide,
      library: existing.library,
    }),
    library: existing.library,
    trainSide: existing.trainSide,
    graphRootFenKey: existing.rootFenKey,
    targetDepth: existing.targetDepth,
    nodes: existing.nodes,
    edges: existing.edges,
  };
  const merged = mergeOpeningGraphDraft(existingGraph, deltaInputs, {
    ownerProfileId: options.ownerProfileId,
    targetDepth: options.targetDepth,
  });
  const catalog = buildCatalogEntries(merged.draft, catalogItemsFromInputs(deltaInputs), {
    catalogPly: options.rootPly,
    catalogMinSources: 1,
  }).find((entry) => entry.fenKey === existing.rootFenKey) ?? {
    id: existing.id,
    graphId: merged.draft.id,
    entryNodeId: merged.draft.nodes.find((node) => node.fenKey === existing.rootFenKey)?.id ?? existing.nodes[0]!.id,
    catalogPly: existing.rootPly,
    library: existing.library,
    fenKey: existing.rootFenKey,
    name: existing.name,
    displaySan: existing.rootSan,
    displayUci: existing.rootUci,
    sourceCount:
      (merged.draft.nodes.find((node) => node.fenKey === existing.rootFenKey)?.recentGames ?? 0) +
        (merged.draft.nodes.find((node) => node.fenKey === existing.rootFenKey)?.cardCount ?? 0) ||
      existing.sourceCount,
    subgraphNodeCount: merged.draft.nodes.length,
  };

  return {
    draft: projectCatalogToTreeDraft(merged.draft, catalog),
    newNodeIds: merged.newNodeIds,
    newEdgeIds: merged.newEdgeIds,
  };
}

function catalogItemsFromInputs(inputs: OpeningTreeBuildInput[]) {
  return inputs.map((input) => ({
    input,
    parsed: parseSanMoves(input.moves),
  }));
}
