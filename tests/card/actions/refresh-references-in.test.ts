// card_references IN-direction + rename-side tests: refresh_references_in
// (the referee-side backfill) and update_referer_content (the referer
// content rewrite on rename), exercised through CardActionEngine — the
// rename seam — plus one module-level test for the skip twin
// (update_referer_references_out) the save path cannot reach yet.
//
// Expected values are HAND-DERIVED from the installed gems:
//   - event :refresh_references_in (card-1.110.0
//     mod/core/set/all/reference_events.rb:22-25): on every name-bearing
//     save, map_referees (lib/card/reference.rb:26-28) backfills
//     referee_id on EVERY row keyed to the card's key — "L", "I", "P"
//     alike (no ref_type filter); the unmap_referees arm (:31-33) needs
//     action == :update && skip_update_referers? and is out of the
//     engine's reach (no skip machinery) until the skip stream.
//   - event :update_referer_content (reference_events.rb:7-10):
//     referers.each { |r| r.replace_references name_before_act, name }
//     (replace_references :48-50 -> content_quietly= :52-58 -> direct
//     db_content column write + update_references_out, all.rb:47-50),
//     then each_descendant -> rename_as_descendant (:39-46) for the
//     virtually renamed junctions.
//   - swap semantics: Link#swap_name (card-mod-content-0.20.0
//     lib/card/content/chunk/link.rb:35-40 — rebuilt as
//     [[absolutized-swapped-name|sub_in'd text]]), Nest#swap_name
//     (chunk/nest.rb:77-81 — swapped name, option list after the first
//     pipe preserved verbatim, name whitespace collapsed at interpret
//     :16-26). Key-comparison swap: cardname-0.20.0
//     lib/cardname/manipulate.rb:20-33 (spec evidence:
//     mod/core/spec/set/all/name_events_spec.rb:177-181 "case variants").
//   - spec mirrors: name_events_spec.rb:124-133 (referer rewrite),
//     :151-162 (self-reference rename leaves content alone — no self
//     rows exist, all.rb:93), :166-170 (nest updates), :69-73 (picks up
//     new references = map_referees backfill).
//   - Divergences (documented in update-referer-content.ts): Ruby rebuilds
//     explicit-resource links and comment nests into corrupted forms on
//     swap (nil @name -> "[[|text]]"/"{{}}"); this port preserves them
//     byte-identically, and the tests below LOCK that preservation.

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

    // Link + nest swapped; the key-comparison swap turns [[blue]] into
    // [[Red]] (manipulate.rb:20-33; spec :177-181 "case variants"). The
    // nest scans before the link, so it leads the rebuilt content.
    await expect(contentOf(storage, referer.cardId)).resolves.toBe("{{Red}} and [[Red]]");
    // content_quietly= wrote the column DIRECTLY (update_column,
    // reference_events.rb:56): no new act/action rows for the referer.
    const refererActionsAfter = await storage.selectOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM card_actions WHERE card_id = ?",
      [referer.cardId],
    );
    expect(refererActionsAfter?.n).toBe(refererActionsBefore?.n);
    // update_references_out rebuilt the rows against the NEW name; the
    // referee id is unchanged (a rename never changes ids), nest scans
    // before link so the I row lands first (all.rb:47-50, parser order).
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

    // link.rb:35-40 rebuilds [[Red|click here]] (text kept, sub_in found
    // nothing to substitute); nest.rb:77-81 keeps "|closed;other:stuff"
    // verbatim; the padded nest collapses to the stripped swapped name
    // (interpret stripped it, nest.rb:19).
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

    // Ruby's unconditional rebuild would corrupt these to
    // "[[|site]]"/"{{}}" (nil @name; link.rb:35-40, nest.rb:77-81);
    // this port preserves them and still swaps the real reference.
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

    // each_descendant (descendants.rb:41-46) -> rename_as_descendant
    // (reference_events.rb:39-41): the junctions' composed names changed
    // virtually, so their referers' content follows, at BOTH depths.
    await expect(contentOf(storage, watcher.cardId)).resolves.toBe("[[Uno+Two]]");
    await expect(contentOf(storage, deepWatcher.cardId)).resolves.toBe("{{Uno+Two+Three}}");
    expect(shape(await refsForReferer(storage, watcher.cardId))).toEqual([
      { refereeKey: "uno+two", refereeId: junction.cardId, refType: "L" },
    ]);
    expect(shape(await refsForReferer(storage, deepWatcher.cardId))).toEqual([
      { refereeKey: "uno+two+three", refereeId: grand.cardId, refType: "I" },
    ]);
    // Zero row writes for the descendants themselves (post-2020 virtual
    // names): their db_content columns stayed put.
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
    // Self-references produce no rows at creation (all.rb:93), so the
    // card is never its own referer and the swap cannot hang on it.
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
    // newFan referenced "Red" before it existed: dangling L row.
    expect(shape(await refsForReferer(storage, newFan.cardId))).toEqual([
      { refereeKey: "red", refereeId: null, refType: "L" },
    ]);

    await engine.updateCard({ cardId: blue.cardId, name: "Red" });

    // oldFan: rewritten by update_referer_content, rows rebuilt against
    // the new name with the (unchanged) id.
    expect(shape(await refsForReferer(storage, oldFan.cardId))).toEqual([
      { refereeKey: "red", refereeId: blue.cardId, refType: "L" },
    ]);
    // newFan: content untouched (its swap was a no-op — reference_events
    // .rb:54 loop guard), but the map_referees arm adopted its dangling
    // row (reference.rb:26-28; spec :69-73 "picks up new references").
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
    // All four rows start dangling: the I row for the unknown junction,
    // its two P partials (all.rb:133-139), and the L row for the unknown
    // simple name.
    expect(shape(await refsForReferer(storage, fan.cardId))).toEqual([
      { refereeKey: "wcc_ghost+child", refereeId: null, refType: "I" },
      { refereeKey: "wcc_ghost", refereeId: null, refType: "P" },
      { refereeKey: "child", refereeId: null, refType: "P" },
      { refereeKey: "ghost_page", refereeId: null, refType: "L" },
    ]);

    // Creating the junction auto-creates its sides in the same act; each
    // of those creates runs refresh_references_in (changed: :name, on:
    // :save) and adopts the rows keyed to its name. ref_types NEVER
    // change: P stays P, the junction's I row matches only its own key.
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

    // Simulate the skipped rename's store stage by hand: the columns and
    // the Lexicon move, no rewrite happens (the same calls the engine's
    // expireAfterWrite makes on a rename).
    await storage.driver.query("UPDATE cards SET name = ?, key = ? WHERE id = ?", [
      "New Name",
      "new_name",
      target.cardId,
    ]);
    deps.lexicon.deleteFor(undefined, "Old Name");
    deps.lexicon.write(target.cardId, DeckoName.parse("New Name"), "New Name");

    // update_referer_references_out (reference_events.rb:16-19): the
    // referer's rows are rebuilt from UNCHANGED content so the stale-key
    // rows are correctly tracked — and Lexicon.id of the old name is gone,
    // so referee_id lands NULL (present-tense rows lose their id).
    await updateRefererReferencesOut(deps, target.cardId);
    await expect(contentOf(storage, skipFan.cardId)).resolves.toBe("[[Old Name]]");
    expect(shape(await refsForReferer(storage, skipFan.cardId))).toEqual([
      { refereeKey: "old_name", refereeId: null, refType: "L" },
    ]);

    // A stale row still pointing at the renamed id (past tense to be).
    await storage.driver.query(
      `INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type)
       VALUES (?, ?, ?, ?)`,
      [skipFan.cardId, "stale_thing", target.cardId, "L"],
    );

    // refresh_references_in with the skip arm armed
    // (reference_events.rb:22-25): unmap_referees first (reference.rb
    // :31-33) — the stale row loses the id — then map_referees
    // (:26-28) — the new_name row adopts it.
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
