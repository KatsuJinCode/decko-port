

import { afterEach, describe, it } from "vitest";
import {
  closeWorld,
  freshWorld,
  givenExtendedDeck,
  givenSignedInAs,
  givenStandardDeck,
  thenSee,
  type GherkinWorld,
  whenCreateCard,
  whenGoToCard,
} from "./gherkin-steps.js";

describe("Gherkin port: basic views (home.feature + structure.feature + pointer_inputs.feature)", () => {
  let world: GherkinWorld;

  afterEach(async () => {
    if (world) await closeWorld(world);
  });

  it("home.feature / I open homepage — render produces a titled slot for Home", async () => {
    world = await freshWorld();
    await givenStandardDeck(world);

    await whenCreateCard(world, "RichText", "Home", "Welcome, Card Shark");

    await whenGoToCard(world, "Home", "titled");

    thenSee(world, "Welcome, Card Shark");

    thenSee(world, "card-slot");
  });

  it("structure.feature / I go to card Movie+*type+*structure — render shows the structure card slot", async () => {
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

    thenSee(world, "card-slot");

    thenSee(world, "Movie+*type+*structure");
  });

  it("pointer_inputs.feature / I go to card Joe User+friends — render of a missing plus card", async () => {
    world = await freshWorld();
    await givenExtendedDeck(world);

    await whenCreateCard(world, "Phrase", "User+*type+*structure", "{{+friends}}");

    await whenCreateCard(world, "Phrase", "Joe User+friends", "");
    await whenGoToCard(world, "Joe User+friends", "titled");

    thenSee(world, "card-slot");
  });

  it("navbox.feature / quick search — fetch by name returns the card", async () => {
    world = await freshWorld();
    await givenStandardDeck(world);

    await whenCreateCard(world, "RichText", "Joe Admin", "administrator body");
    await whenCreateCard(world, "RichText", "Joe Camel", "user body");
    await whenCreateCard(world, "RichText", "Sample Skin", "skin body");

    await whenGoToCard(world, "Joe Admin", "titled");
    thenSee(world, "Joe Admin");
    await whenGoToCard(world, "Joe Camel", "titled");
    thenSee(world, "Joe Camel");
    await whenGoToCard(world, "Sample Skin", "titled");
    thenSee(world, "Sample Skin");
  });
});
