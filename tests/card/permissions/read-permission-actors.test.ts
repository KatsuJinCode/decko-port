

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import {
  ANONYMOUS_VIEWER,
  canReadByRuleLookup,
  canReadByStoredRule,
  readPermissionStatements,
  readPermissionStateFromResults,
  readPermissionStateFromViewerResults,
  type ReadViewer,
} from "../../../src/card/permissions/index.js";
import { runAuthMigrations, SessionStore } from "../../../src/card/auth/index.js";
import { viewerFromToken } from "../../../src/card/actions/render-viewer-for-session.js";
import { DeckoName } from "../../../src/card/name.js";

const SET_TYPE_ID = 2;
const ROLE_TYPE_ID = 9;
const BASIC_TYPE_ID = 4;

const ALICE = 31;
const BOB = 32;
const CAROL = 33;
const DAVE = 34;
const DECKOBOT_CARD = 10;
const ANONYMOUS_CARD = 6;

let storage: RenderTestStorage | undefined;

async function seedActorDeck(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 2, name: "Set", codename: "set" });
  await seedCard(s, { id: 3, name: "*read", codename: "read" });
  await seedCard(s, { id: 4, name: "Basic" });
  await seedCard(s, { id: 5, name: "Anyone", codename: "anyone" });
  await seedCard(s, { id: 6, name: "Anonymous", codename: "anonymous" });
  await seedCard(s, { id: 7, name: "AnyoneSignedIn", codename: "anyone_signed_in" });
  await seedCard(s, { id: 8, name: "Administrator", codename: "administrator", typeId: ROLE_TYPE_ID });
  await seedCard(s, { id: 9, name: "Role", codename: "role" });
  await seedCard(s, { id: 10, name: "DeckoBot", codename: "deckobot" });
  await seedCard(s, { id: 14, name: "*members", codename: "members" });
  await seedCard(s, { id: 15, name: "*type", codename: "type" });
  await seedCard(s, { id: 16, name: "*self", codename: "self" });

  await seedCard(s, { id: 20, name: "Role R1", typeId: ROLE_TYPE_ID });
  await seedCard(s, { id: 21, name: "Role R2", typeId: ROLE_TYPE_ID });
  await seedCard(s, { id: 25, name: "Role R1+*members", leftId: 20, rightId: 14 });
  await seedCard(s, { id: 26, name: "Role R2+*members", leftId: 21, rightId: 14 });
  await seedCard(s, { id: 27, name: "Administrator+*members", leftId: 8, rightId: 14 });
  await seedReference(s, 25, ALICE, null);
  await seedReference(s, 26, BOB, null);
  await seedReference(s, 26, null, null);
  await seedReference(s, 27, CAROL, null);

  await seedCard(s, { id: ALICE, name: "Alice" });
  await seedCard(s, { id: BOB, name: "Bob" });
  await seedCard(s, { id: CAROL, name: "Carol" });
  await seedCard(s, { id: DAVE, name: "Dave" });

  await seedCard(s, { id: 40, leftId: 1, rightId: 3, dbContent: "[[Anyone]]" });
  await seedReference(s, 40, 5, "anyone");
  await seedCard(s, { id: 42, leftId: 4, rightId: 15, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 41, leftId: 42, rightId: 3, dbContent: "[[Role R1]]" });
  await seedReference(s, 41, 20, "role_r1");
  await seedCard(s, { id: 45, name: "Secret" });
  await seedCard(s, { id: 44, leftId: 45, rightId: 15, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 43, leftId: 44, rightId: 3, dbContent: "[[Role R2]]" });
  await seedReference(s, 43, 21, "role_r2");

  await seedCard(s, {
    id: 50, name: "Readable Thing", typeId: BASIC_TYPE_ID, readRuleId: 40,
  });
  await seedCard(s, {
    id: 51, name: "R1 Secret", typeId: BASIC_TYPE_ID, readRuleId: 41,
  });
  await seedCard(s, {
    id: 52, name: "R2 Secret", typeId: BASIC_TYPE_ID, readRuleId: 43,
  });
  await seedCard(s, { id: 54, name: "Mystery Thing", typeId: BASIC_TYPE_ID });
}

