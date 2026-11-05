import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const MASKED_PASSWORD_DIGEST = "<password digest>";

const LEGACY_DIGEST = /^[0-9a-f]{40}$/;
const PBKDF2_DIGEST = /^pbkdf2_sha256\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;

export function isPasswordDigest(value) {
  return typeof value === "string" && (LEGACY_DIGEST.test(value) || PBKDF2_DIGEST.test(value));
}

export const KNOWN_DIVERGENCES = ["password-digest"];

export function validateDeclaredDivergences(declared) {
  const bad = 'declaredDivergences must be { "<divergence name>": "why" }';
  if (declared === null || typeof declared !== "object" || Array.isArray(declared)) throw new TypeError(bad);
  for (const [name, why] of Object.entries(declared)) {
    if (!KNOWN_DIVERGENCES.includes(name)) throw new TypeError(`${bad}; unknown divergence "${name}" (known: ${KNOWN_DIVERGENCES.join(", ")})`);
    if (typeof why !== "string" || why.trim() === "") throw new TypeError(`${bad}; the why of "${name}" is not a non-empty string`);
  }
  return declared;
}

export function passwordDigestContext(fixtureDir) {
  const deckPath = path.join(fixtureDir, "deck", "deck.sqlite3");
  const context = { passwordCodeId: undefined, passwordCards: new Set() };
  if (!existsSync(deckPath)) return context;
  const work = mkdtempSync(path.join(os.tmpdir(), "decko-divergence-"));
  const copy = path.join(work, "deck.sqlite3");
  cpSync(deckPath, copy);
  const db = new DatabaseSync(copy);
  try {
    const code = db.prepare("SELECT id FROM cards WHERE codename = 'password'").get();
    if (code === undefined) return context;
    context.passwordCodeId = Number(code.id);
    for (const row of db.prepare("SELECT id FROM cards WHERE right_id = ?").all(context.passwordCodeId)) context.passwordCards.add(Number(row.id));
  } finally {
    db.close();
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  return context;
}

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

export function maskPasswordDigests(delta, context) {
  const masked = [];
  if (delta === undefined || delta === null || typeof delta !== "object") return { delta, masked };
  const out = clone(delta);
  const passwordCards = new Set(context.passwordCards);
  const isPasswordRow = (row) => context.passwordCodeId !== undefined && Number(row?.right_id) === context.passwordCodeId;
  for (const row of out.cards?.inserted ?? []) if (isPasswordRow(row)) passwordCards.add(Number(row.id));

  const maskRows = (table, rows, kind, column, applies) => {
    for (const row of rows ?? []) {
      if (applies(row) && isPasswordDigest(row[column])) {
        row[column] = MASKED_PASSWORD_DIGEST;
        masked.push(`${table}/${kind}/${row.id}/${column}`);
      }
    }
  };
  const maskUpdates = (table, column, applies) => {
    const d = out[table];
    if (!d) return;
    d.updated = (d.updated ?? []).filter((entry) => {
      const change = entry.changes?.[column];
      if (!applies(entry) || !Array.isArray(change) || !isPasswordDigest(change[0]) || !isPasswordDigest(change[1])) return true;
      delete entry.changes[column];
      masked.push(`${table}/updated/${entry.id}/${column}`);
      return Object.keys(entry.changes).length > 0;
    });
  };

  const passwordCard = (row) => isPasswordRow(row) || passwordCards.has(Number(row.id));
  maskRows("cards", out.cards?.inserted, "inserted", "db_content", passwordCard);
  maskRows("cards", out.cards?.deleted, "deleted", "db_content", passwordCard);
  maskUpdates("cards", "db_content", (entry) => passwordCards.has(Number(entry.id)));

  const cards = out.cards;
  if (masked.length > 0 && cards && cards.inserted.length === 0 && cards.updated.length === 0 && cards.deleted.length === 0) delete out.cards;
  return { delta: out, masked };
}
