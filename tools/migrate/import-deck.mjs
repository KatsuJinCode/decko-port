import { existsSync, statSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { LocalSqliteToolDriver, ENGINE_OWNED_TABLES } from "./import.mjs";
import { importFromSqlite } from "./generalized-import.mjs";
import { dumpRows } from "./parse-dump.mjs";
import { deckSeedRows } from "./deck-seed-parser.mjs";
import { openSourceSqlite, inventorySource, sourceTableRows } from "./source-sqlite.mjs";

async function* sqliteSourceRows(file, tables) {
  const db = openSourceSqlite(file);
  try {
    const wanted = new Set(tables);
    for (const name of Object.keys(inventorySource(db)).sort()) {
      if (wanted.has(name)) yield* sourceTableRows(db, name);
    }
  } finally {
    db.close();
  }
}
import { writeChunkedSeed, readTableColumns } from "./d1-chunker.mjs";
import { buildReport, writeReport } from "./d1-validator.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "..", "..");
const DEFAULT_DDL = path.join(REPO_ROOT, "db", "schema.sqlite.sql");
const DEFAULT_DEPLOY_DIR = path.join(REPO_ROOT, "deploy");
const DEFAULT_STAGING = path.join(TOOL_ROOT, "scratch-out");

function usage(exitCode = 0) {
  const lines = [
    "Usage: node tools/migrate/import-deck.mjs <source-flag> --out-dir <dir> [options]",
    "",
    "Source (exactly one):",
    "  --source <file>      Ruby decko SQLite database to import (read-only)",
    "  --dump <file>        mysqldump text (Ruby decko mysql-format dump)",
    "  --seed <file>        deck INSERT-format text (the seed file's INSERT shape)",
    "",
    "Output:",
    "  --out-dir <dir>      Directory to write chunk-NNN.sql files into",
    "  --report <file>      Validation report JSON path (default <out-dir>/report.json)",
    "  --apply              Apply chunks via `wrangler d1 execute --local --file`",
    "  --apply-dir <dir>    Directory to run wrangler from (default: deploy/)",
    "  --wrangler-bin <bin> Wrangler binary (default: wrangler on PATH)",
    "",
    "Chunking:",
    "  --chunk-rows <n>     Max INSERT statements per chunk (default 1000)",
    "  --chunk-bytes <n>    Max SQL bytes per chunk (default 8388608 = 8 MiB)",
    "  --batch <n>          Source-rows-per-transaction for the staging DB (default 1000)",
    "",
    "Misc:",
    "  --staging <file>     Staging SQLite path (default tools/migrate/scratch-out/staging-<ts>.sqlite)",
    "  --ddl <file>         Target DDL (default db/schema.sqlite.sql)",
    "  --tables <a,b,c>     Restrict to these tables (default: every table the DDL declares)",
    "  --quiet              No progress output",
    "  --strict             Exit nonzero when validation checks fail",
    "  --dedup              SQLite source: ingest through the streaming dedup path",
    "                       (the same UNIQUE-index collision policy the dump and",
    "                       seed paths apply) instead of generalized-import",
    "  --rebuild-keys       Streaming path: recompute the key of every card that stores",
    "                       a name from that name with the port's Card::Name#key, then",
    "                       apply the key collision policy; reports how many changed",
    "",
    "The JSON report is content-free (ids, counts, hashes - never card names/content).",
  ];
  console.log(lines.join("\n"));
  process.exit(exitCode);
}

function parseArgs(argv) {
  const opts = {
    source: undefined,
    dump: undefined,
    seed: undefined,
    outDir: undefined,
    report: undefined,
    apply: false,
    applyDir: DEFAULT_DEPLOY_DIR,
    wranglerBin: "wrangler",
    chunkRows: 1000,
    chunkBytes: 8 * 1024 * 1024,
    batch: 1000,
    staging: undefined,
    ddl: DEFAULT_DDL,
    tables: undefined,
    quiet: false,
    strict: false,
    dedup: false,
    rebuildKeys: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[i + 1];
      if (v === undefined) usage(1);
      i += 1;
      return v;
    };
    switch (a) {
      case "--source": opts.source = val(); break;
      case "--dump": opts.dump = val(); break;
      case "--seed": opts.seed = val(); break;
      case "--out-dir": opts.outDir = val(); break;
      case "--report": opts.report = val(); break;
      case "--apply": opts.apply = true; break;
      case "--apply-dir": opts.applyDir = path.resolve(val()); break;
      case "--wrangler-bin": opts.wranglerBin = val(); break;
      case "--chunk-rows": opts.chunkRows = Number(val()); break;
      case "--chunk-bytes": opts.chunkBytes = Number(val()); break;
      case "--batch": opts.batch = Number(val()); break;
      case "--staging": opts.staging = val(); break;
      case "--ddl": opts.ddl = path.resolve(val()); break;
      case "--tables": opts.tables = val().split(",").map((s) => s.trim()); break;
      case "--quiet": opts.quiet = true; break;
      case "--strict": opts.strict = true; break;
      case "--dedup": opts.dedup = true; break;
      case "--rebuild-keys": opts.rebuildKeys = true; break;
      case "--help": case "-h": usage(0); break;
      default:
        console.error(`unknown argument: ${a}`);
        usage(1);
    }
  }
  const sources = [opts.source, opts.dump, opts.seed].filter((v) => v !== undefined);
  if (sources.length !== 1) {
    console.error(`expected exactly one of --source / --dump / --seed, got ${sources.length}`);
    usage(1);
  }
  if (!opts.outDir) usage(1);
  if (opts.rebuildKeys && opts.source !== undefined && !opts.dedup) {
    console.error("--rebuild-keys with --source requires --dedup (the streaming path)");
    usage(1);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const sourcePath = opts.source ?? opts.dump ?? opts.seed;
const sourceKind = opts.source !== undefined ? "sqlite" : opts.dump !== undefined ? "mysqldump" : "deck-insert";
const sourceBytes = existsSync(sourcePath) ? statSync(sourcePath).size : 0;

if (!existsSync(sourcePath)) {
  console.error(`source not found: ${sourcePath}`);
  process.exit(1);
}
if (!existsSync(opts.ddl)) {
  console.error(`target DDL not found: ${opts.ddl}`);
  process.exit(1);
}

const outDir = path.resolve(opts.outDir);
mkdirSync(outDir, { recursive: true });
const chunksDir = path.join(outDir, "chunks");
mkdirSync(chunksDir, { recursive: true });

const tableColumns = readTableColumns(opts.ddl);
const targetTables = opts.tables ?? Object.keys(tableColumns);

const reportPath = opts.report ?? path.join(outDir, "report.json");

console.log(`import-deck: ${sourcePath} (${sourceKind}, ${(sourceBytes / 1048576).toFixed(1)} MB)`);
console.log(`    -> ${chunksDir}`);
console.log(`    target tables: ${targetTables.join(", ")}`);
console.log(`    chunking: max ${opts.chunkRows} rows or ${(opts.chunkBytes / 1048576).toFixed(0)} MiB per chunk`);

const stagingPath =
  opts.staging ?? path.join(DEFAULT_STAGING, `staging-${Date.now()}.sqlite`);
mkdirSync(path.dirname(stagingPath), { recursive: true });
if (existsSync(stagingPath)) rmSync(stagingPath, { force: true });

const stagingDriver = new LocalSqliteToolDriver(stagingPath);
const stagingStartedAt = Date.now();
let stagingStats = { rowsEmitted: 0, elapsedMs: 0, errors: [] };
let streamedCardsCount = 0;

if (sourceKind === "sqlite" && !opts.dedup) {
  console.log("\ningest: SQLite source -> staging DB (generalized-import)");
  try {
    stagingStats = await importFromSqlite({
      sourcePath,
      driver: stagingDriver,
      ddlPath: opts.ddl,
      batchSize: opts.batch,
      tables: targetTables,
      onProgress: (rows) => {
        if (opts.quiet) return;
        const secs = (Date.now() - stagingStartedAt) / 1000;
        const rate = secs > 0 ? (rows / secs).toFixed(0) : "?";
        process.stderr.write(`\r  ${rows} rows ingested | ${rate} rows/s`);
      },
    });
  } catch (err) {
    stagingDriver.close();
    console.error(`\ningest failed: ${err?.message ?? err}`);
    process.exit(1);
  }
  if (!opts.quiet) process.stderr.write("\n");
} else {
  console.log(`\ningest: ${sourceKind} source -> staging DB (streaming schema-map)`);
  const rowsIter =
    sourceKind === "mysqldump"
      ? dumpRows(sourcePath, { tables: targetTables })
      : sourceKind === "sqlite"
        ? sqliteSourceRows(sourcePath, targetTables)
        : deckSeedRows(sourcePath, { tables: targetTables });

  const { parseTargetSchema } = await import("./import.mjs");
  const schema = parseTargetSchema(opts.ddl);
  for (const pragma of schema.pragmas) await stagingDriver.query(pragma, []);
  for (const stmt of schema.createTables) await stagingDriver.query(stmt, []);

  const { mapRowToTarget } = await import("./schema-map.mjs");
  const deriveKey = opts.rebuildKeys ? await (await import("./load-derive-key.mjs")).loadDeriveKey() : undefined;
  const rebuiltKeys = { examined: 0, changed: 0, caseOnly: 0 };
  const seenIds = new Map();
  const seenKeys = new Map();
  const seenLR = new Map();
  const seenCodenames = new Map();
  const skippedDuplicates = new Map();
  const nulledKeyDuplicates = new Map();
  const nulledLRDuplicates = new Map();
  const nulledCodenameDuplicates = new Map();
  const nocaseFold = (v) => (typeof v === "string" ? v.replace(/[A-Z]/g, (c) => c.toLowerCase()) : v);
  function getSeen(t, m) {
    let s = m.get(t);
    if (s === undefined) { s = new Set(); m.set(t, s); }
    return s;
  }
  let buffer = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    await stagingDriver.batch(buffer);
    buffer = [];
  };
  for await (const row of rowsIter) {
    if (row.table === "cards") streamedCardsCount += 1;
    const targetCols = tableColumns[row.table];
    if (targetCols === undefined) continue;
    const sourceColumns = row.columns ?? targetCols;
    const mapped = mapRowToTarget(row.table, sourceColumns, row.values, targetCols);
    const idIdx = mapped.columns.indexOf("id");
    if (idIdx >= 0) {
      const id = mapped.values[idIdx];
      if (id !== null && id !== undefined) {
        const seen = getSeen(row.table, seenIds);
        if (seen.has(id)) {
          skippedDuplicates.set(row.table, (skippedDuplicates.get(row.table) ?? 0) + 1);
          continue;
        }
        seen.add(id);
      }
    }
    const keyIdx = mapped.columns.indexOf("key");
    if (deriveKey !== undefined && row.table === "cards" && keyIdx >= 0) {
      const name = mapped.values[mapped.columns.indexOf("name")];
      if (typeof name === "string" && name !== "") {
        rebuiltKeys.examined += 1;
        const before = mapped.values[keyIdx];
        const after = deriveKey(name);
        if (after !== before) {
          rebuiltKeys.changed += 1;
          if (typeof before === "string" && before.toLowerCase() === after.toLowerCase()) rebuiltKeys.caseOnly += 1;
          mapped.values[keyIdx] = after;
        }
      }
    }
    if (keyIdx >= 0) {
      const key = mapped.values[keyIdx];
      if (key !== null && key !== undefined) {
        const seen = getSeen(row.table, seenKeys);
        const folded = nocaseFold(key);
        if (seen.has(folded)) {
          mapped.values[keyIdx] = null;
          nulledKeyDuplicates.set(row.table, (nulledKeyDuplicates.get(row.table) ?? 0) + 1);
        } else {
          seen.add(folded);
        }
      }
    }
    const leftIdx = mapped.columns.indexOf("left_id");
    const rightIdx = mapped.columns.indexOf("right_id");
    if (leftIdx >= 0 && rightIdx >= 0) {
      const leftId = mapped.values[leftIdx];
      const rightId = mapped.values[rightIdx];
      if ((leftId !== null && leftId !== undefined) || (rightId !== null && rightId !== undefined)) {
        const k = `${leftId ?? ""},${rightId ?? ""}`;
        const seen = getSeen(row.table, seenLR);
        if (seen.has(k)) {
          mapped.values[rightIdx] = null;
          nulledLRDuplicates.set(row.table, (nulledLRDuplicates.get(row.table) ?? 0) + 1);
        } else {
          seen.add(k);
        }
      }
    }
    const cnIdx = mapped.columns.indexOf("codename");
    if (cnIdx >= 0) {
      const cn = mapped.values[cnIdx];
      if (cn !== null && cn !== undefined) {
        const seen = getSeen(row.table, seenCodenames);
        const folded = nocaseFold(cn);
        if (seen.has(folded)) {
          mapped.values[cnIdx] = null;
          nulledCodenameDuplicates.set(row.table, (nulledCodenameDuplicates.get(row.table) ?? 0) + 1);
        } else {
          seen.add(folded);
        }
      }
    }
    const cols = mapped.columns.map((c) => `"${c}"`).join(", ");
    const slots = mapped.columns.map(() => "?").join(", ");
    buffer.push({
      sql: `INSERT INTO "${row.table}" (${cols}) VALUES (${slots})`,
      params: mapped.values,
    });
    stagingStats.rowsEmitted += 1;
    if (!opts.quiet && stagingStats.rowsEmitted % 10000 === 0) {
      const secs = (Date.now() - stagingStartedAt) / 1000;
      const rate = secs > 0 ? (stagingStats.rowsEmitted / secs).toFixed(0) : "?";
      process.stderr.write(`\r  ${stagingStats.rowsEmitted} rows ingested | ${rate} rows/s`);
    }
    if (buffer.length >= opts.batch) await flush();
  }
  await flush();
  for (const stmt of schema.createIndexes) await stagingDriver.query(stmt, []);
  for (const stmt of schema.postLoadStatements) await stagingDriver.query(stmt, []);
  for (const stmt of schema.createTriggers) await stagingDriver.query(stmt, []);
  await stagingDriver.query("ANALYZE", []);
  if (!opts.quiet) process.stderr.write("\n");
  if (skippedDuplicates.size > 0) {
    const total = [...skippedDuplicates.values()].reduce((a, b) => a + b, 0);
    console.log(`  duplicate-id skip: ${total} rows (per-table: ${JSON.stringify(Object.fromEntries(skippedDuplicates))})`);
    stagingStats.skippedDuplicates = Object.fromEntries(skippedDuplicates);
  }
  if (deriveKey !== undefined) {
    console.log(`  rebuilt keys: ${rebuiltKeys.changed} of ${rebuiltKeys.examined} named cards changed (${rebuiltKeys.caseOnly} in letter case only)`);
    stagingStats.rebuiltKeys = rebuiltKeys;
  }
  if (nulledKeyDuplicates.size > 0) {
    const total = [...nulledKeyDuplicates.values()].reduce((a, b) => a + b, 0);
    console.log(`  duplicate-key null: ${total} rows (per-table: ${JSON.stringify(Object.fromEntries(nulledKeyDuplicates))})`);
    stagingStats.nulledKeyDuplicates = Object.fromEntries(nulledKeyDuplicates);
  }
  if (nulledLRDuplicates.size > 0) {
    const total = [...nulledLRDuplicates.values()].reduce((a, b) => a + b, 0);
    console.log(`  duplicate-(left_id,right_id) null: ${total} rows (per-table: ${JSON.stringify(Object.fromEntries(nulledLRDuplicates))})`);
    stagingStats.nulledLRDuplicates = Object.fromEntries(nulledLRDuplicates);
  }
  if (nulledCodenameDuplicates.size > 0) {
    const total = [...nulledCodenameDuplicates.values()].reduce((a, b) => a + b, 0);
    console.log(`  duplicate-codename null: ${total} rows (per-table: ${JSON.stringify(Object.fromEntries(nulledCodenameDuplicates))})`);
    stagingStats.nulledCodenameDuplicates = Object.fromEntries(nulledCodenameDuplicates);
  }
}
stagingStats.elapsedMs = Date.now() - stagingStartedAt;

console.log(
  `  ingested ${stagingStats.rowsEmitted} rows in ${(stagingStats.elapsedMs / 1000).toFixed(1)}s`,
);

console.log("\nchunk: staging DB -> chunked D1-ready SQL");

async function* readStagingRows(targetTableNames) {
  const targetTableSet = new Set(targetTableNames);
  const sortedTables = Object.keys(tableColumns)
    .filter((t) => targetTableSet.has(t) && !ENGINE_OWNED_TABLES.includes(t))
    .sort();
  for (const table of sortedTables) {
  const cols = tableColumns[table];
  const colList = cols.map((c) => `"${c}"`).join(", ");
  let lastRowid = 0;
    for (;;) {
      const r = await stagingDriver.query(
        `SELECT rowid AS __rowid, ${colList} FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`,
        [lastRowid, 10000],
      );
      if (r.rows.length === 0) break;
      for (const rec of r.rows) {
        lastRowid = Number(rec.__rowid);
        const values = cols.map((c) => rec[c]);
        yield { table, columns: cols, values };
      }
      if (r.rows.length < 10000) break;
    }
  }
}

if (process.env.DECKO_SKIP_NEST_INDEX === "1") {
  console.log("\nnest index: skipped (DECKO_SKIP_NEST_INDEX=1)");
} else {
  const built = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "tools", "deploy", "build-nest-index.mjs"), "--db", stagingPath, "--json"],
    { encoding: "utf8", windowsHide: true, timeout: 60 * 60 * 1000 },
  );
  const builtOut = `${built.stdout ?? ""}${built.stderr ?? ""}`.trim();
  if (built.status === 0) {
    console.log(`\nnest index: built (${builtOut.split("\n").slice(-1)[0]})`);
  } else {
    console.warn(`\nnest index: NOT built (exit ${built.status}) - the deck will be served by walking its nest closure`);
    if (builtOut) console.warn(`  ${builtOut.split("\n").slice(-3).join("\n  ")}`);
  }
}

