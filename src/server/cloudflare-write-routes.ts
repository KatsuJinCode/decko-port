import type { DelayedJobsConfig } from "../card/delayed-job/delayed-job.js";
import type { SQLDatabaseDriver } from "./driver.js";
import type { FetchEngine } from "../card/fetch.js";
import { CloudflareD1Adapter, type D1DatabaseLike } from "./drivers/d1.js";
import {
  handleAuthOnlyRequest,
  handleWriteRequest,
  SESSION_COOKIE_NAME,
  type WriteRouteResponse,
  type WriteRouteContext,
} from "./write-routes.js";
export { handleAuthOnlyRequest };
import { handleFirstRunRequest, SETUP_PATH } from "./first-run-routes.js";
import { originPolicyFromEnv, type OriginPolicy } from "./request-origin.js";
import { configurePasswordHashing, passwordHashPolicyFromEnv } from "../card/auth/password-hash.js";
import { configureSigninSecurity, signinSecurityPolicyFromEnv } from "../card/auth/signin-security.js";
import { configureStrictParity, strictParityFlagsFromEnv } from "../card/parity/strict-parity-flags.js";
import { configureSetupToken } from "../card/auth/setup-token.js";
import { expireRenderCachesAfterSave } from "./post-save-cache-expiry.js";
import { libsassWasmCompiler } from "./libsass-wasm.js";
import { coffeeNpmCompiler } from "./coffee-npm-compiler.js";
import { staticUglifyHarmonySyntaxError } from "../card/assets/uglify-harmony-static.js";
import type { AttachmentStore } from "../card/attachments/attachment-store.js";
import { RenderEngine } from "../card/render.js";
import { withVisitorEnabledRoles } from "../card/session/enabled-roles.js";
import { SessionStore } from "../card/auth/session-store.js";
import { readSessionCookie } from "./write-routes.js";
import { cardWallClockNow } from "../card/wall-clock.js";

export interface WriteSurfaceFlags {
  readonly DECKO_FIRST_RUN?: string;
  readonly DECKO_WRITE_PATH?: string;
  readonly DECKO_PASSWORD_HASH?: string;
  readonly DECKO_PASSWORD_PBKDF2_ITERATIONS?: string;
  readonly DECKO_ORIGIN_CHECK?: string;
  readonly DECKO_TRUSTED_ORIGINS?: string;
  readonly DECKO_SETUP_TOKEN?: string;
  readonly DECKO_SIGNIN_THROTTLE?: string;
  readonly DECKO_SIGNIN_MAX_FAILURES?: string;
  readonly DECKO_SIGNIN_MAX_ADDRESS_FAILURES?: string;
  readonly DECKO_SIGNIN_LOCKOUT_SECONDS?: string;
  readonly DECKO_SIGNIN_UNIFORM_FAILURE?: string;
  readonly DECKO_SESSION_REVOCATION?: string;
  readonly DECKO_STRICT_PARITY_SIGNIN_DETAILED_ERRORS?: string;
  readonly DECKO_STRICT_PARITY_REVISION_RESTORE_500?: string;
  readonly DECKO_STRICT_PARITY_SKIN_CREATE_500?: string;
  readonly DECKO_STRICT_PARITY_SCRIPT_BUNDLE_CLOCK_NAMES?: string;
  readonly DECKO_STRICT_PARITY_MAIL_UNFOLLOW_REFUSAL?: string;
}

export interface WorkersWriteEnv extends WriteSurfaceFlags {
  readonly DB: D1DatabaseLike;
}

export interface WorkersRenderEngine {
  render(name: string, view: string, params?: { absentCard?: boolean }): Promise<string>;
  expireRenderCard(name: string): void;
  readonly imageCdnHost?: string;
}

export interface WorkersWriteContext {
  readonly renderSavedSlot?: (name: string, view?: string, opts?: { absentCard?: boolean }) => Promise<string>;
  readonly renderPreviewEditor?: WriteRouteContext["renderPreviewEditor"];
  readonly accountMail?: WriteRouteContext["accountMail"];
  readonly fetcher: FetchEngine;
  readonly renderEngine: WorkersRenderEngine;
  readonly driver?: SQLDatabaseDriver;
  readonly attachmentStore?: AttachmentStore;
  readonly attachmentStoreDiagnosis?: string;
  readonly delayedJobs?: DelayedJobsConfig;
}

