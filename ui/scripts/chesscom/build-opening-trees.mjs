import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { Chess } from 'chess.js';
import { buildLichessExplorerHeaders } from '../../lib/lichess-explorer.ts';
import {
  listOpponentNodesForLichessEnrichment,
  listOpponentNodesNeedingBookEnrichment,
  pruneOpeningTreeDraft,
} from '../../lib/opening-tree.ts';
import {
  buildFreshOpeningForest,
  forestToUpsertRows,
  listNodesNeedingEnrichment,
} from '../../lib/opening-tree-import.ts';
import { loadLocalEnv, requireAdminKey, requireEnv } from '../supabase/env.mjs';

const DEFAULT_OPENING_ROOT_PLY = 4;
const DEFAULT_OPENING_TARGET_DEPTH = 22;
const LICHESS_EXPLORER_URL = 'https://explorer.lichess.org/masters';

function shortHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function normalizeOpeningFen(fen) {
  return fen.trim().split(' ').slice(0, 4).join(' ');
}

function getSideToMove(fen) {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function resolveOpeningLibrary(parsedMoves) {
  const firstMove = parsedMoves[0]?.uci;
  if (firstMove === 'e2e4') return 'e4';
  if (firstMove === 'd2d4') return 'd4';
  if (firstMove === 'c2c4') return 'c4';
  if (firstMove === 'g1f3') return 'nf3';
  return 'other';
}

function parseSanMoves(moves) {
  const chess = new Chess();
  const parsed = [];
  for (const rawMove of moves) {
    const token = String(rawMove ?? '').trim();
    if (!token) continue;
    const fenBefore = chess.fen();
    const sideToMove = chess.turn() === 'w' ? 'white' : 'black';
    const move = chess.move(token);
    if (!move) break;
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

function moveSanFromFen(fen, uci) {
  const chess = new Chess(fen);
  try {
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) });
    return move?.san ?? null;
  } catch {
    return null;
  }
}

function ensureDraftEdge(draft, fromNode, uci, source, options) {
  const chess = new Chess(fromNode.fen);
  let move;
  try {
    move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) });
  } catch {
    return;
  }
  if (!move) return;

  const toFen = chess.fen();
  const toFenKey = normalizeOpeningFen(toFen);
  let toNode = draft.nodes.find((node) => node.fenKey === toFenKey);

  if (!toNode) {
    toNode = {
      id: `opening-node-${shortHash(`${options.ownerProfileId}:${draft.trainSide}:${draft.library}:${toFenKey}`)}`,
      fen: toFen,
      fenKey: toFenKey,
      ply: fromNode.ply + 1,
      sideToMove: toFen.split(' ')[1] === 'b' ? 'black' : 'white',
      trainSide: draft.trainSide,
      bestUci: null,
      bestSan: null,
      evalCp: null,
      recentGames: 0,
      cardCount: 0,
    };
    draft.nodes.push(toNode);
  }

  const edgeId = `opening-edge-${shortHash(`${options.ownerProfileId}:${draft.trainSide}:${draft.library}:${fromNode.id}:${uci}`)}`;
  let edge = draft.edges.find((e) => e.fromNodeId === fromNode.id && e.uci === uci);

  if (!edge) {
    edge = {
      id: edgeId,
      fromNodeId: fromNode.id,
      toNodeId: toNode.id,
      uci,
      san: move.san,
      moveBy: move.color === 'w' ? 'white' : 'black',
      source,
      recentCount: 0,
      cardCount: 0,
      mastersGames: 0,
      priority: 0,
      isEngineBest: false,
    };
    draft.edges.push(edge);
  }

  edge.mastersGames += options.mastersGames ?? 0;
  edge.priority += options.priority ?? 0;
  edge.isEngineBest = edge.isEngineBest || Boolean(options.isEngineBest);
}

