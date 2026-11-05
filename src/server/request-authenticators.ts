import {
  PermissionDeniedError,
  claimAnonymous,
  claimUserId,
  validateAuthToken,
  type TokenRuntimeConfig,
} from "../card/auth/token.js";

const TOKEN_REGEX = /^(Token|Bearer)\s+/;

const TOKEN_KEY = "token=";

const AUTHN_PAIR_DELIMITERS = /(?:,|;|\t)/;

export function actionpackTokenFromAuthorization(
  authorization: string | undefined | null,
): string | null {
  if (typeof authorization !== "string" || !TOKEN_REGEX.test(authorization)) return null;
  const raw = authorization
    .replace(TOKEN_REGEX, "")
    .split(AUTHN_PAIR_DELIMITERS)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const first = raw[0] === undefined || !raw[0].startsWith(TOKEN_KEY)
    ? `${TOKEN_KEY}${raw[0] ?? ""}`
    : raw[0];
  const equals = first.indexOf("=");
  if (equals === -1) return null;
  const rawValue = first.slice(equals + 1);
  if (rawValue === "") return null;
  return rawValue.replace(/^"|"$/g, "");
}

export interface AuthenticatorHeaders {
  readonly authorization?: string | null | undefined;
  readonly [key: string]: string | null | undefined;
}

export function requestToken(
  headers: AuthenticatorHeaders,
  searchParams?: URLSearchParams | null,
): string | null {
  const fromHeader = actionpackTokenFromAuthorization(headers.authorization);
  if (fromHeader !== null) return fromHeader;
  const fromParam = searchParams?.get("token");
  return fromParam === null || fromParam === undefined ? null : fromParam;
}

export function requestApiKey(
  headers: AuthenticatorHeaders,
  searchParams?: URLSearchParams | null,
): string | null {
  const fromHeader = headers["x-api-key"];
  if (typeof fromHeader === "string") return fromHeader;
  const fromParam = searchParams?.get("api_key");
  return fromParam === null || fromParam === undefined ? null : fromParam;
}

export type TokenSignin =
  | { readonly kind: "actor"; readonly actorId: number }
  | { readonly kind: "anonymous" }
  | { readonly kind: "denied"; readonly reason: string };

export async function signinFromToken(
  config: TokenRuntimeConfig,
  token: string,
): Promise<TokenSignin> {
  let claims;
  try {
    claims = await validateAuthToken(config, token);
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { kind: "denied", reason: error.message };
    }
    throw error;
  }
  if (claimAnonymous(claims) === true) return { kind: "anonymous" };
  const userId = claimUserId(claims);
  if (userId === undefined) return { kind: "anonymous" };
  const actorId = typeof userId === "number" ? userId : Number.parseInt(userId, 10);
  if (!Number.isFinite(actorId)) return { kind: "anonymous" };
  return { kind: "actor", actorId };
}

export type ReadTokenAuth =
  | { readonly kind: "absent" }
  | { readonly kind: "anonymous" }
  | { readonly kind: "actor"; readonly actorId: number }
  | { readonly kind: "denied"; readonly reason: string };

export async function resolveReadTokenAuth(
  headers: AuthenticatorHeaders,
  searchParams: URLSearchParams | null | undefined,
  tokenConfig: TokenRuntimeConfig | undefined,
): Promise<ReadTokenAuth> {
  const token = requestToken(headers, searchParams);
  if (token === null) return { kind: "absent" };
  if (tokenConfig === undefined) return { kind: "absent" };
  const signin = await signinFromToken(tokenConfig, token);
  if (signin.kind === "denied") return { kind: "denied", reason: signin.reason };
  if (signin.kind === "anonymous") return { kind: "anonymous" };
  return { kind: "actor", actorId: signin.actorId };
}

export type ApiKeyAuthenticator = (apiKey: string) => Promise<
  { readonly kind: "actor"; readonly actorId: number } | { readonly kind: "denied"; readonly reason: string }
>;

export type ReadAuth =
  | { readonly kind: "absent" }
  | { readonly kind: "anonymous" }
  | { readonly kind: "actor"; readonly actorId: number }
  | { readonly kind: "denied"; readonly reason: string };

export async function resolveReadAuthenticators(
  headers: AuthenticatorHeaders,
  searchParams: URLSearchParams | null | undefined,
  tokenConfig: TokenRuntimeConfig | undefined,
  apiKeyAuthenticator?: ApiKeyAuthenticator,
): Promise<ReadAuth> {
  const tokenAuth = await resolveReadTokenAuth(headers, searchParams, tokenConfig);
  if (tokenAuth.kind !== "absent") return tokenAuth;
  if (apiKeyAuthenticator === undefined) return { kind: "absent" };
  const apiKey = requestApiKey(headers, searchParams);
  if (apiKey === null) return { kind: "absent" };
  const signin = await apiKeyAuthenticator(apiKey);
  if (signin.kind === "denied") return { kind: "denied", reason: signin.reason };
  return { kind: "actor", actorId: signin.actorId };
}
