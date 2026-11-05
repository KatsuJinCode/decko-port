import { CqlBadQuery, ConditionNode, JoinNode, QueryNode } from "./ast.js";
import { BASIC_FIELDS, DEFAULT_ORDER_DIRS, LIST_OPS, ORDER_MAP } from "./constants.js";
import { escapeRegexpCharacters, safeSql, translateServerRegexp } from "./normalize.js";

export interface SqlOptions {
  alwaysOk?: boolean;
  readRuleIds?: number[];
  countByReadRule?: boolean;
  matchPostFilter?: boolean;
}

export function isRegexpMatchCondition(condition: ConditionNode): boolean {
  return condition.kind === "match" && !(condition.prefix === "=" && condition.cqlField === "name");
}

export function collectMatchPostFilters(root: QueryNode): ConditionNode[] {
  const filters: ConditionNode[] = [];
  for (const condition of root.conditions) {
    if (isRegexpMatchCondition(condition)) {
      filters.push(condition);
    } else if (
      condition.kind === "group" &&
      condition.conditions.some((child) => isRegexpMatchCondition(child))
    ) {
      filters.push(condition);
    }
  }
  return filters;
}

export const MATCH_HELPER_PREFIX = "__cql_match_";

export function matchFilterColumns(filters: ConditionNode[]): string[] {
  const columns = new Set<string>();
  const visit = (condition: ConditionNode): void => {
    if (condition.kind === "match") {
      columns.add(isRegexpMatchCondition(condition) ? condition.field : "key");
    } else if (condition.kind === "group") {
      condition.conditions.forEach(visit);
    }
  };
  filters.forEach(visit);
  return [...columns];
}

export function hasNestedRegexpMatch(root: QueryNode): boolean {
  const visit = (query: QueryNode): boolean => {
    for (const condition of query.conditions) {
      if (isRegexpMatchCondition(condition)) return true;
      if (
        condition.kind === "group" &&
        condition.conditions.some((child) => isRegexpMatchCondition(child))
      ) {
        return true;
      }
    }
    return query.subqueries.some(visit);
  };
  return root.subqueries.some(visit);
}

export interface SqlResult {
  sql: string;
  params: unknown[];
}

export function generateSql(root: QueryNode, options: SqlOptions = {}): SqlResult {
  const ctx: GenContext = { params: [], options };
  const sql = renderQuery(root, ctx, true);
  return { sql, params: ctx.params };
}

interface GenContext {
  params: unknown[];
  options: SqlOptions;
}

function renderQuery(query: QueryNode, ctx: GenContext, isRoot: boolean): string {
  const alias = query.tableAlias;
  const full = isRoot && query.mods.return !== "count";

  const orderDirectives = full ? orderDirectivesOf(query) : [];

  const groupByRule =
    isRoot && query.mods.return === "count" && ctx.options.countByReadRule === true;
  const parts: string[] = groupByRule
    ? [`${alias}.read_rule_id AS read_rule_id`, fullField(alias, query.mods.return)]
    : [fullField(alias, query.mods.return)];
  for (const directive of orderDirectives) parts.push(directive.field);
  if (full && isRoot && ctx.options.matchPostFilter === true) {
    const ret = query.mods.return;
    if (!(ret === undefined || ret === "card" || ret === "raw" || /^_w+/.test(ret))) {
      for (const column of matchFilterColumns(collectMatchPostFilters(query))) {
        parts.push(`${alias}.${column} AS ${MATCH_HELPER_PREFIX}${column}`);
      }
    }
  }

  const selectSql = `SELECT${renderedJoins(query).length > 0 ? " DISTINCT" : ""} ${parts.join(", ")}`;
  const fromSql = `FROM ${query.table} ${alias}`;
  const joinsSql = renderJoins(query, ctx);
  const whereSql = renderWhere(query, ctx);
  const groupSql = groupByRule
    ? `GROUP BY ${alias}.read_rule_id`
    : full && query.mods.group
      ? `GROUP BY ${safeSql(query.mods.group)}`
      : "";
  const orderSql =
    orderDirectives.length > 0
      ? `ORDER BY ${orderDirectives.map((d) => (d.dir ? `${d.field} ${d.dir}` : d.field)).join(", ")}`
      : "";
  let limitSql = "";
  if (full) {
    if (isRoot && ctx.options.matchPostFilter === true && hasRootRegexpMatch(query)) {
      return [selectSql, fromSql, joinsSql, whereSql, groupSql, orderSql]
        .filter((chunk) => chunk !== "")
        .join(" ");
    }
    const limit = toInt(query.mods.limit);
    if (limit > 0) {
      limitSql = `LIMIT ${limit}`;
      if (query.mods.offset !== undefined && query.mods.offset !== "") {
        limitSql += ` OFFSET ${toInt(query.mods.offset)}`;
      }
    }
  }

  return [selectSql, fromSql, joinsSql, whereSql, groupSql, orderSql, limitSql]
    .filter((chunk) => chunk !== "")
    .join(" ");
}

