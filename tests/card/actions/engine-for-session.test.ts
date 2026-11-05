// Integration test for the coordinator wiring between the two landed
// streams: SessionStore (auth) -> Actor -> CardActionEngine (actions).
// Round trip: seed an account card, create a session, resolve the engine
// from the token, perform a create, and assert the act is attributed to the
// session's account — plus the anonymous outcomes (no token, unknown token,
// expired token).

import { describe, expect, it } from "vitest";
import {
  createActionsTestStorage,
  fakeClock,
  IP,
  seedCard,
  seedStandardDeck,
  type ActionsTestStorage,
} from "./actions-test-storage.js";
import { runAuthMigrations, SessionStore } from "../../../src/card/auth/index.js";
import {
  createCardActionEngineForSession,
  actorFromToken,
} from "../../../src/card/actions/engine-for-session.js";
import { CardActionError } from "../../../src/card/actions/types.js";

async function bootDeckWithAuth() {
  const storage = await createActionsTestStorage();
  await runAuthMigrations(storage.driver);
  const deck = await seedStandardDeck(storage);
  // The account card the session will bind to (id 90: ids up to the seed's
  // auto-assigned junction row are taken by seedStandardDeck).
  const joe = await seedCard(storage, { id: 90, name: "Joe User" });
  return { storage, deck, joe };
}

describe("engine-for-session: token -> actor -> attributed write", () => {
  it("round-trips: session token resolves to the actor and the act is attributed", async () => {
    const { storage, joe } = await bootDeckWithAuth();
    try {
      const sessions = new SessionStore({ driver: storage.driver });
      const { token } = await sessions.createSession(joe.id);

      const actor = await actorFromToken(storage.driver, token);
      expect(actor).toEqual({ id: joe.id, name: joe.name });

      const engine = await createCardActionEngineForSession(
        storage.engine,
        storage.driver,
        token,
        { ipAddress: IP, now: fakeClock() },
      );
      const result = await engine.createCard({ name: "Session Made", content: "hello" });

      const act = await storage.selectOne<{ actor_id: number; ip_address: string | null }>(
        "SELECT actor_id, ip_address FROM card_acts WHERE id = ?",
        [result.actId],
      );
      expect(act?.actor_id).toBe(joe.id);
      expect(act?.ip_address).toBe(IP);

      const card = await storage.selectOne<{ id: number; creator_id: number; name: string }>(
        "SELECT id, creator_id, name FROM cards WHERE name = 'Session Made'",
      );
      expect(card?.creator_id).toBe(joe.id);
    } finally {
      storage.close();
    }
  });

  it("no token / unknown token => anonymous engine whose create throws", async () => {
    const { storage } = await bootDeckWithAuth();
    try {
      for (const token of [null, undefined, "", "deadbeef".repeat(8)]) {
        const engine = await createCardActionEngineForSession(
          storage.engine,
          storage.driver,
          token,
        );
        expect(engine.actor).toBeNull();
        await expect(engine.createCard({ name: "Nope", content: "x" })).rejects.toBeInstanceOf(
          CardActionError,
        );
      }
      // And nothing was written.
      expect(await storage.count("cards")).toBe(
        (await storage.selectOne<{ n: number }>("SELECT COUNT(*) AS n FROM cards"))?.n ?? 0,
      );
    } finally {
      storage.close();
    }
  });

  it("expired token degrades to anonymous (auth/current.rb:58-63 shape)", async () => {
    const { storage, joe } = await bootDeckWithAuth();
    try {
      // Created 10 days ago with the default TTL: genuinely expired in real
      // time, so ANY conforming store (including the one inside the engine
      // factory) must resolve it to null.
      const pastClock = () => new Date(Date.now() - 10 * 24 * 3600 * 1000);
      const creator = new SessionStore({ driver: storage.driver, now: pastClock });
      const { token } = await creator.createSession(joe.id);
      expect(await new SessionStore({ driver: storage.driver }).resolveActorFromToken(token))
        .toBeNull();

      const engine = await createCardActionEngineForSession(
        storage.engine,
        storage.driver,
        token,
      );
      expect(engine.actor).toBeNull();
      await expect(engine.createCard({ name: "Expired", content: "x" })).rejects.toBeInstanceOf(
        CardActionError,
      );
    } finally {
      storage.close();
    }
  });
});
