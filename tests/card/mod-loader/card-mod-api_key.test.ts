

import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ModLoader,
  modEngineHost,
  setDefaultModLoader,
  type DeckoModManifest,
} from "../../../src/card/mod-loader.js";
import cardModApiKey from "../../../src/card/mod-loader/mods/card-mod-api_key.js";
import { HTML_VIEWS } from "../../../src/card/render/views.js";
import type { ViewContext, ViewFn } from "../../../src/card/render/format.js";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../fixtures/captured/api-key-views.json", import.meta.url),
    ),
    "utf8",
  ),
) as {
  rendered: Record<string, string>;
};

interface MinimalCard {
  name: { s: string };
  dbContent: string;
}

interface MinimalVoo {
  readonly requestedView: string;
  readonly opts: Record<string, unknown>;
  readonly viz: Map<string, "show" | "hide">;
  readonly classUps: Map<string, string>;
  classUp(klass: string, classier: string): void;
  classy(...classes: (string | string[])[]): string;
}

class StubVoo implements MinimalVoo {
  readonly requestedView: string;
  readonly opts: Record<string, unknown>;
  readonly viz = new Map<string, "show" | "hide">();
  readonly classUps = new Map<string, string>();
  constructor(requestedView: string, opts: Record<string, unknown> = {}) {
    this.requestedView = requestedView;
    this.opts = opts;
  }
  classUp(klass: string, classier: string): void {
    this.classUps.set(klass, [this.classUps.get(klass), classier].filter((s) => s !== undefined && s !== "").join(" "));
  }
  classy(...classes: (string | string[])[]): string {
    const flat: string[] = [];
    for (const group of classes) {
      if (Array.isArray(group)) flat.push(...group);
      else if (group !== "") flat.push(group);
    }
    return flat.filter((s) => s !== "").join(" ");
  }
}

interface MinimalFmt {
  card: MinimalCard;
  renderView(view: string, opts?: Record<string, unknown>): string;
  nest(opts: {
    name: string;
    syntax: string;
    options: { view: string; extra: Record<string, unknown> };
    comment: undefined;
  }): string;
}

class StubFmt implements MinimalFmt {
  readonly card: MinimalCard;
  private readonly nestCalls: { name: string; view: string }[] = [];
  private readonly renderCalls: string[] = [];
  constructor(card: MinimalCard) {
    this.card = card;
  }
  renderView(view: string, _opts: Record<string, unknown> = {}): string {
    this.renderCalls.push(view);

    return `[rendered:${view}]`;
  }
  nest(opts: {
    name: string;
    syntax: string;
    options: { view: string; extra: Record<string, unknown> };
    comment: undefined;
  }): string {
    this.nestCalls.push({ name: opts.name, view: opts.options.view });
    return `[nested:${opts.name}|${opts.options.view}]`;
  }
  getRenderCalls(): readonly string[] {
    return this.renderCalls;
  }
  getNestCalls(): readonly { name: string; view: string }[] {
    return this.nestCalls;
  }
}

function makeCtx(fmt: StubFmt, view: string): {
  ctx: ViewContext;
  fmt: StubFmt;
} {
  const voo = new StubVoo(view);
  const ctx = { fmt: fmt as unknown as ViewContext["fmt"], voo: voo as unknown as ViewContext["voo"] };
  return { ctx: ctx as unknown as ViewContext, fmt };
}

function collectViewFns(manifest: DeckoModManifest): {
  html: Map<string, { viewFn: ViewFn; config: unknown }>;
  json: Map<string, { viewFn: ViewFn; config: unknown }>;
} {
  const html = new Map<string, { viewFn: ViewFn; config: unknown }>();
  const json = new Map<string, { viewFn: ViewFn; config: unknown }>();
  for (const module of manifest.setModules ?? []) {
    const formats = module.formats ?? {};
    for (const [format, block] of Object.entries(formats)) {
      const target = format === "json" ? json : html;
      for (const view of block.views ?? []) {
        target.set(view.view, { viewFn: view.viewFn, config: view.config });
      }
    }
  }
  return { html, json };
}

let liveLoader: ModLoader | undefined;

afterEach(() => {
  liveLoader?.reset();
  liveLoader = undefined;
});

