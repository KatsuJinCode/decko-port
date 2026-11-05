const SPACE = "[ \\t\\r\\n\\f\\v]";

const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

const NBSP = String.fromCharCode(0xa0);

function allowedTags(allowInlineStyles: boolean): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  for (const tag of [
    "br", "i", "b", "pre", "cite", "caption", "strong", "em", "ins", "sup", "sub", "del", "ol",
    "hr", "ul", "li", "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "span", "table", "tr",
    "td", "th", "tbody", "thead", "tfoot",
  ]) {
    tags.set(tag, []);
  }
  tags.set("a", ["href", "title", "target"]);
  tags.set("img", ["src", "alt", "title"]);
  tags.set("code", ["lang"]);
  tags.set("blockquote", ["cite"]);
  tags.set("ol", ["type"]);
  tags.set("ul", ["type"]);
  if (allowInlineStyles) {
    tags.get("table")!.push("cellpadding", "align", "border", "cellspacing", "data-mce-style");
    tags.get("td")!.push("scope", "data-mce-style");
    tags.get("th")!.push("scope", "data-mce-style");
  }
  for (const attrs of tags.values()) {
    attrs.push("class");
    if (allowInlineStyles) attrs.push("style");
  }
  return tags;
}

export const ALLOWED_TAGS = allowedTags(true);

const URL_ATTRIBUTES: ReadonlySet<string> = new Set(["href", "src", "cite"]);

const STYLE_ATTRIBUTES: ReadonlySet<string> = new Set(["style", "data-mce-style"]);

export const ALLOWED_URL_SCHEMES: ReadonlySet<string> = new Set([
  "http", "https", "mailto", "tel", "sms", "ftp", "skype", "callto", "webcal",
  "irc", "ircs", "xmpp", "geo", "news", "nntp", "feed",
]);

const DATA_IMAGE_RE = /^data:image\/(?:png|gif|jpe?g|pjpeg|webp|bmp|avif|x-icon|vnd\.microsoft\.icon)[;,]/;

