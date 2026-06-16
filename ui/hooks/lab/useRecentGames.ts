import { Chess } from 'chess.js';
import { useCallback, useEffect, useRef } from 'react';
import type { AnalysisResult } from '@/lib/analysis-types';
import type { StoredMove } from '@/lib/chess-analysis-client';
import type { ChessComRecentGameSummary, ChessComRecentGameTimeClass } from '@/lib/chesscom';
import {
  type CachedTimelineAnalysis,
  CHESSCOM_TIME_CLASS_COOKIE,
  CHESSCOM_USERNAME_COOKIE,
  formatRecentGameLogLabel,
  GAME_ANALYSIS_CACHE_VERSION,
  getRecentGameCacheKey,
  loadCachedTimelineAnalysis,
  logRecentGamePreload,
  RECENT_GAMES_PAGE_SIZE,
  readCookie,
  saveCachedTimelineAnalysis,
  toStoredMove,
  writeCookie,
} from '@/lib/lab-helpers';
import type { LabState } from '../useLabState';

export const RECENT_GAMES_INTERACTION_IDLE_MS = 3000;
export const RECENT_GAMES_AUTO_REFRESH_MS = 15000;

export const recentGameAnalysisInFlightCache = new Map<string, Promise<CachedTimelineAnalysis | null>>();
export const recentGameAnalysisMemoryCache = new Map<string, CachedTimelineAnalysis>();

