

import { describe, expect, it } from "vitest";
import {
  actionEngine,
  createActionsTestStorage,
  seedStandardDeck,
  type ActionsTestStorage,
} from "./actions-test-storage.js";
import { refreshReferencesIn } from "../../../src/card/actions/refresh-references-in.js";
import { updateRefererReferencesOut } from "../../../src/card/actions/update-referer-content.js";
import { DeckoName } from "../../../src/card/name.js";

interface RefRow {
  id: number;
  referer_id: number;
  referee_key: string | null;
  referee_id: number | null;
  ref_type: string;
  is_present: number | null;
}

async function refsForReferer(
  storage: ActionsTestStorage,
  refererId: number,
): Promise<RefRow[]> {
  return storage.selectAll<RefRow>(
    `SELECT id, referer_id, referee_key, referee_id, ref_type, is_present
     FROM card_references WHERE referer_id = ? ORDER BY id`,
    [refererId],
  );
}

async function contentOf(
  storage: ActionsTestStorage,
  cardId: number,
): Promise<string | null> {
  const row = await storage.selectOne<{ db_content: string | null }>(
    "SELECT db_content FROM cards WHERE id = ?",
    [cardId],
  );
  return row?.db_content ?? null;
}

function shape(rows: RefRow[]): Array<{
  refereeKey: string | null;
  refereeId: number | null;
  refType: string;
}> {
  return rows.map((r) => ({
    refereeKey: r.referee_key,
    refereeId: r.referee_id,
    refType: r.ref_type,
  }));
}

describe("rename rewrites referer content (update_referer_content port)", () => {
  it("swaps links and nests in referer content and rebuilds rows with the same id", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    const blue = await engine.createCard({ name: "Blue", content: "color body" });
    const referer = await engine.createCard({
      name: "Blue Includer",
      content: "{{Blue}} and [[blue]]",
    });
    const refererActionsBefore = await storage.selectOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM card_actions WHERE card_id = ?",
      [referer.cardId],
    );

    await engine.updateCard({ cardId: blue.cardId, name: "Red" });

    await expect(contentOf(storage, referer.cardId)).resolves.toBe("{{Red}} and [[Red]]");

    const refererActionsAfter = await storage.selectOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM card_actions WHERE card_id = ?",
      [referer.cardId],
    );
    expect(refererActionsAfter?.n).toBe(refererActionsBefore?.n);

    expect(shape(await refsForReferer(storage, referer.cardId))).toEqual([
      { refereeKey: "red", refereeId: blue.cardId, refType: "I" },
      { refereeKey: "red", refereeId: blue.cardId, refType: "L" },
    ]);
    storage.close();
  });

  it("keeps link text and nest option lists verbatim (spec :166-170)", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    const blue = await engine.createCard({ name: "Blue", content: "body" });
    const referer = await engine.createCard({
      name: "Blue Fan",
      content: "[[Blue|click here]] and {{Blue|closed;other:stuff}} and {{ Blue }}",
    });

    await engine.updateCard({ cardId: blue.cardId, name: "Red" });

    await expect(contentOf(storage, referer.cardId)).resolves.toBe(
      "[[Red|click here]] and {{Red|closed;other:stuff}} and {{Red}}",
    );
    storage.close();
  });

  it("leaves explicit-resource links and comment nests byte-identical (port divergence)", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    const blue = await engine.createCard({ name: "Blue", content: "body" });
    const referer = await engine.createCard({
      name: "Blue Linker",
      content: "go [[https://x.example|site]] and {{#quiet}} and [[Blue]]",
    });

    await engine.updateCard({ cardId: blue.cardId, name: "Red" });

    await expect(contentOf(storage, referer.cardId)).resolves.toBe(
      "go [[https://x.example|site]] and {{#quiet}} and [[Red]]",
    );
    expect(shape(await refsForReferer(storage, referer.cardId))).toEqual([
      { refereeKey: "red", refereeId: blue.cardId, refType: "L" },
    ]);
    storage.close();
  });

  it("rewrites referers of virtually renamed descendants (rename_as_descendant)", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    const one = await engine.createCard({ name: "One", content: "root body" });
    const junction = await engine.createCard({ name: "One+Two", content: "j body" });
    const grand = await engine.createCard({ name: "One+Two+Three", content: "g body" });
    const watcher = await engine.createCard({
      name: "One Watcher",
      content: "[[One+Two]]",
    });
    const deepWatcher = await engine.createCard({
      name: "Deep Watcher",
      content: "{{One+Two+Three}}",
    });

    await engine.updateCard({ cardId: one.cardId, name: "Uno" });

    await expect(contentOf(storage, watcher.cardId)).resolves.toBe("[[Uno+Two]]");
    await expect(contentOf(storage, deepWatcher.cardId)).resolves.toBe("{{Uno+Two+Three}}");
    expect(shape(await refsForReferer(storage, watcher.cardId))).toEqual([
      { refereeKey: "uno+two", refereeId: junction.cardId, refType: "L" },
    ]);
    expect(shape(await refsForReferer(storage, deepWatcher.cardId))).toEqual([
      { refereeKey: "uno+two+three", refereeId: grand.cardId, refType: "I" },
    ]);

    await expect(contentOf(storage, junction.cardId)).resolves.toBe("j body");
    await expect(contentOf(storage, grand.cardId)).resolves.toBe("g body");
    storage.close();
  });

  it("does not rewrite a card's references to itself (no self rows, spec :151-162)", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    const selfy = await engine.createCard({
      name: "Selfy",
      content: "[[Selfy]] and {{Selfy}}",
    });

    expect(await refsForReferer(storage, selfy.cardId)).toEqual([]);

    await engine.updateCard({ cardId: selfy.cardId, name: "Buttah" });

    await expect(contentOf(storage, selfy.cardId)).resolves.toBe("[[Selfy]] and {{Selfy}}");
    expect(await refsForReferer(storage, selfy.cardId)).toEqual([]);
    storage.close();
  });
});

