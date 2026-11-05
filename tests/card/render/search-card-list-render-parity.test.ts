

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeSlotIds } from "../../../src/testing/diff.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

const SMOKE_JSON = readFileSync(
  fileURLToPath(new URL("../../../fixtures/captured/smoke.json", import.meta.url)),
  "utf8",
);

function capture(name: string): string {
  const obj = JSON.parse(SMOKE_JSON) as {
    rendered: Record<string, string>;
  };
  const bytes = obj.rendered[name];
  if (bytes === undefined) throw new Error(`smoke.json missing rendered entry: ${name}`);
  return bytes;
}

const CAPTURED_ORACLE_SEARCH_CONTENT = capture("Oracle Search#content");
const CAPTURED_ORACLE_SEARCH_OPEN = capture("Oracle Search#open");

async function seedOracleSearchDeck(storage: Awaited<ReturnType<typeof createRenderTestStorage>>): Promise<void> {

  await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
  await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });

  await seedCard(storage, { id: 701, name: "child_one", typeId: 2 });
  await seedCard(storage, { id: 702, name: "child_two", typeId: 2 });

  await seedCard(storage, { id: 606, name: "Oracle Junction", typeId: 2, dbContent: "Junction parent card." });
  await seedCard(storage, {
    id: 608,
    name: "Oracle Junction+child_one",
    leftId: 606,
    rightId: 701,
    typeId: 2,
    dbContent: "first child",
  });
  await seedCard(storage, {
    id: 610,
    name: "Oracle Junction+child_two",
    leftId: 606,
    rightId: 702,
    typeId: 2,
    dbContent: "second child",
  });
  await seedCard(storage, {
    id: 614,
    name: "Oracle Search",
    typeId: 98,
    dbContent: '{"left":"Oracle Junction","sort":"name"}',
  });

  await storage.engine.render("Oracle Junction", "content");
}

describe("search card_list rendering — valid-JSON path (M5)", () => {

  it(":content view of a Search-type card with valid JSON renders the captured card_list bytes", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "content");
      const actual = normalizeSlotIds(html);
      const expected = normalizeSlotIds(CAPTURED_ORACLE_SEARCH_CONTENT);
      expect(actual).toBe(expected);
    } finally {
      storage.close();
    }
  });

  it(":open view of a Search-type card with valid JSON renders the captured card_list bytes", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "open");
      const actual = normalizeSlotIds(html);
      const expected = normalizeSlotIds(CAPTURED_ORACLE_SEARCH_OPEN);
      expect(actual).toBe(expected);
    } finally {
      storage.close();
    }
  });

  it("card_list wrapper class string matches 0_search/views.rb:110", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "content");
      expect(html).toContain('<div class="card-list card-list-bar search-result-list">');

      expect(html).toContain("</div>");
    } finally {
      storage.close();
    }
  });

  it("each result item wraps in <div class=\"search-result-item item-bar\">", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "content");

      const matches = html.match(/<div class="search-result-item item-bar">/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(2);
    } finally {
      storage.close();
    }
  });

  it("each result item nests the result card's :bar view (collection item.rb#nest_item contract)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "content");

      expect(html).toContain('id="oracle_junction-child_one-bar-view"');
      expect(html).toContain('id="oracle_junction-child_two-bar-view"');

      expect(html).toMatch(/data-slot="[^"]*&quot;view&quot;:&quot;bar&quot;[^"]*"/);
    } finally {
      storage.close();
    }
  });

  it("card_list body is closed with a trailing newline (the captured byte shape)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "content");
      const lastListClose = html.lastIndexOf("</div>");

      expect(html).toMatch(/<\/div>\n<\/div>$/);
    } finally {
      storage.close();
    }
  });

  it(":content view of a Search-type card whose valid CQL returns zero results renders no_search_results", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });

      await seedCard(storage, {
        id: 800,
        name: "empty result search",
        typeId: 98,
        dbContent: '{"left":"no_such_card","limit":0}',
      });
      const html = await storage.engine.render("empty_result_search", "content");
      expect(html).toContain('<div class="search-no-results"></div>');

      expect(html).not.toContain("card-list card-list-bar search-result-list");
      expect(html).not.toContain("search-result-item");
    } finally {
      storage.close();
    }
  });

  it(":open view of a Search-type card whose valid CQL returns zero results renders no_search_results", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });
      await seedCard(storage, {
        id: 801,
        name: "empty result search two",
        typeId: 98,
        dbContent: '{"left":"no_such_card","limit":0}',
      });
      const html = await storage.engine.render("empty_result_search_two", "open");
      expect(html).toContain('<div class="search-no-results"></div>');
    } finally {
      storage.close();
    }
  });

  it("result items behind a read-permission denial still render the search-result-item wrapper", async () => {

    const storage = await createRenderTestStorage();
    try {

      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });
      await seedCard(storage, { id: 900, name: "denied parent", typeId: 2, dbContent: "p" });
      await seedCard(storage, {
        id: 901,
        name: "denied child",
        leftId: 900,
        typeId: 2,
        dbContent: "x",
      });
      await seedCard(storage, {
        id: 902,
        name: "denied search",
        typeId: 98,
        dbContent: '{"left":"denied parent"}',
      });

      await storage.engine.render("denied parent", "content");
      const html = await storage.engine.render("denied search", "content");

      expect(html).toContain('<div class="search-result-item item-bar">');

      expect(html).toContain('<div class="card-list card-list-bar search-result-list">');

      expect(html).toContain('id="denied_child-bar-view"');
    } finally {
      storage.close();
    }
  });

  it(":closed view of a Search-type card does NOT render the card_list body (closed body is stubbed)", async () => {

    const storage = await createRenderTestStorage();
    try {
      await seedOracleSearchDeck(storage);
      const html = await storage.engine.render("Oracle Search", "closed");

      expect(html).toContain('data-stub-url="/Oracle_Search/bar_bottom"');

      expect(html).not.toContain("card-list card-list-bar search-result-list");
    } finally {
      storage.close();
    }
  });
});
