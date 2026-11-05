

import { describe, expect, it } from "vitest";
import {
  actionEngine,
  createActionsTestStorage,
  seedCard,
  seedStandardDeck,
  CARDTYPE_ID,
} from "../actions/actions-test-storage.js";

interface RefRow {
  id: number;
  referer_id: number;
  referee_key: string | null;
  referee_id: number | null;
  ref_type: string;
  is_present: number | null;
}

async function refsFor(
  storage: Awaited<ReturnType<typeof createActionsTestStorage>>,
  refererId: number,
): Promise<RefRow[]> {
  return storage.selectAll<RefRow>(
    `SELECT id, referer_id, referee_key, referee_id, ref_type, is_present
     FROM card_references WHERE referer_id = ? ORDER BY id`,
    [refererId],
  );
}

function shape(rows: RefRow[]): Array<{
  refereeKey: string | null;
  refereeId: number | null;
  refType: string;
  isPresent: number | null;
}> {
  return rows.map((r) => ({
    refereeKey: r.referee_key,
    refereeId: r.referee_id,
    refType: r.ref_type,
    isPresent: r.is_present,
  }));
}

describe("card_references write path (refresh_references_out port)", () => {
  it("create with mixed content populates L/I/P rows in Ruby's order and dedupe", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    const target = await engine.createCard({ name: "Ref Target", content: "target body" });
    const parent = await engine.createCard({ name: "Ref Parent", content: "parent body" });

    const referer = await engine.createCard({
      name: "Ref Page",
      content:
        "see [[Ref Target]] and {{Ref Target}} plus [[Missing Page]] " +
        "plus {{Ref Parent+Ref Ghost}} and {{#quiet}} and " +
        "[[https://example.com|site]] and {{_self}}",
    });

    const rows = await refsFor(storage, referer.cardId);
    for (const row of rows) expect(row.referer_id).toBe(referer.cardId);
    expect(shape(rows)).toEqual([

      { refereeKey: "ref_target", refereeId: target.cardId, refType: "L", isPresent: null },

      { refereeKey: "ref_target", refereeId: target.cardId, refType: "I", isPresent: null },

      { refereeKey: "missing_page", refereeId: null, refType: "L", isPresent: null },

      {
        refereeKey: "ref_parent+ref_ghost",
        refereeId: null,
        refType: "I",
        isPresent: null,
      },
      { refereeKey: "ref_parent", refereeId: parent.cardId, refType: "P", isPresent: null },
      { refereeKey: "ref_ghost", refereeId: null, refType: "P", isPresent: null },

    ]);
    storage.close();
  });

  it("update with new content rebuilds the rows (delete + recreate, all.rb:47-50)", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    const target = await engine.createCard({ name: "Ref Target", content: "target body" });
    const referer = await engine.createCard({
      name: "Ref Page",
      content: "see [[Missing Page]]",
    });
    expect((await refsFor(storage, referer.cardId)).length).toBe(1);

    await engine.updateCard({
      cardId: referer.cardId,
      content: "now [[Ref Target]] only",
    });

    expect(shape(await refsFor(storage, referer.cardId))).toEqual([
      { refereeKey: "ref_target", refereeId: target.cardId, refType: "L", isPresent: null },
    ]);
    storage.close();
  });

  it("a save that does not change content leaves the rows untouched (changed: :content)", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);

    await seedCard(storage, { id: 4, name: "Search", codename: "search", typeId: CARDTYPE_ID });
    const engine = actionEngine(storage);

    const target = await engine.createCard({ name: "Ref Target", content: "target body" });
    const content = "see [[Ref Target]] and [[Missing Page]]";
    const referer = await engine.createCard({ name: "Ref Page", content });
    const before = await refsFor(storage, referer.cardId);
    expect(before.length).toBe(2);

    await engine.updateCard({ cardId: referer.cardId, content, typeId: 4 });

    const after = await refsFor(storage, referer.cardId);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(shape(after)).toEqual(shape(before));
    storage.close();
  });

  it("an explicit type on a key drops its partial row (all.rb:116-120)", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    const parent = await engine.createCard({ name: "Ref Parent", content: "parent body" });
    const referer = await engine.createCard({
      name: "Ref Page Two",
      content: "[[Ref Parent]] then {{Ref Parent+Ref Ghost}}",
    });

    expect(shape(await refsFor(storage, referer.cardId))).toEqual([
      { refereeKey: "ref_parent", refereeId: parent.cardId, refType: "L", isPresent: null },
      {
        refereeKey: "ref_parent+ref_ghost",
        refereeId: null,
        refType: "I",
        isPresent: null,
      },
      { refereeKey: "ref_ghost", refereeId: null, refType: "P", isPresent: null },
    ]);
    storage.close();
  });

  it("an existing compound referee resolves referee_id through its sides", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    await engine.createCard({ name: "Sign up", content: "" });
    const junction = await engine.createCard({
      name: "Sign up+wccchild",
      content: "child body",
    });

    const referer = await engine.createCard({
      name: "Junction Fan",
      content: "[[Sign up+wccchild]] and {{Sign up+wccchild}}",
    });

    expect(shape(await refsFor(storage, referer.cardId))).toEqual([
      {
        refereeKey: "sign_up+wccchild",
        refereeId: junction.cardId,
        refType: "L",
        isPresent: null,
      },
      {
        refereeKey: "sign_up+wccchild",
        refereeId: junction.cardId,
        refType: "I",
        isPresent: null,
      },
    ]);
    storage.close();
  });

  it("delete clears the referer's rows and unmaps the id from other rows (clear_references)", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    const target = await engine.createCard({ name: "Ref Target", content: "target body" });
    const subject = await engine.createCard({
      name: "Cleanup Subject",
      content: "[[Ref Target]]",
    });
    const observer = await engine.createCard({
      name: "Cleanup Observer",
      content: "[[Cleanup Subject]]",
    });

    expect(shape(await refsFor(storage, observer.cardId))).toEqual([
      {
        refereeKey: "cleanup_subject",
        refereeId: subject.cardId,
        refType: "L",
        isPresent: null,
      },
    ]);

    await engine.deleteCard({ cardId: subject.cardId });

    expect(await refsFor(storage, subject.cardId)).toEqual([]);

    expect(shape(await refsFor(storage, observer.cardId))).toEqual([
      { refereeKey: "cleanup_subject", refereeId: null, refType: "L", isPresent: null },
    ]);

    expect(shape(await refsFor(storage, target.cardId))).toEqual([]);
    storage.close();
  });

  it("mirrors the write-conformance fixture 08 shape: nest to a not-yet-existing junction", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    const referer = await engine.createCard({
      name: "WCC Referer",
      content: "see {{WCC Referer+child}}",
    });

    const rows = await refsFor(storage, referer.cardId);
    expect(shape(rows)).toEqual([
      { refereeKey: "wcc_referer+child", refereeId: null, refType: "I", isPresent: null },
      { refereeKey: "child", refereeId: null, refType: "P", isPresent: null },
    ]);

    storage.close();
  });
});
