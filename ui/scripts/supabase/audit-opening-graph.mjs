import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import {
  buildDynamicCatalogEntries,
  catalogDraftFromRow,
  graphDraftFromRows,
  projectCatalogSubgraph,
} from '../../lib/opening-graph.ts';
import {
  buildLearnDrillExpectedFromStep,
  countTrainPliesInDrillPath,
  extendDrillPathFromNode,
  isRepertoireEdge,
  listOpponentNodesNeedingBookEnrichment,
  pickLearnBranch,
} from '../../lib/opening-tree.ts';
import { loadLocalEnv, requireAdminKey, requireEnv } from './env.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = {
    catalogId: '',
    graphId: '',
    json: false,
    writeReport: '',
    limit: 25,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--json') {
      options.json = true;
      continue;
    }

    if (token === '--catalog') {
      options.catalogId = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (token === '--graph') {
      options.graphId = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (token === '--write') {
      options.writeReport = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (token === '--limit') {
      options.limit = Math.max(1, Number(argv[index + 1]) || 25);
      index += 1;
      continue;
    }

    if (!token.startsWith('-') && !options.catalogId) {
      options.catalogId = token;
    }
  }

  return options;
}

function trainNode(node, trainSide) {
  return node.sideToMove === trainSide;
}

function repertoireOutgoing(edges, nodeId) {
  return edges.filter((edge) => edge.fromNodeId === nodeId && isRepertoireEdge(edge));
}

function auditGraphIntegrity(graph) {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const orphanEdges = graph.edges.filter((edge) => !nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId));
  const fenKeys = graph.nodes.map((node) => node.fenKey);
  const duplicateFenKeys = [...new Set(fenKeys.filter((fenKey, index) => fenKeys.indexOf(fenKey) !== index))];

  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    orphanEdgeCount: orphanEdges.length,
    duplicateFenKeyCount: duplicateFenKeys.length,
    orphanEdges: orphanEdges.slice(0, 10).map((edge) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      uci: edge.uci,
    })),
    duplicateFenKeys: duplicateFenKeys.slice(0, 10),
  };
}

function auditTrainNodes(graph) {
  const trainSide = graph.trainSide;
  const missingBest = [];
  const missingBestWithOut = [];

  for (const node of graph.nodes) {
    if (!trainNode(node, trainSide) || node.bestUci) {
      continue;
    }

    const outgoing = repertoireOutgoing(graph.edges, node.id);
    const entry = {
      nodeId: node.id,
      ply: node.ply,
      fenKey: node.fenKey,
      recentGames: node.recentGames,
      repertoireOutgoing: outgoing.length,
      suggestedUci: outgoing[0]?.uci ?? null,
      suggestedSan: outgoing[0]?.san ?? null,
    };

    missingBest.push(entry);

    if (outgoing.length > 0) {
      const ranked = [...outgoing].sort(
        (left, right) =>
          Number(right.isEngineBest) - Number(left.isEngineBest) ||
          right.recentCount - left.recentCount ||
          right.mastersGames - left.mastersGames ||
          right.priority - left.priority,
      );
      const bestEdge = ranked[0];
      missingBestWithOut.push({
        ...entry,
        suggestedUci: bestEdge.uci,
        suggestedSan: bestEdge.san,
        suggestedSource: bestEdge.source,
      });
    }
  }

  return {
    missingBestUciCount: missingBest.length,
    missingBestUciWithRepertoireOutCount: missingBestWithOut.length,
    missingBestUciWithRepertoireOut: missingBestWithOut,
  };
}

function auditOpponentNodes(graph) {
  const trainSide = graph.trainSide;
  const needingBook = listOpponentNodesNeedingBookEnrichment(graph);
  const deadEnds = [];

  for (const node of graph.nodes) {
    if (trainNode(node, trainSide)) {
      continue;
    }

    const outgoing = repertoireOutgoing(graph.edges, node.id);
    const incoming = graph.edges.filter((edge) => edge.toNodeId === node.id);

    if (outgoing.length === 0 && incoming.some((edge) => isRepertoireEdge(edge))) {
      deadEnds.push({
        nodeId: node.id,
        ply: node.ply,
        fenKey: node.fenKey,
        recentGames: node.recentGames,
        incomingCount: incoming.length,
        incomingUcis: incoming.map((edge) => edge.uci),
      });
    }
  }

  return {
    opponentNodesNeedingBookCount: needingBook.length,
    opponentNodesNeedingBook: needingBook.map((node) => ({
      nodeId: node.id,
      ply: node.ply,
      fenKey: node.fenKey,
      recentGames: node.recentGames,
    })),
    opponentDeadEndCount: deadEnds.length,
    opponentDeadEnds: deadEnds,
  };
}

