

import { describe, expect, it } from "vitest";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

interface EnginePermissionSeam {
  readPermission?: { parties: number[]; readableRuleIds: Set<number> };
}

describe("ensureReadPermission threads the anonymous actor id into parties", () => {
  it("resolves parties [anyone, anonymous] for the default signed-out viewer", async () => {
    const storage = await createRenderTestStorage();
    try {

      await seedCard(storage, { id: 8, name: "csvqdo", codename: "anyone", typeId: 2 });
      await seedCard(storage, { id: 15, name: "tkmbewlur", codename: "anonymous", typeId: 2 });

      await seedCard(storage, { id: 100, name: "Home", typeId: 2, dbContent: "hello" });

      await storage.engine.render("Home", "open");

      const engine = storage.engine as unknown as EnginePermissionSeam;
      expect(engine.readPermission).toBeDefined();
      expect(engine.readPermission?.parties).toEqual([8, 15]);
    } finally {
      storage.close();
    }
  });
});
