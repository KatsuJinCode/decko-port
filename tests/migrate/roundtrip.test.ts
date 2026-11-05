// roundtrip.test.ts — the full M4 pipeline on a SYNTHETIC deck:
// mysqldump -> import -> the decko-ts engine (fetch, render, CQL).
//
// This is the test that proves the migration produces a WORKING decko-ts
// database, not just rows: FetchEngine composes compound names through the
// junctions, RenderEngine renders views, and the CQL engine queries the
// migrated data.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LocalSqliteToolDriver,
  importDump,
} from "../../tools/migrate/import.mjs";
import { engineChecks, deriveKeyWithEngine } from "../../tools/migrate/engine-bridge.mjs";
import { DeckoName } from "../../src/card/name.js";
import { FetchEngine } from "../../src/card/fetch.js";
import { RenderEngine } from "../../src/card/render.js";
import { executeQuery } from "../../src/cql/execute.js";
import {
  dumpFile,
  cardsInsert,
  actsInsert,
  actionsInsert,
  changesInsert,
  referencesInsert,
} from "./synthetic-dump.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DDL_PATH = join(REPO_ROOT, "db", "schema.sqlite.sql");

const dirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "decko-roundtrip-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  // Close the shared driver first (Windows: the open handle would make
  // temp-dir cleanup EPERM); leftover temp dirs are non-fatal either way.
  try {
    sharedDriver?.close();
  } catch {
    // already closed
  }
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of %TEMP%
    }
  }
});

/** The imported deck's driver, shared by the round-trip tests below. */
let sharedDriver: InstanceType<typeof LocalSqliteToolDriver> | undefined;

function buildDeck(): string {
  return dumpFile([
    cardsInsert([
      { id: 1, name: "Round Trip Home", dbContent: "welcome to the round trip" },
      { id: 2, name: "Round Trip", dbContent: "parent card" },
      {
        id: 3,
        name: "Round Trip+deep_page",
        key: null,
        leftId: 2,
        rightId: 4,
        dbContent: "deep page content",
      },
      { id: 4, name: "deep_page" },
      {
        id: 5,
        name: "Round Trip Home+*self",
        key: null,
        leftId: 1,
        rightId: 6,
        dbContent: "",
      },
      { id: 6, name: "*self" },
      {
        id: 7,
        name: null, // broken junction: NULL columns (2020 convention)...
        key: null,
        leftId: 99999, // ...and an unresolvable side id
        rightId: 4,
        dbContent: "orphan content",
      },
      { id: 8, name: "Trashed Draft", trash: 1, dbContent: "trashed body" },
    ]),
    actsInsert([{ id: 20, cardId: 1, actorId: 1 }]),
    actionsInsert([[30, 1, 20, null, 0, 0, null]]),
    changesInsert([[40, 30, 2, "welcome to the round trip"]]),
    referencesInsert([[50, 3, "deep_page", 4, "I", 1]]),
  ]);
}

describe("dump -> import -> decko-ts engine", () => {
  it("imports the synthetic deck", async () => {
    const dir = makeDir();
    const dumpPath = join(dir, "deck.sql");
    writeFileSync(dumpPath, buildDeck(), "utf8");
    const driver = new LocalSqliteToolDriver(join(dir, "deck.sqlite"));
    sharedDriver = driver;
    const stats = await importDump({
      dumpPath,
      driver,
      ddlPath: DDL_PATH,
      deriveKey: deriveKeyWithEngine,
    });
    expect(stats.counts["cards"]).toBe(8);
    expect(stats.errors).toEqual([]);
  }, 60000);

  it("fetch composes simple and compound names per the fetch layer rules", async () => {
    const fetcher = new FetchEngine(sharedDriver as InstanceType<typeof LocalSqliteToolDriver>);
    // simple card: name/key straight from columns
    const home = await fetcher.fetchByName("Round Trip Home");
    expect(home?.id).toBe(1);
    expect(home?.name?.s).toBe("Round Trip Home");
    expect(home?.key).toBe(DeckoName.parse("Round Trip Home").key);
    // compound card: composed through the Lexicon junction walk
    const deep = await fetcher.fetchByName("Round Trip+deep_page");
    expect(deep?.id).toBe(3);
    expect(deep?.name?.s).toBe("Round Trip+deep_page");
    expect(deep?.leftId).toBe(2);
    expect(deep?.rightId).toBe(4);
    // trashed card: fetch returns it via lookInTrash; lexicon name(id)
    // resolves without a trash filter (by-id reads ignore trash)
    const trashed = await fetcher.fetchById(8, { lookInTrash: true });
    expect(trashed?.trash).toBe(true);
    expect(trashed?.name?.s).toBe("Trashed Draft");
    // broken junction: fetch composes name undefined (data-faithful)
    const broken = await fetcher.fetchById(7);
    expect(broken?.dbContent).toBe("orphan content");
    expect(broken?.name).toBeUndefined();
  });

  it("render engine renders migrated cards", async () => {
    const fetcher = new FetchEngine(sharedDriver as InstanceType<typeof LocalSqliteToolDriver>);
    const renderer = new RenderEngine(fetcher);
    const html = await renderer.render("Round Trip Home", "content");
    expect(html).toContain("welcome to the round trip");
    const title = await renderer.render("Round Trip Home", "title");
    expect(title).toContain("card-title");
    // compound card renders through the composed name
    const deepHtml = await renderer.render("Round Trip+deep_page", "content");
    expect(deepHtml).toContain("deep page content");
  }, 60000);

  it("CQL queries the migrated data", async () => {
    const result = await executeQuery(
      sharedDriver as InstanceType<typeof LocalSqliteToolDriver>,
      { name: "Round Trip" },
      {},
    );
    if (!("rows" in result)) throw new Error("expected card rows");
    expect(result.rows.length).toBe(1);
    const row = result.rows[0];
    expect(row?.id).toBe(2);
    expect(row?.name).toBe("Round Trip");
  }, 60000);

  it("engine bridge spot-renders and reports fixture absence honestly", async () => {
    const checks = await engineChecks({
      driver: sharedDriver as InstanceType<typeof LocalSqliteToolDriver>,
      spotCount: 5,
      seed: 7,
    });
    expect(checks.junctionEngine.sampled).toBeGreaterThan(0);
    expect(checks.junctionEngine.resolved).toBeGreaterThan(0);
    expect(checks.spotRender.sampled).toBeGreaterThan(0);
    expect(checks.spotRender.rendered).toBe(
      checks.spotRender.sampled * 2 - checks.spotRender.renderErrors,
    );
    // content view contains the card's own content
    expect(checks.spotRender.contentContainedHits).toBe(
      checks.spotRender.sampled,
    );
    // the synthetic deck does not contain the oracle fixture cards
    expect(checks.fixtures.cardsPresent).toBe(0);
    // report stays content-free: ids and hashes only
    const json = JSON.stringify(checks);
    expect(json).not.toContain("welcome to the round trip");
    expect(json).not.toContain("Round Trip Home");
  }, 60000);
});
