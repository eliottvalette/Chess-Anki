import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { Chess } from 'chess.js';

import { graphDraftFromRows } from '../../lib/opening-graph.ts';
import {
  backfillTrainNodeBestUciFromRepertoire,
  ensureDraftEdge,
  isRepertoireEdge,
  normalizeOpeningFen,
} from '../../lib/opening-tree.ts';
import { forestToUpsertRows } from '../../lib/opening-tree-import.ts';
import { loadLocalEnv, requireAdminKey, requireEnv } from './env.mjs';
import { fetchAllOpeningGraphRows, resolveGraphBundleLoadRefusal } from './fix-opening-graph-lib.mjs';

const ENGINE_BATCH_SIZE = 120;
const DEFAULT_ENGINE_CONCURRENCY = 4;

function parseArgs(argv) {
  const options = {
    profileId: '',
    graphId: '',
    dryRun: false,
    runEngine: false,
    engineConcurrency: DEFAULT_ENGINE_CONCURRENCY,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (token === '--engine') {
      options.runEngine = true;
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

    if (token === '--engine-concurrency') {
      options.engineConcurrency = Math.max(1, Number(argv[index + 1]) || DEFAULT_ENGINE_CONCURRENCY);
      index += 1;
    }
  }

  return options;
}

function repertoireOutgoing(graph, nodeId) {
  return graph.edges.filter((edge) => edge.fromNodeId === nodeId && isRepertoireEdge(edge));
}

export function countTrainNodeGaps(graph) {
  const trainSide = graph.trainSide;
  let missingBestUci = 0;
  let missingBestUciWithRepertoireOut = 0;
  let engineCandidates = 0;

  for (const node of graph.nodes) {
    if (node.sideToMove !== trainSide || node.bestUci) {
      continue;
    }

    missingBestUci += 1;
    const outgoing = repertoireOutgoing(graph, node.id);

    if (outgoing.length > 0) {
      missingBestUciWithRepertoireOut += 1;
    } else {
      engineCandidates += 1;
    }
  }

  return {
    missingBestUci,
    missingBestUciWithRepertoireOut,
    engineCandidates,
  };
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

async function enrichEngineBatch(graph, batchSize, analyzeBaseUrl, concurrency) {
  const candidates = graph.nodes
    .filter((node) => node.sideToMove === graph.trainSide && !node.bestUci)
    .sort((left, right) => left.ply - right.ply)
    .slice(0, batchSize);

  if (candidates.length === 0) {
    return 0;
  }

  const results = await runWithConcurrency(candidates, concurrency, async (node) => {
    try {
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

      ensureDraftEdge(
        {
          id: graph.id,
          trainSide: graph.trainSide,
          library: graph.library,
          nodes: graph.nodes,
          edges: graph.edges,
        },
        node,
        analysis.bestMove,
        'engine_best',
        { isEngineBest: true, priority: 40 },
      );

      return true;
    } catch {
      return false;
    }
  });

  return results.filter(Boolean).length;
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

  const [nodeRows, edgeRows] = await Promise.all([
    fetchAllOpeningGraphRows(supabase, 'opening_nodes', graphIds),
    fetchAllOpeningGraphRows(supabase, 'opening_edges', graphIds),
  ]);

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
    };
  });
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

