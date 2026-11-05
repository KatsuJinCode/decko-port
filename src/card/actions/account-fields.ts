import { createHash } from "node:crypto";
import { hashPassword, type PasswordHashPolicy } from "../auth/password-hash.js";

export const NO_HISTORY_RIGHT_CODENAMES: ReadonlySet<string> = new Set(["password", "salt"]);

export function encryptPassword(password: string, salt: string | null | undefined): string {
  return createHash("sha1").update(`${salt ?? ""}--${password}--`).digest("hex");
}

export function storedPasswordValue(
  password: string,
  salt: string | null | undefined,
  policy?: PasswordHashPolicy,
): Promise<string> {
  return hashPassword(password, salt ?? "", policy);
}

function rubyUtcTime(now: Date): string {
  return `${now.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function generateSalt(now: Date): string {
  return createHash("sha1").update(`--${rubyUtcTime(now)}--`).digest("hex");
}

export function passwordErrors(password: string): string[] {
  const errors: string[] = [];
  if ([...password].length < 8) errors.push("must be 8 characters or longer");
  const missing: string[] = [];
  if (!/[a-z]/.test(password)) missing.push("a lower case letter");
  if (!/[A-Z]/.test(password)) missing.push("an upper case letter");
  if (!/[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(password)) missing.push("a special character (like !@$%&#)");
  if (!/\d+/.test(password)) missing.push("a number");
  if (missing.length > 0) {
    const text =
      missing.length > 2 ? `${missing.slice(0, -1).join(", ")}, and ${missing[missing.length - 1]}` : missing.join(" and ");
    errors.push(`must contain ${text}`);
  }
  return errors;
}

export const DEFAULT_ACCOUNT_STATUS = "active";
