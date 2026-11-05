export interface OriginPolicy {
  enabled: boolean;
  trustedOrigins: string[];
}

export interface OriginEnv {
  readonly DECKO_ORIGIN_CHECK?: unknown;
  readonly DECKO_TRUSTED_ORIGINS?: unknown;
}

export interface OriginRequest {
  headers: Record<string, string | undefined>;
  host: string | undefined;
}

export type OriginVerdict = { ok: true } | { ok: false; reason: string };

function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function originPolicyFromEnv(env: OriginEnv | undefined): OriginPolicy {
  const check = typeof env?.DECKO_ORIGIN_CHECK === "string" ? env.DECKO_ORIGIN_CHECK.trim().toLowerCase() : "";
  if (check !== "" && check !== "on" && check !== "off") {
    throw new Error(`DECKO_ORIGIN_CHECK must be "on" or "off", got ${JSON.stringify(env?.DECKO_ORIGIN_CHECK)}`);
  }
  const listed = typeof env?.DECKO_TRUSTED_ORIGINS === "string" ? env.DECKO_TRUSTED_ORIGINS : "";
  const trustedOrigins: string[] = [];
  for (const raw of listed.split(",").map((s) => s.trim()).filter(Boolean)) {
    const origin = normalizeOrigin(raw);
    if (origin === null) throw new Error(`DECKO_TRUSTED_ORIGINS: not an http(s) origin: ${JSON.stringify(raw)}`);
    trustedOrigins.push(origin);
  }
  return { enabled: check !== "off", trustedOrigins };
}

export function defaultOriginPolicy(): OriginPolicy {
  const proc = (globalThis as { process?: { env?: OriginEnv } }).process;
  return originPolicyFromEnv(proc?.env);
}

function authority(host: string): string {
  const h = host.trim().toLowerCase();
  return h.replace(/:(80|443)$/, "");
}

function sameDeck(candidate: string, req: OriginRequest, policy: OriginPolicy): boolean {
  const origin = normalizeOrigin(candidate);
  if (origin === null) return false;
  if (policy.trustedOrigins.includes(origin)) return true;
  if (req.host === undefined || req.host === "") return false;
  return authority(new URL(origin).host) === authority(req.host);
}

export function checkRequestOrigin(req: OriginRequest, policy: OriginPolicy = defaultOriginPolicy()): OriginVerdict {
  if (!policy.enabled) return { ok: true };
  const origin = req.headers["origin"];
  const site = req.headers["sec-fetch-site"]?.trim().toLowerCase();
  if (site === "same-site" || site === "cross-site") {
    if (origin !== undefined && origin !== "null" && sameDeck(origin, req, policy)) return { ok: true };
    return { ok: false, reason: `the browser reports a ${site} request` };
  }
  if (origin !== undefined && origin !== "") {
    if (origin.trim().toLowerCase() === "null") return { ok: false, reason: "the request has an opaque (null) origin" };
    return sameDeck(origin, req, policy) ? { ok: true } : { ok: false, reason: `the request comes from ${origin}` };
  }
  const referer = req.headers["referer"];
  if (referer !== undefined && referer !== "") {
    return sameDeck(referer, req, policy) ? { ok: true } : { ok: false, reason: "the request's referring page is on another site" };
  }
  return { ok: true };
}

export const CROSS_ORIGIN_MESSAGE =
  "This request was refused because it came from another site. If you submitted a form on this deck, reload the page and try again.";
