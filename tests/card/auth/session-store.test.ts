// SessionStore tests against REAL storage: in-memory better-sqlite3 with the
// CORE schema (db/schema.sqlite.sql) plus the auth layer's own migration
// (db/migrations/001-auth-sessions.sql) applied through the real runner.
// Each expectation cites the Ruby file:method it derives from; the full
// trail lives in docs/auth-port-notes.md.

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_TTL_SECONDS,
  SessionStore,
  selectAuthSessionsRow,
} from "../../../src/card/auth/session-store.js";
import { runAuthMigrations } from "../../../src/card/auth/migrations.js";
import { sha256Hex } from "../../../src/card/auth/session-token.js";
import {
  createAuthTestStorage,
  fakeClock,
  insertAccountCard,
  type AuthTestStorage,
} from "./auth-test-storage.js";

const USER = { id: 7, name: "Test User A" };

async function freshStorage(): Promise<AuthTestStorage> {
  const storage = createAuthTestStorage();
  await runAuthMigrations(storage.driver);
  insertAccountCard(storage, USER);
  return storage;
}

describe("SessionStore round trip (create -> store -> resolve)", () => {
  let storage: AuthTestStorage;
  let clock: ReturnType<typeof fakeClock>["clock"];

  beforeEach(async () => {
    storage = await freshStorage();
    clock = fakeClock().clock;
  });

  it("resolves the created token to the account card's actor {id, name}", async () => {
    const store = new SessionStore({ driver: storage.driver, now: clock });
    const { token, expiresAt } = await store.createSession(USER.id, { ttlSeconds: 3600 });

    const actor = await store.lookupSession(token);
    expect(actor).toEqual({ id: USER.id, name: USER.name });
    // expires_at = create instant + ttl (canonical UTC TEXT, schema convention)
    expect(expiresAt).toBe("2026-09-20 13:00:00.000");
  });

  it("stores only the token's sha256 digest — the raw token never lands in the DB", async () => {
    const store = new SessionStore({ driver: storage.driver, now: clock });
    const { token } = await store.createSession(USER.id, { ttlSeconds: 3600 });

    const row = storage.selectOne<{ token_hash: string }>(
      "SELECT token_hash FROM auth_sessions",
    );
    expect(row).toBeDefined();
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.token_hash).not.toBe(token);
    expect(row!.token_hash).toBe(await sha256Hex(token));
  });

  it("records created_at from the clock and account_card_id from the argument", async () => {
    const store = new SessionStore({ driver: storage.driver, now: clock });
    await store.createSession(USER.id, { ttlSeconds: 60 });

    const row = storage.selectOne<{ account_card_id: number; created_at: string }>(
      "SELECT account_card_id, created_at FROM auth_sessions",
    );
    expect(row!.account_card_id).toBe(USER.id);
    expect(row!.created_at).toBe("2026-09-20 12:00:00.000");
  });

  it("resolveActorFromToken is the lookupSession alias (same actor)", async () => {
    const store = new SessionStore({ driver: storage.driver, now: clock });
    const { token } = await store.createSession(USER.id, { ttlSeconds: 3600 });

    expect(await store.resolveActorFromToken(token)).toEqual(await store.lookupSession(token));
    expect(await store.resolveActorFromToken(token)).toEqual({ id: USER.id, name: USER.name });
  });

  it("honors the store-wide defaultTtlSeconds when a call passes no ttl", async () => {
    const store = new SessionStore({
      driver: storage.driver,
      now: clock,
      defaultTtlSeconds: 30,
    });
    const { expiresAt } = await store.createSession(USER.id);
    expect(expiresAt).toBe("2026-09-20 12:00:30.000");
  });

  it("DEFAULT_SESSION_TTL_SECONDS is the documented 48h port default", async () => {
    expect(DEFAULT_SESSION_TTL_SECONDS).toBe(60 * 60 * 48);
  });
});

describe("SessionStore expiry (the JWT exp analog, token.rb:11)", () => {
  let storage: AuthTestStorage;
  let clockApi: ReturnType<typeof fakeClock>;

  beforeEach(async () => {
    storage = await freshStorage();
    clockApi = fakeClock();
  });

  it("returns null once expires_at has passed", async () => {
    const store = new SessionStore({ driver: storage.driver, now: clockApi.clock });
    const { token } = await store.createSession(USER.id, { ttlSeconds: 100 });

    clockApi.advanceSeconds(101);
    expect(await store.lookupSession(token)).toBeNull();
  });

  it("still resolves an instant before expiry", async () => {
    const store = new SessionStore({ driver: storage.driver, now: clockApi.clock });
    const { token } = await store.createSession(USER.id, { ttlSeconds: 100 });

    clockApi.advanceSeconds(99);
    expect(await store.lookupSession(token)).toEqual({ id: USER.id, name: USER.name });
  });

  it("treats the expires_at instant itself as still valid (expired means strictly after)", async () => {
    const store = new SessionStore({ driver: storage.driver, now: clockApi.clock });
    const { token } = await store.createSession(USER.id, { ttlSeconds: 100 });

    clockApi.advanceSeconds(100);
    expect(await store.lookupSession(token)).toEqual({ id: USER.id, name: USER.name });

    clockApi.advanceSeconds(1);
    expect(await store.lookupSession(token)).toBeNull();
  });
});

