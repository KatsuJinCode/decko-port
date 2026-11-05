import type { SQLDatabaseDriver, SQLQueryResult, SQLStatement, SQLTransactionGuarantee } from "../driver.js";
import { DatabaseOutcomeUnknownError, TransactionGate } from "../driver.js";

export interface PostgresClientLike {
  query(text: string, params?: unknown[]): Promise<{
    rows: Record<string, unknown>[];
    rowCount?: number | null;
    affectedRows?: number;
    command?: string;
    fields?: Array<{ name: string; dataTypeID: number }>;
  }>;
  exec?(text: string): Promise<unknown>;
  end?(): Promise<void>;
  close?(): Promise<void>;
}

export interface PostgresDriverOptions {
  client: PostgresClientLike;
  ownsClient?: boolean;
}

const GUARANTEE: SQLTransactionGuarantee = {
  mechanism: "native",
  atomicOnFailure: true,
  crashRecovery: "database",
  readersIsolated: true,
  serializedWriters: "driver-object",
  atomicBatch: false,
  idsReusedAfterRollback: false,
};

export class PostgresDriver implements SQLDatabaseDriver {
  readonly transactionGuarantee = GUARANTEE;
  private readonly client: PostgresClientLike;
  private readonly ownsClient: boolean;
  private readonly gate = new TransactionGate();
  private readonly sequencedTables = new Map<string, boolean>();
  private compat: Promise<void> | undefined;
  private schemaTypeCache: SchemaTypes | undefined;
  private schemaTypesStale = true;
  private inTransaction = false;
  private closed = false;
  private terminalError: DatabaseOutcomeUnknownError | undefined;
  private savepoint = 0;
  private lastRowId: number | undefined;

  constructor(options: PostgresDriverOptions) {
    this.client = options.client;
    this.ownsClient = options.ownsClient ?? true;
  }

  async query<T = unknown>(sql: string, params: unknown[]): Promise<SQLQueryResult<T>> {
    this.assertUsable();
    await this.ensureCompat();
    const types = /\bWITH\s+RECURSIVE\b/i.test(sql) ? await this.schemaTypes() : undefined;
    const t = translateSqliteToPostgres(sql, types);
    if (/^\s*(CREATE|ALTER|DROP)\b/i.test(sql)) this.schemaTypesStale = true;
    if (t.skip) return { rows: [], rowsAffected: 0 };
    const sp = this.inTransaction ? `decko_sp_${++this.savepoint}` : undefined;
    if (sp !== undefined) await this.client.query(`SAVEPOINT ${sp}`);
    let res: Awaited<ReturnType<PostgresClientLike["query"]>>;
    try {
      if (t.prelude !== undefined) await this.client.query(t.prelude, []);
      const text = t.sql.includes(LAST_ROWID_MARKER)
        ? t.sql.split(LAST_ROWID_MARKER).join(this.lastRowId === undefined ? "NULL::integer" : `${this.lastRowId}`)
        : t.sql;
      res = await this.client.query(text, params.map(toPgParam));
    } catch (error) {
      if (sp !== undefined) await this.client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => undefined);
      if (error instanceof Error) error.message += ` [postgres: ${t.sql.slice(0, 600)}]`;
      throw error;
    }
    if (sp !== undefined) await this.client.query(`RELEASE SAVEPOINT ${sp}`);
    const jsonColumns = new Set((res.fields ?? []).filter((f) => f.dataTypeID === 114 || f.dataTypeID === 3802).map((f) => f.name));
    const rows = res.rows.map((r) => normalizeRow(r, jsonColumns)) as T[];
    const rowsAffected = Number(res.affectedRows ?? res.rowCount ?? 0);
    const result: SQLQueryResult<T> = { rows: t.returningId ? [] : rows, rowsAffected };
    if (t.insertTable !== undefined) {
      if (t.returningId && rows.length > 0) {
        const id = (rows[rows.length - 1] as Record<string, unknown>).id;
        if (id !== undefined && id !== null) {
          result.lastInsertRowId = Number(id);
          this.lastRowId = Number(id);
        }
      }
      if (t.explicitId) await this.advanceSequence(t.insertTable);
    }
    for (const extra of t.postlude ?? []) await this.client.query(extra, []);
    return result;
  }

  async batch(statements: SQLStatement[]): Promise<SQLQueryResult[]> {
    this.assertUsable();
    const out: SQLQueryResult[] = [];
    for (const s of statements) out.push(await this.query(s.sql, s.params));
    return out;
  }

  async transaction<R>(work: () => Promise<R>): Promise<R> {
    this.assertUsable();
    return this.gate.run(async () => {
      this.assertUsable();
      await this.ensureCompat();
      await this.client.query("BEGIN");
      this.inTransaction = true;
      try {
        let value: R;
        try { value = await work(); }
        catch (error) {
          try { await this.client.query("ROLLBACK"); }
          catch (rollbackError) { throw await this.retireAfterFailedRollback("rollback", error, rollbackError); }
          throw error;
        }
        try { await this.client.query("COMMIT"); }
        catch (error) {
          try { await this.client.query("ROLLBACK"); }
          catch (rollbackError) { throw await this.retireAfterFailedRollback("commit", error, rollbackError); }
          throw new DatabaseOutcomeUnknownError("commit", error);
        }
        return value;
      } finally {
        this.inTransaction = false;
      }
    });
  }

  private async schemaTypes(): Promise<SchemaTypes> {
    if (this.schemaTypeCache !== undefined && !this.schemaTypesStale) return this.schemaTypeCache;
    const res = await this.client.query(
      `SELECT table_name::text AS table_name, column_name::text AS column_name, data_type::text AS data_type ` +
        `FROM information_schema.columns WHERE table_schema = 'public'`,
      [],
    );
    const types: SchemaTypes = new Map();
    for (const row of res.rows) {
      const table = String(row.table_name);
      let columns = types.get(table);
      if (columns === undefined) types.set(table, (columns = new Map()));
      columns.set(String(row.column_name), String(row.data_type));
    }
    this.schemaTypeCache = types;
    this.schemaTypesStale = false;
    return types;
  }

  private ensureCompat(): Promise<void> {
    this.compat ??= (async () => {
      if (this.client.exec) await this.client.exec(SQLITE_COMPAT_SQL);
      else await this.client.query(SQLITE_COMPAT_SQL);
      await this.client.query(`SET search_path TO public, decko_sqlite, pg_catalog`);
    })();
    return this.compat;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.ownsClient) {
      if (this.client.close) await this.client.close();
      else if (this.client.end) await this.client.end();
    }
    this.closed = true;
  }

  private assertUsable(): void {
    if (this.terminalError !== undefined) throw this.terminalError;
    if (this.closed) throw new Error("PostgreSQL driver is closed");
  }

  private async retireAfterFailedRollback(operation: "commit" | "rollback", error: unknown, rollbackError: unknown): Promise<DatabaseOutcomeUnknownError> {
    const errors = [error, rollbackError];
    const message = "PostgreSQL terminal cleanup failed; this driver cannot be reused";
    this.terminalError = new DatabaseOutcomeUnknownError(operation, new AggregateError(errors, message));
    if (this.ownsClient && (this.client.close !== undefined || this.client.end !== undefined)) {
      try { await this.close(); }
      catch (closeError) { errors.push(closeError); }
    } else {
      errors.push(new Error("The connection owner must release the PostgreSQL client; this driver has no shutdown authority or capability"));
    }
    this.terminalError = new DatabaseOutcomeUnknownError(operation, new AggregateError(errors, message));
    return this.terminalError;
  }

  private async advanceSequence(table: string): Promise<void> {
    if (this.sequencedTables.get(table) === false) return;
    const seq = await this.client.query(`SELECT pg_get_serial_sequence($1, 'id') AS s`, [quoteIdent(table)]);
    const name = seq.rows[0]?.s as string | null | undefined;
    if (!name) {
      this.sequencedTables.set(table, false);
      return;
    }
    this.sequencedTables.set(table, true);
    await this.client.query(
      `SELECT setval($1, GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${quoteIdent(table)}), (SELECT last_value FROM ${name})), true)`,
      [name],
    );
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function toPgParam(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return value.toString();
  return value;
}

function normalizeRow(row: Record<string, unknown>, jsonColumns: Set<string>): Record<string, unknown> {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (jsonColumns.has(k) && v !== null && typeof v !== "string") row[k] = JSON.stringify(v);
    else if (typeof v === "boolean") row[k] = v ? 1 : 0;
    else if (typeof v === "bigint") row[k] = Number(v);
  }
  return row;
}

