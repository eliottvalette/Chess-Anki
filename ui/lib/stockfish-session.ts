import 'server-only';

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import path from 'node:path';

import type { AnalysisResult, AnalyzeRequest } from './analysis-types.ts';
import {
  buildPositionCommand,
  getAnalysisFen,
  parseAnalysis,
  sanitizeDepth,
  sanitizeMovetime,
  sanitizeMultiPv,
} from './uci-analysis.ts';

const ENGINE_TIMEOUT_MS = 15_000;
const DEFAULT_ENGINE_POOL_SIZE = 4;
const MAX_ENGINE_POOL_SIZE = 6;
const DEFAULT_STOCKFISH_PATHS = [
  path.join(process.cwd(), 'bin', 'stockfish'),
  path.join(process.cwd(), 'ui', 'bin', 'stockfish'),
  '/var/task/bin/stockfish',
  '/opt/homebrew/bin/stockfish',
  '/usr/local/bin/stockfish',
  'stockfish',
];
const MAX_ANALYSIS_CACHE_ENTRIES = 4_000;

type StockfishEngine = {
  addMessageListener(listener: (line: string) => void): void;
  postMessage(command: string): void;
  dispose(): void;
};

type PendingRequest = {
  lines: string[];
  predicate: (line: string, lines: string[]) => boolean;
  resolve: (lines: string[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

class NativeStockfishEngine implements StockfishEngine {
  private readonly listeners = new Set<(line: string) => void>();
  private bufferedOutput = '';

  private constructor(private readonly process: ChildProcessWithoutNullStreams) {
    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');
    this.process.stdout.on('data', (chunk) => this.handleOutput(String(chunk)));
    this.process.stderr.on('data', (chunk) => this.handleOutput(String(chunk)));
  }

  static async create() {
    const configuredPath = process.env.STOCKFISH_PATH?.trim();
    const candidates = configuredPath ? [configuredPath, ...DEFAULT_STOCKFISH_PATHS] : DEFAULT_STOCKFISH_PATHS;
    const uniqueCandidates = [...new Set(candidates)];
    const errors: string[] = [];

    for (const candidate of uniqueCandidates) {
      try {
        const engine = await NativeStockfishEngine.tryCreate(candidate);
        return engine;
      } catch (error) {
        errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`Unable to start Stockfish. Tried ${errors.join(' | ')}`);
  }

  private static tryCreate(command: string) {
    return new Promise<NativeStockfishEngine>((resolve, reject) => {
      const child = spawn(command, [], { stdio: 'pipe' });

      child.once('spawn', () => resolve(new NativeStockfishEngine(child)));
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code !== null) {
          reject(new Error(`exited with code ${code}`));
        }
      });
    });
  }

  addMessageListener(listener: (line: string) => void) {
    this.listeners.add(listener);
  }

  postMessage(command: string) {
    this.process.stdin.write(`${command}\n`);
  }

  dispose() {
    this.listeners.clear();

    if (!this.process.killed) {
      this.process.kill();
    }
  }

  private handleOutput(output: string) {
    this.bufferedOutput += output;
    const lines = this.bufferedOutput.split(/\r?\n/);
    this.bufferedOutput = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      for (const listener of this.listeners) {
        listener(trimmed);
      }
    }
  }
}

class StockfishSession {
  private readonly engine: StockfishEngine;
  private pending: PendingRequest | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(engine: StockfishEngine) {
    this.engine = engine;
    this.engine.addMessageListener((line) => this.handleLine(line));
  }

  private handleLine(rawLine: string) {
    const line = String(rawLine ?? '').trim();

    if (!line || !this.pending) {
      return;
    }

    this.pending.lines.push(line);

    if (this.pending.predicate(line, this.pending.lines)) {
      const current = this.pending;
      this.pending = null;
      clearTimeout(current.timer);
      current.resolve(current.lines);
    }
  }

  private run(
    commands: string[],
    predicate: (line: string, lines: string[]) => boolean,
    timeoutMs = ENGINE_TIMEOUT_MS,
  ) {
    return new Promise<string[]>((resolve, reject) => {
      if (this.pending) {
        reject(new Error('Stockfish is already busy.'));
        return;
      }

      const timer = setTimeout(() => {
        const active = this.pending;
        this.pending = null;
        reject(
          new Error(
            `Stockfish timeout after ${timeoutMs}ms.${active ? ` Last lines: ${active.lines.slice(-6).join(' | ')}` : ''}`,
          ),
        );
      }, timeoutMs);

      this.pending = {
        lines: [],
        predicate,
        resolve,
        reject,
        timer,
      };

      for (const command of commands) {
        this.engine.postMessage(command);
      }
    });
  }