function toInt(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}

function hasRootRegexpMatch(query: QueryNode): boolean {
  return collectMatchPostFilters(query).length > 0;
}

function fullField(alias: string, ret: string | undefined): string {
  const field = ret === undefined || /^_\w+/.test(ret) ? "card" : ret;
  switch (field) {
    case "card":
    case "raw":
      return `${alias}.*`;
    case "content":
      return `${alias}.db_content`;
    case "name":
    case "key":
      return `${alias}.name, ${alias}.left_id, ${alias}.right_id`;
    case "count":
      return `coalesce(count(distinct ${alias}.id),0) as count`;
    default:
      return (BASIC_FIELDS as readonly string[]).includes(field)
        ? `${alias}.${field}`
        : safeSql(field);
  }
}

function renderWhere(query: QueryNode, ctx: GenContext): string {
  const explicit = explicitConditions(query, ctx);
  const implicit = implicitConditions(query, ctx);
  const chunks = [explicit, implicit].filter((chunk) => chunk !== "");
  return chunks.length > 0 ? `WHERE ${chunks.join(" AND ")}` : "";
}

function explicitConditions(query: QueryNode, ctx: GenContext): string {
  const list: string[] = query.conditions.map((condition) => renderCondition(condition, query, ctx));
  for (const sub of query.subqueries) {
    if (sub.conditionsOnJoin) continue;
    switch (sub.fasten) {
      case "exist":
        list.push(`${sub.negate ? "NOT " : ""}EXISTS (${renderQuery(sub, ctx, false)})`);
        break;
      case "in":
        list.push(
          `${sub.mods.inField ?? `${sub.tableAlias}.id`} ${sub.negate ? "NOT " : ""}IN (${renderQuery(sub, ctx, false)})`,
        );
        break;
      default:
        list.push(explicitConditions(sub, ctx));
    }
  }
  return formatConditionList(list, query.conj);
}

function formatConditionList(list: string[], conj: string): string {
  list = list.filter((condition) => condition !== "");
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  return `(${list.join(` ${conj.toUpperCase()} `)})`;
}

function implicitConditions(query: QueryNode, ctx: GenContext): string {
  if (query.kind !== "card") return "";
  const chunks = [`${query.tableAlias}.trash is false`];
  const { alwaysOk = true, readRuleIds } = ctx.options;
  if (!alwaysOk) {
    if (readRuleIds && readRuleIds.length > 0) {
      chunks.push(`${query.tableAlias}.read_rule_id IN (${readRuleIds.map(() => "?").join(",")})`);
      ctx.params.push(...readRuleIds);
    } else {
      chunks.push(`${query.tableAlias}.read_rule_id IN (1)`);
    }
  }
  return chunks.join(" AND ");
}

function renderCondition(condition: ConditionNode, query: QueryNode, ctx: GenContext): string {
  const alias = query.tableAlias;
  switch (condition.kind) {
    case "value": {
      const fieldSql = `${alias}.${condition.field}`;
      if (condition.values.length === 1 && !LIST_OPS.has(condition.op)) {
        return `${fieldSql} ${condition.op} ${renderScalar(condition.values[0], ctx)}`;
      }
      return `${fieldSql} ${condition.op} (${condition.values
        .map((v) => renderScalar(v, ctx))
        .join(",")})`;
    }
    case "match": {
      if (condition.prefix === "=" && condition.cqlField === "name") {
        return `${alias}.key = ${placeholder(ctx, condition.termKey)}`;
      }
      if (ctx.options.matchPostFilter === true) return "";
      const value =
        condition.prefix === "~~" ? condition.term : escapeRegexpCharacters(condition.term);
      if (condition.prefix === "~~") {
        return `${alias}.${condition.field} REGEXP ${placeholder(ctx, translateServerRegexp(value))}`;
      }
      return `lower(${alias}.${condition.field}) REGEXP lower(${placeholder(ctx, value)})`;
    }
    case "like":
      return `${alias}.key LIKE ${placeholder(ctx, `${condition.value}%`)}`;
    case "raw":
      return condition.sql;
    case "group":
      if (ctx.options.matchPostFilter === true) {
        if (condition.conditions.some((c) => isRegexpMatchCondition(c))) return "";
        return `(${condition.conditions
          .map((c) => renderCondition(c, query, ctx))
          .join(` ${condition.conj.toUpperCase()} `)})`;
      }
      return `(${condition.conditions
        .map((c) => renderCondition(c, query, ctx))
        .join(` ${condition.conj.toUpperCase()} `)})`;
    case "foundBy":
      throw new CqlBadQuery(
        "found_by condition reached SQL generation unresolved (unhandled found_by shape) — execute.ts resolveFoundByConditions should have translated it",
      );
  }
}

