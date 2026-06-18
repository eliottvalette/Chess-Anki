'use client';

import { AsyncTtlCache } from './async-ttl-cache.ts';

const openingTreesRequestCache = new AsyncTtlCache<string, unknown>({ maxEntries: 32, ttlMs: 15_000 });

export async function requestOpeningTreesJson<Payload>(url: string): Promise<Payload> {
  const result = await openingTreesRequestCache.get(url, async () => {
    const response = await fetch(url, { credentials: 'same-origin' });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      throw new Error(payload.error ?? `Opening trees request failed: HTTP ${response.status}`);
    }

    return payload;
  });

  return result.value as Payload;
}

export function invalidateOpeningTreesClientCache(): void {
  openingTreesRequestCache.clear();
}
