

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
import cardModList from "../../../src/card/mod-loader/mods/card-mod-list.js";

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../fixtures/captured/list-mod-loader.json", import.meta.url)),
    "utf8",
  ),
) as {
  rendered: Record<string, string>;
  setting_groups: Record<string, (string | null)[]>;
  setting_opts_content_options: Record<string, unknown>;
  setting_opts_content_option_view: Record<string, unknown>;
  probe_format_configs: Record<string, boolean>;
};

function normalize(html: string): string {
  return html
    .replace(/data-slot-id=(["'])[0-9a-fA-F]+\1/g, 'data-slot-id="RANDOMIZED"')
    .replace(/data-card-id=(["'])\d+\1/g, 'data-card-id="RANDOMIZED"');
}

function captureError(view: string, name: string): string {
  return `view (${view}) not supported for ${name}`;
}

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 12, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });
  await seedCard(s, { id: 15, name: "*input_type", codename: "input_type", typeId: 14 });
  await seedCard(s, { id: 16, name: "*content_options", codename: "content_options", typeId: 14 });
  await seedCard(s, { id: 17, name: "by name", codename: "by_name", typeId: 2 });

  await seedCard(s, { id: 4, name: "List", codename: "list", typeId: 2 });
  await seedCard(s, { id: 56, name: "Pointer", codename: "pointer", typeId: 2 });
  await seedCard(s, { id: 57, name: "Nest list", codename: "nest_list", typeId: 2 });
  await seedCard(s, { id: 58, name: "Link list", codename: "link_list", typeId: 2 });

  await seedCard(s, { id: 100, name: "Oracle Probe Child", dbContent: "probe item body" });

  await seedCard(s, {
    id: 101,
    name: "Oracle List Probe",
    typeId: 4,
    dbContent: "Oracle Probe Child\nOracle Probe Wanted",
  });
  await seedCard(s, {
    id: 102,
    name: "Oracle Pointer Probe",
    typeId: 56,
    dbContent: "Oracle Probe Child\nSecond Item",
  });
  await seedCard(s, {
    id: 103,
    name: "Oracle Radio Probe",
    typeId: 56,
    dbContent: "Option One",
  });
  await seedCard(s, {
    id: 104,
    name: "Oracle Nest List Probe",
    typeId: 57,
    dbContent: "{{Oracle Probe Child|title:nested title}}\n{{Second Item}}",
  });
  await seedCard(s, {
    id: 105,
    name: "Oracle Link List Probe",
    typeId: 58,
    dbContent: "[[Oracle Probe Child|link title]]\n[[Second Item]]",
  });

  await seedCard(s, { id: 110, leftId: 103, rightId: 12, typeId: 13 });
  await seedCard(s, {
    id: 111,
    leftId: 110,
    rightId: 15,
    typeId: 14,
    dbContent: "radio",
  });
  await seedCard(s, {
    id: 112,
    leftId: 110,
    rightId: 16,
    typeId: 4,
    dbContent: "Option One\nOption Two",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-list through the mod loader (A/B)", () => {
  it("WITHOUT the mod: the pointer editor views are unsupported", async () => {
    const s = storage!;
    for (const view of ["list", "input", "one_line_content"]) {
      await expect(s.engine.render("Oracle List Probe", view)).rejects.toThrow(
        UnsupportedViewError,
      );
    }
    await expect(
      s.engine.render("Oracle Nest List Probe", "nest_list_input"),
    ).rejects.toThrow(UnsupportedViewError);
  });

  it("WITHOUT the mod -> WITH the mod: :content bytes are UNCHANGED (the mod adds views, it does not alter core)", async () => {
    const s = storage!;

    const before = normalize(await s.engine.render("Oracle List Probe", "content"));
    loader = new ModLoader([{ manifest: cardModList }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));
    const after = normalize(await s.engine.render("Oracle List Probe", "content"));
    expect(after).toBe(before);
  });

  it("WITH the mod: the loader report carries the gem's file structure", () => {
    const report = loader!.load();
    expect(report.modNames).toEqual(["list"]);
    expect(report.registeredViews).toEqual([
      "one_line_content",
      "list",
      "input",
      "nest_list_input",
    ]);

    expect(report.registeredSetModules).toHaveLength(18);
    expect(report.registeredSetModules.filter((m) => m.startsWith("Abstract::List"))).toEqual([
      "Abstract::List",
      "Abstract::List::Events",
      "Abstract::List::HtmlViews",
      "Abstract::List::OtherViews",
    ]);
    expect(report.registeredSettings).toEqual(["content_option_view", "content_options"]);
  });

  it("WITH the mod: event declarations pin all five gem events (the two :validate-stage events adopted this batch)", () => {

    const report = loader!.load();
    expect(report.registeredEvents).toEqual([
      "add_and_drop_items",
      "insert_item_event",
      "validate_item_type",
      "validate_item_uniqueness",
      "delist",
    ]);

    const events = loader!.eventRegistry();
    expect(events.size()).toBe(5);

    expect(events.all().map((e) => `${e.modName}:${e.event}@${e.setPath}`)).toEqual([
      "list:add_and_drop_items@abstract/01_list/events",
      "list:insert_item_event@abstract/01_list/events",
      "list:validate_item_type@abstract/01_list/events",
      "list:validate_item_uniqueness@abstract/01_list/events",
      "list:delist@abstract/delist",
    ]);

    expect(
      events.forStage("prepare_to_validate").map((e) => e.event),
    ).toEqual(["add_and_drop_items", "insert_item_event"]);
    expect(events.forStage("validate").map((e) => e.event)).toEqual([
      "validate_item_type",
      "validate_item_uniqueness",
    ]);
    expect(events.forStage("prepare_to_store").map((e) => e.event)).toEqual([
      "delist",
    ]);

    expect(events.forStage("integrate")).toEqual([]);
    expect(events.forStage("store")).toEqual([]);
    expect(events.forStage("finalize")).toEqual([]);

    const addDrop = events.forEvent("add_and_drop_items");
    expect(addDrop?.setPath).toBe("abstract/01_list/events");
    expect(addDrop?.modName).toBe("list");
    expect(addDrop?.at).toBe("prepare_to_validate");
    expect(addDrop?.on).toEqual(["save"]);
    expect(addDrop?.when).toBeUndefined();

    const insert = events.forEvent("insert_item_event");
    expect(insert?.at).toBe("prepare_to_validate");
    expect(insert?.on).toEqual(["save"]);
    expect(insert?.when).toBe("item_to_insert");

    const validateItem = events.forEvent("validate_item_type");
    expect(validateItem?.setPath).toBe("abstract/01_list/events");
    expect(validateItem?.modName).toBe("list");
    expect(validateItem?.at).toBe("validate");
    expect(validateItem?.on).toEqual(["save"]);
    expect(validateItem?.when).toBe("validate_item_type?");

    const validateUnique = events.forEvent("validate_item_uniqueness");
    expect(validateUnique?.setPath).toBe("abstract/01_list/events");
    expect(validateUnique?.modName).toBe("list");
    expect(validateUnique?.at).toBe("validate");
    expect(validateUnique?.on).toEqual(["save"]);
    expect(validateUnique?.when).toBe("unique_items?");

    const delist = events.forEvent("delist");
    expect(delist?.setPath).toBe("abstract/delist");
    expect(delist?.at).toBe("prepare_to_store");
    expect(delist?.on).toEqual(["delete"]);
  });

  it("WITH the mod: the view-config registry matches the live _view_*__setting probe", () => {

    expect(FIXTURE.probe_format_configs["_view_input__unknown"]).toBe(true);
    expect(FIXTURE.probe_format_configs["_view_input__cache"]).toBe(true);
    expect(FIXTURE.probe_format_configs["_view_one_line_content__unknown"]).toBe(true);
    expect(FIXTURE.probe_format_configs["_view_one_line_content__wrap"]).toBe(true);
    expect(loader!.viewConfigFor("input")).toEqual({ unknown: true, cache: "never" });
    expect(loader!.viewConfigFor("one_line_content")).toEqual({ unknown: "mini_unknown" });
    expect(loader!.viewConfigFor("list")).toEqual({ cache: "never" });
    expect(loader!.viewConfigFor("nest_list_input")).toEqual({ cache: "never" });
    expect(loader!.viewConfigFor("view_list")).toBeUndefined();
  });

  it("WITH the mod: :one_line_content renders the oracle bytes (known + wanted items)", async () => {
    const s = storage!;
    const html = normalize(await s.engine.render("Oracle List Probe", "one_line_content"));
    expect(html).toBe(FIXTURE.rendered["Oracle List Probe#one_line_content"]);
    const pointer = normalize(
      await s.engine.render("Oracle Pointer Probe", "one_line_content"),
    );
    expect(pointer).toBe(FIXTURE.rendered["Oracle Pointer Probe#one_line_content"]);
  });

  it("WITH the mod: :list renders the pointer list editor (oracle bytes)", async () => {
    const s = storage!;
    const html = normalize(await s.engine.render("Oracle List Probe", "list"));
    expect(html).toBe(FIXTURE.rendered["Oracle List Probe#list"]);
    const pointer = normalize(await s.engine.render("Oracle Pointer Probe", "list"));
    expect(pointer).toBe(FIXTURE.rendered["Oracle Pointer Probe#list"]);
  });

  it("WITH the mod: :input is the hidden content field + the list editor (oracle bytes)", async () => {
    const s = storage!;
    const html = normalize(await s.engine.render("Oracle List Probe", "input"));
    expect(html).toBe(FIXTURE.rendered["Oracle List Probe#input"]);
    const pointer = normalize(await s.engine.render("Oracle Pointer Probe", "input"));
    expect(pointer).toBe(FIXTURE.rendered["Oracle Pointer Probe#input"]);
  });

  it("WITH the mod: :input dispatches the radio editor off the *input_type rule (oracle bytes)", async () => {
    const s = storage!;
    const html = normalize(await s.engine.render("Oracle Radio Probe", "input"));
    expect(html).toBe(FIXTURE.rendered["Oracle Radio Probe#input"]);

  });

  it("WITH the mod: :nest_list_input renders the nest editor (oracle bytes)", async () => {
    const s = storage!;
    const html = normalize(await s.engine.render("Oracle Nest List Probe", "nest_list_input"));
    expect(html).toBe(FIXTURE.rendered["Oracle Nest List Probe#nest_list_input"]);
  });

  it("WITH the mod: :input on the type-specific lists renders their editors (oracle bytes)", async () => {
    const s = storage!;
    const nest = normalize(await s.engine.render("Oracle Nest List Probe", "input"));
    expect(nest).toBe(FIXTURE.rendered["Oracle Nest List Probe#input"]);
    const link = normalize(await s.engine.render("Oracle Link List Probe", "input"));
    expect(link).toBe(FIXTURE.rendered["Oracle Link List Probe#input"]);
  });

  it("WITH the mod: set-scoped dispatch - :list is unsupported on the sibling list types (oracle error bytes)", async () => {
    const s = storage!;

    await expect(s.engine.render("Oracle Link List Probe", "list")).rejects.toThrow(
      captureError("list", "Oracle Link List Probe"),
    );
    await expect(s.engine.render("Oracle Nest List Probe", "list")).rejects.toThrow(
      captureError("list", "Oracle Nest List Probe"),
    );

    await expect(s.engine.render("Oracle List Probe", "nest_list_input")).rejects.toThrow(
      captureError("nest_list_input", "Oracle List Probe"),
    );

    await expect(s.engine.render("Oracle List Probe", "view_list")).rejects.toThrow(
      captureError("view_list", "Oracle List Probe"),
    );
  });

  it("WITH the mod: non-family cards fail loudly for the unported base-format views", async () => {
    const s = storage!;

    await expect(s.engine.render("Oracle Probe Child", "one_line_content")).rejects.toThrow(
      /base-format view \(card-mod-format\/card-mod-edit\) is not ported/,
    );
    await expect(s.engine.render("Oracle Probe Child", "input")).rejects.toThrow(
      /base-format view \(card-mod-format\/card-mod-edit\) is not ported/,
    );
  });

  it("WITH the mod: the setting_opts registrations match the oracle's Card::Setting state", () => {
    const registry = loader!.settingsRegistry();

    expect(
      registry.groups.get("editing")?.map((entry) => entry?.codename ?? null),
    ).toEqual([null, null, null, null, "content_options", "content_option_view"]);
    expect(FIXTURE.setting_groups["editing"]?.slice(5, 7)).toEqual([
      "content_options",
      "content_option_view",
    ]);

    const options = registry.findByCodename("content_options");
    expect(options?.group).toBe(FIXTURE.setting_opts_content_options["group"]);
    expect(options?.ruleTypeEditable).toBe(
      FIXTURE.setting_opts_content_options["rule_type_editable"],
    );
    expect(options?.rawHelpText).toBe(FIXTURE.setting_opts_content_options["raw_help_text"]);

    expect(options?.restrictedToType).toEqual(["list", "pointer", "session"]);

    const optionView = registry.findByCodename("content_option_view");
    expect(optionView?.group).toBe(FIXTURE.setting_opts_content_option_view["group"]);
    expect(optionView?.ruleTypeEditable).toBe(
      FIXTURE.setting_opts_content_option_view["rule_type_editable"],
    );
    expect(optionView?.rawHelpText).toBe(
      FIXTURE.setting_opts_content_option_view["raw_help_text"],
    );
    expect(optionView?.restrictedToType).toEqual(["list", "pointer", "session"]);
  });
});