describe("card-mod-api_key manifest structure", () => {
  it("names + groups + gemName mirror the gem's metadata (dirs.rb:144-150)", () => {
    expect(cardModApiKey.name).toBe("api_key");
    expect(cardModApiKey.gemName).toBe("card-mod-api_key");
    expect(cardModApiKey.group).toBe("gem");
  });

  it("declares exactly the two set files the gem's set/ tree ships", () => {

    const paths = (cardModApiKey.setModules ?? []).map((m) => m.setPath);
    expect(paths).toEqual(["right/api_key", "right/account"]);
  });

  it("set/right/api_key.rb registers the 8 html views + 1 json view", () => {
    const setFile = (cardModApiKey.setModules ?? []).find(
      (m) => m.setPath === "right/api_key",
    );
    expect(setFile).toBeDefined();
    const html = setFile!.formats?.["html"]?.views?.map((v) => v.view) ?? [];
    expect(html).toEqual([
      "core",
      "current",
      "titled",
      "titled_content",
      "content",
      "token_link",
      "buttons",
      "generate_button",
    ]);
    const json = setFile!.formats?.["json"]?.views?.map((v) => v.view) ?? [];
    expect(json).toEqual(["token"]);
  });

  it("set/right/account.rb registers the api_key html view (account.rb:5-9)", () => {
    const setFile = (cardModApiKey.setModules ?? []).find(
      (m) => m.setPath === "right/account",
    );
    expect(setFile).toBeDefined();
    const html = setFile!.formats?.["html"]?.views?.map((v) => v.view) ?? [];
    expect(html).toEqual(["api_key"]);
  });

  it("registers every mod-specific view the T6 verdict's missing list names", () => {

    const { html, json } = collectViewFns(cardModApiKey);
    const htmlNames = new Set(html.keys());
    const jsonNames = new Set(json.keys());
    for (const name of ["api_key", "buttons", "current", "generate_button", "token_link"]) {
      expect(htmlNames.has(name)).toBe(true);
    }
    expect(jsonNames.has("token")).toBe(true);
  });

  it("preserves the Ruby unknown: true tag on every mod-specific html view", () => {
    const { html } = collectViewFns(cardModApiKey);

    for (const view of ["core", "current", "titled", "titled_content", "content"]) {
      expect(html.get(view)?.config).toEqual({ unknown: true });
    }
    expect(html.get("buttons")?.config).toEqual({ unknown: true, perms: "update" });
    expect(html.get("generate_button")?.config).toEqual({ unknown: true, perms: "update" });
  });

  it("preserves the perms: :update tag on :buttons + :generate_button", () => {
    const { html } = collectViewFns(cardModApiKey);
    expect(html.get("buttons")?.config).toEqual({ unknown: true, perms: "update" });
    expect(html.get("generate_button")?.config).toEqual({ unknown: true, perms: "update" });
  });

  it("loads into the nonbase basket: card_mod_api_key's Right::ApiKey + Right::Account", () => {
    const loader = new ModLoader([{ manifest: cardModApiKey }], { ...HTML_VIEWS });
    liveLoader = loader;
    loader.load();
    const basket = loader.setModules();
    const right = basket.nonbase.get("Right::ApiKey") ?? [];
    expect(right.length).toBe(1);
    expect(right[0]?.shortname).toBe("Right::ApiKey");
    expect(right[0]?.kind).toBe("nonbase");
    expect(right[0]?.modName).toBe("api_key");
    const account = basket.nonbase.get("Right::Account") ?? [];
    expect(account.length).toBe(1);
    expect(account[0]?.shortname).toBe("Right::Account");
    expect(account[0]?.modName).toBe("api_key");
  });

  it("registers every mod view into the views record and reset restores the pre-load state", () => {

    const liveRecord = { ...HTML_VIEWS };
    const sentinel: ViewFn = () => "SENTINEL";
    liveRecord["token"] = sentinel;

    const before = "token" in liveRecord;
    expect(before).toBe(true);

    const loader = new ModLoader([{ manifest: cardModApiKey }], liveRecord);
    liveLoader = loader;
    loader.load();

    for (const view of ["core", "current", "titled", "titled_content", "content", "token_link", "buttons", "generate_button"]) {
      expect(typeof liveRecord[view]).toBe("function");
    }

    expect(liveRecord["token"]).toBeDefined();
    expect(liveRecord["token"]).not.toBe(sentinel);

    loader.reset();

    expect(liveRecord["token"]).toBe(sentinel);
    expect(loader.viewConfigFor("buttons")).toBeUndefined();
  });
});