export const LAST_ROWID_MARKER = "decko_last_insert_rowid()";

export interface TranslatedStatement {
  sql: string;
  postlude?: string[];
  prelude?: string;
  skip?: boolean;
  insertTable?: string;
  explicitId?: boolean;
  returningId?: boolean;
}

interface Token {
  kind: "word" | "string" | "ident" | "param" | "other" | "space";
  text: string;
}

function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      out.push({ kind: "string", text: sql.slice(i, j + 1) });
      i = j + 1;
    } else if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      const j = sql.indexOf(close, i + 1);
      const inner = sql.slice(i + 1, j < 0 ? sql.length : j);
      out.push({ kind: "ident", text: `"${inner.replace(/"/g, '""')}"` });
      i = j < 0 ? sql.length : j + 1;
    } else if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      i = j < 0 ? sql.length : j + 1;
      out.push({ kind: "space", text: " " });
    } else if (c === "/" && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i + 2);
      i = j < 0 ? sql.length : j + 2;
      out.push({ kind: "space", text: " " });
    } else if (c === "?") {
      let j = i + 1;
      while (j < sql.length && /[0-9]/.test(sql[j]!)) j++;
      out.push({ kind: "param", text: sql.slice(i, j) });
      i = j;
    } else if (/\s/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /\s/.test(sql[j]!)) j++;
      out.push({ kind: "space", text: " " });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j]!)) j++;
      out.push({ kind: "word", text: sql.slice(i, j) });
      i = j;
    } else {
      out.push({ kind: "other", text: c });
      i++;
    }
  }
  return out;
}

const isWord = (t: Token | undefined, w: string): boolean => t !== undefined && t.kind === "word" && t.text.toUpperCase() === w;

function next(tokens: Token[], i: number): number {
  let j = i;
  while (j < tokens.length && tokens[j]!.kind === "space") j++;
  return j;
}

function prev(tokens: Token[], i: number): number {
  let j = i;
  while (j >= 0 && tokens[j]!.kind === "space") j--;
  return j;
}

function unquote(t: Token): string {
  return t.kind === "ident" ? t.text.slice(1, -1).replace(/""/g, '"') : t.text;
}

function upsertTargetTable(tokens: Token[]): string | undefined {
  let hasConflict = false;
  for (const token of tokens) {
    if (isWord(token, "CONFLICT")) hasConflict = true;
  }
  if (!hasConflict) return undefined;
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], "INSERT")) continue;
    const into = next(tokens, i + 1);
    if (!isWord(tokens[into], "INTO")) continue;
    let name = next(tokens, into + 1);
    let table = tokens[name];
    if (table === undefined) continue;
    while (tokens[next(tokens, name + 1)]?.text === ".") {
      name = next(tokens, next(tokens, name + 1) + 1);
      table = tokens[name];
      if (table === undefined) return undefined;
    }
    const alias = next(tokens, name + 1);
    if (isWord(tokens[alias], "AS")) table = tokens[next(tokens, alias + 1)];
    if (table === undefined) return undefined;
    return table.kind === "word" ? table.text.toLowerCase() : unquote(table);
  }
  return undefined;
}

const SET_CLAUSE_KEYWORDS = new Set([
  "AND", "AS", "BETWEEN", "CASE", "DEFAULT", "DISTINCT", "ELSE", "END", "ESCAPE",
  "FALSE", "IN", "IS", "LIKE", "NOT", "NULL", "OR", "THEN", "TRUE", "WHEN", "WHERE", "COLLATE",
  "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP",
]);