async function upsertGraphNodesAndEdges(supabase, profileId, graph) {
  const now = new Date().toISOString();
  const rows = forestToUpsertRows({ graphs: [graph], catalogs: [] }, now);

  if (rows.graphs.length > 0) {
    const { error } = await supabase.from('opening_graphs').upsert(
      rows.graphs.map((graphRow) => ({
        ...graphRow,
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
}

export async function runOpeningTrainNodeFix(options = {}) {
  const env = loadLocalEnv();
  const analyzeBaseUrl = env.ANALYZE_BASE_URL?.trim() || 'http://localhost:3000';
  const supabase = createClient(requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL'), requireAdminKey(env));
  const profileId = await resolveProfileId(supabase, options.profileId ?? '');
  const bundles = await loadBundles(supabase, profileId, options.graphId ?? '');

  if (bundles.length === 0) {
    throw new Error('No graph bundles found.');
  }

  const graphStats = [];

  console.log(options.dryRun ? 'mode: dry-run' : 'mode: write');
  console.log(options.runEngine ? `engine: yes (${analyzeBaseUrl})` : 'engine: no (repertoire backfill only)');

  for (const bundle of bundles) {
    const graph = bundle.graph;
    const before = countTrainNodeGaps(graph);

    console.log(
      `\n[${graph.library}/${graph.trainSide}] ${graph.id} · ${graph.nodes.length} nodes · before missing=${before.missingBestUci} · withRepOut=${before.missingBestUciWithRepertoireOut} · engineNeeded=${before.engineCandidates}`,
    );

    const backfilled = backfillTrainNodeBestUciFromRepertoire(graph);
    const afterBackfill = countTrainNodeGaps(graph);
    let engineUpdated = 0;
    let engineRounds = 0;

    if (options.runEngine && !options.dryRun && afterBackfill.engineCandidates > 0) {
      for (let round = 0; round < 30; round += 1) {
        const updated = await enrichEngineBatch(graph, ENGINE_BATCH_SIZE, analyzeBaseUrl, options.engineConcurrency);

        if (updated === 0) {
          break;
        }

        engineRounds += 1;
        engineUpdated += updated;
        backfillTrainNodeBestUciFromRepertoire(graph);
      }
    }

    const after = countTrainNodeGaps(graph);

    console.log(
      `  backfill=${backfilled} · after missing=${after.missingBestUci} · withRepOut=${after.missingBestUciWithRepertoireOut} · engineNeeded=${after.engineCandidates}`,
    );

    if (options.runEngine && options.dryRun && after.engineCandidates > 0) {
      console.log(`  engine dry-run: would analyze ${after.engineCandidates} train nodes`);
    }

    if (options.runEngine && !options.dryRun && engineUpdated > 0) {
      console.log(`  engine rounds=${engineRounds} · best_uci set=${engineUpdated}`);
    }

    if (!options.dryRun && (backfilled > 0 || engineUpdated > 0)) {
      await upsertGraphNodesAndEdges(supabase, profileId, graph);
      console.log('  upserted nodes/edges');
    }

    graphStats.push({
      graphId: graph.id,
      library: graph.library,
      trainSide: graph.trainSide,
      before,
      backfilled,
      engineUpdated,
      after,
    });
  }

  const totals = graphStats.reduce(
    (accumulator, stats) => ({
      missingBestUciBefore: accumulator.missingBestUciBefore + stats.before.missingBestUci,
      missingWithRepOutBefore: accumulator.missingWithRepOutBefore + stats.before.missingBestUciWithRepertoireOut,
      backfilled: accumulator.backfilled + stats.backfilled,
      engineUpdated: accumulator.engineUpdated + stats.engineUpdated,
      missingBestUciAfter: accumulator.missingBestUciAfter + stats.after.missingBestUci,
      missingWithRepOutAfter: accumulator.missingWithRepOutAfter + stats.after.missingBestUciWithRepertoireOut,
      engineNeededAfter: accumulator.engineNeededAfter + stats.after.engineCandidates,
    }),
    {
      missingBestUciBefore: 0,
      missingWithRepOutBefore: 0,
      backfilled: 0,
      engineUpdated: 0,
      missingBestUciAfter: 0,
      missingWithRepOutAfter: 0,
      engineNeededAfter: 0,
    },
  );

  if (options.dryRun) {
    console.log('\n[dry-run] no database writes');
  } else {
    console.log('\nfix train nodes complete');
  }

  return { profileId, dryRun: options.dryRun, graphStats, totals };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!process.argv.includes('--write')) {
    options.dryRun = true;
  }

  const result = await runOpeningTrainNodeFix(options);
  console.log(JSON.stringify(result.totals, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
