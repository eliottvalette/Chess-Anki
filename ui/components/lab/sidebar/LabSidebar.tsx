import { Chess } from 'chess.js';
import {
  getModeLabel,
  LinesPanel,
  PgnImportDialog,
  ReviewPanel,
  TrainingProfilePanel,
  TrainPanel,
} from '@/components/chess-lab-panels';
import type { WorkspaceMode } from '../../../lib/analysis-types';
import { createEmptyTrainSessionStats, LAST_TRAINING_DECK_STORAGE_KEY } from '../../../lib/lab-helpers';
import { useLab } from '../LabContext';

export function LabSidebar() {
  const lab = useLab();

  return (
    <>
      <section
        className={`min-w-0 min-h-0 overflow-hidden rounded-2xl border border-(--border) bg-(--panel-bg) shadow-(--glass-shadow) backdrop-blur-[22px] backdrop-saturate-[1.2] flex flex-col gap-3.5 p-[18px]`}
      >
        <div className="grid grid-cols-3 gap-2">
          {(['review', 'train', 'lines'] as WorkspaceMode[]).map((tabMode) => (
            <button
              key={tabMode}
              className={`${lab.labState.mode === tabMode ? 'box-border min-h-[38px] min-w-0 truncate rounded-[10px] border border-[rgba(198,215,255,0.58)] bg-[rgba(46,58,82,0.58)] px-2 text-[11px] font-normal text-(--text) shadow-[inset_0_0_0_1px_rgba(198,215,255,0.1)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(198,215,255,0.58)] hover:bg-[rgba(46,58,82,0.58)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none' : 'box-border min-h-[38px] min-w-0 truncate rounded-[10px] border border-(--border) bg-[rgba(9,14,23,0.38)] px-2 text-[11px] font-normal text-(--text-muted) shadow-[inset_0_1px_0_rgba(0,0,0,0.24)] transition-[border-color,background-color,color,transform,box-shadow] duration-150 hover:border-[rgba(214,226,244,0.28)] hover:bg-[rgba(4,8,15,0.58)] hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-strong) disabled:cursor-not-allowed disabled:border-[rgba(214,226,244,0.1)] disabled:bg-[rgba(9,14,23,0.26)] disabled:text-(--text-disabled) disabled:shadow-none'}`}
              onClick={() => lab.switchWorkspaceMode(tabMode)}
              type="button"
            >
              {getModeLabel(tabMode)}
            </button>
          ))}
        </div>

        <div
          className={`min-h-0 flex flex-1 flex-col gap-(--panel-scroll-gap) overflow-y-auto overflow-x-hidden pr-[3px] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${lab.labState.mode === 'review' && lab.hasLoadedGame ? 'overflow-hidden pr-0' : ''}`}
        >
          {lab.labState.mode === 'review' ? (
            <ReviewPanel
              activeReviewMoment={lab.activeReviewMoment}
              blackReviewName={lab.blackReviewName}
              chesscomUsername={lab.labState.chesscomUsername}
              goToReviewMoment={lab.handleGoToReviewMoment}
              hasLoadedGame={lab.hasLoadedGame}
              historyIndex={lab.labState.historyIndex}
              jumpToIndex={lab.jumpToReviewIndex}
              loadRecentGame={lab.loadRecentChessGame}
              moveHistoryLength={lab.labState.moveHistory.length}
              movePairs={lab.movePairs}
              onBack={() => {
                lab.cancelReviewPlayback();
                lab.persistReviewWorkspaceSnapshot();
                lab.labState.setGame(new Chess());
                lab.labState.setInitialFen(null);
                lab.labState.setMoveHistory([]);
                lab.labState.setHistoryIndex(0);
                lab.clearVariation();
                lab.labState.setMetadata(null);
                lab.labState.setFileName('');
                lab.labState.setReviewIndex(0);
                lab.labState.setPositionAnalysis(null);
                lab.labState.setPreMoveAnalyses([]);
                lab.labState.setTimelineAnalyses([]);
                lab.labState.setPositionLoading(false);
                lab.labState.setTimelineLoading(false);
                lab.labState.setServerError('');
                lab.labState.setTimelineError('');
                lab.labState.setActiveDeckCard(null);
                lab.labState.setDeckFeedback(null);
                lab.labState.setDeckFeedbackArrowsVisible(false);
                lab.labState.setTrainAllSession(false);
                lab.labState.setTrainAllQueue([]);
                lab.labState.setTrainSessionIndex(0);
                lab.labState.setTrainSessionStats(createEmptyTrainSessionStats());
                lab.clearSelection();

                if (lab.labState.trainAllSession) {
                  void lab.loadTrainingDeck(lab.labState.selectedDeckId, { autoStart: false, libraryLoading: false });
                }
              }}
              recentGamesLoading={lab.labState.recentChessGamesLoading}
              onChesscomUsernameChange={lab.labState.setChesscomUsername}
              onFetchRecentGames={() => void lab.fetchRecentChessGames()}
              reviewSaveMoveSan={lab.reviewSaveMoveSan}
              positionLoading={lab.labState.positionLoading}
              deckSummaries={lab.labState.deckSummaries}
              recentGameTimeClass={lab.labState.recentGameTimeClass}
              recentGames={lab.labState.recentChessGames}
              recentGamesError={lab.labState.recentChessGamesError}
              recentGamesHasMore={lab.labState.recentChessGamesHasMore}
              reviewDeckSaveStatus={lab.labState.reviewDeckSaveStatus}
              reviewMoments={lab.reviewMoments}
              onRecentGameTimeClassChange={lab.labState.setRecentGameTimeClass}
              canSaveReviewCard={Boolean(
                lab.labState.trainingProfile &&
                  lab.labState.selectedDeckId &&
                  lab.displayAnalysis?.bestMove &&
                  !lab.labState.positionLoading &&
                  (!lab.labState.saveReplayFromStart || lab.currentMoves.length > 0),
              )}
              onSaveReviewCard={() => void lab.saveReviewPositionToDeck()}
              onGoCreateDeck={lab.openTrainCreateDeck}
              onSelectSaveDeck={lab.selectSaveDeck}
              onLoadMoreRecentGames={() => void lab.fetchRecentChessGames(undefined, undefined, true)}
              selectedDeckId={lab.labState.selectedDeckId}
              setShowArrow={lab.labState.setShowArrow}
              timelineAnalyses={lab.labState.timelineAnalyses}
              timelineAnalysesLength={lab.labState.timelineAnalyses.length}
              timelineError={lab.labState.timelineError}
              timelineLoading={lab.labState.timelineLoading}
              timelineProgress={lab.labState.timelineProgress}
              timelineReviews={lab.timelineReviews}
              whiteReviewName={lab.whiteReviewName}
            />
          ) : !lab.labState.trainingProfile ? (
            <TrainingProfilePanel
              bootstrapping={lab.labState.trainingProfileBootstrapping}
              error={lab.labState.trainingProfileError}
              submitting={lab.labState.trainingProfileSubmitting}
              password={lab.labState.trainingPassword}
              setPassword={lab.labState.setTrainingPassword}
              setUsername={lab.labState.setTrainingUsername}
              username={lab.labState.trainingUsername}
              onSubmit={() => void lab.openTrainingProfile()}
            />
          ) : lab.labState.mode === 'lines' ? (
            <LinesPanel
              actionError={lab.labState.openingTreeActionError}
              actionLoading={lab.labState.openingTreeActionLoading}
              activeNodeId={lab.labState.activeOpeningNodeId}
              activeTree={lab.labState.activeOpeningTree}
              activeTreeId={lab.labState.selectedOpeningTreeId}
              deckFeedback={lab.labState.deckFeedback}
              deckPlaybackBusy={lab.labState.deckPlaybackBusy}
              drillActive={lab.labState.openingDrillActive}
              forkCoverage={lab.linesForkCoverage}
              hasNextLearnBranch={lab.linesHasNextLearnBranch}
              learnBranchComplete={lab.labState.linesLearnBranchComplete}
              linesStudyMode={lab.labState.linesStudyMode}
              loading={lab.labState.openingTreesLoading}
              onImportRecent={() => void lab.importRecentOpeningTrees()}
              onNextLearnBranch={() => lab.startNextLearnBranch()}
              onQuitSession={() => lab.quitLinesSession()}
              onSelectNode={lab.selectOpeningNode}
              onSelectTree={lab.selectOpeningTree}
              onStartLearn={() => lab.startLinesLearn()}
              onStartReview={() => lab.startLinesReview()}
              reviewIndex={lab.labState.linesReviewIndex}
              reviewQueueLength={lab.labState.linesReviewQueue.length}
              sessionTrainPlyCurrent={lab.labState.linesTrainPlyCurrent}
              sessionTrainPlyTotal={lab.labState.linesTrainPlyTotal}
              trainSide={lab.labState.activeTrainSide}
              onChangeTrainSide={(side) => {
                lab.labState.setActiveTrainSide(side);
                lab.labState.setOrientation(side);

                if (lab.labState.linesStudyMode === 'learn') {
                  lab.startLinesLearn(lab.labState.activeOpeningTree ?? undefined, side);
                  return;
                }

                if (lab.labState.linesStudyMode === 'review') {
                  lab.startLinesReview(lab.labState.activeOpeningTree ?? undefined, side);
                }
              }}
              trees={lab.labState.openingTrees}
              minForcedPlies={lab.labState.minForcedPlies}
              setMinForcedPlies={lab.labState.setMinForcedPlies}
              minNodes={lab.labState.minNodes}
              setMinNodes={lab.labState.setMinNodes}
              minDepth={lab.labState.minDepth}
              setMinDepth={lab.labState.setMinDepth}
            />
          ) : (
            <TrainPanel
              activeCard={lab.labState.activeDeckCard}
              activeCardProgress={lab.activeDeckProgress}
              deckActionError={lab.labState.deckActionError}
              deckActionLoading={lab.labState.deckActionLoading}
              deckCounterSan={lab.deckOpponentBestSan}
              deckLoadError={lab.labState.deckLoadError}
              deckBusy={lab.deckBusy}
              deckLibraryLoading={lab.labState.deckLibraryLoading}
              deckSummaries={lab.labState.deckSummaries}
              deckFeedback={lab.labState.deckFeedback}
              deckPlaybackBusy={lab.labState.deckPlaybackBusy}
              deckStats={lab.deckStats}
              deckLineMastery={lab.deckLineMastery}
              trainAllSession={lab.labState.trainAllSession}
              trainSessionCardCurrent={lab.trainSessionCardCurrent}
              trainSessionCardTotal={lab.trainSessionCardTotal}
              trainSessionStats={lab.labState.trainSessionStats}
              canDeleteCard={Boolean(lab.labState.trainingProfile && (lab.labState.activeDeckCard ?? lab.nextDeckCard))}
              deleteCardLabel="Delete"
              newDeckTitle={lab.labState.newDeckTitle}
              nextCard={lab.nextDeckCard}
              onBack={() => {
                const wasTrainAllSession = lab.labState.trainAllSession;
                const restoreDeckId =
                  lab.labState.selectedDeckId ??
                  (typeof window !== 'undefined' ? window.localStorage.getItem(LAST_TRAINING_DECK_STORAGE_KEY) : null);

                lab.cancelPendingAnalysisRequests();
                lab.labState.setGame(new Chess());
                lab.labState.setInitialFen(null);
                lab.labState.setMoveHistory([]);
                lab.labState.setHistoryIndex(0);
                lab.clearVariation();
                lab.labState.setMetadata(null);
                lab.labState.setFileName('');
                lab.labState.setPositionAnalysis(null);
                lab.labState.setPreMoveAnalyses([]);
                lab.labState.setTimelineAnalyses([]);
                lab.labState.setPositionLoading(false);
                lab.labState.setTimelineLoading(false);
                lab.labState.setServerError('');
                lab.labState.setTimelineError('');
                lab.labState.setActiveDeckCard(null);
                lab.labState.setDeckFeedback(null);
                lab.labState.setDeckFeedbackArrowsVisible(false);
                lab.labState.setTrainAllSession(false);
                lab.labState.setTrainAllQueue([]);
                lab.labState.setTrainSessionIndex(0);
                lab.labState.setTrainSessionStats(createEmptyTrainSessionStats());
                lab.clearSelection();

                if (wasTrainAllSession) {
                  void lab.loadTrainingDeck(restoreDeckId, { autoStart: false, libraryLoading: false });
                }
              }}
              selectedDeckId={lab.labState.selectedDeckId}
              focusCreateDeck={lab.labState.focusTrainCreateDeck}
              onCreateDeck={() => void lab.createTrainingDeck(lab.labState.newDeckTitle)}
              onGenerateRecentDeck={() => void lab.generateRecentTrainingDeck()}
              onDeleteCard={() => void lab.deleteActiveDeckCard()}
              onNext={lab.advanceDeckCard}
              onNewDeckTitleChange={lab.labState.setNewDeckTitle}
              onTrainDeck={(deckId) => void lab.trainDeckFromLibrary(deckId)}
              onTrainAll={() => void lab.trainAllDecks()}
              onRenameDeck={(deckId, name) => void lab.renameTrainingDeck(deckId, name)}
              onDeleteDeck={() => void lab.deleteTrainingDeck(lab.labState.selectedDeckId!)}
              onCreateDeckFocusHandled={() => lab.labState.setFocusTrainCreateDeck(false)}
            />
          )}
        </div>
      </section>

      {lab.labState.pgnDialogOpen && (
        <PgnImportDialog
          fileName={lab.labState.fileName}
          handlePgnPaste={lab.handlePgnPaste}
          handleUpload={lab.handleUpload}
          onClose={() => lab.labState.setPgnDialogOpen(false)}
          pgnDraft={lab.labState.pgnDraft}
          setPgnDraft={lab.labState.setPgnDraft}
        />
      )}
    </>
  );
}
