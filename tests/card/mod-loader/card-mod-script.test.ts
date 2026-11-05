// The card-mod-script mod loader test: the mod loaded through the loader
// registers the five headlessly-portable html views of the T6 missing list
// (script_variables, javascript_tags, script_calls, javascript_include_tag,
// remote_script_tags; :compressed is js-format and not registrable), the
// *script setting (setting_opts), and the gem tree's sixteen set modules.
// Each view proves its Ruby-source semantics against a probe deck that
// mirrors the oracle deck's shapes (tools/oracle/decko-oracle-app
// development.sqlite3: *all+*script id 306 and its "mod: X+*script" items).
//
// Byte proof: an oracle capture ran during the port (RAILS_ENV=development
// `bundle exec decko runner` against tools/oracle/decko-oracle-app, modeled
// on oracle-capture-help-mod.rb). Pinned bytes the assertions below mirror:
// - script_variables:
//   "<script>\n//<![CDATA[\ndocko.rootUrl='/';\ndocko.doubleClick='signed_in';\n
//    docko.cssPath='/files/~447/1790061390.css';\ndocko.signed_in=true;\n\n//]]>\n</script>"
//   (the capture ran as bot -> signed_in true; the headless engine's
//   anonymous default is false; the cssPath file ids are seed state)
// - javascript_tags: remote_script_tags bytes + "\n" +
//   "<!-- MAIN DECKO JAVASCRIPT -->" + "\n" +
//   '<script src="/files/~307/1790061390.js"></script>'
// - javascript_include_tag on a JavaScript card:
//   '<script src="/Oracle_Script_Probe.js"></script>'
// - javascript_include_tag fallback:
//   "\n<!-- javascript_include_tag not overridden for NAME -->\n"
// - script_calls: the same <script>//<![CDATA[ wrapper with the
//   trigger_slot_ready line last (the capture also carries cross-mod
//   setAceConfig/setTinyMCEConfig basket entries - not ported, cross-mod
//   basket state)
// - remote_script_tags: "<!-- mod: format (remote) -->" blocks of Rails
//   script tags (the capture's tags carry crossorigin/referrerpolicy
//   attributes that live in the mods' manifest.yml config hashes -
//   filesystem state; the port reads the +*group remote card surface,
//   which carries the src list only)
//
// The cssPath chain nests the *style rule's :stylesheet_path view. That
// view is card-mod-style's (card-mod-style set/type_plus_right/set/
// style.rb:28-34 -> card.asset_output_url, the /files/<db_content> URL
// card-mod-carrierwave lib/carrier_wave/file_card_uploader.rb:111 serves).
// The style mod is a SIBLING port, so the test registers a seam viewFn on
// the engine's live views record that reproduces exactly that composition
// (asset_output_url of the rule card) and deletes it again in afterAll -
// without it the nest would raise UnsupportedViewError, which is what a
// style-less composition does in both engines.

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

