

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

const formatAllBase: DeckoModManifest = {
  name: "format",
  setModules: [
    {
      setPath: "all/base",
      formats: {
        html: {
          views: [

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

const bootswatchSkinManifest: DeckoModManifest = {
  name: "bootstrap",
  setModules: [
    {
      setPath: "type/bootswatch_skin",
      formats: {
        html: {
          views: [

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

describe("superView - Ruby's super() in view bodies (view_definition.rb:18-21)", () => {
  let loader: ModLoader | undefined;

  beforeEach(() => {
    setDefaultModLoader(undefined);
  });

  afterEach(() => {
    loader?.reset();
    setDefaultModLoader(undefined);
    loader = undefined;

    delete HTML_VIEWS["titled"];
    delete HTML_VIEWS["titled_content"];
    delete HTML_VIEWS["content"];
    delete HTML_VIEWS["core"];
    delete HTML_VIEWS["input"];
  });

  it("api_key's :titled super() resolves to card-mod-format's :titled", () => {
    loader = new ModLoader(
      [{ manifest: formatAllBase }, { manifest: apiKeyManifest }],
      HTML_VIEWS,
    );
    loader.load();
    setDefaultModLoader(loader);

    const ctx = makeCtx("ALL RIGHT-api_key", "titled");

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

    const ctx = makeCtx("ALL TYPE-bootswatch_skin", "input");
    expect(superView(ctx, "Type::BootswatchSkin", "input")).toBe("format:input");
  });

  it("super() past the LAST chain entry falls to the BASE format's view (view_definition.rb:18-21)", () => {

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

    expect(superView(makeCtx("ALL", "zz_no_core_view"), "All::Base", "zz_no_core_view")).toBe("");
  });

  it("super() returns '' when no loader is registered (safe fallback)", () => {

    setDefaultModLoader(undefined);
    const ctx = makeCtx("ALL", "titled");
    expect(superView(ctx, "Right::ApiKey", "titled")).toBe("");
  });

  it("super() returns '' when the currentModule is not in the chain", () => {

    loader = new ModLoader(
      [{ manifest: formatAllBase }],
      HTML_VIEWS,
    );
    loader.load();
    setDefaultModLoader(loader);

    const ctx = makeCtx("ALL", "titled");
    expect(superView(ctx, "NotInChain", "titled")).toBe("");
  });

  it("Abstract pseudo-pattern registrations chain in load order (empty cardChain fallback)", () => {

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

    const chain = loader.viewChain("", "input");
    expect(chain.map((e) => e.setModule)).toEqual([
      "Abstract::CodeContent",
      "Abstract::HamlFile",
      "Abstract::ReadOnly",
    ]);

    const ctx = makeCtx("", "input");
    expect(superView(ctx, "Abstract::CodeContent", "input")).toBe(
      "haml_file:input",
    );
    expect(superView(ctx, "Abstract::HamlFile", "input")).toBe(
      "read_only:input",
    );

    const baseInput = HTML_VIEWS["input"];
    const expectedTerminal = baseInput !== undefined ? baseInput(makeCtx("", "input")) : "";
    expect(superView(ctx, "Abstract::ReadOnly", "input")).toBe(expectedTerminal);
  });

  it("a three-level chain (api_key -> type-X -> all) walks each super() step", () => {

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

    expect(superView(ctx, "Right::ApiKey", "titled")).toBe("format:titled");

    expect(superView(ctx, "Right::ApiKey", "titled")).toBe("format:titled");

    expect(superView(ctx, "Type::X", "titled")).toBe("format:titled");

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
