import { DeckoName } from "../name.js";

const NEST_AT_REGEXP = /\{\{([^{}]*)\}\}/y;
const ESCAPED_LITERAL_AT_REGEXP = /\\(?:\[\[[^\]]*\]\]|\{\{[^}]*\}\})/y;
const CANDIDATE_AT_REGEXP = /[\\{]/g;

export function interpretEscapedLiteral(
  chunkText: string,
  escapeLiteral: (literal: string) => string,
): string {
  const escaped = /^\\(.)/.exec(chunkText);
  if (escaped === null) return chunkText;
  return escapeLiteral(escaped[1]!) + chunkText.slice(escaped[0].length);
}

export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

const SHARK_KEYS: ReadonlySet<string> = new Set([
  "view", "nest_name", "nest_syntax", "wrap", "show", "hide", "unknown",
  "help", "structure", "title", "variant", "joint", "input_type", "type",
  "size", "header", "items", "cache", "edit", "separator", "filter", "params",
]);

const DEFAULT_OPTION = "view";

export interface ParsedNest {
  syntax: string;
  name: string;
  options: NestOptions;
  comment: string | undefined;
  chunkNestSyntax?: string;
}

export interface NestOptions {
  view?: string;
  title?: string;
  show?: string;
  hide?: string;
  size?: string;
  items?: Record<string, string>;
  extra: Record<string, string>;
}

export function parseNestOptions(optLists: string | undefined): NestOptions {
  const raw = (optLists ?? "").split("|").reverse();
  let prev: { items?: unknown } | undefined;
  for (const level of raw) {
    prev = interpretPipedOptions(level, prev);
  }
  const flat = (prev ?? {}) as Record<string, unknown>;
  const options: NestOptions = { extra: {} };
  for (const [key, value] of Object.entries(flat)) {
    if (value === undefined) continue;
    switch (key) {
      case "view": options.view = String(value); break;
      case "title": options.title = String(value); break;
      case "show": options.show = String(value); break;
      case "hide": options.hide = String(value); break;
      case "size": options.size = String(value); break;
      case "items":
        options.items = value as Record<string, string>;
        break;
      default: options.extra[key] = String(value);
    }
  }
  return options;
}

function interpretPipedOptions(
  listString: string,
  items: unknown,
): Record<string, unknown> {
  const hash: Record<string, unknown> = items === undefined ? {} : { items };
  optionStringToHash(listString, hash);
  return hash;
}

function optionStringToHash(listString: string, hash: Record<string, unknown>): void {
  if (listString.trim() === "") return;
  for (const pair of listString.trim().split(";")) {
    const colon = pair.indexOf(":");
    const value = (colon === -1 ? pair : pair.slice(colon + 1)).trim();
    const key = (colon === -1 ? DEFAULT_OPTION : pair.slice(0, colon)).trim();
    if (key === "item") {
      const items = (hash["items"] ?? {}) as Record<string, unknown>;
      items["view"] = value;
      hash["items"] = items;
      continue;
    }
    if (!SHARK_KEYS.has(key)) continue;
    hash[key] = value;
  }
}

export interface ContentPiece {
  kind: "text" | "nest" | "escaped";
  text: string;
  nest?: ParsedNest;
}

export function scanNests(content: string | undefined): ContentPiece[] {
  if (content === undefined || content === null) return [];
  const memo = DeckoName.requestMemo<ContentPiece[]>(SCAN_NESTS_MEMO);
  if (memo !== undefined) {
    const hit = memo.get(content);
    if (hit !== undefined) return hit;
  }
  const known = processScanMemo.get(content);
  if (known !== undefined) {
    memo?.set(content, known);
    return known;
  }
  const pieces = deepFreeze(scanNestsUncached(content));
  if (processScanMemoChars + content.length > SCAN_PROCESS_MEMO_CHAR_LIMIT) {
    processScanMemo.clear();
    processScanMemoChars = 0;
  }
  processScanMemo.set(content, pieces);
  processScanMemoChars += content.length;
  memo?.set(content, pieces);
  return pieces;
}

const SCAN_NESTS_MEMO = {};
const processScanMemo = new Map<string, ContentPiece[]>();
let processScanMemoChars = 0;
const SCAN_PROCESS_MEMO_CHAR_LIMIT = 2_000_000;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

function scanNestsUncached(content: string): ContentPiece[] {
  const pieces: ContentPiece[] = [];
  let textStart = 0;
  let at = 0;
  while (at < content.length) {
    CANDIDATE_AT_REGEXP.lastIndex = at;
    const candidate = CANDIDATE_AT_REGEXP.exec(content);
    if (candidate === null) break;
    at = candidate.index;
    const escaped = matchAt(ESCAPED_LITERAL_AT_REGEXP, content, at);
    if (escaped !== undefined) {
      pushText(pieces, content.slice(textStart, at));
      pieces.push({ kind: "escaped", text: escaped });
      at += escaped.length;
      textStart = at;
      continue;
    }
    NEST_AT_REGEXP.lastIndex = at;
    const nest = NEST_AT_REGEXP.exec(content);
    if (nest !== null) {
      pushText(pieces, content.slice(textStart, at));
      pieces.push({ kind: "nest", text: nest[0], nest: interpretNest(nest[1] ?? "") });
      at += nest[0].length;
      textStart = at;
      continue;
    }
    at += 1;
  }
  pushText(pieces, content.slice(textStart));
  return pieces;
}

function matchAt(re: RegExp, content: string, at: number): string | undefined {
  re.lastIndex = at;
  return re.exec(content)?.[0];
}

function pushText(pieces: ContentPiece[], text: string): void {
  if (text !== "") pieces.push({ kind: "text", text });
}

function interpretNest(inBrackets: string): ParsedNest {
  const stripped = stripTags(inBrackets);
  const pipe = stripped.indexOf("|");
  const rawName = (pipe === -1 ? stripped : stripped.slice(0, pipe)).trim();
  const optLists = pipe === -1 ? undefined : stripped.slice(pipe + 1);
  if (rawName.startsWith("#")) {
    return {
      syntax: stripped,
      name: rawName,
      options: { extra: {} },
      comment: rawName.startsWith("##") ? "" : `<!-- ${escapeHtml(stripped)} -->`,
    };
  }
  return {
    syntax: stripped,
    name: rawName,
    options: parseNestOptions(optLists),
    comment: undefined,
    chunkNestSyntax: stripped,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function referencedNames(content: string | undefined): { name: string; relative: boolean }[] {
  const out: { name: string; relative: boolean }[] = [];
  for (const piece of scanNests(content)) {
    const nest = piece.nest;
    if (nest === undefined || nest.comment !== undefined) continue;
    out.push({ name: nest.name, relative: nest.name.startsWith("_") });
  }
  return out;
}
