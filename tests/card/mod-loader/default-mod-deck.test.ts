

import { describe, expect, it, afterAll } from "vitest";
import {
  ORACLE_BUNDLE_ORDER,
  COMPILED_IN_OR_ABSENT_MODS,
  defaultDeckSources,
  portedBundleOrder,
  defaultDeckLoader,
} from "../../../src/card/mod-loader/default-mod-deck.js";
import { ModLoader } from "../../../src/card/mod-loader.js";
import {
  getDefaultModLoader,
  setDefaultModLoader,
  setDefaultContentOverrideRegistry,
  setDefaultModEventRegistry,
  contentOverrideFor,
  eventsForStage,
} from "../../../src/card/mod-loader.js";

afterAll(() => {

  setDefaultModLoader(undefined);
  setDefaultContentOverrideRegistry(undefined);
  setDefaultModEventRegistry(undefined);
});

describe("default-mod-deck: oracle bundle order", () => {
  it("carries the captured resolve order (34 names, 4 without manifests)", () => {
    expect(ORACLE_BUNDLE_ORDER).toHaveLength(34);
    expect(ORACLE_BUNDLE_ORDER[0]).toBe("core");

    expect(ORACLE_BUNDLE_ORDER.slice(-3)).toEqual([
      "recaptcha",
      "tinymce_editor",
      "defaults",
    ]);
    expect(COMPILED_IN_OR_ABSENT_MODS).toHaveLength(4);
    for (const absent of COMPILED_IN_OR_ABSENT_MODS) {
      expect(ORACLE_BUNDLE_ORDER).toContain(absent);
    }
  });

  it("restricts to exactly the 30 ported mods, preserving capture order", () => {
    const order = portedBundleOrder();
    expect(order).toHaveLength(30);

    expect(order.slice(0, 7)).toEqual([
      "collection",
      "content",
      "format",
      "list",
      "markdown",
      "permissions",
      "help",
    ]);

    for (const name of order) {
      expect(ORACLE_BUNDLE_ORDER).toContain(name);
    }
    const unaccounted = ORACLE_BUNDLE_ORDER.filter(
      (name) => !order.includes(name),
    );
    expect(unaccounted).toEqual([
      "core",
      "bar_and_box",
      "delayed_job",
      "defaults",
    ]);

    expect(order.indexOf("collection")).toBeLessThan(order.indexOf("search"));
  });
});

describe("default-mod-deck: one loader, oracle order, live registrations", () => {
  it("resolves the full order and loads every manifest", () => {
    const sources = defaultDeckSources();
    expect(sources).toHaveLength(30);
    const loader = new ModLoader(sources);
    loader.resolveOrder({ gemMods: portedBundleOrder() });
    const report = loader.load();

    expect(report.modNames).toEqual(portedBundleOrder());

    expect(report.registeredSetModules.length).toBeGreaterThan(0);
    expect(report.registeredViews.length).toBeGreaterThan(0);
    expect(report.registeredViews).toContain("count");
    expect(report.registeredSettings).toContain("help");

    const table = loader.patternTable();
    expect(table.length).toBeGreaterThanOrEqual(9);

    let manifestOverrides = 0;
    let manifestEvents = 0;
    for (const source of sources) {
      for (const file of source.manifest.setModules ?? []) {
        manifestOverrides += file.contentOverrides?.length ?? 0;
        manifestEvents += file.events?.length ?? 0;
      }
    }
    expect(report.registeredContentOverrides).toHaveLength(manifestOverrides);
    expect(report.registeredEvents).toHaveLength(manifestEvents);
    expect(loader.contentOverrideRegistry().size()).toBe(manifestOverrides);
    expect(loader.eventRegistry().size()).toBe(manifestEvents);
  });

  it("is idempotent: a second load() produces the same report", () => {
    const loader = new ModLoader(defaultDeckSources());
    loader.resolveOrder({ gemMods: portedBundleOrder() });
    const first = loader.load();
    const second = loader.load();
    expect(second).toEqual(first);
  });

  it(":count dispatches to the search-family registration with collection's behind it", () => {
    const loader = defaultDeckLoader();

    const chain = loader.viewChain("", "count");
    const modules = chain.map((entry) => entry.setModule);
    expect(modules).toContain("Abstract::Search");
    expect(modules).toContain("All::Item");

    expect(loader.viewsTable()["count"]).toBe(
      loader.viewChainTable().viewFor("Abstract::Search", "count"),
    );
  });
});

describe("default-mod-deck: the deck-boot seam binds the process defaults", () => {
  it("binds the loader + both registries it populated", () => {
    const loader = defaultDeckLoader();
    expect(getDefaultModLoader()).toBe(loader);

    expect(contentOverrideFor("no/such_path")).toBeUndefined();
    expect(eventsForStage("integrate")).toEqual(
      loader.eventRegistry().forStage("integrate"),
    );
  });
});
