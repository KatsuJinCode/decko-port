import type { SQLDatabaseDriver } from "../server/driver.js";
import type { CardsRow } from "../server/schema.js";
import type { DbLexicon } from "../card/fetch/lexicon.js";
import { DeckoName } from "../card/name.js";
import { VIRTUAL_SEARCH_CQL_BY_CODENAME } from "../card/fetch/virtual-search-cards.js";
import { parseCql } from "./parser.js";
import { CqlBadQuery, type ParseOptions, type ConditionNode, type QueryNode } from "./ast.js";
import {
  generateSql,
  collectMatchPostFilters,
  hasNestedRegexpMatch,
  isRegexpMatchCondition,
  MATCH_HELPER_PREFIX,
  type SqlOptions,
} from "./sql.js";
import { absolutizeName, escapeRegexpCharacters } from "./normalize.js";
import { compileMatchPattern } from "./sqlite-regexp.js";

export interface CqlExecuteOptions extends SqlOptions {
  parse?: ParseOptions;
  foundByDepth?: number;
}

export interface CqlExecutionResult<Row = CardsRow> {
  sql: string;
  params: unknown[];
  rows: Row[];
}

export interface CqlCountResult {
  sql: string;
  params: unknown[];
  count: number;
}

export type CqlQueryResult = CqlExecutionResult<CardsRow> | CqlCountResult;

export function parseOptionsWithLexicon(
  lexicon: DbLexicon,
  base: ParseOptions = {},
): ParseOptions {
  return {
    ...base,
    resolveCardId: (name: string) => lexicon.peekId(name),
    ensureCardId: (name: string) => lexicon.id(name),
  };
}

async function ensureStatementCardNamesCached(
  cqlQuery: unknown,
  parse: ParseOptions | undefined,
): Promise<void> {
  if (parse === undefined || parse.ensureCardId === undefined) return;
  const ensureCardId = parse.ensureCardId;
  if (cqlQuery === null || typeof cqlQuery !== "object") return;
  const names = collectCardNameValues(cqlQuery);
  if (parse.context !== undefined && parse.context !== "") {
    names.add(parse.context);
    try {
      for (const part of DeckoName.parse(parse.context).parts) {
        if (part !== "") names.add(part);
      }
    } catch {
    }
  }
  for (const varValue of Object.values(parse.vars ?? {})) {
    if (typeof varValue === "string" && varValue !== "" && !varValue.startsWith("_")) {
      names.add(varValue);
    }
  }
  for (const name of names) {
    try {
      await ensureCardId(name);
    } catch {
    }
  }
}

export function collectCardNameValues(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    if (value !== "" && !value.startsWith("_") && !value.startsWith("$")) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectCardNameValues(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key === "return" || key === "sort" || key === "dir") continue;
      collectCardNameValues(val, out);
    }
  }
  return out;
}

export async function executeQuery(
  driver: SQLDatabaseDriver,
  cqlQuery: unknown,
  options: CqlExecuteOptions = {},
): Promise<CqlQueryResult> {
  await ensureStatementCardNamesCached(cqlQuery, options.parse);
  const root = parseCql(cqlQuery, options.parse);
  await resolveFoundByConditions(driver, root, options);
  if (root.mods.return === "count") {
    return executeCountNode(driver, root, options);
  }
  const filters = collectMatchPostFilters(root);
  const postFilter = options.matchPostFilter === true || driver.cqlRegexpSemantics === "incompatible" || regexpBrokenDrivers.has(driver);
  if (filters.length > 0) {
    if (!postFilter) {
      const { sql, params } = generateSql(root, options);
      try {
        const result = await driver.query<CardsRow>(sql, params);
        return { sql, params, rows: result.rows };
      } catch (error) {
        if (!isMissingRegexpError(error)) throw error;
        regexpBrokenDrivers.set(driver, true);
      }
    }
    return executeRowsPostFiltered(driver, root, options, filters);
  }
  if (postFilter && hasNestedRegexpMatch(root)) throw nestedMatchRefusal();
  const { sql, params } = generateSql(root, options);
  try {
    const result = await driver.query<CardsRow>(sql, params);
    return { sql, params, rows: result.rows };
  } catch (error) {
    if (!isMissingRegexpError(error)) throw error;
    regexpBrokenDrivers.set(driver, true);
    throw nestedMatchRefusal();
  }
}

