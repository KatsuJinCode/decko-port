import type { SQLDatabaseDriver, SQLQueryResult } from "../../server/driver.js";
import type { SQLDateTime } from "../../server/schema.js";
import type { Actor } from "./actor.js";
import { generateSessionToken, sha256Hex, tokensEqual } from "./session-token.js";
import { signinSecurityPolicy } from "./signin-security.js";

export function sqlDateTime(date: Date): SQLDateTime {
  const iso = date.toISOString();
  const seconds = `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
  const ms = date.getUTCMilliseconds();
  return ms === 0 ? seconds : `${seconds}.${String(ms).padStart(3, "0")}000`;
}

export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 48;

export interface SessionStoreOptions {
  driver: SQLDatabaseDriver;
  now?: () => Date;
  defaultTtlSeconds?: number;
  compareTokens?: (presented: string, stored: string) => boolean;
  revocation?: boolean;
}

export interface SessionCreation {
  token: string;
  expiresAt: SQLDateTime;
}

export interface AuthSessionsRow {
  token_hash: string;
  account_card_id: number;
  created_at: SQLDateTime;
  expires_at: SQLDateTime;
}

export class SessionStore {
  private readonly driver: SQLDatabaseDriver;
  private readonly clock: () => Date;
  private readonly defaultTtlSeconds: number;
  private readonly compareTokens: (presented: string, stored: string) => boolean;
  private readonly revocation: boolean | undefined;

  constructor(options: SessionStoreOptions) {
    this.driver = options.driver;
    this.clock = options.now ?? (() => new Date());
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    this.compareTokens = options.compareTokens ?? tokensEqual;
    this.revocation = options.revocation;
  }

  get storageDriver(): SQLDatabaseDriver {
    return this.driver;
  }

  async createSession(
    accountCardId: number,
    opts?: { ttlSeconds?: number },
  ): Promise<SessionCreation> {
    const token = generateSessionToken();
    const now = this.clock();
    const ttlSeconds = opts?.ttlSeconds ?? this.defaultTtlSeconds;
    const expiresAt = sqlDateTime(new Date(now.getTime() + ttlSeconds * 1000));
    const tokenHash = await sha256Hex(token);
    const result = await this.driver.query(
      `INSERT INTO auth_sessions (token_hash, account_card_id, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
      [tokenHash, accountCardId, sqlDateTime(now), expiresAt],
    );
    if (result.rowsAffected !== 1) {
      throw new Error(
        `SessionStore: session row not inserted for account card ${accountCardId} ` +
          `(rowsAffected=${result.rowsAffected})`,
      );
    }
    return { token, expiresAt };
  }

  async lookupSession(token: string): Promise<Actor | null> {
    const tokenHash = await sha256Hex(token);
    const checkRevocation = Boolean(this.revocation ?? signinSecurityPolicy().sessionRevocation);
    const sessionSql = `SELECT s.token_hash, s.account_card_id, s.expires_at, s.created_at, c.name
       FROM auth_sessions s JOIN cards c ON c.id = s.account_card_id AND c.trash = 0
       WHERE s.token_hash = ?
         AND NOT EXISTS (
           SELECT 1 FROM cards a JOIN cards f ON f.id = a.right_id
           WHERE a.left_id = c.id AND f.codename = 'account' AND a.trash <> 0
         )`;
    const revocationSql = `SELECT f.codename AS field, c.db_content, c.updated_at
       FROM auth_sessions s
       JOIN cards a ON a.left_id = s.account_card_id AND a.trash = 0
       JOIN cards c ON c.left_id = a.id AND c.trash = 0
       JOIN cards f ON f.id = c.right_id
       WHERE s.token_hash = ?
         AND a.right_id IN (SELECT id FROM cards WHERE codename = 'account' AND trash = 0)
         AND f.codename IN ('status', 'password')`;
    const batchResults = checkRevocation
      ? await this.driver.batch([
          { sql: sessionSql, params: [tokenHash] },
          { sql: revocationSql, params: [tokenHash] },
        ])
      : [await this.driver.query(sessionSql, [tokenHash])];
    const row = (batchResults[0]?.rows[0]) as
      | {
          token_hash: string;
          account_card_id: number;
          expires_at: SQLDateTime;
          created_at: SQLDateTime;
          name: string | null;
        }
      | undefined;
    if (row === undefined) return null;
    if (!this.compareTokens(tokenHash, row.token_hash)) return null;
    if (this.nowString() > row.expires_at) return null;
    if (row.name === null) return null;
    if (checkRevocation) {
      const fields = ((batchResults[1]?.rows ?? []) as Array<{
        field: string;
        db_content: string | null;
        updated_at: string | null;
      }>);
      for (const field of fields) {
        if (field.field === "status" && (field.db_content ?? "") !== "active") return null;
        if (
          field.field === "password" &&
          field.updated_at !== null &&
          String(field.updated_at) > String(row.created_at)
        ) {
          return null;
        }
      }
    }
    return { id: row.account_card_id, name: row.name };
  }

  private async revokedByAccountChange(row: { account_card_id: number; created_at: SQLDateTime }): Promise<boolean> {
    const createdAt = row.created_at;
    const fields = await this.driver.query<{ field: string; db_content: string | null; updated_at: string | null }>(
      `SELECT f.codename AS field, c.db_content, c.updated_at
       FROM cards a
       JOIN cards c ON c.left_id = a.id AND c.trash = 0
       JOIN cards f ON f.id = c.right_id
       WHERE a.left_id = ? AND a.trash = 0
         AND a.right_id IN (SELECT id FROM cards WHERE codename = 'account' AND trash = 0)
         AND f.codename IN ('status', 'password')`,
      [row.account_card_id],
    );
    for (const field of fields.rows) {
      if (field.field === "status" && (field.db_content ?? "") !== "active") return true;
      if (field.field === "password" && field.updated_at !== null && String(field.updated_at) > String(createdAt)) {
        return true;
      }
    }
    return false;
  }

  async resolveActorFromToken(token: string): Promise<Actor | null> {
    return this.lookupSession(token);
  }

  async revokeSession(token: string): Promise<boolean> {
    const tokenHash = await sha256Hex(token);
    const result = await this.driver.query(
      "DELETE FROM auth_sessions WHERE token_hash = ?",
      [tokenHash],
    );
    return result.rowsAffected > 0;
  }

  async ownPasswordUpdatedAt(token: string): Promise<string | null | undefined> {
    const tokenHash = await sha256Hex(token);
    const [session, password] = await this.driver.batch([
      {
        sql: "SELECT account_card_id FROM auth_sessions WHERE token_hash = ?",
        params: [tokenHash],
      },
      {
        sql: `SELECT c.updated_at
       FROM auth_sessions s
       JOIN cards a ON a.left_id = s.account_card_id AND a.trash = 0
       JOIN cards c ON c.left_id = a.id AND c.trash = 0
       JOIN cards f ON f.id = c.right_id
       WHERE s.token_hash = ?
         AND a.right_id IN (SELECT id FROM cards WHERE codename = 'account' AND trash = 0)
         AND f.codename = 'password'`,
        params: [tokenHash],
      },
    ]);
    const accountCardId = (session?.rows[0] as { account_card_id?: number } | undefined)?.account_card_id;
    if (accountCardId === undefined) return undefined;
    return ((password?.rows[0] as { updated_at?: string | null } | undefined)?.updated_at) ?? null;
  }

  async keepSessionAcrossOwnPasswordChange(token: string, before: string | null | undefined): Promise<void> {
    if (before === undefined) return;
    const after = await this.ownPasswordUpdatedAt(token);
    if (after === undefined || after === null || after === before) return;
    const tokenHash = await sha256Hex(token);
    await this.driver.query("UPDATE auth_sessions SET created_at = ? WHERE token_hash = ?", [after, tokenHash]);
  }

  private nowString(): SQLDateTime {
    return sqlDateTime(this.clock());
  }
}

export async function selectAuthSessionsRow(
  driver: SQLDatabaseDriver,
  tokenHash: string,
): Promise<AuthSessionsRow | undefined> {
  const result: SQLQueryResult<AuthSessionsRow> = await driver.query(
    "SELECT token_hash, account_card_id, created_at, expires_at FROM auth_sessions WHERE token_hash = ?",
    [tokenHash],
  );
  return result.rows[0];
}
