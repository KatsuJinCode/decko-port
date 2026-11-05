// Surface 1 — per-set content-override registry.
// Validates the seam the mod loader uses to substitute a registered
// ContentFn for a card's dbContent at renderRaw time. The corpus suites
// under tests/card/render/ pin the bytes for cards WITHOUT an override;
// this suite exercises the OVERRIDE path the ask adds.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeckoName } from "../../../src/card/name.js";
import { RenderFormat, type RenderCard, type RenderEngineLike } from "../../../src/card/render/format.js";
import {
  ContentOverrideRegistry,
  cardBelongsToSet,
  contentOverrideFor,
  resolveContentOverride,
  setDefaultContentOverrideRegistry,
  type ContentFn,
} from "../../../src/card/render/content-overrides.js";

/** Minimal stub engine (the render path only reads engine methods that
 *  the format's renderRaw doesn't touch). */
function stubEngine(): RenderEngineLike {
  return {
    views: {},
    fetchRenderCard: () => undefined,
    executeSearch: () => [],
    isDenied: () => false,
    resolveView: (_card, view) => undefined,
  };
}

/** Build a synthetic RenderCard - the engine enrichment the format layer
 *  consumes (dbContent + the DeckoName fields the format reads). */
function makeCard(name: string, dbContent: string, typeName?: string): RenderCard {
  const dn = DeckoName.parse(name);
  return {
    record: {
      id: 1,
      codename: undefined,
      leftId: undefined,
      rightId: undefined,
      typeId: undefined,
      dbContent,
      trash: false,
      creatorId: undefined,
      updaterId: undefined,
      createdAt: "2026-09-19 00:00:00.000",
      updatedAt: "2026-09-19 00:00:00.000",
      currentRevisionId: undefined,
      readRuleClass: undefined,
      readRuleId: undefined,
      referencesExpired: undefined,
      name: dn,
      key: dn.key,
      isNew: false,
      fromTrash: false,
      uncacheable: false,
    },
    name: dn,
    key: dn.key,
    typeName,
    typeCode: undefined,
    typeId: undefined,
    id: 1,
    dbContent,
    setKeys: "",
  };
}

let registry: ContentOverrideRegistry;

beforeEach(() => {
  registry = new ContentOverrideRegistry();
  setDefaultContentOverrideRegistry(registry);
});

afterEach(() => {
  setDefaultContentOverrideRegistry(undefined as unknown as ContentOverrideRegistry);
});

describe("ContentOverrideRegistry", () => {
  it("register stores and forPath retrieves a registered override", () => {
    const fn: ContentFn = () => "OVERRIDDEN";
    registry.register({ setPath: "right/when_created", modName: "card-mod-date", fn });
    expect(contentOverrideFor("right/when_created")?.fn).toBe(fn);
  });

  it("register replaces a previous registration (module-reopening last-wins)", () => {
    const a: ContentFn = () => "A";
    const b: ContentFn = () => "B";
    registry.register({ setPath: "right/when_created", modName: "card-mod-a", fn: a });
    registry.register({ setPath: "right/when_created", modName: "card-mod-b", fn: b });
    expect(contentOverrideFor("right/when_created")?.fn).toBe(b);
    expect(contentOverrideFor("right/when_created")?.modName).toBe("card-mod-b");
  });

  it("forPath returns undefined for unregistered paths", () => {
    expect(contentOverrideFor("right/never_registered")).toBeUndefined();
  });

  it("clear removes every registration", () => {
    registry.register({ setPath: "right/when_created", modName: "x", fn: () => "x" });
    registry.register({ setPath: "self/now", modName: "x", fn: () => "x" });
    registry.clear();
    expect(contentOverrideFor("right/when_created")).toBeUndefined();
    expect(contentOverrideFor("self/now")).toBeUndefined();
  });

  it("paths returns insertion order (last-wins lookup matches Map.set)", () => {
    registry.register({ setPath: "right/a", modName: "x", fn: () => "" });
    registry.register({ setPath: "right/b", modName: "x", fn: () => "" });
    registry.register({ setPath: "right/c", modName: "x", fn: () => "" });
    expect(registry.paths()).toEqual(["right/a", "right/b", "right/c"]);
  });

  it("size returns the number of unique setPath registrations", () => {
    expect(registry.size()).toBe(0);
    registry.register({ setPath: "right/a", modName: "x", fn: () => "" });
    registry.register({ setPath: "right/b", modName: "x", fn: () => "" });
    registry.register({ setPath: "right/a", modName: "y", fn: () => "" }); // replaces
    expect(registry.size()).toBe(2);
  });
});

