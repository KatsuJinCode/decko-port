// The data-slot nest_name carries the AUTHORED reference form, not the
// resolved (absolutized) card name.
//
// Pins the format.ts#nest fix: the voo's nest_name is seeded from the
// nest chunk's authored reference, verbatim (card-mod-content
// lib/card/content/chunk/nest.rb:23 builds the chunk options with
// `@options = interpret_options.merge nest_name: name,
// nest_syntax: in_brackets` — `name` is the authored reference; the
// resolved name only feeds the fetch and the slot's data-card-name).
//
// Oracles:
//   - raw recapture oracle (tmp/raw-ground-truth/expected/
//     recapture-raw-shard-000005.jsonl, entry id 9625 "The End of Awe
//     by Maureen Dowd - NYTimes", the round-9 lane's named first
//     difference): the `{{+Source Title}}` nest's slot carries
//     nest_name "+Source Title" while data-card-name stays absolute
//     ("The End of Awe by Maureen Dowd - NYTimes+Source Title").
//   - live wire (tmp/live-wire/*.html, the arbiter): nest_name values
//     are authored bytes — "+tag", "+related", "+Source Title",
//     "+Organizer(s)", "_main", "Su$tainability" (dollar intact),
//     "Conflict_Done_Well+class_schedule" (authored underscores) —
//     never the absolutized forms the engine emitted before this fix
//     ("Brandon WilliamsCraig+Image", "Cheryl Honey+Recommendations",
//     ... in tmp/wrong-goal-hunt/ours/*.html).
//
// The pointer/list item path (views.ts#renderPointerListItem) keeps
// passing the item's absolute name explicitly — live pins the item
// slots' nest_name as the absolute item name ("Aikido Oak Cliff+Gallery").
//
// Rule-less storage: no read rules exist, so the rule-less allowance
// keeps every card readable and the nest renders the titled child body.

import { describe, it, expect, afterAll } from "vitest";
import { createRenderTestStorage, seedCard, type RenderTestStorage } from "./render-test-storage.js";

let storage: RenderTestStorage | undefined;

afterAll(() => {
  storage?.close();
});

describe("data-slot nest_name: authored reference form (raw oracle 9625 + live wire)", () => {
  it("renders {{+Source Title}} with nest_name '+Source Title' and absolute data-card-name", async () => {
    storage = await createRenderTestStorage();
    // The referencing parent, its right-part card, and the junction
    // child (decko convention: junction rows store the canonical key,
    // parts seeded so the lexicon resolves left_id/right_id).
    await seedCard(storage, {
      id: 99200,
      name: "Deferred Lane Parent",
      typeId: 2,
      dbContent: "<p>{{+Source Title}}</p>",
    });
    await seedCard(storage, { id: 99201, name: "Source Title", typeId: 2 });
    await seedCard(storage, {
      id: 99202,
      name: "Deferred Lane Parent+Source Title",
      leftId: 99200,
      rightId: 99201,
      typeId: 2,
      dbContent: "<p>the source title body</p>",
    });
    const html = await storage.engine.render("Deferred Lane Parent", "content");

    // The slot's own identity attrs stay absolute (raw oracle id 9625:
    // data-card-name="The End of Awe by Maureen Dowd - NYTimes+Source
    // Title").
    expect(html).toContain('data-card-name="Deferred Lane Parent+Source Title"');
    // nest_name + nest_syntax keep the AUTHORED reference bytes.
    expect(html).toContain("&quot;nest_name&quot;:&quot;+Source Title&quot;");
    expect(html).toContain("&quot;nest_syntax&quot;:&quot;+Source Title&quot;");
    // The slot id is the safe key of the RESOLVED name (unchanged).
    expect(html).toContain('id="deferred_lane_parent-source_title-titled-view"');
  });
});