const ATTR_VALUE_RE = [/(?<=^')[^']+(?=')/m, /(?<=^")[^"]+(?=")/m, /\S+/];

const blank = (s: string | null | undefined): boolean =>
  s === null || s === undefined || /^[ \t\r\n\f\v]*$/.test(s);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function processAttribute(attrib: string, all: string): [string, string | undefined] {
  const re = new RegExp(`\\b${escapeRegExp(attrib)}${SPACE}*=${SPACE}*(?=(.))`, "i");
  const m = re.exec(all);
  if (m === null) return ['"', undefined];
  let q = '"';
  let rest = all.slice(m.index + m[0].length);
  const idx = ["'", '"'].indexOf(m[1]);
  if (idx >= 0) q = m[1];
  const valueRe = ATTR_VALUE_RE[idx >= 0 ? idx : 2];
  const vm = valueRe.exec(rest);
  if (vm !== null) {
    rest = vm[0];
    if (attrib === "class") rest = filterClasses(rest);
  }
  return [q, rest];
}

function filterClasses(value: string): string {
  return value
    .split(/[ \t\r\n\f\v]+/)
    .filter((c) => /^w-/i.test(c))
    .join(" ");
}

export function rubyHtmlAttribs(tag: string, rawAttr: string, okAttrs: readonly string[]): string {
  const pieces = [tag];
  for (const okAttr of okAttrs) {
    const [q, value] = processAttribute(okAttr, rawAttr);
    if (!blank(value)) pieces.push(`${okAttr}=${q}${value}${q}`);
  }
  return pieces.join(" ");
}

export interface ParsedAttribute {
  name: string;
  value: string;
  quote: '"' | "'" | "";
}

export interface ParsedAttributes {
  attributes: ParsedAttribute[];
  unterminatedQuote: boolean;
}

const isTokenSpace = (c: string): boolean =>
  c === " " || c === "\t" || c === "\n" || c === "\f" || c === "\r";

function lowerName(c: string): string {
  if (c === "\0") return REPLACEMENT_CHARACTER;
  return c >= "A" && c <= "Z" ? c.toLowerCase() : c;
}

export function parseAttributes(input: string): ParsedAttributes {
  const attributes: ParsedAttribute[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i];
    if (isTokenSpace(c) || c === "/") {
      i++;
      continue;
    }
    let name = lowerName(c);
    i++;
    while (i < n) {
      const d = input[i];
      if (isTokenSpace(d) || d === "/" || d === "=") break;
      name += lowerName(d);
      i++;
    }
    while (i < n && isTokenSpace(input[i])) i++;
    if (i >= n || input[i] !== "=") {
      attributes.push({ name, value: "", quote: "" });
      continue;
    }
    i++;
    while (i < n && isTokenSpace(input[i])) i++;
    if (i >= n) {
      attributes.push({ name, value: "", quote: "" });
      break;
    }
    const q = input[i];
    if (q === '"' || q === "'") {
      const end = input.indexOf(q, i + 1);
      if (end === -1) {
        attributes.push({ name, value: input.slice(i + 1), quote: q });
        return { attributes, unterminatedQuote: true };
      }
      attributes.push({ name, value: input.slice(i + 1, end), quote: q });
      i = end + 1;
      continue;
    }
    let value = "";
    while (i < n && !isTokenSpace(input[i])) {
      value += input[i] === "\0" ? REPLACEMENT_CHARACTER : input[i];
      i++;
    }
    attributes.push({ name, value, quote: "" });
  }
  return { attributes, unterminatedQuote: false };
}

const ASCII_NAMED_REFS: Record<string, string> = {
  tab: "\t", newline: "\n", excl: "!", quot: '"', num: "#", dollar: "$", percnt: "%",
  amp: "&", apos: "'", lpar: "(", rpar: ")", ast: "*", midast: "*", plus: "+",
  comma: ",", period: ".", sol: "/", colon: ":", semi: ";", lt: "<", equals: "=",
  gt: ">", quest: "?", commat: "@", lsqb: "[", lbrack: "[", bsol: "\\", rsqb: "]",
  rbrack: "]", hat: "^", lowbar: "_", underbar: "_", grave: "`", diacriticalgrave: "`",
  lcub: "{", lbrace: "{", verbar: "|", vert: "|", verticalline: "|", rcub: "}",
  rbrace: "}", nbsp: NBSP, nonbreakingspace: NBSP, fjlig: "fj",
};

const C1_REPLACEMENTS: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

function codePointText(cp: number): string {
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return REPLACEMENT_CHARACTER;
  return String.fromCodePoint(C1_REPLACEMENTS[cp] ?? cp);
}

export function decodeCharacterReferences(value: string): string {
  return value.replace(
    /&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|([A-Za-z][A-Za-z0-9]*);?)/g,
    (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
      if (hex !== undefined) return codePointText(parseInt(hex.slice(0, 8), 16));
      if (dec !== undefined) return codePointText(parseInt(dec.slice(0, 9), 10));
      const lower = name!.toLowerCase();
      if (lower in ASCII_NAMED_REFS) return ASCII_NAMED_REFS[lower]!;
      for (const known of Object.keys(ASCII_NAMED_REFS)) {
        if (lower.startsWith(known)) return ASCII_NAMED_REFS[known]! + name!.slice(known.length);
      }
      return whole;
    },
  );
}

function charClass(ranges: Array<number | [number, number]>): string {
  return ranges
    .map((r) => (Array.isArray(r) ? `${String.fromCharCode(r[0])}-${String.fromCharCode(r[1])}` : String.fromCharCode(r)))
    .join("");
}

const LEADING_UNICODE_SPACE = new RegExp(
  `^[${charClass([0x20, 0xa0, 0x1680, [0x2000, 0x200f], [0x2028, 0x202f], 0x205f, 0x3000, 0xfeff])}]+`,
);

const CSS_IGNORABLE = new RegExp(`[${charClass([[0x00, 0x20], 0x7f])}]`, "g");

