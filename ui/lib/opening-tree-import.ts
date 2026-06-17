import {
  buildCatalogEntries,
  buildOpeningGraphForest,
  catalogDraftFromRow,
  graphDraftFromRows,
  mergeOpeningGraphDraft,
  OPENING_CATALOG_PLY,
  type OpeningCatalogDraft,
  type OpeningGraphDraft,
  type OpeningGraphForest,
  projectCatalogToTreeDraft,
} from './opening-graph.ts';
import {
  draftFromPreloadedTree,
  type OpeningBuildMode,
  type OpeningTreeBuildInput,
  type OpeningTreeDraft,
  parseSanMoves,
  resolveTargetDepthForBuildMode,
  shouldEnrichNodeLazy,
} from './opening-tree.ts';

export { OPENING_CATALOG_PLY as OPENING_BUILD_ROOT_PLY };

export type OpeningTreeImportResult = {
  imported: number;
  nodes: number;
  edges: number;
  skippedGames: number;
  graphs: number;
  catalogs: number;
};

export function buildInputsFromRows(
  lines: Record<string, unknown>[],
  cards: Record<string, unknown>[],
): OpeningTreeBuildInput[] {
  const lineInputs = lines.flatMap((line) => {
    const moves = Array.isArray(line.moves) ? line.moves.map(String) : [];

    if (moves.length === 0) {
      return [];
    }

    return [
      {
        id: String(line.id),
        name: String(line.name ?? 'Opening'),
        trainSide: (line.side === 'black' ? 'black' : 'white') as 'white' | 'black',
        moves,
        source: 'recent_game' as const,
        count: 1,
      },
    ];
  });

  const cardInputs = cards.flatMap((card) => {
    const setupMoves = Array.isArray(card.setup_moves) ? card.setup_moves.map(String) : [];
    const answerSan = String(card.answer_san ?? '');
    const moves = [...setupMoves, answerSan].filter(Boolean);

    if (moves.length === 0) {
      return [];
    }

    return [
      {
        id: String(card.id),
        name: String(card.line_name ?? 'Opening'),
        trainSide: (card.side === 'black' ? 'black' : 'white') as 'white' | 'black',
        moves,
        source: 'card' as const,
        count: 1,
        scoreSwingCp: card.score_swing_cp == null ? null : Number(card.score_swing_cp),
      },
    ];
  });

  return [...lineInputs, ...cardInputs];
}

export function buildFreshOpeningForest(
  inputs: OpeningTreeBuildInput[],
  options: { ownerProfileId: string; targetDepth: number; catalogPly?: number },
): OpeningGraphForest {
  return buildOpeningGraphForest(inputs, {
    ownerProfileId: options.ownerProfileId,
    targetDepth: options.targetDepth,
    catalogPly: options.catalogPly ?? OPENING_CATALOG_PLY,
  });
}

export function catalogItemsFromInputs(inputs: OpeningTreeBuildInput[]) {
  return inputs.map((input) => ({
    input,
    parsed: parseSanMoves(input.moves),
  }));
}

export function rebuildCatalogsForGraph(
  graph: OpeningGraphDraft,
  items: OpeningTreeBuildInput[],
  catalogPly: number = OPENING_CATALOG_PLY,
): OpeningCatalogDraft[] {
  return buildCatalogEntries(graph, catalogItemsFromInputs(items), {
    catalogPly,
    catalogMinSources: 1,
  });
}

export function mergeIncrementalOpeningForest(
  existingGraphs: Array<{
    graphRow: Record<string, unknown>;
    nodeRows: Array<Record<string, unknown>>;
    edgeRows: Array<Record<string, unknown>>;
    catalogRows: Array<Record<string, unknown>>;
  }>,
  deltaInputs: OpeningTreeBuildInput[],
  options: { ownerProfileId: string; mode: OpeningBuildMode; currentTargetDepth?: number },
): {
  forest: OpeningGraphForest;
  newNodeCount: number;
  newEdgeCount: number;
} {
  const targetDepth = resolveTargetDepthForBuildMode(options.mode, options.currentTargetDepth);
  const freshForest = buildFreshOpeningForest(deltaInputs, {
    ownerProfileId: options.ownerProfileId,
    targetDepth,
  });
  const graphs: OpeningGraphDraft[] = [];
  const catalogs: OpeningCatalogDraft[] = [];
  let newNodeCount = 0;
  let newEdgeCount = 0;

  const existingById = new Map(
    existingGraphs.map((bundle) => [
      String(bundle.graphRow.id),
      graphDraftFromRows(bundle.graphRow, bundle.nodeRows, bundle.edgeRows),
    ]),
  );
  const touchedGraphIds = new Set<string>();

  for (const freshGraph of freshForest.graphs) {
    const existing = existingById.get(freshGraph.id);

    if (!existing) {
      graphs.push(freshGraph);
      newNodeCount += freshGraph.nodes.length;
      newEdgeCount += freshGraph.edges.length;
      touchedGraphIds.add(freshGraph.id);
      catalogs.push(...rebuildCatalogsForGraph(freshGraph, deltaInputs));
      continue;
    }

    const merged = mergeOpeningGraphDraft(existing, deltaInputs, {
      ownerProfileId: options.ownerProfileId,
      targetDepth,
    });
    newNodeCount += merged.newNodeIds.size;
    newEdgeCount += merged.newEdgeIds.size;
    graphs.push(merged.draft);
    touchedGraphIds.add(merged.draft.id);
    catalogs.push(...rebuildCatalogsForGraph(merged.draft, deltaInputs));
  }

  for (const bundle of existingGraphs) {
    const graphId = String(bundle.graphRow.id);

    if (touchedGraphIds.has(graphId)) {
      continue;
    }

    const graph = graphDraftFromRows(bundle.graphRow, bundle.nodeRows, bundle.edgeRows);
    graphs.push(graph);
    catalogs.push(...bundle.catalogRows.map((row) => catalogDraftFromRow(row)));
  }

  return {
    forest: { graphs, catalogs },
    newNodeCount,
    newEdgeCount,
  };
}

