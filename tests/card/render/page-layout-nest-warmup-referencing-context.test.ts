// Cold page render: the LAYOUT body's nest targets and their content
// references must warm with the REFERENCING card as the relative-name
// context (nitpicks lane defect 2 companion fix).
//
// Failure shape (observed on the real /Aikido_Oak_Cliff cold render, the
// operator's "page ends early" class): *footer nests {{:credit|core}};
// *credit's content nests {{+:image|core}} - a junction row
// (*credit+*image) whose db row stores a NULL key column. warmUpLayoutNests
// resolved every reference against the PAGE name, so the +image reference
// warmed as "Aikido Oak Cliff+image" (a spurious name), the real sync nest
// fetch (fetchRenderCard, prepared-cards-only) missed the junction, and
// the cold page's footer rendered the svg nest EMPTY. A second (warm)
// render was full. The fix carries each queued name's referencing card
// through the worklist; this test pins the cold render byte.
//
// The live receipt: fresh capture tmp/wrong-goal-hunt/captures/
// live-fresh-Aikido_Oak_Cliff.html renders the full b&w_logo svg inside
// the *footer credit nest; the pre-fix cold page rendered
// `<svg ...>\n  \n<a ...>Decko v</a>` with the svg body gone.

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
  // Codename anchors the set-pattern walk and codename marks resolve on.
  // *credit carries its content directly (it is the codename anchor).
  // The Basic cardtype card (id 2) carries codename "basic" - the layout
  // card's type check reads it (layout/html/basic -> card layout).
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
  // Head-path setting cards: globalSettingContent parses ":<codename>" marks
  // (unknown codenames throw at parse), so the head's settings must exist.
  await seedCard(storage, { id: 904, name: "*title", codename: "title", typeId: 2 });
  await seedCard(storage, { id: 905, name: "*favicon", codename: "favicon", typeId: 2 });
  await seedCard(storage, { id: 906, name: "*ace", codename: "ace", typeId: 2 });
  await seedCard(storage, { id: 907, name: "*tiny_mce", codename: "tiny_mce", typeId: 2 });
  // The *layout rule on *all: names the layout card (first raw item line).
  await seedCard(storage, {
    id: 910,
    leftId: 900,
    rightId: 901,
    typeId: 2,
    dbContent: "Probe Layout",
  });
  // The layout card: main slot + the credit nest (codename mark).
  await seedCard(storage, {
    id: 911,
    name: "Probe Layout",
    typeId: 2,
    dbContent: "{{_main|titled}}\n{{:credit|core}}",
  });
  // The junction *credit+*image: NULL name/key, composed by left/right ids.
  await seedCard(storage, {
    id: 913,
    leftId: 902,
    rightId: 903,
    typeId: 2,
    dbContent: SVG_BODY,
  });
  // The page card.
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
    // The main body landed through {{_main|titled}}.
    expect(page).toContain('<div id="main">');
    expect(page).toContain("<p>the body</p>");
    // The *credit nest rendered - not the empty-nest substitution.
    expect(page).toContain('href="http://decko.org"');
    // THE PIN: the junction *credit+*image resolved COLD - the svg body
    // bytes are present (pre-fix the footer carried only the literal
    // anchor line; the svg nest rendered empty).
    expect(page).toContain("<title>b&amp;w_logo</title>");
    expect(page).toContain("</svg>");
  });
});
