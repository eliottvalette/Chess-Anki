import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { parseCardMoveReviews } from '@/lib/card-move-reviews';
import { type DeckProgressEntry, getDeckCardState } from '@/lib/deck-progress';
import { hashTrainingSessionToken, parseTrainingSessionCookie, TRAINING_SESSION_COOKIE } from '@/lib/training-profile';
import { createAdminClient } from '@/utils/supabase/admin';

const execFileAsync = promisify(execFile);
const DECK_CARD_SELECT =
  'id,kind,line_id,line_name,eco,side,ply,fen,answer_uci,answer_san,prompt,context,source_type,validation_mode,reference_eval_cp,max_eval_loss_cp,opponent_move_uci,opponent_move_san,score_swing_cp,replay_from_start,initial_fen,setup_moves,move_reviews';
const DECK_SELECT = 'id,name,description,version,is_active,owner_profile_id,created_at,updated_at';

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient();
    const profile = await getTrainingProfileFromCookie();
    const requestUrl = new URL(request.url);
    const scope = requestUrl.searchParams.get('scope');
    const selectedDeckId = requestUrl.searchParams.get('deckId');

    const { data: decks, error: deckError } = await fetchAccessibleDecks(supabase, profile?.id ?? null);
    if (deckError) {
      return NextResponse.json({ error: deckError.message }, { status: 500 });
    }

    const accessibleDecks = decks ?? [];
    const accessibleIds = accessibleDecks.map((deck) => String(deck.id));
    const [deckCounts, progressByCardId] = await Promise.all([
      fetchDeckCounts(supabase, accessibleIds),
      profile ? fetchProgressByCardId(supabase, profile.id) : Promise.resolve(new Map<string, ProgressRow>()),
    ]);
    const summaries = accessibleDecks.map((deck) =>
      summarizeDeck(deck, deckCounts.get(deck.id) ?? [], progressByCardId, profile?.id ?? null),
    );

    if (scope === 'all') {
      if (accessibleIds.length === 0) {
        return NextResponse.json({ decks: summaries, deck: null, lines: [], cards: [] });
      }

      const [{ data: lines, error: linesError }, { data: cards, error: cardsError }] = await Promise.all([
        supabase.from('opening_lines').select('id,name,eco,side,moves').in('deck_id', accessibleIds).order('id'),
        supabase
          .from('deck_cards')
          .select(DECK_CARD_SELECT)
          .in('deck_id', accessibleIds)
          .lte('ply', 80)
          .order('score_swing_cp', { ascending: false, nullsFirst: false }),
      ]);

      if (linesError) {
        return NextResponse.json({ error: linesError.message }, { status: 500 });
      }

      if (cardsError) {
        return NextResponse.json({ error: cardsError.message }, { status: 500 });
      }

      return NextResponse.json({
        decks: summaries,
        deck: null,
        lines: lines ?? [],
        cards: cards ?? [],
      });
    }

    const selectedDeck =
      (selectedDeckId && accessibleDecks.find((deck) => deck.id === selectedDeckId)) ||
      (profile ? accessibleDecks.find((deck) => deck.owner_profile_id === profile.id) : null) ||
      accessibleDecks[0] ||
      null;

    if (!selectedDeck) {
      return NextResponse.json({ decks: summaries, deck: null, lines: [], cards: [] });
    }

    const [{ data: lines, error: linesError }, { data: cards, error: cardsError }] = await Promise.all([
      supabase.from('opening_lines').select('id,name,eco,side,moves').eq('deck_id', selectedDeck.id).order('id'),
      supabase
        .from('deck_cards')
        .select(DECK_CARD_SELECT)
        .eq('deck_id', selectedDeck.id)
        .lte('ply', 80)
        .order('score_swing_cp', { ascending: false, nullsFirst: false }),
    ]);

    if (linesError) {
      return NextResponse.json({ error: linesError.message }, { status: 500 });
    }

    if (cardsError) {
      return NextResponse.json({ error: cardsError.message }, { status: 500 });
    }

    return NextResponse.json({
      decks: summaries,
      deck: summarizeDeck(selectedDeck, deckCounts.get(selectedDeck.id) ?? [], progressByCardId, profile?.id ?? null),
      lines: lines ?? [],
      cards: cards ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load training decks.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const profile = await getTrainingProfileFromCookie();

  if (!profile) {
    return NextResponse.json({ error: 'No training profile.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');

  if (action === 'create') {
    return createDeck(profile, body);
  }

  if (action === 'generate_recent') {
    return generateRecentDeck(profile, body, getRequestOrigin(request));
  }

  if (action === 'add_card') {
    return addReviewCard(profile, body);
  }

  if (action === 'delete_card') {
    return deleteDeckCard(profile, body);
  }

  if (action === 'rename_deck') {
    return renameDeck(profile, body);
  }

  if (action === 'delete_deck') {
    return deleteDeck(profile, body);
  }

  return NextResponse.json({ error: 'Unknown deck action.' }, { status: 400 });
}

async function createDeck(profile: TrainingProfileCookie, body: Record<string, unknown>) {
  const name = clampText(String(body.name ?? ''), 80);

  if (!name) {
    return NextResponse.json({ error: 'Deck title is required.' }, { status: 400 });
  }

  const id = `custom-${profile.id.slice(0, 8)}-${slugify(name)}-${Date.now()}`;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('decks')
    .insert({
      id,
      name,
      description: 'Manual review deck.',
      version: 1,
      is_active: true,
      owner_profile_id: profile.id,
    })
    .select(DECK_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deck: summarizeDeck(data, [], new Map(), profile.id) });
}

async function generateRecentDeck(
  profile: TrainingProfileCookie,
  body: Record<string, unknown>,
  requestOrigin: string,
) {
  const username = clampText(String(body.username ?? profile.username), 40).toLowerCase();
  const timeClass = normalizeTimeClass(body.timeClass);
  const count = Math.max(1, Math.min(100, Number.parseInt(String(body.count ?? 50), 10) || 50));
  const analyzeBaseUrl = process.env.ANALYZE_BASE_URL?.trim() || requestOrigin;

  if (!username) {
    return NextResponse.json({ error: 'Chess.com username is required.' }, { status: 400 });
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        'scripts/chesscom/build-recent-blitz-deck.mjs',
        '--username',
        username,
        '--profile',
        profile.username,
        '--count',
        String(count),
        '--time-class',
        timeClass,
        '--write-supabase',
        '--set-active',
        '--concurrency',
        '4',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ANALYZE_BASE_URL: analyzeBaseUrl,
        },
        maxBuffer: 1024 * 1024 * 4,
      },
    );

    return NextResponse.json({
      deckId: `recent-blitz-trainer-v1-${profile.username}`,
      generated: parseJson(stdout),
      logs: stderr,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Deck generation failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function addReviewCard(profile: TrainingProfileCookie, body: Record<string, unknown>) {
  const deckId = String(body.deckId ?? '');
  const card = sanitizeReviewCard(body.card);

  if (!deckId) {
    return NextResponse.json({ error: 'Choose a deck first.' }, { status: 400 });
  }

  if (!card) {
    return NextResponse.json({ error: 'No analyzable position to save.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: deck, error: deckError } = await supabase
    .from('decks')
    .select('id,owner_profile_id')
    .eq('id', deckId)
    .maybeSingle();

  if (deckError) {
    return NextResponse.json({ error: deckError.message }, { status: 500 });
  }

  if (!deck || deck.owner_profile_id !== profile.id) {
    return NextResponse.json({ error: 'Review cards can only be added to your own decks.' }, { status: 403 });
  }

  const id = `review-${createShortHash(`${deckId}:${card.fen}:${card.answerUci}`)}`;
  const { error } = await supabase.from('deck_cards').upsert(
    {
      id,
      deck_id: deckId,
      line_id: null,
      kind: 'punish_mistake',
      line_name: card.lineName,
      eco: card.eco,
      side: card.side,
      ply: card.ply,
      fen: card.fen,
      answer_uci: card.answerUci,
      answer_san: card.answerSan,
      prompt: card.prompt,
      context: card.context,
      source_type: 'review',
      validation_mode: 'strict_best',
      reference_eval_cp: card.referenceEvalCp ?? null,
      max_eval_loss_cp: 0,
      opponent_move_uci: null,
      opponent_move_san: null,
      score_swing_cp: null,
      replay_from_start: card.replayFromStart,
      initial_fen: card.initialFen,
      setup_moves: card.setupMoves,
      move_reviews: card.moveReviews,
    },
    { onConflict: 'id' },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ cardId: id });
}

async function deleteDeckCard(profile: TrainingProfileCookie, body: Record<string, unknown>) {
  const deckId = String(body.deckId ?? '');
  const cardId = String(body.cardId ?? '');

  if (!deckId || !cardId) {
    return NextResponse.json({ error: 'Deck and card are required.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: deck, error: deckError } = await supabase
    .from('decks')
    .select('id,owner_profile_id')
    .eq('id', deckId)
    .maybeSingle();

  if (deckError) {
    return NextResponse.json({ error: deckError.message }, { status: 500 });
  }

  if (!deck || !isDeckAccessibleToProfile(deck.owner_profile_id, profile.id)) {
    return NextResponse.json({ error: 'Deck not found or not accessible.' }, { status: 403 });
  }

  const { data: card, error: cardError } = await supabase
    .from('deck_cards')
    .select('id')
    .eq('id', cardId)
    .eq('deck_id', deckId)
    .maybeSingle();

  if (cardError) {
    return NextResponse.json({ error: cardError.message }, { status: 500 });
  }

  if (!card) {
    return NextResponse.json({ error: 'Card not found in this deck.' }, { status: 404 });
  }

  const { error: progressError } = await supabase
    .from('training_card_progress')
    .delete()
    .eq('profile_id', profile.id)
    .eq('card_id', cardId);

  if (progressError) {
    return NextResponse.json({ error: progressError.message }, { status: 500 });
  }

  const { error: deleteError } = await supabase.from('deck_cards').delete().eq('id', cardId).eq('deck_id', deckId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ cardId });
}

async function renameDeck(profile: TrainingProfileCookie, body: Record<string, unknown>) {
  const deckId = String(body.deckId ?? '');
  const name = clampText(String(body.name ?? ''), 80);

  if (!deckId) {
    return NextResponse.json({ error: 'Deck is required.' }, { status: 400 });
  }

  if (!name) {
    return NextResponse.json({ error: 'Deck title is required.' }, { status: 400 });
  }

  const manageableDeck = await getManageableDeck(profile, deckId);

  if (!manageableDeck) {
    return NextResponse.json({ error: 'Deck not found or not manageable.' }, { status: 403 });
  }

  const supabase = createAdminClient();
  let updateQuery = supabase.from('decks').update({ name }).eq('id', deckId);

  if (manageableDeck.owner_profile_id) {
    updateQuery = updateQuery.eq('owner_profile_id', profile.id);
  } else {
    updateQuery = updateQuery.is('owner_profile_id', null);
  }

  const { data, error } = await updateQuery.select(DECK_SELECT).single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const progressByCardId = await fetchProgressByCardId(supabase, profile.id);
  const deckCounts = await fetchDeckCounts(supabase, [deckId]);

  return NextResponse.json({
    deck: summarizeDeck(data, deckCounts.get(deckId) ?? [], progressByCardId, profile.id),
  });
}

async function deleteDeck(profile: TrainingProfileCookie, body: Record<string, unknown>) {
  const deckId = String(body.deckId ?? '');

  if (!deckId) {
    return NextResponse.json({ error: 'Deck is required.' }, { status: 400 });
  }

  const manageableDeck = await getManageableDeck(profile, deckId);

  if (!manageableDeck) {
    return NextResponse.json({ error: 'Deck not found or not manageable.' }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data: cards, error: cardsError } = await supabase.from('deck_cards').select('id').eq('deck_id', deckId);

  if (cardsError) {
    return NextResponse.json({ error: cardsError.message }, { status: 500 });
  }

  const cardIds = (cards ?? []).map((card) => String(card.id));

  if (cardIds.length > 0) {
    const { error: progressError } = await supabase
      .from('training_card_progress')
      .delete()
      .eq('profile_id', profile.id)
      .in('card_id', cardIds);

    if (progressError) {
      return NextResponse.json({ error: progressError.message }, { status: 500 });
    }
  }

  let deleteDeckQuery = supabase.from('decks').delete().eq('id', deckId);

  if (manageableDeck.owner_profile_id) {
    deleteDeckQuery = deleteDeckQuery.eq('owner_profile_id', profile.id);
  } else {
    deleteDeckQuery = deleteDeckQuery.is('owner_profile_id', null);
  }

  const { error: deleteError } = await deleteDeckQuery;

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ deckId });
}

function isDeckAccessibleToProfile(ownerProfileId: string | null | undefined, profileId: string) {
  return ownerProfileId == null || ownerProfileId === profileId;
}

async function getManageableDeck(profile: TrainingProfileCookie, deckId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('decks')
    .select('id,owner_profile_id,is_active')
    .eq('id', deckId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.is_active || !isDeckAccessibleToProfile(data.owner_profile_id, profile.id)) {
    return null;
  }

  return data;
}

async function _getOwnedDeck(profile: TrainingProfileCookie, deckId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('decks').select('id,owner_profile_id').eq('id', deckId).maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.owner_profile_id !== profile.id) {
    return null;
  }

  return data;
}

async function fetchAccessibleDecks(supabase: ReturnType<typeof createAdminClient>, profileId: string | null) {
  const query = supabase
    .from('decks')
    .select(DECK_SELECT)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  return profileId
    ? query.or(`owner_profile_id.eq.${profileId},owner_profile_id.is.null`)
    : query.is('owner_profile_id', null);
}

async function fetchDeckCounts(supabase: ReturnType<typeof createAdminClient>, deckIds: string[]) {
  const result = new Map<string, Array<{ id: string }>>();

  if (deckIds.length === 0) {
    return result;
  }

  const { data } = await supabase.from('deck_cards').select('id,deck_id').in('deck_id', deckIds);

  for (const row of data ?? []) {
    const deckId = String(row.deck_id);
    const cards = result.get(deckId) ?? [];
    cards.push({ id: String(row.id) });
    result.set(deckId, cards);
  }

  return result;
}

async function fetchProgressByCardId(supabase: ReturnType<typeof createAdminClient>, profileId: string) {
  const { data } = await supabase
    .from('training_card_progress')
    .select(
      'card_id,seen_count,ignored,due_at,interval_days,learning_step,mastery_score,last_response_ms,last_rating,stability,difficulty,retrievability,last_seen_at',
    )
    .eq('profile_id', profileId);
  const result = new Map<string, ProgressRow>();

  for (const row of data ?? []) {
    result.set(String(row.card_id), {
      seenCount: Number(row.seen_count ?? 0),
      ignored: Boolean(row.ignored),
      dueAt: row.due_at ? String(row.due_at) : null,
      intervalDays: Number(row.interval_days ?? 0),
      learningStep: Number(row.learning_step ?? 0),
      masteryScore: Number(row.mastery_score ?? 0),
      lastResponseMs: row.last_response_ms == null ? null : Number(row.last_response_ms),
      lastRating:
        row.last_rating === 'fail' ||
        row.last_rating === 'hard' ||
        row.last_rating === 'good' ||
        row.last_rating === 'easy'
          ? row.last_rating
          : null,
      stability: Number(row.stability ?? 0),
      difficulty: Number(row.difficulty ?? 5),
      retrievability: Number(row.retrievability ?? 0),
      lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
    });
  }

  return result;
}

function summarizeDeck(
  deck: Record<string, unknown>,
  cards: Array<{ id: string }>,
  progressByCardId: Map<string, ProgressRow>,
  profileId: string | null,
) {
  let newCount = 0;
  let learningCount = 0;
  let dueCount = 0;
  let ignoredCount = 0;

  for (const card of cards) {
    const progress = progressByCardId.get(card.id);
    const state = getDeckCardState(toDeckProgressEntry(progress));

    if (state === 'ignored') {
      ignoredCount += 1;
      continue;
    }

    if (state === 'new') {
      newCount += 1;
      continue;
    }

    if (state === 'learning') {
      learningCount += 1;
    } else if (state === 'due') {
      dueCount += 1;
    }
  }

  return {
    id: String(deck.id),
    name: String(deck.name ?? deck.id),
    description: deck.description ? String(deck.description) : '',
    ownerProfileId: deck.owner_profile_id ? String(deck.owner_profile_id) : null,
    cardCount: cards.length,
    newCount,
    learningCount,
    dueCount,
    ignoredCount,
    isOwned: Boolean(profileId && deck.owner_profile_id === profileId),
    canManage: Boolean(
      profileId && isDeckAccessibleToProfile(deck.owner_profile_id ? String(deck.owner_profile_id) : null, profileId),
    ),
  };
}

function toDeckProgressEntry(progress: ProgressRow | undefined): DeckProgressEntry {
  return {
    seenCount: progress?.seenCount ?? 0,
    correctCount: 0,
    missCount: 0,
    streak: 0,
    reviewCount: progress?.seenCount ?? 0,
    lapseCount: 0,
    learningStep: progress?.learningStep ?? 0,
    ease: 2.5,
    intervalDays: progress?.intervalDays ?? 0,
    masteryScore: progress?.masteryScore ?? 0,
    lastResponseMs: progress?.lastResponseMs ?? null,
    lastRating: progress?.lastRating ?? null,
    stability: progress?.stability ?? 0,
    difficulty: progress?.difficulty ?? 5,
    retrievability: progress?.retrievability ?? 0,
    ignored: Boolean(progress?.ignored),
    lastOutcome: null,
    dueAt: progress?.dueAt ?? null,
    lastSeenAt: progress?.lastSeenAt ?? null,
  };
}

function sanitizeReviewCard(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const card = value as Record<string, unknown>;
  const side = card.side === 'black' ? 'black' : card.side === 'white' ? 'white' : null;
  const answerUci = String(card.answerUci ?? '');

  if (!side || !answerUci || answerUci.length < 4) {
    return null;
  }

  const replayFromStart = card.replayFromStart === true;
  const setupMoves = sanitizeSetupMoves(card.setupMoves);

  if (replayFromStart && setupMoves.length === 0) {
    return null;
  }

  return {
    lineName: clampText(String(card.lineName ?? 'Review position'), 120) || 'Review position',
    eco: clampText(String(card.eco ?? 'GAME'), 12) || 'GAME',
    side,
    ply: clampInt(card.ply, 0, 500),
    fen: clampText(String(card.fen ?? ''), 120),
    answerUci: clampText(answerUci, 8),
    answerSan: clampText(String(card.answerSan ?? answerUci), 40) || answerUci,
    prompt:
      clampText(String(card.prompt ?? ''), 180) ||
      `${side === 'white' ? 'White' : 'Black'} to move: find the best response.`,
    context: clampText(String(card.context ?? 'Review position'), 500) || 'Review position',
    referenceEvalCp: Number.isFinite(Number(card.referenceEvalCp)) ? Math.trunc(Number(card.referenceEvalCp)) : null,
    replayFromStart,
    initialFen: typeof card.initialFen === 'string' && card.initialFen.trim() ? clampText(card.initialFen, 120) : null,
    setupMoves,
    moveReviews: parseCardMoveReviews(card.moveReviews),
  };
}

function sanitizeSetupMoves(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((move) => clampText(String(move ?? ''), 12))
    .filter((move) => move.length > 0)
    .slice(0, 500);
}

async function getTrainingProfileFromCookie(): Promise<TrainingProfileCookie | null> {
  const cookieStore = await cookies();
  const parsed = parseTrainingSessionCookie(cookieStore.get(TRAINING_SESSION_COOKIE)?.value);

  if (!parsed) {
    return null;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('training_profiles')
    .select('id,username,session_token_hash')
    .eq('id', parsed.profileId)
    .maybeSingle();

  if (error || !data?.session_token_hash) {
    return null;
  }

  return hashTrainingSessionToken(parsed.token) === data.session_token_hash
    ? { id: String(data.id), username: String(data.username), session_token_hash: String(data.session_token_hash) }
    : null;
}

function clampText(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

function getRequestOrigin(request: Request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.trim();

  if (forwardedHost) {
    return `${forwardedProto || url.protocol.replace(':', '')}://${forwardedHost}`;
  }

  return url.origin;
}

function clampInt(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? Math.trunc(number) : min));
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'deck'
  );
}

function createShortHash(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

function normalizeTimeClass(value: unknown) {
  return value === 'bullet' || value === 'rapid' ? value : 'blitz';
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

type ProgressRow = {
  seenCount: number;
  ignored: boolean;
  dueAt: string | null;
  intervalDays: number;
  learningStep: number;
  masteryScore: number;
  lastResponseMs: number | null;
  lastRating: DeckProgressEntry['lastRating'];
  stability: number;
  difficulty: number;
  retrievability: number;
  lastSeenAt: string | null;
};

type TrainingProfileCookie = {
  id: string;
  username: string;
  session_token_hash: string;
};
