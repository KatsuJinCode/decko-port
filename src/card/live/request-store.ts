import type { SQLQueryResult, SQLStatement } from "../../server/driver.js";
import { CARDS_COLUMNS, StoreRowEvaluator, foldNoCase, type CardRow } from "./store-row-evaluator.js";

export const IDENTITY_COLUMNS = ["id", "key", "name", "left_id", "right_id", "type_id", "trash"] as const;

export interface Need {
  keys: string[];
  ids: number[];
  lefts: number[];
  sideLeftKeys?: string[];
  full: boolean;
  pairs?: [number, number][];
  sideRightKeys?: string[];
}

export interface Missing {
  keys: string[];
  ids: number[];
  lefts: number[];
  leftKeys: string[];
  fullIds: number[];
  full: boolean;
  pairs: [number, number][];
  sideL: string[];
  sideR: string[];
}

const norm = (sql: string) => sql.replace(/\s+/g, " ").trim();

export const MAX_COMPOUND_TERMS = 5;

export function unionCtes(name: string, parts: readonly string[], columns = "id"): string[] {
  if (parts.length <= MAX_COMPOUND_TERMS) return [`${name}(${columns}) AS (${parts.join(" UNION ")})`];
  const groups: string[] = [];
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += MAX_COMPOUND_TERMS) {
    const sub = `${name}_${groups.length}`;
    out.push(...unionCtes(sub, parts.slice(i, i + MAX_COMPOUND_TERMS), columns));
    groups.push(`SELECT ${columns} FROM ${sub}`);
  }
  if (groups.length <= MAX_COMPOUND_TERMS) {
    out.push(`${name}(${columns}) AS (${groups.join(" UNION ")})`);
  } else {
    out.push(...unionCtes(`${name}_g`, groups, columns));
    out.push(`${name}(${columns}) AS (SELECT ${columns} FROM ${name}_g)`);
  }
  return out;
}

export function needsOf(sql: string, params: readonly unknown[]): Need | undefined {
  const s = norm(sql);
  const p = params as (string | number)[];
  const keys = (xs: readonly unknown[]) => xs.map((x) => foldNoCase(String(x)));
  const ids = (xs: readonly unknown[]) => xs.map((x) => Number(x));
  switch (s) {
    case "SELECT * FROM cards WHERE key = ? AND trash = 0 LIMIT 1":
      return { keys: keys([p[0]]), ids: [], lefts: [], full: true };
    case "SELECT id FROM cards WHERE key = ? AND trash = 0 LIMIT 1":
      return { keys: keys([p[0]]), ids: [], lefts: [], full: false };
    case "SELECT * FROM cards WHERE id = ? AND trash = 0 LIMIT 1":
    case "SELECT * FROM cards WHERE id = ? AND trash = 0":
      return { keys: [], ids: ids([p[0]]), lefts: [], full: true };
    case "SELECT name, left_id, right_id FROM cards WHERE id = ? LIMIT 1":
      return { keys: [], ids: ids([p[0]]), lefts: [], full: false };
    case "SELECT id FROM cards WHERE left_id = ? AND right_id = ? AND trash = 0 LIMIT 1":
      return { keys: [], ids: [], lefts: ids([p[0]]), full: false };
  }
  if (/^SELECT j\.\* FROM cards j WHERE j\.trash = 0 AND \(\(j\.left_id = \? AND j\.right_id = \?\)( OR \(j\.left_id = \? AND j\.right_id = \?\))*\)$/.test(s)) {
    const pairs: [number, number][] = [];
    for (let i = 0; i + 1 < p.length; i += 2) pairs.push([Number(p[i]), Number(p[i + 1])]);
    return { keys: [], ids: [], lefts: ids(p.filter((_, i) => i % 2 === 0)), full: true, pairs };
  }
  const keyIn = s.match(/^SELECT (\*|id, key) FROM cards WHERE ("key" COLLATE NOCASE|key COLLATE NOCASE|key) IN \((\?(, ?)?)+\) AND trash = 0$/);
  if (keyIn) {
    return { keys: keys(p), ids: [], lefts: [], full: keyIn[1] === "*" };
  }
  if (/^SELECT (\*|id, db_content) FROM cards WHERE id IN \((\?(, ?)?)+\)( AND trash = 0)?$/.test(s)) {
    return { keys: [], ids: ids(p), lefts: [], full: true };
  }
  const m = s.match(
    /^SELECT DISTINCT j\.\* FROM cards j JOIN cards l ON l\.id = j\.left_id AND l\."key" COLLATE NOCASE IN \(([?, ]+)\) JOIN cards r ON r\.id = j\.right_id AND r\."key" COLLATE NOCASE IN \(([?, ]+)\) WHERE j\.trash = 0$/,
  );
  if (m) {
    const nl = (m[1]!.match(/\?/g) ?? []).length;
    return { keys: keys(p), ids: [], lefts: [], sideLeftKeys: keys(p.slice(0, nl)), sideRightKeys: keys(p.slice(nl)), full: true };
  }
  return undefined;
}

