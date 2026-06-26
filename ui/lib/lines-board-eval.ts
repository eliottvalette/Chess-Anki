import type { AnalysisResult } from './analysis-types.ts';
import {
  formatEvalCpLabel,
  formatScoreLabel,
  getAdvantageMeter,
  getAdvantageMeterFromEvalCp,
} from './chess-analysis-client.ts';
import {
  type LinesMoveCategory,
  normalizeOpeningFen,
  type OpeningSide,
  type OpeningTreeDetail,
  resolveOpeningNodeFromHistory,
} from './opening-tree.ts';

export const LINES_BOARD_NEUTRAL_WHITE_ADVANTAGE = 50;
export const LINES_EARLY_OPENING_MAX_PLY = 12;
export const LINES_EARLY_OPENING_BLUNDER_LOSS_CP = 100;

export function resolveLinesBoardEvalCp(
  tree: Pick<OpeningTreeDetail, 'nodes' | 'edges' | 'rootSan' | 'rootPly' | 'rootFenKey' | 'rootUci'>,
  moveHistory: Array<{ uci: string }>,
  historyIndex: number,
  currentFen: string,
  activeOpeningNodeId: string | null,
): number | null {
  const currentFenKey = normalizeOpeningFen(currentFen);
  const { nodeId: historyNodeId } = resolveOpeningNodeFromHistory(tree, moveHistory, historyIndex);
  let node = historyNodeId ? tree.nodes.find((candidate) => candidate.id === historyNodeId) : null;

  if (node && normalizeOpeningFen(node.fen) !== currentFenKey) {
    node = null;
  }

  if (!node && activeOpeningNodeId) {
    const activeNode = tree.nodes.find((candidate) => candidate.id === activeOpeningNodeId);

    if (activeNode && normalizeOpeningFen(activeNode.fen) === currentFenKey) {
      node = activeNode;
    }
  }

  if (!node || node.evalCp == null) {
    return null;
  }

  return node.evalCp;
}

export function isPositionAnalysisCurrent(
  positionAnalysis: AnalysisResult | null,
  cachedAnalysis: AnalysisResult | undefined,
): boolean {
  if (!positionAnalysis || !cachedAnalysis) {
    return false;
  }

  return positionAnalysis === cachedAnalysis;
}

export function resolveLinesBoardScoreLabel(options: {
  linesBoardEvalCp: number | null;
  orientation: 'white' | 'black';
  currentEngineAnalysis: AnalysisResult | null;
  engineAnalysisIsCurrent: boolean;
}): string {
  if (options.linesBoardEvalCp != null) {
    return formatEvalCpLabel(options.linesBoardEvalCp, options.orientation);
  }

  if (options.engineAnalysisIsCurrent && options.currentEngineAnalysis) {
    return formatScoreLabel(options.currentEngineAnalysis, options.orientation);
  }

  return formatEvalCpLabel(0, options.orientation);
}

export function resolveLinesBoardWhiteAdvantage(options: {
  linesBoardEvalCp: number | null;
  currentEngineAnalysis: AnalysisResult | null;
  engineAnalysisIsCurrent: boolean;
}): number {
  if (options.linesBoardEvalCp != null) {
    return getAdvantageMeterFromEvalCp(options.linesBoardEvalCp);
  }

  if (options.engineAnalysisIsCurrent && options.currentEngineAnalysis) {
    return getAdvantageMeter(options.currentEngineAnalysis);
  }

  return LINES_BOARD_NEUTRAL_WHITE_ADVANTAGE;
}

export function isEarlyOpeningPly(ply: number, maxPly = LINES_EARLY_OPENING_MAX_PLY) {
  return ply > 0 && ply <= maxPly;
}

export function isLinesEvalConcerningForTrainSide(evalCp: number, trainSide: OpeningSide) {
  if (trainSide === 'white') {
    return evalCp < 0;
  }

  return evalCp > 0;
}

export function evalSwingCpForSide(
  before: { evalCp?: number | null; sideToMove: OpeningSide },
  after: { evalCp?: number | null },
) {
  if (before.evalCp == null || after.evalCp == null) {
    return null;
  }

  return before.sideToMove === 'white' ? after.evalCp - before.evalCp : before.evalCp - after.evalCp;
}

export function detectEarlyOpeningConcernOnPath(
  nodes: Array<{ id: string; ply: number; evalCp?: number | null; sideToMove: OpeningSide }>,
  edges: Array<{ fromNodeId: string; toNodeId: string; uci: string }>,
  rootUci: string[],
  trainSide: OpeningSide,
  maxPly = LINES_EARLY_OPENING_MAX_PLY,
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const rootNode = nodes.find((node) => node.ply === 0);

  if (!rootNode) {
    return false;
  }

  let currentNode = rootNode;

  for (const uci of rootUci.slice(0, maxPly)) {
    const edge = edges.find((candidate) => candidate.fromNodeId === currentNode.id && candidate.uci === uci);

    if (!edge) {
      break;
    }

    const nextNode = nodeById.get(edge.toNodeId);

    if (!nextNode || nextNode.ply !== currentNode.ply + 1) {
      break;
    }

    if (isEarlyOpeningPly(nextNode.ply, maxPly)) {
      const swing = evalSwingCpForSide(currentNode, nextNode);

      if (swing != null && swing <= -LINES_EARLY_OPENING_BLUNDER_LOSS_CP && currentNode.sideToMove === trainSide) {
        return true;
      }

      if (nextNode.evalCp != null && isLinesEvalConcerningForTrainSide(nextNode.evalCp, trainSide)) {
        return true;
      }
    }

    currentNode = nextNode;
  }

  return false;
}

export function resolveLinesBoardEarlyOpeningConcern(options: {
  mode: string;
  trainSide: OpeningSide;
  historyIndex: number;
  linesBoardEvalCp: number | null;
  linesBoardClassification: { category: LinesMoveCategory; evalLossCp: number | null } | null;
}) {
  if (options.mode !== 'lines' || options.historyIndex <= 0) {
    return false;
  }

  if (!isEarlyOpeningPly(options.historyIndex)) {
    return false;
  }

  if (
    options.linesBoardEvalCp != null &&
    isLinesEvalConcerningForTrainSide(options.linesBoardEvalCp, options.trainSide)
  ) {
    return true;
  }

  if (options.linesBoardClassification?.category === 'miss') {
    const loss = options.linesBoardClassification.evalLossCp;

    if (loss != null && loss >= LINES_EARLY_OPENING_BLUNDER_LOSS_CP) {
      return true;
    }
  }

  return false;
}