const regexpBrokenDrivers = new WeakMap<object, true>();

function isMissingRegexpError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such function:\s*REGEXP/i.test(message);
}

function nestedMatchRefusal(): CqlBadQuery {
  return new CqlBadQuery(
    "match inside a subselect requires the REGEXP UDF (unavailable on this driver) — not supported by the JS post-filter; see docs/decisions/0005-cql-match-semantics.md",
  );
}

async function executeRowsPostFiltered(
  driver: SQLDatabaseDriver,
  root: QueryNode,
  options: CqlExecuteOptions,
  filters: ConditionNode[],
): Promise<CqlExecutionResult<CardsRow>> {
  if (hasNestedRegexpMatch(root)) throw nestedMatchRefusal();
  if (hasRootGroup(root)) throw groupedMatchRefusal();
  const { sql, params } = generateSql(root, { ...options, matchPostFilter: true });
  const result = await driver.query<CardsRow>(sql, params);
  let filtered = applyMatchFilters(result.rows, filters);
  filtered = stripMatchHelpers(filtered, sql.startsWith("SELECT DISTINCT"));
  return { sql, params, rows: applyPostFilterLimitOffset(filtered, root.mods) };
}

function stripMatchHelpers(rows: CardsRow[], distinct: boolean): CardsRow[] {
  const first = rows[0] as unknown as Record<string, unknown> | undefined;
  if (first === undefined) return rows;
  const helpers = Object.keys(first).filter((key) => key.startsWith(MATCH_HELPER_PREFIX));
  if (helpers.length === 0) return rows;
  const seen = new Set<string>();
  const out: CardsRow[] = [];
  for (const row of rows) {
    const copy = { ...(row as unknown as Record<string, unknown>) };
    for (const key of helpers) delete copy[key];
    if (distinct) {
      const signature = JSON.stringify(copy);
      if (seen.has(signature)) continue;
      seen.add(signature);
    }
    out.push(copy as unknown as CardsRow);
  }
  return out;
}

function hasRootGroup(root: QueryNode): boolean {
  return root.mods.group !== undefined && root.mods.group !== "";
}

function groupedMatchRefusal(): CqlBadQuery {
  return new CqlBadQuery(
    "match with group requires the REGEXP UDF (unavailable on this driver) — the JS post-filter cannot filter before a GROUP BY; see docs/decisions/0005-cql-match-semantics.md",
  );
}

function rowMatches(row: CardsRow, condition: ConditionNode): boolean {
  switch (condition.kind) {
    case "match": {
      if (!isRegexpMatchCondition(condition)) {
        return columnValue(row, "key") === condition.termKey;
      }
      const value = columnValue(row, condition.field);
      if (value === null || value === undefined) return false;
      const pattern =
        condition.prefix === "~~" ? condition.term : escapeRegexpCharacters(condition.term);
      const compiled = compileMatchPattern(pattern);
      if (compiled === null) {
        throw new Error(`invalid REGEXP pattern: ${pattern}`);
      }
      return compiled.test(String(value));
    }
    case "group": {
      const results = condition.conditions.map((child) => rowMatches(row, child));
      return condition.conj === "or" ? results.some(Boolean) : results.every(Boolean);
    }
    default:
      throw new CqlBadQuery(
        "match combined with another condition kind in one group requires the REGEXP UDF (unavailable on this driver); see docs/decisions/0005-cql-match-semantics.md",
      );
  }
}

function columnValue(row: CardsRow, column: string): unknown {
  const record = row as unknown as Record<string, unknown>;
  const helper = MATCH_HELPER_PREFIX + column;
  return helper in record ? record[helper] : record[column];
}

function applyMatchFilters(rows: CardsRow[], filters: ConditionNode[]): CardsRow[] {
  if (filters.length === 0) return rows;
  return rows.filter((row) => filters.every((filter) => rowMatches(row, filter)));
}

function applyPostFilterLimitOffset(
  rows: CardsRow[],
  mods: { limit?: string; offset?: string },
): CardsRow[] {
  const limit = toIntOrZero(mods.limit);
  const offset = toIntOrZero(mods.offset);
  if (limit <= 0) return rows;
  return rows.slice(offset > 0 ? offset : 0, (offset > 0 ? offset : 0) + limit);
}

