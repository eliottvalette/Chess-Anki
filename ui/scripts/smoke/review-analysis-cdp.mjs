const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const USERNAME = process.env.CHESSCOM_USERNAME || 'losvalettos';
const TIME_CLASS = process.env.CHESSCOM_TIME_CLASS || 'blitz';
const RUN_MS = Number(process.env.SMOKE_RUN_MS || 45000);

const version = await fetch(`${CDP_URL}/json/version`).then((response) => response.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const consoleLines = [];
const requests = [];

function send(method, params = {}, sessionId = null) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

function waitForOpen() {
  if (ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
}

ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));

  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message));
    } else {
      resolve(message.result);
    }
    return;
  }

  if (message.method === 'Runtime.consoleAPICalled') {
    const line = message.params.args.map((arg) => String(arg.value ?? arg.description ?? '')).join(' ');
    if (line.includes('[analysis:') || line.includes('[preload:game]')) {
      consoleLines.push(line);
      console.log(line);
    }
  }

  if (message.method === 'Network.requestWillBeSent') {
    const url = message.params.request?.url ?? '';
    if (url.includes('/api/analyze-game') || url.includes('/api/analyze-position')) {
      requests.push({ url, ts: message.params.timestamp });
    }
  }
});

await waitForOpen();
await send('Target.setDiscoverTargets', { discover: true });
const target = await fetch(`${CDP_URL}/json/new?${encodeURIComponent(APP_URL)}`, { method: 'PUT' }).then((response) =>
  response.json(),
);
const session = await send('Target.attachToTarget', { targetId: target.id, flatten: true });
const sessionId = session.sessionId;

function sessionSend(method, params = {}) {
  return send(method, params, sessionId);
}

await sessionSend('Runtime.enable');
await sessionSend('Page.enable');
await sessionSend('Network.enable');
await sessionSend('Network.setCookie', {
  name: 'chesscom_username',
  value: USERNAME,
  domain: 'localhost',
  path: '/',
});
await sessionSend('Network.setCookie', {
  name: 'chesscom_time_class',
  value: TIME_CLASS,
  domain: 'localhost',
  path: '/',
});
await sessionSend('Page.navigate', { url: APP_URL });
await new Promise((resolve) => setTimeout(resolve, 3500));

await sessionSend('Runtime.evaluate', {
  expression: `
    (() => {
      const buttons = [...document.querySelectorAll('button')];
      const fetchButton = buttons.find(button => /fetch|load|recent|games/i.test(button.textContent || ''));
      fetchButton?.click();
      return buttons.map(button => button.textContent?.trim()).filter(Boolean).slice(0, 30);
    })()
  `,
  awaitPromise: true,
});

await new Promise((resolve) => setTimeout(resolve, 5000));
await sessionSend('Runtime.evaluate', {
  expression: `
    (() => {
      const candidates = [...document.querySelectorAll('button, [role="button"], li, article')]
        .filter(element => /vs|LosValettos|MUHAMMED0712199/i.test(element.textContent || ''));
      candidates[0]?.click();
      return candidates.map(element => element.textContent?.trim()).filter(Boolean).slice(0, 10);
    })()
  `,
  awaitPromise: true,
});

await new Promise((resolve) => setTimeout(resolve, RUN_MS));

const starts = consoleLines.filter((line) => line.includes('[analysis:game] ->'));
const duplicateStarts = findDuplicates(starts.map(normalizeGameStart));
const positionStarts = consoleLines.filter((line) => line.includes('[analysis:position] ->'));

console.log(
  JSON.stringify(
    {
      game_start_count: starts.length,
      duplicate_game_starts: duplicateStarts,
      position_start_count: positionStarts.length,
      sample_position_starts: positionStarts.slice(0, 12),
      preload_lines: consoleLines.filter((line) => line.includes('[preload:game]')).slice(0, 12),
    },
    null,
    2,
  ),
);

await fetch(`${CDP_URL}/json/close/${target.id}`).catch(() => undefined);
ws.close();

if (duplicateStarts.length > 0) {
  process.exitCode = 1;
}

function normalizeGameStart(line) {
  return line.replace(/^.*?\\[analysis:game\\] -> /, '');
}

function findDuplicates(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}
