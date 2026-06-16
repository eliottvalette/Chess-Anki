import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCanonicalResetSql, getPgConfig, readMigrationFiles } from './migrate.mjs';

const baseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://rdehwurjccisorhyqonc.supabase.co',
};

test('getPgConfig prefers SUPABASE_DB_PASSWORD over a stale connection string', () => {
  const config = getPgConfig({
    ...baseEnv,
    SUPABASE_DB_PASSWORD: 'db-password',
    SUPABASE_DB_URL: 'postgresql://postgres:wrong@localhost:5432/postgres',
  });

  assert.deepEqual(config, {
    host: 'aws-0-eu-west-1.pooler.supabase.com',
    port: 6543,
    user: 'postgres.rdehwurjccisorhyqonc',
    database: 'postgres',
    password: 'db-password',
    ssl: {
      rejectUnauthorized: false,
    },
  });
});

test('getPgConfig rewrites pooler URIs to the expected user format', () => {
  const config = getPgConfig({
    ...baseEnv,
    SUPABASE_DB_URL: 'postgresql://postgres:test@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
  });

  assert.equal(
    config.connectionString,
    'postgresql://postgres.rdehwurjccisorhyqonc:test@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
  );
});

test('getPgConfig leaves non-pooler URIs untouched', () => {
  const config = getPgConfig({
    ...baseEnv,
    SUPABASE_DB_URL: 'postgresql://postgres:test@db.rdehwurjccisorhyqonc.supabase.co:5432/postgres',
  });

  assert.equal(config.connectionString, 'postgresql://postgres:test@db.rdehwurjccisorhyqonc.supabase.co:5432/postgres');
});

test('buildCanonicalResetSql drops deck tables before applying the schema', () => {
  const sql = buildCanonicalResetSql('create table public.decks ();');

  assert.match(sql, /drop table if exists public\.user_card_attempts cascade;/);
  assert.match(sql, /drop table if exists public\.decks cascade;/);
  assert.match(sql, /create table public\.decks \(\);/);
});

test('readMigrationFiles loads SQL migrations in lexical order', () => {
  const migrations = readMigrationFiles('supabase/migrations');

  assert.ok(migrations.length >= 2);
  assert.equal(migrations[0].path, 'supabase/migrations/0001_learning_decks.sql');
  assert.equal(migrations[1].path, 'supabase/migrations/0002_review_decks.sql');
});