const chunkStartedAt = Date.now();
const chunkResult = await writeChunkedSeed({
  rows: readStagingRows(targetTables),
  tableColumns,
  outDir: chunksDir,
  maxRows: opts.chunkRows,
  maxBytes: opts.chunkBytes,
  onProgress: (chunksWritten, rowsSeen) => {
    if (opts.quiet) return;
    process.stderr.write(`\r  chunks written: ${chunksWritten} | rows: ${rowsSeen}`);
  },
});
const chunkElapsedMs = Date.now() - chunkStartedAt;
if (!opts.quiet) process.stderr.write("\n");

console.log(
  `  wrote ${chunkResult.chunks.length} chunk file(s) (${chunkResult.totalRows} rows, ${(chunkResult.chunks.reduce((a, c) => a + c.bytes, 0) / 1048576).toFixed(1)} MiB) in ${(chunkElapsedMs / 1000).toFixed(1)}s`,
);
for (const c of chunkResult.chunks.slice(0, 5)) {
  console.log(`    ${path.basename(c.file)}: ${c.rows} rows, ${(c.bytes / 1024).toFixed(1)} KiB, tables=[${c.tables.join(", ")}]`);
}
if (chunkResult.chunks.length > 5) {
  console.log(`    ... and ${chunkResult.chunks.length - 5} more`);
}

