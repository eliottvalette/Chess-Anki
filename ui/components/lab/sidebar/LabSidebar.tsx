import { useLab } from '../LabContext';
import {
  TrainingProfilePanel,
  LinesPanel,
  TrainPanel,
  ReviewPanel,
  getModeLabel,
  PgnImportDialog
} from '@/components/chess-lab-panels';
import { formatBestMove } from '@/lib/chess-analysis-client';
import styles from '../../chess-analysis-lab.module.css';
import { Chess } from 'chess.js';
import { createEmptyTrainSessionStats, LAST_TRAINING_DECK_STORAGE_KEY } from '../../../lib/lab-helpers';
import { type WorkspaceMode } from '../../../lib/analysis-types';

export function LabSidebar() {
  const lab = useLab();
  
  return (
    <>
      <section className={`${styles.panel} ${styles.contextPanel}`}>
        <div className={styles.modeTabs}>
          {(['review', 'train', 'lines'] as WorkspaceMode[]).map(tabMode => (
            <button
              key={tabMode}
              className={`${styles.modeTab} ${lab.labState.mode === tabMode ? styles.activeModeTab : ''}`}
              onClick={() => lab.switchWorkspaceMode(tabMode)}
            >
              {getModeLabel(tabMode)}
            </button>
          ))}
        </div>

        <div className={`${styles.panelScroll} ${lab.labState.mode === 'review' && lab.hasLoadedGame ? styles.reviewPanelScroll : ''}`}>
          {lab.labState.mode === 'review' ? (
            <ReviewPanel
              activeReviewMoment={lab.activeReviewMoment}
              blackReviewName={lab.blackReviewName}
              chesscomUsername={lab.labState.chesscomUsername}
              goToReviewMoment={lab.handleGoToReviewMoment}
              hasLoadedGame={lab.hasLoadedGame}
              historyIndex={lab.labState.historyIndex}
              jumpToIndex={lab.jumpToIndex}
              loadRecentGame={lab.loadRecentChessGame}
              moveHistoryLength={lab.labState.moveHistory.length}
              movePairs={lab.movePairs}
              onBack={() => {
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
              reviewSaveMoveSan={lab.deckOpponentBestSan ?? null}
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
                (!lab.labState.saveReplayFromStart || lab.currentMoves.length > 0)
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
              drillActive={lab.labState.openingDrillActive}
              drillStatus={lab.labState.openingDrillStatus}
              expectedSan={lab.labState.openingDrillExpected?.san ?? (lab.labState.openingDrillExpected?.uci ? formatBestMove(lab.currentFen, lab.labState.openingDrillExpected.uci) : null)}
              loading={lab.labState.openingTreesLoading}
              onImportRecent={() => void lab.importRecentOpeningTrees()}
              onSelectNode={lab.selectOpeningNode}
              onSelectTree={lab.selectOpeningTree}
              onStartDrill={() => lab.startOpeningDrill()}
              onStopDrill={lab.stopOpeningDrill}
              trainSide={lab.labState.activeTrainSide}
              onChangeTrainSide={(side) => {
                lab.labState.setActiveTrainSide(side);
                lab.labState.setOrientation(side);
              }}
              trees={lab.labState.openingTrees}
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

                lab.labState.positionRequestIdRef.current += 1;
                lab.labState.timelineRequestIdRef.current += 1;
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
              onTrainDeck={deckId => void lab.trainDeckFromLibrary(deckId)}
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
