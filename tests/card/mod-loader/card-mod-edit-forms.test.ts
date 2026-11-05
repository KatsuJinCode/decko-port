

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

function normalize(html: string): string {
  return html
    .replace(/data-slot-id=(["'])[0-9a-fA-F]+\1/g, 'data-slot-id="RANDOMIZED"')
    .replace(/data-card-id=(["'])\d+\1/g, 'data-card-id="RANDOMIZED"')
    .replace(
      /(<input class="current_revision_id form-control" autocomplete="off" type="hidden" value=")[^"]*(")/,
      "$1ACTION_ID$2",
    );
}

const HOME_CONTENT =
  '<div>{{:getting_started|core}}</div>\n<div>{{## Feel free to get rid of this and start fresh! }}</div>\n';

let storage: RenderTestStorage | undefined;
let loader: ModLoader | undefined;

let anonymousEngine: RenderEngine | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 7, name: "Editor" });
  await seedCard(s, { id: 8, name: "*type", codename: "type", typeId: 14 });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 12, name: "*update", codename: "update", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

  await seedCard(s, { id: 30, leftId: 10, rightId: 12, dbContent: "[[Editor]]" });
  await seedReference(s, 30, 7, "editor");

  await seedCard(s, { id: 40, name: "Getting started", codename: "getting_started" });

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

  s.fetcher.installNameEnvironment();
  await s.fetcher.codenames.ensureLoaded();
}, 60_000);

afterAll(() => {
  loader?.reset();
  storage?.close();
});

describe("card-mod-edit CORE EDIT-FORM PATH (write-path slice 3)", () => {
  it("WITHOUT the mod: :edit / :edit_form are unsupported views", async () => {
    const s = storage!;
    s.engine.viewer = { signedIn: true, actorId: 7 };
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