describe("card-mod-api_key view bodies", () => {
  it(":generate_button's hidden trigger input name matches the Ruby event", () => {

    const { html } = collectViewFns(cardModApiKey);
    const view = html.get("generate_button");
    expect(view).toBeDefined();
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "" });
    const { ctx } = makeCtx(fmt, "generate_button");
    const out = view!.viewFn(ctx);
    expect(out).toContain('name="card[trigger]"');
    expect(out).toContain('value="generate_api_key"');
  });

  it(":generate_button submits to the api_key card's edit path (card-mod-format card_form :update)", () => {

    const { html } = collectViewFns(cardModApiKey);
    const view = html.get("generate_button")!;
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "" });
    const { ctx } = makeCtx(fmt, "generate_button");
    const out = view.viewFn(ctx);
    expect(out).toContain('action="/joe_user+*api_key?view=edit"');
    expect(out).toContain('method="post"');
    expect(out).toContain('class="card-form update-form"');
  });

  it(":generate_button's button label flips on content (api_key.rb:100-102)", () => {

    const { html } = collectViewFns(cardModApiKey);
    const view = html.get("generate_button")!;

    const emptyFmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "" });
    const { ctx: emptyCtx } = makeCtx(emptyFmt, "generate_button");
    expect(view.viewFn(emptyCtx)).toContain("Generate API Key");
    expect(emptyFmt.getRenderCalls()).toEqual([]);

    const presentFmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "abc123def456ghi789jkl0" });
    const { ctx: presentCtx } = makeCtx(presentFmt, "generate_button");
    expect(view.viewFn(presentCtx)).toContain("Regenerate API Key");
  });

  it(":generate_button's submit class is btn-primary (api_key.rb:104-106 + bootstrap btn-primary)", () => {

    const { html } = collectViewFns(cardModApiKey);
    const view = html.get("generate_button")!;
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "" });
    const { ctx } = makeCtx(fmt, "generate_button");
    const out = view.viewFn(ctx);
    expect(out).toContain('class="btn btn-primary"');
    expect(out).toContain('type="submit"');
  });

  it(":generate_button carries the disable-with attribute (api_key.rb:91 disable_with: t(:api_key_generating))", () => {

    const { html } = collectViewFns(cardModApiKey);
    const view = html.get("generate_button")!;
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "" });
    const { ctx } = makeCtx(fmt, "generate_button");
    expect(view.viewFn(ctx)).toContain('data-disable-with="Generating API Key"');
  });

  it(":token_link's href encodes format: :json + view: :token (api_key.rb:77-79)", () => {

    const { html } = collectViewFns(cardModApiKey);
    const view = html.get("token_link")!;
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "abc123" });
    const { ctx } = makeCtx(fmt, "token_link");
    const out = view.viewFn(ctx);
    expect(out).toContain('href="/joe_user+*api_key.json?view=token"');
    expect(out).toContain("get a JWT token");
  });

  it(":token (json) returns the documented {token: <encoded>} shape (api_key.rb:63-67)", () => {

    const { json } = collectViewFns(cardModApiKey);
    const view = json.get("token");
    expect(view).toBeDefined();
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "abc123" });
    const { ctx } = makeCtx(fmt, "token");
    const out = view!.viewFn(ctx);
    expect(out).toBe('{"token":"<jwt-token-pending-runtime>"}');
  });

  it(":current renders a readonly text input with the api_key content (current.haml)", () => {

    const { html } = collectViewFns(cardModApiKey);
    const view = html.get("current")!;
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "abc123def456ghi789" });
    const { ctx } = makeCtx(fmt, "current");
    const out = view.viewFn(ctx);
    expect(out).toContain('<div class="current-api-key nodblclick">');
    expect(out).toContain('<label for="current_api_key">API Key</label>');
    expect(out).toContain('id="current_api_key"');
    expect(out).toContain('name="current_api_key"');
    expect(out).toContain('value="abc123def456ghi789"');
    expect(out).toContain('readonly="readonly"');
  });

  it(":core's top section is conditional on card.content (core.haml `if card.content.present?`)", () => {

    const { html } = collectViewFns(cardModApiKey);
    const view = html.get("core")!;

    const emptyFmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "" });
    const { ctx: emptyCtx } = makeCtx(emptyFmt, "core");
    const emptyOut = view.viewFn(emptyCtx);
    expect(emptyOut).toContain('<div class="api-key-core p-1">');
    expect(emptyOut).toContain('<div class="api-key-buttons d-flex my-2 py-3 justify-content-between w-100">');
    expect(emptyOut).not.toContain("api-key-top");

    expect(emptyFmt.getRenderCalls()).toEqual(["buttons"]);

    const presentFmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "abc123" });
    const { ctx: presentCtx } = makeCtx(presentFmt, "core");
    const presentOut = view.viewFn(presentCtx);
    expect(presentOut).toContain('<div class="api-key-top d-flex my-2 py-3 border-bottom justify-content-between w-100">');

    expect(presentFmt.getRenderCalls()).toEqual(["current", "buttons"]);

    expect(presentOut).toContain("[rendered:current]");
    expect(presentOut).toContain("[rendered:buttons]");
  });

  it(":buttons delegates to :generate_button (api_key.rb:81-83 `render_generate_button`)", () => {
    const { html } = collectViewFns(cardModApiKey);
    const view = html.get("buttons")!;
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "" });
    const { ctx } = makeCtx(fmt, "buttons");
    const out = view.viewFn(ctx);
    expect(out).toBe("[rendered:generate_button]");
    expect(fmt.getRenderCalls()).toEqual(["generate_button"]);
  });

  it(":titled, :titled_content, :content all use super() to walk the MRO (api_key.rb:73-75)", () => {

    const { html } = collectViewFns(cardModApiKey);
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "abc" });
    for (const view of ["titled", "titled_content", "content"]) {
      const fn = html.get(view)!;
      const { ctx } = makeCtx(fmt, view);

      expect(fn.viewFn(ctx)).toBe("");
    }
    expect(fmt.getRenderCalls()).toEqual([]);

    expect(html.get("titled")).toBeDefined();
    expect(html.get("titled_content")).toBeDefined();
    expect(html.get("content")).toBeDefined();
  });

  it(":api_key (account.rb) nests the +*api_key child card with view :core", () => {

    const { html } = collectViewFns(cardModApiKey);
    const view = html.get("api_key")!;
    const fmt = new StubFmt({ name: { s: "Joe User" }, dbContent: "" });
    const { ctx } = makeCtx(fmt, "api_key");
    const out = view.viewFn(ctx);
    expect(out).toBe("[nested:Joe User+*api key|core]");
    const calls = fmt.getNestCalls();
    expect(calls).toEqual([{ name: "Joe User+*api key", view: "core" }]);
  });
});

