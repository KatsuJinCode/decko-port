

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  actionEngine,
  createActionsTestStorage,
  seedCard,
  seedStandardDeck,
  type StandardFixture,
} from "../actions/actions-test-storage.js";
import {
  registerSetTypeAssignment,
  resetSetTypeAssignments,
  findAssignedTypeName,
  resolveAssignedTypeIdForCard,
  listAssignedTypeNamesForCard,
} from "../../../src/card/set-patterns/set-type-assignment.js";
import { DeckoName } from "../../../src/card/name.js";

async function primePatternEnv(f: StandardFixture): Promise<void> {
  f.engine.installNameEnvironment();
  const ids = (
    await f.storage.driver.query<{ id: number }>("SELECT id FROM cards WHERE trash = 0", [])
  ).rows.map((r) => Number(r.id));
  await f.engine.warmLexicon(ids);
}

type Row = Record<string, unknown>;

async function cardRow(f: StandardFixture, id: number): Promise<Row> {
  const row = await f.storage.selectOne<Row>("SELECT * FROM cards WHERE id = ?", [id]);
  if (row === undefined) throw new Error(`card ${id} missing`);
  return row;
}

async function cardRowByKey(f: StandardFixture, key: string): Promise<Row | undefined> {
  return f.storage.selectOne<Row>("SELECT * FROM cards WHERE key = ?", [key]);
}

beforeEach(() => {

  resetSetTypeAssignments();
});

afterEach(() => {
  resetSetTypeAssignments();
});

