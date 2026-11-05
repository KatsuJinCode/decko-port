import type { SQLDatabaseDriver } from "./driver.js";
import { CARD_CODENAME_BY_KEY_SQL } from "../card/fetch/card-read-shapes.js";
import type { NotifyTransport } from "../card/notify/types.js";
import type { FetchEngine } from "../card/fetch.js";
import { composeCardRecord, type CardRecord } from "../card/fetch/card-record.js";
import type { CardsRow } from "./schema.js";
import { SessionStore } from "../card/auth/index.js";
import { signinAccount } from "../card/auth/signin.js";
import { signinSecurityPolicy } from "../card/auth/signin-security.js";
import {
  confirmAccountVerification,
  confirmPasswordReset,
  sendAccountVerificationToken,
  sendAccountWelcomeEmail,
  sendResetPasswordToken,
  type AccountFlowContext,
} from "../card/auth/account-verify-reset-flows.js";
import {
  createCardActionEngineForSession,
  actorFromToken,
} from "../card/actions/engine-for-session.js";
import {
  abstractListEventsSetMember,
  rightSetMember,
  typePlusRightSetMember,
} from "../card/mod-loader/mod-event-set-membership.js";
import { withVisitorEnabledRoles } from "../card/session/enabled-roles.js";
import type { DelayedJobsConfig } from "../card/delayed-job/delayed-job.js";
import { CardActionError, type ActionResult, type CreateCardInput, type AttachmentInput, type SubcardInput } from "../card/actions/types.js";
import { DatabaseOutcomeUnknownError } from "./driver.js";
import { CommittedSaveCleanupError, SaveOutcomeUnknownError, saveOutcomeDiagnostic } from "../card/actions/save-outcome.js";
import { StrictParityCrashError } from "../card/parity/strict-parity-flags.js";
import { SERVER_ERROR_HTML } from "../card/render/debug-server-error.js";
import type { CardActionEngine } from "../card/actions/card-action-engine.js";
import type { CardActionRecaptchaConfig } from "../card/actions/card-action-engine.js";
import type { ModEventRuntime, ModEventStageReport } from "../card/mod-loader/mod-event-dispatch.js";
import type { ModEngineHost } from "../card/mod-loader/mod-manifest.js";
import type { AttachmentStore } from "../card/attachments/attachment-store.js";
import type { ScssCompiler } from "../card/assets/scss-compiler.js";
import type { CoffeeCompiler } from "../card/assets/coffee-compiler.js";
import type { ScriptCompressor } from "../card/assets/script-compressor.js";
import type { JavascriptSyntaxValidator } from "../card/assets/javascript-syntax-validator.js";
import { DeckoName } from "../card/name.js";
import { parseMultipartForm, type MultipartFilePart } from "./multipart-form.js";
import { decodeUriComponentSafe } from "./decode-uri-component-safe.js";
import {
  discardLocationsFor,
  previousLocation,
  readVisitorSession,
  saveLocation,
  storeSessionCardContent,
  visitorSessionCookie,
  type VisitorSession,
} from "../card/session/visitor-session.js";
import {
  CROSS_ORIGIN_MESSAGE,
  checkRequestOrigin,
  defaultOriginPolicy,
  type OriginPolicy,
} from "./request-origin.js";
import { actionpackTokenFromAuthorization } from "./request-authenticators.js";

export interface WriteRouteRequest {
  method: string;
  pathname: string;
  host: string | undefined;
  scheme?: "http" | "https";
  search?: string;
  headers: Record<string, string | undefined>;
  body: string;
  bodyBytes?: Uint8Array;
}

export interface WriteRouteContext {
  driver: SQLDatabaseDriver;
  fetcher: FetchEngine;
  now?: () => Date;
  ipAddress?: string;
  renderSlot?: (
    name: string,
    view?: string,
    subcardNames?: string[],
    opts?: { absentCard?: boolean },
  ) => Promise<string>;
  renderErrorPage?: (name: string, view: string) => Promise<string>;
  renderPreviewEditor?: (input: {
    name: string;
    opts: Record<string, unknown>;
  }) => Promise<string>;
  followMail?: { origin: string; deckoBotEmail: string };
  delayedJobs?: DelayedJobsConfig;
  previousLocation?: () => string | undefined;
  originPolicy?: OriginPolicy;
  attachmentStore?: AttachmentStore;
  scssCompiler?: ScssCompiler;
  coffeeCompiler?: CoffeeCompiler;
  compressAssets?: boolean;
  scriptCompressor?: ScriptCompressor;
  javascriptValidator?: JavascriptSyntaxValidator;
  fileStorage?: string;
  recaptcha?: CardActionRecaptchaConfig;
  onModEventReport?: (report: ModEventStageReport) => void;
  accountMail?: Omit<AccountFlowContext, "driver" | "fetcher" | "sessions">;
  notifyTransport?: NotifyTransport;
}

export interface WriteRouteResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  expiryName?: string;
  expiryNames?: string[];
  visitorCookie?: string;
}

export function writePathEnabled(): boolean {
  return process.env.DECKO_WRITE_PATH === "1";
}

export const SESSION_COOKIE_NAME = "decko_ts_session";
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 48;

export function readSessionCookie(cookieHeader: unknown): string | null {
  if (typeof cookieHeader !== "string" || cookieHeader === "") return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) {
      const value = part.slice(eq + 1).trim();
      return value === "" ? null : value;
    }
  }
  return null;
}

