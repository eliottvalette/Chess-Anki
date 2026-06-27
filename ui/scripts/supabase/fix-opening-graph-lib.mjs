export const OPENING_GRAPH_PAGE_SIZE = 1000;
export const STALE_SYNC_MIN_LOAD_RATIO = 0.9;

export function resolveStaleSyncRefusal(graphId, loadedCounts, databaseCounts) {
  if (loadedCounts.nodes === 0 && databaseCounts.nodes > 0) {
    return `Refusing stale sync for ${graphId}: loaded 0 nodes but database has ${databaseCounts.nodes}. Reload is incomplete.`;
  }

  if (databaseCounts.nodes > 0 && loadedCounts.nodes < databaseCounts.nodes * STALE_SYNC_MIN_LOAD_RATIO) {
    return `Refusing stale sync for ${graphId}: loaded ${loadedCounts.nodes}/${databaseCounts.nodes} nodes. Reload is incomplete.`;
  }

  if (databaseCounts.edges > 0 && loadedCounts.edges < databaseCounts.edges * STALE_SYNC_MIN_LOAD_RATIO) {
    return `Refusing stale sync for ${graphId}: loaded ${loadedCounts.edges}/${databaseCounts.edges} edges. Reload is incomplete.`;
  }

  return null;
}

export function resolveGraphBundleLoadRefusal(graphRow, loadedNodeCount, loadedEdgeCount) {
  const graphId = String(graphRow.id);
  const storedNodeCount = Number(graphRow.node_count ?? 0);
  const storedEdgeCount = Number(graphRow.edge_count ?? 0);

  if (storedNodeCount > 0 && loadedNodeCount < storedNodeCount) {
    return `Refusing fix for ${graphId}: loaded ${loadedNodeCount}/${storedNodeCount} nodes. Paginated reload is incomplete.`;
  }

  if (storedEdgeCount > 0 && loadedEdgeCount < storedEdgeCount) {
    return `Refusing fix for ${graphId}: loaded ${loadedEdgeCount}/${storedEdgeCount} edges. Paginated reload is incomplete.`;
  }

  return null;
}

export async function fetchAllOpeningGraphRows(supabase, table, graphIds, pageSize = OPENING_GRAPH_PAGE_SIZE) {
  if (graphIds.length === 0) {
    return [];
  }

  const rows = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .in('graph_id', graphIds)
      .order('id')
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const page = data ?? [];

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

export async function fetchOpeningGraphTableCount(supabase, table, graphId) {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('graph_id', graphId);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}
