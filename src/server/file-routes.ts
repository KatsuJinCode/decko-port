import type { SQLDatabaseDriver } from "./driver.js";
import type { FetchEngine } from "../card/fetch.js";
import { CardActionError, type Actor } from "../card/actions/types.js";
import type { CardActionEngine } from "../card/actions/card-action-engine.js";
import {
  detectAttachmentContentType,
  detectAttachmentExtension,
  parseLocalAttachmentIdentifier,
} from "../card/attachments/attachment-content.js";
import type { AttachmentStore } from "../card/attachments/attachment-store.js";
import { decodeUriComponentSafe } from "./decode-uri-component-safe.js";
import { decodeName } from "./worker-shared-surface.js";
import { stockCodedFile } from "../card/attachments/stock-coded-files.js";
import { REGISTERED_FORMAT_NAMES } from "../card/render/format-negotiation.js";

const DB_CONTENT_FIELD = 2;

export interface FileRouteDeps {
  driver: SQLDatabaseDriver;
  fetchEngine: FetchEngine;
  attachmentStore: AttachmentStore;
  resolveActor?: (request: Request) => Promise<Actor | null>;
  createEngine: (actor: Actor | null) => CardActionEngine;
  canReadCard?: (cardId: number) => Promise<boolean> | boolean;
}

interface ResolvedMark {
  id: number;
  name: string | null;
  key: string | null;
  typeId: number;
  dbContent: string | null;
  codename?: string | null;
}

export async function handleAttachmentRoute(
  request: Request,
  deps: FileRouteDeps,
): Promise<Response | null> {
  const url = new URL(request.url);
  const segments = url.pathname.replace(/\/+$/, "").split("/").slice(1);
  if (request.method === "GET" || request.method === "HEAD") {
    if (segments.length === 1) {
      const sender = fileSenderRoute(segments[0]!);
      if (sender !== undefined) {
        return await handleFileSenderRead(request, deps, sender.name, sender.format);
      }
    }
    if (segments[0] !== "files" || segments.length < 2 || segments.length > 3) return null;
    return handleFileGet(segments, request, deps);
  }
  if (request.method === "POST") {
    if (segments.length !== 2 || segments[1] !== "asset" || segments[0] === "") return null;
    if (segments[0] === "files") return null;
    return handleAttachmentUpload(segments[0], request, deps);
  }
  return null;
}

export async function handleStockCodedAttachmentRoute(request: Request, deps: Pick<FileRouteDeps, "driver" | "fetchEngine" | "canReadCard">): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const segments = new URL(request.url).pathname.replace(/\/+$/, "").split("/").slice(1);
  if (segments[0] !== "files") return null;
  const parsed = parseFileRouteSegments(segments.slice(1));
  if (parsed?.revId !== "carrierwave") return null;
  const card = await resolveMark(deps, parsed.mark);
  if (!card || (deps.canReadCard && !(await deps.canReadCard(card.id)))) return fileNotFound();
  return (await codedFileResponse(request, parsed, card, deps)) ?? fileNotFound();
}

export interface ParsedFileRequest {
  mark: string;
  revId: string;
  size?: string;
  format: string;
}

export function parseFileRouteSegments(segments: string[]): ParsedFileRequest | undefined {
  const decoded = segments.map((s) => decodeUriComponentSafe(s));
  if (decoded.length === 2) {
    const [mark, file] = decoded;
    const { stem, format } = splitFormat(file);
    const dash = stem.indexOf("-");
    if (dash === -1) return { mark, revId: stem, format };
    return { mark, revId: stem.slice(0, dash), size: stem.slice(dash + 1), format };
  }
  if (decoded.length === 1) {
    const { stem, format } = splitFormat(decoded[0]);
    const revDash = stem.lastIndexOf("-");
    if (revDash <= 0) return undefined;
    const revId = stem.slice(revDash + 1);
    const head = stem.slice(0, revDash);
    const markDash = head.indexOf("-");
    if (markDash === -1) return { mark: head, revId, format };
    return { mark: head.slice(0, markDash), size: head.slice(markDash + 1), revId, format };
  }
  return undefined;
}

