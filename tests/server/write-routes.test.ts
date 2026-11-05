// End-to-end tests for the HTTP write surface (src/server/write-routes.ts):
// sign in (token issued DIRECTLY via the SessionStore — the password front
// door is the sign-in lane's slice), POST an update over real HTTP, watch
// the read side reflect it, and watch the act/action/changes rows land.
// Plus the write-permission walks through the HTTP layer: the three
// ok_to_* denials, the ok_to_update? type-change clause, and the CSRF +
// anonymous gates.
//
// Ruby truth under test (see the module header citations in
// src/server/write-routes.ts): engine_routes.rb grammar, rest.rb
// create/update/delete, permission.rb ok_to_* (403), error.rb statuses
// (404/422), Rails 7.2 forgery protection (422).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  createRenderTestStorage,
  seedCard,
  seedReference,
  type RenderTestStorage,
} from "../card/render/render-test-storage.js";
import { runAuthMigrations, SessionStore } from "../../src/card/auth/index.js";
import {
  csrfTokenFor,
  handleWriteRequest,
  type WriteRouteContext,
} from "../../src/server/write-routes.js";
import { actionTypeCode } from "../../src/card/history/action.js";
import { DeckoName } from "../../src/card/name.js";

const SET_TYPE_ID = 2;
const JOE_ID = 90;
const EDITOR_ID = 30;

let storage: RenderTestStorage | undefined;
let sideDenyStorage: RenderTestStorage | undefined;
let joeToken = "";
let sideDenyJoeToken = "";
let ctx: WriteRouteContext;
let sideDenyCtx: WriteRouteContext;
let server: http.Server;
let sideDenyServer: http.Server;
let baseUrl = "";
let sideDenyBaseUrl = "";

/**
 * The rule deck (mirrors tests/card/permissions/view-task-verdicts.test.ts,
 * plus the account/session cards and the *all+*default rule the create
 * path's Card.default_type_id needs):
 *   1  *all codename all (Set-typed anchor)     2  Set codename set
 *   3  *update   4  *create   5  *delete        6  Anyone codename anyone
 *   7  Anyone Signed In codename anyone_signed_in
 *   8  *type codename type   9  *self codename self
 *   18 *default codename default
 *   10 *all+*update   [[Anyone Signed In]] + ref -> 7
 *   11 *all+*create   [[Anyone Signed In]] + ref -> 7
 *   12 *all+*delete   [[Anyone Signed In]] + ref -> 7
 *   13 Widget typeId 14   14 Basic   15 Basic+*type (Set-typed)
 *   16 RichText (a second type for type-change saves)
 *   17 *all+*default (typeId 2 — Card.default_type_id)
 *   30 Editor (a party Joe is NOT in)
 *   40 Locked   41 Locked+*self   42 Locked+*self+*update [[Editor]]
 *   43 Widget+*self  44 Widget+*self+*create [[Editor]]
 *   90 Joe User (the account card)
 */
