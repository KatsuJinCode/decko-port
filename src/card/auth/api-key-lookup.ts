import { rubyStrip } from "./signin.js";
import type { SQLDatabaseDriver } from "../../server/driver.js";

export const API_KEY_AUTHENTICATION_FAILED = "API key authentication failed";

export type ApiKeySignin =
  | { readonly kind: "actor"; readonly actorId: number }
  | { readonly kind: "denied"; readonly reason: string };

export interface ApiKeyCodenameIds {
  account: number;
  apiKey: number;
}

export async function resolveApiKeyCodenameIds(
  driver: SQLDatabaseDriver,
): Promise<ApiKeyCodenameIds | undefined> {
  const read = async (codename: string): Promise<number | undefined> => {
    const result = await driver.query<{ id: number }>(
      "SELECT id FROM cards WHERE codename = ? AND trash = 0 ORDER BY id LIMIT 1",
      [codename],
    );
    return result.rows[0]?.id;
  };
  const account = await read("account");
  if (account === undefined) return undefined;
  const apiKey = await read("api_key");
  if (apiKey === undefined) return undefined;
  return { account, apiKey };
}

interface ApiKeyAccountRow {
  id: number;
  left_id: number;
  db_content: string | null;
}

export async function findAccountByApiKey(
  driver: SQLDatabaseDriver,
  ids: ApiKeyCodenameIds,
  rawKey: string,
): Promise<ApiKeyAccountRow | undefined> {
  const result = await driver.query<ApiKeyAccountRow>(
    `SELECT a.id, a.left_id, e.db_content FROM cards a
     JOIN cards e ON e.left_id = a.id AND e.right_id = ? AND e.trash = 0
     WHERE a.right_id = ? AND a.trash = 0 AND e.db_content = ?
     ORDER BY a.id LIMIT 1`,
    [ids.apiKey, ids.account, rubyStrip(rawKey)],
  );
  return result.rows[0];
}

export async function signinFromApiKey(
  driver: SQLDatabaseDriver,
  rawKey: string,
): Promise<ApiKeySignin> {
  const ids = await resolveApiKeyCodenameIds(driver);
  if (ids === undefined) return { kind: "denied", reason: API_KEY_AUTHENTICATION_FAILED };
  const account = await findAccountByApiKey(driver, ids, rawKey);
  if (account === undefined) {
    return { kind: "denied", reason: API_KEY_AUTHENTICATION_FAILED };
  }
  if ((account.db_content ?? "") !== rawKey) {
    return { kind: "denied", reason: API_KEY_AUTHENTICATION_FAILED };
  }
  return { kind: "actor", actorId: account.left_id };
}