describe("card-mod-api_key locale strings (config/locales/en.yml)", () => {

  it("emits 'API Key' for api_key_label (en.yml:5)", () => {
    const { html } = collectViewFns(cardModApiKey);
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "abc" });
    const { ctx } = makeCtx(fmt, "current");
    expect(html.get("current")!.viewFn(ctx)).toContain("API Key");
  });

  it("emits 'Generate API Key' for api_key_generate (en.yml:6)", () => {
    const { html } = collectViewFns(cardModApiKey);
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "" });
    const { ctx } = makeCtx(fmt, "generate_button");
    expect(html.get("generate_button")!.viewFn(ctx)).toContain("Generate API Key");
  });

  it("emits 'Regenerate API Key' for api_key_regenerate (en.yml:7)", () => {
    const { html } = collectViewFns(cardModApiKey);
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "present" });
    const { ctx } = makeCtx(fmt, "generate_button");
    expect(html.get("generate_button")!.viewFn(ctx)).toContain("Regenerate API Key");
  });

  it("emits 'Generating API Key' for api_key_generating (en.yml:8)", () => {
    const { html } = collectViewFns(cardModApiKey);
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "" });
    const { ctx } = makeCtx(fmt, "generate_button");
    expect(html.get("generate_button")!.viewFn(ctx)).toContain('data-disable-with="Generating API Key"');
  });

  it("emits 'get a JWT token' for api_key_get_jwt_token (en.yml:10)", () => {
    const { html } = collectViewFns(cardModApiKey);
    const fmt = new StubFmt({ name: { s: "Joe User+*api key" }, dbContent: "abc" });
    const { ctx } = makeCtx(fmt, "token_link");
    expect(html.get("token_link")!.viewFn(ctx)).toContain("get a JWT token");
  });
});

