import type { SQLDatabaseDriver } from "../server/driver.js";
import { DeckoName } from "./name.js";
import { referenceRowsOut, type ReferenceLexicon } from "./actions/refresh-references-out.js";

export const NEST_INDEX_BUILD_VERSION = 2;

export const NEST_INDEX_META_TABLE = "nest_index_meta";

export const NEST_INDEX_META_DDL =
  `CREATE TABLE IF NOT EXISTS ${NEST_INDEX_META_TABLE} (` +
  `meta_key VARCHAR(64) NOT NULL PRIMARY KEY, ` +
  `meta_value VARCHAR(255) NOT NULL)`;

import {NEST_EDGE_CACHE_TABLE,NEST_EDGE_CACHE_DDL,hasNestEdgeCache,noteNestEdgeCacheInstalled,nestIndexTableExists as tableExists} from "./nest-index-cache.js";
const BUILD_VERSION_KEY = "build_version";

export interface NestIndexLexicon extends ReferenceLexicon {
  name(id: number | undefined): Promise<DeckoName | undefined>;
}

export interface NestIndexInstall {
  readonly state: "current" | "built";
  readonly dropped: number;
  readonly scanned: number;
}

export interface NestIndexMarker {
  readonly state: "current" | "stale" | "missing";
  readonly version?: number;
}

const SCAN_BATCH = 2000;

async function readBuildVersion(driver: SQLDatabaseDriver): Promise<number | undefined> {
  const row = await driver.query<{ meta_value: string }>(
    `SELECT meta_value FROM ${NEST_INDEX_META_TABLE} WHERE meta_key = ?`,
    [BUILD_VERSION_KEY],
  );
  const value = row.rows[0]?.meta_value;
  return value === undefined ? undefined : Number(value);
}

export async function readNestIndexMarker(driver: SQLDatabaseDriver): Promise<NestIndexMarker> {
  if (!(await tableExists(driver, NEST_INDEX_META_TABLE))) return { state: "missing" };
  const version = await readBuildVersion(driver);
  if (version === undefined) return { state: "missing" };
  if (version === NEST_INDEX_BUILD_VERSION && !(await hasNestEdgeCache(driver))) return { state: "missing", version };
  return version === NEST_INDEX_BUILD_VERSION ? { state: "current", version } : { state: "stale", version };
}

export async function ensureNestIndex(
  driver: SQLDatabaseDriver,
  lexicon: NestIndexLexicon,
): Promise<NestIndexInstall> {
  await driver.query(NEST_INDEX_META_DDL, []);
  const hadCache = await hasNestEdgeCache(driver);
  if ((await readBuildVersion(driver)) === NEST_INDEX_BUILD_VERSION && hadCache) {
    return { state: "current", dropped: 0, scanned: 0 };
  }
  await driver.query(NEST_EDGE_CACHE_DDL, []);
  noteNestEdgeCacheInstalled(driver);
  const before = await driver.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${NEST_EDGE_CACHE_TABLE}`, []);
  const dropped = Number(before.rows[0]?.n ?? 0);
  await driver.query(`DELETE FROM ${NEST_EDGE_CACHE_TABLE}`, []);
  const cards = await driver.query<{ id: number; db_content: string | null }>(
    `SELECT id, db_content FROM cards WHERE trash = 0 AND db_content LIKE '%{{%' ORDER BY id`, []);
  const rows = cards.rows ?? [];
  for (let start = 0; start < rows.length; start += SCAN_BATCH) {
    for (const row of rows.slice(start, start + SCAN_BATCH)) {
      const id = Number(row.id), name = await lexicon.name(id);
      if (name === undefined) continue;
      const included = (await referenceRowsOut(driver, lexicon, id, name, row.db_content))
        .filter(ref => ref.refType === "I");
      for (const ref of included) {
        if (ref.refereeKey === null) throw new Error("nest cache inclusion has no key");
        await driver.query(`INSERT INTO ${NEST_EDGE_CACHE_TABLE} (referer_id, referee_key, referee_id) VALUES (?, ?, ?)`,
          [ref.refererId, ref.refereeKey, ref.refereeId]);
      }
    }
  }
  await writeBuildVersion(driver, NEST_INDEX_BUILD_VERSION);
  return { state: "built", dropped, scanned: rows.length };
}

async function writeBuildVersion(driver: SQLDatabaseDriver, version: number): Promise<void> {
  await driver.query(`DELETE FROM ${NEST_INDEX_META_TABLE} WHERE meta_key = ?`, [BUILD_VERSION_KEY]);
  await driver.query(`INSERT INTO ${NEST_INDEX_META_TABLE} (meta_key, meta_value) VALUES (?, ?)`, [
    BUILD_VERSION_KEY,
    String(version),
  ]);
}
