import { ALPHA_STYLES } from "../alpha-style.js";
import { coderayEscape } from "../escape.js";

function styleFor(kind: string): string | undefined {
  for (const entry of ALPHA_STYLES) if (entry.kind === kind) return entry.style;
  return undefined;
}

function wrapText(text: string, style: string | undefined): string {
  if (style === undefined) return text;
  return `<span style="${style}">${text}</span>`;
}

const GROUP_SCOPED: Record<
  "string" | "key",
  { group: string; delimiter: string; content: string | undefined; char: string }
> = {
  key: {
    group: "color:#606",
    delimiter: "color:#404",
    content: undefined,
    char: "color:#60f",
  },
  string: {
    group: "background-color:hsla(0,100%,50%,0.05)",
    delimiter: "color:#710",
    content: "color:#D20",
    char: "color:#b0b",
  },
};

function groupOpener(kind: "string" | "key"): string {
  return `<span style="${GROUP_SCOPED[kind].group}">`;
}

function groupDelimiter(kind: "string" | "key", quote: string): string {
  return `<span style="${GROUP_SCOPED[kind].delimiter}">${coderayEscape(quote)}</span>`;
}

function groupInner(kind: "string" | "key", token: "content" | "char", text: string): string {
  const style = GROUP_SCOPED[kind][token];
  const escaped = coderayEscape(text);
  return style === undefined ? `<span>${escaped}</span>` : `<span style="${style}">${escaped}</span>`;
}

export function looksLikeJsonKey(input: string, start: number): boolean {
  const N = input.length;
  let i = start;
  while (i < N) {
    const c = input.charCodeAt(i);
    if (c === 0x22 ) {
      i += 1;
      while (i < N && /\s/.test(input[i])) i += 1;
      return i < N && input[i] === ":";
    }
    if (c === 0x5c ) {
      const next = i + 1 < N ? input.charCodeAt(i + 1) : -1;
      if (next === -1 || next === 0x0a || next === 0x0d || next === 0x2028 || next === 0x2029) {
        return false;
      }
      i += 2;
      continue;
    }
    i += 1;
  }
  return false;
}

export function scanJson(input: string): string {
  let out = "";
  let i = 0;
  const N = input.length;
  let state: "initial" | "string" | "key" = "initial";
  const ESCAPE_RE = /^(?:\\[bfnrt"\\/]|\\u[a-fA-F0-9]{4})/;
  const UNICODE_ESCAPE_RE = /^\\u[a-fA-F0-9]{4}/;
  while (i < N) {
    if (state === "initial") {
      const ws = /^\s+/.exec(input.slice(i));
      if (ws !== null) {
        out += wrapText(coderayEscape(ws[0]), styleFor("space"));
        i += ws[0].length;
        continue;
      }
      const c = input[i];
      if (c === '"') {
        state = looksLikeJsonKey(input, i + 1) ? "key" : "string";
        out += groupOpener(state) + groupDelimiter(state, '"');
        i += 1;
        continue;
      }
      if (/^[:,\[\]{}]/.test(c)) {
        out += wrapText(coderayEscape(c), styleFor("operator"));
        i += 1;
        continue;
      }
      if (/^(?:true|false|null)\b/.test(input.slice(i))) {
        const m = /^(?:true|false|null)\b/.exec(input.slice(i))!;
        out += wrapText(coderayEscape(m[0]), styleFor("value"));
        i += m[0].length;
        continue;
      }
      if (/^-?(?:0|[1-9]\d*)(?:\.\d+(?:[eE][-+]?\d+)?|[eE][-+]?\d+)?/.test(input.slice(i))) {
        const m = /^-?(?:0|[1-9]\d*)(?:\.\d+(?:[eE][-+]?\d+)?|[eE][-+]?\d+)?/.exec(input.slice(i))!;
        const kind = /\.|e|E/.test(m[0]) ? "float" : "integer";
        out += wrapText(coderayEscape(m[0]), styleFor(kind));
        i += m[0].length;
        continue;
      }
      out += wrapText(coderayEscape(c), styleFor("error"));
      i += 1;
      continue;
    }
    if (state === "string" || state === "key") {
      const rest = input.slice(i);
      const plain = /^[^\\"]+/.exec(rest);
      if (plain !== null) {
        out += groupInner(state, "content", plain[0]);
        i += plain[0].length;
        continue;
      }
      if (rest.startsWith('"')) {
        out += groupDelimiter(state, '"') + "</span>";
        i += 1;
        state = "initial";
        continue;
      }
      if (ESCAPE_RE.test(rest)) {
        const m = UNICODE_ESCAPE_RE.test(rest)
          ? /^\\u[a-fA-F0-9]{4}/.exec(rest)!
          : /^\\[bfnrt"\\/]/.exec(rest)!;
        out += groupInner(state, "char", m[0]);
        i += m[0].length;
        continue;
      }
      if (/^\\./.test(rest)) {
        const m = /^\\./.exec(rest)!;
        out += groupInner(state, "content", m[0]);
        i += m[0].length;
        continue;
      }
      if (rest.startsWith("\\")) {
        out += "</span>";
        out += wrapText(coderayEscape("\\"), styleFor("error"));
        state = "initial";
        i += 1;
        continue;
      }
      out += "</span>";
      state = "initial";
      continue;
    }
  }
  return out;
}
