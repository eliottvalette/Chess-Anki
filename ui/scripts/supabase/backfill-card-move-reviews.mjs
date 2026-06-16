import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { DETERMINISTIC_ANALYSIS_PROFILE } from '../../lib/analysis-profile.ts';
import { buildTimelineSequencePositions } from '../../lib/chess-analysis-client.ts';
import {
  buildCardMoveReviewsFromAnalyses,
  buildDeckCardReplayHistory,
  buildTimelineAnalysesForMoves,
  parseCardMoveReviews,
} from './card-move-reviews-lib.mjs';
import { loadLocalEnv, requireAdminKey, requireEnv } from './env.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_DEPTH = DETERMINISTIC_ANALYSIS_PROFILE.depth;
const DEFAULT_BATCH_SIZE = 4;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = loadLocalEnv();
  const supabaseUrl = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireAdminKey(env);
  const analyzeBaseUrl = env.ANALYZE_BASE_URL?.trim() || 'http://localhost:3000';
  const depth = DEFAULT_DEPTH;
  const movetimeMs = DETERMINISTIC_ANALYSIS_PROFILE.movetimeMs;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  logProgress(`checking analyze API at ${analyzeBaseUrl}`);
  await assertAnalyzeApi(analyzeBaseUrl);

  const { data: lines, error: linesError } = await supabase
    .from('opening_lines')
    .select('id,deck_id,name,eco,side,moves');

  if (linesError) {
    throw new Error(linesError.message);
  }

  const linesByDeckId = new Map();

  for (const line of lines ?? []) {
    const deckId = String(line.deck_id);
    const deckLines = linesByDeckId.get(deckId) ?? [];
    deckLines.push({
      id: String(line.id),
      name: String(line.name),
      eco: String(line.eco),
      side: line.side === 'black' ? 'black' : 'white',
      moves: Array.isArray(line.moves) ? line.moves.map((move) => String(move)) : [],
    });
    linesByDeckId.set(deckId, deckLines);
  }

  let query = supabase
    .from('deck_cards')
    .select(
      'id,deck_id,kind,line_id,line_name,eco,side,ply,fen,answer_uci,answer_san,prompt,context,source_type,validation_mode,reference_eval_cp,max_eval_loss_cp,opponent_move_uci,opponent_move_san,score_swing_cp,replay_from_start,initial_fen,setup_moves,move_reviews',
    )
    .order('id');

  if (options.deckId) {
    query = query.eq('deck_id', options.deckId);
  }

  const { data: cards, error: cardsError } = await query;

  if (cardsError) {
    throw new Error(cardsError.message);
  }

  const pendingCards = (cards ?? []).filter((card) => {
    if (options.force) {
      return true;
    }

    return parseCardMoveReviews(card.move_reviews).length === 0;
  });

  logProgress(`loaded ${cards?.length ?? 0} deck cards, ${pendingCards.length} to backfill`);

  if ((cards?.length ?? 0) === 0) {
    logProgress('no deck_cards in database — run supabase:seed and/or regenerate your decks before backfill');
    return;
  }

  if (pendingCards.length === 0) {
    logProgress('every card already has move_reviews — use --force to recompute');
    return;
  }

  for (const [index, row] of pendingCards.entries()) {
    const card = mapDeckCardRow(row);
    const openingLines = linesByDeckId.get(card.deckId) ?? [];
    const { initialFen, moves } = buildDeckCardReplayHistory(card, openingLines);

    if (moves.length === 0) {
      logProgress(`[${index + 1}/${pendingCards.length}] ${card.id}: skipped (no replay moves)`);
      continue;
    }

    logProgress(`[${index + 1}/${pendingCards.length}] ${card.id}: analyzing ${moves.length} plies`);
    const positions = buildTimelineSequencePositions(moves, initialFen);
    const analyses = [];

    for (let start = 0; start < positions.length; start += DEFAULT_BATCH_SIZE) {
      const batch = positions.slice(start, start + DEFAULT_BATCH_SIZE);
      const batchAnalyses = await analyzePositions(analyzeBaseUrl, {
        positions: batch.map((position) => ({
          fen: position.fen,
          initialFen: position.initialFen,
          moves: position.moves,
          depth,
          movetimeMs,
          multipv: 3,
        })),
        depth,
        movetimeMs,
      });
      analyses.push(...batchAnalyses);
    }

    if (analyses.length !== positions.length) {
      throw new Error(`Missing analyses for card ${card.id}.`);
    }

    const { preMoveAnalyses, postMoveAnalyses } = buildTimelineAnalysesForMoves(moves, initialFen, analyses);
    const moveReviews = buildCardMoveReviewsFromAnalyses(moves, preMoveAnalyses, postMoveAnalyses, initialFen);
    const { error } = await supabase.from('deck_cards').update({ move_reviews: moveReviews }).eq('id', card.id);

    if (error) {
      throw new Error(`${card.id}: ${error.message}`);
    }

    logProgress(`[${index + 1}/${pendingCards.length}] ${card.id}: saved ${moveReviews.length} move reviews`);
  }

  logProgress('done');
}

