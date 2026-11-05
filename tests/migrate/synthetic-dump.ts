// synthetic-dump.ts — builders for SYNTHETIC mysqldump fixtures used by the
// migration tests.
//
// DATA RULE: every value here is invented test data ("Migra ...", "Alpha
// One", ...) — zero production strings. These builders never read the real
// dump; tests that need dump FILES write them to tmpdirs with these
// builders.
//
// The builder escapes values the way mysqldump does (backslash escapes),
// so tests can put quotes, backslashes, newlines, tabs, NUL and \Z into
// synthetic content and round-trip them through the parser/importer.

import { DeckoName } from "../../src/card/name.js";

export const BS = String.fromCharCode(92);

/** MySQL escape letter for a control character. */
const CONTROL_ESCAPES: Record<string, string> = {
  "\n": "n",
  "\r": "r",
  "\t": "t",
  "\0": "0",
  "\x1a": "Z",
  "\b": "b",
};

/** Escape a JS string into a mysqldump single-quoted literal body.
 *  One pass for control characters (a naive /\\b/ here would be a
 *  zero-width word-boundary regex and corrupt every value — learned the
 *  hard way; keep the single-callback form). */
export function sqlEscape(s: string): string {
  return s
    .replace(new RegExp(BS + BS, "g"), BS + BS)
    .replace(/'/g, BS + "'")
    .replace(/"/g, BS + '"')
    .replace(/[\n\r\t\0\x1a\b]/g, (ch) => BS + (CONTROL_ESCAPES[ch] ?? ch));
}

/** Quote a value the way mysqldump would. */
export function sqlValue(v: string | number | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${sqlEscape(v)}'`;
}

/** A tuple string from positional values. */
export function sqlTuple(...values: (string | number | null)[]): string {
  return `(${values.map((v) => sqlValue(v)).join(",")})`;
}

export interface SyntheticCard {
  id: number;
  name: string | null;
  /** undefined = default (key derived from name for simple cards, NULL
   *  columns for junction rows); null = explicitly anomalous (models the
   *  missing-key row the importer's repair step targets). */
  key?: string | null;
  codename?: string | null;
  leftId?: number | null;
  rightId?: number | null;
  currentRevisionId?: number | null;
  createdAt?: string;
  updatedAt?: string;
  creatorId?: number;
  updaterId?: number;
  readRuleClass?: string | null;
  readRuleId?: number | null;
  referencesExpired?: number | null;
  trash?: 0 | 1;
  typeId?: number;
  dbContent?: string | null;
}

const T0 = "2020-01-02 03:04:05";

/** One cards tuple, positional (the dump's column order = target DDL).
 *  Column conventions follow the Ruby write path (see
 *  tests/card/fetch/fetch-test-storage.ts): simple cards carry name+key;
 *  junction rows (leftId set) default to NULL name/key columns (the 2020
 *  convention); an explicit `key: null` on a simple card models the
 *  anomalous row the importer's repair step targets. */
export function cardsTuple(c: SyntheticCard): string {
  let keyCol = c.key ?? null;
  let nameCol = c.name ?? null;
  if (c.key === undefined) {
    if (c.leftId !== undefined && c.leftId !== null) {
      keyCol = null;
      if (c.name === undefined) nameCol = null;
    } else if (c.name !== null && c.name !== undefined) {
      keyCol = DeckoName.parse(c.name).key;
    }
  }
  return sqlTuple(
    c.id,
    nameCol,
    keyCol,
    c.codename ?? null,
    c.leftId ?? null,
    c.rightId ?? null,
    c.currentRevisionId ?? null,
    c.createdAt ?? T0,
    c.updatedAt ?? T0,
    c.creatorId ?? 1,
    c.updaterId ?? 1,
    c.readRuleClass ?? null,
    c.readRuleId ?? null,
    c.referencesExpired ?? null,
    c.trash ?? 0,
    c.typeId ?? 2,
    c.dbContent ?? null,
  );
}

/** INSERT INTO `cards` VALUES ...; from card specs. */
export function cardsInsert(cards: SyntheticCard[]): string {
  return `INSERT INTO \`cards\` VALUES ${cards.map((c) => cardsTuple(c)).join(",")};`;
}

export interface SyntheticActRow {
  id: number;
  cardId?: number | null;
  actorId?: number | null;
  actedAt?: string | null;
  ip?: string | null;
}

export function actsInsert(acts: SyntheticActRow[]): string {
  return `INSERT INTO \`card_acts\` VALUES ${acts
    .map((a) => sqlTuple(a.id, a.cardId ?? null, a.actorId ?? 1, a.actedAt ?? T0, a.ip ?? "127.0.0.1"))
    .join(",")};`;
}

export function actionsInsert(
  rows: (string | number | null)[][],
): string {
  return `INSERT INTO \`card_actions\` VALUES ${rows.map((r) => sqlTuple(...r)).join(",")};`;
}

export function changesInsert(rows: (string | number | null)[][]): string {
  return `INSERT INTO \`card_changes\` VALUES ${rows.map((r) => sqlTuple(...r)).join(",")};`;
}

export function referencesInsert(rows: (string | number | null)[][]): string {
  return `INSERT INTO \`card_references\` VALUES ${rows.map((r) => sqlTuple(...r)).join(",")};`;
}

/** Wrap arbitrary SQL lines in a minimal mysqldump-shaped file. */
export function dumpFile(lines: string[]): string {
  return [
    "-- MySQL dump 10.13 (synthetic fixture — no real content)",
    "/*!40101 SET NAMES utf8mb4 */;",
    "/*!40103 SET TIME_ZONE='+00:00' */;",
    ...lines,
    "-- Dump completed (synthetic)",
    "",
  ].join("\n");
}
