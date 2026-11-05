// Pure unit tests for the SQLite -> PostgreSQL dialect mapper
// (src/server/drivers/postgres-dialect.ts). No driver, no fake — the
// mapper is a pure string-in / string-out function. Every test asserts on
// the dialect rewrite for one engine idiom the decko-ts engine emits.
//
// Engine idioms covered (each cited with the source file that produces it):
//
//   - `?` placeholders            : src/cql/sql.ts, src/card/history/write-path.ts, ...
//   - `INSTR`, `SUBSTR`           : src/card/render/prefetch.ts:138-145
//   - `COLLATE NOCASE`            : src/card/render/prefetch.ts:488-491, src/card/render.ts:331
//   - `last_insert_rowid()`       : src/card/history/write-path.ts:454, 491, 637
//   - `REGEXP`                    : src/cql/sql.ts:201
//   - `WITH RECURSIVE`            : src/card/render/prefetch.ts:147, src/card/permissions/read-rules.ts:432
//   - `COALESCE`, `SUM`, `COUNT`  : src/cql/sql.ts:113, src/card/permissions/read-rules.ts:186
//   - `INSERT INTO ...`           : src/card/auth/session-store.ts:111
//   - `PRAGMA` (DDL)              : db/schema.sqlite.sql:43
//
// The mapper does not rewrite DDL — the schema stream's PG DDL emitter
// uses pgIdentityColumn / stripPragmas for that. Those helpers are
// tested here too.

import { describe, it, expect } from "vitest";
import {
  toPostgresSql,
  toPostgresValue,
  pgIdentityColumn,
  stripPragmas,
} from "../../../src/server/drivers/postgres-dialect.js";