function buildTreeForGroup(group, options) {
  const first = group[0];
  const rootMoves = first.parsed.slice(0, options.rootPly);
  const treeId = `opening-tree-${shortHash(`${options.ownerProfileId}:${first.library}:${first.rootFenKey}`)}`;
  const nodes = new Map();
  const edges = new Map();

  for (const item of group) {
    const count = item.input.count ?? 1;
    const boundedMoves = item.parsed.slice(0, options.targetDepth);

    for (let index = options.rootPly; index <= boundedMoves.length; index++) {
      const fen = index === 0 ? new Chess().fen() : boundedMoves[index - 1]?.fenAfter;
      if (!fen) continue;
      const fenKey = normalizeOpeningFen(fen);
      const nodeId = `opening-node-${shortHash(`${treeId}:${fenKey}`)}`;
      const node = nodes.get(nodeId) ?? {
        id: nodeId,
        fen,
        fenKey,
        ply: index,
        sideToMove: getSideToMove(fen),
        trainSide: item.input.trainSide,
        bestUci: null,
        bestSan: null,
        evalCp: null,
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

    for (let index = options.rootPly; index < boundedMoves.length; index++) {
      const move = boundedMoves[index];
      const fromFen = index === 0 ? new Chess().fen() : boundedMoves[index - 1]?.fenAfter;
      if (!move || !fromFen) continue;

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
      edges.set(edgeId, edge);
    }
  }

  const name = first.input.name ?? 'Opening';

  return {
    id: treeId,
    ownerProfileId: options.ownerProfileId,
    name,
    library: first.library,
    rootFenKey: first.rootFenKey,
    rootPly: options.rootPly,
    rootSan: rootMoves.map((move) => move.san),
    rootUci: rootMoves.map((move) => move.uci),
    sourceCount: group.reduce((total, item) => total + (item.input.count ?? 1), 0),
    targetDepth: options.targetDepth,
    trainSide: first.input.trainSide,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}

function buildOpeningTrees(inputs, options) {
  const rootPly = options.rootPly ?? DEFAULT_OPENING_ROOT_PLY;
  const targetDepth = options.targetDepth ?? DEFAULT_OPENING_TARGET_DEPTH;
  const groups = new Map();

  for (const input of inputs) {
    const parsed = parseSanMoves(input.moves);
    if (parsed.length < rootPly) continue;
    const library = resolveOpeningLibrary(parsed);
    const rootFen = parsed[rootPly - 1]?.fenAfter;
    if (!rootFen) continue;
    const rootFenKey = normalizeOpeningFen(rootFen);
    const bucket = groups.get(rootFenKey) ?? [];
    bucket.push({ input, parsed, library, rootFenKey });
    groups.set(rootFenKey, bucket);
  }

  return [...groups.values()].map((group) =>
    buildTreeForGroup(group, { ownerProfileId: options.ownerProfileId, rootPly, targetDepth }),
  );
}

async function enrichEngineBestMoves(draft, analyzeBaseUrl, ownerProfileId, nodesToAnalyze = null) {
  const nodesToEnrich = [...(nodesToAnalyze ?? listNodesNeedingEnrichment(draft, 'backfill'))].sort(
    (left, right) => left.ply - right.ply || left.id.localeCompare(right.id),
  );

  for (const node of nodesToEnrich) {
    try {
      const response = await fetch(`${analyzeBaseUrl}/api/analyze-position`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fen: node.fen, depth: 18, multipv: 1 }),
      });

      if (!response.ok) {
        throw new Error(`Analyze request failed with status ${response.status}.`);
      }

      const analysis = await response.json();
      if (!analysis?.bestMove) {
        throw new Error('Analyze response did not include bestMove.');
      }

      node.bestUci = analysis.bestMove;
      node.bestSan = moveSanFromFen(node.fen, analysis.bestMove);
      node.evalCp = analysis.whitePerspective?.type === 'cp' ? analysis.whitePerspective.value : null;

      ensureDraftEdge(draft, node, analysis.bestMove, 'engine_best', {
        isEngineBest: true,
        priority: 100,
        ownerProfileId,
      });

      const targetNode = draft.nodes.find((candidate) => {
        const chess = new Chess(node.fen);
        try {
          chess.move({
            from: analysis.bestMove.slice(0, 2),
            to: analysis.bestMove.slice(2, 4),
            ...(analysis.bestMove[4] ? { promotion: analysis.bestMove[4] } : {}),
          });
        } catch {
          return false;
        }

        return candidate.fenKey === normalizeOpeningFen(chess.fen());
      });

      if (targetNode && targetNode.evalCp == null && analysis.lines?.[0]?.whitePerspective?.type === 'cp') {
        targetNode.evalCp = analysis.lines[0].whitePerspective.value;
      }
    } catch (error) {
      throw new Error(`Unable to enrich training node ${node.id} at ply ${node.ply}.`, { cause: error });
    }
  }
}

