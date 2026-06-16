import { Chess } from 'chess.js';

import type {
  AnalysisLine,
  AnalysisResult,
  AnalyzeRequest,
  PerspectiveWdl,
  RawWdl,
  RelativeScore,
} from './analysis-types.ts';

const DEFAULT_DEPTH = 12;
const MAX_DEPTH = 24;
const MIN_DEPTH = 6;
const DEFAULT_MULTIPV = 1;
const MAX_MULTIPV = 3;
const MIN_MOVETIME_MS = 1;
const MAX_MOVETIME_MS = 5_000;

export function sanitizeDepth(depth?: number) {
  const parsed = Number.parseInt(String(depth ?? DEFAULT_DEPTH), 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_DEPTH;
  }

  return Math.min(Math.max(parsed, MIN_DEPTH), MAX_DEPTH);
}

export function sanitizeMultiPv(multipv?: number) {
  const parsed = Number.parseInt(String(multipv ?? DEFAULT_MULTIPV), 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_MULTIPV;
  }

  return Math.min(Math.max(parsed, DEFAULT_MULTIPV), MAX_MULTIPV);
}

export function sanitizeMovetime(movetimeMs?: number) {
  if (movetimeMs == null) {
    return null;
  }

  const parsed = Number.parseInt(String(movetimeMs), 10);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.min(Math.max(parsed, MIN_MOVETIME_MS), MAX_MOVETIME_MS);
}

export function buildPositionCommand({ fen, initialFen, moves }: AnalyzeRequest) {
  if (Array.isArray(moves) && moves.length > 0) {
    if (typeof initialFen === 'string' && initialFen.trim()) {
      return `position fen ${initialFen.trim()} moves ${moves.join(' ')}`;
    }

    return `position startpos moves ${moves.join(' ')}`;
  }

  if (typeof fen === 'string' && fen.trim()) {
    return `position fen ${fen.trim()}`;
  }

  return 'position startpos';
}

export function getAnalysisFen({ fen, initialFen, moves }: AnalyzeRequest) {
  if (typeof fen === 'string' && fen.trim()) {
    return fen.trim();
  }

  try {
    const chess = initialFen?.trim() ? new Chess(initialFen.trim()) : new Chess();

    for (const move of moves ?? []) {
      chess.move({
        from: move.slice(0, 2),
        to: move.slice(2, 4),
        ...(move.length > 4 ? { promotion: move[4] } : {}),
      });
    }

    return chess.fen();
  } catch {
    return fen;
  }
}

export function parseAnalysis(lines: string[], fen: string | undefined, depthRequested: number): AnalysisResult {
  const bestMoveLine = [...lines].reverse().find((line) => line.startsWith('bestmove '));
  const parsedLines = parseAnalysisLines(lines, fen, depthRequested);
  const primaryLine = parsedLines.find((line) => line.multipv === 1) ?? parsedLines[0] ?? null;
  const infoLine = findBestInfoLine(lines, 1) ?? findBestInfoLine(lines);

  const bestMoveMatch = bestMoveLine?.match(/^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/);
  const wdlMatch = infoLine?.match(/\bwdl\s+(\d+)\s+(\d+)\s+(\d+)/);
  const depthMatch = infoLine?.match(/\bdepth\s+(\d+)/);
  const seldepthMatch = infoLine?.match(/\bseldepth\s+(\d+)/);
  const timeMatch = infoLine?.match(/\btime\s+(\d+)/);
  const nodesMatch = infoLine?.match(/\bnodes\s+(\d+)/);
  const npsMatch = infoLine?.match(/\bnps\s+(\d+)/);

  const turn = fen?.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';
  const terminalPerspective = inferTerminalPerspective(fen);
  const score = primaryLine?.score ?? null;
  const whitePerspective =
    primaryLine?.whitePerspective ??
    (terminalPerspective
      ? {
          type: terminalPerspective.whiteScore === 0 ? 'cp' : 'mate',
          value: terminalPerspective.whiteScore,
        }
      : null);

  const wdl: RawWdl | null = wdlMatch
    ? {
        win: Number.parseInt(wdlMatch[1], 10),
        draw: Number.parseInt(wdlMatch[2], 10),
        loss: Number.parseInt(wdlMatch[3], 10),
      }
    : (terminalPerspective?.rawWdl ?? null);

  const whitePerspectiveWdl: PerspectiveWdl | null = wdl
    ? turn === 'w'
      ? { white: wdl.win, draw: wdl.draw, black: wdl.loss }
      : { white: wdl.loss, draw: wdl.draw, black: wdl.win }
    : null;

  return {
    bestMove: bestMoveMatch?.[1] ?? null,
    ponder: bestMoveMatch?.[2] ?? null,
    depth: Number.parseInt(depthMatch?.[1] ?? String(depthRequested), 10),
    seldepth: seldepthMatch ? Number.parseInt(seldepthMatch[1], 10) : null,
    timeMs: timeMatch ? Number.parseInt(timeMatch[1], 10) : null,
    nodes: nodesMatch ? Number.parseInt(nodesMatch[1], 10) : null,
    nps: npsMatch ? Number.parseInt(npsMatch[1], 10) : null,
    multipv: primaryLine?.multipv ?? 1,
    pv: primaryLine?.pv ?? [],
    raw: lines,
    score,
    whitePerspective,
    wdl,
    whitePerspectiveWdl,
    lines: parsedLines.length > 0 ? parsedLines : primaryLine ? [primaryLine] : [],
  };
}

