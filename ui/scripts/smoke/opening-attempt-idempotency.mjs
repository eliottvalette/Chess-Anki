import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import pg from 'pg';

import { loadLocalEnv } from '../supabase/env.mjs';
import { getPgConfig } from '../supabase/migrate.mjs';

const { Client } = pg;
const client = new Client({ ...getPgConfig(loadLocalEnv()), connectionTimeoutMillis: 10_000 });

await client.connect();

try {
  await client.query('begin');

  const sample = await client.query(`
    select profile.id as profile_id, node.id as node_id
    from public.training_profiles as profile
    cross join lateral (select id from public.opening_nodes order by id limit 1) as node
    order by profile.id
    limit 1
  `);
  const target = sample.rows[0];
  assert.ok(target, 'A training profile and opening node are required for the smoke test.');

  const before = await client.query(
    `select seen_count from public.opening_drill_progress where profile_id = $1 and node_id = $2`,
    [target.profile_id, target.node_id],
  );
  const seenBefore = Number(before.rows[0]?.seen_count ?? 0);
  const attemptId = randomUUID();
  const args = [target.profile_id, target.node_id, true, attemptId];
  const first = await client.query(
    `select * from public.record_opening_drill_attempt_atomic($1::uuid, $2::text, $3::boolean, $4::uuid)`,
    args,
  );
  const duplicate = await client.query(
    `select * from public.record_opening_drill_attempt_atomic($1::uuid, $2::text, $3::boolean, $4::uuid)`,
    args,
  );
  const after = await client.query(
    `select seen_count from public.opening_drill_progress where profile_id = $1 and node_id = $2`,
    [target.profile_id, target.node_id],
  );

  assert.equal(first.rows[0]?.applied, true);
  assert.equal(duplicate.rows[0]?.applied, false);
  assert.equal(Number(after.rows[0]?.seen_count), seenBefore + 1);

  console.log(
    JSON.stringify({
      appliedFirst: first.rows[0].applied,
      appliedDuplicate: duplicate.rows[0].applied,
      seenDelta: Number(after.rows[0].seen_count) - seenBefore,
    }),
  );
} finally {
  await client.query('rollback').catch(() => undefined);
  await client.end();
}
