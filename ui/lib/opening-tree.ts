import { Chess } from 'chess.js';

export type OpeningLibrary = 'white' | 'black_vs_e4' | 'black_vs_d4' | 'black_vs_c4' | 'black_vs_n_f3' | 'black_other';
export type OpeningSide = 'white' | 'black';
export type OpeningEdgeSource = 'recent_game' | 'card' | 'lichess_masters' | 'engine_best' | 'mixed';

export type OpeningMove = {
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  color: OpeningSide;
  ply: number;
};

export type OpeningTreeBuildInput = {
  id: string;
  name: string;
  trainSide: OpeningSide;
  moves: string[];
  source: 'recent_game' | 'card';
  count?: number;
  scoreSwingCp?: number | null;
};

export type OpeningTreeDraft = {
  id: string;
  name: string;
  library: OpeningLibrary;
  rootFenKey: string;
  rootPly: number;
  rootSan: string[];
  rootUci: string[];
  trainSide: OpeningSide;
  sourceCount: number;
  targetDepth: number;
  nodes: OpeningNodeDraft[];
  edges: OpeningEdgeDraft[];
};

export type OpeningNodeDraft = {
  id: string;
  fen: string;
  fenKey: string;
  ply: number;
  sideToMove: OpeningSide;
  trainSide: OpeningSide;
  bestUci?: string | null;
  bestSan?: string | null;
  evalCp?: number | null;
  recentGames: number;
  cardCount: number;
};

export type OpeningEdgeDraft = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  uci: string;
  san: string;
  moveBy: OpeningSide;
  source: OpeningEdgeSource;
  recentCount: number;
  cardCount: number;
  mastersGames: number;
  priority: number;
  isEngineBest: boolean;
};

export type OpeningTreeSummary = {
  id: string;
  name: string;
  library: OpeningLibrary;
  rootSan: string[];
  sourceCount: number;
  targetDepth: number;
  nodeCount: number;
  dueCount: number;
  masteryScore: number;
  updatedAt: string | null;
};

export type OpeningTreeDetail = OpeningTreeSummary & {
  nodes: OpeningTreeNode[];
  edges: OpeningTreeEdge[];
};

export type OpeningTreeNode = {
  id: string;
  fen: string;
  fenKey: string;
  ply: number;
  sideToMove: OpeningSide;
  trainSide: OpeningSide;
  bestUci: string | null;
  bestSan: string | null;
  evalCp: number | null;
  recentGames: number;
  cardCount: number;
  masteryScore: number;
  seenCount: number;
  correctCount: number;
  missCount: number;
};

export type OpeningTreeEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  uci: string;
  san: string;
  moveBy: OpeningSide;
  source: OpeningEdgeSource;
  recentCount: number;
  cardCount: number;
  mastersGames: number;
  priority: number;
  isEngineBest: boolean;
};

export type OpeningDrillStep = {
  treeId: string;
  pathNodeIds: string[];
  pathEdgeIds: string[];
  activeNodeId: string;
  fen: string;
  sideToMove: OpeningSide;
  expectedUci: string | null;
  expectedSan: string | null;
  depthRemaining: number;
};

export const DEFAULT_OPENING_ROOT_PLY = 4;
export const DEFAULT_OPENING_TARGET_DEPTH = 10;

export function normalizeOpeningFen(fen: string) {
  return fen.trim().split(' ').slice(0, 4).join(' ');
}

