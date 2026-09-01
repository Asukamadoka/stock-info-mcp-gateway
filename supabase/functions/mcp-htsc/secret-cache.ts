export type SecretLoader = (name: string) => Promise<string>;

type CacheEntry = {
  value: string;
  loadedAt: number;
};

export class SecretCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly loader: SecretLoader,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(name: string): Promise<string> {
    const current = this.entries.get(name);
    const now = this.now();

    if (current && now - current.loadedAt < this.ttlMs) {
      return current.value;
    }

    const value = await this.loader(name);

    this.entries.set(name, {
      value,
      loadedAt: now,
    });

    return value;
  }
}
