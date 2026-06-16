import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { Chess } from 'chess.js';

import { buildReviewAnalyzeRequest } from '@/lib/analysis-profile';
import { fetchLichessOpeningExplorer } from '@/lib/opening-book';
import {
  DEFAULT_OPENING_TARGET_DEPTH,
  applyOpeningAttemptScore,
  buildOpeningTrees,
  chooseWeightedOpponentEdge,
  normalizeOpeningFen,
  type OpeningLibrary,
  type OpeningSide,
  type OpeningTreeBuildInput,
  type OpeningTreeDetail,
  type OpeningTreeDraft,
  type OpeningTreeEdge,
  type OpeningTreeNode,
  type OpeningTreeSummary,
  ensureDraftEdge,
} from '@/lib/opening-tree';
import { getStockfishSession } from '@/lib/stockfish-session';
import { TRAINING_SESSION_COOKIE, hashTrainingSessionToken, parseTrainingSessionCookie } from '@/lib/training-profile';
import { createAdminClient } from '@/utils/supabase/admin';

const TREE_SELECT = 'id,library,name,root_san,root_uci,source_count,target_depth,updated_at';
const NODE_SELECT = 'id,tree_id,fen,fen_key,ply,side_to_move,best_uci,best_san,eval_cp,recent_games,card_count';
const EDGE_SELECT = 'id,tree_id,from_node_id,to_node_id,uci,san,move_by,source,recent_count,card_count,masters_games,priority,is_engine_best';
const CARD_SELECT = 'id,line_name,eco,side,answer_san,context,setup_moves,source_type,score_swing_cp';
const MAX_ENGINE_IMPORT_NODES = 60;
const MAX_LICHESS_IMPORT_NODES = 120;

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
      return detail ? NextResponse.json({ tree: detail }) : NextResponse.json({ error: 'Opening tree not found.' }, { status: 404 });
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
      return importRecentOpeningTrees(profile);
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

async function importRecentOpeningTrees(profile: TrainingProfileCookie) {
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from('opening_trees')
    .select('id', { count: 'exact', head: true })
    .eq('owner_profile_id', profile.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ imported: count ?? 0, nodes: 0, edges: 0 });
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

  const outgoing = detail.edges.filter(edge => edge.fromNodeId === nodeId);
  const selected = chooseWeightedOpponentEdge(outgoing, Date.now());

  return NextResponse.json({ edge: selected });
}

