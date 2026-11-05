

import { describe, expect, it } from "vitest";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

describe("prefetch cache keeps the codename column (corpus:274 mechanism)", () => {
  it("fetchByName preserves the seeded codename before any render", async () => {
    const storage = await createRenderTestStorage();
    try {

      await seedCard(storage, {
        id: 274,
        name: "*all",
        key: "*all",
        codename: "all",
        typeId: 259,
        dbContent: "fr",
      });
      const card = await storage.fetcher.fetchByName("*all");
      expect(card?.codename).toBe("all");
    } finally {
      storage.close();
    }
  });

  it("a render whose inclusion closure reaches the codename card does not poison it", async () => {
    const storage = await createRenderTestStorage();
    try {
      await seedCard(storage, {
        id: 274,
        name: "*all",
        key: "*all",
        codename: "all",
        typeId: 259,
        dbContent: "fr",
      });
      await seedCard(storage, { id: 2, name: "RichText", codename: "basic", typeId: 2 });

      await seedCard(storage, {
        id: 300,
        name: "host page",
        typeId: 2,
        dbContent: "see {{*all|content}}",
      });
      await storage.engine.render("host page", "content");
      const after = await storage.fetcher.fetchByName("*all");
      expect(after?.codename).toBe("all");
    } finally {
      storage.close();
    }
  });
});