export function isSafeUrl(rawValue: string, allowDataImage: boolean): boolean {
  const url = decodeCharacterReferences(rawValue)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(LEADING_UNICODE_SPACE, "")
    .toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(url);
  if (scheme !== null) {
    if (ALLOWED_URL_SCHEMES.has(scheme[1])) return true;
    return allowDataImage && DATA_IMAGE_RE.test(url);
  }
  const colon = url.indexOf(":");
  if (colon === -1) return true;
  const head = url.slice(0, colon);
  return /[/?#]/.test(head) || !head.includes("&");
}

export function isSafeStyle(rawValue: string): boolean {
  let css = decodeCharacterReferences(rawValue);
  css = css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "");
  css = css.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([\s\S])/g, (_m, hex: string | undefined, ch: string | undefined) =>
    hex !== undefined ? codePointText(parseInt(hex, 16)) : ch === "\n" ? "" : ch!,
  );
  const flat = css.replace(CSS_IGNORABLE, "").toLowerCase();
  if (/expression\(|javascript:|vbscript:|livescript:|-moz-binding|behavior:|@import|<\/?style|<!--/.test(flat)) {
    return false;
  }
  for (const m of flat.matchAll(/url\(([^)]*)\)?/g)) {
    const target = m[1]!.replace(/^["']|["']$/g, "");
    if (!isSafeUrl(target, true)) return false;
  }
  return true;
}

function attributeValueSafe(name: string, rawValue: string, tag: string): boolean {
  if (URL_ATTRIBUTES.has(name)) return isSafeUrl(rawValue, tag === "img" && name === "src");
  if (STYLE_ATTRIBUTES.has(name)) return isSafeStyle(rawValue);
  return true;
}

function escapeAttributeValue(value: string, quote: '"' | "'"): string {
  return quote === '"' ? value.replace(/"/g, "&quot;") : value.replace(/'/g, "&#39;");
}

interface KeptAttribute {
  name: string;
  value: string;
  quote: '"' | "'";
}

function keptAttributes(tag: string, rawAttr: string, okAttrs: readonly string[]): KeptAttribute[] {
  const parsed = parseAttributes(rawAttr).attributes;
  const kept: KeptAttribute[] = [];
  for (const okAttr of okAttrs) {
    const attr = parsed.find((a) => a.name === okAttr);
    if (attr === undefined) continue;
    let value = attr.value;
    if (okAttr === "class") value = filterClasses(value);
    if (blank(value)) continue;
    if (!attributeValueSafe(okAttr, value, tag)) continue;
    const quote: '"' | "'" = attr.quote === "'" ? "'" : '"';
    kept.push({ name: okAttr, value: escapeAttributeValue(value, quote), quote });
  }
  return kept;
}

function rubyAgrees(rubyAttrText: string, kept: readonly KeptAttribute[]): boolean {
  const parsed = parseAttributes(rubyAttrText);
  if (parsed.unterminatedQuote || parsed.attributes.length !== kept.length) return false;
  return parsed.attributes.every((a, i) => a.name === kept[i]!.name && a.value === kept[i]!.value);
}

function cleanTag(slash: string, name: string, attrs: string): string | null {
  const tag = name.toLowerCase();
  const okAttrs = ALLOWED_TAGS.get(tag);
  if (okAttrs === undefined) return null;
  const kept = keptAttributes(tag, attrs, okAttrs);
  const ruby = rubyHtmlAttribs(tag, attrs, okAttrs);
  if (rubyAgrees(ruby.slice(tag.length), kept)) return `<${slash}${ruby}>`;
  return `<${slash}${[tag, ...kept.map((a) => `${a.name}=${a.quote}${a.value}${a.quote}`)].join(" ")}>`;
}

interface Piece {
  kind: "text" | "tag";
  s: string;
}

export const TAG_RE = /<(\/*)(\w+)([^>]*)>/g;

function tagPieces(input: string): Piece[] {
  const pieces: Piece[] = [];
  let last = 0;
  for (const m of input.matchAll(TAG_RE)) {
    if (m.index > last) pieces.push({ kind: "text", s: input.slice(last, m.index) });
    const cleaned = cleanTag(m[1]!, m[2]!, m[3]!);
    pieces.push(cleaned === null ? { kind: "text", s: " " } : { kind: "tag", s: cleaned });
    last = m.index + m[0].length;
  }
  if (last < input.length) pieces.push({ kind: "text", s: input.slice(last) });
  return pieces;
}

function removeComments(pieces: Piece[]): Piece[] {
  const joined = pieces.map((p) => p.s).join("");
  const inText = new Uint8Array(joined.length);
  let offset = 0;
  for (const p of pieces) {
    if (p.kind === "text") inText.fill(1, offset, offset + p.s.length);
    offset += p.s.length;
  }
  const remove: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const start = joined.indexOf("<!--", from);
    if (start === -1) break;
    if (inText[start] !== 1) {
      from = start + 1;
      continue;
    }
    const end = joined.indexOf("-->", start + 4);
    if (end === -1) break;
    if (joined.slice(start, end).includes("\n")) {
      from = start + 1;
      continue;
    }
    remove.push([start, end + 3]);
    from = end + 3;
  }
  if (remove.length === 0) return mergeText(pieces);
  const out: Piece[] = [];
  offset = 0;
  let r = 0;
  for (const p of pieces) {
    const pStart = offset;
    const pEnd = offset + p.s.length;
    offset = pEnd;
    let kept = "";
    let cursor = pStart;
    while (r < remove.length && remove[r]![0] < pEnd) {
      const [rs, re] = remove[r]!;
      if (rs > cursor) kept += joined.slice(cursor, rs);
      cursor = Math.max(cursor, Math.min(re, pEnd));
      if (re <= pEnd) r++;
      else break;
    }
    if (cursor < pEnd) kept += joined.slice(cursor, pEnd);
    if (kept === "") continue;
    out.push({ kind: p.kind === "tag" && kept === p.s ? "tag" : "text", s: kept });
  }
  return mergeText(out);
}

function mergeText(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    const prev = out[out.length - 1];
    if (p.kind === "text" && prev !== undefined && prev.kind === "text") prev.s += p.s;
    else out.push({ ...p });
  }
  return out;
}

function strayLessThan(all: string, at: number, pieceEnd: number): boolean {
  const atEnd = pieceEnd === all.length;
  if (at + 1 >= pieceEnd) {
    return atEnd;
  }
  const next = all[at + 1]!;
  if (/[A-Za-z{]/.test(next)) return true;
  if (next === "/") {
    if (at + 2 >= pieceEnd) return atEnd;
    return /[A-Za-z]/.test(all[at + 2]!) || all.indexOf(">", at + 2) === -1;
  }
  if (next === "!") {
    if (all.startsWith("<!--", at)) {
      if (all.startsWith("<!-->", at) || all.startsWith("<!--->", at)) return false;
      return all.indexOf("-->", at + 4) === -1 && all.indexOf("--!>", at + 4) === -1;
    }
    return all.indexOf(">", at + 2) === -1;
  }
  if (next === "?") return all.indexOf(">", at + 2) === -1;
  return false;
}

function escapeStrayMarkup(pieces: Piece[]): string {
  const all = pieces.map((p) => p.s).join("");
  let out = "";
  let offset = 0;
  for (const p of pieces) {
    const start = offset;
    offset += p.s.length;
    if (p.kind === "tag" || !p.s.includes("<")) {
      out += p.s;
      continue;
    }
    let last = 0;
    for (let i = p.s.indexOf("<"); i !== -1; i = p.s.indexOf("<", i + 1)) {
      if (strayLessThan(all, start + i, offset)) {
        out += p.s.slice(last, i) + "&lt;";
        last = i + 1;
      }
    }
    out += p.s.slice(last);
  }
  return out;
}

export function cleanSpaces(input: string): string {
  return input.replace(/(?:^|\b) ((?:&nbsp;)+)/gm, "$1 ");
}

export function cleanContent(input: string): string {
  return cleanSpaces(escapeStrayMarkup(removeComments(tagPieces(input))));
}

export const NO_CLEAN_TYPE_CODENAMES: ReadonlySet<string> = new Set([
  "html",
  "layout_type",
  "email_template",
  "java_script",
  "coffee_script",
  "css",
  "scss",
  "bootswatch_skin",
]);

export const NO_CLEAN_RIGHT_CODENAMES: ReadonlySet<string> = new Set(["html_message"]);
