import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import pg from 'pg';

import { getPgConfig } from './migrate.mjs';
import { loadLocalEnv } from './env.mjs';

const { Client } = pg;

export async function main() {
  const migrationPath = process.argv[2];

  if (!migrationPath) {
    throw new Error('Usage: npm run supabase:apply-migration -- supabase/migrations/0009_opening_trees.sql');
  }

  if (!migrationPath.startsWith('supabase/migrations/') || !migrationPath.endsWith('.sql')) {
    throw new Error('Migration path must point to a SQL file in supabase/migrations/.');
  }

  const sql = readFileSync(migrationPath, 'utf8');
  const client = new Client(getPgConfig(loadLocalEnv()));

  await client.connect();

  try {
    await client.query(sql);
  } finally {
    await client.end();
  }

  console.log(`applied migration: ${migrationPath}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
