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
        className={`min-h-0 min-w-0 flex flex-1 flex-col gap-3.5 overflow-hidden rounded-xl border-0 bg-[rgba(7,12,20,0.85)] px-4 py-4 backdrop-blur-md backdrop-saturate-[1.1]`}
      >
        <div className="flex w-full border-b border-(--border-soft)">
          {(['review', 'train', 'lines'] as WorkspaceMode[]).map((tabMode) => (
            <button
              key={tabMode}
              className={`flex-1 relative box-border min-h-[38px] min-w-0 truncate border-0 bg-transparent px-1 text-[14px] font-normal transition-colors duration-150 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                lab.labState.mode === tabMode
                  ? 'text-[#f5f8ff] font-medium after:absolute after:bottom-[-1px] after:left-0 after:h-[2px] after:w-full after:bg-[#98b8ff]'
                  : 'text-[rgba(245,248,255,0.42)] hover:text-[rgba(245,248,255,0.62)]'
              }`}
              onClick={() => lab.switchWorkspaceMode(tabMode)}
              type="button"
            >
              {getModeLabel(tabMode)}
            </button>
          ))}
        </div>

        <div
          className={`min-h-0 flex flex-1 flex-col gap-(--panel-scroll-gap) overflow-y-auto overflow-x-hidden pr-[3px] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${lab.labState.mode === 'review' && lab.hasLoadedGame ? 'overflow-hidden pr-0' : ''} ${lab.labState.mode === 'lines' && lab.labState.activeOpeningTree ? 'overflow-hidden pr-0' : ''}`}
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
              onRecentGameTimeClassChange={(timeClass) => {
                lab.labState.setRecentGameTimeClass(timeClass);
                if (lab.labState.chesscomUsername.trim()) {
                  void lab.fetchRecentChessGames(lab.labState.chesscomUsername, timeClass);
                }
              }}
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
              studyDebugSnapshot={lab.linesStudyDebugSnapshot}
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
              trees={lab.labState.linesBrowseOverrideTrees ?? lab.labState.openingTrees}
              minForcedPlies={lab.labState.minForcedPlies}
              setMinForcedPlies={lab.labState.setMinForcedPlies}
              minNodes={lab.labState.minNodes}
              setMinNodes={lab.labState.setMinNodes}
              minDepth={lab.labState.minDepth}
              setMinDepth={lab.labState.setMinDepth}
              learnMaxPly={lab.labState.learnMaxPly}
              setLearnMaxPly={lab.labState.setLearnMaxPly}
              positionFilterActive={lab.labState.linesBrowseOverrideTrees != null}
              positionFilterLoading={lab.labState.linesPositionFilterLoading}
              onClearBoardPosition={lab.clearLinesBoardPosition}
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
