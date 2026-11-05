import type { SQLStatement } from "../../server/driver.js";
import { ruleCacheKeyFromRow } from "../set-patterns/rule-names.js";

export interface RuleCacheRow {
  rule_id: number | string;
  setting_id: number | string;
  set_id: number | string;
  anchor_id: number | string | null;
  set_tag_id: number | string | null;
}

export function ruleCacheStatement(
  setTypeId: number,
  settingTypeId: number,
  options: { includeContent?: boolean } = {},
): SQLStatement {
  return {
    sql: `SELECT
          rules.id      AS rule_id,${options.includeContent ? "\n          rules.db_content AS rule_content," : ""}
          settings.id   AS setting_id,
          sets.id       AS set_id,
          sets.left_id  AS anchor_id,
          sets.right_id AS set_tag_id
        FROM cards rules
        JOIN cards sets     ON rules.left_id  = sets.id
        JOIN cards settings ON rules.right_id = settings.id
        WHERE     sets.type_id = ?
          AND settings.type_id = ?
          AND (settings.codename != 'follow' OR rules.db_content != '')
          AND    rules.trash is false
          AND     sets.trash is false
          AND settings.trash is false`,
    params: [setTypeId, settingTypeId],
  };
}

function toId(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

export function buildRuleLookupHash(
  rows: readonly RuleCacheRow[],
  nameForId: (id: number) => string | undefined,
): Map<string, number> {
  const hash = new Map<string, number>();
  for (const row of rows) {
    const settingCode = nameForId(toId(row.setting_id));
    if (settingCode === undefined) continue;
    const anchorId = row.anchor_id === null ? null : toId(row.anchor_id);
    const setClassId = anchorId === null ? toId(row.set_id) : toId(row.set_tag_id ?? 0);
    const patternCode = nameForId(setClassId);
    if (patternCode === undefined) continue;
    hash.set(ruleCacheKeyFromRow(anchorId, patternCode, settingCode), toId(row.rule_id));
  }
  return hash;
}

export function ruleIdLookup<V>(
  hash: ReadonlyMap<string, V>,
  lookupKeys: readonly string[],
  settingCode: string,
  fallbackSuffix?: string,
): V | undefined {
  for (const key of lookupKeys) {
    const ruleId = hash.get(`${key}+${settingCode}`);
    if (ruleId !== undefined) return ruleId;
    if (fallbackSuffix === undefined) continue;
    const fallbackId = hash.get(`${key}+${fallbackSuffix}`);
    if (fallbackId !== undefined) return fallbackId;
  }
  return undefined;
}
