

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ModLoader,
  cardModHelp,
  type DeckoModManifest,
  type ModSource,
} from "../../../src/card/mod-loader.js";
import { HTML_VIEWS } from "../../../src/card/render/views.js";
import type { ViewFn } from "../../../src/card/render/format.js";

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../fixtures/captured/help-mod-loader.json", import.meta.url)),
    "utf8",
  ),
) as {
  registered_views: Record<string, unknown>;
  setting_groups: Record<string, (string | null)[]>;
  setting_opts_help: Record<string, unknown>;
  setting_opts_guide: Record<string, unknown>;
  setting_preferences: string[];
};

const sentinel: ViewFn = () => "SENTINEL";

let liveLoader: ModLoader | undefined;

afterEach(() => {

  liveLoader?.reset();
  liveLoader = undefined;
});

function modWithView(name: string, view: string, fn: ViewFn): ModSource {
  return {
    manifest: {
      name,
      setModules: [
        { setPath: "all/thing", formats: { html: { views: [{ view, viewFn: fn }] } } },
      ],
    },
  };
}

describe("view registration into the live HTML_VIEWS record", () => {
  it("registers mod views where Ruby's define_method would (and unload restores)", () => {
    const before = "help" in HTML_VIEWS;
    expect(before).toBe(false);

    const loader = new ModLoader([{ manifest: cardModHelp }], HTML_VIEWS);
    liveLoader = loader;
    loader.load();
    expect(typeof HTML_VIEWS["help"]).toBe("function");
    expect(typeof HTML_VIEWS["help_text"]).toBe("function");
    expect(typeof HTML_VIEWS["lead"]).toBe("function");

    loader.reset();
    expect("help" in HTML_VIEWS).toBe(false);
    expect("help_text" in HTML_VIEWS).toBe(false);
    expect("lead" in HTML_VIEWS).toBe(false);
  });

  it("later mods override earlier views (module reopening) and reset restores exactly", () => {
    const customA: ViewFn = () => "A";
    const customB: ViewFn = () => "B";
    HTML_VIEWS["titled"] = sentinel;
    const loader = new ModLoader(
      [modWithView("first", "titled", customA), modWithView("second", "titled", customB)],
      HTML_VIEWS,
    );
    liveLoader = loader;
    loader.load();
    expect(HTML_VIEWS["titled"]).toBe(customB);
    loader.reset();
    expect(HTML_VIEWS["titled"]).toBe(sentinel);
    delete HTML_VIEWS["titled"];
  });

  it("is idempotent: double load keeps every table stable (boot-clean start)", () => {
    const loader = new ModLoader([{ manifest: cardModHelp }], { ...HTML_VIEWS });
    const first = loader.load();
    const firstEditing = (loader.settingsRegistry().groups.get("editing") ?? []).length;
    const second = loader.load();
    expect(second.registeredSetModules).toEqual(first.registeredSetModules);
    expect(second.registeredViews).toEqual(first.registeredViews);
    expect(second.registeredSettings).toEqual(first.registeredSettings);

    expect(loader.setModules().base.filter((m) => m.shortname === "All::Help")).toHaveLength(1);

    expect(loader.settingsRegistry().groups.get("editing") ?? []).toHaveLength(firstEditing);
    expect(loader.settingsRegistry().findByCodename("help")).toBeDefined();
  });

  it("reload() = reset + load (loader.rb:23-28 reload_sets)", () => {
    const loader = new ModLoader([{ manifest: cardModHelp }], { ...HTML_VIEWS });
    loader.load();
    loader.reload();
    expect(loader.isLoaded).toBe(true);
    expect(loader.setModules().base.map((m) => m.shortname)).toContain("All::Help");
  });
});

