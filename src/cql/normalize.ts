import { DeckoName } from "../card/name.js";
import { getNameEnvironment } from "../card/name/environment.js";
import { CqlBadQuery } from "./ast.js";
import { SAFE_SQL_RE } from "./constants.js";

const NON_WORD_RE = /[^A-Za-z0-9_]/g;

export function parseMatchTermAndPrefix(raw: string): { prefix: string; term: string } {
  const match = /^([=~]*)\s*([\s\S]*)$/.exec(raw);
  if (!match) return { prefix: "", term: raw };
  return { prefix: match[1] ?? "", term: match[2] ?? "" };
}

export function escapeRegexpCharacters(term: string): string {
  return term.replace(NON_WORD_RE, "\\$&");
}

export function translateServerRegexp(pattern: string): string {
  return pattern.replace(/\[\[:<:\]\]/g, "\\b").replace(/\[\[:>:\]\]/g, "\\b");
}

export const NEEDS_ABSOLUTIZE_RE = /\b_/;

const CONTEXTUAL_FORM_RE = /\b_(?:left|right|whole|self|user|main|\d+|L*R?)\b/i;

const CONTEXTUAL_PART_RE = /^_(left|right|whole|self|user|main|\d+|L*R?)$/i;

function rubyBlank(value: string): boolean {
  return /^\s*$/.test(value);
}

export function absolutizeName(
  name: string,
  context: string,
  onWarning?: (message: string) => void,
): string {
  const parsed = DeckoName.parse(name);
  if (CONTEXTUAL_FORM_RE.test(name)) {
    warnUnresolvedContextualParts(parsed, context, onWarning);
  }
  return parsed.absolute(context);
}

function warnUnresolvedContextualParts(
  parsed: DeckoName,
  context: string,
  onWarning?: (message: string) => void,
): void {
  const environment = getNameEnvironment();
  for (const part of parsed.parts) {
    if (!CONTEXTUAL_PART_RE.test(part)) continue;
    if (/^_user$/i.test(part)) {
      if (environment?.session === undefined) {
        onWarning?.(
          "CQL '_user' left in place: no session name in the name environment " +
            "(Ruby: Card::Name.session, card-1.110.0 lib/card/name.rb#session)",
        );
      }
    } else if (/^_main$/i.test(part)) {
      if (environment?.mainName === undefined) {
        onWarning?.(
          "CQL '_main' has no main name in the name environment (Ruby: " +
            "Card::Env.params[:main_name], cardname lib/cardname/contextual.rb#absolutize_contextual_parts); " +
            "it resolves to '' and a blank extreme part falls back to the context",
        );
      }
    } else if (rubyBlank(context)) {
      onWarning?.(
        `CQL part '${part}' absolutized against an empty context (no 'context' ` +
          "in the statement or ParseOptions.context; Ruby AbstractQuery#context defaults to '')",
      );
    }
  }
}

export function defaultNameToKey(name: string): string {
  return DeckoName.parse(name).key;
}

export function safeSql(text: string): string {
  const txt = String(text);
  if (SAFE_SQL_RE.test(txt)) {
    throw new CqlBadQuery(`CQL contains disallowed characters: ${txt}`);
  }
  return txt;
}

export function assertSimpleValue(value: unknown): string | number | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (value === null) return null;
  throw new CqlBadQuery(`Invalid property value: ${JSON.stringify(value)}`);
}
