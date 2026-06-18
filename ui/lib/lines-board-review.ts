import type { ReviewCategory } from './chess-analysis-client';
import type { LinesStudyMode } from './opening-tree';

type LinesMoveFeedback = {
  pending: boolean;
  correct: boolean;
  playedUci: string;
};

export function resolveLinesBoardReviewCategory({
  baseCategory,
  feedback,
  lastMoveUci,
  studyMode,
}: {
  baseCategory: ReviewCategory | null;
  feedback: LinesMoveFeedback | null;
  lastMoveUci: string | null;
  studyMode: LinesStudyMode;
}): ReviewCategory | null {
  if (studyMode !== 'learn' || !feedback || feedback.pending || feedback.playedUci !== lastMoveUci) {
    return baseCategory;
  }

  return feedback.correct ? 'best' : 'miss';
}