function auditLearnPath(tree, trainSide) {
  const completed = [];
  const branches = [];
  let guard = 0;

  while (guard < 12) {
    const branch = pickLearnBranch(tree, trainSide, completed);

    if (!branch.branchEdgeUci || branch.path.length === 0) {
      break;
    }

    const extendedPath = extendDrillPathFromNode(tree, branch.path, trainSide);
    const blockers = [];

    for (let stepIndex = 0; stepIndex < extendedPath.length; stepIndex += 1) {
      const step = extendedPath[stepIndex];
      const nextStep = extendedPath[stepIndex + 1] ?? null;

      if (!step.isTrainTurn) {
        continue;
      }

      const expected = buildLearnDrillExpectedFromStep(step, nextStep);

      if (!expected) {
        blockers.push({
          stepIndex,
          nodeId: step.nodeId,
          ply: tree.nodes.find((node) => node.id === step.nodeId)?.ply ?? null,
          nextUci: nextStep?.edgeUciFromParent ?? null,
          nextSan: nextStep?.edgeSanFromParent ?? null,
        });
      }
    }

    const lastStep = extendedPath[extendedPath.length - 1];
    const lastOutgoing = repertoireOutgoing(tree.edges, lastStep?.nodeId ?? '');

    branches.push({
      branchEdgeUci: branch.branchEdgeUci,
      branchForkNodeId: branch.branchForkNodeId,
      pathLength: extendedPath.length,
      trainPlies: countTrainPliesInDrillPath(extendedPath),
      learnBlockers: blockers,
      lastNodeId: lastStep?.nodeId ?? null,
      lastPly: tree.nodes.find((node) => node.id === lastStep?.nodeId)?.ply ?? null,
      lastSideToMove: lastStep?.sideToMove ?? null,
      lastOutgoingRepertoireCount: lastOutgoing.length,
      shortBranch: Boolean(lastStep && lastStep.isTrainTurn && lastOutgoing.length === 0),
    });

    completed.push({
      forkNodeId: branch.branchForkNodeId,
      edgeId: branch.branchEdgeId,
      edgeUci: branch.branchEdgeUci,
    });
    guard += 1;
  }

  return branches;
}

function resolveCatalogTargets(catalogRows, graphs, nodesByGraph, edgesByGraph, catalogId) {
  if (!catalogId) {
    return catalogRows.map((row) => ({
      graph: graphDraftFromRows(
        graphs.find((graphRow) => String(graphRow.id) === String(row.graph_id)),
        nodesByGraph.get(String(row.graph_id)) ?? [],
        edgesByGraph.get(String(row.graph_id)) ?? [],
      ),
      catalogRow: row,
    }));
  }

  const databaseMatch = catalogRows.find((row) => String(row.id) === catalogId);

  if (databaseMatch) {
    const graphId = String(databaseMatch.graph_id);
    const graphRow = graphs.find((row) => String(row.id) === graphId);

    return [
      {
        graph: graphDraftFromRows(graphRow, nodesByGraph.get(graphId) ?? [], edgesByGraph.get(graphId) ?? []),
        catalogRow: databaseMatch,
      },
    ];
  }

  for (const graphRow of graphs) {
    const graphId = String(graphRow.id);
    const graph = graphDraftFromRows(graphRow, nodesByGraph.get(graphId) ?? [], edgesByGraph.get(graphId) ?? []);

    for (const browsePly of [2, 4, 6, 8]) {
      const dynamicCatalog = buildDynamicCatalogEntries(graph, browsePly).find((entry) => entry.id === catalogId);

      if (dynamicCatalog) {
        return [
          {
            graph,
            catalogRow: {
              id: dynamicCatalog.id,
              graph_id: graphId,
              entry_node_id: dynamicCatalog.entryNodeId,
              catalog_ply: dynamicCatalog.catalogPly,
              library: dynamicCatalog.library,
              fen_key: dynamicCatalog.fenKey,
              name: dynamicCatalog.name,
              display_san: dynamicCatalog.displaySan,
              display_uci: dynamicCatalog.displayUci,
              source_count: dynamicCatalog.sourceCount,
              subgraph_node_count: dynamicCatalog.subgraphNodeCount,
            },
          },
        ];
      }
    }
  }

  throw new Error(`Catalog not found in database or dynamic entries: ${catalogId}`);
}

