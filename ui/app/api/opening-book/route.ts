import { Chess } from 'chess.js';
import { NextResponse } from 'next/server';

import { toStoredMove } from '@/lib/chess-analysis-client';
import { buildOpeningBookPositions, type OpeningBookBatchResult, resolveOpeningBookBatch } from '@/lib/opening-book';

export const runtime = 'nodejs';

type OpeningBookRequestBody = {
  positions?: Array<{ fenBefore?: string; playedUci?: string }>;
  moves?: Array<{ from?: string; to?: string; promotion?: string; uci?: string }>;
  initialFen?: string | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OpeningBookRequestBody;
    let positions = Array.isArray(body.positions)
      ? body.positions.flatMap((position) => {
          const fenBefore = String(position.fenBefore ?? '').trim();
          const playedUci = String(position.playedUci ?? '').trim();

          if (!fenBefore || !playedUci) {
            return [];
          }

          return [{ fenBefore, playedUci }];
        })
      : [];

    if (positions.length === 0 && Array.isArray(body.moves) && body.moves.length > 0) {
      const storedMoves = buildStoredMovesFromRequest(
        body.moves,
        typeof body.initialFen === 'string' ? body.initialFen : null,
      );
      positions = buildOpeningBookPositions(storedMoves, typeof body.initialFen === 'string' ? body.initialFen : null);
    }

    if (positions.length === 0) {
      return NextResponse.json({ results: [] } satisfies OpeningBookBatchResult);
    }

    if (positions.length > 160) {
      return NextResponse.json({ error: 'Too many opening book positions. Max batch size is 160.' }, { status: 400 });
    }

    const batch = await resolveOpeningBookBatch(positions);
    return NextResponse.json(batch);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to resolve opening book positions.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildStoredMovesFromRequest(moves: NonNullable<OpeningBookRequestBody['moves']>, initialFen: string | null) {
  const chess = initialFen ? new Chess(initialFen) : new Chess();
  const storedMoves = [];

  for (const move of moves) {
    const played = chess.move({
      from: String(move.from ?? ''),
      to: String(move.to ?? ''),
      ...(move.promotion ? { promotion: move.promotion } : {}),
    });

    if (!played) {
      break;
    }

    storedMoves.push(toStoredMove(played));
  }

  return storedMoves;
}
