import type { Connection, ConnectionOptions, ResultSetHeader } from "mysql2/promise";
import { createConnection } from "mysql2/promise";
import {
  DatabaseOutcomeUnknownError,
  TransactionGate,
  rowIdOrOmit,
  type SQLDatabaseDriver,
  type SQLQueryResult,
  type SQLStatement,
  type SQLTransactionGuarantee,
} from "../driver.js";

export interface MysqlDriverOptions {
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly password?: string;
  readonly database: string;
}

export const MYSQL_SESSION_SETTINGS = [
  "SET SESSION sql_mode = 'PIPES_AS_CONCAT,ANSI_QUOTES,STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'",
  "SET SESSION time_zone = '+00:00'",
];

export function sqliteToMysql(sql: string): string {
  const lexical = sqlCommentsAsWhitespace(sql);
  const withSequence = lexical.replace(
    /SELECT\s+seq\s+FROM\s+sqlite_sequence\s+WHERE\s+name\s*=\s*'([^']+)'/gi,
    "SELECT AUTO_INCREMENT - 1 AS seq FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '$1'",
  );
  const translated = outsideQuotes(withSequence, (part) =>
    scalarMinMax(part)
      .replace(/(?<![.\w"`])(?<!(?:PRIMARY|UNIQUE|FOREIGN|DUPLICATE)\s+)\b(key)\b(?![\w"`])(?!\s*(?:[`(]|$))/gi, '"$1"')
      .replace(/\s+COLLATE\s+NOCASE\b/gi, "")
      .replace(/\bAS\s+(?:NOT\s+)?MATERIALIZED\s*\(/gi, "AS (")
      .replace(/\bINSERT\s+OR\s+IGNORE\b/gi, "INSERT IGNORE")
      .replace(/\bINSERT\s+OR\s+REPLACE\b/gi, "REPLACE")
      .replace(/\bAUTOINCREMENT\b/gi, "AUTO_INCREMENT")
      .replace(/\s+AS\s+TEXT\s*\)/gi, " AS CHAR(10000))")
      .replace(/\s+AS\s+INTEGER\s*\)/gi, " AS SIGNED)")
      .replace(/\bLIMIT\s+-1\b/gi, "LIMIT 18446744073709551615"),
  );
  const withThrottleUpsert = /^\s*INSERT\s+INTO\s+auth_signin_throttle\b/i.test(translated)
    ? outsideQuotes(translated, (part) => part.replace(/\bON\s+CONFLICT\s*\(\s*scope\s*\)\s+DO\s+UPDATE\s+SET\b/i, "ON DUPLICATE KEY UPDATE"))
    : translated;
  return /^\s*CREATE\s+TABLE\b/i.test(withThrottleUpsert)
    ? boundKeyedTextColumns(typeUntypedColumns(withThrottleUpsert))
    : withThrottleUpsert;
}

function boundKeyedTextColumns(sql: string): string {
  const syntax = maskSqlQuotedAndComments(sql);
  const open = syntax.indexOf("(");
  if (open < 0) return sql;
  let depth = 0;
  let start = open + 1;
  let out = sql.slice(0, open + 1);
  const throttle = /^\s*CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:auth_signin_throttle|"auth_signin_throttle"|`auth_signin_throttle`)\s*\(/i.test(sql);
  const flush = (end: number) => {
    out += boundKeyedTextColumn(sql.slice(start, end), throttle);
  };
  for (let i = open + 1; i < sql.length; i++) {
    const ch = syntax[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) {
        flush(i);
        out += sql.slice(i);
        return out;
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      flush(i);
      out += ",";
      start = i + 1;
    }
  }
  return sql;
}

