import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLichessExplorerHeaders } from './lichess-explorer.ts';

test('buildLichessExplorerHeaders authenticates opening explorer requests', () => {
  assert.deepEqual(buildLichessExplorerHeaders('secret-token'), {
    Accept: 'application/json',
    Authorization: 'Bearer secret-token',
  });
});

test('buildLichessExplorerHeaders rejects missing authentication', () => {
  assert.throws(() => buildLichessExplorerHeaders(''), /LICHESS_API_TOKEN/);
});