async function seedRuleDeck(s: RenderTestStorage): Promise<void> {
  const byId = async (
    id: number,
    name: string,
    extra: Omit<Parameters<typeof seedCard>[1], "id" | "name"> = {},
  ) => seedCard(s, { id, name, ...extra });
  await byId(1, "*all", { codename: "all", typeId: SET_TYPE_ID });
  await byId(2, "Set", { codename: "set" });
  await byId(3, "*update", { codename: "update" });
  await byId(4, "*create", { codename: "create" });
  await byId(5, "*delete", { codename: "delete" });
  await byId(6, "Anyone", { codename: "anyone" });
  await byId(7, "Anyone Signed In", { codename: "anyone_signed_in" });
  await byId(8, "*type", { codename: "type" });
  await byId(9, "*self", { codename: "self" });
  await byId(18, "*default", { codename: "default" });
  await seedCard(s, { id: 10, leftId: 1, rightId: 3, dbContent: "[[Anyone Signed In]]" });
  await seedReference(s, 10, 7, "anyone signed in");
  await seedCard(s, { id: 11, leftId: 1, rightId: 4, dbContent: "[[Anyone Signed In]]" });
  await seedReference(s, 11, 7, "anyone signed in");
  await seedCard(s, { id: 12, leftId: 1, rightId: 5, dbContent: "[[Anyone Signed In]]" });
  await seedReference(s, 12, 7, "anyone signed in");
  await seedCard(s, { id: 17, leftId: 1, rightId: 18, typeId: SET_TYPE_ID });
  await byId(13, "Widget", { typeId: 14, dbContent: "widget body v1" });
  await byId(14, "Basic");
  await seedCard(s, { id: 15, leftId: 14, rightId: 8, typeId: SET_TYPE_ID });
  await byId(16, "RichText");
  await byId(EDITOR_ID, "Editor");
  await byId(40, "Locked", { dbContent: "locked body" });
  await seedCard(s, { id: 41, leftId: 40, rightId: 9, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 42, leftId: 41, rightId: 3, dbContent: "[[Editor]]" });
  await seedReference(s, 42, EDITOR_ID, "editor");
  await seedCard(s, { id: 43, leftId: 13, rightId: 9, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 44, leftId: 43, rightId: 4, dbContent: "[[Editor]]" });
  await seedReference(s, 44, EDITOR_ID, "editor");
  await byId(JOE_ID, "Joe User");
}

async function makeServer(
  s: RenderTestStorage,
  context: WriteRouteContext,
): Promise<{ server: http.Server; url: string }> {
  const readBridge = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    let response: { status: number; headers: Record<string, string>; body: string };
    if (req.method === "GET") {
      // the staging server's read surface, minimal: .json record + html render
      if (pathname.endsWith(".json")) {
        const name = decodeURIComponent(pathname.slice(1, -".json".length)).replace(/_/g, " ");
        const record = await s.fetcher.fetchByKey(DeckoName.parse(name).key);
        response = {
          status: record === undefined ? 404 : 200,
          headers: { "Content-Type": "application/json" },
          body:
            record === undefined
              ? JSON.stringify({ error: "not found" })
              : JSON.stringify({ name, dbContent: record.dbContent ?? null }),
        };
      } else {
        const name = decodeURIComponent(pathname.slice(1)).replace(/_/g, " ");
        try {
          const html = await s.engine.render(name, "open");
          response = { status: 200, headers: { "Content-Type": "text/html" }, body: html };
        } catch {
          response = { status: 404, headers: { "Content-Type": "text/html" }, body: "not found" };
        }
      }
    } else {
      const writeResponse = await handleWriteRequest(context, {
        method: req.method ?? "GET",
        pathname,
        host: req.headers.host,
        headers: req.headers as Record<string, string | undefined>,
        body,
      });
      response = writeResponse ?? { status: 405, headers: {}, body: "method not allowed" };
    }
    res.writeHead(response.status, response.headers).end(response.body);
  });
  await new Promise<void>((resolve) => readBridge.listen(0, "127.0.0.1", resolve));
  const address = readBridge.address() as AddressInfo;
  return { server: readBridge, url: `http://127.0.0.1:${address.port}` };
}

interface CallResult {
  status: number;
  headers: Record<string, string>;
  body: string;
  json: () => Record<string, unknown>;
}

async function call(
  base: string,
  method: string,
  path: string,
  opts: {
    form?: Record<string, string>;
    json?: unknown;
    token?: string;
    csrf?: string;
    origin?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let body: string | undefined;
  if (opts.form !== undefined) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const params = new URLSearchParams(opts.form);
    if (opts.csrf !== undefined) params.set("authenticity_token", opts.csrf);
    if (opts.token !== undefined) params.set("token", opts.token);
    body = params.toString();
  } else if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  if (opts.token !== undefined && opts.form === undefined) {
    headers["Authorization"] = `Bearer ${opts.token}`;
  }
  if (opts.csrf !== undefined && opts.form === undefined) {
    headers["X-CSRF-Token"] = opts.csrf;
  }
  if (opts.origin !== undefined) headers["Origin"] = opts.origin;
  const res = await fetch(`${base}${path}`, { method, headers, body, redirect: "manual" });
  const text = await res.text();
  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  return {
    status: res.status,
    headers: responseHeaders,
    body: text,
    json: () => JSON.parse(text) as Record<string, unknown>,
  };
}

