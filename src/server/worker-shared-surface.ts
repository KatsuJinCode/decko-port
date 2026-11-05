import type { SQLDatabaseDriver } from "./driver.js";
import { DeckoName } from "../card/name.js";
import type { FetchEngine } from "../card/fetch.js";
import type { HistoryRenderParams } from "../card/history/render-seam.js";
import {
  previousLocation,
  readVisitorSession,
} from "../card/session/visitor-session.js";
import { logInfo } from "./server-log.js";

export interface RenderErrorPage {
  readonly status: number;
  readonly title: string;
}

export function mapRenderError(message: string): RenderErrorPage {
  if (/^card not found: /.test(message)) return { status: 404, title: "Card not found" };
  if (/^id doesn't exist: /.test(message) || /^codename doesn't exist: /.test(message)) {
    return { status: 404, title: "Card not found" };
  }
  if (/^view \(/.test(message)) return { status: 422, title: "Unsupported view" };
  if (/^act not found$/.test(message)) return { status: 404, title: "Card not found" };
  if (message === "limit parameter exceeds maximum for anonymous users (1000)") return { status: 403, title: "Forbidden" };
  return { status: 500, title: "Render error" };
}

export function decodeName(raw: string): string | undefined {
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.startsWith(":") ? decoded : decoded.replace(/_/g, " ");
  } catch {
    return undefined;
  }
}

