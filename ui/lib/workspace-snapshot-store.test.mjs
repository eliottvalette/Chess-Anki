import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkspaceSnapshotStore } from './workspace-snapshot-store.ts';

test('WorkspaceSnapshotStore keeps the Lines board independent from Review', () => {
  const store = new WorkspaceSnapshotStore();
  const linesSnapshot = { historyIndex: 8, mode: 'lines' };
  const reviewSnapshot = { historyIndex: 3, mode: 'review' };

  store.save('lines', linesSnapshot);
  store.save('review', reviewSnapshot);

  assert.equal(store.load('lines'), linesSnapshot);
  assert.equal(store.load('review'), reviewSnapshot);
});

test('WorkspaceSnapshotStore can replace and clear individual workspaces', () => {
  const store = new WorkspaceSnapshotStore();

  store.save('lines', { historyIndex: 4 });
  store.save('lines', { historyIndex: 7 });
  assert.deepEqual(store.load('lines'), { historyIndex: 7 });

  store.remove('lines');
  assert.equal(store.load('lines'), null);
});
