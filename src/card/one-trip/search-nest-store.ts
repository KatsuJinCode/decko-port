import type { SQLDatabaseDriver } from "../../server/driver.js";
import { executeQuery } from "../../cql/execute.js";
import { DeckoName } from "../name.js";

export type SearchNestPosture = "write-time" | "live";

export const DEFAULT_SEARCH_NEST_POSTURE: SearchNestPosture = "write-time";

export async function executeSearchNestNow(
  corpus: SQLDatabaseDriver,
  side: SQLDatabaseDriver,
  searchCardId: number,
): Promise<number[]> {
  const cardRows = await corpus.query<{ db_content: string | null; name: string | null }>(
    "SELECT db_content, name FROM cards WHERE id = ? AND trash = 0",
    [searchCardId],
  );
  const row = cardRows.rows[0];
  if (row === undefined || row.db_content === null || row.db_content === "") return [];

  let statement: unknown;
  try {
    statement = JSON.parse(row.db_content);
  } catch {
    return [];
  }
  if (statement === null || typeof statement !== "object" || Array.isArray(statement)) return [];

  const contextName = row.name ?? "";
  let statementClamped = statement as Record<string, unknown>;
  {
    const declared = (statementClamped as Record<string, unknown>)["limit"];
    const cqlLimit =
      typeof declared === "number" && Number.isFinite(declared) ? declared : undefined;
    const limit = cqlLimit ?? 20;
    statementClamped = { ...statementClamped, limit };
  }

  const keyToId = new Map<string, number>();
  const idToKey = new Map<number, string>();
  {
    const all = await corpus.query<{ id: number; name: string | null; "key": string | null }>(
      'SELECT id, name, "key" FROM cards WHERE trash = 0 AND name IS NOT NULL',
      [],
    );
    for (const r of all.rows) {
      if (r.key !== null) keyToId.set(r.key, r.id);
      if (r.id !== undefined) {
        try {
          idToKey.set(r.id, r.name ? DeckoName.parse(r.name).key : (r.key ?? ""));
        } catch {
        }
      }
    }
  }
  void idToKey;

  const result = await executeQuery(corpus, statementClamped, {
    parse: {
      context: contextName,
      ensureCardId: async (nameish: string) => {
        try {
          return keyToId.get(DeckoName.parse(nameish).key);
        } catch {
          return undefined;
        }
      },
      resolveCardId: (nameish: string) => {
        try {
          return keyToId.get(DeckoName.parse(nameish).key);
        } catch {
          return undefined;
        }
      },
    },
  }).catch(() => undefined);

  const rows = result && "rows" in result ? result.rows : [];
  const ids = rows.map((r) => r.id);
  await side.query("DELETE FROM one_trip_search_results WHERE search_card_id = ?", [searchCardId]);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const placeholders = chunk.map(() => "(?, ?, ?)").join(", ");
    await side.query(
      `INSERT INTO one_trip_search_results (search_card_id, position, card_id) VALUES ${placeholders}`,
      chunk.flatMap((cardId, offset) => [searchCardId, i + offset, cardId]),
    );
  }
  return ids;
}
