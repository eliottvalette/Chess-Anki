import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { buildDynamicCatalogEntries, graphDraftFromRows, projectCatalogSubgraph } from '../lib/opening-graph.ts';
import { buildDrillPath, countTrainPliesInDrillPath, pickLearnBranch } from '../lib/opening-tree.ts';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const envPath = join(scriptDir, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_ADMIN_KEY ?? env.SUPABASE_SECRET_KEY);
const catalogIdArg = process.argv[2] ?? '';
let catalogRow = null;
let catalogError = null;

if (catalogIdArg) {
  ({ data: catalogRow, error: catalogError } = await supabase
    .from('opening_catalog')
    .select('id,graph_id,fen_key,catalog_ply,display_san')
    .eq('id', catalogIdArg)
    .maybeSingle());
}

if (catalogError) {
  throw new Error(catalogError.message);
}

if (!catalogRow) {
  const { data: graphRows } = await supabase
    .from('opening_graphs')
    .select('id,library,train_side,root_fen_key,target_depth');
  const graphIds = (graphRows ?? []).map((row) => String(row.id));
  const [{ data: allNodes }, { data: allEdges }] = await Promise.all([
    supabase.from('opening_nodes').select('*').in('graph_id', graphIds),
    supabase.from('opening_edges').select('*').in('graph_id', graphIds),
  ]);
  const graphs = (graphRows ?? []).map((row) =>
    graphDraftFromRows(
      row,
      (allNodes ?? []).filter((node) => String(node.graph_id) === String(row.id)),
      (allEdges ?? []).filter((edge) => String(edge.graph_id) === String(row.id)),
    ),
  );
  for (const graph of graphs) {
    const dynamic = buildDynamicCatalogEntries(graph, 2).find((entry) => entry.displaySan.join(' ') === 'e4 d5');
    if (dynamic) {
      catalogRow = {
        id: dynamic.id,
        graph_id: graph.id,
        fen_key: dynamic.fenKey,
        catalog_ply: dynamic.catalogPly,
        display_san: dynamic.displaySan,
      };
      break;
    }
  }
}

if (!catalogRow) {
  console.log('no e4 d5 catalog found');
  process.exit(1);
}

console.log('catalog', catalogRow.id, catalogRow.display_san);

const graphId = String(catalogRow.graph_id);
const { data: graphRow, error: graphRowError } = await supabase
  .from('opening_graphs')
  .select('id,library,train_side,root_fen_key,target_depth')
  .eq('id', graphId)
  .maybeSingle();
const { data: nodeRows } = await supabase.from('opening_nodes').select('*').eq('graph_id', graphId);
const { data: edgeRows } = await supabase.from('opening_edges').select('*').eq('graph_id', graphId);

if (graphRowError || !graphRow) {
  throw new Error(graphRowError?.message ?? `Graph not found: ${graphId}`);
}

const graph = graphDraftFromRows(graphRow, nodeRows ?? [], edgeRows ?? []);
const catalog = {
  id: String(catalogRow.id),
  graphId,
  entryNodeId: '',
  catalogPly: Number(catalogRow.catalog_ply),
  library: String(graphRow.library),
  fenKey: String(catalogRow.fen_key),
  name: Array.isArray(catalogRow.display_san) ? catalogRow.display_san.join(' ') : String(catalogRow.id),
  displaySan: Array.isArray(catalogRow.display_san) ? catalogRow.display_san.map(String) : [],
  displayUci: [],
  sourceCount: 0,
  subgraphNodeCount: 0,
};
const entryNode = graph.nodes.find((node) => node.fenKey === catalog.fenKey && node.ply === catalog.catalogPly);
catalog.entryNodeId = entryNode?.id ?? graph.nodes[0]?.id ?? '';

const tree = projectCatalogSubgraph(graph, graph.nodes, graph.edges, catalog, new Map());
const completed = [];
let branchIndex = 0;

while (branchIndex < 4) {
  const branch = pickLearnBranch(tree, 'white', completed);

  if (!branch.branchEdgeUci) {
    break;
  }

  const plies = branch.path.map((step) => tree.nodes.find((node) => node.id === step.nodeId)?.ply ?? '?');
  const lastStep = branch.path[branch.path.length - 1];
  const outgoing = tree.edges.filter((edge) => edge.fromNodeId === lastStep?.nodeId);
  const graphOutgoing = graph.edges.filter((edge) => edge.fromNodeId === lastStep?.nodeId);

  console.log(
    [
      `branch ${branchIndex + 1}`,
      branch.branchEdgeUci,
      `path=${branch.path.length}`,
      `train=${countTrainPliesInDrillPath(branch.path)}`,
      `plies=${plies.join(',')}`,
      `treeOut=${outgoing.length}`,
      `graphOut=${graphOutgoing.length}`,
    ].join(' | '),
  );

  if (outgoing.length === 0 && graphOutgoing.length > 0) {
    console.log('  filtered-out edges:', graphOutgoing.map((edge) => edge.uci).join(', '));
  }

  if (graphOutgoing.length > 0) {
    console.log(
      '  graph edges:',
      graphOutgoing.map((edge) => `${edge.uci}->${edge.to_node_id?.slice(-8) ?? edge.toNodeId?.slice(-8)}`).join(', '),
    );
  }

  const lastNode = tree.nodes.find((node) => node.id === lastStep?.nodeId);
  if (lastNode) {
    const graphNode = graph.nodes.find((node) => node.id === lastNode.id);
    const sameFenOutgoing = graph.edges.filter((edge) =>
      graph.nodes.some((node) => node.fenKey === lastNode.fenKey && node.id === edge.fromNodeId),
    );
    console.log(
      '  last',
      lastNode.id.slice(-8),
      'ply',
      lastNode.ply,
      'recent',
      graphNode?.recentGames ?? 0,
      'fenKey',
      lastNode.fenKey.slice(0, 24),
    );
    console.log('  same-fen outgoing', sameFenOutgoing.length);
  }

  completed.push({
    forkNodeId: branch.branchForkNodeId,
    edgeId: branch.branchEdgeId,
    edgeUci: branch.branchEdgeUci,
  });
  branchIndex += 1;
}

const forkNodeId = completed.at(-1)?.forkNodeId ?? pickLearnBranch(tree, 'white', []).branchForkNodeId;
const c8Branch = pickLearnBranch(tree, 'white', completed.slice(0, -1));
const forcedPath = buildDrillPath(tree, {
  trainSide: 'white',
  forcedEdges: forkNodeId && c8Branch.branchEdgeUci ? { [forkNodeId]: c8Branch.branchEdgeUci } : {},
});
console.log('forced path length', forcedPath.length, 'train', countTrainPliesInDrillPath(forcedPath));

const leafId = 'opening-node-7e90f37b';
const leafIncoming = graph.edges.filter((edge) => edge.toNodeId === leafId);
const leafOutgoing = graph.edges.filter((edge) => edge.fromNodeId === leafId);
const leafNode = graph.nodes.find((node) => node.id === leafId);
console.log('leaf', leafId, 'recent', leafNode?.recentGames, 'in', leafIncoming.length, 'out', leafOutgoing.length);
console.log(
  'incoming',
  leafIncoming.map((edge) => ({ uci: edge.uci, recent: edge.recentCount })),
);
