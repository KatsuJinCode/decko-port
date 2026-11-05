import { constantTimeEqual } from "./session-token.js";

const ALGORITHM = "HS256";

export const DEFAULT_TOKEN_EXPIRY_SECONDS = 2 * 24 * 60 * 60;

export type TokenClaims = Readonly<Record<string, unknown>>;

export type TokenClaimValue = string | number | boolean | null | TokenClaimValue[] | {
  [member: string]: TokenClaimValue;
};

export type ExtraTokenPayload = Readonly<Record<string, unknown>>;

export interface TokenRuntimeConfig {
  readonly secret: string;
  readonly tokenExpirySeconds?: number;
  readonly now?: () => number;
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

const NIL_TOKEN = "Nil JSON web token";
const SEGMENT_COUNT = "Not enough or too many segments";
const SEGMENT_ENCODING = "Invalid segment encoding";
const WRONG_ALGORITHM = "Expected a different algorithm";
const BAD_SIGNATURE = "Signature verification failed";
const EXPIRED = "Signature has expired";
const NOT_BEFORE = "Signature nbf has not been reached";

function resolveConfig(config: TokenRuntimeConfig): {
  secret: string;
  expirySeconds: number;
  now: () => number;
} {
  if (typeof config?.secret !== "string" || config.secret.length === 0) {
    throw new TypeError(
      "TokenRuntimeConfig.secret is required: the Auth::Token HMAC key (token.rb:7 reads Rails' secret_key_base) was missing or empty",
    );
  }
  return {
    secret: config.secret,
    expirySeconds: config.tokenExpirySeconds ?? DEFAULT_TOKEN_EXPIRY_SECONDS,
    now: config.now ?? (() => Math.floor(Date.now() / 1000)),
  };
}

export function tokenExpiration(config: TokenRuntimeConfig): number {
  const resolved = resolveConfig(config);
  return Math.trunc(resolved.now() + resolved.expirySeconds);
}

function buildPayload(
  userId: string | number,
  exp: number,
  extraPayload: ExtraTokenPayload,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { user_id: userId, exp };
  for (const [key, value] of Object.entries(extraPayload)) payload[key] = value;
  return payload;
}

export function claimUserId(claims: TokenClaims): string | number | undefined {
  const value = claims?.user_id;
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

export function claimAnonymous(claims: TokenClaims): boolean | undefined {
  const value = claims?.anonymous;
  return typeof value === "boolean" ? value : undefined;
}

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToBinaryString(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64URL_ALPHABET[b0 >> 2];
    out += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += BASE64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

function base64UrlDecode(segment: string): Uint8Array | null {
  const clean = segment.replace(/=+$/, "");
  if (clean.length % 4 === 1) return null;
  const values: number[] = [];
  for (const char of clean) {
    const value = BASE64URL_ALPHABET.indexOf(char);
    if (value < 0) return null;
    values.push(value);
  }
  const bytes: number[] = [];
  for (let i = 0; i < values.length; i += 4) {
    const v0 = values[i]!;
    const v1 = values[i + 1];
    const v2 = values[i + 2];
    const v3 = values[i + 3];
    bytes.push((v0 << 2) | ((v1 ?? 0) >> 4));
    if (v2 === undefined) continue;
    bytes.push(((v1 & 0x0f) << 4) | (v2 >> 2));
    if (v3 === undefined) continue;
    bytes.push(((v2 & 0x03) << 6) | v3);
  }
  return new Uint8Array(bytes);
}

function decodeSegmentToText(segment: string): string | null {
  const bytes = base64UrlDecode(segment);
  if (bytes === null) return null;
  return bytesToBinaryString(bytes);
}

function utf8Decode(text: string): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(
    Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff),
  );
}

async function hmacSha256(key: string, data: string): Promise<Uint8Array> {
  const keyBytes = new TextEncoder().encode(key);
  const dataBytes = new TextEncoder().encode(data);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, dataBytes);
  return new Uint8Array(signature);
}

export async function encodeAuthToken(
  config: TokenRuntimeConfig,
  userId: string | number,
  extraPayload: ExtraTokenPayload = {},
): Promise<string> {
  const resolved = resolveConfig(config);
  const payload = buildPayload(userId, tokenExpiration(config), extraPayload);
  const encodedHeader = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: ALGORITHM })),
  );
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await hmacSha256(resolved.secret, signingInput);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function verifyClaims(
  claims: Record<string, unknown>,
  nowEpochSeconds: number,
): string | null {
  if (claims.exp !== undefined && claims.exp !== null) {
    const exp = Number(claims.exp) || 0;
    if (Math.trunc(exp) <= nowEpochSeconds) return EXPIRED;
  }
  if (claims.nbf !== undefined && claims.nbf !== null) {
    const nbf = Number(claims.nbf) || 0;
    if (Math.trunc(nbf) > nowEpochSeconds) return NOT_BEFORE;
  }
  return null;
}

export async function decodeAuthToken(
  config: TokenRuntimeConfig,
  token: string | undefined | null,
): Promise<TokenClaims | string> {
  try {
    const resolved = resolveConfig(config);
    if (typeof token !== "string") return NIL_TOKEN;

    const segments = token.split(".");
    if (segments.length !== 3) {
      if (segments.length === 2) {
        if (parseJsonSegment(segments[0]!) === null) return SEGMENT_ENCODING;
        return WRONG_ALGORITHM;
      }
      return SEGMENT_COUNT;
    }

    const header = parseJsonSegment(segments[0]!);
    if (header === null) return SEGMENT_ENCODING;

    if (typeof header.alg !== "string" || header.alg !== ALGORITHM) {
      return WRONG_ALGORITHM;
    }

    const expected = await hmacSha256(resolved.secret, `${segments[0]}.${segments[1]}`);
    const presented = base64UrlDecode(segments[2]!);
    if (presented === null || !secureCompare(presented, expected)) {
      return BAD_SIGNATURE;
    }

    const payload = parseJsonSegment(segments[1]!);
    if (payload === null) return SEGMENT_ENCODING;

    const claimFailure = verifyClaims(payload, resolved.now());
    if (claimFailure !== null) return claimFailure;

    return payload as TokenClaims;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function parseJsonSegment(segment: string): Record<string, unknown> | null {
  const text = decodeSegmentToText(segment);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(utf8Decode(text)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function secureCompare(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && constantTimeEqual(a, b);
}

export async function validateAuthToken(
  config: TokenRuntimeConfig,
  token: string | undefined | null,
): Promise<TokenClaims> {
  const payload = await decodeAuthToken(config, token);
  if (typeof payload === "string") throw new PermissionDeniedError(payload);
  return payload;
}
