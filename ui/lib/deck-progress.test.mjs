import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDeckAttempt,
  getAttemptRating,
  getDeckCardState,
  getDeckProgressEntry,
  getDeckQueueCounts,
  getDeckStudyQueue,
  isDeckCardStudyable,
  sortCardsForReview,
  summarizeDeckProgress,
  summarizeLineMastery,
  toggleDeckIgnored,
} from './deck-progress.ts';

test('applyDeckAttempt uses Anki-style learning steps on first success', () => {
  const first = applyDeckAttempt({}, 'card-1', true, '2026-05-24T10:00:00.000Z');

  assert.deepEqual(getDeckProgressEntry(first, 'card-1'), {
    seenCount: 1,
    correctCount: 1,
    missCount: 0,
    streak: 1,
    reviewCount: 1,
    lapseCount: 0,
    learningStep: 1,
    ease: 2.5,
    intervalDays: 0,
    masteryScore: 41,
    lastResponseMs: null,
    ignored: false,
    lastOutcome: 'correct',
    dueAt: '2026-05-24T10:01:00.000Z',
    lastSeenAt: '2026-05-24T10:00:00.000Z',
  });
});

test('applyDeckAttempt only advances one mastery letter per correct answer', () => {
  const first = applyDeckAttempt({}, 'card-1', true, '2026-05-24T10:00:00.000Z', {
    exact: true,
    evalLossCp: 0,
    responseMs: 1_000,
  });

  assert.equal(getDeckProgressEntry(first, 'card-1').masteryScore, 33);
});

test('getAttemptRating maps correctness and response time to automatic review buttons', () => {
  assert.equal(getAttemptRating(false, 500), 'fail');
  assert.equal(getAttemptRating(true, 1_999), 'easy');
  assert.equal(getAttemptRating(true, 2_000), 'good');
  assert.equal(getAttemptRating(true, 4_999), 'good');
  assert.equal(getAttemptRating(true, 5_000), 'hard');
  assert.equal(getAttemptRating(true, 20_000), 'hard');
});

test('applyDeckAttempt stops adding response-time penalty after five seconds', () => {
  const baseEntry = {
    ...getDeckProgressEntry({}, 'card-1'),
    seenCount: 1,
    masteryScore: 34,
    lastSeenAt: '2026-05-23T10:00:00.000Z',
  };
  const fiveSeconds = applyDeckAttempt({ 'card-1': baseEntry }, 'card-1', true, '2026-05-24T10:00:00.000Z', {
    exact: true,
    evalLossCp: 0,
    responseMs: 5_000,
  });
  const twentySeconds = applyDeckAttempt({ 'card-1': baseEntry }, 'card-1', true, '2026-05-24T10:00:00.000Z', {
    exact: true,
    evalLossCp: 0,
    responseMs: 20_000,
  });

  assert.equal(
    getDeckProgressEntry(fiveSeconds, 'card-1').masteryScore,
    getDeckProgressEntry(twentySeconds, 'card-1').masteryScore,
  );
});

test('applyDeckAttempt increments seen counts and reschedules misses in one minute', () => {
  const first = applyDeckAttempt({}, 'card-1', true, '2026-05-24T10:00:00.000Z');
  const second = applyDeckAttempt(first, 'card-1', false, '2026-05-24T10:05:00.000Z');

  assert.deepEqual(getDeckProgressEntry(second, 'card-1'), {
    seenCount: 2,
    correctCount: 1,
    missCount: 1,
    streak: 0,
    reviewCount: 2,
    lapseCount: 1,
    learningStep: 0,
    ease: 2.3,
    intervalDays: 0,
    masteryScore: 9,
    lastResponseMs: null,
    ignored: false,
    lastOutcome: 'miss',
    dueAt: '2026-05-24T10:06:00.000Z',
    lastSeenAt: '2026-05-24T10:05:00.000Z',
  });
});

test('applyDeckAttempt graduates after completing all learning steps', () => {
  let progress = applyDeckAttempt({}, 'card-1', true, '2026-05-24T10:00:00.000Z');
  progress = applyDeckAttempt(progress, 'card-1', true, '2026-05-24T10:01:00.000Z');
  progress = applyDeckAttempt(progress, 'card-1', true, '2026-05-24T10:11:00.000Z');

  assert.deepEqual(getDeckProgressEntry(progress, 'card-1'), {
    seenCount: 3,
    correctCount: 3,
    missCount: 0,
    streak: 3,
    reviewCount: 3,
    lapseCount: 0,
    learningStep: 0,
    ease: 2.5,
    intervalDays: 1,
    masteryScore: 100,
    lastResponseMs: null,
    ignored: false,
    lastOutcome: 'correct',
    dueAt: '2026-05-25T10:11:00.000Z',
    lastSeenAt: '2026-05-24T10:11:00.000Z',
  });
});

test('isDeckCardStudyable keeps missed cards in the study queue immediately', () => {
  const missed = applyDeckAttempt({}, 'card-1', false, '2026-05-24T10:05:00.000Z');

  assert.equal(isDeckCardStudyable(getDeckProgressEntry(missed, 'card-1'), '2026-05-24T10:05:30.000Z'), true);
});

test('getDeckStudyQueue includes new, due, and missed cards', () => {
  const progress = applyDeckAttempt({}, 'card-missed', false, '2026-05-24T10:05:00.000Z');
  const cards = [{ id: 'card-new' }, { id: 'card-missed' }];
  const queue = getDeckStudyQueue(cards, progress, '2026-05-24T10:05:30.000Z');

  assert.deepEqual(
    queue.map((card) => card.id),
    ['card-missed', 'card-new'],
  );
});

