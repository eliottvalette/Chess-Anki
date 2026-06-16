import type { AnalysisResult, AnalyzeRequest } from './analysis-types';

type TimelinePosition = AnalyzeRequest & {
  moves?: string[];
};

type TimelineAnalysisRunnerOptions = {
  label?: string;
  signal?: AbortSignal;
  positions: TimelinePosition[];
  cache: Map<string, AnalysisResult>;
  positionInFlight: Map<string, Promise<AnalysisResult>>;
  batchInFlight: Map<string, Promise<AnalysisResult[]>>;
  batchSize: number;
  getCacheKey: (position: TimelinePosition) => string;
  buildRequest: (position: TimelinePosition) => AnalyzeRequest;
  analyzeBatch: (positions: AnalyzeRequest[], signal?: AbortSignal) => Promise<AnalysisResult[]>;
  onProgress?: (progress: number) => void;
};

export async function runTimelineAnalysisDedupe({
  label = 'timeline',
  signal,
  positions,
  cache,
  positionInFlight,
  batchInFlight,
  batchSize,
  getCacheKey,
  buildRequest,
  analyzeBatch,
  onProgress,
}: TimelineAnalysisRunnerOptions) {
  const sequence: AnalysisResult[] = new Array(positions.length);
  const missing: Array<{
    index: number;
    cacheKey: string;
    position: AnalyzeRequest;
    inFlight?: Promise<AnalysisResult>;
    deferred?: ReturnType<typeof createAnalysisDeferred>;
  }> = [];
  let completed = 0;
  const startedAt = getTimelineLogTime();
  const reportProgress = () => {
    const progress = (completed / Math.max(1, positions.length)) * 100;
    logTimelineAnalysis(label, `progress ${completed}/${positions.length} ${Math.round(progress)}%`);
    onProgress?.(progress);
  };

  throwIfAborted(signal);

  logTimelineAnalysis(
    label,
    `start positions=${positions.length} batch=${batchSize} cache=${cache.size} position_inflight=${positionInFlight.size} batch_inflight=${batchInFlight.size}`,
  );

  reportProgress();

  positions.forEach((position, index) => {
    const cacheKey = getCacheKey(position);
    const cachedAnalysis = cache.get(cacheKey);

    if (cachedAnalysis) {
      sequence[index] = cachedAnalysis;
      completed += 1;
      reportProgress();
      return;
    }

    if (!position.fen) {
      throw new Error('Missing timeline position.');
    }

    const inFlight = positionInFlight.get(cacheKey);
    const deferred = inFlight ? undefined : createAnalysisDeferred();
    const plannedPromise = inFlight ?? deferred?.promise;

    if (plannedPromise && !inFlight) {
      plannedPromise.catch(() => undefined);
      positionInFlight.set(cacheKey, plannedPromise);
    }

    missing.push({
      index,
      cacheKey,
      inFlight: plannedPromise,
      deferred,
      position: buildRequest(position),
    });
  });

  logTimelineAnalysis(
    label,
    `planned cached=${completed} missing=${missing.length} reused_inflight=${missing.filter((item) => item.inFlight && !item.deferred).length}`,
  );

  try {
    for (let start = 0; start < missing.length; start += batchSize) {
      throwIfAborted(signal);
      const batch = missing.slice(start, start + batchSize);
      const alreadyInFlight = batch.filter((item) => item.inFlight && !item.deferred);
      const needsBatchAnalysis = batch.filter((item) => item.deferred);

      if (alreadyInFlight.length > 0) {
        logTimelineAnalysis(
          label,
          `await-inflight count=${alreadyInFlight.length} indexes=${formatTimelineIndexes(alreadyInFlight.map((item) => item.index))}`,
        );
      }

      await Promise.all(
        alreadyInFlight.map(async (item) => {
          throwIfAborted(signal);
          const analysis = await item.inFlight;

          if (!analysis) {
            throw new Error('Missing deep analysis result.');
          }

          cache.set(item.cacheKey, analysis);
          sequence[item.index] = analysis;
          completed += 1;
          reportProgress();
        }),
      );

      if (needsBatchAnalysis.length === 0) {
        continue;
      }

      const batchKey = needsBatchAnalysis.map((item) => item.cacheKey).join('|');
      let batchPromise = batchInFlight.get(batchKey);

      if (!batchPromise) {
        logTimelineAnalysis(
          label,
          `batch-start count=${needsBatchAnalysis.length} indexes=${formatTimelineIndexes(needsBatchAnalysis.map((item) => item.index))}`,
        );
        batchPromise = analyzeBatch(
          needsBatchAnalysis.map((item) => item.position),
          signal,
        ).finally(() => {
          if (batchInFlight.get(batchKey) === batchPromise) {
            batchInFlight.delete(batchKey);
          }
        });

        batchInFlight.set(batchKey, batchPromise);
      } else {
        logTimelineAnalysis(
          label,
          `batch-reuse count=${needsBatchAnalysis.length} indexes=${formatTimelineIndexes(needsBatchAnalysis.map((item) => item.index))}`,
        );
      }

      const analyses = await batchPromise.catch((error) => {
        needsBatchAnalysis.forEach((item) => {
          item.deferred?.reject(error);
          if (positionInFlight.get(item.cacheKey) === item.deferred?.promise) {
            positionInFlight.delete(item.cacheKey);
          }
        });
        throw error;
      });

      logTimelineAnalysis(label, `batch-done count=${analyses.length} elapsed=${getTimelineElapsedMs(startedAt)}ms`);

      needsBatchAnalysis.forEach((item, index) => {
        throwIfAborted(signal);
        const analysis = analyses[index];

        if (!analysis) {
          throw new Error('Missing deep analysis result.');
        }

        cache.set(item.cacheKey, analysis);
        item.deferred?.resolve(analysis);
        if (positionInFlight.get(item.cacheKey) === item.deferred?.promise) {
          positionInFlight.delete(item.cacheKey);
        }
        sequence[item.index] = analysis;
        completed += 1;
        reportProgress();
      });
    }
  } catch (error) {
    logTimelineAnalysis(
      label,
      `fail elapsed=${getTimelineElapsedMs(startedAt)}ms ${error instanceof Error ? error.message : String(error)}`,
    );
    missing.forEach((item) => {
      item.deferred?.reject(error);
      if (positionInFlight.get(item.cacheKey) === item.deferred?.promise) {
        positionInFlight.delete(item.cacheKey);
      }
    });
    throw error;
  }

  onProgress?.(100);
  logTimelineAnalysis(label, `done positions=${positions.length} elapsed=${getTimelineElapsedMs(startedAt)}ms`);
  return sequence;
}

function formatTimelineIndexes(indexes: number[]) {
  if (indexes.length === 0) {
    return '-';
  }

  const first = indexes[0];
  const last = indexes[indexes.length - 1];
  return first === last ? String(first) : `${first}-${last}`;
}

function getTimelineLogTime() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function getTimelineElapsedMs(startedAt: number) {
  return Math.round(getTimelineLogTime() - startedAt);
}

function logTimelineAnalysis(label: string, detail: string) {
  console.info(`[timeline:${label}] ${detail}`);
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException('Analysis aborted.', 'AbortError');
  }
}

function createAnalysisDeferred() {
  let resolve!: (analysis: AnalysisResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<AnalysisResult>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}
