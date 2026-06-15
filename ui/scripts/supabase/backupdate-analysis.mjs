import { createClient } from '@supabase/supabase-js';
import { Chess } from 'chess.js';
import { fileURLToPath } from 'node:url';

import { fetchArchives, fetchRecentGames } from '../chesscom/api.mjs';
import { dedupeTrainingCards } from '../chesscom/deck-mistake-filter.mjs';
import { buildCardsForGame, buildLineRecord, scoreToCpForSide } from '../chesscom/build-recent-blitz-deck.mjs';
import {
  DEFAULT_ANALYZE_BASE_URL,
  analyzePositionsCached,
  analyzeSingleCached,
  analyzeTimelineForPgn,
  assertAnalyzeApi,
  buildCacheAnalysisPayload,
  buildPgnHash,
  buildStoredMovesFromSans,
  getDeterministicProfile,
} from '../analysis/deterministic-runner.mjs';
import {
  buildCardMoveReviewsFromAnalyses,
  buildTimelineAnalysesForMoves,
} from './card-move-reviews-lib.mjs';
import { loadLocalEnv, requireAdminKey, requireEnv } from './env.mjs';

const DEFAULT_COUNT = 50;
const DEFAULT_TIME_CLASS = 'blitz';
const DECK_ID = 'recent-blitz-trainer-v1';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export async function main() {
  const env = loadLocalEnv();
  const options = parseArgs(process.argv.slice(2), env);
  const profile = getDeterministicProfile(env);
  const supabase = createClient(requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL'), requireAdminKey(env), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const analysisCache = new Map();

  await assertAnalyzeApi(options.baseUrl, profile);

  const archives = await fetchArchives(options.username);
  const games = await fetchRecentGames({
    username: options.username,
    archives,
    count: options.count,
    timeClass: options.timeClass,
  });
  const ownerProfileId = await findTrainingProfileId(supabase, options.profile);
  const deckId = ownerProfileId ? `${DECK_ID}-${options.profile}` : DECK_ID;
  const accessibleDeckIds = await loadAccessibleDeckIds(supabase, ownerProfileId);
  const deck = {
    id: deckId,
    owner_profile_id: ownerProfileId,
    name: ownerProfileId ? `Recent Blitz Trainer · ${options.profile}` : 'Recent Blitz Trainer',
    description: `Personalized fix cards built from recent public ${options.timeClass} games for ${options.username}.`,
    version: profile.version,
    is_active: true,
  };
  const lines = [];
  const rawCards = [];
  const gameCacheRows = [];

  for (const [gameIndex, game] of games.entries()) {
    const line = buildLineRecord(game, options.username);
    const timeline = await analyzeTimelineForPgn({
      pgn: game.pgn,
      baseUrl: options.baseUrl,
      profile,
      cache: analysisCache,
    });
    const cards = await buildCardsForGame({
      game,
      line,
      username: options.username,
      analyzeBaseUrl: options.baseUrl,
      depth: profile.depth,
      movetimeMs: profile.movetimeMs,
      multipv: profile.multipv,
      thresholdCp: options.thresholdCp,
      acceptableLossCp: options.acceptableLossCp,
      maxPly: options.maxPly,
      gameIndex,
      totalGames: games.length,
    });

    lines.push({ ...line, deck_id: deckId });
    rawCards.push(...cards);
    gameCacheRows.push({
      cache_key: `chesscom:v${profile.version}:${game.url}`,
      game_link: game.url,
      pgn_hash: buildPgnHash(game.pgn),
      analysis_data: buildCacheAnalysisPayload({
        preMoveAnalyses: timeline.preMoveAnalyses,
        timelineAnalyses: timeline.timelineAnalyses,
      }),
      updated_at: new Date().toISOString(),
    });
  }

  const cards = await attachMoveReviews({
    cards: await applyVerifiedCardAnswers({
      cards: dedupeTrainingCards(rawCards).map(card => ({ ...card, deck_id: deckId })),
      baseUrl: options.baseUrl,
      profile,
      analysisCache,
    }),
    baseUrl: options.baseUrl,
    profile,
    analysisCache,
  });
  const generatedAnswerAudit = await auditCardAnswers({
    cards,
    baseUrl: options.baseUrl,
    profile,
    analysisCache,
  });
  const existing = await loadExistingDeck(supabase, deckId);
  const existingCards = await loadExistingCards(supabase, accessibleDeckIds);
  const existingAnswerAudit = await auditCardAnswers({
    cards: existingCards,
    baseUrl: options.baseUrl,
    profile,
    analysisCache,
  });
  const diff = diffDeck(existing.cards, cards);
  const summary = {
    mode: options.apply ? 'apply' : 'dry-run',
    username: options.username,
    profile: options.profile,
    deck_id: deckId,
    audited_deck_ids: accessibleDeckIds,
    analysis_profile: profile,
    games: games.length,
    unique_positions_analyzed: analysisCache.size,
    lines: lines.length,
    cards: cards.length,
    game_cache_rows: gameCacheRows.length,
    generated_answer_audit: generatedAnswerAudit,
    existing_answer_audit: existingAnswerAudit,
    diff,
  };

  if (!options.apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (generatedAnswerAudit.mismatch_count > 0 || generatedAnswerAudit.missing_best_count > 0) {
    throw new Error(`Refusing to apply: ${generatedAnswerAudit.mismatch_count} generated card answers do not match deterministic best move.`);
  }

  await upsertDeck(supabase, deck);
  await upsertRows(supabase, 'opening_lines', lines, 'id');
  await upsertRows(supabase, 'deck_cards', cards, 'id');
  await updateExistingCardAnswers(supabase, existingAnswerAudit.fixes);
  await upsertRows(supabase, 'game_analysis_cache', gameCacheRows, 'cache_key', { batchSize: 5 });

  console.log(JSON.stringify({ ...summary, applied: true }, null, 2));
}

async function auditCardAnswers({ cards, baseUrl, profile, analysisCache }) {
  const mismatches = [];
  const fixes = [];
  let missingBestCount = 0;

  for (const card of cards) {
    const verified = await resolveVerifiedCardAnswer({
      card,
      baseUrl,
      profile,
      analysisCache,
    });

    if (!verified) {
      missingBestCount += 1;
      continue;
    }

    if (
      verified.answer_uci !== card.answer_uci ||
      verified.answer_san !== card.answer_san ||
      verified.reference_eval_cp !== (card.reference_eval_cp ?? null)
    ) {
      mismatches.push({
        id: card.id,
        source_type: card.source_type ?? null,
        fen: card.fen,
        answer_uci: card.answer_uci,
        deterministic_best_uci: verified.answer_uci,
        answer_san: card.answer_san,
        deterministic_best_san: verified.answer_san,
        reference_eval_cp: card.reference_eval_cp ?? null,
        deterministic_reference_eval_cp: verified.reference_eval_cp,
      });
      fixes.push({
        id: card.id,
        answer_uci: verified.answer_uci,
        answer_san: verified.answer_san,
        reference_eval_cp: verified.reference_eval_cp,
      });
    }
  }

  return {
    checked: cards.length,
    mismatch_count: mismatches.length,
    missing_best_count: missingBestCount,
    mismatches: mismatches.slice(0, 30),
    fixes,
  };
}

async function applyVerifiedCardAnswers({ cards, baseUrl, profile, analysisCache }) {
  const verifiedCards = [];

  for (const card of cards) {
    const verified = await resolveVerifiedCardAnswer({
      card,
      baseUrl,
      profile,
      analysisCache,
    });

    verifiedCards.push(verified ? { ...card, ...verified } : card);
  }

  return verifiedCards;
}

async function resolveVerifiedCardAnswer({ card, baseUrl, profile, analysisCache }) {
  const rootAnalysis = await analyzeSingleCached(baseUrl, {
    position: {
      fen: card.fen,
      multipv: profile.multipv,
    },
    profile,
    cache: analysisCache,
  });
  const candidates = getRootCandidateMoves(rootAnalysis).slice(0, 3);

  if (candidates.length === 0) {
    return null;
  }

  const side = card.side === 'black' ? 'black' : 'white';
  const verified = [];

  for (const answerUci of candidates) {
    const chess = new Chess(card.fen);
    const move = chess.move({
      from: answerUci.slice(0, 2),
      to: answerUci.slice(2, 4),
      ...(answerUci[4] ? { promotion: answerUci[4] } : {}),
    });

    if (!move) {
      continue;
    }

    const postMoveAnalysis = await analyzeSingleCached(baseUrl, {
      position: {
        fen: chess.fen(),
        multipv: profile.multipv,
      },
      profile,
      cache: analysisCache,
    });
    const scoreCp = scoreToCpForSide(postMoveAnalysis.whitePerspective, side);

    verified.push({
      answer_uci: answerUci,
      answer_san: move.san,
      reference_eval_cp: scoreCp == null ? null : Math.round(scoreCp),
    });
  }

  if (verified.length === 0) {
    return null;
  }

  return verified.reduce((best, candidate) => {
    if (best.reference_eval_cp == null) {
      return candidate;
    }

    if (candidate.reference_eval_cp != null && candidate.reference_eval_cp > best.reference_eval_cp) {
      return candidate;
    }

    return best;
  }, verified[0]);
}

function getRootCandidateMoves(analysis) {
  const candidates = new Set();

  for (const line of analysis?.lines ?? []) {
    const move = line.bestMove ?? line.pv?.[0] ?? null;

    if (move) {
      candidates.add(move);
    }
  }

  if (analysis?.bestMove) {
    candidates.add(analysis.bestMove);
  }

  return [...candidates];
}

async function attachMoveReviews({ cards, baseUrl, profile, analysisCache }) {
  const withReviews = [];

  for (const card of cards) {
    const setupMoves = Array.isArray(card.setup_moves) ? card.setup_moves : [];

    if (!card.replay_from_start || setupMoves.length === 0) {
      withReviews.push({ ...card, move_reviews: [] });
      continue;
    }

    const moves = buildStoredMovesFromSans(setupMoves, card.initial_fen ?? null);
    const positions = moves.length > 0
      ? await import('../../lib/chess-analysis-client.ts').then(module => module.buildTimelineSequencePositions(moves, card.initial_fen ?? null))
      : [];
    const analyses = await analyzePositionsCached(baseUrl, {
      positions,
      profile,
      cache: analysisCache,
    });
    const { preMoveAnalyses, postMoveAnalyses } = buildTimelineAnalysesForMoves(moves, card.initial_fen ?? null, analyses);
    const moveReviews = buildCardMoveReviewsFromAnalyses(moves, preMoveAnalyses, postMoveAnalyses, card.initial_fen ?? null);

    withReviews.push({ ...card, move_reviews: moveReviews });
  }

  return withReviews;
}

function parseArgs(args, env) {
  const options = {
    username: (env.CHESSCOM_USERNAME || env.CHESSCOM_DECK_USERNAME || '').trim().toLowerCase(),
    profile: '',
    count: DEFAULT_COUNT,
    timeClass: DEFAULT_TIME_CLASS,
    baseUrl: env.ANALYZE_BASE_URL?.trim() || DEFAULT_ANALYZE_BASE_URL,
    thresholdCp: Number(env.CHESSCOM_DECK_THRESHOLD_CP || 90),
    acceptableLossCp: Number(env.CHESSCOM_DECK_ACCEPTABLE_LOSS_CP || 35),
    maxPly: Number(env.CHESSCOM_DECK_MAX_PLY || 16),
    apply: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (arg === '--username' && value) {
      options.username = value.trim().toLowerCase();
      index += 1;
      continue;
    }

    if (arg === '--profile' && value) {
      options.profile = value.trim().toLowerCase();
      index += 1;
      continue;
    }

    if (arg === '--count' && value) {
      options.count = Math.max(1, Number.parseInt(value, 10) || DEFAULT_COUNT);
      index += 1;
      continue;
    }

    if (arg === '--time-class' && value) {
      options.timeClass = value.trim().toLowerCase();
      index += 1;
      continue;
    }

    if (arg === '--base-url' && value) {
      options.baseUrl = value.trim();
      index += 1;
      continue;
    }

    if (arg === '--apply') {
      options.apply = true;
    }
  }

  options.profile = (options.profile || env.CHESSCOM_DECK_PROFILE || options.username).trim().toLowerCase();

  if (!options.username) {
    throw new Error('Missing Chess.com username. Pass --username or set CHESSCOM_USERNAME.');
  }

  return options;
}

async function loadExistingDeck(supabase, deckId) {
  const [{ data: cards, error: cardsError }, { data: lines, error: linesError }] = await Promise.all([
    supabase
      .from('deck_cards')
      .select('id,deck_id,source_type,side,fen,answer_uci,answer_san,reference_eval_cp,score_swing_cp,move_reviews')
      .eq('deck_id', deckId),
    supabase.from('opening_lines').select('id').eq('deck_id', deckId),
  ]);

  if (cardsError) {
    throw new Error(`deck_cards: ${cardsError.message}`);
  }

  if (linesError) {
    throw new Error(`opening_lines: ${linesError.message}`);
  }

  return {
    cards: cards ?? [],
    lines: lines ?? [],
  };
}

async function loadAccessibleDeckIds(supabase, profileId) {
  const query = supabase.from('decks').select('id').eq('is_active', true).order('created_at', { ascending: false });
  const { data, error } = profileId
    ? await query.or(`owner_profile_id.eq.${profileId},owner_profile_id.is.null`)
    : await query.is('owner_profile_id', null);

  if (error) {
    throw new Error(`decks: ${error.message}`);
  }

  return (data ?? []).map(deck => String(deck.id));
}

async function loadExistingCards(supabase, deckIds) {
  if (deckIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('deck_cards')
    .select('id,deck_id,source_type,side,fen,answer_uci,answer_san,reference_eval_cp,score_swing_cp,move_reviews')
    .in('deck_id', deckIds);

  if (error) {
    throw new Error(`deck_cards: ${error.message}`);
  }

  return data ?? [];
}

async function updateExistingCardAnswers(supabase, fixes) {
  for (const fix of fixes) {
    const { error } = await supabase
      .from('deck_cards')
      .update({
        answer_uci: fix.answer_uci,
        answer_san: fix.answer_san,
        reference_eval_cp: fix.reference_eval_cp,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fix.id);

    if (error) {
      throw new Error(`deck_cards answer update ${fix.id}: ${error.message}`);
    }
  }
}

function diffDeck(existingCards, nextCards) {
  const existingById = new Map(existingCards.map(card => [card.id, card]));
  const nextById = new Map(nextCards.map(card => [card.id, card]));
  const added = nextCards.filter(card => !existingById.has(card.id)).map(card => card.id);
  const staleRecentGame = existingCards
    .filter(card => card.source_type === 'recent_game')
    .filter(card => !nextById.has(card.id))
    .map(card => card.id);
  const changed = [];

  for (const card of nextCards) {
    const before = existingById.get(card.id);

    if (!before) {
      continue;
    }

    const changes = {};

    for (const key of ['answer_uci', 'answer_san', 'reference_eval_cp', 'score_swing_cp']) {
      if (before[key] !== card[key]) {
        changes[key] = { before: before[key] ?? null, after: card[key] ?? null };
      }
    }

    const beforeReviews = JSON.stringify(before.move_reviews ?? []);
    const afterReviews = JSON.stringify(card.move_reviews ?? []);

    if (beforeReviews !== afterReviews) {
      changes.move_reviews = {
        before_count: Array.isArray(before.move_reviews) ? before.move_reviews.length : 0,
        after_count: Array.isArray(card.move_reviews) ? card.move_reviews.length : 0,
      };
    }

    if (Object.keys(changes).length > 0) {
      changed.push({ id: card.id, changes });
    }
  }

  return {
    added_count: added.length,
    removed_count: 0,
    stale_recent_game_count: staleRecentGame.length,
    changed_count: changed.length,
    unchanged_count: nextCards.length - added.length - changed.length,
    added: added.slice(0, 20),
    removed: [],
    stale_recent_game: staleRecentGame.slice(0, 20),
    changed: changed.slice(0, 20),
  };
}

async function upsertDeck(supabase, deck) {
  const { error } = await supabase.from('decks').upsert(deck, { onConflict: 'id' });

  if (error) {
    throw new Error(`decks: ${error.message}`);
  }
}

async function upsertRows(supabase, table, rows, onConflict, { batchSize = 100 } = {}) {
  if (rows.length === 0) {
    return;
  }

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });

    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }
  }
}

async function findTrainingProfileId(supabase, username) {
  const { data, error } = await supabase
    .from('training_profiles')
    .select('id')
    .eq('username', username.toLowerCase())
    .maybeSingle();

  if (error) {
    throw new Error(`training_profiles: ${error.message}`);
  }

  return data?.id ?? null;
}