function toIntOrZero(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}

export async function executeCount(
  driver: SQLDatabaseDriver,
  cqlQuery: unknown,
  options: CqlExecuteOptions = {},
): Promise<number> {
  const root = parseCql(cqlQuery, options.parse);
  await resolveFoundByConditions(driver, root, options);
  const result = await executeCountNode(driver, root, options);
  return result.count;
}

async function executeCountNode(
  driver: SQLDatabaseDriver,
  root: QueryNode,
  options: CqlExecuteOptions = {},
): Promise<CqlCountResult> {
  const filters = collectMatchPostFilters(root);
  const postFilter = options.matchPostFilter === true || driver.cqlRegexpSemantics === "incompatible" || regexpBrokenDrivers.has(driver);
  if (filters.length > 0) {
    if (!postFilter) {
      try {
        return await countSql(driver, root, options);
      } catch (error) {
        if (!isMissingRegexpError(error)) throw error;
        regexpBrokenDrivers.set(driver, true);
      }
    }
    return executeCountPostFiltered(driver, root, options, filters);
  }
  if (postFilter && hasNestedRegexpMatch(root)) throw nestedMatchRefusal();
  try {
    return await countSql(driver, root, options);
  } catch (error) {
    if (!isMissingRegexpError(error)) throw error;
    regexpBrokenDrivers.set(driver, true);
    throw nestedMatchRefusal();
  }
}

async function countSql(
  driver: SQLDatabaseDriver,
  root: QueryNode,
  options: CqlExecuteOptions,
): Promise<CqlCountResult> {
  root.mods.return = "count";
  const { sql, params } = generateSql(root, options);
  const result = await driver.query<Record<string, unknown>>(sql, params);
  const first = result.rows[0];
  const raw = first === undefined ? undefined : first["count"];
  const count = raw === undefined || raw === null ? 0 : Number(raw);
  return { sql, params, count: Number.isNaN(count) ? 0 : count };
}

async function executeCountPostFiltered(
  driver: SQLDatabaseDriver,
  root: QueryNode,
  options: CqlExecuteOptions,
  filters: ConditionNode[],
): Promise<CqlCountResult> {
  if (hasNestedRegexpMatch(root)) throw nestedMatchRefusal();
  if (hasRootGroup(root)) throw groupedMatchRefusal();
  const savedReturn = root.mods.return;
  root.mods.return = undefined;
  try {
    const { sql, params } = generateSql(root, { ...options, matchPostFilter: true });
    const result = await driver.query<CardsRow>(sql, params);
    const count = new Set(applyMatchFilters(result.rows, filters).map((row) => row.id)).size;
    return { sql, params, count };
  } finally {
    root.mods.return = savedReturn;
  }
}

const FOUNDBY_CQL_TYPES = new Set(["search_type", "cardtype", "set"]);

const FOUNDBY_RIGHT_CODENAME_CQL: Record<string, Record<string, unknown>> = {
  type: { type: "_left" },
  self: { name: "_left" },
  right: { right: "_left" },
  "type plus right": { left: { type: "_LL" }, right: "_LR" },
};

const FOUNDBY_MAX_DEPTH = 8;

const FOUNDBY_EMPTY_ID = -999;

async function resolveFoundByConditions(
  driver: SQLDatabaseDriver,
  root: QueryNode,
  options: CqlExecuteOptions,
  depth = options.foundByDepth ?? 0,
): Promise<void> {
  for (const sub of root.subqueries) {
    await resolveFoundByConditions(driver, sub, options, depth);
  }
  for (let i = 0; i < root.conditions.length; i++) {
    const condition = root.conditions[i];
    if (condition === undefined || condition.kind !== "foundBy") continue;
    const replacements = await resolveFoundByCondition(
      driver,
      condition,
      root,
      options,
      depth,
    );
    root.conditions.splice(i, 1, ...replacements);
    i += replacements.length - 1;
  }
}

