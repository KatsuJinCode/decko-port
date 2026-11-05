// Surface 2 — minimal I18n port.
// Validates the YAML loader + lookup + interpolation + missing-key
// behavior + pluralization + Date localize the render layer needs to
// close the locale-token divergences in card-mod-format.ts.

import { beforeEach, describe, expect, it } from "vitest";
import {
  t,
  tExists,
  l,
  loadLocaleFromString,
  resetI18n,
  setDefaultLocale,
  missingTranslationMessage,
} from "../../../src/card/i18n/i18n.js";
import { parseYaml } from "../../../src/card/i18n/yaml.js";

const CARD_EN_YML = `en:
  time:
    formats:
      card_dayofwk_min_tz: '%A, %B %d, %Y %I:%M %p %Z'
      card_date_seconds: '%B %e, %Y %H:%M:%S'
      card_date_only: '%B %e, %Y'
  lib_error_rendering: "Error rendering: %{cardname} (%{view} view)"
  lib_exception_for_card: "for card %{cardname}: %{message}"
  lib_exception_init_without_card: format initialized without card
  lib_exception_not_implemented: "%{func} not implemented"
  lib_exception_unknown_codename: "unknown codename: %{codename}"
  lib_no_cardname: unknown card
`;

const CARD_MOD_FORMAT_EN_YML = `en:
  format_add_card: Add %{cardname}
  format_bad_address: "404: Bad Address"
  format_close: Close
  format_configure_card: Configure %{cardname}
  format_confirm_edit_loss: Unsaved changes will be lost. Do you want to proceed?
  format_denial: Permission Denied
  format_denied_task: to %{denied_task} this
  format_invalid_json: invalid json
  format_need_permission_task: "You need permission %{task}."
  format_not_found_named: Could not find %{cardname}.
  format_not_found_no_name: the card requested
  format_not_numeric: "'%{content}' is not numeric"
  format_or: "or"
  format_please: Please
  format_problems_name: Problems with %{cardname}
  format_read_only: We are currently in read-only mode.  Please try again later.
  format_server_error: "\\nServer Error. Yuck, sorry about that.\\nTo tell us more and follow the fix,\\nadd a support ticket at %{ticket_link}\\n"
  format_sorry: Sorry!
  format_to_do_that: to do that
  format_toggle_no: "no"
  format_toggle_yes: "yes"
  format_too_deep: Man, you're too deep.  (Too many levels of nests at a time)
  format_unsupported_view: view (%{view}) not supported for %{cardname}
  format_mod_description: Format mod
`;

