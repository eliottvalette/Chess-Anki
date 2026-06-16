import { createClient } from '@supabase/supabase-js';

import { loadLocalEnv, requireEnv } from './env.mjs';

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const env = loadLocalEnv();
  const supabaseUrl = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL');
  const publishableKey = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  const adminKey =
    env.SUPABASE_ADMIN_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim() || env.SUPABASE_SECRET_KEY?.trim();

  const publicClient = createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  await checkAuthSettings(supabaseUrl, publishableKey);
  await checkPublicRead(publicClient);

  if (adminKey) {
    await checkAdminRead(supabaseUrl, adminKey);
  } else {
    console.log('Skipping admin smoke: SUPABASE_ADMIN_KEY is not set.');
  }
}

async function checkAuthSettings(supabaseUrl, publishableKey) {
  const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${publishableKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`auth settings failed: ${response.status}`);
  }

  console.log('auth settings: ok');
}

async function checkPublicRead(publicClient) {
  const { data, error } = await publicClient.from('decks').select('id,name,version,is_active').limit(5);

  if (error) {
    throw new Error(
      `public deck read failed. Did you apply supabase/migrations/0001_learning_decks.sql? ${error.message}`,
    );
  }

  console.log(JSON.stringify({ public_decks_read: data.length }, null, 2));
}

async function checkAdminRead(supabaseUrl, key) {
  const adminClient = createClient(supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const { count, error } = await adminClient.from('opening_lines').select('id', { count: 'exact', head: true });

  if (error) {
    throw new Error(`admin opening_lines read failed: ${error.message}`);
  }

  console.log(JSON.stringify({ admin_opening_lines_count: count ?? 0 }, null, 2));
}
