// Oracle replay registration for the render-engine area: replays every
// captured rendered-view entry in fixtures/captured/smoke.json (20 entries:
// :open/:closed/:content/:title per card + the unknown-view sentinel) through
// the RenderEngine against a seeded SQLite deck, byte-diffing TS output
// against Ruby truth. Handler contract: docs/replay-harness.md
// ("render-engine ... success: renderBytes(html) / raise: raisedError").
//
// Slot-id normalization is the harness's job (both sides, strict 20-hex);
// this renderer's job is Ruby-shaped HTML: same classes, same structure,
// same slot markup with a 20-hex id.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIXTURE_PATHS,
  HandlerRegistry,
  collectReplayEntries,
  formatReplayFailure,
  raisedError,
  renderBytes,
  replayEntries,
} from "../../../src/testing/replay.js";
import { loadFixtureFile } from "../../../src/testing/fixture-schema.js";
import { UnsupportedViewError } from "../../../src/card/render.js";
import { createRenderTestStorage, seedCard, type RenderTestStorage } from "./render-test-storage.js";

/** Seed the captured deck exactly as the fetch stream's replay does (the
 *  captured ids/contents; junction part cards for the lexicon; the cardtype
 *  cards whose names the capture's `type` field records). */
async function seedCapturedDeck(storage: RenderTestStorage): Promise<void> {
  // cardtype cards (1.110 renamed Basic -> RichText; type_code :basic)
  await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
  await seedCard(storage, { id: 98, name: "Search", codename: "search_type", typeId: 2 });
  await seedCard(storage, { id: 6, name: "Set", codename: "set", typeId: 2 });
  await seedCard(storage, { id: 7, name: "List", codename: "list", typeId: 2 });
  // junction part cards
  await seedCard(storage, { id: 701, name: "child_one", typeId: 2 });
  await seedCard(storage, { id: 702, name: "child_two", typeId: 2 });
  await seedCard(storage, { id: 703, name: "rich_child", typeId: 2 });
  await seedCard(storage, { id: 704, name: "*self", typeId: 6 });
  await seedCard(storage, { id: 705, name: "*read", typeId: 2 });
  // the captured cards (ids/contents from smoke.json)
  await seedCard(storage, { id: 605, name: "Oracle Basics", typeId: 2, dbContent: "A plain basic card for oracle capture." });
  await seedCard(storage, { id: 606, name: "Oracle Junction", typeId: 2, dbContent: "Junction parent card." });
  await seedCard(storage, { id: 608, name: "Oracle Junction+child_one", leftId: 606, rightId: 701, typeId: 2, dbContent: "first child" });
  await seedCard(storage, { id: 610, name: "Oracle Junction+child_two", leftId: 606, rightId: 702, typeId: 2, dbContent: "second child" });
  await seedCard(storage, {
    id: 611,
    name: "Oracle Rich",
    typeId: 2,
    dbContent: "<p>Rich text with an inclusion: {{Oracle Rich+rich_child}}</p>",
  });
  await seedCard(storage, { id: 613, name: "Oracle Rich+rich_child", leftId: 611, rightId: 703, typeId: 2, dbContent: "the nested child body" });
  await seedCard(storage, { id: 614, name: "Oracle Search", typeId: 98, dbContent: '{"left":"Oracle Junction","sort":"name"}' });
  await seedCard(storage, { id: 615, name: "Oracle Restricted", typeId: 2, dbContent: "Only administrators can read me." });
  await seedCard(storage, { id: 616, name: "Oracle Restricted+*self", leftId: 615, rightId: 704, typeId: 6, dbContent: "" });
  await seedCard(storage, { id: 617, name: "Oracle Restricted+*self+*read", leftId: 616, rightId: 705, typeId: 7, dbContent: "Administrator" });
}

describe("oracle replay: render-engine (card renderer)", () => {
  it("replays the captured smoke rendered views byte-exactly", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCapturedDeck(storage);

      const registry = new HandlerRegistry();
      registry.register("render-engine", async ({ cardName, view }) => {
        try {
          const html = await storage.engine.render(cardName, view);
          return renderBytes(html);
        } catch (error) {
          if (error instanceof UnsupportedViewError) {
            // render.rb#view_method raises Card::Error::UserError; the
            // capture recorded the en.yml message verbatim.
            return raisedError("Card::Error::UserError", error.message);
          }
          throw error;
        }
      });

      const fixtures = DEFAULT_FIXTURE_PATHS.map(loadFixtureFile);
      const report = await replayEntries(collectReplayEntries(fixtures), registry);

      const renderEntries = report.entries.filter((entry) => entry.area === "render-engine");
      expect(renderEntries.length).toBe(20);
      const failures = renderEntries.filter((entry) => entry.status !== "pass");
      expect(failures.map(formatReplayFailure)).toEqual([]);
    } finally {
      storage.close();
    }
  });
});
