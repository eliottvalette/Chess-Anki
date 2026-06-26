import { Chess } from 'chess.js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { buildReviewAnalyzeRequest } from '@/lib/analysis-profile';
import { AsyncTtlCache } from '@/lib/async-ttl-cache';
import { extractTag, fetchArchives, fetchRecentGames, inferOutcome, type RawChessComGame } from '@/lib/chesscom';
import { LINES_EARLY_OPENING_MAX_PLY } from '@/lib/lines-board-eval';
import { fetchLichessOpeningExplorer } from '@/lib/opening-book';
import {
  buildDynamicCatalogEntries,
  buildRecentDynamicBrowseSummaries,
  catalogDraftFromRow,
  findDynamicCatalogEntry,
  findDynamicCatalogEntryById,
  graphDraftFromRows,
  type OpeningGraphDraft,
  projectCatalogSubgraph,
  projectTreeFromFenKey,
} from '@/lib/opening-graph';

import {
  chooseWeightedOpponentEdge,
  DEFAULT_OPENING_TARGET_DEPTH,
  ensureDraftEdge,
  listOpponentNodesForLichessEnrichment,
  listOpponentNodesNeedingBookEnrichment,
  mapOpeningLibraryFromDb,
  normalizeOpeningFen,
  type OpeningBuildMode,
  type OpeningLibrary,
  type OpeningSide,
  type OpeningTreeBuildInput,
  type OpeningTreeDetail,
  type OpeningTreeDraft,
  type OpeningTreeSummary,
  pruneOpeningTreeDraft,
  resolveTargetDepthForBuildMode,
  shortHash,
} from '@/lib/opening-tree';
import {
  buildFreshOpeningForest,
  buildInputsFromRows,
  forestToUpsertRows,
  listNodesNeedingEnrichment,
  mergeIncrementalOpeningForest,
  OPENING_BUILD_ROOT_PLY,
  type OpeningTreeImportResult,
} from '@/lib/opening-tree-import';
import { getStockfishSession, getStockfishSessionPool } from '@/lib/stockfish-session';
import { hashTrainingSessionToken, parseTrainingSessionCookie, TRAINING_SESSION_COOKIE } from '@/lib/training-profile';
import { createAdminClient } from '@/utils/supabase/admin';

const CATALOG_SELECT =
  'id,graph_id,entry_node_id,catalog_ply,library,fen_key,name,display_san,display_uci,source_count,subgraph_node_count,target_depth,updated_at';
const NODE_SELECT =
  'id,graph_id,fen,fen_key,ply,side_to_move,train_side,best_uci,best_san,eval_cp,recent_games,card_count,win_count,loss_count,draw_count';
const EDGE_SELECT =
  'id,graph_id,from_node_id,to_node_id,uci,san,move_by,source,recent_count,card_count,masters_games,priority,is_engine_best';
