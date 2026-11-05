

import { describe, it, expect, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "./render-test-storage.js";

let storage: RenderTestStorage | undefined;

afterAll(() => {
  storage?.close();
});

async function seedDeck(): Promise<RenderTestStorage> {
  storage = await createRenderTestStorage();

  await seedCard(storage, { id: 2, name: "Basic", codename: "basic", typeId: 2 });
  await seedCard(storage, { id: 10, name: "List", codename: "list", typeId: 2 });
  await seedCard(storage, { id: 11, name: "Search", codename: "search_type", typeId: 2 });
  await seedCard(storage, { id: 12, name: "Person", codename: "person", typeId: 2 });

  await seedCard(storage, { id: 20, name: "Jane", typeId: 2 });
  await seedCard(storage, { id: 21, name: "Associates", typeId: 2 });
  await seedCard(storage, { id: 22, name: "*right", codename: "right", typeId: 2 });
  await seedCard(storage, {
    id: 23,
    name: "*content options",
    codename: "content_options",
    typeId: 2,
  });
  await seedCard(storage, { id: 24, name: "Fields", typeId: 2 });

  await seedCard(storage, { id: 30, leftId: 21, rightId: 22, typeId: 2 });
  await seedCard(storage, { id: 31, leftId: 24, rightId: 22, typeId: 2 });

  await seedCard(storage, {
    id: 32,
    leftId: 30,
    rightId: 23,
    typeId: 11,
    dbContent: '{"type":"Person"}',
  });

  await seedCard(storage, {
    id: 33,
    leftId: 20,
    rightId: 21,
    typeId: 10,
    dbContent: "Alice\nBob\n",
  });
  await seedCard(storage, {
    id: 34,
    leftId: 20,
    rightId: 24,
    typeId: 10,
    dbContent: "Alice\n",
  });
  await seedCard(storage, { id: 40, name: "Alice", typeId: 12 });
  return storage;
}

describe("item-slot type option (nest_item item-type chain)", () => {
  it(
    "host *content options rule types the item slot JSON and the unknown-item identity",
    async () => {
      const s = await seedDeck();
      const html = await s.engine.render("Jane+Associates", "content");

      expect(html).toContain(
        "&quot;home_view&quot;:&quot;bar&quot;,&quot;type&quot;:&quot;Person&quot;}",
      );

      expect(html).toContain('id="bob-mini_bar-view"');
      expect(html).toContain("ALL TYPE-person");
      expect(html).toContain('data-card-type-id="12"');
      expect(html).toContain('data-card-type-name="Person"');

      expect(html).toContain('&quot;nest_name&quot;:&quot;Bob&quot;');

      expect(html).toContain('id="alice-bar-view"');
    },
  );

  it(
    "a host without a *content options rule renders the type-less item slot JSON",
    async () => {
      const s = await seedDeck();
      const html = await s.engine.render("Jane+Fields", "content");

      expect(html).toContain(
        "&quot;home_view&quot;:&quot;bar&quot;}",
      );
      expect(html).not.toContain("&quot;type&quot;:");

      expect(html).toContain('data-card-type-name="Person"');
    },
  );
});
