import type { AnalysisResult } from '@/lib/analysis-types';
import {
  buildTimelineSequencePositions,
  classifyTimelineMoves,
  type GameMetadata,
  type ReviewCategory,
  type StoredMove,
  type TimelineReview,
} from '@/lib/chess-analysis-client';
import { resolveOpeningBookFlagsLocal } from '@/lib/opening-book';
import { buildDeckCardStartState, type DeckCard, type OpeningSeedLine } from '@/lib/opening-training';

export type CardMoveReview = {
  ply: number;
  san: string;
  category: ReviewCategory;
  whiteEvalCp: number | null;
};

export function parseCardMoveReviews(value: unknown): CardMoveReview[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }

    const review = entry as Record<string, unknown>;
    const ply = Number(review.ply);
    const san = String(review.san ?? '').trim();
    const category = String(review.category ?? '').trim() as ReviewCategory;
    const whiteEvalCpRaw = review.whiteEvalCp ?? review.evalCp;

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

export function cardMoveReviewsFromTimeline(reviews: TimelineReview[], count: number): CardMoveReview[] {
  return reviews.slice(0, count).flatMap((review) => {
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

export function buildCardMoveReviewsFromAnalyses(
  moves: StoredMove[],
  preMoveAnalyses: AnalysisResult[],
  postMoveAnalyses: AnalysisResult[],
  initialFen: string | null,
  metadata?: GameMetadata | null,
): CardMoveReview[] {
  if (moves.length === 0) {
    return [];
  }

  const openingBookFlags = resolveOpeningBookFlagsLocal(moves, initialFen);
  const reviews = classifyTimelineMoves(
    moves,
    preMoveAnalyses,
    postMoveAnalyses,
    initialFen,
    metadata,
    openingBookFlags,
  );

  return cardMoveReviewsFromTimeline(reviews, moves.length);
}

export function buildDeckCardReplayHistory(card: DeckCard, openingLines: OpeningSeedLine[]) {
  const deckState = buildDeckCardStartState(card, openingLines);

  return {
    initialFen: deckState.initialFen,
    moves: deckState.moveHistory,
  };
}

export function buildTimelineAnalysesForMoves(
  moves: StoredMove[],
  initialFen: string | null,
  analyses: AnalysisResult[],
) {
  const positions = buildTimelineSequencePositions(moves, initialFen);

  if (positions.length === 0 || analyses.length !== positions.length) {
    throw new Error('Missing timeline analyses for card move reviews.');
  }

  return {
    preMoveAnalyses: analyses.slice(0, -1),
    postMoveAnalyses: analyses.slice(1),
  };
}

function toWhiteEvalCp(afterCp: number | null, color: 'w' | 'b') {
  if (afterCp == null) {
    return null;
  }

  return color === 'w' ? afterCp : -afterCp;
}

export type TrainBoardAnswerFeedback = {
  correct: boolean;
  playedUci: string;
  evalLossCp?: number;
};

function moveUciFromStoredMove(move: StoredMove) {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function referenceWhiteEvalCp(card: DeckCard) {
  if (card.referenceEvalCp == null) {
    return null;
  }

  return card.side === 'white' ? card.referenceEvalCp : -card.referenceEvalCp;
}

export function categoryFromEvalLossCp(evalLossCp: number): ReviewCategory {
  const normalizedLossCp = Math.max(0, Math.round(evalLossCp));

  if (normalizedLossCp <= 12) {
    return 'best';
  }

  if (normalizedLossCp <= 28) {
    return 'excellent';
  }

  if (normalizedLossCp <= 55) {
    return 'good';
  }

  if (normalizedLossCp < 100) {
    return 'inaccuracy';
  }

  if (normalizedLossCp < 320) {
    return 'mistake';
  }

  return 'blunder';
}

function categoryFromOpponentScoreSwing(scoreSwingCp: number): ReviewCategory {
  if (scoreSwingCp >= 120) {
    return 'blunder';
  }

  if (scoreSwingCp >= 70) {
    return 'mistake';
  }

  if (scoreSwingCp >= 35) {
    return 'inaccuracy';
  }

  return 'good';
}

function buildTrainBoardMoveReview(
  move: StoredMove,
  moveIndex: number,
  category: ReviewCategory,
  whiteEvalCp: number | null,
): CardMoveReview {
  return {
    ply: moveIndex + 1,
    san: move.san,
    category,
    whiteEvalCp,
  };
}

export function resolveTrainBoardMoveReview(
  card: DeckCard,
  moveIndex: number,
  moves: StoredMove[],
  requestInitialFen: string | null,
  answerFeedback?: TrainBoardAnswerFeedback | null,
): CardMoveReview | null {
  const move = moves[moveIndex];

  if (!move) {
    return null;
  }

  const moveUci = moveUciFromStoredMove(move);

  if (answerFeedback && moveUci === answerFeedback.playedUci) {
    if (answerFeedback.correct) {
      return buildTrainBoardMoveReview(move, moveIndex, 'best', referenceWhiteEvalCp(card));
    }

    if (answerFeedback.evalLossCp != null) {
      return buildTrainBoardMoveReview(
        move,
        moveIndex,
        categoryFromEvalLossCp(answerFeedback.evalLossCp),
        referenceWhiteEvalCp(card),
      );
    }

    return buildTrainBoardMoveReview(move, moveIndex, 'mistake', referenceWhiteEvalCp(card));
  }

  if (moveUci === card.answerUci) {
    return buildTrainBoardMoveReview(move, moveIndex, 'best', referenceWhiteEvalCp(card));
  }

  const stored = card.moveReviews[moveIndex];

  if (stored) {
    return stored;
  }

  const openingBookFlags = resolveOpeningBookFlagsLocal(moves.slice(0, moveIndex + 1), requestInitialFen);

  if (openingBookFlags[moveIndex]) {
    return buildTrainBoardMoveReview(move, moveIndex, 'book', null);
  }

  if (card.opponentMoveUci && moveUci === card.opponentMoveUci && card.scoreSwingCp != null) {
    return buildTrainBoardMoveReview(move, moveIndex, categoryFromOpponentScoreSwing(card.scoreSwingCp), null);
  }

  return buildTrainBoardMoveReview(move, moveIndex, 'good', null);
}

export function resolveTrainReplayBestMoveUci(
  card: DeckCard,
  historyIndex: number,
  moveHistory: StoredMove[],
  positionAnalysesByMoveCount: Array<AnalysisResult | null | undefined>,
  currentPositionAnalysis: AnalysisResult | null | undefined,
) {
  const engineBest = positionAnalysesByMoveCount[historyIndex]?.bestMove ?? currentPositionAnalysis?.bestMove ?? null;

  if (engineBest) {
    return engineBest;
  }

  const quizMoveIndex = moveHistory.length - 1;

  if (historyIndex === quizMoveIndex) {
    return card.answerUci;
  }

  const nextMove = moveHistory[historyIndex];

  if (nextMove) {
    return moveUciFromStoredMove(nextMove);
  }

  return null;
}

export function shouldUseLiveTrainMoveReview(
  card: DeckCard,
  moves: StoredMove[],
  moveIndex: number,
  answerFeedback?: TrainBoardAnswerFeedback | null,
) {
  const move = moves[moveIndex];

  if (!move) {
    return false;
  }

  const moveUci = moveUciFromStoredMove(move);

  if (answerFeedback && moveUci === answerFeedback.playedUci) {
    return !answerFeedback.correct;
  }

  if (answerFeedback) {
    const answerMoveIndex = moves.findIndex(
      (candidate) => moveUciFromStoredMove(candidate) === answerFeedback.playedUci,
    );

    if (answerMoveIndex >= 0 && moveIndex > answerMoveIndex) {
      return true;
    }
  }

  const stored = card.moveReviews[moveIndex];

  if (stored && stored.san === move.san) {
    return false;
  }

  if (moveIndex >= card.moveReviews.length || !stored || stored.san !== move.san) {
    return true;
  }

  return false;
}

export function buildLiveTrainMoveReview(
  moveIndex: number,
  moves: StoredMove[],
  analysesByMoveCount: Array<AnalysisResult | null | undefined>,
  initialFen: string | null,
): CardMoveReview | null {
  const move = moves[moveIndex];

  if (!move) {
    return null;
  }

  const subset = moves.slice(0, moveIndex + 1);
  const preMoveAnalyses = subset.map((_, index) => analysesByMoveCount[index] ?? null);
  const postMoveAnalyses = subset.map((_, index) => analysesByMoveCount[index + 1] ?? null);

  if (preMoveAnalyses.some((analysis) => analysis == null) || postMoveAnalyses.some((analysis) => analysis == null)) {
    return null;
  }

  const openingBookFlags = resolveOpeningBookFlagsLocal(subset, initialFen);
  const reviews = classifyTimelineMoves(
    subset,
    preMoveAnalyses as AnalysisResult[],
    postMoveAnalyses as AnalysisResult[],
    initialFen,
    null,
    openingBookFlags,
  );
  const review = reviews[moveIndex];

  if (!review?.category) {
    return null;
  }

  return {
    ply: moveIndex + 1,
    san: move.san,
    category: review.category,
    whiteEvalCp: toWhiteEvalCp(review.afterCp, review.color),
  };
}
