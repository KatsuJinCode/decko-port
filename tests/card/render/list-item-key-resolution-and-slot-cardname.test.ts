

import { describe, it, expect, afterAll } from "vitest";
import {
  createStructureSeededStorageFor,
  readShardLines,
} from "./structure-corpus-seeding.js";
import { seedCard, type RenderTestStorage } from "./render-test-storage.js";

const WIDE_READ_RULE_ID = 6568;

const LIST_TYPE_ID = 47;

const LEFT_ID = 997011;
const VIDEO_ID = 997012;
const ITEM_JUNCTION_ID = 997013;
const PAGES_ID = 997040;
const LIST_JUNCTION_ID = 997041;
const NEST_HOST_ID = 997015;
const CDW_HOST_ID = 997016;

function baseIdsWithWideReadRule(): Set<number> {
  const baseIds = new Set(readShardLines().map((l) => l.id));
  baseIds.add(WIDE_READ_RULE_ID);
  return baseIds;
}

async function seedListFixture(storage: RenderTestStorage): Promise<void> {
  await seedCard(storage, {
    id: LEFT_ID,
    name: "Host Person",
    typeId: 2,
    readRuleId: WIDE_READ_RULE_ID,
    readRuleClass: "*all",
  });
  await seedCard(storage, {
    id: VIDEO_ID,
    name: "video",
    typeId: 2,
    readRuleId: WIDE_READ_RULE_ID,
    readRuleClass: "*all",
  });
  await seedCard(storage, {
    id: ITEM_JUNCTION_ID,
    leftId: LEFT_ID,
    rightId: VIDEO_ID,
    typeId: 2,
    readRuleId: WIDE_READ_RULE_ID,
    readRuleClass: "*all",
  });
  await seedCard(storage, {
    id: PAGES_ID,
    name: "Pages",
    typeId: 2,
    readRuleId: WIDE_READ_RULE_ID,
    readRuleClass: "*all",
  });
  await seedCard(storage, {
    id: LIST_JUNCTION_ID,
    leftId: LEFT_ID,
    rightId: PAGES_ID,
    typeId: LIST_TYPE_ID,
    dbContent: "Host Person+videos\n",
    readRuleId: WIDE_READ_RULE_ID,
    readRuleClass: "*all",
  });
}

let storage: RenderTestStorage | undefined;

afterAll(() => {
  storage?.close();
});

describe("list-item key resolution + unsaved-compound slot_cardname (name-form trace pins)", () => {
  it(
    "a list line whose form differs from the stored junction name resolves to the real card and renders its stored name",
    async () => {

      const baseIds = baseIdsWithWideReadRule();
      storage = await createStructureSeededStorageFor(baseIds);
      await seedListFixture(storage);
      const html = await storage.engine.render("Host Person+Pages", "content");

      expect(html).toContain('data-card-name="Host Person+video"');
      expect(html).not.toContain("Host Person+videos");

      expect(html).not.toContain("swtktey");
      expect(html).toContain(`id="host_person-video-bar-view"`);
      expect(html).toMatch(/class="card-slot bar-view [^"]*"/);
      expect(html).not.toContain('id="host_person-video-mini_bar-view"');
      expect(html).toContain(`data-card-id="${ITEM_JUNCTION_ID}"`);
    },
  );

  it(
    "a pointer/list card nested inside a page (not the render root) pre-enriches its items through the same key resolution",
    async () => {

      const baseIds = baseIdsWithWideReadRule();
      storage = await createStructureSeededStorageFor(baseIds);
      await seedListFixture(storage);
      await seedCard(storage, {
        id: NEST_HOST_ID,
        name: "Person Page",
        typeId: 2,
        dbContent: "{{Host Person+Pages}}",
        readRuleId: WIDE_READ_RULE_ID,
        readRuleClass: "*all",
      });

      await storage.counting.query(
        "UPDATE cards SET db_content = 'content' WHERE id = 22770 AND key = '*all+*default_html_view'",
        [],
      );
      const html = await storage.engine.render("Person Page", "open");
      expect(html).toContain('data-card-name="Host Person+video"');
      expect(html).not.toContain("Host Person+videos");
      expect(html).not.toContain("swtktey");
    },
  );

  it(
    "an unsaved compound card's slot displays the url_key form (wrap.rb:50-53 slot_cardname)",
    async () => {

      const baseIds = baseIdsWithWideReadRule();
      storage = await createStructureSeededStorageFor(baseIds);
      await seedCard(storage, {
        id: CDW_HOST_ID,
        name: "CDW Host",
        typeId: 2,
        dbContent: "{{+management|open}}",
        readRuleId: WIDE_READ_RULE_ID,
        readRuleClass: "*all",
      });
      const html = await storage.engine.render("CDW Host", "open");
      expect(html).toContain('data-card-name="CDW_Host+management"');
      expect(html).not.toContain('data-card-name="CDW Host+management"');
    },
  );
});
