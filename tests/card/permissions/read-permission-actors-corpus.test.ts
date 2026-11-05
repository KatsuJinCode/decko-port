// CORPUS PROOF of the signed-in readable-set math — the production deck's
// real account/role data against the real ReadRuleCache.
//
// What the corpus CAN and CANNOT prove (said plainly):
// - The corpus CAPTURE (fixtures/corpus/*) is anonymous-viewer only — no
//   rendered bytes exist for a signed-in viewer, so this test proves the
//   READABLE-SET math, not signed-in HTML bytes.
// - The deck's storage carries the full role algebra: real Role cards
//   (codename "role" type), real `<Role>+*members` IdList cards with their
//   member reference rows (card-mod-account set/self/role.rb:33-40's
//   rolehash source; the reference rows are the IdList's own save-time
//   output, card-mod-list set/abstract/id_list.rb:33-47 — the anonymizer
//   rewrote list CONTENT, the id references survived, and item counts
//   match reference counts on every list), and 1,010 (role-party,
//   read-rule) grant rows.
// - This test therefore computes Ruby's read_rule_cache union
//   (account_holder.rb:115-123 over [AnyoneID] + parties, :27-29, roles
//   from :107-113) DIRECTLY from the corpus SQLite with independent raw
//   SQL, and asserts the TS statement batch returns the identical rule-id
//   set — for Anonymous AND for every one of the deck's 113 role members.
//
// Skips when the corpus database is absent (it is a local benchmark
// artifact, not a repo fixture).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { LocalSqliteDriver } from "../../../src/server/drivers/local-sqlite.js";
import {
  readPermissionStatements,
  readPermissionStateFromViewerResults,
  type ReadViewer,
} from "../../../src/card/permissions/index.js";

const CORPUS_PATH = fileURLToPath(
  new URL("../../../benchmarks/corpus-v2/bench-corpus-v2.sqlite3", import.meta.url),
);

const describeIfCorpus = existsSync(CORPUS_PATH) ? describe : describe.skip;

interface CorpusRow {
  [column: string]: unknown;
}