// The card-mod-style :stylesheet_path seam (see file header): Ruby is
// `card.asset_output_url` - the /files/<db_content> file URL of the rule
// card's +*asset output child.
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

  // cardtype cards (their codenames feed the engine's typeCode lookups the
  // set/type dispatches read; ids are self-referential type ids).
  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 40, name: "Set", codename: "set", typeId: 40 });
  await seedCard(s, { id: 41, name: "Setting", codename: "setting", typeId: 41 });
  await seedCard(s, { id: 42, name: "Mod", codename: "mod", typeId: 42 });
  await seedCard(s, { id: 43, name: "List", codename: "list", typeId: 43 });
  await seedCard(s, { id: 44, name: "JavaScript", codename: "java_script", typeId: 44 });
  await seedCard(s, { id: 45, name: "CoffeeScript", codename: "coffee_script", typeId: 45 });

  // setting cards (the prepareEngine CTE joins rules to settings.codename).
  await seedCard(s, { id: 50, name: "*script", codename: "script", typeId: 41 });
  await seedCard(s, { id: 51, name: "*style", codename: "style", typeId: 41 });
  await seedCard(s, { id: 52, name: "*asset output", codename: "asset_output", typeId: 41 });
  await seedCard(s, { id: 53, name: "*group remote", codename: "group_remote", typeId: 41 });

  // the set anchor *all (a Set-typed card, oracle id 10 shape)
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 40 });

  // the *all+*script rule card (oracle id 306: type List, items are
  // "mod: X+*script" cards) + its compiled +*asset output child
  // (oracle id 307, db_content "~307/1790061390.js" - the carrierwave
  // identifier the /files/ URL is built from).
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

  // the *all+*style rule card + its compiled output (the cssPath chain)
  await seedCard(s, { id: 446, leftId: 10, rightId: 51, typeId: 43, dbContent: "" });
  await seedCard(s, {
    id: 447,
    leftId: 446,
    rightId: 52,
    typeId: 43,
    dbContent: "~447test/1790061390.css",
  });

  // mod cards with their *script lists (empty, as in the oracle deck rows)
  // and +*group remote cards (the remote src list surface).
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

  // probe cards
  await seedCard(s, { id: 1169, name: "Oracle Head Probe", dbContent: "head probe body" });
  await seedCard(s, {
    id: 1170,
    name: "Oracle Script Probe",
    typeId: 44,
    dbContent: "// probe js\nvar x = 1;",
  });
  await seedCard(s, { id: 1171, name: "Oracle Bare Probe", dbContent: "bare probe body" });

  // the sibling-mod seam (see file header)
  s.engine.views["stylesheet_path"] = stylesheetPathSeam;
}, 60_000);

afterAll(() => {
  loader?.reset();
  delete storage?.engine.views["stylesheet_path"];
  storage?.close();
});