function qualifyUpsertSetReferences(tokens: Token[], table: string): Token[] {
  let set = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], "DO")) continue;
    const update = next(tokens, i + 1);
    if (!isWord(tokens[update], "UPDATE")) continue;
    const after = next(tokens, update + 1);
    if (isWord(tokens[after], "SET")) set = after;
  }
  if (set < 0) return tokens;

  let end = tokens.length;
  let depth = 0;
  for (let i = set + 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind === "other") {
      if (token.text === "(") depth++;
      else if (token.text === ")") {
        if (depth === 0) { end = i; break; }
        depth--;
      }
    }
    if (depth === 0 && isWord(token, "RETURNING")) { end = i; break; }
  }

  const targets = new Set<number>();
  let assignmentStart = set + 1, lookingForAssignment = true, inWhere = false;
  depth = 0;
  for (let i = set + 1; i < end; i++) {
    const token = tokens[i]!;
    if (token.text === "(") depth++;
    else if (token.text === ")") depth--;
    if (depth !== 0) continue;
    if (isWord(token, "WHERE")) { inWhere = true; lookingForAssignment = false; }
    else if (token.text === "," && !inWhere) { assignmentStart = i + 1; lookingForAssignment = true; }
    else if (token.text === "=" && lookingForAssignment) {
      for (let j = assignmentStart; j < i; j++) targets.add(j);
      lookingForAssignment = false;
    }
  }
  const qualifier = /^[a-z_][a-z0-9_]*$/.test(table) ? table : `"${table.replace(/"/g, '""')}"`;
  const out = tokens.slice();
  let expressionDepth = 0, castTypeDepth = -1, subqueryDepth = -1;
  for (let i = set + 1; i < end; i++) {
    const token = out[i]!;
    if (token.text === "(") {
      expressionDepth++;
      const first = out[next(out, i + 1)];
      if (subqueryDepth < 0 && (isWord(first, "SELECT") || isWord(first, "WITH") || isWord(first, "VALUES"))) {
        subqueryDepth = expressionDepth;
      }
    }
    else if (token.text === ")") {
      if (expressionDepth === castTypeDepth) castTypeDepth = -1;
      if (expressionDepth === subqueryDepth) subqueryDepth = -1;
      expressionDepth--;
    }
    if (subqueryDepth >= 0) continue;
    if (isWord(token, "AS")) castTypeDepth = expressionDepth;
    if (castTypeDepth >= 0 || targets.has(i)) continue;
    if (token.kind !== "word" && token.kind !== "ident") continue;
    if (token.kind === "word" && SET_CLAUSE_KEYWORDS.has(token.text.toUpperCase())) continue;
    const after = next(out, i + 1);
    const before = prev(out, i - 1);
    if (out[after]?.text === "(" || out[after]?.text === ".") continue;
    if (out[before]?.text === ".") continue;
    if (isWord(out[before], "COLLATE")) continue;
    out[i] = { kind: "other", text: `${qualifier}.${token.text}` };
  }
  return out;
}

