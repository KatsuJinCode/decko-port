import { DeckoName, type Nameish } from "../name.js";
import { CodenameNotFoundError, NameNotFoundError } from "../name/errors.js";
import type { SQLQueryResult, SQLStatement } from "../../server/driver.js";
import { ruleNamesForCard } from "../set-patterns/rule-names.js";
import type { PatternCardInput } from "../set-patterns/types.js";
import { referencedNames } from "../render/nest-syntax.js";

export const STRUCTURE_SETTING_NAME = "*structure";

export function structureRuleUniverseStatement(): SQLStatement {
  return ruleUniverseStatementBySetting(STRUCTURE_SETTING_NAME);
}

export const DEFAULT_SETTING_NAME = "*default";

export function ruleUniverseStatementBySetting(settingName: string): SQLStatement {
  if (typeof process !== "undefined" && process.env?.DECKO_LEGACY_RULE_UNIVERSE === "1") {
    return legacyRuleUniverseStatement(settingName);
  }
  return {
    sql:
      `WITH RECURSIVE\n` +
      `setting(id) AS (SELECT id FROM cards WHERE ("key" = ? OR name = ?) AND trash = 0 ORDER BY id LIMIT 1),\n` +
      `rules(rid, lid, db_content, type_id) AS (\n` +
      `  SELECT r.id, r.left_id, r.db_content, r.type_id FROM cards r\n` +
      `  WHERE r.trash = 0 AND r.right_id = (SELECT id FROM setting)),\n` +
      `up(rid, cur, suffix) AS (\n` +
      `  SELECT rid, lid, CAST('' AS TEXT) FROM rules\n` +
      `  UNION ALL\n` +
      `  SELECT u.rid, c.left_id, '+' || COALESCE(rk."key", '') || u.suffix\n` +
      `  FROM up u JOIN cards c ON c.id = u.cur JOIN cards rk ON rk.id = c.right_id\n` +
      `  WHERE c.left_id IS NOT NULL)\n` +
      `SELECT CASE WHEN COALESCE(b."key", '') || u.suffix <> ''\n` +
      `         THEN COALESCE(b."key", '') || u.suffix || '+' || st."key" ELSE NULL END AS composed_key,\n` +
      `  rules.db_content AS db_content, rules.type_id AS rule_type_id\n` +
      `FROM up u\n` +
      `JOIN cards b ON b.id = u.cur AND b.left_id IS NULL AND b.right_id IS NULL\n` +
      `JOIN rules ON rules.rid = u.rid\n` +
      `JOIN cards st ON st.id = (SELECT id FROM setting)\n` +
      `ORDER BY rules.rid`,
    params: [settingName, settingName],
  };
}

export function legacyRuleUniverseStatement(settingName: string): SQLStatement {
  return {
    sql:
      `WITH RECURSIVE name_walk(id, composed) AS (\n` +
      `  -- Base case: simple cards (no left, no right) use their stored key\n` +
      `  SELECT id, CAST(COALESCE("key", '') AS TEXT)\n` +
      `  FROM cards\n` +
      `  WHERE left_id IS NULL AND right_id IS NULL\n` +
      `  UNION ALL\n` +
      `  -- Junction case: compose left-walk + right-key. The walk does NOT\n` +
      `  -- filter on trash: a trashed intermediate card still carries its\n` +
      `  -- left_id/right_id and contributes to the composed name (mirrors\n` +
      `  -- the old SQL's LEFT JOIN chain through trashed junctions — e.g.\n` +
      `  -- rule 829 has set card 828 trashed but walks through Gallery).\n` +
      `  SELECT c.id, COALESCE(w.composed, '') || '+' || COALESCE(r."key", '')\n` +
      `  FROM cards c\n` +
      `  JOIN name_walk w ON w.id = c.left_id\n` +
      `  JOIN cards r ON r.id = c.right_id\n` +
      `)\n` +
      `SELECT\n` +
      `  CASE\n` +
      `    WHEN n.composed IS NOT NULL AND n.composed <> ''\n` +
      `      THEN n.composed || '+' || st."key"\n` +
      `    ELSE NULL\n` +
      `  END AS composed_key,\n` +
      `  r.db_content AS db_content,\n` +
      `  r.type_id AS rule_type_id\n` +
      `FROM cards r\n` +
      `JOIN cards st ON st.id = r.right_id\n` +
      `JOIN name_walk n ON n.id = r.left_id\n` +
      `WHERE r.trash = 0\n` +
      `  AND r.right_id = (SELECT id FROM cards\n` +
      `                    WHERE ("key" = ? OR name = ?)\n` +
      `                      AND trash = 0 ORDER BY id LIMIT 1)`,
    params: [settingName, settingName],
  };
}

