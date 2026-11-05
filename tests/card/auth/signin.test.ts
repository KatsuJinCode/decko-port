

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authenticateAccount,
  encryptAccountPassword,
  rubyStrip,
  runAuthMigrations,
  SessionStore,
  sha1Hex,
  signinAccount,
  signoutAccount,
} from "../../../src/card/auth/index.js";
import {
  createAuthTestStorage,
  fakeClock,
  insertAccountCard,
  type AuthTestStorage,
} from "./auth-test-storage.js";

const IDS = {
  account: 9001,
  email: 9002,
  password: 9003,
  salt: 9004,
  status: 9005,
} as const;

const HOLDER = { id: 9100, name: "Joe User" };
const JUNCTION_ID = 9101;
const EMAIL = "joe@example.com";
const SALT = "SALT";
const PASSWORD = "secret";

const DIGEST = "3c92dd6f59610052250bc50b6b33f9416e7cac3c";

const TS = "2026-09-20 11:00:00.000";

function insertCodenameCard(
  storage: AuthTestStorage,
  id: number,
  codename: string,
  name: string,
): void {
  storage.exec(
    `INSERT INTO cards
       (id, name, key, codename, left_id, right_id, current_revision_id,
        created_at, updated_at, creator_id, updater_id,
        read_rule_class, read_rule_id, references_expired, trash, type_id, db_content)
     VALUES
       (${id}, '${name}', '${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}',
        '${codename}', NULL, NULL, NULL, '${TS}', '${TS}', 1, 1,
        NULL, NULL, NULL, 0, 1, NULL)`,
  );
}

function insertCompoundCard(
  storage: AuthTestStorage,
  id: number,
  name: string,
  leftId: number,
  rightId: number,
  content: string | null,
): void {
  storage.exec(
    `INSERT INTO cards
       (id, name, key, codename, left_id, right_id, current_revision_id,
        created_at, updated_at, creator_id, updater_id,
        read_rule_class, read_rule_id, references_expired, trash, type_id, db_content)
     VALUES
       (${id}, '${name.replace(/'/g, "''")}', NULL, NULL,
        ${leftId}, ${rightId}, NULL, '${TS}', '${TS}', 1, 1,
        NULL, NULL, NULL, 0, 1, ${content === null ? "NULL" : `'${content.replace(/'/g, "''")}'`})`,
  );
}

async function buildStorage(opts?: {
  status?: string;
  withSalt?: boolean;
  storedDigest?: string;
}): Promise<AuthTestStorage> {
  const storage = createAuthTestStorage();
  await runAuthMigrations(storage.driver);
  insertCodenameCard(storage, IDS.account, "account", "*account");
  insertCodenameCard(storage, IDS.email, "email", "*email");
  insertCodenameCard(storage, IDS.password, "password", "*password");
  insertCodenameCard(storage, IDS.salt, "salt", "*salt");
  insertCodenameCard(storage, IDS.status, "status", "*status");
  insertAccountCard(storage, HOLDER);
  insertCompoundCard(
    storage,
    JUNCTION_ID,
    `${HOLDER.name}+*account`,
    HOLDER.id,
    IDS.account,
    null,
  );
  insertCompoundCard(
    storage,
    9102,
    `${HOLDER.name}+*account+*email`,
    JUNCTION_ID,
    IDS.email,
    EMAIL,
  );
  insertCompoundCard(
    storage,
    9103,
    `${HOLDER.name}+*account+*password`,
    JUNCTION_ID,
    IDS.password,
    opts?.storedDigest ?? DIGEST,
  );
  if (opts?.withSalt !== false) {
    insertCompoundCard(
      storage,
      9104,
      `${HOLDER.name}+*account+*salt`,
      JUNCTION_ID,
      IDS.salt,
      SALT,
    );
  }
  insertCompoundCard(
    storage,
    9105,
    `${HOLDER.name}+*account+*status`,
    JUNCTION_ID,
    IDS.status,
    opts?.status ?? "active",
  );
  return storage;
}

