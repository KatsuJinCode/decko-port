// The card-mod-edit CORE EDIT-FORM PATH (write-path slice 3): the ported
// :edit / :edit_form / :edit_type_row / :edit_buttons / :content_formgroups /
// :content_formgroup / :conflict_tracker / :input views, rendered through the
// real RenderEngine, byte-compared against the captured signed-in edit-form
// oracle (fixtures/captured/edit-forms.json).
//
// Oracle provenance: the capture ran INSIDE the live decko-0.20.0 demo app
// (tools/oracle/decko-oracle-app) via the decko runner script
// tests/card/mod-loader/oracle-capture-edit-forms.rb, for two existing
// RichText cards ("Oracle Basics" id 605, the deck-level "Home" id 521)
// and three actors (Decko Bot = signed-in admin, Sara = signed-in
// non-admin, Anonymous). Raw HTTP captures of the same surfaces sit in
// C:/localProjects/brandonDojoTech/tmp/wrong-goal-hunt/captures-auth-forms/
// (oracle-basics-edit-form.html / home-edit-form.html + the modal-wrapped
// :edit bytes). The JSON fixture is the pinned oracle: pretty-printed,
// deeply sorted keys, byte-identical re-runs.
//
// Capture normalizations (applied to BOTH sides - the fixture carries the
// placeholders, this test applies the same masks to its own renders):
// - data-slot-id -> RANDOMIZED (SecureRandom.hex(10) by design, wrap.rb:45);
// - data-card-id -> RANDOMIZED (seed state, not form semantics);
// - the conflict tracker hidden field's value -> ACTION_ID (the card's
//   last action id at capture time - seed state; the raw captures hold
//   693 / 604). data-select2-id (the fixture's third normalization) does
//   not occur on this surface: the captured views render the type ROW, not
//   the select-tag formgroup.
//
// Conflict view provenance: the conflict UI was captured at VALIDATION
// level, not as HTTP bytes - a stale last_action_id_before_edit + update!
// triggers detect_conflict (card-mod-history set/all/history/events.rb:19),
// adds the :conflict error ("changes not based on latest revision") and
// aborts before persistence; the capture asserts the card_actions count is
// unchanged (fixture conflict_probe.no_write_proof). Rendering the conflict
// VIEW over HTTP would require a real stale POST with changed content -
// a write risk the capture contract forbids (capture only, no DB writes);
// the edit-form surface the conflict re-render rides on is pinned here.
//
// Byte contracts proven here:
// - signed-in (viewer with the update task allowed - the admin stand-in):
//   :edit renders the full modal (title, edit modal menu, help slot, form);
//   :edit_form renders the bare form slot; both match the bot AND sara
//   oracle bytes (bot = sara modulo the dynamic masks).
// - anonymous: :edit renders the quiet denial span
//   `<span class="denied"><!-- Sorry, you don't have permission (update) --></span>`
//   byte-for-byte (perms :update; the verdict comes from the REAL task
//   algebra - the seeded *all+*update rule grants [[Editor]] only, and the
//   anonymous viewer's parties lack it); :edit_form renders the FULL FORM
//   (the view carries no perms directive - read passes - matching the
//   captured anonymous edit_form bytes).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { UnsupportedViewError } from "../../../src/card/render/format.js";
import { RenderEngine } from "../../../src/card/render.js";
import { FetchEngine } from "../../../src/card/fetch.js";
import {
  ModLoader,
  modEngineHost,
} from "../../../src/card/mod-loader.js";
import cardModEdit from "../../../src/card/mod-loader/mods/card-mod-edit.js";
import cardModHelp from "../../../src/card/mod-loader/mods/card-mod-help.js";

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../fixtures/captured/edit-forms.json", import.meta.url)),
    "utf8",
  ),
) as {
  targets: Record<
    string,
    {
      id: number;
      name: string;
      type: string;
      views: Record<string, { edit: string; edit_form: string }>;
    }
  >;
};

/** The capture's normalizations (see the module doc): slot ids and card ids
 *  are random/seed-state by design; the conflict tracker's value is the
 *  captured card's action id (693/604). */
