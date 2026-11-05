// Regression pins for the item-slot `type` option — the slot-JSON
// `"type"` field and the typed unknown-item identity.
//
// Ruby mechanism (every assertion traces to it):
//  * card-mod-collection set/all/item.rb:122-126 nest_item ->
//    item_view_options (:149-155) -> determine_item_view_options_type
//    (:157-162): `options[:type] = card.item_type_name` rides EVERY item
//    nest, so the item slot's data-slot JSON (voo.slot_options) carries
//    `"type"` after `home_view` in the slot-keys order.
//  * item.rb:245-248 new_unknown_item_args: a fetch-miss item is
//    constructed with `type: item_type_name` (the HOST's item type), so
//    the phantom slot's data-card-type-* attrs and class chain carry the
//    host-resolved type — not the *all+*default fallback.
//  * The host's item_type_name chain: card-mod-search cql_search.rb:14-19
//    (Search/Set hosts read their own cql :type) and card-mod-collection
//    set/abstract/items.rb:5-11 + card-mod-layout options_api.rb options_card
//    (pointer/list hosts walk rule_card(:content_options) -> the Search-typed
//    JSON spec rule -> its cql :type).
//
// Corpus evidence: Free Aiki Dojo+Central Places:render:open
// (recapture-raw-shard-000024) — the host's *content options rule 501
// is `{"type": "Place"}`; the readable items (Aikido of Berkeley et al.)
// carry `,&quot;type&quot;:&quot;Place&quot;` in the slot JSON and the
// unknown items (The Flight Deck, Pacific Rim International School — no
// data-card-id) render `ALL TYPE-place` slots with
// data-card-type-id="442" data-card-type-name="Place".

import { describe, it, expect, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "./render-test-storage.js";

let storage: RenderTestStorage | undefined;

afterAll(() => {
  storage?.close();
});

/** Seed the shared type/codename skeleton + the Associates family:
 *  Jane+Associates is a List-typed pointer whose right carries a
 *  *content options rule (Search-typed, `{"type":"Person"}`); Jane+Fields
 *  is the control pointer with NO rule. Items: Alice (a real Person-typed
 *  card) and Bob (never seeded — the phantom). */
async function seedDeck(): Promise<RenderTestStorage> {
  storage = await createRenderTestStorage();
  // Type cards (codename column feeds the codehash peekNameForId).
  await seedCard(storage, { id: 2, name: "Basic", codename: "basic", typeId: 2 });
  await seedCard(storage, { id: 10, name: "List", codename: "list", typeId: 2 });
  await seedCard(storage, { id: 11, name: "Search", codename: "search_type", typeId: 2 });
  await seedCard(storage, { id: 12, name: "Person", codename: "person", typeId: 2 });
  // Name-ladder parts.
  await seedCard(storage, { id: 20, name: "Jane", typeId: 2 });
  await seedCard(storage, { id: 21, name: "Associates", typeId: 2 });
  await seedCard(storage, { id: 22, name: "*right", codename: "right", typeId: 2 });
  await seedCard(storage, {
    id: 23,
    name: "*content options",
    codename: "content_options",
    typeId: 2,
  });
  await seedCard(storage, { id: 24, name: "Fields", typeId: 2 });
  // Set anchors: Associates+*right (24->21+22), Fields+*right (25->24+22).
  await seedCard(storage, { id: 30, leftId: 21, rightId: 22, typeId: 2 });
  await seedCard(storage, { id: 31, leftId: 24, rightId: 22, typeId: 2 });
  // The *content options rule on Associates+*right: Search-typed JSON spec.
  await seedCard(storage, {
    id: 32,
    leftId: 30,
    rightId: 23,
    typeId: 11,
    dbContent: '{"type":"Person"}',
  });
  // The pointer hosts. Alice is a real Person card; Bob is never seeded.
  await seedCard(storage, {
    id: 33,
    leftId: 20,
    rightId: 21,
    typeId: 10,
    dbContent: "Alice\nBob\n",
  });
  await seedCard(storage, {
    id: 34,
    leftId: 20,
    rightId: 24,
    typeId: 10,
    dbContent: "Alice\n",
  });
  await seedCard(storage, { id: 40, name: "Alice", typeId: 12 });
  return storage;
}

describe("item-slot type option (nest_item item-type chain)", () => {
  it(
    "host *content options rule types the item slot JSON and the unknown-item identity",
    async () => {
      const s = await seedDeck();
      const html = await s.engine.render("Jane+Associates", "content");
      // Readable REAL item (Alice): the bar-view slot's data-slot JSON
      // carries `"type":"Person"` after home_view (slot-keys order).
      expect(html).toContain(
        "&quot;home_view&quot;:&quot;bar&quot;,&quot;type&quot;:&quot;Person&quot;}",
      );
      // Unknown item (Bob): new_unknown_item_args types the phantom with
      // the host's item type — Person attrs + the type's KEY-form class
      // chip (oracle pin: ALL TYPE-place for the Place rule family,
      // shard-000024) — NOT the *all+*default BasicCs fallback.
      expect(html).toContain('id="bob-mini_bar-view"');
      expect(html).toContain("ALL TYPE-person");
      expect(html).toContain('data-card-type-id="12"');
      expect(html).toContain('data-card-type-name="Person"');
      // The phantom's slot JSON carries the type too.
      expect(html).toContain('&quot;nest_name&quot;:&quot;Bob&quot;');
      // Sanity: Alice's slot is the readable bar-view shape.
      expect(html).toContain('id="alice-bar-view"');
    },
  );

  it(
    "a host without a *content options rule renders the type-less item slot JSON",
    async () => {
      const s = await seedDeck();
      const html = await s.engine.render("Jane+Fields", "content");
      // No rule -> no type opt -> the JSON closes after home_view.
      expect(html).toContain(
        "&quot;home_view&quot;:&quot;bar&quot;}",
      );
      expect(html).not.toContain("&quot;type&quot;:");
      // The real item's OWN type attrs still render (Alice is Person).
      expect(html).toContain('data-card-type-name="Person"');
    },
  );
});
