// Surface 3 — Rails text helpers.
// Validates time_ago_in_words / distance_of_time_in_words / truncate
// against the byte-exact thresholds in
// actionview-7.2.3.2/lib/action_view/helpers/date_helper.rb and the
// ONE_LINE_CHARACTER_LIMIT in card-mod-format-0.20.0/set/all/content.rb:1.

import { beforeEach, describe, expect, it } from "vitest";
import {
  distanceOfTimeInWords,
  timeAgoInWords,
  truncate,
  ONE_LINE_CHARACTER_LIMIT,
} from "../../../src/card/render/text-helpers.js";
import { loadLocaleFromString, resetI18n, setDefaultLocale } from "../../../src/card/i18n/i18n.js";

/** Byte-for-byte copy of actionview en.yml's datetime.distance_in_words
 *  block (the date_helper tests need the plural keys loaded). */
const ACTIONVIEW_DIST_YML = `en:
  datetime:
    distance_in_words:
      half_a_minute: "half a minute"
      less_than_x_seconds:
        one:   "less than 1 second"
        other: "less than %{count} seconds"
      x_seconds:
        one:   "1 second"
        other: "%{count} seconds"
      less_than_x_minutes:
        one:   "less than a minute"
        other: "less than %{count} minutes"
      x_minutes:
        one:   "1 minute"
        other: "%{count} minutes"
      about_x_hours:
        one:   "about 1 hour"
        other: "about %{count} hours"
      x_days:
        one:   "1 day"
        other: "%{count} days"
      about_x_months:
        one:   "about 1 month"
        other: "about %{count} months"
      x_months:
        one:   "1 month"
        other: "%{count} months"
      about_x_years:
        one:   "about 1 year"
        other: "about %{count} years"
      over_x_years:
        one:   "over 1 year"
        other: "over %{count} years"
      almost_x_years:
        one:   "almost 1 year"
        other: "almost %{count} years"
`;

beforeEach(() => {
  resetI18n();
  loadLocaleFromString("en", ACTIONVIEW_DIST_YML);
  setDefaultLocale("en");
});

describe("ONE_LINE_CHARACTER_LIMIT", () => {
  it("equals 60 (card-mod-format-0.20.0/set/all/content.rb:1)", () => {
    expect(ONE_LINE_CHARACTER_LIMIT).toBe(60);
  });
});

describe("truncate - String#truncate (active_support/core_ext/string/filters.rb:70-83)", () => {
  it("returns the input unchanged when shorter than length", () => {
    expect(truncate("short", 30)).toBe("short");
  });

  it("returns the input unchanged when equal to length", () => {
    expect(truncate("012345678901234567890123456789", 30)).toBe("012345678901234567890123456789");
  });

  it("truncates to length and appends '...' when longer", () => {
    // active_support example: 'Once upon a time in a world far far away'
    // truncated to 27 = "Once upon a time in a wo..." (the omission takes
    // 3 chars; the head is 24 chars).
    const text = "Once upon a time in a world far far away";
    expect(truncate(text, 27)).toBe("Once upon a time in a wo...");
  });

  it("defaults to length 30 and omission '...' (Rails default)", () => {
    expect(truncate("Once upon a time in a world far far away"))
      .toBe("Once upon a time in a world...");
  });

  it("respects a custom omission", () => {
    // Active Support edge case: when length - omission.length < 0, Ruby's
    // String#[0, stop] with a negative stop returns "" (Ruby doesn't
    // produce a negative-length slice). The omission IS the entire output.
    // (filters.rb:82 + Ruby String#[0, stop] semantics - tested via
    // `ruby -e 'puts "x"[0, -1].inspect'` -> "").
    expect(truncate("Once upon a time", 12, "... (continued)")).toBe(
      "... (continued)",
    );
  });

  it("returns just the omission when the omission is longer than length (Rails edge case)", () => {
    // active_support example: truncate(4, omission: '... (continued)')
    // -> "... (continued)" - stop = 4 - 13 = -9, self[0, -9] = "" in Ruby,
    // so the output is the omission alone (filters.rb:64-69).
    expect(truncate("And they found...", 4, "... (continued)")).toBe(
      "... (continued)",
    );
  });

  it("ONE_LINE_CHARACTER_LIMIT (60) truncation - the card-mod-format one_line_content shape", () => {
    // 80-char input: 60-char head + '...' (the captured oracle's
    // one_line_content length contract).
    const input = "a".repeat(80);
    expect(truncate(input, ONE_LINE_CHARACTER_LIMIT))
      .toBe("a".repeat(ONE_LINE_CHARACTER_LIMIT - 3) + "...");
  });

  it("input <= 60 returns unchanged (the one_line_content no-truncation path)", () => {
    expect(truncate("a".repeat(60), ONE_LINE_CHARACTER_LIMIT)).toBe("a".repeat(60));
    expect(truncate("a".repeat(30), ONE_LINE_CHARACTER_LIMIT)).toBe("a".repeat(30));
  });
});

