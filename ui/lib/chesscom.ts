import { Chess } from 'chess.js';

export type ChessComRecentGameSummary = {
  url: string;
  link: string;
  endTime: number | null;
  utcDate: string | null;
  utcTime: string | null;
  playerColor: 'white' | 'black' | 'unknown';
  playerUsername: string | null;
  playerRating: number | null;
  opponentUsername: string | null;
  opponentRating: number | null;
  whiteAvatar: string | null;
  blackAvatar: string | null;
  result: string | null;
  termination: string | null;
  eco: string | null;
  timeClass: 'bullet' | 'blitz' | 'rapid' | 'daily' | 'unknown';
  timeControl: string | null;
  moveCount: number;
  outcome: 'win' | 'loss' | 'draw' | 'unknown';
  pgn: string;
};

export type ChessComRecentGameTimeClass = 'all' | 'bullet' | 'blitz' | 'rapid';

export type ChessComRecentGamePage = {
  games: RawChessComGame[];
  hasMore: boolean;
  nextCursor: string | null;
  nextOffset: number;
};

type RawChessComPlayer = {
  username?: string;
  rating?: number;
  result?: string;
};

type ChessComPlayerProfile = {
  avatar: string | null;
};

export type RawChessComGame = {
  url?: string;
  pgn?: string;
  end_time?: number;
  time_class?: string;
  time_control?: string;
  white?: RawChessComPlayer;
  black?: RawChessComPlayer;
};

const ARCHIVE_FETCH_CONCURRENCY = 2;
const CHESSCOM_FETCH_TIMEOUT_MS = 8_000;

export async function fetchArchives(username: string) {
  const response = await fetchJson(`https://api.chess.com/pub/player/${username}/games/archives`);
  const archives = Array.isArray(response.archives) ? response.archives : [];

  if (archives.length === 0) {
    throw new Error(`No public archives found for Chess.com user "${username}".`);
  }

  return archives as string[];
}

export async function fetchRecentGames({
  username,
  archives,
  count,
  offset = 0,
  cursor = null,
  timeClass,
}: {
  username: string;
  archives: string[];
  count: number;
  offset?: number;
  cursor?: string | null;
  timeClass: string;
}): Promise<ChessComRecentGamePage> {
  const selected: RawChessComGame[] = [];
  const needed = cursor ? count + 1 : count + offset + 1;
  const reversedArchives = [...archives].reverse();

  for (let index = 0; index < reversedArchives.length; index += ARCHIVE_FETCH_CONCURRENCY) {
    const archiveUrls = reversedArchives.slice(index, index + ARCHIVE_FETCH_CONCURRENCY);
    const archiveResponses = await Promise.all(archiveUrls.map((archiveUrl) => fetchJson(archiveUrl)));

    for (const response of archiveResponses) {
      const games = Array.isArray(response.games) ? response.games : [];

      selected.push(
        ...(games as RawChessComGame[])
          .filter((game) => timeClass === 'all' || game?.time_class === timeClass)
          .filter((game) => isPlayerInGame(username, game)),
      );
    }

    const availableAfterCursor = cursor
      ? dedupeGames(selected)
          .sort(compareGamesForRecentPage)
          .filter((game) => isAfterCursor(game, cursor)).length
      : selected.length;

    if (availableAfterCursor >= needed) {
      break;
    }
  }

  const sorted = dedupeGames(selected)
    .sort(compareGamesForRecentPage)
    .filter((game) => isAfterCursor(game, cursor));
  const page = cursor ? sorted.slice(0, count + 1) : sorted.slice(offset, offset + count + 1);
  const games = page.slice(0, count);

  return {
    games,
    hasMore: page.length > count,
    nextCursor: games.length > 0 ? encodeCursor(games[games.length - 1]) : null,
    nextOffset: offset + games.length,
  };
}