function mapDeckCardRow(row) {
  return {
    id: String(row.id),
    deckId: String(row.deck_id),
    kind: row.kind === 'repertoire_choice' ? 'repertoire_choice' : 'punish_mistake',
    lineId: row.line_id ? String(row.line_id) : '',
    lineName: String(row.line_name),
    eco: String(row.eco),
    side: row.side === 'black' ? 'black' : 'white',
    ply: Number(row.ply),
    fen: String(row.fen),
    answerUci: String(row.answer_uci),
    answerSan: String(row.answer_san),
    prompt: String(row.prompt),
    context: String(row.context),
    sourceType: row.source_type === 'recent_game' || row.source_type === 'review' ? row.source_type : 'opening_seed',
    validationMode: row.validation_mode === 'within_eval_loss' ? 'within_eval_loss' : 'strict_best',
    referenceEvalCp: typeof row.reference_eval_cp === 'number' ? row.reference_eval_cp : undefined,
    maxEvalLossCp: typeof row.max_eval_loss_cp === 'number' ? row.max_eval_loss_cp : undefined,
    opponentMoveUci: row.opponent_move_uci ? String(row.opponent_move_uci) : undefined,
    opponentMoveSan: row.opponent_move_san ? String(row.opponent_move_san) : undefined,
    scoreSwingCp: typeof row.score_swing_cp === 'number' ? row.score_swing_cp : undefined,
    replayFromStart: Boolean(row.replay_from_start),
    initialFen: row.initial_fen ? String(row.initial_fen) : null,
    setupMoves: Array.isArray(row.setup_moves) ? row.setup_moves.map((move) => String(move)) : [],
    moveReviews: parseCardMoveReviews(row.move_reviews),
  };
}

function parseArgs(argv) {
  const options = {
    deckId: '',
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--deck-id') {
      options.deckId = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }

    if (token === '--force') {
      options.force = true;
    }
  }

  return options;
}

function logProgress(message) {
  console.error(`[card-reviews ${new Date().toISOString()}] ${message}`);
}

async function assertAnalyzeApi(baseUrl) {
  const response = await analyzePosition(baseUrl, {
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    depth: 1,
    movetimeMs: 10,
    multipv: 1,
  });

  if (!response?.bestMove) {
    throw new Error(`Analyze API is not ready at ${baseUrl}.`);
  }
}

async function analyzePosition(baseUrl, payload) {
  const response = await postAnalyzeRequest(baseUrl, '/api/analyze-position', payload);
  return JSON.parse(response);
}

async function analyzePositions(baseUrl, payload) {
  const response = await postAnalyzeRequest(baseUrl, '/api/analyze-game', payload);
  const parsed = JSON.parse(response);
  return Array.isArray(parsed.analyses) ? parsed.analyses : [];
}

async function postAnalyzeRequest(baseUrl, path, payload) {
  try {
    const { stdout } = await execFileAsync('curl', [
      '-sS',
      '-X',
      'POST',
      `${baseUrl}${path}`,
      '-H',
      'content-type: application/json',
      '--data-binary',
      JSON.stringify(payload),
    ]);

    return stdout;
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    throw new Error(`Analyze API is unreachable at ${baseUrl}.${detail}`);
  }
}