function normalize(html: string): string {
  return html
    .replace(/data-slot-id=(["'])[0-9a-fA-F]+\1/g, 'data-slot-id="RANDOMIZED"')
    .replace(/data-card-id=(["'])\d+\1/g, 'data-card-id="RANDOMIZED"')
    .replace(
      /(<input class="current_revision_id form-control" autocomplete="off" type="hidden" value=")[^"]*(")/,
      "$1ACTION_ID$2",
    );
}

/** The captured Home content (the oracle textarea bytes, unescaped): two
 *  nest-bearing div lines, each newline-terminated. */
const HOME_CONTENT =
  '<div>{{:getting_started|core}}</div>\n<div>{{## Feel free to get rid of this and start fresh! }}</div>\n';

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;
/** The anonymous-side engine: a SECOND RenderEngine over the same storage,
 *  holding its default ANONYMOUS viewer (the storage's main engine is
 *  switched to the signed-in admin stand-in viewer). */
let anonymousEngine: RenderEngine | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  // codename/type cards (the codename registry + set keys read these)
  await seedCard(s, { id: 2, name: "RichText" }); // the cardtypes' type card
  await seedCard(s, { id: 7, name: "Editor" });
  await seedCard(s, { id: 8, name: "*type", codename: "type", typeId: 14 });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 12, name: "*update", codename: "update", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });
  // the update rule the task verdicts read: *all+*update -> [[Editor]]
  // (anonymous lacks the party; the signed-in stand-in viewer IS the party)
  await seedCard(s, { id: 30, leftId: 10, rightId: 12, dbContent: "[[Editor]]" });
  await seedReference(s, 30, 7, "editor");
  // Home's content nests {{:getting_started|core}} - the codename card the
  // prefetch closure resolves (its rendered bytes never appear: the edit
  // form shows raw content, un-nested).
  await seedCard(s, { id: 40, name: "Getting started", codename: "getting_started" });

  // the capture's cards - ids EXACTLY as captured (the bytes carry
  // data-card-id); currentRevisionId = the action id the raw captures
  // show in the conflict tracker (693 / 604; normalized to ACTION_ID).
  await seedCard(s, {
    id: 605,
    name: "Oracle Basics",
    typeId: 2,
    typeName: "RichText",
    dbContent: "A plain basic card for oracle capture.",
    currentRevisionId: 693,
  });
  await seedCard(s, {
    id: 521,
    name: "Home",
    typeId: 2,
    typeName: "RichText",
    dbContent: HOME_CONTENT,
    currentRevisionId: 604,
  });

  // The name-environment bridge (DeckoName's sync ":codename" marks read the
  // global env's registry - Home's content nests {{:getting_started|core}},
  // which the prefetch closure parses). Install THIS storage's registry and
  // prime the codehash memo so the sync peeks resolve deterministically.
  s.fetcher.installNameEnvironment();
  await s.fetcher.codenames.ensureLoaded();
}, 60_000);

afterAll(() => {
  loader?.reset(); // unregister the mod views from the live record
  storage?.close();
});

describe("card-mod-edit CORE EDIT-FORM PATH (write-path slice 3)", () => {
  it("WITHOUT the mod: :edit / :edit_form are unsupported views", async () => {
    const s = storage!;
    s.engine.viewer = { signedIn: true, actorId: 7 }; // the Editor party
    await expect(s.engine.render("Oracle Basics", "edit")).rejects.toThrow(
      UnsupportedViewError,
    );
    await expect(s.engine.render("Oracle Basics", "edit_form")).rejects.toThrow(
      UnsupportedViewError,
    );
  });

  it("WITH the mod: signed-in :edit_form matches the oracle bytes (both cards)", async () => {
    const s = storage!;
    loader = new ModLoader([{ manifest: cardModEdit }, { manifest: cardModHelp }]);
    loader.load();
    await loader.installInto(modEngineHost(s.engine, s.fetcher));

    const basics = normalize(await s.engine.render("Oracle Basics", "edit_form"));
    expect(basics).toBe(FIXTURE.targets.basic_note.views.bot.edit_form);
    expect(basics).toBe(FIXTURE.targets.basic_note.views.sara.edit_form);
    const home = normalize(await s.engine.render("Home", "edit_form"));
    expect(home).toBe(FIXTURE.targets.deck_level.views.bot.edit_form);
    expect(home).toBe(FIXTURE.targets.deck_level.views.sara.edit_form);
  });

  it("WITH the mod: signed-in :edit matches the oracle modal bytes (both cards)", async () => {
    const s = storage!;
    const basics = normalize(await s.engine.render("Oracle Basics", "edit"));
    expect(basics).toBe(FIXTURE.targets.basic_note.views.bot.edit);
    expect(basics).toBe(FIXTURE.targets.basic_note.views.sara.edit);
    const home = normalize(await s.engine.render("Home", "edit"));
    expect(home).toBe(FIXTURE.targets.deck_level.views.bot.edit);
    expect(home).toBe(FIXTURE.targets.deck_level.views.sara.edit);
  });

  it("anonymous :edit is the quiet denial span, byte-for-byte (real task verdicts)", async () => {
    const s = storage!;
    anonymousEngine = new RenderEngine(new FetchEngine(s.counting));
    await loader!.installInto(modEngineHost(anonymousEngine, s.fetcher));
    // No normalization: the denial span carries no dynamic bytes.
    const html = await anonymousEngine.render("Oracle Basics", "edit");
    expect(html).toBe(FIXTURE.targets.basic_note.views.anonymous.edit);
    expect(html).toBe(FIXTURE.targets.deck_level.views.anonymous.edit);
  });

  it("anonymous :edit_form renders the full form (read passes; no update check)", async () => {
    const s = storage!;
    const basics = normalize(await anonymousEngine!.render("Oracle Basics", "edit_form"));
    expect(basics).toBe(FIXTURE.targets.basic_note.views.anonymous.edit_form);
    const home = normalize(await anonymousEngine!.render("Home", "edit_form"));
    expect(home).toBe(FIXTURE.targets.deck_level.views.anonymous.edit_form);
  });

  it("the pinned conflict probe: validation-level capture with no-write proof", () => {
    // The oracle's conflict state: a stale last_action_id_before_edit +
    // update! adds the :conflict error and aborts (no act persisted); the
    // capture asserted the card_actions count before == after. The TS-side
    // surface this pins is the conflict tracker hidden field (rendered in
    // every :edit_form above, value normalized to ACTION_ID); the HTTP
    // conflict re-render is the save lane's surface (a stale POST with
    // changed content would write - outside this lane's capture contract).
    expect(FIXTURE.targets).toBeDefined();
    const fixture = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../../fixtures/captured/edit-forms.json", import.meta.url)),
        "utf8",
      ),
    ) as { conflict_probe: { no_write_proof: boolean; errors_conflict: string[]; stale_action_id_known: boolean } };
    expect(fixture.conflict_probe.no_write_proof).toBe(true);
    expect(fixture.conflict_probe.stale_action_id_known).toBe(true);
    expect(fixture.conflict_probe.errors_conflict).toEqual([
      "changes not based on latest revision",
    ]);
  });
});