const _CARD_SELECT = 'id,line_name,eco,side,answer_san,context,setup_moves,source_type,score_swing_cp';
const MAX_ENGINE_IMPORT_NODES = 120;
const MAX_LICHESS_IMPORT_NODES = 80;
const MAX_RECENT_LINE_EVALS = 80;
const RECENT_LINE_EVAL_DEPTH = 10;
const openingGraphCache = new AsyncTtlCache<string, OpeningGraphDraft[]>({ maxEntries: 4, ttlMs: 60_000 });
const recentOpeningGraphCache = new AsyncTtlCache<string, RecentOpeningForest>({
  maxEntries: 8,
  ttlMs: 60_000,
});
const openingProgressCache = new AsyncTtlCache<string, Map<string, ProgressEntry>>({ maxEntries: 4, ttlMs: 1_000 });
const openingProfileCache = new AsyncTtlCache<string, TrainingProfileCookie | null>({
  maxEntries: 8,
  ttlMs: 30_000,
});

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const profile = await getTrainingProfileFromCookie();

  if (!profile) {
    return NextResponse.json({ error: 'No training profile.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const treeId = url.searchParams.get('treeId');
  const full = url.searchParams.get('full') === 'true';
  const atFenKey = url.searchParams.get('atFenKey');
  const browsePlyParam = url.searchParams.get('browsePly');
  const browsePly = browsePlyParam == null ? null : Math.max(1, Number(browsePlyParam) || 1);
  const requestedTrainSide = parseOpeningSide(url.searchParams.get('trainSide'));
  const requestedRootUci = parseRootUciParam(url.searchParams.get('rootUci'));
  const chesscomUsername = String(url.searchParams.get('username') ?? profile.username)
    .trim()
    .toLowerCase();

  try {
    const supabase = createAdminClient();

    if (atFenKey) {
      const tree = await fetchProjectedTreeAtFenKey(supabase, profile.id, atFenKey);
      return NextResponse.json({ tree });
    }

    if (treeId) {
      const detail = await fetchTreeDetail(supabase, profile, treeId, {
        browsePly,
        chesscomUsername,
        requestedTrainSide,
        requestedRootUci,
      });
      return detail
        ? NextResponse.json({ tree: detail })
        : NextResponse.json({ error: 'Opening tree not found.' }, { status: 404 });
    }

    if (full) {
      const fullTrees = await fetchFullTrees(supabase, profile.id);
      return NextResponse.json({ trees: fullTrees });
    }

    const summaries =
      browsePly != null
        ? await fetchRecentDynamicTreeSummaries(supabase, profile, browsePly, chesscomUsername)
        : await fetchTreeSummaries(supabase, profile.id);
    return NextResponse.json({ trees: summaries });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load opening trees.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const profile = await getTrainingProfileFromCookie();

  if (!profile) {
    return NextResponse.json({ error: 'No training profile.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');

  try {
    if (action === 'import_recent') {
      const mode = parseBuildMode(body.mode);
      const timeClasses = parseTimeClasses(body.timeClasses);
      const maxGames = body.maxGames == null ? null : Number(body.maxGames);
      const treeId = body.treeId == null ? null : String(body.treeId);
      return importRecentOpeningTrees(profile, { mode, timeClasses, maxGames, treeId });
    }

    if (action === 'attempt') {
      return recordAttempt(profile, body);
    }

    if (action === 'enrich_book') {
      return enrichOpponentBookMoves(profile);
    }

    if (action === 'next') {
      return chooseNextStep(profile, body);
    }

    return NextResponse.json({ error: 'Unknown opening tree action.' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update opening trees.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function importRecentOpeningTrees(
  profile: TrainingProfileCookie,
  options: {
    mode: OpeningBuildMode;
    timeClasses: string[];
    maxGames: number | null;
    treeId: string | null;
  },
) {
  const supabase = createAdminClient();
  const buildState = await loadBuildState(supabase, profile.id, options.timeClasses[0] ?? 'all');
  const currentTargetDepth = buildState?.target_depth ?? DEFAULT_OPENING_TARGET_DEPTH;
  const targetDepth =
    options.mode === 'extend_depth' && options.treeId
      ? resolveTargetDepthForBuildMode('extend_depth', currentTargetDepth)
      : resolveTargetDepthForBuildMode(options.mode, currentTargetDepth);
  const { inputs, processedIds, skippedGames } = await loadDeltaInputs(
    supabase,
    profile.id,
    buildState?.processed_game_ids ?? [],
    options,
  );

  if (inputs.length === 0) {
    return NextResponse.json({
      imported: 0,
      nodes: 0,
      edges: 0,
      skippedGames,
      graphs: 0,
      catalogs: 0,
    } satisfies OpeningTreeImportResult);
  }

  const existingBundles = await loadExistingGraphBundles(supabase, profile.id);
  const merged =
    existingBundles.length > 0
      ? mergeIncrementalOpeningForest(existingBundles, inputs, {
          ownerProfileId: profile.id,
          mode: options.mode,
          currentTargetDepth,
        })
      : {
          forest: buildFreshOpeningForest(inputs, {
            ownerProfileId: profile.id,
            targetDepth,
            catalogPly: OPENING_BUILD_ROOT_PLY,
          }),
          newNodeCount: 0,
          newEdgeCount: 0,
        };

  let nodeCount = 0;
  let edgeCount = 0;

  for (const graph of merged.forest.graphs) {
    if (options.mode !== 'fast') {
      await enrichOpeningGraphDraft(graph, options.mode);
    } else {
      await enrichLichessBookMoves(asTreeDraft(graph));
    }

    pruneOpeningGraphDraft(graph);
  }

  await upsertForestDraft(supabase, profile.id, merged.forest);
  nodeCount = merged.forest.graphs.reduce((total, graph) => total + graph.nodes.length, 0);
  edgeCount = merged.forest.graphs.reduce((total, graph) => total + graph.edges.length, 0);

  await saveBuildState(supabase, profile.id, options.timeClasses[0] ?? 'all', {
    build_mode: options.mode,
    target_depth: targetDepth,
    processed_game_ids: [...new Set([...(buildState?.processed_game_ids ?? []), ...processedIds])],
    last_imported_at: new Date().toISOString(),
  });

  return NextResponse.json({
    imported: merged.forest.catalogs.length,
    nodes: nodeCount,
    edges: edgeCount,
    skippedGames,
    graphs: merged.forest.graphs.length,
    catalogs: merged.forest.catalogs.length,
  } satisfies OpeningTreeImportResult);
}

async function loadBuildState(supabase: ReturnType<typeof createAdminClient>, profileId: string, timeClass: string) {
  const { data, error } = await supabase
    .from('opening_build_state')
    .select('processed_game_ids,build_mode,target_depth,last_imported_at')
    .eq('profile_id', profileId)
    .eq('time_class', timeClass)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return {
    processed_game_ids: Array.isArray(data.processed_game_ids) ? data.processed_game_ids.map(String) : [],
    build_mode: String(data.build_mode ?? 'normal'),
    target_depth: Number(data.target_depth ?? DEFAULT_OPENING_TARGET_DEPTH),
    last_imported_at: data.last_imported_at ? String(data.last_imported_at) : null,
  };
}

async function saveBuildState(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
  timeClass: string,
  patch: {
    build_mode: OpeningBuildMode;
    target_depth: number;
    processed_game_ids: string[];
    last_imported_at: string;
  },
) {
  const { error } = await supabase.from('opening_build_state').upsert(
    {
      profile_id: profileId,
      time_class: timeClass,
      build_mode: patch.build_mode,
      target_depth: patch.target_depth,
      processed_game_ids: patch.processed_game_ids,
      last_imported_at: patch.last_imported_at,
      updated_at: patch.last_imported_at,
    },
    { onConflict: 'profile_id,time_class' },
  );

  if (error) {
    throw new Error(error.message);
  }
}

async function loadDeltaInputs(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
  processedGameIds: string[],
  options: { maxGames: number | null },
) {
  const { data: decks, error: deckError } = await supabase
    .from('decks')
    .select('id')
    .eq('is_active', true)
    .eq('owner_profile_id', profileId);

  if (deckError) {
    throw new Error(deckError.message);
  }

  const deckIds = (decks ?? []).map((deck) => String(deck.id));

  if (deckIds.length === 0) {
    return { inputs: [] as OpeningTreeBuildInput[], processedIds: [] as string[], skippedGames: 0 };
  }

  const [{ data: lines, error: linesError }, { data: cards, error: cardsError }] = await Promise.all([
    supabase.from('opening_lines').select('id,name,side,moves').in('deck_id', deckIds),
    supabase
      .from('deck_cards')
      .select('id,line_name,eco,side,answer_san,context,setup_moves,source_type,score_swing_cp')
      .in('deck_id', deckIds),
  ]);

  if (linesError) {
    throw new Error(linesError.message);
  }

  if (cardsError) {
    throw new Error(cardsError.message);
  }

  const processedSet = new Set(processedGameIds);
  const freshLines = (lines ?? []).filter((line) => !processedSet.has(String(line.id)));
  const freshCards = (cards ?? []).filter((card) => !processedSet.has(String(card.id)));
  const boundedLines = options.maxGames == null ? freshLines : freshLines.slice(0, Math.max(0, options.maxGames));
  const inputs = buildInputsFromRows(boundedLines, freshCards);
  const processedIds = [...boundedLines.map((line) => String(line.id)), ...freshCards.map((card) => String(card.id))];

  return {
    inputs,
    processedIds,
    skippedGames: (lines?.length ?? 0) - freshLines.length,
  };
}

async function loadExistingGraphBundles(supabase: ReturnType<typeof createAdminClient>, profileId: string) {
  const { data: graphs, error } = await supabase
    .from('opening_graphs')
    .select('id,library,train_side,root_fen_key,target_depth,node_count,edge_count')
    .eq('owner_profile_id', profileId);

  if (error) {
    throw new Error(error.message);
  }

  const bundles: Array<{
    graphRow: Record<string, unknown>;
    nodeRows: Array<Record<string, unknown>>;
    edgeRows: Array<Record<string, unknown>>;
    catalogRows: Array<Record<string, unknown>>;
  }> = [];
  const graphIds = (graphs ?? []).map((graph) => String(graph.id));

  if (graphIds.length === 0) {
    return bundles;
  }

  const [nodeRows, edgeRows, catalogRows] = await Promise.all([
    fetchNodes(supabase, graphIds),
    fetchEdges(supabase, graphIds),
    fetchCatalogs(supabase, profileId),
  ]);

  for (const graph of graphs ?? []) {
    const graphId = String(graph.id);
    bundles.push({
      graphRow: graph,
      nodeRows: nodeRows.filter((row) => String(row.graph_id) === graphId),
      edgeRows: edgeRows.filter((row) => String(row.graph_id) === graphId),
      catalogRows: catalogRows.filter((row) => String(row.graph_id) === graphId),
    });
  }

  return bundles;
}

function parseBuildMode(value: unknown): OpeningBuildMode {
  return value === 'fast' || value === 'normal' || value === 'backfill' || value === 'extend_depth' ? value : 'fast';
}

function parseTimeClasses(value: unknown) {
  if (!Array.isArray(value)) {
    return ['bullet', 'blitz'];
  }

  return value.map((item) => String(item));
}

function parseOpeningSide(value: unknown): OpeningSide | null {
  return value === 'white' || value === 'black' ? value : null;
}

function parseRootUciParam(value: string | null): string[] | null {
  if (!value?.trim()) {
    return null;
  }

  const ucis = value
    .split(',')
    .map((uci) => uci.trim())
    .filter(Boolean);

  return ucis.length > 0 ? ucis : null;
}

async function recordAttempt(profile: TrainingProfileCookie, body: Record<string, unknown>) {
  const nodeId = String(body.nodeId ?? '');
  const correct = Boolean(body.correct);
  const attemptId = String(body.attemptId ?? crypto.randomUUID());

  if (!nodeId) {
    return NextResponse.json({ error: 'Node is required.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('record_opening_drill_attempt_atomic', {
    p_attempt_id: attemptId,
    p_correct: correct,
    p_node_id: nodeId,
    p_profile_id: profile.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  const masteryScore = Number(result?.mastery_score ?? 0);
  openingProgressCache.invalidate(profile.id);
  return NextResponse.json({ nodeId, masteryScore, applied: Boolean(result?.applied) });
}

async function chooseNextStep(profile: TrainingProfileCookie, body: Record<string, unknown>) {
  const treeId = String(body.treeId ?? '');
  const nodeId = String(body.nodeId ?? '');

  if (!treeId || !nodeId) {
    return NextResponse.json({ error: 'Tree and node are required.' }, { status: 400 });
  }

  const detail = await fetchTreeDetail(createAdminClient(), profile, treeId);

  if (!detail) {
    return NextResponse.json({ error: 'Opening tree not found.' }, { status: 404 });
  }

  const outgoing = detail.edges.filter((edge) => edge.fromNodeId === nodeId);
  const selected = chooseWeightedOpponentEdge(outgoing, Date.now());

  return NextResponse.json({ edge: selected });
}

async function upsertForestDraft(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
  forest: ReturnType<typeof buildFreshOpeningForest>,
) {
  const now = new Date().toISOString();
  const rows = forestToUpsertRows(forest, now);
  const graphIds = rows.graphs.map((graph) => graph.id);

  if (rows.graphs.length > 0) {
    const { error: graphError } = await supabase.from('opening_graphs').upsert(
      rows.graphs.map((graph) => ({
        ...graph,
        owner_profile_id: profileId,
      })),
      { onConflict: 'owner_profile_id,library,train_side' },
    );

    if (graphError) {
      throw new Error(graphError.message);
    }
  }

  if (rows.nodes.length > 0) {
    const { error } = await supabase.from('opening_nodes').upsert(rows.nodes, { onConflict: 'graph_id,fen_key' });

    if (error) {
      throw new Error(error.message);
    }
  }

  if (rows.edges.length > 0) {
    const { error } = await supabase.from('opening_edges').upsert(rows.edges, {
      onConflict: 'graph_id,from_node_id,uci',
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  if (graphIds.length > 0) {
    const { error: deleteError } = await supabase.from('opening_catalog').delete().in('graph_id', graphIds);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  if (rows.catalogs.length > 0) {
    const { error } = await supabase.from('opening_catalog').upsert(
      rows.catalogs.map((catalog) => ({
        ...catalog,
        owner_profile_id: profileId,
      })),
      { onConflict: 'graph_id,fen_key,catalog_ply' },
    );

    if (error) {
      throw new Error(error.message);
    }
  }

  openingGraphCache.invalidate(profileId);
}

function asTreeDraft(graph: OpeningGraphDraft): OpeningTreeDraft {
  return {
    id: graph.id,
    name: graph.library,
    library: graph.library,
    rootFenKey: graph.graphRootFenKey,
    rootPly: 0,
    rootSan: [],
    rootUci: [],
    sourceCount: 0,
    targetDepth: graph.targetDepth,
    trainSide: graph.trainSide,
    nodes: graph.nodes,
    edges: graph.edges,
  };
}

function pruneOpeningGraphDraft(graph: OpeningGraphDraft) {
  pruneOpeningTreeDraft(asTreeDraft(graph));
}

async function enrichOpeningGraphDraft(
  graph: OpeningGraphDraft,
  mode: OpeningBuildMode,
  nodesToAnalyze?: OpeningTreeDraft['nodes'],
) {
  const draft = asTreeDraft(graph);
  const candidates = nodesToAnalyze ?? listNodesNeedingEnrichment(graph, mode);
  const nodesToEnrich = candidates.filter((node) => graph.nodes.some((candidate) => candidate.id === node.id));
  await enrichEngineBestMoves(draft, nodesToEnrich, MAX_ENGINE_IMPORT_NODES);

  for (const node of nodesToEnrich) {
    const updated = draft.nodes.find((candidate) => candidate.id === node.id);

    if (updated) {
      node.bestUci = updated.bestUci ?? null;
      node.bestSan = updated.bestSan ?? null;
      node.evalCp = updated.evalCp ?? null;
    }
  }

  await enrichLichessBookMoves(asTreeDraft(graph));
}

async function enrichEngineBestMoves(
  draft: OpeningTreeDraft,
  nodesToAnalyze: OpeningTreeDraft['nodes'] = draft.nodes,
  maxNodes: number = MAX_ENGINE_IMPORT_NODES,
) {
  const nodesToEnrich = [...nodesToAnalyze]
    .sort((left, right) => left.ply - right.ply || left.id.localeCompare(right.id))
    .slice(0, maxNodes);
  const session = nodesToEnrich.length > 0 ? await getStockfishSession() : null;

  if (!session) {
    return;
  }

  for (const node of nodesToEnrich) {
    try {
      const analysis = await session.analyze(buildReviewAnalyzeRequest({ fen: node.fen, multipv: 1 }));

      if (!analysis.bestMove) {
        continue;
      }

      node.bestUci = analysis.bestMove;
      node.bestSan = moveSanFromFen(node.fen, analysis.bestMove) ?? analysis.bestMove;
      node.evalCp = analysis.whitePerspective?.type === 'cp' ? analysis.whitePerspective.value : null;
      ensureDraftEdge(draft, node, analysis.bestMove, 'engine_best', {
        isEngineBest: true,
        priority: 40,
      });

      const targetNode = draft.nodes.find((candidate) => {
        const chess = new Chess(node.fen);

        try {
          chess.move({
            from: analysis.bestMove!.slice(0, 2),
            to: analysis.bestMove!.slice(2, 4),
            ...(analysis.bestMove![4] ? { promotion: analysis.bestMove![4] } : {}),
          });
        } catch {
          return false;
        }

        return candidate.fenKey === normalizeOpeningFen(chess.fen());
      });

      if (targetNode && targetNode.evalCp == null && analysis.lines?.[0]?.whitePerspective?.type === 'cp') {
        targetNode.evalCp = analysis.lines[0].whitePerspective.value;
      }
    } catch {
      // Keep import usable even when a single Stockfish position times out.
    }
  }
}

async function enrichLichessBookMoves(draft: OpeningTreeDraft) {
  const opponentNodes = listOpponentNodesForLichessEnrichment(draft)
    .sort((left, right) => left.ply - right.ply)
    .slice(0, MAX_LICHESS_IMPORT_NODES);

  await enrichLichessBookMovesForNodes(draft, opponentNodes);
}

async function enrichLichessBookMovesForNodes(
  draft: OpeningTreeDraft,
  opponentNodes: OpeningTreeDraft['nodes'],
  maxMoves: number = 4,
) {
  for (const node of opponentNodes) {
    try {
      const explorer = await fetchLichessOpeningExplorer(node.fen);
      const moves = (explorer.moves ?? [])
        .map((move) => ({
          uci: move.uci,
          games: Number(move.white ?? 0) + Number(move.draws ?? 0) + Number(move.black ?? 0),
        }))
        .filter((move) => move.games > 0)
        .sort((left, right) => right.games - left.games)
        .slice(0, maxMoves);

      for (const move of moves) {
        ensureDraftEdge(draft, node, move.uci, 'lichess_masters', {
          mastersGames: move.games,
          priority: Math.log10(move.games + 1) * 4,
        });
      }
    } catch {
      // External explorer is opportunistic; recent games/cards remain the base tree.
    }
  }
}

async function enrichOpponentBookMoves(profile: TrainingProfileCookie) {
  const supabase = createAdminClient();
  const bundles = await loadExistingGraphBundles(supabase, profile.id);

  if (bundles.length === 0) {
    return NextResponse.json({ enrichedNodes: 0, newEdges: 0 });
  }

  const graphs: OpeningGraphDraft[] = [];
  const catalogs = [];
  let enrichedNodes = 0;
  let newEdges = 0;

  for (const bundle of bundles) {
    const graph = graphDraftFromRows(bundle.graphRow, bundle.nodeRows, bundle.edgeRows);
    const draft = asTreeDraft(graph);
    const beforeEdgeCount = draft.edges.length;
    const opponentNodes = listOpponentNodesNeedingBookEnrichment(draft)
      .sort((left, right) => left.ply - right.ply)
      .slice(0, MAX_LICHESS_IMPORT_NODES);

    if (opponentNodes.length > 0) {
      await enrichLichessBookMovesForNodes(draft, opponentNodes);
      enrichedNodes += opponentNodes.length;
    }

    newEdges += draft.edges.length - beforeEdgeCount;
    graphs.push(graph);
    catalogs.push(...bundle.catalogRows.map((row) => catalogDraftFromRow(row)));
  }

  if (newEdges > 0) {
    await upsertForestDraft(supabase, profile.id, { graphs, catalogs });
  }

  return NextResponse.json({ enrichedNodes, newEdges });
}

async function loadOwnerGraphForest(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
): Promise<{ graphs: OpeningGraphDraft[]; progress: Map<string, ProgressEntry> }> {
  const [graphsResult, progressResult] = await Promise.all([
    openingGraphCache.get(profileId, async () => {
      const { data: graphRows, error: graphError } = await supabase
        .from('opening_graphs')
        .select('id,library,train_side,root_fen_key,target_depth')
        .eq('owner_profile_id', profileId);

      if (graphError) {
        throw new Error(graphError.message);
      }

      const graphIds = (graphRows ?? []).map((graph) => String(graph.id));

      if (graphIds.length === 0) {
        return [];
      }

      const [nodeRows, edgeRows] = await Promise.all([fetchNodes(supabase, graphIds), fetchEdges(supabase, graphIds)]);

      return (graphRows ?? []).map((row) =>
        graphDraftFromRows(
          row,
          nodeRows.filter((node) => String(node.graph_id) === String(row.id)),
          edgeRows.filter((edge) => String(edge.graph_id) === String(row.id)),
        ),
      );
    }),
    fetchProgressCached(supabase, profileId),
  ]);

  return { graphs: graphsResult.value, progress: progressResult };
}

type RecentOpeningForest = {
  graphs: OpeningGraphDraft[];
  totalGames: number;
};

async function loadRecentOpeningForest(
  profile: TrainingProfileCookie,
  chesscomUsername: string,
): Promise<RecentOpeningForest> {
  const username = chesscomUsername.trim().toLowerCase() || profile.username.toLowerCase();
  const cacheKey = `${profile.id}:${username}:bullet-blitz-50`;
  const cached = await recentOpeningGraphCache.get(cacheKey, async () => {
    const archives = await fetchArchives(username);
    const pages = await Promise.all(
      (['bullet', 'blitz'] as const).map(async (timeClass) => {
        const page = await fetchRecentGames({
          username,
          archives,
          count: 50,
          timeClass,
        });

        return page.games.map((game) => ({ game, timeClass }));
      }),
    );
    const inputs = buildRecentGameOpeningInputs(username, pages.flat());
    const forest = buildFreshOpeningForest(inputs, {
      ownerProfileId: profile.id,
      targetDepth: DEFAULT_OPENING_TARGET_DEPTH,
      catalogPly: Math.max(1, OPENING_BUILD_ROOT_PLY),
    });

    return {
      graphs: forest.graphs,
      totalGames: inputs.length,
    };
  });

  return cached.value;
}

function buildRecentGameOpeningInputs(
  username: string,
  games: Array<{ game: RawChessComGame; timeClass: 'bullet' | 'blitz' }>,
): OpeningTreeBuildInput[] {
  return games.flatMap(({ game, timeClass }, index) => {
    const moves = parsePgnSanMoves(game.pgn);
    const trainSide = resolveRecentGameTrainSide(game, username);

    if (moves.length === 0 || !trainSide) {
      return [];
    }

    const player = trainSide === 'white' ? game.white : game.black;

    return [
      {
        id: `recent-lines-${timeClass}-${shortHash(`${game.url ?? ''}:${game.end_time ?? ''}:${index}`)}`,
        name: moves.slice(0, 8).join(' ') || 'Opening',
        trainSide,
        moves,
        source: 'recent_game' as const,
        count: 1,
        outcome: inferOutcome(player?.result ?? null, extractTag(game.pgn, 'Result')),
      },
    ];
  });
}

function parsePgnSanMoves(pgn: string | undefined): string[] {
  if (!pgn?.trim()) {
    return [];
  }

  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    return chess.history();
  } catch {
    return [];
  }
}

function resolveRecentGameTrainSide(game: RawChessComGame, username: string): OpeningSide | null {
  const normalized = username.toLowerCase();

  if (game.white?.username?.toLowerCase() === normalized) {
    return 'white';
  }

  if (game.black?.username?.toLowerCase() === normalized) {
    return 'black';
  }

  return null;
}

async function fetchRecentDynamicTreeSummaries(
  supabase: ReturnType<typeof createAdminClient>,
  profile: TrainingProfileCookie,
  browsePly: number,
  chesscomUsername: string,
): Promise<OpeningTreeSummary[]> {
  const persisted = await loadOwnerGraphForest(supabase, profile.id);

  if (persisted.graphs.length > 0) {
    const progressMap = new Map(
      [...persisted.progress.entries()].map(([nodeId, entry]) => [
        nodeId,
        {
          seenCount: entry.seenCount,
          correctCount: entry.correctCount,
          missCount: entry.missCount,
          masteryScore: entry.masteryScore,
        },
      ]),
    );
    const totalGames = persisted.graphs.reduce((total, graph) => {
      const rootNode = graph.nodes.find((node) => node.ply === 0);
      return total + (rootNode?.recentGames ?? 0) + (rootNode?.cardCount ?? 0);
    }, 0);

    return attachRecentLineEvals(
      buildRecentDynamicBrowseSummaries(persisted.graphs, browsePly, progressMap, totalGames),
    );
  }

  const [{ graphs, totalGames }, progress] = await Promise.all([
    loadRecentOpeningForest(profile, chesscomUsername),
    fetchProgressCached(supabase, profile.id),
  ]);
  const progressMap = new Map(
    [...progress.entries()].map(([nodeId, entry]) => [
      nodeId,
      {
        seenCount: entry.seenCount,
        correctCount: entry.correctCount,
        missCount: entry.missCount,
        masteryScore: entry.masteryScore,
      },
    ]),
  );

  return attachRecentLineEvals(buildRecentDynamicBrowseSummaries(graphs, browsePly, progressMap, totalGames));
}

async function attachRecentLineEvals(summaries: OpeningTreeSummary[]): Promise<OpeningTreeSummary[]> {
  const candidates = summaries
    .filter((summary) => summary.rootUci.length > 0)
    .filter((summary) => summary.rootUci.length <= LINES_EARLY_OPENING_MAX_PLY)
    .slice(0, MAX_RECENT_LINE_EVALS);

  if (candidates.length === 0) {
    return summaries;
  }

  let sessions: Awaited<ReturnType<typeof getStockfishSessionPool>>;

  try {
    sessions = await getStockfishSessionPool();
  } catch {
    return summaries;
  }

  const evalById = new Map<string, number>();

  await Promise.all(
    candidates.map(async (summary, index) => {
      const fen = fenAfterUciMoves(summary.rootUci);

      if (!fen) {
        return;
      }

      const session = sessions[index % sessions.length];

      try {
        const analysis = await session.analyze({
          fen,
          depth: RECENT_LINE_EVAL_DEPTH,
          multipv: 1,
        });
        const score = analysis.whitePerspective;

        if (score?.type === 'cp') {
          evalById.set(summary.id, score.value);
        } else if (score?.type === 'mate') {
          evalById.set(summary.id, score.value > 0 ? 100_000 : -100_000);
        }
      } catch {
        // Missing eval should not block the list.
      }
    }),
  );

  return summaries.map((summary) => ({
    ...summary,
    openingEvalCp: evalById.get(summary.id) ?? summary.openingEvalCp ?? null,
  }));
}

function fenAfterUciMoves(ucis: string[]) {
  const chess = new Chess();

  for (const uci of ucis) {
    try {
      chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        ...(uci[4] ? { promotion: uci[4] } : {}),
      });
    } catch {
      return null;
    }
  }

  return chess.fen();
}

async function fetchProjectedTreeAtFenKey(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
  fenKey: string,
): Promise<OpeningTreeDetail | null> {
  const { graphs, progress } = await loadOwnerGraphForest(supabase, profileId);
  const progressMap = new Map(
    [...progress.entries()].map(([nodeId, entry]) => [
      nodeId,
      {
        seenCount: entry.seenCount,
        correctCount: entry.correctCount,
        missCount: entry.missCount,
        masteryScore: entry.masteryScore,
      },
    ]),
  );

  return projectTreeFromFenKey(graphs, fenKey, progressMap);
}

async function fetchTreeSummaries(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
): Promise<OpeningTreeSummary[]> {
  const { data: catalogs, error } = await supabase
    .from('opening_catalog')
    .select(CATALOG_SELECT)
    .eq('owner_profile_id', profileId)
    .order('source_count', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (catalogs ?? []).map((row) => summarizeCatalog(row));
}

async function fetchTreeDetail(
  supabase: ReturnType<typeof createAdminClient>,
  profile: TrainingProfileCookie,
  treeId: string,
  options: {
    browsePly?: number | null;
    chesscomUsername?: string;
    requestedTrainSide?: OpeningSide | null;
    requestedRootUci?: string[] | null;
  } = {},
): Promise<OpeningTreeDetail | null> {
  const browsePly = options.browsePly ?? null;
  const chesscomUsername = options.chesscomUsername ?? profile.username;
  const requestedTrainSide = options.requestedTrainSide ?? null;
  const requestedRootUci = options.requestedRootUci ?? null;

  if (browsePly != null && requestedTrainSide && requestedRootUci) {
    const persistedByRoot = await fetchPersistedTreeDetailByRoot(
      supabase,
      profile,
      browsePly,
      requestedTrainSide,
      requestedRootUci,
    );

    if (persistedByRoot) {
      return persistedByRoot;
    }
  }

  const persistedTree = await fetchPersistedTreeDetail(supabase, profile, treeId);

  if (persistedTree) {
    return persistedTree;
  }

  if (browsePly != null) {
    try {
      const [{ graphs: recentGraphs }, progress] = await Promise.all([
        loadRecentOpeningForest(profile, chesscomUsername),
        fetchProgressCached(supabase, profile.id),
      ]);
      const progressMap = new Map(
        [...progress.entries()].map(([nodeId, entry]) => [
          nodeId,
          {
            seenCount: entry.seenCount,
            correctCount: entry.correctCount,
            missCount: entry.missCount,
            masteryScore: entry.masteryScore,
          },
        ]),
      );
      const dynamicMatch =
        findDynamicCatalogEntry(recentGraphs, treeId, browsePly) ?? findDynamicCatalogEntryById(recentGraphs, treeId);

      if (dynamicMatch) {
        return projectCatalogSubgraph(
          dynamicMatch.graph,
          dynamicMatch.graph.nodes,
          dynamicMatch.graph.edges,
          dynamicMatch.catalog,
          progressMap,
        );
      }
    } catch (error) {
      console.warn('[opening-trees] recent dynamic detail failed; falling back to persisted tree', {
        treeId,
        browsePly,
        error: error instanceof Error ? error.message : error,
      });
      // Persisted trees below remain usable when Chess.com is temporarily unavailable.
    }
  }

  return null;
}

async function fetchPersistedTreeDetailByRoot(
  supabase: ReturnType<typeof createAdminClient>,
  profile: TrainingProfileCookie,
  browsePly: number,
  trainSide: OpeningSide,
  rootUci: string[],
): Promise<OpeningTreeDetail | null> {
  const { graphs, progress } = await loadOwnerGraphForest(supabase, profile.id);
  const graphBrowsePly = trainSide === 'black' ? Math.max(0, browsePly - 1) : browsePly;
  const progressMap = new Map(
    [...progress.entries()].map(([nodeId, entry]) => [
      nodeId,
      {
        seenCount: entry.seenCount,
        correctCount: entry.correctCount,
        missCount: entry.missCount,
        masteryScore: entry.masteryScore,
      },
    ]),
  );

  for (const graph of graphs) {
    if (graph.trainSide !== trainSide) {
      continue;
    }

    for (const catalog of buildDynamicCatalogEntries(graph, graphBrowsePly)) {
      if (fullRootUciForCatalog(graph, catalog).join(',') !== rootUci.join(',')) {
        continue;
      }

      return projectCatalogSubgraph(graph, graph.nodes, graph.edges, catalog, progressMap);
    }
  }

  return null;
}

function fullRootUciForCatalog(
  graph: Pick<OpeningGraphDraft, 'library' | 'trainSide'>,
  catalog: { displayUci: string[] },
) {
  if (graph.trainSide === 'white') {
    return catalog.displayUci;
  }

  const firstMove = firstMoveUciForLibrary(graph.library);
  return firstMove ? [firstMove, ...catalog.displayUci] : catalog.displayUci;
}

function firstMoveUciForLibrary(library: OpeningLibrary): string | null {
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

async function fetchPersistedTreeDetail(
  supabase: ReturnType<typeof createAdminClient>,
  profile: TrainingProfileCookie,
  treeId: string,
): Promise<OpeningTreeDetail | null> {
  const { data: catalogRow, error } = await supabase
    .from('opening_catalog')
    .select(CATALOG_SELECT)
    .eq('owner_profile_id', profile.id)
    .eq('id', treeId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!catalogRow) {
    return null;
  }

  const graphId = String(catalogRow.graph_id);
  const [graphRow, nodeRows, edgeRows, progress] = await Promise.all([
    supabase
      .from('opening_graphs')
      .select('id,library,train_side,root_fen_key,target_depth')
      .eq('id', graphId)
      .maybeSingle(),
    fetchNodes(supabase, [graphId]),
    fetchEdges(supabase, [graphId]),
    fetchProgressCached(supabase, profile.id),
  ]);

  if (graphRow.error) {
    throw new Error(graphRow.error.message);
  }

  if (!graphRow.data) {
    return null;
  }

  const graph = graphDraftFromRows(graphRow.data, nodeRows, edgeRows);
  const catalog = catalogDraftFromRow(catalogRow);
  const progressMap = new Map(
    [...progress.entries()].map(([nodeId, entry]) => [
      nodeId,
      {
        seenCount: entry.seenCount,
        correctCount: entry.correctCount,
        missCount: entry.missCount,
        masteryScore: entry.masteryScore,
      },
    ]),
  );

  return projectCatalogSubgraph(graph, graph.nodes, graph.edges, catalog, progressMap);
}

async function fetchFullTrees(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
): Promise<OpeningTreeDetail[]> {
  const { data: catalogs, error } = await supabase
    .from('opening_catalog')
    .select(CATALOG_SELECT)
    .eq('owner_profile_id', profileId)
    .order('source_count', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  if (!catalogs || catalogs.length === 0) {
    return [];
  }

  const graphIds = [...new Set(catalogs.map((row) => String(row.graph_id)))];
  const [graphRows, nodeRows, edgeRows, progress] = await Promise.all([
    supabase.from('opening_graphs').select('id,library,train_side,root_fen_key,target_depth').in('id', graphIds),
    fetchNodes(supabase, graphIds),
    fetchEdges(supabase, graphIds),
    fetchProgressCached(supabase, profileId),
  ]);

  if (graphRows.error) {
    throw new Error(graphRows.error.message);
  }

  const graphById = new Map(
    (graphRows.data ?? []).map((row) => [
      String(row.id),
      graphDraftFromRows(
        row,
        nodeRows.filter((node) => String(node.graph_id) === String(row.id)),
        edgeRows.filter((edge) => String(edge.graph_id) === String(row.id)),
      ),
    ]),
  );
  const progressMap = new Map(
    [...progress.entries()].map(([nodeId, entry]) => [
      nodeId,
      {
        seenCount: entry.seenCount,
        correctCount: entry.correctCount,
        missCount: entry.missCount,
        masteryScore: entry.masteryScore,
      },
    ]),
  );

  return catalogs.map((row) => {
    const graph = graphById.get(String(row.graph_id));

    if (!graph) {
      throw new Error(`Missing graph ${String(row.graph_id)} for catalog ${String(row.id)}`);
    }

    return projectCatalogSubgraph(graph, graph.nodes, graph.edges, catalogDraftFromRow(row), progressMap);
  });
}

function summarizeCatalog(catalog: Record<string, unknown>): OpeningTreeSummary {
  return {
    id: String(catalog.id),
    name: String(catalog.name ?? 'Opening'),
    library: normalizeLibrary(catalog.library),
    rootFenKey: String(catalog.fen_key ?? ''),
    rootPly: Number(catalog.catalog_ply ?? OPENING_BUILD_ROOT_PLY),
    rootSan: toStringArray(catalog.display_san),
    rootUci: toStringArray(catalog.display_uci),
    sourceCount: Number(catalog.source_count ?? 0),
    targetDepth: Number(catalog.target_depth ?? DEFAULT_OPENING_TARGET_DEPTH),
    nodeCount: Number(catalog.subgraph_node_count ?? 0),
    dueCount: 0,
    masteryScore: 0,
    updatedAt: catalog.updated_at ? String(catalog.updated_at) : null,
  };
}

function _buildInputsFromRows(
  lines: Record<string, unknown>[],
  cards: Record<string, unknown>[],
): OpeningTreeBuildInput[] {
  const lineInputs = lines.flatMap((line) => {
    const moves = toStringArray(line.moves);

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
    const setupMoves = toStringArray(card.setup_moves);
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

type OpeningTablePagedQuery = ReturnType<
  ReturnType<ReturnType<ReturnType<typeof createAdminClient>['from']>['select']>['range']
>;

async function fetchAllRows<T extends Record<string, unknown>>(
  supabase: ReturnType<typeof createAdminClient>,
  table: 'opening_nodes' | 'opening_edges',
  select: string,
  applyFilter: (query: OpeningTablePagedQuery) => OpeningTablePagedQuery,
) {
  const pageSize = 1000;
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const baseQuery = supabase
      .from(table)
      .select(select)
      .order('id')
      .range(offset, offset + pageSize - 1);
    const filteredQuery = applyFilter(baseQuery as OpeningTablePagedQuery);
    const { data, error } = await filteredQuery;

    if (error) {
      throw new Error(error.message);
    }

    const page = (data ?? []) as T[];

    if (page.length === 0) {
      break;
    }

    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return rows;
}

async function fetchNodes(supabase: ReturnType<typeof createAdminClient>, graphIds: string[]) {
  if (graphIds.length === 0) {
    return [];
  }

  return fetchAllRows(supabase, 'opening_nodes', NODE_SELECT, (query) => query.in('graph_id', graphIds));
}

async function fetchEdges(supabase: ReturnType<typeof createAdminClient>, graphIds: string[]) {
  if (graphIds.length === 0) {
    return [];
  }

  return fetchAllRows(supabase, 'opening_edges', EDGE_SELECT, (query) => query.in('graph_id', graphIds));
}

async function fetchCatalogs(supabase: ReturnType<typeof createAdminClient>, profileId: string) {
  const { data, error } = await supabase
    .from('opening_catalog')
    .select(CATALOG_SELECT)
    .eq('owner_profile_id', profileId);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function fetchProgress(supabase: ReturnType<typeof createAdminClient>, profileId: string) {
  const { data, error } = await supabase
    .from('opening_drill_progress')
    .select('node_id,seen_count,correct_count,miss_count,mastery_score')
    .eq('profile_id', profileId);

  if (error) {
    throw new Error(error.message);
  }

  return new Map(
    (data ?? []).map((row) => [
      String(row.node_id),
      {
        seenCount: Number(row.seen_count ?? 0),
        correctCount: Number(row.correct_count ?? 0),
        missCount: Number(row.miss_count ?? 0),
        masteryScore: Number(row.mastery_score ?? 0),
      },
    ]),
  );
}

async function fetchProgressCached(supabase: ReturnType<typeof createAdminClient>, profileId: string) {
  const result = await openingProgressCache.get(profileId, () => fetchProgress(supabase, profileId));
  return result.value;
}

async function getTrainingProfileFromCookie(): Promise<TrainingProfileCookie | null> {
  const cookieStore = await cookies();
  const parsed = parseTrainingSessionCookie(cookieStore.get(TRAINING_SESSION_COOKIE)?.value);

  if (!parsed) {
    return null;
  }

  const tokenHash = hashTrainingSessionToken(parsed.token);
  const cacheKey = `${parsed.profileId}:${tokenHash}`;
  const result = await openingProfileCache.get(cacheKey, async () => {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('training_profiles')
      .select('id,username,session_token_hash')
      .eq('id', parsed.profileId)
      .maybeSingle();

    if (error || !data?.session_token_hash || tokenHash !== data.session_token_hash) {
      return null;
    }

    return {
      id: String(data.id),
      username: String(data.username),
      session_token_hash: String(data.session_token_hash),
    };
  });

  return result.value;
}

function normalizeLibrary(value: unknown): OpeningLibrary {
  return mapOpeningLibraryFromDb(value);
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function moveSanFromFen(fen: string, uci: string) {
  const chess = new Chess(fen);

  try {
    return (
      chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        ...(uci[4] ? { promotion: uci[4] } : {}),
      })?.san ?? null
    );
  } catch {
    return null;
  }
}

function _shortHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash).toString(16).padStart(8, '0');
}

type ProgressEntry = {
  seenCount: number;
  correctCount: number;
  missCount: number;
  masteryScore: number;
};

type TrainingProfileCookie = {
  id: string;
  username: string;
  session_token_hash: string;
};
