export const ORACLE_SECURITY_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Download-Options": "noopen",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-XSS-Protection": "1; mode=block",
});

export function applyOracleSecurityResponseHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = { ...(headers ?? {}) };
  const present = new Set(Object.keys(out).map((name) => name.toLowerCase()));
  for (const [name, value] of Object.entries(ORACLE_SECURITY_RESPONSE_HEADERS)) {
    if (!present.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}
