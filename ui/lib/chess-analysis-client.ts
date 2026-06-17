import type { ChartOptions, PointStyle } from 'chart.js';
import { Chess } from 'chess.js';

import type { AnalysisResult, AnalyzeRequest, PerspectiveScore, PerspectiveWdl, ScoreBound } from './analysis-types.ts';

type BrowserAnalysisModule = typeof import('./browser-analysis-engine.ts');

let browserAnalysisModulePromise: Promise<BrowserAnalysisModule> | null = null;

export type StoredMove = {
  from: string;
  to: string;
  san: string;
  lan: string;
  promotion: string | null;
  piece: string;
  color: string;
  flags: string;
  captured: string | null;
  uci: string;
};

export type GameMetadata = {
  event: string;
  site: string;
  date: string;
  round: string;
  whitePlayer: string;
  whiteElo: string;
  blackPlayer: string;
  blackElo: string;
  result: string;
  eco: string;
  opening: string;
};

export type ReviewCategory =
  | 'book'
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'miss'
  | 'mistake'
  | 'blunder';

export type ReviewSide = 'white' | 'black' | 'both';

export type ReviewCounter = Record<ReviewCategory, number>;

export type TimelineReview = {
  ply: number;
  color: 'w' | 'b';
  category: ReviewCategory | null;
  label: string | null;
  colorHex: string | null;
  pointStyle: PointStyle;
  moveLabel: string;
  san: string;
  playedMove: string;
  bestMove: string | null;
  bestMoveSan: string | null;
  beforeExpected: number | null;
  afterExpected: number | null;
  expectedPointsLost: number | null;
  beforeCp: number | null;
  afterCp: number | null;
  cpLossCp: number | null;
  beforeMate: number | null;
  afterMate: number | null;
  moveAccuracy: number | null;
  isKeyMoment: boolean;
  coachText: string;
  fenBefore: string;
  fenAfter: string;
};

export type GameReview = {
  accuracy: {
    white: number | null;
    black: number | null;
  };
  gameRating: {
    white: number | null;
    black: number | null;
  };
  counts: {
    white: ReviewCounter;
    black: ReviewCounter;
  };
  keyMoments: TimelineReview[];
  opening: {
    name: string;
    eco: string;
    lastBookPly: number | null;
  };
};

export const reviewCategoryOrder: ReviewCategory[] = [
  'book',
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
];

export const reviewCategoryMeta: Record<
  ReviewCategory,
  {
    label: string;
    color: string;
    badge?: string;
    pointStyle: PointStyle;
  }
> = {
  brilliant: {
    label: 'Brilliant',
    color: '#26C2A3',
    badge: '/review-badges/brilliant.svg',
    pointStyle: 'star',
  },
  book: {
    label: 'Book',
    color: '#D5A47D',
    badge: '/review-badges/book.svg',
    pointStyle: 'rectRounded',
  },
  great: {
    label: 'Great',
    color: '#749BBF',
    badge: '/review-badges/great.svg',
    pointStyle: 'triangle',
  },
  best: {
    label: 'Best',
    color: '#81B64C',
    badge: '/review-badges/best.svg',
    pointStyle: 'rectRounded',
  },
  excellent: {
    label: 'Excellent',
    color: '#81B64C',
    badge: '/review-badges/excellent.png',
    pointStyle: 'circle',
  },
  good: {
    label: 'Good',
    color: '#95B776',
    badge: '/review-badges/good.png',
    pointStyle: 'circle',
  },
  inaccuracy: {
    label: 'Inaccuracy',
    color: '#F7C631',
    badge: '/review-badges/inaccuracy.png',
    pointStyle: 'rect',
  },
  miss: {
    label: 'Miss',
    color: '#FF7769',
    badge: '/review-badges/miss.svg',
    pointStyle: 'rectRot',
  },
  mistake: {
    label: 'Mistake',
    color: '#FFA459',
    badge: '/review-badges/mistake.svg',
    pointStyle: 'crossRot',
  },
  blunder: {
    label: 'Blunder',
    color: '#FA412D',
    badge: '/review-badges/blunder.svg',
    pointStyle: 'cross',
  },
};

export async function analyzeSinglePosition(payload: AnalyzeRequest, signal?: AbortSignal) {
  const startedAt = getAnalysisLogTime();
  logAnalysisFetchStart('position', formatSingleAnalysisFetch(payload));

  try {
    const browserAnalysis = canUseBrowserAnalysis() ? await getBrowserAnalysisModule() : null;
    const result = browserAnalysis
      ? await browserAnalysis.analyzeSinglePositionInBrowser(payload, signal)
      : await analyzeSinglePositionOnServer(payload, signal);
    logAnalysisFetchDone('position', startedAt, formatAnalysisResult(result), browserAnalysis ? 'client' : 'server');
    return result;
  } catch (error) {
    logAnalysisFetchFail('position', startedAt, error);
    throw error;
  }
}

export async function analyzeGamePositions(
  payload: {
    positions: AnalyzeRequest[];
    depth?: number;
    movetimeMs?: number;
  },
  signal?: AbortSignal,
) {
  const startedAt = getAnalysisLogTime();
  logAnalysisFetchStart('game', formatBatchAnalysisFetch(payload));

  try {
    const browserAnalysis = canUseBrowserAnalysis() ? await getBrowserAnalysisModule() : null;
    const result = browserAnalysis
      ? await browserAnalysis.analyzeGamePositionsInBrowser(payload, signal)
      : await analyzeGamePositionsOnServer(payload, signal);
    logAnalysisFetchDone('game', startedAt, `${result.analyses.length} results`, browserAnalysis ? 'client' : 'server');
    return result;
  } catch (error) {
    logAnalysisFetchFail('game', startedAt, error);
    throw error;
  }
}

