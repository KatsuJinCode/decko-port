import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { LocalSqliteToolDriver } from "./import.mjs";
import { verifyMigration } from "./verify.mjs";
import { importFromSqlite } from "./generalized-import.mjs";
import { buildRoundtripReport, renderRoundtripMd } from "./roundtrip-report.mjs";
import { proveDeterminism } from "./determinism.mjs";
import { inventorySource, openSourceSqlite } from "./source-sqlite.mjs";
import { parseTargetSchema } from "./import.mjs";
import { classifySourceTable } from "./schema-map.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "..", "..");
const DEFAULT_DDL = path.join(REPO_ROOT, "db", "schema.sqlite.sql");
const SCRATCH_ROOT = path.join(TOOL_ROOT, "scratch-out");

function usage(exitCode = 0) {
  const lines = [
    "Usage: node tools/migrate/migrate-generalized.mjs --source <deck.sqlite> --out <deck.sqlite> [options]",
    "",
    "Required:",
    "  --source <file>      Ruby decko SQLite database to migrate (read-only)",
    "  --out <file>         Target SQLite database path (must not exist without --append)",
    "",
    "Options:",
    "  --verify             Run per-table count + checksum parity (verify.mjs)",
    "  --strict             Exit nonzero when parity checks fail",
    "  --determinism        Import the deck TWICE into fresh DBs and assert",
    "                       byte-identical output (per-row hash check)",
    "  --mod-compat         Read tools/compat-report/mod-compat-report.json",
    "                       (regenerate with tools/compat-report/generate-mod-compat-report.mjs)",
    "                       and copy a per-deck summary into the migration report",
    "  --report <file>      Migration report JSON path (default <out>.migrate-report.json)",
    "  --roundtrip <file>   Round-trip report markdown path (default <out>.roundtrip.md)",
    "  --batch <n>          Rows per transaction (default 1000)",
    "  --append             Import into an existing database",
    "  --max-errors <n>     Keep going past per-row insert failures, up to n",
    "  --ddl <file>         Alternate target DDL (default db/schema.sqlite.sql)",
    "  --quiet              No progress output",
    "",
    "The migration report is content-free (ids, counts, hashes - never card names/content).",
  ];
  console.log(lines.join("\n"));
  process.exit(exitCode);
}

