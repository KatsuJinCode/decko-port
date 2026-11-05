import { basename } from "node:path";
import { writeFileSync } from "node:fs";
import {
  ENGINE_OWNED_TABLES,
  checksumTargetTable,
  parseTargetSchema,
} from "./import.mjs";
import { verifyDeckFiles } from "./files.mjs";

export async function checkTargetReadiness(driver, schema) {
  const exists = async (type, name) =>
    Number(
      (await driver.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = ? AND name = ?", [type, name]))
        .rows[0]?.n ?? 0,
    ) > 0;
  let stampRow = false;
  if (await exists("table", "deck_data_version")) {
    const row = (await driver.query('SELECT "version" FROM "deck_data_version" WHERE "id" = 1', [])).rows[0];
    stampRow = typeof row?.version === "number";
  }
  const triggerNames = schema.createTriggers
    .map((statement) => /^CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/i.exec(statement)?.[1])
    .filter((name) => name !== undefined);
  let triggersPresent = 0;
  for (const name of triggerNames) if (await exists("trigger", name)) triggersPresent += 1;
  const sessionTable = await exists("table", "auth_sessions");
  const interrupted = await exists("table", "decko_import_progress");
  return {
    stampRow,
    freshnessTriggers: { present: triggersPresent, expected: triggerNames.length },
    sessionTable,
    importComplete: !interrupted,
    ok: stampRow && triggersPresent === triggerNames.length && sessionTable && !interrupted,
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

export async function walkJunctionName(driver, id, depth = 0, maxDepth = 64) {
  const result = await driver.query(
    "SELECT name, left_id, right_id FROM cards WHERE id = ? LIMIT 1",
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) return { name: null, resolved: false, depth };
  if (depth > maxDepth) return { name: row.name ?? null, resolved: false, depth };
  if (row.left_id === null || row.left_id === undefined) {
    return { name: row.name ?? "", resolved: row.name !== null, depth };
  }
  const left = await walkJunctionName(driver, row.left_id, depth + 1, maxDepth);
  const right =
    row.right_id === null || row.right_id === undefined
      ? { name: "", resolved: true, depth }
      : await walkJunctionName(driver, row.right_id, depth + 1, maxDepth);
  if (!left.resolved || !right.resolved) {
    return { name: null, resolved: false, depth };
  }
  return { name: `${left.name}+${right.name}`, resolved: true, depth };
}

async function sampleCompoundIds(driver, spotCount, seed) {
  const rand = mulberry32(seed);
  const range = await driver.query(
    `SELECT MIN(id) AS lo, MAX(id) AS hi, COUNT(*) AS n FROM cards
     WHERE left_id IS NOT NULL AND trash = 0`,
    [],
  );
  const stats = range.rows[0] ?? {};
  const lo = Number(stats.lo);
  const hi = Number(stats.hi);
  const n = Number(stats.n ?? 0);
  if (n === 0 || Number.isNaN(lo) || Number.isNaN(hi)) return [];
  const wanted = Math.min(spotCount, n);
  const ids = [];
  let threshold = lo + Math.floor(rand() * Math.max(1, Math.floor((hi - lo) / wanted)));
  const stride = Math.max(1, Math.floor((hi - lo) / wanted));
  while (ids.length < wanted && threshold <= hi) {
    const hit = await driver.query(
      `SELECT id FROM cards WHERE left_id IS NOT NULL AND trash = 0 AND id >= ?
       ORDER BY id LIMIT 1`,
      [threshold],
    );
    const id = hit.rows[0]?.id;
    if (id === undefined) break;
    if (ids[ids.length - 1] !== id) ids.push(id);
    threshold = Number(id) + stride;
  }
  return ids;
}

export async function verifyMigration(opts) {
  const started = Date.now();
  const seed = opts.seed ?? 0xdec000;
  const spotCount = opts.spotCount ?? 25;
  const { driver, importStats } = opts;

  const schema = parseTargetSchema(opts.ddlPath);

  const tables = {};
  for (const table of Object.keys(schema.tableColumns).filter((t) => !ENGINE_OWNED_TABLES.includes(t))) {
    const source = importStats.checksums[table] ?? null;
    const target = await checksumTargetTable(
      driver,
      table,
      schema.tableColumns[table],
    );
    const sourceCount = source === null ? 0 : source.count;
    tables[table] = {
      sourceCount,
      targetCount: target.count,
      countParity: sourceCount === target.count,
      checksumSource: source === null ? null : source.sum,
      checksumTarget: target.sum,
      checksumParity: source === null ? null : source.sum === target.sum,
      minIdSource: source === null ? null : source.minId,
      minIdTarget: target.minId,
      maxIdSource: source === null ? null : source.maxId,
      maxIdTarget: target.maxId,
    };
  }

  const junction = { sampled: 0, resolved: 0, unresolvedIds: [] };
  const sampleIds = await sampleCompoundIds(driver, spotCount, seed);
  for (const id of sampleIds) {
    const walked = await walkJunctionName(driver, id);
    junction.sampled += 1;
    if (walked.resolved && (walked.name ?? "") !== "") junction.resolved += 1;
    else if (junction.unresolvedIds.length < 20) junction.unresolvedIds.push(id);
  }

  let engine = { status: "skipped", reason: "no engine checks provider" };
  if (opts.engineChecks !== undefined) {
    try {
      const result = await opts.engineChecks({ driver, spotCount, seed });
      engine = { ...result, status: "ok" };
    } catch (err) {
      engine = { status: "error", reason: String(err?.message ?? err).slice(0, 300) };
    }
  }

  const readiness = await checkTargetReadiness(driver, schema);
  const files = await verifyDeckFiles({
    driver,
    sourceDir: opts.filesSourceDir,
    targetDir: opts.filesTargetDir,
    copy: opts.filesCopy,
  });

  const cards = tables["cards"] ?? null;
  const allParity = Object.values(tables).every((t) => t.countParity && t.checksumParity !== false);
  const report = {
    tool: "decko-ts migrate",
    timestamp: new Date().toISOString(),
    dump: { file: basename(opts.dumpPath), bytes: importStats.bytesRead },
    import: {
      elapsedMs: importStats.elapsedMs,
      rowsEmitted: importStats.rowsEmitted,
      dumpSha256: importStats.dump?.sha256 ?? null,
      resumedFromRow: importStats.resumedFromRow ?? 0,
      engineMigrations: importStats.engineMigrations ?? [],
      keyRepair: importStats.keyRepair,
      errors: importStats.errors,
      skippedTables: importStats.skippedTables,
    },
    cards:
      cards === null
        ? null
        : { sourceCount: cards.sourceCount, targetCount: cards.targetCount, parity: cards.countParity },
    tables,
    junction,
    engine,
    readiness,
    files,
    outOfScope: OUT_OF_SCOPE,
    allParity,
    ok:
      allParity &&
      junction.resolved === junction.sampled &&
      readiness.ok &&
      files.status === "ok" &&
      engine.status !== "error" &&
      (engine.status !== "ok" || engine.spotRender === undefined || engine.spotRender.renderErrors === 0) &&
      importStats.errors.length === 0,
    warnings: importStats.warnings,
    verifyElapsedMs: Date.now() - started,
  };
  if (opts.reportPath !== undefined) {
    writeFileSync(opts.reportPath, JSON.stringify(report, null, 2), "utf8");
  }
  return report;
}

export const OUT_OF_SCOPE = [
  "attachments/files: uploads live on disk, never inside a mysqldump - pass --files <the deck's files directory> and they are copied and checked file by file; files in a cloud bucket or at a web address stay where they are",
  "user credentials/accounts: there is no users table in modern decko (user data became cards in the 2014 transform migration); account cards import as data, their salted SHA-1 password digests verify on sign-in, and signed-in sessions start fresh",
  "rails sessions: the sessions table imports as-is if present but is inert in decko-ts (no Rails session store)",
  "background jobs: delayed_jobs rows import as-is but are stale queue state, not source of truth",
  "site-custom tables: any table outside the 12 core tables is skipped and reported in skippedTables",
  "ruby code assets: set modules, HAML views, and mod files are code, not data; behavior parity is the decko-ts mod layer's job",
  "search/caches: card_virtuals is a materialized cache and imports only for id fidelity; treat it as stale",
];
