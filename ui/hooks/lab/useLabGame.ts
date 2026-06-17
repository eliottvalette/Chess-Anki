import { Chess, type Square } from 'chess.js';
import type { CSSProperties } from 'react';
import { useCallback } from 'react';
import type { WorkspaceMode } from '@/lib/analysis-types';
import type { StoredMove } from '@/lib/chess-analysis-client';
import { formatBestMove, restoreGameFromHistory, toStoredMove } from '@/lib/chess-analysis-client';
import { type ChessSoundKey, getMoveSoundSequence } from '@/lib/chess-sounds';
import { applyDeckAttempt } from '@/lib/deck-progress';
import {
  buildPendingDeckFeedback,
  type DeckCard,
  type DeckFeedback,
  finalizeDeckFeedback,
} from '@/lib/opening-training';
import {
  buildDrillPath,
  buildOpeningDrillExpected,
  chooseWeightedOpponentEdge,
  classifyLinesMove,
  type DrillPathStep,
} from '@/lib/opening-tree';
import type { LabState } from '../useLabState';
import type { useLinesSession } from './useLinesSession';

const DRILL_OPPONENT_DELAY_MS = 600;

type LinesSessionApi = ReturnType<typeof useLinesSession>;

export function useLabGame(
  state: LabState,
  context: {
    advanceDrillToStepRef: React.MutableRefObject<
      (stepIndex: number, options?: { isOpponentMovePlayback?: boolean; syncOnly?: boolean }) => void
    >;
    cancelDrillOpponentMoveRef?: React.MutableRefObject<() => void>;
    linesGameTimeoutRef: React.MutableRefObject<number | null>;
    playSoundSequence: (keys: ChessSoundKey[]) => void;
    playSound: (key: ChessSoundKey) => void;
    saveTrainingAttempt: (card: DeckCard, feedback: DeckFeedback) => Promise<void>;
    timelineRefineRequestIdRef: React.MutableRefObject<number>;
    deckCardPromptStartedAtRef: React.MutableRefObject<number | null>;
    modeRef: React.MutableRefObject<WorkspaceMode>;
    drillPathRef: React.MutableRefObject<DrillPathStep[]>;
    drillPathIndexRef: React.MutableRefObject<number>;
    linesSession: LinesSessionApi;
  },
) {
  const {
    game,
    historyIndex,
    moveHistory,
    variationBaseIndex,
    variationMoves,
    activeDeckCard,
    deckFeedback,
    deckPlaybackBusy,
    openingDrillActive,
    openingDrillExpected,
    activeOpeningNodeId,
    activeOpeningTree,
    trainAllSession,
    initialFen,
    setVariationBaseIndex,
    setVariationMoves,
    setGame,
    setPositionAnalysis,
    setServerError,
    setSelectedSquare,
    setSquareStyles,
    setMoveHistory,
    setHistoryIndex,
    setTimelineAnalyses,
    setTimelineError,
    setDeckFeedbackArrowsVisible,
    setOpeningDrillExpected,
    setDeckFeedback,
    setShowArrow,
    setOpeningDrillStatus,
    setActiveOpeningNodeId,
  } = state;

  const {
    advanceDrillToStepRef,
    cancelDrillOpponentMoveRef,
    linesGameTimeoutRef,
    playSoundSequence,
    playSound,
    saveTrainingAttempt,
    timelineRefineRequestIdRef,
    deckCardPromptStartedAtRef,
    modeRef,
    drillPathRef,
    drillPathIndexRef,
    linesSession,
  } = context;

  const currentFen = game.fen();
  const hasLoadedGame = moveHistory.length > 0 || initialFen != null;

  const scheduleLinesOpponentAction = useCallback(
    (action: () => void) => {
      if (linesGameTimeoutRef.current != null) {
        window.clearTimeout(linesGameTimeoutRef.current);
      }

      linesGameTimeoutRef.current = window.setTimeout(() => {
        linesGameTimeoutRef.current = null;
        action();
      }, DRILL_OPPONENT_DELAY_MS);
    },
    [linesGameTimeoutRef],
  );

  const clearSelection = useCallback(() => {
    setSelectedSquare(null);
    setSquareStyles({});
  }, [setSelectedSquare, setSquareStyles]);

  const clearVariation = useCallback(() => {
    setVariationBaseIndex(null);
    setVariationMoves([]);
  }, [setVariationBaseIndex, setVariationMoves]);

  const highlightMoves = useCallback(
    (square: string) => {
      const nextStyles: Record<string, CSSProperties> = {
        [square]: {
          boxShadow: 'inset 0 0 0 3px rgba(152, 184, 255, 0.9)',
          backgroundColor: 'rgba(152, 184, 255, 0.18)',
        },
      };

      const moves = game.moves({ square: square as Square, verbose: true });

      for (const move of moves) {
        nextStyles[move.to] = game.get(move.to as Square)
          ? {
              boxShadow: 'inset 0 0 0 2px rgba(242, 243, 245, 0.34)',
              background:
                'radial-gradient(circle, rgba(152, 184, 255, 0.28) 0%, rgba(152, 184, 255, 0.08) 54%, transparent 56%)',
            }
          : {
              background:
                'radial-gradient(circle, rgba(242, 243, 245, 0.5) 0%, rgba(242, 243, 245, 0.32) 16%, transparent 18%)',
            };
      }

      setSquareStyles(nextStyles);
    },
    [game, setSquareStyles],
  );

  const commitMove = useCallback(
    (nextGame: Chess, move: StoredMove) => {
      if (deckPlaybackBusy) {
        return;
      }

      if (modeRef.current === 'lines' && activeOpeningNodeId && activeOpeningTree) {
        const nodeId = activeOpeningNodeId;
        const drillExpected = openingDrillExpected;
        const acceptedMoves = drillExpected?.acceptedUcis ?? [];
        const primaryUci = drillExpected?.uci ?? null;
        const primarySan = drillExpected?.san ?? (primaryUci ? formatBestMove(currentFen, primaryUci) : null);
        const linesClassification = classifyLinesMove(activeOpeningTree, nodeId, move.uci, {
          primaryUci,
          acceptedUcis: acceptedMoves,
        });
        const correct = linesClassification.category !== 'miss';
        const exact = linesClassification.category === 'best';
        const matchingEdge = activeOpeningTree.edges.find(
          (edge) => edge.fromNodeId === nodeId && edge.uci === move.uci,
        );
        const truncatedHistory =
          historyIndex < moveHistory.length ? [...moveHistory.slice(0, historyIndex), move] : [...moveHistory, move];
        const nextHistoryIndex = truncatedHistory.length;

        setMoveHistory(truncatedHistory);
        setHistoryIndex(nextHistoryIndex);
        clearVariation();
        setGame(nextGame);
        setPositionAnalysis(null);
        setServerError('');
        setSelectedSquare(null);
        setSquareStyles({});

        if (correct) {
          setOpeningDrillExpected(null);
          setDeckFeedback({
            correct: true,
            exact,
            playedSan: move.san,
            playedUci: move.uci,
            expectedSan: primarySan ?? move.san,
            expectedUci: primaryUci ?? move.uci,
            validationMode: 'strict_best',
            pending: false,
          });
          setDeckFeedbackArrowsVisible(false);
          setShowArrow(false);
        } else if (primarySan && primaryUci) {
          setDeckFeedback({
            correct: false,
            exact: false,
            playedSan: move.san,
            playedUci: move.uci,
            expectedSan: primarySan,
            expectedUci: primaryUci,
            validationMode: 'strict_best',
            pending: false,
          });
          setDeckFeedbackArrowsVisible(false);
          setShowArrow(false);
        }

        playSoundSequence(
          getMoveSoundSequence({
            move,
            isSelfMove: true,
            isCheck: nextGame.isCheck(),
            isCheckmate: nextGame.isCheckmate(),
            isGameOver: nextGame.isGameOver(),
          }),
        );

        void fetch('/api/opening-trees', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'attempt',
            nodeId,
            playedUci: move.uci,
            expectedUci: primaryUci,
            correct,
          }),
        });

        if (openingDrillActive && drillPathRef.current.length > 0) {
          if (correct) {
            let nextStepIndex = drillPathIndexRef.current + 1;

            if (matchingEdge) {
              const targetNodeId = matchingEdge.toNodeId;
              const nextStep = drillPathRef.current[nextStepIndex];

              if (!nextStep || nextStep.nodeId !== targetNodeId) {
                const newPath = buildDrillPath(activeOpeningTree, {
                  trainSide: state.activeTrainSide,
                  preferWeak: true,
                  seed: Date.now(),
                  startNodeId: targetNodeId,
                });

                if (newPath.length > 0) {
                  drillPathRef.current = newPath;
                  drillPathIndexRef.current = 0;
                  nextStepIndex = 0;
                }
              }

              setActiveOpeningNodeId(targetNodeId);
              setOpeningDrillStatus(linesClassification.category === 'best' ? 'Correct.' : 'Book move.');

              if (matchingEdge) {
                linesSession.markEdgeSeen(nodeId, matchingEdge.id);
              }

              scheduleLinesOpponentAction(() => {
                advanceDrillToStepRef.current(nextStepIndex);
              });
            } else {
              setOpeningDrillStatus('Book move accepted. No continuation in this tree.');
            }
          } else {
            setOpeningDrillStatus(
              `Miss. Best was ${primarySan ?? primaryUci ?? 'unknown'}. Use undo (left arrow) to retry.`,
            );
          }
        } else if (correct && matchingEdge) {
          const nextNode = activeOpeningTree.nodes.find((node) => node.id === matchingEdge.toNodeId) ?? null;

          if (nextNode) {
            setActiveOpeningNodeId(nextNode.id);

            if (nextNode.sideToMove !== state.activeTrainSide) {
              const opponentEdges = activeOpeningTree.edges.filter((edge) => edge.fromNodeId === nextNode.id);
              const opponentEdge = chooseWeightedOpponentEdge(opponentEdges, Date.now());
              const afterOpponent = opponentEdge
                ? (activeOpeningTree.nodes.find((node) => node.id === opponentEdge.toNodeId) ?? null)
                : null;

              if (afterOpponent && opponentEdge) {
                scheduleLinesOpponentAction(() => {
                  setGame((prevGame) => {
                    const nextGame = new Chess(prevGame.fen());
                    try {
                      const oppMove = nextGame.move({
                        from: opponentEdge.uci.substring(0, 2),
                        to: opponentEdge.uci.substring(2, 4),
                        promotion: opponentEdge.uci.length === 5 ? opponentEdge.uci[4] : undefined,
                      });
                      if (oppMove) {
                        setMoveHistory((prev) => [...prev, toStoredMove(oppMove)]);
                        setHistoryIndex((prev) => prev + 1);
                        playSoundSequence(
                          getMoveSoundSequence({
                            move: toStoredMove(oppMove),
                            isSelfMove: false,
                            isCheck: nextGame.isCheck(),
                            isCheckmate: nextGame.isCheckmate(),
                            isGameOver: nextGame.isGameOver(),
                          }),
                        );
                      }
                    } catch {
                      // Fallback
                    }
                    return nextGame;
                  });
                  setActiveOpeningNodeId(afterOpponent.id);
                });
              }
            }
          }
        }

        return;
      }

      if (hasLoadedGame && !activeDeckCard) {
        const baseIndex = variationBaseIndex ?? historyIndex;
        const nextVariationMoves = [...variationMoves, move];

        setVariationBaseIndex(baseIndex);
        setVariationMoves(nextVariationMoves);
        setGame(nextGame);
        setPositionAnalysis(null);
        setServerError('');
        setSelectedSquare(null);
        setSquareStyles({});
        playSoundSequence(
          getMoveSoundSequence({
            move,
            isSelfMove: true,
            isCheck: nextGame.isCheck(),
            isCheckmate: nextGame.isCheckmate(),
            isGameOver: nextGame.isGameOver(),
          }),
        );
        return;
      }

      const nextHistory = [...moveHistory.slice(0, historyIndex), move];

      setMoveHistory(nextHistory);
      setHistoryIndex(nextHistory.length);
      clearVariation();
      setGame(nextGame);
      setPositionAnalysis(null);
      setTimelineAnalyses([]);
      timelineRefineRequestIdRef.current += 1;
      setServerError('');
      setTimelineError('');
      setSelectedSquare(null);
      setSquareStyles({});
      if (activeDeckCard && deckFeedback != null && !deckFeedback.pending) {
        setDeckFeedbackArrowsVisible(false);
      }
      playSoundSequence(
        getMoveSoundSequence({
          move,
          isSelfMove: true,
          isCheck: nextGame.isCheck(),
          isCheckmate: nextGame.isCheckmate(),
          isGameOver: nextGame.isGameOver(),
        }),
      );

      if (activeDeckCard && deckFeedback == null) {
        const nextFeedback = buildPendingDeckFeedback(activeDeckCard, move.uci, move.san);
        const gradedFeedback = finalizeDeckFeedback(activeDeckCard, nextFeedback);
        setDeckFeedback(gradedFeedback);
        setDeckFeedbackArrowsVisible(!gradedFeedback.correct);
        setShowArrow(true);
        if (!trainAllSession) {
          const promptStartedAt = deckCardPromptStartedAtRef.current;
          const responseMs = promptStartedAt == null ? null : Date.now() - promptStartedAt;
          const attemptQuality = {
            responseMs,
            exact: gradedFeedback.exact,
            evalLossCp: gradedFeedback.evalLossCp ?? null,
          };
          const seenAt = new Date().toISOString();
          // Assuming setDeckProgress takes a callback in the actual LabState, but here we just leave it for now.
          state.setDeckProgress((progress) =>
            applyDeckAttempt(progress, activeDeckCard.id, gradedFeedback.correct, seenAt, attemptQuality),
          );
        }
        void saveTrainingAttempt(activeDeckCard, gradedFeedback);
      }
    },
    [
      activeDeckCard,
      activeOpeningNodeId,
      activeOpeningTree,
      advanceDrillToStepRef,
      clearVariation,
      currentFen,
      deckCardPromptStartedAtRef,
      deckFeedback,
      deckPlaybackBusy,
      drillPathIndexRef,
      drillPathRef,
      hasLoadedGame,
      historyIndex,
      linesSession,
      modeRef,
      moveHistory,
      openingDrillActive,
      openingDrillExpected,
      playSoundSequence,
      saveTrainingAttempt,
      scheduleLinesOpponentAction,
      setActiveOpeningNodeId,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setGame,
      setHistoryIndex,
      setMoveHistory,
      setOpeningDrillExpected,
      setOpeningDrillStatus,
      setPositionAnalysis,
      setServerError,
      setSelectedSquare,
      setSquareStyles,
      setShowArrow,
      setTimelineAnalyses,
      setTimelineError,
      setVariationBaseIndex,
      setVariationMoves,
      state,
      timelineRefineRequestIdRef,
      trainAllSession,
      variationBaseIndex,
      variationMoves,
    ],
  );

  const tryMove = useCallback(
    (from: string, to: string, promotion = 'q') => {
      if (deckPlaybackBusy) {
        return false;
      }

      if (openingDrillActive && openingDrillExpected == null && deckFeedback == null) {
        return false;
      }

      if (openingDrillActive && openingDrillExpected == null && deckFeedback != null && !deckFeedback.pending) {
        return false;
      }

      const nextGame = new Chess(currentFen);
      const move = (() => {
        try {
          return nextGame.move({ from, to, promotion });
        } catch {
          return null;
        }
      })();

      if (!move) {
        playSound('illegal');
        return false;
      }

      commitMove(nextGame, toStoredMove(move));
      return true;
    },
    [
      commitMove,
      currentFen,
      deckFeedback,
      deckPlaybackBusy,
      historyIndex,
      moveHistory.length,
      openingDrillActive,
      openingDrillExpected,
      playSound,
      scheduleLinesOpponentAction,
    ],
  );

  const jumpToIndex = useCallback(
    (index: number, options: { playForwardSound?: boolean } = {}) => {
      cancelDrillOpponentMoveRef?.current?.();

      if (linesGameTimeoutRef.current != null) {
        window.clearTimeout(linesGameTimeoutRef.current);
        linesGameTimeoutRef.current = null;
      }

      const boundedIndex = Math.max(0, Math.min(index, moveHistory.length));
      const nextGame = restoreGameFromHistory(moveHistory, initialFen, boundedIndex);

      if (options.playForwardSound && boundedIndex > historyIndex && boundedIndex <= moveHistory.length) {
        const replayedMove = moveHistory[boundedIndex - 1];

        if (replayedMove) {
          playSoundSequence(
            getMoveSoundSequence({
              move: replayedMove,
              isSelfMove: replayedMove.color === (state.activeTrainSide === 'white' ? 'w' : 'b'),
              isCheck: nextGame.isCheck(),
              isCheckmate: nextGame.isCheckmate(),
              isGameOver: nextGame.isGameOver(),
            }),
          );
        }
      }

      setHistoryIndex(boundedIndex);
      setDeckFeedback(null);
      setDeckFeedbackArrowsVisible(false);
      setShowArrow(false);
      clearVariation();
      setGame(nextGame);
      clearSelection();

      if (openingDrillActive && activeOpeningTree) {
        const synced = linesSession.resyncFromHistory(
          activeOpeningTree,
          moveHistory,
          boundedIndex,
          state.activeTrainSide,
        );

        setActiveOpeningNodeId(synced.nodeId);

        if (synced.isTrainTurn && synced.nodeId) {
          const drillExpected = buildOpeningDrillExpected(activeOpeningTree, synced.nodeId);
          setOpeningDrillExpected(drillExpected);
        } else {
          setOpeningDrillExpected(null);
        }

        if (drillPathRef.current.length > 0) {
          const rootLength = activeOpeningTree.rootPly ?? activeOpeningTree.rootSan.length;

          if (boundedIndex >= rootLength) {
            const stepIndex = boundedIndex - rootLength;
            advanceDrillToStepRef.current(stepIndex, { syncOnly: true });
          }
        }
      }
    },
    [
      activeOpeningTree,
      clearSelection,
      clearVariation,
      historyIndex,
      initialFen,
      linesSession,
      moveHistory,
      openingDrillActive,
      advanceDrillToStepRef,
      cancelDrillOpponentMoveRef,
      drillPathRef,
      linesGameTimeoutRef,
      playSoundSequence,
      setActiveOpeningNodeId,
      setDeckFeedback,
      setDeckFeedbackArrowsVisible,
      setGame,
      setHistoryIndex,
      setOpeningDrillExpected,
      setShowArrow,
      state.activeTrainSide,
    ],
  );

  const undoMove = useCallback(() => {
    if (historyIndex === 0) {
      return;
    }

    jumpToIndex(historyIndex - 1);
  }, [historyIndex, jumpToIndex]);

  return {
    clearSelection,
    clearVariation,
    highlightMoves,
    commitMove,
    tryMove,
    jumpToIndex,
    undoMove,
  };
}
