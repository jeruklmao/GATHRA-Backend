export class BoundedTtlCache<T> {
  private readonly entries = new Map<
    string,
    { readonly value: T; readonly expiresAt: number }
  >();

  constructor(private readonly maximumEntries: number) {}

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh insertion order so eviction remains approximately LRU.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number, now = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + ttlMs });
    while (this.entries.size > this.maximumEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