let applyTimings = [];
let applySummary = { ok: 0, failed: 0, totalMs: 0 };
if (opts.apply) {
  console.log(`\napply: ${chunkResult.chunks.length} chunk(s) via wrangler d1 execute --local`);
  if (!existsSync(opts.applyDir)) {
    console.error(`  apply dir not found: ${opts.applyDir}`);
    process.exit(1);
  }
  const timingsLog = path.join(outDir, "apply.timings.jsonl");
  writeFileSync(timingsLog, "", "utf8");
  for (const chunk of chunkResult.chunks) {
    const t0 = Date.now();
    let log = "";
    let stderr = "";
    let code = 1;
    const relChunk = path.relative(opts.applyDir, chunk.file);
    try {
      const res = spawnSync(
        opts.wranglerBin,
        ["d1", "execute", "decko-ts-demo-db", "--local", "--file", relChunk],
        {
          cwd: opts.applyDir,
          encoding: "utf8",
          timeout: 30 * 60 * 1000,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      log = res.stdout ?? "";
      stderr = res.stderr ?? "";
      code = res.status ?? 1;
    } catch (err) {
      stderr = String(err?.message ?? err);
      code = 1;
    }
    const dt = Date.now() - t0;
    applyTimings.push({ file: path.basename(chunk.file), rows: chunk.rows, bytes: chunk.bytes, ms: dt, exitCode: code });
    writeFileSync(timingsLog, JSON.stringify(applyTimings[applyTimings.length - 1]) + "\n", { encoding: "utf8", flag: "a" });
    applySummary.totalMs += dt;
    if (code === 0) {
      applySummary.ok += 1;
      if (!opts.quiet) console.log(`  ${path.basename(chunk.file)}: ${dt} ms (${(chunk.bytes / 1048576).toFixed(2)} MiB, ${chunk.rows} rows)`);
    } else {
      applySummary.failed += 1;
      console.error(`  ${path.basename(chunk.file)}: FAILED (${dt} ms, exit ${code})`);
      const trimmed = (stderr || log || "").slice(0, 2000);
      console.error(trimmed);
      break;
    }
  }
  console.log(
    `  apply: ${applySummary.ok} ok, ${applySummary.failed} failed, total ${(applySummary.totalMs / 1000).toFixed(1)}s`,
  );
}

console.log("\nvalidate: card count, junction count, integrity");

const stagingCardsCount = (await stagingDriver.query("SELECT COUNT(*) AS n FROM cards", [])).rows[0]?.n ?? 0;
const sourceJunctionsCount = (await stagingDriver.query(
  "SELECT COUNT(*) AS n FROM cards WHERE left_id IS NOT NULL AND trash = 0",
  [],
)).rows[0]?.n ?? 0;
const sourceCardsRows = sourceKind === "sqlite"
  ? Number(stagingStats.counts?.cards ?? stagingCardsCount)
  : streamedCardsCount;

const report = await buildReport({
  targetDriver: stagingDriver,
  targetKind: opts.apply ? "sqlite-then-d1-local" : "sqlite-staging",
  targetPath: opts.apply ? `${stagingPath} -> D1 local` : stagingPath,
  sourcePath,
  sourceKind,
  sourceBytes,
  sourceCardsCount: Number(stagingCardsCount),
  sourceJunctionsCount: Number(sourceJunctionsCount),
  tableColumns,
  chunks: chunkResult.chunks,
  totalRows: chunkResult.totalRows,
});
if (opts.apply) {
  report.apply = applySummary;
  report.applyTimingsCount = applyTimings.length;
}
if (stagingStats.skippedDuplicates !== undefined) {
  report.skippedDuplicates = stagingStats.skippedDuplicates;
  report.warnings.push(
    `deduped ${Object.values(stagingStats.skippedDuplicates).reduce((a, b) => a + b, 0)} rows whose id collided with a previously-ingested row in the same table (a sanitization artifact of the source deck)`,
  );
}
if (stagingStats.rebuiltKeys !== undefined) {
  report.rebuiltKeys = stagingStats.rebuiltKeys;
}
if (stagingStats.nulledKeyDuplicates !== undefined) {
  report.nulledKeyDuplicates = stagingStats.nulledKeyDuplicates;
  report.warnings.push(
    `nulled key on ${Object.values(stagingStats.nulledKeyDuplicates).reduce((a, b) => a + b, 0)} rows whose key collided with a previously-ingested row in the same table (a sanitization artifact of the source deck; the rows still land)`,
  );
}
if (stagingStats.nulledLRDuplicates !== undefined) {
  report.nulledLRDuplicates = stagingStats.nulledLRDuplicates;
  report.warnings.push(
    `nulled right_id on ${Object.values(stagingStats.nulledLRDuplicates).reduce((a, b) => a + b, 0)} rows whose (left_id, right_id) collided (the source deck carries duplicate junction sides across revisions; the rows still land)`,
  );
}
if (stagingStats.nulledCodenameDuplicates !== undefined) {
  report.nulledCodenameDuplicates = stagingStats.nulledCodenameDuplicates;
  report.warnings.push(
    `nulled codename on ${Object.values(stagingStats.nulledCodenameDuplicates).reduce((a, b) => a + b, 0)} rows whose codename collided (a sanitization artifact of the source deck)`,
  );
}
writeReport(report, reportPath);

stagingDriver.close();

console.log(`  cards:      source=${sourceCardsRows} staging=${stagingCardsCount} (parity=${Number(stagingCardsCount) === sourceCardsRows})`);
console.log(`  junctions:  staging=${sourceJunctionsCount}`);
console.log(`  integrity:  orphans(left=${report.integrity.orphanLeftCount}, right=${report.integrity.orphanRightCount})`);
console.log(`  junction walk: ${report.integrity.junctionWalk.resolved}/${report.integrity.junctionWalk.sampled} resolved`);
console.log(`  chunks:     ${chunkResult.chunks.length} file(s), ${chunkResult.totalRows} rows total`);
console.log(`  all checks pass: ${report.allChecksPass}`);
console.log(`  report:     ${reportPath}`);

if (process.env.DECKO_KEEP_STAGING) {
  console.log(`  staging DB preserved at: ${stagingPath} (DECKO_KEEP_STAGING=1)`);
} else {
  try {
    rmSync(stagingPath, { force: true });
    rmSync(`${stagingPath}-wal`, { force: true });
    rmSync(`${stagingPath}-shm`, { force: true });
  } catch {
  }
}

let exitCode = 0;
if (opts.apply && applySummary.failed > 0) exitCode = 1;
if (opts.strict && !report.allChecksPass) exitCode = 1;
process.exit(exitCode);
