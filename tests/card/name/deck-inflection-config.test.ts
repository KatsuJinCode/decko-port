/**
 * Deck-inflection-config seam tests.
 *
 * The engine's inflection tables (src/card/name/inflect.ts) ship the DEFAULT
 * English rules transcribed from activesupport 7.2.3.2; a deck may amend them
 * at boot the way a Rails deck does in config/initializers/inflections.rb.
 * That amendment is DECK DATA supplied by deck-boot tooling, never hardcoded
 * in src/ - these tests pin the seam's mechanics with a synthetic table so no
 * test here depends on any specific deck's config.
 *
 * Semantics pinned (mirroring ActiveSupport::Inflector::Inflections):
 *  - uncountable words APPEND to the default uncountables;
 *  - singular/plural rule pairs PREPEND over the defaults, later definitions
 *    winning (Inflections#singular/#plural use Ruby prepend);
 *  - a config change drops memoized DeckoName keys (the parse cache);
 *  - resetDeckInflections restores the gem-standard tables.
 */

import { afterEach, describe, expect, it } from "vitest";
import { DeckoName } from "../../../src/card/name.js";
import {
  applyDeckInflections,
  pluralize,
  resetDeckInflections,
  singularize,
} from "../../../src/card/name/inflect.js";

afterEach(() => {
  resetDeckInflections();
});

describe("deck inflection config seam", () => {
  it("defaults reproduce the gem-standard keys", () => {
    resetDeckInflections();
    expect(singularize("musings")).toBe("musing");
    expect(DeckoName.parse("Brandon's").key).toBe("brandon_");
    expect(DeckoName.parse("delete this").key).toBe("delete_thi");
  });

  it("uncountables append to the default list and protect whole words", () => {
    applyDeckInflections({ uncountables: ["s", "this"] });
    // deck words protected
    expect(singularize("s")).toBe("s");
    expect(singularize("this")).toBe("this");
    expect(DeckoName.parse("Brandon's").key).toBe("brandon_s");
    expect(DeckoName.parse("delete this").key).toBe("delete_this");
    // default uncountables still honored
    expect(singularize("series")).toBe("series");
    expect(singularize("equipment")).toBe("equipment");
    // every other default rule still fires
    expect(singularize("musings")).toBe("musing");
    expect(singularize("is")).toBe("i");
  });

  it("uncountable matching is word-boundary anchored and case-insensitive", () => {
    applyDeckInflections({ uncountables: ["this"] });
    // whole-word match only: "this" protected, "thsomething" not, suffix not
    expect(singularize("this")).toBe("this");
    expect(singularize("This")).toBe("This");
    expect(singularize("somens")).toBe("somen");
  });

  it("deck rules prepend over the defaults, later definitions winning", () => {
    // default: "lies" -> "ly" via /([^aeiouy]|qu)ies$/ -> "$1y"
    expect(singularize("lies")).toBe("ly");
    applyDeckInflections({ singular: [[/(..)ies$/i, "$1y"], [/lies$/i, "layout"]] });
    // prepended: /lies$/ wins over everything (prepend order: last defined first)
    expect(singularize("lies")).toBe("layout");
    // default rules still apply below the deck rules
    expect(singularize("pies")).toBe("py");
    applyDeckInflections({ singular: [[/pies$/i, "chart"], [/lies$/i, "layout"]] });
    expect(singularize("lies")).toBe("layout");
    expect(singularize("pies")).toBe("chart");
  });

  it("plural amendments follow the same prepend semantics", () => {
    expect(pluralize("octopus")).toBe("octopi");
    applyDeckInflections({ plural: [[/^octopus$/i, "octopodes"]] });
    expect(pluralize("octopus")).toBe("octopodes");
    expect(pluralize("cat")).toBe("cats");
  });

  it("a config change invalidates the parse cache so new parses recompute", () => {
    const stale = DeckoName.parse("Brandon's");
    expect(stale.key).toBe("brandon_");
    applyDeckInflections({ uncountables: ["s"] });
    // fresh parse (cache dropped) computes under the deck table...
    expect(DeckoName.parse("Brandon's").key).toBe("brandon_s");
    // ...while a frozen instance memoized before the change keeps its key -
    // identical to Ruby, where @key ||= memoizes per Cardname instance and a
    // Rails inflections initializer runs before any name exists. This is why
    // deck-boot tooling must apply the config before seeding names.
    expect(stale.key).toBe("brandon_");
    resetDeckInflections();
    expect(DeckoName.parse("Brandon's").key).toBe("brandon_");
  });

  it("resetDeckInflections restores the gem-standard tables after amendments", () => {
    applyDeckInflections({
      uncountables: ["s", "this", "anonymous"],
      singular: [[/lies$/i, "layout"]],
    });
    resetDeckInflections();
    expect(singularize("s")).toBe("");
    expect(singularize("this")).toBe("thi");
    expect(singularize("lies")).toBe("ly");
    expect(DeckoName.parse("Anonymous").key).toBe("anonymou");
  });
});
