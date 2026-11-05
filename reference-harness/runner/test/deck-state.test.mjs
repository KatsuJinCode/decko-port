import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { delta, rawDelta, snapshot, splitDelta } from "../deck-state.mjs";
import { scratch } from "./helpers.mjs";

let tmp;
let file;
before(() => {
  tmp = scratch();
  file = path.join(tmp.dir, "deck.sqlite3");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE cards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, left_id INTEGER, right_id INTEGER, updated_at TEXT)");
  db.exec("CREATE TABLE settings (k TEXT, v TEXT)");
  db.exec("INSERT INTO cards (name, updated_at) VALUES ('Alpha', '2026-09-19 12:00:00'), ('Beta', '2026-09-19 12:00:00')");
  db.close();
});
after(() => tmp.cleanup());

const write = (sql) => {
  const db = new DatabaseSync(file);
  db.exec(sql);
  db.close();
};

describe("rawDelta", () => {
  it("records new rows with their stored ids and every table that changed", () => {
    const b = snapshot(file);
    write("INSERT INTO cards (name, left_id, right_id, updated_at) VALUES ('Alpha+Beta', 1, 2, '2026-09-19 12:00:00'); INSERT INTO settings VALUES ('a', 'b')");
    const d = rawDelta(b, snapshot(file));
    assert.equal(d.cards.inserted[0].id, 3);
    assert.equal(d.cards.inserted[0].name, "Alpha+Beta");
    assert.deepEqual(d.settings.inserted, [{ k: "a", v: "b" }]);
    assert.ok(d.sqlite_sequence, "the autoincrement counter moved");
    const { rows, other } = splitDelta(d);
    assert.deepEqual(Object.keys(rows), ["cards"]);
    assert.deepEqual(Object.keys(other).sort(), ["settings", "sqlite_sequence"]);
  });

  it("a timestamp rewritten to the same instant in another text form is a change", () => {
    const b = snapshot(file);
    write("UPDATE cards SET updated_at = '2026-09-19 12:00:00.000' WHERE id = 1");
    const d = rawDelta(b, snapshot(file));
    assert.deepEqual(d.cards.updated, [{ id: 1, changes: { updated_at: ["2026-09-19 12:00:00", "2026-09-19 12:00:00.000"] } }]);
  });

  it("no change, no entry", () => {
    const s = snapshot(file);
    assert.deepEqual(rawDelta(s, snapshot(file)), {});
  });
});

describe("delta (symbolic)", () => {
  it("names new cards, rewrites references to them, and compares timestamps as instants", () => {
    const b = snapshot(file);
    write("INSERT INTO cards (name, updated_at) VALUES ('Gamma', '2026-09-19T12:00:00.000Z'); UPDATE cards SET updated_at = '2026-09-19 12:00:00.000' WHERE id = 2");
    const s = snapshot(file);
    const gamma = [...s.cards.values()].find((r) => r.name === "Gamma").id;
    write(`INSERT INTO cards (name, left_id, right_id, updated_at) VALUES ('x', ${gamma}, 1, '2026-09-19 12:00:00')`);
    const d = delta(b, snapshot(file));
    assert.deepEqual(d.cards.inserted.map((r) => r.id), ["new card Gamma", "new card Gamma+Alpha"]);
    assert.equal(d.cards.inserted[1].left_id, "new card Gamma");
    assert.equal(d.cards.inserted[0].updated_at, "2026-09-19T12:00:00.000Z");
    assert.equal(d.cards.updated.length, 0, "same instant, another text form: not a change here");
  });
});
