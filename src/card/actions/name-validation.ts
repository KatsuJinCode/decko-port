import { DeckoName } from "../name.js";
import type { SQLDatabaseDriver } from "../../server/driver.js";
import type { CardsRow } from "../../server/schema.js";
import type { FetchEngine } from "../fetch.js";
import { DbLexicon, lexQuery, type Lex } from "../fetch/lexicon.js";
import { CardCache } from "../fetch/cache.js";
import {
  LIVE_CARD_ID_BY_KEY_FOLDED_SQL,
  TRASHED_CARD_BY_JUNCTION_SQL,
  TRASHED_CARD_BY_KEY_SQL,
} from "../fetch/card-read-shapes.js";
import { CardActionError } from "./types.js";

export const MAX_NAME_LENGTH = 255;

export function rubyStringLength(str: string): number {
  let count = 0;
  for (const _ of str) count += 1;
  return count;
}

export type NameLegalityArm = "too-long" | "blank" | "incomplete" | "banned-characters";

export function nameLegalityError(
  arm: NameLegalityArm,
  rubyMessage: string | undefined,
  name: DeckoName,
): CardActionError {
  switch (arm) {
    case "too-long":
      return new CardActionError(
        "name-illegal",
        `name is too long (${rubyStringLength(name.s)} characters)`,
        `NAME: ${rubyMessage ?? ""}`,
      );
    case "blank":
      return new CardActionError("name-illegal", "name cannot be blank", `NAME: ${rubyMessage ?? ""}`);
    case "incomplete":
      return new CardActionError("name-illegal", "name is incomplete", `NAME: ${rubyMessage ?? ""}`);
    case "banned-characters":
      return new CardActionError("name-illegal", `name contains illegal characters: ${name.s}`);
  }
}

export function validateNameLegality(name: DeckoName): void {
  const length = rubyStringLength(name.s);
  if (length > MAX_NAME_LENGTH) {
    throw nameLegalityError(
      "too-long",
      `is too long (255 character maximum; length is ${length})`,
      name,
    );
  }
  if (name.s === "") {
    throw nameLegalityError("blank", "can't be blank", name);
  }
  if (name.parts.includes("")) {
    throw nameLegalityError("incomplete", "is incomplete", name);
  }
  if (!name.isValid) {
    throw nameLegalityError("banned-characters", undefined, name);
  }
}

export function validateComputedKey(name: DeckoName): void {
  if (name.key !== "") return;
  throw new CardActionError(
    "validation-failed",
    "Validation failed: Key cannot be blank",
    "KEY: cannot be blank",
    { key: "cannot be blank" },
    name.s,
  );
}

export function currentNameLexicon(fetcher: FetchEngine): DbLexicon {
  const lexicon = new DbLexicon(fetcher.driver, new CardCache());
  lexicon.storedKeyFallback = fetcher.lexicon.storedKeyFallback;
  return lexicon;
}

export async function assertNameAvailable(
  fetcher: FetchEngine,
  name: DeckoName,
  selfId: number | undefined,
): Promise<void> {
  const lexicon = currentNameLexicon(fetcher);
  const existingId = name.isCompound
    ? await lexicon.id(name)
    : (await fetcher.driver.query<{ id: number }>(LIVE_CARD_ID_BY_KEY_FOLDED_SQL, [name.key])).rows[0]?.id;
  if (existingId === undefined || existingId === selfId) return;
  const result = await fetcher.driver.query<Pick<CardsRow, "id" | "name">>(
    "SELECT id, name FROM cards WHERE id = ? AND trash = 0 LIMIT 1",
    [existingId],
  );
  if (result.rows[0] !== undefined) {
    const existingName = result.rows[0].name ?? (await lexicon.name(existingId))?.s ?? name.s;
    throw new CardActionError(
      "name-conflict",
      `name is already taken: ${existingName}`,
      `NAME: must be unique; '${existingName}' already exists.`,
      undefined,
      name.s,
    );
  }
}

export async function findTrashedCardByLex(
  driver: SQLDatabaseDriver,
  lex: Lex,
): Promise<CardsRow | undefined> {
  const { sql, params } = lexQuery(lex);
  const statement =
    Array.isArray(lex) && lex[0] !== undefined && lex[1] !== undefined
      ? TRASHED_CARD_BY_JUNCTION_SQL
      : Array.isArray(lex)
        ? `SELECT * FROM cards WHERE ${sql} AND trash = 1 LIMIT 1`
        : TRASHED_CARD_BY_KEY_SQL;
  const result = await driver.query<CardsRow>(statement, params);
  return result.rows[0];
}

export async function findTrashedKeyObstacle(
  driver: SQLDatabaseDriver,
  key: string,
): Promise<CardsRow | undefined> {
  const result = await driver.query<CardsRow>(TRASHED_CARD_BY_KEY_SQL, [key]);
  return result.rows[0];
}
