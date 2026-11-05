

import { describe, it, expect, afterAll } from "vitest";
import { createRenderTestStorage, seedCard, type RenderTestStorage } from "./render-test-storage.js";

let storage: RenderTestStorage | undefined;

afterAll(() => {
  storage?.close();
});

describe("data-slot nest_name: authored reference form (raw oracle 9625 + live wire)", () => {
  it("renders {{+Source Title}} with nest_name '+Source Title' and absolute data-card-name", async () => {
    storage = await createRenderTestStorage();

    await seedCard(storage, {
      id: 99200,
      name: "Deferred Lane Parent",
      typeId: 2,
      dbContent: "<p>{{+Source Title}}</p>",
    });
    await seedCard(storage, { id: 99201, name: "Source Title", typeId: 2 });
    await seedCard(storage, {
      id: 99202,
      name: "Deferred Lane Parent+Source Title",
      leftId: 99200,
      rightId: 99201,
      typeId: 2,
      dbContent: "<p>the source title body</p>",
    });
    const html = await storage.engine.render("Deferred Lane Parent", "content");

    expect(html).toContain('data-card-name="Deferred Lane Parent+Source Title"');

    expect(html).toContain("&quot;nest_name&quot;:&quot;+Source Title&quot;");
    expect(html).toContain("&quot;nest_syntax&quot;:&quot;+Source Title&quot;");

    expect(html).toContain('id="deferred_lane_parent-source_title-titled-view"');
  });
});
