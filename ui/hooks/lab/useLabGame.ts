import { useCallback } from 'react';
import type { LabState } from '../useLabState';
import { Chess, type Square } from 'chess.js';
import type { CSSProperties } from 'react';
import type { StoredMove } from '@/lib/chess-analysis-client';
import {
  toStoredMove,
  restoreGameFromHistory,
  formatBestMove,
} from '@/lib/chess-analysis-client';
import { getMoveSoundSequence } from '@/lib/chess-sounds';
import {
  buildPendingDeckFeedback,
  finalizeDeckFeedback,
} from '@/lib/opening-training';
import { applyDeckAttempt } from '@/lib/deck-progress';
import { chooseWeightedOpponentEdge, buildDrillPath } from '@/lib/opening-tree';

const DRILL_OPPONENT_DELAY_MS = 600;
const TRAINING_REPLAY_MOVE_MS = 300;

export function useLabGame(
  state: LabState,
  context: {
    advanceDrillToStepRef: React.MutableRefObject<(stepIndex: number) => void>;
    playSoundSequence: (keys: any[]) => void;
    playSound: (key: any) => void;
    saveTrainingAttempt: (card: any, feedback: any) => Promise<void>;
    timelineRefineRequestIdRef: React.MutableRefObject<number>;
    deckCardPromptStartedAtRef: React.MutableRefObject<number | null>;
    modeRef: React.MutableRefObject<any>;
    drillPathRef: React.MutableRefObject<any[]>;
    drillPathIndexRef: React.MutableRefObject<number>;
  }
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
    positionAnalysis,
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
    setInitialFen,
    setActiveOpeningNodeId,
    setDeckProgress,
  } = state;

  const {
    advanceDrillToStepRef,
    playSoundSequence,
    playSound,
    saveTrainingAttempt,
    timelineRefineRequestIdRef,
    deckCardPromptStartedAtRef,
    modeRef,
    drillPathRef,
    drillPathIndexRef,
  } = context;

  const currentFen = game.fen();
  const hasLoadedGame = moveHistory.length > 0 || initialFen != null;

  const clearSelection = useCallback(() => {
    setSelectedSquare(null);
    setSquareStyles({});
  }, [setSelectedSquare, setSquareStyles]);

  const clearVariation = useCallback(() => {
    setVariationBaseIndex(null);
    setVariationMoves([]);
  }, [setVariationBaseIndex, setVariationMoves]);

  const highlightMoves = useCallback((square: string) => {
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
  }, [game, setSquareStyles]);

  const commitMove = useCallback(
    (nextGame: Chess, move: StoredMove) => {
      if (deckPlaybackBusy) {
        return;
      }

      if (modeRef.current === 'lines' && activeOpeningNodeId) {
        let expectedUci = openingDrillExpected?.uci ?? positionAnalysis?.bestMove ?? null;
        let expectedSan = openingDrillExpected?.san ?? (expectedUci ? formatBestMove(currentFen, expectedUci) : null);
        let correct = expectedUci ? move.uci === expectedUci : true;
        const nodeId = activeOpeningNodeId;
        let isAlternativeValid = false;
        let newActiveNodeId = nodeId;

        if (activeOpeningTree && activeOpeningNodeId && !correct) {
          const outgoing = activeOpeningTree.edges.filter(e => e.fromNodeId === activeOpeningNodeId);
          const altEdge = outgoing.find(e => e.uci === move.uci);
          if (altEdge) {
            const targetNode = activeOpeningTree.nodes.find(n => n.id === altEdge.toNodeId);
            if (targetNode) {
              isAlternativeValid = true;
              correct = true;
              expectedUci = move.uci;
              expectedSan = move.san;
              newActiveNodeId = targetNode.id;
            }
          }
        }

        setMoveHistory(prev => [...prev, move]);
        setHistoryIndex(prev => prev + 1);
        clearVariation();
        setGame(nextGame);
        setPositionAnalysis(null);
        setServerError('');
        setSelectedSquare(null);
        setSquareStyles({});
        setOpeningDrillExpected(null);

        if (correct) {
          setDeckFeedback(null);
          setDeckFeedbackArrowsVisible(false);
          setShowArrow(false);
        } else if (expectedSan && expectedUci) {
          setDeckFeedback({
            correct: false,
            exact: false,
            playedSan: move.san,
            playedUci: move.uci,
            expectedSan,
            expectedUci,
            validationMode: 'strict_best',
            pending: false,
          });
          setDeckFeedbackArrowsVisible(true);
          setShowArrow(true);
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
          body: JSON.stringify({ action: 'attempt', nodeId, playedUci: move.uci, expectedUci, correct }),
        });

        if (openingDrillActive && drillPathRef.current.length > 0) {
          let currentPathIndex = drillPathIndexRef.current;
          let nextStepIndex = currentPathIndex + 1;

          if (isAlternativeValid && activeOpeningTree) {
            const newPath = buildDrillPath(activeOpeningTree, { seed: Date.now(), startNodeId: newActiveNodeId });
            if (newPath.length > 0) {
              drillPathRef.current = newPath;
              drillPathIndexRef.current = 0;
              currentPathIndex = 0;
              nextStepIndex = 1;
            }
          }

          if (correct) {
            setOpeningDrillStatus(isAlternativeValid ? 'Alternative valid.' : 'Correct.');

            window.setTimeout(() => {
              advanceDrillToStepRef.current(nextStepIndex);
            }, DRILL_OPPONENT_DELAY_MS);
          } else {
            setOpeningDrillStatus(`Miss. Best was ${expectedSan ?? expectedUci ?? 'unknown'}. Continuing...`);

            window.setTimeout(() => {
              const correctStep = drillPathRef.current[nextStepIndex];
              if (correctStep && correctStep.edgeUciFromParent) {
                const prevGame = new Chess(drillPathRef.current[currentPathIndex].fen);
                try {
                  const correctMove = prevGame.move({
                    from: correctStep.edgeUciFromParent.substring(0, 2),
                    to: correctStep.edgeUciFromParent.substring(2, 4),
                    promotion: correctStep.edgeUciFromParent.length === 5 ? correctStep.edgeUciFromParent[4] : undefined
                  });
                  if (correctMove) {
                    setGame(prevGame);
                    setMoveHistory(prev => [...prev.slice(0, -1), toStoredMove(correctMove)]);
                  }
                } catch (e) {
                  // Fallback if anything goes wrong
                }
              }
              advanceDrillToStepRef.current(nextStepIndex);
            }, DRILL_OPPONENT_DELAY_MS + 500);
          }
        } else {
          const nextNodeEdge = activeOpeningTree?.edges.find(edge => edge.fromNodeId === nodeId && edge.uci === (expectedUci ?? move.uci));
          const nextNode = nextNodeEdge ? activeOpeningTree?.nodes.find(node => node.id === nextNodeEdge.toNodeId) ?? null : null;

          setOpeningDrillStatus(correct ? 'Correct.' : `Miss. Best was ${expectedSan ?? expectedUci ?? 'unknown'}.`);

          if (nextNode) {
            setActiveOpeningNodeId(nextNode.id);

            if (nextNode.sideToMove === nextNode.trainSide) {
              window.setTimeout(() => {
                setInitialFen(nextNode.fen);
                setMoveHistory([]);
                setHistoryIndex(0);
                setGame(new Chess(nextNode.fen));
                setOpeningDrillExpected({ nodeId: nextNode.id, uci: nextNode.bestUci, san: nextNode.bestSan });
                setOpeningDrillStatus('Next node. Find the best move.');
              }, DRILL_OPPONENT_DELAY_MS);
            } else {
              const opponentEdges = activeOpeningTree?.edges.filter(edge => edge.fromNodeId === nextNode.id) ?? [];
              const opponentEdge = chooseWeightedOpponentEdge(opponentEdges, Date.now());
              const afterOpponent = opponentEdge ? activeOpeningTree?.nodes.find(node => node.id === opponentEdge.toNodeId) ?? null : null;

              if (afterOpponent) {
                window.setTimeout(() => {
                  setInitialFen(afterOpponent.fen);
                  setMoveHistory([]);
                  setHistoryIndex(0);
                  setGame(new Chess(afterOpponent.fen));
                  setActiveOpeningNodeId(afterOpponent.id);
                  setOpeningDrillExpected({ nodeId: afterOpponent.id, uci: afterOpponent.bestUci, san: afterOpponent.bestSan });
                  setOpeningDrillStatus(`Opponent played ${opponentEdge?.san ?? 'a branch'}. Find the best move.`);
                }, DRILL_OPPONENT_DELAY_MS);
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
          state.setDeckProgress(progress => applyDeckAttempt(progress, activeDeckCard.id, gradedFeedback.correct, seenAt, attemptQuality));
        }
        void saveTrainingAttempt(activeDeckCard, gradedFeedback);
      }
    },
    [activeDeckCard, activeOpeningNodeId, activeOpeningTree, advanceDrillToStepRef, clearVariation, currentFen, deckCardPromptStartedAtRef, deckFeedback, deckPlaybackBusy, drillPathIndexRef, drillPathRef, hasLoadedGame, historyIndex, modeRef, moveHistory, openingDrillActive, openingDrillExpected, playSoundSequence, positionAnalysis?.bestMove, saveTrainingAttempt, setActiveOpeningNodeId, setDeckFeedback, setDeckFeedbackArrowsVisible, setGame, setHistoryIndex, setInitialFen, setMoveHistory, setOpeningDrillExpected, setOpeningDrillStatus, setPositionAnalysis, setServerError, setSelectedSquare, setSquareStyles, setShowArrow, setTimelineAnalyses, setTimelineError, setVariationBaseIndex, setVariationMoves, state, timelineRefineRequestIdRef, trainAllSession, variationBaseIndex, variationMoves]
  );

  const tryMove = useCallback(
    (from: string, to: string, promotion = 'q') => {
      if (deckPlaybackBusy) {
        return false;
      }

      if (openingDrillActive && historyIndex < moveHistory.length) {
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
    [commitMove, currentFen, deckPlaybackBusy, historyIndex, moveHistory.length, openingDrillActive, playSound],
  );

  const jumpToIndex = useCallback((index: number) => {
    const boundedIndex = Math.max(0, Math.min(index, moveHistory.length));
    const nextGame = restoreGameFromHistory(moveHistory, initialFen, boundedIndex);

    setHistoryIndex(boundedIndex);
    if (activeDeckCard) {
      setDeckFeedbackArrowsVisible(false);
    }
    clearVariation();
    setGame(nextGame);
    clearSelection();
  }, [activeDeckCard, clearSelection, clearVariation, initialFen, moveHistory, setDeckFeedbackArrowsVisible, setGame, setHistoryIndex]);

  return {
    clearSelection,
    clearVariation,
    highlightMoves,
    commitMove,
    tryMove,
    jumpToIndex,
  };
}
