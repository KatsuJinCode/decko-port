import type { SQLDatabaseDriver } from "../../server/driver.js";
import type { FetchEngine } from "../fetch.js";
import type { CardRecord } from "../fetch/card-record.js";
import { DeckoName } from "../name.js";
import { refreshReferencesOut, type ReferenceLexicon } from "./refresh-references-out.js";

export interface ReferenceReadRow {
  referer_id: number | null;
  referee_id: number | null;
  referee_key: string | null;
  ref_type: string | null;
}

export async function referer(
  fetch: FetchEngine,
  row: ReferenceReadRow,
): Promise<CardRecord | undefined> {
  if (row.referer_id === null || row.referer_id === undefined) return undefined;
  return await fetch.fetchById(row.referer_id);
}

export async function refererCardsFromReferences(
  fetch: FetchEngine,
  references: readonly ReferenceReadRow[],
): Promise<CardRecord[]> {
  const seen = new Set<number>();
  const cards: CardRecord[] = [];
  for (const row of references) {
    if (row.referer_id === null || row.referer_id === undefined || seen.has(row.referer_id)) continue;
    seen.add(row.referer_id);
    const card = await fetch.fetchById(row.referer_id);
    if (card !== undefined) cards.push(card);
  }
  return cards;
}

export async function refereesFromReferences(
  fetch: FetchEngine,
  references: readonly ReferenceReadRow[],
): Promise<CardRecord[]> {
  const seen = new Set<string>();
  const cards: CardRecord[] = [];
  for (const row of references) {
    const key = row.referee_key;
    if (key === null || key === undefined || seen.has(key)) continue;
    seen.add(key);
    const card = await fetch.fetchWithOptions([key], { new: {} });
    if (card !== undefined) cards.push(card);
  }
  return cards;
}

export async function nestees(
  fetch: FetchEngine,
  references: readonly ReferenceReadRow[],
): Promise<CardRecord[]> {
  return await refereesFromReferences(
    fetch,
    references.filter((row) => row.ref_type === "I"),
  );
}

export async function nameReferers(
  driver: SQLDatabaseDriver,
  fetch: FetchEngine,
  key: string,
): Promise<CardRecord[]> {
  const result = await driver.query<{ id: number }>(
    `SELECT DISTINCT cards.id AS id FROM cards
       JOIN card_references ON card_references.referer_id = cards.id
      WHERE card_references.referee_key = ? AND cards.trash = 0`,
    [key],
  );
  const cards: CardRecord[] = [];
  for (const row of result.rows) {
    const card = await fetch.fetchById(row.id);
    if (card !== undefined) cards.push(card);
  }
  return cards;
}

export async function eachCard(
  driver: SQLDatabaseDriver,
  fetch: FetchEngine,
  visit: (card: CardRecord) => void | Promise<void>,
): Promise<void> {
  let afterId = 0;
  for (;;) {
    const result = await driver.query<{ id: number }>(
      "SELECT id FROM cards WHERE trash = 0 AND id > ? ORDER BY id LIMIT 1000",
      [afterId],
    );
    if (result.rows.length === 0) return;
    for (const row of result.rows) {
      afterId = row.id;
      const card = await fetch.fetchById(row.id);
      if (card !== undefined) await visit(card);
    }
    if (result.rows.length < 1000) return;
  }
}

export async function recreateAll(
  driver: SQLDatabaseDriver,
  lexicon: ReferenceLexicon,
): Promise<void> {
  await driver.query("DELETE FROM card_references", []);
  let afterId = 0;
  for (;;) {
    const result = await driver.query<{
      id: number;
      name: string | null;
      db_content: string | null;
    }>(
      "SELECT id, name, db_content FROM cards WHERE trash = 0 AND id > ? ORDER BY id LIMIT 1000",
      [afterId],
    );
    if (result.rows.length === 0) return;
    for (const row of result.rows) {
      afterId = row.id;
      if (row.name === null || row.name === undefined) continue;
      await refreshReferencesOut(
        driver,
        lexicon,
        row.id,
        DeckoName.parse(row.name),
        row.db_content,
      );
    }
    if (result.rows.length < 1000) return;
  }
}
