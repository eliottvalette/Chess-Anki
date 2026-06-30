export const CHESSCOM_USERNAME_COOKIE = 'chesscom_username';
export const LEGACY_CHESSCOM_USERNAME_COOKIE = 'chesscom_user';
export const CHESSCOM_TIME_CLASS_COOKIE = 'chesscom_time_class';

export function readSavedChessComUsername(readCookie: (name: string) => string) {
  return readCookie(LEGACY_CHESSCOM_USERNAME_COOKIE) || readCookie(CHESSCOM_USERNAME_COOKIE);
}
