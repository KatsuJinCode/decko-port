// Read-permission ACTOR tests — the signed-in half of the party algebra
// (card-mod-account set/abstract/account_holder.rb: fetch_roles -> parties
// -> read_rules_hash). The Anonymous half lives in read-permission.test.ts
// and must not regress; this file proves the non-anonymous extension:
//
// Ruby trail ported here:
//   - account_holder.rb:107-113  role_ids_from_role_member_cards ->
//     Self::Role.role_ids (set/self/role.rb:8-14) -> fetch_roles puts
//     AnyoneSignedIn first
//   - account_holder.rb:27-29    parties = all_enabled_roles << id
//   - account_holder.rb:115-123  fetch_read_rules = union of
//     Card::Rule.read_rule_cache[party] over [AnyoneID] + parties
//   - auth/permissions.rb:8-13   always_ok? (DeckoBot / cached admin?)
//     short-circuits ok_to_read? BEFORE the hash lookup
//     (set/all/permissions.rb:140)
//
// Deck layout (ids stable so the reference rows are readable):
//    1  *all            codename all    typeId 2 (Set)
//    2  Set             codename set
//    3  *read           codename read
//    4  Basic
//    5  Anyone          codename anyone
//    6  Anonymous       codename anonymous
//    7  AnyoneSignedIn  codename anyone_signed_in
//    8  Administrator   codename administrator  typeId 9 (Role type)
//    9  Role            codename role           (the Role CARDTYPE card)
//   10  DeckoBot        codename deckobot
//   14  *members        codename members        (the rolehash joint)
//   15  *type           codename type
//   16  *self           codename self
//   20  Role R1         typeId 9                - grants R1-secret
//   21  Role R2         typeId 9                - grants R2-secret
//   25  Role R1+*members leftId 20 rightId 14   - members: Alice (31)
//   26  Role R2+*members leftId 21 rightId 14   - members: Bob (32) + a
//                                                 NULL referee row (the
//                                                 corpus's unresolved shape)
//   27  Administrator+*members leftId 8 rightId 14 - members: Carol (33)
//   31  Alice  (member of R1)
//   32  Bob    (member of R2)
//   33  Carol  (member of Administrator)
//   34  Dave   (account, no roles)
//   40  *all+*read            leftId 1  rightId 3  [[Anyone]]
//   42  Basic+*type           leftId 4  rightId 15 typeId 2 (Set)
//   41  Basic+*type+*read     leftId 42 rightId 3  [[Role R1]]
//   45  Secret                (type card for the second set)
//   44  Secret+*type          leftId 45 rightId 15 typeId 2 (Set)
//   43  Secret+*type+*read    leftId 44 rightId 3  [[Role R2]]
//   50  Readable Thing  readRuleId 40 - everyone
//   51  R1 Secret       readRuleId 41 - Alice (+ admins/bot via always_ok)
//   52  R2 Secret       readRuleId 43 - Bob   (+ admins/bot via always_ok)
//   54  Mystery Thing   readRuleId NULL - live rule walk resolves
//       Basic+*type+*read (41) first

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
  // The roles and their member lists (IdList reference rows: ref_type "L",
  // referee_key NULL — card-mod-list set/abstract/id_list.rb:33-47).
  await seedCard(s, { id: 20, name: "Role R1", typeId: ROLE_TYPE_ID });
  await seedCard(s, { id: 21, name: "Role R2", typeId: ROLE_TYPE_ID });
  await seedCard(s, { id: 25, name: "Role R1+*members", leftId: 20, rightId: 14 });
  await seedCard(s, { id: 26, name: "Role R2+*members", leftId: 21, rightId: 14 });
  await seedCard(s, { id: 27, name: "Administrator+*members", leftId: 8, rightId: 14 });
  await seedReference(s, 25, ALICE, null);
  await seedReference(s, 26, BOB, null);
  await seedReference(s, 26, null, null); // unresolved member (corpus shape)
  await seedReference(s, 27, CAROL, null);
  // The account holders.
  await seedCard(s, { id: ALICE, name: "Alice" });
  await seedCard(s, { id: BOB, name: "Bob" });
  await seedCard(s, { id: CAROL, name: "Carol" });
  await seedCard(s, { id: DAVE, name: "Dave" });
  // Read rules: *all+*read -> Anyone; per-set rules -> single roles.
  await seedCard(s, { id: 40, leftId: 1, rightId: 3, dbContent: "[[Anyone]]" });
  await seedReference(s, 40, 5, "anyone");
  await seedCard(s, { id: 42, leftId: 4, rightId: 15, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 41, leftId: 42, rightId: 3, dbContent: "[[Role R1]]" });
  await seedReference(s, 41, 20, "role_r1");
  await seedCard(s, { id: 45, name: "Secret" });
  await seedCard(s, { id: 44, leftId: 45, rightId: 15, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 43, leftId: 44, rightId: 3, dbContent: "[[Role R2]]" });
  await seedReference(s, 43, 21, "role_r2");
  // The governed cards (read_rule_id stored per Ruby's save event).
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

