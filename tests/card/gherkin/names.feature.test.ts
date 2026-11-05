// Gherkin port — name algebra slice.
//
// Upstream: decko-commons/decko/decko/features/*.feature does not have a
// dedicated name.feature, but EVERY feature exercises the name layer
// (every card name like "Duck Soup", "Movie+*type+*structure",
// "color+*right+*default" goes through Cardname.parse). These specs port
// the name-algebra assertions that the upstream scenarios implicitly
// require, against the TS DeckoName port (src/card/name.ts).
//
// Ruby references: cardname 0.20.0 lib/cardname.rb + lib/cardname/*.rb,
// card-1.110.0 lib/card/name.rb + lib/card/name/name_variants.rb.

import { describe, it } from "vitest";
import { DeckoName } from "../../../src/card/name.js";
import {
  thenNameIsCompound,
  thenNameIsSimple,
  thenNameKey,
} from "./gherkin-steps.js";

describe("Gherkin port: card name algebra (every feature file)", () => {
  // Simple names — the common case
  it("conflict.feature — 'Duck Soup' parses with a simple key", () => {
    thenNameKey("Duck Soup", "duck_soup");
    thenNameIsSimple("Duck Soup");
  });

  it("conflict.feature — 'First' (existing seed card) parses with a simple key", () => {
    thenNameKey("First", "first");
    thenNameIsSimple("First");
  });

  // Compound names — the structural case (structure.feature uses these)
  it("structure.feature — 'Movie+*type+*structure' is a triple-jointed compound", () => {
    thenNameIsCompound("Movie+*type+*structure");
  });

  it("structure.feature — 'color+*right+*default' is compound", () => {
    thenNameIsCompound("color+*right+*default");
  });

  it("structure.feature — 'Movie+*type+*structure' left-of-left is 'Movie'", () => {
    // The structure.feature Gherkin relies on DeckoName.leftName being
    // navigable: for the triple-joint name, leftName is itself
    // compound (Movie+*type); its leftName is "Movie" — the rule walk
    // uses this to resolve the type card.
    const n = DeckoName.parse("Movie+*type+*structure");
    if (n.leftName === undefined || !n.leftName.isCompound) {
      throw new Error(`expected compound leftName, got ${n.leftName?.s}`);
    }
    const inner = n.leftName.leftName;
    if (inner === undefined || inner.s !== "Movie") {
      throw new Error(`expected leftName.leftName 'Movie', got ${inner?.s}`);
    }
  });

  // Pointer-card names — pointer_inputs.feature
  it("pointer_inputs.feature — 'Joe User+friends' is a 2-part compound", () => {
    thenNameIsCompound("Joe User+friends");
  });

  // Names with star markers (codename-anchored)
  it("conflict.feature — '*type' (star-named set card) is simple", () => {
    thenNameIsSimple("*type");
  });

  it("pointer_inputs.feature — 'User+*type+*structure' is compound", () => {
    thenNameIsCompound("User+*type+*structure");
  });

  // Setup feature — setup.feature (homepage setup wizard)
  it("setup.feature — 'The Newber' (an account name) parses simply", () => {
    thenNameKey("The Newber", "the_newber");
    thenNameIsSimple("The Newber");
  });

  // Follow feature — follow.feature (notification/follow interface)
  it("follow.feature — 'Home+*self' is compound (left + right joint)", () => {
    thenNameIsCompound("Home+*self");
  });

  it("follow.feature — 'User+*type' is compound", () => {
    thenNameIsCompound("User+*type");
  });

  // Attach feature — file/image cards
  it("attach.feature — 'a test file' parses simply", () => {
    thenNameKey("a test file", "a_test_file");
    thenNameIsSimple("a test file");
  });

  it("attach.feature — 'Vignesh has a complicated relationship' parses simply", () => {
    // The DeckoName port applies Ruby's inflect rules — "has" is not
    // singularized to "ha", but the plural-stem rule does trim some
    // suffixes. Assert isSimple rather than the exact key, which is
    // an inflect detail tracked in tests/card/name/name-port.test.ts.
    thenNameIsSimple("Vignesh has a complicated relationship");
  });

  // Pointer-input compound names
  it("pointer_inputs.feature — 'friends+*right+*input type' is compound", () => {
    thenNameIsCompound("friends+*right+*input type");
  });

  // History feature
  it("history.feature — 'First' (seed card name) is simple", () => {
    thenNameIsSimple("First");
  });

  // Update-includers feature
  it("update_includers.feature — 'Ulysses+Author' is compound", () => {
    thenNameIsCompound("Ulysses+Author");
    // The DeckoName port applies Ruby's plural-stem rule to "Ulysses"
    // (singularizes to "ulyss"); the + author suffix is preserved.
    // Assert the structural property (compound), not the inflect detail.
  });

  it("update_includers.feature — 'Banana+color+*self' is triple-jointed", () => {
    thenNameIsCompound("Banana+color+*self");
  });
});
