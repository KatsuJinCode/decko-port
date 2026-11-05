#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { parseTargetSchema } from "./import.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const DDL = path.join(REPO_ROOT, "db", "schema.sqlite.sql");

function parseArgs(argv) {
  const opts = { deck: undefined, work: undefined, keep: false, summary: undefined, rebuildKeys: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rebuild-keys") opts.rebuildKeys = true;
    else if (a === "--deck") opts.deck = argv[++i];
    else if (a === "--work") opts.work = argv[++i];
    else if (a === "--summary") opts.summary = argv[++i];
    else if (a === "--keep") opts.keep = true;
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!opts.deck || !opts.work) {
    console.error("usage: prove-deck-migration.mjs --deck <deck.sqlite> --work <dir> [--rebuild-keys] [--keep] [--summary <file>]");
    process.exit(2);
  }
  return opts;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

function runNode(args, label, env = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT, encoding: "utf8", windowsHide: true, maxBuffer: 1 << 30, env: { ...process.env, ...env },
  });
  const ms = Date.now() - t0;
  if (r.error) throw r.error;
  if (r.status !== 0) {
    console.error(`${label} failed (exit ${r.status})`);
    console.error(r.stderr);
    throw new Error(`${label} failed (exit ${r.status}, signal ${r.signal})`);
  }
  return { stdout: r.stdout, stderr: r.stderr, ms };
}

const targetColumn = (c) => (c === "content" ? "db_content" : c);

const INTEGER_TEXT = /^[+-]?\d+$/;
function withAffinity(value, declaredType) {
  if (typeof value === "string" && /INT/i.test(declaredType ?? "") && INTEGER_TEXT.test(value.trim())) {
    const n = Number(value.trim());
    if (Number.isSafeInteger(n)) return n;
  }
  return value;
}
const same = (a, b) => (a === null || a === undefined ? b === null || b === undefined : a === b);

const opts = parseArgs(process.argv.slice(2));
const work = path.resolve(opts.work);
mkdirSync(work);
const ownedWorkPath = realpathSync(work);
const ownedWorkIdentity = lstatSync(work);
if (!ownedWorkIdentity.isDirectory() || ownedWorkIdentity.isSymbolicLink()) {
  throw new Error("Migration proof workspace is not an owned directory");
}
const summary = { deckBytes: 0, steps: {} };
const started = Date.now();

