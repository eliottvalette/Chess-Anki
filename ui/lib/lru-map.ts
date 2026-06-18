export function lruMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value, maxEntries: number): void {
  if (map.has(key)) {
    map.delete(key);
  }

  map.set(key, value);

  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value as Key | undefined;

    if (oldestKey === undefined) {
      return;
    }

    map.delete(oldestKey);
  }
}

export function lruMapGet<Key, Value>(map: Map<Key, Value>, key: Key): Value | undefined {
  const value = map.get(key);

  if (value === undefined) {
    return undefined;
  }

  map.delete(key);
  map.set(key, value);
  return value;
}
