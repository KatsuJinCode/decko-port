// card_references WRITE-path conformance: create/update through the ACTION
// engine (CardActionEngine) must populate card_references exactly as Ruby's
// refresh_references_out event does, and delete must clean it up.
//
// Expected rows below are HAND-DERIVED from the installed gems:
//   - event :refresh_references_out, :finalize, on: :save, changed: :content
//     (card-1.110.0 mod/core/set/all/reference_events.rb:2-4)
//   - update_references_out = delete + create
//     (lib/card/reference/all.rb:47-50); rows are
//     {referer_id, referee_key, referee_id, ref_type} (all.rb:105-110;
//     is_present is not written and stays NULL)
//   - ref_type codes: "L" link (card-mod-content-0.20.0
//     lib/card/content/chunk/link.rb:10), "I" inclusion (chunk/abstract.rb
//     card-1.110.0 :30-32), "P" partial (all.rb:10)
//   - referee_key canonicalization = Cardname#key (cardname-0.20.0
//     lib/cardname.rb:96-112 generate_key: downcase, underscores, folded
//     non-word runs); referee names are absolutized against the REFERER's
//     name (card-mod-content reference.rb:15) and self-references are
//     dropped (all.rb:93)
//   - referee_id = Lexicon.id(name) — existing cards resolve (simple names
//     by key, compound names through their sides' ids, lexicon.rb:105-110
//     name_to_lex), unknown names are NULL; an unknown COMPOUND referee
//     also records "P" partial rows for its left/right parts
//     (all.rb:133-139), and "P" is dropped from a key that also carries an
//     explicit type (all.rb:116-120)
//   - explicit-resource links ([[https://...]], [[/...]], [[mailto:...]])
//     and `{{#comment}}` nests carry NO reference (link.rb:82-83, nest.rb
//     :20-21)
//   - delete runs :clear_references (reference_events.rb:28-31): the
//     referer's rows are deleted (delete_references_out :63-65) and the
//     deleted id is unmapped from other cards' rows (unmap_referees,
//     lib/card/reference.rb:31-33)

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

/** Shape a row list for comparison; ids inside rows stay dynamic. */
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

    // Existing referees (referenced BEFORE the referer exists, so
    // referee_id resolution exercises Lexicon.id, all.rb:95).
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
      // [[Ref Target]] -> link (link.rb:10 CODE "L"), key canonicalized
      // (generate_key), id resolved (all.rb:95).
      { refereeKey: "ref_target", refereeId: target.cardId, refType: "L", isPresent: null },
      // {{Ref Target}} -> inclusion ("I", abstract.rb:30-32); SAME key as
      // the link so the ref_hash entry gains a second type (all.rb:83),
      // which becomes a SECOND row for that key (all.rb:100-114).
      { refereeKey: "ref_target", refereeId: target.cardId, refType: "I", isPresent: null },
      // [[Missing Page]] -> unknown referee: referee_id NULL.
      { refereeKey: "missing_page", refereeId: null, refType: "L", isPresent: null },
      // {{Ref Parent+Ref Ghost}} -> unknown compound referee: "I" row with
      // NULL id (side "Ref Ghost" unresolvable, lexicon.rb name_to_lex)
      // PLUS "P" partials for left/right (all.rb:133-139): the existing
      // left resolves (P row WITH id — the fixture 08 P-row shape), the
      // unknown right stays NULL.
      {
        refereeKey: "ref_parent+ref_ghost",
        refereeId: null,
        refType: "I",
        isPresent: null,
      },
      { refereeKey: "ref_parent", refereeId: parent.cardId, refType: "P", isPresent: null },
      { refereeKey: "ref_ghost", refereeId: null, refType: "P", isPresent: null },
      // {{#quiet}}, [[https://example.com|site]], {{_self}} produce NOTHING:
      // comment nests (nest.rb:20-21), explicit-resource links
      // (link.rb:82-83), and self-references (all.rb:93) are dropped.
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
    // A second Cardtype so a type-only change is a real (non-content) save.
    await seedCard(storage, { id: 4, name: "Search", codename: "search", typeId: CARDTYPE_ID });
    const engine = actionEngine(storage);

    const target = await engine.createCard({ name: "Ref Target", content: "target body" });
    const content = "see [[Ref Target]] and [[Missing Page]]";
    const referer = await engine.createCard({ name: "Ref Page", content });
    const before = await refsFor(storage, referer.cardId);
    expect(before.length).toBe(2);

    // Content IDENTICAL, type changes: the save persists (type diff) but
    // `changed: :content` is false, so refresh_references_out must not run
    // (reference_events.rb:2-4). Row ids are asserted STABLE to prove no
    // delete+reinsert happened.
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

    // ref_parent's types are [L, P]: the partial is "not necessary if there
    // are explicit references" (all.rb:117-118), so only the L row lands.
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

    // Compound names resolve through BOTH side ids (lexicon.rb name_to_lex)
    // -> the junction row's id, for both the link and the nest.
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

    // Before the delete: the observer's row points at the subject.
    expect(shape(await refsFor(storage, observer.cardId))).toEqual([
      {
        refereeKey: "cleanup_subject",
        refereeId: subject.cardId,
        refType: "L",
        isPresent: null,
      },
    ]);

    await engine.deleteCard({ cardId: subject.cardId });

    // The subject's own out-rows are gone (delete_references_out,
    // reference_events.rb:63-65)...
    expect(await refsFor(storage, subject.cardId)).toEqual([]);
    // ...and the observer's surviving row lost its referee_id
    // (unmap_referees, reference.rb:31-33).
    expect(shape(await refsFor(storage, observer.cardId))).toEqual([
      { refereeKey: "cleanup_subject", refereeId: null, refType: "L", isPresent: null },
    ]);
    // The untouched card's rows are unaffected.
    expect(shape(await refsFor(storage, target.cardId))).toEqual([]);
    storage.close();
  });

  it("mirrors the write-conformance fixture 08 shape: nest to a not-yet-existing junction", async () => {
    const storage = await createActionsTestStorage();
    await seedStandardDeck(storage);
    const engine = actionEngine(storage);

    // fixtures/write-conformance/08-touch-name-reference.jsonl: referer
    // created naming "WCC Referer+child" before that junction exists.
    const referer = await engine.createCard({
      name: "WCC Referer",
      content: "see {{WCC Referer+child}}",
    });

    // Fixture rows (ids are DB-local; the port asserts shape + order):
    //   {ref_type: "I", referee_key: "wcc_referer+child", referee_id: NULL}
    //   {ref_type: "P", referee_key: "child", ...}
    // The left partial "WCC Referer" is the referer itself -> self-reference
    // dropped (all.rb:93), so no ref_parent P row appears here.
    const rows = await refsFor(storage, referer.cardId);
    expect(shape(rows)).toEqual([
      { refereeKey: "wcc_referer+child", refereeId: null, refType: "I", isPresent: null },
      { refereeKey: "child", refereeId: null, refType: "P", isPresent: null },
    ]);
    // NOTE: Ruby's capture shows the P row's referee_id BACKFILLED once the
    // referee card is created (refresh_references_in -> map_referees,
    // reference_events.rb:22-25). That backfill is built now
    // (refresh-references-in.ts, wired in card-action-engine.ts) and is
    // covered by tests/card/actions/refresh-references-in.test.ts; this
    // fixture test pins only the at-creation rows, so it stays unasserted
    // here.
    storage.close();
  });
});