export interface WorkersWriteRequest {
  readonly method: string;
  readonly pathname: string;
  readonly search?: string;
  readonly host: string | undefined;
  readonly headers: Record<string, string | undefined>;
  readonly body: string;
  readonly bodyBytes?: Uint8Array;
  readonly secure: boolean;
  readonly scheme: "http" | "https";
  readonly ipAddress?: string;
}

export interface WorkersWriteResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly extraCookies?: readonly string[];
}

export const WORKERS_SIGNIN_PATH = "/_signin";

const SIGNIN_FORM_ACTION = "/update/*signin";

export const edgeScssCompiler = libsassWasmCompiler();
export const edgeCoffeeCompiler = coffeeNpmCompiler();

export function writePathArmed(env: WriteSurfaceFlags): boolean {
  if (typeof env.DECKO_WRITE_PATH === "string") return env.DECKO_WRITE_PATH === "1";
  return false;
}

export function firstRunArmed(env: WriteSurfaceFlags): boolean {
  if (typeof env.DECKO_FIRST_RUN === "string") return env.DECKO_FIRST_RUN === "1";
  return false;
}

function syncGateToProcessEnv(name: string, armed: boolean): void {
  try {
    (process.env as Record<string, string | undefined>)[name] = armed ? "1" : "0";
  } catch {
  }
}

function hardenSessionCookie(value: string, secure: boolean): string {
  if (!secure) return value;
  if (/(?:^|;\s*)Secure(?:;|$)/i.test(value)) return value;
  return `${value}; Secure`;
}

export async function readWorkersRequest(request: Request): Promise<WorkersWriteRequest> {
  const url = new URL(request.url);
  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const method = request.method.toUpperCase();
  let body = "";
  let bodyBytes: Uint8Array | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const raw = new Uint8Array(await request.arrayBuffer());
    bodyBytes = raw;
    body = new TextDecoder().decode(raw);
  }
  return {
    method,
    pathname: url.pathname.replace(/\/+$/, ""),
    search: url.search,
    host: url.host,
    headers,
    body,
    bodyBytes,
    secure: url.protocol === "https:",
    scheme: url.protocol === "https:" ? "https" : "http",
    ipAddress: headers["cf-connecting-ip"] ?? headers["x-forwarded-for"],
  };
}

export function toWebResponse(
  result: WorkersWriteResponse,
  request: WorkersWriteRequest,
): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(result.headers)) {
    if (name.toLowerCase() === "set-cookie") {
      headers.append(name, hardenSessionCookie(value, request.secure));
    } else {
      headers.set(name, value);
    }
  }
  for (const cookie of result.extraCookies ?? []) {
    headers.append("Set-Cookie", hardenSessionCookie(cookie, request.secure));
  }
  if (!headers.has("Content-Type") && result.body !== "") {
    headers.set("Content-Type", "text/html; charset=utf-8");
  }
  return new Response(result.body, { status: result.status, headers });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function plainText(status: number, title: string, message: string): WorkersWriteResponse {
  return {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body:
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
      `<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`,
  };
}

const MISSING_FILES_AREA_MESSAGE = "attachment save requires the engine's attachmentStore option";
const MISSING_PRELIMINARY_UPLOAD_MESSAGE =
  "a preliminary upload requires the engine's attachmentStore option";

function isMissingFilesArea(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(MISSING_FILES_AREA_MESSAGE) || message.includes(MISSING_PRELIMINARY_UPLOAD_MESSAGE);
}

function writeCrashResponse(
  req: WorkersWriteRequest,
  error: unknown,
  diagnosis: string | undefined,
): WorkersWriteResponse {
  const message = error instanceof Error ? error.message : String(error);
  const detail = isMissingFilesArea(error) && diagnosis !== undefined && diagnosis !== ""
    ? `${message} ${diagnosis}`
    : message;
  const json =
    (req.pathname !== "/" && /\.json$/i.test(req.pathname)) ||
    (req.headers["accept"] ?? "").includes("application/json");
  if (json) {
    return {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ error_status: 500, errors: { server: detail } }, null, 2),
    };
  }
  return plainText(500, "The save could not be completed", detail);
}

