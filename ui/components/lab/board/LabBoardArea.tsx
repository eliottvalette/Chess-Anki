import type { Square } from 'chess.js';
import dynamic from 'next/dynamic';
import type { CSSProperties } from 'react';
import styles from '../../chess-analysis-lab.module.css';
import { useLab } from '../LabContext';
import { ArrowIcon, FlipIcon, ImportIcon, RefreshIcon, ResetIcon } from '../lab-icons';
import { BoardPlayerBar } from './BoardPlayerBar';

const Chessboard = dynamic(() => import('@/components/chessboard-client'), {
  ssr: false,
  loading: () => <div className={styles.boardFallback}>Loading board...</div>,
});

export function LabBoardArea() {
  const {
    labState,
    boardStageRef,
    evalRailRef,
    whiteAdvantage,
    boardScoreLabel,
    topBoardPlayer,
    bottomBoardPlayer,
    boardReviewBadge,
    currentFen,
    tryMove,
    clearSelection,
    highlightMoves,
    boardSquareStyles,
    boardArrows,
    runTimelineAnalysis,
    resetWorkspace,
    isTrainCardFinished,
  } = useLab();

  return (
    <section className={`${styles.panel} ${styles.boardPanel}`}>
      <div className={styles.boardWorkspace}>
        <div className={styles.boardTools} role="toolbar" aria-label="Board tools">
          <button
            className={styles.iconButton}
            onClick={() => labState.setPgnDialogOpen(true)}
            title="Import PGN"
            type="button"
          >
            <ImportIcon />
          </button>
          <button
            className={styles.iconButton}
            onClick={() => labState.setOrientation((value) => (value === 'white' ? 'black' : 'white'))}
            title="Flip board"
            type="button"
          >
            <FlipIcon />
          </button>
          <button
            className={styles.iconButton}
            onClick={() => labState.setShowArrow((value) => !value)}
            disabled={Boolean(labState.activeDeckCard && !isTrainCardFinished)}
            title={
              labState.activeDeckCard && !isTrainCardFinished
                ? 'Best arrow hidden during deck review'
                : labState.showArrow
                  ? 'Hide best arrow'
                  : 'Show best arrow'
            }
            type="button"
          >
            <ArrowIcon off={!labState.showArrow || Boolean(labState.activeDeckCard && !isTrainCardFinished)} />
          </button>
          <button
            className={styles.iconButton}
            onClick={() => void runTimelineAnalysis()}
            disabled={labState.timelineLoading || labState.moveHistory.length === 0}
            title="Refresh analysis"
            type="button"
          >
            <RefreshIcon />
          </button>
          <button className={styles.iconButton} onClick={resetWorkspace} title="Reset board" type="button">
            <ResetIcon />
          </button>
        </div>

        <div className={styles.boardStage} ref={boardStageRef}>
          <div className={styles.evalRail} ref={evalRailRef}>
            <div
              className={`${styles.evalShell} ${labState.orientation === 'black' ? styles.evalShellFlipped : ''}`}
              style={{ ['--white-share' as string]: `${whiteAdvantage}%` }}
            >
              <div className={styles.evalBlack} />
              <div className={styles.evalWhite} />
              <div className={styles.evalDivider} />
            </div>
            <div className={styles.evalCopy}>
              <span className={styles.score}>{boardScoreLabel}</span>
            </div>
          </div>

          <div className={styles.boardStack} style={{ width: `${labState.boardWidth}px` }}>
            <BoardPlayerBar player={topBoardPlayer} />
            <div
              className={styles.boardFrame}
              style={{ width: `${labState.boardWidth}px`, height: `${labState.boardWidth}px` }}
            >
              <Chessboard
                options={{
                  id: 'analysis-board',
                  position: currentFen,
                  boardOrientation: labState.orientation,
                  boardStyle: {
                    width: `${labState.boardWidth}px`,
                    maxWidth: '100%',
                    height: `${labState.boardWidth}px`,
                    borderRadius: '10px',
                  },
                  onPieceDrop: ({ sourceSquare, targetSquare }) =>
                    targetSquare ? tryMove(sourceSquare, targetSquare) : false,
                  onSquareClick: ({ square }) => {
                    if (labState.selectedSquare) {
                      const movePlayed = tryMove(labState.selectedSquare, square);

                      if (!movePlayed) {
                        clearSelection();
                      }

                      return;
                    }

                    const piece = labState.game.get(square as Square);

                    if (!piece || piece.color !== labState.game.turn()) {
                      return;
                    }

                    labState.setSelectedSquare(square);
                    highlightMoves(square);
                  },
                  onSquareRightClick: () => clearSelection(),
                  squareStyles: boardSquareStyles,
                  arrows: boardArrows,
                  lightSquareStyle: { backgroundColor: '#728092' },
                  darkSquareStyle: { backgroundColor: '#253140' },
                  animationDurationInMs: 180,
                  showNotation: true,
                }}
              />
              {boardReviewBadge ? (
                <span
                  aria-hidden="true"
                  className={styles.boardReviewBadge}
                  style={
                    {
                      '--board-review-badge-url': `url(${boardReviewBadge.badge})`,
                      '--board-review-badge-color': boardReviewBadge.color,
                      '--board-square-size': `${boardReviewBadge.squareSize}px`,
                      left: `${boardReviewBadge.left}px`,
                      top: `${boardReviewBadge.top}px`,
                    } as CSSProperties
                  }
                />
              ) : null}
            </div>
            <BoardPlayerBar player={bottomBoardPlayer} />
          </div>
          <div className={styles.boardStageSpacer} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