function formatSingleAnalysisFetch(payload: AnalyzeRequest) {
  return [
    `ply=${payload.moves?.length ?? 0}`,
    `depth=${payload.depth ?? '-'}`,
    `time=${payload.movetimeMs ?? '-'}ms`,
    `pv=${payload.multipv ?? '-'}`,
  ].join(' ');
}

function formatBatchAnalysisFetch(payload: { positions: AnalyzeRequest[]; depth?: number; movetimeMs?: number }) {
  const plies = payload.positions.map((position) => position.moves?.length ?? 0);
  const firstPly = plies[0] ?? 0;
  const lastPly = plies[plies.length - 1] ?? firstPly;

  return [
    `n=${payload.positions.length}`,
    `plies=${firstPly}-${lastPly}`,
    `depth=${payload.depth ?? '-'}`,
    `time=${payload.movetimeMs ?? '-'}ms`,
  ].join(' ');
}

function formatAnalysisResult(result: AnalysisResult) {
  return [`best=${result.bestMove ?? '-'}`, `depth=${result.depth}`, `pv=${result.multipv}`].join(' ');
}

function getAnalysisLogTime() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function getAnalysisElapsedMs(startedAt: number) {
  return Math.round(getAnalysisLogTime() - startedAt);
}

function logAnalysisFetchStart(kind: 'position' | 'game', detail: string) {
  console.info(`[analysis:${kind}] -> ${detail}`);
}

function logAnalysisFetchDone(
  kind: 'position' | 'game',
  startedAt: number,
  detail: string,
  source: 'client' | 'server',
) {
  console.info(`[analysis:${kind}:${source}] <- ${getAnalysisElapsedMs(startedAt)}ms ${detail}`);
}

function logAnalysisFetchFail(kind: 'position' | 'game', startedAt: number, error: unknown) {
  console.warn(
    `[analysis:${kind}] !! ${getAnalysisElapsedMs(startedAt)}ms ${error instanceof Error ? error.message : String(error)}`,
  );
}

function canUseBrowserAnalysis() {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
}

function getBrowserAnalysisModule() {
  browserAnalysisModulePromise ??= import('./browser-analysis-engine.ts');
  return browserAnalysisModulePromise;
}

function assertServerAnalysisAllowed() {
  if (typeof window !== 'undefined') {
    throw new Error('Browser Stockfish WASM is unavailable; server analysis fallback is disabled.');
  }
}

function analyzeSinglePositionOnServer(payload: AnalyzeRequest, signal?: AbortSignal) {
  assertServerAnalysisAllowed();
  return requestJson<AnalysisResult>('/api/analyze-position', payload, signal);
}

function analyzeGamePositionsOnServer(
  payload: {
    positions: AnalyzeRequest[];
    depth?: number;
    movetimeMs?: number;
  },
  signal?: AbortSignal,
) {
  assertServerAnalysisAllowed();
  return requestJson<{ analyses: AnalysisResult[] }>('/api/analyze-game', payload, signal);
}

export function buildStoredMovesFromSanList(initialFen: string | null, sanMoves: string[]) {
  const chess = initialFen ? new Chess(initialFen) : new Chess();
  const stored: StoredMove[] = [];

  for (const san of sanMoves) {
    const move = chess.move(san);

    if (!move) {
      throw new Error(`Invalid setup move: ${san}`);
    }

    stored.push(toStoredMove(move));
  }

  return stored;
}

export function buildStoredMovesFromUciList(initialFen: string | null, uciMoves: string[]) {
  const chess = initialFen ? new Chess(initialFen) : new Chess();
  const stored: StoredMove[] = [];

  for (const uci of uciMoves) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length === 5 ? uci[4] : undefined;
    const move = chess.move({
      from,
      to,
      ...(promotion ? { promotion } : {}),
    });

    if (!move) {
      throw new Error(`Invalid setup move: ${JSON.stringify({ from, to, promotion })}`);
    }

    stored.push(toStoredMove(move));
  }

  return stored;
}

export function toStoredMove(move: {
  from: string;
  to: string;
  san: string;
  lan: string;
  promotion?: string;
  piece: string;
  color: string;
  flags: string;
  captured?: string;
}) {
  return {
    from: move.from,
    to: move.to,
    san: move.san,
    lan: move.lan,
    promotion: move.promotion ?? null,
    piece: move.piece,
    color: move.color,
    flags: move.flags,
    captured: move.captured ?? null,
    uci: `${move.from}${move.to}${move.promotion ?? ''}`,
  } satisfies StoredMove;
}

export function buildMoveUciHistory(moves: StoredMove[]) {
  return moves.map((move) => move.uci ?? `${move.from}${move.to}${move.promotion ?? ''}`);
}

export function restoreGameFromHistory(moves: StoredMove[], initialFen: string | null, upto = moves.length) {
  const chess = initialFen ? new Chess(initialFen) : new Chess();

  for (const move of moves.slice(0, upto)) {
    chess.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    });
  }

  return chess;
}

export function buildTimelinePositions(moves: StoredMove[], initialFen: string | null) {
  const positions: AnalyzeRequest[] = [];
  const chess = initialFen ? new Chess(initialFen) : new Chess();
  const appliedMoves: string[] = [];

  for (const move of moves) {
    appliedMoves.push(move.uci);
    chess.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    });

    positions.push({
      fen: chess.fen(),
      initialFen,
      moves: [...appliedMoves],
    });
  }

  return positions;
}

