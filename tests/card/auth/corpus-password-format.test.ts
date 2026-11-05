

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const REPO_RAW_CORPUS = fileURLToPath(
  new URL("../../../tmp/raw-ground-truth/bench-corpus-raw.sqlite3", import.meta.url),
);

const SIBLING_RAW_CORPUS = fileURLToPath(
  new URL("../../../../decko-ts/tmp/raw-ground-truth/bench-corpus-raw.sqlite3", import.meta.url),
);

const RAW_CORPUS_PATH =
  process.env.DECKO_TS_RAW_CORPUS ??
  (existsSync(REPO_RAW_CORPUS) ? REPO_RAW_CORPUS : null) ??
  (existsSync(SIBLING_RAW_CORPUS) ? SIBLING_RAW_CORPUS : null);

const describeIfCorpus = RAW_CORPUS_PATH !== null ? describe : describe.skip;

describeIfCorpus("corpus +*password storage shape (raw ground truth)", () => {
  it("every stored digest is a 40-char lowercase SHA-1 hex string, zero bcrypt-shaped", () => {
    const db = new Database(RAW_CORPUS_PATH as string, { readonly: true });
    try {
      const passwordCodename = db
        .prepare("SELECT id FROM cards WHERE codename = 'password' AND trash = 0")
        .get() as { id: number } | undefined;
      expect(passwordCodename).toBeDefined();

      const digests = db
        .prepare(
          "SELECT length(content) AS len, content NOT GLOB '*[^0-9a-f]*' AS allLowerHex, " +
            "substr(content, 1, 1) AS firstChar FROM cards WHERE right_id = ? AND trash = 0",
        )
        .all(passwordCodename?.id) as Array<{
        len: number;
        allLowerHex: number;
        firstChar: string;
      }>;

      expect(digests.length).toBeGreaterThan(0);
      for (const row of digests) {
        expect(row.len).toBe(40);
        expect(row.allLowerHex).toBe(1);
        expect(row.firstChar).not.toBe("$");
      }
    } finally {
      db.close();
    }
  });

  it("the matching +*salt cards exist for verification (40-char, SHA-1-shaped)", () => {
    const db = new Database(RAW_CORPUS_PATH as string, { readonly: true });
    try {
      const saltCodename = db
        .prepare("SELECT id FROM cards WHERE codename = 'salt' AND trash = 0")
        .get() as { id: number } | undefined;
      expect(saltCodename).toBeDefined();
      const salts = db
        .prepare(
          "SELECT length(content) AS len FROM cards WHERE right_id = ? AND trash = 0",
        )
        .all(saltCodename?.id) as Array<{ len: number }>;
      expect(salts.length).toBeGreaterThan(0);
      for (const row of salts) {
        expect(row.len).toBe(40);
      }
    } finally {
      db.close();
    }
  });
});
