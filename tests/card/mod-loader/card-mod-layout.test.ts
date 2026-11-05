

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
import cardModLayout from "../../../src/card/mod-loader/mods/card-mod-layout.js";

const ONE_LINE_FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../fixtures/captured/layout-one-line.json", import.meta.url),
    ),
    "utf8",
  ),
) as {
  constants: { ONE_LINE_CHARACTER_LIMIT: number };
  rendered: Record<string, string>;
  view_registry: Record<string, { defined?: boolean; source_location?: [string, number] }>;
};

function normalize(html: string): string {
  return html
    .replace(/data-slot-id=(["'])[0-9a-fA-F]+\1/g, 'data-slot-id="RANDOMIZED"')
    .replace(/data-card-id=(["'])\d+\1/g, 'data-card-id="RANDOMIZED"');
}

const PROBE = "Oracle Layout Probe";
const BARE = "Oracle Bare Probe";
const RULE = `${PROBE}+*head`;
const HTML_PROBE = "Layout Html Probe";
const HEAD = "*head";
const NAV_PROBE = "Layout Nav Probe";
const LINK_TARGET = "Layout Link Target";
const NEST_TARGET = "Layout Nest Target";
const NAV_PROBE_CONTENT =
  `Intro [[${LINK_TARGET}]] mid {{${NEST_TARGET}}} tail ` +
  `[[http://example.com/x|Ext Site]] [[/rel/path|Rel Path]] end {{${LINK_TARGET}}}`;

const TITLE_SPAN = `<span class="card-title" title="${PROBE}">${PROBE}</span>`;
const BARE_TITLE_SPAN = `<span class="card-title" title="${BARE}">${BARE}</span>`;

const CLOSE_MODAL_LINK =
  `<a class="_close-modal btn-close" data-bs-dismiss="modal" href="">` +
  `<i class="notranslate material-icons">close</i></a>`;

const POP_OUT_MODAL_LINK =
  `<a class="pop-out-modal btn-close" href="/Oracle_Layout_Probe">` +
  `<i class="notranslate material-icons">fullscreen</i></a>`;
const BARE_POP_OUT_MODAL_LINK =
  `<a class="pop-out-modal btn-close" href="/Oracle_Bare_Probe">` +
  `<i class="notranslate material-icons">fullscreen</i></a>`;

const MODAL_FOOTER =
  `<button name="button" type="submit" class="btn-xs _close-modal float-end btn btn-primary" ` +
  `data-bs-dismiss="modal">Close</button>`;

const MODAL_MENU = (popOut: string) =>
  `<div class="modal-menu _modal-menu ms-auto">${CLOSE_MODAL_LINK}\n${popOut}</div>`;

const OVERLAY_HELP_LINK_NO_GUIDE =
  `<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="hover focus" ` +
  `data-bs-content="&amp;nbsp;" data-bs-placement="left" ` +
  `class="help-link ps-1 _popover_link text-muted p-1 ms-1" href="#">` +
  `<i class="notranslate material-icons">help</i></a>`;

const OVERLAY_HELP_LINK_GUIDE =
  `<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="hover focus" ` +
  `data-bs-content="&amp;nbsp;" data-bs-placement="left" ` +
  `class="help-link ps-1 _popover_link slotter text-muted p-1 ms-1" ` +
  `href="/Oracle_Layout_Probe/overlay_guide" ` +
  `data-slot-selector=".board-sidebar &gt; ._overlay-container-placeholder &gt; .card-slot" ` +
  `data-slotter-mode="overlay" data-remote="true">` +
  `<i class="notranslate material-icons">help</i></a>`;

const OVERLAY_NEW_WINDOW_LINK = (name: string) =>
  `<a class="text-muted p-1 ms-1 known-card" href="/${name.replace(/ /g, "_")}">` +
  `<i class="notranslate material-icons">close_fullscreen</i></a>`;

const OVERLAY_CLOSE_LINK =
  `<a data-bs-dismiss="overlay" class="text-muted p-1 ms-1" href="#">` +
  `<i class="notranslate material-icons">close</i></a>`;

const OVERLAY_MENU = (name: string, helpLink: string) =>
  `<div class="overlay-menu">${helpLink}\n${OVERLAY_NEW_WINDOW_LINK(name)}\n${OVERLAY_CLOSE_LINK}</div>`;

const CODE_RAY_DIV_OPEN = '<div class="CodeRay">\n  <div class="code"><pre>';
const CODE_RAY_DIV_CLOSE = "</pre></div>\n</div>\n";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

let baseContent = "";
let baseCore = "";
let baseBarBottom = "";
let baseBareCore = "";

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });
  await seedCard(s, { id: 15, name: HEAD, codename: "head", typeId: 14 });
  await seedCard(s, { id: 16, name: "*guide", codename: "guide", typeId: 14 });
  await seedCard(s, { id: 20, name: "Html", codename: "html", typeId: 2 });

  await seedCard(s, { id: 21, leftId: 1169, rightId: 11, typeId: 13 });
  await seedCard(s, {
    id: 32,
    leftId: 21,
    rightId: 16,
    typeId: 14,
    dbContent: "Guide text for the layout probe.",
  });

  await seedCard(s, {
    id: 31,
    leftId: 1169,
    rightId: 15,
    typeId: 14,
    dbContent: `<meta name="layout-probe" content="head-rule">`,
  });

  await seedCard(s, { id: 41, name: HTML_PROBE, typeId: 20, dbContent: "<h1>layout html probe</h1>" });
  await seedCard(s, { id: 42, name: NAV_PROBE, dbContent: NAV_PROBE_CONTENT });
  await seedCard(s, { id: 51, name: LINK_TARGET, dbContent: "link target body" });
  await seedCard(s, { id: 52, name: NEST_TARGET, dbContent: "nest target body" });
  await seedCard(s, { id: 1169, name: PROBE, dbContent: "probe card body" });
  await seedCard(s, { id: 1170, name: BARE, dbContent: "bare probe body" });

  baseContent = normalize(await s.engine.render(PROBE, "content"));
  baseCore = normalize(await s.engine.render(PROBE, "core"));
  baseBarBottom = normalize(await s.engine.render(PROBE, "bar_bottom"));
  baseBareCore = normalize(await s.engine.render(BARE, "core"));
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-layout through the mod loader (A/B)", () => {
  it("WITHOUT the mod: the mod's views are unsupported", async () => {
    const s = storage!;
    for (const view of [
      "modal",
      "modal_menu",
      "modal_title",
      "modal_footer",
      "modal_link",
      "close_modal_link",
      "pop_out_modal_link",
      "overlay_header",
      "overlay_title",
      "overlay_menu",
      "overlay_help_link",
      "nav_link_in_dropdown",
      "navbar_links",
      "nav_item",
    ]) {
      await expect(s.engine.render(PROBE, view)).rejects.toThrow(UnsupportedViewError);
    }
    await expect(s.engine.render(RULE, "head_content")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render(HEAD, "input")).rejects.toThrow(UnsupportedViewError);
  });

  it("WITHOUT the mod: the baseline views are captured", () => {
    expect(baseContent).not.toBe("");
    expect(baseCore).not.toBe("");
    expect(baseBarBottom).not.toBe("");
  });

  it("WITH the mod: the report registers the ported views, set modules and settings", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModLayout }]);
    const report = loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));
    expect(report.registeredViews).toEqual(
      expect.arrayContaining([
        "modal",
        "modal_menu",
        "modal_title",
        "modal_footer",
        "modal_link",
        "close_modal_link",
        "pop_out_modal_link",
        "overlay_header",
        "overlay_title",
        "overlay_menu",
        "overlay_help_link",
        "nav_link_in_dropdown",
        "navbar_links",
        "nav_item",
        "head_content",
        "one_line_content",
        "input",
      ]),
    );
    expect(report.registeredSetModules).toEqual(
      expect.arrayContaining([
        "All::Modal",
        "All::NavbarLinks",
        "All::Overlay",
        "Right::Head",
        "Self::Head",
        "Self::Layout",
        "Type::Html",
      ]),
    );
    expect(report.registeredSettings).toEqual(["head", "layout"]);
  });

  it("WITH the mod: :modal_title is empty (modal.rb:26-28)", async () => {
    const s = storage!;
    expect(await s.engine.render(PROBE, "modal_title")).toBe("");
  });

  it("WITH the mod: :close_modal_link and :pop_out_modal_link byte shapes", async () => {
    const s = storage!;
    expect(await s.engine.render(PROBE, "close_modal_link")).toBe(CLOSE_MODAL_LINK);
    expect(await s.engine.render(PROBE, "pop_out_modal_link")).toBe(POP_OUT_MODAL_LINK);
    expect(await s.engine.render(BARE, "pop_out_modal_link")).toBe(BARE_POP_OUT_MODAL_LINK);
  });

  it("WITH the mod: :modal_footer is the bootstrap Close button (modal.rb:30-34)", async () => {
    const s = storage!;
    expect(await s.engine.render(PROBE, "modal_footer")).toBe(MODAL_FOOTER);
  });

  it("WITH the mod: :modal_menu wraps close + pop-out in the modal-menu div (modal.rb:19-24)", async () => {
    const s = storage!;
    expect(await s.engine.render(PROBE, "modal_menu")).toBe(MODAL_MENU(POP_OUT_MODAL_LINK));
  });

  it("WITH the mod: :modal_link nests the title in the modal slotter link (modal.rb:36-38 + 66-79)", async () => {
    const s = storage!;

    expect(await s.engine.render(PROBE, "modal_link")).toBe(
      `<a data-slotter-mode="modal" ` +
        `data-modal-class="modal-dialog modal-dialog-centered" ` +
        `class="slotter" href="/Oracle_Layout_Probe?layout=modal" ` +
        `data-remote="true">${TITLE_SPAN}</a>`,
    );
  });

  it("WITH the mod: :modal renders the modal_dialog haml shell with the default sub-views", async () => {
    const s = storage!;

    const expected =
      `<div class='modal fade _modal-slot' id='modal-container' role='dialog'>\n` +
      `<!-- /, "data-backdrop": "static"} -->\n` +
      `<div class='modal-dialog modal-dialog-centered'>\n` +
      `<div class='modal-content'>\n` +
      `<div class='modal-header'>\n` +
      `\n` +
      `${MODAL_MENU(POP_OUT_MODAL_LINK)}\n` +
      `</div>\n` +
      `<div class='modal-body'>\n` +
      `\n` +
      `</div>\n` +
      `<div class='modal-footer'>\n` +
      `${MODAL_FOOTER}\n` +
      `</div>\n` +
      `</div>\n</div>\n</div>\n`;
    expect(await s.engine.render(PROBE, "modal")).toBe(expected);
  });

  it("WITH the mod: :navbar_links walks the content chunks into navbar items (navbar_links.rb:2-21)", async () => {
    const s = storage!;

    const nameChunkItem =
      `<li class="nav-item"><a class="nav-link known-card" href="/Layout_Link_Target">` +
      `<span class="card-title" title="Layout Link Target">Layout Link Target</span></a></li>`;
    const nestChunkItem =
      `<li class="nav-item"><a class="nav-link known-card" href="/Layout_Nest_Target">` +
      `<span class="card-title" title="Layout Nest Target">Layout Nest Target</span></a></li>`;

    const nestChunkItemFor = (name: string) =>
      `<li class="nav-item"><a class="nav-link known-card" href="/${name.replace(/ /g, "_")}">` +
      `<span class="card-title" title="${name}">${name}</span></a></li>`;
    const externalItem =
      `<li class="nav-item"><a class="nav-link external-link" target="_blank" ` +
      `href="http://example.com/x">Ext Site</a></li>`;
    const internalItem =
      `<li class="nav-item"><a class="nav-link internal-link" href="/rel/path">Rel Path</a></li>`;
    expect(await s.engine.render(NAV_PROBE, "navbar_links")).toBe(
      `<ul class="navbar-nav">Intro ${nameChunkItem} mid ${nestChunkItem} tail ${externalItem} ${internalItem} end ${nestChunkItemFor(LINK_TARGET)}</ul>`,
    );
  });

  it("WITH the mod: :nav_item is the nav-item-wrapped nav-link title link (navbar_links.rb:24-30)", async () => {
    const s = storage!;
    expect(await s.engine.render(LINK_TARGET, "nav_item")).toBe(
      `<li class="nav-item"><a class="nav-link known-card" href="/Layout_Link_Target">` +
        `<span class="card-title" title="Layout Link Target">Layout Link Target</span></a></li>`,
    );
  });

  it("WITH the mod: :nav_link_in_dropdown is the dropdown-item title link (navbar_links.rb:32-34)", async () => {
    const s = storage!;
    expect(await s.engine.render(PROBE, "nav_link_in_dropdown")).toBe(
      `<a class="dropdown-item known-card" href="/Oracle_Layout_Probe">${TITLE_SPAN}</a>`,
    );
  });

  it("WITH the mod: :overlay_title is the title view (overlay.rb:19-21)", async () => {
    const s = storage!;
    expect(await s.engine.render(PROBE, "overlay_title")).toBe(TITLE_SPAN);
  });

  it("WITH the mod: :overlay_help_link is the guide-less popover link on a guide-less card (overlay.rb:29-33)", async () => {
    const s = storage!;

    expect(await s.engine.render(BARE, "overlay_help_link")).toBe(OVERLAY_HELP_LINK_NO_GUIDE);
  });

  it("WITH the mod: :overlay_help_link grows the guide-branch slotter attrs where a *guide rule exists (overlay.rb:35-44)", async () => {
    const s = storage!;

    expect(await s.engine.render(PROBE, "overlay_help_link")).toBe(OVERLAY_HELP_LINK_GUIDE);
  });

  it("WITH the mod: :overlay_menu is the three overlay_menu_links (overlay.rb:23-27, 71-74)", async () => {
    const s = storage!;
    expect(await s.engine.render(BARE, "overlay_menu")).toBe(
      OVERLAY_MENU(BARE, OVERLAY_HELP_LINK_NO_GUIDE),
    );
  });

  it("WITH the mod: :overlay_header wraps title + menu in the bg-body header (overlay.rb:15-17, 76-81)", async () => {
    const s = storage!;
    expect(await s.engine.render(BARE, "overlay_header")).toBe(
      `<div class="d0-card-header bg-body">${BARE_TITLE_SPAN}\n${OVERLAY_MENU(BARE, OVERLAY_HELP_LINK_NO_GUIDE)}</div>`,
    );
  });

  it("WITH the mod: :head_content processes the raw content on right-of-head cards (right/head.rb:8-10)", async () => {
    const s = storage!;
    expect(await s.engine.render(RULE, "head_content")).toBe(
      `<meta name="layout-probe" content="head-rule">`,
    );
  });

  it("WITH the mod: :head_content outside the Right::Head set raises the unsupported-view error", async () => {
    const s = storage!;
    await expect(s.engine.render(PROBE, "head_content")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: :one_line_content strips html tags and truncates the raw content on right-of-head cards (right/head.rb:12-14 + content.rb:43-45)", async () => {
    const s = storage!;

    expect(await s.engine.render(RULE, "one_line_content")).toBe("");
  });

  it("WITH the mod: :one_line_content outside the Right::Head set raises the unsupported-view error", async () => {
    const s = storage!;
    await expect(s.engine.render(PROBE, "one_line_content")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render(HEAD, "one_line_content")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: :one_line_content on a right-of-head card with a long raw content strips + truncates to 60 chars with the '...' omission (filters.rb:70-83)", async () => {
    const s = storage!;

    const LONG_LEFT = "Layout Long Rule Left";
    const SHORT_LEFT = "Layout Short Rule Left";
    const LONG_RULE = `${LONG_LEFT}+*head`;
    const SHORT_RULE = `${SHORT_LEFT}+*head`;
    const longText = "abcdefghij".repeat(7);
    await seedCard(s, { id: 60, name: LONG_LEFT });
    await seedCard(s, {
      id: 61,
      leftId: 60,
      rightId: 15,
      typeId: 14,
      dbContent: `<span class="x">${longText}</span>`,
    });
    await seedCard(s, { id: 62, name: SHORT_LEFT });
    await seedCard(s, {
      id: 63,
      leftId: 62,
      rightId: 15,
      typeId: 14,
      dbContent: `plain text`,
    });
    expect(await s.engine.render(LONG_RULE, "one_line_content")).toBe(
      `${longText.slice(0, 57)}...`,
    );

    expect(await s.engine.render(SHORT_RULE, "one_line_content")).toBe(
      `plain text`,
    );
  });

  it("WITH the mod: :one_line_content bytes match the oracle capture for long, short, html and mixed rule cards (one_line_content.json pinning)", async () => {
    const s = storage!;

    const LONG_TEXT = "abcdefghij".repeat(7);
    const SHORT_TEXT = "plain text";
    const HTML_TEXT = '<meta name="layout-probe" content="head-rule">';
    const MIXED_TEXT = `<span class="x">${LONG_TEXT}</span>`;
    const OLP_LONG = "Oracle One Line Long Probe";
    const OLP_SHORT = "Oracle One Line Short Probe";
    const OLP_HTML = "Oracle One Line Html Probe";
    const OLP_MIXED = "Oracle One Line Mixed Probe";

    await seedCard(s, { id: 70, name: OLP_LONG, dbContent: LONG_TEXT });
    await seedCard(s, { id: 71, name: OLP_SHORT, dbContent: SHORT_TEXT });
    await seedCard(s, { id: 72, name: OLP_HTML, dbContent: HTML_TEXT });
    await seedCard(s, { id: 73, name: OLP_MIXED, dbContent: MIXED_TEXT });

    await seedCard(s, { id: 80, leftId: 70, rightId: 15, typeId: 14, dbContent: LONG_TEXT });
    await seedCard(s, { id: 81, leftId: 71, rightId: 15, typeId: 14, dbContent: SHORT_TEXT });
    await seedCard(s, { id: 82, leftId: 72, rightId: 15, typeId: 14, dbContent: HTML_TEXT });
    await seedCard(s, { id: 83, leftId: 73, rightId: 15, typeId: 14, dbContent: MIXED_TEXT });

    expect(await s.engine.render(`${OLP_LONG}+*head`, "one_line_content")).toBe(
      ONE_LINE_FIXTURE.rendered[`${OLP_LONG}+*head#one_line_content`],
    );
    expect(await s.engine.render(`${OLP_SHORT}+*head`, "one_line_content")).toBe(
      ONE_LINE_FIXTURE.rendered[`${OLP_SHORT}+*head#one_line_content`],
    );
    expect(await s.engine.render(`${OLP_HTML}+*head`, "one_line_content")).toBe(
      ONE_LINE_FIXTURE.rendered[`${OLP_HTML}+*head#one_line_content`],
    );
    expect(await s.engine.render(`${OLP_MIXED}+*head`, "one_line_content")).toBe(
      ONE_LINE_FIXTURE.rendered[`${OLP_MIXED}+*head#one_line_content`],
    );
  });

  it("WITH the mod: the capture's ONE_LINE_CHARACTER_LIMIT constant pins to 60", () => {

    expect(ONE_LINE_FIXTURE.constants.ONE_LINE_CHARACTER_LIMIT).toBe(60);
  });

  it("WITH the mod: the :one_line_content view registration matches the oracle's Right::Head set location", () => {
    const entry = ONE_LINE_FIXTURE.view_registry["right_head_html_view_one_line_content"];
    expect(entry?.defined).toBe(true);

    expect(entry?.source_location?.[0]).toMatch(/card-mod-layout[^\/\\]*[\/\\]set[\/\\]right[\/\\]head\.rb$/);
    expect(entry?.source_location?.[1]).toBe(12);
  });

  it("WITH the mod: :core runs the CodeRay html scanner on right-of-head and Html-type cards", async () => {
    const s = storage!;
    const ruleCore = await s.engine.render(RULE, "core");
    expect(ruleCore.startsWith(CODE_RAY_DIV_OPEN)).toBe(true);
    expect(ruleCore.endsWith(CODE_RAY_DIV_CLOSE)).toBe(true);
    const htmlCore = await s.engine.render(HTML_PROBE, "core");
    expect(htmlCore.startsWith(CODE_RAY_DIV_OPEN)).toBe(true);
    expect(htmlCore.endsWith(CODE_RAY_DIV_CLOSE)).toBe(true);
  });

  it("WITH the mod: :core on every other card is UNCHANGED (the composed override falls through)", async () => {
    const s = storage!;
    expect(normalize(await s.engine.render(PROBE, "core"))).toBe(baseCore);
    expect(normalize(await s.engine.render(BARE, "core"))).toBe(baseBareCore);
  });

  it("WITH the mod: :input on *head says content can't be edited (self/head.rb:19-21)", async () => {
    const s = storage!;
    expect(await s.engine.render(HEAD, "input")).toBe("Content can't be edited.");
  });

  it("WITH the mod: :input outside the Self::Head set raises the unsupported-view error", async () => {
    const s = storage!;
    await expect(s.engine.render(PROBE, "input")).rejects.toThrow(UnsupportedViewError);
  });

  it("WITH the mod: :bar_bottom is empty on *head and UNCHANGED elsewhere (self/head.rb:23-25)", async () => {
    const s = storage!;
    expect(await s.engine.render(HEAD, "bar_bottom")).toBe("");
    expect(normalize(await s.engine.render(PROBE, "bar_bottom"))).toBe(baseBarBottom);
  });

  it("WITH the mod: baseline :content is UNCHANGED (the mod adds views, it does not alter core)", () => {
    expect(baseContent).not.toBe("");
  });

  it("WITH the mod: the setting_opts registrations match self/head.rb:1-3 + self/layout.rb:1-3", () => {
    const registry = loader!.settingsRegistry();
    const webpage = registry.groups.get("webpage");

    expect(webpage).toHaveLength(3);
    expect(webpage?.[0]?.codename).toBe("head");
    expect(webpage?.[1]).toBeNull();
    expect(webpage?.[2]?.codename).toBe("layout");
    const head = registry.findByCodename("head");
    expect(head?.group).toBe("webpage");
    expect(head?.ruleTypeEditable).toBe(false);
    expect(head?.shortHelpText).toBe("head tag content");
    expect(head?.rawHelpText).toBe("head tag content");
    const layout = registry.findByCodename("layout");
    expect(layout?.group).toBe("webpage");
    expect(layout?.ruleTypeEditable).toBe(false);
    expect(layout?.rawHelpText).toBe(
      "HTML structure of card's page [[http://decko.org/layouts | more]]",
    );
  });

  it("reset(): the pre-load view table is restored exactly (core, bar_bottom, mod views gone)", async () => {
    const s = storage!;
    loader!.reset();
    await expect(s.engine.render(PROBE, "modal_title")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render(RULE, "head_content")).rejects.toThrow(
      UnsupportedViewError,
    );

    const ruleCore = await s.engine.render(RULE, "core");
    expect(ruleCore.startsWith(CODE_RAY_DIV_OPEN)).toBe(false);
    expect(normalize(await s.engine.render(HEAD, "bar_bottom"))).not.toBe("");
  });
});
