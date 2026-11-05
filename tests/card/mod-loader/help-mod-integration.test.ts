

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

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../fixtures/captured/help-mod-loader.json", import.meta.url)),
    "utf8",
  ),
) as {
  rendered: Record<string, string>;
  setting_opts_help: Record<string, unknown>;
  setting_opts_guide: Record<string, unknown>;
};

function normalize(html: string): string {
  return html
    .replace(/data-slot-id=(["'])[0-9a-fA-F]+\1/g, 'data-slot-id="RANDOMIZED"')
    .replace(/data-card-id=(["'])\d+\1/g, 'data-card-id="RANDOMIZED"');
}

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

  await seedCard(s, { id: 1169, name: "Oracle Help Probe", dbContent: "probe card body" });
  await seedCard(s, { id: 1170, name: "Oracle Bare Probe", dbContent: "bare probe body" });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-help through the mod loader (A/B)", () => {
  it("WITHOUT the mod: :help is unsupported and :lead/:help_text do not exist", async () => {
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
  });

  it("WITHOUT the mod: baseline :content already matches the oracle bytes", async () => {
    const s = storage!;
    const html = normalize(await s.engine.render("Oracle Help Probe", "content"));
    expect(html).toBe(FIXTURE.rendered["Oracle Help Probe#content"]);
    const bare = normalize(await s.engine.render("Oracle Bare Probe", "content"));
    expect(bare).toBe(FIXTURE.rendered["Oracle Bare Probe#content"]);
  });

  it("WITH the mod: :help renders the oracle bytes (rule text + edit link, slot-wrapped)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModHelp }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const html = normalize(await s.engine.render("Oracle Help Probe", "help"));
    expect(html).toBe(FIXTURE.rendered["Oracle Help Probe#help"]);
  });

  it("WITH the mod: :help_text renders bare (oracle bytes)", async () => {
    const s = storage!;
    const html = normalize(await s.engine.render("Oracle Help Probe", "help_text"));
    expect(html).toBe(FIXTURE.rendered["Oracle Help Probe#help_text"]);
  });

  it("WITH the mod: a rule-less card's :help is the EMPTY slot wrap (wrap: :slot)", async () => {
    const s = storage!;
    const html = normalize(await s.engine.render("Oracle Bare Probe", "help"));
    expect(html).toBe(FIXTURE.rendered["Oracle Bare Probe#help"]);
    const helpText = await s.engine.render("Oracle Bare Probe", "help_text");
    expect(helpText).toBe(FIXTURE.rendered["Oracle Bare Probe#help_text"]);
  });

  it("WITH the mod: :lead renders the content bytes under the lead slot (oracle bytes)", async () => {
    const s = storage!;
    for (const name of ["Oracle Help Probe", "Oracle Bare Probe"]) {
      const html = normalize(await s.engine.render(name, "lead"));
      expect(html).toBe(FIXTURE.rendered[`${name}#lead`]);
    }
  });

  it("WITH the mod: baseline :content is UNCHANGED (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = normalize(await s.engine.render("Oracle Help Probe", "content"));
    expect(html).toBe(FIXTURE.rendered["Oracle Help Probe#content"]);
  });

  it("the setting_opts registrations match the oracle's Card::Setting state", () => {
    const registry = loader!.settingsRegistry();
    const help = registry.findByCodename("help");
    expect(help?.group).toBe(FIXTURE.setting_opts_help["group"]);
    expect(help?.ruleTypeEditable).toBe(FIXTURE.setting_opts_help["rule_type_editable"]);
    expect(help?.shortHelpText).toBe(FIXTURE.setting_opts_help["short_help_text"]);
    expect(help?.rawHelpText).toBe(FIXTURE.setting_opts_help["raw_help_text"]);
    const guide = registry.findByCodename("guide");
    expect(guide?.group).toBe(FIXTURE.setting_opts_guide["group"]);
    expect(guide?.shortHelpText).toBe(FIXTURE.setting_opts_guide["short_help_text"]);
  });
});
