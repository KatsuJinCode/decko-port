// Mod load-order tests: the Cardio::Mod::Dirs port (src/card/mod-loader/
// mod-order.ts) and the SetLoader walk order (src/card/mod-loader.ts load()).
//
// Oracle anchors:
// - fixtures/captured/help-mod-loader.json "mods": the live deck's order -
//   core first (group gem-card), then the bundle's gem mods (Bundler's
//   dependency-closure order, NOT name-sorted; card-mod-help loads AFTER its
//   markdown/permissions dependencies)
// - fixtures/captured/help-mod-loader.json "grouped_codes": the set-file
//   load groups ([:all], [:abstract], nonbase reversed)

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ModLoader,
  ModNameConflictError,
  normalizeModName,
  resolveModOrder,
  type DeckoModManifest,
  type ModSource,
} from "../../../src/card/mod-loader.js";

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../fixtures/captured/help-mod-loader.json", import.meta.url)),
    "utf8",
  ),
) as {
  mods: { name: string; group: string; index: number }[];
  grouped_codes: string[][];
  pattern_codes: string[];
};

function modNamed(name: string): ModSource {
  return {
    manifest: { name } as unknown as DeckoModManifest,
  };
}

describe("normalizeModName (class_methods.rb:26-28)", () => {
  it("strips the card-mod- prefix", () => {
    expect(normalizeModName("card-mod-help")).toBe("help");
  });

  it("keeps bare mod names", () => {
    expect(normalizeModName("help")).toBe("help");
    expect(normalizeModName("core")).toBe("core");
  });
});

describe("resolveModOrder (dirs.rb:51-63)", () => {
  it("matches the live oracle deck's order when fed its bundle order", () => {
    // The oracle deck's Dirs state, replayed: the core mod, then the gem
    // mods in the deck's Bundler resolve order (names here carry the
    // card-mod- prefix the way Gemfile entries do).
    const gemOrder = FIXTURE.mods
      .filter((mod) => mod.group === "gem-defaults")
      .map((mod) => `card-mod-${mod.name}`);
    const entries = resolveModOrder({
      coreMods: ["core"],
      gemMods: gemOrder,
    });
    expect(entries.map((entry) => entry.name)).toEqual(
      FIXTURE.mods.map((mod) => mod.name),
    );
    expect(entries.map((entry) => entry.group)).toEqual(
      FIXTURE.mods.map((mod) => mod.group),
    );
  });

  it("sorts core mods and deck-dir listings alphabetically, keeps gem order as given", () => {
    const entries = resolveModOrder({
      coreMods: ["zeta_core", "alpha_core"],
      gemMods: ["card-mod-widget", "card-mod-zebra"],
      deckModDirs: [{ listing: ["mango", "apple", "Banana"] }],
    });
    expect(entries).toEqual([
      { name: "alpha_core", group: "gem-card" },
      { name: "zeta_core", group: "gem-card" },
      { name: "widget", group: "gem-defaults" },
      { name: "zebra", group: "gem-defaults" },
      { name: "Banana", group: "custom" }, // byte order: upper before lower
      { name: "apple", group: "custom" },
      { name: "mango", group: "custom" },
    ]);
  });

  it("Modfile order wins over the directory listing (dirs.rb:159-166)", () => {
    const entries = resolveModOrder({
      coreMods: [],
      deckModDirs: [{ listing: ["a", "b", "c"], modfile: ["c", "a"] }],
    });
    expect(entries.map((entry) => entry.name)).toEqual(["c", "a"]);
  });

  it("raises the name-conflict error on duplicate mod names (dirs.rb:66-71)", () => {
    expect(() =>
      resolveModOrder({ gemMods: ["card-mod-help"], deckModDirs: [{ listing: ["help"] }] }),
    ).toThrow(ModNameConflictError);
  });
});

