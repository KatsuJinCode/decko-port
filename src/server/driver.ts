export interface SQLQueryResult<T = unknown> {
  rows: T[];
  rowsAffected: number;
  lastInsertRowId?: number | bigint;
  rowsRead?: number;
  rowsWritten?: number;
}

export interface SQLStatement {
  sql: string;
  params: unknown[];
  requireStandaloneTransaction?: true;
}

export class DatabaseOutcomeUnknownError extends Error {
  readonly code = "database-outcome-unknown";
  readonly outcome = "unknown";
  readonly retrySafe = false;

  constructor(readonly operation: "statement" | "commit" | "rollback", cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Database ${operation} outcome is unknown after a transport reset or unconfirmed acknowledgement; reconcile persisted state before retrying: ${detail}`, { cause });
    this.name = "DatabaseOutcomeUnknownError";
  }
}

export interface SQLDatabaseDriver {
  readonly cqlRegexpSemantics?: "canonical" | "incompatible";
  query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>>;
  batch(statements: SQLStatement[]): Promise<SQLQueryResult[]>;
  transaction?<R>(work: () => Promise<R>): Promise<R>;
  readonly transactionGuarantee?: SQLTransactionGuarantee;
  prefetchReads?(statements: SQLStatement[]): Promise<PrefetchOutcome[]>;
  readPhase?<R>(work: () => Promise<R>): Promise<R>;
}

export interface PrefetchOutcome {
  result: SQLQueryResult | undefined;
  unverified: boolean;
}

export interface SQLTransactionGuarantee {
  readonly mechanism: "native" | "compensating";
  readonly atomicOnFailure: true;
  readonly crashRecovery: "database" | "next-transaction" | "next-transaction-or-read";
  readonly readersIsolated: boolean;
  readonly serializedWriters: "driver-object" | "database";
  readonly atomicBatch: boolean;
  readonly standaloneBatchAdmission?: true;
  readonly idsReusedAfterRollback: boolean;
}

export type TransactionalSQLDatabaseDriver = SQLDatabaseDriver &
  Required<Pick<SQLDatabaseDriver, "transaction" | "transactionGuarantee">>;

export function supportsTransactions(driver: SQLDatabaseDriver): driver is TransactionalSQLDatabaseDriver {
  return typeof driver.transaction === "function" && driver.transactionGuarantee !== undefined;
}

export class TransactionLockTimeoutError extends Error {
  constructor(waitedMs: number) {
    super(`timed out after ${waitedMs} ms waiting for an earlier transaction to finish`);
    this.name = "TransactionLockTimeoutError";
  }
}

export function isDatabaseBusyError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
  return /database is locked|SQLITE_BUSY/i.test(message);
}

export async function retryWhileBusy<R>(
  open: () => Promise<R>,
  timeoutMs: number = DEFAULT_TRANSACTION_LOCK_TIMEOUT_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  isBusy: (error: unknown) => boolean = isDatabaseBusyError,
): Promise<R> {
  const started = Date.now();
  let delay = 5;
  for (;;) {
    try {
      return await open();
    } catch (error) {
      if (!isBusy(error)) throw error;
      if (Date.now() - started >= timeoutMs) throw new TransactionLockTimeoutError(timeoutMs);
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 250);
  }
}

export const DEFAULT_TRANSACTION_LOCK_TIMEOUT_MS = 30_000;

export class TransactionGate {
  private tail: Promise<void> = Promise.resolve();
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_TRANSACTION_LOCK_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  async run<R>(work: () => Promise<R>): Promise<R> {
    const previous = this.tail;
    let release!: () => void;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = previous.then(() => mine);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        previous,
        new Promise<void>((_, reject) => {
          timer = setTimeout(() => reject(new TransactionLockTimeoutError(this.timeoutMs)), this.timeoutMs);
        }),
      ]);
    } catch (error) {
      void previous.then(release);
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    try {
      return await work();
    } finally {
      release();
    }
  }
}

export function rowIdOrOmit(lastRowId: number | bigint | undefined): number | bigint | undefined {
  if (lastRowId === undefined) return undefined;
  return BigInt(lastRowId) > 0n ? lastRowId : undefined;
}
