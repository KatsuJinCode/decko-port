import { parseYaml, type YamlValue } from "./yaml.js";

export interface TOpts {
  scope?: string;
  default?: string | string[];
  count?: number;
  locale?: string;
  vars?: Record<string, string | number>;
}

const translations = new Map<string, { [k: string]: YamlValue }>();

let defaultLocale: string | undefined;

export async function loadLocaleFile(locale: string, path: string): Promise<void> {
  return loadLocaleFileAsync(locale, path);
}

export function loadLocaleFromString(locale: string, yaml: string): void {
  const parsed = parseYaml(yaml);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`i18n: top-level YAML must be a map, got ${typeof parsed}`);
  }
  const subtree = (parsed as { [k: string]: YamlValue })[locale];
  if (subtree === undefined) {
    throw new Error(`i18n: top-level key "${locale}" not found in YAML`);
  }
  if (typeof subtree !== "object" || subtree === null || Array.isArray(subtree)) {
    throw new Error(`i18n: top-level "${locale}" must be a map, got ${typeof subtree}`);
  }
  const existing = translations.get(locale) ?? {};
  translations.set(locale, deepMerge(existing, subtree as { [k: string]: YamlValue }));
}

export function resetI18n(): void {
  translations.clear();
  defaultLocale = undefined;
}

export function setDefaultLocale(locale: string): void {
  defaultLocale = locale;
}

export function t(key: string, opts: TOpts = {}): string | YamlValue {
  const locale = opts.locale ?? defaultLocale ?? "en";
  const fullKey = opts.scope !== undefined && opts.scope !== ""
    ? `${opts.scope}.${key}`
    : key;

  let entry = lookup(translations.get(locale), fullKey);
  let resolvedKey = fullKey;

  if (entry === undefined && opts.default !== undefined) {
    if (typeof opts.default === "string") {
      if (opts.default.length > 0) {
        return interpolate(opts.default, opts.vars ?? {});
      }
    } else {
      for (const alt of opts.default) {
        entry = lookup(translations.get(locale), alt);
        if (entry !== undefined) {
          resolvedKey = alt;
          break;
        }
      }
    }
  }

  if (entry === undefined) {
    return missingTranslationMessage(locale, key, opts.scope);
  }

  if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
    if (opts.count !== undefined) {
      const form = pluralizationKey(entry as { [k: string]: YamlValue }, opts.count);
      const formEntry = (entry as { [k: string]: YamlValue })[form];
      if (typeof formEntry === "string") {
        return interpolate(formEntry, { ...(opts.vars ?? {}), count: opts.count });
      }
    }
    return entry;
  }

  if (typeof entry !== "string") {
    return missingTranslationMessage(locale, key, opts.scope);
  }

  return interpolate(entry, opts.vars ?? {});
}

export function tExists(key: string, opts: { scope?: string; locale?: string } = {}): boolean {
  const locale = opts.locale ?? defaultLocale ?? "en";
  const fullKey = opts.scope !== undefined && opts.scope !== ""
    ? `${opts.scope}.${key}`
    : key;
  return lookup(translations.get(locale), fullKey) !== undefined;
}

export function l(date: Date, opts: { format: string; locale?: string }): string {
  const locale = opts.locale ?? defaultLocale ?? "en";
  const data = translations.get(locale) ?? {};
  let fmt = lookupString(data, `time.formats.${opts.format}`);
  if (fmt === undefined) {
    fmt = lookupString(data, `date.formats.${opts.format}`);
  }
  if (fmt === undefined) {
    return missingTranslationMessage(locale, `time.formats.${opts.format}`);
  }
  return formatStrftime(date, fmt);
}

export function missingTranslationMessage(locale: string, key: string, scope?: string): string {
  const parts = [locale];
  if (scope !== undefined && scope !== "") parts.push(...scope.split("."));
  parts.push(...key.split("."));
  return `Translation missing: ${parts.join(".")}`;
}

