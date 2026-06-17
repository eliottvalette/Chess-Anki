import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { Chess } from 'chess.js';
import { loadLocalEnv, requireAdminKey, requireEnv } from '../supabase/env.mjs';

const DEFAULT_OPENING_ROOT_PLY = 4;
const DEFAULT_OPENING_TARGET_DEPTH = 22;
const MAX_ENGINE_IMPORT_NODES = 60;
const MAX_LICHESS_IMPORT_NODES = 120;
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
      id: `opening-node-${shortHash(`${draft.id}:${toFenKey}`)}`,
      fen: toFen,
      fenKey: toFenKey,
      ply: fromNode.ply + 1,
      sideToMove: toFen.split(' ')[1] === 'b' ? 'black' : 'white',
      bestUci: null,
      bestSan: null,
      evalCp: null,
      recentGames: 0,
      cardCount: 0,
    };
    draft.nodes.push(toNode);
  }

  let edge = draft.edges.find((candidate) => candidate.fromNodeId === fromNode.id && candidate.uci === uci);
  if (!edge) {
    edge = {
      id: `opening-edge-${shortHash(`${draft.id}:${fromNode.id}:${uci}`)}`,
      fromNodeId: fromNode.id,
      toNodeId: toNode.id,
      uci,
      san: move.san,
      moveBy: fromNode.sideToMove,
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

async function enrichEngineBestMoves(draft, analyzeBaseUrl) {
  const trainNodes = [...draft.nodes].sort((left, right) => left.ply - right.ply).slice(0, MAX_ENGINE_IMPORT_NODES);

  for (const node of trainNodes) {
    try {
      const response = await fetch(`${analyzeBaseUrl}/api/analyze-position`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fen: node.fen, depth: draft.targetDepth, multipv: 1 }),
      });

      if (!response.ok) continue;

      const analysis = await response.json();
      if (!analysis?.bestMove) continue;

      node.bestUci = analysis.bestMove;
      node.bestSan = moveSanFromFen(node.fen, analysis.bestMove);
      node.evalCp = analysis.whitePerspective?.type === 'cp' ? analysis.whitePerspective.value : null;

      ensureDraftEdge(draft, node, analysis.bestMove, 'engine_best', { isEngineBest: true, priority: 100 });
    } catch {
      // continue
    }
  }
}

async function enrichLichessOpponentMoves(draft) {
  const opponentNodes = [...draft.nodes].sort((left, right) => left.ply - right.ply).slice(0, MAX_LICHESS_IMPORT_NODES);

  for (const node of opponentNodes) {
    try {
      const url = new URL(LICHESS_EXPLORER_URL);
      url.searchParams.set('fen', node.fen);
      const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      if (!response.ok) continue;

      const explorer = await response.json();
      const moves = (explorer.moves ?? [])
        .map((move) => ({
          uci: move.uci,
          games: Number(move.white ?? 0) + Number(move.draws ?? 0) + Number(move.black ?? 0),
        }))
        .filter((move) => move.games > 0)
        .sort((left, right) => right.games - left.games)
        .slice(0, 6);

      for (const move of moves) {
        ensureDraftEdge(draft, node, move.uci, 'lichess_masters', {
          mastersGames: move.games,
          priority: Math.log10(move.games + 1) * 4,
        });
      }
    } catch {
      // continue
    }
  }
}

async function upsertTreeDraft(supabase, profileId, draft) {
  const now = new Date().toISOString();

  const { error: treeError } = await supabase.from('opening_trees').upsert(
    {
      id: draft.id,
      owner_profile_id: profileId,
      library: draft.library,
      name: draft.name,
      root_fen_key: draft.rootFenKey,
      root_ply: draft.rootPly,
      root_san: draft.rootSan,
      root_uci: draft.rootUci,
      source_count: draft.sourceCount,
      target_depth: draft.targetDepth,
      updated_at: now,
    },
    { onConflict: 'owner_profile_id,library,root_fen_key' },
  );

  if (treeError) throw new Error(treeError.message);

  if (draft.nodes.length > 0) {
    const { error } = await supabase.from('opening_nodes').upsert(
      draft.nodes.map((node) => ({
        id: node.id,
        tree_id: draft.id,
        fen: node.fen,
        fen_key: node.fenKey,
        ply: node.ply,
        side_to_move: node.sideToMove,
        best_uci: node.bestUci ?? null,
        best_san: node.bestSan ?? null,
        eval_cp: node.evalCp ?? null,
        recent_games: node.recentGames,
        card_count: node.cardCount,
        updated_at: now,
      })),
      { onConflict: 'tree_id,fen_key' },
    );
    if (error) throw new Error(error.message);
  }

  if (draft.edges.length > 0) {
    const { error } = await supabase.from('opening_edges').upsert(
      draft.edges.map((edge) => ({
        id: edge.id,
        tree_id: draft.id,
        from_node_id: edge.fromNodeId,
        to_node_id: edge.toNodeId,
        uci: edge.uci,
        san: edge.san,
        move_by: edge.moveBy,
        source: edge.source,
        recent_count: edge.recentCount,
        card_count: edge.cardCount,
        masters_games: edge.mastersGames,
        priority: edge.priority,
        is_engine_best: edge.isEngineBest,
        updated_at: now,
      })),
      { onConflict: 'tree_id,from_node_id,uci' },
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
  logProgress,
}) {
  const lineInputs = openingLines.map((line) => ({
    id: line.id,
    name: line.name ?? 'Opening',
    moves: line.moves,
    source: 'recent_game',
    count: 1,
  }));

  const cardInputs = cards.map((card) => {
    const moves = [...(card.setup_moves ?? [])];
    if (card.answer_san) moves.push(card.answer_san);
    return {
      id: card.id,
      name: card.line_name ?? 'Opening',
      moves,
      source: 'card',
      count: 1,
      scoreSwingCp: card.score_swing_cp ?? null,
    };
  });

  const inputs = [...lineInputs, ...cardInputs].filter((input) => input.moves.length > 0);
  const drafts = buildOpeningTrees(inputs, { ownerProfileId, targetDepth: DEFAULT_OPENING_TARGET_DEPTH });

  logProgress(`building ${drafts.length} opening trees...`);

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    logProgress(`[${i + 1}/${drafts.length}] enriching "${draft.name}" (${draft.nodes.length} nodes)`);
    await enrichEngineBestMoves(draft, analyzeBaseUrl);
    await enrichLichessOpponentMoves(draft);
    await upsertTreeDraft(supabase, ownerProfileId, draft);
  }

  logProgress(`done: upserted ${drafts.length} opening trees`);
  return drafts.length;
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
    logProgress: (message) => console.error(`[build-opening-trees ${new Date().toISOString()}] ${message}`),
  });
}