beforeAll(async () => {
  storage = await createRenderTestStorage();
  await runAuthMigrations(storage.counting);
  await seedRuleDeck(storage);
  sideDenyStorage = await createRenderTestStorage();
  await runAuthMigrations(sideDenyStorage.counting);
  await seedSideDenyDeck(sideDenyStorage);

  ctx = { driver: storage.counting, fetcher: storage.fetcher, csrfSecret: "test-csrf-secret" };
  sideDenyCtx = {
    driver: sideDenyStorage.counting,
    fetcher: sideDenyStorage.fetcher,
    csrfSecret: "test-csrf-secret",
  };

  const sessions = new SessionStore({ driver: storage.counting });
  joeToken = (await sessions.createSession(JOE_ID)).token;
  // Each deck has its OWN auth_sessions table — the side-deny deck's Joe
  // needs a session issued against THAT storage.
  const sideDenySessions = new SessionStore({ driver: sideDenyStorage.counting });
  sideDenyJoeToken = (await sideDenySessions.createSession(JOE_ID)).token;

  const bridge = await makeServer(storage, ctx);
  server = bridge.server;
  baseUrl = bridge.url;
  const sideBridge = await makeServer(sideDenyStorage, sideDenyCtx);
  sideDenyServer = sideBridge.server;
  sideDenyBaseUrl = sideBridge.url;
}, 60_000);

afterAll(() => {
  server?.close();
  sideDenyServer?.close();
  storage?.close();
  sideDenyStorage?.close();
});

/** The side-deny deck: *all+*create -> [[Editor]] (denies Joe), but
 *  Set+*type+*create -> [[Anyone Signed In]] (cards of the deck's DEFAULT
 *  type pass — new cards resolve *all+*default to type id 2, the "Set"
 *  codename card in this seed). A junction "Trunk+Ghost Part" then passes
 *  permit(:create) through its *type rule, while the MISSING right part
 *  resolves as a virtual NEW card with no type -> its ok?(:create) falls
 *  to the Editor-only *all rule -> ok_to_create_side denies
 *  (permissions.rb:127-137). The side walk is thereby proven through HTTP:
 *  trunk allowed, side denied. */
async function seedSideDenyDeck(s: RenderTestStorage): Promise<void> {
  await seedCard(s, { id: 1, name: "*all", codename: "all", typeId: SET_TYPE_ID });
  await seedCard(s, { id: 2, name: "Set", codename: "set" });
  await seedCard(s, { id: 3, name: "*update", codename: "update" });
  await seedCard(s, { id: 4, name: "*create", codename: "create" });
  await seedCard(s, { id: 5, name: "*delete", codename: "delete" });
  await seedCard(s, { id: 6, name: "Anyone", codename: "anyone" });
  await seedCard(s, { id: 7, name: "Anyone Signed In", codename: "anyone_signed_in" });
  await seedCard(s, { id: 8, name: "*type", codename: "type" });
  await seedCard(s, { id: 9, name: "*default", codename: "default" });
  await seedCard(s, { id: 10, leftId: 1, rightId: 3, dbContent: "[[Anyone Signed In]]" });
  await seedReference(s, 10, 7, "anyone signed in");
  await seedCard(s, { id: 11, leftId: 1, rightId: 4, dbContent: "[[Editor]]" });
  await seedReference(s, 11, 30, "editor");
  await seedCard(s, { id: 12, leftId: 1, rightId: 5, dbContent: "[[Anyone Signed In]]" });
  await seedReference(s, 12, 7, "anyone signed in");
  await seedCard(s, { id: 14, name: "Basic" });
  await seedCard(s, { id: 15, leftId: 2, rightId: 8, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 16, leftId: 15, rightId: 4, dbContent: "[[Anyone Signed In]]" });
  await seedReference(s, 16, 7, "anyone signed in");
  await seedCard(s, { id: 17, leftId: 1, rightId: 9, typeId: SET_TYPE_ID });
  await seedCard(s, { id: 30, name: "Editor" });
  await seedCard(s, { id: 50, name: "Trunk", typeId: 14, dbContent: "trunk body" });
  await seedCard(s, { id: JOE_ID, name: "Joe User" });
}