export function translateSqliteToPostgres(sql: string, types?: SchemaTypes): TranslatedStatement {
  let tokens = tokenize(sql);
  const first = next(tokens, 0);
  if (isWord(tokens[first], "PRAGMA")) return { sql, skip: true };
  const trigger = translateTrigger(sql);
  if (trigger !== undefined) return trigger;
  const upsertTable = upsertTargetTable(tokens);
  if (upsertTable !== undefined) tokens = qualifyUpsertSetReferences(tokens, upsertTable);
  const isCreateTable = isWord(tokens[first], "CREATE") && tokens.some((t) => isWord(t, "TABLE"));
  const isCreateIndex = isWord(tokens[first], "CREATE") && tokens.some((t) => isWord(t, "INDEX"));
  const out: Token[] = [];
  let paramCount = 0;
  let insertTable: string | undefined;
  let explicitId = false;
  let orIgnore = false;
  let hasReturning = false;
  let hasOnConflict = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === "param") {
      const n = t.text.length > 1 ? Number(t.text.slice(1)) : ++paramCount;
      if (t.text.length > 1) paramCount = Math.max(paramCount, n);
      const p = prev(out, out.length - 1);
      const folded = out[p]?.text === "=" && out[prev(out, p - 1)]?.text.startsWith("lower(");
      out.push({ kind: "other", text: folded ? `lower($${n})` : `$${n}` });
      continue;
    }
    if (t.kind === "word") {
      const u = t.text.toUpperCase();
      if (u === "RETURNING") hasReturning = true;
      if (u === "CONFLICT") hasOnConflict = true;
      if (u === "INSERT") {
        const o = next(tokens, i + 1);
        if (isWord(tokens[o], "OR")) {
          const what = next(tokens, o + 1);
          if (isWord(tokens[what], "IGNORE")) orIgnore = true;
          out.push(t);
          i = what;
          continue;
        }
      }
      if (u === "INTO" && insertTable === undefined && tokens.slice(0, i).some((x) => isWord(x, "INSERT"))) {
        const n = next(tokens, i + 1);
        insertTable = unquote(tokens[n]!);
        const paren = next(tokens, n + 1);
        if (tokens[paren]?.text === "(") {
          for (let k = paren + 1; k < tokens.length && tokens[k]!.text !== ")"; k++) {
            const tk = tokens[k]!;
            if ((tk.kind === "word" || tk.kind === "ident") && unquote(tk).toLowerCase() === "id") explicitId = true;
          }
        }
      }
      if (u === "COLLATE") {
        const n = next(tokens, i + 1);
        if (isWord(tokens[n], "NOCASE")) {
          if (isCreateTable || isCreateIndex) {
            i = n;
            continue;
          }
          const p = prev(out, out.length - 1);
          let start = p;
          if (start >= 2 && out[start - 1]?.text === "." && (out[start - 2]?.kind === "word" || out[start - 2]?.kind === "ident")) start -= 2;
          const ref = out.splice(start).filter((x) => x.kind !== "space");
          out.push({ kind: "other", text: `lower(${ref.map((x) => x.text).join("")})` });
          i = n;
          continue;
        }
      }
      if (/[a-z]/.test(t.text) && /[A-Z]/.test(t.text) && tokens[next(tokens, i + 1)]?.text !== "(") {
        out.push({ kind: "ident", text: `"${t.text}"` });
        continue;
      }
      if (u === "IS") {
        let k = next(tokens, i + 1);
        const negated = isWord(tokens[k], "NOT");
        if (negated) k = next(tokens, k + 1);
        if (isWord(tokens[k], "FALSE") || isWord(tokens[k], "TRUE")) {
          const start = operandStart(out);
          if (start >= 0) {
            const operand = out.splice(start).map((x) => x.text).join("").trim();
            const fn = isWord(tokens[k], "TRUE") ? "is_true" : "is_false";
            out.push({ kind: "other", text: `${negated ? "NOT " : ""}decko_sqlite.${fn}(${operand})` });
            i = k;
            continue;
          }
        }
      }
      if (u === "TRUE" || u === "FALSE") {
        out.push({ kind: "other", text: u === "TRUE" ? "1" : "0" });
        continue;
      }
      if (u === "ROWID" && !isCreateTable) {
        const p = prev(out, out.length - 1);
        out.push({ kind: "word", text: isWord(out[p], "BY") ? "1" : "id" });
        continue;
      }
      if (u === "REGEXP") {
        out.push({ kind: "other", text: "~" });
        continue;
      }
      if (u === "LIKE" && !isCreateTable) {
        out.push({ kind: "word", text: "ILIKE" });
        continue;
      }
      if (u === "GLOB") {
        out.push({ kind: "word", text: "SIMILAR TO" });
        continue;
      }
      if (u === "LAST_INSERT_ROWID") {
        const open = next(tokens, i + 1);
        const close = next(tokens, open + 1);
        if (tokens[open]?.text === "(" && tokens[close]?.text === ")") {
          out.push({ kind: "other", text: LAST_ROWID_MARKER });
          i = close;
          continue;
        }
      }
      if (u === "GROUP_CONCAT") {
        out.push({ kind: "word", text: "string_agg" });
        continue;
      }
      if (u === "IFNULL") {
        out.push({ kind: "word", text: "COALESCE" });
        continue;
      }
      if (u === "JSON_OBJECT") {
        out.push({ kind: "word", text: "json_build_object" });
        continue;
      }
      if (u === "JSON_ARRAY") {
        out.push({ kind: "word", text: "json_build_array" });
        continue;
      }
      if (u === "CROSS" && isWord(tokens[next(tokens, i + 1)], "JOIN") && crossJoinHasOn(tokens, next(tokens, i + 1))) {
        i = next(tokens, i + 1);
        out.push({ kind: "word", text: "JOIN" });
        continue;
      }
      if (u === "JSON_EACH") {
        out.push({ kind: "word", text: "json_array_elements_text" });
        continue;
      }
      if (u === "SQLITE_SCHEMA") {
        out.push({ kind: "word", text: "sqlite_master" });
        continue;
      }
      if (isCreateTable) {
        if (u === "INTEGER") {
          const pk = next(tokens, i + 1);
          const key = next(tokens, pk + 1);
          const auto = next(tokens, key + 1);
          if (isWord(tokens[pk], "PRIMARY") && isWord(tokens[key], "KEY")) {
            if (isWord(tokens[auto], "AUTOINCREMENT")) {
              out.push({ kind: "word", text: "SERIAL PRIMARY KEY" });
              i = auto;
              continue;
            }
          }
          out.push({ kind: "word", text: "INTEGER" });
          continue;
        }
        if (["TEXT", "VARCHAR", "CHAR", "CHARACTER", "NVARCHAR", "CLOB"].includes(u)) {
          out.push({ kind: "word", text: "TEXT" });
          const paren = next(tokens, i + 1);
          if (tokens[paren]?.text === "(") {
            let k = paren;
            while (k < tokens.length && tokens[k]!.text !== ")") k++;
            i = k;
          } else if (u === "CHARACTER" && isWord(tokens[paren], "VARYING")) i = paren;
          continue;
        }
        if (u === "DATETIME" || u === "TIMESTAMP" || u === "DATE" || u === "TIME") {
          out.push({ kind: "word", text: "TEXT" });
          const paren = next(tokens, i + 1);
          if (tokens[paren]?.text === "(") {
            let k = paren;
            while (k < tokens.length && tokens[k]!.text !== ")") k++;
            i = k;
          }
          continue;
        }
        if (u === "BOOLEAN") {
          out.push({ kind: "word", text: "INTEGER" });
          continue;
        }
        if (u === "FLOAT" || u === "DOUBLE") {
          out.push({ kind: "word", text: "DOUBLE PRECISION" });
          continue;
        }
        if (u === "REAL") {
          out.push({ kind: "word", text: "DOUBLE PRECISION" });
          continue;
        }
        if (u === "BLOB") {
          out.push({ kind: "word", text: "BYTEA" });
          continue;
        }
        if (u === "AUTOINCREMENT" || u === "STRICT" || u === "WITHOUT" || u === "ROWID") continue;
      }
    }
    out.push(t);
  }

  if (isCreateTable) addMissingColumnTypes(out);
  else addSqliteNullOrdering(out);
  let postlude: string[] | undefined;
  if (isCreateTable && out.some((t) => t.text === "SERIAL PRIMARY KEY")) {
    const nameAt = next(out, out.findIndex((t) => isWord(t, "TABLE")) + 1);
    let n = nameAt;
    if (isWord(out[n], "IF")) n = next(out, next(out, next(out, n + 1) + 1) + 1);
    const table = unquote(out[n]!);
    const fn = `"${table}_id_default_fn"`;
    postlude = [
      `CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $decko$ BEGIN IF NEW.id IS NULL THEN NEW.id := nextval(pg_get_serial_sequence(TG_TABLE_NAME, 'id')); END IF; RETURN NEW; END $decko$`,
      `CREATE TRIGGER "${table}_id_default" BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    ];
  }

  let text = out.map((t) => t.text).join("").trim().replace(/;\s*$/, "");
  text = text.replace(/ORDER BY rowid\b/gi, "ORDER BY 1");
  text = text.replace(/json_array_elements_text\((\$\d+)\)/g, "json_array_elements_text($1::json)");
  if (/\bWITH\s+RECURSIVE\b/i.test(text)) text = mergeRecursiveArms(typeRecursiveAnchorParams(text, types));
  text = addRowidTieBreak(text);
  let returningId = false;
  if (insertTable !== undefined) {
    if (orIgnore && !hasOnConflict) text += " ON CONFLICT DO NOTHING";
    if (!hasReturning && /^\s*INSERT\b/i.test(text) && !/^sqlite_|^pg_/i.test(insertTable)) {
      text += " RETURNING *";
      returningId = true;
    }
  }
  return { sql: text, insertTable, explicitId, returningId, postlude };
}

function addMissingColumnTypes(tokens: Token[]): void {
  const open = tokens.findIndex((t) => t.text === "(");
  if (open < 0) return;
  let depth = 0;
  let segStart = open + 1;
  const segments: Array<[number, number]> = [];
  for (let i = open; i < tokens.length; i++) {
    const t = tokens[i]!.text;
    if (t === "(") depth++;
    else if (t === ")") {
      depth--;
      if (depth === 0) {
        segments.push([segStart, i]);
        break;
      }
    } else if (t === "," && depth === 1) {
      segments.push([segStart, i]);
      segStart = i + 1;
    }
  }
  for (let s = segments.length - 1; s >= 0; s--) {
    const [a, b] = segments[s]!;
    const words = tokens.slice(a, b).filter((t) => t.kind !== "space");
    if (words.length !== 1) continue;
    const w = words[0]!;
    if (w.kind === "word" && /^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)$/i.test(w.text)) continue;
    const idx = tokens.indexOf(w, a);
    tokens.splice(idx + 1, 0, { kind: "space", text: " " }, { kind: "word", text: "TEXT" });
  }
}

function translateTrigger(sql: string): TranslatedStatement | undefined {
  const m = /^\s*CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|\w+)\s+(AFTER|BEFORE)\s+(INSERT|UPDATE|DELETE)\s+ON\s+("[^"]+"|\w+)\s+(?:FOR\s+EACH\s+ROW\s+)?BEGIN\s+([\s\S]*?)\s*END\s*;?\s*$/i.exec(sql);
  if (m === null) return undefined;
  const [, rawName, timing, event, table, body] = m;
  const name = rawName!.replace(/"/g, "");
  const fn = `"${name}_fn"`;
  const statements = body!.trim().replace(/;\s*$/, "") + ";";
  return {
    prelude: `CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $decko$ BEGIN ${statements} RETURN NULL; END $decko$`,
    sql: `CREATE TRIGGER "${name}" ${timing!.toUpperCase()} ${event!.toUpperCase()} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
  };
}

