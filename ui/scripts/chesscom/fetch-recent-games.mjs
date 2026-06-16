import { fetchArchives, fetchRecentGames, toGameSummary } from './api.mjs';

const DEFAULT_COUNT = 5;
const DEFAULT_TIME_CLASS = 'blitz';
const DEFAULT_FORMAT = 'json';

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const username = options.username;

  if (!username) {
    throw new Error(
      'Usage: node scripts/chesscom/fetch-recent-games.mjs --username <chesscom-username> [--count 5] [--time-class blitz] [--format json|pgn]',
    );
  }

  const archives = await fetchArchives(username);
  const games = await fetchRecentGames({
    username,
    archives,
    count: options.count,
    timeClass: options.timeClass,
  });

  if (options.format === 'pgn') {
    console.log(games.map((game) => game.pgn).join('\n\n'));
    return;
  }

  console.log(
    JSON.stringify(
      {
        username,
        requested_count: options.count,
        fetched_count: games.length,
        time_class: options.timeClass,
        games: games.map((game) => toGameSummary(game, username)),
      },
      null,
      2,
    ),
  );
}

function parseArgs(args) {
  const options = {
    username: '',
    count: DEFAULT_COUNT,
    timeClass: DEFAULT_TIME_CLASS,
    format: DEFAULT_FORMAT,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (arg === '--username' && value) {
      options.username = value.trim().toLowerCase();
      index += 1;
      continue;
    }

    if (arg === '--count' && value) {
      options.count = Math.max(1, Number.parseInt(value, 10) || DEFAULT_COUNT);
      index += 1;
      continue;
    }

    if (arg === '--time-class' && value) {
      options.timeClass = value.trim().toLowerCase();
      index += 1;
      continue;
    }

    if (arg === '--format' && value) {
      const format = value.trim().toLowerCase();

      if (format !== 'json' && format !== 'pgn') {
        throw new Error(`Unsupported format "${value}". Use json or pgn.`);
      }

      options.format = format;
      index += 1;
    }
  }

  return options;
}
