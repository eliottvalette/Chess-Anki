import assert from 'node:assert/strict';
import test from 'node:test';

import { formatLinesLoadingStatus } from './lines-loading.ts';

test('formatLinesLoadingStatus identifies the requested browse ply', () => {
  assert.equal(formatLinesLoadingStatus({ kind: 'catalog', browsePly: 6, elapsedSeconds: 0 }), 'Loading lines · ply 6');
});

test('formatLinesLoadingStatus reports elapsed time without fake completion progress', () => {
  assert.equal(
    formatLinesLoadingStatus({ kind: 'position', browsePly: 4, elapsedSeconds: 3 }),
    'Filtering position · 3s',
  );
  assert.equal(formatLinesLoadingStatus({ kind: 'detail', browsePly: 4, elapsedSeconds: 2 }), 'Opening line · 2s');
});
