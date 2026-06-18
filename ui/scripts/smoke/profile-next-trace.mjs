import { readFile } from 'node:fs/promises';

const tracePath = process.argv[2] ?? '.next/dev/trace';
const raw = await readFile(tracePath, 'utf8');
const allEvents = raw
  .trim()
  .split(/\n+/)
  .flatMap((line) => JSON.parse(line));
const latestEvent = allEvents.reduce(
  (latest, event) => (Number(event.startTime ?? 0) > Number(latest?.startTime ?? 0) ? event : latest),
  null,
);
const latestTraceId = latestEvent?.traceId ?? null;
const events = latestTraceId ? allEvents.filter((event) => event.traceId === latestTraceId) : allEvents;

function summarize(eventsToSummarize, keyForEvent) {
  const totals = new Map();

  for (const event of eventsToSummarize) {
    const key = keyForEvent(event);
    const current = totals.get(key) ?? { count: 0, maxUs: 0, totalUs: 0 };
    current.count += 1;
    current.maxUs = Math.max(current.maxUs, Number(event.duration ?? 0));
    current.totalUs += Number(event.duration ?? 0);
    totals.set(key, current);
  }

  return [...totals.entries()]
    .map(([name, value]) => ({
      name,
      count: value.count,
      averageMs: Number((value.totalUs / value.count / 1_000).toFixed(1)),
      maximumMs: Number((value.maxUs / 1_000).toFixed(1)),
      totalMs: Number((value.totalUs / 1_000).toFixed(1)),
    }))
    .sort((left, right) => right.totalMs - left.totalMs);
}

const apiRequests = events.filter(
  (event) => event.name === 'handle-request' && String(event.tags?.url ?? '').startsWith('/api/'),
);
const apiRoutes = summarize(apiRequests, (event) => String(event.tags.url).split('?')[0]);
const compilerEvents = events.filter((event) =>
  ['client-hmr-latency', 'webpack-compilation', 'webpack-invalidated-client', 'webpack-invalidated-server'].includes(
    event.name,
  ),
);
const compiler = summarize(compilerEvents, (event) => event.name);

console.log(
  JSON.stringify(
    {
      tracePath,
      traceId: latestTraceId,
      eventCount: events.length,
      apiRoutes,
      compiler,
    },
    null,
    2,
  ),
);
