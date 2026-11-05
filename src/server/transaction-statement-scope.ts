interface TransactionScope {
  active: boolean;
}

interface AlsLike<T> {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
}

function findAsyncLocalStorage(): (new () => AlsLike<TransactionScope>) | undefined {
  const g = globalThis as {
    AsyncLocalStorage?: new () => AlsLike<TransactionScope>;
    process?: { getBuiltinModule?: (id: string) => { AsyncLocalStorage?: new () => AlsLike<TransactionScope> } | undefined };
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
const storage: AlsLike<TransactionScope> | undefined = Als === undefined ? undefined : new Als();

export function inTransactionStatementScope(): boolean | undefined {
  if (storage === undefined) return undefined;
  return storage.getStore()?.active === true;
}

export function runInTransactionStatementScope<T>(fn: () => Promise<T>): Promise<T> {
  if (storage === undefined) return fn();
  const scope = { active: true };
  return storage.run(scope, async () => {
    try { return await fn(); }
    finally { scope.active = false; }
  });
}