function renderScalar(value: string | number | null, ctx: GenContext): string {
  if (value === null) return "NULL";
  return placeholder(ctx, value);
}

function placeholder(ctx: GenContext, value: unknown): string {
  ctx.params.push(value);
  return "?";
}

function renderedJoins(query: QueryNode): JoinNode[] {
  const joins = [...query.joins];
  collectDirectSubqueryJoins(query, joins);
  return joins;
}

function collectDirectSubqueryJoins(query: QueryNode, out: JoinNode[]): void {
  for (const sub of query.subqueries) {
    if (sub.fasten === "direct") {
      out.push(...sub.joins);
      collectDirectSubqueryJoins(sub, out);
    }
  }
}

function renderJoins(query: QueryNode, ctx: GenContext): string {
  const chunks: string[] = [];
  for (const join of renderedJoins(query)) {
    renderJoin(join, ctx, chunks);
  }
  return chunks.join(" ");
}

function renderJoin(join: JoinNode, ctx: GenContext, chunks: string[]): void {
  const side = join.side ?? "";
  if (join.countSortSubquery !== undefined) {
    const sub = join.countSortSubquery;
    chunks.push(
      `${side ? `${side} ` : ""}JOIN (SELECT wr.referee_id AS "sort_join_field", ` +
        `coalesce(count(*), 0) AS "count" FROM card_references wr ` +
        `WHERE wr.referer_id IN (${renderQuery(sub, ctx, false)}) ` +
        `GROUP BY wr.referee_id) ${join.toAlias} ` +
        `ON ${join.fromAlias}.${join.fromField} = ${join.toAlias}.${join.toField}`,
    );
    return;
  }
  const subjoins = join.to ? renderJoins(join.to, ctx) : "";
  const onSql = onClause(join, ctx);

  if (side === "LEFT" && subjoins !== "") {
    chunks.push(`LEFT JOIN (${join.toTable} ${join.toAlias} ${subjoins}) ON ${onSql}`);
  } else {
    chunks.push(`${side ? `${side} ` : ""}JOIN ${join.toTable} ${join.toAlias} ON ${onSql}`);
    if (subjoins !== "") chunks.push(subjoins);
  }
}

function onClause(join: JoinNode, ctx: GenContext): string {
  const conditions: string[] = [
    `${join.fromAlias}.${join.fromField} = ${join.toAlias}.${join.toField}`,
  ];
  const to = join.to;
  if (to) {
    if (to.conditionsOnJoin) {
      const explicit = explicitConditions(to, ctx);
      if (explicit !== "") conditions.push(explicit);
    }
    const implicit = implicitConditions(to, ctx);
    if (implicit !== "") conditions.push(implicit);
  }
  return conditions.join(" AND ");
}

interface OrderDirective {
  field: string;
  dir: string;
}

function orderDirectivesOf(query: QueryNode): OrderDirective[] {
  const sortMod = query.mods.sortBy ?? query.mods.sort;
  if (!sortMod || sortMod.length === 0) return [];
  return sortMod.map((token, index) => {
    const field = orderField(query, token);
    return { field, dir: orderDir(query, token, index) };
  });
}

function orderField(query: QueryNode, token: string): string {
  const mapped = ORDER_MAP[token];
  const raw = mapped ? `${query.tableAlias}.${mapped}` : safeSql(token);
  return applySortAs(query, raw);
}

function applySortAs(query: QueryNode, field: string): string {
  const as = query.mods.sortAs;
  if (!as) return field;
  return `CAST(${field} AS ${sqliteCastType(safeSql(as))})`;
}

function orderDir(query: QueryNode, token: string, index: number): string {
  const dirs = query.mods.sortDir ?? query.mods.dir;
  if (!dirs || dirs.length === 0) {
    return DEFAULT_ORDER_DIRS[token] ?? "asc";
  }
  const dir = dirs[index];
  return dir === undefined ? "" : safeSql(dir);
}

function sqliteCastType(type: string): string {
  switch (type.toLowerCase()) {
    case "signed":
    case "integer":
    case "int":
      return "INTEGER";
    case "char":
    case "string":
    case "text":
    case "binary":
      return "TEXT";
    case "decimal":
    case "float":
    case "real":
    case "numeric":
      return "REAL";
    default:
      return type;
  }
}
