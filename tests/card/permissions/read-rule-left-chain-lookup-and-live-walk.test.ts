// The _left read-rule delegation is ONE mechanism with TWO entry paths, and
// this file pins both on the same deck so they cannot drift apart:
//
// 1. THE LOOKUP PATH (write/derivation time — set-read-rule.ts): when a
//    read_rule_id is DERIVED for a card (the set_read_rule store event,
//    deriveReadRuleRecord -> permissionRuleId -> leftPermissionRuleId,
//    permissions.rb:52-72), a compound card whose winning read rule's
//    content is the `_left` reference stores its LEFT card's effective rule
//    id. The stored id bakes the left chain in; the read verdict for that
//    row then needs no walk (canReadByStoredRule).
//
// 2. THE LIVE-WALK PATH (read time — read-rules.ts canReadByRuleLookup):
//    a card without a stored read_rule_id (new card, fetch placeholder, row
//    predating the column) resolves its rule at verdict time, and the same
//    `_left` content check (LEFT_DELEGATION_CONTENT) routes the verdict
//    through readThroughLeftCard — the left chain walked with delegation
//    re-checked at every hop (Ruby re-runs permission_rule_id per hop).
//
// Both paths must resolve the SAME left-chain rule for the same card shape:
// the derived stored id and the live walk's winning rule id agree, and the
// verdicts agree (allowed when the left reads, denied when the left locks).

import { describe, expect, it } from "vitest";
import { DeckoName } from "../../../src/card/name.js";
import {
  canReadByRuleLookup,
  resolveAnonymousReadPermission,
} from "../../../src/card/permissions/read-rules.js";
import { deriveReadRuleRecord } from "../../../src/card/permissions/set-read-rule.js";
import type { PatternCardInput } from "../../../src/card/set-patterns/types.js";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
  type SeedOptions,
} from "../render/render-test-storage.js";

// SET_TYPE_ID is the id of the card whose codename is "set" (the Set
// cardtype row) — the read-rule-cache join matches read_rules.left_id ->
// sets.type_id = that id, so every set-pattern row carries it.
const SET_TYPE_ID = 3;
const BASIC_TYPE_ID = 4; // the Basic cardtype row's id (Basic-typed rows)

/** The deck: `*all plus+*read` -> `_left` (the corpus's delegating rule),
 *  `*all+*read` -> anyone. HostB reads through its OWN `*self` rule
 *  (Anyone) — deliberately NOT through *all plus — so a compound child
 *  resolving 40 proves the walk went through the left chain (its own first
 *  existing candidate is the delegator 31). HostC's `*self` rule grants
 *  Role_A only, so the same chain must deny its child. */