/** Resolve one viewer's state exactly the way the engine will: one batch,
 *  parser over the batch results. */
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
    // account_holder.rb:111-113 (AnyoneSignedIn first) + :27-29 (self last);
    // AnyoneID joins in fetch_read_rules :118.
    expect(state.parties).toEqual([5, 7, 20, ALICE]);
  });

  it("her readable set is the union of her parties' grants (fetch_read_rules :115-123)", async () => {
    const state = await stateFor(signedIn(ALICE));
    // *all+*read (40, via Anyone) + Basic+*type+*read (41, via Role R1).
    expect([...state.readableRuleIds].sort((a, b) => a - b)).toEqual([40, 41]);
    expect(state.alwaysOk).toBe(false);
    expect(canReadByStoredRule(40, state)).toBe(true);
    expect(canReadByStoredRule(41, state)).toBe(true);
    expect(canReadByStoredRule(43, state)).toBe(false); // R2-secret stays denied
  });

  it("membership comes from <Role>+*members reference rows (Self::Role.role_ids, role.rb:8-14)", async () => {
    const state = await stateFor(signedIn(BOB));
    expect(state.parties).toEqual([5, 7, 21, BOB]);
    expect([...state.readableRuleIds].sort((a, b) => a - b)).toEqual([40, 43]);
    expect(canReadByStoredRule(41, state)).toBe(false); // R1-secret denied
  });

  it("a NULL referee row in a member list fabricates no role", async () => {
    // Bob's list carries an unresolved member row (the corpus's shape);
    // the statement filters referee_id IS NOT NULL, so Bob's parties are
    // exactly his real membership.
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
    // always_ok? is the cached admin? of auth/permissions.rb:52-60 —
    // a verdict override, NOT extra grants: the union itself stays Anyone's.
    expect(state.alwaysOk).toBe(true);
    expect([...state.readableRuleIds].sort((a, b) => a - b)).toEqual([40]);
    expect(canReadByStoredRule(43, state)).toBe(true); // allowed anyway
    expect(canReadByStoredRule(41, state)).toBe(true);
  });

  it("the DeckoBot actor always_ok? (auth/permissions.rb:9 — 'cannot disable')", async () => {
    const state = await stateFor(signedIn(DECKOBOT_CARD));
    expect(state.alwaysOk).toBe(true);
    // fetch_read_rules returns [] for the bot (:116) — but the union over
    // its parties is computed anyway here; the VERDICT is what alwaysOk
    // decides, and it allows everything.
    expect(canReadByStoredRule(41, state)).toBe(true);
    expect(canReadByStoredRule(43, state)).toBe(true);
  });

  it("Anonymous stays exactly the corpus viewer (parties [Anyone, Anonymous], no alwaysOk)", async () => {
    const results = await storage!.counting.batch(readPermissionStatements(ANONYMOUS_VIEWER));
    expect(results.length).toBe(3);
    // The corpus viewer: the engine (render.ts#ensureReadPermission) supplies
    // the Anonymous card's id from the batch — parties [Anyone, Anonymous].
    const corpusViewer: ReadViewer = { signedIn: false, actorId: ANONYMOUS_CARD };
    const state = readPermissionStateFromViewerResults(results, corpusViewer);
    expect(state.parties).toEqual([5, ANONYMOUS_CARD]);
    expect(state.alwaysOk).toBe(false);
    expect([...state.readableRuleIds].sort((a, b) => a - b)).toEqual([40]);
    expect(canReadByStoredRule(41, state)).toBe(false);
    // The legacy (results, actorId, signedIn) entry point parses to the
    // same state — the historical Anonymous path is untouched.
    const legacy = readPermissionStateFromResults(results, ANONYMOUS_CARD, false);
    expect(legacy).toEqual(state);
    // An id-less signed-out viewer (Ruby never produces one — Anonymous is
    // always a real card, current.rb:7-9) degrades to Anyone-only parties.
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
    // Her union covers Basic+*type+*read (41) — the walk's first hit allows.
    expect(await canReadByRuleLookup(s.fetcher, mystery, aliceState)).toBe(true);
    const anonResults = await s.counting.batch(readPermissionStatements(ANONYMOUS_VIEWER));
    const anonState = readPermissionStateFromViewerResults(anonResults, ANONYMOUS_VIEWER);
    expect(await canReadByRuleLookup(s.fetcher, mystery, anonState)).toBe(false);
    const carolState = await stateFor(signedIn(CAROL));
    // always_ok? short-circuits BEFORE the walk (permissions.rb:140).
    expect(await canReadByRuleLookup(s.fetcher, mystery, carolState)).toBe(true);
  });
});

describe("read permission actor query shape (constant batch, never per-render)", () => {
  it("signed-in viewers fold ONE extra statement into the SAME batch", async () => {
    expect(readPermissionStatements().length).toBe(3);
    expect(readPermissionStatements(ANONYMOUS_VIEWER).length).toBe(3);
    expect(readPermissionStatements(signedIn(ALICE)).length).toBe(4);
    // One driver.batch carries all four (the role statement is the 4th).
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
