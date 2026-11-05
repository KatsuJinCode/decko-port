import { DeckoName } from "../name.js";

export const VISITOR_COOKIE_NAME = "decko_visit";

const HISTORY_LIMIT = 5;

const COOKIE_VALUE_LIMIT = 3800;

export interface VisitorSession {
  history?: string[];
  cards: Record<string, string>;
  commentAuthor?: string;
}

export function emptyVisitorSession(): VisitorSession {
  return { cards: {} };
}

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): string {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const LOCATION = /^(\/(?!\/)|https?:\/\/)[^\s]*$/;

export function readVisitorSession(cookieHeader: string | undefined): VisitorSession {
  const state = emptyVisitorSession();
  if (cookieHeader === undefined) return state;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== VISITOR_COOKIE_NAME) continue;
    try {
      const raw = JSON.parse(base64UrlDecode(part.slice(eq + 1).trim())) as {
        h?: unknown;
        c?: unknown;
        a?: unknown;
      };
      if (Array.isArray(raw.h)) {
        state.history = raw.h.filter((l): l is string => typeof l === "string" && LOCATION.test(l));
      }
      if (raw.c !== null && typeof raw.c === "object") {
        for (const [k, v] of Object.entries(raw.c as Record<string, unknown>)) {
          if (typeof v === "string") state.cards[k] = v;
        }
      }
      if (typeof raw.a === "string" && raw.a !== "") {
        state.commentAuthor = raw.a;
      }
    } catch {
    }
  }
  return state;
}

export function visitorSessionCookie(state: VisitorSession, opts?: { secure?: boolean }): string {
  const attrs = `Path=/; HttpOnly; SameSite=Lax${opts?.secure === true ? "; Secure" : ""}`;
  const payload: { h?: string[]; c?: Record<string, string>; a?: string } = {};
  if (state.history !== undefined) payload.h = state.history;
  if (Object.keys(state.cards).length > 0) payload.c = state.cards;
  if (state.commentAuthor !== undefined && state.commentAuthor !== "") {
    payload.a = state.commentAuthor;
  }
  if (payload.h === undefined && payload.c === undefined && payload.a === undefined) {
    return `${VISITOR_COOKIE_NAME}=; ${attrs}; Max-Age=0`;
  }
  let value = base64UrlEncode(JSON.stringify(payload));
  if (value.length > COOKIE_VALUE_LIMIT && payload.c !== undefined) {
    value = base64UrlEncode(JSON.stringify({ h: payload.h ?? [] }));
  }
  return `${VISITOR_COOKIE_NAME}=${value}; ${attrs}`;
}

export function locationHistory(state: VisitorSession): string[] {
  state.history ??= ["/"];
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  return state.history;
}

export function shouldSaveLocation(view: {
  known: boolean;
  html: boolean;
  ajax: boolean;
  codename?: string | null;
}): boolean {
  return !view.ajax && view.html && view.known && view.codename !== "signin";
}

export function saveLocation(state: VisitorSession, url: string): void {
  if (!LOCATION.test(url)) return;
  const history = locationHistory(state);
  history.push(url);
  state.history = [...new Set(history)];
}

export function previousLocation(state: VisitorSession): string {
  return locationHistory(state).at(-1) ?? "/";
}

function locationCardKey(location: string): string {
  let path = location;
  const scheme = /^https?:\/\/[^/]*/.exec(location);
  if (scheme !== null) path = location.slice(scheme[0].length);
  path = path.replace(/[?#].*$/, "").replace(/^\//, "").replace(/\/.*$/, "");
  return DeckoName.parse(path).key;
}

export function discardLocationsFor(state: VisitorSession, cardName: string): void {
  const key = DeckoName.parse(cardName).key;
  state.history = locationHistory(state).filter((l) => locationCardKey(l) !== key);
}

export function sessionCardContent(state: VisitorSession, cardName: string): string | undefined {
  return state.cards[DeckoName.parse(cardName).key];
}

export function storeSessionCardContent(
  state: VisitorSession,
  cardName: string,
  content: string | undefined,
): void {
  const key = DeckoName.parse(cardName).key;
  if (content === undefined) delete state.cards[key];
  else state.cards[key] = content;
}

export function pageViewCookie(
  cookieHeader: string | undefined,
  url: string,
  view: { known: boolean; html: boolean; ajax: boolean; codename?: string | null },
  opts?: { secure?: boolean },
): string | undefined {
  if (!shouldSaveLocation(view)) return undefined;
  const state = readVisitorSession(cookieHeader);
  const before = visitorSessionCookie(state, opts);
  saveLocation(state, url);
  const after = visitorSessionCookie(state, opts);
  return after === before ? undefined : after;
}

export function sameVisitorSession(a: VisitorSession, b: VisitorSession): boolean {
  return visitorSessionCookie(a) === visitorSessionCookie(b);
}

export function cloneVisitorSession(state: VisitorSession): VisitorSession {
  return {
    ...(state.history === undefined ? {} : { history: [...state.history] }),
    cards: { ...state.cards },
  };
}