function splitFormat(name: string): { stem: string; format: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, format: "" };
  return { stem: name.slice(0, dot), format: name.slice(dot + 1) };
}

async function handleFileGet(
  segments: string[],
  request: Request,
  deps: FileRouteDeps,
): Promise<Response | null> {
  const parsed = parseFileRouteSegments(segments.slice(1));
  if (parsed === undefined) return fileNotFound();
  const card = await resolveMark(deps, parsed.mark);
  if (card === undefined) return fileNotFound();

  if (deps.canReadCard !== undefined && !(await deps.canReadCard(card.id))) {
    return fileNotFound();
  }

  const codedResponse = await codedFileResponse(request, parsed, card, deps);
  if (codedResponse !== undefined) return codedResponse;

  const revId = /^\d+$/.test(parsed.revId) ? Number.parseInt(parsed.revId, 10) : NaN;
  if (Number.isNaN(revId)) return fileNotFound();
  const current = parseLocalAttachmentIdentifier(card.dbContent);
  let local: ReturnType<typeof parseLocalAttachmentIdentifier>;
  let actionComment: string | null = null;
  if (current?.cardId === card.id && current.actionId === revId) {
    local = current;
  } else {
    const action = await deps.driver
      .query<{ id: number; comment: string | null }>(
        "SELECT id, comment FROM card_actions WHERE id = ? AND card_id = ? LIMIT 1",
        [revId, card.id],
      )
      .then((r) => r.rows[0]);
    if (action === undefined) return fileNotFound();
    actionComment = action.comment;

    const changeRow = await deps.driver
      .query<{ value: string | null }>(
        "SELECT value FROM card_changes WHERE card_action_id = ? AND field = ? LIMIT 1",
        [revId, DB_CONTENT_FIELD],
      )
      .then((r) => r.rows[0]);
    local = parseLocalAttachmentIdentifier(changeRow?.value ?? card.dbContent);
  }
  if (local === undefined || local.cardId !== card.id) return fileNotFound();

  const bytes = await deps.attachmentStore.read(
    local.cardId,
    local.actionId,
    local.ext,
    parsed.size,
    card.codename === "new_file" || card.codename === "new_image" ? "tmp" : "files",
  );
  if (bytes === undefined) return fileNotFound();

  const contentType = detectAttachmentContentType(actionComment || safeFilename(card, local.ext), bytes, null);
  return fileResponse(request, parsed, card, local.ext, bytes, contentType, deps.canReadCard !== undefined);
}

function fileResponse(request: Request, parsed: ParsedFileRequest, card: ResolvedMark, ext: string, bytes: Uint8Array, contentType: string, permissionScoped: boolean): Response {
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("Content-Length", String(bytes.length));
  headers.set("Expires", permissionScoped ? new Date(0).toUTCString() : httpDateOneYearOut());
  headers.set("Cache-Control", permissionScoped ? "private, no-store" : "public, max-age=86400");
  if (permissionScoped) headers.set("Vary", "Cookie, Authorization");
  headers.set(
    "Content-Disposition",
    `${parsed.format === "file" ? "attachment" : "inline"}; filename="${safeFilename(card, ext)}"`,
  );
  headers.set("X-Content-Type-Options", "nosniff");
  if (isActiveContentType(contentType)) {
    headers.set("Content-Security-Policy", "sandbox");
  }
  return new Response(request.method === "HEAD" ? undefined : new Uint8Array(bytes), { headers });
}

async function codedFileResponse(request: Request, parsed: ParsedFileRequest, card: ResolvedMark, deps: Pick<FileRouteDeps, "driver" | "canReadCard">): Promise<Response | undefined> {
  if (parsed.revId !== "carrierwave") return undefined;
  const coded = stockCodedFile(card.dbContent, parsed.size);
  if (!coded) return undefined;
  const owner = await deps.driver.query<{ id: number }>("SELECT id FROM cards WHERE codename = ? AND trash = 0", [coded.codename]);
  if (owner.rows[0]?.id !== card.id || parsed.format !== coded.extension) return fileNotFound();
  return fileResponse(request, parsed, card, coded.extension, coded.bytes, coded.extension === "svg" ? "image/svg+xml" : "image/png", deps.canReadCard !== undefined);
}

