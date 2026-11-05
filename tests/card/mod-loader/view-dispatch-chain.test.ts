

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

  delete HTML_VIEWS["titled"];
  delete HTML_VIEWS["core"];
  delete HTML_VIEWS["input"];
});

describe("setKeysToModuleChain (safe_set_keys -> MRO module shortnames)", () => {
  it("converts a single anchorless safeKey to its code shortname", () => {

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

    expect(safeKeyToModuleShortname("TYPE_PLUS_RIGHT-set-Xread")).toBe(
      "TypePlusRight::Set+Xread",
    );
    expect(safeKeyToModuleShortname("SELF-Xall-Xread")).toBe(
      "Self::Xall+Xread",
    );
  });

  it("returns the chain MOST-SPECIFIC-FIRST (the reverse of safeSetKeysForCard)", () => {

    const chain = setKeysToModuleChain(
      "ALL ALL_PLUS TYPE-list RSTAR RULE RIGHT-Xread TYPE_PLUS_RIGHT-set-Xread SELF-Xall-Xread",
    );
    expect(chain).toEqual([
      "Self::Xall+Xread",
      "TypePlusRight::Set+Xread",
      "Right::Xread",
      "Rule",
      "Rstar",
      "Type::List",
      "AllPlus",
      "All",
    ]);
  });

  it("returns [] for an empty / whitespace-only setKeys", () => {
    expect(setKeysToModuleChain("")).toEqual([]);
    expect(setKeysToModuleChain("   ")).toEqual([]);
  });
});

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

    const table = new SetModuleViewTable();
    const first: ViewFn = () => "first";
    const second: ViewFn = () => "second";
    table.register("Right::ApiKey", "core", first);
    table.register("Right::ApiKey", "core", second);
    expect(table.viewFor("Right::ApiKey", "core")).toBe(second);

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

    const chain = table.chainFor(["Right::ApiKey", "Type::X", "All"], "core");
    expect(chain.map((e) => e.setModule)).toEqual([
      "Right::ApiKey",
      "Type::X",
      "All",
    ]);
    expect(chain.map((e) => e.viewFn)).toEqual([apiKeyCore, formatCore, allCore]);
  });

  it("chainFor skips set modules that did NOT register the view", () => {

    const table = new SetModuleViewTable();
    const allTitled: ViewFn = () => "all:titled";
    table.register("All", "titled", allTitled);
    const chain = table.chainFor(["Right::ApiKey", "All"], "titled");
    expect(chain.map((e) => e.setModule)).toEqual(["All"]);
    expect(chain[0]?.viewFn).toBe(allTitled);
  });

  it("chainFor with empty cardChain falls back to load-order registration", () => {

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

describe("ModLoader.viewChain - end-to-end per-card view chain", () => {

  const formatManifest: DeckoModManifest = {
    name: "format",
    setModules: [
      {
        setPath: "all/base",
        formats: {
          html: {
            views: [

              { view: "titled", viewFn: ({ fmt }) => `${fmt.card.name.s}\n\n${fmt.renderView("core")}` },

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

    const chain = loader.viewChain("ALL RIGHT-api_key", "titled");
    expect(chain.map((e) => e.setModule)).toEqual(["Right::ApiKey", "All::Base"]);

    expect(chain[0]?.viewFn).toBeDefined();
    expect(chain[1]?.viewFn).toBeDefined();
  });

  it("returns the format's :titled first for a non-api_key card (less-specific)", () => {
    loader = new ModLoader(
      [{ manifest: formatManifest }, { manifest: apiKeyManifest }],
      { ...HTML_VIEWS },
    );
    loader.load();

    const chain = loader.viewChain("ALL", "titled");
    expect(chain.map((e) => e.setModule)).toEqual(["All::Base"]);
    expect(chain[0]?.viewFn).toBeDefined();
  });

  it("the flat last-wins record still wins for the render-path seam (byte-compat)", () => {

    HTML_VIEWS["titled"] = sentinel;
    loader = new ModLoader(
      [{ manifest: formatManifest }, { manifest: apiKeyManifest }],
      HTML_VIEWS,
    );
    loader.load();

    expect(HTML_VIEWS["titled"]).not.toBe(sentinel);

    const chain = loader.viewChain("ALL RIGHT-api_key", "titled");
    expect(chain).toHaveLength(2);
  });

  it("viewChains.clear() resets only the chain table; the flat record persists", () => {

    loader = new ModLoader(
      [{ manifest: formatManifest }],
      HTML_VIEWS,
    );
    loader.load();
    const before = loader.viewsTable()["titled"];
    loader.viewChainTable().clear();
    expect(loader.viewChainTable().chainFor(["All::Base"], "titled")).toEqual([]);

    expect(loader.viewsTable()["titled"]).toBe(before);
  });
});