test('toggleDeckIgnored flips ignored state without losing counters', () => {
  const initial = applyDeckAttempt({}, 'card-2', true, '2026-05-24T10:00:00.000Z');
  const toggled = toggleDeckIgnored(initial, 'card-2');

  assert.equal(getDeckProgressEntry(toggled, 'card-2').ignored, true);
  assert.equal(getDeckProgressEntry(toggled, 'card-2').correctCount, 1);
});

test('summarizeLineMastery groups review cards by opening when line ids are empty', () => {
  const cards = [
    {
      id: 'card-1',
      lineId: '',
      lineName: 'LosValettos vs alifzawawi',
      eco: 'B13',
      side: 'black',
    },
    {
      id: 'card-2',
      lineId: '',
      lineName: 'LosValettos vs another',
      eco: 'C65',
      side: 'white',
    },
  ];

  const summary = summarizeLineMastery(cards, {}, '2026-05-24T10:00:00.000Z');

  assert.deepEqual(
    summary.map((line) => [line.id, line.name, line.cardCount]),
    [
      ['eco:B13', 'Caro-Kann Defense: Exchange Variation', 1],
      ['eco:C65', 'Unknown opening C65', 1],
    ],
  );
});

test('sortCardsForReview prioritizes weaker opening groups before stronger cards', () => {
  const cards = [
    {
      id: 'strong-card',
      lineId: '',
      lineName: 'LosValettos vs alifzawawi',
      eco: 'B13',
      side: 'black',
    },
    {
      id: 'weak-card',
      lineId: '',
      lineName: 'Unknown position',
      eco: 'C65',
      side: 'white',
    },
  ];
  const progress = {
    'strong-card': {
      ...getDeckProgressEntry({}, 'strong-card'),
      seenCount: 1,
      masteryScore: 77,
      dueAt: '2026-05-24T10:00:00.000Z',
      lastSeenAt: '2026-05-23T10:00:00.000Z',
    },
    'weak-card': {
      ...getDeckProgressEntry({}, 'weak-card'),
      seenCount: 1,
      masteryScore: 8,
      dueAt: '2026-05-24T10:00:00.000Z',
      lastSeenAt: '2026-05-23T10:00:00.000Z',
    },
  };

  assert.deepEqual(
    sortCardsForReview(cards, progress, '2026-05-24T10:00:00.000Z').map((card) => card.id),
    ['weak-card', 'strong-card'],
  );
});

test('summarizeDeckProgress reports review totals and SRS state buckets', () => {
  const progress = applyDeckAttempt(
    toggleDeckIgnored(applyDeckAttempt({}, 'card-1', true, '2026-05-24T10:00:00.000Z'), 'card-2'),
    'card-2',
    false,
    '2026-05-24T10:05:00.000Z',
  );

  const summary = summarizeDeckProgress(
    [{ id: 'card-1' }, { id: 'card-2' }, { id: 'card-3' }],
    progress,
    '2026-05-24T10:06:00.000Z',
  );

  assert.deepEqual(summary, {
    reviews: 2,
    reviewedCards: 2,
    correct: 1,
    misses: 1,
    ignored: 1,
    remaining: 2,
    new: 1,
    learning: 0,
    due: 1,
    review: 0,
    mature: 0,
    later: 0,
  });
});

test('getDeckCardState classifies new, learning, due, review, mature, and ignored cards', () => {
  const now = '2026-05-24T10:00:00.000Z';

  assert.equal(getDeckCardState(getDeckProgressEntry({}, 'new'), now), 'new');
  assert.equal(
    getDeckCardState(
      {
        ...getDeckProgressEntry({}, 'learning'),
        seenCount: 1,
        intervalDays: 0,
        dueAt: '2026-05-24T10:10:00.000Z',
      },
      now,
    ),
    'learning',
  );
  assert.equal(
    getDeckCardState(
      {
        ...getDeckProgressEntry({}, 'due'),
        seenCount: 1,
        intervalDays: 3,
        dueAt: '2026-05-24T09:00:00.000Z',
      },
      now,
    ),
    'due',
  );
  assert.equal(
    getDeckCardState(
      {
        ...getDeckProgressEntry({}, 'review'),
        seenCount: 1,
        intervalDays: 12,
        dueAt: '2026-06-05T10:00:00.000Z',
      },
      now,
    ),
    'review',
  );
  assert.equal(
    getDeckCardState(
      {
        ...getDeckProgressEntry({}, 'mature'),
        seenCount: 1,
        intervalDays: 21,
        dueAt: '2026-06-14T10:00:00.000Z',
      },
      now,
    ),
    'mature',
  );
  assert.equal(
    getDeckCardState(
      {
        ...getDeckProgressEntry({}, 'ignored'),
        ignored: true,
      },
      now,
    ),
    'ignored',
  );
});

test('getDeckQueueCounts exposes Anki-style new learning due queues', () => {
  const progress = {
    learning: {
      ...getDeckProgressEntry({}, 'learning'),
      seenCount: 1,
      intervalDays: 0,
      dueAt: '2026-05-24T10:10:00.000Z',
    },
    due: {
      ...getDeckProgressEntry({}, 'due'),
      seenCount: 1,
      intervalDays: 3,
      dueAt: '2026-05-24T09:00:00.000Z',
    },
  };

  assert.deepEqual(
    getDeckQueueCounts([{ id: 'new' }, { id: 'learning' }, { id: 'due' }], progress, '2026-05-24T10:00:00.000Z'),
    {
      new: 1,
      learning: 1,
      due: 1,
    },
  );
});
