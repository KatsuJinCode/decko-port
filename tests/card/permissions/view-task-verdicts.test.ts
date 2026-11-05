

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import {
  allTaskVerdictsForCard,
  taskVerdictForCard,
  viewTaskPermissionStatements,
  viewTaskStateFromResults,
} from "../../../src/card/permissions/view-task-rules.js";
import { readPermissionStatements } from "../../../src/card/permissions/read-rules.js";
import type { ReadPermissionState } from "../../../src/card/permissions/read-rules.js";
import type { PatternCardInput } from "../../../src/card/set-patterns/types.js";

const SET_TYPE_ID = 2;

let storage: RenderTestStorage | undefined;

let ruleless: RenderTestStorage | undefined;

async function seedTaskDeck(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 2, name: "Set", codename: "set" });
  await seedCard(s, { id: 3, name: "*update", codename: "update" });
  await seedCard(s, { id: 4, name: "*create", codename: "create" });
  await seedCard(s, { id: 5, name: "*delete", codename: "delete" });
  await seedCard(s, { id: 6, name: "Anyone", codename: "anyone" });
  await seedCard(s, { id: 7, name: "Editor" });
  await seedCard(s, { id: 8, name: "*type", codename: "type" });
  await seedCard(s, { id: 9, name: "*self", codename: "self" });
  await seedCard(s, { id: 10, leftId: 1, rightId: 3, dbContent: "[[Editor]]" });
  await seedReference(s, 10, 7, "editor");
  await seedCard(s, { id: 11, leftId: 1, rightId: 4, dbContent: "[[Editor]]" });
  await seedReference(s, 11, 7, "editor");

  await seedCard(s, { id: 12, leftId: 1, rightId: 5 });
  await seedCard(s, { id: 13, name: "Widget", typeId: 14, dbContent: "widget body" });
  await seedCard(s, { id: 14, name: "Basic" });
  await seedCard(s, { id: 15, leftId: 14, rightId: 8, typeId: SET_TYPE_ID });
}

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await seedTaskDeck(storage);
  ruleless = await createRenderTestStorage();
});

afterAll(() => {
  storage?.close();
  ruleless?.close();
});

async function anonymousReadState(s: RenderTestStorage): Promise<ReadPermissionState> {
  const results = await s.counting.batch(readPermissionStatements());
  const anyoneRow = (results[0]?.rows ?? []) as Array<{ id: number; codename: string | null }>;
  const anyoneId = anyoneRow.find((row) => row.codename === "anyone")?.id;
  return {
    readableRuleIds: new Set(),
    alwaysOk: false,
    hasReadRules: true,
    hasCatchAllReadRule: true,
    parties: anyoneId === undefined ? [] : [anyoneId],
  };
}

async function taskState(
  s: RenderTestStorage,
): Promise<ReturnType<typeof viewTaskStateFromResults>> {
  const results = await s.counting.batch(viewTaskPermissionStatements());
  return viewTaskStateFromResults(results, await anonymousReadState(s));
}

function widgetCard(): PatternCardInput {

  return { name: "Widget", id: 13, typeId: 14, typeName: "Basic" };
}

describe("who_can state (permissions.rb:47-49 + account_holder.rb:31-36)", () => {
  it("builds rule-party sets from the reference graph", async () => {
    const state = await taskState(storage!);
    expect(state.alwaysOk).toBe(false);

    expect([...state.ruleParties.update.get(10) ?? []]).toEqual([7]);
    expect([...state.ruleParties.create.get(11) ?? []]).toEqual([7]);
    const deleteParties = state.ruleParties.delete.get(12);
    expect(deleteParties).toBeInstanceOf(Set);
    expect(deleteParties!.size).toBe(0);
  });

  it("keeps the hasTaskRules existence gates per task", async () => {
    const state = await taskState(storage!);
    expect(state.hasTaskRules).toEqual({ update: true, create: true, delete: true });
    const empty = viewTaskStateFromResults([], undefined);
    expect(empty.hasTaskRules).toEqual({ update: false, create: false, delete: false });
  });
});

