import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { loadLocalEnv, requireAdminKey, requireEnv } from './env.mjs';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export async function main() {
  const env = loadLocalEnv();
  const supabase = createClient(requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL'), requireAdminKey(env), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const before = await countRows(supabase);
  const { error } = await supabase.from('game_analysis_cache').delete().not('cache_key', 'is', null);

  if (error) {
    throw new Error(`game_analysis_cache purge failed: ${error.message}`);
  }

  const after = await countRows(supabase);
  console.log(JSON.stringify({ table: 'game_analysis_cache', deleted: before - after, before, after }, null, 2));
}

async function countRows(supabase) {
  const { count, error } = await supabase.from('game_analysis_cache').select('cache_key', {
    count: 'exact',
    head: true,
  });

  if (error) {
    throw new Error(`game_analysis_cache count failed: ${error.message}`);
  }

  return count ?? 0;
}
