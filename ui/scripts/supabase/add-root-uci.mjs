import pg from 'pg';
import { loadLocalEnv } from './env.mjs';
import { getPgConfig } from './migrate.mjs';

const { Client } = pg;

async function main() {
  const client = new Client(getPgConfig(loadLocalEnv()));
  await client.connect();
  try {
    await client.query(
      `alter table public.opening_trees add column if not exists root_uci text[] not null default '{}';`,
    );
    console.log('Added root_uci column successfully');
  } finally {
    await client.end();
  }
}
main().catch(console.error);
