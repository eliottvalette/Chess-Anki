class FailingStockfishWorker {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);

    if (type === 'error') {
      queueMicrotask(() => listener({ message: 'synthetic worker failure' }));
    }
  }

  postMessage() {}
}

let fetchCalled = false;

globalThis.window = { location: { hostname: 'production.example' } };
globalThis.Worker = FailingStockfishWorker;
globalThis.WebAssembly = WebAssembly;
globalThis.fetch = async (url) => {
  fetchCalled = true;
  throw new Error(`Unexpected server fetch: ${url}`);
};

const { analyzeSinglePosition } = await import('../../lib/chess-analysis-client.ts');

try {
  await analyzeSinglePosition({ moves: ['e2e4'], depth: 17, multipv: 3 });
  throw new Error('Expected browser analysis to fail.');
} catch (error) {
  if (fetchCalled) {
    throw new Error('Server analysis fallback was called in production browser mode.');
  }

  console.log(
    JSON.stringify(
      {
        server_fetch_called: fetchCalled,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
}
