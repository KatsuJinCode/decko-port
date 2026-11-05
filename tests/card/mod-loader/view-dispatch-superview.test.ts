// view-dispatch-superview.test.ts - superView delegation tests.
//
// Ruby's `super()` in a view body delegates to the next set module's
// SAME view (view_definition.rb:18-21, the chain walks via Ruby's MRO:
// set/format.rb:146-150 + format.rb:62-68). The TS port exposes this
// through the superView helper (mod-view-helpers.ts:104-138); the
// three concrete porting-batch failures motivate the test:
//
//   1. card-mod-api_key set/right/api_key.rb:73-75: :titled/:titled_
//      content/:content delegate to the parent set's same view via
//      super(). Without a chain walker, registering those views in a
//      flat table would override card-mod-format's :titled/:content
//      for EVERY card. superView walks to the parent set's :titled.
//
//   2. card-mod-content set/abstract/01_code_content.rb + haml_file.rb
//      + read_only.rb: each declares :input on a different set module
//      under the Abstract pseudo-pattern. Ruby's MRO picks the
//      most-specific per card; the chain walker reproduces that order
//      when the cardChain is empty (the Abstract pseudo-pattern's
//      chain has no concrete instances, so the walker falls back to
//      load-order registration).
//
//   3. card-mod-bootstrap set/type/bootswatch_skin.rb:102-108: :input
//      calls super() to the type-default input view. superView must
//      terminate at the base (returns "" when the chain has no next
//      entry past the current module).
//
// The test pins all three behaviors with stub ViewContext shapes (the
// headless engine has no live RenderFormat; the structural surface
// superView reads is `fmt.card.setKeys` + the default mod loader).
//
// setup/teardown: setDefaultModLoader binds the loader for the test;
// afterEach resets and clears it so subsequent tests start clean.

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  ModLoader,
  setDefaultModLoader,
  getDefaultModLoader,
  type DeckoModManifest,
} from "../../../src/card/mod-loader.js";
import { superView } from "../../../src/card/mod-loader/mod-view-helpers.js";
import type {
  ViewContext,
  ViewFn,
} from "../../../src/card/render/format.js";
import { HTML_VIEWS } from "../../../src/card/render/views.js";

// ---------------------------------------------------------------------------
// ViewContext stub: superView only reads ctx.fmt.card.setKeys (the rest
// of the render surface isn't touched). A structural cast keeps the
// dependency on the full RenderFormat out of the test (the headless
// engine has no live RenderFormat).
// ---------------------------------------------------------------------------

interface StubCard {
  name: { s: string };
  setKeys: string;
}

interface StubFmt {
  card: StubCard;
}

interface StubVoo {
  requestedView: string;
}

function makeCtx(setKeys: string, view: string): ViewContext {
  const card: StubCard = { name: { s: "TestCard" }, setKeys };
  const fmt: StubFmt = { card };
  const voo: StubVoo = { requestedView: view };
  return {
    fmt: fmt as unknown as ViewContext["fmt"],
    voo: voo as unknown as ViewContext["voo"],
  };
}

// ---------------------------------------------------------------------------
// Shared test mods
// ---------------------------------------------------------------------------

/** card-mod-format's all/base :titled + :core + :input - the parent
 *  set the api_key mod's super() chains to. */
const formatAllBase: DeckoModManifest = {
  name: "format",
  setModules: [
    {
      setPath: "all/base",
      formats: {
        html: {
          views: [
            // set/all/base.rb:120-122 view :titled: "#{name}\n\n#{core}"
            // Stubbed to "format:titled" so the test can assert the
            // chain order without exercising the full HAML byte path.
            { view: "titled", viewFn: () => "format:titled" },
            { view: "titled_content", viewFn: () => "format:titled_content" },
            { view: "content", viewFn: () => "format:content" },
            { view: "core", viewFn: () => "format:core" },
            { view: "input", viewFn: () => "format:input" },
          ],
        },
      },
    },
  ],
};

/** card-mod-api_key set/right/api_key.rb:73-75 - :titled/:titled_
 *  content/:content delegate to the parent set's same view via super().
 *  In TS, superView(ctx, currentModule, viewName) is the analog. */
