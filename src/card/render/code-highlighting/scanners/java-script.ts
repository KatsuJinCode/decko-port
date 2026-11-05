import { HtmlTokenEncoder } from "../encoder.js";

export function scanJavaScript(input: string): string {
  const enc = new HtmlTokenEncoder();
  scanJavaScriptInto(enc, input);
  return enc.toString();
}

const KEYWORDS = new Set([
  "break", "case", "catch", "continue", "default", "delete", "do", "else",
  "finally", "for", "function", "if", "in", "instanceof", "new",
  "return", "switch", "throw", "try", "typeof", "var", "void", "while", "with",
]);
const PREDEFINED_CONSTANTS = new Set([
  "false", "null", "true", "undefined", "NaN", "Infinity",
]);
const MAGIC_VARIABLES = new Set(["this", "arguments"]);
const KEYWORDS_EXPECTING_VALUE = new Set([
  "case", "delete", "in", "instanceof", "new", "return", "throw", "typeof", "with",
]);
const RESERVED_WORDS = new Set([
  "abstract", "boolean", "byte", "char", "class", "debugger", "double", "enum",
  "export", "extends", "final", "float", "goto", "implements", "import", "int",
  "interface", "long", "native", "package", "private", "protected", "public",
  "short", "static", "super", "synchronized", "throws", "transient", "volatile",
]);

function identKind(word: string): string {
  if (RESERVED_WORDS.has(word)) return "reserved";
  if (PREDEFINED_CONSTANTS.has(word)) return "predefined_constant";
  if (MAGIC_VARIABLES.has(word)) return "local_variable";
  if (KEYWORDS.has(word)) return "keyword";
  return "ident";
}

const KEY_CHECK: Record<string, RegExp> = {
  "'": /^(?:[^\\']*(?:\\.[^\\']*)*)'\s*:/,
  '"': /^(?:[^\\"]*(?:\\.[^\\"]*)*)"\s*:/,
};

