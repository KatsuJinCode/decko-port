import type { SQLDatabaseDriver } from "../../server/driver.js";

export async function unmapReferees(driver: SQLDatabaseDriver, refereeId: number): Promise<void> {
  await driver.query("UPDATE card_references SET referee_id = NULL WHERE referee_id = ?", [
    refereeId,
  ]);
}

export async function mapReferees(
  driver: SQLDatabaseDriver,
  refereeKey: string,
  refereeId: number,
): Promise<void> {
  await driver.query("UPDATE card_references SET referee_id = ? WHERE referee_key = ?", [
    refereeId,
    refereeKey,
  ]);
}

export async function refreshReferencesIn(
  driver: SQLDatabaseDriver,
  cardId: number,
  cardKey: string,
  opts: { unmapExisting?: boolean } = {},
): Promise<void> {
  if (opts.unmapExisting === true) {
    await unmapReferees(driver, cardId);
  }
  await mapReferees(driver, cardKey, cardId);
}
