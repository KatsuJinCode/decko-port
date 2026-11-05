

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { UnsupportedViewError } from "../../../src/card/render/format.js";
import {
  ModLoader,
  modEngineHost,
} from "../../../src/card/mod-loader.js";
import cardModContent from "../../../src/card/mod-loader/mods/card-mod-content.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const CAPTURE_PATH = resolve(
  REPO_ROOT,
  "fixtures/captured/content-inputs.json",
);
interface ContentInputCapture {
  registered_views: Record<
    string,
    { defined: boolean; source_location: [string, number] | null }
  >;
  per_module_input: Record<string, string>;
}
const captured: ContentInputCapture = JSON.parse(
  readFileSync(CAPTURE_PATH, "utf8"),
);

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 12, name: "*right", codename: "right", typeId: 13 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

  await seedCard(s, {
    id: 100,
    name: "*default",
    codename: "default",
    typeId: 14,
  });

  await seedCard(s, {
    id: 110,
    name: "*structure",
    codename: "structure",
    typeId: 14,
  });

  await seedCard(s, {
    id: 120,
    name: "Oracle Code Probe",
    dbContent: "code probe body",
    typeId: 2,
  });

  await seedCard(s, {
    id: 130,
    name: "Oracle Template Probe",
    dbContent: "hello",
    typeId: 2,
  });

  await seedCard(s, {
    id: 140,
    name: "Oracle One-Line Probe",
    dbContent: "one line body",
    typeId: 2,
  });
  await seedCard(s, {
    id: 141,
    leftId: 140,
    rightId: 100,
    typeId: 14,
    dbContent: "default rule body",
  });

  await seedCard(s, {
    id: 142,
    leftId: 140,
    rightId: 110,
    typeId: 14,
    dbContent: "structure rule body",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-content through the mod loader (A/B)", () => {
  it("WITHOUT the mod: every ported view raises UnsupportedViewError", async () => {
    const s = storage!;

    await expect(s.engine.render("Oracle Code Probe", "input")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Template Probe", "file_size")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(
      s.engine.render("Oracle One-Line Probe+*default", "one_line_content"),
    ).rejects.toThrow(UnsupportedViewError);
    await expect(
      s.engine.render("Oracle One-Line Probe+*structure", "one_line_content"),
    ).rejects.toThrow(UnsupportedViewError);
  });

  it("WITH the mod: :input renders ReadOnly's last-registered literal (abstract/read_only.rb:1-4)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModContent }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    expect(await s.engine.render("Oracle Code Probe", "input")).toBe(
      "Content can't be edited.",
    );
  });

  it("WITH the mod: :bar_middle renders CodeContent's icon-tag + span (abstract/01_code_content.rb:7-14)", async () => {
    const s = storage!;
    const expected =
      `<i class="notranslate material-icons text-muted pe-2">warning</i>` +
      `<span class="text-muted">file</span>`;
    expect(await s.engine.render("Oracle Code Probe", "bar_middle")).toBe(
      expected,
    );
  });

  it("WITH the mod: :file_size renders the name + human-size template (abstract/02_code_file.rb:29-31)", async () => {
    const s = storage!;

    expect(await s.engine.render("Oracle Template Probe", "file_size")).toBe(
      "Oracle Template Probe: 5 Bytes",
    );
  });

  it("WITH the mod: :file_size on an empty card renders '0 Bytes' (number_to_human_size <1KB floor)", async () => {
    const s = storage!;

    await seedCard(s, {
      id: 150,
      name: "Oracle Empty Probe",
      typeId: 2,
    });
    expect(await s.engine.render("Oracle Empty Probe", "file_size")).toBe(
      "Oracle Empty Probe: 0 Bytes",
    );
  });

  it("WITH the mod: :one_line_content renders Right::Structure's last-registered shape (right/structure.rb:13-16)", async () => {
    const s = storage!;

    expect(
      await s.engine.render("Oracle One-Line Probe+*default", "one_line_content"),
    ).toBe("*setting : default rule body");
    expect(
      await s.engine.render("Oracle One-Line Probe+*structure", "one_line_content"),
    ).toBe("*setting : structure rule body");
  });

  it("WITH the mod: every set module from the gem tree is in the basket", () => {
    const basket = loader!.setModules();

    expect(basket.abstract.map((m) => m.shortname)).toContain(
      "Abstract::Sources",
    );
    expect(basket.abstract.map((m) => m.shortname)).toContain(
      "Abstract::CodeContent",
    );
    expect(basket.abstract.map((m) => m.shortname)).toContain(
      "Abstract::CodeFile",
    );
    expect(basket.abstract.map((m) => m.shortname)).toContain(
      "Abstract::HamlFile",
    );
    expect(basket.abstract.map((m) => m.shortname)).toContain(
      "Abstract::Lock",
    );
    expect(basket.abstract.map((m) => m.shortname)).toContain(
      "Abstract::ReadOnly",
    );
    expect(basket.abstract.map((m) => m.shortname)).toContain(
      "Abstract::TemplatedNests",
    );

    expect(basket.base.map((m) => m.shortname)).toContain("All::Chunk");
    expect(basket.base.map((m) => m.shortname)).toContain(
      "All::ContextualContent",
    );
    expect(basket.base.map((m) => m.shortname)).toContain("All::Templating");

    const right = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(right).toContain("Right::Default");
    expect(right).toContain("Right::Structure");

    const self = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(self).toContain("Self::Default");
    expect(self).toContain("Self::Structure");
  });

  it("WITH the mod: the mod loader's load report lists every ported view", () => {
    const report = loader!.load();

    expect(report.registeredViews).toContain("input");
    expect(report.registeredViews).toContain("bar_middle");
    expect(report.registeredViews).toContain("file_size");
    expect(report.registeredViews).toContain("one_line_content");
  });

  it("WITH the mod: the setting_opts registrations match the Ruby source (self/default.rb + self/structure.rb)", () => {
    const registry = loader!.settingsRegistry();

    const def = registry.findByCodename("default");
    expect(def).toBeDefined();
    expect(def?.group).toBe("templating");
    expect(def?.ruleTypeEditable).toBe(true);
    expect(def?.shortHelpText).toBe("type/content template for new cards");

    const str = registry.findByCodename("structure");
    expect(str).toBeDefined();
    expect(str?.group).toBe("templating");
    expect(str?.ruleTypeEditable).toBe(true);
    expect(str?.shortHelpText).toBe("control card's content / structure");
    expect(str?.rawHelpText).toBe(
      "Controls cards' content / structure. " +
        "[[http://decko.org/formatting|more]]",
    );

    const templating = registry.groups.get("templating");
    expect(templating).toBeDefined();
    expect(templating?.length).toBeGreaterThanOrEqual(2);
    expect(templating?.[0]).toBeNull();
    expect(templating?.[1]?.codename).toBe("structure");
    expect(templating?.[2]?.codename).toBe("default");
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Code Probe", "content");

    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
  });

  it("oracle: Abstract::CodeContent's :input literal matches the captured bytes (01_code_content.rb:2-5)", () => {

    expect(captured.per_module_input["Abstract::CodeContent::HtmlFormat"])
      .toBe("Content is stored in file and can't be edited.");
  });

  it("oracle: Abstract::HamlFile's :input literal matches the captured bytes (haml_file.rb:11-14)", () => {
    expect(captured.per_module_input["Abstract::HamlFile::HtmlFormat"])
      .toBe("Content is managed by code and cannot be edited");
  });

  it("oracle: Abstract::ReadOnly's :input literal matches the captured bytes (read_only.rb:1-4)", () => {

    expect(captured.per_module_input["Abstract::ReadOnly::HtmlFormat"])
      .toBe("Content can't be edited.");
  });

  it("oracle: every abstract :input view is registered under its source module", () => {

    const cc = captured.registered_views.abstract_code_content_view_input;
    expect(cc.defined).toBe(true);
    expect(cc.source_location).not.toBeNull();
    expect(cc.source_location?.[0]).toContain("card-mod-content-0.20.0");
    expect(cc.source_location?.[0]).toContain("abstract/01_code_content.rb");
    expect(cc.source_location?.[1]).toBe(2);

    const hf = captured.registered_views.abstract_haml_file_view_input;
    expect(hf.defined).toBe(true);
    expect(hf.source_location?.[0]).toContain("abstract/haml_file.rb");
    expect(hf.source_location?.[1]).toBe(12);

    const ro = captured.registered_views.abstract_read_only_view_input;
    expect(ro.defined).toBe(true);
    expect(ro.source_location?.[0]).toContain("abstract/read_only.rb");
    expect(ro.source_location?.[1]).toBe(2);
  });

  it("WITH the mod: superView chain for :input walks CodeContent -> HamlFile -> ReadOnly (terminal literal)", async () => {

    const s = storage!;
    const html = await s.engine.render("Oracle Code Probe", "input");

    expect(html).toBe(captured.per_module_input["Abstract::ReadOnly::HtmlFormat"]);
    expect(html).toBe("Content can't be edited.");
  });

  it("WITH the mod: every per-module :input literal survives super() chaining (chain terminal = ReadOnly)", () => {

    loader = new ModLoader([{ manifest: cardModContent }]);
    loader.load();
    const chain = loader.viewChain("", "input");
    const modules = chain.map((e) => e.setModule);
    expect(modules).toContain("Abstract::CodeContent");
    expect(modules).toContain("Abstract::HamlFile");
    expect(modules).toContain("Abstract::ReadOnly");

    const readOnlyIdx = modules.indexOf("Abstract::ReadOnly");
    expect(readOnlyIdx).toBeGreaterThan(modules.indexOf("Abstract::CodeContent"));
    expect(readOnlyIdx).toBeGreaterThan(modules.indexOf("Abstract::HamlFile"));
  });
});