const NOT_A_FUNCTION = new Set([
  "AND", "OR", "NOT", "WHERE", "ON", "WHEN", "THEN", "ELSE", "CASE", "SELECT", "IN", "EXISTS", "HAVING",
  "BY", "AS", "IS", "VALUES", "SET", "RETURNING", "JOIN", "USING", "FROM", "UNION", "EXCEPT", "INTERSECT",
]);

function operandStart(out: Token[]): number {
  const last = prev(out, out.length - 1);
  if (last < 0) return -1;
  const t = out[last]!;
  if (t.text === ")") {
    let depth = 0;
    for (let j = last; j >= 0; j--) {
      if (out[j]!.text === ")") depth++;
      else if (out[j]!.text === "(") {
        depth--;
        if (depth === 0) {
          const p = prev(out, j - 1);
          const named = p >= 0 && (out[p]!.kind === "word" || out[p]!.kind === "ident");
          return named && !NOT_A_FUNCTION.has(out[p]!.text.toUpperCase()) ? p : j;
        }
      }
    }
    return -1;
  }
  if (t.kind === "word" || t.kind === "ident" || t.kind === "string" || t.kind === "other" && /^\$\d+$|^lower\(/.test(t.text)) {
    let s = last;
    while (s - 2 >= 0 && out[s - 1]?.text === "." && (out[s - 2]!.kind === "word" || out[s - 2]!.kind === "ident")) s -= 2;
    return s;
  }
  return -1;
}

function crossJoinHasOn(tokens: Token[], joinAt: number): boolean {
  let depth = 0;
  for (let k = joinAt + 1; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.text === "(") depth++;
    else if (t.text === ")") {
      if (depth === 0) return false;
      depth--;
    } else if (depth === 0) {
      if (t.text === ",") return false;
      if (t.kind === "word") {
        const u = t.text.toUpperCase();
        if (u === "ON") return true;
        if (["JOIN", "CROSS", "LEFT", "INNER", "WHERE", "GROUP", "ORDER", "LIMIT", "UNION", "USING"].includes(u)) return false;
      }
    }
  }
  return false;
}

const TRUTH_FUNCTION_SQL =
  `CREATE OR REPLACE FUNCTION decko_sqlite.is_true(v boolean) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT COALESCE(v, false) $f$;\n` +
  `CREATE OR REPLACE FUNCTION decko_sqlite.is_false(v boolean) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT COALESCE(NOT v, false) $f$;\n` +
  ["integer", "bigint", "numeric", "double precision"].map(
    (type) =>
      `CREATE OR REPLACE FUNCTION decko_sqlite.is_true(v ${type}) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT COALESCE(v <> 0, false) $f$;\n` +
      `CREATE OR REPLACE FUNCTION decko_sqlite.is_false(v ${type}) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$ SELECT COALESCE(v = 0, false) $f$;`,
  ).join("\n") +
  `CREATE OR REPLACE FUNCTION decko_sqlite.is_true(v text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$\n` +
  `  SELECT CASE WHEN substring(v FROM '^\\s*[-+]?[0-9]*\\.?[0-9]+(?:[eE][-+]?[0-9]+)?') = '' THEN false ELSE COALESCE(substring(v FROM '^\\s*[-+]?[0-9]*\\.?[0-9]+(?:[eE][-+]?[0-9]+)?')::numeric <> 0, false) END $f$;\n` +
  `CREATE OR REPLACE FUNCTION decko_sqlite.is_false(v text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$\n` +
  `  SELECT v IS NOT NULL AND NOT decko_sqlite.is_true(v) $f$;`;