function boundKeyedTextColumn(definition: string, throttle: boolean): string {
  const match = /^(\s*(?:"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]+\]|[A-Za-z_]\w*)\s+)(TEXT)(\s*\([^)]*\))?(\s+.*)$/is.exec(definition);
  if (match === null) return definition;
  const tail = match[4] ?? "";
  if (!/\bPRIMARY\s+KEY\b|\bUNIQUE\b/i.test(maskSqlQuotedAndComments(tail))) return definition;
  const column = match[1]!.trim().replace(/^["`\[]|["`\]]$/g, "").toLowerCase();
  const capacity = throttle && column === "scope" ? 768 : 255;
  return `${match[1]}VARCHAR(${capacity})${tail}`;
}

function sqlCommentsAsWhitespace(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?\*\//g,
    part => part.startsWith("--") || part.startsWith("/*") ? part.replace(/[^\r\n]/g, " ") : part);
}

function maskSqlQuotedAndComments(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (part) => part.replace(/[^\r\n]/g, " "));
}

function scalarMinMax(text: string): string {
  return text.replace(/\b(MAX|MIN)\s*\(/gi, (match, fn: string, offset: number) => {
    let depth = 0;
    let topLevelComma = false;
    for (let i = offset + match.length - 1; i < text.length; i++) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      } else if (ch === "," && depth === 1) topLevelComma = true;
    }
    if (!topLevelComma) return match;
    return fn.toUpperCase() === "MAX" ? "GREATEST(" : "LEAST(";
  });
}

const CONSTRAINT_WORDS = new Set(["PRIMARY", "UNIQUE", "FOREIGN", "KEY", "INDEX", "CONSTRAINT", "CHECK", "FULLTEXT", "SPATIAL"]);

function typeUntypedColumns(sql: string): string {
  const open = sql.indexOf("(");
  if (open < 0) return sql;
  let depth = 0;
  let quote: string | undefined;
  let start = open + 1;
  let out = sql.slice(0, open + 1);
  const flush = (end: number) => {
    const def = sql.slice(start, end);
    const bare = /^(\s*)("?)([A-Za-z_]\w*)\2(\s*)$/.exec(def);
    if (bare && !CONSTRAINT_WORDS.has(bare[3].toUpperCase())) out += `${bare[1]}${bare[2]}${bare[3]}${bare[2]} TEXT${bare[4]}`;
    else out += def;
  };
  for (let i = open + 1; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) {
        flush(i);
        out += sql.slice(i);
        return out;
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      flush(i);
      out += ",";
      start = i + 1;
    }
  }
  return sql;
}

function outsideQuotes(sql: string, rewrite: (part: string) => string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const next = sql.slice(i).search(/['"`]/);
    if (next < 0) {
      out += rewrite(sql.slice(i));
      break;
    }
    out += rewrite(sql.slice(i, i + next));
    const q = sql[i + next];
    let j = i + next + 1;
    while (j < sql.length) {
      if (sql[j] === q) {
        if (sql[j + 1] === q) j += 2;
        else break;
      } else j++;
    }
    out += sql.slice(i + next, j + 1);
    i = j + 1;
  }
  return out;
}

const toParam = (value: unknown): unknown => (typeof value === "bigint" ? value.toString() : value);

export class MysqlDriver implements SQLDatabaseDriver {
  readonly dialect = "mysql";

  private constructor(private readonly conn: Connection) {}

  static async connect(options: MysqlDriverOptions): Promise<MysqlDriver> {
    const config: ConnectionOptions = {
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 3306,
      user: options.user ?? "root",
      password: options.password,
      database: options.database,
      dateStrings: true,
      supportBigNumbers: true,
      charset: "utf8mb4",
    };
    const conn = await createConnection(config);
    for (const sql of MYSQL_SESSION_SETTINGS) await conn.query(sql);
    return new MysqlDriver(conn);
  }

  private inTransaction = false;
  private closed = false;
  private terminalError: DatabaseOutcomeUnknownError | undefined;
  private readonly gate = new TransactionGate();

  readonly transactionGuarantee: SQLTransactionGuarantee = {
    mechanism: "native",
    atomicOnFailure: true,
    crashRecovery: "database",
    readersIsolated: true,
    serializedWriters: "driver-object",
    atomicBatch: true,
    idsReusedAfterRollback: false,
  };

  private lastRowId: number | undefined;

  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    this.assertUsable();
    const translated = sqliteToMysql(sql).replace(
      /last_insert_rowid\(\)/gi,
      this.lastRowId === undefined ? "NULL" : String(this.lastRowId),
    );
    const [result] = await this.conn.query({ sql: translated, values: params.map(toParam) });
    if (Array.isArray(result)) return { rows: result as T[], rowsAffected: 0 };
    const header = result as ResultSetHeader;
    if (header.insertId > 0) this.lastRowId = header.insertId;
    return { rows: [], rowsAffected: header.affectedRows, lastInsertRowId: rowIdOrOmit(header.insertId) };
  }

  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    this.assertUsable();
    if (statements.length === 0) return [];
    if (this.inTransaction) return this.runAll(statements);
    return this.transaction(() => this.runAll(statements));
  }

  async transaction<R>(work: () => Promise<R>): Promise<R> {
    this.assertUsable();
    if (this.inTransaction) return work();
    return this.gate.run(async () => {
      this.assertUsable();
      await this.conn.query("START TRANSACTION");
      this.inTransaction = true;
      try {
        let result: R;
        try { result = await work(); }
        catch (error) {
          try { await this.conn.query("ROLLBACK"); }
          catch (rollbackError) { throw await this.retireAfterFailedRollback("rollback", error, rollbackError); }
          throw error;
        }
        try { await this.conn.query("COMMIT"); }
        catch (error) {
          try { await this.conn.query("ROLLBACK"); }
          catch (rollbackError) { throw await this.retireAfterFailedRollback("commit", error, rollbackError); }
          throw new DatabaseOutcomeUnknownError("commit", error);
        }
        return result;
      } finally {
        this.inTransaction = false;
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.conn.end();
    this.closed = true;
  }

  private assertUsable(): void {
    if (this.terminalError !== undefined) throw this.terminalError;
    if (this.closed) throw new Error("MySQL driver is closed");
  }

  private async retireAfterFailedRollback(operation: "commit" | "rollback", error: unknown, rollbackError: unknown): Promise<DatabaseOutcomeUnknownError> {
    const errors = [error, rollbackError];
    const message = "MySQL terminal cleanup failed; this driver cannot be reused";
    this.terminalError = new DatabaseOutcomeUnknownError(operation, new AggregateError(errors, message));
    try { await this.close(); }
    catch (closeError) { errors.push(closeError); }
    this.terminalError = new DatabaseOutcomeUnknownError(operation, new AggregateError(errors, message));
    return this.terminalError;
  }

  private async runAll(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    const out: SQLQueryResult[] = [];
    for (const s of statements) out.push(await this.query(s.sql, s.params));
    return out;
  }
}