describe("distanceOfTimeInWords - date_helper.rb:95-165", () => {
  // Reference times - one anchor, varying differences.
  const now = new Date("2026-09-22T12:00:00Z");
  const at = (secs: number): Date => new Date(now.getTime() + secs * 1000);

  it("< 29 seconds -> 'less than a minute' (default, no include_seconds)", () => {
    expect(distanceOfTimeInWords(at(-10), now)).toBe("less than a minute");
  });

  it("30 seconds - 1 min 29 secs without include_seconds: 'less than a minute'", () => {
    // distance_in_minutes rounds 60s to 1; x_minutes(1) -> "1 minute".
    expect(distanceOfTimeInWords(at(-60), now)).toBe("1 minute");
  });

  it("0..4 seconds with include_seconds: 'less than 5 seconds'", () => {
    expect(distanceOfTimeInWords(at(-2), now, { includeSeconds: true })).toBe("less than 5 seconds");
  });

  it("5..9 seconds with include_seconds: 'less than 10 seconds'", () => {
    expect(distanceOfTimeInWords(at(-7), now, { includeSeconds: true })).toBe("less than 10 seconds");
  });

  it("10..19 seconds with include_seconds: 'less than 20 seconds'", () => {
    expect(distanceOfTimeInWords(at(-15), now, { includeSeconds: true })).toBe("less than 20 seconds");
  });

  it("20..39 seconds with include_seconds: 'half a minute'", () => {
    expect(distanceOfTimeInWords(at(-30), now, { includeSeconds: true })).toBe("half a minute");
  });

  it("40..59 seconds with include_seconds: 'less than a minute'", () => {
    expect(distanceOfTimeInWords(at(-50), now, { includeSeconds: true })).toBe("less than a minute");
  });

  it("60..89 seconds with include_seconds: '1 minute'", () => {
    expect(distanceOfTimeInWords(at(-75), now, { includeSeconds: true })).toBe("1 minute");
  });

  it("2..44 minutes -> 'N minutes'", () => {
    expect(distanceOfTimeInWords(at(-10 * 60), now)).toBe("10 minutes");
    expect(distanceOfTimeInWords(at(-44 * 60), now)).toBe("44 minutes");
  });

  it("45..89 minutes -> 'about 1 hour'", () => {
    expect(distanceOfTimeInWords(at(-60 * 60), now)).toBe("about 1 hour");
  });

  it("90 mins - 23 hours -> 'about N hours'", () => {
    expect(distanceOfTimeInWords(at(-5 * 60 * 60), now)).toBe("about 5 hours");
    expect(distanceOfTimeInWords(at(-23 * 60 * 60), now)).toBe("about 23 hours");
  });

  it("24 hours - 41 hours -> '1 day'", () => {
    expect(distanceOfTimeInWords(at(-25 * 60 * 60), now)).toBe("1 day");
  });

  it("42 hours - 29 days -> 'N days'", () => {
    expect(distanceOfTimeInWords(at(-3 * 24 * 60 * 60), now)).toBe("3 days");
    expect(distanceOfTimeInWords(at(-10 * 24 * 60 * 60), now)).toBe("10 days");
  });

  it("30..60 days -> 'about N months'", () => {
    expect(distanceOfTimeInWords(at(-45 * 24 * 60 * 60), now)).toBe("about 2 months");
  });

  it("60 days - 1 year -> 'N months'", () => {
    expect(distanceOfTimeInWords(at(-180 * 24 * 60 * 60), now)).toBe("6 months");
  });

  it("1+ years -> 'about N years' / 'over N years' / 'almost N years'", () => {
    const oneYear = 365 * 24 * 60 * 60;
    // ~1 year (just under the 525600 threshold) -> 'about 1 year'
    expect(distanceOfTimeInWords(at(-oneYear), now)).toBe("about 1 year");
    // 2 years -> 'about 2 years' (the remainder after leap-year offset
    // falls in the < 1/4 year range).
    expect(distanceOfTimeInWords(at(-2 * oneYear), now)).toBe("about 2 years");
    // 3 years * 365 days = 1095 days which is just under 3 calendar years
    // (the leap-year subtraction pushes the remainder past 3/4 year, so
    // Ruby returns 'almost 3 years' - date_helper.rb:158-161).
    expect(distanceOfTimeInWords(at(-3 * oneYear), now)).toBe("almost 3 years");
  });

  it("swaps from/to when from > to (symmetric, date_helper.rb:102)", () => {
    // from is later than to - the function should produce the same string
    // as the inverse call.
    const past = at(-3 * 60 * 60); // 3 hours ago
    const future = now;
    expect(distanceOfTimeInWords(future, past)).toBe(distanceOfTimeInWords(past, future));
  });

  it("accepts Unix epoch seconds as numbers", () => {
    const fromEpoch = Math.floor((now.getTime() - 60 * 60 * 1000) / 1000); // 1 hour ago
    expect(distanceOfTimeInWords(fromEpoch, now)).toBe("about 1 hour");
  });

  it("accepts ISO date strings", () => {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    expect(distanceOfTimeInWords(oneHourAgo, now)).toBe("about 1 hour");
  });
});

describe("timeAgoInWords - date_helper.rb:183-185", () => {
  const now = new Date("2026-09-22T12:00:00Z");

  it("renders 'less than a minute' for a recent timestamp", () => {
    expect(timeAgoInWords(new Date(now.getTime() - 1000), now)).toBe("less than a minute");
  });

  it("renders '5 minutes' for 5 minutes ago", () => {
    expect(timeAgoInWords(new Date(now.getTime() - 5 * 60 * 1000), now)).toBe("5 minutes");
  });

  it("renders 'about 3 hours' for 3 hours ago", () => {
    expect(timeAgoInWords(new Date(now.getTime() - 3 * 60 * 60 * 1000), now)).toBe("about 3 hours");
  });

  it("renders '3 days' for 3 days ago", () => {
    expect(timeAgoInWords(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), now)).toBe("3 days");
  });

  it("falls back to literal English strings when no locale is loaded", () => {
    resetI18n();
    expect(timeAgoInWords(new Date(now.getTime() - 3 * 60 * 1000), now)).toBe("3 minutes");
    expect(timeAgoInWords(new Date(now.getTime() - 60 * 60 * 1000), now)).toBe("about 1 hour");
    expect(timeAgoInWords(new Date(now.getTime() - 24 * 60 * 60 * 1000), now)).toBe("1 day");
  });
});