function parseArgs(argv) {
  const opts = {
    source: undefined,
    out: undefined,
    verify: false,
    strict: false,
    determinism: false,
    modCompat: false,
    report: undefined,
    roundtrip: undefined,
    batch: 1000,
    append: false,
    maxErrors: 0,
    ddl: DEFAULT_DDL,
    quiet: false,
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
      case "--out": opts.out = val(); break;
      case "--verify": opts.verify = true; break;
      case "--strict": opts.strict = true; break;
      case "--determinism": opts.determinism = true; break;
      case "--mod-compat": opts.modCompat = true; break;
      case "--report": opts.report = val(); break;
      case "--roundtrip": opts.roundtrip = val(); break;
      case "--batch": opts.batch = Number(val()); break;
      case "--append": opts.append = true; break;
      case "--max-errors": opts.maxErrors = Number(val()); break;
      case "--ddl": opts.ddl = path.resolve(val()); break;
      case "--quiet": opts.quiet = true; break;
      case "--help": case "-h": usage(0); break;
      default:
        console.error(`unknown argument: ${a}`);
        usage(1);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.source || !opts.out) usage(1);
if (!existsSync(opts.source)) {
  console.error(`source not found: ${opts.source}`);
  process.exit(1);
}
if (!existsSync(opts.ddl)) {
  console.error(`target DDL not found: ${opts.ddl}`);
  process.exit(1);
}
if (existsSync(opts.out) && !opts.append) {
  console.error(`target already exists: ${opts.out} (pass --append to import into it anyway)`);
  process.exit(1);
}

const outDir = path.dirname(path.resolve(opts.out));
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const reportPath = opts.report ?? `${opts.out}.migrate-report.json`;
const roundtripPath = opts.roundtrip ?? `${opts.out}.roundtrip.md`;

console.log(`migrate-generalized: ${opts.source}`);
console.log(`    -> ${opts.out}`);

{
  const sourceDb = openSourceSqlite(opts.source);
  try {
    const inv = inventorySource(sourceDb);
    const targetSchema = parseTargetSchema(opts.ddl);
    const targetTableNames = Object.keys(targetSchema.tableColumns);
    console.log("\nsource inventory:");
    for (const [name, info] of Object.entries(inv)) {
      const role = classifySourceTable(name, targetTableNames);
      console.log(`  ${name}: ${info.rowCount} rows (${info.columns.length} cols) -> ${role}`);
    }
  } finally {
    sourceDb.close();
  }
}

const driver = new LocalSqliteToolDriver(opts.out);
const t0 = Date.now();
let stats;
try {
  stats = await importFromSqlite({
    sourcePath: opts.source,
    driver,
    ddlPath: opts.ddl,
    batchSize: opts.batch,
    maxErrors: opts.maxErrors,
    append: opts.append,
    onProgress: (bytes, rows) => {
      if (opts.quiet) return;
      const secs = (Date.now() - t0) / 1000;
      const rate = secs > 0 ? (rows / secs).toFixed(0) : "?";
      process.stderr.write(`\r  ${rows} rows | ${rate} rows/s`);
    },
  });
} catch (err) {
  driver.close();
  console.error(`\nimport failed: ${err?.message ?? err}`);
  process.exit(1);
}

if (!opts.quiet) process.stderr.write("\n");
console.log(
  `\nimported ${stats.rowsEmitted} rows in ${(stats.elapsedMs / 1000).toFixed(1)}s`,
);
for (const [table, count] of Object.entries(stats.counts)) {
  console.log(`  ${table}: ${count}`);
}
if (Object.keys(stats.skippedTables).length > 0) {
  console.log(`  skipped tables: ${JSON.stringify(stats.skippedTables)}`);
}
if (stats.keyRepair.derived > 0 || stats.keyRepair.nullSimpleKeys > 0) {
  console.log(
    `  key repair: ${stats.keyRepair.derived} derived, ${stats.keyRepair.nullSimpleKeys} null-simple-keys`,
  );
}
if (stats.keyRepair.lexResolved > 0 || stats.keyRepair.lexUnresolved > 0) {
  console.log(
    `  name reconstruct: ${stats.keyRepair.lexResolved} lex-resolved, ${stats.keyRepair.lexUnresolved} unresolved`,
  );
}
if (stats.errors.length > 0) {
  console.log(`  row errors: ${stats.errors.length} (see report)`);
}
if (stats.settingsInventory.tables.length > 0) {
  console.log(
    `  settings inventory: ${stats.settingsInventory.tables.length} table(s), ${stats.settingsInventory.totalCount} row(s) — NOT imported (decko-ts stores settings as cards)`,
  );
}

const targetSchema = parseTargetSchema(opts.ddl);
const targetTableNames = Object.keys(targetSchema.tableColumns);
const targetCounts = {};
for (const t of targetTableNames) {
  const r = await driver.query(`SELECT COUNT(*) AS n FROM "${t}"`, []);
  targetCounts[t] = Number(r.rows[0]?.n ?? 0);
}
const sourceDb = openSourceSqlite(opts.source);
let roundtripReport;
try {
  roundtripReport = buildRoundtripReport({
    sourceDb,
    sourcePath: opts.source,
    targetCounts,
    targetTableNames,
  });
} finally {
  sourceDb.close();
}
writeFileSync(roundtripPath, renderRoundtripMd(roundtripReport), "utf8");
console.log(`\nround-trip report: ${roundtripPath}`);
console.log(`  totals: source=${roundtripReport.totals.source} target=${roundtripReport.totals.target}`);
if (roundtripReport.dropCount > 0) {
  console.log(`  dropped: ${roundtripReport.dropCount} rows from unknown source tables (${roundtripReport.unknownTables.join(", ")})`);
}

let report;
if (opts.verify) {
  report = await verifyMigration({
    dumpPath: opts.source,
    driver,
    ddlPath: opts.ddl,
    importStats: stats,
    spotCount: 25,
    reportPath,
  });
  console.log(`\nverification: allParity=${report.allParity}`);
  console.log(`  report: ${reportPath}`);
}

let determinismResult;
if (opts.determinism) {
  if (!existsSync(SCRATCH_ROOT)) mkdirSync(SCRATCH_ROOT, { recursive: true });
  const freshA = path.join(SCRATCH_ROOT, `det-A-${Date.now()}.sqlite`);
  const freshB = path.join(SCRATCH_ROOT, `det-B-${Date.now()}.sqlite`);
  console.log(`\ndeterminism: importing twice into fresh DBs...`);
  try {
    determinismResult = await proveDeterminism({
      importFn: ({ driver, ddlPath }) =>
        importFromSqlite({
          sourcePath: opts.source,
          driver,
          ddlPath,
          batchSize: opts.batch,
          maxErrors: opts.maxErrors,
        }),
      ddlPath: opts.ddl,
      freshPathA: freshA,
      freshPathB: freshB,
      tableList: targetTableNames,
    });
    const failed = Object.entries(determinismResult.tables)
      .filter(([, t]) => !t.idsMatch || !t.hashesMatch)
      .map(([name]) => name);
    if (failed.length === 0) {
      console.log(`  all ${Object.keys(determinismResult.tables).length} tables: deterministic (per-row hashes match)`);
    } else {
      console.log(`  NON-DETERMINISTIC TABLES: ${failed.join(", ")}`);
    }
  } finally {
    rmSync(freshA, { force: true });
    rmSync(freshB, { force: true });
  }
}

let modCompatSummary;
if (opts.modCompat) {
  const compatPath = path.join(REPO_ROOT, "tools", "compat-report", "mod-compat-report.json");
  if (!existsSync(compatPath)) {
    console.warn(`\nmod-compat: ${compatPath} not found; run tools/compat-report/generate-mod-compat-report.mjs first`);
  } else {
    try {
      const compat = JSON.parse(readFileSync(compatPath, "utf8"));
      const byStatus = { "declared-complete": 0, partial: 0, missing: 0, ignored: 0 };
      for (const m of compat.mods ?? []) {
        const s = m.classification?.status ?? "missing";
        byStatus[s] = (byStatus[s] ?? 0) + 1;
      }
      modCompatSummary = {
        source: compatPath,
        generatedAt: compat.generatedAt,
        summary: byStatus,
        mods: (compat.mods ?? []).map((m) => ({
          gem: m.gem,
          status: m.classification?.status,
          verdict: m.classification?.verdict,
        })),
      };
      console.log(`\nmod-compat:`);
      console.log(`  declared-complete:  ${byStatus["declared-complete"] ?? 0}`);
      console.log(`  partial: ${byStatus.partial ?? 0}`);
      console.log(`  missing: ${byStatus.missing ?? 0}`);
      console.log(`  ignored: ${byStatus.ignored ?? 0}`);
    } catch (err) {
      console.warn(`\nmod-compat: failed to read ${compatPath}: ${err?.message ?? err}`);
    }
  }
}

if (opts.verify) {
  const merged = {
    ...report,
    roundtrip: roundtripReport,
    determinism: determinismResult,
    modCompat: modCompatSummary,
  };
  writeFileSync(reportPath, JSON.stringify(merged, null, 2), "utf8");
}

driver.close();

let exitCode = 0;
if (stats.errors.length > 0) exitCode = 1;
if (opts.verify && report !== undefined && !report.allParity && opts.strict) exitCode = 1;
if (opts.determinism && determinismResult !== undefined && !determinismResult.allTablesDeterministic) {
  exitCode = 1;
}
process.exit(exitCode);