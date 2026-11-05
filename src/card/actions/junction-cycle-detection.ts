import type { SQLDatabaseDriver } from "../../server/driver.js";
import type { CardsRow } from "../../server/schema.js";
import { CardActionError } from "./types.js";

export async function assertNotOwnAncestor(
  driver: SQLDatabaseDriver,
  cardId: number,
  sideIds: readonly (number | null | undefined)[],
): Promise<void> {
  const visited = new Set<number>();
  let frontier = sideIds.filter(
    (id): id is number => typeof id === "number" && Number.isInteger(id),
  );
  while (frontier.length > 0) {
    if (frontier.includes(cardId)) {
      throw new CardActionError(
        "cycle",
        `save rejected: card ${cardId} would become its own ancestor`,
      );
    }
    const next: number[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      const result = await driver.query<Pick<CardsRow, "left_id" | "right_id" | "trash">>(
        "SELECT left_id, right_id, trash FROM cards WHERE id = ? LIMIT 1",
        [id],
      );
      const row = result.rows[0];
      if (row === undefined || row.trash === 1) continue;
      if (row.left_id !== null) next.push(row.left_id);
      if (row.right_id !== null) next.push(row.right_id);
    }
    frontier = next;
  }
}
