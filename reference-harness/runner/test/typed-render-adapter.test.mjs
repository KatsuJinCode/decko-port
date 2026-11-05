import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("real TS adapter preserves Ruby's integer, nil, array and hash render answers", () => {
  const out = mkdtempSync(join(tmpdir(), "decko-typed-render-"));
  try {
    const run = spawnSync(process.execPath, [
      "reference-harness/runner/run.mjs",
      "--adapter", "reference-harness/adapters/ts/adapter.json",
      "--fixture", "reference-harness/fixtures/synthetic-v3-mod-probes-ruby33",
      "--out", out,
      "--kinds", "render",
      "--filter", "^probe-view:(5|70|222|259|263|265|271):",
    ], { cwd: repo, windowsHide: true, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const rows = readFileSync(join(out, "render.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(rows.length, 7);
    const answers = new Map(rows.map(row => [Number(row.id.split(":")[1]), row.result?.html]));
    assert.equal(answers.get(5), 2);
    assert.equal(answers.get(70), null);
    assert.equal(answers.get(222), 1);
    assert.deepEqual(answers.get(259), [["Name", "Type"]]);
    assert.deepEqual(answers.get(263), []);
    assert.deepEqual(answers.get(265), { id: 1 });
    assert.deepEqual(answers.get(271), { codename: "decko_bot", id: 1, name: "Decko Bot", type: "RichText", url: "http://deck.example/Decko_Bot.json" });
  } finally {
    const target = resolve(out);
    assert.equal(dirname(target), resolve(tmpdir()));
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
