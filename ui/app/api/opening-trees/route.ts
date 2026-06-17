import { Chess } from 'chess.js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { buildReviewAnalyzeRequest } from '@/lib/analysis-profile';
import { fetchLichessOpeningExplorer } from '@/lib/opening-book';
import {
  applyOpeningAttemptScore,
  chooseWeightedOpponentEdge,
  DEFAULT_OPENING_TARGET_DEPTH,
  ensureDraftEdge,
  mapOpeningLibraryFromDb,
  normalizeOpeningFen,
  type OpeningBuildMode,
  type OpeningLibrary,
  type OpeningTreeBuildInput,
  type OpeningTreeDetail,
  type OpeningTreeDraft,
  type OpeningTreeEdge,
  type OpeningTreeNode,
  type OpeningTreeSummary,
  pruneOpeningTreeDraft,
  resolveTargetDepthForBuildMode,
} from '@/lib/opening-tree';
import {
  buildFreshOpeningForest,
  buildInputsFromRows,
  draftToUpsertRows,
  listNodesNeedingEnrichment,
  mergeIncrementalOpeningForest,
  OPENING_BUILD_ROOT_PLY,
  type OpeningTreeImportResult,
} from '@/lib/opening-tree-import';
import { getStockfishSession } from '@/lib/stockfish-session';
import { hashTrainingSessionToken, parseTrainingSessionCookie, TRAINING_SESSION_COOKIE } from '@/lib/training-profile';
import { createAdminClient } from '@/utils/supabase/admin';

const TREE_SELECT = 'id,library,name,root_fen_key,root_ply,root_san,root_uci,source_count,target_depth,updated_at';
const NODE_SELECT = 'id,tree_id,fen,fen_key,ply,side_to_move,best_uci,best_san,eval_cp,recent_games,card_count';
const EDGE_SELECT =
  'id,tree_id,from_node_id,to_node_id,uci,san,move_by,source,recent_count,card_count,masters_games,priority,is_engine_best';
