

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

const SET_TYPE_ID = 3;
const TYPE_TYPE_ID = 4;
const RICHTEXT_TYPE_ID = 4;
const SETTING_TYPE_ID = 4;

async function seedStructuredChildDeck(): Promise<RenderTestStorage> {
  const storage = await createRenderTestStorage();
  const seed = (opts: SeedOptions): void => void seedCard(storage, opts);

  seed({ id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  seed({ id: 2, name: "*read", codename: "read", typeId: SET_TYPE_ID });
  seed({ id: 3, name: "Set", codename: "set", typeId: TYPE_TYPE_ID });
  seed({ id: 4, name: "RichText", codename: "basic", typeId: TYPE_TYPE_ID });
  seed({ id: 5, name: "*structure", codename: "structure", typeId: SETTING_TYPE_ID });
  seed({ id: 6, name: "*right", codename: "right", typeId: SETTING_TYPE_ID });
  seed({ id: 7, name: "*type plus right", codename: "type_plus_right", typeId: SETTING_TYPE_ID });
  seed({ id: 8, name: "Anonymous", codename: "anonymous", typeId: TYPE_TYPE_ID });
  seed({ id: 9, name: "anyone", codename: "anyone", typeId: TYPE_TYPE_ID });

  seed({ id: 30, name: "*all+*read", leftId: 1, rightId: 2, typeId: SET_TYPE_ID, dbContent: "anyone" });
  await seedReference(storage, 30, 9, "anyone");

  seed({ id: 31, name: "*all plus+*read", rightId: 2, typeId: SET_TYPE_ID, dbContent: "_left" });

  seed({ id: 20, name: "ProjectT", typeId: TYPE_TYPE_ID });
  seed({ id: 40, name: "HostA", typeId: 20, dbContent: "<p>{{+legacy|closed}}</p>" });

  seed({ id: 41, name: "legacy", typeId: TYPE_TYPE_ID });

  seed({ id: 50, name: "ProjectT+legacy", leftId: 20, rightId: 41, typeId: SET_TYPE_ID });
  seed({ id: 51, name: "ProjectT+legacy+*type plus right", leftId: 50, rightId: 7, typeId: SET_TYPE_ID });

  seed({
    id: 52,
    name: "ProjectT+legacy+*type plus right+*structure",
    leftId: 51,
    rightId: 5,
    typeId: RICHTEXT_TYPE_ID,
    dbContent: "<p>{{_left+Description}}</p>",
  });

  const result = await storage.fetcher.driver.batch([structureRuleUniverseStatement()]);
  storage.fetcher.virtualCardLookup = createVirtualCardLookup(storage.fetcher, {
    contents: structureUniverseFromResults(result[0]),
    ruleTypeIds: structureRuleTypesFromResults(result[0]),
  });
  return storage;
}

async function seedLeftDelegationDeck(): Promise<RenderTestStorage> {
  const storage = await createRenderTestStorage();
  const seed = (opts: SeedOptions): void => void seedCard(storage, opts);

  seed({ id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  seed({ id: 2, name: "*read", codename: "read", typeId: SET_TYPE_ID });
  seed({ id: 3, name: "Set", codename: "set", typeId: SET_TYPE_ID });
  seed({ id: 13, name: "*self", codename: "self", typeId: SET_TYPE_ID });
  seed({ id: 4, name: "Basic", typeId: TYPE_TYPE_ID });
  seed({ id: 8, name: "Anonymous", codename: "anonymous", typeId: TYPE_TYPE_ID });
  seed({ id: 9, name: "anyone", codename: "anyone", typeId: TYPE_TYPE_ID });
  seed({ id: 11, name: "Role_A", typeId: TYPE_TYPE_ID });

  seed({ id: 30, name: "*all+*read", leftId: 1, rightId: 2, typeId: SET_TYPE_ID, dbContent: "anyone" });
  await seedReference(storage, 30, 9, "anyone");
  seed({ id: 31, name: "*all plus+*read", rightId: 2, typeId: SET_TYPE_ID, dbContent: "_left" });

  seed({ id: 32, name: "HostC+*self+*read", leftId: 33, rightId: 2, typeId: SET_TYPE_ID, dbContent: "Role_A" });
  await seedReference(storage, 32, 11, "role_a");

  seed({ id: 33, name: "HostC", typeId: TYPE_TYPE_ID, dbContent: "denied host body" });
  seed({ id: 34, name: "HostB", typeId: TYPE_TYPE_ID, dbContent: "readable host body" });
  seed({ id: 12, name: "child", typeId: TYPE_TYPE_ID });

  seed({ id: 35, name: "HostB+child", leftId: 34, rightId: 12, typeId: TYPE_TYPE_ID, dbContent: "readable child body" });
  seed({ id: 36, name: "HostC+child", leftId: 33, rightId: 12, typeId: TYPE_TYPE_ID, dbContent: "denied child body" });
  return storage;
}

describe("structured/missing children: the typed new-card view (PCTS+legacy class)", () => {
  it("renders the missing +legacy nest as the typed virtual child, not a denial", async () => {
    const storage = await seedStructuredChildDeck();
    try {
      storage.fetcher.installNameEnvironment();
      const html = await storage.engine.render("HostA", "content");

      expect(html).not.toContain('class="denied"');

      expect(html).toContain('data-card-name="HostA+legacy"');
      expect(html).toContain(`data-card-type-id="${RICHTEXT_TYPE_ID}"`);
      expect(html).toContain('data-card-type-name="RichText"');
      expect(html).toContain("closed-view ALL ALL_PLUS TYPE-rich_text RIGHT-legacy TYPE_PLUS_RIGHT-project_t-legacy");
      expect(html).not.toContain("SELF-host_a-legacy");
    } finally {
      storage.close();
    }
  });

  it("fetchByName still resolves the child as the virtual card: template content + rule type", async () => {
    const storage = await seedStructuredChildDeck();
    try {
      storage.fetcher.installNameEnvironment();
      const card = await storage.fetcher.fetchByName("HostA+legacy");
      expect(card).toBeDefined();
      expect(card?.id).toBeUndefined();
      expect(card?.isNew).toBe(true);
      expect(card?.typeId).toBe(RICHTEXT_TYPE_ID);
      expect(card?.dbContent).toBe("<p>{{_left+Description}}</p>");
    } finally {
      storage.close();
    }
  });
});

describe("the _left read-rule delegation (permissions.rb:52-72)", () => {
  it("a compound row without read_rule_id reads through its left card's rule", async () => {
    const storage = await seedLeftDelegationDeck();
    try {
      storage.fetcher.installNameEnvironment();
      const html = await storage.engine.render("HostB+child", "content");
      expect(html).not.toContain('class="denied"');
      expect(html).toContain("readable child body");
      const host = await storage.engine.render("HostB", "content");
      expect(host).toContain("readable host body");
    } finally {
      storage.close();
    }
  });

  it("the delegation follows a DENIED left card to the denial span", async () => {
    const storage = await seedLeftDelegationDeck();
    try {
      storage.fetcher.installNameEnvironment();

      const host = await storage.engine.render("HostC", "content");
      expect(host).toContain('class="denied"');

      const html = await storage.engine.render("HostC+child", "content");
      expect(html).toContain('class="denied"');
      expect(html).not.toContain("denied child body");
    } finally {
      storage.close();
    }
  });
});