export function buildTimelineSequencePositions(moves: StoredMove[], initialFen: string | null) {
  const positions: AnalyzeRequest[] = [];
  const chess = initialFen ? new Chess(initialFen) : new Chess();
  const appliedMoves: string[] = [];

  positions.push({
    fen: chess.fen(),
    initialFen,
    moves: [],
  });

  for (const move of moves) {
    appliedMoves.push(move.uci);
    chess.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    });

    positions.push({
      fen: chess.fen(),
      initialFen,
      moves: [...appliedMoves],
    });
  }

  return positions;
}

export function extractMetadataFromGame(game: Chess) {
  const headers = game.header();

  return {
    event: headers.Event ?? 'Open analysis',
    site: headers.Site ?? 'Local PGN',
    date: headers.Date ?? 'Unknown',
    round: headers.Round ?? '-',
    whitePlayer: headers.White ?? 'White',
    whiteElo: headers.WhiteElo ?? '-',
    blackPlayer: headers.Black ?? 'Black',
    blackElo: headers.BlackElo ?? '-',
    result: headers.Result ?? '*',
    eco: headers.ECO ?? '-',
    opening: headers.Opening ?? headers.Variation ?? 'Opening phase',
  } satisfies GameMetadata;
}

export function formatScoreLabel(analysis: AnalysisResult | null, perspective: 'white' | 'black' = 'white') {
  const score = analysis?.whitePerspective;

  if (!score) {
    return '...';
  }

  const perspectiveMultiplier = perspective === 'white' ? 1 : -1;
  const perspectiveValue = score.value * perspectiveMultiplier;

  if (score.type === 'mate') {
    if (analysis?.score?.type === 'mate' && analysis.score.value === 0) {
      return perspectiveValue >= 0 ? '#0' : '-#0';
    }

    return perspectiveValue > 0 ? `#${perspectiveValue}` : `-#${Math.abs(perspectiveValue)}`;
  }

  const pawns = perspectiveValue / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

export function formatBestMove(fen: string, move: string | null) {
  if (!move) {
    return 'waiting';
  }

  const chess = new Chess(fen);
  const parsed = applyUciMove(chess, move);
  return parsed?.san ?? move;
}

export function formatPrincipalVariation(fen: string, pv: string[]) {
  if (!pv.length) {
    return 'No principal variation yet.';
  }

  const chess = new Chess(fen);
  const sanMoves: string[] = [];

  for (const move of pv.slice(0, 8)) {
    const parsed = applyUciMove(chess, move);

    if (!parsed) {
      break;
    }

    sanMoves.push(parsed.san);
  }

  return sanMoves.length > 0 ? sanMoves.join(' ') : pv.join(' ');
}

export function getBestMoveArrow(bestMove: string | null, color = '#b8f7a1') {
  if (!bestMove || bestMove.length < 4) {
    return [];
  }

  return [
    {
      startSquare: bestMove.slice(0, 2),
      endSquare: bestMove.slice(2, 4),
      color,
    },
  ];
}

export function getAdvantageMeter(analysis: AnalysisResult | null) {
  const score = analysis?.whitePerspective;

  if (!score) {
    return 50;
  }

  if (score.type === 'mate') {
    const normalized = Math.sign(score.value) * 12;
    const percentage = 100 / (1 + Math.exp(-normalized / 1.35));

    return Math.max(0, Math.min(100, percentage));
  }

  return getAdvantageMeterFromEvalCp(score.value);
}

export function getAdvantageMeterFromEvalCp(whiteEvalCp: number) {
  const normalized = whiteEvalCp / 100;
  const percentage = 100 / (1 + Math.exp(-normalized / 1.35));

  return Math.max(0, Math.min(100, percentage));
}

export function formatEvalCpLabel(whiteEvalCp: number, perspective: 'white' | 'black' = 'white') {
  const perspectiveValue = perspective === 'white' ? whiteEvalCp : -whiteEvalCp;
  const pawns = perspectiveValue / 100;

  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

export function toChartScore(analysis: AnalysisResult) {
  const score = analysis.whitePerspective;

  if (!score) {
    return 0;
  }

  if (score.type === 'mate') {
    return score.value > 0 ? 12 : -12;
  }

  return Number((score.value / 100).toFixed(2));
}

export function wdlToPercentages(wdl: PerspectiveWdl | null) {
  if (!wdl) {
    return null;
  }

  const total = wdl.white + wdl.draw + wdl.black;

  if (total <= 0) {
    return null;
  }

  return {
    white: Math.round((wdl.white / total) * 100),
    draw: Math.round((wdl.draw / total) * 100),
    black: Math.round((wdl.black / total) * 100),
  };
}

export function classifyTimelineMoves(
  moves: StoredMove[],
  preMoveAnalyses: AnalysisResult[],
  postMoveAnalyses: AnalysisResult[],
  initialFen: string | null,
  metadata?: GameMetadata | null,
  openingBookFlags?: boolean[],
) {
  if (moves.length === 0 || preMoveAnalyses.length !== moves.length || postMoveAnalyses.length !== moves.length) {
    return [] satisfies TimelineReview[];
  }

  const beforeGame = initialFen ? new Chess(initialFen) : new Chess();

  return moves.map((move, index) => {
    const color = move.color === 'b' ? 'b' : 'w';
    const beforeFen = beforeGame.fen();
    const afterGame = new Chess(beforeFen);
    afterGame.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    });

    const beforeAnalysis = preMoveAnalyses[index];
    const afterAnalysis = postMoveAnalyses[index];
    const moveLabel = formatTimelineMoveLabel(index, move);
    const playerRating = parsePlayerRating(color === 'w' ? metadata?.whiteElo : metadata?.blackElo);
    const ratingFlex = getRatingFlex(playerRating);
    const expectedPointsDelta = getMoveExpectedPointsLoss(beforeAnalysis, afterAnalysis, color, move.uci);
    const beforeExpected = expectedPointsDelta.before;
    const afterExpected = expectedPointsDelta.after;
    const expectedPointsLost = expectedPointsDelta.value;
    const beforeCp = getScoreCpForColor(beforeAnalysis, color);
    const afterCp = getScoreCpForColor(afterAnalysis, color);
    const cpLossCp = getMoveCpLoss(beforeAnalysis, afterAnalysis, color, move.uci);
    const beforeMate = getMateForColor(beforeAnalysis, color);
    const afterMate = getMateForColor(afterAnalysis, color);
    const bestMovePlayed = Boolean(beforeAnalysis?.bestMove && beforeAnalysis.bestMove === move.uci);
    const sacrifice = isPieceSacrifice(beforeFen, afterGame.fen(), color);
    const afterWinning = isWinningOutcome(afterAnalysis, color);
    const beforeCompletelyWinning = isCompletelyWinning(beforeAnalysis, color);
    const decisiveMove = move.san.includes('#') || move.san.includes('+') || isMateForColor(afterAnalysis, color);
    const bestMoveSan = beforeAnalysis?.bestMove ? formatBestMove(beforeFen, beforeAnalysis.bestMove) : null;
    const secondBestGapCp = getSecondBestGapCp(beforeAnalysis, color);

    const reviewCategoryInput = {
      openingBookMove: openingBookFlags?.[index] === true,
      san: move.san,
      bestMovePlayed,
      sacrifice,
      afterWinning,
      beforeCompletelyWinning,
      decisiveMove,
      beforeExpected,
      afterExpected,
      expectedPointsLost,
      cpLossCp,
      beforeMate,
      afterMate,
      secondBestGapCp,
      ratingFlex,
    };
    let category = classifyReviewCategory(reviewCategoryInput);

    if (!category) {
      category = classifyReviewCategory({
        ...reviewCategoryInput,
        openingBookMove: false,
        expectedPointsLost:
          beforeExpected == null || afterExpected == null ? null : Math.max(0, beforeExpected - afterExpected),
        cpLossCp: beforeCp == null || afterCp == null ? null : Math.max(0, beforeCp - afterCp),
      });
    }

    const moveAccuracy = getMoveAccuracy(category, expectedPointsLost, cpLossCp, afterMate);
    const isKeyMoment = isReviewKeyMoment(category, expectedPointsLost, cpLossCp, afterMate);
    const coachText = buildCoachText({
      moveLabel,
      category,
      bestMoveSan,
      beforeExpected,
      afterExpected,
      expectedPointsLost,
      cpLossCp,
      beforeCp,
      afterCp,
    });

    beforeGame.move({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    });

    const meta = category ? reviewCategoryMeta[category] : null;

    return {
      ply: index + 1,
      color,
      category,
      label: meta?.label ?? null,
      colorHex: meta?.color ?? null,
      pointStyle: meta?.pointStyle ?? 'circle',
      moveLabel,
      san: move.san,
      playedMove: move.uci,
      bestMove: beforeAnalysis?.bestMove ?? null,
      bestMoveSan,
      beforeExpected: beforeExpected == null ? null : Number(beforeExpected.toFixed(3)),
      afterExpected: afterExpected == null ? null : Number(afterExpected.toFixed(3)),
      expectedPointsLost: expectedPointsLost == null ? null : Number(expectedPointsLost.toFixed(3)),
      beforeCp,
      afterCp,
      cpLossCp,
      beforeMate,
      afterMate,
      moveAccuracy,
      isKeyMoment,
      coachText,
      fenBefore: beforeFen,
      fenAfter: afterGame.fen(),
    } satisfies TimelineReview;
  });
}