async function enrichLichessOpponentMoves(draft, ownerProfileId, lichessApiToken, nodesToEnrich = null, maxMoves = 4) {
  const maxGraphPly = draft.targetDepth - (draft.trainSide === 'black' ? 1 : 0);
  const opponentNodes = [...(nodesToEnrich ?? listOpponentNodesForLichessEnrichment(draft))]
    .filter((node) => node.ply < maxGraphPly)
    .sort((left, right) => left.ply - right.ply || left.id.localeCompare(right.id));

  for (const node of opponentNodes) {
    try {
      const url = new URL(LICHESS_EXPLORER_URL);
      url.searchParams.set('fen', node.fen);
      const response = await fetch(url.toString(), { headers: buildLichessExplorerHeaders(lichessApiToken) });
      if (!response.ok) {
        throw new Error(`Opening explorer request failed with status ${response.status}.`);
      }

      const explorer = await response.json();
      const moves = (explorer.moves ?? [])
        .map((move) => ({
          uci: move.uci,
          games: Number(move.white ?? 0) + Number(move.draws ?? 0) + Number(move.black ?? 0),
        }))
        .filter((move) => move.games > 0)
        .sort((left, right) => right.games - left.games)
        .slice(0, maxMoves);

      for (const move of moves) {
        ensureDraftEdge(draft, node, move.uci, 'lichess_masters', {
          mastersGames: move.games,
          priority: Math.log10(move.games + 1) * 4,
          ownerProfileId,
        });
      }
    } catch (error) {
      throw new Error(`Unable to enrich opponent node ${node.id} at ply ${node.ply}.`, { cause: error });
    }
  }
}

async function extendForcedTrainingContinuations(draft, analyzeBaseUrl, ownerProfileId, lichessApiToken) {
  const maxGraphPly = draft.targetDepth - (draft.trainSide === 'black' ? 1 : 0);
  const attemptedBookNodeIds = new Set();
  const attemptedEngineNodeIds = new Set();

  while (true) {
    const opponentLeaves = listOpponentNodesNeedingBookEnrichment(draft).filter(
      (node) => node.ply < maxGraphPly && !attemptedBookNodeIds.has(node.id),
    );

    for (const node of opponentLeaves) {
      attemptedBookNodeIds.add(node.id);
    }

    if (opponentLeaves.length > 0) {
      await enrichLichessOpponentMoves(draft, ownerProfileId, lichessApiToken, opponentLeaves, 1);
    }

    const trainLeaves = listNodesNeedingEnrichment(draft, 'backfill').filter(
      (node) => !node.bestUci && !attemptedEngineNodeIds.has(node.id),
    );

    for (const node of trainLeaves) {
      attemptedEngineNodeIds.add(node.id);
    }

    if (trainLeaves.length > 0) {
      await enrichEngineBestMoves(draft, analyzeBaseUrl, ownerProfileId, trainLeaves);
    }

    if (opponentLeaves.length === 0 && trainLeaves.length === 0) {
      break;
    }
  }
}

function assertTrainingContinuationsComplete(draft) {
  const missingNodes = listNodesNeedingEnrichment(draft, 'backfill').filter((node) => !node.bestUci);

  if (missingNodes.length === 0) {
    return;
  }

  const sample = missingNodes
    .slice(0, 5)
    .map((node) => `${node.id}@ply${node.ply}`)
    .join(', ');

  throw new Error(
    `Opening tree ${draft.library}/${draft.trainSide} still has ${missingNodes.length} train nodes without bestUci after enrichment: ${sample}`,
  );
}

function graphAsDraft(graph) {
  return {
    id: graph.id,
    name: graph.library,
    library: graph.library,
    rootFenKey: graph.graphRootFenKey,
    rootPly: 0,
    rootSan: [],
    rootUci: [],
    sourceCount: 0,
    targetDepth: graph.targetDepth,
    trainSide: graph.trainSide,
    nodes: graph.nodes,
    edges: graph.edges,
  };
}

async function upsertForestDraft(supabase, profileId, forest) {
  const now = new Date().toISOString();
  const rows = forestToUpsertRows(forest, now);
  const graphIds = rows.graphs.map((graph) => graph.id);

  if (rows.graphs.length > 0) {
    const { error: graphError } = await supabase.from('opening_graphs').upsert(
      rows.graphs.map((graph) => ({
        ...graph,
        owner_profile_id: profileId,
      })),
      { onConflict: 'owner_profile_id,library,train_side' },
    );

    if (graphError) throw new Error(graphError.message);
  }

  if (rows.nodes.length > 0) {
    const { error } = await supabase.from('opening_nodes').upsert(rows.nodes, { onConflict: 'graph_id,fen_key' });
    if (error) throw new Error(error.message);
  }

  if (rows.edges.length > 0) {
    const { error } = await supabase.from('opening_edges').upsert(rows.edges, {
      onConflict: 'graph_id,from_node_id,uci',
    });
    if (error) throw new Error(error.message);
  }

  if (graphIds.length > 0) {
    const { error: deleteError } = await supabase.from('opening_catalog').delete().in('graph_id', graphIds);
    if (deleteError) throw new Error(deleteError.message);
  }

  if (rows.catalogs.length > 0) {
    const { error } = await supabase.from('opening_catalog').upsert(
      rows.catalogs.map((catalog) => ({
        ...catalog,
        owner_profile_id: profileId,
      })),
      { onConflict: 'graph_id,fen_key,catalog_ply' },
    );
    if (error) throw new Error(error.message);
  }
}

