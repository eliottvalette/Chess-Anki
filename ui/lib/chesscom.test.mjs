import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchRecentGames } from './chesscom.ts';

test('monthly Chess.com archives bypass the Next.js data cache and use the bounded memory cache', async (t) => {
  const originalFetch = globalThis.fetch;
  const archiveUrl = 'https://api.chess.com/pub/player/cache-test/games/2099/12';
  const requests = [];

  globalThis.fetch = async (url, options) => {
    requests.push({ options, url: String(url) });
    return new Response(JSON.stringify({ games: [] }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const input = {
    archives: [archiveUrl],
    count: 10,
    timeClass: 'blitz',
    username: 'cache-test',
  };

  await fetchRecentGames(input);
  await fetchRecentGames(input);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.next, undefined);
});
