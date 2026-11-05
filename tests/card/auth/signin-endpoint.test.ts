// Endpoint tests for the staging server's slice-1 sign-in surface
// (vm-staging-server.mjs): POST /_signin, POST /_signout, GET /*signin
// (the form page), and session-scoped rendering — an authenticated GET
// shows a private card the account can read and anonymous cannot, while a
// bogus/revoked/expired token renders the exact anonymous bytes
// (auth/current.rb:58-63 degradation).
//
// The server boots against a DISPOSABLE COPY of the anonymized corpus-v2
// (benchmarks/corpus-v2/bench-corpus-v2.sqlite3, gitignored, rebuilt on
// demand). The account used is a REAL corpus account card — holder 583,
// the corpus-proven roleful member whose readable rule set strictly
// contains Anonymous's (tests/card/permissions/
// read-permission-actors-corpus.test.ts pins the set math). The corpus
// pipeline anonymized the account's +*password and +*status contents, so
// the fixture re-issues credentials for THAT account in the COPY with the
// exact Ruby formula (salted SHA-1, node:crypto side) — the sanctioned
// test-issued-hash fallback; no account data is written to any corpus
// file, and nothing is printed (emails, salts, digests, tokens stay in
// memory).
//
// The fixture also renames the python-built corpus's cards.content column
// to the engine-standard db_content (see src/card/auth/signin.ts's
// column-convention note) and restores the Default Layout card's own name
// (the anonymizer renamed the card; the *all+*layout rule still points at
// "Default Layout") so the server's page chrome can resolve.

import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer as netCreateServer } from "node:net";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function firstExisting(paths: Array<{ path: string; exists: boolean }>): string | null {
  for (const candidate of paths) {
    if (candidate.exists) return candidate.path;
  }
  return null;
}

const REPO_CORPUS = fileURLToPath(
  new URL("../../../benchmarks/corpus-v2/bench-corpus-v2.sqlite3", import.meta.url),
);
// The lane-worktree sibling of the main checkout.
const SIBLING_CORPUS = fileURLToPath(
  new URL("../../../../decko-ts/benchmarks/corpus-v2/bench-corpus-v2.sqlite3", import.meta.url),
);
const CORPUS_PATH =
  process.env.DECKO_TS_CORPUS_V2 ??
  firstExisting([
    { path: REPO_CORPUS, exists: existsSync(REPO_CORPUS) },
    { path: SIBLING_CORPUS, exists: existsSync(SIBLING_CORPUS) },
  ]);

const FIXTURE_PATH = path.join(REPO_ROOT, "tmp", "signin-endpoint-fixture.sqlite3");
const TEST_PASSWORD = "slice1-test-password";
const HOLDER_ID = 583;

const describeIfCorpus = CORPUS_PATH !== null ? describe : describe.skip;

interface Fixture {
  baseUrl: string;
  identifier: string;
  holderName: string;
  privateCard: { name: string; marker: string };
  layoutOk: boolean;
}

let fixture: Fixture;
let server: ChildProcess | null = null;
let serverOutput = "";
let reservedPort = 0;

