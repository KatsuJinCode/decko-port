

import { describe, expect, it } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
  type SeedOptions,
} from "./render-test-storage.js";
import {
  structureRuleUniverseStatement,
  structureUniverseFromResults,
  structureRuleTypesFromResults,
} from "../../../src/card/rules/structure.js";
import { createVirtualCardLookup } from "../../../src/card/fetch/virtual-cards.js";

const BASIC_TYPE_ID = 3;
const SET_TYPE_ID = 4;

async function seedCorpusShapedDeck(): Promise<RenderTestStorage> {
  const storage = await createRenderTestStorage();
  const seed = (opts: SeedOptions) => seedCard(storage, opts);

  seed({ id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  seed({ id: 2, name: "*read", codename: "read", typeId: SET_TYPE_ID });
  seed({ id: 3, name: "orvipveb", codename: "basic", typeId: 5 });
  seed({ id: 4, name: "exi", codename: "set", typeId: 5 });
  seed({ id: 5, name: "*structure", codename: "structure", typeId: SET_TYPE_ID });
  seed({ id: 6, name: "*right", codename: "right", typeId: SET_TYPE_ID });
  seed({ id: 7, name: "*self", codename: "self", typeId: SET_TYPE_ID });
  seed({ id: 8, name: "Anonymous", codename: "anonymous", typeId: BASIC_TYPE_ID });
  seed({ id: 9, name: "anyone", codename: "anyone", typeId: BASIC_TYPE_ID });
  seed({ id: 20, name: "Role_A1", typeId: BASIC_TYPE_ID });

  seed({ id: 30, name: "*all+*read", leftId: 1, rightId: 2, typeId: SET_TYPE_ID, dbContent: "anyone" });
  await seedReference(storage, 30, 9, "anyone");

  seed({ id: 40, name: "ylfetacflzl", typeId: BASIC_TYPE_ID, dbContent: "left body" });
  seed({ id: 41, name: "ytyovdhppytn", typeId: BASIC_TYPE_ID, dbContent: "right body" });

  seed({ id: 50, name: "ytyovdhppytn+*right", leftId: 41, rightId: 6, typeId: SET_TYPE_ID });
  seed({
    id: 51,
    name: "ytyovdhppytn+*right+*structure",
    leftId: 50,
    rightId: 5,
    typeId: BASIC_TYPE_ID,
    dbContent: "<p>{{xxxx}}</p>",
  });

  seed({ id: 53, name: "*self+*right", leftId: 7, rightId: 6, typeId: SET_TYPE_ID });
  seed({ id: 52, name: "*self+*right+*structure", leftId: 53, rightId: 5, typeId: SET_TYPE_ID, dbContent: "crgazjzllxoccqgh" });

  seed({ id: 60, name: "ylfetacflzl+ytyovdhppytn", typeId: BASIC_TYPE_ID, dbContent: "<p>{{xxxx}}</p>" });

  seed({
    id: 61,
    name: "ylfetacflzl+ytyovdhppytn+*self+*read",
    rightId: 2,
    typeId: SET_TYPE_ID,
    dbContent: "Role_A1",
  });
  await seedReference(storage, 61, 9, "anyone");

  seed({ id: 62, name: "*all plus+*read", rightId: 2, typeId: SET_TYPE_ID, dbContent: "Role_A1" });
  await seedReference(storage, 62, 20, "role_a1");

  const result = await storage.fetcher.driver.batch([structureRuleUniverseStatement()]);
  storage.fetcher.virtualCardLookup = createVirtualCardLookup(storage.fetcher, {
    contents: structureUniverseFromResults(result[0]),
    ruleTypeIds: structureRuleTypesFromResults(result[0]),
  });
  return storage;
}

describe("virtual-card fetch (states.rb#virtual?)", () => {
  it("fetchByName resolves an orphan junction name as the virtual card: rule template content + rule card type", async () => {
    const storage = await seedCorpusShapedDeck();
    try {
      const card = await storage.fetcher.fetchByName("ylfetacflzl+ytyovdhppytn");
      expect(card).toBeDefined();
      expect(card?.id).toBeUndefined();
      expect(card?.isNew).toBe(true);
      expect(card?.name?.s).toBe("ylfetacflzl+ytyovdhppytn");
      expect(card?.key).toBe("ylfetacflzl+ytyovdhppytn");
      expect(card?.typeId).toBe(BASIC_TYPE_ID);
      expect(card?.dbContent).toBe("<p>{{xxxx}}</p>");
    } finally {
      storage.close();
    }
  });

  it("the +*self name takes the *self+*right rule's Set type", async () => {
    const storage = await seedCorpusShapedDeck();
    try {
      const card = await storage.fetcher.fetchByName("ylfetacflzl+ytyovdhppytn+*self");
      expect(card).toBeDefined();
      expect(card?.typeId).toBe(SET_TYPE_ID);
      expect(card?.dbContent).toBe("crgazjzllxoccqgh");
    } finally {
      storage.close();
    }
  });

  it("skip_virtual (Card[]) still returns nil for the virtual name", async () => {
    const storage = await seedCorpusShapedDeck();
    try {
      const card = await storage.fetcher.bracket("ylfetacflzl+ytyovdhppytn");
      expect(card).toBeUndefined();
    } finally {
      storage.close();
    }
  });

  it("a compound name under no structure rule stays unknown (fetch nil)", async () => {
    const storage = await seedCorpusShapedDeck();
    try {
      const card = await storage.fetcher.fetchByName("ylfetacflzl+never_structured");
      expect(card).toBeUndefined();
    } finally {
      storage.close();
    }
  });
});

describe("virtual-card render (the denied-view contract)", () => {
  it("closed/content/open render the quiet denial; title renders", async () => {
    const storage = await seedCorpusShapedDeck();
    try {
      const denied = '<span class="denied"><!-- Sorry, you don\'t have permission (read) --></span>';
      expect(await storage.engine.render("ylfetacflzl+ytyovdhppytn", "closed")).toBe(denied);
      expect(await storage.engine.render("ylfetacflzl+ytyovdhppytn", "content")).toBe(denied);
      expect(await storage.engine.render("ylfetacflzl+ytyovdhppytn", "open")).toBe(denied);
      const title = await storage.engine.render("ylfetacflzl+ytyovdhppytn", "title");
      expect(title).toContain('class="card-title" title="ylfetacflzl+ytyovdhppytn"');
    } finally {
      storage.close();
    }
  });
});
