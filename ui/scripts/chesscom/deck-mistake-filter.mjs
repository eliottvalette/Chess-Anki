import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const openingBookKeys = new Set(
  JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../lib/opening-book-keys.json'), 'utf8')),
);

export function normalizeOpeningBookFen(fen) {
  const parts = fen.trim().split(' ');

  if (parts.length >= 4) {
    parts[3] = '-';
  }

  return parts.slice(0, 4).join(' ');
}

export function isMoveInOpeningBook(fenBefore, moveUci) {
  return openingBookKeys.has(`${normalizeOpeningBookFen(fenBefore)}|${moveUci}`);
}

export function qualifiesAsLineRootMistake({
  scoreSwingCp,
  thresholdCp,
  acceptableLossCp,
  inBook,
  playedUci,
  bestMoveUci,
}) {
  if (!bestMoveUci || scoreSwingCp == null || scoreSwingCp <= 0) {
    return false;
  }

  if (playedUci === bestMoveUci) {
    return false;
  }

  if (scoreSwingCp >= thresholdCp) {
    return true;
  }

  if (scoreSwingCp >= acceptableLossCp) {
    return true;
  }

  if (!inBook) {
    return true;
  }

  return false;
}

export function buildTrainingCardIdentity(card) {
  const setupKey = Array.isArray(card.setup_moves) ? card.setup_moves.join(' ') : '';

  return `${card.side}|${card.fen}|${card.answer_uci}|${setupKey}`;
}

function createShortHash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function dedupeTrainingCards(cards) {
  const bestByKey = new Map();

  for (const card of cards) {
    const key = buildTrainingCardIdentity(card);
    const existing = bestByKey.get(key);

    if (!existing || (card.score_swing_cp ?? 0) > (existing.score_swing_cp ?? 0)) {
      bestByKey.set(key, {
        ...card,
        id: `recent-fix-${createShortHash(key)}`,
      });
    }
  }

  return [...bestByKey.values()].sort((left, right) => (right.score_swing_cp ?? 0) - (left.score_swing_cp ?? 0));
}
