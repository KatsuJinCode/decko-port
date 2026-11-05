

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
  cardModHelp,
  modEngineHost,
} from "../../../src/card/mod-loader.js";

const POPOVER_FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../fixtures/captured/help-popover.json", import.meta.url)),
    "utf8",
  ),
) as { rendered: Record<string, string> };

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 12, name: "*help", codename: "help", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

  await seedCard(s, { id: 20, leftId: 1169, rightId: 11, typeId: 13 });

  await seedCard(s, {
    id: 21,
    leftId: 20,
    rightId: 12,
    typeId: 14,
    dbContent: "Moderator-approved help text for the probe card.",
  });

  await seedCard(s, { id: 15, name: "*guide", codename: "guide", typeId: 14 });

  await seedCard(s, {
    id: 22,
    leftId: 20,
    rightId: 15,
    typeId: 14,
    dbContent: "Editing guidance rule text for the probe card.",
  });

  await seedCard(s, {
    id: 1169,
    name: "Oracle Help Probe",
    dbContent: "probe card body",
  });
  await seedCard(s, {
    id: 1170,
    name: "Oracle Bare Probe",
    dbContent: "bare probe body",
  });

  await seedCard(s, {
    id: 2200,
    name: "Oracle Help Popover Probe",
    dbContent: "popover probe card body",
  });
  await seedCard(s, {
    id: 2201,
    name: "Oracle Bare Popover Probe",
    dbContent: "bare popover probe body",
  });

  await seedCard(s, { id: 2210, leftId: 2200, rightId: 11, typeId: 13 });

  await seedCard(s, {
    id: 2211,
    leftId: 2210,
    rightId: 12,
    typeId: 14,
    dbContent: "Moderator-approved help text for the popover probe card.",
  });

  await seedCard(s, {
    id: 2220,
    leftId: 2200,
    rightId: 12,
    typeId: 14,
    dbContent: "popover probe card body",
  });
  await seedCard(s, {
    id: 2221,
    leftId: 2201,
    rightId: 12,
    typeId: 14,
    dbContent: "bare popover probe body",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-help through the mod loader (A/B)", () => {
  it("WITHOUT the mod: every ported view raises UnsupportedViewError", async () => {
    const s = storage!;
    await expect(s.engine.render("Oracle Help Probe", "help")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Help Probe", "help_text")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Bare Probe", "lead")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Help Probe", "guide")).rejects.toThrow(
      UnsupportedViewError,
    );

    await expect(s.engine.render("Oracle Help Probe", "popover")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: :help on a ruled card wraps the help text in <div class='help-text'> (set/all/help.rb:7-12)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModHelp }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const html = await s.engine.render("Oracle Help Probe", "help");

    expect(html).toContain("class=\"help-text\"");
    expect(html).toContain("Moderator-approved help text for the probe card.");

    expect(html).toContain("class='d-none'");
    expect(html).toContain("rule_edit");
  });

  it("WITH the mod: :help_text on a ruled card returns the bare help text (set/all/help.rb:14-16)", async () => {
    const s = storage!;

    const text = await s.engine.render("Oracle Help Probe", "help_text");
    expect(text).toContain("Moderator-approved help text for the probe card.");

    expect(text).toContain("class='d-none'");

    expect(text).not.toContain("help_text-view");
  });

  it("WITH the mod: :help on a rule-less card renders the EMPTY slot wrap (help.rb:9-11 + wrap: :slot)", async () => {
    const s = storage!;

    const html = await s.engine.render("Oracle Bare Probe", "help");
    expect(html).toContain("card-slot");
    expect(html).toContain("help-view");

    expect(html).not.toContain("class=\"help-text\"");
  });

  it("WITH the mod: :help_text on a rule-less card returns the empty string (help.rb:14-16, no rule text to wrap)", async () => {
    const s = storage!;
    const text = await s.engine.render("Oracle Bare Probe", "help_text");
    expect(text).toBe("");
  });

  it("WITH the mod: :lead adds the 'lead' class to the slot and renders the core content (set/all/help.rb:27-30)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Help Probe", "lead");

    expect(html).toContain("card-slot");
    expect(html).toContain("lead-view");
    expect(html).toMatch(/class="[^"]*lead/);

    expect(html).toContain("probe card body");
  });

  it("WITH the mod: :guide on a ruled card wraps the guide text in <div class='guide-text'> (set/all/guide.rb:6-16)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Help Probe", "guide");

    expect(html).toContain("card-slot");
    expect(html).toContain("guide-view");
    expect(html).toContain("class=\"guide-text\"");
    expect(html).toContain("Editing guidance rule text for the probe card.");

    expect(html).toContain("class='d-none'");
  });

  it("WITH the mod: :guide on a rule-less card renders the EMPTY slot wrap (guide.rb:9-11 + wrap: :slot)", async () => {
    const s = storage!;

    const html = await s.engine.render("Oracle Bare Probe", "guide");
    expect(html).toContain("card-slot");
    expect(html).toContain("guide-view");

    expect(html).not.toContain("class=\"guide-text\"");
  });

  it("WITH the mod: :popover wraps the :core text inside the card-mod-bootstrap popover_link anchor (set/right/help.rb:4-6)", async () => {
    const s = storage!;

    const withRule = await s.engine.render(
      "Oracle Help Popover Probe+*help",
      "popover",
    );
    expect(withRule).toBe(
      POPOVER_FIXTURE.rendered["Oracle Help Popover Probe+*help#popover"],
    );
    const bareProbe = await s.engine.render(
      "Oracle Bare Popover Probe+*help",
      "popover",
    );
    expect(bareProbe).toBe(
      POPOVER_FIXTURE.rendered["Oracle Bare Popover Probe+*help#popover"],
    );
  });

  it("WITH the mod: :popover on a SIMPLE probe still resolves through the registered helper (TS does not enforce compound_only)", async () => {
    const s = storage!;

    const html = await s.engine.render("Oracle Help Probe", "popover");
    expect(html).toContain('href="#"');
    expect(html).toContain('class="ps-1 _popover_link"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-bs-toggle="popover"');
    expect(html).toContain('data-bs-trigger="hover focus"');
    expect(html).toContain("probe card body");
    expect(html).toMatch(/data-bs-content="[^"]*probe card body/);
    expect(html).toContain(
      '<i class="notranslate material-icons">help</i>',
    );
  });

  it("WITH the mod: every ported set module from the gem tree is in the basket", () => {
    const basket = loader!.setModules();

    const baseShortnames = basket.base.map((m) => m.shortname);
    expect(baseShortnames).toContain("All::Help");
    expect(baseShortnames).toContain("All::Guide");

    const nonbaseShortnames = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(nonbaseShortnames).toContain("Self::Help");
    expect(nonbaseShortnames).toContain("Self::Guide");
    expect(nonbaseShortnames).toContain("Right::Help");
  });

  it("WITH the mod: the mod loader's load report lists every ported view", () => {

    const report = loader!.load();
    expect(report.registeredViews).toContain("help");
    expect(report.registeredViews).toContain("help_text");
    expect(report.registeredViews).toContain("lead");
    expect(report.registeredViews).toContain("guide");

    expect(report.registeredViews).toContain("popover");
  });

  it("WITH the mod: the setting_opts registrations match the gem's Card::Setting state", () => {
    const registry = loader!.settingsRegistry();

    const help = registry.findByCodename("help");
    expect(help?.group).toBe("editing");
    expect(help?.ruleTypeEditable).toBe(true);
    expect(help?.shortHelpText).toBe("help text people will see when editing");
    expect(help?.rawHelpText).toBe(
      "[[http://decko.org/custom_help_text|Help text]] people will see when editing.",
    );
    expect(help?.rightRawHelpText).toBe(
      "[[http://decko.org/custom_help_text|Help text]] people will see when editing.",
    );

    const guide = registry.findByCodename("guide");
    expect(guide?.group).toBe("editing");
    expect(guide?.ruleTypeEditable).toBe(true);
    expect(guide?.shortHelpText).toBe(
      "appears in the full editor view to guide users",
    );
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Help Probe", "content");

    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
    expect(html).toContain("probe card body");
  });
});