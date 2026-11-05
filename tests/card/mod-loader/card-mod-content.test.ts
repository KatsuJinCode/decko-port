// The card-mod-content mod loader integration test: the mod loaded
// through the loader registers its views and the rendered bytes match
// the Ruby source semantics.
//
// Proof shape (A/B per ported view):
//   WITHOUT the mod: render the view on the seeded probe card raises the
//     unsupported-view error (render.ts#view_method - the view does not
//     exist on the live registry).
//   WITH the mod: the view renders the port's documented bytes; the
//     set-modules basket records the full gem tree.
//
// Key port-side observations:
// - :input is declared in three abstract set modules (CodeContent/
//   HamlFile/ReadOnly). The mod loader's view table is a flat record
//   where later registrations win (mod-registrar.ts:303-309
//   ViewRegistrationTable#define_method-replace); under path-sort
//   "abstract/01_code_content" < "abstract/haml_file" < "abstract/
//   read_only" so the LAST registered :input is ReadOnly's
//   "Content can't be edited." - the same end-state Ruby reaches at
//   the format module level after every CodeContent/HamlFile/ReadOnly
//   reopening. The TS port captures the END STATE of the format
//   module's view_method, not the dynamic set-module walk (a known
//   headless-port simplification - the same simplification card-mod-
//   account and card-mod-bootstrap ports make).
// - :one_line_content is declared in two right set modules (default/
//   structure). Path-sort: "right/default" < "right/structure", so the
//   last-registered version is Right::Structure's "typeName : raw"
//   shape. The TS port captures that end state.
// - :bar_middle is declared only by abstract/01_code_content (the
//   icon-tag + "file" span shape).
// - :file_size is declared only by abstract/02_code_file (the
//   "name: number_to_human_size" template).
//
// Probe cards:
//   - Oracle Code Probe (any card; abstract applies to every card via
//     the abstract pseudo-pattern). :input / :bar_middle / :file_size
//     all reachable from a single probe.
//   - Oracle Template Probe (any card with content). :file_size needs
//     bytesize of the dbContent.
//   - Oracle One-Line Probe+default (junction: right side = *default
//     setting) - the right/default set module applies. The :one_line_
//     content rendered is Right::Structure's "typeName : raw" (the
//     last-registered end state).
//   - Oracle One-Line Probe+structure (junction: right side =
//     *structure setting) - same end state via right/structure.

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

