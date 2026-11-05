// The card-mod-tabs mod loader test: the mod loaded through the loader
// registers its four html views (tabs, pills, tabs_static, pills_static)
// and the gem tree's two set modules. The lazy views are proven
// BYTE-IDENTICAL against the live decko 0.20.0 oracle capture
// (fixtures/captured/tabs-mod-loader.json, recorded via
// oracle-capture-tabs-mod.rb); the static views are proven to carry the
// SAME RAISE Ruby ships (NoMethodError on `args` - the oracle's
// CAPTURE_ERROR entries).
//
// Proof shape (A/B per ported view):
//   WITHOUT the mod: render the view on the seeded probe card raises the
//     unsupported-view error (render.rb#view_method - the view does not
//     exist on the live registry).
//   WITH the mod: the view renders bytes that equal the oracle capture
//     after the three masks both sides share:
//       - data-slot-id (SecureRandom hex per render)
//       - data-card-id (probe ids advance every oracle capture run)
//       - the tab ids' root-format counter (the oracle reuses ONE format
//         object across its renders - :tabs consumed counter values 1/2,
//         so its :pills render carries 3/4 - while every TS engine.render
//         starts a fresh format at 1; content.rb:59-67 pins the semantics,
//         the capture's absolute values are render-sequence noise)
//
// Probe cards (mirroring the capture's seeds):
//   - Oracle Probe Child (RichText, "probe item body") - the tab target
//   - Oracle Tabs Probe (RichText, nests with options) - :tabs + :pills
//   - Oracle Tabs Plain Probe (RichText, plain nests)
//   - Oracle Tabs Pointer Probe (Pointer, plain item lines) - the
//     Abstract::List each_item_name_with_options override branch
//   - Oracle Tabs Empty Probe (RichText, no nests) - the empty panel
//
// Set module basket (set/all/tabs.rb :tabs/:pills/:tabs_static/
// :pills_static; set/abstract/tabs.rb passive - include-scoped machinery,
// see card-mod-tabs.ts header): all/tabs (base bucket) + abstract/tabs
// (abstract bucket).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
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
import cardModTabs from "../../../src/card/mod-loader/mods/card-mod-tabs.js";

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../fixtures/captured/tabs-mod-loader.json", import.meta.url),
    ),
    "utf8",
  ),
) as { rendered: Record<string, string> };

