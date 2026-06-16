import assert from 'node:assert/strict';
import test from 'node:test';

import { getMoveSoundSequence, getPrimaryMoveSound } from './chess-sounds.ts';

test('getPrimaryMoveSound prioritizes castle, promote, and capture over self/opponent move sounds', () => {
  assert.equal(
    getPrimaryMoveSound(
      {
        from: 'e1',
        to: 'g1',
        san: 'O-O',
        lan: 'e1g1',
        promotion: null,
        piece: 'k',
        color: 'w',
        flags: 'k',
        captured: null,
        uci: 'e1g1',
      },
      true,
    ),
    'castle',
  );

  assert.equal(
    getPrimaryMoveSound(
      {
        from: 'e7',
        to: 'e8',
        san: 'e8=Q',
        lan: 'e7e8q',
        promotion: 'q',
        piece: 'p',
        color: 'w',
        flags: 'np',
        captured: null,
        uci: 'e7e8q',
      },
      true,
    ),
    'promote',
  );

  assert.equal(
    getPrimaryMoveSound(
      {
        from: 'e4',
        to: 'd5',
        san: 'exd5',
        lan: 'e4d5',
        promotion: null,
        piece: 'p',
        color: 'w',
        flags: 'c',
        captured: 'p',
        uci: 'e4d5',
      },
      false,
    ),
    'capture',
  );
});

test('getMoveSoundSequence appends check and end sounds for checkmates', () => {
  const sounds = getMoveSoundSequence({
    move: {
      from: 'd1',
      to: 'h5',
      san: 'Qh5#',
      lan: 'd1h5',
      promotion: null,
      piece: 'q',
      color: 'w',
      flags: 'n',
      captured: null,
      uci: 'd1h5',
    },
    isSelfMove: true,
    isCheck: true,
    isCheckmate: true,
    isGameOver: true,
  });

  assert.deepEqual(sounds, ['move-self', 'move-check', 'game-end']);
});
