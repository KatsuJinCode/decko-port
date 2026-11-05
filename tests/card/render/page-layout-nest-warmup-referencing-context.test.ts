

import { describe, expect, it } from "vitest";
import { renderPageBytes } from "../../../src/card/render/page.js";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

const SVG_BODY =
  '<svg style="width:18px; height:14px;" viewBox="0 0 242 220">\n' +
  "  <title>b&amp;w_logo</title>\n" +
  "  <desc>Created with Sketch.</desc>\n" +
  "</svg>";

async function seedLayoutDeck(): ReturnType<typeof createRenderTestStorage> {
  const storage = await createRenderTestStorage();

  await seedCard(storage, { id: 2, name: "Basic", codename: "basic", typeId: 2 });
  await seedCard(storage, { id: 900, name: "*all", codename: "all", typeId: 2 });
  await seedCard(storage, { id: 901, name: "*layout", codename: "layout", typeId: 2 });
  await seedCard(storage, {
    id: 902,
    name: "*credit",
    codename: "credit",
    typeId: 2,
    dbContent: "{{+:image|core}}\n" + '<a href="http://decko.org">Decko v</a>',
  });
  await seedCard(storage, { id: 903, name: "*image", codename: "image", typeId: 2 });

  await seedCard(storage, { id: 904, name: "*title", codename: "title", typeId: 2 });
  await seedCard(storage, { id: 905, name: "*favicon", codename: "favicon", typeId: 2 });
  await seedCard(storage, { id: 906, name: "*ace", codename: "ace", typeId: 2 });
  await seedCard(storage, { id: 907, name: "*tiny_mce", codename: "tiny_mce", typeId: 2 });

  await seedCard(storage, {
    id: 910,
    leftId: 900,
    rightId: 901,
    typeId: 2,
    dbContent: "Probe Layout",
  });

  await seedCard(storage, {
    id: 911,
    name: "Probe Layout",
    typeId: 2,
    dbContent: "{{_main|titled}}\n{{:credit|core}}",
  });

  await seedCard(storage, {
    id: 913,
    leftId: 902,
    rightId: 903,
    typeId: 2,
    dbContent: SVG_BODY,
  });

  await seedCard(storage, {
    id: 914,
    name: "Probe Page",
    typeId: 2,
    dbContent: "<p>the body</p>",
  });
  await storage.fetcher.codenames.ensureLoaded();
  storage.fetcher.installNameEnvironment();
  return storage;
}

describe("cold layout warm-up: referencing-context relative resolution", () => {
  it("renders the footer credit junction svg on the FIRST (cold) page render", async () => {
    const storage = await seedLayoutDeck();
    const page = await renderPageBytes(storage.engine, "Probe Page");

    expect(page).toContain('<div id="main">');
    expect(page).toContain("<p>the body</p>");

    expect(page).toContain('href="http://decko.org"');

    expect(page).toContain("<title>b&amp;w_logo</title>");
    expect(page).toContain("</svg>");
  });
});