function parseAnalysisLines(lines: string[], fen: string | undefined, depthRequested: number) {
  const byMultiPv = new Map<number, AnalysisLine>();

  for (const line of lines) {
    if (!line.startsWith('info ') || !/\bscore (cp|mate) /.test(line)) {
      continue;
    }

    const parsed = parseInfoLine(line, fen, depthRequested);

    if (!parsed) {
      continue;
    }

    const previous = byMultiPv.get(parsed.multipv);

    if (!previous || parsed.depth >= previous.depth) {
      byMultiPv.set(parsed.multipv, parsed);
    }
  }

  return [...byMultiPv.values()].sort((left, right) => left.multipv - right.multipv);
}

function parseInfoLine(line: string, fen: string | undefined, depthRequested: number): AnalysisLine | null {
  const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  const pvSection = line.match(/\bpv\s+(.+)$/)?.[1] ?? '';

  if (!scoreMatch) {
    return null;
  }

  const turn = fen?.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w';
  const terminalPerspective = inferTerminalPerspective(fen);
  const score: RelativeScore = {
    type: scoreMatch[1] as RelativeScore['type'],
    value: Number.parseInt(scoreMatch[2], 10),
    bound: line.includes(' lowerbound') ? 'lowerbound' : line.includes(' upperbound') ? 'upperbound' : 'exact',
  };
  const whitePerspective = {
    type: score.type,
    value:
      score.type === 'mate' && score.value === 0 && terminalPerspective
        ? terminalPerspective.whiteScore
        : turn === 'w'
          ? score.value
          : -score.value,
    bound: turn === 'w' ? score.bound : invertScoreBound(score.bound),
  };
  const pv = pvSection ? pvSection.split(/\s+/) : [];

  return {
    multipv: Number.parseInt(line.match(/\bmultipv\s+(\d+)/)?.[1] ?? '1', 10),
    bestMove: pv[0] ?? null,
    depth: Number.parseInt(line.match(/\bdepth\s+(\d+)/)?.[1] ?? String(depthRequested), 10),
    pv,
    score,
    whitePerspective,
  };
}

function invertScoreBound(bound: RelativeScore['bound']) {
  if (bound === 'lowerbound') {
    return 'upperbound';
  }

  if (bound === 'upperbound') {
    return 'lowerbound';
  }

  return bound;
}

function findBestInfoLine(lines: string[], multipv?: number) {
  const candidates = [...lines].reverse().filter((line) => line.startsWith('info ') && /\bscore (cp|mate) /.test(line));

  if (multipv == null) {
    return candidates[0];
  }

  return candidates.find((line) => Number.parseInt(line.match(/\bmultipv\s+(\d+)/)?.[1] ?? '1', 10) === multipv);
}

function inferTerminalPerspective(fen: string | undefined) {
  if (!fen?.trim()) {
    return null;
  }

  try {
    const chess = new Chess(fen.trim());

    if (chess.isCheckmate()) {
      return {
        whiteScore: chess.turn() === 'b' ? 1 : -1,
        rawWdl: {
          win: 0,
          draw: 0,
          loss: 1000,
        } satisfies RawWdl,
      };
    }

    if (chess.isDraw()) {
      return {
        whiteScore: 0,
        rawWdl: {
          win: 0,
          draw: 1000,
          loss: 0,
        } satisfies RawWdl,
      };
    }
  } catch {
    return null;
  }

  return null;
}
