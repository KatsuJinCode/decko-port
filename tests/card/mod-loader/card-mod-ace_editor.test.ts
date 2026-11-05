// card-mod-ace_editor: registration-mechanics tests for the mod port.
//
// The gem has zero HTML views declared (mod-compat-report.json
// "htmlViewsDeclared": 0) so there is no view-registration surface to test.
// What exists is one Setting registration (set/self/ace.rb's raw_help_text
// body) and one set-only basket registration (set/all/ace_editor.rb's
// format :html helper-method block has no `view :x` calls).
//
// Each test pins a single Ruby-set-file line against its TS-port outcome.
// The Ruby source under test:
//   * set/self/ace.rb:1-7 (format :html do ... raw_help_text ... end)
//     - the body string stored as the Setting's help text on BOTH
//     Self and Right sets (lib/card/setting.rb:112-114).
//   * set/all/ace_editor.rb:1-2 (basket ops), 4-18 (format :html helper
//     methods, no views).

import { describe, it, expect, afterEach } from "vitest";
import { ModLoader } from "../../../src/card/mod-loader.js";
import cardModAceEditor from "../../../src/card/mod-loader/mods/card-mod-ace_editor.js";

let liveLoader: ModLoader | undefined;

afterEach(() => {
  // keep the registries clean between tests
  liveLoader?.reset();
  liveLoader = undefined;
});

describe("card-mod-ace_editor through the mod loader", () => {
  it("loads with no errors and registers exactly two set modules", () => {
    const loader = new ModLoader([{ manifest: cardModAceEditor }]);
    liveLoader = loader;
    const report = loader.load();
    expect(report.registeredSetModules).toEqual(
      expect.arrayContaining(["Self::Ace", "All::AceEditor"]),
    );
    expect(report.registeredSetModules).toHaveLength(2);
  });

  it("registers the *Ace setting with the raw_help_text body on BOTH Self and Right (setting.rb:112-114)", () => {
    // set/self/ace.rb:2-6: raw_help_text = "Configure [[https://ace.c9.io/|ace]], Decko's default code editor, using these available [[https://github.com/ajaxorg/ace/wiki/Configuring-Ace|options]]."
    // lib/card/setting.rb:112-114 stores the same help_text string on both
    // the Self set and the Right set; the registrar's RegisteredSetting
    // carries rawHelpText (Self half) + rightRawHelpText (Right half).
    const expectedHelp =
      "Configure [[https://ace.c9.io/|ace]], " +
      "Decko's default code editor, using these available " +
      "[[https://github.com/ajaxorg/ace/wiki/Configuring-Ace|options]].";

    const loader = new ModLoader([{ manifest: cardModAceEditor }]);
    liveLoader = loader;
    loader.load();

    const registry = loader.settingsRegistry();
    const ace = registry.findByCodename("ace");
    expect(ace).toBeDefined();
    expect(ace?.codename).toBe("ace");
    expect(ace?.rawHelpText).toBe(expectedHelp); // Self half
    expect(ace?.rightRawHelpText).toBe(expectedHelp); // Right half
  });

  it("places the *Ace setting in the 'other' group (no explicit group -> default)", () => {
    // set/self/ace.rb: no `setting_opts` call; the gem relies on
    // lib/card/setting.rb#register_setting's :other default for an
    // unconstrained setting. The TS ModSettingOpts defaults group to "other"
    // (mod-registrar.ts:143 SettingRegistry.register: group ?? "other").
    const loader = new ModLoader([{ manifest: cardModAceEditor }]);
    liveLoader = loader;
    loader.load();

    const registry = loader.settingsRegistry();
    const ace = registry.findByCodename("ace");
    expect(ace?.group).toBe("other");
  });

  it("reports no registered views (the mod declares zero HTML views)", () => {
    // Compat-report verdict: htmlViewsDeclared = 0; the format :html do
    // block in set/all/ace_editor.rb defines helper METHODS, not view
    // :x declarations, so the registration path passes an empty views
    // array through formats.html.views. The load report's registeredViews
    // is therefore empty.
    const loader = new ModLoader([{ manifest: cardModAceEditor }]);
    liveLoader = loader;
    const report = loader.load();
    expect(report.registeredViews).toEqual([]);
  });

  it("records the All::AceEditor set module in the basket (mod/registrar.rb:16-29)", () => {
    // set/all/ace_editor.rb: a set module file - enters the basket even
    // when its format :html block declares no views (basket tracks
    // set_modules regardless of format contents).
    const loader = new ModLoader([{ manifest: cardModAceEditor }]);
    liveLoader = loader;
    loader.load();

    const basket = loader.setModules();
    expect(basket.base.map((m) => m.shortname)).toContain("All::AceEditor");
    expect(basket.base.find((m) => m.shortname === "All::AceEditor")?.modName).toBe("ace_editor");
  });

  it("records the Self::Ace set module in the basket", () => {
    const loader = new ModLoader([{ manifest: cardModAceEditor }]);
    liveLoader = loader;
    loader.load();

    const basket = loader.setModules();
    expect(basket.nonbase.get("Self::Ace")?.map((m) => m.modName)).toEqual(
      expect.arrayContaining(["ace_editor"]),
    );
  });

  it("report's registered settings list includes 'ace' (derived from the self/ace anchor)", () => {
    // mod-loader.ts:208-214: the codename comes from the set anchor
    // (Self::Ace -> "ace", lib/card/setting.rb:96). The registeredSettings
    // list carries the codename as the loader saw it.
    const loader = new ModLoader([{ manifest: cardModAceEditor }]);
    liveLoader = loader;
    const report = loader.load();
    expect(report.registeredSettings).toEqual(expect.arrayContaining(["ace"]));
  });

  it("loader.reset() clears the setting registration (settings registry returns to clean slate)", () => {
    const loader = new ModLoader([{ manifest: cardModAceEditor }]);
    loader.load();
    const before = loader.settingsRegistry().findByCodename("ace");
    expect(before).toBeDefined();

    loader.reset();
    liveLoader = loader;
    const after = loader.settingsRegistry().findByCodename("ace");
    expect(after).toBeUndefined();
  });

  it("loader.reset() empties the set-module basket", () => {
    const loader = new ModLoader([{ manifest: cardModAceEditor }]);
    loader.load();
    expect(loader.setModules().base.length).toBeGreaterThan(0);

    loader.reset();
    liveLoader = loader;
    expect(loader.setModules().base).toEqual([]);
    expect(loader.setModules().nonbase.size).toBe(0);
  });

  it("does NOT register a setting called 'ace_editor' (only the set/all/ace_editor.rb file's basket ops are no-views; the file has no setting_opts)", () => {
    // set/all/ace_editor.rb is a base-pattern set file with no
    // setting_opts block - it CANNOT register a setting under the loader's
    // ModSettingOpts registration path. The corresponding rubric codename
    // would be "ace_editor" but the loader must report no such entry.
    const loader = new ModLoader([{ manifest: cardModAceEditor }]);
    liveLoader = loader;
    loader.load();
    const registry = loader.settingsRegistry();
    expect(registry.findByCodename("ace_editor")).toBeUndefined();
    expect(registry.findByCodename("ace")).toBeDefined();
  });
});
