

import { describe, it, expect, afterAll } from "vitest";
import {
  createStructureSeededStorageFor,
  readShardLines,
} from "./structure-corpus-seeding.js";
import { createRenderTestStorage, seedCard, type RenderTestStorage } from "./render-test-storage.js";

let plainStorage: RenderTestStorage | undefined;
let corpusStorage: Awaited<ReturnType<typeof createStructureSeededStorageFor>> | undefined;

afterAll(() => {
  plainStorage?.close();
  corpusStorage?.close();
});

describe("pointer/list item slot: readable items keep the bar-view slot, denied real items render the bare span", () => {
  it(
    "a List card renders its readable item as a bar-view slot with data-card-id and the titled bar body",
    async () => {

      plainStorage = await createRenderTestStorage();

      await seedCard(plainStorage, { id: 7, name: "List", codename: "list", typeId: 2 });
      await seedCard(plainStorage, {
        id: 99100,
        name: "deferred lane list",
        typeId: 7,
        dbContent: "readable item",
      });
      await seedCard(plainStorage, {
        id: 99101,
        name: "readable item",
        typeId: 2,
        dbContent: "<p>readable body</p>",
      });
      const html = await plainStorage.engine.render("deferred lane list", "content");

      expect(html).toContain('id="readable_item-bar-view"');
      expect(html).toMatch(/class="card-slot bar-view [^"]*"/);
      expect(html).toContain('data-card-name="readable item"');
      expect(html).toContain('data-card-id="99101"');
      expect(html).not.toContain('id="readable_item-mini_bar-view"');

      expect(html).toMatch(/bar-left[\s\S]{0,200}card-title/);
    },
  );

  it(
    "a List card renders its read-denied item (a real row) as the bare quiet span, not a mini_bar wrap",
    async () => {

      const baseIds = new Set(readShardLines().map((l) => l.id));
      baseIds.add(22281);
      baseIds.add(22282);
      corpusStorage = await createStructureSeededStorageFor(baseIds);
      await seedCard(corpusStorage, {
        id: 99102,
        name: "deferred lane denied list",
        typeId: 47,
        dbContent: "denied item",
      });
      await seedCard(corpusStorage, {
        id: 99103,
        name: "denied item",
        typeId: 22281,
        readRuleId: 22283,
        readRuleClass: "*type",
      });
      const html = await corpusStorage.engine.render("deferred lane denied list", "content");
      expect(html).toContain('pointer-item item-bar"><span class="denied">');
      expect(html).not.toContain('id="denied_item-mini_bar-view"');
      expect(html).not.toContain('id="denied_item-bar-view"');
    },
  );
});