export function sessionCookieHeader(token: string, secure = false): string {
  return (
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${SESSION_COOKIE_MAX_AGE}${secure ? "; Secure" : ""}`
  );
}

export function clearedSessionCookieHeader(secure = false): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export type CookieSecureSetting = "auto" | "always" | "never";

function cookieSecureSetting(): CookieSecureSetting {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const raw = (proc?.env?.["DECKO_COOKIE_SECURE"] ?? "").trim().toLowerCase();
  if (raw === "" || raw === "auto") return "auto";
  if (raw === "always" || raw === "never") return raw;
  throw new Error(`DECKO_COOKIE_SECURE must be "auto", "always" or "never", got ${JSON.stringify(raw)}`);
}

export function sessionCookieSecure(
  req: Pick<WriteRouteRequest, "scheme" | "headers">,
  setting: CookieSecureSetting = cookieSecureSetting(),
): boolean {
  if (setting === "always") return true;
  if (setting === "never") return false;
  if (req.scheme === "https") return true;
  const forwarded = req.headers["x-forwarded-proto"];
  return typeof forwarded === "string" && forwarded.split(",")[0]!.trim().toLowerCase() === "https";
}

interface ParsedBody {
  card: Record<string, string>;
  subcards: Record<string, Record<string, string>>;
  subcardTree: Record<string, ParsedSubcard>;
  success: Record<string, string>;
  slotParams: Record<string, string>;
  cardFiles: Record<string, MultipartFilePart>;
  cardArrays: Record<string, string[]>;
  token?: string;
  methodOverride?: string;
  simulateXhr?: boolean;
  isMain?: string;
  slotterMode?: string;
  comment?: string;
  commentAuthor?: string;
  draft?: string;
  recaptchaToken?: string;
  lookInTrash?: boolean;
  revertActions?: string[];
  revertTo?: string;
  revertAct?: string;
  attachmentUpload?: string;
  addItem?: string[];
  dropItem?: string[];
  insertItem?: string;
  itemIndex?: string;
  task?: string;
  colorsParams?: Record<string, string>;
  themeColorsParams?: Record<string, string>;
}

function applyParam(
  parsed: ParsedBody,
  key: string,
  value: string,
): void {
  if (key.startsWith("card[subcards][")) {
    const segments = [...key.slice("card".length).matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]).slice(1);
    addSubcardParam(parsed.subcardTree, segments, value);
    if (segments.length === 2) {
      const slot = (parsed.subcards[segments[0]] ??= {});
      slot[segments[1]] = value;
    } else if (segments.length === 1) {
      const slot = (parsed.subcards[segments[0]] ??= {});
      slot["content"] = value;
    }
    return;
  }
  const arrayMatch = CARD_ARRAY_KEY.exec(key);
  if (arrayMatch !== null) {
    (parsed.cardArrays[arrayMatch[1]] ??= []).push(value);
    return;
  }
  const cardMatch = /^card\[(.+)\]$/.exec(key);
  if (cardMatch !== null) {
    parsed.card[cardMatch[1]] = value;
    return;
  }
  const successMatch = /^success\[([^\]]+)\]$/.exec(key);
  if (successMatch !== null) {
    parsed.success[successMatch[1]] = value;
    return;
  }
  const slotMatch = /^slot\[([^\]]+)\]$/.exec(key);
  if (slotMatch !== null) {
    parsed.slotParams[slotMatch[1]] = value;
    return;
  }
  if (key === "is_main") parsed.isMain = value;
  if (key === "token") parsed.token = value;
  else if (key === "_method") parsed.methodOverride = value;
  else if (key === "simulate_xhr") parsed.simulateXhr = value !== "";
  else if (key === "is_main") parsed.isMain = value;
  else if (key === "comment") parsed.comment = value;
  else if (key === "comment_author") parsed.commentAuthor = value;
  else if (key === "draft") parsed.draft = value;
  else if (key === "recaptcha_token") parsed.recaptchaToken = value;
  else if (key === "slotter_mode") parsed.slotterMode = value;
  else if (key === "look_in_trash") parsed.lookInTrash = value !== "" && value !== "false";
  else if (key === "revert_actions[]" || key === "revert_actions") {
    (parsed.revertActions ??= []).push(value);
  } else if (key === "revert_to") parsed.revertTo = value;
  else if (key === "revert_act") parsed.revertAct = value;
  else if (key === "attachment_upload") parsed.attachmentUpload = value;
  else if (key === "add_item" || key === "add_item[]") (parsed.addItem ??= []).push(value);
  else if (key === "drop_item" || key === "drop_item[]") (parsed.dropItem ??= []).push(value);
  else if (key === "insert_item") parsed.insertItem = value;
  else if (key === "item_index") parsed.itemIndex = value;
  else if (key === "task") parsed.task = value;
  else if (key.startsWith("colors[") || key.startsWith("theme_colors[")) {
    const prefix = key.startsWith("colors[") ? "colors[" : "theme_colors[";
    const name = key.slice(prefix.length, key.endsWith("]") ? -1 : undefined);
    if (name !== "") {
      const bag = prefix === "colors[" ? (parsed.colorsParams ??= {}) : (parsed.themeColorsParams ??= {});
      bag[name] = value;
    }
  }
}

const CARD_ARRAY_KEY = /^card\[([^[\]]+)\]\[\]$/;

function pointerItemsContent(values: readonly string[]): string {
  return values
    .map((item) => item.trim().replace(/^\[\[/, "").replace(/\]\]$/, ""))
    .filter((item) => item.trim() !== "")
    .join("\n");
}

function foldCardArrays(parsed: ParsedBody): ParsedBody {
  const names = Object.keys(parsed.cardArrays);
  if (names.length === 0) return parsed;
  const card = { ...parsed.card };
  for (const name of names) card[name] = pointerItemsContent(parsed.cardArrays[name]);
  return { ...parsed, card };
}

function listItemsOf(content: string): string[] {
  return content
    .split(/\n+/)
    .map((item) => item.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").trim())
    .filter((item) => item !== "");
}

function itemIdentity(item: string): string {
  try {
    return DeckoName.parse(item).key;
  } catch {
    return item;
  }
}

function listItemContent(parsed: ParsedBody, base: string): string | undefined {
  if (parsed.addItem === undefined && parsed.dropItem === undefined && parsed.insertItem === undefined) {
    return undefined;
  }
  let items = listItemsOf(base);
  for (const add of parsed.addItem ?? []) items = [...items, add.trim()];
  for (const drop of parsed.dropItem ?? []) {
    const identity = itemIdentity(drop.trim());
    items = items.filter((item) => itemIdentity(item) !== identity);
  }
  if (parsed.insertItem !== undefined) {
    const name = parsed.insertItem.trim();
    const identity = itemIdentity(name);
    items = items.filter((item) => itemIdentity(item) !== identity);
    const index = Number.parseInt(parsed.itemIndex ?? "0", 10);
    items.splice(Number.isFinite(index) && index >= 0 ? index : 0, 0, name);
  }
  return items.join("\n");
}

function applyQuery(parsed: ParsedBody, search: string | undefined): ParsedBody {
  if (search === undefined || search === "" || search === "?") return parsed;
  const fromQuery = emptyParsedBody();
  for (const [key, value] of new URLSearchParams(search).entries()) {
    applyParam(fromQuery, key, value);
  }
  return {
    ...fromQuery,
    ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined)),
    card: { ...fromQuery.card, ...parsed.card },
    subcards: { ...fromQuery.subcards, ...parsed.subcards },
    subcardTree: { ...fromQuery.subcardTree, ...parsed.subcardTree },
    success: { ...fromQuery.success, ...parsed.success },
    cardArrays: { ...fromQuery.cardArrays, ...parsed.cardArrays },
    cardFiles: parsed.cardFiles,
  } as ParsedBody;
}

interface ParsedSubcard {
  fields: Record<string, string>;
  subcards: Record<string, ParsedSubcard>;
}

function addSubcardParam(tree: Record<string, ParsedSubcard>, segments: string[], value: string): void {
  let level = tree;
  let i = 0;
  while (i < segments.length) {
    const node = (level[segments[i]] ??= { fields: {}, subcards: {} });
    const rest = segments.length - i - 1;
    if (rest === 0) {
      node.fields["content"] = value;
      return;
    }
    if (rest === 1) {
      node.fields[segments[i + 1]] = value;
      return;
    }
    if (rest < 3 || segments[i + 1] !== "subcards") return;
    level = node.subcards;
    i += 2;
  }
}

function requestParamsForEvents(parsed: ParsedBody): Record<string, unknown> {
  const params: Record<string, unknown> = { ...parsed.card };
  if (parsed.draft !== undefined) params["draft"] = parsed.draft;
  if (parsed.comment !== undefined) params["comment"] = parsed.comment;
  if (parsed.commentAuthor !== undefined) params["comment_author"] = parsed.commentAuthor;
  if (parsed.recaptchaToken !== undefined) params["recaptcha_token"] = parsed.recaptchaToken;
  if (parsed.token !== undefined) params["token"] = parsed.token;
  if (parsed.addItem !== undefined) params["add_item"] = parsed.addItem;
  if (parsed.dropItem !== undefined) params["drop_item"] = parsed.dropItem;
  if (parsed.insertItem !== undefined) params["insert_item"] = parsed.insertItem;
  if (parsed.itemIndex !== undefined) params["item_index"] = parsed.itemIndex;
  if (parsed.task !== undefined) params["task"] = parsed.task;
  return params;
}

function subcardTreeFromJson(raw: unknown): Record<string, ParsedSubcard> {
  const out: Record<string, ParsedSubcard> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const node: ParsedSubcard = { fields: {}, subcards: {} };
    if (typeof value === "string" || typeof value === "number") {
      node.fields["content"] = String(value);
      out[key] = node;
      continue;
    }
    if (typeof value !== "object") continue;
    for (const [field, v] of Object.entries(value as Record<string, unknown>)) {
      if (field === "subcards") node.subcards = subcardTreeFromJson(v);
      else if (typeof v === "string") node.fields[field] = v;
      else if (typeof v === "number") node.fields[field] = String(v);
    }
    out[key] = node;
  }
  return out;
}

function jsonCardArrays(rawCard: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(rawCard)) {
    if (!Array.isArray(value)) continue;
    out[key] = value
      .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
      .map((item) => String(item));
  }
  return out;
}

function emptyParsedBody(): ParsedBody {
  return { card: {}, subcards: {}, subcardTree: {}, success: {}, slotParams: {}, cardFiles: {}, cardArrays: {} };
}

function parseBody(req: WriteRouteRequest): ParsedBody {
  const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (contentType === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams(req.body);
    const parsed = emptyParsedBody();
    for (const [key, value] of params.entries()) {
      applyParam(parsed, key, value);
    }
    return parsed;
  }
  if (contentType === "multipart/form-data") {
    if (req.bodyBytes === undefined) return emptyParsedBody();
    const parsed = emptyParsedBody();
    let parts: ReturnType<typeof parseMultipartForm>;
    try {
      parts = parseMultipartForm(req.bodyBytes, req.headers["content-type"] ?? "");
    } catch {
      throw new Error("bad content body");
    }
    for (const part of parts) {
      if (part.kind === "file") {
        const cardMatch = /^card\[(.+)\]$/.exec(part.name);
        parsed.cardFiles[cardMatch !== null ? cardMatch[1] : part.name] = part;
      } else {
        applyParam(parsed, part.name, part.value);
      }
    }
    return parsed;
  }
  if (contentType === "application/json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(req.body) as unknown;
    } catch {
      throw new CardActionError("name-illegal", "request body is not valid JSON");
    }
    if (typeof parsed !== "object" || parsed === null) {
      return emptyParsedBody();
    }
    const obj = parsed as Record<string, unknown>;
    const rawCard = typeof obj["card"] === "object" && obj["card"] !== null
      ? (obj["card"] as Record<string, unknown>)
      : {};
    const card: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawCard)) {
      if (typeof value === "string") card[key] = value;
      else if (typeof value === "number") card[key] = String(value);
    }
    const success: Record<string, string> = {};
    const rawSuccess = typeof obj["success"] === "object" && obj["success"] !== null
      ? (obj["success"] as Record<string, unknown>)
      : {};
    for (const [key, value] of Object.entries(rawSuccess)) {
      if (typeof value === "string") success[key] = value;
    }
    const subcardTree = subcardTreeFromJson(rawCard["subcards"]);
    const subcards: Record<string, Record<string, string>> = {};
    for (const [k, node] of Object.entries(subcardTree)) subcards[k] = { ...node.fields };
    return {
      card,
      subcards,
      subcardTree,
      success,
      slotParams: {},
      cardFiles: {},
      cardArrays: jsonCardArrays(rawCard),
      token: typeof obj["token"] === "string" ? obj["token"] : undefined,
      methodOverride: typeof obj["_method"] === "string" ? obj["_method"] : undefined,
      simulateXhr: obj["simulate_xhr"] === true || obj["simulate_xhr"] === "true",
      draft:
        typeof obj["draft"] === "string"
          ? obj["draft"]
          : obj["draft"] === true
            ? "true"
            : undefined,
    };
  }
  return emptyParsedBody();
}

export function tokenFromRequest(
  req: WriteRouteRequest,
  parsed: { readonly token?: string | undefined },
): string | null {
  const fromHeader = actionpackTokenFromAuthorization(req.headers["authorization"]);
  if (fromHeader !== null) return fromHeader;
  return parsed.token ?? null;
}

type WriteVerb = "create" | "update" | "delete";

interface RouteMatch {
  verb: WriteVerb;
  mark?: string;
  typeShortcut?: string;
  json: boolean;
}

function matchRoute(method: string, pathname: string): RouteMatch | null {
  const post = method === "POST";
  const put = method === "PUT" || method === "PATCH";
  const patch = method === "PATCH";
  const del = method === "DELETE";
  if (method === "GET") {
    const explicit = /^\/(?:card\/)?update(?:\/([^/]+))?$/.exec(pathname);
    if (explicit !== null && (pathname.startsWith("/card/update") || explicit[1] !== undefined)) {
      return { verb: "update", mark: explicit[1], json: false };
    }
  }
  if (!post && !put && !del) return null;
  if (pathname === "/" || pathname === "") {
    if (post) return { verb: "create", json: false };
    if (put) return { verb: "update", json: false };
    if (del) return { verb: "delete", json: false };
    return null;
  }
  const explicitMatch = /^\/(card\/)?(create|update|delete)(?:\/([^/]+))?$/.exec(pathname);
  if (explicitMatch !== null) {
    const prefix = explicitMatch[1];
    const verb = explicitMatch[2] as WriteVerb;
    const mark = explicitMatch[3];
    if (prefix !== undefined || mark !== undefined) {
      if (verb === "create" && !(post || patch)) return null;
      if (verb === "update" && !(post || put)) return null;
      if (verb === "delete" && !del) return null;
      return { verb, mark, json: false };
    }
  }
  if (post) {
    const typed = /^\/type\/(.+)$/.exec(pathname);
    if (typed !== null) return { verb: "create", typeShortcut: decodeUriComponentSafe(typed[1]), json: false };
    if (!pathname.slice(1).includes("/")) {
      return { verb: "create", mark: pathname.slice(1), json: false };
    }
    return null;
  }
  if (put) {
    return pathname.slice(1).includes("/") ? null : { verb: "update", mark: pathname.slice(1), json: false };
  }
  return pathname.slice(1).includes("/") ? null : { verb: "delete", mark: pathname.slice(1), json: false };
}

function markToName(mark: string): string {
  const withoutFormat = mark.replace(/\.json$/i, "");
  return decodeUriComponentSafe(withoutFormat).replace(/_/g, " ");
}

async function warmIdMarks(
  fetcher: FetchEngine,
  ...marks: readonly (string | undefined)[]
): Promise<number | undefined> {
  for (const mark of marks) {
    if (mark === undefined) continue;
    const match = /^~(\d+)$/.exec(markToName(mark).trim());
    if (match === null) continue;
    const id = Number(match[1]);
    const name = await fetcher.lexicon.name(id);
    if (name === undefined || name.s === "") return id;
  }
  return undefined;
}

function effectiveMethod(method: string, parsed: ParsedBody): string {
  if (method !== "POST") return method;
  const override = parsed.methodOverride?.trim().toUpperCase();
  if (override === "PATCH" || override === "PUT" || override === "DELETE") return override;
  return method;
}

function ajaxSaveRedirects(): boolean {
  const env = typeof process !== "undefined" ? process.env : undefined;
  return env?.DECKO_AJAX_SAVE_REDIRECT === "1";
}

function isAjax(req: WriteRouteRequest, parsed: ParsedBody): boolean {
  if (parsed.simulateXhr) return true;
  return /XMLHttpRequest/i.test(req.headers["x-requested-with"] ?? "");
}

function htmlResponse(status: number, title: string, bodyHtml: string): WriteRouteResponse {
  return {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body: `<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title></head><body>${bodyHtml}</body></html>`,
  };
}

function jsonResponse(status: number, payload: unknown): WriteRouteResponse {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(payload),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function crossOriginResponse(json: boolean, reason: string): WriteRouteResponse {
  const message = `${CROSS_ORIGIN_MESSAGE} (${reason})`;
  return json
    ? jsonResponse(403, { error: { code: "cross-origin", message } })
    : htmlResponse(403, "Error (cross-origin)", `<pre>${escapeHtml(message)}</pre>`);
}

function errorStatus(code: CardActionError["code"]): number {
  if (code === "not-found") return 404;
  if (code === "server-error") return 500;
  if (code === "conflict") return 409;
  if (code === "anonymous-actor" || code === "permission-denied") return 403;
  return 422;
}

function denialText(signedIn: boolean): string {
  return signedIn
    ? "Sorry! You need permission to do that."
    : "Sorry! Please sign in or sign up to do that.";
}

function userFacingMessage(error: CardActionError, signedIn: boolean): string {
  if (errorStatus(error.code) === 403) return denialText(signedIn);
  return error.userMessage ?? error.message;
}

const MISSING_CARD_DELETE_MESSAGE = "USERERROR: Card::Error::UserError";

async function signedInFor(ctx: WriteRouteContext, sessionToken: string | null): Promise<boolean> {
  if (sessionToken === null) return false;
  return (await new SessionStore({ driver: ctx.driver }).lookupSession(sessionToken)) !== null;
}

async function renderRefusalPage(
  ctx: WriteRouteContext,
  cardName: string,
  status: number,
  errorEntries: Array<{ attribute: string; message: string }> | undefined,
  signedIn: boolean,
  sessionToken: string | null,
  cookieHeader: unknown,
  newCardType?: string,
): Promise<string> {
  const view = status === 403 ? "denial" : status === 404 ? "not_found" : "errors";
  return renderErrorPage(ctx, cardName, view, errorEntries, sessionToken, cookieHeader, newCardType);
}

async function renderErrorPage(
  ctx: WriteRouteContext,
  cardName: string,
  view: "denial" | "not_found" | "errors" | "server_error",
  errorEntries: Array<{ attribute: string; message: string }> | undefined,
  sessionToken: string | null,
  cookieHeader: unknown,
  newCardType?: string,
): Promise<string> {
  const [{ FetchEngine }, { RenderEngine }, { renderPageWithStatus }] =
    await Promise.all([
      import("../card/fetch.js"),
      import("../card/render.js"),
      import("../card/render/page.js"),
    ]);
  const fetcher = new FetchEngine(ctx.driver);
  const probe = await fetcher.fetchByKey(DeckoName.parse(cardName).key);
  const engine = new RenderEngine(fetcher);
  if (probe === undefined || probe.trash) engine.renderAbsentCards = true;
  const actor = await actorFromToken(ctx.driver, sessionToken);
  const viewer = await withVisitorEnabledRoles(
    fetcher,
    actor === null ? { signedIn: false } : { signedIn: true, actorId: actor.id },
    typeof cookieHeader === "string" ? cookieHeader : undefined,
  );
  engine.viewer = viewer;
  if (actor !== null) engine.pageSession = viewer;
  if (view === "denial") engine.pageLoudDenialTaskPhrase = "do that";
  if (errorEntries !== undefined && errorEntries.length > 0) {
    engine.attachedErrorsByKey.set(DeckoName.parse(cardName).key, errorEntries);
  }
  const { html } = await renderPageWithStatus(
    engine,
    cardName,
    view,
    newCardType !== undefined && probe === undefined ? { newCard: { typeName: newCardType } } : undefined,
  );
  return html;
}

function refusalPageErrorEntries(error: CardActionError): Array<{ attribute: string; message: string }> {
  if (error.errorsByAttribute !== undefined) {
    return Object.entries(error.errorsByAttribute).map(([attribute, message]) => ({ attribute, message }));
  }
  const shown = error.userMessage ?? error.message;
  const sep = error.userMessage !== undefined ? shown.indexOf(": ") : -1;
  const key = sep > 0 ? shown.slice(0, sep) : undefined;
  return shown.split("\n").map((line) => {
    if (key === undefined) return { attribute: "abort", message: line };
    const stripped = line.startsWith(`${key}: `) ? line.slice(key.length + 2) : line;
    return { attribute: key.toLowerCase(), message: stripped };
  });
}

export function jsonErrorsViewHash(error: CardActionError, signedIn: boolean): Record<string, string> {
  if (error.errorsByAttribute !== undefined) return { ...error.errorsByAttribute };
  if (errorStatus(error.code) === 403) return { permission_denied: error.message };
  if (error.code === "recaptcha") return { recaptcha: error.message };
  const shown = userFacingMessage(error, signedIn);
  const out: Record<string, string> = {};
  for (const line of shown.split("\n")) {
    const m = /^([A-Z0-9_*+ ]+): ([\s\S]*)$/.exec(line.trim());
    if (m !== null) out[m[1].toLowerCase()] = m[2];
  }
  if (Object.keys(out).length === 0 && shown !== "") out["error"] = shown;
  return out;
}

function formatUtcTimestamp(d: Date): string {
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function requestUrl(req: WriteRouteRequest): string {
  return `${req.scheme ?? "http"}://${req.host ?? ""}${req.pathname}`;
}

function errorResponse(
  json: boolean,
  error: CardActionError,
  signedIn = false,
  meta?: { url: string; now: Date },
  opts?: { ajax?: boolean; getAlternative?: boolean },
): WriteRouteResponse {
  const status = errorStatus(error.code);
  if (json) {
    const payload: Record<string, unknown> = {
      error_status: status,
      errors: jsonErrorsViewHash(error, signedIn),
    };
    if (meta !== undefined) {
      payload["url"] = meta.url;
      payload["requested_at"] = formatUtcTimestamp(meta.now);
    }
    return {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify(payload, null, 2),
    };
  }
  if (status === errorStatus("user-error") || error.code === "conflict") {
    return htmlResponse(status, `Error (${error.code})`, cardErrorAlertHtml(error));
  }
  if (opts?.ajax === true && error.cardName !== undefined) {
    return htmlResponse(status, `Error (${error.code})`, cardErrorAlertHtml(error));
  }
  return htmlResponse(
    status,
    `Error (${error.code})`,
    `<pre>${escapeHtml(userFacingMessage(error, signedIn))}</pre>${diagnosticComment(error, signedIn)}`,
  );
}

const RUBY_ALERT_CLASS = "alert alert-warning alert-dismissible  card-error-msg";

function rubyErrorMessageHtml(key: string | undefined, message: string): string {
  return key === undefined || key === ""
    ? escapeHtml(message)
    : `<p><strong>${escapeHtml(key)}:</strong> ${escapeHtml(message)}</p>`;
}

function cardErrorAlertHtml(error: CardActionError): string {
  const shown = error.userMessage ?? error.message;
  const sep = error.userMessage !== undefined ? shown.indexOf(": ") : -1;
  const key = sep > 0 ? shown.slice(0, sep) : undefined;
  const message = sep > 0 ? shown.slice(sep + 2) : shown;
  const heading =
    error.cardName !== undefined ? `Problems with ${escapeHtml(error.cardName)}` : undefined;
  return (
    `<div class="${RUBY_ALERT_CLASS}" role="alert">` +
    `<button type="button" data-bs-dismiss="alert" class="btn-close" aria-label="Close"></button>` +
    (heading !== undefined ? `<h4 class="alert-heading error">${heading}</h4>` : "") +
    rubyErrorMessageHtml(key, message) +
    `</div>`
  );
}

function errorAlertFragmentHtml(cardName: string, key: string | undefined, message: string): string {
  return (
    `<div class="${RUBY_ALERT_CLASS}" role="alert">` +
    `<button type="button" data-bs-dismiss="alert" class="btn-close" aria-label="Close"></button>\n` +
    `<h4 class="alert-heading error">Problems with ${escapeHtml(cardName)}</h4>\n` +
    rubyErrorMessageHtml(key, message) +
    `</div>`
  );
}

function diagnosticComment(error: CardActionError, signedIn: boolean): string {
  if (userFacingMessage(error, signedIn) === error.message) return "";
  return `<!-- ${escapeHtml(error.message).replace(/--/g, "&#45;&#45;")} -->`;
}

export async function deckoBotAccountEmail(driver: SQLDatabaseDriver): Promise<string> {
  try {
    const r = await driver.query<{ email: string }>(
      "SELECT e.db_content AS email FROM cards e JOIN cards a ON a.id = e.left_id " +
        "JOIN cards b ON b.id = a.left_id WHERE b.codename = 'decko_bot' " +
        "AND a.right_id = (SELECT id FROM cards WHERE codename = 'account') " +
        "AND e.right_id = (SELECT id FROM cards WHERE codename = 'email') AND e.trash = 0",
      [],
    );
    const email = r.rows[0]?.email;
    if (typeof email === "string" && email !== "") return email;
  } catch {
  }
  return "no-reply@decko.org";
}

function cardUrl(req: WriteRouteRequest, path: string): string {
  if (req.host === undefined || req.host === "") return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `${req.scheme ?? "http"}://${req.host}${path}`;
}

function signinErrorAlertHtml(message: string, key?: string): string {
  const text = key !== undefined && message.startsWith(`${key}: `)
    ? message.slice(key.length + 2)
    : message;
  return (
    `<div class="${RUBY_ALERT_CLASS}" role="alert">` +
    `<button type="button" data-bs-dismiss="alert" class="btn-close" aria-label="Close"></button>` +
    `<h4 class="alert-heading error">Problems with *signin</h4>` +
    rubyErrorMessageHtml(key, text) +
    `</div>`
  );
}

function successResponse(
  req: WriteRouteRequest,
  json: boolean,
  name: string,
  saved: { cardId: number; actId: number; actionId: number; verb: WriteVerb },
  redirectPath: string = `/${locationName(name)}`,
  subcardNames?: string[],
): WriteRouteResponse {
  if (json) {
    return {
      ...jsonResponse(200, {
        card: { name, url: `/${locationName(name)}` },
        verb: saved.verb,
        card_id: saved.cardId,
        act_id: saved.actId,
        action_id: saved.actionId,
      }),
      ...(subcardNames !== undefined && subcardNames.length > 0 ? { expiryNames: subcardNames } : {}),
      expiryName: name,
    };
  }
  return {
    status: 303,
    headers: { Location: absoluteTarget(req, redirectPath), "Cache-Control": "no-store" },
    body: "",
    ...(subcardNames !== undefined && subcardNames.length > 0 ? { expiryNames: subcardNames } : {}),
    expiryName: name,
  };
}

async function saveVisitorSessionCard(
  ctx: WriteRouteContext,
  engine: CardActionEngine,
  req: WriteRouteRequest,
  json: boolean,
  parsed: ParsedBody,
  visit: VisitorSession,
  input: CreateCardInput,
  verb: "create" | "update",
): Promise<WriteRouteResponse> {
  const result = await engine.createCard(input);
  const name = DeckoName.parse(input.name).s;
  storeSessionCardContent(visit, name, input.content ?? undefined);
  if (parsed.success["reload"] === "true") {
    return { ...jsonResponse(200, { reload: true }), expiryName: name };
  }
  if (
    parsed.slotterMode === "silent-success" ||
    parsed.slotterMode === "update-modal-origin" ||
    parsed.slotterMode === "update-origin"
  ) {
    return { ...jsonResponse(200, { magic: true }), expiryName: name };
  }
  return successResponse(req, json, name, { ...result, verb },
    await successTargetPath(ctx.fetcher, parsed, name, visit));
}

function locationName(name: string): string {
  return encodeURI(DeckoName.parse(name).urlKey).replace(/[?#]/g, (c) => encodeURIComponent(c));
}

function absoluteTarget(req: WriteRouteRequest, target: string): string {
  return /^https?:\/\//.test(target) ? target : cardUrl(req, target);
}

async function successTargetPath(fetcher: FetchEngine, parsed: ParsedBody, ownName: string, visit: VisitorSession): Promise<string> {
  const mark = parsed.success["mark"] ?? parsed.success["id"];
  if (mark === undefined) return `/${locationName(ownName)}`;
  if (mark === "") return "";
  if (mark === "*previous" || mark === ":previous") return previousLocation(visit);
  if (/^(http|\/)/.test(mark)) return mark;
  if (mark === "_self") return `/${locationName(ownName)}`;
  const target = await fetcher.fetchByName(mark);
  return `/${locationName(target?.name?.s ?? mark)}`;
}

const SIGNIN_KEY = DeckoName.parse("*signin").key;

async function handleSigninUpdate(
  ctx: WriteRouteContext,
  req: WriteRouteRequest,
  json: boolean,
  parsed: ParsedBody,
  visit: VisitorSession,
): Promise<WriteRouteResponse> {
  const email = parsed.subcards["+*email"]?.content ?? "";
  const password = parsed.subcards["+*password"]?.content ?? "";
  const signinToken = tokenFromRequest(req, parsed) ?? readSessionCookie(req.headers.cookie);
  const fail = async (message: string, shown: string, key?: string): Promise<WriteRouteResponse> => {
    if (json) {
      return errorResponse(true, new CardActionError("user-error", message, shown), false, {
        url: requestUrl(req),
        now: ctx.now?.() ?? new Date(),
      });
    }
    if (isAjax(req, parsed)) {
      const fragment = errorAlertFragmentHtml(
        "*signin",
        key,
        key !== undefined && shown.startsWith(`${key}: `) ? shown.slice(key.length + 2) : shown,
      );
      return {
        status: 422,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        body: fragment,
      };
    }
    try {
      const pageHtml = await renderRefusalPage(
        ctx,
        "*signin",
        422,
        [
          {
            attribute: key !== undefined ? key.toLowerCase() : "abort",
            message: key !== undefined && shown.startsWith(`${key}: `) ? shown.slice(key.length + 2) : shown,
          },
        ],
        await signedInFor(ctx, signinToken),
        signinToken,
        req.headers.cookie,
      );
      return {
        status: 422,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        body: pageHtml,
      };
    } catch {
      return htmlResponse(422, "Error (signin-failure)", signinErrorAlertHtml(shown, key));
    }
  };
  if (parsed.card["trigger"] === "send_reset_password_token") {
    return handleResetPasswordTrigger(ctx, req, json, parsed, email, fail);
  }
  if (email === "" || password === "") {
    const field = email === "" ? "email" : "password";
    return fail(`${field} missing`, `${field} can't be blank`);
  }
  const sessions = new SessionStore({ driver: ctx.driver });
  const outcome = await signinAccount(ctx.driver, sessions, email, password, {
    clientAddress: ctx.ipAddress ?? req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"],
    now: ctx.now,
  });
  if (!outcome.ok) {
    const keyed = outcome.reason !== "email_missing" && outcome.reason !== "password_missing";
    return fail(outcome.message, outcome.message, keyed ? "SIGNIN" : undefined);
  }
  const target = absoluteTarget(req, await successTargetPath(ctx.fetcher, parsed, "*signin", visit));
  if (isAjax(req, parsed)) {
    const body = jsonResponse(200, { redirect: target });
    return {
      status: body.status,
      headers: { ...body.headers, "Set-Cookie": sessionCookieHeader(outcome.session.token, sessionCookieSecure(req)) },
      body: body.body,
    };
  }
  return {
    status: 303,
    headers: { Location: target, "Cache-Control": "no-store", "Set-Cookie": sessionCookieHeader(outcome.session.token, sessionCookieSecure(req)) },
    body: "",
  };
}

async function handleResetPasswordTrigger(
  ctx: WriteRouteContext,
  req: WriteRouteRequest,
  json: boolean,
  parsed: ParsedBody,
  email: string,
  fail: (message: string, shown: string, key?: string) => Promise<WriteRouteResponse>,
): Promise<WriteRouteResponse> {
  if (ctx.accountMail === undefined) {
    return fail("account mail is not configured on this host", "account mail is not configured on this host");
  }
  const outcome = await sendResetPasswordToken(
    {
      ...ctx.accountMail,
      driver: ctx.driver,
      fetcher: ctx.fetcher,
      sessions: new SessionStore({ driver: ctx.driver }),
    },
    email,
  );
  const hideAccountState =
    !outcome.ok && outcome.reason !== "blank_email" && signinSecurityPolicy().uniformFailure;
  if (!outcome.ok && !hideAccountState) {
    const key = outcome.reason === "not_active" ? "ACCOUNT" : "EMAIL";
    return fail(outcome.message, `${key}: ${outcome.message}`, key);
  }
  const view = parsed.success["view"];
  const path = view === undefined || view === ""
    ? `/${locationName("*signin")}`
    : `/${locationName("*signin")}/${encodeURIComponent(view)}`;
  if (json) return jsonResponse(200, { redirect: cardUrl(req, path) });
  return { status: 303, headers: { Location: cardUrl(req, path), "Cache-Control": "no-store" }, body: "" };
}

async function handleSignout(
  ctx: WriteRouteContext,
  req: WriteRouteRequest,
  json: boolean,
  parsed: ParsedBody,
  visit: VisitorSession,
): Promise<WriteRouteResponse> {
  const token = tokenFromRequest(req, parsed) ?? readSessionCookie(req.headers.cookie);
  if (token !== null) await new SessionStore({ driver: ctx.driver }).revokeSession(token);
  delete visit.history;
  visit.cards = {};
  delete visit.commentAuthor;
  const target = cardUrl(req, `/${locationName("*signin")}`);
  const headers = { "Cache-Control": "no-store", "Set-Cookie": clearedSessionCookieHeader(sessionCookieSecure(req)) };
  if (json) {
    const body = jsonResponse(200, { redirect: target });
    return { ...body, headers: { ...body.headers, ...headers } };
  }
  return { status: 303, headers: { ...headers, Location: target }, body: "" };
}

const WRITE_PATH_HOST: ModEngineHost = {
  fetchRenderCard: () => undefined,
  isDenied: () => {
    throw new Error(
      "the serving write path composes no read-permission surface (ModEngineHost.isDenied)",
    );
  },
  batch: async () => {
    throw new Error(
      "the serving write path composes no batch surface (ModEngineHost.batch)",
    );
  },
  codenames: {
    ensureLoaded: async () => {
      throw new Error(
        "the serving write path composes no codename surface (ModEngineHost.codenames.ensureLoaded)",
      );
    },
    peekId: () => {
      throw new Error(
        "the serving write path composes no codename surface (ModEngineHost.codenames.peekId)",
      );
    },
  },
  fetchById: async () => {
    throw new Error(
      "the serving write path composes no fetch surface (ModEngineHost.fetchById)",
    );
  },
  cacheFetchedRecord: async () => {
    throw new Error(
      "the serving write path composes no cache-write surface (ModEngineHost.cacheFetchedRecord)",
    );
  },
  composeAndCacheRows: async () => {
    throw new Error(
      "the serving write path composes no warm-compose surface (ModEngineHost.composeAndCacheRows)",
    );
  },
};

let servingModEventRuntimeSeat: Promise<ModEventRuntime> | undefined;
export function servingModEventRuntime(): Promise<ModEventRuntime> {
  servingModEventRuntimeSeat ??= (async () => {
    const [{ defaultDeckEventRuntime }] = await Promise.all([
      import("../card/mod-loader/default-mod-deck.js"),
    ]);
    return defaultDeckEventRuntime(WRITE_PATH_HOST);
  })();
  return servingModEventRuntimeSeat;
}

export async function observedModEventRuntime(ctx: WriteRouteContext): Promise<ModEventRuntime> {
  const runtime = await servingModEventRuntime();
  const codenameOfType = await typeCodenames(ctx.driver);
  const typeMember = typeSetMember(codenameOfType);
  const abstractListMember = abstractListEventsSetMember(ctx.driver);
  return {
    ...runtime,
    setMember: (setPath, card, event) => {
      const selfMatch = /^self\/(.+)$/.exec(setPath);
      if (selfMatch !== null) {
        return card.key !== undefined
          ? card.key === `*${selfMatch[1]}`
          : card.name !== "" && DeckoName.parse(card.name).key === `*${selfMatch[1]}`;
      }
      if (setPath.startsWith("abstract/attachment")) {
        const ownType = card.typeId === undefined || card.typeId === null
          ? undefined
          : codenameOfType.get(card.typeId);
        return ownType === "file" || ownType === "image";
      }
      if (setPath === "abstract/virtual_cache") {
        const right = DeckoName.parse(card.name).rightName;
        if (right === undefined) return false;
        return ctx.driver.query<{ codename: string | null }>(
          CARD_CODENAME_BY_KEY_SQL,
          [right.key],
        ).then(result => result.rows[0]?.codename === "asset_input");
      }
      const rightSupplied = rightSetMember(ctx.driver)(setPath, card);
      if (rightSupplied !== false) return rightSupplied;
      if (setPath === "right/enabled_roles") {
        const right = DeckoName.parse(card.name).rightName;
        if (right === undefined) return false;
        return ctx.driver.query<{ codename: string }>(
          CARD_CODENAME_BY_KEY_SQL,
          [right.key],
        ).then(result => result.rows[0]?.codename === "enabled_roles");
      }
      const typePlusRight = typePlusRightSetMember(ctx.driver);
      const supplied = typePlusRight(setPath, card);
      if (supplied !== false) return supplied;
      const abstractSupplied = abstractListMember(setPath, card, event);
      if (abstractSupplied !== false) return abstractSupplied;
      return typeMember(setPath, card);
    },
    ...(ctx.onModEventReport === undefined ? {} : { onReport: ctx.onModEventReport }),
  };
}

function typeSetMember(codenameOfType: ReadonlyMap<number, string>) {
  return (setPath: string, card: { typeId?: number | null; patternTypeId?: number | null }): boolean => {
    const match = /^type\/([^/]+)/.exec(setPath);
    if (match === null) return false;
    const memberTypeId = card.typeId;
    if (memberTypeId === undefined || memberTypeId === null) return false;
    const ownType = codenameOfType.get(memberTypeId);
    if (ownType === match[1]) return true;
    return (ownType === "set" && match[1] === "search_type") ||
      ((ownType === "set" || ownType === "search_type") && match[1] === "json");
  };
}

const typeCodenameCache = new WeakMap<object, Promise<Map<number, string>>>();
function typeCodenames(driver: SQLDatabaseDriver): Promise<Map<number, string>> {
  let cached = typeCodenameCache.get(driver);
  if (cached === undefined) {
    cached = driver
      .query<{ id: number; codename: string }>(
        "SELECT id, codename FROM cards WHERE codename IS NOT NULL AND codename <> '' AND trash = 0",
        [],
      )
      .then((r) => new Map(r.rows.map((row) => [Number(row.id), String(row.codename)])));
    typeCodenameCache.set(driver, cached);
  }
  return cached;
}

export async function handleWriteRequest(
  ctx: WriteRouteContext,
  req: WriteRouteRequest,
  opts?: { authOnly?: boolean },
): Promise<WriteRouteResponse | null> {
  const visit = readVisitorSession(req.headers.cookie);
  const before = visitorSessionCookie(visit);
  const res = await dispatchWriteRequest(ctx, req, opts, visit);
  if (res === null) return null;
  if (visitorSessionCookie(visit) === before) return res;
  return { ...res, visitorCookie: visitorSessionCookie(visit, { secure: req.scheme === "https" }) };
}

async function dispatchWriteRequest(
  ctx: WriteRouteContext,
  req: WriteRouteRequest,
  opts: { authOnly?: boolean } | undefined,
  visit: VisitorSession,
): Promise<WriteRouteResponse | null> {
  const json =
    (req.pathname !== "/" && /\.json$/i.test(req.pathname)) ||
    (req.headers["accept"] ?? "").includes("application/json");
  let parsed: ParsedBody;
  try {
    parsed = foldCardArrays(applyQuery(parseBody(req), req.search));
    parsed.comment = parsed.card["comment"] ?? parsed.comment;
    parsed.commentAuthor = parsed.card["comment_author"] ?? parsed.commentAuthor;
  } catch (error) {
    if (error instanceof CardActionError) {
      return errorResponse(json, error, false, { url: requestUrl(req), now: ctx.now?.() ?? new Date() });
    }
    throw error;
  }
  const method = effectiveMethod(req.method, parsed);

  const route = matchRoute(method, req.pathname);
  if (route === null) return null;

  if (opts?.authOnly !== true && method === "GET" && route.verb === "update" && route.mark !== undefined &&
      (parsed.card["trigger"] === "reset_password" || parsed.card["trigger"] === "verify_and_activate")) {
    if (ctx.accountMail === undefined) return { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, body: "account mail is not configured on this host" };
    const flow = { ...ctx.accountMail, driver: ctx.driver, fetcher: ctx.fetcher, sessions: new SessionStore({ driver: ctx.driver }), now: ctx.now, ipAddress: ctx.ipAddress ?? req.headers["x-forwarded-for"] ?? "127.0.0.1" };
    const token = new URLSearchParams(req.search ?? "").get("token") ?? "";
    const mark = markToName(route.mark);
    const outcome = parsed.card["trigger"] === "reset_password"
      ? await confirmPasswordReset(flow, mark, token)
      : await confirmAccountVerification(flow, mark, token);
    if (!outcome.ok) return {
      status: outcome.kind === "token_invalid" ? 403 : outcome.kind === "account_not_found" ? 404 : 422,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, body: outcome.message,
    };
    const prefix = (ctx.accountMail.relativeUrlRoot ?? "").replace(/\/$/, "");
    const target = outcome.redirectTo.name === "" ? `${prefix}/` : `${prefix}/${DeckoName.parse(outcome.redirectTo.name).urlKey}${outcome.redirectTo.view ? `/${outcome.redirectTo.view}` : ""}`;
    return { status: 303, headers: { Location: cardUrl(req, target), "Cache-Control": "no-store", "Set-Cookie": sessionCookieHeader(outcome.session.token, sessionCookieSecure(req)) }, body: "", expiryName: outcome.holder.name };
  }

  const originVerdict = checkRequestOrigin(
    { headers: req.headers, host: req.host },
    ctx.originPolicy ?? defaultOriginPolicy(),
  );
  if (!originVerdict.ok) return crossOriginResponse(json, originVerdict.reason);

  const missingId = await warmIdMarks(ctx.fetcher, route.mark, parsed.card["name"]);
  if (missingId !== undefined) {
    return errorResponse(
      json,
      new CardActionError("not-found", `id doesn't exist: ${missingId}`),
      false,
      { url: requestUrl(req), now: ctx.now?.() ?? new Date() },
    );
  }

  if (route.verb === "update" && route.mark !== undefined) {
    if (DeckoName.parse(markToName(route.mark)).key === SIGNIN_KEY) {
      return handleSigninUpdate(ctx, req, json, parsed, visit);
    }
  }
  if (opts?.authOnly === true) return null;

  if (route.verb === "delete" && route.mark !== undefined) {
    if (DeckoName.parse(markToName(route.mark)).key === SIGNIN_KEY) {
      return handleSignout(ctx, req, json, parsed, visit);
    }
  }

  const sessionToken =
    tokenFromRequest(req, parsed) ?? readSessionCookie(req.headers.cookie);
  const [passwordBefore, modEvents, deckoBotEmail] = await Promise.all([
    sessionToken === null
      ? Promise.resolve(undefined)
      : new SessionStore({ driver: ctx.driver }).ownPasswordUpdatedAt(sessionToken),
    observedModEventRuntime(ctx),
    ctx.accountMail?.deckoBotEmail !== undefined
      ? Promise.resolve(ctx.accountMail.deckoBotEmail)
      : deckoBotAccountEmail(ctx.driver),
  ]);

  const engine = await createCardActionEngineForSession(ctx.fetcher, ctx.driver, sessionToken, {
    ipAddress: ctx.ipAddress ?? req.headers["x-forwarded-for"] ?? "127.0.0.1",
    now: ctx.now,
    attachmentStore: ctx.attachmentStore,
    ...(ctx.scssCompiler === undefined ? {} : { scssCompiler: ctx.scssCompiler }),
    ...(ctx.coffeeCompiler === undefined ? {} : { coffeeCompiler: ctx.coffeeCompiler }),
    ...(ctx.compressAssets === undefined ? {} : { compressAssets: ctx.compressAssets }),
    ...(ctx.scriptCompressor === undefined ? {} : { scriptCompressor: ctx.scriptCompressor }),
    ...(ctx.javascriptValidator === undefined ? {} : { javascriptValidator: ctx.javascriptValidator }),
    fileStorage: ctx.fileStorage,
    modEvents,
    params: requestParamsForEvents(parsed),
    ...(ctx.notifyTransport === undefined ? {} : { notifyTransport: ctx.notifyTransport }),
    followMail: {
      origin: cardUrl(req, ""),
      deckoBotEmail,
    },
    ...(ctx.recaptcha === undefined ? {} : { recaptcha: ctx.recaptcha }),
    ...(ctx.delayedJobs === undefined ? {} : { delayedJobs: ctx.delayedJobs }),
  }, req.headers.cookie);

  const mount: "file" | "image" | undefined =
    parsed.cardFiles["file"] !== undefined
      ? "file"
      : parsed.cardFiles["image"] !== undefined
      ? "image"
      : undefined;
  const attachmentInput = mount !== undefined ? parsed.cardFiles[mount] : undefined;
  const attachment: AttachmentInput | undefined = attachmentInput === undefined
    ? undefined
    : {
        bytes: attachmentInput.bytes,
        originalFilename: attachmentInput.filename,
        declaredContentType: attachmentInput.contentType,
      };

  try {
    let result: ActionResult | null;
    let name: string;
    if (
      parsed.attachmentUpload !== undefined &&
      parsed.attachmentUpload !== "" &&
      attachment !== undefined &&
      (route.verb === "create" || route.verb === "update")
    ) {
      return await handlePreliminaryUpload(ctx, engine, req, route, parsed, attachment, mount);
    }
    if (route.verb === "create") {
      const input = {
        ...createInputFromParams(route, parsed, attachment),
        ...(cachedUploadActionParam(parsed) !== undefined
          ? { actionIdOfCachedUpload: cachedUploadActionParam(parsed) }
          : {}),
        comment: parsed.comment,
        commentAuthor: parsed.commentAuthor,
        commentAuthorSession: visit,
        recaptchaToken: parsed.recaptchaToken,
      };
      if (await isSessionTypeCreate(ctx.fetcher, input)) {
        return await saveVisitorSessionCard(ctx, engine, req, json, parsed, visit, input, "create");
      }
      await assertSignupMailConfigured(ctx, engine, input);
      result = await engine.createCard(input);
      name = result.name?.s ?? input.name;
      await requestSignupVerification(ctx, name, input.subcards);
    } else if (route.verb === "update") {
      const card = parsed.card;
      const hashName: string | undefined = card["name"];
      const markName: string | undefined = route.mark !== undefined
        ? markToName(route.mark)
        : hashName;
      if (markName === undefined || markName === "") {
        throw new CardActionError("not-found", "no card name in request (no mark, no card[name])");
      }
      const updateName = hashName ?? markName;
      const reverting =
        (parsed.revertActions !== undefined && parsed.revertActions.length > 0) ||
        (parsed.revertAct !== undefined && parsed.revertAct !== "");
      const trashedTarget =
        parsed.lookInTrash === true ? await lookupTrashedCard(ctx.fetcher, markName ?? updateName) : undefined;
      const idMarkMatch = markName !== undefined ? /^~(\d+)$/.exec(markName.trim()) : null;
      const byId =
        idMarkMatch !== null ? await ctx.fetcher.fetchById(Number(idMarkMatch[1])) : undefined;
      const existing =
        (await lookupLiveCard(ctx.fetcher, markName ?? updateName)) ??
        (byId !== undefined && byId.id !== undefined && byId.trash !== true
          ? (byId as CardRecord & { id: number })
          : undefined) ??
        trashedTarget;
      const trigger = card["trigger"];
      if (existing !== undefined && reverting) {
        result = await engine.revertActions({
          cardId: existing.id,
          actionIds: parsed.revertActions,
          actId: parsed.revertAct,
          revertToPrevious: parsed.revertTo === "previous",
        });
        name = result?.name?.s ?? updateName;
      } else if (
        existing !== undefined &&
        (trigger === "approve_with_verification" || trigger === "approve_without_verification") &&
        (await typeCodenameOf(ctx.fetcher, existing.typeId)) === "signup"
      ) {
        name = existing.name?.s ?? updateName;
        result = await approveSignup(ctx, engine, existing.id, name, trigger === "approve_with_verification");
      } else if (
        existing !== undefined &&
        trigger === "use_as_current_skin" &&
        (await typeCodenameOf(ctx.fetcher, existing.typeId)) === "bootswatch_skin"
      ) {
        name = existing.name?.s ?? updateName;
        result = await engine.useAsCurrentSkin(existing.id);
      } else if (existing === undefined) {
        const heldRevision = card["last_action_id_before_edit"];
        if (heldRevision !== undefined && /^\d+$/.test(heldRevision) &&
            await lookupTrashedCard(ctx.fetcher, markName ?? updateName)) {
          throw new CardActionError("conflict", "Card changed or was deleted while being edited");
        }

        const sessionInput = { ...createInputFromParams(route, parsed, attachment), name: updateName };
        if (await isSessionTypeCreate(ctx.fetcher, sessionInput)) {
          return await saveVisitorSessionCard(ctx, engine, req, json, parsed, visit, sessionInput, "update");
        }
        const created = await engine.createCard({
          ...createInputFromParams(route, parsed, attachment),
          name: updateName,
          comment: parsed.comment,
          commentAuthor: parsed.commentAuthor,
          commentAuthorSession: visit,
          recaptchaToken: parsed.recaptchaToken,
        });
        name = created.name?.s ?? updateName;
        result = created;
      } else {
        const typeIdRaw = card["type_id"];
        result = await engine.updateCard({
          cardId: existing.id,
          ...(existing.trash ? { lookInTrash: true } : {}),
          ...(card["skip"] === "validate_renaming" ? { skipValidateRenaming: true } : {}),
          name: hashName !== undefined && hashName !== markName ? hashName : undefined,
          content: listItemContent(parsed, card["content"] ?? existing.dbContent ?? "") ?? card["content"],
          typeName: card["type"],
          typeId:
            typeIdRaw !== undefined && /^\d+$/.test(typeIdRaw) ? Number(typeIdRaw) : undefined,
          attachment,
          ...(cachedUploadActionParam(parsed) !== undefined
            ? { actionIdOfCachedUpload: cachedUploadActionParam(parsed) }
            : {}),
          ...(Object.keys(subcardInputs(parsed.subcardTree)).length > 0
            ? { subcards: subcardInputs(parsed.subcardTree) }
            : {}),
          comment: parsed.comment,
          commentAuthor: parsed.commentAuthor,
          commentAuthorSession: visit,
          recaptchaToken: parsed.recaptchaToken,
          ...(parsed.colorsParams === undefined && parsed.themeColorsParams === undefined
            ? {}
            : { colorsParams: parsed.colorsParams, themeColorsParams: parsed.themeColorsParams }),
          lastActionIdBeforeEdit: card["last_action_id_before_edit"],
          ...(card["trigger"] !== undefined ? { trigger: card["trigger"] } : {}),
          draft: parsed.draft === "true",
        });
        name = result?.name?.s ?? updateName;
      }
    } else {
      const markName: string | undefined = route.mark !== undefined
        ? markToName(route.mark)
        : parsed.card?.["name"];
      if (markName === undefined || markName === "") {
        throw new CardActionError("not-found", "no card name in request (no mark, no card[name])");
      }
      const existing = await lookupLiveCard(ctx.fetcher, markName);
      if (existing === undefined) {
        throw new CardActionError("user-error", `no such card: ${markName}`, MISSING_CARD_DELETE_MESSAGE, {
          UserError: "Card::Error::UserError",
        });
      }
      result = await engine.deleteCard({
        cardId: existing.id,
        recaptchaToken: parsed.recaptchaToken,
        visitorSession: visit,
      });
      name = markName;
    }

    if (result?.successAppends !== undefined) {
      for (const append of result.successAppends) {
        if (append.id !== undefined && append.id !== "") parsed.success["id"] = append.id;
        if (append.view !== undefined && append.view !== "") parsed.success["view"] = append.view;
      }
    }
    let actSignout = false;
    if (result?.signout === true) {
      actSignout = true;
      if (sessionToken !== null) {
        await new SessionStore({ driver: ctx.driver }).revokeSession(sessionToken);
      }
      delete visit.history;
      visit.cards = {};
      delete visit.commentAuthor;
    }
    const applyActSignoutCookie = (response: WriteRouteResponse): WriteRouteResponse =>
      actSignout
        ? {
            ...response,
            headers: {
              ...response.headers,
              "Set-Cookie": clearedSessionCookieHeader(sessionCookieSecure(req)),
            },
          }
        : response;

    if (sessionToken !== null) {
      await new SessionStore({ driver: ctx.driver }).keepSessionAcrossOwnPasswordChange(sessionToken, passwordBefore);
    }

    const saved = {
      cardId: result?.cardId ?? 0,
      actId: result?.actId ?? 0,
      actionId: result?.actionId ?? 0,
      verb: result?.verb ?? route.verb,
    };

    const successMark = parsed.success["mark"];
    const previousRedirect =
      successMark === "*previous" || successMark === ":previous"
        ? (ctx.previousLocation?.() ?? previousLocation(visit))
        : undefined;
    const successName =
      previousRedirect !== undefined
        ? undefined
        : successMark !== undefined && successMark !== "" && !successMark.startsWith("_")
          ? successMark
          : name;
    const subcardExpiryNames = [
      ...Object.keys(parsed.subcards)
        .filter((slot) => slot.startsWith("+"))
        .map((slot) => `${name}${slot}`),
      ...Object.keys(parsed.subcards).filter((slot) => !slot.startsWith("+")),
      ...(result?.nameBeforeAct !== undefined ? [result.nameBeforeAct.s] : []),
      ...engine.takeRelatedExpiryNames(),
    ];
    const deletesOwnTarget =
      saved.verb === "delete" &&
      (parsed.success["mark"] === undefined || parsed.success["mark"] === "" || parsed.success["mark"] === "_self");
    if (deletesOwnTarget && !json && isAjax(req, parsed) && parsed.isMain !== undefined) {
      discardLocationsFor(visit, name);
      const previous = ctx.previousLocation?.() ?? previousLocation(visit);
      return applyActSignoutCookie({
        ...jsonResponse(200, { redirect: absoluteTarget(req, previous) }),
        expiryName: name,
        expiryNames: subcardExpiryNames,
      });
    }
    if (parsed.success["reload"] === "true") {
      return applyActSignoutCookie({
        ...jsonResponse(200, { reload: true }),
        expiryName: name,
        expiryNames: subcardExpiryNames,
      });
    }
    if (
      parsed.slotterMode === "silent-success" ||
      parsed.slotterMode === "update-modal-origin" ||
      parsed.slotterMode === "update-origin"
    ) {
      return applyActSignoutCookie({
        ...jsonResponse(200, { magic: true }),
        expiryName: name,
        expiryNames: subcardExpiryNames,
      });
    }
    const successRedirect = parsed.success["redirect"];
    const envelopeCarriesSoft = successRedirect === "soft";
    const softOverrideOnNormalRequest = envelopeCarriesSoft && !deletesOwnTarget;
    if (!json && isAjax(req, parsed) && successRedirect !== undefined && successRedirect !== "" && successRedirect !== "soft") {
      return applyActSignoutCookie({
        ...jsonResponse(200, {
          redirect:
            previousRedirect !== undefined
              ? cardUrl(req, previousRedirect)
              : absoluteTarget(req, await successTargetPath(ctx.fetcher, parsed, name, visit)),
        }),
        expiryName: name,
        expiryNames: subcardExpiryNames,
      });
    }
    if (!json && isAjax(req, parsed) && saved.verb !== "delete" && ajaxSaveRedirects()) {
      return applyActSignoutCookie({
        ...jsonResponse(200, { redirect: cardUrl(req, `/${locationName(successName ?? name)}`) }),
        expiryName: name,
        expiryNames: subcardExpiryNames,
      });
    }
    if (!json && ctx.renderSlot !== undefined && (isAjax(req, parsed) || softOverrideOnNormalRequest)) {
      const slotView =
        parsed.success["view"] ||
        (req.search ? new URLSearchParams(req.search).get("view") : null) ||
        undefined;
      const slotHtml = await ctx.renderSlot(
        successName ?? name,
        slotView,
        subcardExpiryNames,
        {
          ...(deletesOwnTarget ? { absentCard: true } : {}),
        },
      );
      return applyActSignoutCookie({
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        body: slotHtml,
        expiryName: name,
        expiryNames: subcardExpiryNames,
      });
    }
    if (saved.verb === "delete") discardLocationsFor(visit, name);
    const redirectPath = saved.verb === "delete" && parsed.success["mark"] === undefined
      ? previousLocation(visit)
      : (previousRedirect ?? await successTargetPath(ctx.fetcher, parsed, name, visit));
    const response = applyActSignoutCookie(
      successResponse(req, json, name, saved, redirectPath, subcardExpiryNames),
    );
    return response;
  } catch (error) {
    if (error instanceof DatabaseOutcomeUnknownError || error instanceof CommittedSaveCleanupError) {
      let diagnosticRecorded = false;
      try {
        console.warn("decko-save-outcome", JSON.stringify(saveOutcomeDiagnostic(error)));
        diagnosticRecorded = true;
      } catch {
        diagnosticRecorded = false;
      }
      const message = error instanceof CommittedSaveCleanupError ?
        "The save completed. A cleanup task needs attention; do not submit the save again." :
        "The save may have completed. Reload the card and check its history before trying again. Uploaded files have been kept.";
      const reconciliation = error instanceof SaveOutcomeUnknownError || error instanceof CommittedSaveCleanupError ? error.reconciliation : undefined;
      const expiryName = route.mark !== undefined ? markToName(route.mark) :
        typeof parsed.card["name"] === "string" ? parsed.card["name"] : undefined;
      const response = json ? jsonResponse(409, {
        error_status: 409, code: error.code, outcome: error.outcome,
        retry_safe: false, errors: { save: message }, reconciliation,
      }) : htmlResponse(409, "Save outcome unknown", `<p>${escapeHtml(message)}</p>`);
      return { ...response, headers: { ...response.headers,
        "X-Decko-Save-Diagnostic": diagnosticRecorded ? "recorded" : "unavailable" }, expiryName };
    }
    if (error instanceof StrictParityCrashError) {
      if (!json && !isAjax(req, parsed) && route.mark !== undefined) {
        const shown = await lookupLiveCard(ctx.fetcher, markToName(route.mark));
        if (shown !== undefined && shown.codename !== "signin") saveLocation(visit, requestUrl(req));
      }
      const crashName =
        route.mark !== undefined
          ? markToName(route.mark)
          : typeof parsed.card["name"] === "string"
            ? parsed.card["name"]
            : undefined;
      if (!json && !isAjax(req, parsed) && crashName !== undefined) {
        try {
          const pageHtml = await renderErrorPage(
            ctx,
            crashName,
            "server_error",
            undefined,
            sessionToken,
            req.headers.cookie,
            typeof parsed.card["type"] === "string" && parsed.card["type"] !== ""
              ? parsed.card["type"]
              : route.typeShortcut,
          );
          return {
            status: 500,
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
            body: pageHtml,
          };
        } catch {
        }
      }
      return htmlResponse(500, "Error (server-error)", SERVER_ERROR_HTML);
    }
    if (error instanceof CardActionError) {
      if (!json && !isAjax(req, parsed) && route.mark !== undefined) {
        const shown = await lookupLiveCard(ctx.fetcher, markToName(route.mark));
        if (shown !== undefined && shown.codename !== "signin") saveLocation(visit, requestUrl(req));
      }
      if (
        !json &&
        !isAjax(req, parsed) &&
        req.method === "GET" &&
        route.mark !== undefined &&
        errorStatus(error.code) === 403 &&
        ctx.renderErrorPage !== undefined
      ) {
        try {
          const pageHtml = await ctx.renderErrorPage(markToName(route.mark), "denial");
          return {
            status: 403,
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
            body: pageHtml,
          };
        } catch {
        }
      }
      if (
        !json &&
        error.code === "conflict" &&
        error.cardName !== undefined &&
        ctx.renderSlot !== undefined
      ) {
        try {
          const conflictHtml = await ctx.renderSlot(error.cardName, "conflict", [], {});
          return {
            status: 409,
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
            body: conflictHtml,
          };
        } catch {
        }
      }
      const signedIn = await signedInFor(ctx, sessionToken);
      const refusalStatus = errorStatus(error.code);
      const requestedName = parsed.card["name"];
      const refusalName =
        error.cardName ??
        (route.mark !== undefined
          ? markToName(route.mark)
          : typeof requestedName === "string"
            ? requestedName
            : undefined);
      if (
        !json &&
        !isAjax(req, parsed) &&
        refusalName !== undefined &&
        (refusalStatus === 403 || refusalStatus === 404 || refusalStatus === 422)
      ) {
        try {
          const pageHtml = await renderRefusalPage(
            ctx,
            refusalName,
            refusalStatus,
            refusalStatus === 403 ? undefined : refusalPageErrorEntries(error),
            signedIn,
            sessionToken,
            req.headers.cookie,
            typeof parsed.card["type"] === "string" && parsed.card["type"] !== ""
              ? parsed.card["type"]
              : route.typeShortcut,
          );
          return {
            status: refusalStatus,
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
            body: pageHtml,
          };
        } catch {
        }
      }
      return errorResponse(json, error, signedIn, {
        url: requestUrl(req),
        now: ctx.now?.() ?? new Date(),
      }, { ajax: isAjax(req, parsed), getAlternative: req.method === "GET" });
    }
    throw error;
  }
}

function cachedUploadActionParam(parsed: ParsedBody): string | undefined {
  const value = parsed.card["action_id_of_cached_upload"];
  return value !== undefined && value !== "" ? value : undefined;
}

async function handlePreliminaryUpload(
  ctx: WriteRouteContext,
  engine: CardActionEngine,
  req: WriteRouteRequest,
  route: RouteMatch,
  parsed: ParsedBody,
  attachment: AttachmentInput,
  mount: "file" | "image" | undefined,
): Promise<WriteRouteResponse> {
  if (mount === undefined) {
    throw new CardActionError("field-required", `${route.verb} requires an upload`);
  }
  if (ctx.renderPreviewEditor === undefined) {
    throw new Error(
      "the preliminary upload arm requires WriteRouteContext.renderPreviewEditor (the host's preview_editor render seam)",
    );
  }
  let cardId: number | undefined;
  let typeId: number;
  if (route.verb === "update") {
    if (route.mark === undefined) {
      throw new CardActionError("not-found", "no card name in request (no mark)");
    }
    const existing = await lookupLiveCard(ctx.fetcher, markToName(route.mark));
    if (existing === undefined) {
      throw new CardActionError("not-found", `no such card: ${markToName(route.mark)}`);
    }
    cardId = existing.id;
    if (existing.typeId === undefined) {
      throw new CardActionError("not-found", `card ${existing.id} carries no type`);
    }
    typeId = existing.typeId;
  } else {
    const typeIdRaw = parsed.card["type_id"];
    if (typeIdRaw !== undefined && /^\d+$/.test(typeIdRaw)) {
      typeId = Number(typeIdRaw);
    } else {
      const typeName = parsed.card["type"] ?? route.typeShortcut;
      const type = typeName !== undefined ? await ctx.fetcher.fetchByName(typeName) : undefined;
      if (type?.id === undefined || type.id === null) {
        throw new CardActionError("type-unknown", "a preliminary upload requires card[type_id]");
      }
      typeId = type.id;
    }
  }
  const { actionId, cacheCardName, identifier, size, originalFilename } =
    await engine.recordPreliminaryUpload({
      ...(cardId !== undefined ? { cardId } : {}),
      typeId,
      mount,
      attachment,
    });
  const renderName = cardId !== undefined
    ? await lookupLiveCardName(ctx, cardId)
    : cacheCardName;
  if (renderName === undefined) {
    throw new CardActionError("not-found", "no *new cache card for the preliminary upload");
  }
  if (!isAjax(req, parsed)) {
    return {
      status: 303,
      headers: {
        Location: cardUrl(req, `/${locationName(renderName)}/preview_editor?rev_id=${actionId}`),
        "Content-Type": "text/html; charset=utf-8",
      },
      body: "",
    };
  }
  const html = await ctx.renderPreviewEditor({
    name: renderName,
    opts: {
      attachment_upload: parsed.attachmentUpload,
      original_filename: originalFilename,
      attachment_size: size,
      selected_action_id: actionId,
      cached_upload_identifier: identifier,
    },
  });
  return {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body: html,
  };
}

async function lookupLiveCardName(ctx: WriteRouteContext, cardId: number): Promise<string> {
  const record = await ctx.fetcher.fetchById(cardId);
  const name = record?.name?.s;
  if (name === undefined) throw new CardActionError("not-found", `no such card: ${cardId}`);
  return name;
}

export async function handleAuthOnlyRequest(
  ctx: WriteRouteContext,
  req: WriteRouteRequest,
): Promise<WriteRouteResponse | null> {
  return handleWriteRequest(ctx, req, { authOnly: true });
}

function createInputFromParams(
  route: RouteMatch,
  parsed: ParsedBody,
  attachment: AttachmentInput | undefined,
): {
  name: string;
  content?: string;
  typeName?: string;
  typeId?: number;
  attachment?: AttachmentInput;
  subcards?: Record<string, SubcardInput>;
} {
  const card = parsed.card;
  const subcards = subcardInputs(parsed.subcardTree);
  const name = card["name"] ?? (route.mark !== undefined ? markToName(route.mark) : "");
  const typeName = card["type"] ?? route.typeShortcut;
  const typeIdRaw = card["type_id"];
  return {
    name,
    content: card["content"],
    typeName,
    typeId: typeIdRaw !== undefined && /^\d+$/.test(typeIdRaw) ? Number(typeIdRaw) : undefined,
    attachment,
    ...(Object.keys(subcards).length > 0 ? { subcards } : {}),
  };
}

async function isSessionTypeCreate(
  fetcher: FetchEngine,
  input: { typeName?: string; typeId?: number },
): Promise<boolean> {
  const type = input.typeId !== undefined
    ? await fetcher.fetchById(input.typeId)
    : input.typeName !== undefined
      ? await fetcher.fetchByName(input.typeName)
      : undefined;
  return type !== undefined && !type.trash && type.codename === "session";
}

async function assertSignupMailConfigured(
  ctx: WriteRouteContext,
  engine: CardActionEngine,
  input: { typeName?: string; typeId?: number },
): Promise<void> {
  if (ctx.accountMail !== undefined) return;
  const type = input.typeId !== undefined ? await ctx.fetcher.fetchById(input.typeId) : input.typeName !== undefined ? await ctx.fetcher.fetchByName(input.typeName) : undefined;
  if (type?.codename !== "signup") return;
  const userId = await ctx.fetcher.codenames.id("user");
  if (userId !== undefined && await engine.mayCreateCardOfType(userId)) throw new CardActionError("user-error", "account mail is not configured on this host", "ACCOUNT: account mail is not configured on this host");
}

async function requestSignupVerification(
  ctx: WriteRouteContext,
  name: string,
  subcards: Record<string, SubcardInput> | undefined,
): Promise<void> {
  if (ctx.accountMail === undefined || subcards?.["+*account"] === undefined) return;
  const status = await lookupLiveCard(ctx.fetcher, `${name}+*account+*status`);
  if (status?.dbContent !== "unverified") return;
  await sendAccountVerificationToken(
    {
      ...ctx.accountMail,
      driver: ctx.driver,
      fetcher: ctx.fetcher,
      sessions: new SessionStore({ driver: ctx.driver }),
    },
    `${name}+*account`,
  );
}

async function typeCodenameOf(fetcher: FetchEngine, typeId: number | null | undefined): Promise<string> {
  if (typeId === null || typeId === undefined) return "";
  return (await fetcher.fetchById(typeId))?.codename ?? "";
}

async function approveSignup(
  ctx: WriteRouteContext,
  engine: Awaited<ReturnType<typeof createCardActionEngineForSession>>,
  cardId: number,
  name: string,
  withVerification: boolean,
): Promise<ActionResult | null> {
  try {
    await engine.assertMayUpdate(cardId);
  } catch (error) {
    if (error instanceof CardActionError && error.code === "permission-denied") {
      const message = error.errorsByAttribute?.["permission_denied"] ?? `You don't have permission to update ${name}`;
      throw new CardActionError("user-error", error.message, `PERMISSION_DENIED: ${message}`, {
        permission_denied: message,
      });
    }
    throw error;
  }
  const accountedTypeId = await ctx.fetcher.codenames.id("user");
  if (accountedTypeId === undefined || !(await engine.canApproveSignups())) {
    throw new CardActionError("user-error", "illegal approval", "ABORT: illegal approval");
  }
  if (withVerification && ctx.accountMail === undefined) throw new CardActionError("user-error", "account mail is not configured on this host", "ACCOUNT: account mail is not configured on this host");
  const accountMail = ctx.accountMail;
  const flow = accountMail === undefined
    ? undefined
    : { ...accountMail, driver: ctx.driver, fetcher: ctx.fetcher, sessions: new SessionStore({ driver: ctx.driver }) };
  return engine.updateCard({
    cardId,
    ...(withVerification ? {} : { typeId: accountedTypeId }),
    subcards: {
      "+*account": { subcards: { "+*status": { content: withVerification ? "unverified" : "active" } } },
    },
    triggeredIntegrate: async () => {
      if (flow === undefined) return;
      if (withVerification) await sendAccountVerificationToken(flow, `${name}+*account`);
      else await sendAccountWelcomeEmail(flow, `${name}+*account`);
    },
  });
}

function subcardInputs(tree: Record<string, ParsedSubcard>): Record<string, SubcardInput> {
  const out: Record<string, SubcardInput> = {};
  for (const [key, node] of Object.entries(tree)) {
    const typeIdRaw = node.fields["type_id"];
    const nested = subcardInputs(node.subcards);
    const cachedUploadRaw = node.fields["action_id_of_cached_upload"];
    out[key] = {
      ...(node.fields["content"] !== undefined ? { content: node.fields["content"] } : {}),
      ...(node.fields["type"] !== undefined ? { typeName: node.fields["type"] } : {}),
      ...(typeIdRaw !== undefined && /^\d+$/.test(typeIdRaw) ? { typeId: Number(typeIdRaw) } : {}),
      ...(cachedUploadRaw !== undefined && cachedUploadRaw !== ""
        ? { actionIdOfCachedUpload: cachedUploadRaw }
        : {}),
      ...(Object.keys(nested).length > 0 ? { subcards: nested } : {}),
    };
  }
  return out;
}

async function lookupTrashedCard(
  fetcher: FetchEngine,
  name: string,
): Promise<(CardRecord & { id: number }) | undefined> {
  const parsedName = DeckoName.parse(name);
  const driver = fetcher.driver;
  const pick = async (sql: string, params: unknown[]): Promise<number | undefined> => {
    const { rows } = await driver.query<{ id: number }>(sql, params);
    return rows[0] === undefined ? undefined : Number(rows[0].id);
  };
  const idOfKey = (key: string): Promise<number | undefined> =>
    pick("SELECT id FROM cards WHERE key = ? ORDER BY trash, id LIMIT 1", [key]);
  let id: number | undefined;
  if (parsedName.isSimple) {
    id = await pick("SELECT id FROM cards WHERE key = ? AND trash = 1 ORDER BY id DESC LIMIT 1", [
      parsedName.key,
    ]);
  } else if (parsedName.leftName !== undefined && parsedName.rightName !== undefined) {
    const resolve = async (part: DeckoName): Promise<number | undefined> =>
      part.isSimple ? idOfKey(part.key) : (await lookupTrashedOrLive(fetcher, part.s))?.id;
    const left = await resolve(parsedName.leftName);
    const right = await resolve(parsedName.rightName);
    if (left !== undefined && right !== undefined) {
      id = await pick(
        "SELECT id FROM cards WHERE left_id = ? AND right_id = ? AND trash = 1 ORDER BY id DESC LIMIT 1",
        [left, right],
      );
    }
  }
  if (id === undefined) return undefined;
  const { rows } = await driver.query<CardsRow>("SELECT * FROM cards WHERE id = ?", [id]);
  if (rows[0] === undefined) return undefined;
  return { ...(await composeCardRecord(rows[0], fetcher.lexicon)), id } as CardRecord & { id: number };
}

async function lookupTrashedOrLive(
  fetcher: FetchEngine,
  name: string,
): Promise<(CardRecord & { id: number }) | undefined> {
  return (await lookupLiveCard(fetcher, name)) ?? lookupTrashedCard(fetcher, name);
}

async function lookupLiveCard(
  fetcher: FetchEngine,
  name: string,
): Promise<(CardRecord & { id: number }) | undefined> {
  const key = DeckoName.parse(name).key;
  const record = await fetcher.fetchByKey(key);
  if (record === undefined || record.trash || record.id === undefined) return undefined;
  return record as CardRecord & { id: number };
}

export { matchRoute };