function auditCatalog(graph, catalogRow) {
  const catalog = catalogDraftFromRow(catalogRow);
  const tree = projectCatalogSubgraph(graph, graph.nodes, graph.edges, catalog, new Map());
  const trainSide = graph.trainSide;
  const branches = auditLearnPath(tree, trainSide);
  const blockerCount = branches.reduce((sum, branch) => sum + branch.learnBlockers.length, 0);
  const shortBranchCount = branches.filter((branch) => branch.shortBranch).length;

  return {
    catalogId: catalog.id,
    name: catalog.name,
    displaySan: catalog.displaySan,
    graphId: graph.id,
    nodeCount: tree.nodes.length,
    edgeCount: tree.edges.length,
    branchCount: branches.length,
    learnBlockerCount: blockerCount,
    shortBranchCount,
    branches,
  };
}

function summarizeReport(report) {
  const lines = [];
  lines.push('=== opening graph supabase audit ===');
  lines.push(`graphs: ${report.graphCount}`);
  lines.push(`catalogs: ${report.catalogCount}`);
  lines.push('');

  for (const graphReport of report.graphs) {
    lines.push(`--- graph ${graphReport.graphId} (${graphReport.library} · train ${graphReport.trainSide}) ---`);
    lines.push(
      `nodes ${graphReport.integrity.nodeCount} · edges ${graphReport.integrity.edgeCount} · orphan edges ${graphReport.integrity.orphanEdgeCount}`,
    );
    lines.push(
      `train missing best_uci: ${graphReport.train.missingBestUciCount} · with repertoire out: ${graphReport.train.missingBestUciWithRepertoireOutCount}`,
    );
    lines.push(
      `opponent need book: ${graphReport.opponent.opponentNodesNeedingBookCount} · dead ends: ${graphReport.opponent.opponentDeadEndCount}`,
    );

    if (graphReport.train.missingBestUciWithRepertoireOutCount > 0) {
      lines.push('top train nodes missing best_uci (backfill candidates):');

      for (const node of graphReport.train.missingBestUciWithRepertoireOut.slice(0, report.limit)) {
        lines.push(
          `  ${node.nodeId} ply ${node.ply} · out ${node.repertoireOutgoing} · suggest ${node.suggestedSan} (${node.suggestedUci})`,
        );
      }
    }

    if (graphReport.opponent.opponentNodesNeedingBookCount > 0) {
      lines.push('top opponent nodes needing lichess book:');

      for (const node of graphReport.opponent.opponentNodesNeedingBook.slice(0, report.limit)) {
        lines.push(`  ${node.nodeId} ply ${node.ply} · recent ${node.recentGames}`);
      }
    }

    lines.push('');
  }

  for (const catalogReport of report.catalogs) {
    lines.push(`--- catalog ${catalogReport.catalogId} · ${catalogReport.name} ---`);
    lines.push(
      `subgraph ${catalogReport.nodeCount} nodes · branches ${catalogReport.branchCount} · learn blockers ${catalogReport.learnBlockerCount} · short branches ${catalogReport.shortBranchCount}`,
    );

    for (const branch of catalogReport.branches) {
      lines.push(
        `  branch ${branch.branchEdgeUci} · path ${branch.pathLength} · train ${branch.trainPlies} · blockers ${branch.learnBlockers.length} · short ${branch.shortBranch ? 'yes' : 'no'}`,
      );

      for (const blocker of branch.learnBlockers) {
        lines.push(
          `    blocker step ${blocker.stepIndex} ${blocker.nodeId} ply ${blocker.ply} · path expects ${blocker.nextSan} (${blocker.nextUci})`,
        );
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

export async function runOpeningGraphAudit(options = {}) {
  const env = loadLocalEnv();
  const supabase = createClient(requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL'), requireAdminKey(env));

  const { data: graphRows, error: graphError } = await supabase
    .from('opening_graphs')
    .select('id,library,train_side,root_fen_key,target_depth,node_count,edge_count');

  if (graphError) {
    throw new Error(graphError.message);
  }

  let graphs = graphRows ?? [];

  if (options.graphId) {
    graphs = graphs.filter((row) => String(row.id) === options.graphId);
  }

  const graphIds = graphs.map((row) => String(row.id));

  if (graphIds.length === 0) {
    throw new Error('No opening graphs found for audit.');
  }

  const [
    { data: nodeRows, error: nodeError },
    { data: edgeRows, error: edgeError },
    { data: catalogRows, error: catalogError },
  ] = await Promise.all([
    supabase.from('opening_nodes').select('*').in('graph_id', graphIds),
    supabase.from('opening_edges').select('*').in('graph_id', graphIds),
    supabase.from('opening_catalog').select('*').in('graph_id', graphIds),
  ]);

  if (nodeError) {
    throw new Error(nodeError.message);
  }

  if (edgeError) {
    throw new Error(edgeError.message);
  }

  if (catalogError) {
    throw new Error(catalogError.message);
  }

  const nodesByGraph = new Map();

  for (const row of nodeRows ?? []) {
    const graphId = String(row.graph_id);
    const bucket = nodesByGraph.get(graphId) ?? [];
    bucket.push(row);
    nodesByGraph.set(graphId, bucket);
  }

  const edgesByGraph = new Map();

  for (const row of edgeRows ?? []) {
    const graphId = String(row.graph_id);
    const bucket = edgesByGraph.get(graphId) ?? [];
    bucket.push(row);
    edgesByGraph.set(graphId, bucket);
  }

  const graphReports = [];

  for (const graphRow of graphs) {
    const graphId = String(graphRow.id);
    const graph = graphDraftFromRows(graphRow, nodesByGraph.get(graphId) ?? [], edgesByGraph.get(graphId) ?? []);

    graphReports.push({
      graphId,
      library: graph.library,
      trainSide: graph.trainSide,
      targetDepth: graph.targetDepth,
      storedNodeCount: Number(graphRow.node_count ?? 0),
      storedEdgeCount: Number(graphRow.edge_count ?? 0),
      integrity: auditGraphIntegrity(graph),
      train: auditTrainNodes(graph),
      opponent: auditOpponentNodes(graph),
    });
  }

  const catalogTargets = resolveCatalogTargets(
    catalogRows ?? [],
    graphs,
    nodesByGraph,
    edgesByGraph,
    options.catalogId,
  );

  const catalogReports = catalogTargets.map((target) => auditCatalog(target.graph, target.catalogRow));

  if (options.catalogId) {
    const focusedGraphId = String(catalogTargets[0]?.graph.id ?? '');
    if (focusedGraphId) {
      const focusedIndex = graphReports.findIndex((graphReport) => graphReport.graphId === focusedGraphId);
      if (focusedIndex >= 0) {
        graphReports.splice(0, graphReports.length, graphReports[focusedIndex]);
      }
    }
  }

  const report = {
    auditedAt: new Date().toISOString(),
    graphCount: graphReports.length,
    catalogCount: catalogReports.length,
    limit: options.limit ?? 25,
    graphs: graphReports,
    catalogs: catalogReports,
    totals: {
      trainMissingBestUciWithOut: graphReports.reduce(
        (sum, graphReport) => sum + graphReport.train.missingBestUciWithRepertoireOutCount,
        0,
      ),
      opponentNeedingBook: graphReports.reduce(
        (sum, graphReport) => sum + graphReport.opponent.opponentNodesNeedingBookCount,
        0,
      ),
      opponentDeadEnds: graphReports.reduce((sum, graphReport) => sum + graphReport.opponent.opponentDeadEndCount, 0),
      learnBlockers: catalogReports.reduce((sum, catalogReport) => sum + catalogReport.learnBlockerCount, 0),
      shortBranches: catalogReports.reduce((sum, catalogReport) => sum + catalogReport.shortBranchCount, 0),
    },
  };

  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runOpeningGraphAudit(options);
  const summary = summarizeReport(report);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(summary);
    console.log('--- totals ---');
    console.log(JSON.stringify(report.totals, null, 2));
  }

  if (options.writeReport) {
    const outputPath = join(scriptDir, options.writeReport);
    writeFileSync(outputPath, `${summary}\n\n--- json ---\n${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote ${outputPath}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