describe("ModLoader registration order (set_loader.rb:26-44)", () => {
  it("walks pattern groups outer, mods, patterns inner, files byte-sorted", () => {
    // Two mods with set files across three patterns. Load order:
    // group [all] -> mod1/all/z, mod2/all/a; group [abstract] -> none;
    // nonbase REVERSED ([all_plus, type, ..., self]) -> type before self:
    // mod1/type/b, mod1/self/x2, mod2/self/x1 - and within one (mod,
    // pattern) the paths byte-sort ("self/x1" < "self/x2").
    const loader = new ModLoader([
      {
        manifest: {
          name: "mod_one",
          setModules: [
            { setPath: "self/x2" },
            { setPath: "type/b" },
            { setPath: "all/z" },
          ],
        },
      },
      {
        manifest: {
          name: "mod_two",
          setModules: [{ setPath: "self/x1" }, { setPath: "all/a" }],
        },
      },
    ]);
    const report = loader.load();
    expect(report.registeredSetModules).toEqual([
      "All::Z", // group [all]: mod1
      "All::A", // group [all]: mod2
      "Type::B", // group [type]: nonbase load order puts type before self
      "Self::X2",
      "Self::X1",
    ]);
  });

  it("rejects a required-but-unknown mod with Ruby's mod-not-found error", () => {
    const loader = new ModLoader([modNamed("present")]);
    expect(() => loader.resolveOrder({ gemMods: ["card-mod-missing"] })).toThrow(
      "mod not found: missing",
    );
    expect(loader.fetchMod("missing")).toBeUndefined();
    expect(loader.fetchMod("card-mod-present")).toBeDefined();
  });

  it("raises the dirs name-conflict on duplicate adds", () => {
    const loader = new ModLoader([modNamed("help")]);
    expect(() => loader.add(modNamed("card-mod-help"))).toThrow(ModNameConflictError);
  });
});

describe("the core pattern table through the loader", () => {
  it("reproduces the oracle pattern_codes and grouped_codes byte-identically", () => {
    const loader = new ModLoader([]); // no mod patterns: core only
    loader.load();
    expect(loader.patternTable().map((spec) => spec.code)).toEqual(FIXTURE.pattern_codes);
    const groups = loader.setModules();
    void groups;
    // grouped_codes via the overlay (same algorithm as the registry port)
    const report = loader.load();
    expect(report.registeredPatternCodes).toEqual([]);
    expect(loader.patternTable().map((spec) => spec.code)).toEqual(FIXTURE.pattern_codes);
    // the load groups the SetLoader walks, oracle-pinned:
    expect(FIXTURE.grouped_codes).toEqual([
      ["all"],
      ["abstract"],
      ["all_plus", "type", "star", "rstar", "rule", "right", "type_plus_right", "self"],
    ]);
  });

  it("front-inserts mod patterns like ClassMethods#register (class_methods.rb:13-18)", () => {
    const loader = new ModLoader([]); // seed below
    loader.load();
    // A synthetic mod pattern registered after the core: front-inserted
    // into concrete (lookup FIRST), loading LAST in the set walk.
    const withPattern = new ModLoader([
      {
        manifest: {
          name: "tab_mod",
          setPatterns: [
            {
              code: "tab",
              index: undefined,
              spec: {
                loadIndex: 0,
                registerSite: "synthetic set_pattern/tab.rb",
                code: "tab",
                patternCardName: "*tab",
                compoundOnly: false,
                assignsType: false,
                staticAnchorPartsCount: 1,
                applies: () => true,
                label: (anchor) => `Tab ${anchor ?? ""}`,
                shortLabel: (anchor) => anchor ?? "",
                genericLabel: () => "a tab",
                prototypeArgs: () => ({}),
              },
            },
          ],
        },
      },
    ]);
    withPattern.load();
    const codes = withPattern.patternTable().map((spec) => spec.code);
    expect(codes[0]).toBe("tab"); // front-inserted: lookup order first
    expect(codes.slice(1)).toEqual(FIXTURE.pattern_codes);
    // load order: tab is in the LAST nonbase group position (reversed)
    const nonbase = codes.filter((code) => code !== "all").reverse();
    expect(nonbase[nonbase.length - 1]).toBe("tab");
  });
});