export function summarizeTimelineReviews(reviews: TimelineReview[]) {
  const white = createReviewCounter();
  const black = createReviewCounter();

  for (const review of reviews) {
    if (!review.category) {
      continue;
    }

    const bucket = review.color === 'b' ? black : white;
    bucket[review.category] += 1;
  }

  return { white, black };
}

export function buildGameReview(reviews: TimelineReview[], metadata: GameMetadata | null) {
  const counts = summarizeTimelineReviews(reviews);
  const keyMoments = extractKeyMoments(reviews);
  const whiteAccuracy = calculatePlayerAccuracy(reviews, 'w');
  const blackAccuracy = calculatePlayerAccuracy(reviews, 'b');
  const lastBookPly = [...reviews].reverse().find((review) => review.category === 'book')?.ply ?? null;

  return {
    accuracy: {
      white: whiteAccuracy,
      black: blackAccuracy,
    },
    gameRating: {
      white: calculateGameRating(parsePlayerRating(metadata?.whiteElo), whiteAccuracy),
      black: calculateGameRating(parsePlayerRating(metadata?.blackElo), blackAccuracy),
    },
    counts,
    keyMoments,
    opening: {
      name: metadata?.opening ?? 'Opening phase',
      eco: metadata?.eco ?? '-',
      lastBookPly,
    },
  } satisfies GameReview;
}

export function filterReviewMoments(moments: TimelineReview[], side: ReviewSide) {
  if (side === 'both') {
    return moments;
  }

  const color = side === 'white' ? 'w' : 'b';
  return moments.filter((moment) => moment.color === color);
}

