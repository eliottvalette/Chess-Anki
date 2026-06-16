import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { DeckProgressMap } from '@/lib/deck-progress';
import {
  DECK_PROGRESS_STORAGE_KEY,
  mergeDeckProgress,
  persistTrainingPassword,
  persistTrainingUsername,
  readStoredTrainingPassword,
  readStoredTrainingUsername,
} from '@/lib/lab-helpers';
import type { DeckCard, DeckFeedback } from '@/lib/opening-training';
import type { TrainingProfile } from '../../lib/analysis-types';
import type { LabState } from '../useLabState';

export function useTrainingProfile(
  state: LabState,
  sharedRefs: {
    progressHydratedRef: React.MutableRefObject<boolean>;
    progressSyncTimerRef: React.MutableRefObject<number | null>;
    trainingCredentialsHydratedRef: React.MutableRefObject<boolean>;
  },
) {
  const hydrateTrainingProgressRef = useRef<(options: { saveMerged: boolean }) => Promise<void>>(async () => undefined);

  const {
    deckProgress,
    setDeckProgress,
    deckCards,
    trainingProfile,
    setTrainingProfile,
    setTrainingProfileError,
    setTrainingProfileBootstrapping,
    trainingUsername,
    setTrainingUsername,
    trainingPassword,
    setTrainingPassword,
  } = state;

  const saveTrainingProgress = useCallback(async (progress: DeckProgressMap) => {
    try {
      await fetch('/api/training-progress', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ progress }),
      });
    } catch {
      // Local storage remains the fallback when server sync is unavailable.
    }
  }, []);

  const saveTrainingAttempt = useCallback(async (card: DeckCard, feedback: DeckFeedback) => {
    try {
      await fetch('/api/training-progress', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          attempt: {
            cardId: card.id,
            playedUci: feedback.playedUci,
            playedSan: feedback.playedSan,
            expectedUci: card.answerUci,
            expectedSan: feedback.expectedSan,
            correct: feedback.correct,
            exact: feedback.exact,
            evalLossCp: feedback.evalLossCp ?? null,
          },
        }),
      });
    } catch {
      // Progress still syncs separately; attempts are best-effort telemetry.
    }
  }, []);

  const hydrateTrainingProgress = useCallback(
    async (options: { saveMerged: boolean }) => {
      try {
        const response = await fetch('/api/training-progress', { credentials: 'same-origin' });
        const payload = (await response.json()) as { progress?: DeckProgressMap; error?: string };
        const serverProgress = response.ok && payload.progress ? payload.progress : {};

        if (!response.ok && typeof window !== 'undefined') {
          window.localStorage.removeItem(DECK_PROGRESS_STORAGE_KEY);
        }
        let mergedProgress: DeckProgressMap | null = null;

        setDeckProgress((current) => {
          mergedProgress = mergeDeckProgress(serverProgress, current);

          if (typeof window !== 'undefined' && deckCards.length > 0) {
            const validCardIds = new Set(deckCards.map((card) => card.id));
            mergedProgress = Object.fromEntries(
              Object.entries(mergedProgress).filter(([cardId]) => validCardIds.has(cardId)),
            );
          }

          return mergedProgress;
        });

        sharedRefs.progressHydratedRef.current = true;

        if (options.saveMerged && mergedProgress) {
          await saveTrainingProgress(mergedProgress);
        }
      } catch {
        sharedRefs.progressHydratedRef.current = true;
      }
    },
    [deckCards, saveTrainingProgress, setDeckProgress, sharedRefs],
  );

  useEffect(() => {
    hydrateTrainingProgressRef.current = hydrateTrainingProgress;
  }, [hydrateTrainingProgress]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(DECK_PROGRESS_STORAGE_KEY);

      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as DeckProgressMap;
      setDeckProgress(parsed && typeof parsed === 'object' ? parsed : {});
    } catch {
      setDeckProgress({});
    }
  }, [setDeckProgress]);

  useLayoutEffect(() => {
    if (sharedRefs.trainingCredentialsHydratedRef.current) {
      return;
    }

    sharedRefs.trainingCredentialsHydratedRef.current = true;
    const savedUsername = readStoredTrainingUsername();
    const savedPassword = readStoredTrainingPassword();

    if (savedUsername) {
      setTrainingUsername(savedUsername);
    }

    if (savedPassword) {
      setTrainingPassword(savedPassword);
    }
  }, [setTrainingPassword, setTrainingUsername, sharedRefs]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (trainingUsername.trim()) {
      persistTrainingUsername(trainingUsername.trim());
    }
  }, [trainingUsername]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (trainingPassword) {
      persistTrainingPassword(trainingPassword);
    }
  }, [trainingPassword]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(DECK_PROGRESS_STORAGE_KEY, JSON.stringify(deckProgress));
  }, [deckProgress]);

  useEffect(() => {
    let cancelled = false;

    async function restoreTrainingProfile(username: string, password: string) {
      const response = await fetch('/api/training-profile', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json()) as { profile?: TrainingProfile | null; error?: string };

      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? 'Unable to restore training profile.');
      }

      return payload.profile;
    }

    async function loadTrainingProfile() {
      setTrainingProfileError('');

      const savedUsername = readStoredTrainingUsername();
      const savedPassword = readStoredTrainingPassword();

      if (savedUsername) {
        setTrainingUsername(savedUsername);
      }

      if (savedPassword) {
        setTrainingPassword(savedPassword);
      }

      try {
        const response = await fetch('/api/training-profile', { credentials: 'same-origin' });
        const payload = (await response.json()) as { profile?: TrainingProfile | null };

        if (cancelled) {
          return;
        }

        if (payload.profile) {
          setTrainingProfile(payload.profile);
          setTrainingUsername(payload.profile.username);
          await hydrateTrainingProgressRef.current({ saveMerged: false });
          return;
        }

        if (savedUsername && savedPassword) {
          const profile = await restoreTrainingProfile(savedUsername, savedPassword);

          if (cancelled) {
            return;
          }

          setTrainingProfile(profile);
          setTrainingUsername(profile.username);
          await hydrateTrainingProgressRef.current({ saveMerged: false });
          return;
        }

        setTrainingProfile(null);
      } catch (error) {
        if (!cancelled) {
          setTrainingProfile(null);
          setTrainingProfileError(error instanceof Error ? error.message : 'Unable to load training profile.');
        }
      } finally {
        sharedRefs.progressHydratedRef.current = true;

        if (!cancelled) {
          setTrainingProfileBootstrapping(false);
        }
      }
    }

    void loadTrainingProfile();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    setTrainingUsername,
    setTrainingProfile,
    sharedRefs.progressHydratedRef,
    setTrainingProfileError,
    setTrainingProfileBootstrapping,
    setTrainingPassword,
  ]);

  useEffect(() => {
    if (!trainingProfile || !sharedRefs.progressHydratedRef.current) {
      return undefined;
    }

    if (sharedRefs.progressSyncTimerRef.current != null) {
      window.clearTimeout(sharedRefs.progressSyncTimerRef.current);
    }

    sharedRefs.progressSyncTimerRef.current = window.setTimeout(() => {
      void saveTrainingProgress(deckProgress);
    }, 450);

    return () => {
      if (sharedRefs.progressSyncTimerRef.current != null) {
        window.clearTimeout(sharedRefs.progressSyncTimerRef.current);
      }
    };
  }, [deckProgress, saveTrainingProgress, sharedRefs, trainingProfile]);

  return {
    saveTrainingProgress,
    saveTrainingAttempt,
    hydrateTrainingProgressRef,
  };
}
