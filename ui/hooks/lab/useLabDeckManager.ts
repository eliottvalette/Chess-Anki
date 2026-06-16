import { useCallback } from 'react';
import { LAST_TRAINING_DECK_STORAGE_KEY } from '@/lib/lab-helpers';
import type { LabState } from '../useLabState';

export function useLabDeckManager(
  state: LabState,
  context: {
    loadTrainingDeck: (
      deckId?: string | null,
      options?: { autoStart?: boolean; allDecks?: boolean; libraryLoading?: boolean },
    ) => Promise<void>;
  },
) {
  const {
    trainingProfile,
    trainingUsername,
    chesscomUsername,
    recentGameTimeClass,
    selectedDeckId,
    setDeckActionLoading,
    setDeckActionError,
    setSelectedDeckId,
    setFocusTrainCreateDeck,
    setDeckCards,
    setDeckProgress,
    setActiveDeckCard,
    setDeckFeedback,
    setDeckFeedbackArrowsVisible,
  } = state;
  const { loadTrainingDeck } = context;

  const createTrainingDeck = useCallback(
    async (name: string, pgn?: string) => {
      setDeckActionLoading(true);
      setDeckActionError('');

      try {
        const response = await fetch('/api/training-deck', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'create_deck', name, pgn }),
        });
        const payload = (await response.json()) as { deckId?: string; error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? 'Unable to create deck.');
        }

        if (payload.deckId) {
          setSelectedDeckId(payload.deckId);
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(LAST_TRAINING_DECK_STORAGE_KEY, payload.deckId);
          }
        }

        await loadTrainingDeck(payload.deckId);
        setFocusTrainCreateDeck(false);
      } catch (error) {
        setDeckActionError(error instanceof Error ? error.message : 'Unable to create deck.');
      } finally {
        setDeckActionLoading(false);
      }
    },
    [loadTrainingDeck, setDeckActionError, setDeckActionLoading, setFocusTrainCreateDeck, setSelectedDeckId],
  );

  const generateRecentTrainingDeck = useCallback(async () => {
    setDeckActionLoading(true);
    setDeckActionError('');

    try {
      const response = await fetch('/api/training-deck', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_recent',
          username: chesscomUsername || trainingProfile?.username || trainingUsername,
          count: 50,
          timeClass: recentGameTimeClass,
        }),
      });
      const payload = (await response.json()) as { deckId?: string; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to generate deck.');
      }

      if (payload.deckId) {
        setSelectedDeckId(payload.deckId);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(LAST_TRAINING_DECK_STORAGE_KEY, payload.deckId);
        }
      }
      await loadTrainingDeck(payload.deckId ?? selectedDeckId);
    } catch (error) {
      setDeckActionError(error instanceof Error ? error.message : 'Unable to generate deck.');
    } finally {
      setDeckActionLoading(false);
    }
  }, [
    chesscomUsername,
    loadTrainingDeck,
    recentGameTimeClass,
    selectedDeckId,
    setDeckActionError,
    setDeckActionLoading,
    setSelectedDeckId,
    trainingProfile?.username,
    trainingUsername,
  ]);

  const renameTrainingDeck = useCallback(
    async (deckId: string, name: string) => {
      setDeckActionLoading(true);
      setDeckActionError('');

      try {
        const response = await fetch('/api/training-deck', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'rename_deck', deckId, name }),
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? 'Unable to rename deck.');
        }

        await loadTrainingDeck(selectedDeckId === deckId ? deckId : selectedDeckId);
      } catch (error) {
        setDeckActionError(error instanceof Error ? error.message : 'Unable to rename deck.');
      } finally {
        setDeckActionLoading(false);
      }
    },
    [loadTrainingDeck, selectedDeckId, setDeckActionError, setDeckActionLoading],
  );

  const deleteTrainingDeck = useCallback(
    async (deckId: string) => {
      setDeckActionLoading(true);
      setDeckActionError('');

      try {
        const response = await fetch('/api/training-deck', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'delete_deck', deckId }),
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? 'Unable to delete deck.');
        }

        const isCurrent = deckId === selectedDeckId;

        if (isCurrent) {
          setSelectedDeckId(null);
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(LAST_TRAINING_DECK_STORAGE_KEY);
          }
          setDeckCards([]);
          setDeckProgress({});
          setActiveDeckCard(null);
          setDeckFeedback(null);
          setDeckFeedbackArrowsVisible(false);
        }

        await loadTrainingDeck(isCurrent ? null : selectedDeckId);
      } catch (error) {
        setDeckActionError(error instanceof Error ? error.message : 'Unable to delete deck.');
      } finally {
        setDeckActionLoading(false);
      }
    },
    [
      loadTrainingDeck,
      selectedDeckId,
      setActiveDeckCard,
      setDeckActionError,
      setDeckActionLoading,
      setDeckCards,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setDeckProgress,
      setSelectedDeckId,
    ],
  );

  return {
    createTrainingDeck,
    generateRecentTrainingDeck,
    renameTrainingDeck,
    deleteTrainingDeck,
  };
}
