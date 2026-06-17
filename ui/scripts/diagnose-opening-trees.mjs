import { createClient } from '@supabase/supabase-js';
import {
  classifyLinesMove,
  isLegacyCatchAllOpeningTree,
  isRepertoireEdge,
  sliceOpeningForest,
} from '../lib/opening-tree.ts';
import { loadLocalEnv, requireAdminKey, requireEnv } from './supabase/env.mjs';

const env = loadLocalEnv();
const supabase = createClient(requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL'), requireAdminKey(env), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: profiles } = await supabase.from('training_profiles').select('id,username').limit(1);
const profile = profiles?.[0];

if (!profile) {
  throw new Error('No training profile');
}

function mapLibrary(value) {
  if (value === 'white') {
    return 'e4';
  }

  return value;
}

function toDetail(treeRow, nodeRows, edgeRows) {
  return {
    id: treeRow.id,
    name: treeRow.name,
    library: mapLibrary(treeRow.library),
    rootFenKey: treeRow.root_fen_key,
    rootPly: treeRow.root_ply ?? 0,
    rootSan: treeRow.root_san ?? [],
    rootUci: treeRow.root_uci ?? [],
    sourceCount: treeRow.source_count,
    targetDepth: treeRow.target_depth,
    nodeCount: nodeRows.length,
    dueCount: 0,
    masteryScore: 0,
    updatedAt: treeRow.updated_at,
    nodes: nodeRows.map((row) => ({
      id: row.id,
      fen: row.fen,
      fenKey: row.fen_key,
      ply: row.ply,
      sideToMove: row.side_to_move,
      bestUci: row.best_uci,
      bestSan: row.best_san,
      evalCp: row.eval_cp,
      recentGames: row.recent_games,
      cardCount: row.card_count,
      masteryScore: 0,
      seenCount: 0,
      correctCount: 0,
      missCount: 0,
    })),
    edges: edgeRows.map((row) => ({
      id: row.id,
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      uci: row.uci,
      san: row.san,
      moveBy: row.move_by,
      source: row.source,
      recentCount: row.recent_count,
      cardCount: row.card_count,
      mastersGames: row.masters_games,
      priority: row.priority,
      isEngineBest: row.is_engine_best,
    })),
  };
}

const { data: treeRows } = await supabase
  .from('opening_trees')
  .select('*')
  .eq('owner_profile_id', profile.id)
  .order('source_count', { ascending: false });

const treeIds = (treeRows ?? []).map((tree) => tree.id);
const [{ data: allNodes }, { data: allEdges }, { data: progress }] = await Promise.all([
  supabase.from('opening_nodes').select('*').in('tree_id', treeIds),
  supabase.from('opening_edges').select('*').in('tree_id', treeIds),
  supabase.from('opening_drill_progress').select('node_id,mastery_score').eq('profile_id', profile.id),
]);

const sampleNode = allNodes?.[0];
console.log('Profile:', profile.username);
console.log('train_side column present:', sampleNode ? 'train_side' in sampleNode : 'no nodes');
console.log('Progress rows:', progress?.length ?? 0);
console.log('Trees:', treeRows?.length ?? 0);

const legacyTrees = (treeRows ?? []).filter((treeRow) => {
  const detail = toDetail(
    treeRow,
    (allNodes ?? []).filter((node) => node.tree_id === treeRow.id),
    (allEdges ?? []).filter((edge) => edge.tree_id === treeRow.id),
  );

  return isLegacyCatchAllOpeningTree(detail);
});

console.log('Legacy catch-all trees:', legacyTrees.length);

for (const treeRow of (treeRows ?? []).slice(0, 5)) {
  const nodeRows = (allNodes ?? []).filter((node) => node.tree_id === treeRow.id);
  const edgeRows = (allEdges ?? []).filter((edge) => edge.tree_id === treeRow.id);
  const detail = toDetail(treeRow, nodeRows, edgeRows);
  const repertoireEdges = detail.edges.filter(isRepertoireEdge);
  const nodesWithEval = nodeRows.filter((node) => node.eval_cp != null);

  console.log('\n===', treeRow.name.slice(0, 48), '===');
  console.log({
    rootPly: treeRow.root_ply,
    rootSan: (treeRow.root_san ?? []).join(' ') || '(empty)',
    targetDepth: treeRow.target_depth,
    nodes: nodeRows.length,
    edges: edgeRows.length,
    repertoireEdges: repertoireEdges.length,
    nodesWithEval: nodesWithEval.length,
    legacy: isLegacyCatchAllOpeningTree(detail),
  });
}

const forest = (treeRows ?? []).map((treeRow) =>
  toDetail(
    treeRow,
    (allNodes ?? []).filter((node) => node.tree_id === treeRow.id),
    (allEdges ?? []).filter((edge) => edge.tree_id === treeRow.id),
  ),
);
const sliced = sliceOpeningForest(forest, 4);

console.log('\nSliced forest:', sliced.length, 'trees (minForcedPlies=4)');
console.log(
  sliced.slice(0, 8).map((tree) => ({
    name: tree.name.slice(0, 36),
    nodes: tree.nodes.length,
    edges: tree.edges.length,
    rootPly: tree.rootPly,
    rootSan: tree.rootSan.join(' '),
  })),
);

const sampleTree = sliced.find((tree) => tree.nodes.length > 50) ?? sliced[0];

if (sampleTree) {
  const repertoireEdges = sampleTree.edges.filter((edge) => edge.recentCount > 0 || edge.cardCount > 0);
  const counts = { best: 0, book: 0, miss: 0 };

  for (const edge of repertoireEdges.slice(0, 150)) {
    const result = classifyLinesMove(sampleTree, edge.fromNodeId, edge.uci);
    counts[result.category] = (counts[result.category] ?? 0) + 1;
  }

  console.log('\nClassification sample on', sampleTree.name.slice(0, 40), counts);
}

console.log('\nDone.');
