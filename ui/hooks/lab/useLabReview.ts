import { useCallback } from 'react';
import type { TimelineReview } from '@/lib/chess-analysis-client';
import { restoreGameFromHistory } from '@/lib/chess-analysis-client';
import { type ChessSoundKey, getMoveSoundSequence } from '@/lib/chess-sounds';
import type { DeckCard } from '@/lib/opening-training';
import type { LabState } from '../useLabState';

export function useLabReview(
  state: LabState,
  context: {
    reviewPlaybackRequestIdRef: React.MutableRefObject<number>;
    playSoundSequence: (keys: ChessSoundKey[]) => void;
    jumpToIndex: (index: number) => void;
    activeDeckCard: DeckCard | null;
    reviewPlayerSide: 'white' | 'black' | null;
    orientation: 'white' | 'black';
  },
) {
  const { moveHistory, initialFen, historyIndex, setHistoryIndex, setGame, setMode, setReviewIndex } = state;

  const { reviewPlaybackRequestIdRef, playSoundSequence, jumpToIndex, activeDeckCard, reviewPlayerSide, orientation } =
    context;

  const playToHistoryIndex = useCallback(
    async (targetIndex: number, deps: { clearVariation: () => void; clearSelection: () => void }) => {
      const requestId = ++reviewPlaybackRequestIdRef.current;
      const boundedTarget = Math.max(0, Math.min(targetIndex, moveHistory.length));

      if (boundedTarget <= historyIndex) {
        jumpToIndex(boundedTarget);
        return;
      }

      for (let nextIndex = historyIndex + 1; nextIndex <= boundedTarget; nextIndex += 1) {
        if (reviewPlaybackRequestIdRef.current !== requestId) {
          return;
        }

        const nextGame = restoreGameFromHistory(moveHistory, initialFen, nextIndex);
        const replayedMove = moveHistory[nextIndex - 1];

        if (replayedMove) {
          const playerSide = activeDeckCard?.side ?? reviewPlayerSide;
          const isSelfMove =
            playerSide == null
              ? orientation === 'white'
              : (playerSide === 'white' && replayedMove.color === 'w') ||
                (playerSide === 'black' && replayedMove.color === 'b');

          playSoundSequence(
            getMoveSoundSequence({
              move: replayedMove,
              isSelfMove,
              isCheck: nextGame.isCheck(),
              isCheckmate: nextGame.isCheckmate(),
              isGameOver: nextGame.isGameOver(),
            }),
          );
        }

        setHistoryIndex(nextIndex);
        deps.clearVariation();
        setGame(nextGame);
        deps.clearSelection();

        await new Promise((resolve) => window.setTimeout(resolve, 210));
      }
    },
    [
      activeDeckCard?.side,
      historyIndex,
      initialFen,
      jumpToIndex,
      moveHistory,
      orientation,
      playSoundSequence,
      reviewPlaybackRequestIdRef,
      reviewPlayerSide,
      setGame,
      setHistoryIndex,
    ],
  );

  const goToReviewMoment = useCallback(
    (
      index: number,
      reviewMoments: TimelineReview[],
      deps: { clearVariation: () => void; clearSelection: () => void },
    ) => {
      if (index >= reviewMoments.length) {
        setMode('review');
        setReviewIndex(Math.max(0, reviewMoments.length - 1));
        void playToHistoryIndex(moveHistory.length, deps);
        return;
      }

      const boundedIndex = Math.max(0, Math.min(index, Math.max(0, reviewMoments.length - 1)));
      const moment = reviewMoments[boundedIndex] ?? null;

      setMode('review');
      setReviewIndex(boundedIndex);

      if (!moment) {
        return;
      }

      void playToHistoryIndex(moment.ply, deps);
    },
    [moveHistory.length, playToHistoryIndex, setMode, setReviewIndex],
  );

  return {
    playToHistoryIndex,
    goToReviewMoment,
  };
}