describeIfCorpus("read permission actors: corpus union math (bench-corpus-v2)", () => {
  let raw: Database;
  let driver: LocalSqliteDriver;

  /** Ruby's ReadRuleCache SQL (lib/card/rule/read_rule_cache.rb:7-18) with
   *  ReadID/SetID interpolated from the codename cards — the expectation
   *  side, deliberately independent of the TS statement builder. */
  const cacheRows = (): Array<{ partyId: number; readRuleId: number }> =>
    raw
      .prepare(
        `SELECT refs.referee_id AS partyId, read_rules.id AS readRuleId ` +
          `FROM cards read_rules ` +
          `JOIN card_references refs ON refs.referer_id = read_rules.id ` +
          `JOIN cards sets ON read_rules.left_id = sets.id ` +
          `WHERE read_rules.right_id = ${codenameId("read")} ` +
          `AND sets.type_id = ${codenameId("set")} ` +
          `AND read_rules.trash = 0 AND sets.trash = 0`,
      )
      .all() as Array<{ partyId: number; readRuleId: number }>;

  const codenameId = (code: string): number =>
    (raw.prepare("SELECT id FROM cards WHERE codename = ? AND trash = 0").get(code) as
      | { id: number }
      | undefined)?.id ?? -1;

  /** Self::Role.role_ids (set/self/role.rb:8-14) — the member-list rows of
   *  the role cards the actor sits in (ordered by role id, the same
   *  normalization the TS statement applies). */
  const rolesOf = (actorId: number): number[] =>
    (
      raw
        .prepare(
          `SELECT lists.left_id AS roleId ` +
            `FROM card_references refs ` +
            `JOIN cards lists ON lists.id = refs.referer_id ` +
            `JOIN cards roles ON roles.id = lists.left_id ` +
            `WHERE refs.referee_id = ? AND refs.referee_id IS NOT NULL ` +
            `AND lists.right_id = ${codenameId("members")} ` +
            `AND lists.trash = 0 AND roles.trash = 0 ` +
            `AND roles.type_id = ${codenameId("role")} ` +
            `ORDER BY lists.left_id`,
        )
        .all(actorId) as Array<{ roleId: number }>
    ).map((row) => row.roleId);

  /** account_holder.rb: fetch_read_rules (:115-123): union of
   *  read_rule_cache[party] over [AnyoneID] + parties (:27-29, :39-41). */
  function expectedUnion(parties: number[]): Set<number> {
    const cache = new Map<number, Set<number>>();
    for (const row of cacheRows()) {
      let rules = cache.get(row.partyId);
      if (rules === undefined) cache.set(row.partyId, (rules = new Set()));
      rules.add(row.readRuleId);
    }
    const union = new Set<number>();
    for (const party of parties) {
      for (const ruleId of cache.get(party) ?? []) union.add(ruleId);
    }
    return union;
  }

  /** The TS side, exactly the way an engine resolves it: one base batch +
   *  the viewer parse (statement 4 spliced in for signed-in viewers). */
  async function tsState(viewer: ReadViewer) {
    const baseResults = await driver.batch(readPermissionStatements());
    const statements = readPermissionStatements(viewer);
    const results =
      viewer.signedIn && viewer.actorId !== undefined
        ? [
            ...baseResults,
            ...(await driver.batch([statements[statements.length - 1]])),
          ]
        : baseResults;
    return readPermissionStateFromViewerResults(results, viewer);
  }

  beforeAll(() => {
    raw = new Database(CORPUS_PATH, { readonly: true });
    driver = new LocalSqliteDriver({ path: CORPUS_PATH, readonly: true });
  });

  afterAll(() => {
    raw.close();
    driver.close();
  });

  it("Anonymous: TS readable set equals Ruby's union over [Anyone, Anonymous]", async () => {
    const anyone = codenameId("anyone");
    const anonymous = codenameId("anonymous");
    const expected = expectedUnion([anyone, anonymous]);
    const state = await tsState({
      signedIn: false,
      actorId: anonymous,
    });
    expect(state.parties).toEqual([anyone, anonymous]);
    expect(state.alwaysOk).toBe(false);
    expect(state.readableRuleIds).toEqual(expected);
    expect(expected.size).toBeGreaterThan(0);
  });

  it("a real roleful account holder: TS readable set equals Ruby's role-party union", async () => {
    // Lowest-id account holder with roles and WITHOUT the Administrator
    // role (the admin path is always_ok?, proven separately below).
    const accountId = codenameId("account");
    const administratorId = codenameId("administrator");
    const anyone = codenameId("anyone");
    const anyoneSignedIn = codenameId("anyone_signed_in");
    const memberIds = (
      raw
        .prepare(
          `SELECT DISTINCT refs.referee_id AS memberId ` +
            `FROM card_references refs ` +
            `JOIN cards lists ON lists.id = refs.referer_id ` +
            `JOIN cards roles ON roles.id = lists.left_id ` +
            `WHERE refs.referee_id IS NOT NULL ` +
            `AND lists.right_id = ${codenameId("members")} ` +
            `AND lists.trash = 0 AND roles.trash = 0 ` +
            `AND roles.type_id = ${codenameId("role")} ` +
            `ORDER BY memberId`,
        )
        .all() as Array<{ memberId: number }>
    ).map((row) => row.memberId);
    const hasAccount = (id: number): boolean =>
      raw
        .prepare(
          `SELECT 1 AS one FROM cards WHERE left_id = ? AND right_id = ${accountId} AND trash = 0`,
        )
        .get(id) !== undefined;

    const traced = memberIds.find((id) => {
      const roles = rolesOf(id);
      return roles.length > 0 && !roles.includes(administratorId) && hasAccount(id);
    });
    expect(traced).toBeDefined();
    const roles = rolesOf(traced!);
    expect(roles.length).toBeGreaterThan(0);

    const parties = [anyone, anyoneSignedIn, ...roles, traced!];
    const expected = expectedUnion(parties);
    const state = await tsState({ signedIn: true, actorId: traced! });

    expect(state.parties).toEqual(parties);
    expect(state.alwaysOk).toBe(false);
    expect(state.readableRuleIds).toEqual(expected);
    // The point of the wave: role membership reads rules Anonymous cannot.
    const anonymousUnion = expectedUnion([anyone, codenameId("anonymous")]);
    expect(state.readableRuleIds.size).toBeGreaterThan(anonymousUnion.size);
    for (const ruleId of anonymousUnion) {
      expect(state.readableRuleIds.has(ruleId)).toBe(true);
    }
  });

  it("an Administrator-role member: union matches AND alwaysOk short-circuits (permissions.rb:140)", async () => {
    const administratorId = codenameId("administrator");
    const anyone = codenameId("anyone");
    const anyoneSignedIn = codenameId("anyone_signed_in");
    const memberIds = (
      raw
        .prepare(
          `SELECT DISTINCT refs.referee_id AS memberId ` +
            `FROM card_references refs ` +
            `JOIN cards lists ON lists.id = refs.referer_id ` +
            `JOIN cards roles ON roles.id = lists.left_id ` +
            `WHERE refs.referee_id IS NOT NULL ` +
            `AND lists.right_id = ${codenameId("members")} ` +
            `AND lists.trash = 0 AND roles.trash = 0 ` +
            `AND roles.type_id = ${codenameId("role")} ` +
            `ORDER BY memberId`,
        )
        .all() as Array<{ memberId: number }>
    ).map((row) => row.memberId);
    const adminMember = memberIds.find((id) => rolesOf(id).includes(administratorId));
    expect(adminMember).toBeDefined();
    const roles = rolesOf(adminMember!);
    const expected = expectedUnion([anyone, anyoneSignedIn, ...roles, adminMember!]);
    const state = await tsState({ signedIn: true, actorId: adminMember! });
    expect(state.alwaysOk).toBe(true); // auth/permissions.rb:52-60 cached admin?
    expect(state.readableRuleIds).toEqual(expected);
  });

  it("the full sweep: EVERY role member's TS union equals Ruby's union (113 members)", async () => {
    const anyone = codenameId("anyone");
    const anyoneSignedIn = codenameId("anyone_signed_in");
    const administratorId = codenameId("administrator");
    const deckobotId = codenameId("deckobot"); // absent in this deck -> -1
    const memberIds = (
      raw
        .prepare(
          `SELECT DISTINCT refs.referee_id AS memberId ` +
            `FROM card_references refs ` +
            `JOIN cards lists ON lists.id = refs.referer_id ` +
            `JOIN cards roles ON roles.id = lists.left_id ` +
            `WHERE refs.referee_id IS NOT NULL ` +
            `AND lists.right_id = ${codenameId("members")} ` +
            `AND lists.trash = 0 AND roles.trash = 0 ` +
            `AND roles.type_id = ${codenameId("role")} ` +
            `ORDER BY memberId`,
        )
        .all() as Array<{ memberId: number }>
    ).map((row) => row.memberId);
    expect(memberIds.length).toBeGreaterThan(100);

    const baseResults = await driver.batch(readPermissionStatements());
    for (const memberId of memberIds) {
      const roles = rolesOf(memberId);
      const viewer: ReadViewer = { signedIn: true, actorId: memberId };
      const statements = readPermissionStatements(viewer);
      const results = [
        ...baseResults,
        ...(await driver.batch([statements[statements.length - 1]])),
      ];
      const state = readPermissionStateFromViewerResults(results, viewer);
      const expected = expectedUnion([anyone, anyoneSignedIn, ...roles, memberId]);
      expect(state.readableRuleIds).toEqual(expected);
      expect(state.alwaysOk).toBe(
        memberId === deckobotId || roles.includes(administratorId),
      );
    }
  });
});