async function seedDualPathDeck(): Promise<RenderTestStorage> {
  const storage = await createRenderTestStorage();
  const seed = (opts: SeedOptions): void => void seedCard(storage, opts);

  seed({ id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  seed({ id: 2, name: "*read", codename: "read", typeId: SET_TYPE_ID });
  seed({ id: 3, name: "Set", codename: "set", typeId: SET_TYPE_ID });
  seed({ id: 13, name: "*self", codename: "self", typeId: SET_TYPE_ID });
  seed({ id: 4, name: "Basic", typeId: BASIC_TYPE_ID });
  seed({ id: 8, name: "Anonymous", codename: "anonymous", typeId: BASIC_TYPE_ID });
  seed({ id: 9, name: "anyone", codename: "anyone", typeId: BASIC_TYPE_ID });
  seed({ id: 11, name: "Role_A", codename: "role_a", typeId: BASIC_TYPE_ID });

  seed({ id: 30, name: "*all+*read", leftId: 1, rightId: 2, typeId: SET_TYPE_ID, dbContent: "anyone" });
  await seedReference(storage, 30, 9, "anyone");
  seed({ id: 31, name: "*all plus+*read", rightId: 2, typeId: SET_TYPE_ID, dbContent: "_left" });

  seed({ id: 34, name: "HostB", typeId: BASIC_TYPE_ID, dbContent: "readable host" });
  // The SELF set card row (type Set) is what the readable-rules SQL joins on
  // (read_rules.left_id = sets.id AND sets.type_id = Set); the rule hangs off it.
  seed({ id: 39, name: "HostB+*self", leftId: 34, rightId: 13, typeId: SET_TYPE_ID });
  seed({ id: 40, name: "HostB+*self+*read", leftId: 39, rightId: 2, typeId: SET_TYPE_ID, dbContent: "[[anyone]]" });
  await seedReference(storage, 40, 9, "anyone");

  seed({ id: 33, name: "HostC", typeId: BASIC_TYPE_ID, dbContent: "locked host" });
  seed({ id: 38, name: "HostC+*self", leftId: 33, rightId: 13, typeId: SET_TYPE_ID });
  seed({ id: 32, name: "HostC+*self+*read", leftId: 38, rightId: 2, typeId: SET_TYPE_ID, dbContent: "[[Role_A]]" });
  await seedReference(storage, 32, 11, "role_a");

  seed({ id: 12, name: "child", typeId: BASIC_TYPE_ID });
  // Stored compound rows WITHOUT a read_rule_id: the live walk decides.
  seed({ id: 35, name: "HostB+child", leftId: 34, rightId: 12, typeId: BASIC_TYPE_ID, dbContent: "readable child" });
  seed({ id: 36, name: "HostC+child", leftId: 33, rightId: 12, typeId: BASIC_TYPE_ID, dbContent: "locked child" });
  return storage;
}

describe("_left delegation: the lookup path and the live-walk path agree", () => {
  it("LOOKUP PATH: deriving a compound's read_rule_id stores the LEFT card's rule id", async () => {
    const storage = await seedDualPathDeck();
    try {
      storage.fetcher.installNameEnvironment();
      const deps = { driver: storage.fetcher.driver, fetch: storage.fetcher };
      const derived = await deriveReadRuleRecord(deps, {
        name: "HostB+child",
        typeId: BASIC_TYPE_ID,
        leftId: 34,
        rightId: 12,
        isNew: false,
      });
      // The child's own first existing candidate is the delegator
      // (*all plus+*read = 31, content "_left"); the stored id must be the
      // LEFT card's effective rule (HostB+*self+*read = 40) instead.
      expect(derived.readRuleId).toBe(40);
      // Sanity: the left's own derivation resolves the same rule.
      const left = await deriveReadRuleRecord(deps, {
        name: "HostB",
        typeId: BASIC_TYPE_ID,
        isNew: false,
      });
      expect(left.readRuleId).toBe(40);
    } finally {
      storage.close();
    }
  });

  it("LIVE-WALK PATH: the same compound without a stored id resolves allowed through the left chain", async () => {
    const storage = await seedDualPathDeck();
    try {
      storage.fetcher.installNameEnvironment();
      const state = await resolveAnonymousReadPermission(storage.fetcher.driver);
      // Stored-row shape (id 35, no read_rule_id) — the fetch-placeholder
      // surface the render path walks.
      const storedRow: PatternCardInput = {
        name: DeckoName.parse("HostB+child"),
        id: 35,
        typeId: BASIC_TYPE_ID,
      };
      expect(await canReadByRuleLookup(storage.fetcher, storedRow, state)).toBe(true);
      // Name-only shape (no id) — the new-card surface; the SELF candidate
      // drops and the delegation still routes through the left chain.
      const nameOnly: PatternCardInput = {
        name: DeckoName.parse("HostB+child"),
        id: undefined,
        typeId: BASIC_TYPE_ID,
      };
      expect(await canReadByRuleLookup(storage.fetcher, nameOnly, state)).toBe(true);
    } finally {
      storage.close();
    }
  });

  it("BOTH PATHS DENY through the same chain when the left card's rule locks", async () => {
    const storage = await seedDualPathDeck();
    try {
      storage.fetcher.installNameEnvironment();
      const deps = { driver: storage.fetcher.driver, fetch: storage.fetcher };
      const state = await resolveAnonymousReadPermission(storage.fetcher.driver);
      // Lookup path: the derived id is HostC's locking SELF rule (32), not
      // the delegator (31) — the chain, not the delegating rule's grants.
      const derived = await deriveReadRuleRecord(deps, {
        name: "HostC+child",
        typeId: BASIC_TYPE_ID,
        leftId: 33,
        rightId: 12,
        isNew: false,
      });
      expect(derived.readRuleId).toBe(32);
      expect(state.readableRuleIds.has(32)).toBe(false);
      // Live-walk path: the same verdict through the same chain.
      const walk: PatternCardInput = {
        name: DeckoName.parse("HostC+child"),
        id: 36,
        typeId: BASIC_TYPE_ID,
      };
      expect(await canReadByRuleLookup(storage.fetcher, walk, state)).toBe(false);
    } finally {
      storage.close();
    }
  });
});
