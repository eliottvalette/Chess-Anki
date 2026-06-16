import { readFileSync } from 'node:fs';

export function loadLocalEnv() {
  const env = { ...process.env };

  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separator = trimmed.indexOf('=');

      if (separator === -1) {
        continue;
      }

      const key = trimmed.slice(0, separator);
      const value = unquoteEnvValue(trimmed.slice(separator + 1));
      env[key] = value;
    }
  } catch {
    // Fall back to process.env for CI.
  }

  return env;
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

export function requireEnv(env, key) {
  const value = env[key]?.trim();

  if (!value) {
    throw new Error(`Missing ${key}. Add it to .env.local or the shell environment.`);
  }

  return value;
}

export function requireAdminKey(env) {
  const value =
    env.SUPABASE_ADMIN_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim() || env.SUPABASE_SECRET_KEY?.trim();

  if (!value) {
    throw new Error(
      'Missing SUPABASE_ADMIN_KEY. Add a project key with write access to .env.local or the shell environment.',
    );
  }

  return value;
}
