import { checkRequestOrigin, CROSS_ORIGIN_MESSAGE, defaultOriginPolicy, type OriginPolicy } from "./request-origin.js";
import type { SQLDatabaseDriver } from "./driver.js";
import type { FetchEngine } from "../card/fetch.js";
import {
  createOwnerAccount,
  firstRunEnabled,
  setupWindowState,
  SETUP_CLOSED_REASONS,
  SIGN_IN_PATH,
  type SetupClosedReason,
  type SetupWindowReason,
} from "../card/auth/first-run-setup.js";
import {
  checkSetupToken,
  clearDeckSetupTokens,
  presentedSetupToken,
  SETUP_TOKEN_PARAM,
} from "../card/auth/setup-token.js";
import { setPreparedSetupVerdict } from "../card/auth/first-run-setup-verdict-seam.js";

export const SETUP_PATH = "/setup";

export interface FirstRunRouteRequest {
  readonly method: string;
  readonly pathname: string;
  readonly host: string | undefined;
  readonly scheme?: "http" | "https";
  readonly headers: Record<string, string | undefined>;
  readonly body: string;
  readonly search?: string;
}

export interface FirstRunRouteResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly expiryName?: string;
}

export interface FirstRunRouteContext {
  readonly driver: SQLDatabaseDriver;
  readonly fetcher: FetchEngine;
  readonly now?: () => Date;
  readonly originPolicy?: OriginPolicy;
  readonly corpusShippedAccountHolderIds?: readonly number[];
}

export async function handleFirstRunRequest(
  ctx: FirstRunRouteContext,
  req: FirstRunRouteRequest,
): Promise<FirstRunRouteResponse | null> {
  if (!firstRunEnabled()) return null;
  if (req.pathname !== SETUP_PATH) return null;
  if (req.method !== "GET" && req.method !== "POST") return null;

  const window = await setupWindowState({
    driver: ctx.driver,
    ...(ctx.corpusShippedAccountHolderIds !== undefined
      ? { corpusShippedAccountHolderIds: ctx.corpusShippedAccountHolderIds }
      : {}),
  });
  if (window.open) {
    setPreparedSetupVerdict({ open: true, accountCount: window.accountCount });
  } else if (window.reason === "setup_complete") {
    setPreparedSetupVerdict({ open: false, accountCount: window.accountCount });
  }
  if (!window.open) {
    return notFoundResponse(window.reason);
  }

  const linkToken = presentedSetupToken(req.search, undefined);
  let formAction: string | undefined;
  if (linkToken !== undefined) {
    const check = await checkSetupToken(ctx.driver, linkToken);
    if (!check.ok) {
      return htmlResponse(403, "Set up this deck", renderSetupFormHtml("setup_token", check.message));
    }
    formAction = `${SETUP_PATH}?${SETUP_TOKEN_PARAM}=${encodeURIComponent(linkToken)}`;
  }

  if (req.method === "GET") {
    return htmlResponse(200, "Set up this deck", renderSetupFormHtml(null, null, formAction));
  }

  const origin = checkRequestOrigin({ headers: req.headers, host: req.host }, ctx.originPolicy ?? defaultOriginPolicy());
  if (!origin.ok) {
    return htmlResponse(403, "Set up this deck", renderSetupFormHtml(null, `${CROSS_ORIGIN_MESSAGE} (${origin.reason})`, formAction));
  }

  const submitted = parseSetupForm(req.body, req.headers["content-type"] ?? "");
  if (submitted === null) {
    return htmlResponse(
      400,
      "Set up this deck",
      renderSetupFormHtml(null, "Could not read the submitted form.", formAction),
    );
  }

  const token = await checkSetupToken(ctx.driver, linkToken ?? presentedSetupToken(undefined, submitted.setupToken));
  if (!token.ok) {
    return htmlResponse(403, "Set up this deck", renderSetupFormHtml("setup_token", token.message, formAction));
  }

  const outcome = await createOwnerAccount(
    {
      driver: ctx.driver,
      fetcher: ctx.fetcher,
      now: ctx.now,
      ...(ctx.corpusShippedAccountHolderIds !== undefined
        ? { corpusShippedAccountHolderIds: ctx.corpusShippedAccountHolderIds }
        : {}),
    },
    {
      email: submitted.email,
      password: submitted.password,
      ...(submitted.cardName !== undefined && submitted.cardName !== ""
        ? { cardName: submitted.cardName }
        : {}),
    },
  );
  if (!outcome.ok) {
    if (isWindowReason(outcome.reason)) return notFoundResponse(outcome.reason);
    return htmlResponse(
      422,
      "Set up this deck",
      renderSetupFormHtml(outcome.field ?? null, outcome.message, formAction),
      { "Cache-Control": "no-store" },
    );
  }
  await clearDeckSetupTokens(ctx.driver);
  return {
    status: 303,
    headers: {
      Location: absoluteUrl(req, outcome.signInAt),
      "Cache-Control": "no-store",
    },
    body: "",
    expiryName: outcome.owner.name,
  };
}

