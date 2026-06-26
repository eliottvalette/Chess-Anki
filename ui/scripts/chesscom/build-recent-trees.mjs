import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { Chess } from 'chess.js';
import { inferOutcome } from '../../lib/chesscom.ts';
import { loadLocalEnv, requireAdminKey, requireEnv } from '../supabase/env.mjs';
import { extractTag, fetchArchives, fetchRecentGames } from './api.mjs';
import { buildAndUpsertOpeningTrees } from './build-opening-trees.mjs';

const DEFAULT_COUNT = 100;
const DEFAULT_TIME_CLASS = 'blitz';

function logProgress(message) {
  console.error(`[build-recent-trees ${new Date().toISOString()}] ${message}`);
}

function parseArgs(argv) {
  const options = {
    username: null,
    profile: null,
    count: DEFAULT_COUNT,
    timeClass: DEFAULT_TIME_CLASS,
  };

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === '--username' && value) {
      options.username = value.trim().toLowerCase();
      index += 2;
      continue;
    }

    if (arg === '--count' && value) {
      options.count = Math.max(1, Number.parseInt(value, 10) || DEFAULT_COUNT);
      index += 2;
      continue;
    }

    if (arg === '--time-class' && value) {
      options.timeClass = value.trim().toLowerCase();
      index += 2;
      continue;
    }

    index += 1;
  }

  return options;
}

export function loadVerboseMoves(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return chess.history({ verbose: true });
}

function extractSanMoves(pgn) {
  return loadVerboseMoves(pgn).map((move) => move.san);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = loadLocalEnv();
  const username = (options.username || env.CHESSCOM_USERNAME || env.CHESSCOM_DECK_USERNAME || '').trim().toLowerCase();

  if (!username) {
    throw new Error(
      'Missing Chess.com username. Pass --username <chesscom-username> or set CHESSCOM_USERNAME in .env.local.',
    );
  }

  const supabaseUrl = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL');
  const adminKey = requireAdminKey(env);
  const analyzeBaseUrl = env.ANALYZE_BASE_URL?.trim() || 'http://localhost:3000';
  const lichessApiToken = requireEnv(env, 'LICHESS_API_TOKEN');

  const supabase = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profiles, error: profileError } = await supabase
    .from('training_profiles')
    .select('id,username')
    .limit(1);
  if (profileError) throw new Error(profileError.message);
  const profile = profiles?.[0];
  if (!profile) throw new Error('No training profile found.');

  logProgress(`starting build for username=${username} count=${options.count} time_class=${options.timeClass}`);

  logProgress(`fetching Chess.com archives for ${username}`);
  const archives = await fetchArchives(username);
  logProgress(`fetching ${options.count} recent ${options.timeClass} games`);
  const games = await fetchRecentGames({
    username,
    archives,
    count: options.count,
    timeClass: options.timeClass,
  });

  logProgress(`fetched ${games.length} games`);

  const openingLines = games.map((game, index) => {
    const playerColor = game.white?.username?.toLowerCase() === username.toLowerCase() ? 'white' : 'black';
    const player = playerColor === 'white' ? game.white : game.black;
    const moves = extractSanMoves(game.pgn);
    return {
      id: `recent-game-${game.uuid || index}`,
      name: `Recent Game`,
      side: playerColor, // This maps to trainSide
      moves,
      outcome: inferOutcome(player?.result ?? null, extractTag(game.pgn, 'Result')),
    };
  });

  await buildAndUpsertOpeningTrees({
    supabase,
    openingLines,
    cards: [], // No cards, strictly game lines
    ownerProfileId: profile.id,
    analyzeBaseUrl,
    lichessApiToken,
    logProgress,
  });

  logProgress('done building opening trees from recent games');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
