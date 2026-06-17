import { createClient } from '@supabase/supabase-js';

import { loadLocalEnv, requireAdminKey, requireEnv } from './supabase/env.mjs';

const TABLES = [
  { name: 'opening_drill_progress', filterColumn: 'updated_at' },
  { name: 'opening_catalog', filterColumn: 'created_at' },
  { name: 'opening_edges', filterColumn: 'created_at' },
  { name: 'opening_nodes', filterColumn: 'created_at' },
  { name: 'opening_graphs', filterColumn: 'updated_at' },
  { name: 'opening_build_state', filterColumn: 'updated_at' },
  { name: 'opening_trees', filterColumn: 'updated_at' },
];

function isMissingTableError(error) {
  if (!error) {
    return false;
  }

  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST204') {
    return true;
  }

  const message = String(error.message ?? '');

  return message.includes('schema cache') || message.includes('does not exist');
}

async function main() {
  const env = loadLocalEnv();
  const supabaseUrl = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL');
  const adminKey = requireAdminKey(env);
  const supabase = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const clearedTables = [];
  const skippedTables = [];

  for (const table of TABLES) {
    const { error } = await supabase.from(table.name).delete().gte(table.filterColumn, '1970-01-01T00:00:00.000Z');

    if (error) {
      if (isMissingTableError(error)) {
        skippedTables.push(table.name);
        continue;
      }

      throw new Error(`${table.name}: ${error.message}`);
    }

    clearedTables.push(table.name);
  }

  console.error(`[purge-opening-data] cleared tables: ${clearedTables.join(', ') || '(none)'}`);

  if (skippedTables.length > 0) {
    console.error(`[purge-opening-data] skipped missing tables: ${skippedTables.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