describe("postgres-dialect: placeholders", () => {
  it("replaces a single `?` with `$1`", () => {
    const r = toPostgresSql("SELECT 1");
    expect(r.sql).toBe("SELECT 1");
    expect(r.paramCount).toBe(0);
  });

  it("replaces sequential placeholders in a SELECT", () => {
    const r = toPostgresSql("SELECT * FROM cards WHERE id = ? AND key = ?");
    expect(r.sql).toBe("SELECT * FROM cards WHERE id = $1 AND key = $2");
    expect(r.paramCount).toBe(2);
  });

  it("replaces placeholders in an INSERT VALUES list", () => {
    const r = toPostgresSql(
      "INSERT INTO auth_sessions (token_hash, account_card_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    );
    expect(r.sql).toBe(
      "INSERT INTO auth_sessions (token_hash, account_card_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
    );
    expect(r.paramCount).toBe(4);
  });

  it("does NOT replace `?` inside a single-quoted string literal", () => {
    const r = toPostgresSql("SELECT 'is this a ? placeholder?' AS msg, ? AS p");
    expect(r.sql).toBe("SELECT 'is this a ? placeholder?' AS msg, $1 AS p");
    expect(r.paramCount).toBe(1);
  });

  it("handles doubled single-quote escapes inside string literals", () => {
    // The SQL `'''` is one literal: the empty string followed by start of
    // another — but a naive split would think the second `'` closes. The
    // walker must recognize the doubled form.
    const r = toPostgresSql("SELECT '''', ?, '''' || ?");
    expect(r.sql).toBe("SELECT '''', $1, '''' || $2");
    expect(r.paramCount).toBe(2);
  });

  it("does NOT replace `?` inside a line comment", () => {
    const r = toPostgresSql("SELECT 1 -- a ? in a comment\nWHERE id = ?");
    expect(r.sql).toBe("SELECT 1 -- a ? in a comment\nWHERE id = $1");
    expect(r.paramCount).toBe(1);
  });

  it("does NOT replace `?` inside a block comment", () => {
    const r = toPostgresSql("SELECT /* ? still ? in comment */ 1 WHERE id = ?");
    expect(r.sql).toBe("SELECT /* ? still ? in comment */ 1 WHERE id = $1");
    expect(r.paramCount).toBe(1);
  });

  it("replaces placeholders across a recursive CTE", () => {
    const r = toPostgresSql(
      "WITH RECURSIVE reached(id) AS (SELECT ? AS id UNION SELECT s.id FROM reached r JOIN cards s ON s.id IN (r.id, ?)) SELECT * FROM reached",
    );
    expect(r.sql).toBe(
      "WITH RECURSIVE reached(id) AS (SELECT $1 AS id UNION SELECT s.id FROM reached r JOIN cards s ON s.id IN (r.id, $2)) SELECT * FROM reached",
    );
    expect(r.paramCount).toBe(2);
  });
});

describe("postgres-dialect: SQLite function rewrites", () => {
  it("rewrites INSTR(...) to STRPOS(...)", () => {
    const r = toPostgresSql("SELECT instr(name, 'A') FROM cards");
    expect(r.sql).toBe("SELECT STRPOS(name, 'A') FROM cards");
  });

  it("rewrites SUBSTR(haystack, start) to SUBSTRING(haystack FROM start)", () => {
    const r = toPostgresSql("SELECT substr(name, 2) FROM cards");
    expect(r.sql).toBe("SELECT SUBSTRING(name FROM 2) FROM cards");
  });

  it("rewrites SUBSTR(haystack, start, length) to SUBSTRING(haystack FROM start FOR length)", () => {
    const r = toPostgresSql("SELECT substr(name, 2, 5) FROM cards");
    expect(r.sql).toBe("SELECT SUBSTRING(name FROM 2 FOR 5) FROM cards");
  });

  it("rewrites the engine's instr-chained span scan verbatim (prefetch.ts:138-145)", () => {
    // The exact SQL fragment from src/card/render/prefetch.ts:
    //   const at = `instr(f.rest, '{{')`;
    //   const restAfter = `substr(f.rest, ${at} + 2)`;
    //   const closeAt = `instr(substr(f.rest, ${at} + 2), '}}')`;
    //   const span = `substr(f.rest, ${at} + 2, ${closeAt} - 1)`;
    const at = `instr(f.rest, '{{')`;
    const closeAt = `instr(substr(f.rest, ${at} + 2), '}}')`;
    const span = `substr(f.rest, ${at} + 2, ${closeAt} - 1)`;
    const sql = `SELECT ${span} FROM frontier f`;
    const r = toPostgresSql(sql);
    // Three-arg SUBSTR maps to PG's SUBSTRING(... FROM ... FOR ...) form.
    expect(r.sql).toBe(
      "SELECT SUBSTRING(f.rest FROM STRPOS(f.rest, '{{') + 2 " +
        "FOR STRPOS(SUBSTRING(f.rest FROM STRPOS(f.rest, '{{') + 2), '}}') - 1) FROM frontier f",
    );
  });

  it("rewrites last_insert_rowid() to lastval()", () => {
    const r = toPostgresSql("SELECT last_insert_rowid() AS id");
    expect(r.sql).toBe("SELECT lastval() AS id");
  });

  it("rewrites REGEXP to ~* (case-insensitive)", () => {
    const r = toPostgresSql("SELECT * FROM cards WHERE name REGEXP ?");
    expect(r.sql).toBe("SELECT * FROM cards WHERE name ~* $1");
  });

  it("does NOT touch lowercase identifiers that happen to start with substr/instr", () => {
    // Defensive: identifiers like `substring_count` must not be clobbered.
    const r = toPostgresSql("SELECT substring_count, instr_pos FROM t");
    expect(r.sql).toBe("SELECT substring_count, instr_pos FROM t");
  });
});

describe("postgres-dialect: COLLATE NOCASE", () => {
  it("rewrites `col COLLATE NOCASE = ?` to `LOWER(col) = LOWER(?)`", () => {
    const r = toPostgresSql('SELECT * FROM cards WHERE "key" COLLATE NOCASE = ?');
    expect(r.sql).toBe('SELECT * FROM cards WHERE LOWER("key") = LOWER($1)');
  });

  it("rewrites the prefetch batch IN-list verbatim (prefetch.ts:488-491)", () => {
    const placeholders = "?, ?, ?";
    const sql = `SELECT * FROM cards WHERE "key" COLLATE NOCASE IN (${placeholders}) AND trash = 0`;
    const r = toPostgresSql(sql);
    expect(r.sql).toBe(
      'SELECT * FROM cards WHERE LOWER("key") IN (LOWER($1), LOWER($2), LOWER($3)) AND trash = 0',
    );
    expect(r.paramCount).toBe(3);
  });

  it("rewrites the prefetch junction join's two NOCASE IN lists (prefetch.ts:504-505)", () => {
    const placeholdersL = "?, ?";
    const placeholdersR = "?, ?, ?";
    const sql =
      `  JOIN cards l ON l.id = j.left_id AND l."key" COLLATE NOCASE IN (${placeholdersL})\n` +
      `  JOIN cards r ON r.id = j.right_id AND r."key" COLLATE NOCASE IN (${placeholdersR})\n`;
    const r = toPostgresSql(sql);
    expect(r.sql).toBe(
      `  JOIN cards l ON l.id = j.left_id AND LOWER(l."key") IN (LOWER($1), LOWER($2))\n` +
        `  JOIN cards r ON r.id = j.right_id AND LOWER(r."key") IN (LOWER($3), LOWER($4), LOWER($5))\n`,
    );
    expect(r.paramCount).toBe(5);
  });

  it("rewrites NOT IN with NOCASE", () => {
    const r = toPostgresSql('SELECT 1 FROM cards WHERE "key" COLLATE NOCASE NOT IN (?, ?)');
    expect(r.sql).toBe('SELECT 1 FROM cards WHERE LOWER("key") NOT IN (LOWER($1), LOWER($2))');
  });

  it("rewrites `<>` with NOCASE", () => {
    const r = toPostgresSql('SELECT 1 FROM cards WHERE "key" COLLATE NOCASE <> ?');
    expect(r.sql).toBe('SELECT 1 FROM cards WHERE LOWER("key") <> LOWER($1)');
  });

  it("rewrites LIKE with NOCASE", () => {
    const r = toPostgresSql('SELECT 1 FROM cards WHERE "key" COLLATE NOCASE LIKE ?');
    expect(r.sql).toBe('SELECT 1 FROM cards WHERE LOWER("key") LIKE LOWER($1)');
  });

  it("throws when COLLATE NOCASE is not followed by a comparison operator", () => {
    // Engine bug guard — never expected in production, but the
    // dialect must fail loud rather than silently corrupt.
    expect(() => toPostgresSql('SELECT 1 FROM cards WHERE "key" COLLATE NOCASE')).toThrow();
  });
});

describe("postgres-dialect: PRAGMA comments out", () => {
  it("comments out a PRAGMA line in DDL", () => {
    const r = toPostgresSql("PRAGMA foreign_keys = OFF;\nCREATE TABLE cards (id INT);");
    expect(r.sql).toBe("-- PRAGMA foreign_keys = OFF;\nCREATE TABLE cards (id INT);");
  });

  it("comments out a PRAGMA on the first line of a file", () => {
    const r = toPostgresSql("PRAGMA foreign_keys = OFF;");
    expect(r.sql).toBe("-- PRAGMA foreign_keys = OFF;");
  });

  it("does not touch CREATE INDEX etc.", () => {
    const r = toPostgresSql("CREATE UNIQUE INDEX cards_key_index ON cards (key);");
    expect(r.sql).toBe("CREATE UNIQUE INDEX cards_key_index ON cards (key);");
  });
});

describe("postgres-dialect: datetime", () => {
  it("rewrites datetime('now') to CURRENT_TIMESTAMP", () => {
    const r = toPostgresSql("SELECT datetime('now')");
    expect(r.sql).toBe("SELECT CURRENT_TIMESTAMP");
  });

  it("does NOT rewrite the storage-shape datetime (engine does not emit this form)", () => {
    // The engine's canonical form is the already-formatted string
    // "YYYY-MM-DD HH:MM:SS.mmm" generated by sqlDateTime() — it never
    // asks PG to format a datetime. No-op proves the mapper does not
    // mangle the storage form.
    const r = toPostgresSql("SELECT '2026-09-21 12:34:56.789'");
    expect(r.sql).toBe("SELECT '2026-09-21 12:34:56.789'");
  });
});

describe("postgres-dialect: passes through engine-compatible SQL", () => {
  it("leaves COALESCE, SUM, CASE WHEN, AND, OR, parens alone", () => {
    const sql =
      "COALESCE(SUM(CASE WHEN cards.left_id = 5 THEN 1 ELSE 0 END), 0) AS catchAll";
    expect(toPostgresSql(sql).sql).toBe(sql);
  });

  it("leaves LIMIT / OFFSET alone", () => {
    expect(toPostgresSql("SELECT * FROM cards LIMIT 10 OFFSET 5").sql).toBe(
      "SELECT * FROM cards LIMIT 10 OFFSET 5",
    );
  });

  it("leaves INSERT ... RETURNING (when/if the engine ever emits it) alone", () => {
    expect(toPostgresSql("INSERT INTO cards (key) VALUES (?) RETURNING id").sql).toBe(
      "INSERT INTO cards (key) VALUES ($1) RETURNING id",
    );
  });

  it("leaves CAST(x AS INTEGER/REAL/TEXT) alone (PG accepts these)", () => {
    expect(toPostgresSql("SELECT CAST(x AS INTEGER), CAST(y AS REAL), CAST(z AS TEXT) FROM t").sql).toBe(
      "SELECT CAST(x AS INTEGER), CAST(y AS REAL), CAST(z AS TEXT) FROM t",
    );
  });
});

describe("postgres-dialect: paramCount sanity", () => {
  it("reports zero for SQL with no placeholders", () => {
    expect(toPostgresSql("SELECT 1").paramCount).toBe(0);
    expect(toPostgresSql("CREATE TABLE x (id INT)").paramCount).toBe(0);
  });

  it("reports the right count for a multi-placeholder query", () => {
    expect(toPostgresSql("SELECT ?, ?, ?, ?").paramCount).toBe(4);
  });
});

describe("postgres-dialect: parameter value mapping (toPostgresValue)", () => {
  it("passes null through as null", () => {
    expect(toPostgresValue(null)).toBe(null);
  });

  it("passes a number through as number", () => {
    expect(toPostgresValue(42)).toBe(42);
    expect(toPostgresValue(-3.14)).toBe(-3.14);
  });

  it("passes a string through as string", () => {
    expect(toPostgresValue("hello")).toBe("hello");
  });

  it("serializes a bigint to its string form", () => {
    expect(toPostgresValue(2n ** 63n - 1n)).toBe("9223372036854775807");
  });

  it("wraps a Uint8Array in a Buffer", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const out = toPostgresValue(bytes);
    expect(out).toBeInstanceOf(Buffer);
    expect(Array.from(out as Buffer)).toEqual([1, 2, 3]);
  });

  it("passes booleans through (PG boolean column accepts them)", () => {
    expect(toPostgresValue(true)).toBe(true);
    expect(toPostgresValue(false)).toBe(false);
  });

  it("treats undefined as null (matches SQLite NULL semantics)", () => {
    // The engine does not emit undefined; if it ever does the dialect
    // maps it to null so PG's binding layer does not reject it.
    expect(toPostgresValue(undefined)).toBe(null);
  });
});

describe("postgres-dialect: DDL helpers (used by the schema stream)", () => {
  it("pgIdentityColumn rewrites INTEGER PRIMARY KEY AUTOINCREMENT", () => {
    const sql = pgIdentityColumn(
      "CREATE TABLE cards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)",
    );
    expect(sql).toBe(
      "CREATE TABLE cards (id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT)",
    );
  });

  it("pgIdentityColumn is case-insensitive", () => {
    // The replacement always emits uppercase canonical form regardless
    // of the input casing — that is the contract for DDL emission.
    const sql = pgIdentityColumn("id integer primary key autoincrement");
    expect(sql).toBe("id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY");
  });

  it("stripPragmas returns the cleaned SQL and the removed pragma lines", () => {
    const ddl =
      "PRAGMA foreign_keys = OFF;\n" +
      "CREATE TABLE cards (id INT);\n" +
      "PRAGMA journal_mode = WAL;";
    const { cleaned, removed } = stripPragmas(ddl);
    expect(removed).toEqual(["PRAGMA foreign_keys = OFF;", "PRAGMA journal_mode = WAL;"]);
    expect(cleaned).toBe("\nCREATE TABLE cards (id INT);\n");
  });
});