export function useRecentGames(
  state: LabState,
  sharedRefs: {
    modeRef: React.MutableRefObject<string>;
    positionInFlightRef: React.MutableRefObject<Map<string, Promise<AnalysisResult>>>;
    lastReviewInteractionAtRef: React.MutableRefObject<number>;
  },
  dependencies: {
    analyzeTimelineDeep: (
      history: StoredMove[],
      initialFen: string | null,
      onProgress?: (progress: number) => void,
      logContext?: string,
      signal?: AbortSignal,
    ) => Promise<AnalysisResult[]>;
  },
) {
  const recentFetchRequestIdRef = useRef(0);
  const recentPreloadBusyRef = useRef(false);
  const recentPreloadedKeysRef = useRef(new Set<string>());
  const activeRecentGameCacheKeyRef = useRef<string | null>(null);
  const recentPreloadRequestIdRef = useRef(0);
  const recentPreloadAbortRef = useRef<AbortController | null>(null);
  const recentAutoFetchStartedRef = useRef(false);

  const {
    chesscomUsername,
    recentGameTimeClass,
    recentChessGamesNextCursor,
    recentChessGamesNextOffset,
    setRecentChessGamesLoading,
    setRecentChessGames,
    setRecentChessGamesHasMore,
    setRecentChessGamesNextCursor,
    setRecentChessGamesNextOffset,
    setRecentChessGamesError,
    positionLoading,
    recentChessGames,
    timelineLoading,
    setRecentPreloadTick,
    setChesscomUsername,
    setRecentGameTimeClass,
  } = state;

  const fetchRecentChessGames = useCallback(
    async (
      usernameOverride?: string,
      timeClassOverride?: ChessComRecentGameTimeClass,
      append = false,
      quiet = false,
    ) => {
      const requestId = ++recentFetchRequestIdRef.current;
      const username = (usernameOverride ?? chesscomUsername).trim().toLowerCase();
      const timeClass = timeClassOverride ?? recentGameTimeClass;
      const offset = append && !recentChessGamesNextCursor ? recentChessGamesNextOffset : 0;
      const cursor = append ? recentChessGamesNextCursor : null;

      if (!username) {
        setRecentChessGames([]);
        setRecentChessGamesHasMore(false);
        setRecentChessGamesNextOffset(0);
        setRecentChessGamesNextCursor(null);
        setRecentChessGamesError('Enter a Chess.com username.');
        return;
      }

      if (!quiet) {
        setRecentChessGamesLoading(true);
      }
      if (!append) {
        setRecentChessGamesError('');
      }

      try {
        writeCookie(CHESSCOM_USERNAME_COOKIE, username);
        writeCookie(CHESSCOM_TIME_CLASS_COOKIE, timeClass);
        const params = new URLSearchParams({
          username,
          timeClass,
          count: String(RECENT_GAMES_PAGE_SIZE),
          offset: String(offset),
        });

        if (cursor) {
          params.set('cursor', cursor);
        }

        const response = await fetch(`/api/chesscom/recent-games?${params.toString()}`);
        const payload = (await response.json()) as {
          error?: string;
          games?: ChessComRecentGameSummary[];
          hasMore?: boolean;
          nextCursor?: string | null;
          nextOffset?: number;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? `Chess.com fetch failed: HTTP ${response.status}`);
        }

        if (recentFetchRequestIdRef.current !== requestId) {
          return;
        }

        const nextGames = Array.isArray(payload.games) ? payload.games : [];
        setRecentChessGames((current) => {
          const merged = append ? [...current, ...nextGames] : nextGames;
          return [...new Map(merged.map((game) => [game.link || game.url, game])).values()].sort(
            (left, right) => Number(right.endTime ?? 0) - Number(left.endTime ?? 0),
          );
        });
        setRecentChessGamesHasMore(Boolean(payload.hasMore));
        setRecentChessGamesNextCursor(payload.nextCursor ?? null);
        setRecentChessGamesNextOffset(
          typeof payload.nextOffset === 'number' ? payload.nextOffset : offset + nextGames.length,
        );
      } catch (error) {
        if (recentFetchRequestIdRef.current !== requestId) {
          return;
        }
        setRecentChessGamesError(error instanceof Error ? error.message : 'Unable to fetch Chess.com games.');
      } finally {
        if (recentFetchRequestIdRef.current === requestId && !quiet) {
          setRecentChessGamesLoading(false);
        }
      }
    },
    [
      chesscomUsername,
      recentChessGamesNextCursor,
      recentChessGamesNextOffset,
      recentGameTimeClass,
      setRecentChessGames,
      setRecentChessGamesError,
      setRecentChessGamesHasMore,
      setRecentChessGamesLoading,
      setRecentChessGamesNextCursor,
      setRecentChessGamesNextOffset,
    ],
  );

  const preloadRecentGameAnalysis = useCallback(async () => {
    if (recentPreloadBusyRef.current) {
      return;
    }

    if (
      sharedRefs.modeRef.current !== 'review' ||
      document.visibilityState !== 'visible' ||
      timelineLoading ||
      positionLoading ||
      sharedRefs.positionInFlightRef.current.size > 0 ||
      Date.now() - sharedRefs.lastReviewInteractionAtRef.current < RECENT_GAMES_INTERACTION_IDLE_MS
    ) {
      return;
    }

    const nextGame = [...recentChessGames]
      .sort((left, right) => Number(right.endTime ?? 0) - Number(left.endTime ?? 0))
      .find((game) => {
        const cacheKey = getRecentGameCacheKey(game);
        return cacheKey !== activeRecentGameCacheKeyRef.current && !recentPreloadedKeysRef.current.has(cacheKey);
      });

    if (!nextGame?.pgn) {
      return;
    }

    const cacheKey = getRecentGameCacheKey(nextGame);
    recentPreloadedKeysRef.current.add(cacheKey);
    recentPreloadBusyRef.current = true;
    let requestId = 0;
    let preloadAbortController: AbortController | null = null;

    try {
      const cached = await loadCachedTimelineAnalysis(cacheKey);
      if (cached) {
        logRecentGamePreload('cache', `${formatRecentGameLogLabel(nextGame)} ${cached.timelineAnalyses.length} plies`);
        setRecentPreloadTick((tick) => tick + 1);
        return;
      }

      requestId = ++recentPreloadRequestIdRef.current;
      preloadAbortController = new AbortController();
      recentPreloadAbortRef.current = preloadAbortController;
      const preloadPromise = (async (): Promise<CachedTimelineAnalysis | null> => {
        const preloadGame = new Chess();
        preloadGame.loadPgn(nextGame.pgn);
        const nextInitialFen = preloadGame.header().FEN ?? null;
        const nextHistory = preloadGame.history({ verbose: true }).map(toStoredMove);

        if (nextHistory.length === 0) {
          return null;
        }

        logRecentGamePreload('start', `${formatRecentGameLogLabel(nextGame)} ${nextHistory.length} plies`);
        const sequence = await dependencies.analyzeTimelineDeep(
          nextHistory,
          nextInitialFen,
          undefined,
          `preload:${formatRecentGameLogLabel(nextGame)}`,
          preloadAbortController.signal,
        );

        if (recentPreloadRequestIdRef.current !== requestId) {
          return null;
        }

        const analysis = {
          quality: 'refined',
          version: GAME_ANALYSIS_CACHE_VERSION,
          preMoveAnalyses: sequence.slice(0, -1),
          timelineAnalyses: sequence.slice(1),
        } satisfies CachedTimelineAnalysis;

        await saveCachedTimelineAnalysis({
          cacheKey,
          gameLink: nextGame.link || nextGame.url,
          pgn: nextGame.pgn,
          preMoveAnalyses: analysis.preMoveAnalyses,
          timelineAnalyses: analysis.timelineAnalyses,
        });
        return analysis;
      })();

      recentGameAnalysisInFlightCache.set(cacheKey, preloadPromise);

      const analysis = await preloadPromise;
      if (analysis) {
        recentGameAnalysisMemoryCache.set(cacheKey, analysis);
        logRecentGamePreload('done', `${formatRecentGameLogLabel(nextGame)} ${analysis.timelineAnalyses.length} plies`);
      } else {
        logRecentGamePreload('skip', `${formatRecentGameLogLabel(nextGame)} stale`);
      }
      setRecentPreloadTick((tick) => tick + 1);
    } catch (error) {
      recentPreloadedKeysRef.current.delete(cacheKey);
      const message = error instanceof Error ? error.message : String(error);
      logRecentGamePreload(
        message === 'Analysis aborted.' ? 'cancel' : 'fail',
        `${formatRecentGameLogLabel(nextGame)} ${message}`,
      );
    } finally {
      if (requestId === 0 || recentPreloadRequestIdRef.current === requestId) {
        recentPreloadBusyRef.current = false;
        if (preloadAbortController && recentPreloadAbortRef.current === preloadAbortController) {
          recentPreloadAbortRef.current = null;
        }
      }
      recentGameAnalysisInFlightCache.delete(cacheKey);
    }
  }, [dependencies, positionLoading, recentChessGames, sharedRefs, timelineLoading, setRecentPreloadTick]);

  const cancelRecentPreload = useCallback((reason: string) => {
    if (recentPreloadAbortRef.current) {
      recentPreloadAbortRef.current.abort();
      recentPreloadAbortRef.current = null;
    }
    const hadPreload = recentPreloadBusyRef.current;
    recentPreloadBusyRef.current = false;

    if (hadPreload) {
      logRecentGamePreload('cancel', reason);
    }
  }, []);

  useEffect(() => {
    const savedUsername = readCookie(CHESSCOM_USERNAME_COOKIE);
    const savedTimeClass = readCookie(CHESSCOM_TIME_CLASS_COOKIE);

    if (savedUsername) {
      setChesscomUsername(savedUsername);
    }

    if (
      savedTimeClass === 'all' ||
      savedTimeClass === 'bullet' ||
      savedTimeClass === 'blitz' ||
      savedTimeClass === 'rapid'
    ) {
      setRecentGameTimeClass(savedTimeClass);
    }
  }, [setChesscomUsername, setRecentGameTimeClass]);

  useEffect(() => {
    const username = chesscomUsername.trim().toLowerCase();

    if (!username || recentAutoFetchStartedRef.current) {
      return;
    }

    recentAutoFetchStartedRef.current = true;
    void fetchRecentChessGames(username, recentGameTimeClass, false, true);
  }, [chesscomUsername, fetchRecentChessGames, recentGameTimeClass]);

  useEffect(() => {
    if (!chesscomUsername.trim()) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      if (sharedRefs.modeRef.current !== 'review' || document.visibilityState !== 'visible') {
        return;
      }

      void fetchRecentChessGames(undefined, undefined, false, true);
    }, RECENT_GAMES_AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [chesscomUsername, fetchRecentChessGames, sharedRefs]);

  return {
    fetchRecentChessGames,
    preloadRecentGameAnalysis,
    cancelRecentPreload,
    activeRecentGameCacheKeyRef,
  };
}