const ACTIONVIEW_EN_YML = `"en":
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
  loadLocaleFromString("en", CARD_EN_YML);
  loadLocaleFromString("en", CARD_MOD_FORMAT_EN_YML);
  loadLocaleFromString("en", ACTIONVIEW_EN_YML);
  setDefaultLocale("en");
});

describe("parseYaml - the YAML loader", () => {
  it("parses a flat key/value shape with double-quoted leaves", () => {
    const yaml = `en:\n  hello: "world"\n`;
    const parsed = parseYaml(yaml);
    expect(parsed).toEqual({ en: { hello: "world" } });
  });

  it("parses nested maps via 2-space indentation", () => {
    const yaml = `en:\n  a:\n    b: "c"\n`;
    const parsed = parseYaml(yaml) as { en: { a: { b: string } } };
    expect(parsed.en.a.b).toBe("c");
  });

  it("parses bare (unquoted) leaves", () => {
    const yaml = `en:\n  bare: hello world\n`;
    const parsed = parseYaml(yaml) as { en: { bare: string } };
    expect(parsed.en.bare).toBe("hello world");
  });

  it("parses single-quoted leaves with the '' escape for one apostrophe", () => {
    const yaml = `en:\n  q: 'it''s'\n`;
    const parsed = parseYaml(yaml) as { en: { q: string } };
    expect(parsed.en.q).toBe("it's");
  });

  it("parses double-quoted leaves with backslash escapes (\\n -> newline)", () => {
    const yaml = `en:\n  e: "line1\\nline2"\n`;
    const parsed = parseYaml(yaml) as { en: { e: string } };
    expect(parsed.en.e).toBe("line1\nline2");
  });

  it("parses a quoted locale key (\"en\":)", () => {
    const yaml = `"en":\n  a: b\n`;
    const parsed = parseYaml(yaml) as { en: { a: string } };
    expect(parsed.en.a).toBe("b");
  });

  it("skips comment lines starting with #", () => {
    const yaml = `en:\n  # comment\n  a: b\n`;
    const parsed = parseYaml(yaml) as { en: { a: string } };
    expect(parsed.en.a).toBe("b");
  });

  it("parses plural entries with one/other sub-keys", () => {
    const yaml = `en:\n  d:\n    one: "1 thing"\n    other: "%{count} things"\n`;
    const parsed = parseYaml(yaml) as { en: { d: { one: string; other: string } } };
    expect(parsed.en.d.one).toBe("1 thing");
    expect(parsed.en.d.other).toBe("%{count} things");
  });

  it("parses the actual card en.yml structure byte-faithfully", () => {
    const parsed = parseYaml(CARD_EN_YML) as {
      en: { time: { formats: { card_dayofwk_min_tz: string } }; lib_no_cardname: string };
    };
    expect(parsed.en.time.formats.card_dayofwk_min_tz).toBe("%A, %B %d, %Y %I:%M %p %Z");
    expect(parsed.en.lib_no_cardname).toBe("unknown card");
  });

  it("parses the actual actionview en.yml with quoted locale key + plurals", () => {
    const parsed = parseYaml(ACTIONVIEW_EN_YML) as {
      en: { datetime: { distance_in_words: { x_minutes: { one: string; other: string } } } };
    };
    expect(parsed.en.datetime.distance_in_words.x_minutes.one).toBe("1 minute");
    expect(parsed.en.datetime.distance_in_words.x_minutes.other).toBe("%{count} minutes");
  });
});

describe("t - translation lookup", () => {
  it("resolves a flat key to its byte-exact leaf", () => {
    expect(t("format_close")).toBe("Close");
    expect(t("format_denial")).toBe("Permission Denied");
  });

  it("resolves a nested key with scope", () => {
    const subtree = t("distance_in_words", { scope: "datetime" }) as unknown as {
      half_a_minute: string;
      x_minutes: { one: string; other: string };
    };
    expect(subtree.half_a_minute).toBe("half a minute");
    expect(subtree.x_minutes.one).toBe("1 minute");
    expect(subtree.x_minutes.other).toBe("%{count} minutes");
  });

  it("resolves a dot-separated key path", () => {
    expect(t("datetime.distance_in_words.x_minutes.one")).toBe("1 minute");
    expect(t("datetime.distance_in_words.x_minutes.other")).toBe("%{count} minutes");
  });

  it("interpolates %{name} placeholders with values from vars", () => {
    expect(t("lib_error_rendering", { vars: { cardname: "Home", view: "open" } }))
      .toBe("Error rendering: Home (open view)");
  });

  it("interpolates multi-var strings in byte order", () => {
    expect(t("format_add_card", { vars: { cardname: "New" } })).toBe("Add New");
    expect(t("format_unsupported_view", { vars: { view: "core", cardname: "Home" } }))
      .toBe("view (core) not supported for Home");
  });

  it("leaves literal %% as a single %", () => {
    // None of the captured en.yml files use %%, but the Ruby interpolation
    // supports it (i18n/interpolate/ruby.rb). Verify the port does too.
    loadLocaleFromString("en", "en:\n  pct: \"100%% done\"\n");
    expect(t("pct")).toBe("100% done");
  });
});

