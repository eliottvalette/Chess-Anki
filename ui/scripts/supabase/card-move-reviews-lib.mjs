import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

import {
  buildStoredMovesFromSanList,
  buildTimelineSequencePositions,
  classifyTimelineMoves,
  toStoredMove,
} from '../../lib/chess-analysis-client.ts';

const openingBookKeys = new Set(
  JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../lib/opening-book-keys.json'), 'utf8')),
);

export function parseCardMoveReviews(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }

    const ply = Number(entry.ply);
    const san = String(entry.san ?? '').trim();
    const category = String(entry.category ?? '').trim();
    const whiteEvalCpRaw = entry.whiteEvalCp ?? entry.evalCp;

    if (!Number.isInteger(ply) || ply <= 0 || !san || !category) {
      return [];
    }

    return [
      {
        ply,
        san,
        category,
        whiteEvalCp: Number.isFinite(Number(whiteEvalCpRaw)) ? Math.trunc(Number(whiteEvalCpRaw)) : null,
      },
    ];
  });
}

export function buildDeckCardReplayHistory(card, openingLines) {
  if (card.replayFromStart && card.setupMoves.length > 0) {
    const moves = buildStoredMovesFromSanList(card.initialFen, card.setupMoves);

    return {
      initialFen: card.initialFen,
      moves,
    };
  }

  const line = openingLines.find((candidate) => candidate.id === card.lineId);

  if (line && card.opponentMoveUci) {
    try {
      const baseGame = new Chess();

      for (const san of line.moves.slice(0, Math.max(0, card.ply - 1))) {
        baseGame.move(san);
      }

      const lineInitialFen = baseGame.fen();
      const replayGame = new Chess(lineInitialFen);
      const move = replayGame.move({
        from: card.opponentMoveUci.slice(0, 2),
        to: card.opponentMoveUci.slice(2, 4),
        ...(card.opponentMoveUci[4] ? { promotion: card.opponentMoveUci[4] } : {}),
      });

      if (!move) {
        throw new Error('Invalid opponent move');
      }

      return {
        initialFen: lineInitialFen,
        moves: [toStoredMove(move)],
      };
    } catch {
      // fall through
    }
  }

  return {
    initialFen: card.fen,
    moves: [],
  };
}

export function buildTimelineAnalysesForMoves(moves, initialFen, analyses) {
  const positions = buildTimelineSequencePositions(moves, initialFen);

  if (positions.length === 0 || analyses.length !== positions.length) {
    throw new Error('Missing timeline analyses for card move reviews.');
  }

  return {
    preMoveAnalyses: analyses.slice(0, -1),
    postMoveAnalyses: analyses.slice(1),
  };
}

export function buildCardMoveReviewsFromAnalyses(moves, preMoveAnalyses, postMoveAnalyses, initialFen) {
  if (moves.length === 0) {
    return [];
  }

  const openingBookFlags = resolveOpeningBookFlagsLocal(moves, initialFen);
  const reviews = classifyTimelineMoves(moves, preMoveAnalyses, postMoveAnalyses, initialFen, null, openingBookFlags);

  return reviews.flatMap((review) => {
    if (!review.category) {
      return [];
    }

    return [
      {
        ply: review.ply,
        san: review.san,
        category: review.category,
        whiteEvalCp: toWhiteEvalCp(review.afterCp, review.color),
      },
    ];
  });
}

function resolveOpeningBookFlagsLocal(moves, initialFen) {
  const chess = initialFen ? new Chess(initialFen) : new Chess();

  return moves.map((move) => {
    const fenBefore = normalizeOpeningBookFen(chess.fen());
    const inBook = openingBookKeys.has(`${fenBefore}|${move.uci}`);
    chess.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    });
    return inBook;
  });
}

function normalizeOpeningBookFen(fen) {
  return fen.trim().split(' ').slice(0, 4).join(' ');
}

function toWhiteEvalCp(afterCp, color) {
  if (afterCp == null) {
    return null;
  }

  return color === 'w' ? afterCp : -afterCp;
}
