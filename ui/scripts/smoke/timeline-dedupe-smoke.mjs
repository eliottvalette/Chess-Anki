import { runTimelineAnalysisDedupe } from '../../lib/timeline-analysis-runner.ts';

const positions = Array.from({ length: 24 }, (_, index) => ({
  fen: `8/8/8/8/8/8/8/8 ${index % 2 === 0 ? 'w' : 'b'} - - 0 1`,
  moves: Array.from({ length: index }, (__, moveIndex) => `m${moveIndex}`),
}));
const cache = new Map();
const positionInFlight = new Map();
const batchInFlight = new Map();
const batchStarts = [];
const singleStarts = [];
const batchSize = 4;
const getCacheKey = (position) => `k:${position.moves.join('.')}`;

function makeAnalysis(id) {
  return {
    bestMove: id,
    depth: 17,
    multipv: 3,
    whitePerspective: { type: 'cp', value: 0, bound: 'exact' },
    score: { type: 'cp', value: 0, bound: 'exact' },
    lines: [],
  };
}

function fetchSingle(position) {
  const cacheKey = getCacheKey(position);
  const cached = cache.get(cacheKey);

  if (cached) {
    return Promise.resolve(cached);
  }

  const inFlight = positionInFlight.get(cacheKey);

  if (inFlight) {
    return inFlight;
  }

  singleStarts.push(cacheKey);
  const request = Promise.resolve(makeAnalysis(`single:${cacheKey}`)).then((analysis) => {
    cache.set(cacheKey, analysis);
    return analysis;
  });
  positionInFlight.set(cacheKey, request);
  return request;
}

const deep = runTimelineAnalysisDedupe({
  positions,
  cache,
  positionInFlight,
  batchInFlight,
  batchSize,
  getCacheKey,
  buildRequest: (position) => position,
  analyzeBatch: async (batchPositions) => {
    batchStarts.push(batchPositions.map(getCacheKey));
    await new Promise((resolve) => setTimeout(resolve, 10));
    return batchPositions.map((position) => makeAnalysis(`batch:${getCacheKey(position)}`));
  },
});

if (positionInFlight.size !== positions.length) {
  throw new Error(
    `Expected every timeline position to be reserved synchronously, got ${positionInFlight.size}/${positions.length}.`,
  );
}

await Promise.all(positions.slice(5, 16).map(fetchSingle));
await deep;

const duplicateBatches = findDuplicates(batchStarts.map((batch) => batch.join('|')));

console.log(
  JSON.stringify(
    {
      positions: positions.length,
      batch_starts: batchStarts.length,
      duplicate_batches: duplicateBatches,
      single_starts: singleStarts,
    },
    null,
    2,
  ),
);

if (singleStarts.length !== 0) {
  throw new Error(`Expected zero single analysis starts, got ${singleStarts.length}: ${singleStarts.join(', ')}`);
}

if (duplicateBatches.length !== 0) {
  throw new Error(`Expected zero duplicate batches, got ${JSON.stringify(duplicateBatches)}`);
}

function findDuplicates(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}