  private enqueue<T>(task: () => Promise<T>) {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async initialize() {
    await this.run(['uci'], (line) => line === 'uciok');
    await this.run(
      [
        'setoption name Threads value 1',
        'setoption name Hash value 32',
        'setoption name UCI_AnalyseMode value true',
        'setoption name UCI_ShowWDL value true',
        'isready',
      ],
      (line) => line === 'readyok',
    );
  }

  analyze(request: AnalyzeRequest) {
    return this.enqueue(async () => {
      const depth = sanitizeDepth(request.depth);
      const movetimeMs = sanitizeMovetime(request.movetimeMs);
      const multipv = sanitizeMultiPv(request.multipv);
      const positionCommand = buildPositionCommand(request);
      const analysisFen = getAnalysisFen(request);
      const searchCommand = movetimeMs == null ? `go depth ${depth}` : `go movetime ${movetimeMs}`;
      const cacheKey = getAnalysisCacheKey(positionCommand, depth, movetimeMs, multipv);
      const cachedAnalysis = getCachedAnalysis(cacheKey);

      if (cachedAnalysis) {
        return cachedAnalysis;
      }

      const lines = await this.run(
        ['setoption name Clear Hash', `setoption name MultiPV value ${multipv}`, positionCommand, searchCommand],
        (line) => line.startsWith('bestmove '),
        movetimeMs == null ? 30_000 : Math.max(ENGINE_TIMEOUT_MS, movetimeMs + 5_000),
      );

      const analysis = parseAnalysis(lines, analysisFen, depth);
      setCachedAnalysis(cacheKey, analysis);
      return analysis;
    });
  }
}

declare global {
  var __chessAnalysisStockfishSession: Promise<StockfishSession> | undefined;
  var __chessAnalysisStockfishSessions: Array<Promise<StockfishSession> | undefined> | undefined;
  var __chessAnalysisStockfishRoundRobin: number | undefined;
  var __chessAnalysisCache: Map<string, AnalysisResult> | undefined;
}

if (process.env.NODE_ENV !== 'production') {
  globalThis.__chessAnalysisStockfishSession = undefined;
  globalThis.__chessAnalysisStockfishSessions = undefined;
  globalThis.__chessAnalysisStockfishRoundRobin = undefined;
}

export function getStockfishSession(slot?: number) {
  const poolSize = getStockfishPoolSize();
  const requestedSlot =
    typeof slot === 'number' && Number.isFinite(slot)
      ? Math.max(0, Math.floor(slot)) % poolSize
      : getNextStockfishSlot(poolSize);

  globalThis.__chessAnalysisStockfishSessions ??= [];

  if (!globalThis.__chessAnalysisStockfishSessions[requestedSlot]) {
    const sessionPromise = NativeStockfishEngine.create()
      .then(async (engine) => {
        const session = new StockfishSession(engine);
        await session.initialize();
        return session;
      })
      .catch((error) => {
        if (globalThis.__chessAnalysisStockfishSessions) {
          globalThis.__chessAnalysisStockfishSessions[requestedSlot] = undefined;
        }
        throw error;
      });

    globalThis.__chessAnalysisStockfishSessions[requestedSlot] = sessionPromise;
  }

  globalThis.__chessAnalysisStockfishSession = globalThis.__chessAnalysisStockfishSessions[requestedSlot];
  return globalThis.__chessAnalysisStockfishSessions[requestedSlot];
}

export async function getStockfishSessionPool(size = getStockfishPoolSize()) {
  const poolSize = Math.max(1, Math.min(getStockfishPoolSize(), Math.floor(size)));
  return Promise.all(Array.from({ length: poolSize }, (_, index) => getStockfishSession(index)));
}

function getNextStockfishSlot(poolSize: number) {
  const next = globalThis.__chessAnalysisStockfishRoundRobin ?? 0;
  globalThis.__chessAnalysisStockfishRoundRobin = (next + 1) % poolSize;
  return next;
}

function getStockfishPoolSize() {
  const parsed = Number.parseInt(String(process.env.STOCKFISH_POOL_SIZE ?? DEFAULT_ENGINE_POOL_SIZE), 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_ENGINE_POOL_SIZE;
  }

  return Math.max(1, Math.min(MAX_ENGINE_POOL_SIZE, parsed));
}

function getAnalysisCache() {
  globalThis.__chessAnalysisCache ??= new Map<string, AnalysisResult>();
  return globalThis.__chessAnalysisCache;
}

function getAnalysisCacheKey(positionCommand: string, depth: number, movetimeMs: number | null, multipv: number) {
  return JSON.stringify({
    engine: 'native-stockfish',
    depth,
    movetimeMs,
    multipv,
    positionCommand,
  });
}

function getCachedAnalysis(cacheKey: string) {
  const cache = getAnalysisCache();
  const analysis = cache.get(cacheKey);

  if (!analysis) {
    return null;
  }

  cache.delete(cacheKey);
  cache.set(cacheKey, analysis);
  return analysis;
}

function setCachedAnalysis(cacheKey: string, analysis: AnalysisResult) {
  const cache = getAnalysisCache();
  cache.set(cacheKey, analysis);

  while (cache.size > MAX_ANALYSIS_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;

    if (oldestKey == null) {
      return;
    }

    cache.delete(oldestKey);
  }
}