describe("SessionStore revocation", () => {
  let storage: AuthTestStorage;
  let clock: ReturnType<typeof fakeClock>["clock"];

  beforeEach(async () => {
    storage = await freshStorage();
    clock = fakeClock().clock;
  });

  it("revoked token resolves to null; the row is gone", async () => {
    const store = new SessionStore({ driver: storage.driver, now: clock });
    const { token } = await store.createSession(USER.id, { ttlSeconds: 3600 });
    expect(await store.lookupSession(token)).not.toBeNull();

    expect(await store.revokeSession(token)).toBe(true);
    expect(await store.lookupSession(token)).toBeNull();
    expect(storage.selectOne("SELECT * FROM auth_sessions")).toBeUndefined();
  });

  it("revoking an unknown/already-revoked token returns false", async () => {
    const store = new SessionStore({ driver: storage.driver, now: clock });
    const { token } = await store.createSession(USER.id, { ttlSeconds: 3600 });

    expect(await store.revokeSession(token)).toBe(true);
    expect(await store.revokeSession(token)).toBe(false);
  });
});

describe("SessionStore rejections", () => {
  let storage: AuthTestStorage;
  let clock: ReturnType<typeof fakeClock>["clock"];

  beforeEach(async () => {
    storage = await freshStorage();
    clock = fakeClock().clock;
  });

  it("a wrong (never issued) token resolves to null", async () => {
    const store = new SessionStore({ driver: storage.driver, now: clock });
    await store.createSession(USER.id, { ttlSeconds: 3600 });

    expect(await store.lookupSession("f".repeat(64))).toBeNull();
    expect(await store.lookupSession("not-a-token")).toBeNull();
  });

  it("a session whose user card was deleted resolves to null (current.rb:58-63)", async () => {
    const store = new SessionStore({ driver: storage.driver, now: clock });
    const { token } = await store.createSession(USER.id, { ttlSeconds: 3600 });

    storage.exec(`DELETE FROM cards WHERE id = ${USER.id}`);
    expect(await store.lookupSession(token)).toBeNull();
  });

  it("a user card row with a NULL name resolves to null (broken account card)", async () => {
    insertAccountCard(storage, { id: 8, name: "Compound Named Thing" });
    storage.exec("UPDATE cards SET name = NULL WHERE id = 8");
    const store = new SessionStore({ driver: storage.driver, now: clock });
    const { token } = await store.createSession(8, { ttlSeconds: 3600 });

    expect(await store.lookupSession(token)).toBeNull();
  });
});

describe("SessionStore constant-time compare seam", () => {
  let storage: AuthTestStorage;
  let clock: ReturnType<typeof fakeClock>["clock"];

  beforeEach(async () => {
    storage = await freshStorage();
    clock = fakeClock().clock;
  });

  it("MUTATION: a store whose comparator refuses everything fails every lookup — the comparison is load-bearing, not SQL '=' alone", async () => {
    const store = new SessionStore({
      driver: storage.driver,
      now: clock,
      compareTokens: () => false,
    });
    const { token } = await store.createSession(USER.id, { ttlSeconds: 3600 });
    expect(await store.lookupSession(token)).toBeNull();
  });

  it("every lookup routes the two 64-hex DIGESTS through the comparator (raw token never compared)", async () => {
    const seen: Array<[string, string]> = [];
    const store = new SessionStore({
      driver: storage.driver,
      now: clock,
      compareTokens: (a, b) => {
        seen.push([a, b]);
        return a === b;
      },
    });
    const { token } = await store.createSession(USER.id, { ttlSeconds: 3600 });
    expect(await store.lookupSession(token)).toEqual({ id: USER.id, name: USER.name });

    expect(seen.length).toBe(1);
    const [presented, stored] = seen[0]!;
    expect(presented).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(presented).toBe(stored);
    expect(presented).not.toBe(token);
    expect(stored).toBe(await sha256Hex(token));
  });

  it("a naive === comparator keeps the round trip working (behavior-preserving substitution)", async () => {
    const store = new SessionStore({
      driver: storage.driver,
      now: clock,
      compareTokens: (a, b) => a === b,
    });
    const { token } = await store.createSession(USER.id, { ttlSeconds: 3600 });
    expect(await store.lookupSession(token)).toEqual({ id: USER.id, name: USER.name });
  });

  it("the default comparator is tokensEqual (constant time)", async () => {
    const store = new SessionStore({ driver: storage.driver, now: clock });
    const { token } = await store.createSession(USER.id, { ttlSeconds: 3600 });
    // Round trip through the default (constant-time) comparator.
    expect(await store.lookupSession(token)).toEqual({ id: USER.id, name: USER.name });
  });
});

describe("SessionStore bookkeeping reads", () => {
  it("selectAuthSessionsRow reads the stored row by digest", async () => {
    const storage = await freshStorage();
    const clock = fakeClock().clock;
    const store = new SessionStore({ driver: storage.driver, now: clock });
    const { token, expiresAt } = await store.createSession(USER.id, { ttlSeconds: 60 });

    const row = await selectAuthSessionsRow(storage.driver, await sha256Hex(token));
    expect(row).toEqual({
      token_hash: await sha256Hex(token),
      account_card_id: USER.id,
      created_at: "2026-09-20 12:00:00.000",
      expires_at: expiresAt,
    });
    expect(await selectAuthSessionsRow(storage.driver, await sha256Hex("nope"))).toBeUndefined();
  });
});