describe("account password verification (Ruby Card::Auth salted SHA-1)", () => {
  it("encryptAccountPassword reproduces Digest::SHA1.hexdigest('salt--password--')", async () => {
    expect(await encryptAccountPassword("secret", "SALT")).toBe(DIGEST);

    expect(createHash("sha1").update("SALT--secret--").digest("hex")).toBe(
      DIGEST,
    );
    expect(await sha1Hex("SALT--secret--")).toBe(DIGEST);
  });

  it("rubyStrip strips exactly Ruby's String#strip set (ASCII whitespace + NUL)", () => {
    expect(rubyStrip(" \t\r\n\f\v\0secret\0\n")).toBe("secret");
    expect(rubyStrip("secret")).toBe("secret");

    expect(rubyStrip("\u00a0x\u00a0")).toBe("\u00a0x\u00a0");
  });
});

describe("authenticateAccount (the :signin event's authenticate half)", () => {
  it("verifies the right password for an active account and returns the holder", async () => {
    const storage = await buildStorage();
    try {
      const result = await authenticateAccount(storage.driver, EMAIL, PASSWORD);
      expect(result).toEqual({
        ok: true,
        account: {
          holder: { id: HOLDER.id, name: HOLDER.name },
          accountId: JUNCTION_ID,
        },
      });
    } finally {
      storage.close();
    }
  });

  it("rejects a wrong password with Ruby's :error_wrong_password message", async () => {
    const storage = await buildStorage();
    try {
      expect(await authenticateAccount(storage.driver, EMAIL, "wrong")).toEqual(
        { ok: false, reason: "wrong_password", message: "Wrong password" },
      );
    } finally {
      storage.close();
    }
  });

  it("rejects an unknown email with Ruby's :error_unknown_email message", async () => {
    const storage = await buildStorage();
    try {
      expect(
        await authenticateAccount(storage.driver, "nobody@example.com", PASSWORD),
      ).toEqual({
        ok: false,
        reason: "unknown_email",
        message: "Unrecognized email.",
      });
    } finally {
      storage.close();
    }
  });

  it("rejects an inactive account with Ruby's :error_not_active message", async () => {
    const storage = await buildStorage({ status: "pending" });
    try {
      expect(await authenticateAccount(storage.driver, EMAIL, PASSWORD)).toEqual(
        {
          ok: false,
          reason: "not_active",
          message: "Sorry, that account is not active.",
        },
      );
    } finally {
      storage.close();
    }
  });

  it("matches the email strip+downcase of find_account_by_email (current.rb:74-77)", async () => {
    const storage = await buildStorage();
    try {
      const result = await authenticateAccount(
        storage.driver,
        `  ${EMAIL.toUpperCase()} `,
        PASSWORD,
      );
      expect(result.ok).toBe(true);
    } finally {
      storage.close();
    }
  });

  it("authenticates by the holder name and its Ruby key form (port extension)", async () => {
    const storage = await buildStorage();
    try {
      const byName = await authenticateAccount(storage.driver, "Joe User", PASSWORD);
      expect(byName.ok).toBe(true);
      const byKey = await authenticateAccount(storage.driver, "joe_user", PASSWORD);
      expect(byKey.ok).toBe(true);
    } finally {
      storage.close();
    }
  });

  it("applies Ruby's blank-field ladder: identifier then password (signin.rb:53-55)", async () => {
    const storage = await buildStorage();
    try {
      expect(await authenticateAccount(storage.driver, "", PASSWORD)).toEqual({
        ok: false,
        reason: "email_missing",
        message: "email can't be blank",
      });
      expect(await authenticateAccount(storage.driver, EMAIL, "")).toEqual({
        ok: false,
        reason: "password_missing",
        message: "password can't be blank",
      });

      expect(await authenticateAccount(storage.driver, EMAIL, "   ")).toEqual({
        ok: false,
        reason: "wrong_password",
        message: "Wrong password",
      });
    } finally {
      storage.close();
    }
  });

  it("verifies against an empty salt when the +*salt card is absent (auth.rb:38 nil interpolation)", async () => {

    const storage = await buildStorage({
      withSalt: false,
      storedDigest: createHash("sha1").update(`--${PASSWORD}--`).digest("hex"),
    });
    try {
      const result = await authenticateAccount(storage.driver, EMAIL, PASSWORD);
      expect(result.ok).toBe(true);
    } finally {
      storage.close();
    }
  });

  it("reports a deck without the account codenames as account_system_absent", async () => {
    const storage = createAuthTestStorage();
    try {
      expect(await authenticateAccount(storage.driver, EMAIL, PASSWORD)).toEqual(
        {
          ok: false,
          reason: "account_system_absent",
          message: "This deck has no account system.",
        },
      );
    } finally {
      storage.close();
    }
  });
});

