import {
  buildOpeningTrees,
  DEFAULT_OPENING_ROOT_PLY,
  draftFromPreloadedTree,
  mapOpeningLibraryToDb,
  mergeOpeningTreeDelta,
  type OpeningBuildMode,
  type OpeningTreeBuildInput,
  type OpeningTreeDraft,
  resolveTargetDepthForBuildMode,
  shouldEnrichNodeLazy,
} from '@/lib/opening-tree';

export const OPENING_BUILD_ROOT_PLY = 4;

export type OpeningTreeImportResult = {
  imported: number;
  nodes: number;
  edges: number;
  skippedGames: number;
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
  options: { ownerProfileId: string; targetDepth: number; rootPly?: number },
): OpeningTreeDraft[] {
  return buildOpeningTrees(inputs, {
    ownerProfileId: options.ownerProfileId,
    targetDepth: options.targetDepth,
    rootPly: options.rootPly ?? OPENING_BUILD_ROOT_PLY,
  });
}

export function mergeIncrementalOpeningForest(
  existingTrees: Array<{
    treeRow: Record<string, unknown>;
    nodeRows: Array<Record<string, unknown>>;
    edgeRows: Array<Record<string, unknown>>;
  }>,
  deltaInputs: OpeningTreeBuildInput[],
  options: { ownerProfileId: string; mode: OpeningBuildMode; currentTargetDepth?: number },
): { drafts: OpeningTreeDraft[]; newNodeCount: number; newEdgeCount: number } {
  const targetDepth = resolveTargetDepthForBuildMode(options.mode, options.currentTargetDepth);
  const freshTrees = buildFreshOpeningForest(deltaInputs, {
    ownerProfileId: options.ownerProfileId,
    targetDepth,
  });
  const drafts: OpeningTreeDraft[] = [];
  let newNodeCount = 0;
  let newEdgeCount = 0;

  for (const fresh of freshTrees) {
    const existingBundle = existingTrees.find((bundle) => String(bundle.treeRow.root_fen_key) === fresh.rootFenKey);

    if (!existingBundle) {
      drafts.push(fresh);
      newNodeCount += fresh.nodes.length;
      newEdgeCount += fresh.edges.length;
      continue;
    }

    const existingDraft = draftFromPreloadedTree(
      existingBundle.treeRow,
      existingBundle.nodeRows,
      existingBundle.edgeRows,
    );
    const merged = mergeOpeningTreeDelta(existingDraft, deltaInputs, {
      ownerProfileId: options.ownerProfileId,
      targetDepth,
      rootPly: OPENING_BUILD_ROOT_PLY,
    });
    newNodeCount += merged.newNodeIds.size;
    newEdgeCount += merged.newEdgeIds.size;
    drafts.push(merged.draft);
  }

  return { drafts, newNodeCount, newEdgeCount };
}

export function draftToUpsertRows(draft: OpeningTreeDraft, now: string) {
  return {
    tree: {
      id: draft.id,
      library: mapOpeningLibraryToDb(draft.library),
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

export function listNodesNeedingEnrichment(draft: OpeningTreeDraft, mode: OpeningBuildMode) {
  return draft.nodes.filter((node) => shouldEnrichNodeLazy(node, draft.trainSide, mode));
}