async function reserveEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = netCreateServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (address === null || typeof address === "string") {
        reject(new Error("unexpected address"));
        srv.close();
        return;
      }
      const port = address.port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describeIfCorpus("staging server sign-in endpoints (booted server, disposable corpus copy)", () => {
  beforeAll(async () => {
    // 1. Disposable copy of the corpus (the source stays untouched).
    rmSync(FIXTURE_PATH, { force: true });
    copyFileSync(CORPUS_PATH as string, FIXTURE_PATH);

    // 2. Seed the fixture: engine-standard column name, deck-identity
    //    restoration for the layout card, test-issued credentials for the
    //    real account card, and the private-card pick.
    const db = new Database(FIXTURE_PATH);
    try {
      const columns = (db.prepare("PRAGMA table_info(cards)").all() as Array<{
        name: string;
      }>).map((c) => c.name);
      if (columns.includes("content") && !columns.includes("db_content")) {
        db.exec("ALTER TABLE cards RENAME COLUMN content TO db_content");
      }

      const codenameId = (code: string): number =>
        (
          db.prepare("SELECT id FROM cards WHERE codename = ? AND trash = 0").get(code) as
            | { id: number }
            | undefined
        )?.id ?? -1;
      const ids = {
        account: codenameId("account"),
        email: codenameId("email"),
        password: codenameId("password"),
        salt: codenameId("salt"),
        status: codenameId("status"),
      };
      expect(ids.account).toBeGreaterThan(0);

      const junction = db
        .prepare(
          "SELECT id FROM cards WHERE left_id = ? AND right_id = ? AND trash = 0",
        )
        .get(HOLDER_ID, ids.account) as { id: number } | undefined;
      expect(junction).toBeDefined();
      const junctionId = junction?.id as number;

      const fieldChild = (fieldId: number): { id: number; content: string | null } =>
        db
          .prepare(
            "SELECT id, db_content AS content FROM cards WHERE left_id = ? AND right_id = ? AND trash = 0",
          )
          .get(junctionId, fieldId) as { id: number; content: string | null };

      const emailChild = fieldChild(ids.email);
      const passwordChild = fieldChild(ids.password);
      const saltChild = fieldChild(ids.salt);
      const statusChild = fieldChild(ids.status);
      expect(emailChild?.content).toBeTruthy();
      expect(passwordChild).toBeDefined();
      expect(statusChild).toBeDefined();

      // Test-issued credential for the REAL account card: the corpus
      // anonymized its +*password and +*status contents; re-issue them in
      // the disposable copy with Ruby's exact formula
      // (Digest::SHA1.hexdigest "#{salt}--#{password}--", auth.rb:36-39).
      const salt = saltChild?.content ?? "";
      const digest = createHash("sha1")
        .update(`${salt}--${TEST_PASSWORD}--`)
        .digest("hex");
      db.prepare("UPDATE cards SET db_content = ? WHERE id = ?").run(
        digest,
        passwordChild?.id,
      );
      db.prepare("UPDATE cards SET db_content = 'active' WHERE id = ?").run(
        statusChild?.id,
      );

      const holder = db
        .prepare("SELECT name FROM cards WHERE id = ? AND trash = 0")
        .get(HOLDER_ID) as { name: string } | undefined;
      expect(holder?.name).toBeTruthy();

      // Restore the Default Layout card's own identity (anonymizer renamed
      // it; the deck's own *all+*layout rule names it) and repoint every
      // *layout rule whose target card the anonymizer left unresolvable —
      // otherwise the engine's page lane cannot resolve a layout for ANY
      // card and every page 500s. Deck-chrome restoration only; the
      // source corpus files stay untouched.
      const layoutCard = db
        .prepare("SELECT id FROM cards WHERE codename = 'default_layout' AND trash = 0")
        .get() as { id: number } | undefined;
      let layoutOk = false;
      if (layoutCard !== undefined) {
        db.prepare("UPDATE cards SET name = 'Default Layout', key = 'default_layout' WHERE id = ?").run(
          layoutCard.id,
        );
        const body = (
          db.prepare("SELECT db_content AS c FROM cards WHERE id = ?").get(layoutCard.id) as {
            c: string | null;
          }
        )?.c;
        layoutOk =
          typeof body === "string" && body.includes("<body") && body.includes("</body>");
        const layoutRules = db
          .prepare(
            "SELECT id, db_content AS target FROM cards WHERE right_id = (SELECT id FROM cards WHERE codename = 'layout' AND trash = 0) AND trash = 0",
          )
          .all() as Array<{ id: number; target: string }>;
        const repoint = db.prepare(
          "UPDATE cards SET db_content = 'Default Layout' WHERE id = ?",
        );
        for (const rule of layoutRules) {
          const target = db
            .prepare(
              "SELECT length(db_content) AS blen FROM cards WHERE name = ? AND trash = 0",
            )
            .get(rule.target) as { blen: number } | undefined;
          if (target === undefined || !target.blen) repoint.run(rule.id);
        }
      }

      // 3. Private-card pick: named, live, non-empty content, readable by
      //    holder 583's parties but NOT by Anonymous's — the same
      //    independent ReadRuleCache SQL the corpus permission test pins.
      const anyone = codenameId("anyone");
      const anyoneSignedIn = codenameId("anyone_signed_in");
      const anonymous = codenameId("anonymous");
      const readId = codenameId("read");
      const setId = codenameId("set");
      const roleId = codenameId("role");
      const membersId = codenameId("members");

      const cacheRows = db
        .prepare(
          `SELECT refs.referee_id AS partyId, read_rules.id AS readRuleId
           FROM cards read_rules
           JOIN card_references refs ON refs.referer_id = read_rules.id
           JOIN cards sets ON read_rules.left_id = sets.id
           WHERE read_rules.right_id = ${readId}
           AND sets.type_id = ${setId}
           AND read_rules.trash = 0 AND sets.trash = 0`,
        )
        .all() as Array<{ partyId: number; readRuleId: number }>;
      const roles = (
        db
          .prepare(
            `SELECT lists.left_id AS roleId
             FROM card_references refs
             JOIN cards lists ON lists.id = refs.referer_id
             JOIN cards roles ON roles.id = lists.left_id
             WHERE refs.referee_id = ? AND refs.referee_id IS NOT NULL
             AND lists.right_id = ${membersId}
             AND lists.trash = 0 AND roles.trash = 0
             AND roles.type_id = ${roleId}
             ORDER BY lists.left_id`,
          )
          .all(HOLDER_ID) as Array<{ roleId: number }>
      ).map((r) => r.roleId);

      const union = (parties: number[]): Set<number> => {
        const out = new Set<number>();
        for (const row of cacheRows) {
          if (parties.includes(row.partyId)) out.add(row.readRuleId);
        }
        return out;
      };
      const union583 = union([anyone, anyoneSignedIn, ...roles, HOLDER_ID]);
      const unionAnon = union([anyone, anonymous]);
      const holderOnly = [...union583].filter((id) => !unionAnon.has(id));
      expect(holderOnly.length).toBeGreaterThan(0);

      const placeholders = holderOnly.map(() => "?").join(",");
      // Plain content cards only: rule/set cards (+* names) render through
      // content-parsing views that the anonymized corpus data breaks, and
      // brace-bearing content is nest/CQL markup — none of that is needed
      // to prove the permission verdicts.
      const candidates = db
        .prepare(
          `SELECT id, name, db_content AS content FROM cards
           WHERE trash = 0 AND name != '' AND read_rule_id IN (${placeholders})
           AND db_content IS NOT NULL AND length(db_content) > 30
           AND name NOT LIKE '%+*%' AND name NOT LIKE '\\*%'
           AND db_content NOT LIKE '%{{%' AND db_content NOT LIKE '%{%'
           ORDER BY id LIMIT 40`,
        )
        .all(...holderOnly) as Array<{ id: number; name: string; content: string }>;

      let privateCard: { name: string; marker: string } | null = null;
      for (const card of candidates) {
        const match = card.content.match(/[A-Za-z]{10,}/g);
        if (match === null) continue;
        const marker = match.find(
          (word) => !card.name.toLowerCase().includes(word.toLowerCase()),
        );
        if (marker !== undefined) {
          privateCard = { name: card.name, marker };
          break;
        }
      }
      expect(privateCard).not.toBeNull();

      fixture = {
        baseUrl: "", // filled after the port is reserved
        identifier: emailChild?.content ?? "",
        holderName: holder?.name ?? "",
        privateCard: privateCard as { name: string; marker: string },
        layoutOk,
      };
    } finally {
      db.close();
    }

    // 4. Boot the server on the fixture.
    reservedPort = await reserveEphemeralPort();
    fixture.baseUrl = `http://127.0.0.1:${reservedPort}`;
    server = spawn(
      process.execPath,
      [path.join(REPO_ROOT, "vm-staging-server.mjs"), FIXTURE_PATH, String(reservedPort)],
      { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    server.stdout?.on("data", (chunk: Buffer) => {
      serverOutput += chunk.toString();
    });
    server.stderr?.on("data", (chunk: Buffer) => {
      serverOutput += chunk.toString();
    });

    // Bounded readiness wait (the boot primes the engine; typically a few
    // seconds). No unbounded polling.
    let ready = false;
    for (let attempt = 0; attempt < 120 && !ready; attempt++) {
      try {
        const response = await fetch(`${fixture.baseUrl}/_status`);
        ready = response.status === 200;
      } catch {
        await delay(250);
      }
    }
    if (!ready) {
      throw new Error(
        `staging server did not become ready on port ${reservedPort}\n--- server output ---\n${serverOutput}`,
      );
    }
  }, 240_000);

  afterAll(async () => {
    // The server process is this test's own child (fully owned): terminate
    // via its own API, then clean the disposable fixture file.
    if (server !== null && server.exitCode === null) {
      server.kill();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 3000);
        server?.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    server = null;
    rmSync(FIXTURE_PATH, { force: true });
  });

  function cookieValueOf(setCookie: string | null): string {
    expect(setCookie).toBeTruthy();
    const match = /decko_ts_session=([A-Za-z0-9]+)/.exec(setCookie as string);
    expect(match).not.toBeNull();
    return match?.[1] as string;
  }

  /** The engine stamps every rendered slot with a fresh random hex
   *  data-slot-id per request (SecureRandom; the staging server's own
   *  error-page builder notes slot ids are normalized in every replay
   *  comparison). Normalize it before cross-request byte comparisons —
   *  everything else must be identical. */
  function normalizeSlotIds(html: string): string {
    return html.replace(/data-slot-id="[0-9a-f]+"/g, 'data-slot-id="X"');
  }

  it("POST /_signin (JSON) signs the real account in and sets the session cookie", async () => {
    const response = await fetch(`${fixture.baseUrl}/_signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: fixture.identifier, password: TEST_PASSWORD }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; name: string };
    expect(body.ok).toBe(true);
    expect(body.name).toBe(fixture.holderName);
    expect(response.headers.get("set-cookie")).toContain("decko_ts_session=");
  });

  it("POST /_signin (form-urlencoded) signs in too", async () => {
    const form = new URLSearchParams({
      identifier: fixture.identifier,
      password: TEST_PASSWORD,
    });
    const response = await fetch(`${fixture.baseUrl}/_signin`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("wrong password -> 401 with Ruby's Wrong password message", async () => {
    const response = await fetch(`${fixture.baseUrl}/_signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: fixture.identifier, password: "definitely-wrong" }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: "Wrong password" });
  });

  it("unknown identifier -> 401 with Ruby's Unrecognized email message", async () => {
    const response = await fetch(`${fixture.baseUrl}/_signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "no-such-identity@example.invalid", password: TEST_PASSWORD }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: "Unrecognized email." });
  });

  it("blank password -> 401 with Ruby's password can't be blank message", async () => {
    const response = await fetch(`${fixture.baseUrl}/_signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: fixture.identifier, password: "" }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: "password can't be blank" });
  });

  it("authenticated GET shows the private card; anonymous GET does not", async () => {
    const signin = await fetch(`${fixture.baseUrl}/_signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: fixture.identifier, password: TEST_PASSWORD }),
    });
    const token = cookieValueOf(signin.headers.get("set-cookie"));

    const cardUrl = `${fixture.baseUrl}/${encodeURIComponent(fixture.privateCard.name)}`;
    const anonymousPage = await fetch(cardUrl);
    expect(anonymousPage.status).toBe(200);
    const anonymousHtml = await anonymousPage.text();
    expect(anonymousHtml).not.toContain(fixture.privateCard.marker);

    const signedPage = await fetch(cardUrl, {
      headers: { Cookie: `decko_ts_session=${token}` },
    });
    expect(signedPage.status).toBe(200);
    const signedHtml = await signedPage.text();
    expect(signedHtml).toContain(fixture.privateCard.marker);

    // The record endpoint agrees with the page: 403 for Anonymous, 200 for
    // the account.
    const anonymousJson = await fetch(`${cardUrl}.json`);
    expect(anonymousJson.status).toBe(403);
    const signedJson = await fetch(`${cardUrl}.json`, {
      headers: { Cookie: `decko_ts_session=${token}` },
    });
    expect(signedJson.status).toBe(200);
    const record = (await signedJson.json()) as { name: string };
    expect(record.name).toBe(fixture.privateCard.name);
  }, 120_000);

  it("a bogus session token renders the exact anonymous bytes", async () => {
    const cardUrl = `${fixture.baseUrl}/${encodeURIComponent(fixture.privateCard.name)}`;
    const anonymous = await fetch(cardUrl);
    const anonymousHtml = normalizeSlotIds(await anonymous.text());
    const bogus = await fetch(cardUrl, {
      headers: { Cookie: "decko_ts_session=0123456789abcdef0123456789abcdef" },
    });
    expect(bogus.status).toBe(anonymous.status);
    expect(normalizeSlotIds(await bogus.text())).toBe(anonymousHtml);
  });

  it("GET /*signin serves the honest sign-in form page in house chrome", async () => {
    const response = await fetch(`${fixture.baseUrl}/*signin`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('action="/_signin"');
    expect(html).toContain("Sign In");
    expect(html).toContain('type="password"');
  });

  it("POST /_signout revokes the session; the old token renders anonymous again", async () => {
    const signin = await fetch(`${fixture.baseUrl}/_signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: fixture.identifier, password: TEST_PASSWORD }),
    });
    const token = cookieValueOf(signin.headers.get("set-cookie"));
    const cardUrl = `${fixture.baseUrl}/${encodeURIComponent(fixture.privateCard.name)}`;
    const anonymousHtml = normalizeSlotIds(await (await fetch(cardUrl)).text());

    const signout = await fetch(`${fixture.baseUrl}/_signout`, {
      method: "POST",
      headers: { Cookie: `decko_ts_session=${token}` },
    });
    expect(signout.status).toBe(200);
    const body = (await signout.json()) as { ok: boolean; revoked: boolean };
    expect(body).toEqual({ ok: true, revoked: true });
    expect(signout.headers.get("set-cookie")).toContain("Max-Age=0");

    const afterSignout = await fetch(cardUrl, {
      headers: { Cookie: `decko_ts_session=${token}` },
    });
    expect(normalizeSlotIds(await afterSignout.text())).toBe(anonymousHtml);

    // Idempotent like Ruby's :signout (signing out Anonymous is a no-op).
    const again = await fetch(`${fixture.baseUrl}/_signout`, {
      method: "POST",
      headers: { Cookie: `decko_ts_session=${token}` },
    });
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { ok: boolean; revoked: boolean };
    expect(againBody.revoked).toBe(false);
  }, 120_000);

  it("non-GET methods other than the sign-in endpoints stay 405", async () => {
    const response = await fetch(`${fixture.baseUrl}/`, { method: "POST" });
    expect(response.status).toBe(405);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("method not allowed");
  });
});
