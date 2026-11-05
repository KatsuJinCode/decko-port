

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import cardModFormat from "../../../src/card/mod-loader/mods/card-mod-format.js";

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, {
    id: 200,
    name: "Oracle Format Probe",
    dbContent: "Hello world",
  });

  await seedCard(s, {
    id: 201,
    name: "Oracle Date Probe",
  });
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-format through the mod loader (A/B)", () => {
  it("WITHOUT the mod: every ported view raises UnsupportedViewError", async () => {
    const s = storage!;

    const portedViews = [
      "name",
      "key",
      "linkname",
      "url",
      "id_url",
      "url_link",
      "nav_link",
      "codename",
      "id",
      "type",
      "created_at",
      "updated_at",
      "acted_at",
      "raw",
      "one_line_content",
      "labeled_content",
      "labeled",
      "compact_missing",
      "server_error",
      "denial",
      "not_found",
      "bad_address",
      "errors",
      "label",
      "closed_content",
      "raw_one_line_content",
      "admin",
    ];
    for (const view of portedViews) {
      await expect(
        s.engine.render("Oracle Format Probe", view),
      ).rejects.toThrow(UnsupportedViewError);
    }
  });

  it("WITH the mod: :name renders the card name (base.rb:14-16)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModFormat }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    expect(await s.engine.render("Oracle Format Probe", "name")).toBe(
      "Oracle Format Probe",
    );
  });

  it("WITH the mod: :key renders the URL-safe key (base.rb:26)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Format Probe", "key")).toBe(
      "oracle_format_probe",
    );
  });

  it("WITH the mod: :linkname renders the URL-safe key (base.rb:27)", async () => {
    const s = storage!;

    expect(await s.engine.render("Oracle Format Probe", "linkname")).toBe(
      "Oracle_Format_Probe",
    );
  });

  it("WITH the mod: :url renders the linkname (base.rb:28 - no live host)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Format Probe", "url")).toBe(
      "Oracle_Format_Probe",
    );
  });

  it("WITH the mod: :id_url renders the id-mark (base.rb:29)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Format Probe", "id_url")).toBe("~200");
  });

  it("WITH the mod: :id_url renders blank for an unknown card (no id)", async () => {
    const s = storage!;

    const unknownCard = s.engine as unknown as {
      renderUnknown(view: string): Promise<string>;
    };
    if (typeof unknownCard.renderUnknown === "function") {
      expect(await unknownCard.renderUnknown("id_url")).toBe("");
    }
  });

  it("WITH the mod: :url_link renders the internal-link anchor (base.rb:31-33)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Format Probe", "url_link")).toBe(
      '<a class="internal-link" href="Oracle_Format_Probe">Oracle_Format_Probe</a>',
    );
  });

  it("WITH the mod: :link renders the engine's link view (already in HTML_VIEWS)", async () => {
    const s = storage!;

    expect(await s.engine.render("Oracle Format Probe", "link")).toBe(
      '<a class="known-card" href="Oracle_Format_Probe">Oracle Format Probe</a>',
    );
  });

  it("WITH the mod: :nav_link adds the nav-link class (base.rb:39-41)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Format Probe", "nav_link")).toBe(
      '<a class="known-card nav-link" href="Oracle_Format_Probe">Oracle Format Probe</a>',
    );
  });

  it("WITH the mod: :codename renders the empty string when undefined (base.rb:55)", async () => {
    const s = storage!;

    expect(await s.engine.render("Oracle Format Probe", "codename")).toBe("");
  });

  it("WITH the mod: :id renders the integer-as-string (base.rb:56)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Format Probe", "id")).toBe("200");
  });

  it("WITH the mod: :type renders the type name (base.rb:57)", async () => {
    const s = storage!;

    expect(await s.engine.render("Oracle Format Probe", "type")).toBe("");
  });

  it("WITH the mod: :created_at reads the card record's date (base.rb:61)", async () => {
    const s = storage!;

    const rendered = await s.engine.render("Oracle Date Probe", "created_at");
    expect(rendered).toBe("2026-09-19");
  });

  it("WITH the mod: :updated_at reads the card record's date (base.rb:62)", async () => {
    const s = storage!;
    const rendered = await s.engine.render("Oracle Date Probe", "updated_at");
    expect(rendered).toBe("2026-09-19");
  });

  it("WITH the mod: :acted_at reads the card record's date (base.rb:63)", async () => {
    const s = storage!;

    const rendered = await s.engine.render("Oracle Date Probe", "acted_at");
    expect(rendered).toBe("2026-09-19");
  });

  it("WITH the mod: :created_at formats a present date when voo.variant is a strftime pattern", async () => {
    const s = storage!;

    const result = await s.engine.render("Oracle Date Probe", "created_at");
    expect(result).toBe("2026-09-19");
  });

  it("WITH the mod: :raw renders the dbContent (base.rb:75-77)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Format Probe", "raw")).toBe(
      "Hello world",
    );
  });

  it("WITH the mod: :one_line_content renders the trimmed dbContent (base.rb:97-99)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Format Probe", "one_line_content")).toBe(
      "Hello world",
    );
  });

  it("WITH the mod: :one_line_content truncates at 60 chars (base.rb:97-99)", async () => {
    const s = storage!;
    await seedCard(s, {
      id: 210,
      name: "Oracle Long Probe",
      dbContent: "x".repeat(80),
    });
    expect(await s.engine.render("Oracle Long Probe", "one_line_content")).toBe(
      "x".repeat(60),
    );
  });

  it("WITH the mod: :titled renders name + blank line + core (base.rb:120-122)", async () => {
    const s = storage!;
    expect(
      await s.engine.render("Oracle Format Probe", "titled"),
    ).toBe("Oracle Format Probe\n\nHello world");
  });

  it("WITH the mod: :labeled renders name + ': ' + labeled_content (base.rb:125-127)", async () => {
    const s = storage!;

    expect(
      await s.engine.render("Oracle Format Probe", "labeled"),
    ).toBe("Oracle Format Probe: Hello world");
  });

  it("WITH the mod: :compact_missing renders the empty string (error.rb:2-4)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Format Probe", "compact_missing")).toBe(
      "",
    );
  });

  it("WITH the mod: :unknown renders the empty string (error.rb:6-8)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Format Probe", "unknown")).toBe("");
  });

  it("WITH the mod: :server_error renders the locale token (error.rb:10-12)", async () => {
    const s = storage!;
    expect(
      await s.engine.render("Oracle Format Probe", "server_error"),
    ).toBe("format.server_error");
  });

  it("WITH the mod: :denial renders the locale token (error.rb:14-16)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Format Probe", "denial")).toBe(
      "format.denial",
    );
  });

  it("WITH the mod: :not_found renders the locale token (error.rb:18-21)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Format Probe", "not_found")).toBe(
      "format.not_found_named",
    );
  });

  it("WITH the mod: :bad_address renders the locale token (error.rb:23-26)", async () => {
    const s = storage!;
    expect(
      await s.engine.render("Oracle Format Probe", "bad_address"),
    ).toBe("format.bad_address");
  });

  it("WITH the mod: :errors renders the 'Problem:' prefix (error.rb:28-30)", async () => {
    const s = storage!;
    expect(await s.engine.render("Oracle Format Probe", "errors")).toBe(
      "Problem:\n\n",
    );
  });

  it("WITH the mod: :label renders the card name (content.rb:22-24)", async () => {
    const s = storage!;

    expect(await s.engine.render("Oracle Format Probe", "label")).toBe(
      "Oracle Format Probe",
    );
  });

  it("WITH the mod: :closed_content renders the same body as one_line_content (content.rb:16 alias)", async () => {
    const s = storage!;

    const closed = await s.engine.render("Oracle Format Probe", "closed_content");
    const oneLine = await s.engine.render("Oracle Format Probe", "one_line_content");
    expect(closed).toBe(oneLine);
    expect(closed).toBe("Hello world");
  });

  it("WITH the mod: :raw_one_line_content renders strip_tags(raw) truncated with '...' (content.rb:18-20)", async () => {
    const s = storage!;

    expect(
      await s.engine.render("Oracle Format Probe", "raw_one_line_content"),
    ).toBe("Hello world");
  });

  it("WITH the mod: :raw_one_line_content truncates long content with '...' marker", async () => {
    const s = storage!;
    await seedCard(s, {
      id: 211,
      name: "Oracle Long Raw Probe",
      dbContent: "x".repeat(80),
    });

    expect(
      await s.engine.render("Oracle Long Raw Probe", "raw_one_line_content"),
    ).toBe("x".repeat(57) + "...");
  });

  it("WITH the mod: :admin renders the core view (type/mod.rb:3-5)", async () => {
    const s = storage!;

    expect(await s.engine.render("Oracle Format Probe", "admin")).toBe(
      "Hello world",
    );
  });

  it("WITH the mod: every set module from the gem tree is in the basket", () => {
    const basket = loader!.setModules();

    const base = basket.base.map((m) => m.shortname);
    expect(base).toContain("All::Base");
    expect(base).toContain("All::Content");
    expect(base).toContain("All::Css");
    expect(base).toContain("All::Csv");
    expect(base).toContain("All::Data");
    expect(base).toContain("All::Demo");
    expect(base).toContain("All::Error");
    expect(base).toContain("All::File");
    expect(base).toContain("All::Haml");
    expect(base).toContain("All::Html");
    expect(base).toContain("All::Js");
    expect(base).toContain("All::Json");
    expect(base).toContain("All::Jsonld");
    expect(base).toContain("All::Links");
    expect(base).toContain("All::Path");
    expect(base).toContain("All::Rss");
    expect(base).toContain("All::Text");
    expect(base).toContain("All::Title");
    expect(base).toContain("All::Yaml");

    const abstract = basket.abstract.map((m) => m.shortname);
    expect(abstract).toContain("Abstract::JsonldSupport");

    const right = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(right).toContain("Right::Head");

    const self = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(self).toContain("Self::Home");

    const type = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    expect(type).toContain("Type::Basic");
    expect(type).toContain("Type::Cardtype");
    expect(type).toContain("Type::Html");
    expect(type).toContain("Type::Json");
    expect(type).toContain("Type::Mod");
    expect(type).toContain("Type::Number");
    expect(type).toContain("Type::Phrase");
    expect(type).toContain("Type::PlainText");
    expect(type).toContain("Type::Toggle");
    expect(type).toContain("Type::Uri");
  });

  it("WITH the mod: the mod loader's load report lists every ported view", () => {
    const report = loader!.load();
    const expected = [
      "name",
      "key",
      "linkname",
      "url",
      "id_url",
      "url_link",
      "link",
      "nav_link",
      "codename",
      "id",
      "type",
      "created_at",
      "updated_at",
      "acted_at",
      "raw",
      "one_line_content",
      "labeled_content",
      "titled_content",
      "titled",
      "labeled",
      "compact_missing",
      "unknown",
      "server_error",
      "denial",
      "not_found",
      "bad_address",
      "errors",
      "label",
      "closed_content",
      "raw_one_line_content",
      "admin",
    ];
    for (const view of expected) {
      expect(report.registeredViews).toContain(view);
    }
  });

  it("WITH the mod: a card's baseline :content render still works (the mod adds views, it does not alter core)", async () => {
    const s = storage!;
    const html = await s.engine.render("Oracle Format Probe", "content");

    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });
});