function normalize(html: string): string {
  return html
    .replace(/data-slot-id=(["'])[0-9a-fA-F]+\1/g, 'data-slot-id="RANDOMIZED"')
    .replace(/data-card-id=(["'])\d+\1/g, 'data-card-id="RANDOMIZED"');
}

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

describe("card-mod-api_key superView trio (A/B against live oracle)", () => {

  const engineTitled = HTML_VIEWS["titled"]!;
  const engineTitledContent = HTML_VIEWS["titled_content"]!;
  const engineContent = HTML_VIEWS["content"]!;
  const engineCore = HTML_VIEWS["core"]!;
  const engineTitle = HTML_VIEWS["title"]!;
  const engineMenu = HTML_VIEWS["menu"]!;

  const engineCoreStub: DeckoModManifest = {
    name: "engine_core",
    setModules: [
      {
        setPath: "all/base",
        formats: {
          html: {
            views: [
              { view: "titled", viewFn: engineTitled },
              { view: "titled_content", viewFn: engineTitledContent },
              { view: "content", viewFn: engineContent },
              { view: "core", viewFn: engineCore },
              { view: "title", viewFn: engineTitle },
              { view: "menu", viewFn: engineMenu },
            ],
          },
        },
      },
    ],
  };

  beforeAll(async () => {
    storage = await createRenderTestStorage();
    const s = storage;

    await seedCard(s, { id: 2, name: "RichText" });
    await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
    await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
    await seedCard(s, { id: 12, name: "*api_key", codename: "api_key", typeId: 14 });
    await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
    await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

    await seedCard(s, {
      id: 1297,
      name: "Oracle ApiKey Account",
      dbContent: "account body",
    });

    await seedCard(s, {
      id: 1298,
      leftId: 1297,
      rightId: 12,
      typeId: 2,
      dbContent: "probeapikeybody0123456789",
    });

    await seedCard(s, { id: 1299, leftId: 1298, rightId: 11, typeId: 13 });

    loader = new ModLoader([
      { manifest: engineCoreStub },
      { manifest: cardModApiKey },
    ]);
    loader.load();
    setDefaultModLoader(loader);
    await loader.installInto(modEngineHost(s.engine, s.fetcher));
  }, 60_000);

  afterAll(() => {
    loader?.reset();
    setDefaultModLoader(undefined);
    storage?.close();
    storage = undefined;
    loader = undefined;
  });

  it(":titled resolves Right::ApiKey through the RIGHT-Xapi_key token and renders the api key", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle ApiKey Account+*api key", "titled");
    expect(html).not.toBe("");
    expect(html).toContain("probeapikeybody0123456789");
  });

  it(":titled_content delegates through the chain and renders the api key", async () => {
    const s = storage!;
    const html = await s.engine.render(
      "Oracle ApiKey Account+*api key",
      "titled_content",
    );
    expect(html).not.toBe("");
    expect(html).toContain("probeapikeybody0123456789");
  });

  it(":content delegates to the base format's content view", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle ApiKey Account+*api key", "content");
    expect(html).not.toBe("");
    expect(html).toContain("probeapikeybody0123456789");
  });

  it("chain walker finds All::Base via ALL-RIGHT (the X-mark-free path)", () => {

    const chain = loader!.viewChain(
      "ALL ALL_PLUS TYPE-rich_text RSTAR RIGHT-api_key TYPE_PLUS_RIGHT-rich_text-api_key SELF-oracle_api_key_account-api_key",
      "titled",
    );
    expect(chain.map((e) => e.setModule)).toEqual([
      "Right::ApiKey",
      "All::Base",
    ]);
  });
});