// -----------------------------------------------------------------------

describe("signed-in save over HTTP (the full write path)", () => {
  it("form update with a valid session + CSRF token: redirect, content rendered, rows written", async () => {
    // A real decko edit form POSTs with the Rails _method override (patch).
    const csrf = csrfTokenFor(ctx, joeToken);
    const res = await call(baseUrl, "POST", "/Widget", {
      form: { "card[content]": "widget body v2 — saved over HTTP", _method: "patch" },
      token: joeToken,
      csrf,
    });
    expect(res.status, `DBG1 status=${res.status} headers=${JSON.stringify(res.headers)} body=${res.body.slice(0,200)}`).toBe(302); // Ruby cud_success redirect
    expect(res.headers["location"]).toBe("/Widget");

    // READ side reflects the save: the record and the RENDER carry v2.
    const record = await call(baseUrl, "GET", "/Widget.json", {});
    expect(record.status).toBe(200);
    expect(record.json().dbContent).toBe("widget body v2 — saved over HTTP");
    const page = await call(baseUrl, "GET", "/Widget", {});
    expect(page.status).toBe(200);
    expect(page.body).toContain("widget body v2 — saved over HTTP");

    // EVENT rows: one act attributed to Joe, an update action, a db_content
    // change with the new value (the ActWriter shapes the write path tests
    // pin; here through the HTTP layer).
    const driver = storage!.counting;
    const act = await driver.query<{ actor_id: number; ip_address: string | null }>(
      `SELECT a.actor_id, a.ip_address FROM card_acts a
       JOIN card_actions act ON act.card_act_id = a.id
       JOIN cards c ON c.id = act.card_id
       WHERE c.key = 'widget' ORDER BY a.id DESC LIMIT 1`,
      [],
    );
    expect(act.rows[0]?.actor_id).toBe(JOE_ID);
    const action = await driver.query<{ action_type: number }>(
      `SELECT act.action_type FROM card_actions act
       JOIN cards c ON c.id = act.card_id
       WHERE c.key = 'widget' ORDER BY act.id DESC LIMIT 1`,
      [],
    );
    expect(action.rows[0]?.action_type).toBe(actionTypeCode("update"));
    const change = await driver.query<{ field: number; value: string }>(
      `SELECT ch.field, ch.value FROM card_changes ch
       JOIN card_actions act ON act.id = ch.card_action_id
       JOIN cards c ON c.id = act.card_id
       WHERE c.key = 'widget' ORDER BY ch.id DESC LIMIT 1`,
      [],
    );
    expect(change.rows[0]?.value).toBe("widget body v2 — saved over HTTP");
  });

  it("PUT JSON update with a Bearer session: 200 JSON, no CSRF needed (API carve-out)", async () => {
    const res = await call(baseUrl, "PUT", "/Widget.json", {
      json: { card: { content: "widget body v3 (json api)" } },
      token: joeToken,
    });
    expect(res.status).toBe(200);
    expect(res.json().card).toMatchObject({ name: "Widget" });
    expect(res.json().verb).toBe("update");
  });

  it("PUT update (RESTful verb) and POST create both work per the Ruby grammar", async () => {
    const put = await call(baseUrl, "PUT", "/Widget.json", {
      json: { card: { content: "widget body v4 (put)" } },
      token: joeToken,
    });
    expect(put.status).toBe(200);
    expect(put.json().verb).toBe("update");

    const create = await call(baseUrl, "POST", "/HTTP Made.json", {
      json: { card: { content: "created over http" } },
      token: joeToken,
    });
    expect(create.status).toBe(200);
    expect(create.json().verb).toBe("create");
    const record = await call(baseUrl, "GET", "/HTTP_Made.json", {});
    expect(record.json().dbContent).toBe("created over http");
  });

  it("DELETE trashes the card over HTTP", async () => {
    const create = await call(baseUrl, "POST", "/Doomed.json", {
      json: { card: { content: "doomed" } },
      token: joeToken,
    });
    expect(create.status).toBe(200);
    const del = await call(baseUrl, "DELETE", "/Doomed.json", { token: joeToken });
    expect(del.status).toBe(200);
    expect(del.json().verb).toBe("delete");
    const record = await call(baseUrl, "GET", "/Doomed.json", {});
    expect(record.status).toBe(404);
  });

  it("update of a missing mark routes to CREATE (rest.rb: card.new_card? ? create)", async () => {
    const res = await call(baseUrl, "PUT", "/Fresh From Put.json", {
      json: { card: { content: "via update-as-create" } },
      token: joeToken,
    });
    expect(res.status, `DBG2 status=${res.status} body=${res.body.slice(0,200)}`).toBe(200);
    expect(res.json().verb).toBe("create");
  });
});

