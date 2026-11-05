import { DatabaseSync } from "node:sqlite";

export const CARD_TABLES = ["cards", "card_acts", "card_actions", "card_changes", "card_references", "card_virtuals"];

export function snapshot(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
    const state = {};
    for (const table of tables) {
      const rows = db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all();
      const keyed = new Map();
      const hasId = rows.length > 0 ? Object.hasOwn(rows[0], "id") : columnNames(db, table).includes("id");
      for (const row of rows) {
        const copy = Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? { $blob: Buffer.from(v).toString("hex") } : v]),
        );
        if (hasId) {
          keyed.set(`id:${copy.id}`, copy);
        } else {
          const json = JSON.stringify(copy);
          let key = `row:${json}`;
          for (let n = 2; keyed.has(key); n++) key = `row:${json}#${n}`;
          keyed.set(key, copy);
        }
      }
      state[table] = keyed;
    }
    for (const table of CARD_TABLES) state[table] ??= new Map();
    return state;
  } finally {
    db.close();
  }
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all().map((c) => c.name);
}

export function rawDelta(before, after, tables) {
  const names = tables ?? [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const result = {};
  for (const table of names) {
    const b = before[table] ?? new Map();
    const a = after[table] ?? new Map();
    const inserted = [];
    const updated = [];
    const deleted = [];
    for (const [key, row] of a) {
      const old = b.get(key);
      if (!old) {
        inserted.push(row);
        continue;
      }
      const changes = {};
      for (const col of new Set([...Object.keys(old), ...Object.keys(row)])) {
        if (!sameValue(old[col], row[col])) changes[col] = [old[col] ?? null, row[col] ?? null];
      }
      if (Object.keys(changes).length > 0) updated.push({ id: row.id, changes });
    }
    for (const [key, row] of b) if (!a.has(key)) deleted.push(row);
    if (inserted.length || updated.length || deleted.length) result[table] = { inserted, updated, deleted };
  }
  return result;
}

function sameValue(x, y) {
  if (x === y) return true;
  if (x !== null && y !== null && typeof x === "object" && typeof y === "object") return x.$blob === y.$blob;
  return false;
}

export function splitDelta(full) {
  const rows = {};
  const other = {};
  for (const [table, d] of Object.entries(full)) (CARD_TABLES.includes(table) ? rows : other)[table] = d;
  return { rows, other };
}

const FOREIGN = {
  cards: { left_id: "cards", right_id: "cards", type_id: "cards", creator_id: "cards", updater_id: "cards",
    read_rule_id: "cards", current_revision_id: "card_actions" },
  card_acts: { card_id: "cards", actor_id: "cards" },
  card_actions: { card_id: "cards", card_act_id: "card_acts", super_action_id: "card_actions" },
  card_changes: { card_action_id: "card_actions" },
  card_references: { referer_id: "cards", referee_id: "cards" },
  card_virtuals: { left_id: "cards", right_id: "cards" },
};
const TIME_COLUMNS = new Set(["created_at", "updated_at", "acted_at"]);

const byNumericId = (table) => new Map([...(table ?? new Map()).values()].map((row) => [Number(row.id), row]));

function composedName(cards, id, seen = new Set()) {
  const row = cards.get(id);
  if (!row || seen.has(id)) return undefined;
  seen.add(id);
  if (row.left_id === null || row.left_id === undefined) return row.name ?? undefined;
  const l = composedName(cards, Number(row.left_id), seen);
  const r = composedName(cards, Number(row.right_id), seen);
  return l === undefined || r === undefined ? undefined : `${l}+${r}`;
}

function canonicalTime(value) {
  if (value === null || value === undefined) return value;
  const s = String(value);
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s) ? new Date(s.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z")) : null;
  return iso && !Number.isNaN(iso.getTime()) ? iso.toISOString() : s;
}

export function delta(beforeSnapshot, afterSnapshot) {
  const before = Object.fromEntries(CARD_TABLES.map((t) => [t, byNumericId(beforeSnapshot[t])]));
  const after = Object.fromEntries(CARD_TABLES.map((t) => [t, byNumericId(afterSnapshot[t])]));
  const symbols = {};
  for (const table of CARD_TABLES) {
    const fresh = [...after[table].keys()].filter((id) => !before[table].has(id)).sort((a, b) => a - b);
    const map = new Map();
    fresh.forEach((id, i) => {
      if (table === "cards") {
        const name = composedName(after.cards, id);
        map.set(id, `new card ${name ?? `#${i + 1}`}`);
      } else {
        map.set(id, `new ${table} #${i + 1}`);
      }
    });
    symbols[table] = map;
  }
  const norm = (table, row) => {
    const out = {};
    for (const [col, value] of Object.entries(row)) {
      if (col === "id") {
        out.id = symbols[table].get(Number(value)) ?? value;
        continue;
      }
      const target = FOREIGN[table]?.[col];
      if (target && value !== null && value !== undefined) out[col] = symbols[target].get(Number(value)) ?? value;
      else if (TIME_COLUMNS.has(col)) out[col] = canonicalTime(value);
      else out[col] = value;
    }
    return out;
  };
  const result = {};
  for (const table of CARD_TABLES) {
    const inserted = [];
    const deleted = [];
    const updated = [];
    for (const [id, row] of after[table]) {
      const old = before[table].get(id);
      if (!old) {
        inserted.push(norm(table, row));
        continue;
      }
      const changes = {};
      const was = norm(table, old);
      const now = norm(table, row);
      for (const col of Object.keys(row)) {
        if (String(was[col]) !== String(now[col])) changes[col] = [was[col], now[col]];
      }
      if (Object.keys(changes).length > 0) updated.push({ id, changes });
    }
    for (const [id, row] of before[table]) if (!after[table].has(id)) deleted.push(norm(table, row));
    if (inserted.length || deleted.length || updated.length) result[table] = { inserted, updated, deleted };
  }
  return result;
}
