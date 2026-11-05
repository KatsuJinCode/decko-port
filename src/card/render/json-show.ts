import type { ViewResult } from "./format.js";
import { cardWallClockNow } from "../wall-clock.js";

export function jsonShowResult(raw: ViewResult, requestUrl: string, compress?: unknown): string {
  if (typeof raw === "string") return raw;
  const requestedAt = `${cardWallClockNow().toISOString().slice(0, 19).replace("T", " ")} UTC`;
  const result = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? { ...raw, url: requestUrl, requested_at: requestedAt }
    : raw;
  return JSON.stringify(result, null, compress !== undefined && compress !== null && compress !== false ? 0 : 2);
}
