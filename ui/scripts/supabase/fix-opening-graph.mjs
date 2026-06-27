import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { Chess } from 'chess.js';

import { buildDynamicCatalogEntries, graphDraftFromRows } from '../../lib/opening-graph.ts';
import {
  backfillTrainNodeBestUciFromRepertoire,
  ensureDraftEdge,
  listOpponentNodesNeedingBookEnrichment,
  normalizeOpeningFen,
  pruneOpeningTreeDraft,
} from '../../lib/opening-tree.ts';
import { forestToUpsertRows } from '../../lib/opening-tree-import.ts';
import { loadLocalEnv, requireAdminKey, requireEnv } from './env.mjs';
import {
  fetchAllOpeningGraphRows,
  fetchOpeningGraphTableCount,
  resolveGraphBundleLoadRefusal,
  resolveStaleSyncRefusal,
} from './fix-opening-graph-lib.mjs';

const LICHESS_EXPLORER_URL = 'https://explorer.lichess.org/masters';
const LICHESS_BATCH_SIZE = 80;
const LICHESS_MAX_ROUNDS = 40;
const DEFAULT_LICHESS_CONCURRENCY = 6;
const ENGINE_BATCH_SIZE = 120;
const ENGINE_MAX_ROUNDS = 30;
const DEFAULT_ENGINE_CONCURRENCY = 4;
const CATALOG_BROWSE_PLIES = [2, 4, 6, 8];

