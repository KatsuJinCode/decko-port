

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
    expect(DeckoName.parse("Gordon's").key).toBe("gordon_");
    expect(DeckoName.parse("delete this").key).toBe("delete_thi");
  });

  it("uncountables append to the default list and protect whole words", () => {
    applyDeckInflections({ uncountables: ["s", "this"] });

    expect(singularize("s")).toBe("s");
    expect(singularize("this")).toBe("this");
    expect(DeckoName.parse("Gordon's").key).toBe("gordon_s");
    expect(DeckoName.parse("delete this").key).toBe("delete_this");

    expect(singularize("series")).toBe("series");
    expect(singularize("equipment")).toBe("equipment");

    expect(singularize("musings")).toBe("musing");
    expect(singularize("is")).toBe("i");
  });

  it("uncountable matching is word-boundary anchored and case-insensitive", () => {
    applyDeckInflections({ uncountables: ["this"] });

    expect(singularize("this")).toBe("this");
    expect(singularize("This")).toBe("This");
    expect(singularize("somens")).toBe("somen");
  });

  it("deck rules prepend over the defaults, later definitions winning", () => {

    expect(singularize("lies")).toBe("ly");
    applyDeckInflections({ singular: [[/(..)ies$/i, "$1y"], [/lies$/i, "layout"]] });

    expect(singularize("lies")).toBe("layout");

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
    const stale = DeckoName.parse("Gordon's");
    expect(stale.key).toBe("gordon_");
    applyDeckInflections({ uncountables: ["s"] });

    expect(DeckoName.parse("Gordon's").key).toBe("gordon_s");

    expect(stale.key).toBe("gordon_");
    resetDeckInflections();
    expect(DeckoName.parse("Gordon's").key).toBe("gordon_");
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