describe("the permission gates through HTTP (ok_to_* walks)", () => {
  it("ok_to_update? denial: the card's *self rule names a party Joe is not in (403)", async () => {
    const res = await call(baseUrl, "PUT", "/Locked.json", {
      json: { card: { content: "should not land" } },
      token: joeToken,
    });
    expect(res.status).toBe(403); // Card::Error::PermissionDenied.status_code
    // nothing landed
    const record = await call(baseUrl, "GET", "/Locked.json", {});
    expect(record.json().dbContent).toBe("locked body");
  });

  it("ok_to_update? type-change clause: update allowed, create denied -> type change is 403", async () => {
    // Widget: *all+*update -> Anyone Signed In (Joe passes), but
    // Widget+*self+*create -> [[Editor]] (Joe fails). Content-only saves
    // pass; a type-changing save additionally needs permitted?(:create)
    // (permissions.rb:148-153).
    const contentOnly = await call(baseUrl, "PUT", "/Widget.json", {
      json: { card: { content: "still allowed" } },
      token: joeToken,
    });
    expect(contentOnly.status).toBe(200);
    const typeChange = await call(baseUrl, "PUT", "/Widget.json", {
      json: { card: { content: "retyped", type: "RichText" } },
      token: joeToken,
    });
    expect(typeChange.status).toBe(403);
    const record = await call(baseUrl, "GET", "/Widget.json", {});
    expect(record.json().dbContent).toBe("still allowed"); // the retype never landed
  });

  it("ok_to_create? denial rides the junction sides: trunk allowed, missing part denied (403)", async () => {
    // Trunk (typed Basic) passes permit(:create) through
    // Basic+*type+*create -> [[Anyone Signed In]]; the MISSING right part
    // resolves as a virtual new card with no type -> its ok?(:create) falls
    // to *all+*create -> [[Editor]] (Joe is not one) -> denied.
    const res = await call(sideDenyBaseUrl, "POST", "/Trunk+Ghost Part.json", {
      json: { card: { content: "junction" } },
      token: sideDenyJoeToken,
    });
    expect(res.status).toBe(403);
  });

  it("ok_to_create? sides pass when every part exists (200)", async () => {
    const s = sideDenyStorage!;
    await seedCard(s, { id: 51, name: "Left Part", typeId: 14 });
    await seedCard(s, { id: 52, name: "Right Part", typeId: 14 });
    const res = await call(sideDenyBaseUrl, "POST", "/Left Part+Right Part.json", {
      json: { card: { content: "junction with existing parts" } },
      token: sideDenyJoeToken,
    });
    expect(res.status, `DBG3 status=${res.status} body=${res.body.slice(0,200)}`).toBe(200);
    expect(res.json().verb).toBe("create");
  });
});