describe("cardBelongsToSet - the membership check", () => {
  it("right pattern matches compound cards with a right part (when_created anchor)", () => {
    const card = makeCard("A+when_created", "ignored");
    expect(cardBelongsToSet(card, "right/when_created")).toBe(true);
  });

  it("right pattern matches compound cards with a right part (when_last_edited anchor)", () => {
    const card = makeCard("A+when_last_edited", "ignored");
    expect(cardBelongsToSet(card, "right/when_last_edited")).toBe(true);
  });

  it("right pattern does NOT match simple (non-compound) cards", () => {
    const card = makeCard("simple_name", "ignored");
    expect(cardBelongsToSet(card, "right/when_created")).toBe(false);
  });

  it("right pattern is anchor-distinct: when_created does not match when_last_edited (the date overrides fire per anchor)", () => {
    const created = makeCard("A+when_created", "ignored");
    expect(cardBelongsToSet(created, "right/when_last_edited")).toBe(false);
    const edited = makeCard("A+when_last_edited", "ignored");
    expect(cardBelongsToSet(edited, "right/when_created")).toBe(false);
  });

  it("right pattern keys the anchor on the right part's name key (spaces -> underscores)", () => {
    const card = makeCard("A+when last edited", "ignored");
    expect(cardBelongsToSet(card, "right/when_last_edited")).toBe(true);
  });

  it("self pattern matches exactly the card the anchor names (08_self.rb: the anchor is the card's own key)", () => {
    expect(cardBelongsToSet(makeCard("now", "ignored"), "self/now")).toBe(true);
    expect(cardBelongsToSet(makeCard("any_name", "ignored"), "self/now")).toBe(false);
  });

  it("all pattern matches every card", () => {
    expect(cardBelongsToSet(makeCard("A", ""), "all/any")).toBe(true);
    expect(cardBelongsToSet(makeCard("X+Y", ""), "all/any")).toBe(true);
  });

  it("abstract pattern matches every card", () => {
    expect(cardBelongsToSet(makeCard("A", ""), "abstract/any")).toBe(true);
  });

  it("plus pattern matches compound cards", () => {
    expect(cardBelongsToSet(makeCard("X+Y", ""), "plus/any")).toBe(true);
    expect(cardBelongsToSet(makeCard("simple", ""), "plus/any")).toBe(false);
  });

  it("star pattern matches star-named cards", () => {
    expect(cardBelongsToSet(makeCard("*self", ""), "star/any")).toBe(true);
    expect(cardBelongsToSet(makeCard("simple", ""), "star/any")).toBe(false);
  });

  it("rstar pattern matches compound cards with a star right part", () => {
    expect(cardBelongsToSet(makeCard("X+*right", ""), "rstar/any")).toBe(true);
    expect(cardBelongsToSet(makeCard("X+Y", ""), "rstar/any")).toBe(false);
  });

  it("type pattern matches when typeName camelizes to the anchor", () => {
    const card = makeCard("X", "", "date");
    expect(cardBelongsToSet(card, "type/date")).toBe(true);
    expect(cardBelongsToSet(card, "type/Date")).toBe(true);
  });

  it("unrecognized pattern returns false (safe default - falls through to dbContent)", () => {
    expect(cardBelongsToSet(makeCard("X", ""), "unknown_pattern/anchor")).toBe(false);
  });
});

describe("resolveContentOverride - renderRaw consultation", () => {
  it("returns the override's bytes when the setPath matches the card", () => {
    const card = makeCard("A+when_created", "db_content_unused");
    registry.register({
      setPath: "right/when_created",
      modName: "card-mod-date",
      fn: () => "OVERRIDE_BYTES",
    });
    const fmt = new RenderFormat(card, stubEngine());
    expect(resolveContentOverride(fmt)).toBe("OVERRIDE_BYTES");
  });

  it("returns undefined when no registered setPath matches the card (dbContent unchanged)", () => {
    const card = makeCard("simple_card", "db_content_used");
    registry.register({
      setPath: "right/when_created",
      modName: "card-mod-date",
      fn: () => "OVERRIDE",
    });
    const fmt = new RenderFormat(card, stubEngine());
    expect(resolveContentOverride(fmt)).toBeUndefined();
  });

  it("returns undefined when no registry is bound (corpus suite pin)", () => {
    setDefaultContentOverrideRegistry(undefined as unknown as ContentOverrideRegistry);
    const card = makeCard("A+when_created", "db_content");
    const fmt = new RenderFormat(card, stubEngine());
    expect(resolveContentOverride(fmt)).toBeUndefined();
  });

  it("multiple registered overrides: the last-registered matching one wins (Map.set semantics)", () => {
    const card = makeCard("A+when_created", "db_content");
    registry.register({
      setPath: "right/when_created",
      modName: "mod-a",
      fn: () => "FIRST",
    });
    registry.register({
      setPath: "right/when_created",
      modName: "mod-b",
      fn: () => "SECOND",
    });
    const fmt = new RenderFormat(card, stubEngine());
    expect(resolveContentOverride(fmt)).toBe("SECOND");
  });

  it("content override receives the RenderFormat (the ContentFn signature contract)", () => {
    const card = makeCard("A+when_created", "db_content");
    let receivedFmt: RenderFormat | undefined;
    registry.register({
      setPath: "right/when_created",
      modName: "test",
      fn: (fmt) => {
        receivedFmt = fmt;
        return "ok";
      },
    });
    const fmt = new RenderFormat(card, stubEngine());
    expect(resolveContentOverride(fmt)).toBe("ok");
    expect(receivedFmt).toBe(fmt);
  });
});

describe("RenderFormat.renderRaw - the format-layer integration", () => {
  it("returns dbContent when no override matches (corpus suite pin - MUST not change)", () => {
    const card = makeCard("simple_card", "ORIGINAL_DB_CONTENT");
    const fmt = new RenderFormat(card, stubEngine());
    expect(fmt.renderRaw()).toBe("ORIGINAL_DB_CONTENT");
  });

  it("returns the override bytes when a matching override is registered", () => {
    const card = makeCard("A+when_created", "DB_BYTES");
    registry.register({
      setPath: "right/when_created",
      modName: "card-mod-date",
      fn: () => "I18N_FORMATTED_DATE",
    });
    const fmt = new RenderFormat(card, stubEngine());
    expect(fmt.renderRaw()).toBe("I18N_FORMATTED_DATE");
  });

  it("returns the override bytes for self/now pattern (Time.now override)", () => {
    const card = makeCard("now", "DB_BYTES", "now");
    registry.register({
      setPath: "self/now",
      modName: "card-mod-date",
      fn: () => "TIME_NOW_FORMATTED",
    });
    const fmt = new RenderFormat(card, stubEngine());
    expect(fmt.renderRaw()).toBe("TIME_NOW_FORMATTED");
  });
});
