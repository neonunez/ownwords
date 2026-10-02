/** Short-lived, client-instance-only reads. Nothing is persisted or replayed offline. */
export class RecentReads {
  private readonly entries = new Map<
    string,
    { value?: unknown; expiresAt: number; pending?: Promise<unknown> }
  >();
  constructor(private readonly now: () => number = Date.now) {}

  clear(matches: (key: string) => boolean = () => true): void {
    for (const key of this.entries.keys())
      if (matches(key)) this.entries.delete(key);
  }

  async read<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing?.pending) return structuredClone(await existing.pending) as T;
    if (existing && existing.expiresAt > this.now())
      return structuredClone(existing.value) as T;
    for (const [cachedKey, slot] of this.entries) {
      if (!slot.pending && slot.expiresAt <= this.now())
        this.entries.delete(cachedKey);
    }
    // Rapid searches must not grow a long-lived tab's memory without a bound.
    while (this.entries.size >= 64)
      this.entries.delete(this.entries.keys().next().value!);
    const slot: {
      value?: unknown;
      expiresAt: number;
      pending?: Promise<unknown>;
    } = { expiresAt: 0 };
    const pending = load().then((value) => {
      // A write or account change can evict this slot while its read is pending.
      // Such an answer must never repopulate the next account/generation's cache.
      if (this.entries.get(key) === slot) {
        slot.value = structuredClone(value);
        slot.expiresAt = this.now() + ttl;
        delete slot.pending;
      }
      return value;
    });
    slot.pending = pending;
    this.entries.set(key, slot);
    try {
      return structuredClone(await pending);
    } catch (error) {
      if (this.entries.get(key) === slot) this.entries.delete(key);
      throw error;
    }
  }
}
