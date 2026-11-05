

import { describe, expect, it } from "vitest";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

describe("blank nest reference ({{}})", () => {
  it("renders Ruby's quiet denial span where the blank reference stood", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });
      await seedCard(storage, {
        id: 900,
        name: "blank ref source",
        typeId: 2,
        dbContent: "<p>before{{}}after</p>",
      });
      const html = await storage.engine.render("blank_ref_source", "content");
      expect(html).toContain("<p>before<span class=\"denied\"><!-- Sorry, you don't have permission (read) --></span>after</p>");
    } finally {
      storage.close();
    }
  });
});
