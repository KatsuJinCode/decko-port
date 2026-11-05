const payloadPrototypes = new Set<unknown>([Object.prototype, null, Array.prototype, Map.prototype,
  Set.prototype, ArrayBuffer.prototype, Uint8Array.prototype, DataView.prototype]);

export function estimateRetainedPayload(root: unknown, limit: number): number {
  const seen = new WeakSet<object>();
  let bytes = 0, steps = 0;
  const add = (n: number) => { if (!Number.isFinite(n) || n < 0) throw 0; bytes += n; if (bytes > limit) throw 0; };
  const visit = (value: unknown, depth: number): void => {
    if (++steps > 100_000 || depth > 64) throw 0;
    if (typeof value === "string") { add(64 + value.length * 2); return; }
    if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") { add(16); return; }
    if (typeof value === "bigint") { add(64 + String(value).length * 2); return; }
    if (typeof value !== "object") throw 0;
    if (seen.has(value)) return;
    seen.add(value);
    add(128);
    const prototype = Object.getPrototypeOf(value);
    if (!payloadPrototypes.has(prototype)) throw 0;
    if ((ArrayBuffer.isView(value) || value instanceof ArrayBuffer) &&
      (Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteLength"))) throw 0;
    if (ArrayBuffer.isView(value)) { add(value.byteLength * 64); visit(value.buffer, depth + 1); }
    else if (value instanceof ArrayBuffer) add(value.byteLength);
    else if (Array.isArray(value)) add(value.length * 24);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw 0;
      if (value instanceof Map || value instanceof Set) throw 0;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor)) throw 0;
      add(64 + key.length * 2);
      visit(descriptor.value, depth + 1);
    }
    if (value instanceof Map) {
      add(value.size * 96);
      for (const [key, item] of value) { visit(key, depth + 1); visit(item, depth + 1); }
    } else if (value instanceof Set) {
      add(value.size * 64);
      for (const item of value) visit(item, depth + 1);
    }
  };
  try { visit(root, 0); return bytes; } catch { return Infinity; }
}

export class RetainedPages<T extends { stamp: number }> {
  private readonly entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;
  constructor(
    private readonly close: (value: T) => void,
    private readonly payload: (value: T) => unknown,
    private readonly maxBytes = 8 * 1024 * 1024,
    private readonly maxEntries = 8,
  ) {}
  take(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    return entry.value;
  }
  put(key: string, value: T): void {
    for (const entry of this.entries.values()) {
      if (entry.value.stamp > value.stamp) { this.close(value); return; }
    }
    for (const [oldKey, entry] of this.entries) {
      if (entry.value.stamp !== value.stamp || oldKey === key) this.drop(oldKey);
    }
    let bytes: number;
    try { bytes = estimateRetainedPayload([key, this.payload(value)], this.maxBytes); }
    catch { bytes = Infinity; }
    if (bytes > this.maxBytes || this.maxEntries < 1) { this.close(value); return; }
    while (this.entries.size && (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
      this.drop(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
  }
  private drop(key: string): void { const value = this.take(key); if (value) this.close(value); }
  clear(): void { for (const key of this.entries.keys()) this.drop(key); }
}

export function retainedPagesDiagnostics<T extends { stamp: number }>(cache: RetainedPages<T>): { entries: number; estimatedBytes: number } {
  const state = cache as unknown as { entries: Map<string, unknown>; bytes: number };
  return { entries: state.entries.size, estimatedBytes: state.bytes };
}