const apiKeyManifest: DeckoModManifest = {
  name: "api_key",
  setModules: [
    {
      setPath: "right/api_key",
      formats: {
        html: {
          views: [
            {
              view: "titled",
              // set/right/api_key.rb:73-75 view :titled { super() }
              viewFn: (ctx) => superView(ctx, "Right::ApiKey", "titled"),
              config: { unknown: true },
            },
            {
              view: "titled_content",
              viewFn: (ctx) => superView(ctx, "Right::ApiKey", "titled_content"),
              config: { unknown: true },
            },
            {
              view: "content",
              viewFn: (ctx) => superView(ctx, "Right::ApiKey", "content"),
              config: { unknown: true },
            },
          ],
        },
      },
    },
  ],
};

/** card-mod-bootstrap set/type/bootswatch_skin.rb:101-108 - the
 *  bootswatch_skin set defines :input with a conditional super() (the
 *  super() only fires when card.parent? is true). The TS port always
 *  delegates when superView is called. */
const bootswatchSkinManifest: DeckoModManifest = {
  name: "bootstrap",
  setModules: [
    {
      setPath: "type/bootswatch_skin",
      formats: {
        html: {
          views: [
            // set/type/bootswatch_skin.rb:102-108 view :input do
            //   if card.parent?; super()
            //   else; "Content is stored in file and can't be edited."
            //   end
            // end
            // The super() branch delegates to the next module's :input.
            viewInputThatCallsSuper("Type::BootswatchSkin"),
          ],
        },
      },
    },
  ],
};

