import { sha1Hex } from "./signin.js";
import { tokensEqual } from "./session-token.js";

export type PasswordHashMode = "pbkdf2" | "legacy-sha1";

export interface PasswordHashPolicy {
  mode: PasswordHashMode;
  iterations: number;
}

export const OWASP_PBKDF2_SHA256_ITERATIONS = 600_000;

export const MIN_PBKDF2_ITERATIONS = 100_000;

export const CLOUDFLARE_WORKERS_PBKDF2_MAX_ITERATIONS = 100_000;

const PBKDF2_PREFIX = "pbkdf2_sha256";
const SALT_BYTES = 16;
const HASH_BITS = 256;
const PBKDF2_RE = /^pbkdf2_sha256\$(\d{1,9})\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;
const LEGACY_RE = /^[0-9a-f]{40}$/;

let platformLimit: { iterations: number; runtime: string } | undefined;
let configured: PasswordHashPolicy | undefined;

export function setPbkdf2IterationLimit(limit: { iterations: number; runtime: string } | undefined): void {
  platformLimit = limit;
}

export interface PasswordHashEnv {
  readonly DECKO_PASSWORD_HASH?: unknown;
  readonly DECKO_PASSWORD_PBKDF2_ITERATIONS?: unknown;
}

export function passwordHashPolicyFromEnv(env: PasswordHashEnv | undefined): PasswordHashPolicy {
  const rawMode = typeof env?.DECKO_PASSWORD_HASH === "string" ? env.DECKO_PASSWORD_HASH.trim() : "";
  const mode: PasswordHashMode = rawMode === "" ? "pbkdf2" : (rawMode as PasswordHashMode);
  if (mode !== "pbkdf2" && mode !== "legacy-sha1") {
    throw new Error(`DECKO_PASSWORD_HASH must be "pbkdf2" or "legacy-sha1", got ${JSON.stringify(rawMode)}`);
  }
  const ceiling = platformLimit?.iterations ?? Number.MAX_SAFE_INTEGER;
  const rawIterations =
    typeof env?.DECKO_PASSWORD_PBKDF2_ITERATIONS === "string" ? env.DECKO_PASSWORD_PBKDF2_ITERATIONS.trim() : "";
  let iterations = Math.min(OWASP_PBKDF2_SHA256_ITERATIONS, ceiling);
  if (rawIterations !== "") {
    if (!/^\d+$/.test(rawIterations)) {
      throw new Error(`DECKO_PASSWORD_PBKDF2_ITERATIONS must be a whole number, got ${JSON.stringify(rawIterations)}`);
    }
    iterations = Number(rawIterations);
    if (iterations < MIN_PBKDF2_ITERATIONS) {
      throw new Error(`DECKO_PASSWORD_PBKDF2_ITERATIONS must be at least ${MIN_PBKDF2_ITERATIONS}, got ${iterations}`);
    }
    if (iterations > ceiling) {
      throw new Error(
        `DECKO_PASSWORD_PBKDF2_ITERATIONS=${iterations} exceeds the PBKDF2 limit of ${platformLimit!.runtime} (${ceiling})`,
      );
    }
  }
  return { mode, iterations };
}

export function configurePasswordHashing(policy: PasswordHashPolicy | undefined): void {
  configured = policy;
}

function processEnv(): PasswordHashEnv | undefined {
  const proc = (globalThis as { process?: { env?: PasswordHashEnv } }).process;
  return proc?.env;
}

export function passwordHashPolicy(): PasswordHashPolicy {
  return configured ?? passwordHashPolicyFromEnv(processEnv());
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, HASH_BITS);
  return new Uint8Array(bits);
}

export function isPbkdf2Hash(stored: string): boolean {
  return PBKDF2_RE.test(stored);
}

export function isLegacyDigest(stored: string): boolean {
  return LEGACY_RE.test(stored);
}

export function legacyDigest(password: string, salt: string): Promise<string> {
  return sha1Hex(`${salt}--${password}--`);
}

export async function hashPassword(
  password: string,
  legacySalt: string,
  policy: PasswordHashPolicy = passwordHashPolicy(),
): Promise<string> {
  if (policy.mode === "legacy-sha1") return legacyDigest(password, legacySalt);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, policy.iterations);
  return `${PBKDF2_PREFIX}$${policy.iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

export interface PasswordCheck {
  ok: boolean;
  needsUpgrade: boolean;
  unsupported?: string;
}

export async function checkPassword(
  stored: string,
  password: string,
  legacySalt: string,
  policy: PasswordHashPolicy = passwordHashPolicy(),
): Promise<PasswordCheck> {
  const m = PBKDF2_RE.exec(stored);
  if (m !== null) {
    const iterations = Number(m[1]);
    const salt = fromBase64(m[2]!);
    const expected = fromBase64(m[3]!);
    let actual: Uint8Array;
    try {
      actual = await pbkdf2(password, salt, iterations);
    } catch (error) {
      return {
        ok: false,
        needsUpgrade: false,
        unsupported: `this runtime cannot compute PBKDF2 with ${iterations} iterations: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    const ok = expected.length === actual.length && tokensEqual(toBase64(actual), toBase64(expected));
    return { ok, needsUpgrade: ok && policy.mode === "pbkdf2" && iterations < policy.iterations };
  }
  const ok = stored !== "" && tokensEqual(await legacyDigest(password, legacySalt), stored);
  return { ok, needsUpgrade: ok && policy.mode === "pbkdf2" };
}