function isActiveContentType(contentType: string): boolean {
  const media = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return media === "text/html" || media === "image/svg+xml";
}

function safeFilename(card: ResolvedMark, ext: string): string {
  const key = card.key ?? card.name ?? "file";
  return `${key.replace(/[^a-z0-9_]+/g, "_")}${ext}`;
}

function httpDateOneYearOut(): string {
  return new Date(Date.now() + 365 * 24 * 3600 * 1000).toUTCString();
}

function fileNotFound(): Response {
  return new Response("", { status: 404 });
}

export function splitUnregisteredFormatSuffix(
  raw: string,
): { base: string; format: string } | undefined {
  const dot = raw.lastIndexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return undefined;
  const format = raw.slice(dot + 1);
  if (REGISTERED_FORMAT_NAMES.includes(format)) return undefined;
  return { base: raw.slice(0, dot), format };
}

function fileSenderRoute(rawSegment: string): { name: string; format: string } | undefined {
  const split = splitUnregisteredFormatSuffix(rawSegment);
  if (split === undefined) return undefined;
  const name = decodeName(split.base);
  if (name === undefined || name === "") return undefined;
  return { name, format: split.format };
}

export async function handleFileSenderRead(
  request: Request,
  deps: FileRouteDeps,
  mark: string,
  requestedFormat: string,
): Promise<Response | null> {
  const card = await resolveMark(deps, mark);
  if (card === undefined) return fileNotFound();
  if (deps.canReadCard !== undefined && !(await deps.canReadCard(card.id))) {
    return fileNotFound();
  }
  const local = parseLocalAttachmentIdentifier(card.dbContent);
  if (local === undefined || local.cardId !== card.id) return fileNotFound();
  const bytes = await deps.attachmentStore.read(
    local.cardId,
    local.actionId,
    local.ext,
    undefined,
    card.codename === "new_file" || card.codename === "new_image" ? "tmp" : "files",
  );
  if (bytes === undefined) return fileNotFound();
  const contentType = detectAttachmentContentType(safeFilename(card, local.ext), bytes, null);
  return fileResponse(
    request,
    { mark, revId: String(local.actionId), format: requestedFormat },
    card,
    local.ext,
    bytes,
    contentType,
    deps.canReadCard !== undefined,
  );
}

const FILE_PARAM_NAMES = ["file", "image", "card[file]", "card[image]"] as const;

async function handleAttachmentUpload(
  rawMark: string,
  request: Request,
  deps: FileRouteDeps,
): Promise<Response> {
  const actor = deps.resolveActor ? await deps.resolveActor(request) : null;
  if (actor === null) {
    return jsonResponse(403, { error: "permission denied", code: "anonymous-actor" });
  }
  const engine = deps.createEngine(actor);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse(400, { error: "multipart form body required" });
  }
  const paramName = FILE_PARAM_NAMES.find((name) => form.get(name) instanceof File);
  const file = paramName !== undefined ? (form.get(paramName) as File) : undefined;
  if (file === undefined) {
    return jsonResponse(400, { error: `missing upload part (${FILE_PARAM_NAMES.join(" | ")})` });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const originalFilename = file.name || "upload";
  const mark = decodeUriComponentSafe(rawMark);
  const ext = detectAttachmentExtension(originalFilename, bytes);

  const existing = await resolveMark(deps, mark);

  if (existing !== undefined) {
    const typeCode = await typeCodeOf(deps, existing.typeId);
    if (typeCode !== "file" && typeCode !== "image") {
      return jsonResponse(400, {
        error: `card is not an attachment card (type code: ${typeCode ?? "unknown"})`,
      });
    }
    try {
      const result = await engine.updateCard({
        cardId: existing.id,
        attachment: { bytes, originalFilename, declaredContentType: file.type },
      });
      return jsonResponse(200, uploadBody(existing, result?.actionId, bytes.length, ext));
    } catch (error) {
      return actionError(error);
    }
  }

  const formType = (form.get("type") ?? form.get("card[type]") ?? "").toString().trim();
  const sniffed = detectAttachmentContentType(originalFilename, bytes, file.type);
  const typeCode =
    formType !== ""
      ? formType
      : paramName === "image" || sniffed.startsWith("image/")
        ? "image"
        : "file";
  if (typeCode !== "file" && typeCode !== "image") {
    return jsonResponse(400, { error: `unsupported upload type: ${typeCode}` });
  }
  try {
    const result = await engine.createCard({
      name: mark,
      typeCode,
      attachment: { bytes, originalFilename, declaredContentType: file.type },
    });
    return jsonResponse(
      201,
      uploadBody(
        { id: result.cardId, name: result.name?.s ?? mark, key: null, typeId: 0, dbContent: null },
        result.actionId,
        bytes.length,
        ext,
      ),
    );
  } catch (error) {
    return actionError(error);
  }
}

