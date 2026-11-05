export function canonicalErrorClass(name) {
  if (typeof name !== "string" || name === "") return name;
  const proper = name.includes("::") ? name.slice(name.lastIndexOf("::") + 2) : name;
  const stem = "Error";
  return proper.endsWith(stem) && proper.length > stem.length ? proper.slice(0, -stem.length) : proper;
}

export const RULE_ORDER = ["N1", "N2", "N3", "N4", "N6", "N7", "N8", "N9"];

export const OBJECT_ADDRESS = /#<([A-Za-z_][\w:]*):0x[0-9a-fA-F]{16}(?=[ >])/g;
export const OBJECT_ADDRESS_ESCAPED = /(#(?:&amp;lt;|&lt;)[A-Za-z_][\w:]*):0x[0-9a-fA-F]{16}(?=&amp;gt;|&gt;| )/g;
export const OBJECT_ADDRESS_MARKER = "N9#addr";

export function maskObjectAddresses(text, applied) {
  if (typeof text !== "string") return text;
  return text.replace(OBJECT_ADDRESS, (_, cls) => {
    if (applied) applied.add("N9");
    return `#<${cls}:${OBJECT_ADDRESS_MARKER}`;
  });
}

export function normalizeErrorRecord(error, applied) {
  if (error === null || typeof error !== "object") return error;
  const cls = canonicalErrorClass(error.class);
  if (applied && cls !== error.class) applied.add("N8");
  const out = { ...error, class: cls };
  if (typeof error.message === "string") out.message = maskObjectAddresses(error.message, applied);
  return out;
}

export function sameFailure(a, b, applied) {
  return sameJson(normalizeErrorRecord(a, applied), normalizeErrorRecord(b, applied));
}

export const SLOT_ID = /(?<=\s)data-slot-id=(["'])[0-9a-f]{20}\1/g;

const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title", "xmp"]);
const RAW_TEXT_NEVER_CLOSES = "plaintext";

const isWhitespace = (c) => c === " " || "\n\r\t\f".includes(c);
const isNameChar = (c) => /[A-Za-z0-9:_-]/.test(c);

export const COLLAPSE_ID = /(card-[a-z0-9_]+-)(-?\d+)(-collapse-id)/g;

export const RELATIVE_TIME =
  /\b(less than a minute|half a minute|less than \d+ seconds|about (?:[1-9]|1[0-9]|2[0-4]) hours?|about (?:[1-9]|1[0-2]) months?|about [1-9][0-9]* years?|over [1-9][0-9]* years?|almost [1-9][0-9]* years?|(?:[1-9]|1[0-9]|2[0-9]|3[0-9]|4[0-4]) minutes?|(?:[1-9]|1[0-9]|2[0-4]) hours?|(?:[1-9]|[12][0-9]|30) days?|(?:[1-9]|1[0-2]) months?)\b/g;

export const ERROR_SPAN_TITLE =
  /(&lt;h3&gt;Error message \(visible to admin only\)&lt;\/h3&gt;)/;
const CAPTURE_HOST_PATH = /\b[A-Za-z]:[/\\][^\s<>&":]+/g;
const HEAP_ADDRESS = /0x[0-9a-fA-F]{6,16}/g;

export const FRAME_MARKER = "N6#frames";
const BACKTRACE_DIV = /(&lt;\/p&gt;\s*&lt;div&gt;)([\s\S]*?)(&lt;\/div&gt;)/;

function canonicalizeDebugTitle(body, note, on) {
  let out = body;
  if (on("N7")) {
    out = out.replace(CAPTURE_HOST_PATH, () => {
      note("N7");
      return "N7#path";
    });
    out = out.replace(HEAP_ADDRESS, () => {
      note("N7");
      return "N7#addr";
    });
  }
  if (on("N6")) {
    out = out.replace(BACKTRACE_DIV, (_, pre, _frames, post) => {
      note("N6");
      return pre + FRAME_MARKER + post;
    });
  }
  return out;
}

export function normalizeHtml(html, { classTokenOrder = true, applied, rules } = {}) {
  if (typeof html !== "string") return html;
  if (rules?.includes("N5")) throw new Error("RetiredRelativeTimeNormalization: literal durations must remain exact");
  const on = (rule) => !rules || rules.includes(rule);
  const note = (rule) => {
    if (applied && on(rule)) applied.add(rule);
  };
  const seen = new Map();
  const collapse = (text) =>
    text.replace(COLLAPSE_ID, (_, pre, digits, post) => {
      if (!on("N4")) return `${pre}${digits}${post}`;
      note("N4");
      let k = seen.get(digits);
      if (k === undefined) {
        k = `N4#${seen.size + 1}`;
        seen.set(digits, k);
      }
      return `${pre}${k}${post}`;
    });
  const nine = (text) => on("N9") ? maskHtmlAddresses(text, note) : text;
  let out = "";
  let i = 0;
  const lower = html.toLowerCase();
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += canonicalizeText(html.slice(i), collapse, nine);
      break;
    }
    out += canonicalizeText(html.slice(i, lt), collapse, nine);
    i = lt;
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? html.length : end + 3;
      out += html.slice(lt, i);
      continue;
    }
    if (html.startsWith("<!", i) || html.startsWith("<?", i)) {
      const gt = html.indexOf(">", i);
      i = gt === -1 ? html.length : gt + 1;
      out += html.slice(lt, i);
      continue;
    }
    let k = i + 1;
    const closing = html[k] === "/";
    if (closing) k++;
    const nameStart = k;
    if (!/[A-Za-z]/.test(html[nameStart] ?? "")) {
      out += "<";
      i++;
      continue;
    }
    while (k < html.length && isNameChar(html[k])) k++;
    const name = html.slice(nameStart, k);
    let quote = null;
    let j = k;
    while (j < html.length) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
      j++;
    }
    const tagEnd = j >= html.length ? html.length : j + 1;
    const tagText = html.slice(i, tagEnd);
    out += closing ? tagText : normalizeTagAttributes(tagText, classTokenOrder, collapse, note, nine, on);
    i = tagEnd;
    const lowerName = name.toLowerCase();
    if (!closing && RAW_TEXT_ELEMENTS.has(lowerName) && !tagText.endsWith("/>")) {
      const closeAt = lower.indexOf(`</${lowerName}`, i);
      const bodyEnd = closeAt === -1 ? html.length : (() => {
        const gt = html.indexOf(">", closeAt);
        return gt === -1 ? html.length : gt + 1;
      })();
      out += html.slice(i, bodyEnd);
      i = bodyEnd;
    } else if (!closing && lowerName === RAW_TEXT_NEVER_CLOSES) {
      out += html.slice(i);
      i = html.length;
    }
  }
  return out;
}

