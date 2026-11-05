#!/usr/bin/env node

import Database from "better-sqlite3";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_D1_DIR = join(REPO_ROOT, "deploy", ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");

const args = process.argv.slice(2);
const chunksDir = args[0];
if (!chunksDir) {
  console.error("usage: node apply-chunks-to-d1-local.mjs <chunks-dir> [--d1-path <path>]");
  process.exit(1);
}

function fail(msg) {
  console.error(`apply-chunks-to-d1-local: ${msg}`);
  process.exit(1);
}

function resolveD1Path() {
  const flagIdx = args.indexOf("--d1-path");
  if (flagIdx !== -1) return args[flagIdx + 1];
  if (!existsSync(DEFAULT_D1_DIR)) {
    fail(`no local D1 state at ${DEFAULT_D1_DIR}; pass --d1-path <file.sqlite>`);
  }
  const candidates = readdirSync(DEFAULT_D1_DIR).filter((f) => f.endsWith(".sqlite"));
  if (candidates.length === 0) {
    fail(`no *.sqlite database under ${DEFAULT_D1_DIR}; pass --d1-path <file.sqlite>`);
  }
  if (candidates.length > 1) {
    fail(`multiple local D1 databases under ${DEFAULT_D1_DIR}; pass --d1-path with one of: ${candidates.join(", ")}`);
  }
  return join(DEFAULT_D1_DIR, candidates[0]);
}

const d1Path = resolveD1Path();
if (!existsSync(d1Path)) {
  fail(`local D1 database not found: ${d1Path} (apply a first chunk via wrangler, or pass --d1-path)`);
}

const files = readdirSync(chunksDir).filter((f) => f.endsWith(".sql")).sort();
console.log(`apply-chunks-to-d1-local: ${files.length} chunks from ${chunksDir}`);
console.log(`  target: ${d1Path}`);

const db = new Database(d1Path);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = OFF");

const t0 = Date.now();
let appliedRows = 0;
let chunkIdx = 0;
for (const f of files) {
  const sql = readFileSync(join(chunksDir, f), "utf8");
  db.exec(sql);
  chunkIdx++;
  if (chunkIdx % 50 === 0) console.log(`  ${chunkIdx}/${files.length} chunks applied`);
}

const cardCount = db.prepare("SELECT COUNT(*) AS n FROM cards").get();
const refsCount = db.prepare("SELECT COUNT(*) AS n FROM card_references").get();
const elapsed = Date.now() - t0;
console.log(`  applied ${files.length} chunks in ${(elapsed / 1000).toFixed(1)}s`);
console.log(`  cards: ${cardCount.n}`);
console.log(`  card_references: ${refsCount.n}`);
for (const t of ["card_acts","card_actions","card_changes","card_revisions","card_virtuals","delayed_jobs","sessions","schema_migrations","ar_internal_metadata","transform_migrations"]) {
  try {
    const c = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get();
    console.log(`  ${t}: ${c.n}`);
  } catch { }
}
db.close();