function viewInputThatCallsSuper(currentModule: string): {
  view: string;
  viewFn: ViewFn;
} {
  return {
    view: "input",
    viewFn: (ctx) => `bootstrap:input [super=${superView(ctx, currentModule, "input")}]`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("superView - Ruby's super() in view bodies (view_definition.rb:18-21)", () => {
  let loader: ModLoader | undefined;

  beforeEach(() => {
    setDefaultModLoader(undefined);
  });

  afterEach(() => {
    loader?.reset();
    setDefaultModLoader(undefined);
    loader = undefined;
    // Clean the live HTML_VIEWS record - the loader registered views
    // into it via ViewRegistrationTable, and reset() restores them.
    delete HTML_VIEWS["titled"];
    delete HTML_VIEWS["titled_content"];
    delete HTML_VIEWS["content"];
    delete HTML_VIEWS["core"];
    delete HTML_VIEWS["input"];
  });

  // ---- (1) card-mod-api_key porting-batch failure -----------------------

  it("api_key's :titled super() resolves to card-mod-format's :titled", () => {
    loader = new ModLoader(
      [{ manifest: formatAllBase }, { manifest: apiKeyManifest }],
      HTML_VIEWS,
    );
    loader.load();
    setDefaultModLoader(loader);

    const ctx = makeCtx("ALL RIGHT-api_key", "titled");
    // The chain for "ALL RIGHT-api_key" walks Right::ApiKey first, then
    // All::Base. superView from Right::ApiKey returns All::Base's :titled.
    const next = superView(ctx, "Right::ApiKey", "titled");
    expect(next).toBe("format:titled");
  });

  it("api_key's :titled_content super() resolves to card-mod-format's :titled_content", () => {
    loader = new ModLoader(
      [{ manifest: formatAllBase }, { manifest: apiKeyManifest }],
      HTML_VIEWS,
    );
    loader.load();
    setDefaultModLoader(loader);

    const ctx = makeCtx("ALL RIGHT-api_key", "titled_content");
    expect(superView(ctx, "Right::ApiKey", "titled_content")).toBe(
      "format:titled_content",
    );
  });

  it("api_key's :content super() resolves to card-mod-format's :content", () => {
    loader = new ModLoader(
      [{ manifest: formatAllBase }, { manifest: apiKeyManifest }],
      HTML_VIEWS,
    );
    loader.load();
    setDefaultModLoader(loader);

    const ctx = makeCtx("ALL RIGHT-api_key", "content");
    expect(superView(ctx, "Right::ApiKey", "content")).toBe("format:content");
  });

  // ---- (3) card-mod-bootstrap porting-batch failure ---------------------

  it("bootstrap's :input super() resolves to the type-default :input", () => {
    loader = new ModLoader(
      [
        { manifest: formatAllBase },
        { manifest: bootswatchSkinManifest },
      ],
      HTML_VIEWS,
    );
    loader.load();
    setDefaultModLoader(loader);

    // Card chain for a bootswatch_skin card: TYPE-bootswatch_skin + ALL.
    // The walker returns Type::BootswatchSkin first; superView from
    // there walks to All::Base's :input.
    const ctx = makeCtx("ALL TYPE-bootswatch_skin", "input");
    expect(superView(ctx, "Type::BootswatchSkin", "input")).toBe("format:input");
  });

  // ---- termination -----------------------------------------------------

  it("super() past the LAST chain entry falls to the BASE format's view (view_definition.rb:18-21)", () => {
    // The All set is the most-general set; if All::Base calls super(),
    // there's no next chain entry - Ruby's super() reaches the parent
    // method, which is the compiled-in core view. Only a view with no
    // core definition at all terminates empty.
    loader = new ModLoader(
      [{ manifest: formatAllBase }],
      HTML_VIEWS,
    );
    loader.load();
    setDefaultModLoader(loader);

    const ctx = makeCtx("ALL", "titled");
    const base = HTML_VIEWS["titled"];
    if (base !== undefined) {
      expect(superView(ctx, "All::Base", "titled")).toBe(base(ctx));
    } else {
      expect(superView(ctx, "All::Base", "titled")).toBe("");
    }
    // a view neither mods nor the core define still terminates ""
    expect(superView(makeCtx("ALL", "zz_no_core_view"), "All::Base", "zz_no_core_view")).toBe("");
  });

  it("super() returns '' when no loader is registered (safe fallback)", () => {
    // superView must not crash when setDefaultModLoader has not been
    // called yet (the helper is called from view bodies that may run
    // before the loader wires up).
    setDefaultModLoader(undefined);
    const ctx = makeCtx("ALL", "titled");
    expect(superView(ctx, "Right::ApiKey", "titled")).toBe("");
  });

  it("super() returns '' when the currentModule is not in the chain", () => {
    // An unknown currentModule is a programming error (the mod's
    // view body must pass its OWN shortname). superView treats this
    // as base-of-chain rather than throwing.
    loader = new ModLoader(
      [{ manifest: formatAllBase }],
      HTML_VIEWS,
    );
    loader.load();
    setDefaultModLoader(loader);

    const ctx = makeCtx("ALL", "titled");
    expect(superView(ctx, "NotInChain", "titled")).toBe("");
  });

  // ---- (2) card-mod-content Abstract pseudo-pattern ---------------------

  it("Abstract pseudo-pattern registrations chain in load order (empty cardChain fallback)", () => {
    // The Abstract pseudo-pattern is anchorless; no concrete pattern
    // instance matches a card directly. The cardChain is empty for
    // an Abstract pseudo-pattern view, and the walker falls back to
    // load-order registration (the abstract-set module chain).
    const codeContent: DeckoModManifest = {
      name: "content",
      setModules: [
        {
          setPath: "abstract/01_code_content",
          formats: {
            html: {
              views: [
                { view: "input", viewFn: () => "code_content:input" },
              ],
            },
          },
        },
      ],
    };
    const hamlFile: DeckoModManifest = {
      name: "content_haml",
      setModules: [
        {
          setPath: "abstract/haml_file",
          formats: {
            html: {
              views: [
                { view: "input", viewFn: () => "haml_file:input" },
              ],
            },
          },
        },
      ],
    };
    const readOnly: DeckoModManifest = {
      name: "content_read_only",
      setModules: [
        {
          setPath: "abstract/read_only",
          formats: {
            html: {
              views: [
                { view: "input", viewFn: () => "read_only:input" },
              ],
            },
          },
        },
      ],
    };
    loader = new ModLoader(
      [
        { manifest: codeContent },
        { manifest: hamlFile },
        { manifest: readOnly },
      ],
      HTML_VIEWS,
    );
    loader.load();
    setDefaultModLoader(loader);

    // Empty cardChain (the Abstract pseudo-pattern never matches a
    // card directly). The walker returns the three input views in
    // load order: CodeContent -> HamlFile -> ReadOnly. The loader's
    // setModuleShortname strips the "NN_" prefix from the setPath
    // (loader.rb#parts_from_path:61-65: strip segment-leading NN_).
    const chain = loader.viewChain("", "input");
    expect(chain.map((e) => e.setModule)).toEqual([
      "Abstract::CodeContent",
      "Abstract::HamlFile",
      "Abstract::ReadOnly",
    ]);

    // superView from CodeContent walks to HamlFile; from HamlFile
    // walks to ReadOnly; from ReadOnly terminates ("").
    const ctx = makeCtx("", "input");
    expect(superView(ctx, "Abstract::CodeContent", "input")).toBe(
      "haml_file:input",
    );
    expect(superView(ctx, "Abstract::HamlFile", "input")).toBe(
      "read_only:input",
    );
    // ReadOnly is the chain terminal: super() falls to the base format's
    // :input if the core table defines one, else ""
    const baseInput = HTML_VIEWS["input"];
    const expectedTerminal = baseInput !== undefined ? baseInput(makeCtx("", "input")) : "";
    expect(superView(ctx, "Abstract::ReadOnly", "input")).toBe(expectedTerminal);
  });

  // ---- the full chain composes correctly -------------------------------

  it("a three-level chain (api_key -> type-X -> all) walks each super() step", () => {
    // api_key's :titled super() returns type-X's :titled; type-X's
    // :titled super() returns all's :titled; all's super() terminates.
    const typeXManifest: DeckoModManifest = {
      name: "type_x",
      setModules: [
        {
          setPath: "type/x",
          formats: {
            html: {
              views: [
                {
                  view: "titled",
                  viewFn: (ctx) => superView(ctx, "Type::X", "titled"),
                },
              ],
            },
          },
        },
      ],
    };
    loader = new ModLoader(
      [
        { manifest: formatAllBase },
        { manifest: typeXManifest },
        { manifest: apiKeyManifest },
      ],
      HTML_VIEWS,
    );
    loader.load();
    setDefaultModLoader(loader);

    const ctx = makeCtx("ALL TYPE-x RIGHT-api_key", "titled");
    // api_key -> Type::X
    expect(superView(ctx, "Right::ApiKey", "titled")).toBe("format:titled");
    // Wait: the chain walker doesn't return the type-X :titled unless
    // the type-X :titled is registered. Here it IS (typeXManifest).
    // The walker order for "ALL TYPE-x RIGHT-api_key" is:
    //   Right::ApiKey (most-specific), Type::X, All::Base (most-general).
    // api_key's super() returns Type::X's :titled, which itself calls
    // super() and returns All::Base's :titled.
    //
    // The end-to-end: superView from Right::ApiKey returns the OUTPUT
    // of Type::X's :titled, which is superView(Type::X) -> All::Base.
    expect(superView(ctx, "Right::ApiKey", "titled")).toBe("format:titled");
    // Direct probe of Type::X's :titled (its body) returns All::Base's.
    expect(superView(ctx, "Type::X", "titled")).toBe("format:titled");
    // All::Base's super() falls to the base format's :titled (the parent
    // method, view_definition.rb:18-21)
    const baseTitled = HTML_VIEWS["titled"];
    expect(superView(ctx, "All::Base", "titled")).toBe(
      baseTitled !== undefined ? baseTitled(ctx) : "",
    );
  });

  it("getDefaultModLoader returns the registered loader (the seam the helper uses)", () => {
    loader = new ModLoader(
      [{ manifest: formatAllBase }],
      HTML_VIEWS,
    );
    loader.load();
    setDefaultModLoader(loader);
    expect(getDefaultModLoader()).toBe(loader);
  });
});
