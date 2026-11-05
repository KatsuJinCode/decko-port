// Oracle replay registration for the card-engine area: replays the captured
// smoke.json card records (fixtures/captured/smoke.json) through the fetch
// layer against a seeded SQLite deck, byte-diffing TS output against the
// Ruby oracle. The handler contract is documented in docs/replay-harness.md
// ("card-engine ... must return jsonValue(cardRecord)").
//
// The seed reconstructs the captured deck minimally: the 10 captured cards
// with their captured ids/contents (ids are DB-local and stripped by the
// harness), the junction part cards the lexicon needs to compose compound
// names, and the cardtype cards (RichText/Search/Set/List) whose names and
// codenames the capture's `type` / `type_code` fields record
// (tools/oracle/capture.rb#card_attributes: type_name + Card::Codename[type_id]).

import { describe, expect, it } from "vitest";
import {
  HandlerRegistry,
  jsonValue,
  replayEntries,
  collectReplayEntries,
  formatReplayFailure,
  DEFAULT_FIXTURE_PATHS,
} from "../../../src/testing/replay.js";
import { loadFixtureFile } from "../../../src/testing/fixture-schema.js";
import { createFetchTestStorage, seedCard, type FetchTestStorage } from "./fetch-test-storage.js";
import type { CapturedCardRecord } from "../../../src/testing/fixture-schema.js";
import type { CardRecord } from "../../../src/card/fetch/card-record.js";

/** Captured record -> the shape capture.rb#card_attributes recorded. */
async function toCapturedRecord(
  storage: FetchTestStorage,
  card: CardRecord,
): Promise<CapturedCardRecord> {
  const engine = storage.engine;
  const typeCard = card.typeId === undefined ? undefined : await engine.fetchById(card.typeId);
  const typeCode = card.typeId === undefined ? undefined : await engine.codenames.nameForId(card.typeId);
  const name = card.name;
  const isSimple = name === undefined || name.isSimple;
  return {
    id: card.id as number,
    name: name?.s ?? "",
    key: card.key ?? "",
    type: typeCard?.name?.s ?? "",
    type_code: typeCode ?? "",
    codename: card.codename ?? null,
    content: card.dbContent ?? "", // content/all.rb:19 db_content || (new_card? ? default : "")
    left: isSimple ? null : (name?.leftName?.s ?? null),
    right: isSimple ? null : (name?.rightName?.s ?? null),
  };
}

describe("oracle replay: card-engine (fetch/cache layer)", () => {
  it("replays the captured smoke card records byte-exactly", async () => {
    const storage = await createFetchTestStorage();
    try {
      // --- cardtype cards (names + codenames per capture.rb note: 1.110
      // renamed Basic -> RichText; type_code :basic) ---
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, { id: 5, name: "Search", codename: "search_type", typeId: 2 });
      await seedCard(storage, { id: 6, name: "Set", codename: "set", typeId: 2 });
      await seedCard(storage, { id: 7, name: "List", codename: "list", typeId: 2 });
      // --- junction part cards (the lexicon composes names through these) ---
      await seedCard(storage, { id: 701, name: "child_one", typeId: 2 });
      await seedCard(storage, { id: 702, name: "child_two", typeId: 2 });
      await seedCard(storage, { id: 703, name: "rich_child", typeId: 2 });
      await seedCard(storage, { id: 704, name: "*self", typeId: 6 });
      await seedCard(storage, { id: 705, name: "*read", typeId: 2 });
      // --- the captured cards themselves (ids/contents from smoke.json) ---
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
      await seedCard(storage, { id: 614, name: "Oracle Search", typeId: 5, dbContent: '{"left":"Oracle Junction","sort":"name"}' });
      await seedCard(storage, { id: 615, name: "Oracle Restricted", typeId: 2, dbContent: "Only administrators can read me." });
      await seedCard(storage, { id: 616, name: "Oracle Restricted+*self", leftId: 615, rightId: 704, typeId: 6, dbContent: "" });
      await seedCard(storage, { id: 617, name: "Oracle Restricted+*self+*read", leftId: 616, rightId: 705, typeId: 7, dbContent: "Administrator" });

      // --- card-engine handler: fetch by name, compose the captured shape ---
      const registry = new HandlerRegistry();
      registry.register("card-engine", async ({ name }) => {
        const card = await storage.engine.fetchByName(name);
        if (card === undefined) {
          return { kind: "error" as const, errorClass: "RuntimeError", message: `seeded card missing: ${name}` };
        }
        return jsonValue(await toCapturedRecord(storage, card));
      });

      const fixtures = DEFAULT_FIXTURE_PATHS.map(loadFixtureFile);
      const report = await replayEntries(collectReplayEntries(fixtures), registry);

      const cardEntries = report.entries.filter((entry) => entry.area === "card-engine");
      expect(cardEntries.length).toBe(10);
      const failures = cardEntries.filter((entry) => entry.status !== "pass");
      expect(failures.map(formatReplayFailure)).toEqual([]);
    } finally {
      storage.close();
    }
  });
});
