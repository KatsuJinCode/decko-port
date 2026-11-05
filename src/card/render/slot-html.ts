import { randomBytes } from "node:crypto";

const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
  "&": "&amp;",
  ">": "&gt;",
  "<": "&lt;",
  '"': "&quot;",
  "'": "&#39;",
};
const HTML_ESCAPE_CHARS = /[&<>"']/g;

export function h(s: string): string {
  return s.replace(HTML_ESCAPE_CHARS, (ch) => HTML_ESCAPE_MAP[ch]!);
}

const UTF8_ENCODER = new TextEncoder();

export function cgiEscape(s: string): string {
  let out = "";
  for (const ch of s) {
    if (/[A-Za-z0-9_.~-]/.test(ch)) out += ch;
    else if (ch === " ") out += "+";
    else {
      for (const byte of UTF8_ENCODER.encode(ch)) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    }
  }
  return out;
}

export function htmlEscapeExceptQuotes(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&apos;")
    .replace(/>/g, "&gt;")
    .replace(/</g, "&lt;");
}

export function htmlEscapeKeepApostrophe(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/>/g, "&gt;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

export function newSlotId(): string {
  return randomBytes(10).toString("hex");
}

function attrValue(value: string): string {
  return h(value);
}

export function emitAttrs(attrs: Record<string, string | number | undefined>): string {
  let out = "";
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    out += ` ${key}="${attrValue(String(value))}"`;
  }
  return out;
}

export function emitHamlAttrs(attrs: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const key of Object.keys(attrs).sort()) {
    const value = attrs[key];
    if (value === undefined) continue;
    parts.push(`${key}='${h(String(value))}'`);
  }
  return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}

const SLOT_KEYS: readonly string[] = [
  "view", "nest_name", "nest_syntax", "wrap", "show", "hide", "unknown",
  "main", "home_view", "buttons_view", "edit_structure", "cql", "action_id", "content_opts",
  "help", "structure", "title", "variant", "joint", "input_type", "type", "size",
  "header", "items", "cache", "edit", "separator", "filter",
  "params",
  "main_view", "layout",
  "name_context",
];

export function slotOptionsJson(slotOptions: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {};
  for (const key of SLOT_KEYS) {
    if (key in slotOptions && slotOptions[key] !== undefined) ordered[key] = slotOptions[key];
  }
  return htmlEscapeExceptQuotes(JSON.stringify(ordered));
}

export function slotOptionsWithNameContext(
  fmt: {
    initialContextNames: readonly string[];
    slotNameContextKeys?: () => readonly string[];
  },
  voo: { slotOptions: () => Record<string, unknown> },
): string {
  const slotOptions = voo.slotOptions();
  const initial = fmt.slotNameContextKeys !== undefined
    ? fmt.slotNameContextKeys()
    : fmt.initialContextNames;
  if (initial.length > 0) slotOptions["name_context"] = initial.join(",");
  return slotOptionsJson(slotOptions);
}