async function upsertTreeDraft(supabase: ReturnType<typeof createAdminClient>, profileId: string, draft: ReturnType<typeof buildOpeningTrees>[number]) {
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
      draft.nodes.map(node => ({
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
      draft.edges.map(edge => ({
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

async function enrichOpeningTreeDraft(draft: OpeningTreeDraft) {
  await enrichEngineBestMoves(draft);
  await enrichLichessOpponentMoves(draft);
}

async function enrichEngineBestMoves(draft: OpeningTreeDraft) {
  const trainNodes = draft.nodes
    .sort((left, right) => left.ply - right.ply)
    .slice(0, MAX_ENGINE_IMPORT_NODES);
  const session = trainNodes.length > 0 ? await getStockfishSession() : null;

  if (!session) {
    return;
  }

  for (const node of trainNodes) {
    try {
      const analysis = await session.analyze(buildReviewAnalyzeRequest({ fen: node.fen, multipv: 1 }));

      if (!analysis.bestMove) {
        continue;
      }

      node.bestUci = analysis.bestMove;
      node.bestSan = moveSanFromFen(node.fen, analysis.bestMove) ?? analysis.bestMove;
      node.evalCp = analysis.whitePerspective?.type === 'cp'
        ? analysis.whitePerspective.value
        : null;
      ensureDraftEdge(draft, node, analysis.bestMove, 'engine_best', {
        isEngineBest: true,
        priority: 40,
      });
    } catch {
      // Keep import usable even when a single Stockfish position times out.
    }
  }
}

async function enrichLichessOpponentMoves(draft: OpeningTreeDraft) {
  const opponentNodes = draft.nodes
    .sort((left, right) => left.ply - right.ply)
    .slice(0, MAX_LICHESS_IMPORT_NODES);

  for (const node of opponentNodes) {
    try {
      const explorer = await fetchLichessOpeningExplorer(node.fen);
      const moves = (explorer.moves ?? [])
        .map(move => ({
          uci: move.uci,
          games: Number(move.white ?? 0) + Number(move.draws ?? 0) + Number(move.black ?? 0),
        }))
        .filter(move => move.games > 0)
        .sort((left, right) => right.games - left.games)
        .slice(0, 6);

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


async function fetchTreeSummaries(supabase: ReturnType<typeof createAdminClient>, profileId: string): Promise<OpeningTreeSummary[]> {
  const { data: trees, error } = await supabase
    .from('opening_trees')
    .select(TREE_SELECT)
    .eq('owner_profile_id', profileId)
    .order('library')
    .order('source_count', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const treeIds = (trees ?? []).map(tree => String(tree.id));
  const [nodes, progress] = await Promise.all([
    fetchNodes(supabase, treeIds),
    fetchProgress(supabase, profileId),
  ]);

  return (trees ?? []).map(tree => summarizeTree(tree, nodes.filter(node => node.tree_id === tree.id), progress));
}

async function fetchTreeDetail(supabase: ReturnType<typeof createAdminClient>, profileId: string, treeId: string): Promise<OpeningTreeDetail | null> {
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
  const summary = summarizeTree(tree, nodeRows, progress);
  const nodes: OpeningTreeNode[] = nodeRows.map(row => {
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
  const edges: OpeningTreeEdge[] = edgeRows.map(row => ({
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

async function fetchFullTrees(supabase: ReturnType<typeof createAdminClient>, profileId: string): Promise<OpeningTreeDetail[]> {
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

  const treeIds = trees.map(tree => String(tree.id));
  const [nodeRows, edgeRows, progress] = await Promise.all([
    fetchNodes(supabase, treeIds),
    fetchEdges(supabase, treeIds),
    fetchProgress(supabase, profileId),
  ]);

  return trees.map(tree => {
    const treeId = String(tree.id);
    const treeNodeRows = nodeRows.filter(row => String(row.tree_id) === treeId);
    const treeEdgeRows = edgeRows.filter(row => String(row.tree_id) === treeId);
    const summary = summarizeTree(tree, treeNodeRows, progress);

    const nodes: OpeningTreeNode[] = treeNodeRows.map(row => {
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

    const edges: OpeningTreeEdge[] = treeEdgeRows.map(row => ({
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

function summarizeTree(tree: Record<string, unknown>, nodes: Record<string, unknown>[], progress: Map<string, ProgressEntry>): OpeningTreeSummary {
  const trainNodes = nodes;
  const scores = trainNodes.map(node => progress.get(String(node.id))?.masteryScore ?? 0);
  const masteryScore = scores.length > 0 ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
  const dueCount = trainNodes.filter(node => (progress.get(String(node.id))?.masteryScore ?? 0) < 80).length;

  return {
    id: String(tree.id),
    name: String(tree.name ?? 'Opening'),
    library: normalizeLibrary(tree.library),
    rootSan: toStringArray(tree.root_san),
    rootUci: toStringArray(tree.root_uci),
    sourceCount: Number(tree.source_count ?? 0),
    targetDepth: Number(tree.target_depth ?? DEFAULT_OPENING_TARGET_DEPTH),
    nodeCount: nodes.length,
    dueCount,
    masteryScore,
    updatedAt: tree.updated_at ? String(tree.updated_at) : null,
  };
}

function buildInputsFromRows(lines: Record<string, unknown>[], cards: Record<string, unknown>[]): OpeningTreeBuildInput[] {
  const lineInputs = lines.flatMap(line => {
    const moves = toStringArray(line.moves);

    if (moves.length === 0) {
      return [];
    }

    return [{
      id: String(line.id),
      name: String(line.name ?? 'Opening'),
      trainSide: (line.side === 'black' ? 'black' : 'white') as 'white' | 'black',
      moves,
      source: 'recent_game' as const,
      count: 1,
    }];
  });
  const cardInputs = cards.flatMap(card => {
    const setupMoves = toStringArray(card.setup_moves);
    const answerSan = String(card.answer_san ?? '');
    const moves = [...setupMoves, answerSan].filter(Boolean);

    if (moves.length === 0) {
      return [];
    }

    return [{
      id: String(card.id),
      name: String(card.line_name ?? 'Opening'),
      trainSide: (card.side === 'black' ? 'black' : 'white') as 'white' | 'black',
      moves,
      source: 'card' as const,
      count: 1,
      scoreSwingCp: card.score_swing_cp == null ? null : Number(card.score_swing_cp),
    }];
  });

  return [...lineInputs, ...cardInputs];
}

async function fetchNodes(supabase: ReturnType<typeof createAdminClient>, treeIds: string[]) {
  if (treeIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase.from('opening_nodes').select(NODE_SELECT).in('tree_id', treeIds);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function fetchEdges(supabase: ReturnType<typeof createAdminClient>, treeIds: string[]) {
  if (treeIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase.from('opening_edges').select(EDGE_SELECT).in('tree_id', treeIds);

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

  return new Map((data ?? []).map(row => [String(row.node_id), {
    seenCount: Number(row.seen_count ?? 0),
    correctCount: Number(row.correct_count ?? 0),
    missCount: Number(row.miss_count ?? 0),
    masteryScore: Number(row.mastery_score ?? 0),
  }]));
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
  return value === 'e4' || value === 'd4' || value === 'c4' || value === 'nf3' || value === 'other'
    ? value
    : 'e4';
}

function normalizeEdgeSource(value: unknown) {
  return value === 'card' || value === 'lichess_masters' || value === 'engine_best' || value === 'mixed' ? value : 'recent_game';
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function moveSanFromFen(fen: string, uci: string) {
  const chess = new Chess(fen);

  try {
    return chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      ...(uci[4] ? { promotion: uci[4] } : {}),
    })?.san ?? null;
  } catch {
    return null;
  }
}

function shortHash(value: string) {
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