export function parseSanMoves(moves: string[], initialFen: string | null = null): OpeningMove[] {
  const chess = initialFen ? new Chess(initialFen) : new Chess();
  const parsed: OpeningMove[] = [];

  for (const rawMove of moves) {
    const token = String(rawMove ?? '').trim();

    if (!token) {
      continue;
    }

    const fenBefore = chess.fen();
    const sideToMove = chess.turn() === 'w' ? 'white' : 'black';
    const move = chess.move(token);

    if (!move) {
      break;
    }

    parsed.push({
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion ?? ''}`,
      fenBefore,
      fenAfter: chess.fen(),
      color: sideToMove,
      ply: parsed.length + 1,
    });
  }

  return parsed;
}

export function tokenizePgnMoves(text: string) {
  return text
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\{[^}]*}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean)
    .filter(token => !/^\d+\.(\.\.)?$/.test(token))
    .filter(token => !/^\d+\.\.\.$/.test(token))
    .filter(token => !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token))
    .map(token => token.replace(/^\d+\.+/, ''))
    .filter(Boolean);
}

export function resolveOpeningLibrary(trainSide: OpeningSide, parsedMoves: OpeningMove[]): OpeningLibrary {
  if (trainSide === 'white') {
    return 'white';
  }

  const firstMove = parsedMoves[0]?.uci;

  if (firstMove === 'e2e4') {
    return 'black_vs_e4';
  }

  if (firstMove === 'd2d4') {
    return 'black_vs_d4';
  }

  if (firstMove === 'c2c4') {
    return 'black_vs_c4';
  }

  if (firstMove === 'g1f3') {
    return 'black_vs_n_f3';
  }

  return 'black_other';
}

export function buildOpeningTrees(inputs: OpeningTreeBuildInput[], options: { ownerProfileId: string; targetDepth?: number; rootPly?: number }) {
  const rootPly = options.rootPly ?? DEFAULT_OPENING_ROOT_PLY;
  const targetDepth = options.targetDepth ?? DEFAULT_OPENING_TARGET_DEPTH;
  const groups = new Map<string, { input: OpeningTreeBuildInput; parsed: OpeningMove[]; library: OpeningLibrary; rootFenKey: string }[]>();

  for (const input of inputs) {
    const parsed = parseSanMoves(input.moves);

    if (parsed.length < rootPly) {
      continue;
    }

    const library = resolveOpeningLibrary(input.trainSide, parsed);
    const rootFen = parsed[rootPly - 1]?.fenAfter;

    if (!rootFen) {
      continue;
    }

    const rootFenKey = normalizeOpeningFen(rootFen);
    const key = `${library}|${rootFenKey}`;
    const bucket = groups.get(key) ?? [];
    bucket.push({ input, parsed, library, rootFenKey });
    groups.set(key, bucket);
  }

  return [...groups.values()].map(group => buildTreeForGroup(group, {
    ownerProfileId: options.ownerProfileId,
    rootPly,
    targetDepth,
  }));
}

export function chooseWeightedOpponentEdge(edges: OpeningTreeEdge[], seed = Date.now()) {
  const weighted = edges.map(edge => ({
    edge,
    weight: Math.max(1, edge.priority + edge.recentCount * 3 + edge.cardCount * 6 + (edge.isEngineBest ? 4 : 0)),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = seededUnit(seed) * total;

  for (const item of weighted) {
    roll -= item.weight;

    if (roll <= 0) {
      return item.edge;
    }
  }

  return weighted[0]?.edge ?? null;
}

export function applyOpeningAttemptScore(currentScore: number, correct: boolean) {
  return Math.max(0, Math.min(100, currentScore + (correct ? 18 : -22)));
}

export type DrillPathStep = {
  nodeId: string;
  fen: string;
  sideToMove: OpeningSide;
  trainSide: OpeningSide;
  bestUci: string | null;
  bestSan: string | null;
  masteryScore: number;
  isTrainTurn: boolean;
  edgeSanFromParent: string | null;
  edgeUciFromParent: string | null;
};

export function buildDrillPath(
  tree: { nodes: OpeningTreeNode[]; edges: OpeningTreeEdge[]; rootSan: string[] },
  options: { preferWeak?: boolean; seed?: number; startNodeId?: string } = {},
): DrillPathStep[] {
  const rootPly = tree.rootSan.length;
  const rootNode = options.startNodeId 
    ? tree.nodes.find(node => node.id === options.startNodeId)
    : (tree.nodes.find(node => node.ply === rootPly) ?? tree.nodes[0]);

  if (!rootNode) {
    return [];
  }

  const path: DrillPathStep[] = [];
  const visited = new Set<string>();
  let currentNodeId = rootNode.id;
  let currentSeed = options.seed ?? Date.now();

  while (currentNodeId && !visited.has(currentNodeId)) {
    visited.add(currentNodeId);
    const node = tree.nodes.find(candidate => candidate.id === currentNodeId);

    if (!node) {
      break;
    }

    const isTrainTurn = node.sideToMove === node.trainSide;
    path.push({
      nodeId: node.id,
      fen: node.fen,
      sideToMove: node.sideToMove,
      trainSide: node.trainSide,
      bestUci: node.bestUci,
      bestSan: node.bestSan,
      masteryScore: node.masteryScore,
      isTrainTurn,
      edgeSanFromParent: null,
      edgeUciFromParent: null,
    });

    const outgoing = tree.edges.filter(edge => edge.fromNodeId === currentNodeId);

    if (outgoing.length === 0) {
      break;
    }

    let chosenEdge: OpeningTreeEdge | null = null;

    if (isTrainTurn) {
      const nonMistakes = outgoing.filter(edge => {
        if (edge.isEngineBest) return true;
        const target = tree.nodes.find(n => n.id === edge.toNodeId);
        if (!target || node.evalCp == null || target.evalCp == null) return true;
        const swing = node.sideToMove === 'white' ? target.evalCp - node.evalCp : node.evalCp - target.evalCp;
        return swing > -100;
      });

      if (nonMistakes.length > 0) {
        chosenEdge = nonMistakes.find(edge => edge.isEngineBest) ?? nonMistakes[0] ?? null;
      } else {
        chosenEdge = null;
      }
    } else {
      if (options.preferWeak) {
        const weakTargets = outgoing.filter(edge => {
          const target = tree.nodes.find(candidate => candidate.id === edge.toNodeId);
          return target && target.sideToMove === target.trainSide && target.masteryScore < 80;
        });

        if (weakTargets.length > 0) {
          chosenEdge = chooseWeightedOpponentEdge(weakTargets, currentSeed);
        }
      }

      if (!chosenEdge) {
        chosenEdge = chooseWeightedOpponentEdge(outgoing, currentSeed);
      }
    }

    if (!chosenEdge) {
      break;
    }

    if (path.length > 0) {
      const lastStep = path[path.length - 1];

      if (lastStep) {
        lastStep.edgeSanFromParent = null;
      }
    }

    const nextStep = tree.nodes.find(candidate => candidate.id === chosenEdge!.toNodeId);

    if (nextStep) {
      currentNodeId = nextStep.id;
      currentSeed += 1;
    } else {
      break;
    }
  }

  for (let index = 1; index < path.length; index += 1) {
    const step = path[index]!;
    const parentStep = path[index - 1]!;
    const connectingEdge = tree.edges.find(
      edge => edge.fromNodeId === parentStep.nodeId && edge.toNodeId === step.nodeId,
    );
    step.edgeSanFromParent = connectingEdge?.san ?? null;
    step.edgeUciFromParent = connectingEdge?.uci ?? null;
  }

  return path;
}

function buildTreeForGroup(
  group: { input: OpeningTreeBuildInput; parsed: OpeningMove[]; library: OpeningLibrary; rootFenKey: string }[],
  options: { ownerProfileId: string; rootPly: number; targetDepth: number },
): OpeningTreeDraft {
  const first = group[0]!;
  const rootMoves = first.parsed.slice(0, options.rootPly);
  const treeId = `opening-tree-${shortHash(`${options.ownerProfileId}:${first.library}:${first.rootFenKey}`)}`;
  const nodes = new Map<string, OpeningNodeDraft>();
  const edges = new Map<string, OpeningEdgeDraft>();

  for (const item of group) {
    const count = item.input.count ?? 1;
    const boundedMoves = item.parsed.slice(0, options.targetDepth);

    for (let index = options.rootPly; index <= boundedMoves.length; index += 1) {
      const fen = index === 0 ? new Chess().fen() : boundedMoves[index - 1]?.fenAfter;

      if (!fen) {
        continue;
      }

      const fenKey = normalizeOpeningFen(fen);
      const nodeId = `opening-node-${shortHash(`${treeId}:${fenKey}`)}`;
      const node = nodes.get(nodeId) ?? {
        id: nodeId,
        fen,
        fenKey,
        ply: index,
        sideToMove: getSideToMove(fen),
        trainSide: item.input.trainSide,
        recentGames: 0,
        cardCount: 0,
      };

      if (item.input.source === 'recent_game') {
        node.recentGames += count;
      } else {
        node.cardCount += count;
      }

      nodes.set(nodeId, node);
    }

    for (let index = options.rootPly; index < boundedMoves.length; index += 1) {
      const move = boundedMoves[index];
      const fromFen = boundedMoves[index - 1]?.fenAfter;

      if (!move || !fromFen) {
        continue;
      }

      const fromNodeId = `opening-node-${shortHash(`${treeId}:${normalizeOpeningFen(fromFen)}`)}`;
      const toNodeId = `opening-node-${shortHash(`${treeId}:${normalizeOpeningFen(move.fenAfter)}`)}`;
      const edgeId = `opening-edge-${shortHash(`${treeId}:${fromNodeId}:${move.uci}`)}`;
      const edge = edges.get(edgeId) ?? {
        id: edgeId,
        fromNodeId,
        toNodeId,
        uci: move.uci,
        san: move.san,
        moveBy: move.color,
        source: item.input.source,
        recentCount: 0,
        cardCount: 0,
        mastersGames: 0,
        priority: 0,
        isEngineBest: false,
      };

      if (item.input.source === 'recent_game') {
        edge.recentCount += item.input.count ?? 1;
      } else {
        edge.cardCount += item.input.count ?? 1;
      }

      edge.priority = edge.recentCount * 3 + edge.cardCount * 8 + Math.max(0, item.input.scoreSwingCp ?? 0) / 40;
      edge.source = edge.recentCount > 0 && edge.cardCount > 0 ? 'mixed' : edge.source;
      edges.set(edgeId, edge);
    }
  }

  return {
    id: treeId,
    name: deriveOpeningName(first.input.name, rootMoves),
    library: first.library,
    rootFenKey: first.rootFenKey,
    rootPly: options.rootPly,
    rootSan: rootMoves.map(move => move.san),
    rootUci: rootMoves.map(move => move.uci),
    trainSide: first.input.trainSide,
    sourceCount: group.reduce((total, item) => total + (item.input.count ?? 1), 0),
    targetDepth: options.targetDepth,
    nodes: [...nodes.values()].sort((left, right) => left.ply - right.ply || left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id)),
  };
}

function deriveOpeningName(name: string, rootMoves: OpeningMove[]) {
  const cleanName = String(name ?? '').replace(/\s+/g, ' ').trim();

  if (cleanName && cleanName !== 'Opening') {
    return cleanName.slice(0, 96);
  }

  return rootMoves.map(move => move.san).join(' ').slice(0, 96) || 'Opening';
}

function getSideToMove(fen: string): OpeningSide {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function seededUnit(seed: number) {
  const value = Math.sin(seed) * 10000;
  return value - Math.floor(value);
}

function shortHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash).toString(16).padStart(8, '0');
}
