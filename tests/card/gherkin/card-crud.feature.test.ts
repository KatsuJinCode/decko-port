

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

  it("conflict.feature / Two edits — background: I create Phrase card with content", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);

    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });

    await whenCreateCard(world, "Phrase", "Duck Soup", "Laurel and Hardy");

    await thenCardExists(world, "Duck Soup");
    await thenCardContains(world, "Duck Soup", "Laurel and Hardy");
  });

  it("conflict.feature / Two edits — Joe Admin edits Duck Soup with a new body", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    await whenCreateCard(world, "Phrase", "Duck Soup", "Laurel and Hardy");

    await whenSetContent(world, "Duck Soup", "Oliver Laurel");
    await thenCardContains(world, "Duck Soup", "Oliver Laurel");
    await thenCardNotContains(world, "Duck Soup", "Laurel and Hardy");
  });

  it("conflict.feature / Two edits — second editor changes the card to a divergent body", async () => {

    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    await whenCreateCard(world, "Phrase", "Duck Soup", "Laurel and Hardy");

    await whenSetContent(world, "Duck Soup", "Stan Hardy");

    await givenSignedInAs(world, { id: 9, name: "Joe User" });
    await whenSetContent(world, "Duck Soup", "Oliver Laurel");

    await thenCardContains(world, "Duck Soup", "Oliver Laurel");
  });

  it("conflict.feature / Two edits with the same change — no-op second save", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    await whenCreateCard(world, "Phrase", "Duck Soup", "Laurel and Hardy");

    await whenSetContent(world, "Duck Soup", "Stan Laurel");

    await whenSetContent(world, "Duck Soup", "Stan Laurel");
    await thenCardContains(world, "Duck Soup", "Stan Laurel");

    expect(await world.storage.count("card_actions")).toBe(2);
  });

  it("conflict.feature / I edit without changing — touch is a no-op", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    await whenCreateCard(world, "Phrase", "Duck Soup", "Laurel and Hardy");

    await whenTouch(world, "Duck Soup");

    expect(await world.storage.count("card_actions")).toBe(1);
  });

  it("structure.feature / I create Cardtype card (and a Rule card with template content)", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });

    await whenCreateCard(world, "Cardtype", "Movie", "");
    await thenCardExists(world, "Movie");

    await whenCreateCard(
      world,
      "RichText",
      "Movie+*type+*structure",
      "{{+director}} {{+lead}} {{+color}}",
    );
    await thenCardExists(world, "Movie+*type+*structure");
    await thenCardContains(world, "Movie+*type+*structure", "{{+director}}");

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

    await whenGoToCard(world, "Movie+*type+*structure", "content");

    thenSee(world, "data-card-name=\"Movie+*type+*structure\"");
    thenSee(world, "card-slot");
  });

  it("card delete — soft-trash flip on a simple card (trash.rb:11-21)", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    await whenCreateCard(world, "Phrase", "Doomed", "v1");
    await thenCardExists(world, "Doomed");

    await whenDeleteCard(world, "Doomed");

    await thenCardNotExists(world, "Doomed");
    await thenCardTrashed(world, "Doomed");
  });

  it("card create — illegal name is rejected (validate_legality_of_name)", async () => {
    world = await freshWorld();
    await givenStandardDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });

    await expect(whenCreateSimpleCard(world, "", "body")).rejects.toMatchObject({
      code: "name-illegal",
    });

    await expect(whenCreateSimpleCard(world, "+orphan", "body")).rejects.toMatchObject({
      code: "name-illegal",
    });
  });

  it("card create — duplicate name is rejected (validate_uniqueness_of_name)", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);
    await givenSignedInAs(world, { id: 1, name: "Joe Admin" });
    await whenCreateCard(world, "Phrase", "Pudding", "v1");

    await expect(whenCreateCard(world, "Phrase", "pudding", "v2")).rejects.toMatchObject({
      code: "name-conflict",
    });
  });
});
