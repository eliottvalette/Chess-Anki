import { restoreGameFromHistory, restoreGameFromVariationBranch, type StoredMove } from './chess-analysis-client.ts';

export type ReviewVariationState = {
  variationBaseIndex: number | null;
  variationMoves: StoredMove[];
  variationIndex: number;
};

export function resolveReviewGameAtHistoryIndex(
  moveHistory: StoredMove[],
  initialFen: string | null,
  targetHistoryIndex: number,
  variation: ReviewVariationState,
) {
  const boundedIndex = Math.max(0, Math.min(targetHistoryIndex, moveHistory.length));
  const { variationBaseIndex, variationMoves, variationIndex } = variation;

  if (variationBaseIndex != null && boundedIndex === variationBaseIndex && variationIndex > 0) {
    return restoreGameFromVariationBranch(moveHistory, initialFen, variationBaseIndex, variationMoves, variationIndex);
  }

  return restoreGameFromHistory(moveHistory, initialFen, boundedIndex);
}

export type ReviewHistoryStep =
  | { kind: 'noop' }
  | { kind: 'variation'; variationIndex: number }
  | { kind: 'main'; historyIndex: number };

export function planReviewHistoryBack(historyIndex: number, variation: ReviewVariationState): ReviewHistoryStep {
  const { variationBaseIndex, variationIndex } = variation;

  if (variationBaseIndex != null && historyIndex === variationBaseIndex && variationIndex > 0) {
    return { kind: 'variation', variationIndex: variationIndex - 1 };
  }

  if (historyIndex === 0) {
    return { kind: 'noop' };
  }

  return { kind: 'main', historyIndex: historyIndex - 1 };
}

export function planReviewHistoryForward(
  moveHistory: StoredMove[],
  historyIndex: number,
  variation: ReviewVariationState,
): ReviewHistoryStep {
  const { variationBaseIndex, variationMoves, variationIndex } = variation;

  if (variationBaseIndex != null && historyIndex === variationBaseIndex && variationIndex < variationMoves.length) {
    return { kind: 'variation', variationIndex: variationIndex + 1 };
  }

  if (historyIndex >= moveHistory.length) {
    return { kind: 'noop' };
  }

  return { kind: 'main', historyIndex: historyIndex + 1 };
}