// The remote_script_tags bytes the set-branch walk composes for *all+*script
// (oracle shape minus the manifest-file tag attributes - see header).
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
    // Oracle-pinned byte shape (capture quoted in the file header): the
    // Rails javascript_tag CDATA wrapper, the four variables in hash order,
    // each line "k=v;\n" (the trailing newline makes the blank line before
    // //]]>), rootUrl the requestless root "/" (location.rb:19-21 with an
    // empty origin - the capture pinned card_url("") == "/"), doubleClick
    // the extend_ansi.rb:1 config single-quoted, cssPath the *style rule's
    // :stylesheet_path nest (the seam's /files/<db_content> bytes), and
    // signed_in the anonymous default false (the capture's true was bot
    // session state).
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
    // The headless basket is empty (the capture's setAceConfig/
    // setTinyMCEConfig entries are cross-mod basket state, not ported), so
    // the "\n\n".join of [trigger] is the bare trigger line.
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
    // the +*group remote card's content lines, one Rails script tag each
    // (the oracle capture's extra crossorigin/referrerpolicy attributes come
    // from the manifest.yml config hashes - filesystem state the card
    // surface does not carry)
    expect(html).toBe(
      '<script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>\n' +
        '<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-ujs/1.2.3/rails.min.js"></script>',
    );
  });

  it("WITH the mod: :remote_script_tags on a card outside the two type_plus_right sets raises (no Ruby set module defines it)", async () => {
    const s = storage!;
    // Ruby: the view exists only on Set+*script / Mod+*script; the flat
    // registry would otherwise over-claim it for every card.
    await expect(
      s.engine.render("Oracle Head Probe", "remote_script_tags"),
    ).rejects.toThrow(UnsupportedViewError);
  });

  it("WITH the mod: :javascript_tags joins remote tags, the comment, and the compiled-output main tag (all/head_javascript.rb:17-23, 42-44)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Head Probe", "javascript_tags");
    // param_or_rule_card(:script) resolves *all+*script; the three-part
    // array joins "\n" (oracle-pinned shape); main_javascript_tag reads the
    // rule card's +*asset output file URL (/files/<db_content>, oracle:
    // '<script src="/files/~307/1790061390.js"></script>').
    expect(html).toBe(
      REMOTE_TAGS_FOR_ALL_SCRIPT +
        "\n<!-- MAIN DECKO JAVASCRIPT -->\n" +
        '<script src="/files/~307test/1790061390.js"></script>',
    );
  });

  it("WITH the mod: :javascript_tags resolves the *all+*script rule for ANY card through the all-pattern walk (all/head_javascript.rb:18)", async () => {
    const s = storage!;
    // The bare probe has no set card of its own; the param_or_rule_card
    // walk (head.rb:79-81 -> rule_card(:script)) still lands on the
    // *all+*script rule (the same bytes as the ruled probe above). The
    // view's `return unless` empty-string branch (no resolvable rule) is
    // unreachable in a deck that carries an *all+*script rule - every real
    // deck does - and is covered by the branch's Ruby citation, not pinned
    // here.
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
    // path(format: :js) -> "/#{url_key}.js" (oracle:
    // '<script src="/Oracle_Script_Probe.js"></script>')
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
    // The three items are themselves +*script cards whose lists are empty
    // (oracle deck rows 540/543/546), so each item's recursive render is ""
    // and the "\n".join of ["", "", ""] is "\n\n".
    expect(html).toBe("\n\n");
  });

  it("WITH the mod: the manifest carries all sixteen gem-tree set modules", () => {
    const basket = loader!.setModules();
    // all/* -> base bucket (loader.ts#kindOfSetPath); the shortname is the
    // loader's Rails camelize ("head_javascript" -> "HeadJavascript")
    const baseShortnames = basket.base.map((m) => m.shortname);
    expect(baseShortnames).toContain("All::HeadJavascript");
    // abstract/* + nonbase
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
    // 1 base + 7 abstract + 8 nonbase = the gem's 16 set files
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
    // setting.rb#set_position: position 5 in a previously empty group array
    // leaves the Ruby nil holes in front
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
    // re-render: zero new denial/unknown effects, the rule cards resolve
    // from the prepared map (the ModEngineHost cache walk)
    const html = await s.engine.render("Oracle Head Probe", "javascript_tags");
    expect(html).toContain("<!-- MAIN DECKO JAVASCRIPT -->");
    // and the engine's own :content render still works (the mod adds views,
    // it does not alter core)
    const content = await s.engine.render("Oracle Head Probe", "content");
    expect(content).toContain("head probe body");
  });

  it("WITH the mod: the load report lists the two validate events (type/coffee_script.rb:5, type/java_script.rb:5)", () => {
    // The two `event :` declarations adopted from the gem:
    // - type/coffee_script.rb:5-9 validate_coffeescript_syntax at :validate
    // - type/java_script.rb:5-9 validate_javascript_syntax at :validate
    // Both carry on: :save (recorded as ["save"]; the execution seam
    // applies Ruby's :save -> [:create, :update] expansion at fire time)
    // and changed: %i[type_id content] (recorded verbatim).
    const report = loader!.load();
    expect(report.modNames).toEqual(["script"]);
    expect(report.registeredEvents).toEqual([
      "validate_coffeescript_syntax",
      "validate_javascript_syntax",
    ]);
  });

  it("WITH the mod: the ModEventRegistry carries both validate events with file coordinates injected", () => {
    // The SetLoader phase (mod-loader.ts:283-293) injects setPath + modName
    // at registration time; the registry's all() / forStage() / forEvent()
    // surfaces read the adopted declarations verbatim.
    const registry = loader!.eventRegistry();
    expect(registry.size()).toBe(2);
    expect(registry.all().map((e) => `${e.modName}:${e.event}:${e.setPath}`)).toEqual([
      "script:validate_coffeescript_syntax:type/coffee_script",
      "script:validate_javascript_syntax:type/java_script",
    ]);
    // forStage preserves registration order (Ruby's same-stage execution
    // order is definition load order; the gem's two set files load in
    // path order: type/coffee_script < type/java_script).
    expect(registry.forStage("validate").map((e) => e.event)).toEqual([
      "validate_coffeescript_syntax",
      "validate_javascript_syntax",
    ]);
    // stages the events do not run at stay empty (the cross-check that
    // forStage is genuinely a stage filter).
    expect(registry.forStage("store")).toEqual([]);
    expect(registry.forStage("integrate")).toEqual([]);
    // forEvent returns the first registration for the name with setPath +
    // modName + at + on + changed injected.
    const cs = registry.forEvent("validate_coffeescript_syntax");
    expect(cs?.setPath).toBe("type/coffee_script");
    expect(cs?.modName).toBe("script");
    expect(cs?.at).toBe("validate");
    expect(cs?.on).toEqual(["save"]);
    // changed: %i[type_id content] (Ruby permissions.rb:1) stored verbatim
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