async function resolveFoundByCondition(
  driver: SQLDatabaseDriver,
  condition: Extract<ConditionNode, { kind: "foundBy" }>,
  node: QueryNode,
  options: CqlExecuteOptions,
  depth: number,
): Promise<ConditionNode[]> {
  if (depth > FOUNDBY_MAX_DEPTH) {
    throw new CqlBadQuery(
      `found_by nesting exceeds ${FOUNDBY_MAX_DEPTH} levels (the oracle implementation has no cap; ` +
        "the port refuses runaway found_by chains instead of overflowing the stack)",
    );
  }
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];
  const constraints: ConditionNode[] = [];
  for (const value of values) {
    if (value !== null && typeof value === "object") {
      constraints.push(
        ...(await resolveHashFoundBy(
          driver,
          value as Record<string, unknown>,
          node,
          options,
          depth,
        )),
      );
      continue;
    }
    if (typeof value !== "string") {
      throw new CqlBadQuery(
        `invalid found_by value: ${JSON.stringify(value)} (expected a card name or a list of names)`,
      );
    }
    const targetName = absolutizeName(value, node.context);
    const statement = await foundByTargetStatement(driver, targetName, options);
    constraints.push({
      kind: "value",
      field: "id",
      op: "in",
      values: await runFoundByTargetIds(driver, statement, targetName, options, depth),
    });
  }
  return constraints;
}

function invalidFoundByCard(name: string, typeName: string): CqlBadQuery {
  return new CqlBadQuery(
    `"found_by" value must be valid Search, but ${name} is a ${typeName}`,
  );
}

async function resolveHashFoundBy(
  driver: SQLDatabaseDriver,
  hash: Record<string, unknown>,
  node: QueryNode,
  options: CqlExecuteOptions,
  depth: number,
): Promise<ConditionNode[]> {
  const inner: Record<string, unknown> = { ...hash };
  for (const mod of ["return", "limit", "offset", "sort", "sort_by", "dir"]) {
    const modValue = inner[mod];
    if (modValue !== undefined && modValue !== null && typeof modValue !== "object") {
      delete inner[mod];
    }
  }
  const innerResult = await executeQuery(driver, inner, {
    ...options,
    foundByDepth: depth + 1,
    parse: { ...options.parse, context: node.context },
  });
  const rows =
    "rows" in innerResult
      ? (innerResult.rows as unknown as Record<string, unknown>[])
      : [];
  const constraints: ConditionNode[] = [];
  for (const row of rows) {
    const name = row["name"];
    if (typeof name !== "string") {
      throw new CqlBadQuery(
        `found_by hash produced a non-card result: ${JSON.stringify(row)}`,
      );
    }
    const statement = await foundByTargetStatement(driver, name, options);
    constraints.push({
      kind: "value",
      field: "id",
      op: "in",
      values: await runFoundByTargetIds(driver, statement, name, options, depth),
    });
  }
  return constraints;
}

async function foundByTargetCardId(
  name: string,
  options: CqlExecuteOptions,
): Promise<number | undefined> {
  const parse = options.parse;
  const ensure = parse?.ensureCardId;
  if (ensure !== undefined) {
    try {
      const id = await ensure(name);
      if (id !== undefined && id !== null) return id;
    } catch {
    }
  }
  const peeked = parse?.resolveCardId?.(name);
  if (peeked !== undefined && peeked !== null) return peeked;
  if (ensure === undefined && parse?.resolveCardId === undefined) {
    throw new CqlBadQuery(
      `found_by target "${name}" cannot be resolved: the execution options carry no ` +
        "card-name resolver (ParseOptions.ensureCardId / resolveCardId)",
    );
  }
  return undefined;
}

async function fetchCardRowById(
  driver: SQLDatabaseDriver,
  id: number,
): Promise<CardsRow | undefined> {
  const result = await driver.query<CardsRow>(
    "SELECT * FROM cards WHERE id = ? AND trash = 0",
    [id],
  );
  return result.rows[0];
}

async function fetchCodenameById(
  driver: SQLDatabaseDriver,
  id: number | null,
): Promise<string | undefined> {
  if (id === null || id === undefined) return undefined;
  const result = await driver.query<{ codename: string | null }>(
    "SELECT codename FROM cards WHERE id = ?",
    [id],
  );
  return result.rows[0]?.codename ?? undefined;
}

