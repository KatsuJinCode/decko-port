export const CARDS_COLUMNS = [
  "id",
  "name",
  "key",
  "codename",
  "left_id",
  "right_id",
  "current_revision_id",
  "created_at",
  "updated_at",
  "creator_id",
  "updater_id",
  "read_rule_class",
  "read_rule_id",
  "references_expired",
  "trash",
  "type_id",
  "db_content",
] as const;

export type CardRow = Record<string, unknown>;

export function foldNoCase(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s[i];
  }
  return out;
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return sqlNumberToText(v);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Uint8Array) return null;
  return String(v);
}

function sqlNumberToText(n: number): string {
  return Number.isInteger(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n.toString() : String(n);
}

function asNumeric(v: unknown): number | string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^[+-]?\d+$/.test(t)) {
      const n = Number(t);
      if (Number.isSafeInteger(n)) return n;
    }
    return v;
  }
  return null;
}

function intEquals(columnValue: unknown, param: unknown): boolean {
  const c = asNumeric(columnValue);
  const p = asNumeric(param);
  if (c === null || p === null) return false;
  if (typeof c === "number" && typeof p === "number") return c === p;
  return false;
}

function textEquals(columnValue: unknown, param: unknown, nocase: boolean): boolean {
  const c = asText(columnValue);
  const p = asText(param);
  if (c === null || p === null) return false;
  return nocase ? foldNoCase(c) === foldNoCase(p) : c === p;
}