function writePathOffResponse(): WorkersWriteResponse {
  return plainText(
    403,
    "Writes are off on this deployment",
    "This deck is deployed read-only. The deployment's DECKO_WRITE_PATH setting " +
      "is not 1, so no card can be created, edited, or deleted here.",
  );
}

export function signinFormPage(): WorkersWriteResponse {
  const field = (label: string, id: string, name: string, type: string): string =>
    `<p><label for="${id}">${label}</label><br>` +
    `<input id="${id}" name="${name}" type="${type}" autocomplete="off" size="40"></p>`;
  return {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body:
      `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title></head><body>` +
      `<h1>Sign in</h1>` +
      `<form action="${SIGNIN_FORM_ACTION}" method="post">` +
      `<input type="hidden" name="_method" value="patch">` +
      `<input type="hidden" name="success[redirect]" value="true">` +
      `<input type="hidden" name="success[mark]" value="*previous">` +
      field("Email", "signin_email", "card[subcards][+*email][content]", "text") +
      field("Password", "signin_password", "card[subcards][+*password][content]", "password") +
      `<p><button type="submit">Sign in</button></p>` +
      `</form></body></html>`,
  };
}

async function mountFirstRun(
  ctx: WorkersWriteContext,
  driver: SQLDatabaseDriver,
  req: WorkersWriteRequest,
  originPolicy: OriginPolicy,
): Promise<WorkersWriteResponse> {
  const result = await handleFirstRunRequest(
    { driver, fetcher: ctx.fetcher, originPolicy },
    {
      method: req.method,
      pathname: req.pathname,
      host: req.host,
      scheme: req.scheme,
      headers: req.headers,
      body: req.body,
      ...(req.search === undefined ? {} : { search: req.search }),
    },
  );
  if (result === null) {
    return plainText(
      501,
      "The first-run window could not be armed",
      "This deployment sets DECKO_FIRST_RUN=1, but its runtime did not make the " +
        "setting visible to the engine's gate, so /setup is not served.",
    );
  }
  expireAfterSave(ctx, result.expiryName);
  return { status: result.status, headers: result.headers, body: result.body };
}

async function mountWrite(
  ctx: WorkersWriteContext,
  driver: SQLDatabaseDriver,
  req: WorkersWriteRequest,
  originPolicy: OriginPolicy,
): Promise<WorkersWriteResponse> {
  let result: WriteRouteResponse | null;
  try {
    result = await handleWriteRequest(
    {
      driver,
      fetcher: ctx.fetcher,
      ipAddress: req.ipAddress,
      now: cardWallClockNow,
      originPolicy,
      ...(ctx.accountMail === undefined ? {} : { accountMail: ctx.accountMail, notifyTransport: ctx.accountMail.transport }),
      renderSlot: async (name, view, _subcardNames, opts) => {
        ctx.fetcher.expireName(name);
        ctx.renderEngine.expireRenderCard(name);
        if (ctx.renderSavedSlot !== undefined) return await ctx.renderSavedSlot(name, view, opts);
        return ctx.renderEngine.render(
          name,
          view ?? "titled",
          opts?.absentCard === true ? { absentCard: true } : {},
        );
      },
      renderPreviewEditor: ctx.renderPreviewEditor ?? (async ({ name, opts }) => {
        const token = readSessionCookie(req.headers.cookie);
        const actor = token === null ? null : await new SessionStore({ driver }).lookupSession(token);
        if (actor === null) throw new Error("upload preview requires the authenticated request session");
        ctx.fetcher.expireName(name);
        const render = new RenderEngine(ctx.fetcher);
        render.viewer = await withVisitorEnabledRoles(ctx.fetcher,
          { signedIn: true, actorId: actor.id }, req.headers.cookie);
        render.pageSession = render.viewer;
        render.imageCdnHost = ctx.renderEngine.imageCdnHost;
        return await render.render(name, "preview_editor", { viewOpts: opts });
      }),
      scssCompiler: edgeScssCompiler,
      coffeeCompiler: edgeCoffeeCompiler,
      javascriptValidator: staticUglifyHarmonySyntaxError,
      ...(ctx.attachmentStore === undefined ? {} : { attachmentStore: ctx.attachmentStore }),
      ...(ctx.delayedJobs === undefined ? {} : { delayedJobs: ctx.delayedJobs }),
    },
    {
      method: req.method,
      pathname: req.pathname,
      search: req.search,
      host: req.host,
      scheme: req.scheme,
      headers: req.headers,
      body: req.body,
      bodyBytes: req.bodyBytes,
    },
    );
  } catch (error) {
    return writeCrashResponse(req, error, ctx.attachmentStoreDiagnosis);
  }
  if (result === null) {
    return plainText(405, "Method not allowed", "That is not a card write route on this deck.");
  }
  expireAfterSave(ctx, result.expiryName);
  return {
    status: result.status,
    headers: result.headers,
    body: result.body,
    ...(result.visitorCookie === undefined ? {} : { extraCookies: [result.visitorCookie] }),
  };
}

