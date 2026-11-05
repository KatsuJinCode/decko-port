import { HtmlTokenEncoder } from "../encoder.js";
import { scanJavaScriptInto } from "./java-script.js";
import { scanCssInto } from "./css.js";

export function scanHtml(input: string): string {
  const enc = new HtmlTokenEncoder();
  let i = 0;
  const N = input.length;
  let state:
    | "initial"
    | "attribute"
    | "attribute_equal"
    | "attribute_value"
    | "attribute_value_string"
    | "in_special_tag" = "initial";
  let inTag: string | undefined = undefined;
  let inAttribute: "script" | "style" | undefined = undefined;
  let plainStringContent: RegExp | undefined = undefined;

  const CDATA_OPEN = /^<!\[CDATA\[/;
  const CDATA_BODY = /^.*?\]\]>/s;
  const COMMENT = /^<!--(?:.*?-->|.*)/s;
  const DOCTYPE = /^<!(?:\w+)(?:.*?>|.*)|^\]>/s;
  const XML_PI = /^<\?xml(?:.*?\?>|.*)/s;
  const PI = /^<\?(?:.*?\?>|.*)/s;
  const CLOSE_TAG = /^<\/[-\w.:]*>?/;
  const OPEN_TAG = /^<(?:(script|style)|[-\w.:]+)(>)?/;
  const PLAIN = /^[^<>&]+/;
  const ENTITY = /^&(?:\w+|#\d+|#x[0-9a-fA-F]+);/;
  const TAG_END = /^\/?>/;
  const ATTR_NAME = /^[\w.:-]+/;
  const ATTR_EQ = /^=/;
  const QUOTE = /^["']/;
  const WHITE = /^\s+/;
  const STR_CONTENT_DQ = /^[^&">\n]+/;
  const STR_CONTENT_SQ = /^[^&'\n]+/;

  while (i < N) {
    const rest = input.slice(i);
    if (state !== "in_special_tag") {
      const ws = WHITE.exec(rest);
      if (ws !== null) {
        enc.textToken(ws[0], "space");
        i += ws[0].length;
        continue;
      }
    }
    let m: RegExpExecArray | null;
    if (state === "initial") {
      if ((m = CDATA_OPEN.exec(rest)) !== null) {
        enc.textToken(m[0], "inline_delimiter");
        i += m[0].length;
        const body = CDATA_BODY.exec(rest.slice(m[0].length));
        if (body !== null) {
          enc.textToken(body[0].slice(0, -3), "plain");
          enc.textToken("]]>", "inline_delimiter");
          i += body[0].length;
        } else {
          const tail = /^.+/.exec(rest.slice(m[0].length));
          if (tail !== null) {
            enc.textToken(tail[0], "error");
            i += tail[0].length;
          }
        }
        continue;
      }
      if ((m = COMMENT.exec(rest)) !== null) {
        enc.textToken(m[0], "comment");
        i += m[0].length;
        continue;
      }
      if ((m = DOCTYPE.exec(rest)) !== null) {
        enc.textToken(m[0], "doctype");
        i += m[0].length;
        continue;
      }
      if ((m = XML_PI.exec(rest)) !== null) {
        enc.textToken(m[0], "preprocessor");
        i += m[0].length;
        continue;
      }
      if ((m = PI.exec(rest)) !== null) {
        enc.textToken(m[0], "comment");
        i += m[0].length;
        continue;
      }
      if ((m = CLOSE_TAG.exec(rest)) !== null) {
        inTag = undefined;
        enc.textToken(m[0], "tag");
        i += m[0].length;
        continue;
      }
      if ((m = OPEN_TAG.exec(rest)) !== null) {
        enc.textToken(m[0], "tag");
        i += m[0].length;
        inTag = m[1];
        if (m[2] !== undefined) {
          state = inTag !== undefined ? "in_special_tag" : "initial";
        } else {
          state = "attribute";
        }
        continue;
      }
      if ((m = PLAIN.exec(rest)) !== null) {
        enc.textToken(m[0], "plain");
        i += m[0].length;
        continue;
      }
      if ((m = ENTITY.exec(rest)) !== null) {
        enc.textToken(m[0], "entity");
        i += m[0].length;
        continue;
      }
      inTag = undefined;
      enc.textToken(rest[0], "error");
      i += 1;
      continue;
    }
    if (state === "attribute") {
      if ((m = TAG_END.exec(rest)) !== null) {
        enc.textToken(m[0], "tag");
        inAttribute = undefined;
        state = inTag !== undefined ? "in_special_tag" : "initial";
        i += m[0].length;
        continue;
      }
      if ((m = ATTR_NAME.exec(rest)) !== null) {
        inAttribute = attributeScriptOrStyle(m[0]);
        enc.textToken(m[0], "attribute_name");
        state = "attribute_equal";
        i += m[0].length;
        continue;
      }
      inTag = undefined;
      enc.textToken(rest[0], "error");
      i += 1;
      continue;
    }
    if (state === "attribute_equal") {
      if ((m = ATTR_EQ.exec(rest)) !== null) {
        enc.textToken(m[0], "operator");
        state = "attribute_value";
        i += m[0].length;
        continue;
      }
      state = "attribute";
      continue;
    }
    if (state === "attribute_value") {
      if ((m = ATTR_NAME.exec(rest)) !== null) {
        enc.textToken(m[0], "attribute_value");
        state = "attribute";
        i += m[0].length;
        continue;
      }
      if ((m = QUOTE.exec(rest)) !== null) {
        const openChar = m[0];
        enc.beginGroup("string");
        enc.textToken(openChar, "delimiter");
        if (inAttribute === "script" || inAttribute === "style") {
          const bodyEnd = scanUntilQuote(input, i + m[0].length, openChar);
          const body = input.slice(i + m[0].length, bodyEnd);
          if (body.length > 0) enc.textToken(body, "ident");
          if (input[bodyEnd] === openChar) {
            enc.textToken(openChar, "delimiter");
            i = bodyEnd + 1;
          } else {
            i = bodyEnd;
          }
          enc.endGroup();
          state = "attribute";
          inAttribute = undefined;
        } else {
          state = "attribute_value_string";
          plainStringContent = openChar === '"' ? STR_CONTENT_DQ : STR_CONTENT_SQ;
          i += m[0].length;
        }
        continue;
      }
      if ((m = TAG_END.exec(rest)) !== null) {
        enc.textToken(m[0], "tag");
        state = "initial";
        i += m[0].length;
        continue;
      }
      enc.textToken(rest[0], "error");
      i += 1;
      continue;
    }
    if (state === "attribute_value_string") {
      if ((m = plainStringContent!.exec(rest)) !== null) {
        enc.textToken(m[0], "content");
        i += m[0].length;
        continue;
      }
      if (/^['"]/.test(rest)) {
        enc.textToken(rest[0], "delimiter");
        enc.endGroup();
        state = "attribute";
        i += 1;
        continue;
      }
      if ((m = ENTITY.exec(rest)) !== null) {
        enc.textToken(m[0], "entity");
        i += m[0].length;
        continue;
      }
      if (rest[0] === "&") {
        enc.textToken("&", "content");
        i += 1;
        continue;
      }
      if (/^[\n>]/.test(rest)) {
        enc.endGroup();
        state = "initial";
        enc.textToken(rest[0], "error");
        i += 1;
        continue;
      }
      enc.textToken(rest[0], "error");
      i += 1;
      continue;
    }
    if (state === "in_special_tag") {
      if (inTag === "script" || inTag === "style") {
        const leading = /^[ \t]*\n/.exec(rest);
        if (leading !== null) {
          enc.textToken(leading[0], "space");
          i += leading[0].length;
        }
        const cm = /^(\s*<!--)(?:(.*?)(-->)|(.*))/s.exec(input.slice(i));
        let body: string;
        let closing: string | undefined;
        if (cm !== null) {
          body = cm[2] ?? cm[4] ?? "";
          closing = cm[3];
          enc.textToken(cm[1], "comment");
          i += cm[1].length;
          if (body.length > 0) i += body.length;
          if (closing !== undefined && closing !== "") {
            enc.textToken(closing, "comment");
            i += closing.length;
          }
        } else {
          const untilRe = new RegExp(`(?=(?:\\n\\s*)?</${inTag}>)`);
          const until = untilRe.exec(input.slice(i));
          body = until !== null ? input.slice(i, i + until.index) : input.slice(i);
          closing = "";
          if (body.length > 0) i += body.length;
        }
        if (body.length > 0) {
          enc.beginGroup("inline");
          if (inTag === "script") {
            scanJavaScriptInto(enc, body);
          } else {
            scanCssInto(enc, body);
          }
          enc.endGroup();
        }
        state = "initial";
        continue;
      }
      enc.textToken(rest[0], "error");
      i += 1;
      continue;
    }
    enc.textToken(rest[0], "error");
    i += 1;
  }
  if (state === "attribute_value_string") enc.endGroup();
  enc.closeAllGroups();
  return enc.toString();
}

function scanUntilQuote(input: string, from: number, quote: string): number {
  for (let k = from; k < input.length; k++) {
    if (input[k] === quote) return k;
  }
  return input.length;
}

function attributeScriptOrStyle(name: string): "script" | "style" | undefined {
  const lower = name.toLowerCase();
  if (lower === "style") return "style";
  if (lower === "script" || EVENT_ATTRIBUTES.has(lower)) return "script";
  return undefined;
}

const EVENT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "onabort", "onafterprint", "onbeforeprint", "onbeforeunload", "onblur",
  "oncanplay", "oncanplaythrough", "onchange", "onclick", "oncontextmenu",
  "oncuechange", "ondblclick", "ondrag", "ondragdrop", "ondragend",
  "ondragenter", "ondragleave", "ondragover", "ondragstart", "ondrop",
  "ondurationchange", "onemptied", "onended", "onerror", "onfocus",
  "onformchange", "onforminput", "onhashchange", "oninput", "oninvalid",
  "onkeydown", "onkeypress", "onkeyup", "onload", "onloadeddata",
  "onloadedmetadata", "onloadstart", "onmessage", "onmousedown",
  "onmousemove", "onmouseout", "onmouseover", "onmouseup", "onmousewheel",
  "onmove", "onoffline", "ononline", "onpagehide", "onpageshow",
  "onpause", "onplay", "onplaying", "onpopstate", "onprogress",
  "onratechange", "onreadystatechange", "onredo", "onreset", "onresize",
  "onscroll", "onseeked", "onseeking", "onselect", "onshow",
  "onstalled", "onstorage", "onsubmit", "onsuspend", "ontimeupdate",
  "ontoggle", "onvolumechange", "onwaiting",
]);
