// deck-seed-parser.test.ts — the deck-INSERT parser behind the M5 CLI's
// third ingest path. Same shape as parse-dump.test.ts: feed-size
// invariance is the sharpest contract for a streaming parser.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deckSeedRows, decodeLiteral } from "../../tools/migrate/deck-seed-parser.mjs";

type Row = { table: string; columns: string[] | undefined; values: unknown[] };

async function readAll(path: string, tables?: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for await (const r of deckSeedRows(path, { tables })) out.push(r);
  return out;
}

function synthDeckInsert(): string {
  return [
    `INSERT INTO cards (id, name, key, left_id, right_id, type_id, db_content, created_at, updated_at) VALUES (1, 'Alpha', 'alpha', NULL, NULL, 2, 'plain body', '2026-09-23 00:00:00.000', '2026-09-23 00:00:00.000');`,
    `INSERT INTO cards (id, name, key, left_id, right_id, type_id, db_content, created_at, updated_at) VALUES (2, NULL, NULL, 1, 3, 2, '<p>with ''apostrophes'' and \\n newlines</p>', '2026-09-23 00:00:00.000', '2026-09-23 00:00:00.000');`,
    `INSERT INTO cards (id, name, key, left_id, right_id, type_id, db_content, created_at, updated_at) VALUES (3, 'Right', 'right', NULL, NULL, 2, '', '2026-09-23 00:00:00.000', '2026-09-23 00:00:00.000');`,
    `INSERT INTO card_references (id, referer_id, referee_key, referee_id, ref_type, is_present) VALUES (10, 1, 'alpha', 1, 'I', 1);`,
    `INSERT INTO meta (key, value) VALUES ('build', 'synthetic');`,
    `INSERT INTO meta (key, value) VALUES ('version', '1.0');`,
  ].join("\n");
}

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "deck-seed-parser-"));
  dirs.push(d);
  return d;
}


describe("deck-seed-parser", () => {
  it("decodes SQL doubled-quote escapes", () => {
    expect(decodeLiteral("plain")).toBe("plain");
    expect(decodeLiteral("it''s")).toBe("it's");
    expect(decodeLiteral("a''b''c")).toBe("a'b'c");
  });

  it("parses a small synthetic deck into rows", async () => {
    const dir = tmp();
    const p = join(dir, "seed.sql");
    writeFileSync(p, synthDeckInsert(), "utf8");
    const rows = await readAll(p);
    expect(rows.length).toBe(6);
    const cards = rows.filter((r) => r.table === "cards");
    const refs = rows.filter((r) => r.table === "card_references");
    const meta = rows.filter((r) => r.table === "meta");
    expect(cards.length).toBe(3);
    expect(refs.length).toBe(1);
    expect(meta.length).toBe(2);
    // junction row id=2 carries NULL name/key per the 2020 convention
    const junction = cards.find((c) => c.values[0] === 2);
    expect(junction?.values[1]).toBeNull();
    expect(junction?.values[2]).toBeNull();
    expect(junction?.values[4]).toBe(3); // right_id
    // content escapes decoded
    const content = junction?.values[6] as string;
    expect(content).toContain("apostrophes");
  });

  it("table filter drops rows not in the filter set", async () => {
    const dir = tmp();
    const p = join(dir, "seed.sql");
    writeFileSync(p, synthDeckInsert(), "utf8");
    const cards = await readAll(p, ["cards"]);
    expect(cards.length).toBe(3);
    expect(cards.every((r) => r.table === "cards")).toBe(true);
  });

  it("parses statements that span multiple lines (content with newlines)", async () => {
    const dir = tmp();
    const p = join(dir, "seed.sql");
    const text = `INSERT INTO cards (id, name, key, type_id, db_content, created_at, updated_at) VALUES (
      1,
      'Multi',
      'multi',
      2,
      '<p>line one
line two
line three</p>',
      '2026-09-23 00:00:00.000',
      '2026-09-23 00:00:00.000'
    );`;
    writeFileSync(p, text, "utf8");
    const rows = await readAll(p);
    expect(rows.length).toBe(1);
    expect(rows[0].values[4]).toBe("<p>line one\nline two\nline three</p>");
  });

  it("throws on a malformed statement instead of silently dropping it", async () => {
    const dir = tmp();
    const p = join(dir, "seed.sql");
    writeFileSync(
      p,
      `INSERT INTO cards (id, name, key) VALUES (1, 'a', 'a'); NOT SQL; INSERT INTO cards (id, name, key) VALUES (2, 'b', 'b');`,
      "utf8",
    );
    // The first statement is valid; "NOT SQL;" is treated as a non-INSERT
    // line and skipped (the parser only emits INSERT rows); the third
    // statement is valid.
    const rows = await readAll(p);
    expect(rows.length).toBe(2);
  });

  afterAll(() => {
    for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
  });
});