function expireAfterSave(ctx: WorkersWriteContext, expiryName: string | undefined): void {
  if (expiryName === undefined || expiryName === "") return;
  expireRenderCachesAfterSave(
    {
      fetcher: ctx.fetcher,
      renderEngine: ctx.renderEngine,
      signedInEngines: [],
    },
    { status: 200, headers: {}, body: "", expiryName },
  );
}

export async function handleWorkersWriteSurface(
  ctx: WorkersWriteContext,
  req: WorkersWriteRequest,
  env: WriteSurfaceFlags & { readonly DB?: D1DatabaseLike },
): Promise<WorkersWriteResponse | null> {
  const firstRun = firstRunArmed(env);
  const write = writePathArmed(env);
  syncGateToProcessEnv("DECKO_FIRST_RUN", firstRun);
  syncGateToProcessEnv("DECKO_WRITE_PATH", write);

  const readMethod = req.method === "GET" || req.method === "HEAD";

  if (firstRun && (req.method === "GET" || req.method === "POST") && req.pathname === SETUP_PATH) {
    return mountFirstRun(ctx, resolveDriver(ctx, env), req, applySecuritySettings(env));
  }

  if (write && req.method === "GET" && req.pathname === WORKERS_SIGNIN_PATH) {
    return signinFormPage();
  }

  if (readMethod) {
    if (write && req.method === "GET" && /^\/(?:card\/)?update\/[^/]+$/.test(req.pathname)) {
      return mountWrite(ctx, resolveDriver(ctx, env), req, applySecuritySettings(env));
    }
    return null;
  }
  const originPolicy = applySecuritySettings(env);
  if (!write) {
    const auth = await handleAuthOnlyRequest(
      {
        driver: resolveDriver(ctx, env),
        fetcher: ctx.fetcher,
        ipAddress: req.ipAddress,
        originPolicy,
      },
      {
        method: req.method,
        pathname: req.pathname,
        search: req.search,
        host: req.host,
        scheme: req.scheme,
        headers: req.headers,
        body: req.body,
        bodyBytes: req.bodyBytes,
      },
    );
    if (auth !== null) return auth;
    return writePathOffResponse();
  }
  return mountWrite(ctx, resolveDriver(ctx, env), req, originPolicy);
}

export function applySecuritySettings(env: WriteSurfaceFlags): OriginPolicy {
  configurePasswordHashing(passwordHashPolicyFromEnv(env));
  configureSigninSecurity(signinSecurityPolicyFromEnv(env));
  configureStrictParity(strictParityFlagsFromEnv(env));
  configureSetupToken(env.DECKO_SETUP_TOKEN);
  return originPolicyFromEnv(env);
}

export function resolveDriver(ctx: WorkersWriteContext, env: WriteSurfaceFlags & { readonly DB?: D1DatabaseLike }): SQLDatabaseDriver {
  if (ctx.driver !== undefined) return ctx.driver;
  if (env.DB === undefined) {
    throw new Error(
      "write surface needs a storage binding: pass ctx.driver (host adapter) or env.DB (the D1 binding)",
    );
  }
  return new CloudflareD1Adapter(env.DB);
}

export { SESSION_COOKIE_NAME, SETUP_PATH };