export function buildChartOptions(
  moves: StoredMove[],
  reviews: TimelineReview[],
  onPointClick?: (ply: number) => void,
): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    onClick(_event, elements) {
      const index = elements[0]?.index;

      if (typeof index === 'number') {
        onPointClick?.(index + 1);
      }
    },
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: 'rgba(24, 26, 32, 0.96)',
        borderColor: '#343744',
        borderWidth: 1,
        titleColor: '#f2f3f5',
        bodyColor: '#cfd3dc',
        displayColors: false,
        callbacks: {
          title(items) {
            const index = items[0]?.dataIndex ?? 0;
            return `Ply ${index + 1}`;
          },
          beforeBody(items) {
            const index = items[0]?.dataIndex ?? 0;
            const move = moves[index];

            if (!move) {
              return '';
            }

            return formatTimelineMoveLabel(index, move);
          },
          label(item) {
            const value = typeof item.raw === 'number' ? item.raw : Number(item.raw ?? 0);
            return `Eval ${formatChartAxisValue(value)}`;
          },
          afterBody(items) {
            const index = items[0]?.dataIndex ?? 0;
            const review = reviews[index];

            if (!review) {
              return [];
            }

            const lines: string[] = [];

            if (review.label) {
              lines.push(review.label);
            }

            if (review.expectedPointsLost != null) {
              lines.push(`EP loss ${(review.expectedPointsLost * 100).toFixed(1)}%`);
            }

            if (review.cpLossCp != null) {
              lines.push(`CP loss ${review.cpLossCp}`);
            }

            return lines;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: '#a7abb7',
          maxTicksLimit: 8,
          autoSkip: true,
        },
        grid: {
          color: 'rgba(167, 171, 183, 0.12)',
        },
        border: {
          color: '#343744',
        },
        title: {
          display: true,
          text: 'Half-move',
          color: '#a7abb7',
        },
      },
      y: {
        suggestedMin: -8,
        suggestedMax: 8,
        ticks: {
          color: '#a7abb7',
          maxTicksLimit: 7,
          callback(value) {
            return formatChartAxisValue(Number(value));
          },
        },
        grid: {
          color: 'rgba(167, 171, 183, 0.12)',
        },
        border: {
          color: '#343744',
        },
        title: {
          display: true,
          text: 'White edge',
          color: '#a7abb7',
        },
      },
    },
  };
}

async function requestJson<T>(url: string, payload: unknown, signal?: AbortSignal) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  });

  const data = (await response.json().catch(() => ({}))) as Partial<T> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(data.error ?? `Request failed with status ${response.status}.`);
  }

  return data as T;
}

function applyUciMove(chess: Chess, move: string) {
  if (move.length < 4) {
    return null;
  }

  try {
    return chess.move({
      from: move.slice(0, 2),
      to: move.slice(2, 4),
      ...(move.length > 4 ? { promotion: move[4] } : {}),
    });
  } catch {
    return null;
  }
}

function createReviewCounter() {
  return {
    book: 0,
    brilliant: 0,
    great: 0,
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    miss: 0,
    mistake: 0,
    blunder: 0,
  } satisfies ReviewCounter;
}

function parsePlayerRating(value: string | number | null | undefined) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getRatingFlex(rating: number | null) {
  if (rating == null) {
    return 0.01;
  }

  if (rating <= 900) {
    return 0.02;
  }

  if (rating <= 1400) {
    return 0.015;
  }

  return 0.008;
}

function getExpectedPoints(analysis: AnalysisResult | null | undefined, color: 'w' | 'b') {
  const wdl = analysis?.whitePerspectiveWdl;

  if (wdl) {
    const total = wdl.white + wdl.draw + wdl.black;

    if (total > 0) {
      const wins = color === 'w' ? wdl.white : wdl.black;
      return (wins + wdl.draw / 2) / total;
    }
  }

  const chartValue = analysis ? toChartScore(analysis) : null;

  if (chartValue == null) {
    return null;
  }

  const perspectiveValue = color === 'w' ? chartValue : -chartValue;
  return 1 / (1 + Math.exp(-perspectiveValue / 1.35));
}

function getExpectedPointsLoss(
  beforeAnalysis: AnalysisResult | null | undefined,
  afterAnalysis: AnalysisResult | null | undefined,
  color: 'w' | 'b',
) {
  const before = getExpectedPoints(beforeAnalysis, color);
  const after = getExpectedPoints(afterAnalysis, color);
  const loss = normalizeBoundedLoss(
    before,
    after,
    getScoreBoundForColor(beforeAnalysis?.whitePerspective ?? null, color),
    getScoreBoundForColor(afterAnalysis?.whitePerspective ?? null, color),
  );

  return {
    before,
    after,
    value: loss.value,
    raw: loss.raw,
    reliable: loss.reliable,
  };
}

function getMoveExpectedPointsLoss(
  beforeAnalysis: AnalysisResult | null | undefined,
  afterAnalysis: AnalysisResult | null | undefined,
  color: 'w' | 'b',
  moveUci: string,
) {
  const bestLine = beforeAnalysis?.lines?.[0] ?? null;
  const playedLine = findAnalysisLineForMove(beforeAnalysis, moveUci);

  if (bestLine?.whitePerspective && playedLine?.whitePerspective) {
    const before = getExpectedPointsFromScore(bestLine.whitePerspective, color);
    const after = getExpectedPointsFromScore(playedLine.whitePerspective, color);
    const loss = normalizeBoundedLoss(
      before,
      after,
      getScoreBoundForColor(bestLine.whitePerspective, color),
      getScoreBoundForColor(playedLine.whitePerspective, color),
    );

    return {
      before: getExpectedPoints(beforeAnalysis, color),
      after: getExpectedPoints(afterAnalysis, color),
      value: loss.value,
      raw: loss.raw,
      reliable: loss.reliable,
    };
  }

  return getExpectedPointsLoss(beforeAnalysis, afterAnalysis, color);
}

function getExpectedPointsFromScore(score: PerspectiveScore | null | undefined, color: 'w' | 'b') {
  if (!score) {
    return null;
  }

  const whiteChartValue = score.type === 'mate' ? Math.sign(score.value) * 12 : score.value / 100;
  const perspectiveValue = color === 'w' ? whiteChartValue : -whiteChartValue;
  return 1 / (1 + Math.exp(-perspectiveValue / 1.35));
}

