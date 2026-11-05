import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyStaticImportClosure, staticImportClosure } from "./copy-static-import-closure.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

test("the capture closure of run-all includes every module it statically imports", () => {
  const closure = staticImportClosure(repo, ["reference-harness/browser/run-all.mjs"]);
  for (const file of [
    "reference-harness/browser/run-all.mjs",
    "reference-harness/runner/platform-shell.mjs",
    "reference-harness/runner/source-git-environment.mjs",
    "reference-harness/browser/lib/comparison-artifacts.mjs",
  ]) assert.ok(closure.includes(file), `${file} must be copied with run-all`);
});

test("a copied closure resolves its relative imports inside the destination", () => {
  const destination = mkdtempSync(path.join(tmpdir(), "decko-static-closure-test-"));
  try {
    copyStaticImportClosure(repo, ["reference-harness/browser/run-all.mjs"], destination);
    assert.ok(existsSync(path.join(destination, "reference-harness/runner/platform-shell.mjs")));
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
});

test("an import that names a missing file fails the closure instead of copying a partial set", () => {
  const source = mkdtempSync(path.join(tmpdir(), "decko-static-closure-missing-"));
  try {
    mkdirSync(path.join(source, "a"));
    writeFileSync(path.join(source, "a/entry.mjs"), 'import "./absent.mjs";\n');
    assert.throws(() => staticImportClosure(source, ["a/entry.mjs"]), /fixture source is missing/);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});
