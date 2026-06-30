import assert from 'node:assert/strict';
import test from 'node:test';

import { scheduleRecentGamesAutoFetch } from './recent-games-auto-fetch.ts';

test('canceling an initial auto-fetch schedule allows the replacement effect to reschedule it', () => {
  const callbacks = new Map();
  let nextId = 0;
  let fetches = 0;
  const startedRef = { current: false };
  const scheduler = {
    cancel(id) {
      callbacks.delete(id);
    },
    schedule(callback) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
  };

  const cancelFirst = scheduleRecentGamesAutoFetch(
    startedRef,
    () => {
      fetches += 1;
    },
    scheduler,
  );

  cancelFirst();
  assert.equal(startedRef.current, false);

  scheduleRecentGamesAutoFetch(
    startedRef,
    () => {
      fetches += 1;
    },
    scheduler,
  );
  callbacks.values().next().value();

  assert.equal(fetches, 1);
  assert.equal(startedRef.current, true);
});

test('auto-fetch can only start once when multiple callbacks are queued', () => {
  const callbacks = [];
  let fetches = 0;
  const startedRef = { current: false };
  const scheduler = {
    cancel() {},
    schedule(callback) {
      callbacks.push(callback);
      return callbacks.length;
    },
  };

  scheduleRecentGamesAutoFetch(
    startedRef,
    () => {
      fetches += 1;
    },
    scheduler,
  );
  scheduleRecentGamesAutoFetch(
    startedRef,
    () => {
      fetches += 1;
    },
    scheduler,
  );

  callbacks.forEach((callback) => {
    callback();
  });
  assert.equal(fetches, 1);
});
