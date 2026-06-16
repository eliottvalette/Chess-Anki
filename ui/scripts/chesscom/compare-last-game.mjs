import { Chess } from 'chess.js';

import {
  buildTimelineSequencePositions,
  classifyTimelineMoves,
  extractMetadataFromGame,
  toStoredMove,
} from '../../lib/chess-analysis-client.ts';

const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.05.24"]
[Round "-"]
[White "LosValettos"]
[Black "chnskashima"]
[Result "1-0"]
[CurrentPosition "3R1Qk1/1p5p/p5p1/4pp2/8/7B/PPr2PPP/1n4K1 b - - 0 26"]
[Timezone "UTC"]
[ECO "C45"]
[ECOUrl "https://www.chess.com/openings/Scotch-Game-3...d6"]
[UTCDate "2026.05.24"]
[UTCTime "15:07:47"]
[WhiteElo "843"]
[BlackElo "810"]
[TimeControl "180+2"]
[Termination "LosValettos won by checkmate"]
[StartTime "15:07:47"]
[EndDate "2026.05.24"]
[EndTime "15:12:39"]
[Link "https://www.chess.com/game/live/169172799186"]

1. e4 e5 2. Nf3 Nc6 3. d4 d6 4. d5 Nce7 5. Nc3 Nf6 6. Bc4 g6 7. Bg5 Bg7 8. O-O O-O 9. Qd2 Bg4 10. Be2 a6 11. Bh6 c6 12. Qg5 Bxf3 13. Bxf3 Nd7 14. Bg4 cxd5 15. exd5 Bxh6 16. Qxh6 f5 17. Bh3 Rc8 18. Rfe1 Qb6 19. Rab1 Qd4 20. Re3 Nxd5 21. Rd3 Nxc3 22. Rxd4 Nxb1 23. Rxd6 Rxc2 24. Rxd7 Rf7 25. Rd8+ Rf8 26. Qxf8#`;

const ANALYZE_BASE_URL = process.env.ANALYZE_BASE_URL?.trim() || 'https://chess-analysis-v2.vercel.app';
const DEPTH = Number(process.env.COMPARE_DEPTH || 12);
const MOVETIME_MS = Number(process.env.COMPARE_MOVETIME_MS || 80);
const ONLY_PLIES = new Set(
  (process.env.COMPARE_PLIES ?? '')
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter(Number.isFinite),
);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const chess = new Chess();
  chess.loadPgn(PGN);

  const storedMoves = chess.history({ verbose: true }).map(toStoredMove);
  const positions = buildTimelineSequencePositions(storedMoves, null);
  const analyses = [];

  for (const position of positions) {
    const response = await fetch(`${ANALYZE_BASE_URL}/api/analyze-position`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        fen: position.fen,
        initialFen: position.initialFen,
        moves: position.moves,
        depth: DEPTH,
        movetimeMs: MOVETIME_MS,
        multipv: 3,
      }),
    });

    if (!response.ok) {
      throw new Error(`analysis failed at ${position.moves.length} plies: HTTP ${response.status}`);
    }

    analyses.push(await response.json());
  }

  const reviews = classifyTimelineMoves(
    storedMoves,
    analyses.slice(0, -1),
    analyses.slice(1),
    null,
    extractMetadataFromGame(chess),
  );

  const filtered = reviews
    .filter((review) => review.category)
    .filter((review) => ONLY_PLIES.size === 0 || ONLY_PLIES.has(review.ply))
    .map((review) => ({
      ply: review.ply,
      san: review.san,
      color: review.color,
      category: review.category,
      best: review.bestMoveSan,
      expected_points_lost: review.expectedPointsLost,
      before_cp: toCentipawns(analyses[review.ply - 1], review.color),
      after_cp: toCentipawns(analyses[review.ply], review.color),
      cp_loss: cpLoss(analyses[review.ply - 1], analyses[review.ply], review.color),
      before_mate: mateForSide(analyses[review.ply - 1], review.color),
      after_mate: mateForSide(analyses[review.ply], review.color),
    }));

  console.log(
    JSON.stringify(
      {
        depth: DEPTH,
        movetime_ms: MOVETIME_MS,
        reviews: filtered,
      },
      null,
      2,
    ),
  );
}

function toCentipawns(analysis, color) {
  const score = analysis?.whitePerspective;

  if (!score) {
    return null;
  }

  const value = score.type === 'mate' ? Math.sign(score.value) * 100000 : score.value;
  return color === 'w' ? value : -value;
}

function cpLoss(beforeAnalysis, afterAnalysis, color) {
  const before = toCentipawns(beforeAnalysis, color);
  const after = toCentipawns(afterAnalysis, color);

  if (before == null || after == null) {
    return null;
  }

  return Math.max(0, before - after);
}

function mateForSide(analysis, color) {
  const score = analysis?.whitePerspective;

  if (score?.type !== 'mate') {
    return null;
  }

  return color === 'w' ? score.value : -score.value;
}