const STRING_CONTENT: Record<string, RegExp> = {
  "'": /^[^\\']+/,
  '"': /^[^\\"]+/,
  "/": /^[^\\/]+/,
};

const STRING_ESCAPE_RE = /^\\(?:[bfnrtv\n\\'"]|x[a-fA-F0-9]{1,2}|[0-7]{1,3}|u[a-fA-F0-9]{4}|U[a-fA-F0-9]{8})/;
const REGEXP_ESCAPE_RE = /^\\(?:[bfnrtv\n\\'"]|[bBdDsSwW]|u[a-fA-F0-9]{4}|U[a-fA-F0-9]{8})/;

type JsState = "initial" | "string" | "regexp" | "key" | "open_multi_line_comment";

export function scanJavaScriptInto(enc: HtmlTokenEncoder, input: string): void {
  let i = 0;
  const N = input.length;
  let state: JsState = "initial";
  let stringDelimiter: "'" | '"' | "/" | undefined;
  let valueExpected = true;
  let keyExpected = false;
  let functionExpected = false;

  const rest = () => input.slice(i);

  while (i < N) {
    if (state === "initial") {
      const ws = /^(?:[ \t\r\n\f\v]+|\\\n)/.exec(rest());
      if (ws !== null) {
        if (!valueExpected && ws[0].includes("\n")) valueExpected = true;
        enc.textToken(ws[0], "space");
        i += ws[0].length;
        continue;
      }
      if (rest().startsWith("//")) {
        const lineComment = /^\/\/[^\n\\]*(?:\\.[^\n\\]*)*/.exec(rest())!;
        valueExpected = true;
        enc.textToken(lineComment[0], "comment");
        i += lineComment[0].length;
        continue;
      }
      if (rest().startsWith("/*")) {
        const closed = /^\/\*[\s\S]*?\*\//.exec(rest());
        valueExpected = true;
        if (closed !== null) {
          enc.textToken(closed[0], "comment");
          i += closed[0].length;
        } else {
          enc.textToken(rest(), "comment");
          i = N;
          state = "open_multi_line_comment";
        }
        continue;
      }
      if (/^\.?\d/.test(rest())) {
        keyExpected = false;
        valueExpected = false;
        const hex = /^0[xX][0-9A-Fa-f]+/.exec(rest());
        if (hex !== null) {
          enc.textToken(hex[0], "hex");
          i += hex[0].length;
          continue;
        }
        const octal = /^0[0-7]+(?![89.eEfF])/.exec(rest());
        if (octal !== null) {
          enc.textToken(octal[0], "octal");
          i += octal[0].length;
          continue;
        }
        const float = /^\d+[fF]|\d*\.\d+(?:[eE][+-]?\d+)?[fF]?|\d+[eE][+-]?\d+[fF]/.exec(rest());
        if (float !== null) {
          enc.textToken(float[0], "float");
          i += float[0].length;
          continue;
        }
        const integer = /^\d+/.exec(rest());
        if (integer !== null) {
          enc.textToken(integer[0], "integer");
          i += integer[0].length;
          continue;
        }
      }
      if (valueExpected) {
        const xml = /^<([a-zA-Z]\w*)[^\/>]*\/>|^<([a-zA-Z]\w*)[\s\S]*?<\/\1>/i.exec(rest());
        if (xml !== null) {
          scanXmlLiteralInto(enc, xml[0]);
          valueExpected = false;
          i += xml[0].length;
          continue;
        }
      }
      const op = /^(?:[-+*=<>?:;,!&^|(\[{~%]+|\.(?!\d))/.exec(rest());
      if (op !== null) {
        valueExpected = true;
        const last = op[0].slice(-1);
        keyExpected = last === "{" || last === ",";
        functionExpected = false;
        enc.textToken(op[0], "operator");
        i += op[0].length;
        continue;
      }
      const close = /^[)\]}]+/.exec(rest());
      if (close !== null) {
        functionExpected = false;
        keyExpected = false;
        valueExpected = false;
        enc.textToken(close[0], "operator");
        i += close[0].length;
        continue;
      }
      const ident = /^[$a-zA-Z_][A-Za-z_0-9$]*/.exec(rest());
      if (ident !== null) {
        const word = ident[0];
        let kind = identKind(word);
        valueExpected = kind === "keyword" && KEYWORDS_EXPECTING_VALUE.has(word);
        if (kind === "ident") {
          if (word.includes("$")) kind = "predefined";
          else if (functionExpected) kind = "function";
          else if (/^\s*[=:]\s*function\b/.test(rest().slice(word.length))) kind = "function";
          else if (keyExpected && /^\s*:/.test(rest().slice(word.length))) kind = "key";
        }
        functionExpected = kind === "keyword" && word === "function";
        keyExpected = false;
        enc.textToken(word, kind);
        i += word.length;
        continue;
      }
      const quote = /^["']/.exec(rest());
      if (quote !== null) {
        const q = quote[0] as "'" | '"';
        state = keyExpected && KEY_CHECK[q].test(rest().slice(1)) ? "key" : "string";
        enc.beginGroup(state);
        stringDelimiter = q;
        enc.textToken(q, "delimiter");
        i += 1;
        continue;
      }
      if (valueExpected && rest().startsWith("/")) {
        enc.beginGroup("regexp");
        state = "regexp";
        stringDelimiter = "/";
        enc.textToken("/", "delimiter");
        i += 1;
        continue;
      }
      if (rest().startsWith("/")) {
        valueExpected = true;
        keyExpected = false;
        enc.textToken("/", "operator");
        i += 1;
        continue;
      }
      enc.textToken(input[i], "error");
      i += 1;
      continue;
    }
    if (state === "open_multi_line_comment") {
      const closed = /^[\s\S]*?\*\//.exec(rest());
      if (closed !== null) {
        state = "initial";
        enc.textToken(closed[0], "comment");
        i += closed[0].length;
      } else {
        const all = /^[\s\S]+/.exec(rest())!;
        enc.textToken(all[0], "comment");
        i += all[0].length;
      }
      valueExpected = true;
      continue;
    }
    const delim = stringDelimiter;
    if (delim !== undefined) {
      const content = STRING_CONTENT[delim].exec(rest());
      if (content !== null) {
        enc.textToken(content[0], "content");
        i += content[0].length;
        continue;
      }
    }
    const closer = /^["'\/]/.exec(rest());
    if (closer !== null) {
      enc.textToken(closer[0], "delimiter");
      i += 1;
      if (state === "regexp") {
        const modifiers = /^[gim]+/.exec(rest());
        if (modifiers !== null && modifiers[0] !== "") {
          enc.textToken(modifiers[0], "modifier");
          i += modifiers[0].length;
        }
      }
      enc.endGroup();
      stringDelimiter = undefined;
      keyExpected = false;
      valueExpected = false;
      state = "initial";
      continue;
    }
    if (state !== "regexp" && delim !== undefined && delim !== "/") {
      const esc = STRING_ESCAPE_RE.exec(rest());
      if (esc !== null) {
        if (delim === "'" && esc[0] !== "\\\\" && esc[0] !== "\\'") {
          enc.textToken(esc[0], "content");
        } else {
          enc.textToken(esc[0], "char");
        }
        i += esc[0].length;
        continue;
      }
    }
    if (state === "regexp") {
      const esc = REGEXP_ESCAPE_RE.exec(rest());
      if (esc !== null) {
        enc.textToken(esc[0], "char");
        i += esc[0].length;
        continue;
      }
    }
    const looseEscape = /^\\[\s\S]/.exec(rest());
    if (looseEscape !== null) {
      enc.textToken(looseEscape[0], "content");
      i += looseEscape[0].length;
      continue;
    }
    if (rest().startsWith("\\")) {
      enc.endGroup();
      enc.textToken("\\", "error");
      stringDelimiter = undefined;
      keyExpected = false;
      valueExpected = false;
      state = "initial";
      i += 1;
      continue;
    }
    if (i === N || (i === N - 1 && input[i] === "\n")) {
      enc.endGroup();
      stringDelimiter = undefined;
      keyExpected = false;
      valueExpected = false;
      state = "initial";
      continue;
    }
    enc.textToken(input[i], "error");
    i += 1;
  }
  if (state === "string" || state === "regexp") enc.endGroup();
}

function scanXmlLiteralInto(enc: HtmlTokenEncoder, literal: string): void {
  enc.textToken(literal, "plain");
}
