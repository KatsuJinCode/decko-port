import { HtmlTokenEncoder } from "../encoder.js";

function at(re: RegExp, input: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(input);
}

const ESC = `(?:\\\\[0-9a-fA-F]{1,6}\\b|\\\\[^\\n0-9a-fA-F])`;
const STRING1 = `"(?:[^\\n\\\\"]+|\\\\\\n|${ESC})*"?`;
const STRING2 = `'(?:[^\\n\\\\']+|\\\\\\n|${ESC})*'?`;
const HEX_COLOR = `#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})`;
const NUM = `-?(?:[0-9]*\\.[0-9]+|[0-9]+)n?`;
const IDENT = `-?[_a-zA-Z][-_a-zA-Z0-9]*`;
const AT_KEYWORD = `@${IDENT}`;
const UNIT = `(?:em|ex|px|in|cm|mm|pt|pc|s|dpi|dppx|deg)`;
const DIMENSION = `${NUM}${UNIT}`;
const PERCENTAGE = `${NUM}%`;
const FUNCTION = `(?:url|alpha|attr|counters?)\\((?:[^)\\n]|\\\\\\))*\\)?`;
const ID = `(?!${HEX_COLOR}\\b(?!-))#[-_a-zA-Z0-9]+`;
const CLASS = `\\.[-_a-zA-Z0-9]+`;
const PSEUDO_CLASS = `::?${IDENT}`;
const ATTRIBUTE_SELECTOR = `\\[[^\\]]*\\]?`;

const RE_WS = /\s+/y;
const RE_IDENT_GREEDY = new RegExp(IDENT, "y");
const RE_ASTERISK = /\*/y;
const RE_BLOCK_IDENT = new RegExp(IDENT, "y");
const RE_MEDIA_IDENT = new RegExp(IDENT, "y");
const RE_CLASS = new RegExp(CLASS, "y");
const RE_ID = new RegExp(ID, "y");
const RE_PSEUDO = new RegExp(PSEUDO_CLASS, "y");
const RE_ATTR = new RegExp(ATTRIBUTE_SELECTOR, "y");
const RE_AT_MEDIA = /@media/y;
const RE_COMMENT = /\/\*(?:[\s\S]*?\*\/|[\s\S]*)/y;
const RE_STRING = new RegExp(`(?:${STRING1}|${STRING2})`, "y");
const RE_FUNCTION = new RegExp(FUNCTION, "y");
const RE_MEASURE = new RegExp(`(?:${DIMENSION}|${PERCENTAGE}|${NUM})`, "y");
const RE_HEX = new RegExp(HEX_COLOR, "y");
const RE_IMPORTANT = /! *important/y;
const RE_RGB = /(?:rgb|hsl)a?\([^()\n]*\)?/y;
const RE_AT_KEYWORD = new RegExp(AT_KEYWORD, "y");
const RE_OP = /[+>~:;,.=()/]/y;

type CssState = "initial" | "block" | "media" | "media_before_name" | "media_after_name";

export function scanCss(input: string): string {
  const enc = new HtmlTokenEncoder();
  scanCssInto(enc, input);
  return enc.toString();
}

