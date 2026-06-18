import assert from 'node:assert/strict';
import test from 'node:test';

import { BoundedAsyncQueue } from './bounded-async-queue.ts';

test('BoundedAsyncQueue runs every task with bounded concurrency', async () => {
  const queue = new BoundedAsyncQueue(2);
  let active = 0;
  let peak = 0;
  const order = [];

  for (let index = 0; index < 5; index += 1) {
    queue.enqueue(async () => {
      active += 1;
      peak = Math.max(peak, active);
      order.push(`start-${index}`);
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      order.push(`end-${index}`);
      active -= 1;
    });
  }

  await new Promise((resolve) => {
    setTimeout(resolve, 200);
  });

  assert.equal(peak, 2);
  assert.equal(order.filter((entry) => entry.startsWith('end-')).length, 5);
});

test('BoundedAsyncQueue cancel drops pending tasks', async () => {
  const queue = new BoundedAsyncQueue(1);
  let completed = 0;

  queue.enqueue(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    completed += 1;
  });
  queue.enqueue(async () => {
    completed += 1;
  });
  queue.cancel();

  await new Promise((resolve) => {
    setTimeout(resolve, 40);
  });

  assert.equal(completed, 1);
});
