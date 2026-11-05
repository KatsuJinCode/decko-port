#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {verifyStagedSource} from "./verify-staged-source.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function ordinary(file, directory = false) {
  const absolute = path.resolve(file), stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || path.resolve(fs.realpathSync(absolute)) !== absolute
    || (directory ? !stat.isDirectory() : !stat.isFile())) throw Error(`Redirected or nonordinary package input: ${absolute}`);
  return absolute;
}
function sqlInventory(root) {
  ordinary(root, true);
  const out = [];
  function visit(directory, prefix = "db") {
    ordinary(directory, true);
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw Error(`Redirected SQL package input: ${file}`);
      if (name.endsWith(".sql") && !stat.isFile()) throw Error(`Nonordinary SQL package input: ${file}`);
      if (stat.isDirectory()) visit(file, `${prefix}/${name}`);
      else if (name.endsWith(".sql")) {ordinary(file); out.push(`${prefix}/${name}`);}
    }
  }
  visit(root);
  return out.sort();
}
function verifySql(root, selection) {
  const pins = selection.nodeRuntimeFiles;
  if (!pins || typeof pins !== "object" || Array.isArray(pins)) throw Error("Node package must pin its SQL runtime inputs");
  const names = Object.keys(pins).sort();
  for (const required of ["db/schema.sqlite.sql", "db/migrations/001-auth-sessions.sql"]) {
    if (!Object.hasOwn(pins, required)) throw Error(`Required Node runtime input is unpinned: ${required}`);
  }
  for (const name of names) {
    if (!name.startsWith("db/") || !name.endsWith(".sql") || name.includes("\\")
      || path.posix.normalize(name) !== name || name.split("/").some(part => !part || part === "..")) throw Error(`Invalid SQL runtime path: ${name}`);
    const pin = pins[name];
    if (!pin || !Number.isSafeInteger(pin.byteLength) || pin.byteLength <= 0 || !/^[a-f0-9]{64}$/.test(pin.sha256)) throw Error(`Invalid SQL runtime pin: ${name}`);
    const file = path.join(root, name), bytes = fs.readFileSync(ordinary(file));
    if (bytes.length !== pin.byteLength || sha(bytes) !== pin.sha256) throw Error(`SQL runtime input differs: ${name}`);
  }
  if (JSON.stringify(sqlInventory(path.join(root, "db"))) !== JSON.stringify(names)) throw Error("SQL runtime inventory differs from declared pins");
  return names;
}

export function verifyNodeHostPackage(root, selection) {
  const source = verifyStagedSource(root, selection);
  const sql = verifySql(root, selection);
  return {...source, nodeRuntimeFilesVerified: sql,
    scope: "Source/dist and declared SQL byte verification only; dependencies, native ABI, runnable host, data, HTTP and activation require actual checks"};
}

export function packageNodeHost(sourceRoot, outputRoot, selection) {
  const source = ordinary(sourceRoot, true), output = path.resolve(outputRoot);
  if (fs.existsSync(output)) throw Error("Refusing to overwrite an existing Node package");
  const relative = path.relative(source, output);
  if (relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw Error("Node package output must be outside its source tree");
  }
  ordinary(path.dirname(output), true);
  const verified = verifyNodeHostPackage(source, selection);
  fs.mkdirSync(output);
  for (const file of Object.keys(selection.files)) fs.copyFileSync(path.join(source, file), path.join(output, file), fs.constants.COPYFILE_EXCL);
  fs.cpSync(path.join(source, "dist"), path.join(output, "dist"), {recursive: true, force: false, errorOnExist: true});
  for (const name of verified.nodeRuntimeFilesVerified) {
    const destination = path.join(output, name);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.copyFileSync(path.join(source, name), destination, fs.constants.COPYFILE_EXCL);
  }
  fs.mkdirSync(path.join(output, ".runtime"));
  fs.copyFileSync(path.join(source, ".runtime/browser-build.json"), path.join(output, ".runtime/browser-build.json"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(output, "proposed-selection.json"), JSON.stringify(selection, null, 2) + "\n", {flag: "wx"});
  const result = verifyNodeHostPackage(output, selection);
  fs.writeFileSync(path.join(output, "source-verification.json"), JSON.stringify(result, null, 2) + "\n", {flag: "wx"});
  return result;
}

function isEntry() {
  if (!process.argv[1]) return false;
  try {return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));}
  catch (error) {if (error.code === "ENOENT" || error.code === "ENOTDIR") return false; throw error;}
}
if (isEntry()) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 6 || args[0] !== "--source-root" || args[2] !== "--out" || args[4] !== "--selection") throw Error("Supply --source-root DIRECTORY --out NEW_DIRECTORY --selection FILE");
    const selection = JSON.parse(fs.readFileSync(args[5], "utf8"));
    console.log(JSON.stringify(packageNodeHost(args[1], args[3], selection), null, 2));
  } catch (error) {console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;}
}
