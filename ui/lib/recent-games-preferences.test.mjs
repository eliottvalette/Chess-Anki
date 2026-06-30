import assert from 'node:assert/strict';
import test from 'node:test';

import { CHESSCOM_USERNAME_COOKIE, readSavedChessComUsername } from './recent-games-preferences.ts';

test('recent games keep the pre-refactor Chess.com username cookie as the canonical key', () => {
  assert.equal(CHESSCOM_USERNAME_COOKIE, 'chesscom_username');
});

test('recent games hydrate usernames saved under the short-lived refactor cookie key', () => {
  const cookies = new Map([['chesscom_user', 'losvalettos']]);

  assert.equal(
    readSavedChessComUsername((name) => cookies.get(name) ?? ''),
    'losvalettos',
  );
});

test('the refactor cookie wins during migration when it contains a newer username', () => {
  const cookies = new Map([
    ['chesscom_username', 'old-name'],
    ['chesscom_user', 'new-name'],
  ]);

  assert.equal(
    readSavedChessComUsername((name) => cookies.get(name) ?? ''),
    'new-name',
  );
});