describe("refresh_references_in backfills referee ids (map_referees port)", () => {
  it("backfills dangling rows when the renamed card adopts the new key's rows", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    const blue = await engine.createCard({ name: "Blue", content: "body" });
    const oldFan = await engine.createCard({ name: "Old Fan", content: "[[Blue]]" });
    const newFan = await engine.createCard({ name: "New Fan", content: "[[Red]]" });

    expect(shape(await refsForReferer(storage, newFan.cardId))).toEqual([
      { refereeKey: "red", refereeId: null, refType: "L" },
    ]);

    await engine.updateCard({ cardId: blue.cardId, name: "Red" });

    expect(shape(await refsForReferer(storage, oldFan.cardId))).toEqual([
      { refereeKey: "red", refereeId: blue.cardId, refType: "L" },
    ]);

    await expect(contentOf(storage, newFan.cardId)).resolves.toBe("[[Red]]");
    expect(shape(await refsForReferer(storage, newFan.cardId))).toEqual([
      { refereeKey: "red", refereeId: blue.cardId, refType: "L" },
    ]);
    storage.close();
  });

  it("backfills L/I/P rows alike as referees come into existence (no ref_type filter)", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    const fan = await engine.createCard({
      name: "Backfill Fan",
      content: "see {{WCC Ghost+child}} and [[Ghost Page]]",
    });

    expect(shape(await refsForReferer(storage, fan.cardId))).toEqual([
      { refereeKey: "wcc_ghost+child", refereeId: null, refType: "I" },
      { refereeKey: "wcc_ghost", refereeId: null, refType: "P" },
      { refereeKey: "child", refereeId: null, refType: "P" },
      { refereeKey: "ghost_page", refereeId: null, refType: "L" },
    ]);

    const junction = await engine.createCard({ name: "WCC Ghost+child", content: "j" });
    const ghostPage = await engine.createCard({ name: "Ghost Page", content: "gp" });
    const ghostSide = await storage.selectOne<{ id: number }>(
      "SELECT id FROM cards WHERE key = 'wcc_ghost' AND trash = 0",
    );
    const childSide = await storage.selectOne<{ id: number }>(
      "SELECT id FROM cards WHERE key = 'child' AND trash = 0",
    );

    expect(shape(await refsForReferer(storage, fan.cardId))).toEqual([
      { refereeKey: "wcc_ghost+child", refereeId: junction.cardId, refType: "I" },
      { refereeKey: "wcc_ghost", refereeId: ghostSide?.id ?? null, refType: "P" },
      { refereeKey: "child", refereeId: childSide?.id ?? null, refType: "P" },
      { refereeKey: "ghost_page", refereeId: ghostPage.cardId, refType: "L" },
    ]);
    storage.close();
  });
});

describe("module: the skip twin the save path cannot reach yet", () => {
  it("update_referer_references_out keeps content but rebuilds rows; refresh_references_in unmaps then maps", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);
    const deps = { driver: storage.driver, lexicon: storage.engine.lexicon };

    const target = await engine.createCard({ name: "Old Name", content: "body" });
    const skipFan = await engine.createCard({ name: "Skip Fan", content: "[[Old Name]]" });
    const newFan = await engine.createCard({ name: "New Fan", content: "[[New Name]]" });
    expect(shape(await refsForReferer(storage, newFan.cardId))).toEqual([
      { refereeKey: "new_name", refereeId: null, refType: "L" },
    ]);

    await storage.driver.query("UPDATE cards SET name = ?, key = ? WHERE id = ?", [
      "New Name",
      "new_name",
      target.cardId,
    ]);
    deps.lexicon.deleteFor(undefined, "Old Name");
    deps.lexicon.write(target.cardId, DeckoName.parse("New Name"), "New Name");

    await updateRefererReferencesOut(deps, target.cardId);
    await expect(contentOf(storage, skipFan.cardId)).resolves.toBe("[[Old Name]]");
    expect(shape(await refsForReferer(storage, skipFan.cardId))).toEqual([
      { refereeKey: "old_name", refereeId: null, refType: "L" },
    ]);

    await storage.driver.query(
      `INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type)
       VALUES (?, ?, ?, ?)`,
      [skipFan.cardId, "stale_thing", target.cardId, "L"],
    );

    await refreshReferencesIn(deps.driver, target.cardId, "new_name", {
      unmapExisting: true,
    });
    const stale = await storage.selectAll<RefRow>(
      "SELECT referee_key, referee_id, ref_type FROM card_references WHERE referee_key = 'stale_thing'",
    );
    expect(stale.map((r) => ({ key: r.referee_key, id: r.referee_id }))).toEqual([
      { key: "stale_thing", id: null },
    ]);
    expect(shape(await refsForReferer(storage, newFan.cardId))).toEqual([
      { refereeKey: "new_name", refereeId: target.cardId, refType: "L" },
    ]);
    storage.close();
  });
});