function parseArgs(argv) {
  const options = {
    profileId: '',
    graphId: '',
    dryRun: false,
    skipEngine: false,
    skipLichess: false,
    prune: false,
    lichessConcurrency: DEFAULT_LICHESS_CONCURRENCY,
    engineConcurrency: DEFAULT_ENGINE_CONCURRENCY,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (token === '--skip-engine') {
      options.skipEngine = true;
      continue;
    }

    if (token === '--skip-lichess') {
      options.skipLichess = true;
      continue;
    }

    if (token === '--prune') {
      options.prune = true;
      continue;
    }

    if (token === '--profile') {
      options.profileId = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (token === '--graph') {
      options.graphId = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (token === '--lichess-concurrency') {
      options.lichessConcurrency = Math.max(1, Number(argv[index + 1]) || DEFAULT_LICHESS_CONCURRENCY);
      index += 1;
      continue;
    }

    if (token === '--engine-concurrency') {
      options.engineConcurrency = Math.max(1, Number(argv[index + 1]) || DEFAULT_ENGINE_CONCURRENCY);
      index += 1;
    }
  }

  return options;
}

async function runWithConcurrency(items, concurrency, task) {
  if (items.length === 0) {
    return [];
  }

  const results = Array.from({ length: items.length });
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await task(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

async function fetchLichessOpeningExplorer(fen) {
  const url = new URL(LICHESS_EXPLORER_URL);
  url.searchParams.set('fen', fen);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Opening explorer request failed with status ${response.status}.`);
  }

  return response.json();
}

function moveSanFromFen(fen, uci) {
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

function graphAsTreeDraft(graph) {
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

function removeOrphanEdges(graph) {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const before = graph.edges.length;
  graph.edges = graph.edges.filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId));

  return before - graph.edges.length;
}

async function enrichLichessNode(draft, node) {
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
}

async function enrichLichessBatch(graph, batchSize, attemptedNodeIds, concurrency) {
  const draft = graphAsTreeDraft(graph);
  const opponentNodes = listOpponentNodesNeedingBookEnrichment(draft)
    .filter((node) => !attemptedNodeIds.has(node.id))
    .sort((left, right) => left.ply - right.ply)
    .slice(0, batchSize);

  if (opponentNodes.length === 0) {
    return { processed: 0, newEdges: 0 };
  }

  const beforeEdgeCount = draft.edges.length;

  await runWithConcurrency(opponentNodes, concurrency, async (node) => {
    try {
      await enrichLichessNode(draft, node);
    } catch {
      // Lichess is opportunistic.
    } finally {
      attemptedNodeIds.add(node.id);
    }
  });

  return {
    processed: opponentNodes.length,
    newEdges: draft.edges.length - beforeEdgeCount,
  };
}

async function enrichEngineNode(graph, draft, node, analyzeBaseUrl) {
  const response = await fetch(`${analyzeBaseUrl}/api/analyze-position`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fen: node.fen, depth: 14, multipv: 1 }),
  });

  if (!response.ok) {
    return false;
  }

  const analysis = await response.json();

  if (!analysis?.bestMove) {
    return false;
  }

  node.bestUci = analysis.bestMove;
  node.bestSan = moveSanFromFen(node.fen, analysis.bestMove) ?? analysis.bestMove;
  node.evalCp = analysis.whitePerspective?.type === 'cp' ? analysis.whitePerspective.value : null;

  ensureDraftEdge(draft, node, analysis.bestMove, 'engine_best', {
    isEngineBest: true,
    priority: 40,
  });

  const targetNode = graph.nodes.find((candidate) => {
    const chess = new Chess(node.fen);

    try {
      chess.move({
        from: analysis.bestMove.slice(0, 2),
        to: analysis.bestMove.slice(2, 4),
        ...(analysis.bestMove[4] ? { promotion: analysis.bestMove[4] } : {}),
      });
    } catch {
      return false;
    }

    return candidate.fenKey === normalizeOpeningFen(chess.fen());
  });

  if (targetNode && targetNode.evalCp == null && analysis.lines?.[0]?.whitePerspective?.type === 'cp') {
    targetNode.evalCp = analysis.lines[0].whitePerspective.value;
  }

  return true;
}

async function enrichEngineBatch(graph, batchSize, analyzeBaseUrl, concurrency) {
  const candidates = graph.nodes
    .filter((node) => node.sideToMove === graph.trainSide && !node.bestUci)
    .sort((left, right) => left.ply - right.ply)
    .slice(0, batchSize);

  if (candidates.length === 0) {
    return 0;
  }

  const draft = graphAsTreeDraft(graph);
  const results = await runWithConcurrency(candidates, concurrency, async (node) => {
    try {
      return await enrichEngineNode(graph, draft, node, analyzeBaseUrl);
    } catch {
      return false;
    }
  });

  return results.filter(Boolean).length;
}

function rebuildCatalogs(graph) {
  const catalogsById = new Map();

  for (const browsePly of CATALOG_BROWSE_PLIES) {
    for (const catalog of buildDynamicCatalogEntries(graph, browsePly)) {
      catalogsById.set(catalog.id, catalog);
    }
  }

  return [...catalogsById.values()];
}

function pruneGraph(graph) {
  const draft = graphAsTreeDraft(graph);
  const beforeNodes = graph.nodes.length;
  const beforeEdges = graph.edges.length;
  pruneOpeningTreeDraft(draft);
  graph.nodes = draft.nodes;
  graph.edges = draft.edges;

  return {
    removedNodes: beforeNodes - graph.nodes.length,
    removedEdges: beforeEdges - graph.edges.length,
  };
}

async function deleteStaleRows(supabase, graphId, nodeIds, edgeIds, loadedCounts) {
  const databaseNodeCount = await fetchOpeningGraphTableCount(supabase, 'opening_nodes', graphId);
  const databaseEdgeCount = await fetchOpeningGraphTableCount(supabase, 'opening_edges', graphId);
  const refusal = resolveStaleSyncRefusal(graphId, loadedCounts, {
    nodes: databaseNodeCount,
    edges: databaseEdgeCount,
  });

  if (refusal) {
    throw new Error(refusal);
  }

  const edgeRows = await fetchAllOpeningGraphRows(supabase, 'opening_edges', [graphId]);
  const staleEdgeIds = edgeRows.map((row) => String(row.id)).filter((edgeId) => !edgeIds.has(edgeId));

  if (staleEdgeIds.length > 0) {
    const { error } = await supabase.from('opening_edges').delete().in('id', staleEdgeIds);

    if (error) {
      throw new Error(error.message);
    }
  }

  const nodeRows = await fetchAllOpeningGraphRows(supabase, 'opening_nodes', [graphId]);
  const staleNodeIds = nodeRows.map((row) => String(row.id)).filter((nodeId) => !nodeIds.has(nodeId));

  if (staleNodeIds.length > 0) {
    const { error } = await supabase.from('opening_nodes').delete().in('id', staleNodeIds);

    if (error) {
      throw new Error(error.message);
    }
  }

  return {
    deletedEdges: staleEdgeIds.length,
    deletedNodes: staleNodeIds.length,
  };
}

async function upsertGraphForest(supabase, profileId, forest) {
  const now = new Date().toISOString();
  const rows = forestToUpsertRows(forest, now);
  const graphIds = rows.graphs.map((graph) => graph.id);

  if (rows.graphs.length > 0) {
    const { error } = await supabase.from('opening_graphs').upsert(
      rows.graphs.map((graph) => ({
        ...graph,
        owner_profile_id: profileId,
      })),
      { onConflict: 'owner_profile_id,library,train_side' },
    );

    if (error) {
      throw new Error(error.message);
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
    const { error: deleteCatalogError } = await supabase.from('opening_catalog').delete().in('graph_id', graphIds);

    if (deleteCatalogError) {
      throw new Error(deleteCatalogError.message);
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
}

async function loadBundles(supabase, profileId, graphId) {
  let graphQuery = supabase
    .from('opening_graphs')
    .select('id,library,train_side,root_fen_key,target_depth,node_count,edge_count,owner_profile_id')
    .eq('owner_profile_id', profileId);

  if (graphId) {
    graphQuery = graphQuery.eq('id', graphId);
  }

  const { data: graphRows, error: graphError } = await graphQuery;

  if (graphError) {
    throw new Error(graphError.message);
  }

  const graphs = graphRows ?? [];
  const graphIds = graphs.map((row) => String(row.id));

  if (graphIds.length === 0) {
    return [];
  }

  const [nodeRows, edgeRows, { data: catalogRows, error: catalogError }] = await Promise.all([
    fetchAllOpeningGraphRows(supabase, 'opening_nodes', graphIds),
    fetchAllOpeningGraphRows(supabase, 'opening_edges', graphIds),
    supabase.from('opening_catalog').select('*').eq('owner_profile_id', profileId),
  ]);

  if (catalogError) {
    throw new Error(catalogError.message);
  }

  return graphs.map((graphRow) => {
    const currentGraphId = String(graphRow.id);
    const graphNodes = nodeRows.filter((row) => String(row.graph_id) === currentGraphId);
    const graphEdges = edgeRows.filter((row) => String(row.graph_id) === currentGraphId);
    const loadRefusal = resolveGraphBundleLoadRefusal(graphRow, graphNodes.length, graphEdges.length);

    if (loadRefusal) {
      throw new Error(loadRefusal);
    }

    return {
      graphRow,
      graph: graphDraftFromRows(graphRow, graphNodes, graphEdges),
      catalogRows: (catalogRows ?? []).filter((row) => String(row.graph_id) === currentGraphId),
    };
  });
}

async function fixGraph(graph, options, analyzeBaseUrl) {
  const stats = {
    graphId: graph.id,
    library: graph.library,
    trainSide: graph.trainSide,
    orphanEdgesRemoved: 0,
    bestUciBackfilled: 0,
    lichessRounds: 0,
    lichessNodes: 0,
    lichessNewEdges: 0,
    engineRounds: 0,
    engineNodes: 0,
    prunedNodes: 0,
    prunedEdges: 0,
    catalogs: 0,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
  };

  console.log(
    `\n[${graph.library}/${graph.trainSide}] ${graph.id} · ${graph.nodes.length} nodes · ${graph.edges.length} edges`,
  );

  stats.orphanEdgesRemoved = removeOrphanEdges(graph);
  stats.bestUciBackfilled = backfillTrainNodeBestUciFromRepertoire(graph);
  console.log(`  orphan edges removed: ${stats.orphanEdgesRemoved}`);
  console.log(`  best_uci backfill (repertoire): ${stats.bestUciBackfilled}`);

  if (!options.skipLichess) {
    const attemptedLichessNodeIds = new Set();

    for (let round = 0; round < LICHESS_MAX_ROUNDS; round += 1) {
      const batch = await enrichLichessBatch(
        graph,
        LICHESS_BATCH_SIZE,
        attemptedLichessNodeIds,
        options.lichessConcurrency,
      );

      if (batch.processed === 0) {
        break;
      }

      stats.lichessRounds += 1;
      stats.lichessNodes += batch.processed;
      stats.lichessNewEdges += batch.newEdges;
      stats.bestUciBackfilled += backfillTrainNodeBestUciFromRepertoire(graph);
      console.log(
        `  lichess round ${round + 1}: nodes ${batch.processed} · new edges ${batch.newEdges} · total edges ${graph.edges.length}`,
      );

      if (batch.newEdges === 0) {
        break;
      }
    }
  }

  if (!options.skipEngine) {
    for (let round = 0; round < ENGINE_MAX_ROUNDS; round += 1) {
      const updated = await enrichEngineBatch(graph, ENGINE_BATCH_SIZE, analyzeBaseUrl, options.engineConcurrency);

      if (updated === 0) {
        break;
      }

      stats.engineRounds += 1;
      stats.engineNodes += updated;
      stats.bestUciBackfilled += backfillTrainNodeBestUciFromRepertoire(graph);
      console.log(`  engine round ${round + 1}: best_uci set on ${updated} nodes`);
    }
  }

  const pruneStats = options.prune ? pruneGraph(graph) : { removedNodes: 0, removedEdges: 0 };
  stats.prunedNodes = pruneStats.removedNodes;
  stats.prunedEdges = pruneStats.removedEdges;
  stats.bestUciBackfilled += backfillTrainNodeBestUciFromRepertoire(graph);
  stats.nodes = graph.nodes.length;
  stats.edges = graph.edges.length;

  if (options.prune) {
    console.log(`  prune: -${stats.prunedNodes} nodes · -${stats.prunedEdges} edges`);
  }

  console.log(`  final: ${stats.nodes} nodes · ${stats.edges} edges`);

  return stats;
}

async function resolveProfileId(supabase, requestedProfileId) {
  if (requestedProfileId) {
    return requestedProfileId;
  }

  const { data, error } = await supabase.from('opening_graphs').select('owner_profile_id').limit(1).maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.owner_profile_id) {
    throw new Error('No opening graphs found. Pass --profile <uuid>.');
  }

  return String(data.owner_profile_id);
}

export async function runOpeningGraphFix(options = {}) {
  const env = loadLocalEnv();
  const analyzeBaseUrl = env.ANALYZE_BASE_URL?.trim() || 'http://localhost:3000';
  const supabase = createClient(requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL'), requireAdminKey(env));
  const profileId = await resolveProfileId(supabase, options.profileId ?? '');
  const bundles = await loadBundles(supabase, profileId, options.graphId ?? '');

  if (bundles.length === 0) {
    throw new Error('No graph bundles found for fix.');
  }

  const graphs = [];
  const catalogs = [];
  const graphStats = [];

  console.log(`analyze API: ${analyzeBaseUrl}`);
  console.log(`concurrency: lichess ${options.lichessConcurrency} · engine ${options.engineConcurrency}`);

  for (const bundle of bundles) {
    const stats = await fixGraph(bundle.graph, options, analyzeBaseUrl);
    const rebuiltCatalogs = rebuildCatalogs(bundle.graph);
    stats.catalogs = rebuiltCatalogs.length;
    console.log(`  catalogs rebuilt: ${stats.catalogs}`);
    graphStats.push(stats);
    graphs.push(bundle.graph);
    catalogs.push(...rebuiltCatalogs);
  }

  if (options.dryRun) {
    console.log('\n[dry-run] no database writes');
    return { profileId, graphStats, dryRun: true };
  }

  await upsertGraphForest(supabase, profileId, { graphs, catalogs });

  for (const graph of graphs) {
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const edgeIds = new Set(graph.edges.map((edge) => edge.id));
    const deleted = await deleteStaleRows(supabase, graph.id, nodeIds, edgeIds, {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    });
    console.log(
      `  synced ${graph.id}: deleted ${deleted.deletedEdges} stale edges · ${deleted.deletedNodes} stale nodes`,
    );
  }

  console.log('\nfix complete');
  return { profileId, graphStats, dryRun: false };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runOpeningGraphFix(options);
  console.log(JSON.stringify(result.graphStats, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