export interface Widening {
  fullKeys: string[];
  idKeys: string[];
  fullIds: number[];
  idIds: number[];
  lefts: number[];
  leftKeys: string[];
  pairs: [number, number][];
  sideL: string[];
  sideR: string[];
  ruleSets?: [number, string][];
  tprSets?: [number, number][];
  wholeLefts?: number[];
  wholeLeftKeys?: string[];
}

export class RequestStore {
  private readonly rows = new StoreRowEvaluator();
  readonly keyKnown = new Set<string>();
  readonly idKnown = new Set<number>();
  readonly leftComplete = new Set<number>();
  readonly expanded = new Set<number>();
  readonly contentExpanded = new Set<number>();
  readonly present = new Set<number>();
  readonly full = new Set<number>();
  rowsFetched = 0;
  private readonly answerMemo = new Map<string, CardRow[]>();

  retainedPayload(): unknown { return { ...this, rows: this.rows.retainedPayload() }; }

  releaseWitnesses(): void {
    this.rows.clear();
    for (const set of [this.keyKnown, this.idKnown, this.leftComplete, this.expanded,
      this.contentExpanded, this.present, this.full]) set.clear();
    this.rowsFetched = 0;
  }

  close(): void {
    this.answerMemo.clear();
  }

  addRow(r: Record<string, unknown>, isFull: boolean): boolean {
    const id = Number(r.id);
    if (this.present.has(id)) {
      if (!isFull || this.full.has(id)) return false;
      this.rows.replace(r);
      this.full.add(id);
      return true;
    }
    if (!this.rows.seat(r)) return false;
    this.present.add(id);
    this.idKnown.add(id);
    if (isFull) this.full.add(id);
    if (typeof r.key === "string") this.keyKnown.add(foldNoCase(r.key));
    this.rowsFetched += 1;
    return true;
  }

  rowById(id: number): CardRow | undefined {
    if (!this.present.has(id)) return undefined;
    return this.rows.evaluate("SELECT * FROM cards WHERE id = ?", [id])?.[0];
  }

  idForKey(key: string): number | undefined {
    const r = this.rows.evaluate(`SELECT id FROM cards WHERE "key" COLLATE NOCASE = ?`, [key])?.[0];
    return r === undefined ? undefined : Number(r.id);
  }

  partialAnswer(sql: string, params: readonly unknown[]): Record<string, unknown>[] {
    const ps = params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
    let rows: Record<string, unknown>[] | undefined;
    try {
      rows = this.rows.evaluate(sql, ps) as Record<string, unknown>[] | undefined;
    } catch {
      return [];
    }
    if (rows === undefined) return [];
    const out: Record<string, unknown>[] = [];
    for (const r of rows) {
      if (r.id === null || r.id === undefined) return [];
      if (this.full.has(Number(r.id))) out.push({ ...r });
    }
    return out;
  }

