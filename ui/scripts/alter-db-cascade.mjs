import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadLocalEnv } from './supabase/env.mjs';

const { Client } = pg;

async function migrate() {
  const env = loadLocalEnv();
  const dbUrl = env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is missing in .env.local');
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  console.log('Altering foreign keys to add ON UPDATE CASCADE...');

  try {
    await client.query(`
      BEGIN;

      -- Drop existing constraints
      ALTER TABLE public.opening_nodes DROP CONSTRAINT IF EXISTS opening_nodes_graph_id_fkey;
      ALTER TABLE public.opening_edges DROP CONSTRAINT IF EXISTS opening_edges_graph_id_fkey;
      ALTER TABLE public.opening_edges DROP CONSTRAINT IF EXISTS opening_edges_from_node_id_fkey;
      ALTER TABLE public.opening_edges DROP CONSTRAINT IF EXISTS opening_edges_to_node_id_fkey;
      ALTER TABLE public.opening_catalog DROP CONSTRAINT IF EXISTS opening_catalog_graph_id_fkey;
      ALTER TABLE public.opening_catalog DROP CONSTRAINT IF EXISTS opening_catalog_entry_node_id_fkey;
      ALTER TABLE public.opening_drill_progress DROP CONSTRAINT IF EXISTS opening_drill_progress_node_id_fkey;

      -- Recreate constraints with ON UPDATE CASCADE
      ALTER TABLE public.opening_nodes 
        ADD CONSTRAINT opening_nodes_graph_id_fkey 
        FOREIGN KEY (graph_id) REFERENCES public.opening_graphs(id) ON DELETE CASCADE ON UPDATE CASCADE;

      ALTER TABLE public.opening_edges 
        ADD CONSTRAINT opening_edges_graph_id_fkey 
        FOREIGN KEY (graph_id) REFERENCES public.opening_graphs(id) ON DELETE CASCADE ON UPDATE CASCADE;
      
      ALTER TABLE public.opening_edges 
        ADD CONSTRAINT opening_edges_from_node_id_fkey 
        FOREIGN KEY (from_node_id) REFERENCES public.opening_nodes(id) ON DELETE CASCADE ON UPDATE CASCADE;
      
      ALTER TABLE public.opening_edges 
        ADD CONSTRAINT opening_edges_to_node_id_fkey 
        FOREIGN KEY (to_node_id) REFERENCES public.opening_nodes(id) ON DELETE CASCADE ON UPDATE CASCADE;

      ALTER TABLE public.opening_catalog 
        ADD CONSTRAINT opening_catalog_graph_id_fkey 
        FOREIGN KEY (graph_id) REFERENCES public.opening_graphs(id) ON DELETE CASCADE ON UPDATE CASCADE;
      
      ALTER TABLE public.opening_catalog 
        ADD CONSTRAINT opening_catalog_entry_node_id_fkey 
        FOREIGN KEY (entry_node_id) REFERENCES public.opening_nodes(id) ON DELETE CASCADE ON UPDATE CASCADE;

      ALTER TABLE public.opening_drill_progress 
        ADD CONSTRAINT opening_drill_progress_node_id_fkey 
        FOREIGN KEY (node_id) REFERENCES public.opening_nodes(id) ON DELETE CASCADE ON UPDATE CASCADE;

      COMMIT;
    `);
    console.log('Successfully updated constraints with ON UPDATE CASCADE.');
  } catch (error) {
    await client.query('ROLLBACK;');
    console.error('Failed to update constraints:', error);
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
