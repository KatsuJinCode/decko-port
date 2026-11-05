

import { describe, it, expect } from "vitest";
import {
  MysqldumpInsertParser,
  dumpRows,
  decodeMysqlEscapes,
} from "../../tools/migrate/parse-dump.mjs";
import { BS, dumpFile, sqlTuple } from "./synthetic-dump.js";

type Row = { table: string; values: unknown[]; columns: string[] | undefined };

function parseWith(dumpText: string, feedSize: number, opts = {}): Row[] {
  const p = new MysqldumpInsertParser(opts);
  const rows: Row[] = [];
  for (let i = 0; i < dumpText.length; i += feedSize) {
    p.feed(dumpText.slice(i, i + feedSize), false);
    let r = p.nextRow();
    while (r !== undefined) {
      rows.push(r);
      r = p.nextRow();
    }
  }
  p.feed("", true);
  p.finish();
  let r = p.nextRow();
  while (r !== undefined) {
    rows.push(r);
    r = p.nextRow();
  }
  return rows;
}

function canon(rows: Row[]): string {
  return JSON.stringify(rows, (_k, v) =>
    v instanceof Uint8Array ? `hex:${Buffer.from(v).toString("hex")}` : v,
  );
}

const FEED_SIZES = [1, 2, 3, 7, 64, 1 << 20];