const COMPARE_OPERATORS = ["=", "<>", "<", "<=", ">", ">="] as const;
const INT_TEXT_BODY: Record<(typeof COMPARE_OPERATORS)[number], string> = {
  "=": "SELECT CASE WHEN n.v IS NULL THEN false ELSE i::numeric = n.v END",
  "<>": "SELECT CASE WHEN n.v IS NULL THEN true ELSE i::numeric <> n.v END",
  "<": "SELECT CASE WHEN n.v IS NULL THEN true ELSE i::numeric < n.v END",
  "<=": "SELECT CASE WHEN n.v IS NULL THEN true ELSE i::numeric <= n.v END",
  ">": "SELECT CASE WHEN n.v IS NULL THEN false ELSE i::numeric > n.v END",
  ">=": "SELECT CASE WHEN n.v IS NULL THEN false ELSE i::numeric >= n.v END",
};
const OP_NAME: Record<string, string> = { "=": "eq", "<>": "ne", "<": "lt", "<=": "le", ">": "gt", ">=": "ge" };
const FLIPPED: Record<string, string> = { "=": "=", "<>": "<>", "<": ">", "<=": ">=", ">": "<", ">=": "<=" };
const COMPARE_OPERATOR_SQL = [
  `CREATE OR REPLACE FUNCTION decko_sqlite.text_numeric(v text) RETURNS numeric LANGUAGE sql IMMUTABLE STRICT AS $f$\n` +
    `  SELECT CASE WHEN substring(v FROM '^\\s*[-+]?[0-9]*\\.?[0-9]+(?:[eE][-+]?[0-9]+)?') = '' THEN NULL ELSE substring(v FROM '^\\s*[-+]?[0-9]*\\.?[0-9]+(?:[eE][-+]?[0-9]+)?')::numeric END $f$;`,
  ...COMPARE_OPERATORS.map(
    (op) =>
      `CREATE OR REPLACE FUNCTION decko_sqlite.int_${OP_NAME[op]}_text(i integer, t text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $f$\n` +
      `  ${INT_TEXT_BODY[op]} FROM (SELECT decko_sqlite.text_numeric(t) AS v) n $f$;`,
  ),
  ...COMPARE_OPERATORS.map(
    (op) =>
      `CREATE OR REPLACE FUNCTION decko_sqlite.text_${OP_NAME[op]}_int(t text, i integer) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $f$\n` +
      `  SELECT decko_sqlite.int_${OP_NAME[FLIPPED[op]!]}_text(i, t) $f$;`,
  ),
  ...COMPARE_OPERATORS.map(
    (op) =>
      `DO $o$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace WHERE n.nspname = 'decko_sqlite' AND o.oprname = '${op}' AND o.oprleft = 'integer'::regtype AND o.oprright = 'text'::regtype) THEN\n` +
      `  CREATE OPERATOR decko_sqlite.${op} (LEFTARG = integer, RIGHTARG = text, FUNCTION = decko_sqlite.int_${OP_NAME[op]}_text);\n` +
      `  CREATE OPERATOR decko_sqlite.${op} (LEFTARG = text, RIGHTARG = integer, FUNCTION = decko_sqlite.text_${OP_NAME[op]}_int);\n` +
      `END IF;\n` +
      `END $o$;`,
  ),
].join("\n");

const SQLITE_COMPAT_SQL = `
CREATE SCHEMA IF NOT EXISTS decko_sqlite;
CREATE OR REPLACE FUNCTION decko_sqlite.substr(s text, start integer) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN start < 0 THEN right(s, -start) WHEN start = 0 THEN s ELSE pg_catalog.substr(s, start) END $f$;
CREATE OR REPLACE FUNCTION decko_sqlite.substr(s text, start integer, len integer) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN start < 0 THEN pg_catalog.substr(s, length(s) + start + 1, len)
              WHEN start = 0 THEN pg_catalog.substr(s, 1, greatest(len - 1, 0))
              ELSE pg_catalog.substr(s, start, len) END $f$;
CREATE OR REPLACE FUNCTION decko_sqlite.max(a anycompatible, b anycompatible) RETURNS anycompatible LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN a IS NULL OR b IS NULL THEN NULL ELSE greatest(a, b) END $f$;
CREATE OR REPLACE FUNCTION decko_sqlite.max(a anycompatible, b anycompatible, c anycompatible) RETURNS anycompatible LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN a IS NULL OR b IS NULL OR c IS NULL THEN NULL ELSE greatest(a, b, c) END $f$;
CREATE OR REPLACE FUNCTION decko_sqlite.min(a anycompatible, b anycompatible) RETURNS anycompatible LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN a IS NULL OR b IS NULL THEN NULL ELSE least(a, b) END $f$;
CREATE OR REPLACE FUNCTION decko_sqlite.min(a anycompatible, b anycompatible, c anycompatible) RETURNS anycompatible LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN a IS NULL OR b IS NULL OR c IS NULL THEN NULL ELSE least(a, b, c) END $f$;
CREATE OR REPLACE FUNCTION decko_sqlite.instr(s text, sub text) RETURNS integer LANGUAGE sql IMMUTABLE AS $f$ SELECT strpos(s, sub) $f$;
CREATE OR REPLACE FUNCTION decko_sqlite.char(VARIADIC codes integer[]) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT string_agg(chr(c), '' ORDER BY o) FROM unnest(codes) WITH ORDINALITY AS u(c, o) $f$;
CREATE OR REPLACE FUNCTION decko_sqlite.json_extract(doc json, path text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_path_query_first(doc::jsonb, path::jsonpath) #>> '{}' $f$;
CREATE OR REPLACE FUNCTION decko_sqlite.json_extract(doc text, path text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_path_query_first(doc::jsonb, path::jsonpath) #>> '{}' $f$;
CREATE OR REPLACE FUNCTION decko_sqlite.json_group_array_step(acc jsonb, v anyelement) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT acc || jsonb_build_array(v) $f$;
CREATE OR REPLACE FUNCTION decko_sqlite.json_group_array_final(acc jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT acc::text $f$;
DO $d$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'decko_sqlite' AND p.proname = 'json_group_array') THEN
    CREATE AGGREGATE decko_sqlite.json_group_array(anyelement) (SFUNC = decko_sqlite.json_group_array_step, STYPE = jsonb, FINALFUNC = decko_sqlite.json_group_array_final, INITCOND = '[]');
  END IF;
END $d$;
${COMPARE_OPERATOR_SQL}
${TRUTH_FUNCTION_SQL}
CREATE OR REPLACE VIEW decko_sqlite.sqlite_sequence AS
  SELECT regexp_replace(sequencename::text, '_id_seq$', '') AS name, last_value AS seq FROM pg_sequences WHERE schemaname = 'public';
CREATE OR REPLACE VIEW decko_sqlite.sqlite_master AS
  SELECT 'table'::text AS type, tablename::text AS name, tablename::text AS tbl_name, ''::text AS sql FROM pg_tables WHERE schemaname = 'public'
  UNION ALL SELECT 'index'::text, indexname::text, tablename::text, indexdef::text FROM pg_indexes WHERE schemaname = 'public';
`;

