import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadLocalEnv } from './supabase/env.mjs';

const { Client } = pg;

async function backup() {
  const env = loadLocalEnv();
  const dbUrl = env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('SUPABASE_DB_URL is missing in .env.local');
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  console.log('Fetching tables...');
  const result = await client.query(`
    SELECT tablename FROM pg_catalog.pg_tables
    WHERE schemaname = 'public';
  `);

  const tables = result.rows.map((row) => row.tablename);
  const dump = {};

  for (const table of tables) {
    console.log(`Dumping table: ${table}...`);
    const data = await client.query(`SELECT * FROM "public"."${table}"`);
    dump[table] = data.rows;
  }

  await client.end();

  await fs.mkdir('.backup', { recursive: true });
  await fs.writeFile('.backup/supabase-backup.json', JSON.stringify(dump, null, 2));
  console.log('Database backup successfully saved to .backup/supabase-backup.json');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  backup().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
