

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
    expect(state.alwaysOk).toBe(true);
    expect(state.readableRuleIds).toEqual(expected);
  });

  it("the full sweep: EVERY role member's TS union equals Ruby's union (113 members)", async () => {
    const anyone = codenameId("anyone");
    const anyoneSignedIn = codenameId("anyone_signed_in");
    const administratorId = codenameId("administrator");
    const deckobotId = codenameId("deckobot");
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