function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      const j = text.indexOf(c, i + 1);
      i = j < 0 ? text.length : j;
    } else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitUnionArms(body: string): { arms: string[]; ops: string[] } {
  const arms: string[] = [];
  const ops: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" || c === '"') {
      const j = body.indexOf(c, i + 1);
      i = j < 0 ? body.length : j;
    } else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0) {
      const m = /^\bUNION(\s+ALL)?\b/i.exec(body.slice(i));
      if (m !== null && /\s/.test(body[i - 1] ?? " ")) {
        arms.push(body.slice(start, i).trim());
        ops.push(m[0].toUpperCase().replace(/\s+/g, " "));
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  arms.push(body.slice(start).trim());
  return { arms, ops };
}

export type SchemaTypes = Map<string, Map<string, string>>;

const CLAUSE_WORDS = new Set([
  "ON", "JOIN", "WHERE", "LEFT", "RIGHT", "FULL", "INNER", "OUTER", "CROSS", "NATURAL", "GROUP", "ORDER",
  "HAVING", "LIMIT", "OFFSET", "UNION", "EXCEPT", "INTERSECT", "USING", "WINDOW", "AND", "OR",
]);

function splitSelectItems(arm: string): { items: string[]; rest: string } | undefined {
  const head = /^SELECT\s+/i.exec(arm);
  if (head === null || /^SELECT\s+DISTINCT\b/i.test(arm)) return undefined;
  const items: string[] = [];
  let depth = 0;
  let start = head[0].length;
  let i = start;
  for (; i < arm.length; i++) {
    const c = arm[i]!;
    if (c === "'" || c === '"') {
      const j = arm.indexOf(c, i + 1);
      if (j < 0) return undefined;
      i = j;
    } else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && c === ",") {
      items.push(arm.slice(start, i).trim());
      start = i + 1;
    } else if (depth === 0 && /\s/.test(arm[i - 1] ?? " ") && /^(FROM|WHERE|GROUP|ORDER|LIMIT|HAVING|WINDOW)\b/i.test(arm.slice(i))) {
      break;
    }
  }
  items.push(arm.slice(start, i).trim());
  return { items, rest: arm.slice(i) };
}

function fromAliases(arm: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\b(?:FROM|JOIN)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?(?:\s+(?:AS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(arm)) !== null) {
    const table = m[1]!;
    const alias = m[2] !== undefined && !CLAUSE_WORDS.has(m[2].toUpperCase()) ? m[2] : table;
    out.set(alias, table);
  }
  return out;
}

function selectItemType(item: string, aliases: Map<string, string>, types: SchemaTypes, cteName: string): string | undefined {
  if (/^'([^']|'')*'$/.test(item)) return "text";
  if (/^-?\d+$/.test(item)) return "integer";
  const cast = /^CAST\s*\(.*\s+AS\s+([A-Za-z][A-Za-z ]*?)\s*\)$/i.exec(item);
  if (cast !== null) return cast[1]!.toLowerCase();
  const col = /^(?:("?)([A-Za-z_][A-Za-z0-9_]*)\1\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?$/.exec(item);
  if (col === null) return undefined;
  const qualifier = col[2];
  const column = col[3]!;
  const candidates = qualifier !== undefined
    ? [aliases.get(qualifier)].filter((t): t is string => t !== undefined && t !== cteName)
    : [...new Set(aliases.values())].filter((t) => t !== cteName && types.get(t)?.has(column) === true);
  if (candidates.length !== 1) return undefined;
  return types.get(candidates[0]!)?.get(column);
}

function typeRecursiveAnchorParams(text: string, types: SchemaTypes | undefined): string {
  const cte = /(?:WITH\s+RECURSIVE\s+|,\s*)("?[A-Za-z_][A-Za-z0-9_]*"?)\s*\(([^()]*)\)\s+AS\s+(?:(?:NOT\s+)?MATERIALIZED\s+)?\(/gi;
  let m: RegExpExecArray | null;
  const edits: Array<[number, number, string]> = [];
  while ((m = cte.exec(text)) !== null) {
    const name = m[1]!.replace(/"/g, "");
    const open = m.index + m[0].length - 1;
    const close = closingParen(text, open);
    if (close < 0) continue;
    const { arms, ops } = splitUnionArms(text.slice(open + 1, close));
    const ref = new RegExp(`\\b(FROM|JOIN)\\s+"?${name}"?(?![A-Za-z0-9_])`, "i");
    const firstRecursive = arms.findIndex((a) => ref.test(a));
    if (firstRecursive < 1) continue;
    const recursive = splitSelectItems(arms[firstRecursive]!);
    if (recursive === undefined) continue;
    const aliases = fromAliases(arms[firstRecursive]!);
    const recursiveTypes = recursive.items.map((item) => selectItemType(item, aliases, types ?? new Map(), name));
    const rebuilt = arms.slice(0, firstRecursive).map((arm) => {
      const seed = splitSelectItems(arm);
      if (seed === undefined) return arm;
      let changed = false;
      const items = seed.items.map((item, k) => {
        const bare = /^\$(\d+)(\s+AS\s+.+)?$/i.exec(item);
        const type = recursiveTypes[k];
        if (bare === null || type === undefined) return item;
        changed = true;
        return `CAST($${bare[1]} AS ${type})${bare[2] ?? ""}`;
      });
      return changed ? `SELECT ${items.join(", ")}${seed.rest}` : arm;
    });
    if (rebuilt.every((arm, k) => arm === arms[k])) continue;
    const all = [...rebuilt, ...arms.slice(firstRecursive)];
    const body = all.map((a, k) => (k === 0 ? a : `${ops[k - 1]} ${a}`)).join(" ");
    edits.push([open + 1, close, body]);
  }
  let out = text;
  for (const [a, b, replacement] of edits.reverse()) out = out.slice(0, a) + replacement + out.slice(b);
  return out;
}

function mergeRecursiveArms(text: string): string {
  const cte = /(?:WITH\s+RECURSIVE\s+|,\s*)("?[A-Za-z_][A-Za-z0-9_]*"?)\s*\(([^()]*)\)\s+AS\s+(?:(?:NOT\s+)?MATERIALIZED\s+)?\(/gi;
  let m: RegExpExecArray | null;
  let out = text;
  const edits: Array<[number, number, string]> = [];
  while ((m = cte.exec(text)) !== null) {
    const name = m[1]!.replace(/"/g, "");
    const cols = m[2]!.split(",").map((c) => c.trim());
    const open = m.index + m[0].length - 1;
    const close = closingParen(text, open);
    if (close < 0) continue;
    const body = text.slice(open + 1, close);
    const { arms, ops } = splitUnionArms(body);
    if (arms.length < 3 || cols.length < 1) continue;
    const ref = new RegExp(`\\b(FROM|JOIN)\\s+"?${name}"?(?![A-Za-z0-9_])(?:\\s+(?:AS\\s+)?(?!(?:ON|JOIN|WHERE|CROSS|LEFT|INNER|GROUP|ORDER|UNION|LIMIT)\\b)([A-Za-z_][A-Za-z0-9_]*))?`, "gi");
    const refCount = (arm: string) => arm.match(ref)?.length ?? 0;
    const firstRecursive = arms.findIndex((a) => refCount(a) > 0);
    if (firstRecursive < 1) continue;
    const rec = arms.slice(firstRecursive);
    if (rec.length < 2 || !rec.every((a) => refCount(a) === 1)) continue;
    const steps = rec.map((arm) => arm.replace(ref, (_all, kw: string, alias?: string) => `${kw} (SELECT decko_r.*) AS ${alias ?? name}`));
    const stepOps = ops.slice(firstRecursive);
    const lateral = steps.map((s, k) => (k === 0 ? s : `${stepOps[k - 1]} ${s}`)).join(" ");
    const merged = `SELECT decko_u.* FROM "${name}" AS decko_r CROSS JOIN LATERAL (${lateral}) AS decko_u`;
    const seed = arms.slice(0, firstRecursive).map((a, k) => (k === 0 ? a : `${ops[k - 1]} ${a}`)).join(" ");
    edits.push([open + 1, close, `${seed} ${ops[firstRecursive - 1]} ${merged}`]);
  }
  for (const [a, b, replacement] of edits.reverse()) out = out.slice(0, a) + replacement + out.slice(b);
  return out;
}

export function configurePgTypes(types: { setTypeParser(oid: number, parse: (value: string) => unknown): void }): void {
  const toNumber = (value: string): number => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) && /^-?\d+$/.test(value)) throw new RangeError(`integer ${value} exceeds the safe range`);
    return n;
  };
  types.setTypeParser(20, toNumber);
  types.setTypeParser(1700, (value) => Number(value));
}

function addSqliteNullOrdering(tokens: Token[]): void {
  const ENDS = new Set(["LIMIT", "OFFSET", "UNION", "EXCEPT", "INTERSECT", "ROWS", "RANGE", "GROUPS", "FETCH"]);
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], "ORDER") || !isWord(tokens[next(tokens, i + 1)], "BY")) continue;
    let depth = 0;
    let termStart = next(tokens, i + 1) + 1;
    const close = (at: number): number => {
      const term = tokens.slice(termStart, at).filter((t) => t.kind !== "space");
      if (term.length === 0 || term.some((t) => isWord(t, "NULLS"))) return 0;
      const nulls = isWord(term[term.length - 1], "DESC") ? "NULLS LAST" : "NULLS FIRST";
      tokens.splice(at, 0, { kind: "space", text: " " }, { kind: "word", text: nulls }, { kind: "space", text: " " });
      return 3;
    };
    let k = termStart;
    for (; k < tokens.length; k++) {
      const t = tokens[k]!;
      if (t.text === "(") depth++;
      else if (t.text === ")") {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && t.text === ",") {
        k += close(k);
        termStart = k + 1;
      } else if (depth === 0 && t.kind === "word" && ENDS.has(t.text.toUpperCase())) break;
      else if (depth === 0 && t.text === ";") break;
    }
    k += close(k);
    i = k;
  }
}

