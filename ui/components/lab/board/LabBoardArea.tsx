import type { Square } from 'chess.js';
import dynamic from 'next/dynamic';
import { type CSSProperties, memo, useCallback, useMemo, useState } from 'react';
import { useLab } from '../LabContext';
import { ArrowIcon, FlipIcon, ImportIcon, RefreshIcon, ResetIcon } from '../lab-icons';
import { BoardPlayerBar } from './BoardPlayerBar';

const Chessboard = dynamic(() => import('@/components/chessboard-client'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[150px] w-full items-center justify-center rounded-[10px] border border-dashed border-[rgba(214,226,244,0.22)] p-[18px] text-center text-(--text-soft)">
      Loading board...
    </div>
  ),
});

export const LabBoardArea = memo(function LabBoardArea() {
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

  const isBlackOrientation = labState.orientation === 'black';
  const evalRailTransitionClass = 'transition-[height,width] duration-200 ease-out will-change-[height,width]';
  const boardWidth = labState.boardWidth;
  const selectedSquare = labState.selectedSquare;
  const game = labState.game;

  const [rightClickedSquares, setRightClickedSquares] = useState<Record<string, boolean>>({});

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
      setRightClickedSquares({});
      return targetSquare ? tryMove(sourceSquare, targetSquare) : false;
    },
    [tryMove],
  );

  const onSquareClick = useCallback(
    ({ square }: { square: string }) => {
      setRightClickedSquares({});
      if (selectedSquare) {
        const movePlayed = tryMove(selectedSquare, square);

        if (!movePlayed) {
          clearSelection();
        }

        return;
      }

      const piece = game.get(square as Square);

      if (!piece || piece.color !== game.turn()) {
        return;
      }

      labState.setSelectedSquare(square);
      highlightMoves(square);
    },
    [clearSelection, game, highlightMoves, labState, selectedSquare, tryMove],
  );

  const onSquareRightClick = useCallback(
    ({ square }: { square: string }) => {
      clearSelection();
      setRightClickedSquares((prev) => ({
        ...prev,
        [square]: !prev[square],
      }));
    },
    [clearSelection],
  );

  const mergedSquareStyles = useMemo(() => {
    const combined = { ...boardSquareStyles };
    for (const [sq, active] of Object.entries(rightClickedSquares)) {
      if (active) {
        combined[sq] = { ...combined[sq], backgroundColor: 'rgba(225, 120, 120, 0.8)' };
      }
    }
    return combined;
  }, [boardSquareStyles, rightClickedSquares]);

  const chessboardOptions = useMemo(
    () => ({
      id: 'analysis-board',
      position: currentFen,
      boardOrientation: labState.orientation,
      boardStyle: {
        width: `${boardWidth}px`,
        maxWidth: '100%',
        height: `${boardWidth}px`,
        borderRadius: '2px',
      },
      onPieceDrop,
      onSquareClick,
      onSquareRightClick,
      squareStyles: mergedSquareStyles,
      arrows: boardArrows,
      lightSquareStyle: { backgroundColor: '#B8C8AA' },
      darkSquareStyle: { backgroundColor: '#173126' },
      animationDurationInMs: 180,
      showNotation: true,
    }),
    [
      boardArrows,
      mergedSquareStyles,
      boardWidth,
      currentFen,
      labState.orientation,
      onPieceDrop,
      onSquareClick,
      onSquareRightClick,
    ],
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-2.5 overflow-hidden rounded-xl border-0 bg-transparent px-2 pb-4 pt-3.5 max-[980px]:min-h-[min(820px,calc(100svh-36px))] max-[720px]:min-h-0 max-[720px]:p-3.5">
      <div
        className="relative flex min-h-0 flex-1 justify-center gap-[12px] overflow-hidden max-[720px]:flex-col"
        ref={boardStageRef}
      >
        <div
          className="z-2 flex flex-col gap-1 self-center rounded-[10px] border border-[rgba(226,238,220,0.075)] bg-[rgba(8,18,14,0.72)] p-1 shadow-sm backdrop-blur-md max-[720px]:order-2 max-[720px]:flex-row max-[720px]:justify-center max-[720px]:self-stretch"
          role="toolbar"
          aria-label="Board tools"
          style={{ '--board-size': `${labState.boardWidth}px` } as CSSProperties}
        >
          <button
            className="inline-flex h-[clamp(32px,calc(var(--board-size)*0.056),48px)] w-[clamp(32px,calc(var(--board-size)*0.056),48px)] flex-none items-center justify-center rounded-[6px] border-0 bg-[rgba(168,216,160,0.025)] p-0 font-normal text-(--text-soft) transition-[background-color,color] duration-150 hover:bg-[rgba(168,216,160,0.06)] hover:text-[--accent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            onClick={() => labState.setPgnDialogOpen(true)}
            title="Import PGN"
            type="button"
          >
            <ImportIcon />
          </button>
          <button
            className="inline-flex h-[clamp(32px,calc(var(--board-size)*0.056),48px)] w-[clamp(32px,calc(var(--board-size)*0.056),48px)] flex-none items-center justify-center rounded-[6px] border-0 bg-[rgba(168,216,160,0.025)] p-0 font-normal text-(--text-soft) transition-[background-color,color] duration-150 hover:bg-[rgba(168,216,160,0.06)] hover:text-[--accent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            onClick={() => labState.setOrientation((value) => (value === 'white' ? 'black' : 'white'))}
            title="Flip board"
            type="button"
          >
            <FlipIcon />
          </button>
          <button
            className="inline-flex h-[clamp(32px,calc(var(--board-size)*0.056),48px)] w-[clamp(32px,calc(var(--board-size)*0.056),48px)] flex-none items-center justify-center rounded-[6px] border-0 bg-[rgba(168,216,160,0.025)] p-0 font-normal text-(--text-soft) transition-[background-color,color] duration-150 hover:bg-[rgba(168,216,160,0.06)] hover:text-[--accent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
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
            className="inline-flex h-[clamp(32px,calc(var(--board-size)*0.056),48px)] w-[clamp(32px,calc(var(--board-size)*0.056),48px)] flex-none items-center justify-center rounded-[6px] border-0 bg-[rgba(168,216,160,0.025)] p-0 font-normal text-(--text-soft) transition-[background-color,color] duration-150 hover:bg-[rgba(168,216,160,0.06)] hover:text-[--accent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            onClick={() => void runTimelineAnalysis()}
            disabled={labState.timelineLoading || labState.moveHistory.length === 0}
            title="Refresh analysis"
            type="button"
          >
            <RefreshIcon />
          </button>
          <button
            className="inline-flex h-[clamp(32px,calc(var(--board-size)*0.056),48px)] w-[clamp(32px,calc(var(--board-size)*0.056),48px)] flex-none items-center justify-center rounded-[6px] border-0 bg-[rgba(168,216,160,0.025)] p-0 font-normal text-(--text-soft) transition-[background-color,color] duration-150 hover:bg-[rgba(168,216,160,0.06)] hover:text-[--accent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            onClick={resetWorkspace}
            title="Reset board"
            type="button"
          >
            <ResetIcon />
          </button>
        </div>

        <div
          className="grid min-h-0 min-w-0 grid-cols-[clamp(24px,calc(var(--board-size)*0.05),48px)_auto_clamp(24px,calc(var(--board-size)*0.05),48px)] items-center justify-center gap-[14px] overflow-hidden p-0.5 max-[980px]:!grid-cols-1 max-[980px]:justify-items-center max-[980px]:gap-2.5 max-[720px]:order-1"
          style={{ '--board-size': `${labState.boardWidth}px` } as CSSProperties}
        >
          <div
            className="flex w-[clamp(24px,calc(var(--board-size)*0.05),48px)] flex-col items-center gap-[clamp(4px,calc(var(--board-size)*0.015),12px)] max-[980px]:!w-full max-[980px]:flex-row max-[980px]:justify-center"
            ref={evalRailRef}
          >
            <div
              className="relative h-[var(--board-size)] w-[clamp(6px,calc(var(--board-size)*0.012),14px)] overflow-hidden rounded-full border-0 bg-[rgba(241,245,234,0.10)] max-[980px]:h-[clamp(6px,calc(var(--board-size)*0.012),14px)] max-[980px]:w-[var(--board-size)]"
              style={{ '--white-share': `${whiteAdvantage}%` } as CSSProperties}
            >
              <div
                className={`absolute w-full bg-[#18231C] max-[980px]:right-0 max-[980px]:top-0 max-[980px]:h-full max-[980px]:w-[calc(100%-var(--white-share,50%))] ${evalRailTransitionClass} ${
                  isBlackOrientation
                    ? 'bottom-0 h-[calc(100%-var(--white-share,50%))]'
                    : 'top-0 h-[calc(100%-var(--white-share,50%))]'
                }`}
              />
              <div
                className={`absolute w-full bg-[#A8D8A0] max-[980px]:bottom-0 max-[980px]:left-0 max-[980px]:h-full max-[980px]:w-(--white-share,50%) ${evalRailTransitionClass} ${
                  isBlackOrientation ? 'top-0 h-(--white-share,50%)' : 'bottom-0 h-(--white-share,50%)'
                }`}
              />
              <div
                className={`absolute bg-(--accent) max-[980px]:bottom-0 max-[980px]:left-(--white-share,50%) max-[980px]:h-full max-[980px]:w-[2px] max-[980px]:-translate-x-1/2 ${
                  isBlackOrientation
                    ? 'bottom-[calc(100%-var(--white-share,50%))] left-0 h-[2px] w-full translate-y-1/2'
                    : 'bottom-(--white-share,50%) left-0 h-[2px] w-full translate-y-1/2'
                }`}
              />
            </div>
            <div className="flex justify-center">
              <span className="min-w-0 text-[clamp(11px,calc(var(--board-size)*0.02),18px)] font-medium leading-none text-[rgba(241,245,234,0.56)] max-[720px]:min-w-[32px]">
                {boardScoreLabel}
              </span>
            </div>
          </div>

          <div className="flex max-w-full flex-col gap-2" style={{ width: `${boardWidth}px` }}>
            <BoardPlayerBar player={topBoardPlayer} />
            <div
              className="relative flex max-h-full max-w-full flex-none items-center justify-center overflow-hidden rounded-[2px] border-0 bg-transparent p-0 max-[980px]:max-w-[calc(100vw-112px)] max-[720px]:max-w-[calc(100vw-56px)]"
              style={{ width: `${boardWidth}px`, height: `${boardWidth}px` }}
            >
              <Chessboard options={chessboardOptions} />
              {boardReviewBadge ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute z-5 h-[clamp(22px,calc(var(--board-square-size)*0.34),42px)] w-[clamp(22px,calc(var(--board-square-size)*0.34),42px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-contain bg-center bg-no-repeat shadow-[0_10px_24px_rgba(8,13,21,0.34),0_0_0_1px_rgba(255,255,255,0.22)] drop-shadow-[0_2px_3px_rgba(0,0,0,0.34)]"
                  style={
                    {
                      '--board-square-size': `${boardReviewBadge.squareSize}px`,
                      left: `${boardReviewBadge.left}px`,
                      top: `${boardReviewBadge.top}px`,
                      backgroundColor: boardReviewBadge.color,
                      backgroundImage: `url(${boardReviewBadge.badge})`,
                    } as CSSProperties
                  }
                />
              ) : null}
            </div>
            <BoardPlayerBar player={bottomBoardPlayer} />
          </div>
          <div
            className="w-[clamp(24px,calc(var(--board-size)*0.05),48px)] self-stretch max-[980px]:hidden"
            aria-hidden="true"
          />
        </div>
      </div>
    </section>
  );
});
