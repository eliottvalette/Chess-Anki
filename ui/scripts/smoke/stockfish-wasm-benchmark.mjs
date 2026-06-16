import { Chess } from 'chess.js';
import stockfish from 'stockfish';

import {
  buildPositionCommand,
  getAnalysisFen,
  parseAnalysis,
  sanitizeDepth,
  sanitizeMultiPv,
} from '../../lib/uci-analysis.ts';

const DEFAULT_USERNAME = 'losvalettos';
const DEFAULT_ARCHIVE = '2026/06';
const DEFAULT_DEPTH = 17;
const DEFAULT_MULTIPV = 3;
const DEFAULT_POSITIONS = 24;
const DEFAULT_NATIVE_URL = 'http://localhost:3000';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const username = options.username ?? DEFAULT_USERNAME;
  const archive = options.archive ?? DEFAULT_ARCHIVE;
  const depth = Number.parseInt(String(options.depth ?? DEFAULT_DEPTH), 10);
  const multipv = Number.parseInt(String(options.multipv ?? DEFAULT_MULTIPV), 10);
  const positionCount = Number.parseInt(String(options.positions ?? DEFAULT_POSITIONS), 10);
  const nativeUrl = options.nativeUrl ?? DEFAULT_NATIVE_URL;
  const positions = await loadRecentPositions({ username, archive, positionCount, depth, multipv });

  console.log(
    JSON.stringify(
      {
        benchmark: 'stockfish-native-vs-wasm',
        username,
        archive,
        positions: positions.length,
        depth,
        multipv,
        nativeUrl,
      },
      null,
      2,
    ),
  );

  const native = await benchmarkNative(positions, { depth, multipv, nativeUrl });
  const lite = await benchmarkWasm('lite-single', positions, { depth, multipv });
  const full = await benchmarkWasm('single', positions, { depth, multipv });
  const fullThreaded = await benchmarkWasm('full', positions, { depth, multipv });
  const summary = {
    native: summarizeEngine(native),
    wasm_lite_single: summarizeEngine(lite),
    wasm_full_single: summarizeEngine(full),
    wasm_full_threaded: summarizeEngine(fullThreaded),
    lite_vs_native: compareEngines(native.results, lite.results),
    full_vs_native: compareEngines(native.results, full.results),
    full_threaded_vs_native: compareEngines(native.results, fullThreaded.results),
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith('--')) {
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];

    if (!next || next.startsWith('--')) {
      parsed[key] = 'true';
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

async function loadRecentPositions({ username, archive, positionCount, depth, multipv }) {
  const response = await fetch(`https://api.chess.com/pub/player/${username.toLowerCase()}/games/${archive}`);

  if (!response.ok) {
    throw new Error(`Chess.com archive failed: ${response.status}`);
  }

  const payload = await response.json();
  const games = [...(payload.games ?? [])].reverse();
  const positions = [];
  const seen = new Set();

  for (const gameSummary of games) {
    if (!gameSummary.pgn) {
      continue;
    }

    const game = new Chess();

    try {
      game.loadPgn(gameSummary.pgn);
    } catch {
      continue;
    }

    const moves = game.history({ verbose: true }).map((move) => `${move.from}${move.to}${move.promotion ?? ''}`);
    const interestingPlies = [4, 6, 8, 10, 12, 14, 16, 20, 24, 30, 36, 44].filter((ply) => ply < moves.length);

    for (const ply of interestingPlies) {
      const request = {
        moves: moves.slice(0, ply),
        depth,
        multipv,
      };
      const key = request.moves.join(' ');

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      positions.push({
        id: `${gameSummary.url ?? gameSummary.end_time}#${ply}`,
        ply,
        request,
      });

      if (positions.length >= positionCount) {
        return positions;
      }
    }
  }

  return positions;
}

async function benchmarkNative(positions, { depth, multipv, nativeUrl }) {
  const results = [];
  const startedAt = performance.now();

  for (const position of positions) {
    const requestStartedAt = performance.now();
    const response = await fetch(`${nativeUrl}/api/analyze-position`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...position.request,
        depth,
        multipv,
      }),
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Native analyze failed ${response.status}: ${text}`);
    }

    results.push({
      ...position,
      analysis: JSON.parse(text),
      elapsedMs: Math.round(performance.now() - requestStartedAt),
    });
  }

  return {
    engine: 'native-server',
    elapsedMs: Math.round(performance.now() - startedAt),
    results,
  };
}

async function benchmarkWasm(engineName, positions, { depth, multipv }) {
  const session = await WasmStockfishSession.create(engineName);
  const results = [];
  const startedAt = performance.now();

  for (const position of positions) {
    const requestStartedAt = performance.now();
    const request = {
      ...position.request,
      depth,
      multipv,
    };
    const analysis = await session.analyze(request);
    results.push({
      ...position,
      analysis,
      elapsedMs: Math.round(performance.now() - requestStartedAt),
    });
  }

  return {
    engine: `wasm-${engineName}`,
    elapsedMs: Math.round(performance.now() - startedAt),
    results,
  };
}

class WasmStockfishSession {
  static async create(engineName) {
    const engine = await stockfish(engineName);
    const session = new WasmStockfishSession(engineName, engine);
    await session.initialize();
    return session;
  }

  constructor(engineName, engine) {
    this.engineName = engineName;
    this.engine = engine;
  }

  initialize() {
    return this.run(['uci'], (line) => line === 'uciok').then(() =>
      this.run(
        [
          `setoption name Threads value ${this.engineName === 'full' ? 4 : 1}`,
          'setoption name Hash value 32',
          'setoption name UCI_AnalyseMode value true',
          'setoption name UCI_ShowWDL value true',
          'isready',
        ],
        (line) => line === 'readyok',
      ),
    );
  }

  async analyze(request) {
    const safeDepth = sanitizeDepth(request.depth);
    const safeMultiPv = sanitizeMultiPv(request.multipv);
    const positionCommand = buildPositionCommand(request);
    const analysisFen = getAnalysisFen(request);
    const lines = await this.run(
      [
        'setoption name Clear Hash',
        `setoption name MultiPV value ${safeMultiPv}`,
        positionCommand,
        `go depth ${safeDepth}`,
      ],
      (line) => line.startsWith('bestmove '),
      60_000,
    );

    return parseAnalysis(lines, analysisFen, safeDepth);
  }

  run(commands, predicate, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const lines = [];
      const previousListener = this.engine.listener;
      const timer = setTimeout(() => {
        this.engine.listener = previousListener;
        reject(
          new Error(`${this.engineName} timeout after ${timeoutMs}ms. Last lines: ${lines.slice(-6).join(' | ')}`),
        );
      }, timeoutMs);

      this.engine.listener = (line) => {
        const text = String(line ?? '').trim();

        if (!text) {
          return;
        }

        lines.push(text);

        if (predicate(text, lines)) {
          clearTimeout(timer);
          this.engine.listener = previousListener;
          resolve(lines);
        }
      };

      for (const command of commands) {
        this.engine.sendCommand(command);
      }
    });
  }
}

function summarizeEngine(run) {
  const elapsed = run.results.map((result) => result.elapsedMs).sort((left, right) => left - right);

  return {
    engine: run.engine,
    total_ms: run.elapsedMs,
    avg_ms: round(avg(elapsed), 1),
    p50_ms: percentile(elapsed, 0.5),
    p95_ms: percentile(elapsed, 0.95),
    results: run.results.length,
  };
}

function compareEngines(reference, candidate) {
  const pairs = reference
    .map((referenceResult, index) => ({
      reference: referenceResult,
      candidate: candidate[index],
    }))
    .filter((pair) => pair.candidate);
  const bestMoveMatches = pairs.filter((pair) => pair.reference.analysis.bestMove === pair.candidate.analysis.bestMove);
  const cpDeltas = pairs
    .map((pair) => Math.abs(getWhiteCp(pair.reference.analysis) - getWhiteCp(pair.candidate.analysis)))
    .filter(Number.isFinite);
  const disagreements = pairs
    .filter((pair) => pair.reference.analysis.bestMove !== pair.candidate.analysis.bestMove)
    .slice(0, 8)
    .map((pair) => ({
      id: pair.reference.id,
      ply: pair.reference.ply,
      native_best: pair.reference.analysis.bestMove,
      candidate_best: pair.candidate.analysis.bestMove,
      native_cp: getWhiteCp(pair.reference.analysis),
      candidate_cp: getWhiteCp(pair.candidate.analysis),
      native_ms: pair.reference.elapsedMs,
      candidate_ms: pair.candidate.elapsedMs,
    }));

  return {
    positions: pairs.length,
    best_move_match_rate: round(bestMoveMatches.length / Math.max(1, pairs.length), 4),
    avg_abs_cp_delta: round(avg(cpDeltas), 1),
    p95_abs_cp_delta: percentile(
      cpDeltas.sort((left, right) => left - right),
      0.95,
    ),
    disagreements,
  };
}

function getWhiteCp(analysis) {
  const score = analysis.whitePerspective;

  if (!score) {
    return Number.NaN;
  }

  if (score.type === 'mate') {
    return Math.sign(score.value) * 100_000;
  }

  return score.value;
}

function avg(values) {
  if (values.length === 0) {
    return Number.NaN;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, p) {
  if (values.length === 0) {
    return null;
  }

  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
  return values[index];
}

function round(value, digits) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

await main();