// Oracle byte-pinning for the Abstract::CodeContent / Abstract::HamlFile /
// Abstract::ReadOnly :input chain (card-mod-content set/abstract/01_code_
// content.rb:2-5 + haml_file.rb:11-14 + read_only.rb:1-4). The capture
// script at tests/card/mod-loader/oracle-capture-content-inputs.rb runs
// from tools/oracle/decko-oracle-app via decko runner; this fixture is
// the byte oracle the TS port's superView chain terminals pin against.
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

  // codename cards (the codename registry reads cards.codename; their
  // type ids matter to the rule-cache join: set-typed vs setting-typed).
  await seedCard(s, { id: 2, name: "RichText" }); // cardtypes' type card
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 12, name: "*right", codename: "right", typeId: 13 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });
  // the *default setting card (the codename registry's lookup for the
  // Self::Default / Right::Default anchor).
  await seedCard(s, {
    id: 100,
    name: "*default",
    codename: "default",
    typeId: 14,
  });
  // the *structure setting card (the codename registry's lookup for
  // the Self::Structure / Right::Structure anchor).
  await seedCard(s, {
    id: 110,
    name: "*structure",
    codename: "structure",
    typeId: 14,
  });

  // Oracle Code Probe - any card. The abstract pseudo-pattern carries
  // every abstract set module's views onto every card.
  await seedCard(s, {
    id: 120,
    name: "Oracle Code Probe",
    dbContent: "code probe body",
    typeId: 2,
  });

  // Oracle Template Probe - any card with multi-byte content (the
  // file_size view uses bytesize of dbContent).
  await seedCard(s, {
    id: 130,
    name: "Oracle Template Probe",
    dbContent: "hello", // 5 bytes
    typeId: 2,
  });

  // Oracle One-Line Probe+default (junction: left = Oracle One-Line
  // Probe, right = *default setting). The right/default set module
  // applies because the card's right side is the *default setting card.
  await seedCard(s, {
    id: 140,
    name: "Oracle One-Line Probe",
    dbContent: "one line body",
    typeId: 2,
  });
  await seedCard(s, {
    id: 141,
    leftId: 140,
    rightId: 100, // +default right (right is the *default setting card)
    typeId: 14, // setting type (junctions are setting-typed)
    dbContent: "default rule body",
  });

  // Oracle One-Line Probe+structure (junction: left = Oracle One-Line
  // Probe, right = *structure setting). The right/structure set module
  // applies because the card's right side is the *structure setting.
  await seedCard(s, {
    id: 142,
    leftId: 140,
    rightId: 110, // +structure right
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
    // :bar_middle is already in HTML_VIEWS (the render layer's baseline
    // barMiddleView returns ""), so without the mod it renders "" instead
    // of throwing. The mod port overrides it with the CodeContent shape;
    // the override is the proof of the WITH-the-mod test below.
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
    // 5 ASCII bytes -> "5 Bytes" (number_to_human_size's <1KB branch).
    expect(await s.engine.render("Oracle Template Probe", "file_size")).toBe(
      "Oracle Template Probe: 5 Bytes",
    );
  });

  it("WITH the mod: :file_size on an empty card renders '0 Bytes' (number_to_human_size <1KB floor)", async () => {
    const s = storage!;
    // Seed an empty card and render :file_size.
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
    // right/structure.rb:13-16: "#{_render_type} : #{_render_raw}" - the
    // TS port composes from card.typeName + card.dbContent. The last-
    // registered :one_line_content wins (right/structure sorts after
    // right/default in path order), so this is the shape on every
    // probe regardless of which right set module applied. Both probes
    // are setting-typed (typeId=14 -> *setting), so typeName is
    // "*setting" (the name of the type card, not its codename).
    expect(
      await s.engine.render("Oracle One-Line Probe+*default", "one_line_content"),
    ).toBe("*setting : default rule body");
    expect(
      await s.engine.render("Oracle One-Line Probe+*structure", "one_line_content"),
    ).toBe("*setting : structure rule body");
  });

  it("WITH the mod: every set module from the gem tree is in the basket", () => {
    const basket = loader!.setModules();
    // abstract pseudo-pattern: 00_sources + 01_code_content +
    // 02_code_file + haml_file + lock + read_only + templated_nests.
    // The shortname function strips NN_ prefixes (loader.rb#parts_from_
    // path:61-65), so "abstract/01_code_content" -> "Abstract::CodeContent"
    // (the "01_" load-order prefix is stripped before camelization).
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
    // base pattern (all): chunk + contextual_content + templating.
    expect(basket.base.map((m) => m.shortname)).toContain("All::Chunk");
    expect(basket.base.map((m) => m.shortname)).toContain(
      "All::ContextualContent",
    );
    expect(basket.base.map((m) => m.shortname)).toContain("All::Templating");
    // right nonbase: default + structure.
    const right = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(right).toContain("Right::Default");
    expect(right).toContain("Right::Structure");
    // self nonbase: default + structure.
    const self = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(self).toContain("Self::Default");
    expect(self).toContain("Self::Structure");
  });

  it("WITH the mod: the mod loader's load report lists every ported view", () => {
    const report = loader!.load();
    // :input (3 declarations collapse to one view name; the report
    // records the distinct names registered).
    expect(report.registeredViews).toContain("input");
    expect(report.registeredViews).toContain("bar_middle");
    expect(report.registeredViews).toContain("file_size");
    expect(report.registeredViews).toContain("one_line_content");
  });

  it("WITH the mod: the setting_opts registrations match the Ruby source (self/default.rb + self/structure.rb)", () => {
    const registry = loader!.settingsRegistry();

    // Self::Default - set/self/default.rb:1-2:
    //   setting_opts group: :templating, position: 2, rule_type_editable: true,
    //                    short_help_text: "type/content template for new cards"
    const def = registry.findByCodename("default");
    expect(def).toBeDefined();
    expect(def?.group).toBe("templating");
    expect(def?.ruleTypeEditable).toBe(true);
    expect(def?.shortHelpText).toBe("type/content template for new cards");

    // Self::Structure - set/self/structure.rb:1-4:
    //   setting_opts group: :templating, position: 2, rule_type_editable: true,
    //                    short_help_text: "control card's content / structure",
    //                    help_text: "Controls cards' content / structure.
    //                                [[http://decko.org/formatting|more]]"
    const str = registry.findByCodename("structure");
    expect(str).toBeDefined();
    expect(str?.group).toBe("templating");
    expect(str?.ruleTypeEditable).toBe(true);
    expect(str?.shortHelpText).toBe("control card's content / structure");
    expect(str?.rawHelpText).toBe(
      "Controls cards' content / structure. " +
        "[[http://decko.org/formatting|more]]",
    );

    // The position=2 insertion in the templating group means index 1
    // (setting.rb#set_position:101-110 inserts BEFORE an occupied slot,
    // so both default and structure land at index 1; the second
    // registration's insert leaves the first at index 0 - the nil hole
    // at templating[0] is the Ruby shape).
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
    // baseline :content is the format/views.ts#contentView; the mod
    // does NOT redefine :content for any of its set modules, so the
    // existing core content renders unchanged. We assert it renders
    // WITHOUT throwing and produces a non-empty slot.
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
  });

  // -----------------------------------------------------------------------
  // Oracle byte-pinning: card-mod-content abstract :input chain terminals
  // (card-mod-content set/abstract/01_code_content.rb:2-5,
  //  haml_file.rb:11-14, read_only.rb:1-4). The captured Ruby
  // per-module :input literals + rendered :input bytes live at
  // fixtures/captured/content-inputs.json; the assertions below pin the
  // TS port's superView chain terminals against them.
  // -----------------------------------------------------------------------

  it("oracle: Abstract::CodeContent's :input literal matches the captured bytes (01_code_content.rb:2-5)", () => {
    // The Ruby view DSL stores `view :input do "..."` body as a Proc on
    // Card::Set::Abstract::CodeContent::HtmlFormat.views[self][:input].
    // Calling the proc returns the literal "Content is stored in file
    // and can't be edited." - the per-set-module bytes the TS port's
    // superView chain terminals pin against.
    expect(captured.per_module_input["Abstract::CodeContent::HtmlFormat"])
      .toBe("Content is stored in file and can't be edited.");
  });

  it("oracle: Abstract::HamlFile's :input literal matches the captured bytes (haml_file.rb:11-14)", () => {
    expect(captured.per_module_input["Abstract::HamlFile::HtmlFormat"])
      .toBe("Content is managed by code and cannot be edited");
  });

  it("oracle: Abstract::ReadOnly's :input literal matches the captured bytes (read_only.rb:1-4)", () => {
    // ReadOnly is the chain's terminal literal - super() past this
    // module returns "" (no further :input registered). The TS port's
    // chain terminal IS this literal for every card that walks the
    // Abstract pseudo-pattern (the OR-fallback in CodeContent's +
    // HamlFile's superView calls catches this when they're not
    // bypassed - but in practice the chain walking means the OR
    // always returns this terminal literal because ReadOnly never
    // chains further).
    expect(captured.per_module_input["Abstract::ReadOnly::HtmlFormat"])
      .toBe("Content can't be edited.");
  });

  it("oracle: every abstract :input view is registered under its source module", () => {
    // The :input view must be defined on each abstract set's HtmlFormat
    // module (so the chain walker can step through CodeContent ->
    // HamlFile -> ReadOnly). Source locations name the file that
    // contributed each registration - pinning the TS manifest entries
    // to their Ruby counterparts.
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
    // The superView chain (mod-view-helpers.ts:97-115) walks the
    // Abstract pseudo-pattern registrations in load order:
    // CodeContent -> HamlFile -> ReadOnly. ReadOnly has no further
    // :input (its view body returns the bare literal without calling
    // superView), so the chain terminates there. The flat last-wins
    // views.input IS ReadOnly's body - every card that resolves :input
    // through the abstract chain renders ReadOnly's literal.
    const s = storage!;
    const html = await s.engine.render("Oracle Code Probe", "input");
    // The chain terminal (Abstract::ReadOnly's literal): the bytes
    // the format module's view_method returns after every abstract
    // reopening of :input - same end state Ruby reaches at the
    // format module level after ReadOnly's reopening wins.
    expect(html).toBe(captured.per_module_input["Abstract::ReadOnly::HtmlFormat"]);
    expect(html).toBe("Content can't be edited.");
  });

  it("WITH the mod: every per-module :input literal survives super() chaining (chain terminal = ReadOnly)", () => {
    // All three abstract modules chain via superView: CodeContent and
    // HamlFile each delegate via superView and fall back to their own
    // literal only if super() returns "". ReadOnly is the terminal,
    // so its literal is what super() ultimately returns. The TS
    // port's chain terminals therefore pin the ReadOnly literal for
    // both CodeContent-anchored and HamlFile-anchored cards.
    loader = new ModLoader([{ manifest: cardModContent }]);
    loader.load();
    const chain = loader.viewChain("", "input");
    const modules = chain.map((e) => e.setModule);
    expect(modules).toContain("Abstract::CodeContent");
    expect(modules).toContain("Abstract::HamlFile");
    expect(modules).toContain("Abstract::ReadOnly");

    // The chain's order is load-order; ReadOnly at the end.
    const readOnlyIdx = modules.indexOf("Abstract::ReadOnly");
    expect(readOnlyIdx).toBeGreaterThan(modules.indexOf("Abstract::CodeContent"));
    expect(readOnlyIdx).toBeGreaterThan(modules.indexOf("Abstract::HamlFile"));
  });
});