export async function fetchPlayerProfiles(usernames: string[]) {
  const uniqueUsernames = [...new Set(usernames.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  const entries = await Promise.all(
    uniqueUsernames.map(async (playerUsername) => {
      try {
        const profile = await fetchJson(`https://api.chess.com/pub/player/${playerUsername}`);
        const avatar = typeof profile.avatar === 'string' ? profile.avatar : null;

        return [playerUsername, { avatar }] as const;
      } catch {
        return [playerUsername, { avatar: null }] as const;
      }
    }),
  );

  return new Map<string, ChessComPlayerProfile>(entries);
}

export function toGameSummary(
  game: RawChessComGame,
  username: string,
  profiles = new Map<string, ChessComPlayerProfile>(),
): ChessComRecentGameSummary {
  const playerColor =
    game.white?.username?.toLowerCase() === game.black?.username?.toLowerCase()
      ? 'unknown'
      : inferPlayerColor(game, username);
  const player = playerColor === 'white' ? game.white : game.black;
  const opponent = playerColor === 'white' ? game.black : game.white;

  return {
    url: String(game.url),
    link: extractTag(game.pgn, 'Link') ?? String(game.url),
    endTime: typeof game.end_time === 'number' ? game.end_time : null,
    utcDate: extractTag(game.pgn, 'UTCDate'),
    utcTime: extractTag(game.pgn, 'UTCTime'),
    playerColor,
    playerUsername: player?.username ?? null,
    playerRating: typeof player?.rating === 'number' ? player.rating : null,
    opponentUsername: opponent?.username ?? null,
    opponentRating: typeof opponent?.rating === 'number' ? opponent.rating : null,
    whiteAvatar: game.white?.username ? (profiles.get(game.white.username.toLowerCase())?.avatar ?? null) : null,
    blackAvatar: game.black?.username ? (profiles.get(game.black.username.toLowerCase())?.avatar ?? null) : null,
    result: extractTag(game.pgn, 'Result'),
    termination: extractTag(game.pgn, 'Termination'),
    eco: extractTag(game.pgn, 'ECO'),
    timeClass: normalizeTimeClass(game.time_class),
    timeControl: typeof game.time_control === 'string' ? game.time_control : null,
    moveCount: countMovesFromPgn(game.pgn),
    outcome: inferOutcome(player?.result ?? null, extractTag(game.pgn, 'Result')),
    pgn: typeof game.pgn === 'string' ? game.pgn : '',
  };
}

export function extractTag(pgn: string | null | undefined, tagName: string) {
  if (typeof pgn !== 'string') {
    return null;
  }

  const match = pgn.match(new RegExp(`\\[${tagName} "([^"]+)"\\]`));
  return match?.[1] ?? null;
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHESSCOM_FETCH_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        'user-agent': 'chess-analysis-v2/1.0',
      },
      next: {
        revalidate: 300,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Chess.com request timed out for ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Chess.com request failed for ${url}: HTTP ${response.status}`);
  }

  return response.json();
}

function dedupeGames(games: RawChessComGame[]) {
  const seen = new Set<string>();
  const deduped: RawChessComGame[] = [];

  for (const game of games) {
    const key = getGameStableKey(game);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(game);
  }

  return deduped;
}

function getGameStableKey(game: RawChessComGame) {
  return (
    extractTag(game.pgn, 'Link') ??
    game.url ??
    `${game.end_time ?? 0}:${game.white?.username ?? ''}:${game.black?.username ?? ''}`
  );
}

function encodeCursor(game: RawChessComGame) {
  return `${Number(game.end_time ?? 0)}|${encodeURIComponent(getGameStableKey(game))}`;
}

function parseCursor(cursor: string | null) {
  if (!cursor) {
    return null;
  }

  const [rawEndTime, rawKey = ''] = cursor.split('|');
  const endTime = Number(rawEndTime);

  if (!Number.isFinite(endTime)) {
    return null;
  }

  return {
    endTime,
    key: decodeURIComponent(rawKey),
  };
}

function compareGamesForRecentPage(left: RawChessComGame, right: RawChessComGame) {
  const timeCompare = Number(right.end_time ?? 0) - Number(left.end_time ?? 0);

  if (timeCompare !== 0) {
    return timeCompare;
  }

  return getGameStableKey(left).localeCompare(getGameStableKey(right));
}

function isAfterCursor(game: RawChessComGame, cursor: string | null) {
  const parsed = parseCursor(cursor);

  if (!parsed) {
    return true;
  }

  const endTime = Number(game.end_time ?? 0);

  if (endTime < parsed.endTime) {
    return true;
  }

  if (endTime > parsed.endTime) {
    return false;
  }

  return getGameStableKey(game).localeCompare(parsed.key) > 0;
}

function isPlayerInGame(username: string, game: RawChessComGame) {
  const normalized = username.toLowerCase();
  return game?.white?.username?.toLowerCase() === normalized || game?.black?.username?.toLowerCase() === normalized;
}

function inferPlayerColor(game: RawChessComGame, username: string): 'white' | 'black' {
  return game.white?.username?.toLowerCase() === username.toLowerCase() ? 'white' : 'black';
}

function normalizeTimeClass(timeClass: string | undefined): ChessComRecentGameSummary['timeClass'] {
  switch (timeClass) {
    case 'bullet':
    case 'blitz':
    case 'rapid':
    case 'daily':
      return timeClass;
    default:
      return 'unknown';
  }
}

function countMovesFromPgn(pgn: string | undefined) {
  if (typeof pgn !== 'string' || pgn.trim().length === 0) {
    return 0;
  }

  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    return Math.ceil(chess.history().length / 2);
  } catch {
    return 0;
  }
}

function inferOutcome(playerResult: string | null, resultTag: string | null): ChessComRecentGameSummary['outcome'] {
  switch (playerResult) {
    case 'win':
      return 'win';
    case 'agreed':
    case 'repetition':
    case 'stalemate':
    case 'insufficient':
    case '50move':
    case 'timevsinsufficient':
      return 'draw';
    case 'checkmated':
    case 'timeout':
    case 'resigned':
    case 'lose':
    case 'abandoned':
      return 'loss';
  }

  switch (resultTag) {
    case '1-0':
    case '0-1':
      return 'unknown';
    case '1/2-1/2':
      return 'draw';
    default:
      return 'unknown';
  }
}