function addRowidTieBreak(text: string): string {
  const head = /^SELECT\s+(DISTINCT\s+)?([\s\S]*?)\s+FROM\s+cards\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(text);
  if (head === null) return text;
  const alias = head[3]!;
  if (/^(WHERE|JOIN|LEFT|INNER|CROSS|ORDER|GROUP|LIMIT|ON)$/i.test(alias)) return text;
  let depth = 0;
  let orderAt = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      const j = text.indexOf(c, i + 1);
      i = j < 0 ? text.length : j;
    } else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && /^ORDER\s+BY\b/i.test(text.slice(i, i + 12)) && /\s/.test(text[i - 1] ?? " ")) orderAt = i;
  }
  if (orderAt < 0) return text;
  if (/\b(GROUP\s+BY|UNION|EXCEPT|INTERSECT)\b/i.test(text.slice(head[0].length))) return text;
  const tail = text.slice(orderAt);
  const end = /\s(LIMIT|OFFSET)\b/i.exec(tail);
  const terms = end === null ? tail : tail.slice(0, end.index);
  if (new RegExp(`${alias}\\.id(\\s+(ASC|DESC))?(\\s+NULLS\\s+(FIRST|LAST))?\\s*$`, "i").test(terms.trim())) return text;
  const where = text.slice(head[0].length, orderAt);
  const scanColumns = new RegExp(`\\bWHERE\\b[\\s\\S]*\\b${alias}\\.read_rule_id\\s+IN\\s*\\(`, "i").test(where)
    ? ["read_rule_id", "id"]
    : ["id"];
  const insertAt = orderAt + terms.length;
  const selectedList = head[2]!;
  const isSelected = (column: string) => new RegExp(`(^|[\\s,])${alias}\\.(${column}|\\*)\\s*(,|$)`).test(selectedList);
  if (head[1] === undefined || scanColumns.every(isSelected)) {
    return `${text.slice(0, insertAt).trimEnd()}, ${scanColumns.map((c) => `${alias}.${c}`).join(", ")}${text.slice(insertAt)}`;
  }
  const selected = selectedList.split(",").map((c) => c.trim());
  if (!selected.every((c) => new RegExp(`^${alias}\\.[A-Za-z_][A-Za-z0-9_]*$`).test(c))) return text;
  const names = selected.map((c) => c.slice(alias.length + 1));
  const extra = scanColumns.map((c) => `${alias}.${c} AS decko_scan_${c}`).join(", ");
  const inner = `SELECT DISTINCT ${selectedList}, ${extra} ${text.slice(head[0].search(/\s+FROM\s+/i), orderAt).trim()}`;
  const outerTerms = terms.replace(new RegExp(`\\b${alias}\\.`, "g"), "decko_q.").trimEnd();
  const scanTerms = scanColumns.map((c) => `decko_q.decko_scan_${c}`).join(", ");
  return `SELECT ${names.map((n) => `decko_q.${n}`).join(", ")} FROM (${inner}) AS decko_q ${outerTerms}, ${scanTerms}${text.slice(insertAt)}`;
}
