import type { SQLDatabaseDriver } from "../../server/driver.js";
import { sha256Hex, tokensEqual } from "./session-token.js";

export const SETUP_TOKEN_PARAM = "token";

let generated: string | undefined;
let configured: string | undefined;

function processEnvToken(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const raw = proc?.env?.["DECKO_SETUP_TOKEN"];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

export function configureSetupToken(token: string | undefined): void {
  configured = typeof token === "string" && token.trim() !== "" ? token.trim() : undefined;
}

export function armGeneratedSetupToken(): string | undefined {
  if ((configured ?? processEnvToken()) !== undefined) return undefined;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  generated = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return generated;
}

export function clearGeneratedSetupToken(): void {
  generated = undefined;
}

export function requiredSetupToken(): string | undefined {
  return configured ?? processEnvToken() ?? generated;
}

async function deckIssuedDigests(driver: SQLDatabaseDriver): Promise<string[]> {
  try {
    const result = await driver.query<{ token_sha256: string }>(`SELECT "token_sha256" FROM "deck_setup_tokens"`, []);
    return result.rows.map((r) => r.token_sha256);
  } catch {
    return [];
  }
}

export async function clearDeckSetupTokens(driver: SQLDatabaseDriver): Promise<void> {
  try {
    await driver.query(`DELETE FROM "deck_setup_tokens"`, []);
  } catch {
  }
}

export function presentedSetupToken(search: string | undefined, formField: string | undefined): string | undefined {
  const fromQuery = new URLSearchParams(search ?? "").get(SETUP_TOKEN_PARAM);
  if (fromQuery !== null && fromQuery.trim() !== "") return fromQuery.trim();
  if (typeof formField === "string" && formField.trim() !== "") return formField.trim();
  return undefined;
}

export type SetupTokenCheck =
  | { ok: true }
  | { ok: false; reason: "no_token_configured" | "wrong_token"; message: string };

export const SETUP_TOKEN_MESSAGES = {
  no_token_configured:
    "Setup needs a setup token, and this deck has none. Run `npm run setup-token` to issue a one-time setup link, " +
    "or set DECKO_SETUP_TOKEN and submit it with the form.",
  wrong_token:
    "The setup token is missing or not correct. Use the setup link printed by the most recent deploy, " +
    "the token printed when the server started, or the value of DECKO_SETUP_TOKEN.",
} as const;

export async function checkSetupToken(driver: SQLDatabaseDriver, presented: string | undefined): Promise<SetupTokenCheck> {
  const plain = requiredSetupToken();
  const digests = await deckIssuedDigests(driver);
  if (plain === undefined && digests.length === 0) {
    return { ok: false, reason: "no_token_configured", message: SETUP_TOKEN_MESSAGES.no_token_configured };
  }
  const submitted = (presented ?? "").trim();
  if (submitted !== "") {
    if (plain !== undefined && tokensEqual(submitted, plain)) return { ok: true };
    if (digests.length > 0) {
      const digest = await sha256Hex(submitted);
      let matched = false;
      for (const d of digests) if (tokensEqual(d, digest)) matched = true;
      if (matched) return { ok: true };
    }
  }
  return { ok: false, reason: "wrong_token", message: SETUP_TOKEN_MESSAGES.wrong_token };
}
