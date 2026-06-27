'use client';

import { AsyncTtlCache } from './async-ttl-cache.ts';

const openingTreesRequestCache = new AsyncTtlCache<string, unknown>({ maxEntries: 32, ttlMs: 15_000 });
const OPENING_TREES_REQUEST_TIMEOUT_MS = 12_000;

export async function requestOpeningTreesJson<Payload>(url: string): Promise<Payload> {
  const result = await openingTreesRequestCache.get(url, async () => {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), OPENING_TREES_REQUEST_TIMEOUT_MS);

    let response: Response;

    try {
      response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Opening trees request timed out after ${OPENING_TREES_REQUEST_TIMEOUT_MS / 1000}s.`);
      }

      throw error;
    } finally {
      globalThis.clearTimeout(timer);
    }

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