const _CARD_SELECT = 'id,line_name,eco,side,answer_san,context,setup_moves,source_type,score_swing_cp';
const MAX_ENGINE_IMPORT_NODES = 120;
const MAX_LICHESS_IMPORT_NODES = 80;

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const profile = await getTrainingProfileFromCookie();

  if (!profile) {
    return NextResponse.json({ error: 'No training profile.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const treeId = url.searchParams.get('treeId');
  const full = url.searchParams.get('full') === 'true';

  try {
    const supabase = createAdminClient();

    if (treeId) {
      const detail = await fetchTreeDetail(supabase, profile.id, treeId);
      return detail
        ? NextResponse.json({ tree: detail })
        : NextResponse.json({ error: 'Opening tree not found.' }, { status: 404 });
    }

    if (full) {
      const fullTrees = await fetchFullTrees(supabase, profile.id);
      return NextResponse.json({ trees: fullTrees });
    }

    const summaries = await fetchTreeSummaries(supabase, profile.id);
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
    return NextResponse.json({ imported: 0, nodes: 0, edges: 0, skippedGames } satisfies OpeningTreeImportResult);
  }

  const touchedRootKeys = new Set(
    buildFreshOpeningForest(inputs, {
      ownerProfileId: profile.id,
      targetDepth,
      rootPly: OPENING_BUILD_ROOT_PLY,
    }).map((draft) => draft.rootFenKey),
  );
  const existingBundles = await loadExistingTreeBundles(supabase, profile.id, [...touchedRootKeys]);
  const merged =
    existingBundles.length > 0
      ? mergeIncrementalOpeningForest(existingBundles, inputs, {
          ownerProfileId: profile.id,
          mode: options.mode,
          currentTargetDepth,
        })
      : {
          drafts: buildFreshOpeningForest(inputs, {
            ownerProfileId: profile.id,
            targetDepth,
            rootPly: OPENING_BUILD_ROOT_PLY,
          }),
          newNodeCount: 0,
          newEdgeCount: 0,
        };

  let nodeCount = 0;
  let edgeCount = 0;

  for (const draft of merged.drafts) {
    if (options.mode !== 'fast') {
      await enrichOpeningTreeDraftLazy(draft, options.mode);
    } else {
      await enrichLichessBookMoves(draft);
    }

    pruneOpeningTreeDraft(draft);
    await upsertTreeDraft(supabase, profile.id, draft);
    nodeCount += draft.nodes.length;
    edgeCount += draft.edges.length;
  }

  await saveBuildState(supabase, profile.id, options.timeClasses[0] ?? 'all', {
    build_mode: options.mode,
    target_depth: targetDepth,
    processed_game_ids: [...new Set([...(buildState?.processed_game_ids ?? []), ...processedIds])],
    last_imported_at: new Date().toISOString(),
  });

  return NextResponse.json({
    imported: merged.drafts.length,
    nodes: nodeCount,
    edges: edgeCount,
    skippedGames,
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

async function loadExistingTreeBundles(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
  rootFenKeys: string[],
) {
  if (rootFenKeys.length === 0) {
    return [];
  }

  const { data: trees, error } = await supabase
    .from('opening_trees')
    .select('id,library,name,root_fen_key,root_ply,root_san,root_uci,source_count,target_depth')
    .eq('owner_profile_id', profileId)
    .in('root_fen_key', rootFenKeys);

  if (error) {
    throw new Error(error.message);
  }

  const bundles = [];

  for (const tree of trees ?? []) {
    const treeId = String(tree.id);
    const [nodeRows, edgeRows] = await Promise.all([fetchNodes(supabase, [treeId]), fetchEdges(supabase, [treeId])]);
    bundles.push({ treeRow: tree, nodeRows, edgeRows });
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

async function recordAttempt(profile: TrainingProfileCookie, body: Record<string, unknown>) {
  const nodeId = String(body.nodeId ?? '');
  const correct = Boolean(body.correct);

  if (!nodeId) {
    return NextResponse.json({ error: 'Node is required.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: current } = await supabase
    .from('opening_drill_progress')
    .select('seen_count,correct_count,miss_count,mastery_score')
    .eq('profile_id', profile.id)
    .eq('node_id', nodeId)
    .maybeSingle();
  const masteryScore = applyOpeningAttemptScore(Number(current?.mastery_score ?? 0), correct);
  const { error } = await supabase.from('opening_drill_progress').upsert(
    {
      profile_id: profile.id,
      node_id: nodeId,
      seen_count: Number(current?.seen_count ?? 0) + 1,
      correct_count: Number(current?.correct_count ?? 0) + (correct ? 1 : 0),
      miss_count: Number(current?.miss_count ?? 0) + (correct ? 0 : 1),
      mastery_score: masteryScore,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id,node_id' },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ nodeId, masteryScore });
}

async function chooseNextStep(profile: TrainingProfileCookie, body: Record<string, unknown>) {
  const treeId = String(body.treeId ?? '');
  const nodeId = String(body.nodeId ?? '');

  if (!treeId || !nodeId) {
    return NextResponse.json({ error: 'Tree and node are required.' }, { status: 400 });
  }

  const detail = await fetchTreeDetail(createAdminClient(), profile.id, treeId);

  if (!detail) {
    return NextResponse.json({ error: 'Opening tree not found.' }, { status: 404 });
  }

  const outgoing = detail.edges.filter((edge) => edge.fromNodeId === nodeId);
  const selected = chooseWeightedOpponentEdge(outgoing, Date.now());

  return NextResponse.json({ edge: selected });
}

async function upsertTreeDraft(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
  draft: OpeningTreeDraft,
) {
  const now = new Date().toISOString();
  const rows = draftToUpsertRows(draft, now);
  const { error: treeError } = await supabase.from('opening_trees').upsert(
    {
      ...rows.tree,
      owner_profile_id: profileId,
    },
    { onConflict: 'owner_profile_id,library,root_fen_key' },
  );

  if (treeError) {
    throw new Error(treeError.message);
  }

  if (rows.nodes.length > 0) {
    const { error } = await supabase.from('opening_nodes').upsert(rows.nodes, { onConflict: 'tree_id,fen_key' });

    if (error) {
      throw new Error(error.message);
    }
  }

  if (rows.edges.length > 0) {
    const { error } = await supabase.from('opening_edges').upsert(rows.edges, {
      onConflict: 'tree_id,from_node_id,uci',
    });

    if (error) {
      throw new Error(error.message);
    }
  }
}

async function enrichOpeningTreeDraftLazy(draft: OpeningTreeDraft, mode: OpeningBuildMode) {
  const nodesToEnrich = listNodesNeedingEnrichment(draft, mode);
  const limitedDraft = { ...draft, nodes: nodesToEnrich };
  await enrichEngineBestMoves(limitedDraft);
  await enrichLichessBookMoves(draft);
}

async function _upsertTreeDraft(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
  draft: ReturnType<typeof buildOpeningTrees>[number],
) {
  const now = new Date().toISOString();
  const { error: treeError } = await supabase.from('opening_trees').upsert(
    {
      id: draft.id,
      owner_profile_id: profileId,
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
    { onConflict: 'owner_profile_id,library,root_fen_key' },
  );

  if (treeError) {
    throw new Error(treeError.message);
  }

  if (draft.nodes.length > 0) {
    const { error } = await supabase.from('opening_nodes').upsert(
      draft.nodes.map((node) => ({
        id: node.id,
        tree_id: draft.id,
        fen: node.fen,
        fen_key: node.fenKey,
        ply: node.ply,
        side_to_move: node.sideToMove,
        best_uci: node.bestUci ?? null,
        best_san: node.bestSan ?? null,
        eval_cp: node.evalCp ?? null,
        recent_games: node.recentGames,
        card_count: node.cardCount,
        updated_at: now,
      })),
      { onConflict: 'tree_id,fen_key' },
    );

    if (error) {
      throw new Error(error.message);
    }
  }

  if (draft.edges.length > 0) {
    const { error } = await supabase.from('opening_edges').upsert(
      draft.edges.map((edge) => ({
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
      { onConflict: 'tree_id,from_node_id,uci' },
    );

    if (error) {
      throw new Error(error.message);
    }
  }
}

async function _enrichOpeningTreeDraft(draft: OpeningTreeDraft) {
  await enrichOpeningTreeDraftLazy(draft, 'normal');
}

async function enrichEngineBestMoves(draft: OpeningTreeDraft) {
  const nodesToEnrich = [...draft.nodes].sort((left, right) => left.ply - right.ply).slice(0, MAX_ENGINE_IMPORT_NODES);
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
  const opponentNodes = draft.nodes
    .filter((node) => node.recentGames > 0)
    .sort((left, right) => left.ply - right.ply)
    .slice(0, MAX_LICHESS_IMPORT_NODES);

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
        .slice(0, 4);

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

async function fetchTreeSummaries(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
): Promise<OpeningTreeSummary[]> {
  const { data: trees, error } = await supabase
    .from('opening_trees')
    .select(TREE_SELECT)
    .eq('owner_profile_id', profileId)
    .order('library')
    .order('source_count', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const treeIds = (trees ?? []).map((tree) => String(tree.id));
  const [nodeIndexRows, progress] = await Promise.all([
    fetchAllRows<{ id: string; tree_id: string }>(supabase, 'opening_nodes', 'id,tree_id', (query) =>
      query.in('tree_id', treeIds),
    ),
    fetchProgress(supabase, profileId),
  ]);
  const nodeCountByTree = new Map<string, number>();
  const nodeIdsByTree = new Map<string, string[]>();

  for (const row of nodeIndexRows) {
    const treeId = String(row.tree_id);
    nodeCountByTree.set(treeId, (nodeCountByTree.get(treeId) ?? 0) + 1);
    const nodeIds = nodeIdsByTree.get(treeId) ?? [];
    nodeIds.push(String(row.id));
    nodeIdsByTree.set(treeId, nodeIds);
  }

  return (trees ?? []).map((tree) => {
    const treeId = String(tree.id);
    const nodeIds = nodeIdsByTree.get(treeId) ?? [];
    const nodeRows = nodeIds.map((nodeId) => ({ id: nodeId, tree_id: treeId }));

    return summarizeTree(tree, nodeRows, progress, nodeCountByTree.get(treeId) ?? 0);
  });
}

async function fetchTreeDetail(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
  treeId: string,
): Promise<OpeningTreeDetail | null> {
  const { data: tree, error } = await supabase
    .from('opening_trees')
    .select(TREE_SELECT)
    .eq('owner_profile_id', profileId)
    .eq('id', treeId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!tree) {
    return null;
  }

  const [nodeRows, edgeRows, progress] = await Promise.all([
    fetchNodes(supabase, [treeId]),
    fetchEdges(supabase, [treeId]),
    fetchProgress(supabase, profileId),
  ]);
  const summary = summarizeTree(tree, nodeRows, progress, nodeRows.length);
  const nodes: OpeningTreeNode[] = nodeRows.map((row) => {
    const entry = progress.get(String(row.id));
    return {
      id: String(row.id),
      fen: String(row.fen),
      fenKey: String(row.fen_key),
      ply: Number(row.ply ?? 0),
      sideToMove: row.side_to_move === 'black' ? 'black' : 'white',
      bestUci: row.best_uci ? String(row.best_uci) : null,
      bestSan: row.best_san ? String(row.best_san) : null,
      evalCp: row.eval_cp == null ? null : Number(row.eval_cp),
      recentGames: Number(row.recent_games ?? 0),
      cardCount: Number(row.card_count ?? 0),
      masteryScore: entry?.masteryScore ?? 0,
      seenCount: entry?.seenCount ?? 0,
      correctCount: entry?.correctCount ?? 0,
      missCount: entry?.missCount ?? 0,
    };
  });
  const edges: OpeningTreeEdge[] = edgeRows.map((row) => ({
    id: String(row.id),
    fromNodeId: String(row.from_node_id),
    toNodeId: String(row.to_node_id),
    uci: String(row.uci),
    san: String(row.san),
    moveBy: row.move_by === 'black' ? 'black' : 'white',
    source: normalizeEdgeSource(row.source),
    recentCount: Number(row.recent_count ?? 0),
    cardCount: Number(row.card_count ?? 0),
    mastersGames: Number(row.masters_games ?? 0),
    priority: Number(row.priority ?? 0),
    isEngineBest: Boolean(row.is_engine_best),
  }));

  return { ...summary, nodes, edges };
}

async function fetchFullTrees(
  supabase: ReturnType<typeof createAdminClient>,
  profileId: string,
): Promise<OpeningTreeDetail[]> {
  const { data: trees, error } = await supabase
    .from('opening_trees')
    .select(TREE_SELECT)
    .eq('owner_profile_id', profileId)
    .order('library')
    .order('source_count', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  if (!trees || trees.length === 0) {
    return [];
  }

  const treeIds = trees.map((tree) => String(tree.id));
  const [nodeRows, edgeRows, progress] = await Promise.all([
    fetchNodes(supabase, treeIds),
    fetchEdges(supabase, treeIds),
    fetchProgress(supabase, profileId),
  ]);

  return trees.map((tree) => {
    const treeId = String(tree.id);
    const treeNodeRows = nodeRows.filter((row) => String(row.tree_id) === treeId);
    const treeEdgeRows = edgeRows.filter((row) => String(row.tree_id) === treeId);
    const summary = summarizeTree(tree, treeNodeRows, progress, treeNodeRows.length);

    const nodes: OpeningTreeNode[] = treeNodeRows.map((row) => {
      const entry = progress.get(String(row.id));
      return {
        id: String(row.id),
        fen: String(row.fen),
        fenKey: String(row.fen_key),
        ply: Number(row.ply ?? 0),
        sideToMove: row.side_to_move === 'black' ? 'black' : 'white',
        bestUci: row.best_uci ? String(row.best_uci) : null,
        bestSan: row.best_san ? String(row.best_san) : null,
        evalCp: row.eval_cp == null ? null : Number(row.eval_cp),
        recentGames: Number(row.recent_games ?? 0),
        cardCount: Number(row.card_count ?? 0),
        masteryScore: entry?.masteryScore ?? 0,
        seenCount: entry?.seenCount ?? 0,
        correctCount: entry?.correctCount ?? 0,
        missCount: entry?.missCount ?? 0,
      };
    });

    const edges: OpeningTreeEdge[] = treeEdgeRows.map((row) => ({
      id: String(row.id),
      fromNodeId: String(row.from_node_id),
      toNodeId: String(row.to_node_id),
      uci: String(row.uci),
      san: String(row.san),
      moveBy: row.move_by === 'black' ? 'black' : 'white',
      source: normalizeEdgeSource(row.source),
      recentCount: Number(row.recent_count ?? 0),
      cardCount: Number(row.card_count ?? 0),
      mastersGames: Number(row.masters_games ?? 0),
      priority: Number(row.priority ?? 0),
      isEngineBest: Boolean(row.is_engine_best),
    }));

    return { ...summary, nodes, edges };
  });
}

function summarizeTree(
  tree: Record<string, unknown>,
  nodes: Array<{ id: string | number }>,
  progress: Map<string, ProgressEntry>,
  nodeCount = nodes.length,
): OpeningTreeSummary {
  const scores = nodes.map((node) => progress.get(String(node.id))?.masteryScore ?? 0);
  const masteryScore =
    scores.length > 0 ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
  const dueCount = nodes.filter((node) => (progress.get(String(node.id))?.masteryScore ?? 0) < 80).length;

  return {
    id: String(tree.id),
    name: String(tree.name ?? 'Opening'),
    library: normalizeLibrary(tree.library),
    rootFenKey: String(tree.root_fen_key ?? ''),
    rootPly: Number(tree.root_ply ?? 0),
    rootSan: toStringArray(tree.root_san),
    rootUci: toStringArray(tree.root_uci),
    sourceCount: Number(tree.source_count ?? 0),
    targetDepth: Number(tree.target_depth ?? DEFAULT_OPENING_TARGET_DEPTH),
    nodeCount,
    dueCount,
    masteryScore,
    updatedAt: tree.updated_at ? String(tree.updated_at) : null,
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

async function fetchAllRows<T extends Record<string, unknown>>(
  supabase: ReturnType<typeof createAdminClient>,
  table: 'opening_nodes' | 'opening_edges',
  select: string,
  applyFilter: (
    query: ReturnType<ReturnType<typeof createAdminClient>['from']>,
  ) => ReturnType<ReturnType<typeof createAdminClient>['from']>,
) {
  const pageSize = 1000;
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from(table)
      .select(select)
      .range(offset, offset + pageSize - 1);
    query = applyFilter(query);
    const { data, error } = await query;

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

async function fetchNodes(supabase: ReturnType<typeof createAdminClient>, treeIds: string[]) {
  if (treeIds.length === 0) {
    return [];
  }

  return fetchAllRows(supabase, 'opening_nodes', NODE_SELECT, (query) => query.in('tree_id', treeIds));
}

async function fetchEdges(supabase: ReturnType<typeof createAdminClient>, treeIds: string[]) {
  if (treeIds.length === 0) {
    return [];
  }

  return fetchAllRows(supabase, 'opening_edges', EDGE_SELECT, (query) => query.in('tree_id', treeIds));
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

async function getTrainingProfileFromCookie(): Promise<TrainingProfileCookie | null> {
  const cookieStore = await cookies();
  const parsed = parseTrainingSessionCookie(cookieStore.get(TRAINING_SESSION_COOKIE)?.value);

  if (!parsed) {
    return null;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('training_profiles')
    .select('id,username,session_token_hash')
    .eq('id', parsed.profileId)
    .maybeSingle();

  if (error || !data?.session_token_hash) {
    return null;
  }

  return hashTrainingSessionToken(parsed.token) === data.session_token_hash
    ? { id: String(data.id), username: String(data.username), session_token_hash: String(data.session_token_hash) }
    : null;
}

function normalizeLibrary(value: unknown): OpeningLibrary {
  return mapOpeningLibraryFromDb(value);
}

function normalizeEdgeSource(value: unknown) {
  return value === 'card' || value === 'lichess_masters' || value === 'engine_best' || value === 'mixed'
    ? value
    : 'recent_game';
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
