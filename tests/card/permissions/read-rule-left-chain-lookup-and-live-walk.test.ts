

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

const SET_TYPE_ID = 3;
const BASIC_TYPE_ID = 4;

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

  seed({ id: 39, name: "HostB+*self", leftId: 34, rightId: 13, typeId: SET_TYPE_ID });
  seed({ id: 40, name: "HostB+*self+*read", leftId: 39, rightId: 2, typeId: SET_TYPE_ID, dbContent: "[[anyone]]" });
  await seedReference(storage, 40, 9, "anyone");

  seed({ id: 33, name: "HostC", typeId: BASIC_TYPE_ID, dbContent: "locked host" });
  seed({ id: 38, name: "HostC+*self", leftId: 33, rightId: 13, typeId: SET_TYPE_ID });
  seed({ id: 32, name: "HostC+*self+*read", leftId: 38, rightId: 2, typeId: SET_TYPE_ID, dbContent: "[[Role_A]]" });
  await seedReference(storage, 32, 11, "role_a");

  seed({ id: 12, name: "child", typeId: BASIC_TYPE_ID });

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

      expect(derived.readRuleId).toBe(40);

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

      const storedRow: PatternCardInput = {
        name: DeckoName.parse("HostB+child"),
        id: 35,
        typeId: BASIC_TYPE_ID,
      };
      expect(await canReadByRuleLookup(storage.fetcher, storedRow, state)).toBe(true);

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

      const derived = await deriveReadRuleRecord(deps, {
        name: "HostC+child",
        typeId: BASIC_TYPE_ID,
        leftId: 33,
        rightId: 12,
        isNew: false,
      });
      expect(derived.readRuleId).toBe(32);
      expect(state.readableRuleIds.has(32)).toBe(false);

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
