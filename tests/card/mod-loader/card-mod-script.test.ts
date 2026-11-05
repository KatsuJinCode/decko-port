

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { UnsupportedViewError } from "../../../src/card/render/format.js";
import type { ViewFn } from "../../../src/card/render/format.js";
import { ModLoader, modEngineHost } from "../../../src/card/mod-loader.js";
import cardModScript from "../../../src/card/mod-loader/mods/card-mod-script.js";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

const stylesheetPathSeam: ViewFn = (ctx) => {
  const outputCard = ctx.fmt.engine.fetchRenderCard(
    `${ctx.fmt.card.name.s}+*asset output`,
  );
  const content = outputCard?.dbContent ?? "";
  expect(content).not.toBe("");
  return `/files/${content}`;
};

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 40, name: "Set", codename: "set", typeId: 40 });
  await seedCard(s, { id: 41, name: "Setting", codename: "setting", typeId: 41 });
  await seedCard(s, { id: 42, name: "Mod", codename: "mod", typeId: 42 });
  await seedCard(s, { id: 43, name: "List", codename: "list", typeId: 43 });
  await seedCard(s, { id: 44, name: "JavaScript", codename: "java_script", typeId: 44 });
  await seedCard(s, { id: 45, name: "CoffeeScript", codename: "coffee_script", typeId: 45 });

  await seedCard(s, { id: 50, name: "*script", codename: "script", typeId: 41 });
  await seedCard(s, { id: 51, name: "*style", codename: "style", typeId: 41 });
  await seedCard(s, { id: 52, name: "*asset output", codename: "asset_output", typeId: 41 });
  await seedCard(s, { id: 53, name: "*group remote", codename: "group_remote", typeId: 41 });

  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 40 });

  await seedCard(s, {
    id: 306,
    leftId: 10,
    rightId: 50,
    typeId: 43,
    dbContent:
      "mod: format+*script\nmod: ace editor+*script\nmod: bootstrap+*script",
  });
  await seedCard(s, {
    id: 307,
    leftId: 306,
    rightId: 52,
    typeId: 43,
    dbContent: "~307test/1790061390.js",
  });

  await seedCard(s, { id: 446, leftId: 10, rightId: 51, typeId: 43, dbContent: "" });
  await seedCard(s, {
    id: 447,
    leftId: 446,
    rightId: 52,
    typeId: 43,
    dbContent: "~447test/1790061390.css",
  });

  await seedCard(s, { id: 539, name: "mod: format", typeId: 42 });
  await seedCard(s, { id: 540, leftId: 539, rightId: 50, typeId: 43, dbContent: "" });
  await seedCard(s, {
    id: 541,
    leftId: 539,
    rightId: 53,
    typeId: 43,
    dbContent:
      "https://code.jquery.com/jquery-3.5.1.min.js\nhttps://cdnjs.cloudflare.com/ajax/libs/jquery-ujs/1.2.3/rails.min.js",
  });
  await seedCard(s, { id: 542, name: "mod: ace editor", typeId: 42 });
  await seedCard(s, { id: 543, leftId: 542, rightId: 50, typeId: 43, dbContent: "" });
  await seedCard(s, {
    id: 544,
    leftId: 542,
    rightId: 53,
    typeId: 43,
    dbContent: "https://cdnjs.cloudflare.com/ajax/libs/ace/1.18.0/ace.min.js",
  });
  await seedCard(s, { id: 545, name: "mod: bootstrap", typeId: 42 });
  await seedCard(s, { id: 546, leftId: 545, rightId: 50, typeId: 43, dbContent: "" });
  await seedCard(s, {
    id: 547,
    leftId: 545,
    rightId: 53,
    typeId: 43,
    dbContent: "https://kit.fontawesome.com/1366963381.js",
  });

  await seedCard(s, { id: 1169, name: "Oracle Head Probe", dbContent: "head probe body" });
  await seedCard(s, {
    id: 1170,
    name: "Oracle Script Probe",
    typeId: 44,
    dbContent: "// probe js\nvar x = 1;",
  });
  await seedCard(s, { id: 1171, name: "Oracle Bare Probe", dbContent: "bare probe body" });

  s.engine.views["stylesheet_path"] = stylesheetPathSeam;
}, 60_000);

afterAll(() => {
  loader?.reset();
  delete storage?.engine.views["stylesheet_path"];
  storage?.close();
});

const REMOTE_TAGS_FOR_ALL_SCRIPT = [
  "<!-- mod: format (remote) -->\n" +
    '<script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>\n' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-ujs/1.2.3/rails.min.js"></script>',
  "<!-- mod: ace editor (remote) -->\n" +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.18.0/ace.min.js"></script>',
  "<!-- mod: bootstrap (remote) -->\n" +
    '<script src="https://kit.fontawesome.com/1366963381.js"></script>',
].join("\n");

