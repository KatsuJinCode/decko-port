










































import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  HandlerRegistry,
  formatReplayFailure,
  renderBytes,
  replayEntries,
  type ReplayEntry,
} from "../../../src/testing/replay.js";
import {
  CORPUS_DB,
  createPermissionSeededStorage,
  readShardLines,
} from "./permission-corpus-seeding.js";
import { installHelpRules } from "../../../src/card/render/help-popover.js";
import { seedCard } from "./render-test-storage.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

const PROOF_ENTRIES: readonly number[] = [
  53, 61, 79, 81, 82, 86, 241, 247, 252, 255, 256, 317, 318, 89,
];

interface ShardLine {
  id: number;
  name: string;
  views?: Record<string, string>;
}



async function seedHelpRuleUniverse(storage: Awaited<ReturnType<typeof createPermissionSeededStorage>>): Promise<void> {
  const corpus = new Database(CORPUS_DB, { readonly: true });
  const setType = corpus.prepare(`SELECT id FROM cards WHERE codename = 'set' AND trash = 0`).get() as
    | { id: number }
    | undefined;
  const settingType = corpus.prepare(`SELECT id FROM cards WHERE codename = 'setting' AND trash = 0`).get() as
    | { id: number }
    | undefined;
  if (setType === undefined || settingType === undefined) {
    corpus.close();
    throw new Error("corpus DB lacks the set/setting codename cards");
  }
  const sql =
    "WITH RECURSIVE reached(id) AS (\n" +
    "  SELECT rules.id FROM cards rules\n" +
    "    JOIN cards sets ON rules.left_id = sets.id\n" +
    "    JOIN cards settings ON rules.right_id = settings.id\n" +
    "  WHERE sets.type_id = ? AND settings.type_id = ? AND settings.codename = 'help'\n" +
    "    AND rules.trash = 0 AND sets.trash = 0 AND settings.trash = 0\n" +
    "  UNION\n" +
    "  SELECT s.id FROM reached r\n" +
    "    JOIN cards j ON j.id = r.id AND j.trash = 0\n" +
    "    JOIN cards s ON s.id IN (j.left_id, j.right_id) AND s.id IS NOT NULL\n" +
    "  UNION\n" +
    "  SELECT j.type_id FROM reached r\n" +
    "    JOIN cards j ON j.id = r.id AND j.type_id IS NOT NULL\n" +
    ")\n" +
    "SELECT c.* FROM cards c WHERE c.trash = 0 AND c.id IN (SELECT id FROM reached)";
  const rows = corpus.prepare(sql).all(setType.id, settingType.id) as Array<{
    id: number;
    name: string | null;
    codename: string | null;
    left_id: number | null;
    right_id: number | null;
    trash: number;
    type_id: number;
    content: string | null;
    read_rule_id: number | null;
    read_rule_class: string | null;
  }>;
  corpus.close();
  for (const row of rows) {


    const existing = await storage.counting.query<{ id: number }>(
      "SELECT id FROM cards WHERE id = ?",
      [row.id],
    );
    if (existing.rows.length > 0) continue;
    await seedCard(storage, {
      id: row.id,
      name: row.name ?? undefined,
      codename: row.codename,
      leftId: row.left_id ?? undefined,
      rightId: row.right_id ?? undefined,
      trash: row.trash === 1,
      typeId: row.type_id,
      dbContent: row.content,
      readRuleId: row.read_rule_id,
      readRuleClass: row.read_rule_class,
    });
  }
}

describe("corpus replay: menu help popovers render Ruby's help text byte-identically", () => {
  it(
    "replays the captured views of the help-text proof entries from shard-000000",
    { timeout: 300_000 },
    async () => {
      const storage = await createPermissionSeededStorage();
      const registry = new HandlerRegistry();
      try {
        await seedHelpRuleUniverse(storage);
        const resolver = installHelpRules(storage.engine, storage.fetcher);
        await resolver.prepare();

        const lines = readShardLines() as unknown as ShardLine[];
        const byId = new Map(lines.map((l) => [l.id, l]));

        registry.register("render-engine", async ({ cardName, view }) => {
          const html = await storage.engine.render(cardName, view);
          return renderBytes(html);
        });

        const entries: ReplayEntry[] = [];
        for (const proofId of PROOF_ENTRIES) {
          const line = byId.get(proofId);
          if (line === undefined || line.views === undefined) {
            throw new Error(`corpus entry ${proofId} not found in shard (or has no captured views)`);
          }
          for (const [view, expected] of Object.entries(line.views)) {







            if (view !== "closed" && view !== "title") continue;
            entries.push({
              id: `corpus:${proofId}:render:${view}`,
              area: "render-engine",
              input: { cardName: line.name, view },
              expected,
            });
          }
        }

        const report = await replayEntries(entries, registry);
        const failures = report.entries
          .filter((e) => e.status !== "pass")
          .map((e) => (e.status === "fail" ? formatReplayFailure(e) : `${e.id}: ${e.status}`));
        if (failures.length > 0) console.log("HELP REPLAY FAILURES:\n" + failures.join("\n---\n"));
        expect(failures).toEqual([]);
      } finally {
        storage.close();
      }
    },
  );
});
