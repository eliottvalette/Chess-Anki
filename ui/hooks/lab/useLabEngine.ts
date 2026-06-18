import { useCallback, useEffect, useRef } from 'react';
import {
  buildDeterministicAnalyzeRequest,
  buildReviewAnalyzeRequest,
  REVIEW_ANALYSIS_PROFILE,
} from '@/lib/analysis-profile';
import type { AnalysisResult } from '@/lib/analysis-types';
import { shouldUseLiveTrainMoveReview } from '@/lib/card-move-reviews';
import {
  analyzeGamePositions,
  analyzeSinglePosition,
  buildMoveUciHistory,
  buildTimelineSequencePositions,
  restoreGameFromHistory,
  type StoredMove,
} from '@/lib/chess-analysis-client';
import { getPositionCacheKey, getTimelinePositionCacheKey, type PositionAnalysisProfile } from '@/lib/lab-helpers';
import { runTimelineAnalysisDedupe } from '@/lib/timeline-analysis-runner';
import type { LabState } from '../useLabState';

const TIMELINE_ANALYSIS_BATCH_SIZE = 4;
const PRELOAD_AHEAD = 3;

export function useLabEngine(
  state: LabState,
  context: {
    currentFen: string;
    currentMoveList: string[];
    currentLineKey: string;
  },
) {
  const {
    initialFen,
    activeDeckCard,
    deckFeedback,
    moveHistory,
    historyIndex,
    mode,
    timelineLoading,
    setPositionAnalysis,
    setPositionLoading,
    setServerError,
    setTrainAnalysisTick,
  } = state;

  const { currentFen, currentMoveList } = context;

  const positionCacheRef = useRef<Map<string, AnalysisResult>>(new Map());
  const positionInFlightRef = useRef<Map<string, Promise<AnalysisResult>>>(new Map());
  const timelineBatchInFlightRef = useRef<Map<string, Promise<AnalysisResult[]>>>(new Map());
  const positionRequestIdRef = useRef(0);

  const clearEngineCache = useCallback(() => {
    positionCacheRef.current.clear();
  }, []);

  const fetchCachedPositionAnalysis = useCallback(
    (
      cacheKey: string,
      fen: string,
      moves: string[],
      requestInitialFen = initialFen,
      profile: PositionAnalysisProfile = 'review',
    ) => {
      const cachedAnalysis = positionCacheRef.current.get(cacheKey);

      if (cachedAnalysis) {
        return Promise.resolve(cachedAnalysis);
      }

      const inFlight = positionInFlightRef.current.get(cacheKey);

      if (inFlight) {
        return inFlight;
      }

      const buildRequest = profile === 'training' ? buildDeterministicAnalyzeRequest : buildReviewAnalyzeRequest;
      const request = analyzeSinglePosition(
        buildRequest({
          fen,
          initialFen: requestInitialFen,
          moves,
        }),
      )
        .then((analysis) => {
          positionCacheRef.current.set(cacheKey, analysis);
          return analysis;
        })
        .finally(() => {
          positionInFlightRef.current.delete(cacheKey);
        });

      positionInFlightRef.current.set(cacheKey, request);
      return request;
    },
    [initialFen],
  );

  const analyzeTimelineDeep = useCallback(
    async (
      moves: StoredMove[],
      requestInitialFen: string | null,
      onProgress?: (progress: number) => void,
      label = 'review',
      signal?: AbortSignal,
    ) => {
      const positions = buildTimelineSequencePositions(moves, requestInitialFen);

      return runTimelineAnalysisDedupe({
        label,
        positions,
        signal,
        cache: positionCacheRef.current,
        positionInFlight: positionInFlightRef.current,
        batchInFlight: timelineBatchInFlightRef.current,
        batchSize: TIMELINE_ANALYSIS_BATCH_SIZE,
        getCacheKey: (position) => getTimelinePositionCacheKey(requestInitialFen, position.moves ?? []),
        buildRequest: (position) =>
          buildReviewAnalyzeRequest({
            ...position,
            initialFen: requestInitialFen,
          }),
        analyzeBatch: async (batchPositions, batchSignal) => {
          const response = await analyzeGamePositions(
            {
              positions: batchPositions,
              depth: REVIEW_ANALYSIS_PROFILE.depth,
            },
            batchSignal,
          );
          return response.analyses ?? [];
        },
        onProgress,
      });
    },
    [],
  );

  // 1. Fetch current position analysis on history index / move change
  useEffect(() => {
    if (mode === 'lines') {
      return undefined;
    }

    const requestId = ++positionRequestIdRef.current;
    const positionProfile: PositionAnalysisProfile = activeDeckCard ? 'training' : 'review';
    const cacheKey = getPositionCacheKey(initialFen, currentMoveList, positionProfile);
    const cachedAnalysis = positionCacheRef.current.get(cacheKey);

    if (cachedAnalysis) {
      setPositionAnalysis(cachedAnalysis);
      setPositionLoading(false);
      setServerError('');
      return undefined;
    }

    setPositionLoading(true);
    setServerError('');
    setPositionAnalysis(null);

    fetchCachedPositionAnalysis(cacheKey, currentFen, currentMoveList, initialFen, positionProfile)
      .then((analysis) => {
        if (positionRequestIdRef.current === requestId) {
          setPositionAnalysis(analysis);
        }
      })
      .catch((error) => {
        if (positionRequestIdRef.current === requestId) {
          setPositionAnalysis(null);
          setServerError(error.message);
        }
      })
      .finally(() => {
        if (positionRequestIdRef.current === requestId) {
          setPositionLoading(false);
        }
      });

    return undefined;
  }, [
    activeDeckCard,
    currentFen,
    currentMoveList,
    fetchCachedPositionAnalysis,
    initialFen,
    mode,
    setPositionAnalysis,
    setPositionLoading,
    setServerError,
  ]);

  // Lines study uses opening-tree eval for the rail; engine analysis is optional and debounced.
  useEffect(() => {
    if (mode !== 'lines') {
      return undefined;
    }

    const cacheKey = getPositionCacheKey(initialFen, currentMoveList, 'review');
    const cachedAnalysis = positionCacheRef.current.get(cacheKey);

    if (cachedAnalysis) {
      setPositionAnalysis(cachedAnalysis);
      return undefined;
    }

    setPositionAnalysis(null);

    const requestId = ++positionRequestIdRef.current;
    const timer = window.setTimeout(() => {
      void fetchCachedPositionAnalysis(cacheKey, currentFen, currentMoveList, initialFen, 'review')
        .then((analysis) => {
          if (positionRequestIdRef.current === requestId) {
            setPositionAnalysis(analysis);
          }
        })
        .catch(() => undefined);
    }, 400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [currentFen, currentMoveList, fetchCachedPositionAnalysis, initialFen, mode, setPositionAnalysis]);

  // 2. Pre-fetch train move review if we step forward during training
  useEffect(() => {
    if (!activeDeckCard || historyIndex <= 0) {
      return undefined;
    }

    const moveIndex = historyIndex - 1;
    const answerFeedback =
      deckFeedback && !deckFeedback.pending
        ? {
            correct: deckFeedback.correct,
            playedUci: deckFeedback.playedUci,
            evalLossCp: deckFeedback.evalLossCp,
          }
        : null;

    if (!shouldUseLiveTrainMoveReview(activeDeckCard, moveHistory.slice(0, historyIndex), moveIndex, answerFeedback)) {
      return undefined;
    }

    const beforeMoveList = buildMoveUciHistory(moveHistory.slice(0, moveIndex));
    const beforeKey = getPositionCacheKey(initialFen, beforeMoveList, 'training');

    if (positionCacheRef.current.has(beforeKey)) {
      return undefined;
    }

    const beforeGame = restoreGameFromHistory(moveHistory.slice(0, historyIndex), initialFen, moveIndex);

    void fetchCachedPositionAnalysis(beforeKey, beforeGame.fen(), beforeMoveList, initialFen, 'training')
      .then(() => {
        setTrainAnalysisTick((tick) => tick + 1);
      })
      .catch(() => undefined);

    return undefined;
  }, [
    activeDeckCard,
    moveHistory,
    deckFeedback,
    fetchCachedPositionAnalysis,
    historyIndex,
    initialFen,
    setTrainAnalysisTick,
  ]);

  // 3. Pre-fetch all remaining trained moves once an answer is given
  useEffect(() => {
    if (!activeDeckCard || !deckFeedback || deckFeedback.pending) {
      return undefined;
    }

    for (let index = 0; index <= moveHistory.length; index += 1) {
      const moves = buildMoveUciHistory(moveHistory.slice(0, index));
      const cacheKey = getPositionCacheKey(initialFen, moves, 'training');

      if (positionCacheRef.current.has(cacheKey) || positionInFlightRef.current.has(cacheKey)) {
        continue;
      }

      const game = restoreGameFromHistory(moveHistory, initialFen, index);

      void fetchCachedPositionAnalysis(cacheKey, game.fen(), moves, initialFen, 'training')
        .then(() => {
          setTrainAnalysisTick((tick) => tick + 1);
        })
        .catch(() => undefined);
    }

    return undefined;
  }, [activeDeckCard, deckFeedback, fetchCachedPositionAnalysis, initialFen, moveHistory, setTrainAnalysisTick]);

  // 4. Preload ahead slightly in review mode
  useEffect(() => {
    if (mode === 'lines' || timelineLoading || moveHistory.length === 0 || historyIndex >= moveHistory.length) {
      return;
    }

    const timer = window.setTimeout(() => {
      const positionProfile: PositionAnalysisProfile = activeDeckCard ? 'training' : 'review';

      for (
        let index = historyIndex + 1;
        index <= Math.min(moveHistory.length, historyIndex + PRELOAD_AHEAD);
        index += 1
      ) {
        const moves = buildMoveUciHistory(moveHistory.slice(0, index));
        const cacheKey = getPositionCacheKey(initialFen, moves, positionProfile);

        if (positionCacheRef.current.has(cacheKey) || positionInFlightRef.current.has(cacheKey)) {
          continue;
        }

        const nextGame = restoreGameFromHistory(moveHistory, initialFen, index);
        void fetchCachedPositionAnalysis(cacheKey, nextGame.fen(), moves, initialFen, positionProfile).catch(
          () => undefined,
        );
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [activeDeckCard, fetchCachedPositionAnalysis, historyIndex, initialFen, mode, moveHistory, timelineLoading]);

  return {
    fetchCachedPositionAnalysis,
    analyzeTimelineDeep,
    clearEngineCache,
    positionCacheRef,
    positionInFlightRef,
    timelineBatchInFlightRef,
  };
}
