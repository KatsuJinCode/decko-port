

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { quietDenial } from "../../../src/card/permissions/index.js";

const SET_TYPE_ID = 2;
const BASIC_TYPE_ID = 4;

let storage: RenderTestStorage | undefined;

let ruleless: RenderTestStorage | undefined;

async function seedPermissionDeck(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 2, name: "Set", codename: "set" });
  await seedCard(s, { id: 3, name: "*read", codename: "read" });
  await seedCard(s, { id: 4, name: "Basic" });
  await seedCard(s, { id: 5, name: "Anyone", codename: "anyone" });
  await seedCard(s, { id: 6, name: "Anonymous", codename: "anonymous" });
  await seedCard(s, { id: 7, name: "Role A" });

  await seedCard(s, { id: 15, name: "*type", codename: "type" });
  await seedCard(s, { id: 16, name: "*self", codename: "self" });

  await seedCard(s, {
    id: 8, leftId: 1, rightId: 3, dbContent: "[[Anyone]]",
  });
  await seedReference(s, 8, 5, "anyone");

  await seedCard(s, { id: 9, leftId: 4, rightId: 15, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 10, leftId: 9, rightId: 3, dbContent: "[[Role A]]" });
  await seedReference(s, 10, 7, "role_a");

  await seedCard(s, {
    id: 11, name: "Readable Thing", typeId: BASIC_TYPE_ID,
    dbContent: "readable body", readRuleId: 8, readRuleClass: "*all",
  });
  await seedCard(s, {
    id: 12, name: "Secret Thing", typeId: BASIC_TYPE_ID,
    dbContent: "secret body", readRuleId: 10, readRuleClass: "*type",
  });
  await seedCard(s, {
    id: 13, name: "Page With Secret", typeId: BASIC_TYPE_ID,
    dbContent: "before {{Secret Thing}} after", readRuleId: 8,
    readRuleClass: "*all",
  });
  await seedCard(s, {
    id: 14, name: "Mystery Thing", typeId: BASIC_TYPE_ID,
    dbContent: "mystery body",
  });
}

async function seedRulelessDeck(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 4, name: "Basic" });
  await seedCard(s, {
    id: 11, name: "Readable Thing", typeId: BASIC_TYPE_ID,
    dbContent: "readable body",
  });
}

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await seedPermissionDeck(storage);
  ruleless = await createRenderTestStorage();
  await seedRulelessDeck(ruleless);
}, 60_000);

afterAll(() => {
  storage?.close();
  ruleless?.close();
});

describe("read permission: the Anonymous viewer (the corpus actor)", () => {
  it("renders a card readable through *all+*read -> Anyone in full", async () => {
    const s = storage!;
    for (const view of ["open", "content", "closed", "title"]) {
      const html = await s.engine.render("Readable Thing", view);
      expect(html).not.toContain('class="denied"');
    }
    expect(await s.engine.render("Readable Thing", "content")).toContain("readable body");
  });

  it("replaces the whole :open/:closed/:content view with Ruby's quiet denial span", async () => {
    const s = storage!;
    const span = quietDenial();
    expect(span).toBe(
      '<span class="denied"><!-- Sorry, you don\'t have permission (read) --></span>',
    );
    for (const view of ["open", "closed", "content"]) {
      expect(await s.engine.render("Secret Thing", view)).toBe(span);
    }
  });

  it("still renders :title of a denied card (perms :none, title.rb:2)", async () => {
    const s = storage!;
    expect(await s.engine.render("Secret Thing", "title")).toBe(
      '<span class="card-title" title="Secret Thing">Secret Thing</span>',
    );
  });

  it("renders :menu of a denied card as blank (menu.rb:8 denial: :blank)", async () => {
    const s = storage!;
    expect(await s.engine.render("Secret Thing", "menu")).toBe("");
  });

  it("denies the nest, never the host: denied card content is not processed", async () => {
    const s = storage!;
    const html = await s.engine.render("Page With Secret", "content");
    expect(html).toContain(quietDenial());
    expect(html).toContain("before");
    expect(html).toContain("after");
    expect(html).not.toContain("secret body");
  });

  it("resolves cards without a stored read_rule_id through the live rule walk", async () => {
    const s = storage!;

    expect(await s.engine.render("Mystery Thing", "content")).toBe(quietDenial());
  });

  it("renders rule-less decks in full (the documented synthetic-seed divergence)", async () => {
    const s = ruleless!;

    const html = await s.engine.render("Readable Thing", "content");
    expect(html).toContain("readable body");
    expect(html).not.toContain('class="denied"');
  });
});

describe("read permission query shape (decko-commons/decko#1282)", () => {
  it("cold render: permission resolution rides the closure batch (one round trip, three folded statements)", async () => {
    const cold = await createRenderTestStorage();
    try {
      await seedPermissionDeck(cold);
      cold.counting.reset();
      await cold.engine.render("Readable Thing", "open");
      const stats = cold.engine.lastRenderStats;

      expect(stats?.batches).toBe(1);

      expect(stats?.additionalResults?.length).toBe(6);
    } finally {
      cold.close();
    }
  });

  it("warm re-render of a denied card issues zero queries", async () => {
    const s = storage!;
    await s.engine.render("Secret Thing", "open");
    s.counting.reset();
    expect(await s.engine.render("Secret Thing", "open")).toBe(quietDenial());
    expect(s.counting.snapshot()).toEqual({ statements: 0, roundTrips: 0 });
  });

  it("resetCaches clears the permission state (re-resolution works)", async () => {
    const s = storage!;
    s.engine.resetCaches();
    expect(await s.engine.render("Secret Thing", "content")).toBe(quietDenial());
    expect(await s.engine.render("Readable Thing", "content")).toContain("readable body");
  });
});