async function foundByTargetStatement(
  driver: SQLDatabaseDriver,
  targetName: string,
  options: CqlExecuteOptions,
): Promise<Record<string, unknown>> {
  const targetId = await foundByTargetCardId(targetName, options);
  const row = targetId === undefined ? undefined : await fetchCardRowById(driver, targetId);
  if (row !== undefined) {
    const typeCodename = await fetchCodenameById(driver, row.type_id);
    if (!FOUNDBY_CQL_TYPES.has(typeCodename ?? "")) {
      const typeRow = await fetchCardRowById(driver, row.type_id);
      throw invalidFoundByCard(targetName, typeRow?.name ?? typeCodename ?? "unknown");
    }
    if (typeCodename === "cardtype") {
      return { type_id: row.id, sort_by: "name" };
    }
    if (typeCodename === "set") {
      const override = foundByRightCodenameOverride(await fetchCodenameById(driver, row.right_id));
      if (override !== undefined) return override;
      return parseFoundByContentCql(row.db_content ?? "");
    }
    return parseFoundByContentCql(row.db_content ?? "");
  }
  const fabricated = await foundByFabricatedStatement(driver, targetName, options);
  if (fabricated !== undefined) return fabricated;
  throw invalidFoundByCard(targetName, "Basic");
}

function foundByRightCodenameOverride(
  rightCodename: string | undefined,
): Record<string, unknown> | undefined {
  const override =
    rightCodename === undefined || !Object.hasOwn(FOUNDBY_RIGHT_CODENAME_CQL, rightCodename)
      ? undefined : FOUNDBY_RIGHT_CODENAME_CQL[rightCodename];
  return override === undefined ? undefined : { ...override };
}

async function foundByFabricatedStatement(
  driver: SQLDatabaseDriver,
  targetName: string,
  options: CqlExecuteOptions,
): Promise<Record<string, unknown> | undefined> {
  const rightName = DeckoName.parse(targetName).rightName?.s;
  if (rightName === undefined) return undefined;
  const rightId = await foundByTargetCardId(rightName, options);
  if (rightId === undefined) return undefined;
  const rightCodename = await fetchCodenameById(driver, rightId);
  const virtualSearch = rightCodename === undefined
    ? undefined : VIRTUAL_SEARCH_CQL_BY_CODENAME.get(rightCodename);
  if (virtualSearch !== undefined) return parseFoundByContentCql(virtualSearch);
  return foundByRightCodenameOverride(rightCodename);
}

function parseFoundByContentCql(content: string): Record<string, unknown> {
  if (content === "") {
    throw new CqlBadQuery("can't run search with empty content");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new CqlBadQuery(`Invalid JSON search query: ${content}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`cql content is not a Hash: ${content}`);
  }
  return parsed as Record<string, unknown>;
}

async function runFoundByTargetIds(
  driver: SQLDatabaseDriver,
  statement: Record<string, unknown>,
  targetName: string,
  options: CqlExecuteOptions,
  depth: number,
): Promise<number[]> {
  const stripped: Record<string, unknown> = { ...statement };
  for (const mod of ["return", "limit", "offset", "sort", "sort_by", "dir"]) {
    const value = stripped[mod];
    if (value !== undefined && value !== null && typeof value !== "object") {
      delete stripped[mod];
    }
  }
  const keys = Object.keys(stripped);
  const typeKeys = keys.filter((key) => key === "type" || key === "type_id");
  const typeValue = typeKeys.length === 1 ? stripped[typeKeys[0]!] : undefined;
  if (
    typeKeys.length === 1 &&
    keys.every((key) => key === "type" || key === "type_id" || key === "trash") &&
    (typeof typeValue === "string" || (typeof typeValue === "number" && Number.isInteger(typeValue))) &&
    (stripped["trash"] === undefined || typeof stripped["trash"] === "boolean")
  ) {
    stripped["return"] = "id";
  }
  const result = await executeQuery(driver, stripped, {
    ...options,
    foundByDepth: depth + 1,
    parse: { ...options.parse, context: targetName },
  });
  const ids: number[] = [];
  for (const row of "rows" in result ? result.rows : []) {
    const id = (row as unknown as Record<string, unknown>)["id"];
    if (typeof id === "number" && Number.isInteger(id)) ids.push(id);
  }
  return ids.length > 0 ? ids : [FOUNDBY_EMPTY_ID];
}