describe("anonymous and bad-token writes are denied (403, Ruby's PermissionDenied shape)", () => {
  it("no token at all", async () => {
    const res = await call(baseUrl, "POST", "/Widget.json", {
      json: { card: { content: "anonymous edit" } },
    });
    expect(res.status).toBe(403);
  });

  it("unknown token degrades to Anonymous (auth/current.rb:58-63), still 403", async () => {
    const res = await call(baseUrl, "POST", "/Widget.json", {
      json: { card: { content: "forge" } },
      token: "not-a-real-token",
    });
    expect(res.status).toBe(403);
  });

  it("anonymous create is denied too", async () => {
    const res = await call(baseUrl, "POST", "/Anon Made.json", {
      json: { card: { content: "nope" } },
    });
    expect(res.status).toBe(403);
    const record = await call(baseUrl, "GET", "/Anon_Made.json", {});
    expect(record.status).toBe(404);
  });
});

describe("CSRF on form posts (Rails 7.2 protect_from_forgery with: :exception)", () => {
  it("form post without an authenticity token: 422", async () => {
    const res = await call(baseUrl, "POST", "/Widget", {
      form: { "card[content]": "csrf-less", _method: "patch" },
      token: joeToken,
    });
    expect(res.status).toBe(422);
  });

  it("form post with a WRONG token: 422", async () => {
    const res = await call(baseUrl, "POST", "/Widget", {
      form: { "card[content]": "csrf-less", _method: "patch" },
      token: joeToken,
      csrf: "forged-token-value",
    });
    expect(res.status).toBe(422);
  });

  it("form post with the CORRECT per-session token passes (200 via JSON-mode mark)", async () => {
    const csrf = csrfTokenFor(ctx, joeToken);
    const res = await call(baseUrl, "POST", "/Widget.json", {
      form: { "card[content]": "csrf'd form save", _method: "patch" },
      token: joeToken,
      csrf,
    });
    expect(res.status).toBe(200);
  });

  it("cross-origin form post (Origin header vs Host): 422 even with a token", async () => {
    const csrf = csrfTokenFor(ctx, joeToken);
    const res = await call(baseUrl, "POST", "/Widget", {
      form: { "card[content]": "cross origin", _method: "patch" },
      token: joeToken,
      csrf,
      origin: "https://evil.example",
    });
    expect(res.status).toBe(422);
  });

  it("form post with NO session behind it: 422 (no session to verify against)", async () => {
    const res = await call(baseUrl, "POST", "/Widget", {
      form: { "card[content]": "anonymous form", _method: "patch" },
    });
    expect(res.status).toBe(422);
  });
});

describe("error shapes over HTTP", () => {
  it("missing card on DELETE: 404 (Card::Error::NotFound)", async () => {
    const res = await call(baseUrl, "DELETE", "/Never Was.json", { token: joeToken });
    expect(res.status).toBe(404);
  });

  it("create with no name: 422 (Ruby Card.new(name: nil).save! validation)", async () => {
    const res = await call(baseUrl, "POST", "/", {
      json: { card: { content: "nameless" } },
      token: joeToken,
    });
    expect(res.status).toBe(422);
  });

  it("multi-segment marks are not routes (Rails: no match) -> the host keeps its 405", async () => {
    const res = await call(baseUrl, "POST", "/card/read/Widget", {
      json: { card: { content: "x" } },
      token: joeToken,
    });
    expect(res.status).toBe(405);
  });
});
