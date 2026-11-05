import type { SQLDatabaseDriver } from "../../server/driver.js";
import { DeckoName } from "../name.js";

export type ModEventSetMember = (
  setPath: string,
  card: { name?: string; id?: number },
) => boolean | Promise<boolean>;

export function rightSetMember(driver: SQLDatabaseDriver): ModEventSetMember {
  return (setPath, card) => {
    const match = /^right\/([^/]+)$/.exec(setPath);
    if (match === null) return false;
    const name = card.name;
    if (name === undefined || !name.includes("+")) return false;
    const tagKey = DeckoName.parse(name).tagKey;
    return (async () => {
      const tagRow = await driver
        .query<{ codename: string | null }>(
          "SELECT codename FROM cards WHERE key = ? AND trash = 0 LIMIT 1",
          [tagKey],
        )
        .catch(() => undefined);
      return tagRow?.rows[0]?.codename === match[1];
    })();
  };
}

export function typePlusRightSetMember(driver: SQLDatabaseDriver): ModEventSetMember {
  return (setPath, card) => {
    const match = /^type_plus_right\/([^/]+)\/([^/]+)$/.exec(setPath);
    if (match === null) return false;
    const name = card.name;
    if (name === undefined || !name.includes("+")) return false;
    const parsed = DeckoName.parse(name);
    const left = parsed.leftName;
    if (left === undefined) return false;
    const expectedTagKey = DeckoName.parse(`*${match[2]}`).key;
    if (parsed.tagKey !== expectedTagKey) return false;
    const leftKey = left.key;
    return (async () => {
      const leftRow = await driver
        .query<{ type_id: number | null }>(
          "SELECT type_id FROM cards WHERE key = ? AND trash = 0 LIMIT 1",
          [leftKey],
        )
        .catch(() => undefined);
      const typeId = leftRow?.rows[0]?.type_id;
      if (typeId === undefined || typeId === null) return false;
      const typeCodename = await driver
        .query<{ codename: string | null }>(
          "SELECT codename FROM cards WHERE id = ? LIMIT 1",
          [typeId],
        )
        .catch(() => undefined);
      return typeCodename?.rows[0]?.codename === match[1];
    })();
  };
}

const ABSTRACT_LIST_TYPE_CODENAMES: ReadonlySet<string> = new Set([
  "list",
  "pointer",
  "mod",
  "session",
  "skin",
]);
const ABSTRACT_LIST_RIGHT_CODENAMES: ReadonlySet<string> = new Set([
  "followers",
  "status",
]);
const ABSTRACT_LIST_SELF_KEYS: ReadonlySet<string> = new Set([
  DeckoName.parse("*mod").key,
  DeckoName.parse("*recent settings").key,
  DeckoName.parse("input type+*content options").key,
]);
const ABSTRACT_LIST_TYPE_PLUS_RIGHT: ReadonlyArray<readonly [string, string]> = [
  ["mod", "script"],
  ["mod", "style"],
  ["user", "follow"],
];

export function abstractListEventsSetMember(
  driver: SQLDatabaseDriver,
): (
  setPath: string,
  card: { name?: string; id?: number; key?: string; typeId?: number | null },
  event?: string,
) => boolean | Promise<boolean> {
  const typePlusRight = typePlusRightSetMember(driver);
  return (setPath, card, event) => {
    if (setPath !== "abstract/01_list/events") return false;
    if (event !== undefined && event !== "validate_item_type" && event !== "validate_item_uniqueness") {
      return false;
    }
    const name = card.name;
    if (name === undefined || name === "") return false;
    const parsed = DeckoName.parse(name);
    if (card.key !== undefined && ABSTRACT_LIST_SELF_KEYS.has(card.key)) return true;
    if (ABSTRACT_LIST_SELF_KEYS.has(parsed.key)) return true;
    const tagKey = parsed.tagKey;
    return (async () => {
      if (tagKey !== undefined) {
        const tagRow = await driver
          .query<{ codename: string | null }>(
            "SELECT codename FROM cards WHERE key = ? AND trash = 0 LIMIT 1",
            [tagKey],
          )
          .catch(() => undefined);
        const tagCodename = tagRow?.rows[0]?.codename;
        if (tagCodename !== null && tagCodename !== undefined && ABSTRACT_LIST_RIGHT_CODENAMES.has(tagCodename)) {
          return true;
        }
      }
      let typeCodename: string | null | undefined;
      if (card.typeId !== undefined && card.typeId !== null) {
        const row = await driver
          .query<{ codename: string | null }>(
            "SELECT codename FROM cards WHERE id = ? LIMIT 1",
            [card.typeId],
          )
          .catch(() => undefined);
        typeCodename = row?.rows[0]?.codename;
      } else if (card.id !== undefined) {
        const row = await driver
          .query<{ codename: string | null }>(
            "SELECT t.codename AS codename FROM cards c LEFT JOIN cards t ON t.id = c.type_id " +
              "WHERE c.id = ? LIMIT 1",
            [card.id],
          )
          .catch(() => undefined);
        typeCodename = row?.rows[0]?.codename;
      }
      if (typeCodename !== null && typeCodename !== undefined && ABSTRACT_LIST_TYPE_CODENAMES.has(typeCodename)) {
        return true;
      }
      for (const [typeCodename, rightCodename] of ABSTRACT_LIST_TYPE_PLUS_RIGHT) {
        if (await typePlusRight(`type_plus_right/${typeCodename}/${rightCodename}`, card)) {
          return true;
        }
      }
      return false;
    })();
  };
}
