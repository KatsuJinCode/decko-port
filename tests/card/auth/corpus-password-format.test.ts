// Corpus pin for the sign-in slice's central storage finding: the real
// deck's +*account+*password cards store SALTED SHA-1 HEX DIGESTS (40
// lowercase hex chars — Digest::SHA1.hexdigest "#{salt}--#{password}--",
// card-1.110.0 lib/card/auth.rb:36-39), NOT bcrypt hashes. Every stored
// value was probed read-only when the finding was made (2026-09-27); this
// test re-pins the shape so a future corpus refresh that DID carry bcrypt
// would fail here loudly instead of silently breaking sign-in.
//
// Data rule: the test asserts SHAPES (lengths, character classes, prefix
// classes). No password content, salt content, or email content is ever
// selected into a string that outlives the query, printed, or embedded in
// an assertion message.
//
// The raw ground-truth corpus is a local, gitignored build
// (tmp/raw-ground-truth/bench-corpus-raw.sqlite3). Resolution order:
// DECKO_TS_RAW_CORPUS env var, this repo's tmp path, then the main
// checkout's tmp path (lane worktrees are siblings of decko-ts and the
// corpus stays in the main checkout's gitignored tmp). Skips when absent.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const REPO_RAW_CORPUS = fileURLToPath(
  new URL("../../../tmp/raw-ground-truth/bench-corpus-raw.sqlite3", import.meta.url),
);
// The lane-worktree sibling of the main checkout.
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

      // The python-built corpus names the content column `content` (the
      // engine-standard build names it db_content — see
      // src/card/auth/signin.ts's column-convention note).
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