async function stateFor(viewer: ReadViewer): Promise<ReturnType<typeof readPermissionStateFromViewerResults>> {
  const s = storage!;
  const results = await s.counting.batch(readPermissionStatements(viewer));
  return readPermissionStateFromViewerResults(results, viewer);
}

function signedIn(actorId: number): ReadViewer {
  return { signedIn: true, actorId };
}

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await seedActorDeck(storage);
  await runAuthMigrations(storage.counting);
}, 60_000);

afterAll(() => {
  storage?.close();
});

describe("read permission actors: role parties (the fetch_roles port)", () => {
  it("a signed-in member's parties are [Anyone, AnyoneSignedIn, ...member roles, self]", async () => {
    const state = await stateFor(signedIn(ALICE));

    expect(state.parties).toEqual([5, 7, 20, ALICE]);
  });

  it("her readable set is the union of her parties' grants (fetch_read_rules :115-123)", async () => {
    const state = await stateFor(signedIn(ALICE));

    expect([...state.readableRuleIds].sort((a, b) => a - b)).toEqual([40, 41]);
    expect(state.alwaysOk).toBe(false);
    expect(canReadByStoredRule(40, state)).toBe(true);
    expect(canReadByStoredRule(41, state)).toBe(true);
    expect(canReadByStoredRule(43, state)).toBe(false);
  });

  it("membership comes from <Role>+*members reference rows (Self::Role.role_ids, role.rb:8-14)", async () => {
    const state = await stateFor(signedIn(BOB));
    expect(state.parties).toEqual([5, 7, 21, BOB]);
    expect([...state.readableRuleIds].sort((a, b) => a - b)).toEqual([40, 43]);
    expect(canReadByStoredRule(41, state)).toBe(false);
  });

  it("a NULL referee row in a member list fabricates no role", async () => {

    const state = await stateFor(signedIn(BOB));
    expect(state.parties).toEqual([5, 7, 21, BOB]);
  });

  it("an account with no roles reads only the Anyone grants", async () => {
    const state = await stateFor(signedIn(DAVE));
    expect(state.parties).toEqual([5, 7, DAVE]);
    expect([...state.readableRuleIds].sort((a, b) => a - b)).toEqual([40]);
    expect(canReadByStoredRule(41, state)).toBe(false);
    expect(canReadByStoredRule(43, state)).toBe(false);
  });

  it("an Administrator-role member gets Ruby's always_ok? (permissions.rb:140)", async () => {
    const state = await stateFor(signedIn(CAROL));

    expect(state.alwaysOk).toBe(true);
    expect([...state.readableRuleIds].sort((a, b) => a - b)).toEqual([40]);
    expect(canReadByStoredRule(43, state)).toBe(true);
    expect(canReadByStoredRule(41, state)).toBe(true);
  });

  it("the DeckoBot actor always_ok? (auth/permissions.rb:9 — 'cannot disable')", async () => {
    const state = await stateFor(signedIn(DECKOBOT_CARD));
    expect(state.alwaysOk).toBe(true);

    expect(canReadByStoredRule(41, state)).toBe(true);
    expect(canReadByStoredRule(43, state)).toBe(true);
  });

  it("Anonymous stays exactly the corpus viewer (parties [Anyone, Anonymous], no alwaysOk)", async () => {
    const results = await storage!.counting.batch(readPermissionStatements(ANONYMOUS_VIEWER));
    expect(results.length).toBe(3);

    const corpusViewer: ReadViewer = { signedIn: false, actorId: ANONYMOUS_CARD };
    const state = readPermissionStateFromViewerResults(results, corpusViewer);
    expect(state.parties).toEqual([5, ANONYMOUS_CARD]);
    expect(state.alwaysOk).toBe(false);
    expect([...state.readableRuleIds].sort((a, b) => a - b)).toEqual([40]);
    expect(canReadByStoredRule(41, state)).toBe(false);

    const legacy = readPermissionStateFromResults(results, ANONYMOUS_CARD, false);
    expect(legacy).toEqual(state);

    const bare = readPermissionStateFromViewerResults(results, ANONYMOUS_VIEWER);
    expect(bare.parties).toEqual([5]);
    expect(bare.readableRuleIds).toEqual(new Set([40]));
  });

  it("the live rule walk honors the signed-in union (Mystery: allowed for Alice, denied for Anonymous)", async () => {
    const s = storage!;
    const mystery = {
      name: DeckoName.parse("Mystery Thing"),
      id: 54,
      typeId: BASIC_TYPE_ID,
      typeName: "Basic",
    };
    const aliceState = await stateFor(signedIn(ALICE));

    expect(await canReadByRuleLookup(s.fetcher, mystery, aliceState)).toBe(true);
    const anonResults = await s.counting.batch(readPermissionStatements(ANONYMOUS_VIEWER));
    const anonState = readPermissionStateFromViewerResults(anonResults, ANONYMOUS_VIEWER);
    expect(await canReadByRuleLookup(s.fetcher, mystery, anonState)).toBe(false);
    const carolState = await stateFor(signedIn(CAROL));

    expect(await canReadByRuleLookup(s.fetcher, mystery, carolState)).toBe(true);
  });
});