export function forestToUpsertRows(forest: OpeningGraphForest, now: string) {
  return {
    graphs: forest.graphs.map((graph) => ({
      id: graph.id,
      library: graph.library,
      train_side: graph.trainSide,
      root_fen_key: graph.graphRootFenKey,
      target_depth: graph.targetDepth,
      node_count: graph.nodes.length,
      edge_count: graph.edges.length,
      catalog_version: 1,
      built_at: now,
      updated_at: now,
    })),
    nodes: forest.graphs.flatMap((graph) =>
      graph.nodes.map((node) => ({
        id: node.id,
        graph_id: graph.id,
        fen: node.fen,
        fen_key: node.fenKey,
        ply: node.ply,
        side_to_move: node.sideToMove,
        train_side: node.trainSide ?? graph.trainSide,
        best_uci: node.bestUci ?? null,
        best_san: node.bestSan ?? null,
        eval_cp: node.evalCp ?? null,
        recent_games: node.recentGames,
        card_count: node.cardCount,
        updated_at: now,
      })),
    ),
    edges: forest.graphs.flatMap((graph) =>
      graph.edges.map((edge) => ({
        id: edge.id,
        graph_id: graph.id,
        from_node_id: edge.fromNodeId,
        to_node_id: edge.toNodeId,
        uci: edge.uci,
        san: edge.san,
        move_by: edge.moveBy,
        source: edge.source,
        recent_count: edge.recentCount,
        card_count: edge.cardCount,
        masters_games: edge.mastersGames,
        priority: edge.priority,
        is_engine_best: edge.isEngineBest,
        updated_at: now,
      })),
    ),
    catalogs: forest.catalogs.map((catalog) => {
      const graph = forest.graphs.find((candidate) => candidate.id === catalog.graphId);

      return {
        id: catalog.id,
        graph_id: catalog.graphId,
        entry_node_id: catalog.entryNodeId,
        catalog_ply: catalog.catalogPly,
        library: catalog.library,
        fen_key: catalog.fenKey,
        name: catalog.name,
        display_san: catalog.displaySan,
        display_uci: catalog.displayUci,
        source_count: catalog.sourceCount,
        subgraph_node_count: catalog.subgraphNodeCount,
        target_depth: graph?.targetDepth ?? 22,
        updated_at: now,
      };
    }),
  };
}

export function graphDraftToTreeDrafts(graph: OpeningGraphDraft, catalogs: OpeningCatalogDraft[]): OpeningTreeDraft[] {
  return catalogs
    .filter((catalog) => catalog.graphId === graph.id)
    .map((catalog) => projectCatalogToTreeDraft(graph, catalog));
}

export function draftToUpsertRows(draft: OpeningTreeDraft, now: string) {
  return {
    tree: {
      id: draft.id,
      library: draft.library,
      name: draft.name,
      root_fen_key: draft.rootFenKey,
      root_ply: draft.rootPly,
      root_san: draft.rootSan,
      root_uci: draft.rootUci,
      source_count: draft.sourceCount,
      target_depth: draft.targetDepth,
      updated_at: now,
    },
    nodes: draft.nodes.map((node) => ({
      id: node.id,
      tree_id: draft.id,
      fen: node.fen,
      fen_key: node.fenKey,
      ply: node.ply,
      side_to_move: node.sideToMove,
      train_side: node.trainSide ?? draft.trainSide,
      best_uci: node.bestUci ?? null,
      best_san: node.bestSan ?? null,
      eval_cp: node.evalCp ?? null,
      recent_games: node.recentGames,
      card_count: node.cardCount,
      updated_at: now,
    })),
    edges: draft.edges.map((edge) => ({
      id: edge.id,
      tree_id: draft.id,
      from_node_id: edge.fromNodeId,
      to_node_id: edge.toNodeId,
      uci: edge.uci,
      san: edge.san,
      move_by: edge.moveBy,
      source: edge.source,
      recent_count: edge.recentCount,
      card_count: edge.cardCount,
      masters_games: edge.mastersGames,
      priority: edge.priority,
      is_engine_best: edge.isEngineBest,
      updated_at: now,
    })),
  };
}

export function listNodesNeedingEnrichment(graph: OpeningGraphDraft, mode: OpeningBuildMode) {
  return graph.nodes.filter((node) => shouldEnrichNodeLazy(node, graph.trainSide, mode));
}

export function legacyDraftFromPreloadedTree(
  treeRow: Record<string, unknown>,
  nodeRows: Array<Record<string, unknown>>,
  edgeRows: Array<Record<string, unknown>>,
): OpeningTreeDraft {
  return draftFromPreloadedTree(treeRow, nodeRows, edgeRows);
}
