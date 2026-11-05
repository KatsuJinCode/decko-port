import { spawnSync } from "node:child_process";
import { existsSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { LocalSqliteToolDriver, importDump } from "./import.mjs";
import { verifyMigration } from "./verify.mjs";
import { copyDeckFiles } from "./files.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "..", "..");
const DEFAULT_DDL = path.join(REPO_ROOT, "db", "schema.sqlite.sql");

function usage(exitCode = 0) {
  const lines = [
    "Usage: node tools/migrate/migrate.mjs --dump <mysqldump.sql> --out <deck.sqlite> [options]",
    "",
    "Required:",
    "  --dump <file>       Ruby Decko mysqldump to migrate (hashed, then parsed streaming)",
    "  --out <file>        Target SQLite database path (must not exist without --append)",
    "",
    "Options:",
    "  --verify            Run post-import verification (count/checksum parity, junction walk)",
    "  --engine-verify     Also run engine-level checks (spot render via decko-ts RenderEngine,",
    "                      Ruby-fixture byte comparison) through the repo's vitest runner",
    "  --report <file>     Migration report path (default <out>.migrate-report.json)",
    "  --spot <n>          Random cards to spot-check (default 25)",
    "  --tables <a,b,c>    Import only these tables (default: all core tables)",
    "  --batch <n>         Rows per transaction (default 1000)",
    "  --append            Import into an existing database instead of refusing",
    "  --resume            Continue an interrupted import into --out from its last committed batch",
    "  --files <dir>       The Ruby deck's files directory (uploads); copied and checked file by file",
    "  --files-out <dir>   Where the files go (default: files/ beside --out, the Node host's default)",
    "  --max-errors <n>    Keep going past per-row insert failures, up to n (default 0)",
    "  --ddl <file>        Alternate target DDL (default db/schema.sqlite.sql)",
    "  --tolerant          Tolerate a truncated dump tail instead of failing",
    "  --strict            Exit nonzero unless verification passes: parity, readiness, files, engine",
    "  --quiet             No per-chunk progress output",
    "",
    "The JSON report is content-free (ids, counts, hashes - never card names or content).",
  ];
  console.log(lines.join("\n"));
  process.exit(exitCode);
}

function parseArgs(argv) {
  const opts = {
    dump: undefined,
    out: undefined,
    verify: false,
    engineVerify: false,
    report: undefined,
    spot: 25,
    tables: undefined,
    batch: 1000,
    append: false,
    resume: false,
    files: undefined,
    filesOut: undefined,
    maxErrors: 0,
    ddl: DEFAULT_DDL,
    tolerant: false,
    strict: false,
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
      case "--dump": opts.dump = val(); break;
      case "--out": opts.out = val(); break;
      case "--verify": opts.verify = true; break;
      case "--engine-verify": opts.engineVerify = true; opts.verify = true; break;
      case "--report": opts.report = val(); break;
      case "--spot": opts.spot = Number(val()); break;
      case "--tables": opts.tables = val().split(",").map((s) => s.trim()); break;
      case "--batch": opts.batch = Number(val()); break;
      case "--append": opts.append = true; break;
      case "--resume": opts.resume = true; break;
      case "--files": opts.files = path.resolve(val()); break;
      case "--files-out": opts.filesOut = path.resolve(val()); break;
      case "--max-errors": opts.maxErrors = Number(val()); break;
      case "--ddl": opts.ddl = path.resolve(val()); break;
      case "--tolerant": opts.tolerant = true; break;
      case "--strict": opts.strict = true; break;
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
if (!opts.dump || !opts.out) usage(1);
if (!existsSync(opts.dump)) {
  console.error(`dump not found: ${opts.dump}`);
  process.exit(1);
}
if (!existsSync(opts.ddl)) {
  console.error(`target DDL not found: ${opts.ddl}`);
  process.exit(1);
}
if (existsSync(opts.out) && !opts.append && !opts.resume) {
  console.error(
    `target already exists: ${opts.out} (pass --resume to continue an interrupted import into it, or --append to import into it anyway)`,
  );
  process.exit(1);
}
if (opts.resume && !existsSync(opts.out)) {
  console.error(`nothing to resume: ${opts.out} does not exist`);
  process.exit(1);
}
if (opts.files !== undefined && !existsSync(opts.files)) {
  console.error(`files directory not found: ${opts.files}`);
  process.exit(1);
}

const reportPath = opts.report ?? `${opts.out}.migrate-report.json`;
const filesOut = opts.filesOut ?? path.join(path.dirname(path.resolve(opts.out)), "files");

console.log(`migrate: ${opts.dump}`);
console.log(`    -> ${opts.out}${opts.resume ? " (resuming)" : ""}`);

const driver = new LocalSqliteToolDriver(opts.out);
const t0 = Date.now();

const crashAfter = Number(process.env.DECKO_MIGRATE_FAULT_AFTER_CHECKPOINTS ?? "0");
let checkpoints = 0;

let stats;
try {
  stats = await importDump({
    dumpPath: opts.dump,
    driver,
    ddlPath: opts.ddl,
    tables: opts.tables,
    batchSize: opts.batch,
    maxErrors: opts.maxErrors,
    append: opts.append,
    resume: opts.resume,
    onCheckpoint: (rowsDone) => {
      checkpoints += 1;
      if (!opts.quiet) process.stderr.write(`\r  checkpoint: ${rowsDone} dump rows committed`);
      if (crashAfter > 0 && checkpoints >= crashAfter) process.kill(process.pid, "SIGKILL");
    },
    onProgress: (bytes, rows) => {
      if (opts.quiet) return;
      const secs = (Date.now() - t0) / 1000;
      const mb = (bytes / 1048576).toFixed(0);
      const rate = secs > 0 ? (bytes / 1048576 / secs).toFixed(1) : "?";
      process.stderr.write(
        `\r  ${mb} MB read, ${rows} rows | ${rate} MB/s`,
      );
    },
  });
} catch (err) {
  driver.close();
  console.error(`\nimport failed: ${err?.message ?? err}`);
  console.error("  the database keeps every committed batch; rerun with --resume to continue");
  process.exit(1);
}

if (!opts.quiet) process.stderr.write("\n");
console.log(
  `imported ${stats.rowsEmitted} rows in ${(stats.elapsedMs / 1000).toFixed(1)}s ` +
    `(${(stats.bytesRead / 1048576).toFixed(0)} MB)` +
    (stats.resumedFromRow > 0 ? `, resumed after ${stats.resumedFromRow} committed rows` : ""),
);
for (const [table, count] of Object.entries(stats.counts)) {
  console.log(`  ${table}: ${count}`);
}
if (Object.keys(stats.skippedTables).length > 0) {
  console.log(`  skipped tables (not in core schema): ${JSON.stringify(stats.skippedTables)}`);
}
if (stats.keyRepair.derived > 0 || stats.keyRepair.nullSimpleKeys > 0) {
  console.log(
    `  key repair: ${stats.keyRepair.derived} derived, ${stats.keyRepair.nullSimpleKeys} simple cards without keys left NULL`,
  );
}
if (stats.errors.length > 0) {
  console.log(`  row errors: ${stats.errors.length} (see report)`);
}

let filesCopy;
if (opts.files !== undefined) {
  filesCopy = copyDeckFiles({ sourceDir: opts.files, targetDir: filesOut });
  console.log(
    `files: ${filesCopy.files} (${(filesCopy.bytes / 1048576).toFixed(1)} MB) -> ${filesOut}; ` +
      `${filesCopy.copied} copied, ${filesCopy.alreadyPresent} already present, ${filesCopy.mismatched.length} mismatched`,
  );
}

let report;
if (opts.verify) {
  let engineBridge;
  try {
    engineBridge = await import("./engine-bridge.mjs");
  } catch {
    engineBridge = undefined;
  }

  report = await verifyMigration({
    dumpPath: opts.dump,
    driver,
    ddlPath: opts.ddl,
    importStats: stats,
    engineChecks: engineBridge?.engineChecks,
    spotCount: opts.spot,
    filesSourceDir: opts.files,
    filesTargetDir: opts.files === undefined ? undefined : filesOut,
    filesCopy,
    reportPath,
  });

  if (engineBridge === undefined && opts.engineVerify) {
    await runEngineVerificationSpawn(opts, reportPath);
    try {
      const spawned = JSON.parse(readFileSync(`${reportPath}.engine.json`, "utf8"));
      report.engine = spawned;
      report.ok =
        report.ok && spawned.status === "ok" && (spawned.spotRender?.renderErrors ?? 0) === 0;
      rmSync(`${reportPath}.engine.json`, { force: true });
    } catch {
      report.engine = { status: "error", reason: "the engine verification run produced no result" };
      report.ok = false;
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  }

  console.log("\nverification:");
  console.log(`  cards: source=${report.cards?.sourceCount} target=${report.cards?.targetCount} parity=${report.cards?.parity}`);
  const failedTables = Object.entries(report.tables)
    .filter(([, t]) => !t.countParity || t.checksumParity === false)
    .map(([name]) => name);
  if (failedTables.length === 0) {
    console.log(`  all ${Object.keys(report.tables).length} tables: count + checksum parity`);
  } else {
    console.log(`  PARITY FAILURES: ${failedTables.join(", ")}`);
  }
  console.log(`  junction walk: ${report.junction.resolved}/${report.junction.sampled} resolved`);
  const r = report.readiness;
  console.log(
    `  engine readiness: stamp row ${r.stampRow ? "present" : "MISSING"}, freshness triggers ` +
      `${r.freshnessTriggers.present}/${r.freshnessTriggers.expected}, session table ${r.sessionTable ? "present" : "MISSING"}`,
  );
  const f = report.files;
  console.log(
    `  files: ${f.status}; referenced ${f.referenced.current} current + ${f.referenced.history} in history, ` +
      `present ${f.present.current} + ${f.present.history}, lost ${f.lost}` +
      (f.status === "not-migrated" ? " (pass --files <the Ruby deck's files directory>)" : ""),
  );
  console.log(`  engine checks: ${report.engine.status}`);
  if (report.engine.status === "ok") {
    const sr = report.engine.spotRender;
    const fx = report.engine.fixtures;
    console.log(
      `    spot render: ${sr.rendered} views over ${sr.sampled} cards` +
        ` (${sr.renderErrors} errors, ${sr.contentContainedHits}/${sr.sampled} content-contained)`,
    );
    console.log(
      `    fixtures: ${fx.cardsPresent} present, content parity ${fx.contentParityHits}/${fx.contentParityChecked}` +
        `, rendered compared ${fx.renderedCompared} (${fx.renderedMismatched} mismatched)`,
    );
  }
  console.log(`  verdict: ${report.ok ? "ok" : "NOT OK"}`);
  console.log(`  report: ${reportPath}`);
}

driver.close();

let exitCode = 0;
if (stats.errors.length > 0) exitCode = 1;
if (opts.verify && report !== undefined && !report.ok && opts.strict) exitCode = 1;
process.exit(exitCode);

async function runEngineVerificationSpawn(opts, reportPath) {
  const vitestMjs = path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");
  if (!existsSync(vitestMjs)) {
    console.error("  engine checks: vitest not found in node_modules; skipping");
    return;
  }
  console.log("  engine checks (via vitest runner)...");
  const result = spawnSync(
    process.execPath,
    [vitestMjs, "run", "tests/migrate/cli-engine-verification.test.ts"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 15 * 60 * 1000,
      stdio: opts.quiet ? "pipe" : "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        DECKO_MIGRATE_REPORT: reportPath,
        DECKO_MIGRATE_TARGET: opts.out,
        DECKO_MIGRATE_DDL: opts.ddl,
        DECKO_MIGRATE_SPOT: String(opts.spot),
      },
    },
  );
  if (result.error !== undefined || (result.status ?? 1) !== 0) {
    console.error("  engine checks spawn failed (continuing; engine status notes it)");
  }
}