const UTF8 = new TextEncoder();
function binaryCompare(a: string, b: string): number {
  if (a === b) return 0;
  const x = UTF8.encode(a);
  const y = UTF8.encode(b);
  const n = x.length < y.length ? x.length : y.length;
  for (let i = 0; i < n; i++) {
    const d = x[i]! - y[i]!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

const norm = (sql: string) => sql.replace(/\s+/g, " ").trim();

export type ShapeId =
  | "S1-key-eq-star"
  | "S2-key-eq-id"
  | "S3-id-eq-star-limit"
  | "S4-id-eq-star"
  | "S5-id-eq-trio"
  | "S6-pair-eq-id"
  | "S7-pair-or-chain"
  | "S8-key-in"
  | "S9-id-in"
  | "S10-sidekey-join"
  | "X-row-by-id"
  | "X-row-by-pair"
  | "X-id-for-key"
  | "UNRECOGNIZED";

export interface Classified {
  shape: ShapeId;
  leftIds?: number[];
  rightIds?: number[];
  leftParamCount?: number;
  nocase?: boolean;
  trashFiltered?: boolean;
  columns: readonly string[] | null;
  arms?: number;
}

const TRIO = ["name", "left_id", "right_id"] as const;
const ID_KEY = ["id", "key"] as const;
const ID_CONTENT = ["id", "db_content"] as const;
const ID_ONLY = ["id"] as const;
const STAR = null;

export function classifyShape(sql: string): Classified {
  const s = norm(sql);
  switch (s) {
    case "SELECT * FROM cards WHERE key = ? AND trash = 0 LIMIT 1":
      return { shape: "S1-key-eq-star", columns: STAR, trashFiltered: true };
    case "SELECT id FROM cards WHERE key = ? AND trash = 0 LIMIT 1":
      return { shape: "S2-key-eq-id", columns: ID_ONLY, trashFiltered: true };
    case "SELECT * FROM cards WHERE id = ? AND trash = 0 LIMIT 1":
      return { shape: "S3-id-eq-star-limit", columns: STAR, trashFiltered: true };
    case "SELECT * FROM cards WHERE id = ? AND trash = 0":
      return { shape: "S4-id-eq-star", columns: STAR, trashFiltered: true };
    case "SELECT name, left_id, right_id FROM cards WHERE id = ? LIMIT 1":
      return { shape: "S5-id-eq-trio", columns: TRIO, trashFiltered: false };
    case "SELECT id FROM cards WHERE left_id = ? AND right_id = ? AND trash = 0 LIMIT 1":
      return { shape: "S6-pair-eq-id", columns: ID_ONLY, trashFiltered: true };
  }
  if (
    /^SELECT j\.\* FROM cards j WHERE j\.trash = 0 AND \(\(j\.left_id = \? AND j\.right_id = \?\)( OR \(j\.left_id = \? AND j\.right_id = \?\))*\)$/.test(
      s,
    )
  ) {
    const arms = (s.match(/\(j\.left_id = \?/g) ?? []).length;
    return { shape: "S7-pair-or-chain", columns: STAR, trashFiltered: true, arms };
  }
  if (
    /^SELECT (\*|id, key) FROM cards WHERE ("key" COLLATE NOCASE|key COLLATE NOCASE|key) IN \((\?(, ?)?)+\) AND trash = 0$/.test(
      s,
    )
  ) {
    return {
      shape: "S8-key-in",
      columns: /SELECT \*/.test(s) ? STAR : ID_KEY,
      trashFiltered: true,
      nocase: /COLLATE NOCASE/.test(s),
    };
  }
  if (/^SELECT (\*|id, db_content) FROM cards WHERE id IN \((\?(, ?)?)+\)( AND trash = 0)?$/.test(s)) {
    return {
      shape: "S9-id-in",
      columns: /SELECT \*/.test(s) ? STAR : ID_CONTENT,
      trashFiltered: /AND trash = 0/.test(s),
    };
  }
  const m = s.match(
    /^SELECT DISTINCT j\.\* FROM cards j JOIN cards l ON l\.id = j\.left_id AND l\."key" COLLATE NOCASE IN \(([?, ]+)\) JOIN cards r ON r\.id = j\.right_id AND r\."key" COLLATE NOCASE IN \(([?, ]+)\) WHERE j\.trash = 0$/,
  );
  if (m) {
    const nl = (m[1]?.match(/\?/g) ?? []).length;
    return { shape: "S10-sidekey-join", columns: STAR, trashFiltered: true, leftParamCount: nl };
  }
  if (s === "SELECT * FROM cards WHERE id = ?") {
    return { shape: "X-row-by-id", columns: STAR, trashFiltered: false };
  }
  if (s === "SELECT * FROM cards WHERE left_id = ? AND right_id = ?") {
    return { shape: "X-row-by-pair", columns: STAR, trashFiltered: false };
  }
  if (s === `SELECT id FROM cards WHERE "key" COLLATE NOCASE = ?`) {
    return { shape: "X-id-for-key", columns: ID_ONLY, trashFiltered: false, nocase: true };
  }
  return { shape: "UNRECOGNIZED", columns: STAR, trashFiltered: false };
}

function byRowId(rows: CardRow[]): CardRow[] {
  return rows.sort((a, b) => Number(a.id) - Number(b.id));
}

function project(row: CardRow, columns: readonly string[] | null): CardRow {
  if (columns === null) {
    const out: CardRow = {};
    for (const c of CARDS_COLUMNS) out[c] = row[c] === undefined ? null : row[c];
    return out;
  }
  const out: CardRow = {};
  for (const c of columns) out[c] = row[c] === undefined ? null : row[c];
  return out;
}

export class StoreRowEvaluator {
  private readonly rowsById = new Map<number, CardRow>();
  private readonly idByKeyBinary = new Map<string, number>();
  private readonly idByKeyNoCase = new Map<string, number>();
  private readonly idsByLeft = new Map<number, number[]>();
  private readonly idByPair = new Map<number, Map<number, number>>();

  rowsSeated = 0;

  retainedPayload(): unknown { return { ...this }; }

  clear(): void {
    for (const index of [this.rowsById, this.idByKeyBinary, this.idByKeyNoCase, this.idsByLeft, this.idByPair]) index.clear();
    this.rowsSeated = 0;
  }

  seat(raw: CardRow): boolean {
    const id = asNumeric(raw.id);
    if (typeof id !== "number" || !Number.isSafeInteger(id)) return false;
    if (this.rowsById.has(id)) return false;
    const row: CardRow = {};
    for (const c of CARDS_COLUMNS) row[c] = raw[c] === undefined ? null : raw[c];
    this.rowsById.set(id, row);
    const key = asText(row.key);
    if (key !== null) {
      this.idByKeyBinary.set(key, id);
      this.idByKeyNoCase.set(foldNoCase(key), id);
    }
    const left = asNumeric(row.left_id);
    if (typeof left === "number") {
      let ids = this.idsByLeft.get(left);
      if (ids === undefined) {
        ids = [];
        this.idsByLeft.set(left, ids);
      }
      ids.push(id);
      ids.sort((a, b) => a - b);
      const right = asNumeric(row.right_id);
      if (typeof right === "number") {
        let m = this.idByPair.get(left);
        if (m === undefined) {
          m = new Map<number, number>();
          this.idByPair.set(left, m);
        }
        m.set(right, id);
      }
    }
    this.rowsSeated += 1;
    return true;
  }

  replace(raw: CardRow): void {
    const id = asNumeric(raw.id);
    if (typeof id !== "number" || !this.rowsById.has(id)) return;
    const row: CardRow = {};
    for (const c of CARDS_COLUMNS) row[c] = raw[c] === undefined ? null : raw[c];
    this.rowsById.set(id, row);
  }

  idsWithLeft(left: number): readonly number[] {
    return this.idsByLeft.get(left) ?? [];
  }

  get size(): number {
    return this.rowsById.size;
  }

  evaluate(sql: string, params: readonly unknown[]): CardRow[] | undefined {
    const c = classifyShape(sql);
    switch (c.shape) {
      case "S1-key-eq-star":
      case "S2-key-eq-id": {
        const id = this.lookupKey(params[0], c.nocase === true);
        if (id === undefined) return [];
        const row = this.rowsById.get(id);
        if (row === undefined) return [];
        if (c.trashFiltered === true && !intEquals(row.trash, 0)) return [];
        return [project(row, c.columns)];
      }
      case "S3-id-eq-star-limit":
      case "S4-id-eq-star":
      case "S5-id-eq-trio":
      case "X-row-by-id": {
        const id = asNumeric(params[0]);
        if (typeof id !== "number") return [];
        const row = this.rowsById.get(id);
        if (row === undefined) return [];
        if (c.trashFiltered === true && !intEquals(row.trash, 0)) return [];
        return [project(row, c.columns)];
      }
      case "S6-pair-eq-id":
      case "X-row-by-pair": {
        const left = asNumeric(params[0]);
        const right = asNumeric(params[1]);
        if (typeof left !== "number" || typeof right !== "number") return [];
        const id = this.idByPair.get(left)?.get(right);
        if (id === undefined) return [];
        const row = this.rowsById.get(id);
        if (row === undefined) return [];
        if (c.trashFiltered === true && !intEquals(row.trash, 0)) return [];
        return [project(row, c.columns)];
      }
      case "X-id-for-key": {
        const id = this.lookupKey(params[0], true);
        if (id === undefined) return [];
        return [{ id }];
      }
      case "S7-pair-or-chain": {
        const out: CardRow[] = [];
        const seen = new Set<number>();
        for (let i = 0; i + 1 < params.length; i += 2) {
          const left = asNumeric(params[i]);
          const right = asNumeric(params[i + 1]);
          if (typeof left !== "number" || typeof right !== "number") continue;
          const id = this.idByPair.get(left)?.get(right);
          if (id === undefined || seen.has(id)) continue;
          seen.add(id);
          const row = this.rowsById.get(id);
          if (row === undefined) continue;
          if (!intEquals(row.trash, 0)) continue;
          out.push(project(row, c.columns));
        }
        return c.arms === 2 ? out : byRowId(out);
      }
      case "S8-key-in": {
        const out: CardRow[] = [];
        const seen = new Set<number>();
        for (const p of params) {
          const id = this.lookupKey(p, c.nocase === true);
          if (id === undefined || seen.has(id)) continue;
          seen.add(id);
          const row = this.rowsById.get(id);
          if (row === undefined) continue;
          if (!intEquals(row.trash, 0)) continue;
          out.push(project(row, c.columns));
        }
        if (c.nocase !== true && params.length === 2) {
          out.sort((a, b) => binaryCompare(asText(a.key) ?? "", asText(b.key) ?? ""));
          return out;
        }
        return byRowId(out);
      }
      case "S9-id-in": {
        const out: CardRow[] = [];
        const seen = new Set<number>();
        for (const p of params) {
          const id = asNumeric(p);
          if (typeof id !== "number" || !Number.isSafeInteger(id) || seen.has(id)) continue;
          seen.add(id);
          const row = this.rowsById.get(id);
          if (row === undefined) continue;
          if (c.trashFiltered === true && !intEquals(row.trash, 0)) continue;
          out.push(project(row, c.columns));
        }
        return byRowId(out);
      }
      case "S10-sidekey-join": {
        const n = c.leftParamCount ?? 0;
        const leftIds = new Set<number>();
        const rightIds = new Set<number>();
        for (let i = 0; i < params.length; i++) {
          const id = this.lookupKey(params[i], true);
          if (id === undefined) continue;
          if (i < n) leftIds.add(id);
          else rightIds.add(id);
        }
        const out: CardRow[] = [];
        for (const leftId of leftIds) {
          for (const rowId of this.idsByLeft.get(leftId) ?? []) {
            const row = this.rowsById.get(rowId);
            if (row === undefined) continue;
            if (!intEquals(row.trash, 0)) continue;
            const right = asNumeric(row.right_id);
            if (typeof right !== "number" || !rightIds.has(right)) continue;
            out.push(project(row, c.columns));
          }
        }
        return byRowId(out);
      }
      case "UNRECOGNIZED":
        return undefined;
    }
  }

  private lookupKey(param: unknown, nocase: boolean): number | undefined {
    const map = nocase ? this.idByKeyNoCase : this.idByKeyBinary;
    if (nocase) {
      const k = asText(param);
      return k === null ? undefined : map.get(foldNoCase(k));
    }
    const k = asText(param);
    return k === null ? undefined : map.get(k);
  }
}