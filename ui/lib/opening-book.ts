import { Chess } from 'chess.js';

import type { StoredMove } from '@/lib/chess-analysis-client';
import openingBookKeys from '@/lib/opening-book-keys.json';
import { OPENING_REPERTOIRE } from '@/lib/opening-training';

const OPENING_EXPLORER_URL = 'https://explorer.lichess.org/masters';
const MIN_MASTER_GAMES_FOR_BOOK = 3;
const bundledOpeningBookKeys = new Set(openingBookKeys);

export type OpeningBookPositionResult = {
  inBook: boolean;
  openingName: string | null;
  openingEco: string | null;
  masterGames: number;
  source: 'lichess-masters' | 'local-repertoire' | 'none';
};

export type OpeningBookBatchResult = {
  results: OpeningBookPositionResult[];
};

type LichessExplorerMove = {
  uci: string;
  white: number;
  draws: number;
  black: number;
};

type LichessExplorerResponse = {
  opening?: {
    eco?: string;
    name?: string;
  } | null;
  moves?: LichessExplorerMove[];
  white?: number;
  draws?: number;
  black?: number;
};

let localOpeningBookKeys: Set<string> | null = null;

export function normalizeOpeningBookFen(fen: string) {
  const parts = fen.trim().split(' ');

  if (parts.length >= 4) {
    parts[3] = '-';
  }

  return parts.slice(0, 4).join(' ');
}

export function buildLocalOpeningBookKeys() {
  const keys = new Set(bundledOpeningBookKeys);

  for (const line of OPENING_REPERTOIRE) {
    const chess = new Chess();

    for (const san of line.moves) {
      const fenBefore = chess.fen();
      const move = chess.move(san);

      if (!move) {
        break;
      }

      const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
      keys.add(`${normalizeOpeningBookFen(fenBefore)}|${uci}`);
    }
  }

  return keys;
}

function getLocalOpeningBookKeys() {
  if (!localOpeningBookKeys) {
    localOpeningBookKeys = buildLocalOpeningBookKeys();
  }

  return localOpeningBookKeys;
}

export function isMoveInLocalOpeningBook(fenBefore: string, uci: string) {
  return getLocalOpeningBookKeys().has(`${normalizeOpeningBookFen(fenBefore)}|${uci}`);
}

export function isMoveInLichessExplorerMoveList(playedUci: string, explorerMoves: LichessExplorerMove[]) {
  const entry = explorerMoves.find((move) => move.uci === playedUci);

  if (!entry) {
    return false;
  }

  return entry.white + entry.draws + entry.black >= MIN_MASTER_GAMES_FOR_BOOK;
}

export async function fetchLichessOpeningExplorer(fen: string) {
  const url = new URL(OPENING_EXPLORER_URL);
  url.searchParams.set('fen', fen);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
    next: { revalidate: 60 * 60 * 24 },
  });

  if (!response.ok) {
    throw new Error(`Opening explorer request failed with status ${response.status}.`);
  }

  return (await response.json()) as LichessExplorerResponse;
}

export function resolveOpeningBookPosition(
  fenBefore: string,
  playedUci: string,
  explorer: LichessExplorerResponse | null,
): OpeningBookPositionResult {
  if (isMoveInLocalOpeningBook(fenBefore, playedUci)) {
    return {
      inBook: true,
      openingName: null,
      openingEco: null,
      masterGames: 0,
      source: 'local-repertoire',
    };
  }

  const explorerMoves = explorer?.moves ?? [];

  if (explorer && isMoveInLichessExplorerMoveList(playedUci, explorerMoves)) {
    const entry = explorerMoves.find((move) => move.uci === playedUci);

    return {
      inBook: true,
      openingName: explorer.opening?.name ?? null,
      openingEco: explorer.opening?.eco ?? null,
      masterGames: entry ? entry.white + entry.draws + entry.black : 0,
      source: 'lichess-masters',
    };
  }

  return {
    inBook: false,
    openingName: explorer?.opening?.name ?? null,
    openingEco: explorer?.opening?.eco ?? null,
    masterGames: 0,
    source: 'none',
  };
}

export async function resolveOpeningBookBatch(
  positions: Array<{ fenBefore: string; playedUci: string }>,
): Promise<OpeningBookBatchResult> {
  const results: OpeningBookPositionResult[] = [];
  const explorerCache = new Map<string, LichessExplorerResponse | null>();

  for (const position of positions) {
    const localResult = resolveOpeningBookPosition(position.fenBefore, position.playedUci, null);

    if (localResult.inBook) {
      results.push(localResult);
      continue;
    }

    const fenKey = normalizeOpeningBookFen(position.fenBefore);
    let explorer = explorerCache.get(fenKey) ?? null;

    if (!explorerCache.has(fenKey)) {
      try {
        explorer = await fetchLichessOpeningExplorer(position.fenBefore);
      } catch {
        explorer = null;
      }

      explorerCache.set(fenKey, explorer);
    }

    results.push(resolveOpeningBookPosition(position.fenBefore, position.playedUci, explorer));
  }

  return { results };
}

export function resolveOpeningBookFlagsLocal(moves: StoredMove[], initialFen: string | null) {
  const positions = buildOpeningBookPositions(moves, initialFen);
  return positions.map((position) => resolveOpeningBookPosition(position.fenBefore, position.playedUci, null).inBook);
}

export function buildOpeningBookPositions(moves: StoredMove[], initialFen: string | null) {
  const chess = initialFen ? new Chess(initialFen) : new Chess();
  const positions: Array<{ fenBefore: string; playedUci: string }> = [];

  for (const move of moves) {
    positions.push({
      fenBefore: chess.fen(),
      playedUci: move.uci,
    });

    chess.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    });
  }

  return positions;
}

export async function resolveOpeningBookFlags(moves: StoredMove[], initialFen: string | null) {
  const positions = buildOpeningBookPositions(moves, initialFen);
  const batch = await resolveOpeningBookBatch(positions);
  return batch.results.map((result) => result.inBook);
}

export async function resolveOpeningBookFlagsFromApi(moves: StoredMove[], initialFen: string | null) {
  const positions = buildOpeningBookPositions(moves, initialFen);

  if (positions.length === 0) {
    return [];
  }

  const response = await fetch('/api/opening-book', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ positions }),
  });

  if (!response.ok) {
    throw new Error(`Opening book request failed with status ${response.status}.`);
  }

  const batch = (await response.json()) as OpeningBookBatchResult;
  return batch.results.map((result) => result.inBook);
}