  missing(sql: string, params: readonly unknown[]): Missing | undefined {
    const need = needsOf(sql, params);
    if (need === undefined) return undefined;
    const keys = need.keys.filter((k) => !this.keyKnown.has(k));
    const ids = need.ids.filter((i) => !this.idKnown.has(i));
    const lefts = need.lefts.filter((l) => !this.leftComplete.has(l));
    const leftKeys: string[] = [];
    if (need.sideLeftKeys) {
      for (const k of need.sideLeftKeys) {
        if (!this.keyKnown.has(k)) {
          leftKeys.push(k);
          continue;
        }
        const id = this.idForKey(k);
        if (id !== undefined && !this.leftComplete.has(id)) lefts.push(id);
      }
    }
    const fullIds: number[] = [];
    if (need.full && keys.length + ids.length + lefts.length + leftKeys.length === 0) {
      const ps = params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
      for (const r of this.rows.evaluate(sql, ps) ?? []) {
        const id = Number(r.id);
        if (!this.full.has(id)) fullIds.push(id);
      }
    }
    const pairs = need.pairs === undefined ? [] : need.pairs.filter(([l]) => !this.leftComplete.has(l));
    const sideOpen = keys.length + lefts.length + leftKeys.length > 0;
    const sideL = sideOpen ? (need.sideLeftKeys ?? []) : [];
    const sideR = sideOpen ? (need.sideRightKeys ?? []) : [];
    return { keys, ids, lefts, leftKeys, fullIds, full: need.full, pairs, sideL, sideR };
  }

  certifiedAnswer(sql: string, params: readonly unknown[]): SQLQueryResult | undefined {
    if (this.answerMemo.size === 0) return undefined;
    const memo = this.answerMemo.get(memoKeyOf(sql, params));
    return memo === undefined ? undefined : { rows: memo.map((r) => ({ ...r })), rowsAffected: 0 };
  }

  answer(sql: string, params: readonly unknown[]): SQLQueryResult {
    const ps = params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
    const mk = memoKeyOf(sql, params);
    const memo = this.answerMemo.get(mk);
    if (memo !== undefined) return { rows: memo.map((r) => ({ ...r })), rowsAffected: 0 };
    const rows = this.rows.evaluate(sql, ps);
    if (rows === undefined) throw new Error(`request store: no local evaluator for a certified shape: ${norm(sql).slice(0, 120)}`);
    this.answerMemo.set(mk, rows.map((r) => ({ ...r })));
    return { rows: rows.map((r) => ({ ...r })), rowsAffected: 0 };
  }

