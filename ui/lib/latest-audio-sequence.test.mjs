import assert from 'node:assert/strict';
import test from 'node:test';

import { LatestAudioSequence } from './latest-audio-sequence.ts';

function createHarness() {
  const pending = new Map();
  const played = [];
  const stopped = [];
  let nextTimer = 0;

  const controller = new LatestAudioSequence({
    clearTimer(timer) {
      pending.delete(timer);
    },
    schedule(callback, delayMs) {
      const timer = ++nextTimer;
      pending.set(timer, { callback, delayMs });
      return timer;
    },
    startSound(sound, onEnded) {
      played.push(sound);
      return {
        stop() {
          stopped.push(sound);
          onEnded();
        },
      };
    },
  });

  const runNextTimer = () => {
    const next = pending.entries().next().value;

    if (!next) {
      return;
    }

    const [timer, { callback }] = next;
    pending.delete(timer);
    callback();
  };

  return { controller, pending, played, runNextTimer, stopped };
}

test('a newer move replaces active audio and pending sounds from the previous move', () => {
  const { controller, pending, played, runNextTimer, stopped } = createHarness();

  controller.playSequence(['move-self', 'move-check', 'game-end']);
  assert.deepEqual(played, ['move-self']);
  assert.deepEqual(
    [...pending.values()].map(({ delayMs }) => delayMs),
    [110, 220],
  );

  runNextTimer();
  controller.playSequence(['capture']);

  assert.deepEqual(played, ['move-self', 'move-check', 'capture']);
  assert.deepEqual(stopped, ['move-self', 'move-check']);
  assert.equal(pending.size, 0);
});

test('rapid standalone sounds never leave more than the latest player active', () => {
  const { controller, played, stopped } = createHarness();

  controller.play('move-self');
  controller.play('move-opponent');
  controller.play('capture');

  assert.deepEqual(played, ['move-self', 'move-opponent', 'capture']);
  assert.deepEqual(stopped, ['move-self', 'move-opponent']);
});

test('cancel stops active players and removes all pending timers', () => {
  const { controller, pending, stopped } = createHarness();

  controller.playSequence(['castle', 'move-check', 'game-end']);
  controller.cancel();

  assert.deepEqual(stopped, ['castle']);
  assert.equal(pending.size, 0);
});
