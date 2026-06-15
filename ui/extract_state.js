const { Project, SyntaxKind } = require('ts-morph');
const fs = require('fs');
const path = require('path');

const srcPath = '/Users/eliottvalette/Documents/Games/Chess Bot/ui/components/chess-analysis-lab.tsx';
const outPath = '/Users/eliottvalette/Documents/Games/Chess Bot/ui/hooks/useLabState.ts';

const project = new Project();
const sourceFile = project.addSourceFileAtPath(srcPath);

const mainFn = sourceFile.getFunction('ChessAnalysisLab');

// We find all VariableStatements that call useState or useRef
const statements = mainFn.getStatements();
let stateDeclarations = [];
let refs = [];
let other = [];

let endIndex = -1;

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  const text = stmt.getText();
  if (text.includes('useState(')) {
    stateDeclarations.push(text);
    endIndex = i;
  } else if (text.includes('useRef(')) {
    refs.push(text);
    endIndex = i;
  } else if (endIndex === -1 && text.includes('const ')) {
    // maybe some other consts
  }
}

// Just copy lines 513 to 600 exactly from the file?
const lines = fs.readFileSync(srcPath, 'utf8').split('\n');
const stateLines = lines.slice(512, 600); // 0-indexed: 512 to 599 corresponds to 513 to 600

const outCode = `
import { useState, useRef } from 'react';
import { Chess } from 'chess.js';
import type { CSSProperties } from 'react';
import type { AnalysisResult } from '@/lib/analysis-types';
import type { GameMetadata, ReviewSide, StoredMove } from '@/lib/chess-analysis-client';
import type { ChessComRecentGameSummary, ChessComRecentGameTimeClass } from '@/lib/chesscom';
import type { DeckProgressMap } from '@/lib/deck-progress';
import type { DrillPathStep, OpeningSeedLine, OpeningTreeDetail, OpeningTreeSummary } from '@/lib/opening-tree';
import type { DeckCard, DeckFeedback } from '@/lib/opening-training';
import type { TrainingProfile } from '@/lib/training-profile';
import type { TrainSessionStats, WorkspaceMode } from '../components/chess-lab-panels';

export function useLabState() {
${stateLines.join('\n')}

  return {
    game, setGame, initialFen, setInitialFen, moveHistory, setMoveHistory,
    historyIndex, setHistoryIndex, variationBaseIndex, setVariationBaseIndex,
    variationMoves, setVariationMoves, selectedSquare, setSelectedSquare,
    squareStyles, setSquareStyles, orientation, setOrientation, showArrow, setShowArrow,
    mode, setMode, reviewSide, reviewIndex, setReviewIndex, metadata, setMetadata,
    whiteAvatarUrl, setWhiteAvatarUrl, blackAvatarUrl, setBlackAvatarUrl,
    fileName, setFileName, pgnDraft, setPgnDraft, pgnDialogOpen, setPgnDialogOpen,
    positionAnalysis, setPositionAnalysis, preMoveAnalyses, setPreMoveAnalyses,
    timelineAnalyses, setTimelineAnalyses, positionLoading, setPositionLoading,
    timelineLoading, setTimelineLoading, timelineProgress, setTimelineProgress,
    serverError, setServerError, timelineError, setTimelineError, boardWidth, setBoardWidth,
    deckIndex, setDeckIndex, trainAllSession, setTrainAllSession, trainAllQueue, setTrainAllQueue,
    trainSessionIndex, setTrainSessionIndex, trainSessionStats, setTrainSessionStats,
    activeDeckCard, setActiveDeckCard, deckFeedback, setDeckFeedback,
    deckFeedbackArrowsVisible, setDeckFeedbackArrowsVisible, openingLines, setOpeningLines,
    deckCards, setDeckCards, deckSummaries, setDeckSummaries, selectedDeckId, setSelectedDeckId,
    deckLibraryLoading, setDeckLibraryLoading, deckCardsLoading, setDeckCardsLoading,
    deckLoadError, setDeckLoadError, deckActionLoading, setDeckActionLoading,
    deckActionError, setDeckActionError, openingTrees, setOpeningTrees,
    activeOpeningTree, setActiveOpeningTree, openingTreesLoading, setOpeningTreesLoading,
    openingTreeActionLoading, setOpeningTreeActionLoading, openingTreeActionError, setOpeningTreeActionError,
    selectedOpeningTreeId, setSelectedOpeningTreeId, activeOpeningNodeId, setActiveOpeningNodeId,
    openingDrillStatus, setOpeningDrillStatus, openingDrillExpected, setOpeningDrillExpected,
    openingDrillActive, setOpeningDrillActive, drillPathRef, drillPathIndexRef,
    newDeckTitle, setNewDeckTitle, reviewDeckSaveStatus, setReviewDeckSaveStatus,
    deckProgress, setDeckProgress, chesscomUsername, setChesscomUsername,
    recentGameTimeClass, setRecentGameTimeClass, recentChessGames, setRecentChessGames,
    recentChessGamesLoading, setRecentChessGamesLoading, recentChessGamesHasMore, setRecentChessGamesHasMore,
    recentChessGamesNextOffset, setRecentChessGamesNextOffset, recentChessGamesNextCursor, setRecentChessGamesNextCursor,
    recentChessGamesError, setRecentChessGamesError, recentPreloadTick, setRecentPreloadTick,
    trainingProfile, setTrainingProfile, trainingProfileBootstrapping, setTrainingProfileBootstrapping,
    trainingProfileSubmitting, setTrainingProfileSubmitting, trainingProfileError, setTrainingProfileError,
    trainingUsername, setTrainingUsername, trainingPassword, setTrainingPassword,
    trainingCredentialsHydratedRef, focusTrainCreateDeck, setFocusTrainCreateDeck,
    saveReplayFromStart, deckPlaybackBusy, setDeckPlaybackBusy, trainAnalysisTick, setTrainAnalysisTick,
    boardStageRef, evalRailRef, positionRequestIdRef, timelineRequestIdRef,
    timelineRefineRequestIdRef, reviewPlaybackRequestIdRef, deckPlaybackRequestIdRef
  };
}

export type LabState = ReturnType<typeof useLabState>;
`;

fs.writeFileSync(outPath, outCode);
console.log('useLabState created');