describe("the view-config table (_view_<x>__<setting>, view_opts.rb:59-64)", () => {
  it("mirrors the oracle's registered view configs for the help mod", () => {
    const loader = new ModLoader([{ manifest: cardModHelp }], { ...HTML_VIEWS });
    loader.load();

    expect(FIXTURE.registered_views["unknown_config_help"]).toBe(true);
    expect(loader.viewConfigFor("help")).toEqual({
      unknown: true,
      cache: "never",
      wrap: "slot",
    });
    expect(FIXTURE.registered_views["unknown_config_help_text"]).toBe(true);
    expect(loader.viewConfigFor("help_text")).toEqual({ unknown: true, cache: "never" });
    expect(FIXTURE.registered_views["unknown_config_lead"]).toBe(false);
    expect(loader.viewConfigFor("lead")).toBeUndefined();
  });

  it("later registrations replace earlier configs", () => {
    const loader = new ModLoader(
      [
        modWithView("one", "someview", () => ""),
        {
          manifest: {
            name: "two",
            setModules: [
              {
                setPath: "all/thing",
                formats: {
                  html: {
                    views: [{ view: "someview", viewFn: () => "", config: { unknown: true } }],
                  },
                },
              },
            ],
          },
        },
      ],
      { ...HTML_VIEWS },
    );
    loader.load();
    expect(loader.viewConfigFor("someview")).toEqual({ unknown: true });
  });
});

describe("the Card::Setting registry port (setting.rb)", () => {

  const listMod: DeckoModManifest = {
    name: "list",
    setModules: [
      {

        setPath: "self/content_option_view",
        settingOpts: {
          group: "editing",
          position: 6,
          ruleTypeEditable: false,
          helpText:
            "Label view for radio button and checkbox items.  [[http://decko.org/Pointer|more]]",
        },
      },
      {

        setPath: "self/content_options",
        settingOpts: {
          group: "editing",
          position: 5,
          ruleTypeEditable: true,
          helpText:
            "Value options for [[List]] and [[Pointer]] and cards. Can itself be a List or a [[Search]]. [[http://decko.org/Pointer|more]]",
        },
      },
    ],
  };
  const editMod: DeckoModManifest = {
    name: "edit",
    setModules: [
      {

        setPath: "self/input_type",
        settingOpts: {
          group: "editing",
          position: 3,
          ruleTypeEditable: false,
          shortHelpText: "edit interface",
        },
      },
    ],
  };

  it("reconstructs the oracle editing group array (nil holes included)", () => {

    const loader = new ModLoader(
      [{ manifest: listMod }, { manifest: cardModHelp }, { manifest: editMod }],
      { ...HTML_VIEWS },
    );
    const report = loader.load();
    const editing = loader.settingsRegistry().groups.get("editing") ?? [];
    expect(editing.map((entry) => (entry === null ? null : entry.codename))).toEqual(
      FIXTURE.setting_groups["editing"],
    );

    expect(report.registeredSettings).toEqual([
      "content_option_view",
      "content_options",
      "guide",
      "help",
      "input_type",
    ]);
  });

  it("stores help_text on BOTH the self and right sets (setting.rb:112-114)", () => {
    const loader = new ModLoader([{ manifest: cardModHelp }], { ...HTML_VIEWS });
    loader.load();
    const help = loader.settingsRegistry().findByCodename("help");
    expect(FIXTURE.setting_opts_help["raw_help_text"]).toBe(help?.rawHelpText);
    expect(FIXTURE.setting_opts_help["right_set_raw_help_text"]).toBe(
      help?.rightRawHelpText,
    );
    expect(help?.ruleTypeEditable).toBe(FIXTURE.setting_opts_help["rule_type_editable"]);
    expect(help?.shortHelpText).toBe(FIXTURE.setting_opts_help["short_help_text"]);
    const guide = loader.settingsRegistry().findByCodename("guide");
    expect(guide?.shortHelpText).toBe(FIXTURE.setting_opts_guide["short_help_text"]);
    expect(guide?.group).toBe(FIXTURE.setting_opts_guide["group"]);
  });

  it("tracks preferences (setting.rb:95-99; oracle: only follow)", () => {
    const loader = new ModLoader([{ manifest: cardModHelp }], { ...HTML_VIEWS });
    loader.load();
    expect(loader.settingsRegistry().preferenceIs("help")).toBe(false);
    expect(FIXTURE.setting_preferences).toEqual(["follow"]);
    const loader2 = new ModLoader(
      [
        {
          manifest: {
            name: "follow",
            setModules: [
              {
                setPath: "self/follow",
                settingOpts: { group: "other", preference: true },
              },
            ],
          },
        },
      ],
      { ...HTML_VIEWS },
    );
    loader2.load();
    expect(loader2.settingsRegistry().preferenceIs("follow")).toBe(true);
  });
});
