

import { describe, it, expect, afterEach } from "vitest";
import { ModLoader } from "../../../src/card/mod-loader.js";
import cardModAceEditor from "../../../src/card/mod-loader/mods/card-mod-ace_editor.js";

let liveLoader: ModLoader | undefined;

afterEach(() => {

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
    expect(ace?.rawHelpText).toBe(expectedHelp);
    expect(ace?.rightRawHelpText).toBe(expectedHelp);
  });

  it("places the *Ace setting in the 'other' group (no explicit group -> default)", () => {

    const loader = new ModLoader([{ manifest: cardModAceEditor }]);
    liveLoader = loader;
    loader.load();

    const registry = loader.settingsRegistry();
    const ace = registry.findByCodename("ace");
    expect(ace?.group).toBe("other");
  });

  it("reports no registered views (the mod declares zero HTML views)", () => {

    const loader = new ModLoader([{ manifest: cardModAceEditor }]);
    liveLoader = loader;
    const report = loader.load();
    expect(report.registeredViews).toEqual([]);
  });

  it("records the All::AceEditor set module in the basket (mod/registrar.rb:16-29)", () => {

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

    const loader = new ModLoader([{ manifest: cardModAceEditor }]);
    liveLoader = loader;
    loader.load();
    const registry = loader.settingsRegistry();
    expect(registry.findByCodename("ace_editor")).toBeUndefined();
    expect(registry.findByCodename("ace")).toBeDefined();
  });
});
