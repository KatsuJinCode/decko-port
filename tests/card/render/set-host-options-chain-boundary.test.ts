

import { describe, expect, it } from "vitest";
import { createRenderTestStorage, seedCard, type RenderTestStorage } from "./render-test-storage.js";

async function seedCardtypes(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 2, name: "Basic", codename: "basic", typeId: 2 });
  await seedCard(s, { id: 5, name: "Cardtype", codename: "cardtype", typeId: 5 });
  await seedCard(s, { id: 30, name: "Search", codename: "search_type", typeId: 5 });
  await seedCard(s, { id: 47, name: "List", codename: "list", typeId: 5 });
  await seedCard(s, { id: 259, name: "Set", codename: "set", typeId: 5 });
  await seedCard(s, { id: 34840, name: "Pointer", codename: "pointer", typeId: 5 });
}

async function seedSettings(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 700, name: "*right", typeId: 2 });
  await seedCard(s, { id: 701, name: "*content options", typeId: 2 });
  await seedCard(s, { id: 717, name: "*self", typeId: 2 });
  await seedCard(s, { id: 718, name: "*structure", typeId: 2 });
  await seedCard(s, { id: 719, name: "*default", typeId: 2 });
  await seedCard(s, { id: 720, name: "*help", typeId: 2 });
  await seedCard(s, { id: 274, name: "*all", codename: "all", typeId: 259, dbContent: "fr" });
}

async function captureError(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected the render to raise");
}

describe("set-host rules-editor options-chain boundary", () => {
  it(":open of a set host raises via the *content options rule walk with the rule's content", async () => {

    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);

      await seedCard(s, { id: 7000, name: "*all+*self", leftId: 274, rightId: 717, typeId: 259, dbContent: "qhmdkcvehcrhiuzs" });

      await seedCard(s, { id: 7001, name: "*self+*right", leftId: 717, rightId: 700, typeId: 259, dbContent: "" });

      await seedCard(s, { id: 7002, name: "*self+*right+*content options", leftId: 7001, rightId: 701, typeId: 30, dbContent: "garbage_cql_content" });
      const err = await captureError(() => s.engine.render("*all+*self", "open"));
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe("Invalid JSON search query: garbage_cql_content");
    } finally {
      s.close();
    }
  });

  it(":content of a set host fires the same gate (both views delegate to :core)", async () => {

    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 7010, name: "*all+*self", leftId: 274, rightId: 717, typeId: 259, dbContent: "qhmdkcvehcrhiuzs" });
      await seedCard(s, { id: 7011, name: "*self+*right", leftId: 717, rightId: 700, typeId: 259, dbContent: "" });
      await seedCard(s, { id: 7012, name: "*self+*right+*content options", leftId: 7011, rightId: 701, typeId: 30, dbContent: "garbage_content_for_content_view" });
      const err = await captureError(() => s.engine.render("*all+*self", "content"));
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe("Invalid JSON search query: garbage_content_for_content_view");
    } finally {
      s.close();
    }
  });

  it(":closed of a set host never consults the rules-editor chain", async () => {

    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 7020, name: "*all+*self", leftId: 274, rightId: 717, typeId: 259, dbContent: "qhmdkcvehcrhiuzs" });
      await seedCard(s, { id: 7021, name: "*self+*right", leftId: 717, rightId: 700, typeId: 259, dbContent: "" });
      await seedCard(s, { id: 7022, name: "*self+*right+*content options", leftId: 7021, rightId: 701, typeId: 30, dbContent: "garbage_for_closed_view" });
      const html = await s.engine.render("*all+*self", "closed");
      expect(typeof html).toBe("string");
    } finally {
      s.close();
    }
  });

  it("valid-JSON options content parses and the view renders without raising", async () => {

    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 7030, name: "*all+*self", leftId: 274, rightId: 717, typeId: 259, dbContent: "qhmdkcvehcrhiuzs" });
      await seedCard(s, { id: 7031, name: "*self+*right", leftId: 717, rightId: 700, typeId: 259, dbContent: "" });
      await seedCard(s, { id: 7032, name: "*self+*right+*content options", leftId: 7031, rightId: 701, typeId: 30, dbContent: '{"type":"Basic"}' });
      const html = await s.engine.render("*all+*self", "open");
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    } finally {
      s.close();
    }
  });

  it("Abstract::Permission set hosts are excluded from the gate", async () => {

    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);

      await seedCard(s, { id: 7040, name: "*read", codename: "read", typeId: 2 });

      await seedCard(s, { id: 7041, name: "*all+*read", leftId: 274, rightId: 7040, typeId: 259, dbContent: "fr" });
      await seedCard(s, { id: 7042, name: "*read+*right", leftId: 7040, rightId: 700, typeId: 259, dbContent: "" });
      await seedCard(s, { id: 7043, name: "*read+*right+*content options", leftId: 7042, rightId: 701, typeId: 30, dbContent: "garbage_for_permission_host" });
      const htmlOpen = await s.engine.render("*all+*read", "open");
      expect(typeof htmlOpen).toBe("string");
    } finally {
      s.close();
    }
  });

  it("empty content raises the distinct empty-query BadQuery (cql_search.rb:29-38 parity)", async () => {

    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);
      await seedCard(s, { id: 7060, name: "*all+*self", leftId: 274, rightId: 717, typeId: 259, dbContent: "qhmdkcvehcrhiuzs" });
      await seedCard(s, { id: 7061, name: "*self+*right", leftId: 717, rightId: 700, typeId: 259, dbContent: "" });
      await seedCard(s, { id: 7062, name: "*self+*right+*content options", leftId: 7061, rightId: 701, typeId: 30, dbContent: "" });
      const err = await captureError(() => s.engine.render("*all+*self", "open"));
      expect(err.constructor.name).toBe("Card::Error::BadQuery");
      expect(err.message).toBe("can't run search with empty content");
    } finally {
      s.close();
    }
  });

  it("a set host with no resolvable *content options rule chain renders normally", async () => {

    const s = await createRenderTestStorage();
    try {
      await seedCardtypes(s);
      await seedSettings(s);

      await seedCard(s, { id: 7070, name: "*all+*self", leftId: 274, rightId: 717, typeId: 259, dbContent: "qhmdkcvehcrhiuzs" });

      await seedCard(s, { id: 7071, name: "*self+*right", leftId: 717, rightId: 700, typeId: 259, dbContent: "" });

      await seedCard(s, { id: 7072, name: "*self+*right+*content options", leftId: 7071, rightId: 701, typeId: 30, dbContent: '{"type":"Basic"}' });
      const html = await s.engine.render("*all+*self", "open");
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    } finally {
      s.close();
    }
  });
});
