export interface SharedCacheStore {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  delete(key: string): void;
  exist?(key: string): boolean;
  clear?(): void;
}

export const DEFAULT_MAX_TEMPORARY_CACHE_KEYS = 10_000;

export class TemporaryCache {
  private store = new Map<string, unknown>();
  private reps = 0;
  private readonly maxKeys: number;
  private resetCountValue = 0;

  constructor(maxKeys: number = DEFAULT_MAX_TEMPORARY_CACHE_KEYS) {
    this.maxKeys = maxKeys;
  }

  get resetCount(): number {
    return this.resetCountValue;
  }

  keys(): readonly string[] {
    return [...this.store.keys()];
  }

  read(key: string): unknown {
    return this.store.get(key);
  }

  write(key: string, value: unknown, callback?: (value: unknown) => void): unknown {
    this.withinKeyCounts(() => {
      this.store.set(key, value);
      this.reps += 1;
      if (callback) callback(value);
    });
    return value;
  }

  fetch(key: string, compute: () => unknown, callback?: (value: unknown) => void): unknown {
    return this.exist(key) ? this.read(key) : this.write(key, compute(), callback);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  reset(): void {
    this.reps = 0;
    this.store = new Map();
    this.resetCountValue += 1;
  }

  purge(select: (key: string, value: unknown) => boolean): number {
    let dropped = 0;
    for (const [key, value] of this.store) {
      if (select(key, value)) {
        this.store.delete(key);
        dropped += 1;
      }
    }
    return dropped;
  }

  exist(key: string): boolean {
    return this.store.has(key);
  }

  hold(): () => void {
    this.holds += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds -= 1;
      if (this.holds === 0 && this.store.size > this.maxKeys) this.reset();
    };
  }

  private holds = 0;

  private withinKeyCounts(body: () => void): void {
    if (this.reps >= this.maxKeys) {
      this.reps = this.store.size;
      if (this.reps > this.maxKeys && this.holds === 0) this.reset();
    }
    body();
  }
}

export class SharedCache {
  private store: SharedCacheStore;
  private readonly database: string;
  private readonly classKey: string;
  private stampValue?: string;
  private prefixValue?: string;
  private static stampRegistry = new Map<string, string>();
  private static stampCounter = 0;

  constructor(opts: { store: SharedCacheStore; database?: string; className?: string }) {
    this.store = opts.store;
    this.database = opts.database ?? "decko";
    this.classKey = (opts.className ?? "Card").replace(/\+/g, "_");
  }

  renew(): void {
    this.stampValue = undefined;
    this.prefixValue = undefined;
  }

  reset(): void {
    this.stampValue = SharedCache.newStamp();
    this.prefixValue = undefined;
    SharedCache.stampRegistry.set(this.stampKey(), this.stampValue);
  }

  annihilate(): void {
    if (typeof (this.store as unknown as { clear?: () => void }).clear === "function") {
      (this.store as unknown as { clear: () => void }).clear();
    }
  }

  stamp(): string {
    if (this.stampValue === undefined) {
      const key = this.stampKey();
      const existing = SharedCache.stampRegistry.get(key);
      this.stampValue = existing ?? SharedCache.newStamp();
      SharedCache.stampRegistry.set(key, this.stampValue);
    }
    return this.stampValue;
  }

  stampKey(): string {
    return `${this.database}-${this.classKey}-stamp`;
  }

  prefix(): string {
    if (this.prefixValue === undefined) {
      this.prefixValue = `${this.database}-${this.classKey}-${this.stamp()}:`;
    }
    return this.prefixValue;
  }

  fullKey(key: string): string {
    return `${this.prefix()}/${key}`;
  }

  read(key: string): unknown {
    return this.store.read(this.fullKey(key));
  }

  write(key: string, value: unknown): void {
    this.store.write(this.fullKey(key), value);
  }

  fetch(key: string, compute: () => unknown): unknown {
    const existing = this.read(key);
    if (existing !== undefined) return existing;
    const computed = compute();
    this.write(key, computed);
    return computed;
  }

  delete(key: string): void {
    this.store.delete(this.fullKey(key));
  }

  exist(key: string): boolean {
    return this.store.exist
      ? this.store.exist(this.fullKey(key))
      : this.store.read(this.fullKey(key)) !== undefined;
  }

  writeAttribute(key: string, attribute: string, value: unknown): unknown {
    const object = this.read(key);
    if (object !== null && typeof object === "object") {
      (object as Record<string, unknown>)[attribute] = value;
      this.write(key, object);
    }
    return value;
  }

  readAttribute(key: string, attribute: string): unknown {
    const object = this.read(key);
    if (object !== null && typeof object === "object") {
      return (object as Record<string, unknown>)[attribute];
    }
    return undefined;
  }

  private static newStamp(): string {
    SharedCache.stampCounter += 1;
    return `stamp-${Date.now()}-${SharedCache.stampCounter}`;
  }
}

export const cacheTallyCounter = new Map<string | undefined, Map<string, number>>();

