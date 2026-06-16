export async function fetchArchives(username) {
  const response = await fetchJson(`https://api.chess.com/pub/player/${username}/games/archives`);
  const archives = Array.isArray(response.archives) ? response.archives : [];

  if (archives.length === 0) {
    throw new Error(`No public archives found for Chess.com user "${username}".`);
  }

  return archives;
}

export async function fetchRecentGames({ username, archives, count, timeClass }) {
  const selected = [];

  for (const archiveUrl of [...archives].reverse()) {
    const response = await fetchJson(archiveUrl);
    const games = Array.isArray(response.games) ? response.games : [];

    const matchingGames = games
      .filter((game) => game?.time_class === timeClass)
      .filter((game) => isPlayerInGame(username, game))
      .sort((left, right) => Number(right.end_time ?? 0) - Number(left.end_time ?? 0));

    selected.push(...matchingGames);

    if (selected.length >= count) {
      break;
    }
  }

  return selected.sort((left, right) => Number(right.end_time ?? 0) - Number(left.end_time ?? 0)).slice(0, count);
}

export function toGameSummary(game, username) {
  const playerColor =
    game.white?.username?.toLowerCase() === game.black?.username?.toLowerCase()
      ? 'unknown'
      : inferPlayerColor(game, username);
  const player = playerColor === 'white' ? game.white : game.black;
  const opponent = playerColor === 'white' ? game.black : game.white;

  return {
    url: game.url,
    link: extractTag(game.pgn, 'Link') ?? game.url,
    end_time: game.end_time,
    utc_date: extractTag(game.pgn, 'UTCDate'),
    utc_time: extractTag(game.pgn, 'UTCTime'),
    player_color: playerColor,
    player_username: player?.username ?? null,
    player_rating: player?.rating ?? null,
    player_result: player?.result ?? null,
    opponent_username: opponent?.username ?? null,
    opponent_rating: opponent?.rating ?? null,
    result: extractTag(game.pgn, 'Result'),
    termination: extractTag(game.pgn, 'Termination'),
    eco: extractTag(game.pgn, 'ECO'),
    eco_url: game.eco ?? null,
    time_control: game.time_control ?? null,
    accuracies: game.accuracies ?? null,
    pgn: game.pgn,
  };
}

export function extractTag(pgn, tagName) {
  if (typeof pgn !== 'string') {
    return null;
  }

  const match = pgn.match(new RegExp(`\\[${tagName} "([^"]+)"\\]`));
  return match?.[1] ?? null;
}

export async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'chess-analysis-v2/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Chess.com request failed for ${url}: HTTP ${response.status}`);
  }

  return response.json();
}

function isPlayerInGame(username, game) {
  const normalized = username.toLowerCase();
  return game?.white?.username?.toLowerCase() === normalized || game?.black?.username?.toLowerCase() === normalized;
}

function inferPlayerColor(game, username) {
  return game.white?.username?.toLowerCase() === username.toLowerCase() ? 'white' : 'black';
}
