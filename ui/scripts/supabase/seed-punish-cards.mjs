import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { Chess } from 'chess.js';

import { DETERMINISTIC_ANALYSIS_PROFILE } from '../../lib/analysis-profile.ts';
import { loadLocalEnv, requireAdminKey, requireEnv } from './env.mjs';

const OPENING_REPERTOIRE = [
  {
    id: 'italian-main',
    name: 'Italian Game',
    eco: 'C50',
    side: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4'],
  },
  {
    id: 'ruy-lopez',
    name: 'Ruy Lopez',
    eco: 'C60',
    side: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'],
  },
  {
    id: 'queens-gambit',
    name: "Queen's Gambit Declined",
    eco: 'D30',
    side: 'white',
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3'],
  },
  {
    id: 'london',
    name: 'London System',
    eco: 'D02',
    side: 'white',
    moves: ['d4', 'Nf6', 'Bf4', 'd5', 'e3', 'e6', 'Nf3', 'c5', 'c3'],
  },
  {
    id: 'sicilian-najdorf',
    name: 'Sicilian Najdorf',
    eco: 'B90',
    side: 'black',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
  },
  {
    id: 'french-advance',
    name: 'French Advance',
    eco: 'C02',
    side: 'black',
    moves: ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3'],
  },
  {
    id: 'caro-kann',
    name: 'Caro-Kann Classical',
    eco: 'B18',
    side: 'black',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3'],
  },
  {
    id: 'kings-indian',
    name: "King's Indian Defense",
    eco: 'E60',
    side: 'black',
    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O'],
  },
];

const DECK_ID = 'opening-punishments-v1';
const DEFAULT_PUNISH_THRESHOLD_CP = 30;
const DEFAULT_ACCEPTABLE_LOSS_CP = 35;
const DEFAULT_PUNISH_DEPTH = DETERMINISTIC_ANALYSIS_PROFILE.depth;
const DEFAULT_PUNISH_MULTIPV = 3;

export async function main() {
  const env = loadLocalEnv();
  const supabaseUrl = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireAdminKey(env);
  const analyzeUrl = env.ANALYZE_BASE_URL?.trim() || 'http://localhost:3000';
  const thresholdCp = Number(env.PUNISH_THRESHOLD_CP || DEFAULT_PUNISH_THRESHOLD_CP);
  const acceptableLossCp = Number(env.PUNISH_ACCEPTABLE_LOSS_CP || DEFAULT_ACCEPTABLE_LOSS_CP);
  const depth = DEFAULT_PUNISH_DEPTH;
  const movetimeMs = DETERMINISTIC_ANALYSIS_PROFILE.movetimeMs;
  const multipv = DEFAULT_PUNISH_MULTIPV;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  await assertAnalyzeApi(analyzeUrl);

  const candidates = buildTrainingCandidates();
  const cards = [];

  for (const candidate of candidates) {
    const baseAnalysis = await analyzePosition(analyzeUrl, {
      fen: candidate.fen,
      depth,
      movetimeMs,
      multipv,
    });
    const baseScore = scoreToCpForSide(baseAnalysis.whitePerspective, candidate.side);

    if (baseScore == null) {
      continue;
    }

    for (const line of baseAnalysis.lines.slice(0, multipv)) {
      if (!line.bestMove) {
        continue;
      }

      const reply = moveFromFen(candidate.fen, line.bestMove);

      if (!reply) {
        continue;
      }

      const fenAfterReply = reply.afterFen;
      const afterAnalysis = await analyzePosition(analyzeUrl, {
        fen: fenAfterReply,
        depth,
        movetimeMs,
        multipv: 1,
      });

      if (!afterAnalysis.bestMove) {
        continue;
      }

      const afterScore = scoreToCpForSide(afterAnalysis.whitePerspective, candidate.side);

      if (afterScore == null) {
        continue;
      }

      const scoreSwingCp = afterScore - baseScore;

      if (scoreSwingCp < thresholdCp) {
        continue;
      }

      const answer = moveFromFen(fenAfterReply, afterAnalysis.bestMove);

      if (!answer) {
        continue;
      }

      cards.push({
        id: `${candidate.id}-${line.bestMove}-${afterAnalysis.bestMove}`,
        deck_id: DECK_ID,
        line_id: candidate.lineId,
        kind: 'punish_mistake',
        line_name: candidate.lineName,
        eco: candidate.eco,
        side: candidate.side,
        ply: candidate.ply,
        fen: fenAfterReply,
        answer_uci: afterAnalysis.bestMove,
        answer_san: answer.san,
        prompt: `Opponent played ${reply.san}; punish it`,
        context: candidate.context,
        source_type: 'opening_seed',
        validation_mode: 'strict_best',
        reference_eval_cp: Math.round(afterScore),
        max_eval_loss_cp: 0,
        opponent_move_uci: line.bestMove,
        opponent_move_san: reply.san,
        score_swing_cp: Math.round(scoreSwingCp),
      });
    }
  }

  if (cards.length === 0) {
    console.log(
      JSON.stringify(
        {
          candidate_positions: candidates.length,
          generated_cards: 0,
          upserted_cards: 0,
          threshold_cp: thresholdCp,
          acceptable_loss_cp: acceptableLossCp,
          multipv,
          depth,
          movetime_ms: movetimeMs,
        },
        null,
        2,
      ),
    );
    return;
  }

  const { error } = await supabase.from('deck_cards').upsert(cards, { onConflict: 'id' });

  if (error) {
    throw new Error(`deck_cards: ${error.message}`);
  }

  console.log(
    JSON.stringify(
      {
        candidate_positions: candidates.length,
        generated_cards: cards.length,
        upserted_cards: cards.length,
        threshold_cp: thresholdCp,
        acceptable_loss_cp: acceptableLossCp,
        multipv,
        depth,
        movetime_ms: movetimeMs,
      },
      null,
      2,
    ),
  );
}