export async function buildAndUpsertOpeningTrees({
  supabase,
  openingLines,
  cards,
  ownerProfileId,
  analyzeBaseUrl,
  lichessApiToken,
  logProgress,
}) {
  const lineInputs = openingLines.map((line) => ({
    id: line.id,
    name: line.name ?? 'Opening',
    trainSide: line.side === 'black' ? 'black' : 'white',
    moves: line.moves,
    source: 'recent_game',
    count: 1,
    outcome: line.outcome ?? 'unknown',
  }));

  const cardInputs = cards.map((card) => {
    const moves = [...(card.setup_moves ?? [])];
    if (card.answer_san) moves.push(card.answer_san);
    return {
      id: card.id,
      name: card.line_name ?? 'Opening',
      trainSide: card.side === 'black' ? 'black' : 'white',
      moves,
      source: 'card',
      count: 1,
      scoreSwingCp: card.score_swing_cp ?? null,
    };
  });

  const inputs = [...lineInputs, ...cardInputs].filter((input) => input.moves.length > 0);
  const forest = buildFreshOpeningForest(inputs, {
    ownerProfileId,
    targetDepth: DEFAULT_OPENING_TARGET_DEPTH,
  });

  logProgress(`building ${forest.graphs.length} graphs and ${forest.catalogs.length} catalog entries...`);

  for (let index = 0; index < forest.graphs.length; index += 1) {
    const graph = forest.graphs[index];
    logProgress(
      `[${index + 1}/${forest.graphs.length}] enriching graph ${graph.library}/${graph.trainSide} (${graph.nodes.length} nodes)`,
    );
    const draft = graphAsDraft(graph);
    await enrichLichessOpponentMoves(draft, ownerProfileId, lichessApiToken);
    await enrichEngineBestMoves(draft, analyzeBaseUrl, ownerProfileId);
    await extendForcedTrainingContinuations(draft, analyzeBaseUrl, ownerProfileId, lichessApiToken);
    assertTrainingContinuationsComplete(draft);
    pruneOpeningTreeDraft({
      id: graph.id,
      name: graph.library,
      library: graph.library,
      rootFenKey: graph.graphRootFenKey,
      rootPly: 0,
      rootSan: [],
      rootUci: [],
      sourceCount: 0,
      targetDepth: graph.targetDepth,
      trainSide: graph.trainSide,
      nodes: graph.nodes,
      edges: graph.edges,
    });
  }

  await upsertForestDraft(supabase, ownerProfileId, forest);
  logProgress(`done: upserted ${forest.catalogs.length} catalog entries across ${forest.graphs.length} graphs`);
  return forest.catalogs.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

async function main() {
  const env = loadLocalEnv();
  const supabaseUrl = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL');
  const adminKey = requireAdminKey(env);
  const analyzeBaseUrl = env.ANALYZE_BASE_URL?.trim() || 'http://localhost:3000';
  const lichessApiToken = requireEnv(env, 'LICHESS_API_TOKEN');

  const supabase = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profiles, error: profileError } = await supabase
    .from('training_profiles')
    .select('id,username')
    .limit(1);
  if (profileError) throw new Error(profileError.message);
  const profile = profiles?.[0];
  if (!profile) throw new Error('No training profile found.');

  const { data: decks, error: deckError } = await supabase
    .from('decks')
    .select('id')
    .eq('is_active', true)
    .eq('owner_profile_id', profile.id);
  if (deckError) throw new Error(deckError.message);
  const deckIds = (decks ?? []).map((deck) => deck.id);

  if (deckIds.length === 0) {
    console.error('[build-opening-trees] No active deck found. Run chesscom:build:deck first.');
    process.exit(1);
  }

  const [{ data: lines, error: linesError }, { data: cards, error: cardsError }] = await Promise.all([
    supabase.from('opening_lines').select('id,name,moves').in('deck_id', deckIds),
    supabase
      .from('deck_cards')
      .select('id,line_name,answer_san,setup_moves,score_swing_cp')
      .in('deck_id', deckIds)
      .eq('source_type', 'recent_game'),
  ]);

  if (linesError) throw new Error(linesError.message);
  if (cardsError) throw new Error(cardsError.message);

  await buildAndUpsertOpeningTrees({
    supabase,
    openingLines: lines ?? [],
    cards: cards ?? [],
    ownerProfileId: profile.id,
    analyzeBaseUrl,
    lichessApiToken,
    logProgress: (message) => console.error(`[build-opening-trees ${new Date().toISOString()}] ${message}`),
  });
}
