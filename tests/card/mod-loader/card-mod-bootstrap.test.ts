

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
import {
  popoverLink,
} from "../../../src/card/mod-loader/mods/card-mod-bootstrap.js";
import cardModBootstrap from "../../../src/card/mod-loader/mods/card-mod-bootstrap.js";

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../fixtures/captured/bootstrap-views.json", import.meta.url),
    ),
    "utf8",
  ),
) as { rendered: Record<string, string> };

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, { id: 200, name: "Progress Numeric", dbContent: "42" });
  await seedCard(s, { id: 201, name: "Progress Zero", dbContent: "0" });
  await seedCard(s, { id: 202, name: "Progress OutOfRange", dbContent: "150" });
  await seedCard(s, { id: 203, name: "Progress Decimal", dbContent: "12.5" });
  await seedCard(s, { id: 204, name: "Progress NonNumeric", dbContent: "not a number" });
  await seedCard(s, { id: 205, name: "Progress Empty", dbContent: "" });

  await seedCard(s, { id: 210, name: "Icon Reference", dbContent: "" });

  await seedCard(s, { id: 220, name: "Bootswatch Skin Probe", dbContent: "skin content" });

  await seedCard(s, {
    id: 500,
    name: "*bootswatch_skin",
    codename: "bootswatch_skin",
    typeId: 13,
  });
  await seedCard(s, {
    id: 230,
    name: "Cerulean Skin",
    dbContent: "skin css body",
    typeId: 500,
  });

  await seedCard(s, {
    id: 231,
    name: "Cerulean Skin Customized",
    dbContent: "skin css body v2",
    typeId: 500,
  });
  await seedCard(s, {
    id: 233,
    name: "parent",
    dbContent: "",
  });
  await seedCard(s, {
    id: 232,
    leftId: 231,
    rightId: 233,
    dbContent: "Cerulean Skin",
  });

  await seedCard(s, {
    id: 300,
    name: "Oracle Carousel Item One",
    dbContent: "item one body",
  });
  await seedCard(s, {
    id: 301,
    name: "Oracle Carousel Item Two",
    dbContent: "item two body",
  });
  await seedCard(s, {
    id: 302,
    name: "Oracle Carousel Item Three",
    dbContent: "item three body",
  });
  await seedCard(s, {
    id: 303,
    name: "Oracle Carousel Probe",
    dbContent:
      "Oracle Carousel Item One\nOracle Carousel Item Two\nOracle Carousel Item Three",
    typeId: 500,
  });

  await seedCard(s, {
    id: 304,
    name: "Oracle Customize Skin Probe",
    dbContent: "skin css body",
    typeId: 500,
  });

  await seedCard(s, {
    id: 250,
    name: "Non Skin Probe",
    dbContent: "non skin body",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-bootstrap through the mod loader", () => {

  it("WITHOUT the mod: the mod-specific views are unsupported", async () => {
    const s = storage!;
    await expect(s.engine.render("Progress Numeric", "progress_bar")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Icon Reference", "icons")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  describe(":progress_bar", () => {
    beforeAll(() => {
      const s = storage!;
      loader = new ModLoader([{ manifest: cardModBootstrap }]);
      loader.load();
    });

    it("renders the div.progress > div.progress-bar structure for numeric content", async () => {
      const s = storage!;
      const html = await s.engine.render("Progress Numeric", "progress_bar");

      expect(html).toContain('<div class="progress">');
      expect(html).toContain('<div class="progress-bar"');
      expect(html).toContain('role="progressbar"');

      expect(html).toContain('style="width: 42%"');
      expect(html).toContain('aria-valuenow="42"');
      expect(html).toContain('aria-valuemin="0"');
      expect(html).toContain('aria-valuemax="100"');

      expect(html).toContain('<span class="progress-value">42%</span>');
    });

    it("clamps an out-of-range value to 100%", async () => {

      const s = storage!;
      const html = await s.engine.render("Progress OutOfRange", "progress_bar");
      expect(html).toContain('style="width: 150%"');
      expect(html).toContain('aria-valuenow="150"');
    });

    it("renders the zero case (progress_bar.rb accepts value: 0)", async () => {
      const s = storage!;
      const html = await s.engine.render("Progress Zero", "progress_bar");
      expect(html).toContain('style="width: 0%"');
      expect(html).toContain('aria-valuenow="0"');
    });

    it("renders the decimal case (Number() accepts 12.5 -> 12.5)", async () => {
      const s = storage!;
      const html = await s.engine.render("Progress Decimal", "progress_bar");
      expect(html).toContain('style="width: 12.5%"');

      expect(html).toContain('<span class="progress-value">13%</span>');
    });

    it("renders the bootstrap error message for non-numeric content", async () => {

      const s = storage!;
      const html = await s.engine.render("Progress NonNumeric", "progress_bar");
      expect(html).toBe(
        "Only card with numeric content can be shown as progress bar.",
      );
    });

    it("renders the bootstrap error message for empty content", async () => {
      const s = storage!;
      const html = await s.engine.render("Progress Empty", "progress_bar");
      expect(html).toBe(
        "Only card with numeric content can be shown as progress bar.",
      );
    });

    it("does NOT include a div.progress wrapper for the error branch", async () => {
      const s = storage!;
      const html = await s.engine.render("Progress NonNumeric", "progress_bar");
      expect(html).not.toContain('<div class="progress">');
      expect(html).not.toContain("progress-bar");
    });
  });

  describe(":icons", () => {
    it("renders the icon-library reference table (3 columns, 3 libraries)", async () => {

      const s = storage!;
      const html = await s.engine.render("Icon Reference", "icons");

      expect(html).toMatch(/^<table>/);
      expect(html).toContain("<th>lookup key</th>");

      expect(html).toContain("<th>material</th>");
      expect(html).toContain("<th>font_awesome</th>");
      expect(html).toContain("<th>bootstrap</th>");
    });

    it("renders each icon key as a row, with the library-specific mapping", async () => {

      const s = storage!;
      const html = await s.engine.render("Icon Reference", "icons");
      const plusRow = extractRow(html, "plus");
      expect(plusRow).not.toBeNull();
      const cells = plusRow!.match(/<td>([^<]*)<\/td>/g);
      expect(cells).not.toBeNull();

      expect(cells!.length).toBe(4);
      expect(cells![0]).toBe("<td>plus</td>");
      expect(cells![1]).toBe("<td>add</td>");
      expect(cells![2]).toBe("<td>plus</td>");
      expect(cells![3]).toBe("<td>plus-lg</td>");
    });

    it("renders &nbsp; for keys absent from a library", async () => {

      const s = storage!;
      const html = await s.engine.render("Icon Reference", "icons");
      const row = extractRow(html, "full_page");
      expect(row).not.toBeNull();
      const cells = row!.match(/<td>([^<]*)<\/td>/g);
      expect(cells).not.toBeNull();
      expect(cells![1]).toBe("<td>open_in_full</td>");
      expect(cells![2]).toBe("<td>&nbsp;</td>");
      expect(cells![3]).toBe("<td>&nbsp;</td>");
    });
  });

  describe(":one_line_content", () => {
    it("renders the empty string (the bootswatch_skin override)", async () => {

      const s = storage!;
      const html = await s.engine.render(
        "Bootswatch Skin Probe",
        "one_line_content",
      );

      expect(typeof html).toBe("string");
    });

    it("registers the :one_line_content override in the load report", () => {
      const report = loader!.load();

      expect(report.registeredViews).toContain("one_line_content");
    });
  });

  describe(":input", () => {
    it("renders the literal 'stored in file' message when the skin has no parent", async () => {

      const s = storage!;
      const html = await s.engine.render("Cerulean Skin", "input");
      expect(html).toBe(
        "Content is stored in file and can't be edited.",
      );
    });

    it("registers the :input view in the load report", () => {
      const report = loader!.load();
      expect(report.registeredViews).toContain("input");
    });
  });

  describe(":customize_button", () => {
    beforeAll(() => {
      const s = storage!;
      loader = new ModLoader([{ manifest: cardModBootstrap }]);
      loader.load();
    });

    it("renders the button-link with the literal card/create URL when the skin has no parent", async () => {

      const s = storage!;
      const html = await s.engine.render(
        "Cerulean Skin",
        "customize_button",
      );
      expect(html).toContain('href="/card/create?');

      expect(html).toContain(
        "card%5Bfields%5D%5Bparent%5D=Cerulean+Skin&amp;card%5Bname%5D=Cerulean+Skin+customized&amp;card%5Btype%5D=bootswatch_skin&amp;mark=Cerulean+Skin+customized",
      );

      expect(html).toContain(
        'class="btn btn-sm btn-outline-primary me-2 wanted-card"',
      );
      expect(html).toContain(">Customize</a>");
    });

    it("WITH the mod + the A/B oracle probe: byte-equal to the captured Ruby bytes", async () => {

      const s = storage!;
      const html = await s.engine.render(
        "Oracle Customize Skin Probe",
        "customize_button",
      );
      expect(html).toBe(
        FIXTURE.rendered["Oracle Customize Skin Probe#customize_button"],
      );
    });

    it("returns the empty string when the skin has a +parent subcard", async () => {

      const s = storage!;

      await s.engine.prepareItemForRender("Cerulean Skin Customized+parent");
      const html = await s.engine.render(
        "Cerulean Skin Customized",
        "customize_button",
      );
      expect(html).toBe("");
    });

    it("throws UnsupportedViewError for non-bootswatch_skin cards", async () => {

      const s = storage!;
      await expect(
        s.engine.render("Non Skin Probe", "customize_button"),
      ).rejects.toThrow(UnsupportedViewError);
    });

    it("registers the :customize_button view in the load report", () => {
      const report = loader!.load();
      expect(report.registeredViews).toContain("customize_button");

      const cache = loader!.viewConfigFor("customize_button")?.cache;
      expect(cache).toBe("never");
    });
  });

  describe(":carousel", () => {

    beforeAll(async () => {
      const s = storage!;
      loader = new ModLoader([{ manifest: cardModBootstrap }]);
      loader.load();
      await s.engine.prepareItemForRender("Oracle Carousel Item One");
      await s.engine.prepareItemForRender("Oracle Carousel Item Two");
      await s.engine.prepareItemForRender("Oracle Carousel Item Three");
      await s.engine.prepareItemForRender("Oracle Carousel Probe");
    });

    it("renders the div.carousel.slide container with the bootstrap-docs structure", async () => {
      const s = storage!;
      const html = await s.engine.render("Oracle Carousel Probe", "carousel");

      expect(html).toContain('<div class="carousel slide"');

      expect(html).toContain('id="oracle_carousel_probe-1"');
      expect(html).toContain('data-bs-ride="true"');

      expect(html).toContain('<div class="carousel-indicators">');
      expect(html).toContain(
        '<button data-bs-slide-to="0" data-bs-target="#oracle_carousel_probe-1" type="button" aria-label="Slide 1" class="active"/>',
      );
      expect(html).toContain(
        '<button data-bs-slide-to="1" data-bs-target="#oracle_carousel_probe-1" type="button" aria-label="Slide 2"/>',
      );
      expect(html).toContain(
        '<button data-bs-slide-to="2" data-bs-target="#oracle_carousel_probe-1" type="button" aria-label="Slide 3"/>',
      );

      expect(html).toContain('<div class="carousel-inner">');
      expect(html).toContain('<div class="carousel-item active">item one body</div>');
      expect(html).toContain('<div class="carousel-item">item two body</div>');
      expect(html).toContain('<div class="carousel-item">item three body</div>');

      expect(html).toContain(
        '<button class="carousel-control-prev" data-bs-target="#oracle_carousel_probe-1" type="button">',
      );
      expect(html).toContain('<span class="carousel-control-prev-icon" aria-hidden="true"></span>');
      expect(html).toContain('<span class="visually-hidden">Previous</span>');
      expect(html).toContain(
        '<button class="carousel-control-next" data-bs-target="#oracle_carousel_probe-1" type="button">',
      );
      expect(html).toContain('<span class="carousel-control-next-icon" aria-hidden="true"></span>');
      expect(html).toContain('<span class="visually-hidden">Next</span>');
    });

    it("WITH the mod + the A/B oracle probe: byte-equal to the captured Ruby bytes", async () => {

      const s = storage!;
      const html = await s.engine.render("Oracle Carousel Probe", "carousel");
      expect(html).toBe(
        FIXTURE.rendered["Oracle Carousel Probe#carousel"],
      );
    });

    it("registers the :carousel view in the load report", () => {
      const report = loader!.load();
      expect(report.registeredViews).toContain("carousel");
    });
  });

  describe("popoverLink (set/all/bootstrap/helper.rb:41-57)", () => {
    it("emits the icon_tag :help anchor with the data-bs-toggle=popover default", () => {

      const html = popoverLink("click me for help");
      expect(html).toContain('href="#"');
      expect(html).toContain('class="ps-1 _popover_link"');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('data-bs-toggle="popover"');
      expect(html).toContain('data-bs-trigger="hover focus"');
      expect(html).toContain('data-bs-content="click me for help"');

      expect(html).toContain(
        '<i class="notranslate material-icons">help</i>',
      );

      expect(html).not.toContain("data-bs-title");
    });

    it("renders data-bs-title only when title is supplied", () => {
      const html = popoverLink("body", "Help title");
      expect(html).toContain('data-bs-title="Help title"');
      expect(html).toContain('data-bs-content="body"');
    });

    it("substitutes &nbsp; when text is blank (helper.rb:48 present? gate)", () => {
      const html = popoverLink("");
      expect(html).toContain('data-bs-content="&nbsp;"');
    });

    it("uses an explicit linkText when provided", () => {
      const html = popoverLink("body", undefined, "<strong>?</strong>");

      expect(html).toContain("<strong>?</strong>");
      expect(html).not.toContain("notranslate material-icons");
    });
  });

  describe("events surface (LANDED)", () => {
    it("load() injects setPath + modName on every event registration", () => {

      const registry = loader!.eventRegistry();
      expect(registry.size()).toBeGreaterThanOrEqual(4);
      const allEvents = registry.all();

      const sf = registry.forEvent("update_skin_asset_input");
      expect(sf?.setPath).toBe("abstract/skin_field");
      expect(sf?.modName).toBe("bootstrap");
      expect(sf?.at).toBe("finalize");
      expect(sf?.on).toEqual(["save"]);

      const init = registry.forEvent("initialize_because_of_type_change");
      expect(init?.setPath).toBe("type/bootswatch_skin/events");
      expect(init?.modName).toBe("bootstrap");
      expect(init?.at).toBe("prepare_to_store");
      expect(init?.on).toEqual(["update"]);

      expect(init?.when).toBe("changed: type");

      const copy = registry.forEvent("copy_theme");
      expect(copy?.setPath).toBe("type/bootswatch_skin/events");
      expect(copy?.at).toBe("prepare_to_store");
      expect(copy?.on).toEqual(["create"]);

      const validate = registry.forEvent("validate_theme_template");
      expect(validate?.setPath).toBe("type/bootswatch_skin/events");
      expect(validate?.on).toEqual(["create"]);

      expect(allEvents.length).toBe(4);
      expect(allEvents[0]?.event).toBe("update_skin_asset_input");
      expect(allEvents[1]?.event).toBe("initialize_because_of_type_change");
      expect(allEvents[2]?.event).toBe("copy_theme");
      expect(allEvents[3]?.event).toBe("validate_theme_template");
    });

    it("forStage returns events at one stage, in registration order", () => {
      const registry = loader!.eventRegistry();

      expect(registry.forStage("finalize").map((e) => e.event)).toEqual([
        "update_skin_asset_input",
      ]);

      expect(
        registry.forStage("prepare_to_store").map((e) => e.event),
      ).toEqual(["initialize_because_of_type_change", "copy_theme"]);

      expect(registry.forStage("integrate")).toEqual([]);
    });

    it("the load report carries the registered event names", () => {
      const report = loader!.load();

      expect(report.registeredEvents).toContain("update_skin_asset_input");
      expect(report.registeredEvents).toContain(
        "initialize_because_of_type_change",
      );
      expect(report.registeredEvents).toContain("copy_theme");
      expect(report.registeredEvents).toContain("validate_theme_template");
    });
  });

  describe("set-module bookkeeping", () => {
    it("registers every set/ tree entry from the gem", () => {

      const basket = loader!.setModules();
      const all = [
        ...basket.base,
        ...basket.abstract,
        ...Array.from(basket.nonbase.values()).flat(),
      ].map((m) => m.shortname);

      expect(all).toContain("Abstract::ProgressBar");
      expect(all).toContain("All::Bootstrap::Icon");
      expect(all).toContain("Type::BootswatchSkin::HtmlViews");

      expect(all).toContain("TypePlusRight::BootswatchSkin::Colors");

      expect(all).toContain("All::Bootstrap::Accordion");
      expect(all).toContain("All::Bootstrap::Carousel");
      expect(all).toContain("All::Bootstrap::Dropdown");
      expect(all).toContain("All::Bootstrap::Form");
      expect(all).toContain("All::Bootstrap::Helper");
      expect(all).toContain("All::Bootstrap::Navbar");
      expect(all).toContain("All::Bootstrap::Table");
      expect(all).toContain("All::Bootstrap::Wrapper");
    });
  });

  it("the manifest declares the right name and group", () => {
    expect(cardModBootstrap.name).toBe("bootstrap");
    expect(cardModBootstrap.gemName).toBe("card-mod-bootstrap");
    expect(cardModBootstrap.group).toBe("gem-defaults");
  });
});

function extractRow(html: string, key: string): string | null {
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g);
  if (rows === null) return null;
  for (const row of rows) {
    if (row.startsWith(`<tr><td>${key}</td>`)) return row;
  }
  return null;
}