describe("mysqldump INSERT parser", () => {
  it("decodes MySQL escapes per server semantics", () => {
    expect(decodeMysqlEscapes(`a${BS}'b`)).toBe("a'b");
    expect(decodeMysqlEscapes(`${BS}${BS}`)).toBe(BS);
    expect(decodeMysqlEscapes(`x${BS}ny${BS}tz${BS}r`)).toBe("x\ny\tz\r");
    expect(decodeMysqlEscapes(`n${BS}0t${BS}Z`)).toBe("n\0t\x1a");
    expect(decodeMysqlEscapes(`q${BS}"d`)).toBe('q"d');

    expect(decodeMysqlEscapes(`50${BS}%_of${BS}_x`)).toBe(`50${BS}%_of${BS}_x`);

    expect(decodeMysqlEscapes(`${BS}w`)).toBe("w");

    expect(decodeMysqlEscapes("don''t")).toBe("don't");

    expect(decodeMysqlEscapes(`${BS}'${BS}'`)).toBe("''");

    expect(decodeMysqlEscapes("plain")).toBe("plain");
  });

  it("parses the production grammar shapes identically at every feed size", () => {
    const tricky = "It's a 'test\\', he said\nline2";
    const dump = dumpFile([
      "LOCK TABLES `cards` WRITE;",
      "/*!40000 ALTER TABLE `cards` DISABLE KEYS */;",
      `INSERT INTO \`cards\` VALUES ${sqlTuple(1, tricky, null, "hexdeadbeef", -12.5e2, "")};`.replace(
        "'hexdeadbeef'",
        "0xdeadbeef",
      ),
      "-- a comment",
      "# hash comment",
      "CREATE TABLE `x` (a int);",
      "INSERT INTO `cards` (`id`,`name`) VALUES (3,'col-listed');",
    ]);
    const results = FEED_SIZES.map((size) => parseWith(dump, size));

    for (const rows of results) {
      expect(rows.map((r) => r.table)).toEqual(["cards", "cards"]);
    }
    for (const rows of results) {
      expect(canon(rows)).toBe(canon(results[0]));
    }
    const first = results[0][0];
    expect(first.values[0]).toBe(1);
    expect(first.values[1]).toBe(tricky);
    expect(first.values[2]).toBe(null);
    expect(first.values[3]).toEqual(Uint8Array.from(Buffer.from("deadbeef", "hex")));
    expect(first.values[4]).toBe(-1250);
    expect(first.values[5]).toBe("");
    expect(results[0][1].columns).toEqual(["id", "name"]);
    expect(results[0][1].values).toEqual([3, "col-listed"]);
  });

  it("handles adversarial string content at every feed size", () => {
    const content = [
      "quote' inside",
      "backslash" + BS + " inside",
      "escaped quote" + BS + "' then real ' quote",
      "doubled '' quotes",
      "trailing" + BS,
      BS + BS + BS + "'",
      "line1\nline2\ttabbed\rCRLF",
      "nul" + BS + "0 and Z" + BS + "Z",
      "",
      "'",
      "''",
    ];
    const tuples = content.map((c, i) => sqlTuple(i, c)).join(",");
    const dump = dumpFile([`INSERT INTO \`cards\` VALUES ${tuples};`]);
    const results = FEED_SIZES.map((size) => parseWith(dump, size));
    const base = canon(results[0]);
    for (const rows of results) expect(canon(rows)).toBe(base);
    expect(results[0].length).toBe(content.length);

    const values = results[0].map((r) => r.values[1]);
    expect(values).toEqual(content);
  });

  it("parses NULL, numbers, and literals", () => {
    const dump = dumpFile([
      "INSERT INTO `cards` VALUES (1,NULL,-42,3.25,1.5e-3,0,2147483647,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,2,NULL);",
    ]);
    for (const size of FEED_SIZES) {
      const rows = parseWith(dump, size);
      expect(rows[0].values).toEqual([
        1, null, -42, 3.25, 0.0015, 0, 2147483647, null, null, null, null, null,
        null, null, 1, 2, null,
      ]);
    }
  });

  it("handles very long lines with many tuples (no whole-line assumption)", () => {

    const tuples: string[] = [];
    for (let i = 0; i < 2000; i++) {
      tuples.push(sqlTuple(i, `sess_${i}_${"x".repeat(30)}`, null, null));
    }
    const dump = dumpFile([`INSERT INTO \`sessions\` VALUES ${tuples.join(",")};`]);
    for (const size of [1 << 20, 4096, 97]) {
      const rows = parseWith(dump, size);
      expect(rows.length).toBe(2000);
      expect(rows[1999].values[0]).toBe(1999);
      expect(rows[0].values[1]).toBe(`sess_0_${"x".repeat(30)}`);
    }
  });

  it("tracks stats and skips filtered tables", () => {
    const dump = dumpFile([
      "INSERT INTO `cards` VALUES (1,'a',NULL,NULL,NULL,NULL,NULL,'2020-01-01 00:00:00','2020-01-01 00:00:00',1,1,NULL,NULL,NULL,0,2,NULL);",
      "INSERT INTO `sessions` VALUES (9,'sid',NULL,NULL);",
      "INSERT INTO `cards` VALUES (2,'b',NULL,NULL,NULL,NULL,NULL,'2020-01-01 00:00:00','2020-01-01 00:00:00',1,1,NULL,NULL,NULL,0,2,NULL);",
    ]);
    const p = new MysqldumpInsertParser({ tables: ["cards"] });
    const rows: Row[] = [];
    p.feed(dump, true);
    p.finish();
    let r = p.nextRow();
    while (r !== undefined) {
      rows.push(r);
      r = p.nextRow();
    }
    expect(rows.length).toBe(2);
    expect(p.stats.rowsEmitted).toBe(2);
    expect(p.stats.skippedTables).toBe(1);
    expect(p.stats.statements).toBe(3);
    expect(p.stats.bytesRead).toBe(dump.length);
  });

  it("tolerates a truncated tail only when asked", () => {
    const truncated = "INSERT INTO `cards` VALUES (1,'unterminated";
    expect(() => {
      const p = new MysqldumpInsertParser({});
      p.feed(truncated, true);
      p.finish();
    }).toThrow(/inside a string literal/);
    const p = new MysqldumpInsertParser({ tolerantTruncated: true });
    p.feed(truncated, true);
    p.finish();
    expect(p.warnings.length).toBeGreaterThanOrEqual(1);
    expect(p.warnings.join(" ")).toMatch(/truncated/);
    expect(p.stats.rowsEmitted).toBe(0);
  });

  it("rejects malformed rows with loud errors instead of silent data loss", () => {

    const bad = dumpFile(["INSERT INTO `cards` VALUES (1" + BS + ",2);"]);
    expect(() => parseWith(bad, 1 << 20)).toThrow(/unexpected character/);

    const bad2 = dumpFile(["INSERT INTO `cards` (1,2);"]);
    expect(() => parseWith(bad2, 1 << 20)).toThrow(/malformed column list/);

    const bad3 = dumpFile(["INSERT INTO `cards` VALUES (1 @ 2);"]);
    expect(() => parseWith(bad3, 1 << 20)).toThrow(/unexpected character/);
  });

  it("dumpRows streams the same rows as the class API", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "decko-parse-"));
    try {
      const tuples: string[] = [];
      for (let i = 0; i < 500; i++) {
        tuples.push(sqlTuple(i, `row ${i} 'quoted'`, i % 2 === 0 ? null : `n${i}`));
      }
      const dump = dumpFile([`INSERT INTO \`sessions\` VALUES ${tuples.join(",")};`]);
      const path = join(dir, "d.sql");
      writeFileSync(path, dump, "utf8");
      const rows: Row[] = [];
      let progressCalls = 0;
      for await (const row of dumpRows(path, {
        onProgress: () => {
          progressCalls += 1;
        },
      })) {
        rows.push(row);
      }
      expect(rows.length).toBe(500);
      expect(rows[250].values[1]).toBe(`row 250 'quoted'`);
      expect(rows[1].values[2]).toBe("n1");
      expect(progressCalls).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
