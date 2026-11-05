import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { HARNESS } from "./helpers.mjs";
import { sourceGitEnvironment } from "../source-git-environment.mjs";

const SIDECAR = /\.sqlite3?-(wal|shm)$/;

describe("the shipped fixture decks carry no journal sidecars", () => {
  for (const fixture of ["synthetic-v1", "synthetic-v2"]) {
    it(`${fixture}/deck holds no -wal or -shm file beside deck.sqlite3`, () => {
      const dir = path.join(HARNESS, "fixtures", fixture, "deck");
      assert.ok(existsSync(path.join(dir, "deck.sqlite3")), "the committed deck is present");
      const residue = readdirSync(dir).filter((f) => SIDECAR.test(f));
      assert.deepEqual(residue, [], "open decks only through a copy; delete the sidecars");
    });
  }

  it("no journal sidecar is tracked by Git, so none can be committed", () => {
    const repo = path.join(HARNESS, "..");
    const sidecarPathspecs = ["sqlite3-wal", "sqlite3-shm", "sqlite-wal", "sqlite-shm"].map((suffix) => `:(glob)**/*.${suffix}`);
    const listed = spawnSync("git", ["-C", repo, "ls-files", "-z", "--", ...sidecarPathspecs], {
      windowsHide: true, encoding: "utf8", env: sourceGitEnvironment(), maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(listed.error, undefined, "git must run to list tracked files");
    assert.equal(listed.status, 0, listed.stderr);
    const tracked = listed.stdout.split("\0").filter(Boolean).filter((f) => SIDECAR.test(path.posix.basename(f)));
    assert.deepEqual(tracked, [], "journal sidecars are residue of an open; untrack and delete them, never commit them");
  });
});