const SLOT_ID_RE = /data-slot-id=(["'])[0-9a-f]+\1/g;
const CARD_ID_RE = /data-card-id=(["'])\d+\1/g;
const TAB_COUNTER_RE = /tab-([a-z0-9_]+)-\d+-(oracle_probe_child|second_item)/g;

/** The three masks the capture and this test share (the capture script
 *  applies the first two; the counter mask is this test's - see the
 *  header). */
function normalize(html: string): string {
  return html
    .replace(SLOT_ID_RE, 'data-slot-id="RANDOMIZED"')
    .replace(CARD_ID_RE, 'data-card-id="RANDOMIZED"')
    .replace(TAB_COUNTER_RE, "tab-$1-COUNTER-$2");
}

function expectOracleBytes(actual: string, oracleKey: string): void {
  expect(normalize(actual)).toBe(normalize(FIXTURE.rendered[oracleKey]));
}

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  // codename + type cards (the codename registry reads cards.codename;
  // id 2 is the default seed type - its name is what slot divs carry as
  // data-card-type-name / TYPE-rich_text).
  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 5, name: "Pointer", codename: "pointer" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });

  // the tab target + the four probe cards (capture seeds)
  await seedCard(s, {
    id: 100,
    name: "Oracle Probe Child",
    dbContent: "probe item body",
  });
  await seedCard(s, {
    id: 101,
    name: "Oracle Tabs Probe",
    dbContent: "{{Oracle Probe Child|title:First}}\n{{Second Item|open}}",
  });
  await seedCard(s, {
    id: 102,
    name: "Oracle Tabs Plain Probe",
    dbContent: "{{Oracle Probe Child}}\n{{Second Item}}",
  });
  await seedCard(s, {
    id: 103,
    name: "Oracle Tabs Pointer Probe",
    typeId: 5,
    dbContent: "Oracle Probe Child\nSecond Item",
  });
  await seedCard(s, {
    id: 104,
    name: "Oracle Tabs Empty Probe",
    dbContent: "no nests here",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-tabs through the mod loader (A/B)", () => {
  it("WITHOUT the mod: every ported view raises UnsupportedViewError", async () => {
    const s = storage!;
    for (const view of ["tabs", "pills", "tabs_static", "pills_static"]) {
      await expect(s.engine.render("Oracle Tabs Probe", view)).rejects.toThrow(
        UnsupportedViewError,
      );
    }
  });

  it("WITH the mod: the load report lists the four views and the gem tree's two set modules", () => {
    loader = new ModLoader([{ manifest: cardModTabs }]);
    const report = loader.load();
    expect(report.registeredViews).toContain("tabs");
    expect(report.registeredViews).toContain("pills");
    expect(report.registeredViews).toContain("tabs_static");
    expect(report.registeredViews).toContain("pills_static");
    expect(report.registeredSetModules).toContain("All::Tabs");
    expect(report.registeredSetModules).toContain("Abstract::Tabs");
    // the abstract module registers passive - it contributes no view fns
    const basket = loader.setModules();
    expect(basket.base.map((m) => m.shortname)).toContain("All::Tabs");
    expect(basket.abstract.map((m) => m.shortname)).toContain("Abstract::Tabs");
  });

  it("WITH the mod: :tabs on the options probe renders the oracle bytes (set/all/tabs.rb:41-43 construct_tabs)", async () => {
    const s = storage!;
    await loader!.installInto(modEngineHost(s.engine, s.fetcher));
    const html = await s.engine.render("Oracle Tabs Probe", "tabs");
    // the byte pins worth calling out before the full-equality check:
    // - the explicit title option labels the tab through wrapped_title
    //   (card-mod-format set/all/title.rb:38-46) - "First", not the name
    expect(html).toContain('<span class="card-title" title="First">First</span>');
    // - the lazy data-url carries the chunk's nest_name/nest_syntax/title
    //   as Rails' SORTED nested to_param pairs (nest_name < nest_syntax <
    //   title), CGI-escaped (space -> "+", "|" -> %7C, ":" -> %3A)
    expect(html).toContain(
      'data-url="/Oracle_Probe_Child/content?slot%5Bnest_name%5D=Oracle+Probe+Child' +
        '&slot%5Bnest_syntax%5D=Oracle+Probe+Child%7Ctitle%3AFirst' +
        '&slot%5Btitle%5D=First"',
    );
    // - the second tab's explicit view replaces the voo's :content default
    expect(html).toContain('data-url="/Second_Item/open?slot%5Bnest_name%5D=Second+Item');
    // - the active anchor carries "active nav-link", the lazy one "load nav-link"
    expect(html).toContain('class="active nav-link"');
    expect(html).toContain('class="load nav-link"');
    // - the pane class interpolates the RAW item name (spaces included)
    expect(html).toContain('class="tab-pane tab-pane-Oracle Probe Child active"');
    // - the inactive pane is the empty LazyTab pane
    expect(html).toContain('class="tab-pane tab-pane-Second Item"></div>');
    expectOracleBytes(html, "Oracle Tabs Probe#tabs");
  });

  it("WITH the mod: :pills differs only in the nav class (set/all/tabs.rb:72-74)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Tabs Probe", "pills");
    expect(html).toContain("<ul class='nav nav-pills' role='tablist'>");
    expectOracleBytes(html, "Oracle Tabs Probe#pills");
  });

  it("WITH the mod: :tabs on plain nests defaults the item view to :content (construct_tabs :47)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Tabs Plain Probe", "tabs");
    // no explicit options -> data-urls carry just nest_name/nest_syntax
    expect(html).toContain(
      'data-url="/Oracle_Probe_Child/content?slot%5Bnest_name%5D=Oracle+Probe+Child' +
        '&slot%5Bnest_syntax%5D=Oracle+Probe+Child"',
    );
    expectOracleBytes(html, "Oracle Tabs Plain Probe#tabs");
  });

  it("WITH the mod: :tabs on a Pointer card routes through the Abstract::List override (01_list.rb:24-26)", async () => {
    const s = storage!;
    // the pointer's items are PLAIN db_content lines - not in the
    // nest-reference closure the prefetch walks - so the shared item is
    // warmed the way the engine's on-demand render path provides
    // (render.ts prepareItemForRender; "Second Item" stays unknown, as in
    // the oracle run).
    await s.engine.prepareItemForRender("Oracle Probe Child");
    const html = await s.engine.render("Oracle Tabs Pointer Probe", "tabs");
    // the item_names override yields EMPTY option hashes: the query is the
    // bare "?" (path.rb:84-87 query_opts {slot: {}} is non-empty but
    // to_param-s empty) and the data-slot carries no nest_syntax
    expect(html).toContain('data-url="/Oracle_Probe_Child/content?"');
    expect(html).toContain('data-url="/Second_Item/content?"');
    expect(html).not.toContain("slot%5B");
    expectOracleBytes(html, "Oracle Tabs Pointer Probe#tabs");
  });

  it("WITH the mod: the empty panel shape on nest-free cards (tab_panel.haml)", async () => {
    const s = storage!;
    const tabs = await s.engine.render("Oracle Tabs Empty Probe", "tabs");
    expectOracleBytes(tabs, "Oracle Tabs Empty Probe#tabs");
    const pills = await s.engine.render("Oracle Tabs Empty Probe", "pills");
    expectOracleBytes(pills, "Oracle Tabs Empty Probe#pills");
  });

  it("WITH the mod: :tabs_static and :pills_static carry Ruby's NoMethodError parity raise (all/tabs.rb:87)", async () => {
    const s = storage!;
    // stock decko 0.20.0 raises for every static render (no `args` method
    // on the format chain); the oracle captured CAPTURE_ERROR NoMethodError
    // for all four static probes. The port refuses to invent bytes Ruby
    // never produced.
    await expect(s.engine.render("Oracle Tabs Pointer Probe", "tabs_static")).rejects.toThrow(
      /undefined method 'args' for Card::Format::CardActionView/,
    );
    await expect(s.engine.render("Oracle Tabs Pointer Probe", "pills_static")).rejects.toThrow(
      /NoMethodError parity/,
    );
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Tabs Probe", "content");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
    expect(html).toContain("Oracle Probe Child");
  });
});
