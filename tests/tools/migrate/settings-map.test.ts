// settings-map.test.ts — the settings inventory module (the
// "settings tables are inventoried, never imported" rule).
//
// DATA RULE: settings VALUES are never read into the report (settings
// may carry account email templates, OAuth tokens, deck-private config).
// The test asserts: settings TABLES are inventoried, settings KEYS are
// sampled, settings VALUES never appear in the report.

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  inventorySettings,
  isSettingsTable,
} from "../../../tools/migrate/settings-map.mjs";
import { inventorySource } from "../../../tools/migrate/source-sqlite.mjs";

function makeDbWithSettings(): string {
  const dir = mkdtempSync(join(tmpdir(), "decko-settings-"));
  const path = join(dir, "src.sqlite");
  const db = new Database(path);
  db.exec(`CREATE TABLE cards (id INTEGER PRIMARY KEY, name TEXT)`);
  db.exec(`INSERT INTO cards (id, name) VALUES (1, 'alpha')`);
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`);
  db.exec(`INSERT INTO meta (key, value) VALUES ('secret_oauth_token', 'should-not-appear'), ('ui_theme', 'dark'), ('build_seed', '57024')`);
  db.exec(`CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT)`);
  db.exec(`INSERT INTO settings (name, value) VALUES ('widget_size', '42')`);
  db.close();
  return path;
}

describe("isSettingsTable", () => {
  it("returns true for meta/settings/setting/card_settings by name", () => {
    expect(isSettingsTable("meta", { key: "TEXT", value: "TEXT" })).toBe(true);
    expect(isSettingsTable("settings", { name: "TEXT", value: "TEXT" })).toBe(true);
    expect(isSettingsTable("setting", { setting: "TEXT", value: "TEXT" })).toBe(true);
    expect(isSettingsTable("card_settings", { key: "TEXT", value: "TEXT" })).toBe(true);
  });

  it("returns true for an unknown table whose column shape is (key/name, value)", () => {
    expect(isSettingsTable("widget_config", { key: "TEXT", value: "TEXT" })).toBe(true);
    expect(isSettingsTable("site_prefs", { name: "TEXT", val: "TEXT" })).toBe(true);
  });

  it("returns false for non-settings tables", () => {
    expect(isSettingsTable("cards", { id: "INTEGER", name: "TEXT" })).toBe(false);
    expect(isSettingsTable("card_references", { id: "INTEGER", referer_id: "INTEGER" })).toBe(false);
  });
});

describe("inventorySettings", () => {
  it("inventories settings tables, samples key names, never copies values", () => {
    const path = makeDbWithSettings();
    const db = new Database(path, { readonly: true });
    try {
      const inv = inventorySource(db);
      const settings = inventorySettings(db, inv);
      expect(settings.tables.length).toBe(2);
      const metaEntry = settings.tables.find((t) => t.source === "meta");
      const settingsEntry = settings.tables.find((t) => t.source === "settings");
      expect(metaEntry).toBeDefined();
      expect(metaEntry!.count).toBe(3);
      expect(metaEntry!.sampleKeys).toContain("secret_oauth_token");
      expect(metaEntry!.sampleKeys).toContain("ui_theme");
      expect(metaEntry!.sampleKeys).toContain("build_seed");
      // THE DATA RULE: no values appear in the inventory
      const json = JSON.stringify(settings);
      expect(json).not.toContain("should-not-appear");
      expect(json).not.toContain("dark");
      expect(json).not.toContain("57024");
      expect(json).not.toContain("42");
      expect(settingsEntry).toBeDefined();
      expect(settingsEntry!.sampleKeys).toContain("widget_size");
      expect(JSON.stringify(settings)).not.toContain("42");
      expect(settings.warning).toMatch(/settings tables present/);
      expect(settings.totalCount).toBe(4);
    } finally {
      db.close();
    }
  });

  it("returns an empty inventory when there are no settings tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "decko-no-settings-"));
    const path = join(dir, "src.sqlite");
    const db = new Database(path);
    db.exec(`CREATE TABLE cards (id INTEGER PRIMARY KEY, name TEXT)`);
    db.exec(`INSERT INTO cards (id, name) VALUES (1, 'only-cards')`);
    db.close();
    const src = new Database(path, { readonly: true });
    try {
      const inv = inventorySource(src);
      const settings = inventorySettings(src, inv);
      expect(settings.tables).toEqual([]);
      expect(settings.totalCount).toBe(0);
      expect(settings.warning).toBeUndefined();
    } finally {
      src.close();
    }
  });
});