export function decodeViewSegment(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

export function queryViewFromUrl(url: URL): string | undefined {
  for (const key of ["view", "v"] as const) {
    const value = url.searchParams.get(key);
    if (value !== null && value !== "") return value;
  }
  return undefined;
}

const HISTORY_PARAM_KEYS = [
  "act_id",
  "action_id",
  "page",
  "act_seq",
  "action_view",
  "hide_diff",
  "act_context",
  "tinymce_id",
  "tm_snippet_raw",
  "tm_snippet_start",
] as const;

const EDITOR_PARAM_KEYS = ["tinymce_id", "tm_snippet_raw", "tm_snippet_start"] as const;

export function historyRenderParamsFromWire(
  params: Record<string, string> | undefined,
): HistoryRenderParams {
  if (params === undefined) return {};
  const out: HistoryRenderParams = {};
  if (params["act_id"] !== undefined) out.actId = params["act_id"];
  if (params["action_id"] !== undefined) out.actionId = params["action_id"];
  if (params["act_seq"] !== undefined) out.actSeq = params["act_seq"];
  if (params["action_view"] !== undefined) out.actionView = params["action_view"];
  if (params["hide_diff"] !== undefined) out.hideDiff = params["hide_diff"];
  if (params["act_context"] !== undefined) out.actContext = params["act_context"];
  if (params["page"] !== undefined) out.page = params["page"];
  const editor: Record<string, string> = {};
  for (const key of EDITOR_PARAM_KEYS) {
    if (params[key] !== undefined) editor[key] = params[key];
  }
  if (Object.keys(editor).length > 0) out.editorParams = editor;
  return out;
}

export function historyViewParams(searchParams: URLSearchParams): HistoryRenderParams {
  const wire: Record<string, string> = {};
  for (const key of HISTORY_PARAM_KEYS) {
    const value = searchParams.get(key);
    if (value !== null) wire[key] = value;
  }
  const search = jsonViewSearchParams(searchParams);
  return { ...historyRenderParamsFromWire(wire), ...(search !== undefined ? { search } : {}) };
}

export function jsonViewSearchParams(searchParams: URLSearchParams): HistoryRenderParams["search"] {
  const term = searchParams.get("term");
  const main = searchParams.get("main");
  const vars = Object.fromEntries([...searchParams].flatMap(([key, value]) => {
    const match = /^query\[([^\[\]]+)\]$/.exec(key);
    return match ? [[match[1]!, value]] : [];
  }));
  const rawOffset = searchParams.get("offset");
  const offset = rawOffset !== null && /^\d+$/.test(rawOffset) && Number(rawOffset) > 0 ? Number(rawOffset) : undefined;
  if (term === null && main === null && Object.keys(vars).length === 0 && offset === undefined) return undefined;
  return {
    ...(term !== null ? { term } : {}),
    ...(main !== null ? { main } : {}),
    ...(Object.keys(vars).length ? { vars } : {}),
    ...(offset !== undefined ? { offset } : {}),
  };
}

interface PrimeIdRow {
  id: number;
  name: string | null;
  left_id: number | null;
  right_id: number | null;
}

export function composeJunctionNames(rows: PrimeIdRow[]): {
  rows: PrimeIdRow[];
  nameOf: (id: number) => string | undefined;
} {
  const byId = new Map<number, PrimeIdRow>();
  const idToName = new Map<number, string>();
  for (const row of rows) {
    byId.set(row.id, row);
    if (row.name !== null && row.name !== "") {
      const name = DeckoName.parse(row.name);
      idToName.set(row.id, name.s);
    }
  }
  const composing = new Set<number>();
  const composedName = (id: number): string | undefined => {
    const direct = idToName.get(id);
    if (direct !== undefined) return direct;
    if (composing.has(id)) return undefined;
    const row = byId.get(id);
    if (row === undefined || row.left_id === null || row.right_id === null) return undefined;
    composing.add(id);
    try {
      const left = composedName(row.left_id);
      const right = composedName(row.right_id);
      if (left === undefined || right === undefined) return undefined;
      const joined = `${left}${DeckoName.JOINT}${right}`;
      idToName.set(id, joined);
      return joined;
    } finally {
      composing.delete(id);
    }
  };
  return { rows, nameOf: composedName };
}

export async function installDeckNameEnvironment(
  driver: SQLDatabaseDriver,
  fetcher: FetchEngine,
): Promise<void> {
  const { rows } = await driver.query<PrimeIdRow>(
    "SELECT id, name, left_id, right_id FROM cards WHERE trash = 0",
    [],
  );
  const { nameOf } = composeJunctionNames(rows);
  fetcher.installNameEnvironment();
  await fetcher.codenames.ensureLoaded();
  for (const row of rows) {
    if (row.left_id !== null && row.right_id !== null) {
      const joined = nameOf(row.id);
      if (joined === undefined) continue;
      fetcher.lexicon.write(row.id, DeckoName.parse(joined), [row.left_id, row.right_id]);
    } else if (row.name !== null && row.name !== "") {
      const name = DeckoName.parse(row.name);
      fetcher.lexicon.write(row.id, name, row.name);
    }
  }
}

export function publicDbContent(record: { name?: DeckoName; dbContent?: string }): string {
  if (record.name?.rightName?.key === "*password") return "encrypted";
  return record.dbContent ?? "";
}

export function previousMarkRedirect(
  request: Request,
  url: URL,
  mark: string | undefined,
): Response | null {
  if (mark !== "*previous") return null;
  const visit = readVisitorSession(request.headers.get("Cookie") ?? undefined);
  const target = previousLocation(visit);
  const absolute = /^https?:\/\//i.test(target) ? target : `${url.origin}${target}`;
  if (/XMLHttpRequest/i.test(request.headers.get("X-Requested-With") ?? "")) {
    return new Response(JSON.stringify({ redirect: absolute }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(null, {
    status: 302,
    headers: { Location: absolute, "Cache-Control": "no-store" },
  });
}


export const DEPRECATED_ASSET_ROUTE_PREFIXES = ["assets", "javascripts", "jasmine"] as const;

export const DEPRECATED_ASSET_BODY = "Decko installation error: missing public directory symlinks";

export const DEPRECATED_ASSET_LOG_LINE = `${DEPRECATED_ASSET_BODY}.\n  >>> Try \`rake card:mod:symlink\``;

export function isDeprecatedAssetRoute(segments: readonly string[]): boolean {
  return segments.length >= 2 && (DEPRECATED_ASSET_ROUTE_PREFIXES as readonly string[]).includes(segments[0]!);
}

export function assetRouteResponse(pathname: string): Response | null {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  return isDeprecatedAssetRoute(segments) ? deprecatedAssetStubResponse() : null;
}

export function deprecatedAssetStubResponse(): Response {
  logInfo(DEPRECATED_ASSET_LOG_LINE);
  return new Response(DEPRECATED_ASSET_BODY, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