export class CardCache {
  readonly temp: TemporaryCache;
  readonly shared?: SharedCache;
  afterWriteToTempCache?: (value: unknown) => void;
  private readonly className: string | undefined;

  constructor(
    opts: {
      className?: string;
      maxTemporaryKeys?: number;
      sharedStore?: SharedCacheStore;
      database?: string;
    } = {},
  ) {
    this.className = opts.className;
    this.temp = new TemporaryCache(opts.maxTemporaryKeys);
    this.shared = opts.sharedStore
      ? new SharedCache({
          store: opts.sharedStore,
          database: opts.database,
          className: opts.className,
        })
      : undefined;
  }

  tally(type: string): number {
    let perClass = cacheTallyCounter.get(this.className);
    if (perClass === undefined) {
      perClass = new Map<string, number>();
      cacheTallyCounter.set(this.className, perClass);
    }
    const next = (perClass.get(type) ?? 0) + 1;
    perClass.set(type, next);
    return next;
  }

  read(key: string): unknown {
    return this.temp.fetch(key, () => this.shared?.read(key));
  }

  readMulti(keys: string[]): Map<string, unknown> {
    const found = new Map<string, unknown>();
    if (keys.length <= 1) return found;
    const missing: string[] = [];
    for (const key of keys) {
      if (this.temp.exist(key)) {
        found.set(key, this.temp.read(key));
      } else {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      const fromShared = new Map<string, unknown>();
      for (const key of missing) {
        const value = this.shared ? this.shared.read(key) : undefined;
        if (value !== undefined) {
          fromShared.set(key, value);
          this.temp.write(key, value, this.afterWriteToTempCache);
        }
      }
      for (const [key, value] of fromShared) found.set(key, value);
    }
    return found;
  }

  write(key: string, value: unknown): void {
    this.shared?.write(key, value);
    this.temp.write(key, value, this.afterWriteToTempCache);
  }

  fetch(key: string, compute: () => unknown): unknown {
    return this.temp.fetch(key, () =>
      this.shared ? this.shared.fetch(key, compute) : compute(),
    );
  }

  delete(key: string): void {
    this.shared?.delete(key);
    this.temp.delete(key);
  }

  reset(): void {
    this.shared?.reset();
    this.temp.reset();
  }

  exist(key: string): boolean {
    return this.temp.exist(key) || (this.shared?.exist(key) ?? false);
  }
}

export const cacheByClass = new Map<string, CardCache>();

export let cacheNoRenewal = false;
export function setCacheNoRenewal(value: boolean): void {
  cacheNoRenewal = value;
}

let cacheResetOtherHook: (() => void) | undefined;
export function setCacheResetOtherHook(hook: () => void): void {
  cacheResetOtherHook = hook;
}

export function cacheForClass(
  className: string,
  opts: { sharedStore?: SharedCacheStore; database?: string; maxTemporaryKeys?: number } = {},
): CardCache {
  if (!className) throw new TypeError("nil klass (class_methods.rb:17)");
  let cache = cacheByClass.get(className);
  if (cache === undefined) {
    cache = new CardCache({
      className,
      sharedStore: opts.sharedStore,
      database: opts.database,
      maxTemporaryKeys: opts.maxTemporaryKeys,
    });
    cacheByClass.set(className, cache);
  }
  return cache;
}

export function renewCaches(): void {
  cacheTallyCounter.clear();
  if (cacheNoRenewal) return;
  renewSharedCache();
  for (const cache of cacheByClass.values()) {
    cache.temp.reset();
    cache.shared?.renew();
  }
}

export function renewSharedCache(): void {
  for (const cache of cacheByClass.values()) cache.shared?.renew();
}

export function resetCaches(): void {
  resetSharedCaches();
  resetTempCaches();
}

export function resetAllCaches(): void {
  resetSharedCaches();
  resetTempCaches();
  resetOtherCaches();
}

export function resetGlobalCaches(): void {
  for (const cache of cacheByClass.values()) {
    cache.temp.reset();
    cache.shared?.annihilate();
  }
  resetOtherCaches();
}

export function resetSharedCaches(): void {
  for (const cache of cacheByClass.values()) cache.shared?.reset();
}

export function resetTempCaches(): void {
  for (const cache of cacheByClass.values()) cache.temp.reset();
}

export function resetOtherCaches(): void {
  cacheResetOtherHook?.();
}

export function sharedCacheOn(): void {
  cacheByClass.clear();
}

export function cacheTallies(): string {
  const total = cacheTallyTotal();
  const parts: string[] = [];
  for (const [klass, perType] of cacheTallyCounter) {
    const hashBody = [...perType.entries()]
      .map(([type, count]) => `"${type}"=>${count}`)
      .join(", ");
    parts.push(`${klass ?? ""}={${hashBody}} `);
  }
  return `${total} Cache calls (${parts.join("")})`;
}

export function cacheTallyTotal(): number {
  let total = 0;
  for (const perType of cacheTallyCounter.values()) {
    for (const count of perType.values()) total += count;
  }
  return total;
}