export function scanCssInto(enc: HtmlTokenEncoder, input: string): void {
  const states: CssState[] = ["initial"];
  let valueExpected = false;
  const N = input.length;
  let i = 0;

  const push = (text: string, kind: string): void => {
    enc.textToken(text, kind);
    i += text.length;
  };

  while (i < N) {
    const ws = at(RE_WS, input, i);
    if (ws !== null) {
      push(ws[0], "space");
      continue;
    }

    const state = states[states.length - 1];
    if (state === "initial" || state === "media") {
      const ident = at(RE_IDENT_GREEDY, input, i);
      if (ident !== null && input[i + ident[0].length] !== "(") {
        push(ident[0], "tag");
        continue;
      }
      const star = at(RE_ASTERISK, input, i);
      if (star !== null) {
        push("*", "tag");
        continue;
      }
      const cls = at(RE_CLASS, input, i);
      if (cls !== null) {
        push(cls[0], "class");
        continue;
      }
      const id = at(RE_ID, input, i);
      if (id !== null) {
        push(id[0], "id");
        continue;
      }
      const pseudo = at(RE_PSEUDO, input, i);
      if (pseudo !== null) {
        push(pseudo[0], "pseudo_class");
        continue;
      }
      const attr = at(RE_ATTR, input, i);
      if (attr !== null) {
        const m = attr[0];
        enc.textToken(m[0], "operator");
        if (m.length > 2) enc.textToken(m.slice(1, m.length - 1), "attribute_name");
        if (m[m.length - 1] === "]") enc.textToken("]", "operator");
        i += m.length;
        continue;
      }
      const media = at(RE_AT_MEDIA, input, i);
      if (media !== null) {
        push(media[0], "directive");
        states.push("media_before_name");
        continue;
      }
    } else if (state === "block") {
      const ident = at(RE_BLOCK_IDENT, input, i);
      if (ident !== null && input[i + ident[0].length] !== "(") {
        enc.textToken(ident[0], valueExpected ? "value" : "key");
        i += ident[0].length;
        continue;
      }
    } else if (state === "media_before_name") {
      const ident = at(RE_MEDIA_IDENT, input, i);
      if (ident !== null) {
        push(ident[0], "type");
        states[states.length - 1] = "media_after_name";
        continue;
      }
    } else if (state === "media_after_name") {
      if (input[i] === "{") {
        push("{", "operator");
        states[states.length - 1] = "media";
        continue;
      }
    }

    const comment = at(RE_COMMENT, input, i);
    if (comment !== null) {
      push(comment[0], "comment");
      continue;
    }

    if (input[i] === "{") {
      valueExpected = false;
      push("{", "operator");
      states.push("block");
      continue;
    }
    if (input[i] === "}") {
      valueExpected = false;
      push("}", "operator");
      const last = states[states.length - 1];
      if (last === "block" || last === "media") states.pop();
      continue;
    }

    const str = at(RE_STRING, input, i);
    if (str !== null) {
      const m = str[0];
      enc.beginGroup("string");
      enc.textToken(m[0], "delimiter");
      if (m.length > 2) enc.textToken(m.slice(1, m.length - 1), "content");
      if (m.length >= 2) enc.textToken(m[m.length - 1], "delimiter");
      enc.endGroup();
      i += m.length;
      continue;
    }

    const fn = at(RE_FUNCTION, input, i);
    if (fn !== null) {
      const m = fn[0];
      const start = /^\w+\(/.exec(m)![0];
      enc.beginGroup("function");
      enc.textToken(start, "delimiter");
      if (m[m.length - 1] === ")") {
        if (m.length > start.length + 1) {
          enc.textToken(m.slice(start.length, m.length - 1), "content");
        }
        enc.textToken(")", "delimiter");
      } else {
        if (m.length > start.length) {
          enc.textToken(m.slice(start.length), "content");
        }
      }
      enc.endGroup();
      i += m.length;
      continue;
    }

    const measure = at(RE_MEASURE, input, i);
    if (measure !== null) {
      push(measure[0], "float");
      continue;
    }

    const hex = at(RE_HEX, input, i);
    if (hex !== null) {
      push(hex[0], "color");
      continue;
    }

    const important = at(RE_IMPORTANT, input, i);
    if (important !== null) {
      push(important[0], "important");
      continue;
    }

    const rgb = at(RE_RGB, input, i);
    if (rgb !== null) {
      push(rgb[0], "color");
      continue;
    }

    const atKeyword = at(RE_AT_KEYWORD, input, i);
    if (atKeyword !== null) {
      push(atKeyword[0], "directive");
      continue;
    }

    const op = at(RE_OP, input, i);
    if (op !== null) {
      const ch = op[0];
      if (ch === ":") valueExpected = true;
      else if (ch === ";") valueExpected = false;
      push(ch, "operator");
      continue;
    }

    push(input[i], "error");
  }
}