  wideningStatements(
    w: Widening,
    identityRows = true,
  ): { full: SQLStatement; identity: SQLStatement; identityColumns: readonly string[] } | undefined {
    const total =
      w.fullKeys.length + w.idKeys.length + w.fullIds.length + w.idIds.length + w.lefts.length + w.leftKeys.length + w.pairs.length +
      (w.ruleSets?.length ?? 0) + (w.tprSets?.length ?? 0) + (w.wholeLefts?.length ?? 0) + (w.wholeLeftKeys?.length ?? 0);
    if (total === 0) return undefined;
    const ctes: string[] = [];
    const params: unknown[] = [];
    const lfParts: string[] = ["SELECT id FROM la"];
    ctes.push(`la(id) AS (${w.lefts.length ? "SELECT value FROM json_each(?)" : "SELECT NULL WHERE 0"})`);
    if (w.lefts.length) params.push(JSON.stringify(w.lefts));
    if (w.leftKeys.length) {
      lfParts.push(`SELECT id FROM cards WHERE "key" COLLATE NOCASE IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(w.leftKeys));
    }
    ctes.push(`lf(id) AS (${lfParts.join(" UNION ")})`);
    const fullParts: string[] = ["SELECT NULL WHERE 0"];
    if (w.fullKeys.length) {
      fullParts.push(`SELECT id FROM cards WHERE "key" COLLATE NOCASE IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(w.fullKeys));
    }
    if (w.fullIds.length) {
      fullParts.push(`SELECT id FROM cards WHERE id IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(w.fullIds));
    }
    if (w.pairs.length) {
      fullParts.push(
        `SELECT c.id FROM json_each(?) p JOIN cards c ON c.left_id = json_extract(p.value, '$[0]') AND c.right_id = json_extract(p.value, '$[1]')`,
      );
      params.push(JSON.stringify(w.pairs));
    }
    if (w.sideL.length && w.sideR.length) {
      fullParts.push(
        `SELECT j.id FROM cards j JOIN cards l ON l.id = j.left_id AND l."key" COLLATE NOCASE IN (SELECT value FROM json_each(?)) ` +
          `JOIN cards r ON r.id = j.right_id AND r."key" COLLATE NOCASE IN (SELECT value FROM json_each(?))`,
      );
      params.push(JSON.stringify(w.sideL), JSON.stringify(w.sideR));
    }
    if (w.wholeLefts?.length) {
      fullParts.push(`SELECT id FROM cards WHERE left_id IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(w.wholeLefts));
    }
    if (w.wholeLeftKeys?.length) {
      const anchors = `SELECT id FROM cards WHERE "key" COLLATE NOCASE IN (SELECT value FROM json_each(?))`;
      fullParts.push(anchors, `SELECT id FROM cards WHERE left_id IN (${anchors})`);
      fullParts.push(
        `SELECT l.id FROM cards r JOIN cards s ON s.id = r.right_id AND s.codename = 'layout' ` +
          `JOIN cards l ON l.name = trim(replace(replace(r.db_content, '[[', ''), ']]', '')) ` +
          `WHERE r.left_id IN (${anchors}) AND l.left_id IS NULL`,
      );
      const k = JSON.stringify(w.wholeLeftKeys);
      params.push(k, k, k);
    }
    if (w.ruleSets?.length || w.tprSets?.length) {
      const setParts: string[] = [];
      const setParams: string[] = [];
      if (w.ruleSets?.length) {
        setParts.push(
          `SELECT s.id FROM json_each(?) p JOIN cards s ON s.left_id = json_extract(p.value, '$[0]') ` +
            `JOIN cards sr ON sr.id = s.right_id AND sr.codename = json_extract(p.value, '$[1]')`,
        );
        setParams.push(JSON.stringify(w.ruleSets));
      }
      if (w.tprSets?.length) {
        setParts.push(
          `SELECT s.id FROM json_each(?) p JOIN cards m ON m.left_id = json_extract(p.value, '$[0]') AND m.right_id = json_extract(p.value, '$[1]') ` +
            `JOIN cards s ON s.left_id = m.id JOIN cards sr ON sr.id = s.right_id AND sr.codename = 'type_plus_right'`,
        );
        setParams.push(JSON.stringify(w.tprSets));
      }
      const sets = setParts.join(" UNION ");
      const RULES = `('structure','default','content_options')`;
      const ruleOf = `SELECT c.id FROM cards c JOIN cards cr ON cr.id = c.right_id AND cr.codename IN ${RULES} WHERE c.left_id IN (${sets})`;
      const selfMode = (typeof process !== "undefined" ? process.env?.DECKO_LIVE_RULE_SETS_SELF : undefined) ?? "all";
      const setCards =
        selfMode === "all"
          ? sets
          : `SELECT s.id FROM cards s JOIN cards sr ON sr.id = s.right_id WHERE s.id IN (${sets}) AND (sr.codename <> 'self' OR s.id IN (SELECT left_id FROM cards WHERE id IN (${ruleOf})))`;
      if (selfMode === "all") fullParts.push(...setParts, ruleOf);
      else fullParts.push(setCards, ruleOf);
      if (selfMode === "all") params.push(...setParams, ...setParams);
      else params.push(...setParams, ...setParams, ...setParams);
    }
    ctes.push(...unionCtes("fs", fullParts));
    const parts: string[] = [
      "SELECT id FROM fs",
      "SELECT id FROM lf",
      "SELECT id FROM cards WHERE left_id IN (SELECT id FROM lf)",
      "SELECT c.id FROM cards c JOIN cards p ON c.left_id = p.id WHERE p.left_id IN (SELECT id FROM lf)",
    ];
    if (w.idKeys.length) {
      parts.push(`SELECT id FROM cards WHERE "key" COLLATE NOCASE IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(w.idKeys));
    }
    if (w.idIds.length) {
      parts.push(`SELECT id FROM cards WHERE id IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(w.idIds));
    }
    ctes.push(...unionCtes("seed", parts));
    ctes.push(
      `pt(id) AS (SELECT type_id FROM cards WHERE id IN (SELECT id FROM fs) ` +
        `UNION SELECT left_id FROM cards WHERE id IN (SELECT id FROM fs) AND left_id IS NOT NULL ` +
        `UNION SELECT right_id FROM cards WHERE id IN (SELECT id FROM fs) AND right_id IS NOT NULL)`,
    );
    ctes.push(
      `ext(id) AS (SELECT id FROM seed ` +
        `UNION SELECT type_id FROM cards WHERE id IN (SELECT id FROM seed) ` +
        `UNION SELECT left_id FROM cards WHERE id IN (SELECT id FROM seed) AND left_id IS NOT NULL ` +
        `UNION SELECT right_id FROM cards WHERE id IN (SELECT id FROM seed) AND right_id IS NOT NULL)`,
    );
    const starMode = typeof process !== "undefined" ? process.env?.DECKO_LIVE_STAR_FULL : undefined;
    const SETS = `('self','type','right','type_plus_right','all_plus','rstar','star','ltype_rtype')`;
    ctes.push(
      starMode === "1"
        ? `star(id) AS (SELECT c.id FROM cards c JOIN cards r ON r.id = c.right_id WHERE c.id IN (SELECT id FROM ext) AND r."key" LIKE '*%')`
        : starMode === "2"
          ? `star(id) AS (SELECT c.id FROM cards c JOIN cards r ON r.id = c.right_id WHERE c.id IN (SELECT id FROM ext) AND r.codename IN ${SETS})`
          : starMode === "3"
            ? `star(id) AS (SELECT c.id FROM cards c JOIN cards r ON r.id = c.right_id WHERE c.id IN (SELECT id FROM ext) AND r.codename IN ${SETS} ` +
              `UNION SELECT c.id FROM cards c JOIN cards s ON s.id = c.left_id JOIN cards sr ON sr.id = s.right_id JOIN cards r ON r.id = c.right_id ` +
              `WHERE c.id IN (SELECT id FROM ext) AND sr.codename IN ${SETS} AND r."key" LIKE '*%')`
            : `star(id) AS (SELECT NULL WHERE 0)`,
    );
    const head = `WITH ${ctes.join(", ")} `;
    const fullCols = CARDS_COLUMNS.map((c) => `cards.${c}`).join(", ");
    const identityColumns: readonly string[] = identityRows ? IDENTITY_COLUMNS : CARDS_COLUMNS;
    const idCols = identityColumns.map((c) => `cards.${c}`).join(", ");
    return {
      full: {
        sql:
          `${head}SELECT ${fullCols} FROM cards WHERE (id IN (SELECT id FROM fs) OR id IN (SELECT id FROM pt) OR id IN (SELECT id FROM star)) ` +
          `AND id NOT IN (SELECT value FROM json_each(?))`,
        params: [...params, JSON.stringify([...this.full])],
      },
      identity: {
        sql:
          `${head}SELECT ${idCols} FROM cards WHERE id IN (SELECT id FROM ext) ` +
          `AND id NOT IN (SELECT id FROM fs) AND id NOT IN (SELECT id FROM pt) AND id NOT IN (SELECT id FROM star) AND id NOT IN (SELECT value FROM json_each(?))`,
        params: [...params, JSON.stringify([...this.present])],
      },
      identityColumns,
    };
  }

