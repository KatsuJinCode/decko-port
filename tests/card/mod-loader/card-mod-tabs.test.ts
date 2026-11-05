

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

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 5, name: "Pointer", codename: "pointer" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });

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

    const basket = loader.setModules();
    expect(basket.base.map((m) => m.shortname)).toContain("All::Tabs");
    expect(basket.abstract.map((m) => m.shortname)).toContain("Abstract::Tabs");
  });

  it("WITH the mod: :tabs on the options probe renders the oracle bytes (set/all/tabs.rb:41-43 construct_tabs)", async () => {
    const s = storage!;
    await loader!.installInto(modEngineHost(s.engine, s.fetcher));
    const html = await s.engine.render("Oracle Tabs Probe", "tabs");

    expect(html).toContain('<span class="card-title" title="First">First</span>');

    expect(html).toContain(
      'data-url="/Oracle_Probe_Child/content?slot%5Bnest_name%5D=Oracle+Probe+Child' +
        '&slot%5Bnest_syntax%5D=Oracle+Probe+Child%7Ctitle%3AFirst' +
        '&slot%5Btitle%5D=First"',
    );

    expect(html).toContain('data-url="/Second_Item/open?slot%5Bnest_name%5D=Second+Item');

    expect(html).toContain('class="active nav-link"');
    expect(html).toContain('class="load nav-link"');

    expect(html).toContain('class="tab-pane tab-pane-Oracle Probe Child active"');

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

    expect(html).toContain(
      'data-url="/Oracle_Probe_Child/content?slot%5Bnest_name%5D=Oracle+Probe+Child' +
        '&slot%5Bnest_syntax%5D=Oracle+Probe+Child"',
    );
    expectOracleBytes(html, "Oracle Tabs Plain Probe#tabs");
  });

  it("WITH the mod: :tabs on a Pointer card routes through the Abstract::List override (01_list.rb:24-26)", async () => {
    const s = storage!;

    await s.engine.prepareItemForRender("Oracle Probe Child");
    const html = await s.engine.render("Oracle Tabs Pointer Probe", "tabs");

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
