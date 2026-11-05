

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import cardModEdit from "../../../src/card/mod-loader/mods/card-mod-edit.js";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

  await seedCard(s, {
    id: 100,
    name: "*input type",
    codename: "input_type",
    typeId: 14,
    dbContent: "Configure [[https://ace.c9.io/|ace]]",
  });

  await seedCard(s, {
    id: 200,
    name: "Oracle Edit Probe",
    dbContent: "edit probe body",
  });

  await seedCard(s, {
    id: 210,
    name: "Oracle Nested Probe",
    dbContent: "nested probe body",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-edit through the mod loader (A/B)", () => {
  it("WITHOUT the mod: every ported view raises UnsupportedViewError", async () => {
    const s = storage!;
    await expect(s.engine.render("Oracle Edit Probe", "just_deleted")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Edit Probe", "template_nest")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: :just_deleted renders <div>TITLE deleted</div> (all/editing.rb:46-48)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModEdit }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const html = await s.engine.render("Oracle Edit Probe", "just_deleted");
    expect(html).toBe(
      '<div><span class="card-title" title="Oracle Edit Probe">Oracle Edit Probe</span> deleted</div>',
    );
  });

  it("WITH the mod: :template_nest returns the literal {{syntax}} for non-field-only nests (all/template_nest.rb:9-11)", () => {

    const viewsTable = loader!.viewsTable();
    const viewFn = viewsTable["template_nest"];
    expect(viewFn).toBeDefined();
    if (viewFn === undefined) return;
    const ctx = {
      fmt: undefined,
      voo: {
        opts: {
          nest_name: "Oracle Nested Probe",
          nest_syntax: "Oracle Nested Probe",
        },
      },
    };
    expect(viewFn(ctx as unknown as Parameters<typeof viewFn>[0])).toBe(
      "{{Oracle Nested Probe}}",
    );
  });

  it("WITH the mod: :template_nest returns \"\" when no nest_name is set (all/template_nest.rb:3-4)", () => {
    const viewsTable = loader!.viewsTable();
    const viewFn = viewsTable["template_nest"];
    expect(viewFn).toBeDefined();
    if (viewFn === undefined) return;
    const ctx = {
      fmt: undefined,
      voo: { opts: {} },
    };
    expect(viewFn(ctx as unknown as Parameters<typeof viewFn>[0])).toBe(
      "",
    );
  });

  it("WITH the mod: :template_nest returns \"\" for field-only names (honest remainder)", () => {

    const viewsTable = loader!.viewsTable();
    const viewFn = viewsTable["template_nest"];
    expect(viewFn).toBeDefined();
    if (viewFn === undefined) return;
    const ctx = {
      fmt: undefined,
      voo: {
        opts: {
          nest_name: "+relative_field",
          nest_syntax: "+relative_field",
        },
      },
    };
    expect(viewFn(ctx as unknown as Parameters<typeof viewFn>[0])).toBe(
      "",
    );
  });

  it("WITH the mod: every set module from the gem tree is in the basket", () => {
    const basket = loader!.setModules();

    const base = basket.base.map((m) => m.shortname);
    expect(base).toContain("All::Board");
    expect(base).toContain("All::Board::BoardPills");
    expect(base).toContain("All::Board::FollowSection");
    expect(base).toContain("All::Board::RelatedSection");
    expect(base).toContain("All::Board::TabViews");
    expect(base).toContain("All::Board::TabVisibility");
    expect(base).toContain("All::EditContent");
    expect(base).toContain("All::EditInline");
    expect(base).toContain("All::EditName");
    expect(base).toContain("All::EditType");
    expect(base).toContain("All::Editing");
    expect(base).toContain("All::Editor");
    expect(base).toContain("All::Form");
    expect(base).toContain("All::FormButtons");
    expect(base).toContain("All::FormElements");
    expect(base).toContain("All::Formgroup");
    expect(base).toContain("All::New");
    expect(base).toContain("All::OverlayGuide");
    expect(base).toContain("All::TemplateNest");

    const right = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(right).toContain("Right::InputType");
    expect(right).toContain("Right::Thanks");

    const selfMods = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(selfMods).toContain("Self::InputType");

    const type = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(type).toContain("Type::List");
    expect(type).toContain("Type::PlainText");
    expect(type).toContain("Type::Pointer");
  });

  it("WITH the mod: the *input_type setting is registered (self/input_type.rb:1-4)", () => {
    const registry = loader!.settingsRegistry();
    const inputType = registry.findByCodename("input_type");
    expect(inputType).toBeDefined();
    expect(inputType?.group).toBe("editing");
    expect(inputType?.ruleTypeEditable).toBe(false);
    expect(inputType?.shortHelpText).toBe("edit interface");
  });

  it("WITH the mod: the mod loader's load report lists every ported view", () => {

    const report = loader!.load();
    expect(report.registeredViews).toContain("just_deleted");
    expect(report.registeredViews).toContain("template_nest");
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Edit Probe", "content");

    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
  });
});
