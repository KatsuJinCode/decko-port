

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { UnsupportedViewError } from "../../../src/card/render/format.js";
import { ModLoader } from "../../../src/card/mod-loader.js";
import cardModStyle, {
  cssChunkList,
  cssInputType,
  cssAceMode,
  cssDefaultNestView,
  scssAceMode,
  validFileExtensions,
  styleOkItemTypes,
  hiddenSkins,
  styleInputType,
  styleDefaultItemView,
  setStyleOkToRead,
  modStyleSubpath,
  modStyleFolderGroupType,
  modStyleLocalManifestGroupType,
  skinDeletionError,
} from "../../../src/card/mod-loader/mods/card-mod-style.js";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 3, name: "Skin", codename: "skin" });
  await seedCard(s, { id: 4, name: "BootswatchSkin", codename: "bootswatch_skin" });

  await seedCard(s, {
    id: 1169,
    name: "Alpha Skin",
    typeId: 3,
    dbContent: "alpha skin body",
  });
  await seedCard(s, {
    id: 1170,
    name: "Beta Skin",
    typeId: 3,
    dbContent: "beta skin body",
  });

  await seedCard(s, { id: 31, name: "image", dbContent: "image body" });
  await seedCard(s, { id: 32, leftId: 1170, rightId: 31, typeId: 2 });

  await seedCard(s, {
    id: 1172,
    name: "Bootswatch Skin Probe",
    typeId: 4,
    dbContent: "bootswatch body",
  });

  await seedCard(s, {
    id: 1171,
    name: "Plain Page",
    dbContent: "plain page body",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-style through the mod loader (A/B)", () => {
  it("WITHOUT the mod: every ported view raises UnsupportedViewError on every probe", async () => {
    const s = storage!;
    for (const name of ["Alpha Skin", "Plain Page"]) {
      await expect(s.engine.render(name, "box_bottom")).rejects.toThrow(
        UnsupportedViewError,
      );
      await expect(s.engine.render(name, "customize_button")).rejects.toThrow(
        UnsupportedViewError,
      );
      await expect(s.engine.render(name, "box_middle")).rejects.toThrow(
        UnsupportedViewError,
      );
    }
  });

  it("load() registers all sixteen gem-tree set modules, exactly three views, and the *style setting", () => {
    loader = new ModLoader([{ manifest: cardModStyle }]);
    const report = loader.load();
    expect(report.modNames).toEqual(["style"]);

    expect(report.registeredSetModules).toEqual([
      "Abstract::AssetStyle",
      "Abstract::Css",
      "Abstract::Scss",
      "Abstract::AssetCss",
      "Abstract::AssetScss",
      "Abstract::SkinBox",
      "Abstract::StyleGroup",
      "Type::Css",
      "Type::LocalStyleFolderGroup",
      "Type::LocalStyleManifestGroup",
      "Type::Scss",
      "Type::Skin",
      "TypePlusRight::Mod::Style",
      "TypePlusRight::Set::Style",
      "Self::Style",
      "Self::StyleMods",
    ]);

    expect(report.registeredViews).toEqual([
      "box_bottom",
      "customize_button",
      "box_middle",
    ]);
    expect(report.registeredSettings).toEqual(["style"]);

    expect(report.registeredEvents).toEqual([
      "validate_css",
      "validate_scss_syntax",
      "no_deletion_if_used",
    ]);
  });

  it("eventRegistry(): the three pinned event declarations land on the registry with exact stages and triggers", () => {
    const registry = loader!.eventRegistry();

    const validateEvents = registry.forStage("validate");
    expect(validateEvents.map((e) => e.event)).toEqual([
      "validate_css",
      "validate_scss_syntax",
      "no_deletion_if_used",
    ]);

    const validateCss = registry.forEvent("validate_css");
    expect(validateCss).toBeDefined();
    expect(validateCss?.at).toBe("validate");
    expect(validateCss?.on).toEqual(["save"]);
    expect(validateCss?.changed).toEqual(["type_id", "content"]);
    expect(validateCss?.setPath).toBe("type/css");
    expect(validateCss?.modName).toBe("style");
    expect(typeof validateCss?.fn).toBe("function");

    const validateScssSyntax = registry.forEvent("validate_scss_syntax");
    expect(validateScssSyntax).toBeDefined();
    expect(validateScssSyntax?.at).toBe("validate");
    expect(validateScssSyntax?.on).toEqual(["save"]);
    expect(validateScssSyntax?.changed).toEqual(["type_id", "content"]);
    expect(validateScssSyntax?.setPath).toBe("type/scss");
    expect(validateScssSyntax?.modName).toBe("style");
    expect(typeof validateScssSyntax?.fn).toBe("function");

    const noDeletionIfUsed = registry.forEvent("no_deletion_if_used");
    expect(noDeletionIfUsed).toBeDefined();
    expect(noDeletionIfUsed?.at).toBe("validate");
    expect(noDeletionIfUsed?.on).toEqual(["delete"]);
    expect(noDeletionIfUsed?.changed).toBeUndefined();
    expect(noDeletionIfUsed?.setPath).toBe("type/skin");
    expect(noDeletionIfUsed?.modName).toBe("style");
    expect(typeof noDeletionIfUsed?.fn).toBe("function");

    const all = registry.all();
    expect(all.map((e) => e.event)).toEqual([
      "validate_css",
      "validate_scss_syntax",
      "no_deletion_if_used",
    ]);
    expect(registry.size()).toBe(3);

    expect(registry.forStage("initialize")).toEqual([]);
    expect(registry.forStage("prepare_to_validate")).toEqual([]);
    expect(registry.forStage("prepare_to_store")).toEqual([]);
    expect(registry.forStage("store")).toEqual([]);
    expect(registry.forStage("finalize")).toEqual([]);
    expect(registry.forStage("integrate")).toEqual([]);
    expect(registry.forStage("after_integrate")).toEqual([]);
    expect(registry.forStage("integrate_with_delay")).toEqual([]);
    expect(registry.forStage("extend")).toEqual([]);
    expect(registry.forStage("extend_with_delay")).toEqual([]);
  });

  it("WITH the mod: :box_bottom on a Skin card renders the empty string (skin_box.rb:8 + box_bottom.haml:1)", async () => {
    const s = storage!;

    const html = await s.engine.render("Alpha Skin", "box_bottom");
    expect(html).toBe("");
  });

  it("WITH the mod: :customize_button on a Skin card renders the empty string (skin_box.rb:10-12)", async () => {
    const s = storage!;
    const html = await s.engine.render("Alpha Skin", "customize_button");
    expect(html).toBe("");
  });

  it("WITH the mod: :box_middle on a Skin card without an image field renders nothing (skin_box.rb:14-16 guard)", async () => {
    const s = storage!;

    const html = await s.engine.render("Alpha Skin", "box_middle");
    expect(html).toBe("");
  });

  it("WITH the mod: :box_middle on a Skin card WITH an image field nests it at :full_width (skin_box.rb:15)", async () => {
    const s = storage!;

    const image = await s.engine.prepareItemForRender("Beta Skin+image");
    expect(image).toBeDefined();

    await expect(s.engine.render("Beta Skin", "box_middle")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Beta Skin", "box_middle")).rejects.toThrow(
      /full_width/,
    );
  });

  it("WITH the mod: the SkinBox reach covers BootswatchSkin (bootstrap type/bootswatch_skin.rb:30 include)", async () => {
    const s = storage!;
    const html = await s.engine.render("Bootswatch Skin Probe", "box_bottom");
    expect(html).toBe("");
    const button = await s.engine.render(
      "Bootswatch Skin Probe",
      "customize_button",
    );
    expect(button).toBe("");
  });

  it("WITH the mod: a non-Skin card keeps raising UnsupportedViewError (the ancestor fallback)", async () => {
    const s = storage!;

    await expect(s.engine.render("Plain Page", "box_bottom")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(
      s.engine.render("Plain Page", "customize_button"),
    ).rejects.toThrow(UnsupportedViewError);
    await expect(s.engine.render("Plain Page", "box_middle")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: the SkinBox views land in the abstract basket bucket with their contributing mod", () => {
    const basket = loader!.setModules();
    const abstractNames = basket.abstract.map((m) => m.shortname);
    expect(abstractNames).toContain("Abstract::SkinBox");
    const skinBox = basket.abstract.find((m) => m.shortname === "Abstract::SkinBox");
    expect(skinBox?.modName).toBe("style");
    expect(skinBox?.kind).toBe("abstract");

    const nonbaseShortnames = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(nonbaseShortnames).toContain("Self::Style");
    expect(nonbaseShortnames).toContain("Self::StyleMods");
    expect(nonbaseShortnames).toContain("Type::Css");
    expect(nonbaseShortnames).toContain("Type::Scss");
    expect(nonbaseShortnames).toContain("Type::Skin");
    expect(nonbaseShortnames).toContain("TypePlusRight::Mod::Style");
    expect(nonbaseShortnames).toContain("TypePlusRight::Set::Style");

    expect(basket.base).toEqual([]);
  });

  it("WITH the mod: the *style setting_opts registration matches self/style.rb:1-4", () => {
    const registry = loader!.settingsRegistry();
    const style = registry.findByCodename("style");
    expect(style?.group).toBe("webpage");
    expect(style?.ruleTypeEditable).toBe(false);
    expect(style?.rawHelpText).toBe(
      "Skin (collection of stylesheets) for card's page. [[http://decko.org/skins|more]]",
    );

    expect(style?.rightRawHelpText).toBe(
      "Skin (collection of stylesheets) for card's page. [[http://decko.org/skins|more]]",
    );

    const webpage = registry.groups.get("webpage");
    expect(webpage?.length).toBe(4);
    expect(webpage?.[0]).toBeNull();
    expect(webpage?.[1]).toBeNull();
    expect(webpage?.[2]).toBeNull();
    expect(webpage?.[3]?.codename).toBe("style");
  });

  it("WITH the mod: the nine non-portable missing views stay UNREGISTERED", () => {

    const views = loader!.viewsTable();
    for (const name of [
      "box",
      "compiled",
      "compressed",
      "import",
      "labeled",
      "remote_include_tags",
      "remote_style_tags",
      "stylesheet_include_tag",
      "stylesheet_path",
    ]) {
      expect(views[name]).toBeUndefined();
    }
  });

  it("the set-module method constants transcribe the Ruby declarations", () => {

    expect(cssChunkList).toBe("references");
    expect(cssInputType).toBe("ace_editor");
    expect(cssAceMode).toBe("css");
    expect(cssDefaultNestView).toBe("closed");

    expect(scssAceMode).toBe("scss");

    expect(validFileExtensions).toEqual(["css", "scss"]);

    expect(styleOkItemTypes).toEqual(["css", "scss", "skin", "bootswatch_skin"]);
    expect(styleInputType).toBe("box_select");
    expect(styleDefaultItemView).toBe("bar");
    expect(setStyleOkToRead).toBe(true);

    expect(modStyleSubpath).toBe("style");
    expect(modStyleFolderGroupType).toBe("local_style_folder_group");
    expect(modStyleLocalManifestGroupType).toBe("local_style_manifest_group");
  });

  it("HIDDEN_SKINS keeps the Ruby source's duplicate entry verbatim (set/style.rb:24-25)", () => {

    expect(hiddenSkins).toEqual([
      "bootstrap_default_skin",
      "themeless_bootstrap_skin",
      "bootstrap_default_skin",
      "classic_bootstrap_skin",
    ]);
  });

  it("skinDeletionError is the no_deletion_if_used predicate (type/skin.rb:13-17 + en.yml)", () => {

    const itemKeys = ["my_active_skin", "another_skin"];
    expect(skinDeletionError(itemKeys, "my_active_skin")).toBe(
      "Can't delete skin because it's used.",
    );
    expect(skinDeletionError(itemKeys, "unused_skin")).toBeUndefined();
    expect(skinDeletionError([], "my_active_skin")).toBeUndefined();
  });

  it("WITH the mod: a baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Alpha Skin", "content");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("card-slot");
    expect(html).toContain("alpha skin body");
  });

  it("reset() restores the pre-load state (the views raise UnsupportedViewError again)", async () => {
    const s = storage!;
    loader!.reset();
    await expect(s.engine.render("Alpha Skin", "box_bottom")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Alpha Skin", "box_middle")).rejects.toThrow(
      UnsupportedViewError,
    );

    const report = loader!.load();
    expect(report.registeredViews).toEqual([
      "box_bottom",
      "customize_button",
      "box_middle",
    ]);
    const html = await s.engine.render("Alpha Skin", "box_bottom");
    expect(html).toBe("");
  });
});