export function getScoreCpForColor(analysis: AnalysisResult | null | undefined, color: 'w' | 'b') {
  const score = analysis?.whitePerspective;

  if (!score) {
    return null;
  }

  const whiteScore = score.type === 'mate' ? Math.sign(score.value) * 100000 : score.value;
  return color === 'w' ? whiteScore : -whiteScore;
}

function getScoreBoundForColor(score: PerspectiveScore | null | undefined, color: 'w' | 'b') {
  const bound = score?.bound ?? 'exact';
  return color === 'w' ? bound : invertScoreBound(bound);
}

function invertScoreBound(bound: ScoreBound): ScoreBound {
  if (bound === 'lowerbound') {
    return 'upperbound';
  }

  if (bound === 'upperbound') {
    return 'lowerbound';
  }

  return bound;
}

function normalizeBoundedLoss(
  before: number | null,
  after: number | null,
  beforeBound: ScoreBound,
  afterBound: ScoreBound,
) {
  if (before == null || after == null) {
    return { value: null, raw: null, reliable: false };
  }

  const raw = before - after;

  if (raw <= 0) {
    return { value: 0, raw, reliable: true };
  }

  if (beforeBound === 'upperbound' || afterBound === 'lowerbound') {
    return { value: null, raw, reliable: false };
  }

  return { value: raw, raw, reliable: true };
}

export function getMateForColor(analysis: AnalysisResult | null | undefined, color: 'w' | 'b') {
  const score = analysis?.whitePerspective;

  if (score?.type !== 'mate') {
    return null;
  }

  return color === 'w' ? score.value : -score.value;
}

export function getCpLoss(
  beforeAnalysis: AnalysisResult | null | undefined,
  afterAnalysis: AnalysisResult | null | undefined,
  color: 'w' | 'b',
) {
  const before = getScoreCpForColor(beforeAnalysis, color);
  const after = getScoreCpForColor(afterAnalysis, color);
  const loss = normalizeBoundedLoss(
    before,
    after,
    getScoreBoundForColor(beforeAnalysis?.whitePerspective ?? null, color),
    getScoreBoundForColor(afterAnalysis?.whitePerspective ?? null, color),
  );

  return loss.value;
}

function getMoveCpLoss(
  beforeAnalysis: AnalysisResult | null | undefined,
  afterAnalysis: AnalysisResult | null | undefined,
  color: 'w' | 'b',
  moveUci: string,
) {
  const bestLine = beforeAnalysis?.lines?.[0] ?? null;
  const playedLine = findAnalysisLineForMove(beforeAnalysis, moveUci);

  if (bestLine?.whitePerspective && playedLine?.whitePerspective) {
    const bestScore = getScoreCpForColor(
      { ...beforeAnalysis, whitePerspective: bestLine.whitePerspective } as AnalysisResult,
      color,
    );
    const playedScore = getScoreCpForColor(
      { ...beforeAnalysis, whitePerspective: playedLine.whitePerspective } as AnalysisResult,
      color,
    );
    const loss = normalizeBoundedLoss(
      bestScore,
      playedScore,
      getScoreBoundForColor(bestLine.whitePerspective, color),
      getScoreBoundForColor(playedLine.whitePerspective, color),
    );

    return loss.value;
  }

  return getCpLoss(beforeAnalysis, afterAnalysis, color);
}

export function getSecondBestGapCp(analysis: AnalysisResult | null | undefined, color: 'w' | 'b') {
  const first = analysis?.lines?.[0];
  const second = analysis?.lines?.[1];
  const firstScore = first
    ? getScoreCpForColor({ ...analysis, whitePerspective: first.whitePerspective } as AnalysisResult, color)
    : null;
  const secondScore = second
    ? getScoreCpForColor({ ...analysis, whitePerspective: second.whitePerspective } as AnalysisResult, color)
    : null;
  const gap = normalizeBoundedLoss(
    firstScore,
    secondScore,
    getScoreBoundForColor(first?.whitePerspective ?? null, color),
    getScoreBoundForColor(second?.whitePerspective ?? null, color),
  );

  return gap.value;
}

function findAnalysisLineForMove(analysis: AnalysisResult | null | undefined, moveUci: string) {
  return analysis?.lines?.find((line) => line.bestMove === moveUci || line.pv[0] === moveUci) ?? null;
}

