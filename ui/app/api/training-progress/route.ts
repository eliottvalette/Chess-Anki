import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import type { DeckProgressEntry, DeckProgressMap } from '@/lib/deck-progress';
import { hashTrainingSessionToken, parseTrainingSessionCookie, TRAINING_SESSION_COOKIE } from '@/lib/training-profile';
import { createAdminClient } from '@/utils/supabase/admin';

export async function GET() {
  const profile = await getTrainingProfileFromCookie();

  if (!profile) {
    return NextResponse.json({ error: 'No training profile.' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('training_card_progress')
    .select(
      'card_id,seen_count,correct_count,miss_count,streak,review_count,lapse_count,learning_step,ease,interval_days,mastery_score,last_response_ms,last_rating,stability,difficulty,retrievability,ignored,last_outcome,due_at,last_seen_at',
    )
    .eq('profile_id', profile.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const progress: DeckProgressMap = {};

  for (const row of data ?? []) {
    progress[String(row.card_id)] = {
      seenCount: Number(row.seen_count ?? 0),
      correctCount: Number(row.correct_count ?? 0),
      missCount: Number(row.miss_count ?? 0),
      streak: Number(row.streak ?? 0),
      reviewCount: Number(row.review_count ?? 0),
      lapseCount: Number(row.lapse_count ?? 0),
      learningStep: Number(row.learning_step ?? 0),
      ease: Number(row.ease ?? 2.5),
      intervalDays: Number(row.interval_days ?? 0),
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
      ignored: Boolean(row.ignored),
      lastOutcome: row.last_outcome === 'correct' || row.last_outcome === 'miss' ? row.last_outcome : null,
      dueAt: row.due_at ? String(row.due_at) : null,
      lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
    };
  }

  return NextResponse.json({ progress });
}

export async function POST(request: Request) {
  const profile = await getTrainingProfileFromCookie();

  if (!profile) {
    return NextResponse.json({ error: 'No training profile.' }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { progress?: unknown; attempt?: unknown };
    const progress = sanitizeProgress(body.progress);
    const attempt = sanitizeAttempt(body.attempt);
    const supabase = createAdminClient();
    const progressCardIds = Object.keys(progress);
    const validProgressCardIds = await fetchExistingCardIds(supabase, progressCardIds);
    const rows = Object.entries(progress).flatMap(([cardId, entry]) => {
      if (!validProgressCardIds.has(cardId)) {
        return [];
      }

      return [
        {
          profile_id: profile.id,
          card_id: cardId,
          seen_count: entry.seenCount,
          correct_count: entry.correctCount,
          miss_count: entry.missCount,
          streak: entry.streak,
          review_count: entry.reviewCount,
          lapse_count: entry.lapseCount,
          learning_step: entry.learningStep,
          ease: entry.ease,
          interval_days: entry.intervalDays,
          mastery_score: entry.masteryScore,
          last_response_ms: entry.lastResponseMs,
          last_rating: entry.lastRating,
          stability: entry.stability,
          difficulty: entry.difficulty,
          retrievability: entry.retrievability,
          ignored: entry.ignored,
          last_outcome: entry.lastOutcome,
          due_at: entry.dueAt ?? new Date(0).toISOString(),
          last_seen_at: entry.lastSeenAt,
        },
      ];
    });

    let saved = 0;

    if (rows.length > 0) {
      const { error } = await supabase
        .from('training_card_progress')
        .upsert(rows, { onConflict: 'profile_id,card_id' });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      saved = rows.length;
    }

    if (attempt) {
      const attemptCardIds = await fetchExistingCardIds(supabase, [attempt.cardId]);

      if (!attemptCardIds.has(attempt.cardId)) {
        return NextResponse.json({ saved, attemptSaved: false });
      }

      const { error } = await supabase.from('training_card_attempts').insert({
        profile_id: profile.id,
        card_id: attempt.cardId,
        played_uci: attempt.playedUci,
        played_san: attempt.playedSan,
        expected_uci: attempt.expectedUci,
        expected_san: attempt.expectedSan,
        correct: attempt.correct,
        exact: attempt.exact,
        eval_loss_cp: attempt.evalLossCp,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ saved, attemptSaved: Boolean(attempt) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save training progress.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function sanitizeProgress(value: unknown): DeckProgressMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const progress: DeckProgressMap = {};

  for (const [cardId, rawEntry] of Object.entries(value)) {
    if (!cardId || !rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      continue;
    }

    const entry = rawEntry as Partial<DeckProgressEntry>;
    progress[cardId] = {
      seenCount: clampCount(entry.seenCount),
      correctCount: clampCount(entry.correctCount),
      missCount: clampCount(entry.missCount),
      streak: clampCount(entry.streak),
      reviewCount: clampCount(entry.reviewCount),
      lapseCount: clampCount(entry.lapseCount),
      learningStep: clampCount(entry.learningStep),
      ease: clampEase(entry.ease),
      intervalDays: clampCount(entry.intervalDays),
      masteryScore: clampCount(entry.masteryScore),
      lastResponseMs: clampNullableCount(entry.lastResponseMs),
      lastRating:
        entry.lastRating === 'fail' ||
        entry.lastRating === 'hard' ||
        entry.lastRating === 'good' ||
        entry.lastRating === 'easy'
          ? entry.lastRating
          : null,
      stability: clampMemoryNumber(entry.stability, 0, 0, 3650),
      difficulty: clampMemoryNumber(entry.difficulty, 5, 1, 10),
      retrievability: clampMemoryNumber(entry.retrievability, 0, 0, 1),
      ignored: Boolean(entry.ignored),
      lastOutcome: entry.lastOutcome === 'correct' || entry.lastOutcome === 'miss' ? entry.lastOutcome : null,
      dueAt: typeof entry.dueAt === 'string' ? entry.dueAt : null,
      lastSeenAt: typeof entry.lastSeenAt === 'string' ? entry.lastSeenAt : null,
    };
  }

  return progress;
}

async function fetchExistingCardIds(supabase: ReturnType<typeof createAdminClient>, cardIds: string[]) {
  const validCardIds = new Set<string>();

  if (cardIds.length === 0) {
    return validCardIds;
  }

  const { data, error } = await supabase.from('deck_cards').select('id').in('id', cardIds);

  if (error) {
    throw new Error(error.message);
  }

  for (const row of data ?? []) {
    validCardIds.add(String(row.id));
  }

  return validCardIds;
}

function clampCount(value: unknown) {
  return Math.max(0, Math.min(1_000_000, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0));
}

function clampEase(value: unknown) {
  return Math.max(1.3, Math.min(3.2, Number.isFinite(Number(value)) ? Number(value) : 2.5));
}

function clampMemoryNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function clampNullableCount(value: unknown) {
  if (value == null) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1_000_000, Math.trunc(number))) : null;
}

function sanitizeAttempt(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const attempt = value as Record<string, unknown>;
  const cardId = String(attempt.cardId ?? '');
  const playedUci = String(attempt.playedUci ?? '');
  const playedSan = String(attempt.playedSan ?? '');
  const expectedUci = String(attempt.expectedUci ?? '');
  const expectedSan = String(attempt.expectedSan ?? '');

  if (!cardId || !playedUci || !playedSan || !expectedUci || !expectedSan) {
    return null;
  }

  const evalLossValue = Number(attempt.evalLossCp);

  return {
    cardId,
    playedUci,
    playedSan,
    expectedUci,
    expectedSan,
    correct: Boolean(attempt.correct),
    exact: Boolean(attempt.exact),
    evalLossCp: Number.isFinite(evalLossValue) ? Math.trunc(evalLossValue) : null,
  };
}

async function getTrainingProfileFromCookie() {
  const cookieStore = await cookies();
  const parsed = parseTrainingSessionCookie(cookieStore.get(TRAINING_SESSION_COOKIE)?.value);

  if (!parsed) {
    return null;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('training_profiles')
    .select('id,session_token_hash')
    .eq('id', parsed.profileId)
    .maybeSingle();

  if (error || !data?.session_token_hash) {
    return null;
  }

  return hashTrainingSessionToken(parsed.token) === data.session_token_hash ? data : null;
}