  absorb(
    w: Widening,
    fullRows: Record<string, unknown>[],
    identityRows: Record<string, unknown>[],
    identityRowsAreFull = false,
  ): Record<string, unknown>[] {
    const fresh: Record<string, unknown>[] = [];
    for (const r of fullRows) if (this.addRow(r, true)) fresh.push(r);
    for (const r of identityRows) if (this.addRow(r, identityRowsAreFull)) fresh.push(r);
    for (const k of w.fullKeys) this.keyKnown.add(k);
    for (const k of w.idKeys) this.keyKnown.add(k);
    for (const k of w.leftKeys) this.keyKnown.add(k);
    for (const i of w.fullIds) this.idKnown.add(i);
    for (const i of w.idIds) this.idKnown.add(i);
    const leftSet = new Set(w.lefts);
    for (const k of w.leftKeys) {
      const id = this.idForKey(k);
      if (id !== undefined) leftSet.add(id);
    }
    for (const l of leftSet) this.leftComplete.add(l);
    for (const l of leftSet) for (const id of this.rows.idsWithLeft(l)) this.leftComplete.add(id);
    return fresh;
  }

  absorbFull(named: number[], rows: Record<string, unknown>[]): void {
    for (const r of rows) this.addRow(r, true);
    for (const i of named) this.idKnown.add(i);
  }
}

function memoKeyOf(sql: string, params: readonly unknown[]): string {
  const ps = params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
  return `${sql}\u0000${JSON.stringify(ps, (_k, v) => (typeof v === "bigint" ? `${v}n` : v))}`;
}