describe("card-mod-script through the mod loader (A/B)", () => {
  it("WITHOUT the mod: every ported view raises UnsupportedViewError", async () => {
    const s = storage!;
    await expect(
      s.engine.render("Oracle Head Probe", "script_variables"),
    ).rejects.toThrow(UnsupportedViewError);
    await expect(
      s.engine.render("Oracle Head Probe", "javascript_tags"),
    ).rejects.toThrow(UnsupportedViewError);
    await expect(
      s.engine.render("Oracle Head Probe", "script_calls"),
    ).rejects.toThrow(UnsupportedViewError);
    await expect(
      s.engine.render("Oracle Head Probe", "javascript_include_tag"),
    ).rejects.toThrow(UnsupportedViewError);
    await expect(
      s.engine.render("mod: format+*script", "remote_script_tags"),
    ).rejects.toThrow(UnsupportedViewError);
  });

  it("WITH the mod: :script_variables renders the four decko variables in the javascript_tag wrapper (all/head_javascript.rb:9-15, 33-40)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModScript }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const html = await s.engine.render("Oracle Head Probe", "script_variables");

    expect(html).toBe(
      "<script>\n//<![CDATA[\n" +
        "decko.rootUrl='/';\n" +
        "decko.doubleClick='signed_in';\n" +
        "decko.cssPath='/files/~447test/1790061390.css';\n" +
        "decko.signed_in=false;\n" +
        "\n//]]>\n</script>",
    );
  });

  it("WITH the mod: :script_calls renders the trigger_slot_ready line in the javascript_tag wrapper (all/head_javascript.rb:25-27, 48-50)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Head Probe", "script_calls");

    expect(html).toBe(
      "<script>\n//<![CDATA[\n" +
        "$('document').ready(function() { $('.card-slot').trigger('decko.slot.ready'); })" +
        "\n//]]>\n</script>",
    );
  });

  it("WITH the mod: :remote_script_tags on *all+*script walks the items with the (remote) comment wrappers (type_plus_right/set/script.rb:12-23)", async () => {
    const s = storage!;
    const html = await s.engine.render("*all+*script", "remote_script_tags");
    expect(html).toBe(REMOTE_TAGS_FOR_ALL_SCRIPT);
  });

  it("WITH the mod: :remote_script_tags on a mod card renders its group-remote src list (type_plus_right/mod/script.rb:18-26)", async () => {
    const s = storage!;
    const html = await s.engine.render("mod: format+*script", "remote_script_tags");

    expect(html).toBe(
      '<script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>\n' +
        '<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-ujs/1.2.3/rails.min.js"></script>',
    );
  });

  it("WITH the mod: :remote_script_tags on a card outside the two type_plus_right sets raises (no Ruby set module defines it)", async () => {
    const s = storage!;

    await expect(
      s.engine.render("Oracle Head Probe", "remote_script_tags"),
    ).rejects.toThrow(UnsupportedViewError);
  });

  it("WITH the mod: :javascript_tags joins remote tags, the comment, and the compiled-output main tag (all/head_javascript.rb:17-23, 42-44)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Head Probe", "javascript_tags");

    expect(html).toBe(
      REMOTE_TAGS_FOR_ALL_SCRIPT +
        "\n<!-- MAIN DECKO JAVASCRIPT -->\n" +
        '<script src="/files/~307test/1790061390.js"></script>',
    );
  });

  it("WITH the mod: :javascript_tags resolves the *all+*script rule for ANY card through the all-pattern walk (all/head_javascript.rb:18)", async () => {
    const s = storage!;

    const html = await s.engine.render("Oracle Bare Probe", "javascript_tags");
    expect(html).toBe(
      REMOTE_TAGS_FOR_ALL_SCRIPT +
        "\n<!-- MAIN DECKO JAVASCRIPT -->\n" +
        '<script src="/files/~307test/1790061390.js"></script>',
    );
  });

  it("WITH the mod: :javascript_include_tag on a JavaScript card emits the format-js path tag (abstract/00_script.rb:78-80 layer)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Script Probe", "javascript_include_tag");

    expect(html).toBe('<script src="/Oracle_Script_Probe.js"></script>');
  });

  it("WITH the mod: :javascript_include_tag on a plain card emits the fallback comment (all/head_javascript.rb:29-31 layer)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Head Probe", "javascript_include_tag");
    expect(html).toBe(
      "\n<!-- javascript_include_tag not overridden for Oracle Head Probe -->\n",
    );
  });

  it("WITH the mod: :javascript_include_tag on *all+*script walks its items (right/script.rb:8-12 layer)", async () => {
    const s = storage!;
    const html = await s.engine.render("*all+*script", "javascript_include_tag");

    expect(html).toBe("\n\n");
  });

  it("WITH the mod: the manifest carries all sixteen gem-tree set modules", () => {
    const basket = loader!.setModules();

    const baseShortnames = basket.base.map((m) => m.shortname);
    expect(baseShortnames).toContain("All::HeadJavascript");

    const abstractShortnames = basket.abstract.map((m) => m.shortname);
    expect(abstractShortnames).toEqual([
      "Abstract::Script",
      "Abstract::AssetScript",
      "Abstract::JavaScript",
      "Abstract::CoffeeScript",
      "Abstract::AssetJavaScript",
      "Abstract::AssetCoffeeScript",
      "Abstract::ScriptGroup",
    ]);
    const nonbaseShortnames = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(nonbaseShortnames).toContain("Right::Script");
    expect(nonbaseShortnames).toContain("Self::Script");
    expect(nonbaseShortnames).toContain("Type::CoffeeScript");
    expect(nonbaseShortnames).toContain("Type::JavaScript");
    expect(nonbaseShortnames).toContain("Type::LocalScriptFolderGroup");
    expect(nonbaseShortnames).toContain("Type::LocalScriptManifestGroup");
    expect(nonbaseShortnames).toContain("TypePlusRight::Mod::Script");
    expect(nonbaseShortnames).toContain("TypePlusRight::Set::Script");

    expect(1 + abstractShortnames.length + nonbaseShortnames.filter((n) =>
      [
        "Right::Script",
        "Self::Script",
        "Type::CoffeeScript",
        "Type::JavaScript",
        "Type::LocalScriptFolderGroup",
        "Type::LocalScriptManifestGroup",
        "TypePlusRight::Mod::Script",
        "TypePlusRight::Set::Script",
      ].includes(n),
    ).length).toBe(16);
  });

  it("WITH the mod: the load report lists every ported view", () => {
    const report = loader!.load();
    expect(report.modNames).toEqual(["script"]);
    for (const view of [
      "script_variables",
      "javascript_tags",
      "script_calls",
      "javascript_include_tag",
      "remote_script_tags",
    ]) {
      expect(report.registeredViews).toContain(view);
    }
  });

  it("WITH the mod: the *script setting_opts registration matches self/script.rb:1", () => {
    const registry = loader!.settingsRegistry();
    const script = registry.findByCodename("script");
    expect(script?.group).toBe("webpage");

    expect(registry.groups.get("webpage")?.slice(0, 4)).toEqual([null, null, null, null]);
    expect(registry.groups.get("webpage")?.[4]?.codename).toBe("script");
  });

  it("WITH the mod: view configs match the Ruby view options", () => {
    const loaderRef = loader!;
    expect(loaderRef.viewConfigFor("script_variables")).toMatchObject({
      unknown: true,
      cache: "never",
      perms: "none",
    });
    expect(loaderRef.viewConfigFor("javascript_tags")).toMatchObject({
      unknown: true,
      cache: "force",
      perms: "none",
    });
    expect(loaderRef.viewConfigFor("script_calls")).toMatchObject({
      unknown: true,
      perms: "none",
    });
    expect(loaderRef.viewConfigFor("javascript_include_tag")).toMatchObject({
      unknown: true,
      cache: "never",
    });
    expect(loaderRef.viewConfigFor("remote_script_tags")).toBeUndefined();
  });

  it("WITH the mod: the prepareEngine warmed the rule closure so the render path resolves it synchronously", async () => {
    const s = storage!;

    const html = await s.engine.render("Oracle Head Probe", "javascript_tags");
    expect(html).toContain("<!-- MAIN DECKO JAVASCRIPT -->");

    const content = await s.engine.render("Oracle Head Probe", "content");
    expect(content).toContain("head probe body");
  });

  it("WITH the mod: the load report lists the two validate events (type/coffee_script.rb:5, type/java_script.rb:5)", () => {

    const report = loader!.load();
    expect(report.modNames).toEqual(["script"]);
    expect(report.registeredEvents).toEqual([
      "validate_coffeescript_syntax",
      "validate_javascript_syntax",
    ]);
  });

  it("WITH the mod: the ModEventRegistry carries both validate events with file coordinates injected", () => {

    const registry = loader!.eventRegistry();
    expect(registry.size()).toBe(2);
    expect(registry.all().map((e) => `${e.modName}:${e.event}:${e.setPath}`)).toEqual([
      "script:validate_coffeescript_syntax:type/coffee_script",
      "script:validate_javascript_syntax:type/java_script",
    ]);

    expect(registry.forStage("validate").map((e) => e.event)).toEqual([
      "validate_coffeescript_syntax",
      "validate_javascript_syntax",
    ]);

    expect(registry.forStage("store")).toEqual([]);
    expect(registry.forStage("integrate")).toEqual([]);

    const cs = registry.forEvent("validate_coffeescript_syntax");
    expect(cs?.setPath).toBe("type/coffee_script");
    expect(cs?.modName).toBe("script");
    expect(cs?.at).toBe("validate");
    expect(cs?.on).toEqual(["save"]);

    expect(cs?.changed).toEqual(["type_id", "content"]);
    expect(typeof cs?.fn).toBe("function");
    const js = registry.forEvent("validate_javascript_syntax");
    expect(js?.setPath).toBe("type/java_script");
    expect(js?.modName).toBe("script");
    expect(js?.at).toBe("validate");
    expect(js?.on).toEqual(["save"]);
    expect(js?.changed).toEqual(["type_id", "content"]);
    expect(typeof js?.fn).toBe("function");
  });
});
