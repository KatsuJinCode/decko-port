// streaming-memory.test.ts — the bounded-memory streaming proof.
//
// Generates a 1,000,000-row SYNTHETIC dump (sessions-shaped rows, written
// incrementally so generation itself never holds the file) and imports it.
// Assertions:
//   1. all 1M rows arrive and land (count parity),
//   2. the parser's retained text buffer stays at a fixed bound
//      (maxBufferChars) no matter the input size — the whole-file load
//      and per-line accumulation failure modes are excluded by this,
//   3. heap growth during the import stays bounded (a row-accumulating
//      implementation at this scale would exceed the cap several times).

import { describe, it, expect, afterAll } from "vitest";
import { openSync, writeSync, closeSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LocalSqliteToolDriver,
  importDump,
} from "../../tools/migrate/import.mjs";
import { MysqldumpInsertParser } from "../../tools/migrate/parse-dump.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DDL_PATH = join(REPO_ROOT, "db", "schema.sqlite.sql");

const ROWS = 1_000_000;
const BATCH = 500;

const dirs: string[] = [];
afterAll(() => {
  // best-effort cleanup; Windows may still hold a handle briefly
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // leftover %TEMP% dirs are acceptable
    }
  }
});

/** Write ROWS sessions tuples to fd, BATCH at a time (bounded memory). */
function generateSessionsDump(path: string): number {
  const fd = openSync(path, "w");
  let bytes = 0;
  const header = "-- synthetic 1M-row sessions dump (generated in-test)\n";
  bytes += writeSync(fd, header);
  bytes += writeSync(fd, "LOCK TABLES `sessions` WRITE;\n");
  for (let start = 0; start < ROWS; start += BATCH) {
    const tuples: string[] = [];
    for (let i = start; i < Math.min(start + BATCH, ROWS); i++) {
      tuples.push(
        `(${i + 1},'sess-${i.toString(36)}-${"d".repeat(24)}','payload-${i}-"${"x".repeat(20)}"','2021-06-01 12:00:00')`,
      );
    }
    bytes += writeSync(
      fd,
      `INSERT INTO \`sessions\` VALUES ${tuples.join(",")};\n`,
    );
  }
  bytes += writeSync(fd, "UNLOCK TABLES;\n");
  closeSync(fd);
  return bytes;
}

describe("streaming bounded memory", () => {
  it(
    "imports 1M rows with a bounded parser buffer and bounded heap growth",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "decko-stream-"));
      dirs.push(dir);
      const dumpPath = join(dir, "million.sql");
      const fileBytes = generateSessionsDump(dumpPath);
      expect(fileBytes).toBeGreaterThan(80 * 1024 * 1024); // ~85+ MB dump

      // Parser-side bound: the max retained buffer must stay far below the
      // file size (it must never approach holding even one whole INSERT
      // line's worth of accumulated text beyond the compaction bound).
      const parser = new MysqldumpInsertParser({});
      let parserRows = 0;
      {
        const { open } = await import("node:fs/promises");
        const handle = await open(dumpPath, "r");
        try {
          const buffer = Buffer.allocUnsafe(1 << 20);
          const decoder = new TextDecoder("utf-8");
          for (;;) {
            const read = await handle.read(buffer, 0, buffer.length);
            if (read.bytesRead === 0) break;
            parser.feed(decoder.decode(buffer.subarray(0, read.bytesRead), { stream: true }), false);
            let r = parser.nextRow();
            while (r !== undefined) {
              parserRows += 1;
              r = parser.nextRow();
            }
          }
          parser.feed(decoder.decode() + "\n", true);
          parser.finish();
        } finally {
          await handle.close();
        }
      }
      expect(parserRows).toBe(ROWS);
      // bound: compaction keeps the buffer at ~chunk size + slack, not at
      // file size and not at line size
      expect(parser.stats.maxBufferChars).toBeLessThan(8 * 1024 * 1024);

      // Import with heap sampling through the progress callback.
      const driver = new LocalSqliteToolDriver(join(dir, "million.sqlite"));
      const heapBefore = process.memoryUsage().heapUsed;
      let heapPeak = heapBefore;
      const stats = await importDump({
        dumpPath,
        driver,
        ddlPath: DDL_PATH,
        batchSize: 2000,
        onProgress: () => {
          const heap = process.memoryUsage().heapUsed;
          if (heap > heapPeak) heapPeak = heap;
        },
      });
      const heapGrowth = heapPeak - heapBefore;

      expect(stats.counts["sessions"]).toBe(ROWS);
      expect(stats.errors).toEqual([]);
      // 1M rows at ~200 bytes each would need >200 MB if accumulated;
      // the streaming pipeline must stay far under that.
      expect(heapGrowth).toBeLessThan(150 * 1024 * 1024);

      const count = await driver.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sessions",
        [],
      );
      expect(count.rows[0]?.n).toBe(ROWS);
      // spot rows survive intact
      const spot = await driver.query<{ session_id: string }>(
        "SELECT session_id FROM sessions WHERE id = ?",
        [ROWS],
      );
      expect(spot.rows[0]?.session_id).toBe(
        `sess-${(ROWS - 1).toString(36)}-${"d".repeat(24)}`,
      );
      driver.close();
    },
    600_000,
  );
});