describe("signinAccount / signoutAccount (the :signin and :signout events over the SessionStore)", () => {
  it("issues a session that resolves to the holder, and writes NO card rows", async () => {
    const storage = await buildStorage();
    try {
      const clock = fakeClock();
      const sessions = new SessionStore({ driver: storage.driver, now: clock.clock });
      const cardsBefore = storage.selectOne<{ n: number }>(
        "SELECT COUNT(*) AS n FROM cards",
      )?.n;
      const outcome = await signinAccount(storage.driver, sessions, EMAIL, PASSWORD);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.actor).toEqual({ id: HOLDER.id, name: HOLDER.name });

      const cardsAfter = storage.selectOne<{ n: number }>(
        "SELECT COUNT(*) AS n FROM cards",
      )?.n;
      expect(cardsAfter).toBe(cardsBefore);
      const actor = await sessions.lookupSession(outcome.session.token);
      expect(actor).toEqual({ id: HOLDER.id, name: HOLDER.name });
    } finally {
      storage.close();
    }
  });

  it("expires the session per the store TTL (the degraded-to-Anonymous lookup)", async () => {
    const storage = await buildStorage();
    try {
      const clock = fakeClock();
      const sessions = new SessionStore({ driver: storage.driver, now: clock.clock });
      const outcome = await signinAccount(storage.driver, sessions, EMAIL, PASSWORD);
      if (!outcome.ok) throw new Error("signin failed");
      clock.advanceSeconds(3600);
      expect(await sessions.lookupSession(outcome.session.token)).toEqual({
        id: HOLDER.id,
        name: HOLDER.name,
      });
      clock.advanceSeconds(60 * 60 * 48);
      expect(await sessions.lookupSession(outcome.session.token)).toBeNull();
    } finally {
      storage.close();
    }
  });

  it("revokes on signout (:signout: Auth.signin AnonymousID + Env.reset_session) and is idempotent", async () => {
    const storage = await buildStorage();
    try {
      const sessions = new SessionStore({ driver: storage.driver });
      const outcome = await signinAccount(storage.driver, sessions, EMAIL, PASSWORD);
      if (!outcome.ok) throw new Error("signin failed");
      expect(await sessions.lookupSession(outcome.session.token)).not.toBeNull();
      expect(await signoutAccount(sessions, outcome.session.token)).toBe(true);
      expect(await sessions.lookupSession(outcome.session.token)).toBeNull();

      expect(await signoutAccount(sessions, outcome.session.token)).toBe(false);
      expect(await signoutAccount(sessions, null)).toBe(false);
      expect(await signoutAccount(sessions, "")).toBe(false);
    } finally {
      storage.close();
    }
  });

  it("never issues a session for a failed authentication", async () => {
    const storage = await buildStorage();
    try {
      const sessions = new SessionStore({ driver: storage.driver });
      const outcome = await signinAccount(storage.driver, sessions, EMAIL, "wrong");
      expect(outcome.ok).toBe(false);
      const rows = storage.selectAll("SELECT * FROM auth_sessions");
      expect(rows).toEqual([]);
    } finally {
      storage.close();
    }
  });
});
