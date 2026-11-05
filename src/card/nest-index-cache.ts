import type {SQLDatabaseDriver} from '../server/driver.js';
import {PostgresDriver} from '../server/drivers/postgres.js';
import {driverDialect} from '../server/same-database.js';

export const NEST_EDGE_CACHE_TABLE = 'decko_nest_edges';
export const NEST_EDGE_CACHE_DDL =
  `CREATE TABLE IF NOT EXISTS ${NEST_EDGE_CACHE_TABLE} (`+
  'referer_id INTEGER NOT NULL, referee_id INTEGER, referee_key VARCHAR(255) NOT NULL, '+
  'PRIMARY KEY (referer_id, referee_key))';
const availability = new WeakMap<SQLDatabaseDriver,boolean>();

function dialectDriver(driver:SQLDatabaseDriver):SQLDatabaseDriver {
  const seen=new Set<SQLDatabaseDriver>();
  for (;;) {
    if(seen.has(driver)) throw new Error('cyclic database driver wrapper');
    seen.add(driver);
    const base=(driver as SQLDatabaseDriver & {readonly base?:SQLDatabaseDriver}).base;
    if(base===undefined) return driver;
    driver=base;
  }
}

export async function nestIndexTableExists(driver:SQLDatabaseDriver,table:string):Promise<boolean> {
  const base=dialectDriver(driver);
  const sql=base instanceof PostgresDriver
    ? "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?"
    : driverDialect(base)==='mysql'
      ? "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?"
      : "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?";
  const result=await driver.query<{n:number}>(sql,[table]);
  return Number(result.rows[0]?.n??0)>0;
}

export async function hasNestEdgeCache(driver:SQLDatabaseDriver,onProbe?:()=>void):Promise<boolean> {
  const identity=dialectDriver(driver);
  const known=availability.get(identity);
  if(known!==undefined) return known;
  onProbe?.();
  const present=await nestIndexTableExists(driver,NEST_EDGE_CACHE_TABLE);
  availability.set(identity,present);
  return present;
}

export function noteNestEdgeCacheInstalled(driver:SQLDatabaseDriver):void {
  availability.set(dialectDriver(driver),true);
}

export function nestEdgeCacheAvailable(driver:SQLDatabaseDriver):boolean {
  return availability.get(dialectDriver(driver))===true;
}

export async function clearCachedNestEdges(driver:SQLDatabaseDriver,refererId:number):Promise<void> {
  if(await hasNestEdgeCache(driver)) {
    await driver.query(`DELETE FROM ${NEST_EDGE_CACHE_TABLE} WHERE referer_id=?`,[refererId]);
  }
}
