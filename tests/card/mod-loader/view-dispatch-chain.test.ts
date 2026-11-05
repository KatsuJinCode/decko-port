// view-dispatch-chain.test.ts - the chain-aware view lookup ports
// Ruby's MRO walk: set/format.rb:146-150 (Set.modules[set_format_type_key]
// [format_class][shortname] = [mod1, mod2, ...]) + format.rb:62-68
// (`self.class.format_ancestry.reverse_each do |klass|;
// card.set_format_modules(klass).each do |m|; singleton_class.send
// :include, m; end; end`).
//
// The TS port keeps the flat last-wins view table (engine.views[view]) for
// the render-path seam (format.ts:311) and adds a per-set-module table
// (SetModuleViewTable) the chain walker + superView helper consult.
// Three test groups below:
//
//   1. setKeysToModuleChain conversion (render/set-keys-to-modules.ts):
//      the safeKey tokens ("ALL", "TYPE-rich_text", "RIGHT-Xread",
//      "TYPE_PLUS_RIGHT-set-Xread", "SELF-Xall-Xread") map to module
//      shortnames ("All", "Type::RichText", "Right::Xread",
//      "TypePlusRight::Set+Xread", "Self::Xall+Xread") in
//      MOST-SPECIFIC-FIRST order (Ruby's MRO, the reverse of the
//      general-first input).
//
//   2. SetModuleViewTable - per-set-module view recording + chain
//      walker: every `view :foo` lands under its contributing set
//      module; the chain walker returns entries most-specific-FIRST
//      for the card's chain.
//
//   3. ModLoader.viewChain - end-to-end through the loader: the
//      flat last-wins record still wins for the render path, but
//      viewChain(setKeys, view) returns the per-card ordered chain
//      the chain walker + superView consult.

import { describe, it, expect, afterEach } from "vitest";
import {
  ModLoader,
  type DeckoModManifest,
} from "../../../src/card/mod-loader.js";
import {
  SetModuleViewTable,
} from "../../../src/card/mod-loader/mod-registrar.js";
import {
  setKeysToModuleChain,
  safeKeyToModuleShortname,
} from "../../../src/card/render/set-keys-to-modules.js";
import { HTML_VIEWS } from "../../../src/card/render/views.js";
import type { ViewFn } from "../../../src/card/render/format.js";

const sentinel: ViewFn = () => "SENTINEL";

afterEach(() => {
  // Restore any live-record state the loader may have mutated so the
  // next test starts from a clean baseline. The flat last-wins table
  // records the pre-load values for the touched views; deleting them
  // restores the baseline the render layer ships.
  delete HTML_VIEWS["titled"];
  delete HTML_VIEWS["core"];
  delete HTML_VIEWS["input"];
});

// ---------------------------------------------------------------------------
// 1. setKeysToModuleChain - the safeKey-to-shortname conversion
// ---------------------------------------------------------------------------

