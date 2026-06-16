import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

export const TRAINING_SESSION_COOKIE = 'chess_training_session';
const PASSWORD_ITERATIONS = 120_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = 'sha256';

export function normalizeTrainingUsername(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);
}

export function hashTrainingPassword(password: string) {
  const salt = randomBytes(16).toString('base64url');
  const hash = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString(
    'base64url',
  );
  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

export function verifyTrainingPassword(password: string, storedHash: string) {
  const [method, iterationsRaw, salt, expectedHash] = storedHash.split('$');

  if (method !== 'pbkdf2' || !iterationsRaw || !salt || !expectedHash) {
    return false;
  }

  const iterations = Number(iterationsRaw);

  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  const actual = Buffer.from(
    pbkdf2Sync(password, salt, iterations, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST).toString('base64url'),
  );
  const expected = Buffer.from(expectedHash);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createTrainingSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashTrainingSessionToken(token: string) {
  return createHash('sha256').update(token).digest('base64url');
}

export function parseTrainingSessionCookie(value: string | undefined) {
  if (!value) {
    return null;
  }

  const [profileId, token] = value.split('.');

  if (!profileId || !token) {
    return null;
  }

  return { profileId, token };
}