describe("t - missing-key behavior (byte-exact per I18n::MissingTranslation#message)", () => {
  it("returns the 'Translation missing: en.<key>' string for an unknown key", () => {
    expect(t("not_a_real_key")).toBe("Translation missing: en.not_a_real_key");
  });

  it("returns the same shape with a dotted key path", () => {
    expect(t("foo.bar.baz")).toBe("Translation missing: en.foo.bar.baz");
  });

  it("includes the scope in the missing-key string", () => {
    expect(t("missing", { scope: "datetime.distance_in_words" }))
      .toBe("Translation missing: en.datetime.distance_in_words.missing");
  });

  it("returns the string default when the key is missing", () => {
    expect(t("not_a_real_key", { default: "fallback text" })).toBe("fallback text");
  });

  it("tries array defaults in order and returns the first hit", () => {
    expect(t("not_a_real_key", { default: ["also_missing", "format_close"] })).toBe("Close");
  });

  it("falls through to the missing-key message when no array default hits", () => {
    expect(t("not_a_real_key", { default: ["x", "y"] }))
      .toBe("Translation missing: en.not_a_real_key");
  });

  it("the missingTranslationMessage function matches Ruby's exception shape", () => {
    expect(missingTranslationMessage("en", "format.bad_address"))
      .toBe("Translation missing: en.format.bad_address");
    expect(missingTranslationMessage("en", "missing", "datetime.distance_in_words"))
      .toBe("Translation missing: en.datetime.distance_in_words.missing");
  });
});

describe("tExists - existence check", () => {
  it("returns true for known keys", () => {
    expect(tExists("format_close")).toBe(true);
    expect(tExists("datetime.distance_in_words.x_minutes.one")).toBe(true);
  });

  it("returns false for unknown keys", () => {
    expect(tExists("not_a_real_key")).toBe(false);
  });
});

describe("l - Date localize (strftime via i18n format strings)", () => {
  it("renders card_dayofwk_min_tz: full day, full month, day, year, hour:min am/pm, tz", () => {
    // 2026-09-22T10:30:00 local. The exact tz varies by environment; we
    // assert the shape, not the timezone string.
    const out = l(new Date(2026, 8, 22, 10, 30, 0), { format: "card_dayofwk_min_tz" });
    expect(out).toMatch(/^Tuesday, September 22, 2026 10:30 AM /);
  });

  it("renders card_date_only: full month, space-padded day, year", () => {
    expect(l(new Date(2026, 0, 5, 0, 0, 0), { format: "card_date_only" })).toBe("January  5, 2026");
  });

  it("renders card_date_seconds: full month, space-padded day, year, HH:MM:SS", () => {
    expect(l(new Date(2026, 0, 5, 9, 5, 7), { format: "card_date_seconds" }))
      .toBe("January  5, 2026 09:05:07");
  });

  it("returns the missing-key message for an unknown format", () => {
    expect(l(new Date(), { format: "not_a_real_format" }))
      .toBe("Translation missing: en.time.formats.not_a_real_format");
  });
});

describe("loadLocaleFromString - merge semantics", () => {
  it("deep-merges two loads for the same locale (last value wins on leaf collisions)", () => {
    resetI18n();
    loadLocaleFromString("en", "en:\n  format_close: First\n");
    loadLocaleFromString("en", "en:\n  format_close: Second\n");
    expect(t("format_close")).toBe("Second");
  });

  it("keeps non-colliding keys from both loads", () => {
    resetI18n();
    loadLocaleFromString("en", "en:\n  format_close: Close\n");
    loadLocaleFromString("en", "en:\n  format_denial: Denial\n");
    expect(t("format_close")).toBe("Close");
    expect(t("format_denial")).toBe("Denial");
  });

  it("deep-merges nested maps", () => {
    resetI18n();
    loadLocaleFromString("en", "en:\n  datetime:\n    distance_in_words:\n      x_minutes:\n        one: 1m\n");
    loadLocaleFromString("en", "en:\n  datetime:\n    distance_in_words:\n      x_minutes:\n        other: %cm\n");
    expect(t("datetime.distance_in_words.x_minutes.one")).toBe("1m");
    expect(t("datetime.distance_in_words.x_minutes.other")).toBe("%cm");
  });
});
