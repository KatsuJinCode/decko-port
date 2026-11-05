#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const hex = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sourceFiles = ["configured-public-page-shell.mjs", "package-lock.json", "package.json", "vm-staging-server.mjs"];
const moduleFile = fs.realpathSync(fileURLToPath(import.meta.url));
const selectionFile = path.resolve(path.dirname(moduleFile), "../../deploy/selected-staging-source.json");

function ordinaryPathComponents(file) {
  const absolute = path.resolve(file), root = path.parse(absolute).root;
  const parts = path.relative(root, absolute).split(path.sep).filter(Boolean);
  let current = root;
  const inspect = (name, ancestor) => {
    const stat = fs.lstatSync(name);
    if (stat.isSymbolicLink()) throw Error(`Artifact path component is redirected: ${name}`);
    if (ancestor && !stat.isDirectory()) throw Error(`Artifact ancestor is not a directory: ${name}`);
    return stat;
  };
  let stat = inspect(current, parts.length !== 0);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    stat = inspect(current, index < parts.length - 1);
  }
  return stat;
}

function regularBytes(file) {
  const stat = ordinaryPathComponents(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`Expected an ordinary artifact file: ${file}`);
  return fs.readFileSync(file);
}

export function stagedTreeDigest(root) {
  if (!ordinaryPathComponents(root).isDirectory()) throw Error("Expected an ordinary dist directory");
  const digest = createHash("sha256");
  let files = 0, bytes = 0;
  const visit = directory => {
    if (!ordinaryPathComponents(directory).isDirectory()) throw Error("Expected an ordinary artifact directory");
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw Error(`Artifact symlink unsupported: ${file}`);
      if (stat.isDirectory()) visit(file);
      else {
        if (!stat.isFile()) throw Error(`Special artifact file unsupported: ${file}`);
        const content = regularBytes(file);
        digest.update(path.relative(root, file).replaceAll("\\", "/") + "\0" + sha256(content) + "\n");
        files++; bytes += content.length;
      }
    }
  };
  visit(root);
  if (files === 0) throw Error("Empty dist is not a staged engine");
  return {sha256: digest.digest("hex"), files, bytes};
}

export function verifyStagedSource(packageRoot, selection) {
  if (!selection || selection.format !== "decko-staging-source-selection/1" || typeof selection.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(selection.sourceCommit) || selection.sourceAcceptance !== "component-reviewed" || selection.targetActivationAccepted !== false) throw Error("Invalid source-only selection record");
  if (!selection.files || Object.keys(selection.files).sort().join("\n") !== sourceFiles.join("\n")) throw Error("Selection must pin all four source/package files");
  if (!Array.isArray(selection.distributions) || selection.distributions.length === 0) throw Error("Selection has no qualified distribution");
  const configurations = new Set();
  for (const distribution of selection.distributions) {
    if (!distribution || !["tsconfig.browser-hosts.json", "tsconfig.dist.json"].includes(distribution.config) || configurations.has(distribution.config) || !hex(distribution.distSha256)
      || !distribution.runtimeAssets || !hex(distribution.runtimeAssets.manifestSha256) || !Number.isSafeInteger(distribution.runtimeAssets.files) || distribution.runtimeAssets.files <= 0 || !Number.isSafeInteger(distribution.runtimeAssets.bytes) || distribution.runtimeAssets.bytes <= 0) throw Error("Invalid qualified distribution pin");
    configurations.add(distribution.config);
  }
  for (const file of sourceFiles) {
    const pin = selection.files[file];
    if (!pin || !Number.isSafeInteger(pin.byteLength) || pin.byteLength <= 0 || !hex(pin.sha256)) throw Error(`Invalid source file pin: ${file}`);
  }
  const root = path.resolve(packageRoot);
  const receipt = JSON.parse(regularBytes(path.join(root, ".runtime/browser-build.json")).toString("utf8"));
  if (receipt.sourceCommit !== selection.sourceCommit) throw Error(`Selected source mismatch: expected ${selection.sourceCommit}, received ${receipt.sourceCommit}`);
  if (receipt.sourceDiffSha256 !== sha256("")) throw Error("Build receipt does not identify clean tracked source");
  const distribution = selection.distributions.find(item => item.config === receipt.config);
  if (!distribution || !hex(distribution.distSha256) || !distribution.runtimeAssets || !hex(distribution.runtimeAssets.manifestSha256)) throw Error("Build configuration has no qualified artifact pin");
  if (receipt.distSha256 !== distribution.distSha256) throw Error("Build receipt differs from selected dist pin");
  for (const field of ["files", "bytes", "manifestSha256"]) if (receipt.runtimeAssets?.[field] !== distribution.runtimeAssets[field]) throw Error(`Runtime asset receipt differs: ${field}`);
  const checked = [];
  for (const file of sourceFiles) {
    const pin = selection.files[file], content = regularBytes(path.join(root, file));
    if (content.length !== pin.byteLength || sha256(content) !== pin.sha256) throw Error(`Source/package file differs from selected pin: ${file}`);
    checked.push(file);
  }
  const actual = stagedTreeDigest(path.join(root, "dist"));
  if (actual.sha256 !== distribution.distSha256) throw Error("Actual staged dist differs from selected artifact pin");
  return {sourceCommit: selection.sourceCommit, sourceAndArtifactMatch: true, checked, distribution: {config: receipt.config, ...actual}, targetAcceptance: false, activationAccepted: false,
    scope: "Read-only byte/provenance snapshot; dependencies, ABI, target settings/data/HTTP behavior, approval and whole-port acceptance are not established"};
}

export function stagedSourceMain(argv) {
  if (argv.length !== 2 || argv[0] !== "--package-root" || !argv[1] || argv[1].startsWith("--")) throw Error("Supply exactly --package-root DIRECTORY");
  const selection = JSON.parse(regularBytes(selectionFile).toString("utf8"));
  return verifyStagedSource(argv[1], selection);
}
function isEntryModule() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === moduleFile; }
  catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}
if (isEntryModule()) {
  try { console.log(JSON.stringify(stagedSourceMain(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(`Staged candidate refused: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
