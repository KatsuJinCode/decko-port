// Pin the anonymous actorId threading (R4 permission lane seam 2): the
// engine's permission state must carry the signed-out viewer's OWN card id
// as a party — Ruby's parties are all_enabled_roles + [self]
// (card-mod-account set/abstract/account_holder.rb:27-29) and
// fetch_read_rules unions the cache over [AnyoneID] + parties (:115-123) —
// so Anonymous resolves parties [AnyoneID, AnonymousID], never [AnyoneID]
// alone. The engine parsed its state from this.viewer verbatim
// (ANONYMOUS_VIEWER, no actorId) and dropped the [AnonymousID] party;
// ensureReadPermission now resolves it from the batch's codename rows
// (the resolveAnonymousReadPermission pattern, src/card/permissions/
// read-rules.ts:352-360).
//
// Corpus-neutral today (verified by census: 0 read rules grant the
// anonymous party alone, 0 grant anonymous-but-not-anyone), but the parties
// must match Ruby's for any deck whose rules grant [[Anonymous]].

import { describe, expect, it } from "vitest";
import { createRenderTestStorage, seedCard } from "./render-test-storage.js";

interface EnginePermissionSeam {
  readPermission?: { parties: number[]; readableRuleIds: Set<number> };
}

describe("ensureReadPermission threads the anonymous actor id into parties", () => {
  it("resolves parties [anyone, anonymous] for the default signed-out viewer", async () => {
    const storage = await createRenderTestStorage();
    try {
      // The codename cards the party math reads (statement 1 selects
      // codename IN (... 'anyone', ..., 'anonymous', ...)). Ids mirror the
      // classic decko bootstrap (AnyoneID=8, AnonymousID=15).
      await seedCard(storage, { id: 8, name: "csvqdo", codename: "anyone", typeId: 2 });
      await seedCard(storage, { id: 15, name: "tkmbewlur", codename: "anonymous", typeId: 2 });
      // A readable root so the render pipeline runs end to end.
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
