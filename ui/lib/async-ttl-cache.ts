export type AsyncCacheStatus = 'hit' | 'miss' | 'deduped';

type CacheEntry<Value> = {
  expiresAt: number;
  pending: Promise<Value> | null;
  value: Value | undefined;
};

export class AsyncTtlCache<Key, Value> {
  private readonly entries = new Map<Key, CacheEntry<Value>>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: { maxEntries: number; ttlMs: number; now?: () => number }) {
    this.maxEntries = Math.max(1, options.maxEntries);
    this.ttlMs = Math.max(0, options.ttlMs);
    this.now = options.now ?? Date.now;
  }

  async get(key: Key, loader: () => Promise<Value>): Promise<{ status: AsyncCacheStatus; value: Value }> {
    const existing = this.entries.get(key);

    if (existing?.pending) {
      return { status: 'deduped', value: await existing.pending };
    }

    if (existing?.value !== undefined && existing.expiresAt > this.now()) {
      this.touch(key, existing);
      return { status: 'hit', value: existing.value };
    }

    if (existing) {
      this.entries.delete(key);
    }

    const entry: CacheEntry<Value> = { expiresAt: 0, pending: null, value: undefined };
    const pending = loader();
    entry.pending = pending;
    this.entries.set(key, entry);
    this.evictOverflow();

    try {
      const value = await pending;

      if (this.entries.get(key) === entry) {
        entry.expiresAt = this.now() + this.ttlMs;
        entry.pending = null;
        entry.value = value;
        this.touch(key, entry);
      }

      return { status: 'miss', value };
    } catch (error) {
      if (this.entries.get(key) === entry) {
        this.entries.delete(key);
      }
      throw error;
    }
  }

  has(key: Key): boolean {
    const entry = this.entries.get(key);

    if (!entry) {
      return false;
    }

    if (!entry.pending && (entry.value === undefined || entry.expiresAt <= this.now())) {
      this.entries.delete(key);
      return false;
    }

    return true;
  }

  invalidate(key: Key): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as Key | undefined;

      if (oldestKey === undefined) {
        return;
      }

      this.entries.delete(oldestKey);
    }
  }

  private touch(key: Key, entry: CacheEntry<Value>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }
}
