import type { AnalysisResult, AnalyzeRequest } from './analysis-types.ts';
import {
  buildPositionCommand,
  getAnalysisFen,
  parseAnalysis,
  sanitizeDepth,
  sanitizeMovetime,
  sanitizeMultiPv,
} from './uci-analysis.ts';

type BrowserAnalysisPayload = {
  positions?: AnalyzeRequest[];
  depth?: number;
  movetimeMs?: number;
};

type PendingRun = {
  lines: string[];
  predicate: (line: string, lines: string[]) => boolean;
  resolve: (lines: string[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  abort?: () => void;
};

const BROWSER_ENGINE_CACHE_VERSION = 3;
const BROWSER_ENGINE_CACHE_NAME = 'chess-analysis-engine-lite-single-v1';
const BROWSER_ENGINE_LEGACY_CACHE_NAMES = ['chess-analysis-engine-v1', 'chess-analysis-engine-full-single-v1'];
const BROWSER_ENGINE_STORE_NAME = 'analysis';
const BROWSER_ENGINE_MAX_CACHE_ENTRIES = 6_000;
const BROWSER_ENGINE_DEFAULT_POOL_SIZE = 2;
const BROWSER_ENGINE_MAX_POOL_SIZE = 2;
const BROWSER_ENGINE_TIMEOUT_MS = 120_000;
const STOCKFISH_SCRIPT_URL = '/stockfish/stockfish-18-lite-single.js#/stockfish/stockfish-18-lite-single.wasm';

let browserEnginePool: Promise<BrowserStockfishSession[]> | null = null;
let browserRoundRobin = 0;
let indexedDbCache: Promise<BrowserAnalysisCache | null> | null = null;
let legacyCacheCleanup: Promise<void> | null = null;
let browserSearchId = 0;
const memoryCache = new Map<string, AnalysisResult>();

export function canUseBrowserAnalysis() {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
}

export async function analyzeSinglePositionInBrowser(payload: AnalyzeRequest, signal?: AbortSignal) {
  const request = normalizeAnalyzeRequest(payload);
  const cacheKey = getBrowserAnalysisCacheKey(request);
  const cached = await getCachedAnalysis(cacheKey);

  if (cached) {
    logBrowserAnalysis(`cache-hit ${formatBrowserAnalysisRequest(request)} best=${cached.bestMove ?? '-'}`);
    return cached;
  }

  logBrowserAnalysis(`cache-miss ${formatBrowserAnalysisRequest(request)}`);
  const session = await getNextBrowserSession();
  const analysis = await session.analyze(request, signal);
  await setCachedAnalysis(cacheKey, analysis);
  return analysis;
}

export async function analyzeGamePositionsInBrowser(payload: BrowserAnalysisPayload, signal?: AbortSignal) {
  const positions = Array.isArray(payload.positions) ? payload.positions : [];
  const normalizedPositions = positions.map((position) =>
    normalizeAnalyzeRequest({
      ...position,
      depth: payload.depth ?? position.depth,
      movetimeMs: payload.movetimeMs ?? position.movetimeMs,
    }),
  );

  const analyses = await Promise.all(
    normalizedPositions.map((position) => analyzeSinglePositionInBrowser(position, signal)),
  );

  return { analyses };
}

function normalizeAnalyzeRequest(request: AnalyzeRequest): AnalyzeRequest {
  const movetimeMs = sanitizeMovetime(request.movetimeMs);
  const normalized: AnalyzeRequest = {
    ...request,
    depth: sanitizeDepth(request.depth),
    multipv: sanitizeMultiPv(request.multipv),
  };

  if (movetimeMs == null) {
    delete normalized.movetimeMs;
  } else {
    normalized.movetimeMs = movetimeMs;
  }

  return normalized;
}

async function getNextBrowserSession() {
  const pool = await getBrowserEnginePool();
  const session = pool[browserRoundRobin % pool.length];
  browserRoundRobin += 1;
  return session;
}

async function getBrowserEnginePool() {
  if (!browserEnginePool) {
    const size = getBrowserEnginePoolSize();
    logBrowserAnalysis(`pool-create size=${size} script=${STOCKFISH_SCRIPT_URL}`);
    browserEnginePool = Promise.all(Array.from({ length: size }, () => BrowserStockfishSession.create()));
  }

  return browserEnginePool;
}

function getBrowserEnginePoolSize() {
  const concurrency =
    typeof navigator === 'undefined' ? BROWSER_ENGINE_DEFAULT_POOL_SIZE : (navigator.hardwareConcurrency ?? 0);

  if (!Number.isFinite(concurrency) || concurrency < 4) {
    return 1;
  }

  return Math.max(1, Math.min(BROWSER_ENGINE_MAX_POOL_SIZE, Math.floor(concurrency / 4) || 1));
}

class BrowserStockfishSession {
  private pending: PendingRun | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly worker: Worker;

  private constructor(worker: Worker) {
    this.worker = worker;
    this.worker.addEventListener('message', (event) => this.handleLine(String(event.data ?? '')));
    this.worker.addEventListener('error', (event) => {
      this.rejectPending(new Error(event.message || 'Browser Stockfish worker failed.'));
    });
  }

  static async create() {
    const startedAt = getBrowserAnalysisLogTime();
    const session = new BrowserStockfishSession(new Worker(STOCKFISH_SCRIPT_URL));
    await session.initialize();
    logBrowserAnalysis(`worker-ready elapsed=${getBrowserAnalysisElapsedMs(startedAt)}ms`);
    return session;
  }

  analyze(request: AnalyzeRequest, signal?: AbortSignal) {
    return this.enqueue(async () => {
      const searchId = ++browserSearchId;
      const startedAt = getBrowserAnalysisLogTime();
      const depth = sanitizeDepth(request.depth);
      const movetimeMs = sanitizeMovetime(request.movetimeMs);
      const multipv = sanitizeMultiPv(request.multipv);
      const positionCommand = buildPositionCommand(request);
      const analysisFen = getAnalysisFen(request);
      const searchCommand = movetimeMs == null ? `go depth ${depth}` : `go movetime ${movetimeMs}`;
      logBrowserAnalysis(
        `search#${searchId} start ${formatBrowserAnalysisRequest(request)} command="${searchCommand}"`,
      );
      const lines = await this.run(
        ['setoption name Clear Hash', `setoption name MultiPV value ${multipv}`, positionCommand, searchCommand],
        (line) => line.startsWith('bestmove '),
        signal,
        movetimeMs == null ? null : Math.max(BROWSER_ENGINE_TIMEOUT_MS, movetimeMs + 5_000),
      );

      const analysis = parseAnalysis(lines, analysisFen, depth);
      logBrowserAnalysis(
        `search#${searchId} done elapsed=${getBrowserAnalysisElapsedMs(startedAt)}ms best=${analysis.bestMove ?? '-'} nodes=${analysis.nodes ?? '-'}`,
      );
      return analysis;
    });
  }

  private async initialize() {
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

  private enqueue<T>(task: () => Promise<T>) {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private run(
    commands: string[],
    predicate: (line: string, lines: string[]) => boolean,
    signal?: AbortSignal,
    timeoutMs: number | null = BROWSER_ENGINE_TIMEOUT_MS,
  ) {
    return new Promise<string[]>((resolve, reject) => {
      if (this.pending) {
        reject(new Error('Browser Stockfish is already busy.'));
        return;
      }

      if (signal?.aborted) {
        reject(new DOMException('Analysis aborted.', 'AbortError'));
        return;
      }

      const timer =
        timeoutMs == null
          ? null
          : setTimeout(() => {
              const active = this.pending;
              this.pending = null;
              reject(
                new Error(
                  `Browser Stockfish timeout after ${timeoutMs}ms.${active ? ` Last lines: ${active.lines.slice(-6).join(' | ')}` : ''}`,
                ),
              );
            }, timeoutMs);

      const abort = () => {
        const active = this.pending;
        if (active) {
          this.worker.postMessage('stop');
          this.pending = null;
          if (active.timer) {
            clearTimeout(active.timer);
          }
          active.reject(new DOMException('Analysis aborted.', 'AbortError'));
        }
      };

      signal?.addEventListener('abort', abort, { once: true });
      this.pending = {
        lines: [],
        predicate,
        resolve: (lines) => {
          signal?.removeEventListener('abort', abort);
          resolve(lines);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', abort);
          reject(error);
        },
        timer,
        abort,
      };

      for (const command of commands) {
        this.worker.postMessage(command);
      }
    });
  }

  private handleLine(rawLine: string) {
    const line = rawLine.trim();

    if (!line || !this.pending) {
      return;
    }

    this.pending.lines.push(line);

    if (this.pending.predicate(line, this.pending.lines)) {
      const current = this.pending;
      this.pending = null;
      if (current.timer) {
        clearTimeout(current.timer);
      }
      current.resolve(current.lines);
    }
  }

  private rejectPending(error: Error) {
    const current = this.pending;
    this.pending = null;
    if (current) {
      if (current.timer) {
        clearTimeout(current.timer);
      }
    }
    current?.reject(error);
  }
}

function getBrowserAnalysisCacheKey(request: AnalyzeRequest) {
  return JSON.stringify({
    engine: 'browser-stockfish-18-lite-single',
    version: BROWSER_ENGINE_CACHE_VERSION,
    positionCommand: buildPositionCommand(request),
    depth: sanitizeDepth(request.depth),
    movetimeMs: sanitizeMovetime(request.movetimeMs),
    multipv: sanitizeMultiPv(request.multipv),
  });
}

async function getCachedAnalysis(cacheKey: string) {
  const memoryHit = memoryCache.get(cacheKey);

  if (memoryHit) {
    memoryCache.delete(cacheKey);
    memoryCache.set(cacheKey, memoryHit);
    return memoryHit;
  }

  const cache = await getIndexedDbCache();
  const analysis = await cache?.get(cacheKey);

  if (analysis) {
    setMemoryCache(cacheKey, analysis);
  }

  return analysis ?? null;
}

async function setCachedAnalysis(cacheKey: string, analysis: AnalysisResult) {
  setMemoryCache(cacheKey, analysis);
  await (await getIndexedDbCache())?.set(cacheKey, analysis);
}

function setMemoryCache(cacheKey: string, analysis: AnalysisResult) {
  memoryCache.set(cacheKey, analysis);

  while (memoryCache.size > BROWSER_ENGINE_MAX_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;

    if (oldestKey == null) {
      return;
    }

    memoryCache.delete(oldestKey);
  }
}

async function getIndexedDbCache() {
  if (!canUseBrowserAnalysis() || typeof indexedDB === 'undefined') {
    return null;
  }

  indexedDbCache ??= deleteLegacyBrowserAnalysisCaches()
    .then(() => BrowserAnalysisCache.open())
    .catch(() => null);
  return indexedDbCache;
}

async function deleteLegacyBrowserAnalysisCaches() {
  if (!legacyCacheCleanup) {
    legacyCacheCleanup = Promise.all(
      BROWSER_ENGINE_LEGACY_CACHE_NAMES.filter((name) => name !== BROWSER_ENGINE_CACHE_NAME).map(
        deleteIndexedDbDatabase,
      ),
    ).then(() => undefined);
  }

  return legacyCacheCleanup;
}

function deleteIndexedDbDatabase(name: string) {
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => resolve();
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
  });
}

function formatBrowserAnalysisRequest(request: AnalyzeRequest) {
  return [
    `ply=${request.moves?.length ?? 0}`,
    `depth=${sanitizeDepth(request.depth)}`,
    `pv=${sanitizeMultiPv(request.multipv)}`,
  ].join(' ');
}

function getBrowserAnalysisLogTime() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function getBrowserAnalysisElapsedMs(startedAt: number) {
  return Math.round(getBrowserAnalysisLogTime() - startedAt);
}

function logBrowserAnalysis(detail: string) {
  console.info(`[analysis:browser] ${detail}`);
}

class BrowserAnalysisCache {
  private readonly db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static open() {
    return new Promise<BrowserAnalysisCache>((resolve, reject) => {
      const request = indexedDB.open(BROWSER_ENGINE_CACHE_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(BROWSER_ENGINE_STORE_NAME)) {
          db.createObjectStore(BROWSER_ENGINE_STORE_NAME);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('Unable to open analysis cache.'));
      request.onsuccess = () => resolve(new BrowserAnalysisCache(request.result));
    });
  }

  get(cacheKey: string) {
    return new Promise<AnalysisResult | null>((resolve) => {
      const transaction = this.db.transaction(BROWSER_ENGINE_STORE_NAME, 'readonly');
      const store = transaction.objectStore(BROWSER_ENGINE_STORE_NAME);
      const request = store.get(cacheKey);

      request.onerror = () => resolve(null);
      request.onsuccess = () => resolve((request.result as AnalysisResult | undefined) ?? null);
    });
  }

  set(cacheKey: string, analysis: AnalysisResult) {
    return new Promise<void>((resolve) => {
      const transaction = this.db.transaction(BROWSER_ENGINE_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(BROWSER_ENGINE_STORE_NAME);
      store.put(analysis, cacheKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  }
}