describe("read permission actor query shape (constant batch, never per-render)", () => {
  it("signed-in viewers fold ONE extra statement into the SAME batch", async () => {
    expect(readPermissionStatements().length).toBe(3);
    expect(readPermissionStatements(ANONYMOUS_VIEWER).length).toBe(3);
    expect(readPermissionStatements(signedIn(ALICE)).length).toBe(4);

    storage!.counting.reset();
    await stateFor(signedIn(ALICE));
    expect(storage!.counting.snapshot().roundTrips).toBe(1);
    expect(storage!.counting.snapshot().statements).toBe(4);
  });

  it("a signed-in viewer without an actor id adds no statement (defensive guard)", () => {
    expect(readPermissionStatements({ signedIn: true }).length).toBe(3);
  });
});

describe("session wiring: viewerFromToken (the render twin of engine-for-session)", () => {
  it("a live token resolves to the signed-in viewer of its account card", async () => {
    const s = storage!;
    const sessions = new SessionStore({ driver: s.counting });
    const { token } = await sessions.createSession(ALICE);
    const viewer = await viewerFromToken(s.counting, token);
    expect(viewer).toEqual({ signedIn: true, actorId: ALICE });
  });

  it("unknown / expired / revoked tokens degrade to ANONYMOUS_VIEWER (auth/current.rb:58-63)", async () => {
    const s = storage!;
    const sessions = new SessionStore({ driver: s.counting });
    expect(await viewerFromToken(s.counting, "not-a-real-token")).toBe(ANONYMOUS_VIEWER);
    const { token: doomed } = await sessions.createSession(BOB, { ttlSeconds: -1 });
    expect(await viewerFromToken(s.counting, doomed)).toBe(ANONYMOUS_VIEWER);
    const { token: revoked } = await sessions.createSession(BOB);
    expect(await sessions.revokeSession(revoked)).toBe(true);
    expect(await viewerFromToken(s.counting, revoked)).toBe(ANONYMOUS_VIEWER);
  });

  it("an empty token is the anonymous viewer", async () => {
    const s = storage!;
    expect(await viewerFromToken(s.counting, null)).toBe(ANONYMOUS_VIEWER);
    expect(await viewerFromToken(s.counting, undefined)).toBe(ANONYMOUS_VIEWER);
    expect(await viewerFromToken(s.counting, "")).toBe(ANONYMOUS_VIEWER);
  });
});