describe("setKeysToModuleChain (safe_set_keys -> MRO module shortnames)", () => {
  it("converts a single anchorless safeKey to its code shortname", () => {
    // pattern/all.rb#safe_key: anchorless? ? caps_part : "#{caps_part}-#{@anchor_name.safe_key}"
    // ALL is anchorless (set_pattern/all.rb defines no anchor_name) so the
    // safeKey is the bare caps code.
    expect(safeKeyToModuleShortname("ALL")).toBe("All");
    expect(safeKeyToModuleShortname("RSTAR")).toBe("Rstar");
    expect(safeKeyToModuleShortname("RULE")).toBe("Rule");
  });

  it("converts an anchored safeKey to 'Code::Anchor' shortname", () => {
    expect(safeKeyToModuleShortname("TYPE-rich_text")).toBe("Type::RichText");
    expect(safeKeyToModuleShortname("RIGHT-Xread")).toBe("Right::Xread");
    expect(safeKeyToModuleShortname("SELF-oracle_basic")).toBe("Self::OracleBasic");
  });

  it("preserves the '+' inside multi-anchor safeKeys (type_plus_right)", () => {
    // 08_type_plus_right.rb anchor_name: "#{left_type(card)}+#{card.name.tag}"
    // safe_key preserves the literal "+" so the chain can resolve the
    // module without re-deriving the left type.
    expect(safeKeyToModuleShortname("TYPE_PLUS_RIGHT-set-Xread")).toBe(
      "TypePlusRight::Set+Xread",
    );
    expect(safeKeyToModuleShortname("SELF-Xall-Xread")).toBe(
      "Self::Xall+Xread",
    );
  });

  it("returns the chain MOST-SPECIFIC-FIRST (the reverse of safeSetKeysForCard)", () => {
    // safeSetKeysForCard: patterns.reverse().join(" ") - general first
    // (oracle-verified example: "ALL ALL_PLUS TYPE-list RSTAR RULE
    //  RIGHT-Xread TYPE_PLUS_RIGHT-set-Xread SELF-Xall-Xread").
    // Ruby's MRO walks most-specific first, so the chain reverses again:
    // SELF -> TYPE_PLUS_RIGHT -> RIGHT -> RULE -> RSTAR -> TYPE ->
    // ALL_PLUS -> ALL.
    const chain = setKeysToModuleChain(
      "ALL ALL_PLUS TYPE-list RSTAR RULE RIGHT-Xread TYPE_PLUS_RIGHT-set-Xread SELF-Xall-Xread",
    );
    expect(chain).toEqual([
      "Self::Xall+Xread",        // SELF is the most-specific (anchored to card name)
      "TypePlusRight::Set+Xread", // TYPE_PLUS_RIGHT
      "Right::Xread",             // RIGHT
      "Rule",                     // RULE (anchorless)
      "Rstar",                    // RSTAR (anchorless)
      "Type::List",               // TYPE
      "AllPlus",                  // ALL_PLUS
      "All",                      // ALL (most-general)
    ]);
  });

  it("returns [] for an empty / whitespace-only setKeys", () => {
    expect(setKeysToModuleChain("")).toEqual([]);
    expect(setKeysToModuleChain("   ")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. SetModuleViewTable - the per-set-module view recording
// ---------------------------------------------------------------------------

describe("SetModuleViewTable - per-set-module view recording", () => {
  it("records each view under its contributing set module", () => {
    const table = new SetModuleViewTable();
    const fnA: ViewFn = () => "A";
    const fnF: ViewFn = () => "F";
    table.register("Right::ApiKey", "core", fnA);
    table.register("All::Help", "core", fnF);
    expect(table.viewFor("Right::ApiKey", "core")).toBe(fnA);
    expect(table.viewFor("All::Help", "core")).toBe(fnF);
  });

  it("a re-registration from the SAME set module replaces (Ruby reopening)", () => {
    // set/format.rb:130 mod.class_eval(&block) reopens the same module
    // every time the same file loads; define_method replaces.
    const table = new SetModuleViewTable();
    const first: ViewFn = () => "first";
    const second: ViewFn = () => "second";
    table.register("Right::ApiKey", "core", first);
    table.register("Right::ApiKey", "core", second);
    expect(table.viewFor("Right::ApiKey", "core")).toBe(second);
    // The chain order keeps the FIRST entry's position so super() walks
    // past re-openings rather than re-emitting the same view fn twice.
    const chain = table.chainFor(["Right::ApiKey"], "core");
    expect(chain).toHaveLength(1);
    expect(chain[0]?.viewFn).toBe(second);
  });

  it("chainFor walks the card's chain MOST-SPECIFIC-FIRST", () => {
    const table = new SetModuleViewTable();
    const apiKeyCore: ViewFn = () => "api_key:core";
    const formatCore: ViewFn = () => "format:core";
    const allCore: ViewFn = () => "all:core";
    table.register("Right::ApiKey", "core", apiKeyCore);
    table.register("Type::X", "core", formatCore);
    table.register("All", "core", allCore);

    // For a card whose chain is [Right::ApiKey, Type::X, All], the
    // walker returns api_key first, then Type::X, then All.
    const chain = table.chainFor(["Right::ApiKey", "Type::X", "All"], "core");
    expect(chain.map((e) => e.setModule)).toEqual([
      "Right::ApiKey",
      "Type::X",
      "All",
    ]);
    expect(chain.map((e) => e.viewFn)).toEqual([apiKeyCore, formatCore, allCore]);
  });

  it("chainFor skips set modules that did NOT register the view", () => {
    // Right::ApiKey didn't register :titled; card-mod-format did.
    // For a card whose chain is [Right::ApiKey, All], the walker
    // returns All only (api_key's missing entry is not a chain slot).
    const table = new SetModuleViewTable();
    const allTitled: ViewFn = () => "all:titled";
    table.register("All", "titled", allTitled);
    const chain = table.chainFor(["Right::ApiKey", "All"], "titled");
    expect(chain.map((e) => e.setModule)).toEqual(["All"]);
    expect(chain[0]?.viewFn).toBe(allTitled);
  });

  it("chainFor with empty cardChain falls back to load-order registration", () => {
    // The "no set applies" case: the Abstract pseudo-pattern's chain
    // is empty (card-mod-content set/abstract/01_code_content.rb,
    // haml_file.rb, read_only.rb all register :input but no concrete
    // set applies to a "card with no name"-shape input). The walker
    // returns the registering modules in load order.
    const table = new SetModuleViewTable();
    const codeContent: ViewFn = () => "code_content:input";
    const hamlFile: ViewFn = () => "haml_file:input";
    const readOnly: ViewFn = () => "read_only:input";
    table.register("Abstract::CodeContent", "input", codeContent);
    table.register("Abstract::HamlFile", "input", hamlFile);
    table.register("Abstract::ReadOnly", "input", readOnly);
    const chain = table.chainFor([], "input");
    expect(chain.map((e) => e.setModule)).toEqual([
      "Abstract::CodeContent",
      "Abstract::HamlFile",
      "Abstract::ReadOnly",
    ]);
  });

  it("clear() drops every per-set-module registration", () => {
    const table = new SetModuleViewTable();
    table.register("Right::ApiKey", "core", () => "x");
    table.clear();
    expect(table.viewFor("Right::ApiKey", "core")).toBeUndefined();
    expect(table.chainFor(["Right::ApiKey"], "core")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. ModLoader.viewChain - end-to-end through the loader
// ---------------------------------------------------------------------------

describe("ModLoader.viewChain - end-to-end per-card view chain", () => {
  /** Two-mods setup: card-mod-format defines :titled (delegates to :core)
   *  on the All set; card-mod-api_key defines :titled (delegates to :core)
   *  on the Right::ApiKey set. The chain for an api_key card walks
   *  api_key's :titled first, then card-mod-format's :titled. */
  const formatManifest: DeckoModManifest = {
    name: "format",
    setModules: [
      {
        setPath: "all/base",
        formats: {
          html: {
            views: [
              // set/all/base.rb:120-122 view :titled: "#{name}\n\n#{core}"
              { view: "titled", viewFn: ({ fmt }) => `${fmt.card.name.s}\n\n${fmt.renderView("core")}` },
              // set/all/base.rb:75-77 view :core: literal "core".
              { view: "core", viewFn: () => "format:core" },
            ],
          },
        },
      },
    ],
  };

  const apiKeyManifest: DeckoModManifest = {
    name: "api_key",
    setModules: [
      {
        // set/right/api_key.rb:73-75: titled/titled_content/content all
        // call super() (the next set module's same view). The chain-
        // shape tests below assert the chain ORDER; super() delegation
        // has its own test file (view-dispatch-superview.test.ts).
        setPath: "right/api_key",
        formats: {
          html: {
            views: [
              { view: "titled", viewFn: () => "api_key:titled" },
            ],
          },
        },
      },
    ],
  };

  let loader: ModLoader | undefined;
  afterEach(() => {
    loader?.reset();
    loader = undefined;
  });

  it("returns the api_key's :titled first for an api_key card (most-specific)", () => {
    loader = new ModLoader(
      [{ manifest: formatManifest }, { manifest: apiKeyManifest }],
      { ...HTML_VIEWS },
    );
    loader.load();

    // Card chain: Right::ApiKey (set/right/api_key.rb applies) + All
    // (the All set always applies). The walker returns api_key first.
    const chain = loader.viewChain("ALL RIGHT-api_key", "titled");
    expect(chain.map((e) => e.setModule)).toEqual(["Right::ApiKey", "All::Base"]);
    // The chain is the chain walker's output: viewChains is independent
    // of the flat last-wins table; the render layer consults the latter.
    expect(chain[0]?.viewFn).toBeDefined();
    expect(chain[1]?.viewFn).toBeDefined();
  });

  it("returns the format's :titled first for a non-api_key card (less-specific)", () => {
    loader = new ModLoader(
      [{ manifest: formatManifest }, { manifest: apiKeyManifest }],
      { ...HTML_VIEWS },
    );
    loader.load();

    // Card chain: All only (no Right::ApiKey match - the card is not
    // an *api_key card). The walker returns card-mod-format's :titled.
    const chain = loader.viewChain("ALL", "titled");
    expect(chain.map((e) => e.setModule)).toEqual(["All::Base"]);
    expect(chain[0]?.viewFn).toBeDefined();
  });

  it("the flat last-wins record still wins for the render-path seam (byte-compat)", () => {
    // The render layer (format.ts:311) reads engine.views[view] - a
    // FLAT lookup. The chain table is a NEW surface; the render layer
    // is untouched. The loader populates BOTH tables from the same
    // registrations.
    HTML_VIEWS["titled"] = sentinel;
    loader = new ModLoader(
      [{ manifest: formatManifest }, { manifest: apiKeyManifest }],
      HTML_VIEWS,
    );
    loader.load();
    // The api_key :titled was registered AFTER format's :titled, so
    // the flat last-wins record carries api_key's view fn.
    expect(HTML_VIEWS["titled"]).not.toBe(sentinel);
    // The chain table carries BOTH registrations under their modules.
    const chain = loader.viewChain("ALL RIGHT-api_key", "titled");
    expect(chain).toHaveLength(2);
  });

  it("viewChains.clear() resets only the chain table; the flat record persists", () => {
    // Defensive: a future reset hook that touches only the chain
    // table must not perturb the render-path seam. (The current
    // reset() clears both; this pins the table-level isolation.)
    loader = new ModLoader(
      [{ manifest: formatManifest }],
      HTML_VIEWS,
    );
    loader.load();
    const before = loader.viewsTable()["titled"];
    loader.viewChainTable().clear();
    expect(loader.viewChainTable().chainFor(["All::Base"], "titled")).toEqual([]);
    // The flat record is untouched by viewChainTable().clear().
    expect(loader.viewsTable()["titled"]).toBe(before);
  });
});
