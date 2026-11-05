import { cardWallClockNow } from "../wall-clock.js";
import { deckTimeZoneName } from "../deck-time-zone.js";

class CardErrorBadQuery extends Error {
  readonly query: string;
  constructor(query: string, message: string = `Invalid JSON search query: ${query}`) {
    super(message);
    this.name = "Card::Error::BadQuery";
    this.query = query;
  }
}
Object.defineProperty(CardErrorBadQuery, "name", { value: "Card::Error::BadQuery" });

export const BadQueryError: typeof Error & { new (query: string, message?: string): Error & { query: string } } =
  CardErrorBadQuery as unknown as typeof Error & {
    new (query: string, message?: string): Error & { query: string };
  };

export function badQuery(query: string): Error & { query: string } {
  return new CardErrorBadQuery(query);
}

export function emptyQueryError(): Error & { query: string } {
  const err = new CardErrorBadQuery("", "can't run search with empty content");
  return err;
}

export const BAD_QUERY_CLASS_NAME = "Card::Error::BadQuery";

class RubyDateError extends Error {
  constructor(message: string = "invalid date") {
    super(message);
    this.name = "Date::Error";
  }
}
Object.defineProperty(RubyDateError, "name", { value: "Date::Error" });

export const DateError: typeof Error & { new (message?: string): Error } =
  RubyDateError as unknown as typeof Error & { new (message?: string): Error };

export function dateError(message: string = "invalid date"): Error {
  return new RubyDateError(message);
}

export const DATE_ERROR_CLASS_NAME = "Date::Error";

class RubyNoMethodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoMethodError";
  }
}
Object.defineProperty(RubyNoMethodError, "name", { value: "NoMethodError" });

export function mainNestWithoutMainError(): Error {
  return new RubyNoMethodError("undefined method `rendered' for nil");
}

export const NO_METHOD_ERROR_CLASS_NAME = "NoMethodError";

function fillFromReferenceMonth(day: number): Date | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: deckTimeZoneName(),
    year: "numeric",
    month: "numeric",
  }).formatToParts(cardWallClockNow());
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return new Date(Date.UTC(year, month - 1, day));
}

export function parseRubyDateContent(content: string): Date | null {
  if (content === "") return null;
  if (/^\d{8}$/.test(content)) {
    const y = Number(content.slice(0, 4));
    const m = Number(content.slice(4, 6));
    const d = Number(content.slice(6, 8));
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return new Date(Date.UTC(y, m - 1, d));
    return null;
  }
  const dashMatch = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(content);
  if (dashMatch !== null) {
    let y = Number(dashMatch[1]);
    const m = Number(dashMatch[2]);
    const d = Number(dashMatch[3]);
    if (y < 100) y += y <= 68 ? 2000 : 1900;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d
    ) {
      return null;
    }
    return date;
  }
  const dayZone = /^(\d{1,2})-(\d{3,4})$/.exec(content);
  if (dayZone !== null) {
    const day = Number(dayZone[1]);
    if (day < 1 || day > 31) return null;
    return fillFromReferenceMonth(day);
  }
  const twoPart = /^(\d{1,5})-(\d{1,5})$/.exec(content);
  if (twoPart !== null) {
    const day = Number(twoPart[1]);
    const zone = twoPart[2];
    if (zone.length !== 2) return null;
    if (day > 31) return null;
    if (day < 10 && (zone === "00" || Number(zone) > 31)) return null;
    return fillFromReferenceMonth(day);
  }
  const slashMatch = /^(\d{1,4})\/(\d{1,2})\/(\d{1,4})$/.exec(content);
  if (slashMatch !== null) {
    const a = Number(slashMatch[1]);
    const b = Number(slashMatch[2]);
    const c = Number(slashMatch[3]);
    if (a >= 1000) {
      if (b >= 1 && b <= 12 && c >= 1 && c <= 31) {
        return new Date(Date.UTC(a, b - 1, c));
      }
      return null;
    }
    if (c >= 1000) {
      if (a >= 1 && a <= 31 && b >= 1 && b <= 12) {
        return new Date(Date.UTC(c, b - 1, a));
      }
      return null;
    }
    if (b >= 1 && b <= 12 && c >= 1 && c <= 31) {
      const y = a <= 99 ? (a <= 68 ? 2000 + a : 1900 + a) : a;
      return new Date(Date.UTC(y, b - 1, c));
    }
    return null;
  }
  if (/^\d+$/.test(content)) return null;
  const parsed = new Date(content);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function isValidDateContent(content: string): boolean {
  return parseRubyDateContent(content) !== null;
}

export class RuntimeError extends Error {
  constructor() {
    super("%{func} not implemented");
    this.name = "RuntimeError";
  }
}

export function isUpstreamMatchError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "RuntimeError" &&
    error.message === "%{func} not implemented"
  );
}

export function upstreamMatchError(): Error {
  return new RuntimeError();
}