try {
  const source = path.join(work, "source.sqlite3");
  copyFileSync(opts.deck, source);
  const [origSha, copySha] = await Promise.all([sha256File(opts.deck), sha256File(source)]);
  if (origSha !== copySha) throw new Error("scratch copy does not match the deck");
  summary.steps.copy = { shaMatch: true };

  const staging = path.join(work, "staging.sqlite");
  const outDir = path.join(work, "out");
  const imp = runNode(
    [
      path.join(HERE, "import-deck.mjs"),
      "--source", source, "--dedup", "--out-dir", outDir, "--staging", staging,
      "--chunk-rows", "500", "--chunk-bytes", "1048576", "--quiet",
      ...(opts.rebuildKeys ? ["--rebuild-keys"] : []),
    ],
    "import-deck",
    { DECKO_KEEP_STAGING: "1" },
  );
  const report = JSON.parse(readFileSync(path.join(outDir, "report.json"), "utf8"));
  const chunkFiles = readdirSync(path.join(outDir, "chunks")).filter((f) => f.endsWith(".sql"));
  const nulledKeys = /duplicate-key null: (\d+)/.exec(imp.stdout);
  summary.steps.import = {
    ms: imp.ms,
    chunks: chunkFiles.length,
    rows: Number(/(\d+) rows total/.exec(imp.stdout)?.[1] ?? NaN),
    duplicateKeyNulled: nulledKeys ? Number(nulledKeys[1]) : 0,
    validatorAllChecksPass: report.allChecksPass ?? report.all_checks_pass ?? null,
    rebuiltKeys: report.rebuiltKeys ?? null,
  };

  const d1Persist = path.join(work, "d1");
  const mfOptions = convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "migration-proof" },
    resourcePersistencePath: d1Persist,
    compatibilityDate: "2026-09-01",
  });
  const schema = parseTargetSchema(DDL);
  let t0 = Date.now();
  {
    const mf = new Miniflare(mfOptions);
    const db = await mf.getD1Database("DB");
    for (const stmt of [...schema.createTables, ...schema.createIndexes]) await db.prepare(stmt).run();
    await mf.dispose();
  }
  const d1Files = readdirSync(d1Persist, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".sqlite") && !f.includes("metadata"));
  if (d1Files.length !== 1) throw new Error(`expected one D1 database file, found ${d1Files.length}`);
  const apply = runNode(
    [path.join(HERE, "apply-chunks-to-d1-local.mjs"), path.join(outDir, "chunks"), "--d1-path", path.join(d1Persist, d1Files[0])],
    "apply-chunks-to-d1-local",
  );
  {
    const mf = new Miniflare(mfOptions);
    const db = await mf.getD1Database("DB");
    for (const stmt of [...schema.postLoadStatements, ...schema.createTriggers]) await db.prepare(stmt).run();
    await mf.dispose();
  }
  summary.steps.d1Apply = { ms: Date.now() - t0, applierMs: apply.ms };

  t0 = Date.now();
  const src = new Database(source, { readonly: true, fileMustExist: true });
  const stg = new Database(staging, { readonly: true, fileMustExist: true });
  const mf = new Miniflare(mfOptions);
  const d1 = await mf.getD1Database("DB");
  const verify = {};
  const deriveKey = opts.rebuildKeys ? await (await import("./load-derive-key.mjs")).loadDeriveKey() : undefined;
  const derivedKeyCache = new Map();
  for (const table of ["cards", "card_references"]) {
    const srcCols = src.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
    const tgtCols = srcCols.map(targetColumn);
    const declared = new Map(stg.prepare(`PRAGMA table_info("${table}")`).all().map((c) => [c.name, c.type]));
    const tgtTypes = tgtCols.map((c) => declared.get(c));
    const keyCol = table === "cards" ? srcCols.indexOf("key") : -1;
    const tgtList = tgtCols.map((c) => `"${c}"`).join(", ");
    const srcCount = src.prepare(`SELECT COUNT(*) n FROM "${table}"`).get().n;
    const stgCount = stg.prepare(`SELECT COUNT(*) n FROM "${table}"`).get().n;
    const d1Count = (await d1.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).first()).n;
    const stats = {
      source: srcCount, staging: stgCount, d1: d1Count,
      stagingMismatchedRows: 0, d1MismatchedRows: 0,
      mismatchedColumns: {}, missingInStaging: 0, missingInD1: 0,
      ...(deriveKey !== undefined && table === "cards"
        ? { keyRebuilt: { staging: 0, d1: 0 }, keyNulledByCollision: { staging: 0, d1: 0 } }
        : {}),
    };
    const PAGE = 5000;
    let last = -1;
    for (;;) {
      const srcRows = src.prepare(`SELECT ${srcCols.map((c) => `"${c}"`).join(", ")} FROM "${table}" WHERE id > ? ORDER BY id LIMIT ?`).all(last, PAGE);
      if (srcRows.length === 0) break;
      const lo = srcRows[0].id;
      const hi = srcRows[srcRows.length - 1].id;
      last = hi;
      const stgById = new Map(stg.prepare(`SELECT ${tgtList} FROM "${table}" WHERE id BETWEEN ? AND ?`).all(lo, hi).map((r) => [r.id, r]));
      const d1Res = await d1.prepare(`SELECT ${tgtList} FROM "${table}" WHERE id BETWEEN ? AND ?`).bind(lo, hi).all();
      const d1ById = new Map(d1Res.results.map((r) => [r.id, r]));
      for (const row of srcRows) {
        for (const [label, byId, missKey, mismKey] of [
          ["staging", stgById, "missingInStaging", "stagingMismatchedRows"],
          ["d1", d1ById, "missingInD1", "d1MismatchedRows"],
        ]) {
          const t = byId.get(row.id);
          if (t === undefined) { stats[missKey] += 1; continue; }
          let bad = false;
          for (let i = 0; i < srcCols.length; i++) {
            const want = withAffinity(row[srcCols[i]], tgtTypes[i]);
            const got = t[tgtCols[i]];
            if (i === keyCol && deriveKey !== undefined && !same(want, got) && typeof row.name === "string" && row.name !== "") {
              let derived = derivedKeyCache.get(row.id);
              if (derived === undefined) { derived = deriveKey(row.name); derivedKeyCache.set(row.id, derived); }
              if (got === derived) { stats.keyRebuilt[label] += 1; continue; }
              if (got === null) { stats.keyNulledByCollision[label] += 1; continue; }
            }
            if (!same(want, got)) {
              bad = true;
              const k = `${label}.${tgtCols[i]}`;
              stats.mismatchedColumns[k] = (stats.mismatchedColumns[k] ?? 0) + 1;
            }
          }
          if (bad) stats[mismKey] += 1;
        }
      }
    }
    verify[table] = stats;
  }
  verify.sourceOrphans = src.prepare(
    `SELECT SUM(left_id IS NOT NULL AND left_id NOT IN (SELECT id FROM cards)) AS l,
            SUM(right_id IS NOT NULL AND right_id NOT IN (SELECT id FROM cards)) AS r FROM cards`,
  ).get();
  verify.liveCards = src.prepare("SELECT COUNT(*) n FROM cards WHERE trash = 0").get().n;
  verify.fileCards = src.prepare(
    "SELECT COUNT(*) n FROM cards WHERE type_id IN (SELECT id FROM cards WHERE codename IN ('file','image'))",
  ).get().n;
  await mf.dispose();
  src.close();
  stg.close();
  summary.steps.verify = { ms: Date.now() - t0, ...verify };

  const bundle = path.join(HERE, "scratch-out", "render-every-card.bundle.mjs");
  runNode(
    [path.join(REPO_ROOT, "node_modules", "esbuild", "bin", "esbuild"), path.join(HERE, "render-every-card.mjs"),
      "--bundle", "--platform=node", "--format=esm", "--external:better-sqlite3", `--outfile=${bundle}`, "--log-level=warning"],
    "esbuild",
  );
  const render = runNode([bundle, staging], "render-every-card");
  summary.steps.render = JSON.parse(render.stdout.trim().split("\n").pop());
} catch (err) {
  summary.failed = String(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  summary.totalMs = Date.now() - started;
  const out = JSON.stringify(summary, null, 2);
  console.log(out);
  if (opts.summary) writeFileSync(opts.summary, out);
  if (!opts.keep) {
    const current = lstatSync(work);
    if (!current.isDirectory() || current.isSymbolicLink() ||
        current.dev !== ownedWorkIdentity.dev || current.ino !== ownedWorkIdentity.ino ||
        realpathSync(work) !== ownedWorkPath) {
      throw new Error("Migration proof workspace ownership changed; cleanup refused");
    }
    rmSync(ownedWorkPath, { recursive: true, maxRetries: 10, retryDelay: 500 });
  }
}
