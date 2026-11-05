import { t, tExists, type TOpts } from "../i18n/i18n.js";

export const ONE_LINE_CHARACTER_LIMIT = 60;

export function timeAgoInWords(from: Date | number | string, now: Date = new Date()): string {
  return distanceOfTimeInWords(from, now, {});
}

export function distanceOfTimeInWords(
  from: Date | number | string,
  to: Date | number | string,
  opts: { includeSeconds?: boolean } = {},
): string {
  const fromTime = normalizeTime(from);
  const toTime = normalizeTime(to);
  let a = fromTime;
  let b = toTime;
  if (a.getTime() > b.getTime()) {
    [a, b] = [b, a];
  }
  const distanceInMinutes = Math.round((b.getTime() - a.getTime()) / (1000 * 60));
  const distanceInSeconds = Math.round((b.getTime() - a.getTime()) / 1000);

  const tOpts: TOpts = { scope: "datetime.distance_in_words" };

  if (distanceInMinutes >= 0 && distanceInMinutes <= 1) {
    if (opts.includeSeconds !== true) {
      if (distanceInMinutes === 0) {
        return lookupOrFallback("less_than_x_minutes", { ...tOpts, count: 1 }, "less than a minute");
      }
      return lookupOrFallback(
        "x_minutes",
        { ...tOpts, count: distanceInMinutes },
        englishPlural(distanceInMinutes, "1 minute", `${distanceInMinutes} minutes`),
      );
    }
    switch (true) {
      case distanceInSeconds <= 4:
        return lookupOrFallback("less_than_x_seconds", { ...tOpts, count: 5 }, "less than 5 seconds");
      case distanceInSeconds <= 9:
        return lookupOrFallback("less_than_x_seconds", { ...tOpts, count: 10 }, "less than 10 seconds");
      case distanceInSeconds <= 19:
        return lookupOrFallback("less_than_x_seconds", { ...tOpts, count: 20 }, "less than 20 seconds");
      case distanceInSeconds <= 39:
        return lookupOrFallback("half_a_minute", tOpts, "half a minute");
      case distanceInSeconds <= 59:
        return lookupOrFallback("less_than_x_minutes", { ...tOpts, count: 1 }, "less than a minute");
      default:
        return lookupOrFallback("x_minutes", { ...tOpts, count: 1 }, "1 minute");
    }
  }

  if (distanceInMinutes >= 2 && distanceInMinutes < 45) {
    return lookupOrFallback(
      "x_minutes",
      { ...tOpts, count: distanceInMinutes },
      englishPlural(distanceInMinutes, "1 minute", `${distanceInMinutes} minutes`),
    );
  }
  if (distanceInMinutes >= 45 && distanceInMinutes < 90) {
    return lookupOrFallback("about_x_hours", { ...tOpts, count: 1 }, "about 1 hour");
  }
  if (distanceInMinutes >= 90 && distanceInMinutes < 1440) {
    const hours = Math.round(distanceInMinutes / 60);
    return lookupOrFallback(
      "about_x_hours",
      { ...tOpts, count: hours },
      englishPlural(hours, "about 1 hour", `about ${hours} hours`),
    );
  }
  if (distanceInMinutes >= 1440 && distanceInMinutes < 2520) {
    return lookupOrFallback("x_days", { ...tOpts, count: 1 }, "1 day");
  }
  if (distanceInMinutes >= 2520 && distanceInMinutes < 43200) {
    const days = Math.round(distanceInMinutes / 1440);
    return lookupOrFallback("x_days", { ...tOpts, count: days }, englishPlural(days, "1 day", `${days} days`));
  }
  if (distanceInMinutes >= 43200 && distanceInMinutes < 86400) {
    const months = Math.round(distanceInMinutes / 43200);
    return lookupOrFallback(
      "about_x_months",
      { ...tOpts, count: months },
      englishPlural(months, "about 1 month", `about ${months} months`),
    );
  }
  if (distanceInMinutes >= 86400 && distanceInMinutes < 525600) {
    const months = Math.round(distanceInMinutes / 43200);
    return lookupOrFallback("x_months", { ...tOpts, count: months }, englishPlural(months, "1 month", `${months} months`));
  }

  const fromYear = a.getFullYear() + (a.getMonth() >= 2 ? 1 : 0);
  let toYear = b.getFullYear();
  if (b.getMonth() < 2) toYear -= 1;
  let leapYears = 0;
  if (fromYear <= toYear) {
    const fyear = fromYear - 1;
    const leapsTo = Math.floor(toYear / 4) - Math.floor(toYear / 100) + Math.floor(toYear / 400);
    const leapsFrom = Math.floor(fyear / 4) - Math.floor(fyear / 100) + Math.floor(fyear / 400);
    leapYears = leapsTo - leapsFrom;
  }
  const MINUTES_IN_YEAR = 525600;
  const MINUTES_IN_QUARTER_YEAR = 131400;
  const MINUTES_IN_THREE_QUARTERS_YEAR = 394200;
  const minuteOffsetForLeapYear = leapYears * 1440;
  const minutesWithOffset = distanceInMinutes - minuteOffsetForLeapYear;
  const remainder = ((minutesWithOffset % MINUTES_IN_YEAR) + MINUTES_IN_YEAR) % MINUTES_IN_YEAR;
  const distanceInYears = Math.floor(minutesWithOffset / MINUTES_IN_YEAR);

  if (remainder < MINUTES_IN_QUARTER_YEAR) {
    return lookupOrFallback(
      "about_x_years",
      { ...tOpts, count: distanceInYears },
      englishPlural(distanceInYears, "about 1 year", `about ${distanceInYears} years`),
    );
  }
  if (remainder < MINUTES_IN_THREE_QUARTERS_YEAR) {
    return lookupOrFallback(
      "over_x_years",
      { ...tOpts, count: distanceInYears },
      englishPlural(distanceInYears, "over 1 year", `over ${distanceInYears} years`),
    );
  }
  return lookupOrFallback(
    "almost_x_years",
    { ...tOpts, count: distanceInYears + 1 },
    englishPlural(distanceInYears + 1, "almost 1 year", `almost ${distanceInYears + 1} years`),
  );
}

export function truncate(text: string, length: number = 30, omission: string = "..."): string {
  const characters = Array.from(text);
  if (characters.length <= length) return text;
  const room = length - Array.from(omission).length;
  return room < 0 ? omission : characters.slice(0, room).join("") + omission;
}

export function truncateHtmlSafeText(text: string, length: number = 30, omission: string = "..."): string {
  const result = truncate(text, length, omission);
  return Array.from(text).length <= length ? result : result.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function normalizeTime(value: Date | number | string): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    return new Date(value * 1000);
  }
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
    if (m !== null) {
      return new Date(
        Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!),
      );
    }
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`distance_of_time_in_words: cannot parse ${JSON.stringify(value)}`);
  }
  return d;
}

function lookupOrFallback(key: string, opts: TOpts, fallback: string): string {
  if (tExists(key, opts)) {
    const result = t(key, opts);
    if (typeof result === "string") return result;
  }
  return fallback;
}

function englishPlural(count: number, one: string, other: string): string {
  return count === 1 ? one : other;
}
