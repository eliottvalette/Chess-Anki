export function buildLichessExplorerHeaders(token: string | undefined = process.env.LICHESS_API_TOKEN) {
  const normalizedToken = token?.trim();

  if (!normalizedToken) {
    throw new Error('Missing LICHESS_API_TOKEN for Opening Explorer authentication.');
  }

  return {
    Accept: 'application/json',
    Authorization: `Bearer ${normalizedToken}`,
  };
}