export function classifyReviewCategory({
  openingBookMove = false,
  san,
  bestMovePlayed,
  sacrifice,
  afterWinning,
  beforeCompletelyWinning,
  decisiveMove,
  beforeExpected,
  afterExpected,
  expectedPointsLost,
  cpLossCp,
  beforeMate,
  afterMate,
  secondBestGapCp,
  ratingFlex,
}: {
  openingBookMove?: boolean;
  san: string;
  bestMovePlayed: boolean;
  sacrifice: boolean;
  afterWinning: boolean;
  beforeCompletelyWinning: boolean;
  decisiveMove: boolean;
  beforeExpected: number | null;
  afterExpected: number | null;
  expectedPointsLost: number | null;
  cpLossCp: number | null;
  beforeMate: number | null;
  afterMate: number | null;
  secondBestGapCp: number | null;
  ratingFlex: number;
}): ReviewCategory | null {
  if (
    openingBookMove &&
    !san.includes('+') &&
    !san.includes('#') &&
    isOpeningBookClassificationAllowed({ expectedPointsLost, cpLossCp, ratingFlex })
  ) {
    return 'book';
  }

  if (afterMate != null && afterMate < 0) {
    return 'blunder';
  }

  if (bestMovePlayed && sacrifice && afterWinning && !beforeCompletelyWinning && (cpLossCp ?? 0) <= 20) {
    return 'brilliant';
  }

  if (
    bestMovePlayed &&
    ((afterMate != null && afterMate > 0) ||
      (decisiveMove && afterWinning) ||
      ((secondBestGapCp ?? 0) >= 140 && afterWinning) ||
      ((beforeExpected ?? 0.5) <= 0.38 && (afterExpected ?? 0.5) >= 0.34))
  ) {
    return 'great';
  }

  const missedWinningChance =
    !bestMovePlayed &&
    beforeExpected != null &&
    afterExpected != null &&
    beforeExpected >= Math.max(0.66, 0.72 - ratingFlex * 3) &&
    afterExpected <= Math.min(0.64, beforeExpected - 0.18);

  if (expectedPointsLost != null) {
    if (bestMovePlayed) {
      return 'best';
    }

    if (expectedPointsLost <= 0.0005 || (cpLossCp != null && cpLossCp <= 12 + Math.round(ratingFlex * 200))) {
      return 'excellent';
    }

    if (expectedPointsLost <= 0.02 + ratingFlex) {
      return 'excellent';
    }

    if (expectedPointsLost <= 0.05 + ratingFlex) {
      return 'good';
    }

    if (expectedPointsLost <= 0.1 + ratingFlex) {
      return 'inaccuracy';
    }

    if (expectedPointsLost <= 0.2 + ratingFlex) {
      return missedWinningChance ? 'miss' : 'mistake';
    }

    return missedWinningChance ? 'miss' : 'blunder';
  }

  if (cpLossCp == null) {
    return bestMovePlayed ? 'best' : null;
  }

  if (bestMovePlayed) {
    return 'best';
  }

  if (cpLossCp <= 0 || cpLossCp <= 12 + Math.round(ratingFlex * 200)) {
    return 'excellent';
  }

  if (cpLossCp <= 28 + Math.round(ratingFlex * 250)) {
    return 'excellent';
  }

  if (cpLossCp <= 55 + Math.round(ratingFlex * 300)) {
    return 'good';
  }

  if (cpLossCp < 100 + Math.round(ratingFlex * 500)) {
    return 'inaccuracy';
  }

  if (cpLossCp < 320 + Math.round(ratingFlex * 500)) {
    return 'mistake';
  }

  if (beforeMate != null && afterMate == null && beforeMate > 0) {
    return 'blunder';
  }

  return 'blunder';
}

function isOpeningBookClassificationAllowed({
  expectedPointsLost,
  cpLossCp,
  ratingFlex,
}: {
  expectedPointsLost: number | null;
  cpLossCp: number | null;
  ratingFlex: number;
}) {
  if (expectedPointsLost != null && expectedPointsLost > 0.05 + ratingFlex) {
    return false;
  }

  if (cpLossCp != null && cpLossCp > 55 + Math.round(ratingFlex * 300)) {
    return false;
  }

  return true;
}

function cpLossToAccuracy(cpLossCp: number) {
  return Math.round(Math.max(0, Math.min(100, 100 - cpLossCp / 3)));
}

function getMoveAccuracy(
  category: ReviewCategory | null,
  expectedPointsLost: number | null,
  cpLossCp: number | null,
  afterMate: number | null,
) {
  if (!category) {
    return null;
  }

  if (category === 'book' || category === 'brilliant' || category === 'great' || category === 'best') {
    return 100;
  }

  if (expectedPointsLost == null) {
    if (afterMate != null && afterMate < 0) {
      return 0;
    }

    if (cpLossCp == null) {
      return null;
    }

    return cpLossToAccuracy(cpLossCp);
  }

  return cpLossCp != null
    ? cpLossToAccuracy(cpLossCp)
    : Math.round(Math.max(0, Math.min(100, 100 - expectedPointsLost * 260)));
}

function isReviewKeyMoment(
  category: ReviewCategory | null,
  expectedPointsLost: number | null,
  cpLossCp: number | null,
  afterMate: number | null,
) {
  if (!category) {
    return false;
  }

  if (category === 'brilliant' || category === 'great') {
    return true;
  }

  if (afterMate != null && afterMate < 0) {
    return true;
  }

  if (category === 'blunder') {
    return (cpLossCp ?? 0) >= 260 || (expectedPointsLost ?? 0) >= 0.18;
  }

  if (category === 'mistake') {
    return (cpLossCp ?? 0) >= 220 || (expectedPointsLost ?? 0) >= 0.16;
  }

  if (category === 'miss') {
    return (cpLossCp ?? 0) >= 200 || (expectedPointsLost ?? 0) >= 0.14;
  }

  return false;
}

function buildCoachText({
  moveLabel,
  category,
  bestMoveSan,
  beforeExpected,
  afterExpected,
  expectedPointsLost,
  cpLossCp,
  beforeCp,
  afterCp,
}: {
  moveLabel: string;
  category: ReviewCategory | null;
  bestMoveSan: string | null;
  beforeExpected: number | null;
  afterExpected: number | null;
  expectedPointsLost: number | null;
  cpLossCp: number | null;
  beforeCp: number | null;
  afterCp: number | null;
}) {
  const swing =
    beforeExpected == null || afterExpected == null
      ? ''
      : ` Expected score: ${formatExpected(beforeExpected)} -> ${formatExpected(afterExpected)}.`;
  const best = bestMoveSan ? ` Best was ${bestMoveSan}.` : '';
  const loss = expectedPointsLost == null ? '' : ` Loss: ${(expectedPointsLost * 100).toFixed(1)}%.`;
  const cp =
    cpLossCp == null || beforeCp == null || afterCp == null
      ? ''
      : ` Eval: ${formatCpScore(beforeCp)} -> ${formatCpScore(afterCp)} (loss ${cpLossCp}cp).`;

  switch (category) {
    case 'book':
      return `${moveLabel} stays in the opening lane.`;
    case 'brilliant':
      return `${moveLabel} is a strong sacrifice that keeps or increases the advantage.${swing}${cp}`;
    case 'great':
      return `${moveLabel} is a key engine-aligned move.${swing}${cp}`;
    case 'best':
      return `${moveLabel} matches the engine's top choice.`;
    case 'excellent':
      return `${moveLabel} is accurate with only a tiny practical loss.${loss}${cp}`;
    case 'good':
      return `${moveLabel} is playable, but it leaves a little more on the board.${loss}${cp}`;
    case 'inaccuracy':
      return `${moveLabel} is an inaccuracy.${swing}${best}${cp}`;
    case 'miss':
      return `${moveLabel} misses a chance to punish the previous move.${swing}${best}${cp}`;
    case 'mistake':
      return `${moveLabel} is a mistake.${swing}${best}${cp}`;
    case 'blunder':
      return `${moveLabel} is a blunder.${swing}${best}${cp}`;
    default:
      return `${moveLabel}.`;
  }
}