function isWindowReason(reason: string): reason is SetupClosedReason {
  return (SETUP_CLOSED_REASONS as ReadonlyArray<string>).includes(reason);
}

function htmlResponse(
  status: number,
  title: string,
  body: string,
  extraHeaders: Record<string, string> = {},
): FirstRunRouteResponse {
  return {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body:
      `<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title></head>` +
      `<body>${body}</body></html>`,
  };
}

function notFoundResponse(reason: SetupWindowReason): FirstRunRouteResponse {
  return htmlResponse(404, "Not Found", `<p>${escapeHtml(CLOSED_BODY[reason])}</p>`);
}

function absoluteUrl(req: FirstRunRouteRequest, path: string): string {
  if (req.host === undefined || req.host === "") return path;
  return `${req.scheme ?? "http"}://${req.host}${path}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CLOSED_BODY: Record<SetupWindowReason, string> = {
  disabled: "First-run setup is not enabled on this deck.",
  write_path_disabled: "This deck is running read-only, so it cannot create an account.",
  account_system_absent: "This deck has no account system, so it has no first account to create.",
  bot_card_absent: "This deck has no Decko Bot card, so the account census cannot run.",
  setup_complete: "This deck already has an account. Sign in instead.",
  needs_setup: "First-run setup is not enabled on this deck.",
};

function renderSetupFormHtml(
  errorField: "email" | "password" | "setup_token" | null,
  errorMessage: string | null,
  formAction: string = SETUP_PATH,
): string {
  const error =
    errorMessage === null
      ? ""
      : `<p class="form-error" data-field="${escapeHtml(errorField ?? "")}">${escapeHtml(errorMessage)}</p>\n`;
  return (
    `<div class="d0-card-frame card">\n` +
    `<div class="d0-card-header card-header">\n` +
    `<h1 class="d0-card-header-title">\n` +
    `<span class="card-title" title="Set up">Set up</span></h1></div>\n` +
    `\n` +
    `<div class="d0-card-body card-body card-text">\n` +
    `<p>Your deck is ready to go!</p>\n` +
    error +
    `<form action="${escapeHtml(formAction)}" method="post" class="first-run-setup-form">\n` +
    (formAction === SETUP_PATH
      ? `<div class="form-group">\n` +
        `<label for="setup_token">Setup token</label>\n` +
        `<input type="password" name="setup_token" id="setup_token" class="form-control" autocomplete="off" />\n` +
        `</div>\n`
      : "") +
    `<div class="form-group">\n` +
    `<label for="card_name">Name</label>\n` +
    `<input type="text" name="card[name]" id="card_name" class="form-control" autocomplete="off" />\n` +
    `</div>\n` +
    `<div class="form-group">\n` +
    `<label for="setup_email">Email</label>\n` +
    `<input type="text" name="email" id="setup_email" class="form-control" autocomplete="username" />\n` +
    `</div>\n` +
    `<div class="form-group">\n` +
    `<label for="setup_password">Password</label>\n` +
    `<input type="password" name="password" id="setup_password" class="form-control" autocomplete="new-password" />\n` +
    `</div>\n` +
    `<button type="submit" class="btn btn-primary">Set up</button>\n` +
    `</form>\n` +
    `<!-- decko-ts first-run setup: NEW surface, off unless DECKO_FIRST_RUN=1. The census behind it is Ruby's Card::Auth.needs_setup? (card-1.110.0 lib/card/auth/setup.rb:33-52). -->\n` +
    `</div></div>`
  );
}

export function parseSetupForm(
  body: string,
  contentTypeHeader: string,
): { email: string; password: string; setupToken: string; cardName: string } | null {
  const contentType = contentTypeHeader.split(";")[0].trim().toLowerCase();
  if (contentType === "application/x-www-form-urlencoded" || contentType === "") {
    const params = new URLSearchParams(body);
    return {
      email: params.get("email") ?? "",
      password: params.get("password") ?? "",
      setupToken: params.get("setup_token") ?? "",
      cardName: params.get("card[name]") ?? "",
    };
  }
  if (contentType === "application/json") {
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed !== "object" || parsed === null) return null;
      const obj = parsed as Record<string, unknown>;
      const card = typeof obj["card"] === "object" && obj["card"] !== null
        ? (obj["card"] as Record<string, unknown>)
        : {};
      return {
        email: typeof obj["email"] === "string" ? obj["email"] : "",
        password: typeof obj["password"] === "string" ? obj["password"] : "",
        setupToken: typeof obj["setup_token"] === "string" ? obj["setup_token"] : "",
        cardName: typeof card["name"] === "string" ? card["name"] : "",
      };
    } catch {
      return null;
    }
  }
  return null;
}

export { SIGN_IN_PATH };

export { firstRunEnabled };
