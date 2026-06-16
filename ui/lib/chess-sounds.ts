import type { StoredMove } from '@/lib/chess-analysis-client';

export type ChessSoundKey =
  | 'game-start'
  | 'game-end'
  | 'capture'
  | 'castle'
  | 'premove'
  | 'move-self'
  | 'move-opponent'
  | 'move-check'
  | 'promote'
  | 'notify'
  | 'illegal';

export const CHESS_SOUND_URLS: Record<ChessSoundKey, string> = {
  'game-start': '/sounds/chesscom/game-start.mp3',
  'game-end': '/sounds/chesscom/game-end.mp3',
  capture: '/sounds/chesscom/capture.mp3',
  castle: '/sounds/chesscom/castle.mp3',
  premove: '/sounds/chesscom/premove.mp3',
  'move-self': '/sounds/chesscom/move-self.mp3',
  'move-opponent': '/sounds/chesscom/move-opponent.mp3',
  'move-check': '/sounds/chesscom/move-check.mp3',
  promote: '/sounds/chesscom/promote.mp3',
  notify: '/sounds/chesscom/notify.mp3',
  illegal: '/sounds/chesscom/illegal.mp3',
};

export function getMoveSoundSequence({
  move,
  isSelfMove,
  isCheck,
  isCheckmate,
  isGameOver,
}: {
  move: StoredMove;
  isSelfMove: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  isGameOver: boolean;
}): ChessSoundKey[] {
  const sounds: ChessSoundKey[] = [getPrimaryMoveSound(move, isSelfMove)];

  if (isCheck || isCheckmate) {
    sounds.push('move-check');
  }

  if (isCheckmate || isGameOver) {
    sounds.push('game-end');
  }

  return sounds;
}

export function getPrimaryMoveSound(move: StoredMove, isSelfMove: boolean): ChessSoundKey {
  if (isCastleMove(move)) {
    return 'castle';
  }

  if (move.promotion) {
    return 'promote';
  }

  if (move.captured || move.flags.includes('c') || move.flags.includes('e')) {
    return 'capture';
  }

  return isSelfMove ? 'move-self' : 'move-opponent';
}

function isCastleMove(move: StoredMove) {
  return move.flags.includes('k') || move.flags.includes('q');
}