function calculatePlayerAccuracy(reviews: TimelineReview[], color: 'w' | 'b') {
  const accuracies = reviews
    .filter((review) => review.color === color)
    .map((review) => review.moveAccuracy)
    .filter((value): value is number => typeof value === 'number');

  if (accuracies.length === 0) {
    return null;
  }

  return Number((accuracies.reduce((total, value) => total + value, 0) / accuracies.length).toFixed(1));
}

function calculateGameRating(rating: number | null, accuracy: number | null) {
  if (accuracy == null) {
    return null;
  }

  const base = rating ?? 800;
  const raw = base + (accuracy - 65) * 18;
  return Math.round(Math.max(100, Math.min(3200, raw)) / 50) * 50;
}

function extractKeyMoments(reviews: TimelineReview[]) {
  const lastBookMoment = [...reviews].reverse().find((review) => review.category === 'book') ?? null;
  const directMoments = reviews.filter((review) => review.category !== 'book' && review.isKeyMoment);
  const selected = [
    ...(lastBookMoment ? [lastBookMoment] : []),
    ...directMoments
      .sort((left, right) => {
        const leftRank = getKeyMomentRank(left);
        const rightRank = getKeyMomentRank(right);

        if (leftRank !== rightRank) {
          return rightRank - leftRank;
        }

        return getKeyMomentLossScore(right) - getKeyMomentLossScore(left);
      })
      .slice(0, lastBookMoment ? 7 : 8),
  ];

  return selected.sort((left, right) => left.ply - right.ply);
}

function getKeyMomentRank(review: TimelineReview) {
  switch (review.category) {
    case 'blunder':
      return 90;
    case 'mistake':
      return 80;
    case 'brilliant':
      return 76;
    case 'great':
      return 68;
    case 'miss':
      return 58;
    case 'inaccuracy':
      return 42;
    default:
      return review.isKeyMoment ? 30 : 0;
  }
}

function getKeyMomentLossScore(review: TimelineReview) {
  const expectedLoss = Math.round((review.expectedPointsLost ?? 0) * 1_000);
  const cpLoss = review.cpLossCp ?? 0;
  const matePenalty = review.afterMate != null && review.afterMate < 0 ? 10_000 : 0;

  return matePenalty + Math.max(cpLoss, expectedLoss);
}

function formatCpScore(scoreCp: number) {
  const pawns = scoreCp / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

function formatExpected(value: number) {
  return `${Math.round(value * 100)}%`;
}

function getMaterialCount(chess: Chess, color: 'w' | 'b') {
  let total = 0;

  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== color) {
        continue;
      }

      total += getPieceValue(piece.type);
    }
  }

  return total;
}

function isPieceSacrifice(beforeFen: string, afterFen: string, color: 'w' | 'b') {
  const before = new Chess(beforeFen);
  const after = new Chess(afterFen);

  return getMaterialCount(after, color) <= getMaterialCount(before, color) - 3;
}

function getPieceValue(piece: string) {
  switch (piece) {
    case 'p':
      return 1;
    case 'n':
    case 'b':
      return 3;
    case 'r':
      return 5;
    case 'q':
      return 9;
    default:
      return 0;
  }
}

function isMateForColor(analysis: AnalysisResult | null | undefined, color: 'w' | 'b') {
  const score = analysis?.whitePerspective;

  if (score?.type !== 'mate') {
    return false;
  }

  return color === 'w' ? score.value > 0 : score.value < 0;
}

function isWinningOutcome(analysis: AnalysisResult | null | undefined, color: 'w' | 'b') {
  const expectedPoints = getExpectedPoints(analysis, color);

  if (expectedPoints != null) {
    return expectedPoints >= 0.67;
  }

  const chartValue = analysis ? toChartScore(analysis) : null;

  if (chartValue == null) {
    return false;
  }

  return color === 'w' ? chartValue >= 1.8 : chartValue <= -1.8;
}

function isCompletelyWinning(analysis: AnalysisResult | null | undefined, color: 'w' | 'b') {
  const expectedPoints = getExpectedPoints(analysis, color);

  if (expectedPoints != null) {
    return expectedPoints >= 0.95;
  }

  const chartValue = analysis ? toChartScore(analysis) : null;

  if (chartValue == null) {
    return false;
  }

  return color === 'w' ? chartValue >= 5 : chartValue <= -5;
}

function formatTimelineMoveLabel(index: number, move: StoredMove) {
  const moveNumber = Math.floor(index / 2) + 1;
  return `${moveNumber}. ${move.san}`;
}

function formatChartAxisValue(value: number) {
  if (Math.abs(value) >= 11.95) {
    return value > 0 ? 'Mate' : '-Mate';
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}
