import type { StoredMove } from './chess-analysis-client.ts';
import type { LinesStudySessionLog } from './lines-study-session-log.ts';
import { formatLinesStudySessionLog } from './lines-study-session-log.ts';
import type { DeckFeedback } from './opening-training.ts';
import type {
  ForkCoverageMap,
  LearnBranchCompletion,
  OpeningDrillExpectedMove,
  OpeningTreeDetail,
} from './opening-tree.ts';
import { formatOpeningTreeDisplayName } from './opening-tree.ts';

export type LinesStudyDebugInput = {
  linesStudyMode: 'idle' | 'learn' | 'review';
  trainSide: 'white' | 'black';
  tree: OpeningTreeDetail | null;
  activeNodeId: string | null;
  openingDrillActive: boolean;
  openingDrillStatus: string;
  openingDrillExpected: OpeningDrillExpectedMove | null;
  deckFeedback: DeckFeedback | null;
  deckPlaybackBusy: boolean;
  linesLearnBranchComplete: boolean;
  completedLearnBranches: LearnBranchCompletion[];
  historyIndex: number;
  moveHistory: StoredMove[];
  initialFen: string | null;
  linesReviewQueue: string[];
  linesReviewIndex: number;
  sessionTrainPlyCurrent: number;
  sessionTrainPlyTotal: number;
  forkCoverage?: ForkCoverageMap;
  currentFen?: string;
  sessionLog?: LinesStudySessionLog | null;
  activeLearnBranch?: LearnBranchCompletion | null;
};

function formatMoveLine(moveHistory: StoredMove[], historyIndex: number) {
  if (historyIndex <= 0) {
    return '(start)';
  }

  return moveHistory
    .slice(0, historyIndex)
    .map((move) => move.san)
    .join(' ');
}

function formatFeedback(feedback: DeckFeedback | null) {
  if (!feedback) {
    return 'none';
  }

  const parts = [feedback.correct ? 'correct' : 'miss'];

  if (feedback.exact) {
    parts.push('exact');
  }

  parts.push(`played ${feedback.playedSan}`);

  if (feedback.expectedSan) {
    parts.push(`expected ${feedback.expectedSan}`);
  }

  return parts.join(' · ');
}

export function buildLinesStudyDebugSnapshot(input: LinesStudyDebugInput) {
  const tree = input.tree;
  const activeNode = input.activeNodeId ? (tree?.nodes.find((node) => node.id === input.activeNodeId) ?? null) : null;
  const forkEntry = input.activeNodeId ? input.forkCoverage?.[input.activeNodeId] : null;
  const lines: string[] = [formatLinesStudySessionLog(input.sessionLog ?? null), '', '--- current position ---'];

  lines.push(`mode: ${input.linesStudyMode} · train ${input.trainSide}`);

  if (tree) {
    lines.push(
      `tree: ${formatOpeningTreeDisplayName(tree.name)} · id ${tree.id} · ${tree.nodes.length} nodes · depth ${tree.targetDepth}`,
    );
    lines.push(`root: ${tree.rootSan.join(' ') || '(start)'}`);
  } else {
    lines.push('tree: none');
  }

  if (input.linesStudyMode === 'learn') {
    lines.push(`learn: ply ${input.sessionTrainPlyCurrent}/${input.sessionTrainPlyTotal}`);
    lines.push(`branch complete: ${input.linesLearnBranchComplete ? 'yes' : 'no'}`);

    if (input.activeLearnBranch) {
      lines.push(
        `active branch: ${input.activeLearnBranch.forkNodeId}:${input.activeLearnBranch.edgeUci} (${input.activeLearnBranch.edgeId})`,
      );
    }

    if (input.completedLearnBranches.length > 0) {
      lines.push(
        `branches done (${input.completedLearnBranches.length}): ${input.completedLearnBranches
          .map((branch, index) => `#${index + 1} ${branch.forkNodeId}:${branch.edgeUci} id=${branch.edgeId}`)
          .join(' | ')}`,
      );
    }
  }

  if (input.linesStudyMode === 'review') {
    lines.push(`review: card ${input.linesReviewIndex + 1}/${input.linesReviewQueue.length}`);
    if (input.linesReviewQueue.length > 0) {
      lines.push(`queue: ${input.linesReviewQueue.join(' → ')}`);
    }
  }

  lines.push(
    `drill: ${input.openingDrillActive ? 'active' : 'idle'} · playback ${input.deckPlaybackBusy ? 'busy' : 'idle'}`,
  );

  if (input.openingDrillStatus) {
    lines.push(`status: ${input.openingDrillStatus}`);
  }

  if (activeNode) {
    lines.push(
      `node: ${activeNode.id} · ply ${activeNode.ply} · ${activeNode.sideToMove} to move · mastery ${activeNode.masteryScore}`,
    );

    if (activeNode.bestSan) {
      lines.push(`book best: ${activeNode.bestSan} (${activeNode.bestUci ?? '?'})`);
    }
  } else if (input.activeNodeId) {
    lines.push(`node: ${input.activeNodeId} (missing from tree)`);
  }

  if (input.openingDrillExpected) {
    lines.push(
      `prompt: ${input.openingDrillExpected.san ?? '?'} (${input.openingDrillExpected.uci ?? '?'}) · accepted ${input.openingDrillExpected.acceptedUcis.join(', ') || 'none'}`,
    );
  }

  lines.push(`feedback: ${formatFeedback(input.deckFeedback)}`);
  lines.push(
    `history: ${input.historyIndex}/${input.moveHistory.length} · ${formatMoveLine(input.moveHistory, input.historyIndex)}`,
  );

  if (forkEntry) {
    lines.push(
      `fork replies: ${forkEntry.playedEdgeIds.length}/${forkEntry.playedEdgeIds.length + forkEntry.remainingEdgeIds.length} played`,
    );
  }

  if (input.currentFen) {
    lines.push(`fen: ${input.currentFen}`);
  }

  if (input.initialFen) {
    lines.push(`initial fen: ${input.initialFen}`);
  }

  return lines.join('\n');
}