export function buildTrainingCandidates() {
  const candidates = [];

  for (const line of OPENING_REPERTOIRE) {
    const chess = new Chess();
    const playedSan = [];

    for (const [index, san] of line.moves.entries()) {
      const sideToMove = chess.turn() === 'w' ? 'white' : 'black';
      const fen = chess.fen();

      if (sideToMove !== line.side) {
        candidates.push({
          id: `${line.id}-candidate-${index + 1}`,
          lineId: line.id,
          lineName: line.name,
          eco: line.eco,
          side: line.side,
          ply: index + 1,
          fen,
          context: playedSan.length > 0 ? playedSan.join(' ') : 'Starting position',
        });
      }

      const move = chess.move(san);

      if (!move) {
        break;
      }

      playedSan.push(move.san);
    }
  }

  return candidates;
}

export async function assertAnalyzeApi(baseUrl) {
  const response = await postAnalyzeRequest(baseUrl, {
    fen: new Chess().fen(),
    depth: 1,
    movetimeMs: 10,
    multipv: 1,
  });

  if (!response.ok) {
    throw new Error(`Analyze API is not ready at ${baseUrl}: HTTP ${response.status}`);
  }
}

export async function analyzePosition(baseUrl, payload) {
  const response = await postAnalyzeRequest(baseUrl, payload);

  if (!response.ok) {
    throw new Error(`Analyze API failed: HTTP ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function postAnalyzeRequest(baseUrl, payload) {
  try {
    return await fetch(`${baseUrl}/api/analyze-position`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    throw new Error(`Analyze API is unreachable at ${baseUrl}. Start the local app or set ANALYZE_BASE_URL.${detail}`);
  }
}

export function scoreToCpForSide(score, side) {
  if (!score) {
    return null;
  }

  const whiteScore = score.type === 'mate' ? Math.sign(score.value) * 100000 : score.value;
  return side === 'white' ? whiteScore : -whiteScore;
}

export function moveFromFen(fen, uci) {
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      ...(uci[4] ? { promotion: uci[4] } : {}),
    });

    return {
      san: move.san,
      afterFen: chess.fen(),
    };
  } catch {
    return null;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