export function defaultRuleUniverseStatement(): SQLStatement {
  return ruleUniverseStatementBySetting(DEFAULT_SETTING_NAME);
}

export function templateTypeNameStatement(): SQLStatement {
  return {
    sql:
      `SELECT DISTINCT c.type_id AS type_id, t.name AS name\n` +
      `FROM cards c\n` +
      `LEFT JOIN cards t ON t.id = c.type_id\n` +
      `WHERE c.trash = 0\n` +
      `  AND c.right_id IN (\n` +
      `    SELECT id FROM cards\n` +
      `    WHERE key IN ('*default', '*structure') AND trash = 0)\n` +
      `  AND c.type_id IS NOT NULL`,
    params: [],
  };
}

export function templateTypeNamesFromResults(
  result: SQLQueryResult | undefined,
): Map<number, string> {
  const map = new Map<number, string>();
  if (result === undefined) return map;
  for (const row of result.rows as Array<{ type_id: number | null; name: string | null }>) {
    if (row.type_id === null || row.name === null || row.name === "") continue;
    map.set(row.type_id, row.name);
  }
  return map;
}

export function structureUniverseFromResults(
  result: SQLQueryResult | undefined,
): Map<string, string | null> {
  const universe = new Map<string, string | null>();
  if (result === undefined) return universe;
  for (const row of result.rows as Array<{ composed_key: string | null; db_content: string | null }>) {
    if (row.composed_key === null) continue;
    const canonicalKey = DeckoName.parse(row.composed_key).key;
    if (canonicalKey === "") continue;
    universe.set(canonicalKey, row.db_content);
  }
  return universe;
}

export function structureRuleTypesFromResults(
  result: SQLQueryResult | undefined,
): Map<string, number> {
  const types = new Map<string, number>();
  if (result === undefined) return types;
  for (const row of result.rows as Array<{ composed_key: string | null; rule_type_id: number | null }>) {
    if (row.composed_key === null || row.rule_type_id === null) continue;
    const canonicalKey = DeckoName.parse(row.composed_key).key;
    if (canonicalKey === "") continue;
    types.set(canonicalKey, row.rule_type_id);
  }
  return types;
}

export interface StructuredContentResult {
  templateContent: string;
  ruleName: string;
  matchedIndex: number;
}

export function resolveStructuredContent(
  card: PatternCardInput,
  universe: Map<string, string | null>,
): StructuredContentResult | undefined {
  if (universe.size === 0) return undefined;
  const candidates = ruleNamesForCard(card, STRUCTURE_SETTING_NAME);
  for (let i = 0; i < candidates.length; i++) {
    const key = DeckoName.parse(candidates[i] as string).key;
    if (!universe.has(key)) continue;
    const content = universe.get(key) ?? null;
    if (content === null) return undefined;
    if (content.trim() === "_self") return undefined;
    return { templateContent: content, ruleName: candidates[i] as string, matchedIndex: i };
  }
  return undefined;
}

export function structuredCardContent(
  card: PatternCardInput,
  recordDbContent: string | null | undefined,
  universe: Map<string, string | null>,
  setModuleOverride?: string | undefined,
): string {
  if (setModuleOverride !== undefined) return setModuleOverride;
  const structured = resolveStructuredContent(card, universe);
  if (structured !== undefined) return structured.templateContent;
  return recordDbContent ?? "";
}

export function templateReferenceNames(
  templateContent: string,
  contextName?: DeckoName,
): string[] {
  const byTemplate = DeckoName.requestMemo<Map<string, readonly string[]>>(TEMPLATE_REFERENCE_MEMO);
  let memo: Map<string, readonly string[]> | undefined;
  if (byTemplate !== undefined) {
    memo = byTemplate.get(templateContent);
    if (memo === undefined) {
      memo = new Map();
      byTemplate.set(templateContent, memo);
    }
  }
  const memoKey = contextName?.s ?? "";
  const hit = memo?.get(memoKey);
  if (hit !== undefined) return [...hit];
  const names: string[] = [];
  let dropped = false;
  for (const ref of referencedNames(templateContent)) {
    if (ref.relative) continue;
    if (ref.name === "") continue;
    if (contextName === undefined) {
      names.push(ref.name);
      continue;
    }
    try {
      names.push(DeckoName.parse(ref.name).absoluteName(contextName).s);
    } catch (err) {
      if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
        dropped = true;
        continue;
      }
      throw err;
    }
  }
  if (memo !== undefined && !dropped) memo.set(memoKey, [...names]);
  return names;
}

const TEMPLATE_REFERENCE_MEMO = {};
