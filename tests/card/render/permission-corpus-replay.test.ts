

import { describe, expect, it } from "vitest";
import { normalizeSlotIds } from "../../../src/testing/diff.js";
import {
  createPermissionSeededStorage,
  readShardLines,
  type ShardLine,
} from "./permission-corpus-seeding.js";

const DENIED_PREFIX = '<span class="denied">';

function expectBytes(actual: string, expected: string, label: string): void {
  expect(normalizeSlotIds(actual), label).toBe(normalizeSlotIds(expected));
}

function byId(lines: ShardLine[], id: number): ShardLine {
  const line = lines.find((l) => l.id === id);
  if (line === undefined) throw new Error(`corpus entry ${id} not in shard`);
  return line;
}

const DENIED_PICKS: Array<{ id: number; view: string }> = [
  { id: 28, view: "closed" },
  { id: 34, view: "open" },
  { id: 34, view: "content" },
  { id: 41, view: "closed" },
  { id: 44, view: "content" },
  { id: 95, view: "open" },
];

const READABLE_PICKS: Array<{ id: number; view: string }> = [
  { id: 1, view: "closed" },
  { id: 1, view: "content" },
  { id: 15, view: "open" },
  { id: 55, view: "content" },
  { id: 66, view: "open" },
];

const DENIED_TITLE_PICKS: Array<{ id: number }> = [{ id: 28 }, { id: 33 }];

const MID_DENIED_PICKS: Array<{ id: number; view: string }> = [
  { id: 581, view: "content" },
];

describe("corpus replay: read-permission denial renders byte-identically", () => {
  it(
    "replays denied + readable captured views from shard-000000",
    { timeout: 600_000 },
    async () => {
      const storage = await createPermissionSeededStorage();
      try {
        const lines = readShardLines();

        for (const { id, view } of DENIED_PICKS) {
          const line = byId(lines, id);
          const expected = line.views?.[view];
          if (expected === undefined) throw new Error(`corpus:${id} has no :${view}`);
          expect(
            expected.startsWith(DENIED_PREFIX),
            `corpus:${id}:${view} is a denied capture`,
          ).toBe(true);
          expectBytes(
            await storage.engine.render(line.name, view),
            expected,
            `denied corpus:${id}:${view} (${line.name})`,
          );
        }
        for (const { id, view } of READABLE_PICKS) {
          const line = byId(lines, id);
          const expected = line.views?.[view];
          if (expected === undefined) throw new Error(`corpus:${id} has no :${view}`);
          expectBytes(
            await storage.engine.render(line.name, view),
            expected,
            `readable corpus:${id}:${view} (${line.name})`,
          );
        }
        for (const { id } of DENIED_TITLE_PICKS) {
          const line = byId(lines, id);
          const expected = line.views?.title;
          if (expected === undefined) throw new Error(`corpus:${id} has no :title`);
          expectBytes(
            await storage.engine.render(line.name, "title"),
            expected,
            `denied-title corpus:${id}:title (${line.name})`,
          );
        }
        for (const { id, view } of MID_DENIED_PICKS) {
          const line = byId(lines, id);
          const expected = line.views?.[view];
          if (expected === undefined) throw new Error(`corpus:${id} has no :${view}`);
          expectBytes(
            await storage.engine.render(line.name, view),
            expected,
            `mid-denied corpus:${id}:${view} (${line.name})`,
          );
        }
      } finally {
        storage.close();
      }
    },
  );
});