function canonicalizeText(text, collapse, nine) {
  return collapse(nine(text));
}

function maskHtmlAddresses(text, note) {
  return text
    .replace(OBJECT_ADDRESS_ESCAPED, (_, pre) => {
      note("N9");
      return `${pre}:${OBJECT_ADDRESS_MARKER}`;
    })
    .replace(OBJECT_ADDRESS, (_, cls) => {
      note("N9");
      return `#<${cls}:${OBJECT_ADDRESS_MARKER}`;
    });
}

function normalizeTagAttributes(tagText, classTokenOrder, collapse, note, nine, on) {
  let out = "";
  let k = 1;
  while (k < tagText.length && !isWhitespace(tagText[k]) && tagText[k] !== ">" && tagText[k] !== "/") k++;
  out += tagText.slice(0, k);
  while (k < tagText.length) {
    const c = tagText[k];
    if (isWhitespace(c) || c === ">" || c === "/" || c === "=") {
      out += c;
      k++;
      continue;
    }
    const nameStart = k;
    while (k < tagText.length && !isWhitespace(tagText[k]) && !"=/>".includes(tagText[k])) k++;
    const name = tagText.slice(nameStart, k);
    if (k === nameStart) {
      out += tagText.slice(k);
      break;
    }
    let e = k;
    while (e < tagText.length && isWhitespace(tagText[e])) e++;
    if (tagText[e] !== "=") {
      out += name;
      continue;
    }
    let v = e + 1;
    while (v < tagText.length && isWhitespace(tagText[v])) v++;
    out += tagText.slice(nameStart, v);
    const q = tagText[v];
    if (q === '"' || q === "'") {
      const closeQ = tagText.indexOf(q, v + 1);
      const value = closeQ === -1 ? tagText.slice(v + 1) : tagText.slice(v + 1, closeQ);
      const isClass = name.toLowerCase() === "class";
      const isTitle = name.toLowerCase() === "title";
      let next = nine(value);
      if (name === "data-slot-id" && /^[0-9a-f]{20}$/.test(value)) {
        next = on("N1") ? "SLOT" : value;
        note("N1");
      } else {
        if (isClass && classTokenOrder) {
          if (value.split(/[ \t\n\r\f]+/).filter((t) => t !== "").length >= 2) note("N3");
          if (on("N3")) next = sortClassTokens(value);
        }
        if (on("N4")) next = collapse(next);
      }
      if (isTitle && ERROR_SPAN_TITLE.test(next)) {
        next = canonicalizeDebugTitle(next, note, on);
      }
      out += q + next + (closeQ === -1 ? "" : q);
      k = closeQ === -1 ? tagText.length : closeQ + 1;
    } else {
      let u = v;
      while (u < tagText.length && !isWhitespace(tagText[u]) && tagText[u] !== ">") u++;
      out += tagText.slice(v, u);
      k = u;
    }
  }
  return out;
}

export function sortClassTokens(value) {
  const tokens = value.split(/[ \t\n\r\f]+/).filter((t) => t !== "");
  if (tokens.length < 2) return value;
  const sorted = [...tokens].sort();
  if (new Set(tokens).size !== tokens.length) return value;
  const out = sorted.join(" ");
  return out === value ? value : out;
}

export function normalizeRender(result, options) {
  return result && typeof result === "object" && typeof result.html === "string" ? { ...result, html: normalizeHtml(result.html, options) } : result;
}

export const RECORD_TIME_RULES = ["N6", "N7"];
export function normalizeForRecord(result) {
  return normalizeRender(result, { rules: RECORD_TIME_RULES });
}

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  }
  return value;
}

export function sameJson(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