function lookup(data: { [k: string]: YamlValue } | undefined, key: string): YamlValue | undefined {
  if (data === undefined) return undefined;
  const parts = key.split(".").filter((p) => p.length > 0);
  let cur: YamlValue | undefined = data;
  for (const part of parts) {
    if (typeof cur !== "object" || cur === null || Array.isArray(cur)) return undefined;
    cur = (cur as { [k: string]: YamlValue })[part];
    if (cur === undefined) return undefined;
  }
  return cur;
}

function lookupString(data: { [k: string]: YamlValue }, key: string): string | undefined {
  const v = lookup(data, key);
  return typeof v === "string" ? v : undefined;
}

function pluralizationKey(entry: { [k: string]: YamlValue }, count: number): string {
  const hasZero = "zero" in entry;
  if (count === 0 && hasZero) return "zero";
  return count === 1 ? "one" : "other";
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  if (Object.keys(vars).length === 0) {
    return template.replace(/%%/g, "%");
  }
  return template.replace(/%(%|\{([^}]+)\})/g, (_match, body: string, name: string | undefined) => {
    if (body === "%") return "%";
    if (name === undefined) return body;
    const v = vars[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}

function formatStrftime(date: Date, fmt: string): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const abbrDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const abbrMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad2 = (n: number): string => (n < 10 ? "0" + n : "" + n);
  const spacePad2 = (n: number): string => (n < 10 ? " " + n : "" + n);

  let out = "";
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i]!;
    if (c !== "%") {
      out += c;
      i++;
      continue;
    }
    i++;
    if (i >= fmt.length) break;
    const flag = fmt[i]!;
    if (flag === "-") {
      i++;
      const directive = fmt[i]!;
      i++;
      switch (directive) {
        case "d": out += String(date.getDate()); break;
        default: out += "%-" + directive; break;
      }
      continue;
    }
    switch (flag) {
      case "A": out += days[date.getDay()] ?? ""; break;
      case "a": out += abbrDays[date.getDay()] ?? ""; break;
      case "B": out += months[date.getMonth()] ?? ""; break;
      case "b": out += abbrMonths[date.getMonth()] ?? ""; break;
      case "d": out += pad2(date.getDate()); break;
      case "e": out += spacePad2(date.getDate()); break;
      case "H": out += pad2(date.getHours()); break;
      case "I": out += pad2(((date.getHours() + 11) % 12) + 1); break;
      case "M": out += pad2(date.getMinutes()); break;
      case "m": out += pad2(date.getMonth() + 1); break;
      case "p": out += date.getHours() < 12 ? "AM" : "PM"; break;
      case "S": out += pad2(date.getSeconds()); break;
      case "Y": out += String(date.getFullYear()); break;
      case "y": out += String(date.getFullYear()).slice(-2); break;
      case "Z":
        try {
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZoneName: "short",
          }).formatToParts(date);
          const tz = parts.find((p) => p.type === "timeZoneName");
          out += tz?.value ?? "";
        } catch {
          out += "";
        }
        break;
      case "z":
        out += " ";
        break;
      case "%": out += "%"; break;
      default: out += "%" + flag; break;
    }
    i++;
  }
  return out;
}

function deepMerge(
  a: { [k: string]: YamlValue },
  b: { [k: string]: YamlValue },
): { [k: string]: YamlValue } {
  const out: { [k: string]: YamlValue } = { ...a };
  for (const k of Object.keys(b)) {
    const av = a[k];
    const bv = b[k];
    if (
      typeof av === "object" && av !== null && !Array.isArray(av) &&
      typeof bv === "object" && bv !== null && !Array.isArray(bv)
    ) {
      out[k] = deepMerge(av as { [k: string]: YamlValue }, bv as { [k: string]: YamlValue });
    } else {
      out[k] = bv;
    }
  }
  return out;
}

export async function loadLocaleFileAsync(locale: string, path: string): Promise<void> {
  const fsModule = await import("node:fs");
  const text = fsModule.readFileSync(path, "utf8");
  loadLocaleFromString(locale, text);
}
