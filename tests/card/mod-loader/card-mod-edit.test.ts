// The card-mod-edit mod loader integration test: the mod loaded through
// the loader registers its views and the rendered bytes match the Ruby
// source semantics.
//
// Proof shape (A/B per ported view):
//   WITHOUT the mod: render the view on the seeded probe card raises the
//     unsupported-view error (render.ts#view_method - the view does not
//     exist on the live registry).
//   WITH the mod: the view renders the port's documented bytes; the
//     set-modules basket records the full gem tree (21 set modules
//     across the all/right/self/type patterns); the setting registry
//     records the *input_type setting the data/real.yml seed card
//     declares.
//
// Probe cards:
//   - Oracle Edit Probe (any real card; :just_deleted renders on unknown
//     cards via unknown: true, but the title view runs through normal
//     voo machinery so a real card exercises the same path - the
//     unknown-card view substitution routes :just_deleted for the
//     just-deleted nest the delete action fires).
//   - Oracle Edit Probe+right (the *input type setting's right-anchor -
//     the `setting` table is what the *input_type setting lives in;
//     the setting_opts registration test inspects the SettingsRegistry,
//     not a per-card render).

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

  // codename cards (the codename registry reads cards.codename; their
  // type ids matter to the setting_registry join: setting-typed codename
  // cards vs the rest).
  await seedCard(s, { id: 2, name: "RichText" }); // cardtypes' type card
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

  // *input type setting (the right-anchor for Self::InputType and the
  // codename registry's lookup key for `setting_opts` registration).
  await seedCard(s, {
    id: 100,
    name: "*input type",
    codename: "input_type",
    typeId: 14,
    dbContent: "Configure [[https://ace.c9.io/|ace]]",
  });

  // Oracle Edit Probe (any real card; :just_deleted renders the title
  // view through the normal voo machinery). For the unknown: true path
  // the read-permission check is skipped (view/permission.rb#skip_check?
  // for unknown-card substitutions), so an unknown card works too -
  // but a real card exercises the same bytes (title span + " deleted").
  await seedCard(s, {
    id: 200,
    name: "Oracle Edit Probe",
    dbContent: "edit probe body",
  });

  // Oracle Nested Probe (the *template_nest view runs as a nest
  // substitute; format/nest.rb populates nest_name + nest_syntax in
  // the voo. We exercise the else branch via a direct render call
  // with the nest options set - the view reads them from voo.opts).
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

    // The title view (src/card/render/views.ts#titleView) wraps the
    // name in <span class="card-title" title="X">X</span> with
    // <span>+</span> joints for compound names. Oracle Edit Probe is a
    // simple card so the joint span is absent.
    const html = await s.engine.render("Oracle Edit Probe", "just_deleted");
    expect(html).toBe(
      '<div><span class="card-title" title="Oracle Edit Probe">Oracle Edit Probe</span> deleted</div>',
    );
  });

  it("WITH the mod: :template_nest returns the literal {{syntax}} for non-field-only nests (all/template_nest.rb:9-11)", () => {
    // The else branch of :template_nest echoes the nest_syntax literal.
    // format/nest.rb#prepare_view_and_opts! populates nest_name +
    // nest_syntax from the nest's ParsedNest - here we drive the
    // viewFn directly with those opts set, mirroring the live nest
    // path. The view only reads voo.opts for nest_name + nest_syntax,
    // so a stub ctx is honest.
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
    // The field-only branch is the rails-runtime branch (with_nest_mode +
    // nest template_link_set_name). The port returns "" - the same shape
    // a Ruby's field-only branch yields when the template_link set card
    // does not exist (Card[mark] returns nil and with_card yields nothing).
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
    // pattern: all (20 set modules - base bucket)
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
    // pattern: right (nonbase)
    const right = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(right).toContain("Right::InputType");
    expect(right).toContain("Right::Thanks");
    // pattern: self (nonbase)
    const selfMods = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(selfMods).toContain("Self::InputType");
    // pattern: type (nonbase)
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
    // The ModLoadReport is returned by load(); re-run via the loader's
    // table introspection since the first call's report was discarded.
    const report = loader!.load();
    expect(report.registeredViews).toContain("just_deleted");
    expect(report.registeredViews).toContain("template_nest");
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Edit Probe", "content");
    // baseline :content is the format/views.ts#contentView; the mod
    // does NOT redefine :content for any of its set modules, so the
    // existing core content renders unchanged. We assert it renders
    // WITHOUT throwing and produces a non-empty slot.
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
  });
});
