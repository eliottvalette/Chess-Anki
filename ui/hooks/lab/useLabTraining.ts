import { useCallback, useEffect, useRef } from 'react';
import type { WorkspaceMode } from '@/lib/analysis-types';
import type { StoredMove } from '@/lib/chess-analysis-client';
import { restoreGameFromHistory } from '@/lib/chess-analysis-client';
import { type ChessSoundKey, getMoveSoundSequence } from '@/lib/chess-sounds';
import { buildMixedTrainingQueue, getDeckStudyQueue } from '@/lib/deck-progress';
import {
  createEmptyTrainSessionStats,
  delay,
  LAST_TRAINING_DECK_STORAGE_KEY,
  mapTrainingDeckCard,
  normalizeDeckLoadError,
  readJsonResponse,
  type TrainingDeckPayload,
} from '@/lib/lab-helpers';
import { buildDeckCardStartState, type DeckCard, type OpeningSeedLine } from '@/lib/opening-training';
import type { LabState } from '../useLabState';

const TRAINING_REPLAY_MOVE_MS = 300;

export function useLabTraining(
  state: LabState,
  context: {
    playSound: (key: ChessSoundKey) => void;
    playSoundSequence: (keys: ChessSoundKey[]) => void;
    clearVariation: () => void;
    clearSelection: () => void;
    persistReviewWorkspaceSnapshot: () => void;
    deckCardPromptStartedAtRef: React.MutableRefObject<number | null>;
    deckReplayInitialFenRef: React.MutableRefObject<string | null>;
    deckReplayMovesRef: React.MutableRefObject<StoredMove[]>;
    timelineRefineRequestIdRef: React.MutableRefObject<number>;
    modeRef: React.MutableRefObject<WorkspaceMode>;
  },
) {
  const {
    deckProgress,
    deckFeedback,
    selectedDeckId,
    setInitialFen,
    setMoveHistory,
    setHistoryIndex,
    setGame,
    setMetadata,
    setFileName,
    setPreMoveAnalyses,
    setActiveDeckCard,
    setDeckFeedback,
    setDeckFeedbackArrowsVisible,
    setOrientation,
    setShowArrow,
    setPositionAnalysis,
    setTimelineAnalyses,
    setTimelineError,
    setDeckPlaybackBusy,
    setDeckLibraryLoading,
    setDeckCardsLoading,
    setDeckLoadError,
    setDeckSummaries,
    setTrainAllQueue,
    setTrainSessionIndex,
    setTrainSessionStats,
    setOpeningLines,
    setDeckCards,
    setDeckIndex,
    setTrainAllSession,
    setSelectedDeckId,
    setMode,
    deckPlaybackRequestIdRef,
  } = state;

  const {
    playSound,
    playSoundSequence,
    clearVariation,
    clearSelection,
    persistReviewWorkspaceSnapshot,
    deckCardPromptStartedAtRef,
    deckReplayInitialFenRef,
    deckReplayMovesRef,
    timelineRefineRequestIdRef,
    modeRef,
  } = context;

  const deckLoadRequestIdRef = useRef(0);
  const selectedDeckIdRef = useRef(selectedDeckId);
  const deckProgressRef = useRef(deckProgress);
  const deckFeedbackRef = useRef(deckFeedback);

  useEffect(() => {
    selectedDeckIdRef.current = selectedDeckId;
  }, [selectedDeckId]);

  useEffect(() => {
    deckProgressRef.current = deckProgress;
  }, [deckProgress]);

  useEffect(() => {
    deckFeedbackRef.current = deckFeedback;
  }, [deckFeedback]);

  const beginDeckCardSession = useCallback(
    (card: DeckCard, lines: OpeningSeedLine[]) => {
      persistReviewWorkspaceSnapshot();
      deckCardPromptStartedAtRef.current = null;
      const deckState = buildDeckCardStartState(card, lines);

      setInitialFen(deckState.initialFen);
      setMoveHistory(deckState.moveHistory);
      setHistoryIndex(deckState.historyIndex);
      clearVariation();
      setGame(deckState.game);
      setMetadata(null);
      setFileName('');
      setPreMoveAnalyses([]);
      timelineRefineRequestIdRef.current += 1;
      setMode('train');
      modeRef.current = 'train';
      setActiveDeckCard(card);
      setDeckFeedback(null);
      setDeckFeedbackArrowsVisible(false);
      setOrientation(card.side);
      setShowArrow(false);
      setPositionAnalysis(null);
      setTimelineAnalyses([]);
      setTimelineError('');
      clearSelection();
      deckReplayMovesRef.current = deckState.moveHistory;
      deckReplayInitialFenRef.current = deckState.initialFen;

      if (deckState.replayTargetIndex > 0) {
        playSound('game-start');
        return deckState.replayTargetIndex;
      }

      playSound('game-start');
      return 0;
    },
    [
      clearSelection,
      clearVariation,
      deckCardPromptStartedAtRef,
      deckReplayInitialFenRef,
      deckReplayMovesRef,
      modeRef,
      persistReviewWorkspaceSnapshot,
      playSound,
      setActiveDeckCard,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setFileName,
      setGame,
      setHistoryIndex,
      setInitialFen,
      setMetadata,
      setMode,
      setMoveHistory,
      setOrientation,
      setPositionAnalysis,
      setPreMoveAnalyses,
      setShowArrow,
      setTimelineAnalyses,
      setTimelineError,
      timelineRefineRequestIdRef,
    ],
  );

  const playDeckReplayToIndex = useCallback(
    async (targetIndex: number, trainSide: DeckCard['side']) => {
      const requestId = ++deckPlaybackRequestIdRef.current;
      const moves = deckReplayMovesRef.current;
      const startFen = deckReplayInitialFenRef.current;
      const boundedTarget = Math.max(0, Math.min(targetIndex, moves.length));

      if (boundedTarget === 0) {
        return true;
      }

      setDeckPlaybackBusy(true);

      for (let nextIndex = 1; nextIndex <= boundedTarget; nextIndex += 1) {
        if (deckPlaybackRequestIdRef.current !== requestId) {
          setDeckPlaybackBusy(false);
          return false;
        }

        const nextGame = restoreGameFromHistory(moves, startFen, nextIndex);
        const replayedMove = moves[nextIndex - 1];

        if (replayedMove) {
          const isSelfMove =
            (trainSide === 'white' && replayedMove.color === 'w') ||
            (trainSide === 'black' && replayedMove.color === 'b');

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
        setDeckFeedbackArrowsVisible(false);
        clearVariation();
        setGame(nextGame);
        clearSelection();
        await delay(TRAINING_REPLAY_MOVE_MS);
      }

      if (deckPlaybackRequestIdRef.current === requestId) {
        setDeckPlaybackBusy(false);
        return true;
      }

      return false;
    },
    [
      clearSelection,
      clearVariation,
      deckReplayInitialFenRef,
      deckReplayMovesRef,
      playSoundSequence,
      setDeckFeedbackArrowsVisible,
      setDeckPlaybackBusy,
      setGame,
      setHistoryIndex,
      deckPlaybackRequestIdRef,
    ],
  );

  const startDeckCardWithReplay = useCallback(
    async (card: DeckCard, lines: OpeningSeedLine[]) => {
      deckPlaybackRequestIdRef.current += 1;
      const replayTargetIndex = beginDeckCardSession(card, lines);

      if (replayTargetIndex > 0) {
        const replayCompleted = await playDeckReplayToIndex(replayTargetIndex, card.side);

        if (!replayCompleted) {
          return;
        }
      }

      deckCardPromptStartedAtRef.current = Date.now();
    },
    [beginDeckCardSession, deckCardPromptStartedAtRef, playDeckReplayToIndex, deckPlaybackRequestIdRef],
  );

  const loadTrainingDeck = useCallback(
    async (deckId?: string | null, options?: { autoStart?: boolean; allDecks?: boolean; libraryLoading?: boolean }) => {
      const resolvedDeckId = deckId ?? selectedDeckIdRef.current;
      const libraryLoading = options?.libraryLoading !== false;
      const requestId = ++deckLoadRequestIdRef.current;

      if (libraryLoading) {
        setDeckLibraryLoading(true);
      } else {
        setDeckCardsLoading(true);
      }

      setDeckLoadError('');

      try {
        const query = options?.allDecks
          ? '?scope=all'
          : resolvedDeckId
            ? `?deckId=${encodeURIComponent(resolvedDeckId)}`
            : '';
        const response = await fetch(`/api/training-deck${query}`, { credentials: 'same-origin' });
        const payload = await readJsonResponse<TrainingDeckPayload>(response);

        if (!response.ok) {
          throw new Error(payload.error ?? `Training deck fetch failed: HTTP ${response.status}`);
        }

        setDeckSummaries(payload.decks ?? []);

        if (
          typeof window !== 'undefined' &&
          resolvedDeckId &&
          !(payload.decks ?? []).some((deck) => deck.id === resolvedDeckId)
        ) {
          window.localStorage.removeItem(LAST_TRAINING_DECK_STORAGE_KEY);
        }

        const lines = (payload.lines ?? []).map((line) => ({
          id: String(line.id),
          name: String(line.name),
          eco: String(line.eco),
          side: (line.side === 'black' ? 'black' : 'white') as OpeningSeedLine['side'],
          moves: Array.isArray(line.moves) ? line.moves.map((move) => String(move)) : [],
        }));
        const cards: DeckCard[] = (payload.cards ?? []).map(mapTrainingDeckCard);

        if (options?.allDecks) {
          const mixedCards = buildMixedTrainingQueue(cards, deckProgressRef.current);
          setTrainAllQueue(mixedCards);
          setTrainSessionIndex(0);
          setTrainSessionStats(createEmptyTrainSessionStats());
          setOpeningLines(lines);
          setDeckCards(cards);
          setDeckIndex(0);

          if (options.autoStart && mixedCards.length > 0) {
            setTrainAllSession(true);
            await startDeckCardWithReplay(mixedCards[0]!, lines);
          }

          return;
        }

        if (!payload.deck) {
          setOpeningLines([]);
          setDeckCards([]);
          setSelectedDeckId(null);
          return;
        }

        setSelectedDeckId(payload.deck.id);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(LAST_TRAINING_DECK_STORAGE_KEY, payload.deck.id);
        }
        setOpeningLines(lines);
        setDeckCards(cards);
        setDeckIndex(0);

        if (options?.autoStart && cards.length > 0) {
          const nextCard = getDeckStudyQueue(cards, deckProgressRef.current)[0] ?? null;

          if (nextCard) {
            await startDeckCardWithReplay(nextCard, lines);
          }
        }
      } catch (error) {
        setOpeningLines([]);
        setDeckCards([]);

        if (libraryLoading) {
          setDeckSummaries([]);
        }

        setDeckLoadError(
          normalizeDeckLoadError(error instanceof Error ? error.message : 'Unable to load Supabase deck.'),
        );
      } finally {
        if (requestId === deckLoadRequestIdRef.current) {
          if (libraryLoading) {
            setDeckLibraryLoading(false);
          } else {
            setDeckCardsLoading(false);
          }
        }
      }
    },
    [
      setDeckCardsLoading,
      setDeckLibraryLoading,
      setDeckLoadError,
      setDeckSummaries,
      setOpeningLines,
      setDeckCards,
      setSelectedDeckId,
      setTrainAllQueue,
      setTrainSessionIndex,
      setTrainSessionStats,
      setDeckIndex,
      setTrainAllSession,
      startDeckCardWithReplay,
    ],
  );

  return {
    beginDeckCardSession,
    playDeckReplayToIndex,
    startDeckCardWithReplay,
    loadTrainingDeck,
    deckPlaybackRequestIdRef,
    deckLoadRequestIdRef,
    deckProgressRef,
    deckFeedbackRef,
    selectedDeckIdRef,
  };
}
