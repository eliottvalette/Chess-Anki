import { fileURLToPath } from 'node:url';
import {
  analyzeSingleCached,
  analyzeTimelineForPgn,
  assertAnalyzeApi,
  DEFAULT_ANALYZE_BASE_URL,
  getDeterministicProfile,
} from '../analysis/deterministic-runner.mjs';
import { extractTag, fetchArchives, fetchRecentGames } from './api.mjs';
import { buildCardsForGame, buildLineRecord } from './build-recent-blitz-deck.mjs';

const DEFAULT_COUNT = 50;
const DEFAULT_TIME_CLASS = 'blitz';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  const profile = getDeterministicProfile();
  const analysisCache = new Map();

  await assertAnalyzeApi(options.baseUrl, profile);

  const archives = await fetchArchives(options.username);
  const games = await fetchRecentGames({
    username: options.username,
    archives,
    count: options.count,
    timeClass: options.timeClass,
  });

  const gameReports = [];
  const cardReports = [];
  const answerMismatches = [];

  for (const [gameIndex, game] of games.entries()) {
    const timeline = await analyzeTimelineForPgn({
      pgn: game.pgn,
      baseUrl: options.baseUrl,
      profile,
      cache: analysisCache,
    });
    const line = buildLineRecord(game, options.username);
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
    const shallowAnalyses = timeline.analyses.filter((analysis) => Number(analysis?.depth ?? 0) < profile.depth);
    const boundedScores = timeline.analyses.filter(
      (analysis) => analysis?.whitePerspective?.bound && analysis.whitePerspective.bound !== 'exact',
    );
    const changedLineCandidates = timeline.analyses.filter((analysis) => {
      const lines = analysis?.lines ?? [];
      const first = lines[0]?.whitePerspective?.value;
      const second = lines[1]?.whitePerspective?.value;

      return typeof first === 'number' && typeof second === 'number' && Math.abs(first - second) <= 15;
    });

    gameReports.push({
      url: game.url,
      date: extractTag(game.pgn, 'UTCDate'),
      result: extractTag(game.pgn, 'Result'),
      eco: extractTag(game.pgn, 'ECO'),
      plies: timeline.moves.length,
      positions: timeline.positions.length,
      cards: cards.length,
      shallow_analyses: shallowAnalyses.length,
      bounded_scores: boundedScores.length,
      close_top_lines: changedLineCandidates.length,
      review_counts: countReviewCategories(timeline.reviews),
    });
    cardReports.push(
      ...cards.map((card) => ({
        id: card.id,
        game_url: game.url,
        ply: card.ply,
        answer_uci: card.answer_uci,
        answer_san: card.answer_san,
        reference_eval_cp: card.reference_eval_cp,
        score_swing_cp: card.score_swing_cp,
        context: card.context,
      })),
    );

    for (const card of cards) {
      const analysis = await analyzeSingleCached(options.baseUrl, {
        position: {
          fen: card.fen,
          multipv: profile.multipv,
        },
        profile,
        cache: analysisCache,
      });

      if (analysis?.bestMove && analysis.bestMove !== card.answer_uci) {
        answerMismatches.push({
          id: card.id,
          game_url: game.url,
          ply: card.ply,
          answer_uci: card.answer_uci,
          deterministic_best_uci: analysis.bestMove,
          answer_san: card.answer_san,
        });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        username: options.username,
        count: games.length,
        time_class: options.timeClass,
        profile,
        unique_positions_analyzed: analysisCache.size,
        totals: {
          plies: gameReports.reduce((sum, game) => sum + game.plies, 0),
          positions: gameReports.reduce((sum, game) => sum + game.positions, 0),
          cards: cardReports.length,
          shallow_analyses: gameReports.reduce((sum, game) => sum + game.shallow_analyses, 0),
          bounded_scores: gameReports.reduce((sum, game) => sum + game.bounded_scores, 0),
          close_top_lines: gameReports.reduce((sum, game) => sum + game.close_top_lines, 0),
          answer_mismatches: answerMismatches.length,
        },
        answer_audit: {
          checked: cardReports.length,
          mismatch_count: answerMismatches.length,
          mismatches: answerMismatches.slice(0, 30),
        },
        games: gameReports,
        cards: cardReports,
      },
      null,
      2,
    ),
  );
}

function parseArgs(args) {
  const options = {
    username: '',
    count: DEFAULT_COUNT,
    timeClass: DEFAULT_TIME_CLASS,
    baseUrl: process.env.ANALYZE_BASE_URL?.trim() || DEFAULT_ANALYZE_BASE_URL,
    thresholdCp: Number(process.env.CHESSCOM_DECK_THRESHOLD_CP || 90),
    acceptableLossCp: Number(process.env.CHESSCOM_DECK_ACCEPTABLE_LOSS_CP || 35),
    maxPly: Number(process.env.CHESSCOM_DECK_MAX_PLY || 16),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (arg === '--username' && value) {
      options.username = value.trim().toLowerCase();
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
    }
  }

  if (!options.username) {
    throw new Error('Missing --username <chesscom-username>.');
  }

  return options;
}

function countReviewCategories(reviews) {
  const counts = {};

  for (const review of reviews) {
    if (!review.category) {
      continue;
    }

    counts[review.category] = (counts[review.category] ?? 0) + 1;
  }

  return counts;
}
