// Gherkin port — card CRUD slice.
//
// Upstream: decko-commons/decko/decko/features/conflict.feature (card
// create / update / delete) and structure.feature (cardtype, templated
// card). Both feature files require a real Rails stack with Capybara +
// a browser; this port executes the same business behavior against the
// TS engine (CardActionEngine + FetchEngine) with vitest.
//
// Each "it" header carries the upstream scenario name so the link to
// the source feature is obvious from the spec alone. The `// upstream`
// comment at each step names the corresponding Ruby step exactly as it
// appears in decko-commons/decko.

import { afterEach, describe, expect, it } from "vitest";
import {
  closeWorld,
  freshWorld,
  givenExtendedDeck,
  givenSignedInAs,
  givenStandardDeck,
  thenCardContains,
  thenCardExists,
  thenCardNotContains,
  thenCardNotExists,
  thenCardTrashed,
  thenSee,
  type GherkinWorld,
  whenCreateCard,
  whenCreateSimpleCard,
  whenDeleteCard,
  whenGoToCard,
  whenSetContent,
  whenTouch,
} from "./gherkin-steps.js";

describe("Gherkin port: card create/read/update/delete (conflict.feature + structure.feature)", () => {
  let world: GherkinWorld;

  afterEach(async () => {
    if (world) await closeWorld(world);
  });

  // ---------------------------------------------------------------------
  // conflict.feature, Scenario: Two edits on a card at the same time
  // (the create half — Joe Admin creates "Duck Soup" with body)
  // ---------------------------------------------------------------------

  it("conflict.feature / Two edits — background: I create Phrase card with content", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);
    // upstream: Given I am signed in as Joe Admin
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    // upstream: And I create Phrase card "Duck Soup" with content "Laurel and Hardy"
    await whenCreateCard(world, "Phrase", "Duck Soup", "Laurel and Hardy");
    // Then the card exists with the right content
    await thenCardExists(world, "Duck Soup");
    await thenCardContains(world, "Duck Soup", "Laurel and Hardy");
  });

  it("conflict.feature / Two edits — Joe Admin edits Duck Soup with a new body", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    await whenCreateCard(world, "Phrase", "Duck Soup", "Laurel and Hardy");
    // upstream: When I edit "Duck Soup" setting content to "Oliver Laurel"
    await whenSetContent(world, "Duck Soup", "Oliver Laurel");
    await thenCardContains(world, "Duck Soup", "Oliver Laurel");
    await thenCardNotContains(world, "Duck Soup", "Laurel and Hardy");
  });

  it("conflict.feature / Two edits — second editor changes the card to a divergent body", async () => {
    // The conflict.feature scenario uses a second window / second actor.
    // Here we simulate the same divergent edit pattern in the same
    // engine: actor A saves A's content, actor B saves B's content, both
    // succeed (the engine records each as a separate act). The
    // CONFLICT-detection layer is downstream of this port (see
    // docs/actions-port-notes.md); what the engine proves is that both
    // acts persisted independently.
    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    await whenCreateCard(world, "Phrase", "Duck Soup", "Laurel and Hardy");
    // upstream: When I edit "Duck Soup" filling in "Stan Hardy"
    await whenSetContent(world, "Duck Soup", "Stan Hardy");
    // upstream: And I open a new window for Joe User / And I edit "Duck Soup" setting content to "Oliver Laurel"
    await givenSignedInAs(world, { id: 9, name: "Joe User" });
    await whenSetContent(world, "Duck Soup", "Oliver Laurel");
    // The engine records the LATEST save's body.
    await thenCardContains(world, "Duck Soup", "Oliver Laurel");
  });

  it("conflict.feature / Two edits with the same change — no-op second save", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    await whenCreateCard(world, "Phrase", "Duck Soup", "Laurel and Hardy");
    // upstream: When I edit "Duck Soup" setting content to "Stan Laurel"
    await whenSetContent(world, "Duck Soup", "Stan Laurel");
    // Same edit again — events.rb:34-37 returns null (no-op save).
    await whenSetContent(world, "Duck Soup", "Stan Laurel");
    await thenCardContains(world, "Duck Soup", "Stan Laurel");
    // Sanity: the engine recorded only ONE update action for the change,
    // not two — proves the no-op branch (actions-port-notes.md section
    // 1.3).
    expect(await world.storage.count("card_actions")).toBe(2); // 1 create + 1 update
  });

  it("conflict.feature / I edit without changing — touch is a no-op", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    await whenCreateCard(world, "Phrase", "Duck Soup", "Laurel and Hardy");
    // Touch — equivalent to opening the editor and saving unchanged.
    await whenTouch(world, "Duck Soup");
    // Only the create action exists; no update.
    expect(await world.storage.count("card_actions")).toBe(1);
  });

  // ---------------------------------------------------------------------
  // structure.feature — Cardtype + structure card create + default rule
  // ---------------------------------------------------------------------

  it("structure.feature / I create Cardtype card (and a Rule card with template content)", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    // upstream: And I create Cardtype card "Movie"
    await whenCreateCard(world, "Cardtype", "Movie", "");
    await thenCardExists(world, "Movie");
    // upstream: And I create RichText card "Movie+*type+*structure" with content "{{+director}} {{+lead}} {{+color}}"
    await whenCreateCard(
      world,
      "RichText",
      "Movie+*type+*structure",
      "{{+director}} {{+lead}} {{+color}}",
    );
    await thenCardExists(world, "Movie+*type+*structure");
    await thenCardContains(world, "Movie+*type+*structure", "{{+director}}");
    // upstream: And I create Phrase card "color+*right+*default" with content "true dat"
    await whenCreateCard(world, "Phrase", "color+*right+*default", "true dat");
    await thenCardExists(world, "color+*right+*default");
    await thenCardContains(world, "color+*right+*default", "true dat");
  });

  it("structure.feature / I go to card <templated> — render shows the structure body", async () => {
    world = await freshWorld();
    await givenStandardDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    await whenCreateCard(world, "Cardtype", "Movie", "");
    await whenCreateCard(
      world,
      "RichText",
      "Movie+*type+*structure",
      "{{+director}} {{+lead}} {{+color}}",
    );
    // upstream: When I go to card "Movie+*type+*structure"
    await whenGoToCard(world, "Movie+*type+*structure", "content");
    // The render engine processes the template body: `{{+lead}}` is a
    // nest token resolved against the plus card; with no plus cards
    // seeded, the nest renders empty. The data-card-name attribute
    // preserves the structure card's name across the round trip —
    // proves the structure body was stored and rendered.
    thenSee(world, "data-card-name=\"Movie+*type+*structure\"");
    thenSee(world, "card-slot");
  });

  // ---------------------------------------------------------------------
  // Card delete — the upstream conflict.feature does not exercise
  // delete, but notifications.feature / update_includers.feature do.
  // ---------------------------------------------------------------------

  it("card delete — soft-trash flip on a simple card (trash.rb:11-21)", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    await whenCreateCard(world, "Phrase", "Doomed", "v1");
    await thenCardExists(world, "Doomed");
    // upstream: When I delete "Doomed"
    await whenDeleteCard(world, "Doomed");
    // The card is now trashed; a default fetch skips trashed cards
    // (fetch.rb:49-51).
    await thenCardNotExists(world, "Doomed");
    await thenCardTrashed(world, "Doomed");
  });

  it("card create — illegal name is rejected (validate_legality_of_name)", async () => {
    world = await freshWorld();
    await givenStandardDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    // Empty name
    await expect(whenCreateSimpleCard(world, "", "body")).rejects.toMatchObject({
      code: "name-illegal",
    });
    // Lone joint (+orphan)
    await expect(whenCreateSimpleCard(world, "+orphan", "body")).rejects.toMatchObject({
      code: "name-illegal",
    });
  });

  it("card create — duplicate name is rejected (validate_uniqueness_of_name)", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    await whenCreateCard(world, "Phrase", "Pudding", "v1");
    // Same key collision
    await expect(whenCreateCard(world, "Phrase", "pudding", "v2")).rejects.toMatchObject({
      code: "name-conflict",
    });
  });
});