function uploadBody(card: ResolvedMark, actionId: number | undefined, size: number, ext: string) {
  return {
    name: card.name,
    id: card.id,
    action_id: actionId ?? null,
    size,
    url: actionId !== undefined ? `/files/~${card.id}/${actionId}${ext}` : null,
    storage: "local",
  };
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function actionError(error: unknown): Response {
  if (error instanceof CardActionError) {
    switch (error.code) {
      case "anonymous-actor":
      case "permission-denied":
        return jsonResponse(403, { error: "permission denied", code: error.code });
      case "not-found":
        return jsonResponse(404, { error: error.message, code: error.code });
      case "name-conflict":
      case "name-illegal":
      case "rename-conflict":
      case "cycle":
      case "type-unknown":
      case "attachment-missing":
      case "protected-card":
      case "user-error":
        return jsonResponse(422, { error: error.message, code: error.code });
      case "conflict":
        return jsonResponse(409, { error: error.message, code: error.code });
    }
  }
  throw error;
}

async function typeCodeOf(deps: FileRouteDeps, typeId: number): Promise<string | null> {
  const row = await deps.driver
    .query<{ codename: string | null }>("SELECT codename FROM cards WHERE id = ?", [typeId])
    .then((r) => r.rows[0]);
  return row?.codename ?? null;
}

async function resolveMark(deps: Pick<FileRouteDeps, "driver" | "fetchEngine">, mark: string): Promise<ResolvedMark | undefined> {
  if (/^~\d+$/.test(mark)) {
    const row = await deps.driver
      .query<CardsRowLite>("SELECT * FROM cards WHERE id = ? AND trash = 0", [
        Number.parseInt(mark.slice(1), 10),
      ])
      .then((r) => r.rows[0]);
    return row === undefined ? undefined : wrapRow(row);
  }
  if (mark.startsWith(":")) {
    const row = await deps.driver
      .query<CardsRowLite>("SELECT * FROM cards WHERE codename = ? AND trash = 0", [mark.slice(1)])
      .then((r) => r.rows[0]);
    return row === undefined ? undefined : wrapRow(row);
  }
  const record = await deps.fetchEngine.fetchByName(mark);
  if (record === undefined || record.id === undefined) return undefined;
  return {
    id: record.id,
    name: record.name?.s ?? null,
    key: record.key ?? null,
    typeId: record.typeId ?? 0,
    dbContent: record.dbContent ?? null,
    codename: record.codename ?? null,
  };
}

interface CardsRowLite {
  id: number;
  name: string | null;
  key: string | null;
  type_id: number;
  db_content: string | null;
  codename?: string | null;
}

function wrapRow(row: CardsRowLite): ResolvedMark {
  return {
    id: row.id,
    name: row.name,
    key: row.key,
    typeId: row.type_id,
    dbContent: row.db_content,
    codename: row.codename ?? null,
  };
}