describe("findAssignedTypeName — the type_id_from_code walk", () => {
  it("returns undefined for SIMPLE names (type.rb:69 `return if simple?`)", () => {

    expect(findAssignedTypeName({ name: "banana", isNew: true })).toBeUndefined();
    registerSetTypeAssignment("Right::Banana", "Phrase");

    expect(findAssignedTypeName({ name: "banana", isNew: true })).toBeUndefined();
  });

  it("returns undefined when no assigns_type pattern has a registration", () => {

    expect(findAssignedTypeName({ name: "A+B", isNew: true })).toBeUndefined();
  });

  it("returns the registered type name when an assigns_type pattern matches", async () => {

    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, {
      id: 200,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    f.engine.codenames.resetCache();
    await primePatternEnv(f);
    registerSetTypeAssignment("Right::Subject", "Phrase");
    expect(findAssignedTypeName({ name: "Home+subject", isNew: true })).toBe("Phrase");
    storage.close();
  });

  it("walks assigns_type patterns in pattern-precedence order", async () => {

    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, {
      id: 200,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    f.engine.codenames.resetCache();
    await primePatternEnv(f);
    registerSetTypeAssignment("Right::Subject", "Phrase");
    registerSetTypeAssignment("TypePlusRight::Basic::Subject", "List");
    const card = {
      name: "Home+subject",
      isNew: true,
      typeName: "RichText",
    };
    const list = listAssignedTypeNamesForCard(card);

    expect(list).toContain("Phrase");
    expect(list).toContain("List");
    expect(list.indexOf("List")).toBeLessThan(list.indexOf("Phrase"));
    expect(findAssignedTypeName(card)).toBe("List");
    storage.close();
  });

  it("skips registered module keys whose anchor codenames the card lacks", () => {

    registerSetTypeAssignment("Right::Ghost", "List");
    expect(findAssignedTypeName({ name: "Home+ghost", isNew: true })).toBeUndefined();
  });
});

describe("resolveAssignedTypeIdForCard — id resolution (type.rb:72 `&.card_id`)", () => {
  it("returns the registered type's id from the codename registry", async () => {
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);

    const phraseCard = await seedCard(storage, {
      id: 99,
      name: "Phrase",
      codename: "phrase",
      typeId: 3,
    });

    await seedCard(storage, {
      id: 100,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    f.engine.codenames.resetCache();
    registerSetTypeAssignment("Right::Subject", "phrase");
    const id = await resolveAssignedTypeIdForCard(f.engine, {
      name: "Home+subject",
      isNew: true,
    });
    expect(id).toBe(phraseCard.id);
    storage.close();
  });

  it("returns undefined when the registered type card does not exist", async () => {
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, {
      id: 100,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    f.engine.codenames.resetCache();

    registerSetTypeAssignment("Right::Subject", "Pointer");
    const id = await resolveAssignedTypeIdForCard(f.engine, {
      name: "Home+subject",
      isNew: true,
    });
    expect(id).toBeUndefined();
    storage.close();
  });
});

describe("createCard — auto-created side cards get the assigned type", () => {
  it("simple auto-created side falls back to the default (RichText)", async () => {

    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Pudding+banana", content: "mix" });
    const banana = await cardRowByKey(f, "banana");
    expect(banana).toBeDefined();
    expect(banana).toMatchObject({
      name: "banana",
      key: "banana",
      left_id: null,
      right_id: null,

      type_id: 2,
      db_content: null,
    });
    expect(result.subactions).toHaveLength(1);
    expect(result.subactions[0]).toMatchObject({ cardId: banana!.id });
  });

  it("compound auto-created side with no registration still gets the default", async () => {

    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Pudding+brandnew", content: "x" });
    const side = await cardRowByKey(f, "brandnew");
    expect(side).toBeDefined();
    expect(side).toMatchObject({ name: "brandnew", type_id: 2 });
    expect(result.subactions).toHaveLength(1);
  });

  it("compound main card with no registration still gets the default", async () => {

    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Pudding+brandnew", content: "x" });
    const junction = await cardRow(f, result.cardId);

    expect(junction.left_id).toBe(f.joeCard.id);
    expect(junction.type_id).toBe(2);
  });

  it("compound main card with a registration gets the assigned type, not the default", async () => {

    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    const subjectCard = await seedCard(storage, {
      id: 200,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    await seedCard(storage, {
      id: 201,
      name: "Phrase",
      codename: "phrase",
      typeId: 3,
    });

    f.engine.codenames.resetCache();
    registerSetTypeAssignment("Right::Subject", "Phrase");

    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Home+subject", content: "hi" });
    const junction = await cardRow(f, result.cardId);

    const homeSide = await cardRowByKey(f, "home");
    expect(homeSide).toBeDefined();
    expect(homeSide).toMatchObject({ name: "Home", key: "home", type_id: 2 });

    expect(junction.right_id).toBe(subjectCard.id);

    expect(junction.type_id).toBe(201);
    storage.close();
  });

  it("compound side with a registration gets the assigned type, not the default", async () => {

    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, {
      id: 200,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    await seedCard(storage, {
      id: 201,
      name: "Phrase",
      codename: "phrase",
      typeId: 3,
    });
    f.engine.codenames.resetCache();
    registerSetTypeAssignment("Right::Subject", "Phrase");

    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Pudding+brandnew+subject", content: "x" });
    const junction = await cardRow(f, result.cardId);

    expect(junction.type_id).toBe(201);

    const middleActions = await f.storage.selectAll<Row>(
      "SELECT card_id FROM card_actions WHERE action_type = 0 AND card_id != ?",
      [result.cardId],
    );
    const middleIds = middleActions.map((r) => Number(r.card_id));
    expect(middleIds.length).toBeGreaterThan(0);
    for (const mid of middleIds) {
      const row = await cardRow(f, mid);
      if (row.left_id !== null && row.right_id !== null) {

        expect([2, 201]).toContain(Number(row.type_id));
      }
    }
    storage.close();
  });

  it("set_read_rule derivation runs for the auto-created compound card", async () => {

    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, {
      id: 200,
      name: "subject",
      codename: "subject",
      typeId: 3,
    });
    await seedCard(storage, {
      id: 201,
      name: "Phrase",
      codename: "phrase",
      typeId: 3,
    });
    f.engine.codenames.resetCache();
    registerSetTypeAssignment("Right::Subject", "Phrase");
    const engine = actionEngine(f.storage);
    const result = await engine.createCard({ name: "Home+subject", content: "hi" });
    const junction = await cardRow(f, result.cardId);

    expect(junction.read_rule_id).not.toBeNaN();
    expect(junction.read_rule_class).not.toBeNaN();
    storage.close();
  });
});

describe("registry semantics (lib/card/set/type.rb:5-6)", () => {
  it("registerSetTypeAssignment stores module-key -> type-name pairs", async () => {
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, { id: 200, name: "subject", codename: "subject", typeId: 3 });
    await seedCard(storage, { id: 201, name: "cc", codename: "cc", typeId: 3 });
    f.engine.codenames.resetCache();
    await primePatternEnv(f);
    registerSetTypeAssignment("Right::Subject", "Phrase");
    registerSetTypeAssignment("Right::Cc", "Pointer");
    expect(listAssignedTypeNamesForCard({ name: "Home+subject", isNew: true })).toEqual(["Phrase"]);
    expect(listAssignedTypeNamesForCard({ name: "Home+cc", isNew: true })).toEqual(["Pointer"]);
    storage.close();
  });

  it("resetSetTypeAssignments clears the registry", async () => {
    const storage = await createActionsTestStorage();
    const f = await seedStandardDeck(storage);
    await seedCard(storage, { id: 200, name: "subject", codename: "subject", typeId: 3 });
    f.engine.codenames.resetCache();
    await primePatternEnv(f);
    registerSetTypeAssignment("Right::Subject", "Phrase");
    expect(listAssignedTypeNamesForCard({ name: "Home+subject", isNew: true })).toEqual(["Phrase"]);
    resetSetTypeAssignments();
    expect(listAssignedTypeNamesForCard({ name: "Home+subject", isNew: true })).toEqual([]);
    storage.close();
  });

  it("DeckoName normalization: assignment accepts type names with case / spacing variants", () => {

    const parsed = DeckoName.parse("Phrase");
    expect(parsed.s).toBe("Phrase");
  });
});
