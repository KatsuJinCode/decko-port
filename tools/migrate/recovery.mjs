import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { constants, createReadStream, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

async function digest(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}

function inventory(root, prefix = "") {
  const records = [];
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error("files root must be a real directory");
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    safeRelative(name);
    if (entry.isSymbolicLink()) throw new Error("recovery packages refuse symbolic links");
    if (entry.isDirectory()) records.push({ path: name, directory: true }, ...inventory(path, name));
    else if (entry.isFile()) records.push({ path: name, directory: false });
    else throw new Error("recovery packages refuse special files");
  }
  return records.sort((a, b) => a.path.localeCompare(b.path));
}

function safeRelative(name) {
  if (typeof name !== "string" || !name || isAbsolute(name) || name.includes("\\") || name.includes(":")) throw new Error("invalid recovery path");
  if (name.split("/").some(part => !part || part === "." || part === "..")) throw new Error("invalid recovery path");
}

function outside(source, destination) {
  const target = resolve(destination);
  const rel = relative(realpathSync(source), join(realpathSync(dirname(target)), basename(target)));
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) throw new Error("recovery destination must be outside its source");
}

async function backup(databasePath, target) {
  if (!lstatSync(databasePath).isFile() || lstatSync(databasePath).isSymbolicLink()) throw new Error("database must be a regular file");
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try { await db.backup(target); } finally { db.close(); }
  const copy = new Database(target, { fileMustExist: true });
  try {
    copy.pragma("journal_mode = DELETE");
    if (copy.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("recovery database integrity check failed");
  } finally { copy.close(); }
}

export async function createRecoverySnapshot({ databasePath, filesPath, snapshotDir }) {
  const root = resolve(snapshotDir);
  outside(filesPath, root);
  outside(databasePath, root);
  const files = inventory(filesPath);
  mkdirSync(root);
  await backup(databasePath, join(root, "deck.sqlite"));
  mkdirSync(join(root, "files"));
  for (const entry of files) {
    const target = join(root, "files", entry.path);
    if (entry.directory) mkdirSync(target, { recursive: true });
    else {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(filesPath, entry.path), target, constants.COPYFILE_EXCL);
      entry.sha256 = await digest(target);
      if (entry.sha256 !== await digest(join(filesPath, entry.path))) throw new Error("upload changed while taking recovery snapshot");
    }
  }
  const manifest = { version: 1, databaseSha256: await digest(join(root, "deck.sqlite")), files };
  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

export async function restoreRecoverySnapshot({ snapshotDir, targetDir }) {
  const root = resolve(snapshotDir);
  outside(root, targetDir);
  if (lstatSync(root).isSymbolicLink()) throw new Error("snapshot must be a real directory");
  const manifestPath = join(root, "manifest.json");
  const manifestStat = lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("recovery manifest must be a regular file");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error("invalid recovery manifest");
  const actual = inventory(join(root, "files"));
  for (const entry of manifest.files) safeRelative(entry.path);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files.map(({ path, directory }) => ({ path, directory })))) throw new Error("recovery file inventory differs");
  if (lstatSync(join(root, "deck.sqlite")).isSymbolicLink() || await digest(join(root, "deck.sqlite")) !== manifest.databaseSha256) throw new Error("recovery database checksum differs");
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (existsSync(join(root, `deck.sqlite${suffix}`))) throw new Error("snapshot database has unexpected journal files");
  }
  for (const entry of manifest.files) {
    if (!entry.directory && await digest(join(root, "files", entry.path)) !== entry.sha256) throw new Error("recovery upload checksum differs");
  }
  const destination = resolve(targetDir);
  mkdirSync(destination);
  const databasePath = join(destination, "deck.sqlite");
  copyFileSync(join(root, "deck.sqlite"), databasePath, constants.COPYFILE_EXCL);
  if (await digest(databasePath) !== manifest.databaseSha256) throw new Error("restored database checksum differs");
  const restoredDb = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    if (restoredDb.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("restored database integrity check failed");
  } finally { restoredDb.close(); }
  mkdirSync(join(destination, "files"));
  for (const entry of manifest.files) {
    const target = join(destination, "files", entry.path);
    if (entry.directory) mkdirSync(target, { recursive: true });
    else {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(root, "files", entry.path), target, constants.COPYFILE_EXCL);
      if (await digest(target) !== entry.sha256) throw new Error("restored upload checksum differs");
    }
  }
  return { databasePath: join(destination, "deck.sqlite"), filesPath: join(destination, "files") };
}
