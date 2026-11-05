import { randomBytes, randomUUID } from "node:crypto";

export function generatedPassword(label: string): string {
  const safeLabel = label.replace(/[^A-Za-z]/g, "") || "Flow";
  const body = randomBytes(24).toString("base64url").replace(/[^A-Za-z0-9]/g, "");
  return `${safeLabel}${body}A7!`;
}

export function generatedEmail(localPart: string): string {
  const safeLocal = localPart.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "user";
  return `${safeLocal}-${randomBytes(6).toString("hex")}@example.com`;
}

export function generatedTokenSecret(): string {
  return randomBytes(32).toString("hex");
}

export function generatedToken(): string {
  return randomUUID().replace(/-/g, "");
}
