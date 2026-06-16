import { loadLocalEnv } from '../supabase/env.mjs';
Object.assign(process.env, loadLocalEnv());

import { createAdminClient } from '../../utils/supabase/admin';
import {
  DEFAULT_OPENING_TARGET_DEPTH,
  buildOpeningTrees,
  type OpeningTreeDraft,
} from '../../lib/opening-tree';
import { getStockfishSession } from '../../lib/stockfish-session';
import { fetchLichessOpeningExplorer } from '../../lib/opening-book';
import { Chess } from 'chess.js';
import { ensureDraftEdge } from '../../app/api/opening-trees/route';

const MAX_ENGINE_IMPORT_NODES = 60;
const MAX_LICHESS_IMPORT_NODES = 120;
const CARD_SELECT = 'id,line_name,eco,side,answer_san,context,setup_moves,source_type,score_swing_cp';

function moveSanFromFen(fen: string, uci: string) {
  try {
    const game = new Chess(fen);
    const move = game.move({
      from: uci.substring(0, 2),
      to: uci.substring(2, 4),
      promotion: uci.length === 5 ? uci[4] : undefined,
    });
    return move?.san;
  } catch {
    return null;
  }
}

async function buildInputsFromRows(lines: any[], cards: any[]) {
  const inputs = [];

  for (const line of lines) {
    if (!line.moves || !Array.isArray(line.moves)) continue;
    inputs.push({
      id: String(line.id),
      name: String(line.name ?? 'Opening'),
      trainSide: (line.side === 'black' ? 'black' : 'white') as 'white' | 'black',
      moves: line.moves,
      source: 'recent_game' as const,
      count: 1,
    });
  }

  for (const card of cards) {
    if (!card.setup_moves || !Array.isArray(card.setup_moves)) continue;
    const moves = [...card.setup_moves];
    if (card.answer_san) {
      moves.push(card.answer_san);
    }

    inputs.push({
      id: String(card.id),
      name: String(card.line_name ?? 'Opening'),
      trainSide: (card.side === 'black' ? 'black' : 'white') as 'white' | 'black',
      moves,
      source: 'card' as const,
      count: 1,
      scoreSwingCp: card.score_swing_cp == null ? null : Number(card.score_swing_cp),
    });
  }

  return inputs;
}

async function enrichEngineBestMoves(draft: OpeningTreeDraft) {
  const trainNodes = draft.nodes
    .sort((left, right) => left.ply - right.ply)
    .slice(0, MAX_ENGINE_IMPORT_NODES);
  
  const session = trainNodes.length > 0 ? await getStockfishSession() : null;

  if (!session) {
    return;
  }

  for (const node of trainNodes) {
    try {
      const analysis = await session.analyze({ fen: node.fen, depth: draft.targetDepth, movetimeMs: undefined, multipv: 1 });

      if (!analysis || !analysis.bestMove) continue;

      node.bestUci = analysis.bestMove;
      node.bestSan = moveSanFromFen(node.fen, analysis.bestMove) ?? analysis.bestMove;
      node.evalCp = analysis.whitePerspective?.type === 'cp'
        ? analysis.whitePerspective.value
        : null;

      ensureDraftEdge(draft, node, analysis.bestMove, 'engine_best', {
        isEngineBest: true,
        priority: 100,
      });
    } catch {
      // Keep going
    }
  }
}

async function enrichLichessOpponentMoves(draft: OpeningTreeDraft) {
  const opponentNodes = draft.nodes
    .sort((left, right) => left.ply - right.ply)
    .slice(0, MAX_LICHESS_IMPORT_NODES);

  for (const node of opponentNodes) {
    try {
      const explorer = await fetchLichessOpeningExplorer(node.fen);
      const moves = (explorer.moves ?? [])
        .map(move => ({
          uci: move.uci,
          games: Number(move.white ?? 0) + Number(move.draws ?? 0) + Number(move.black ?? 0),
        }))
        .filter(move => move.games > 0)
        .sort((left, right) => right.games - left.games)
        .slice(0, 6);

      for (const move of moves) {
        ensureDraftEdge(draft, node, move.uci, 'lichess_masters', {
          mastersGames: move.games,
        });
      }
    } catch {
      // Keep going
    }
  }
}

async function upsertTreeDraft(supabase: any, draft: OpeningTreeDraft, ownerProfileId: string) {
  const now = new Date().toISOString();

  const { error: treeError } = await supabase.from('opening_trees').upsert(
    {
      id: draft.id,
      owner_profile_id: ownerProfileId,
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

  if (treeError) {
    throw new Error(treeError.message);
  }

  if (draft.nodes.length > 0) {
    const { error } = await supabase.from('opening_nodes').upsert(
      draft.nodes.map(node => ({
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

    if (error) {
      throw new Error(error.message);
    }
  }

  if (draft.edges.length > 0) {
    const { error } = await supabase.from('opening_edges').upsert(
      draft.edges.map(edge => ({
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

    if (error) {
      throw new Error(error.message);
    }
  }
}

async function main() {
  console.log('[build-opening-trees] Connecting to Supabase...');
  const supabase = createAdminClient();

  // For this script we assume a single user. If multi-user, we should fetch profiles.
  // We'll just fetch the cards for the current local user or globally if there's only one.
  const { data: cards, error: cardsError } = await supabase
    .from('deck_cards')
    .select(CARD_SELECT)
    .eq('source_type', 'recent_game');

  if (cardsError) {
    throw new Error(cardsError.message);
  }

  const { data: lines, error: linesError } = await supabase
    .from('opening_lines')
    .select('id,name,side,moves');

  if (linesError) {
    throw new Error(linesError.message);
  }

  // Find the profile id (we can just take it from the first card if available)
  let ownerProfileId = 'global';
  const { data: profileData } = await supabase.from('training_profiles').select('id').limit(1);
  if (profileData && profileData.length > 0) {
    ownerProfileId = profileData[0].id;
  }

  const inputs = await buildInputsFromRows(lines ?? [], cards ?? []);
  console.log(`[build-opening-trees] Found ${inputs.length} total inputs (lines + cards)`);

  const drafts = buildOpeningTrees(inputs, { ownerProfileId, targetDepth: DEFAULT_OPENING_TARGET_DEPTH });
  console.log(`[build-opening-trees] Grouped into ${drafts.length} Opening Trees. Beginning enrichment...`);

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    console.log(`[build-opening-trees] [${i + 1}/${drafts.length}] Enriching ${draft.name} (${draft.nodes.length} nodes)`);
    
    // Enrich with Engine
    await enrichEngineBestMoves(draft);
    
    // Enrich with Lichess
    await enrichLichessOpponentMoves(draft);
    
    // Save to DB
    await upsertTreeDraft(supabase, draft, ownerProfileId);
  }

  console.log('[build-opening-trees] Done building opening trees!');
  process.exit(0);
}

main().catch(console.error);
