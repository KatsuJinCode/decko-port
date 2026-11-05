import type { NameEnvironment } from "./name/environment.js";

export interface NameScopeState {
  depth: number;
  markMemo?: Map<string, unknown>;
  parseMemo?: Map<string, unknown>;
  scopedMemos?: WeakMap<object, Map<string, unknown>>;
}

export interface RequestContext {
  environment: NameEnvironment | undefined;
  readonly nameScope: NameScopeState;
  bootBundle: unknown;
}

interface AlsLike<T> {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
}

function findAsyncLocalStorage(): (new () => AlsLike<RequestContext>) | undefined {
  const g = globalThis as {
    AsyncLocalStorage?: new () => AlsLike<RequestContext>;
    process?: { getBuiltinModule?: (id: string) => { AsyncLocalStorage?: new () => AlsLike<RequestContext> } | undefined };
  };
  if (typeof g.AsyncLocalStorage === "function") return g.AsyncLocalStorage;
  try {
    const mod = g.process?.getBuiltinModule?.("node:async_hooks");
    if (typeof mod?.AsyncLocalStorage === "function") return mod.AsyncLocalStorage;
  } catch {
  }
  return undefined;
}

const Als = findAsyncLocalStorage();
let storage: AlsLike<RequestContext> | undefined = Als === undefined ? undefined : new Als();
export type RequestContextStorageConstructor = new () => AlsLike<RequestContext>;

export function installAsyncLocalStorage(Als: RequestContextStorageConstructor): void {
  if (storage === undefined) storage = new Als();
}

export function requestContextAvailable(): boolean {
  return storage !== undefined;
}

export function currentRequestContext(): RequestContext | undefined {
  return storage?.getStore();
}

export function runInRequestContext<T>(environment: NameEnvironment | undefined, fn: () => Promise<T>): Promise<T> {
  if (storage === undefined) return fn();
  const ctx: RequestContext = { environment, nameScope: { depth: 0 }, bootBundle: undefined };
  return storage.run(ctx, fn);
}
