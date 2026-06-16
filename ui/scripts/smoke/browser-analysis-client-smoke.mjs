class FakeStockfishWorker {
  static created = 0;
  static urls = [];

  constructor(url) {
    FakeStockfishWorker.created += 1;
    FakeStockfishWorker.urls.push(String(url));
    this.url = String(url);
    this.listeners = new Map();
    this.commands = [];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(command) {
    this.commands.push(String(command));

    if (command === 'uci') {
      this.emit('message', 'Stockfish 18 Lite WASM by the Stockfish developers');
      this.emit('message', 'uciok');
      return;
    }

    if (command === 'isready') {
      this.emit('message', 'readyok');
      return;
    }

    if (String(command).startsWith('go ')) {
      this.emit(
        'message',
        'info depth 17 seldepth 19 multipv 1 score cp 31 wdl 85 910 5 nodes 12345 nps 411500 time 30 pv g1f3 b8c6',
      );
      this.emit(
        'message',
        'info depth 17 seldepth 18 multipv 2 score cp 18 wdl 70 920 10 nodes 12345 nps 411500 time 30 pv b1c3 g8f6',
      );
      this.emit('message', 'bestmove g1f3 ponder b8c6');
    }
  }

  emit(type, data) {
    queueMicrotask(() => {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ data });
      }
    });
  }
}

globalThis.window = {};
globalThis.Worker = FakeStockfishWorker;
globalThis.WebAssembly = WebAssembly;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { hardwareConcurrency: 8 },
});
globalThis.fetch = async (url) => {
  throw new Error(`Unexpected server fetch: ${url}`);
};

const { analyzeSinglePosition, analyzeGamePositions } = await import('../../lib/chess-analysis-client.ts');

const single = await analyzeSinglePosition({
  moves: ['e2e4', 'e7e5'],
  depth: 17,
  multipv: 3,
});

if (single.bestMove !== 'g1f3' || single.depth !== 17 || single.lines.length !== 2) {
  throw new Error(`Unexpected single analysis: ${JSON.stringify(single)}`);
}

const batch = await analyzeGamePositions({
  positions: [
    { moves: ['e2e4'], multipv: 3 },
    { moves: ['e2e4', 'e7e5'], multipv: 3 },
  ],
  depth: 17,
});

if (batch.analyses.length !== 2 || batch.analyses.some((analysis) => analysis.bestMove !== 'g1f3')) {
  throw new Error(`Unexpected batch analysis: ${JSON.stringify(batch)}`);
}

console.log(
  JSON.stringify(
    {
      worker_urls: FakeStockfishWorker.urls,
      workers_created: FakeStockfishWorker.created,
      single_best: single.bestMove,
      batch_results: batch.analyses.length,
    },
    null,
    2,
  ),
);
