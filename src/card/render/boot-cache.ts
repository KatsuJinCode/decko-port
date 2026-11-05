import type { SQLDatabaseDriver, SQLQueryResult } from "../../server/driver.js";

import { currentRequestContext } from "../request-context.js";

export const BOOT_VERSION_STATEMENT =
  'SELECT "version" FROM "deck_data_version" WHERE "id" = 1';

export interface BootBundle {
  readonly version: number | undefined;
  readonly driver: SQLDatabaseDriver;
  readonly codehash: SQLQueryResult;
  readonly typeNames: SQLQueryResult;
  readonly headReads: SQLQueryResult;
}

let processBundle: BootBundle | undefined;

function slot(): BootBundle | undefined {
  const ctx = currentRequestContext();
  return ctx !== undefined ? (ctx.bootBundle as BootBundle | undefined) : processBundle;
}
function setSlot(bundle: BootBundle | undefined): void {
  const ctx = currentRequestContext();
  if (ctx !== undefined) ctx.bootBundle = bundle;
  else processBundle = bundle;
}

function bundleIdentityDriver(driver: SQLDatabaseDriver): SQLDatabaseDriver {
  const wrapper = driver as { readonly base?: SQLDatabaseDriver };
  return wrapper.base ?? driver;
}

export function bootCacheIsWarm(driver: SQLDatabaseDriver): boolean {
  const currentBundle = slot();
  return currentBundle !== undefined && currentBundle.driver === bundleIdentityDriver(driver);
}

export function bootBundleForVersion(
  driver: SQLDatabaseDriver,
  version: number,
): BootBundle | undefined {
  const currentBundle = slot();
  if (currentBundle === undefined) return undefined;
  if (currentBundle.driver !== bundleIdentityDriver(driver)) return undefined;
  if (currentBundle.version === undefined) return undefined;
  return currentBundle.version === version ? currentBundle : undefined;
}

export function storeBootBundle(bundle: BootBundle): void {
  setSlot({ ...bundle, driver: bundleIdentityDriver(bundle.driver) });
}

export function bootCacheIsEmpty(): boolean {
  return slot() === undefined;
}

export function resetBootCache(): void {
  setSlot(undefined);
}

export async function readBootContentVersion(driver: SQLDatabaseDriver): Promise<number> {
  let rows: Array<{ version: unknown }>;
  try {
    const result = await driver.query<{ version: unknown }>(BOOT_VERSION_STATEMENT, []);
    rows = result.rows;
  } catch (error) {
    throw new Error(
      `deck_data_version unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const raw = rows[0]?.version;
  const version = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(version)) {
    throw new Error("deck_data_version unreadable: no version row");
  }
  return version;
}