describe("ok_to_<task>? verdicts (permissions.rb:105-157)", () => {
  it("denies update through the card's OWN *self rule (Editor-only)", async () => {

    const s = storage!;
    await seedCard(s, { id: 16, leftId: 13, rightId: 9, typeId: SET_TYPE_ID });
    await seedCard(s, { id: 17, leftId: 16, rightId: 3, dbContent: "[[Editor]]" });
    await seedReference(s, 17, 7, "editor");
    const state = await taskState(s);
    expect(await taskVerdictForCard(s.fetcher, widgetCard(), "update", state)).toBe(false);
  });

  it("allows create through the *type rule's Anyone party", async () => {

    const s = storage!;
    await seedCard(s, { id: 18, leftId: 15, rightId: 4, dbContent: "[[Anyone]]" });
    await seedReference(s, 18, 6, "anyone");
    const state = await taskState(s);
    expect(await taskVerdictForCard(s.fetcher, widgetCard(), "create", state)).toBe(true);
  });

  it("walks candidates through the composed-key closure (junction rule key)", async () => {

    const s = storage!;
    await seedCard(s, { id: 19, name: "Gadget", typeId: 14, dbContent: "gadget" });
    await seedCard(s, { id: 20, leftId: 15, rightId: 3, dbContent: "[[Anyone]]" });
    await seedReference(s, 20, 6, "anyone");
    const state = await taskState(s);
    expect(
      await taskVerdictForCard(
        s.fetcher,
        { name: "Gadget", id: 19, typeId: 14, typeName: "Basic" },
        "update",
        state,
      ),
    ).toBe(true);

    expect(await taskVerdictForCard(s.fetcher, widgetCard(), "update", state)).toBe(false);
  });

  it("denies delete through an EMPTY applicable rule (who_can -> [])", async () => {
    const state = await taskState(storage!);
    expect(await taskVerdictForCard(storage!.fetcher, widgetCard(), "delete", state)).toBe(false);
  });

  it("short-circuits everything for an always-ok actor (permitted? :108-109)", async () => {
    const results = await storage!.counting.batch(viewTaskPermissionStatements());
    const state = viewTaskStateFromResults(results, {
      readableRuleIds: new Set(),
      alwaysOk: true,
      hasReadRules: true,
      hasCatchAllReadRule: true,
      parties: [],
    });
    const verdicts = await allTaskVerdictsForCard(storage!.fetcher, widgetCard(), state);
    expect(verdicts).toEqual({ update: true, create: true, delete: true });
  });

  it("degrades to unverifiable (undefined) on a rule-less deck", async () => {
    const state = viewTaskStateFromResults([], await anonymousReadState(ruleless!));
    for (const task of ["update", "create", "delete"] as const) {
      expect(
        await taskVerdictForCard(ruleless!.fetcher, widgetCard(), task, state),
      ).toBeUndefined();
    }
  });
});

describe("junction create sides (ok_to_create_side, permissions.rb:127-137)", () => {
  it("passes when every side part exists (part_card.new_card? false)", async () => {
    const s = storage!;
    await seedCard(s, { id: 21, name: "Left Part", typeId: 14, dbContent: "left" });
    await seedCard(s, { id: 22, leftId: 21, rightId: 13, dbContent: "junction" });
    const state = await taskState(s);
    const junction: PatternCardInput = {
      name: "Left Part+Widget", id: 22, typeId: 14, typeName: "Basic",
    };
    expect(await taskVerdictForCard(s.fetcher, junction, "create", state)).toBe(true);
  });

  it("denies when a missing part cannot be created as a virtual new card", async () => {

    const s = storage!;
    await seedCard(s, { id: 23, name: "Unparted", typeId: 14, dbContent: "trunk" });
    const state = await taskState(s);
    const junction: PatternCardInput = {
      name: "Unparted+Ghost Part", typeId: 14, typeName: "Basic",
    };
    expect(await taskVerdictForCard(s.fetcher, junction, "create", state)).toBe(false);
  });
});
