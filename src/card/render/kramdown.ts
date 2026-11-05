import { highlight, type HighlightLanguage } from "./code-highlighting/index.js";

interface KramdownState {
  usedIds: Map<string, number>;
  linkDefs: Map<string, { url: string; title: string | undefined; ial: Ial | undefined }>;
  alds: Map<string, Ial>;
  footnotes: Map<string, KBlock[]>;
  abbrevs: Map<string, string>;
  abbrevIals: Map<string, Ial | undefined>;
  footnoteIals: Map<string, Ial | undefined>;
  footnoteOrder: { name: string; repeats: number }[];
}

let _footnoteDefinitionRe: RegExp | undefined;
let _ialBlockStartRe: RegExp | undefined;
function footnoteDefinitionRe(): RegExp { return (_footnoteDefinitionRe ??= new RegExp(
  `^ {0,3}\\[\\^(\\w[\\w-]*)\\]:\\s*?(.*?\\n(?:[ \\t]*\\n?(?:\\t| {4})[ \\t]*\\S[^\\n]*\\n(?:(?!${IAL_BLOCK_SRC}|\\^\\s*?\\n|^ {0,3}${LAZY_HTML_STOP_SRC}|^ {0,3}${LAZY_HTML_START_SRC})^[ \\t]*\\S[^\\n]*\\n)*)*)`,
));
}
const LAZY_HTML_STOP_SRC =
  "<\\/(?:(?!(?:a|abbr|acronym|b|big|bdo|br|button|cite|code|del|dfn|em|i|img|input|ins|kbd|label|mark|option|q|rb|rbc|rp|rt|rtc|ruby|samp|select|small|span|strong|sub|sup|time|tt|u|var|script)\\b)(?:(?:\\p{L}|_)(?:[-\\p{L}\\p{N}._])*:)?(?:\\p{L}|_)(?:[-\\p{L}\\p{N}._])*)\\s*>";
const LAZY_HTML_START_SRC =
  "<(?!(?:(?:a|abbr|acronym|b|big|bdo|br|button|cite|code|del|dfn|em|i|img|input|ins|kbd|label|mark|option|q|rb|rbc|rp|rt|rtc|ruby|samp|select|small|span|strong|sub|sup|time|tt|u|var|script)\\b)(?:(?:\\p{L}|_)(?:[-\\p{L}\\p{N}._])*:)?(?:\\p{L}|_)(?:[-\\p{L}\\p{N}._])*)";
const IAL_BLOCK_SRC = "[{]:(?!:|/)((?:\\\\[}]|[^}])+)[}]\\s*?\\n";
function ialBlockStartRe(): RegExp { return (_ialBlockStartRe ??= new RegExp(`^ {0,3}${IAL_BLOCK_SRC}`)); }
const HTML_NAME_SRC =
  "(?:(?:\\p{L}|_)(?:[-\\p{L}\\p{N}._])*:)?(?:\\p{L}|_)(?:[-\\p{L}\\p{N}._])*";
const LAZY_HTML_SKIP =
  "a|abbr|acronym|b|big|bdo|br|button|cite|code|d" + "el|dfn|em|i|img|input|ins|kbd|label|mark|option|q|rb|rbc|rp|rt|rtc|ruby|samp|select|small|span|strong|sub|sup|time|tt|u|var|script";

function normalizeSource(source: string): string {
  let src = source.replace(/\r\n?/g, "\n");
  if (!src.endsWith("\n")) src += "\n";
  return src;
}

type KBlock =
  | { kind: "blank" }
  | { kind: "p"; text: string; transparent: boolean; ial?: Ial }
  | { kind: "header"; level: number; idAttr: string; text: string; ial?: Ial }
  | { kind: "hr"; ial?: Ial }
  | {
      kind: "codeblock";
      lang: string | undefined;
      langClass: string | undefined;
      content: string;
      ial?: Ial;
    }
  | { kind: "blockquote"; children: KBlock[]; ial?: Ial }
  | {
      kind: "list";
      ordered: boolean;
      items: { blocks: KBlock[]; transparent: boolean }[];
      ial?: Ial;
    }
  | { kind: "eob"; value: EobValue | undefined; ial?: Ial }
  | { kind: "dl"; items: DlEntry[]; ial?: Ial }
  | { kind: "table"; alignment: TableAlign[]; sections: TableSection[]; ial?: Ial }
  | {
      kind: "htmlBlock";
      tag: string;
      attrs: [string, string][];
      content: { raw: HtmlRawNode[] } | { blocks: KBlock[] };
      isClosed: boolean;
      ial?: Ial;
    }
  | { kind: "mathBlock"; text: string; ial?: Ial }
  | { kind: "xmlComment"; value: string }
  | { kind: "raw"; value: string };

type EobValue = "ald" | "ial" | "extension" | "link_def" | "abbrev_def" | "footnote_def";

type DlEntry =
  | { type: "dt"; text: string; ial?: Ial }
  | { type: "dd"; blocks: KBlock[]; transparent: boolean };

type TableAlign = "default" | "left" | "right" | "center";

type TableSection = { type: "thead" | "tbody" | "tfoot"; rows: string[][] };

type HtmlRawNode =
  | { text: string }
  | { comment: string }
  | { el: { tag: string; attrs: [string, string][]; children: HtmlRawNode[]; isClosed: boolean } };

export interface Ial {
  attrs: [string, string][];
  refs: string[];
}

export function kramdownToHtml(source: string, shared?: KramdownState, indent = 0): string {
  const state: KramdownState = shared ?? makeKramdownState();
  const blocks = parseBlocksInto(normalizeSource(source), state);
  return convertBlocks(blocks, state, indent) + footnoteContentHtml(state);
}

function makeKramdownState(): KramdownState {
  return {
    usedIds: new Map(),
    linkDefs: new Map(),
    alds: new Map(),
    footnotes: new Map(),
    abbrevs: new Map(),
    abbrevIals: new Map(),
    footnoteIals: new Map(),
    footnoteOrder: [],
  };
}

function convertBlocks(blocks: readonly KBlock[], state: KramdownState, indent: number): string {
  const pad = " ".repeat(indent);
  let out = "";
  for (const block of blocks) {
    if (block.kind === "blank") {
      out += "\n";
    } else if (block.kind === "eob") {
    } else if (block.kind === "p") {
      const attrs = ialAppliedAttrs(block, state);
      const inner = parseSpans(block.text, new Set(), state).html;
      out += block.transparent
        ? inner
        : `${pad}<p${htmlAttributes(attrs)}>${inner}</p>\n`;
    } else if (block.kind === "header") {
      const attrs: [string, string][] = [["id", block.idAttr], ...ialAppliedAttrs(block, state)];
      out += `${pad}<h${block.level}${htmlAttributes(attrs)}>${parseSpans(block.text, new Set(), state).html}</h${block.level}>\n`;
    } else if (block.kind === "hr") {
      out += `${pad}<hr${htmlAttributes(ialAppliedAttrs(block, state))} />\n`;
    } else if (block.kind === "codeblock") {
      out += codeBlockHtml(block.content, block.lang, block.langClass, indent, ialAppliedAttrs(block, state));
    } else if (block.kind === "blockquote") {
      out += `${pad}<blockquote${htmlAttributes(ialAppliedAttrs(block, state))}>\n${convertBlocks(block.children, state, indent + 2)}${pad}</blockquote>\n`;
    } else if (block.kind === "list") {
      const itemPad = " ".repeat(indent + 2);
      const listTag = block.ordered ? "ol" : "ul";
      out += `${pad}<${listTag}${htmlAttributes(ialAppliedAttrs(block, state))}>\n`;
      for (const item of block.items) {
        const first = item.blocks[0];
        if (item.transparent === true && first !== undefined && first.kind === "p") {
          const inner =
            parseSpans(first.text, new Set(), state).html +
            convertBlocks(item.blocks.slice(1), state, indent + 4);
          out += `${itemPad}<li>${inner}${/\n$/.test(inner) ? itemPad : ""}</li>\n`;
        } else {
          out += `${itemPad}<li>\n${convertBlocks(item.blocks, state, indent + 4)}${itemPad}</li>\n`;
        }
      }
      out += `${pad}</${listTag}>\n`;
    } else if (block.kind === "dl") {
      out += `${pad}<dl${htmlAttributes(ialAppliedAttrs(block, state))}>\n`;
      for (const entry of block.items) {
        if (entry.type === "dt") {
          const attrs = ialAppliedAttrs(entry, state);
          out += `${" ".repeat(indent + 2)}<dt${htmlAttributes(attrs)}>${parseSpans(entry.text, new Set(), state).html}</dt>\n`;
        } else {
          const first = entry.blocks[0];
          const ddPad = " ".repeat(indent + 2);
          if (entry.transparent === true && first !== undefined && first.kind === "p") {
            const inner =
              parseSpans(first.text, new Set(), state).html +
              convertBlocks(entry.blocks.slice(1), state, indent + 4);
            out += `${ddPad}<dd>${inner}${/\n$/.test(inner) ? ddPad : ""}</dd>\n`;
          } else {
            out += `${ddPad}<dd>\n${convertBlocks(entry.blocks, state, indent + 4)}${ddPad}</dd>\n`;
          }
        }
      }
      out += `${pad}</dl>\n`;
    } else if (block.kind === "table") {
      out += convertTableHtml(block, state, indent);
    } else if (block.kind === "htmlBlock") {
      out += convertHtmlBlockHtml(block, state, indent);
    } else if (block.kind === "mathBlock") {
      const attrs = ialAppliedAttrs(block, state);
      if (attrs.length === 0) {
        out += `\\[${block.text}\\]\n`;
      } else {
        const withClass: [string, string][] = attrs.map(([n, v]) =>
          n === "class" ? [n, `${v} kdmath`] : [n, v],
        );
        if (!withClass.some(([n]) => n === "class")) withClass.push(["class", "kdmath"]);
        out += `${pad}<div${htmlAttributes(withClass)}>\\[${block.text}\\]\n${pad}</div>\n`;
      }
    } else if (block.kind === "xmlComment") {
      out += `${pad}${block.value}\n`;
    } else if (block.kind === "raw") {
      out += `${block.value}\n`;
    }
  }
  return out;
}

function ialAppliedAttrs(
  block: { ial?: Ial; attrs?: [string, string][] },
  state: KramdownState,
): [string, string][] {
  if (block.ial === undefined) return block.attrs ?? [];
  const attrList: [string, string][] = [...(block.attrs ?? [])];
  applyIal(attrList, block.ial, state);
  return attrList;
}

function applyIal(attrList: [string, string][], ial: Ial, state: KramdownState): void {
  for (const ref of ial.refs) {
    const ald = state.alds.get(ref);
    if (ald !== undefined) applyIal(attrList, ald, state);
  }
  for (const [k, v] of ial.attrs) {
    if (k === "class") {
      const existing = attrList.find(([name]) => name === "class");
      if (existing !== undefined) existing[1] = `${existing[1]} ${v}`.replace(/^ +/, "");
      else attrList.push(["class", v]);
    } else {
      const existing = attrList.find(([name]) => name === k);
      if (existing !== undefined) existing[1] = v;
      else attrList.push([k, v]);
    }
  }
}

function htmlAttributes(attrs: readonly [string, string][]): string {
  let out = "";
  for (const [name, value] of attrs) {
    out += ` ${name}="${escapeAttribute(value)}"`;
  }
  return out;
}

interface BlockCtx {
  src: string;
  pos: number;
  tree: KBlock[];
  state: KramdownState;
  blockIal: Ial | undefined;
  stopCloseTag: string | undefined;
  stopped: boolean;
}

function parseBlocksInto(src: string, state: KramdownState): KBlock[] {
  const ctx: BlockCtx = { src, pos: 0, tree: [], state, blockIal: undefined, stopCloseTag: undefined, stopped: false };
  while (ctx.pos < src.length) {
    const rest = src.slice(ctx.pos);
    if (parseBlankLine(ctx, rest)) continue;
    if (parseIndentedCodeBlock(ctx, rest)) continue;
    if (parseFencedCodeBlock(ctx, rest)) continue;
    if (parseBlockquote(ctx, rest)) continue;
    if (parseAtxHeader(ctx, rest)) continue;
    if (parseHorizontalRule(ctx, rest)) continue;
    if (parseListBlock(ctx, rest)) continue;
    if (parseDefinitionList(ctx, rest)) continue;
    if (parseBlockHtml(ctx, rest)) continue;
    if (parseSetextHeader(ctx, rest)) continue;
    if (parseBlockMath(ctx, rest)) continue;
    if (parseTable(ctx, rest)) continue;
    if (parseFootnoteDefinition(ctx, rest)) continue;
    if (parseLinkDefinition(ctx, rest)) continue;
    if (parseAbbrevDefinition(ctx, rest)) continue;
    if (parseBlockExtensions(ctx, rest)) continue;
    if (parseEobMarker(ctx, rest)) continue;
    const para = parseParagraphInto(ctx.tree, src, ctx.pos);
    ctx.pos = para.nextPos;
  }
  return ctx.tree;
}

function takeBlockEl(ctx: BlockCtx, el: KBlock): KBlock {
  if (ctx.blockIal !== undefined) {
    (el as { ial?: Ial }).ial = ctx.blockIal;
    ctx.blockIal = undefined;
  }
  return el;
}

function afterBlockBoundary(ctx: BlockCtx): boolean {
  const last = ctx.tree[ctx.tree.length - 1];
  return (
    last === undefined ||
    last.kind === "blank" ||
    (last.kind === "eob" && last.value === undefined) ||
    ctx.blockIal !== undefined
  );
}

function atBlockBoundary(rest: string): boolean {
  return (
    /^(?:[ \t]*\n)/.test(rest) ||
    /^\^\s*?\n/.test(rest) ||
    ialBlockStartRe().test(rest) ||
    rest === ""
  );
}

function parseBlankLine(ctx: BlockCtx, rest: string): boolean {
  const blank = /^(?:[ \t]*\n)+/.exec(rest);
  if (blank === null) return false;
  ctx.tree.push(takeBlockEl(ctx, { kind: "blank" }));
  ctx.pos += blank[0].length;
  return true;
}

function parseIndentedCodeBlock(ctx: BlockCtx, rest: string): boolean {
  if (!/^(?:\t| {4})/.test(rest)) return false;
  const codeblock = parseIndentedCode(rest);
  if (codeblock === null) return false;
  ctx.tree.push(takeBlockEl(ctx, codeblock.block));
  ctx.pos += codeblock.length;
  return true;
}

function parseFencedCodeBlock(ctx: BlockCtx, rest: string): boolean {
  const fence = /^((~){3,})[ \t]*((\S+?)(?:\?\S*)?)?[ \t]*\n/.exec(rest);
  if (fence === null) return false;
  const closer = new RegExp(`^${fence[1]}~*[ \\t]*\\n`, "gm");
  closer.lastIndex = fence[0].length;
  const closeMatch = closer.exec(rest);
  if (closeMatch === null) return false;
  ctx.tree.push(
    takeBlockEl(ctx, {
      kind: "codeblock",
      lang: fence[3],
      langClass: fence[4],
      content: rest.slice(fence[0].length, closeMatch.index),
    }),
  );
  ctx.pos += closeMatch.index + closeMatch[0].length;
  return true;
}

function parseBlockquote(ctx: BlockCtx, rest: string): boolean {
  const bq = /^ {0,3}> ?/.exec(rest);
  if (bq === null) return false;
  let end = 0;
  for (;;) {
    const line = /^[^\n]*\n/.exec(rest.slice(end));
    if (line === null) break;
    if (/^[ \t]*\n/.test(line[0])) break;
    end += line[0].length;
  }
  const stripped = rest
    .slice(0, end)
    .split("\n")
    .map((quoteLine) => quoteLine.replace(/^ {0,3}> ?/, ""))
    .join("\n");
  ctx.tree.push(
    takeBlockEl(ctx, {
      kind: "blockquote",
      children: parseBlocksInto(stripped, ctx.state),
    }),
  );
  ctx.pos += end;
  return true;
}

function parseAtxHeader(ctx: BlockCtx, rest: string): boolean {
  const atx = /^(#{1,6})[ \t]*([^ \t][^\n]*)\n/.exec(rest);
  if (atx === null || !afterBlockBoundary(ctx)) return false;
  const parsed = parseAtxContents(atx[2]);
  if (parsed === undefined) return false;
  ctx.tree.push(
    takeBlockEl(ctx, {
      kind: "header",
      level: atx[1].length,
      idAttr: parsed.id ?? generateId(parsed.text, ctx.state),
      text: parsed.text,
    }),
  );
  ctx.pos += atx[0].length;
  return true;
}

function parseHorizontalRule(ctx: BlockCtx, rest: string): boolean {
  const hr = /^ {0,3}([*_-])[ \t]*\1[ \t]*\1(?:\1|[ \t])*\n/.exec(rest);
  if (hr === null) return false;
  ctx.tree.push(takeBlockEl(ctx, { kind: "hr" }));
  ctx.pos += hr[0].length;
  return true;
}

function parseListBlock(ctx: BlockCtx, rest: string): boolean {
  const list = parseList(rest, ctx.state);
  if (list === null) return false;
  ctx.tree.push(takeBlockEl(ctx, list.block));
  if (list.trailingBlank) ctx.tree.push({ kind: "blank" });
  ctx.pos += list.length;
  return true;
}

function parseSetextHeader(ctx: BlockCtx, rest: string): boolean {
  const setext = /^ {0,3}([^ \t][^\n]*)\n([=-])[-=]*[ \t\r\f\v]*\n/.exec(rest);
  if (setext === null || !afterBlockBoundary(ctx)) return false;
  const parsed = parseHeaderContents(setext[1]);
  if (parsed.text === "") return false;
  ctx.tree.push(
    takeBlockEl(ctx, {
      kind: "header",
      level: setext[2] === "-" ? 2 : 1,
      idAttr: parsed.id ?? generateId(parsed.text, ctx.state),
      text: parsed.text,
    }),
  );
  ctx.pos += setext[0].length;
  return true;
}

function parseEobMarker(ctx: BlockCtx, rest: string): boolean {
  const eob = /^\^\s*?\n/.exec(rest);
  if (eob === null) return false;
  ctx.tree.push(takeBlockEl(ctx, { kind: "eob", value: undefined }));
  ctx.pos += eob[0].length;
  return true;
}

function parseAbbrevDefinition(ctx: BlockCtx, rest: string): boolean {
  const m = /^ {0,3}\*\[(.+?)\]:(.*?)\n/.exec(rest);
  if (m === null) return false;
  const eob = takeBlockEl(ctx, { kind: "eob", value: "abbrev_def" });
  ctx.tree.push(eob);
  ctx.state.abbrevs.set(m[1], m[2].trim());
  ctx.state.abbrevIals.set(m[1], (eob as { ial?: Ial }).ial);
  ctx.pos += m[0].length;
  return true;
}

function parseLinkDefinition(ctx: BlockCtx, rest: string): boolean {
  const m = LINK_DEFINITION_RE.exec(rest);
  if (m === null) return false;
  if ((m[3] ?? "").match(/[ \t]+["']/) !== null) return false;
  const eob = takeBlockEl(ctx, { kind: "eob", value: "link_def" });
  ctx.tree.push(eob);
  ctx.state.linkDefs.set(normalizeLinkId(m[1]), {
    url: m[2] ?? m[3],
    title: m[5],
    ial: (eob as { ial?: Ial }).ial,
  });
  ctx.pos += m[0].length;
  return true;
}

const LINK_DEFINITION_RE =
  /^ {0,3}\[([^\n\]]+)\]:[ \t]*(?:<(.*?)>|([^\n]*?\S[^\n]*?))(?:(?:[ \t]*?\n|[ \t]+?)[ \t]*?(["'])([\s\S]*?)\4)?[ \t]*?\n/;

function normalizeLinkId(id: string): string {
  return id.replace(/\s+/g, " ").toLowerCase();
}

function parseFootnoteDefinition(ctx: BlockCtx, rest: string): boolean {
  const m = footnoteDefinitionRe().exec(rest);
  if (m === null) return false;
  const eob = takeBlockEl(ctx, { kind: "eob", value: "footnote_def" });
  ctx.tree.push(eob);
  const content = m[2].replace(/^(?:\t| {4})/gm, "");
  ctx.state.footnotes.set(m[1], parseBlocksInto(content, ctx.state));
  ctx.state.footnoteIals.set(m[1], (eob as { ial?: Ial }).ial);
  ctx.pos += m[0].length;
  return true;
}

function parseBlockMath(ctx: BlockCtx, rest: string): boolean {
  const m = /^ {0,3}(\\)?\$\$([\s\S]*?)\$\$(\s*?\n)?/.exec(rest);
  if (m === null || !afterBlockBoundary(ctx)) return false;
  if (m[1] !== undefined) {
    if (m[3] !== undefined) ctx.pos += /^ {0,3}\\/.exec(rest.slice(ctx.pos))![0].length;
    return false;
  }
  if (!atBlockBoundary(rest.slice(m[0].length))) return false;
  ctx.tree.push(takeBlockEl(ctx, { kind: "mathBlock", text: m[2].trim() }));
  ctx.pos += m[0].length;
  return true;
}

function parseIndentedCode(rest: string): { block: KBlock; length: number } | null {
  const indentLine = /^(?:\t| {4})[ \t]*\S[^\n]*\n/;
  const lazyLine = /^[ \t]*\S[^\n]*\n/;
  let raw = "";
  let consumed = 0;
  let iterations = 0;
  for (;;) {
    if (iterations > 0) {
      const blanks = /^(?:[ \t]*\n)+/.exec(rest.slice(consumed));
      if (blanks === null) break;
      if (!indentLine.test(rest.slice(consumed + blanks[0].length))) break;
      raw += blanks[0];
      consumed += blanks[0].length;
    }
    let indented = 0;
    for (;;) {
      const line = indentLine.exec(rest.slice(consumed));
      if (line === null) break;
      raw += line[0];
      consumed += line[0].length;
      indented += 1;
    }
    if (indented === 0) {
      if (iterations === 0) return null;
      break;
    }
    for (;;) {
      const line = lazyLine.exec(rest.slice(consumed));
      if (line === null) break;
      raw += line[0];
      consumed += line[0].length;
    }
    iterations += 1;
  }
  const content = raw
    .replace(/\n(?: {0,3}\S)/g, (m) => ` ${m.slice(1)}`)
    .replace(/^(?:\t| {4})/gm, "");
  return {
    block: { kind: "codeblock", lang: undefined, langClass: undefined, content },
    length: consumed,
  };
}

function codeBlockHtml(
  content: string,
  lang: string | undefined,
  langClass: string | undefined,
  indent: number,
  attrs: readonly [string, string][] = [],
): string {
  const pad = " ".repeat(indent);
  if (lang !== undefined && lang.includes("?")) {
    const cls = langClass ?? "";
    const chomped = escapeHtmlAll(content).replace(/\n$/, "");
    return `${pad}<pre><code${
      cls === "" ? "" : ` class="language-${cls}"`
    }>${chomped}\n</code></pre>\n`;
  }
  const language = langClass ?? "ruby";
  const coderayLang = coderayLanguageFor(langClass ?? lang ?? "ruby");
  const ialClass = attrs.find(([n]) => n === "class");
  const highlighted =
    coderayLang !== undefined
      ? highlight(content, coderayLang)
      : `<div class="CodeRay">\n  <div class="code"><pre>${escapeHtmlCoderay(content)}</pre></div>\n</div>\n`;
  return (
    `${pad}<div class="language-${language} highlighter-coderay${
      ialClass !== undefined ? ` ${ialClass[1]}` : ""
    }">` +
    highlighted +
    `${pad}</div>\n`
  );
}

function coderayLanguageFor(lang: string): HighlightLanguage | undefined {
  const normalized = lang.replace(/-/g, "_");
  if (normalized === "ruby" || normalized === "rb") return "ruby";
  if (normalized === "js" || normalized === "javascript" || normalized === "java_script") {
    return "java_script";
  }
  return undefined;
}

function parseHeaderContents(
  rawContents: string,
): { text: string; id: string | undefined } {
  let text = rawContents.replace(/\s+$/, "");
  const idMatch = /[ \t]\{#([^\s{}]+)\}$/.exec(text);
  let id: string | undefined;
  if (idMatch !== null) {
    id = idMatch[1];
    text = text.slice(0, text.length - idMatch[0].length).replace(/\s+$/, "");
  }
  return { text, id };
}

function parseAtxContents(
  rawContents: string,
): { text: string; id: string | undefined } | undefined {
  const parsed = parseHeaderContents(rawContents);
  let { text } = parsed;
  const stripped = text.replace(/(?<!\\)#+$/, "");
  if (stripped !== text) text = stripped.replace(/\s+$/, "");
  if (text === "") return undefined;
  return { text, id: parsed.id };
}

function generateId(rawText: string, state: KramdownState): string {
  let gen = rawText.replace(/^[^a-zA-Z]+/, "");
  gen = gen.replace(/[^a-zA-Z0-9 -]/g, "");
  gen = gen.replace(/ /g, "-").toLowerCase();
  if (gen === "") gen = "section";
  if (state.usedIds.has(gen)) {
    const next = (state.usedIds.get(gen) ?? 0) + 1;
    state.usedIds.set(gen, next);
    gen += `-${next}`;
  } else {
    state.usedIds.set(gen, 0);
  }
  return gen;
}

function parseList(
  rest: string,
  state: KramdownState,
): { block: KBlock; length: number; trailingBlank: boolean } | null {
  const firstMarker =
    /^( {0,3})([-+*])([\t ]+)([^\n]*)\n/.exec(rest) ??
    /^( {0,3})(\d+[.])([\t ]+)([^\n]*)\n/.exec(rest);
  if (firstMarker === null) return null;
  const ordered = firstMarker[2].includes(".");
  const items: { groups: string[][] }[] = [];
  let pos = 0;
  let contentIndent =
    firstMarker[1].length + firstMarker[2].length + firstMarker[3].length;
  let markerRe = listMarkerRe(ordered, contentIndent);
  let nestedListFound = listStartRe.test(firstMarker[4]!.replace(/^[ \t]+/, ""));
  items.push({ groups: [[firstMarker[4]!]] });
  pos += firstMarker[0].length;
  let lastIsBlank = false;

  for (;;) {
    const at = rest.slice(pos);
    if (
      lastIsBlank &&
      /^ {0,3}([*_-])[ \t]*\1[ \t]*\1(?:\1|[ \t])*\n/.test(at)
    ) {
      break;
    }
    const marker = markerRe.exec(at);
    if (marker !== null) {
      items.push({ groups: [[marker[4]!]] });
      contentIndent = marker[1].length + marker[2].length + marker[3].length;
      markerRe = listMarkerRe(ordered, contentIndent);
      nestedListFound = listStartRe.test(marker[4]!.replace(/^[ \t]+/, ""));
      lastIsBlank = false;
      pos += marker[0].length;
      continue;
    }
    const line = /^[^\n]*\n/.exec(at);
    if (line === null) break;
    if (/^[ \t]*\n/.test(line[0])) {
      const current = items[items.length - 1];
      if (current === undefined) break;
      const run = /^(?:[ \t]*\n)+/.exec(at)![0];
      const lines = run.replace(/\n$/, "").split("\n");
      current.groups[current.groups.length - 1]!.push(...lines);
      pos += run.length;
      lastIsBlank = true;
      continue;
    }
    const current = items[items.length - 1];
    if (current === undefined) break;
    const tabsExpanded = line[0]
      .replace(/\n$/, "")
      .replace(/^(\t+)/, (tabs) => " ".repeat(4 * tabs.length));
    const indentationFound = new RegExp(`^ {${contentIndent}}`).test(tabsExpanded);
    const stripped = indentationFound ? tabsExpanded.slice(contentIndent) : tabsExpanded;
    const lastGroup = current.groups[current.groups.length - 1];
    if (lastGroup === undefined) break;
    if (indentationFound) {
      if (!nestedListFound && listStartRe.test(stripped)) {
        current.groups.push([stripped]);
        nestedListFound = true;
      } else {
        lastGroup.push(stripped);
      }
      lastIsBlank = false;
      pos += line[0].length;
      continue;
    }
    if (!lastIsBlank) {
      let text = tabsExpanded;
      if (nestedListFound && listStartRe.test(stripped)) {
        text = " ".repeat(contentIndent + 4) + stripped;
      }
      lastGroup.push(text);
      lastIsBlank = false;
      pos += line[0].length;
      continue;
    }
    break;
  }

  const itemBlocks: KBlock[][] = items.map((item) => {
    const blocks: KBlock[] = [];
    for (const group of item.groups) {
      blocks.push(...parseBlocksInto(group.map((l) => `${l}\n`).join(""), state));
    }
    return blocks;
  });
  const transparents: boolean[] = [];
  let trailingBlankAfterList = false;
  for (let i = 0; i < itemBlocks.length; i++) {
    const blocks = itemBlocks[i]!;
    if (blocks.length === 0) {
      transparents[i] = false;
      continue;
    }
    const first = blocks[0]!;
    let transparent = false;
    if (
      first.kind === "p" &&
      (blocks.length < 2 ||
        blocks[1]!.kind !== "blank" ||
        (i === items.length - 1 && blocks.length === 2)) &&
      (i !== items.length - 1 ||
        items.length === 1 ||
        itemBlocks
          .slice(0, -1)
          .some(
            (earlier) =>
              earlier[0] === undefined ||
              earlier[0].kind !== "p" ||
              earlier[0].transparent === true,
          ))
    ) {
      transparent = true;
      if (blocks.length > 1 && blocks[1]!.kind !== "blank") {
        first.text += "\n";
      }
      first.transparent = true;
    }
    transparents[i] = transparent;
    const lastBlock = blocks[blocks.length - 1]!;
    if (lastBlock.kind === "blank") {
      blocks.pop();
      if (i === items.length - 1) trailingBlankAfterList = true;
    }
  }

  return {
    block: {
      kind: "list",
      ordered,
      items: itemBlocks.map((blocks, i) => ({ blocks, transparent: transparents[i] === true })),
    },
    length: pos,
    trailingBlank: trailingBlankAfterList,
  };
}

function listMarkerRe(ordered: boolean, indentation: number): RegExp {
  const lead = Math.min(indentation, 4) - 1;
  return new RegExp(
    `^( {0,${lead}})(${ordered ? "\\d+[.]" : "[-+*]"})([\\t ]+)([^\\n]*)\\n`,
  );
}

const listStartRe = /^(?: {0,3}[-+*]| {0,3}\d+[.])[\t ]/;

function parseParagraphInto(blocks: KBlock[], src: string, startPos: number): { nextPos: number } {
  const lines: string[] = [];
  let pos = startPos;
  for (;;) {
    const at = src.slice(pos);
    if (/^[ \t]*\n/.test(at)) break;
    if (/^ {0,3}\{:(?!:|\/)((?:\\[}]|[^}])+)[}]\s*?\n/.test(at)) break;
    if (/^\^\s*?\n/.test(at)) break;
    if (new RegExp(`^ {0,3}</(?!(?:${LAZY_HTML_SKIP})\b)(?:${HTML_NAME_SRC})[ \t]*>`, "u").test(at)) break;
    if (new RegExp(`^ {0,3}<(?!(?:${LAZY_HTML_SKIP})\b)(?:${HTML_NAME_SRC})`, "u").test(at)) break;
    if (/^ {0,3}:[\t| ][^\n]*\n/.test(at)) break;
    const line = /^[^\n]*\n/.exec(at);
    if (line === null) break;
    lines.push(line[0].replace(/\n$/, ""));
    pos += line[0].length;
  }
  const text = lines.join("\n").replace(/\s+$/, "");
  const last = blocks[blocks.length - 1];
  if (last !== undefined && last.kind === "p") {
    const before = src.slice(Math.max(0, startPos - 3), startPos);
    last.text = `${last.text}${before === "  \n" ? "  \n" : "\n"}${text}`;
  } else {
    blocks.push({ kind: "p", text: text.replace(/^\s+/, ""), transparent: false });
  }
  return { nextPos: pos };
}

type SpanSeg =
  | { t: "s"; s: string }
  | { t: "el"; tag: string; attrs: [string, string][]; children: SpanSeg[] };

function parseSpans(
  text: string,
  ancestors: ReadonlySet<string>,
  state: KramdownState,
  opts?: {
    begin?: number;
    stop?: { ch: string; run: number; elem: "em" | "strong"; from: number };
  },
): { html: string; stoppedAt: number; segs: SpanSeg[]; lastElSeg: SpanSeg | undefined } {
  const stop = opts?.stop;
  const segs: SpanSeg[] = [];
  let lastElSeg: SpanSeg | undefined = undefined;
  let rawRun = "";

  const flushText = (): void => {
    if (rawRun === "") return;
    if (state.abbrevs.size > 0) {
      segs.push({ t: "s", s: replaceAbbreviations(rawRun, state) });
    } else {
      segs.push({ t: "s", s: escapeHtmlText(rawRun) });
    }
    rawRun = "";
    lastElSeg = undefined;
  };

  let i = opts?.begin ?? 0;
  while (i < text.length) {
    if (
      stop !== undefined &&
      i > stop.from &&
      text.startsWith(stop.ch.repeat(stop.run), i) &&
      stopValid(text, i, stop)
    ) {
      flushText();
      return { html: serializeSegs(segs), stoppedAt: i, segs, lastElSeg };
    }
    const ch = text[i];
    if (ch === "*" || ch === "_") {
      const parsed = parseEmphasisSeg(text, i, ancestors, state);
      if (parsed !== null) {
        flushText();
        segs.push(parsed.seg);
        lastElSeg = parsed.seg;
        i = parsed.next;
        continue;
      }
    }
    if (ch === "`") {
      const parsed = parseCodespan(text, i);
      flushText();
      segs.push({ t: "s", s: parsed.html });
      i = parsed.next;
      continue;
    }
    if (ch === "<") {
      const auto = parseAutolink(text, i);
      if (auto !== null) {
        flushText();
        segs.push({ t: "s", s: auto.html });
        i = auto.next;
        continue;
      }
      const html = parseSpanHtml(text, i, state);
      if (html !== null) {
        flushText();
        if (html.kind === "text") {
          segs.push({ t: "s", s: html.html });
        } else {
          segs.push(html.seg);
          lastElSeg = html.seg;
        }
        i = html.next;
        continue;
      }
    }
    if (ch === "[") {
      const fn = parseFootnoteMarker(text, i, state);
      if (fn !== null) {
        flushText();
        segs.push({ t: "s", s: fn.html });
        i = fn.next;
        continue;
      }
    }
    if (ch === "[" || (ch === "!" && text[i + 1] === "[")) {
      const link = parseLinkOrImageSeg(text, i, ancestors, state);
      if (link !== null) {
        flushText();
        segs.push(...link.segs);
        lastElSeg = link.lastElSeg ?? lastElSeg;
        i = link.next;
        continue;
      }
    }
    if (ch === "'" || ch === '"' || isQuoteAhead(text, i)) {
      const sq = parseSmartQuote(text, i);
      if (sq !== null) {
        flushText();
        segs.push({ t: "s", s: sq.html });
        i = sq.next;
        continue;
      }
    }
    if (ch === "$" && text[i + 1] === "$") {
      const close = text.indexOf("$$", i + 2);
      if (close !== -1) {
        flushText();
        segs.push({ t: "s", s: `\\(${text.slice(i + 2, close).trim()}\\)` });
        i = close + 2;
        continue;
      }
    }
    if (ch === "{") {
      const ext = parseSpanExtension(text, i, state, lastElSeg);
      if (ext !== null) {
        flushText();
        if (ext.html !== undefined) {
          segs.push({ t: "s", s: ext.html });
          lastElSeg = undefined;
        }
        i = ext.next;
        continue;
      }
    }
    if (ch === "&") {
      const entity = parseHtmlEntity(text, i);
      if (entity !== null) {
        flushText();
        segs.push({ t: "s", s: entity.html });
        i = entity.next;
        continue;
      }
    }
    const typo = parseTypographic(text, i);
    if (typo !== null) {
      flushText();
      segs.push({ t: "s", s: typo.html });
      i = typo.next;
      continue;
    }
    const br = /^(?:  |\\\\)\n/.exec(text.slice(i));
    if (br !== null) {
      flushText();
      segs.push({ t: "s", s: "<br />\n" });
      i += br[0].length;
      continue;
    }
    const esc = parseEscapedChar(text, i);
    if (esc !== null) {
      flushText();
      segs.push({ t: "s", s: esc.html });
      i = esc.next;
      continue;
    }
    rawRun += ch;
    i += 1;
  }
  flushText();
  return { html: serializeSegs(segs), stoppedAt: -1, segs, lastElSeg };
}

function serializeSegs(segs: readonly SpanSeg[]): string {
  let out = "";
  for (const seg of segs) {
    if (seg.t === "s") {
      out += seg.s;
    } else {
      out += `<${seg.tag}${htmlAttributes(seg.attrs)}>`;
      out += serializeSegs(seg.children);
      out += `</${seg.tag}>`;
    }
  }
  return out;
}

function parseEmphasisSeg(
  text: string,
  start: number,
  ancestors: ReadonlySet<string>,
  state: KramdownState,
): { seg: SpanSeg; next: number } | null {
  const ch = text[start];
  let run = 1;
  while (run < 2 && text[start + run] === ch) run += 1;
  const elem: "em" | "strong" = run === 2 ? "strong" : "em";
  const prev = start > 0 ? text[start - 1] : "";
  const nextCh = text[start + run];
  if (ch === "_" && /[a-zA-Z0-9_]/.test(prev)) return null;
  if (nextCh === undefined || /\s/.test(nextCh)) return null;
  if (ancestors.has(elem)) return null;
  const contentStart = start + run;
  const innerAncestors = new Set(ancestors);
  innerAncestors.add(elem);
  const walked = parseSpans(text, innerAncestors, state, {
    begin: contentStart,
    stop: { ch, run, elem, from: contentStart },
  });
  if (walked.stoppedAt >= 0) {
    return {
      seg: { t: "el", tag: elem, attrs: [], children: walked.segs },
      next: walked.stoppedAt + run,
    };
  }
  if (elem === "strong") {
    const retry = parseEmphasisSeg(text, start + 1, ancestors, state);
    if (retry !== null) {
      return {
        seg: {
          t: "el",
          tag: "em",
          attrs: [],
          children: [
            { t: "s", s: escapeHtmlText(text[start]) },
            ...(retry.seg.t === "el" ? retry.seg.children : []),
          ],
        },
        next: retry.next,
      };
    }
  }
  return null;
}

function isQuoteAhead(text: string, i: number): boolean {
  return text[i] !== "\\" && (text[i + 1] === "'" || text[i + 1] === '"');
}

function stopValid(
  text: string,
  i: number,
  stop: { ch: string; run: number; elem: "em" | "strong" },
): boolean {
  const prev = i > 0 ? text[i - 1] : "";
  if (/\s/.test(prev)) return false;
  if (stop.elem === "em") {
    const after = text.slice(i, i + 2);
    if (after === `${stop.ch}${stop.ch}` && text[i + 2] !== stop.ch) return false;
  }
  if (stop.ch === "_" && /[a-zA-Z0-9]/.test(text[i + stop.run] ?? "")) return false;
  return true;
}


function parseCodespan(text: string, start: number): { html: string; next: number } {
  let run = 0;
  while (text[start + run] === "`") run += 1;
  const simple = run === 1;
  const prevOk = start === 0 || /\s/.test(text[start - 1]);
  if (simple && prevOk && /\s/.test(text[start + 1] ?? " ")) {
    return { html: escapeHtmlText("`"), next: start + 1 };
  }
  const closeStart = text.indexOf("`".repeat(run), start + run);
  if (closeStart === -1) {
    return { html: escapeHtmlText("`".repeat(run)), next: start + run };
  }
  let content = text.slice(start + run, closeStart);
  if (!simple) {
    if (content.startsWith(" ")) content = content.slice(1);
    if (content.endsWith(" ")) content = content.slice(0, -1);
  }
  return { html: `<code>${escapeHtmlAll(content)}</code>`, next: closeStart + run };
}

function parseAutolink(text: string, start: number): { html: string; next: number } | null {
  const match = /^<(mailto|https?|ftps?):([^ \t<>]+)>/.exec(text.slice(start));
  if (match === null) return null;
  const scheme = match[1];
  const rest = match[2];
  if (scheme === "mailto") {
    return {
      html: `<a href="mailto:${escapeAttribute(rest)}">${escapeHtmlText(rest)}</a>`,
      next: start + match[0].length,
    };
  }
  const url = `${scheme}:${rest}`;
  return {
    html: `<a href="${escapeAttribute(url)}">${escapeHtmlText(url)}</a>`,
    next: start + match[0].length,
  };
}

function parseLinkOrImageSeg(
  text: string,
  start: number,
  ancestors: ReadonlySet<string>,
  state: KramdownState,
): { segs: SpanSeg[]; lastElSeg: SpanSeg | undefined; next: number } | null {
  const isImage = text[start] === "!";
  let i = start + (isImage ? 1 : 0);
  let depth = 1;
  let close = -1;
  for (i += 1; i < text.length && close === -1; i++) {
    if (text[i] === "[") depth += 1;
    else if (text[i] === "]") {
      depth -= 1;
      if (depth === 0) close = i;
    }
  }
  if (close === -1) return null;
  const innerText = text.slice(start + (isImage ? 2 : 1), close);
  const altText = innerText.replace(
    /\\([\\.*_+`<>(){}[\]#!:|"'$=-])/g,
    "$1",
  );
  const after = text.slice(close + 1);
  const refId = /^(\s*?)\[([^\]]+)?\]/.exec(after);
  if (refId !== null || after[0] !== "(") {
    if (isImage) return null;
    const linkId = normalizeLinkId(refId?.[2] ?? altText);
    const def = state.linkDefs.get(linkId);
    if (def === undefined) {
      return {
        segs: [
          { t: "s", s: "[" },
          ...parseSpans(innerText, ancestors, state).segs,
          { t: "s", s: "]" },
        ],
        lastElSeg: undefined,
        next: close + 1 + (refId?.[0].length ?? 0),
      };
    }
    const attrs: [string, string][] = [
      ["href", def.url],
      ...(def.title !== undefined ? ([["title", def.title]] as [string, string][]) : []),
    ];
    if (def.ial !== undefined) applyIal(attrs, def.ial, state);
    return {
      segs: [
        { t: "el", tag: "a", attrs, children: parseSpans(innerText, ancestors, state).segs },
      ],
      lastElSeg: undefined,
      next: close + 1 + (refId?.[0].length ?? 0),
    };
  }
  const target = /^[(]([^)]*)[)]/.exec(after);
  if (target === null) {
    if (isImage) return null;
    return {
      segs: [
        { t: "s", s: "[" },
        ...parseSpans(innerText, ancestors, state).segs,
        { t: "s", s: "]" },
      ],
      lastElSeg: undefined,
      next: close + 1,
    };
  }
  const targetInner = target[1];
  const angle = /^<([^>]*)>/.exec(targetInner);
  let url = angle !== null ? angle[1] : targetInner;
  let title: string | undefined;
  const titleMatch = /^(?:<[^>]*>|[^"\s]+)[ \t]+["']([^"']*)["'][ \t]*$/.exec(targetInner);
  if (titleMatch !== null) {
    url = angle !== null ? angle[1] : titleMatch[0].replace(/[ \t]+["'][^"']*["'][ \t]*$/, "");
    title = titleMatch[1];
  }
  if (isImage) {
    const attrs = ` src="${escapeAttribute(url)}" alt="${escapeAttribute(altText)}"${
      title === undefined ? "" : ` title="${escapeAttribute(title)}"`
    }`;
    return {
      segs: [{ t: "s", s: `<img${attrs} />` }],
      lastElSeg: undefined,
      next: close + 1 + target[0].length,
    };
  }
  const attrs: [string, string][] = [
    ["href", url],
    ...(title !== undefined ? ([["title", title]] as [string, string][]) : []),
  ];
  return {
    segs: [
      { t: "el", tag: "a", attrs, children: parseSpans(innerText, ancestors, state).segs },
    ],
    lastElSeg: undefined,
    next: close + 1 + target[0].length,
  };
}

const SQ_PUNCT = "[!\"#$%&'()*+,\\-./:;<=>?@\\[\\\\\\]^_`{|}~]";
const SQ_CLOSE = "[^ \\\\\t\r\n\\[{(-]";

type SqSubst =
  | { kind: "text"; group: number }
  | { kind: "quote"; char: string }
  | { kind: "context"; via: "lquote" | "rquote"; group: number };

const SQ_RULES: { re: RegExp; substs: SqSubst[] }[] = [
  { re: new RegExp(`("|')(?=[_*]{1,2}\\S)`, "y"), substs: [{ kind: "context", via: "lquote", group: 1 }] },
  { re: new RegExp(`("|')(?=${SQ_PUNCT}(?!\\.\\.)\\B)`, "y"), substs: [{ kind: "context", via: "rquote", group: 1 }] },
  { re: new RegExp(`(\\s)"'(?=\\w)`, "y"), substs: [{ kind: "text", group: 1 }, { kind: "quote", char: "\u201c" }, { kind: "quote", char: "\u2018" }] },
  { re: new RegExp(`(\\s)'"(?=\\w)`, "y"), substs: [{ kind: "text", group: 1 }, { kind: "quote", char: "\u2018" }, { kind: "quote", char: "\u201c" }] },
  { re: new RegExp(`(\\s)'(?=\\d\\ds)`, "y"), substs: [{ kind: "text", group: 1 }, { kind: "quote", char: "\u2019" }] },
  { re: new RegExp(`(\\s)('|")(?=\\w)`, "y"), substs: [{ kind: "text", group: 1 }, { kind: "context", via: "lquote", group: 2 }] },
  { re: new RegExp(`(${SQ_CLOSE})('|")`, "y"), substs: [{ kind: "text", group: 1 }, { kind: "context", via: "rquote", group: 2 }] },
  { re: new RegExp(`("|')(?=\\s|s\\b|$)`, "y"), substs: [{ kind: "context", via: "rquote", group: 1 }] },
  { re: new RegExp(`(.?)'`, "sy"), substs: [{ kind: "text", group: 1 }, { kind: "quote", char: "\u2018" }] },
  { re: new RegExp(`(.?)"`, "sy"), substs: [{ kind: "text", group: 1 }, { kind: "quote", char: "\u201c" }] },
];

function sqSubstChar(via: "lquote" | "rquote", quote: string): string {
  if (quote === '"') return via === "lquote" ? "\u201c" : "\u201d";
  return via === "lquote" ? "\u2018" : "\u2019";
}

function parseSmartQuote(text: string, start: number): { html: string; next: number } | null {
  for (const rule of SQ_RULES) {
    rule.re.lastIndex = start;
    const match = rule.re.exec(text);
    if (match === null) continue;
    let html = "";
    for (const subst of rule.substs) {
      if (subst.kind === "text") {
        const captured = match[subst.group];
        if (captured !== undefined && captured !== "") html += escapeHtmlText(captured);
      } else if (subst.kind === "quote") {
        html += subst.char;
      } else {
        html += sqSubstChar(subst.via, match[subst.group] ?? "'");
      }
    }
    return { html, next: start + match[0].length };
  }
  return null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', copy: "\u00a9", reg: "\u00ae",
  trade: "\u2122", nbsp: "\u00a0", mdash: "\u2014", ndash: "\u2013",
  hellip: "\u2026", laquo: "\u00ab", raquo: "\u00bb", lsquo: "\u2018",
  rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d", deg: "\u00b0",
  plusmn: "\u00b1", frac12: "\u00bd", times: "\u00d7", divide: "\u00f7",
  middot: "\u00b7", bull: "\u2022", dagger: "\u2020", sect: "\u00a7",
  para: "\u00b6", euro: "\u20ac", pound: "\u00a3", yen: "\u00a5", cent: "\u00a2",
};

function parseHtmlEntity(text: string, start: number): { html: string; next: number } | null {
  const match = /^&([A-Za-z][A-Za-z0-9]*|#[0-9]+|#[xX][0-9a-fA-F]+);/.exec(text.slice(start));
  if (match === null) return null;
  const original = match[0];
  const body = match[1];
  let char: string | undefined;
  if (body.startsWith("#")) {
    const code = body[1] === "#" || body[1] === "x" || body[1] === "X"
      ? parseInt(body.slice(2), body[1]?.toLowerCase() === "x" ? 16 : 10)
      : parseInt(body.slice(1), 10);
    if (Number.isFinite(code)) char = String.fromCodePoint(code);
  } else {
    char = NAMED_ENTITIES[body];
    if (char === undefined) return null;
  }
  if (char === undefined) {
    return { html: original, next: start + original.length };
  }
  if (char === "<" || char === ">" || char === "&" || char === '"') {
    return { html: original, next: start + original.length };
  }
  return { html: char, next: start + original.length };
}

const TYPOGRAPHIC_SUBSTS: [RegExp, string, number][] = [
  [/^---/, "\u2014", 3],
  [/^--/, "\u2013", 2],
  [/^\.\.\./, "\u2026", 3],
  [/^\\<</, "&lt;&lt;", 4],
  [/^\\>>/, "&gt;&gt;", 4],
  [/^<< /, "\u00ab\u00a0", 3],
  [/^ >>/, "\u00a0\u00bb", 3],
  [/^<</, "\u00ab", 2],
  [/^>>/, "\u00bb", 2],
];

function parseTypographic(text: string, start: number): { html: string; next: number } | null {
  for (const [re, replacement, length] of TYPOGRAPHIC_SUBSTS) {
    if (re.test(text.slice(start, start + length))) {
      return { html: replacement, next: start + length };
    }
  }
  return null;
}

function parseEscapedChar(text: string, start: number): { html: string; next: number } | null {
  const match = /^\\([\\.*_+`<>(){}[\]#!:|"'$=-])/.exec(text.slice(start));
  if (match === null) return null;
  return { html: escapeHtmlText(match[1]), next: start + match[0].length };
}

function escapeHtmlAll(s: string): string {
  return s.replace(/[<>&]/g, (m) => (m === "<" ? "&lt;" : m === ">" ? "&gt;" : "&amp;"));
}

function escapeHtmlCoderay(s: string): string {
  return escapeHtmlAll(s).replace(/"/g, "&quot;");
}

function escapeHtmlText(s: string): string {
  return escapeHtmlAll(s);
}

function escapeAttribute(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function kramdownToStashedHtml(raw: string): string {
  type StashPiece = { kind: "text"; text: string } | { kind: "ref"; text: string };
  const merged: StashPiece[] = [];
  const REF_PATTERN =
    /\\(?:\{\{[^{}]*\}\}|\[\[[^\]\n]+\]\])|\{\{[^{}]*\}\}|\[\[[^\]\n]+\]\]/g;
  let last = 0;
  for (const match of raw.matchAll(REF_PATTERN)) {
    const start = match.index;
    if (start > last) merged.push({ kind: "text", text: raw.slice(last, start) });
    merged.push({ kind: "ref", text: match[0] });
    last = start + match[0].length;
  }
  if (last < raw.length) merged.push({ kind: "text", text: raw.slice(last) });
  let stashed = "";
  const stash: string[] = [];
  for (const piece of merged) {
    if (piece.kind === "text") {
      stashed += piece.text;
    } else {
      stashed += `{{${stash.length}}}`;
      stash.push(piece.text);
    }
  }
  return unstashNests(kramdownToHtml(stashed), stash);
}

function unstashNests(converted: string, stash: readonly string[]): string {
  return converted.replace(/{{([^{}]*)}}/g, (whole, inner: string) => {
    if (!isRubyNumber(inner)) return whole;
    return stash[Number(inner)] ?? "";
  });
}

function isRubyNumber(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed === "") return false;
  return Number.isFinite(Number(trimmed));
}

const DEFINITION_LIST_START_RE = /^((?: {0,3}):)([\t| ][^\n]*\n)/;

const LIST_ITEM_IAL_RE = /^\s*(?:\{:(?!(?:\w[\w-]*)?:|\/)((?:\\}|[^}])+)\})\s*/;
const LIST_ITEM_IAL_CHECK_RE = /^\s*(?:\{:(?!(?:\w[\w-]*)?:|\/)((?:\\}|[^}])+)\})?\s*\n/;

function parseDefinitionList(ctx: BlockCtx, rest: string): boolean {
  const m = DEFINITION_LIST_START_RE.exec(rest);
  if (m === null) return false;
  const tree = ctx.tree;
  const last = tree[tree.length - 1];
  const prev = tree[tree.length - 2];
  let popCount: number;
  let firstAsPara = false;
  if (last?.kind === "p") {
    popCount = 1;
  } else if (last?.kind === "blank" && prev?.kind === "p") {
    popCount = 2;
    firstAsPara = true;
  } else {
    return false;
  }
  const items: DlEntry[] = [];
  let para: KBlock;
  if (popCount === 2) {
    tree.pop();
    para = tree.pop()!;
  } else {
    para = tree.pop()!;
  }
  if (para.kind !== "p") return false;
  const dl: KBlock = { kind: "dl", items, ial: para.ial };
  for (const term of para.text.split("\n")) {
    let text = term;
    let ial: Ial | undefined;
    const ialMatch = LIST_ITEM_IAL_RE.exec(text);
    if (ialMatch !== null) {
      ial = parseAttributeList(ialMatch[1]);
      text = text.slice(ialMatch[0].length);
    }
    items.push({ type: "dt", text, ial });
  }

  const defs: { lines: string[]; firstAsPara: boolean }[] = [];
  let pos = 0;
  let defStartRe = DEFINITION_LIST_START_RE;
  let contentRe: RegExp | undefined;
  let lazyRe: RegExp | undefined;
  let indentRe: RegExp | undefined;
  let lastIsBlank = false;
  for (;;) {
    const at = rest.slice(pos);
    const start = defStartRe.exec(at);
    if (start !== null) {
      const [content, indentation, cRe, lRe, iRe] = parseFirstListLine(
        start[1].length,
        start[2],
      );
      void indentation;
      contentRe = cRe;
      lazyRe = lRe;
      indentRe = iRe;
      defStartRe = fetchPatternDl(contentRe, lazyRe, indentRe, cRe.source);
      defs.push({ lines: [content], firstAsPara });
      firstAsPara = false;
      lastIsBlank = false;
      pos += start[0].length;
      continue;
    }
    if (defs.length === 0) break;
    if (/^\^\s*?\n/.test(at)) break;
    let result = contentRe !== undefined ? contentRe.exec(at) : null;
    if (result === null && !lastIsBlank && lazyRe !== undefined) result = lazyRe.exec(at);
    if (result !== null) {
      let line = result[0].replace(/^(\t+)/, (tabs) => " ".repeat(4 * tabs.length));
      line = line.replace(indentRe!, "");
      defs[defs.length - 1]!.lines.push(line);
      firstAsPara = false;
      lastIsBlank = false;
      pos += result[0].length;
      continue;
    }
    const blank = /^(?:[ \t]*\n)+/.exec(at);
    if (blank !== null) {
      firstAsPara = true;
      defs[defs.length - 1]!.lines.push(blank[0]);
      lastIsBlank = true;
      pos += blank[0].length;
      continue;
    }
    break;
  }

  let trailing: KBlock | undefined;
  for (const def of defs) {
    const blocks = parseBlocksInto(def.lines.join(""), ctx.state);
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock?.kind === "blank") {
      blocks.pop();
      trailing = { kind: "blank" };
    }
    if (blocks[0]?.kind === "p" && !def.firstAsPara) {
      if (blocks.length > 1) (blocks[0] as { text: string }).text += "\n";
      (blocks[0] as { transparent: boolean }).transparent = true;
    }
    items.push({ type: "dd", blocks, transparent: blocks[0]?.kind === "p" && !def.firstAsPara });
  }

  const lastChild = tree[tree.length - 1];
  if (lastChild?.kind === "dl") {
    lastChild.items.push(...items);
  } else if (
    tree[tree.length - 1]?.kind === "blank" &&
    tree[tree.length - 2]?.kind === "dl"
  ) {
    tree.pop();
    (tree[tree.length - 1] as Extract<KBlock, { kind: "dl" }>).items.push(...items);
  } else {
    tree.push(takeBlockEl(ctx, dl));
  }
  if (trailing !== undefined) tree.push(trailing);
  ctx.pos += pos;
  return true;
}

function parseFirstListLine(
  indentation: number,
  content: string,
): [string, number, RegExp, RegExp, RegExp] {
  let indent = indentation;
  let text = content;
  if (LIST_ITEM_IAL_CHECK_RE.test(text)) {
    indent = 4;
  } else {
    while (/^ *\t/.test(text)) {
      const temp = (text.match(/^ */)![0].length) + indent;
      text = text.replace(/^( *)(\t+)/, (_whole, spaces: string, tabs: string) =>
        spaces + " ".repeat(4 - (temp % 4) + (tabs.length - 1) * 4),
      );
    }
    indent += text.match(/^ */)![0].length;
  }
  text = text.replace(/^\s+/, "");
  const div4 = Math.floor(indent / 4);
  const mod4 = indent % 4;
  const contentRe = new RegExp(
    `^(?:(?:\\t| {4}){${div4}} {${mod4}}|(?:\\t| {4}){${div4 + 1}}).*\\S.*\\n`,
    "y",
  );
  const lazyRe = new RegExp(
    `(?!^ {0,${Math.min(indent, 3)}}(?:${IAL_BLOCK_SRC}|${LAZY_HTML_STOP_SRC}|${LAZY_HTML_START_SRC})).*\\S.*\\n`,
    "uy",
  );
  const indentRe = new RegExp(`^ {${indent}}`);
  return [text, indent, contentRe, lazyRe, indentRe];
}

function fetchPatternDl(
  contentRe: RegExp,
  lazyRe: RegExp,
  indentRe: RegExp,
  _source: string,
): RegExp {
  void contentRe;
  void lazyRe;
  void indentRe;
  void _source;
  return DEFINITION_LIST_START_RE;
}

const UNAME_RE = new RegExp(
  `(?:(?:\\p{L}|_)(?:[-\\p{L}\\p{N}._])*:)?(?:\\p{L}|_)(?:[-\\p{L}\\p{N}._])*`,
  "u",
);
const HTML_TAG_RE = new RegExp(
  `<((?:${UNAME_RE.source}))\\s*((?:\\s+${UNAME_RE.source}(?:\\s*=\\s*(?:[\\p{L}\\p{N}_]+|("|')[\\s\\S]*?\\3))?)*)\\s*(/)?>`,
  "u",
);
const HTML_TAG_CLOSE_RE = new RegExp(`</(${UNAME_RE.source})\\s*>`, "u");
const HTML_COMMENT_RE = /<!--([\s\S]*?)-->/;
const HTML_INSTRUCTION_RE = /<\?([\s\S]*?)\?>/;
const HTML_CDATA_RE = /<!\[CDATA\[([\s\S]*?)\]\]>/;
const HTML_ELEMENTS_WITHOUT_BODY = new Set([
  "area", "base", "br", "col", "command", "embed", "hr", "img", "input",
  "keygen", "link", "meta", "param", "source", "track", "wbr",
]);
const HTML_BLOCK_ELEMENTS = new Set([
  "address", "article", "aside", "applet", "body", "blockquote", "caption",
  "col", "colgroup", "dd", "div", "dl", "dt", "fieldset", "figcaption",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup",
  "hr", "html", "head", "iframe", "legend", "menu", "li", "main", "map",
  "nav", "ol", "optgroup", "p", "pre", "section", "summary", "table",
  "tbody", "td", "th", "thead", "tfoot", "tr", "ul",
]);
const HTML_CONTENT_MODEL: Readonly<Record<string, "block" | "span" | "raw">> =
  Object.freeze(
    Object.fromEntries([
      ...["address", "applet", "article", "aside", "blockquote", "body", "dd", "details", "div", "dl", "fieldset", "figure", "figcaption", "footer", "form", "header", "hgroup", "iframe", "li", "main", "map", "menu", "nav", "noscript", "object", "section", "summary", "td"].map((n) => [n, "block"]),
      ...["a", "abbr", "acronym", "b", "bdo", "big", "button", "cite", "caption", "del", "dfn", "dt", "em", "h1", "h2", "h3", "h4", "h5", "h6", "i", "ins", "label", "legend", "optgroup", "p", "q", "rb", "rbc", "rp", "rt", "rtc", "ruby", "select", "small", "span", "strong", "sub", "sup", "th", "tt"].map((n) => [n, "span"]),
      ...["script", "style", "math", "option", "textarea", "pre", "code", "kbd", "samp", "var"].map((n) => [n, "raw"]),
    ]),
  );
const HTML_KNOWN_ELEMENTS = new Set(Object.keys(HTML_CONTENT_MODEL));

function parseHtmlAttributes(
  str: string,
  inHtmlTag: boolean,
): [string, string][] {
  const attrs: [string, string][] = [];
  const re = new RegExp(
    `\\s*(${UNAME_RE.source})(?:\\s*=\\s*(?:(\\w+)|("|')([\\s\\S]*?)\\3))?`,
    "gu",
  );
  for (const m of str.matchAll(re)) {
    const name = inHtmlTag ? m[1].toLowerCase() : m[1];
    const value = m[2] ?? m[4] ?? "";
    const existing = attrs.find(([n]) => n === name);
    if (existing !== undefined) existing[1] = value;
    else attrs.push([name, value]);
  }
  return attrs;
}

function parseBlockHtml(ctx: BlockCtx, rest: string): boolean {
  if (!/^ {0,3}<(?:[\p{L}_]|!--|\/)/u.test(rest)) return false;
  const comment = /^ {0,3}<!--[\s\S]*?-->/.exec(rest);
  if (comment !== null) {
    ctx.tree.push(takeBlockEl(ctx, { kind: "xmlComment", value: comment[0] }));
    ctx.pos += comment[0].length;
    const ws = /^[ \t]*\n/.exec(rest.slice(ctx.pos));
    if (ws !== null) ctx.pos += ws[0].length;
    return true;
  }
  const open = /^ {0,3}/.exec(rest)![0];
  const tagMatch = HTML_TAG_RE.exec(rest.slice(open.length));
  if (tagMatch !== null && !HTML_SPAN_ONLY(tagMatch[1])) {
    ctx.pos += open.length + tagMatch[0].length;
    handleHtmlStartTag(ctx, tagMatch);
    return true;
  }
  const closeMatch = /^ {0,3}<\/((?:[\p{L}_])[\p{L}\p{N}._:-]*)\s*>/u.exec(rest);
  if (closeMatch !== null && !HTML_SPAN_ONLY(closeMatch[1])) {
    const name = closeMatch[1].toLowerCase();
    if (ctx.stopCloseTag === name) {
      ctx.pos += closeMatch[0].length;
      ctx.stopped = true;
      return true;
    }
    return false;
  }
  return false;
}

function HTML_SPAN_ONLY(name: string): boolean {
  return (
    !HTML_BLOCK_ELEMENTS.has(name.toLowerCase()) &&
    HTML_CONTENT_MODEL[name.toLowerCase()] === "span"
  );
}

function handleHtmlStartTag(ctx: BlockCtx, tagMatch: RegExpExecArray): void {
  let name = tagMatch[1];
  if (HTML_KNOWN_ELEMENTS.has(name.toLowerCase())) name = name.toLowerCase();
  let closed = tagMatch[4] !== undefined;
  const attrs = parseHtmlAttributes(tagMatch[2] ?? "", HTML_KNOWN_ELEMENTS.has(name));
  if (!closed && HTML_ELEMENTS_WITHOUT_BODY.has(name)) closed = true;

  const block: Extract<KBlock, { kind: "htmlBlock" }> = {
    kind: "htmlBlock",
    tag: name,
    attrs,
    content: { raw: [] },
    isClosed: closed,
  };
  if (ctx.blockIal !== undefined) {
    block.ial = ctx.blockIal;
    ctx.blockIal = undefined;
  }
  ctx.tree.push(block);

  if (!closed && (name === "script" || name === "style")) {
    const rest = ctx.src.slice(ctx.pos);
    const stop = new RegExp(`(?=<\\\\?/${name}\\\\s*>)`, "i");
    void stop;
    const closeIdx = searchCloseTag(rest, name, true);
    if (closeIdx >= 0) {
      block.content = { raw: [{ text: rest.slice(0, closeIdx) }] };
      const closeLen = rest.length - closeIdx;
      const closeMatch = /^<\/[^>]*>/.exec(rest.slice(closeIdx))!;
      ctx.pos += closeIdx + closeMatch[0].length;
      void closeLen;
    } else {
      block.content = { raw: [{ text: rest }] };
      ctx.pos = ctx.src.length;
    }
    return;
  }
  if (closed) return;

  let contentModel: "raw" | "block" | "span" = "raw";
  const mdIdx = attrs.findIndex(([n]) => n === "markdown");
  if (mdIdx >= 0) {
    const val = attrs[mdIdx][1];
    attrs.splice(mdIdx, 1);
    const mapped =
      val === "0"
        ? "raw"
        : val === "1"
          ? HTML_CONTENT_MODEL[name] ?? "raw"
          : val === "span"
            ? "span"
            : val === "block"
              ? "block"
              : undefined;
    if (mapped !== undefined) contentModel = mapped;
  }

  const rest = () => ctx.src.slice(ctx.pos);
  if (contentModel === "block") {
    const ws = /^[ \t]*\n/.exec(rest());
    if (ws !== null) ctx.pos += ws[0].length;
    const prevStop = ctx.stopCloseTag;
    ctx.stopCloseTag = name;
    const savedTree = ctx.tree;
    const inner: BlockCtx = { ...ctx, tree: [], blockIal: undefined, stopCloseTag: name };
    ctx.tree = inner.tree;
    parseBlocksRest(ctx);
    block.content = { blocks: inner.tree };
    ctx.tree = savedTree;
    ctx.stopCloseTag = prevStop;
    return;
  }
  if (contentModel === "span") {
    const ws = /^[ \t]*\n/.exec(rest());
    if (ws !== null) ctx.pos += ws[0].length;
    const closeIdx = searchCloseTag(rest(), name, HTML_KNOWN_ELEMENTS.has(name));
    if (closeIdx >= 0) {
      const textPart = rest().slice(0, closeIdx);
      block.content = { raw: [{ text: textPart }] };
      ctx.pos += closeIdx;
      const closeMatch = /^<\/[^>]*>/.exec(rest());
      ctx.pos += closeMatch![0].length;
    } else {
      block.content = { raw: [{ text: rest() }] };
      ctx.pos = ctx.src.length;
    }
    return;
  }
  parseRawHtmlInto(ctx, block);
  const ws2 = /^[ \t]*\n/.exec(ctx.src.slice(ctx.pos));
  if (ws2 !== null) ctx.pos += ws2[0].length;
}

function searchCloseTag(text: string, name: string, ignoreCase: boolean): number {
  const re = new RegExp(`</${escapeRegExp(name)}\\s*>`, ignoreCase ? "im" : "m");
  const m = re.exec(text);
  return m === null ? -1 : m.index;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRawHtmlInto(
  ctx: BlockCtx,
  block: Extract<KBlock, { kind: "htmlBlock" }>,
): void {
  const children: HtmlRawNode[] = [];
  block.content = { raw: children };
  const textOf = (s: string): HtmlRawNode => ({ text: s });
  for (;;) {
    const rest = ctx.src.slice(ctx.pos);
    if (rest === "") break;
    const nextTag = rest.indexOf("<");
    if (nextTag === -1) {
      children.push(textOf(rest));
      ctx.pos = ctx.src.length;
      break;
    }
    if (nextTag > 0) children.push(textOf(rest.slice(0, nextTag)));
    ctx.pos += nextTag;
    const at = ctx.src.slice(ctx.pos);
    const comment = /^<!--[\s\S]*?-->/.exec(at);
    if (comment !== null) {
      children.push({ comment: comment[0] });
      ctx.pos += comment[0].length;
      continue;
    }
    const instruction = /^<\?[\s\S]*?\?>/.exec(at);
    if (instruction !== null) {
      children.push({ comment: instruction[0] });
      ctx.pos += instruction[0].length;
      continue;
    }
    const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>/.exec(at);
    if (cdata !== null) {
      children.push(textOf(cdata[1]));
      ctx.pos += cdata[0].length;
      continue;
    }
    const openTag = HTML_TAG_RE.exec(at);
    if (openTag !== null) {
      let name = openTag[1];
      if (HTML_KNOWN_ELEMENTS.has(name.toLowerCase())) name = name.toLowerCase();
      let closed = openTag[4] !== undefined;
      const attrs = parseHtmlAttributes(openTag[2] ?? "", HTML_KNOWN_ELEMENTS.has(name));
      ctx.pos += openTag[0].length;
      if (!closed && HTML_ELEMENTS_WITHOUT_BODY.has(name)) closed = true;
      const el: HtmlRawNode = { el: { tag: name, attrs, children: [], isClosed: closed } };
      children.push(el);
      if (name === "script" || name === "style") {
        const rest2 = ctx.src.slice(ctx.pos);
        const closeIdx = searchCloseTag(rest2, name, true);
        if (closeIdx >= 0) {
          (el as { el: { children: HtmlRawNode[] } }).el.children.push({ text: rest2.slice(0, closeIdx) });
          const closeMatch = /^<\/[^>]*>/.exec(rest2.slice(closeIdx))!;
          ctx.pos += closeIdx + closeMatch[0].length;
        } else {
          (el as { el: { children: HtmlRawNode[] } }).el.children.push({ text: rest2 });
          ctx.pos = ctx.src.length;
        }
        continue;
      }
      if (!closed) {
        const rest2 = ctx.src.slice(ctx.pos);
        const closeIdx = searchCloseTag(rest2, name, HTML_KNOWN_ELEMENTS.has(name));
        if (closeIdx >= 0) {
          const body = rest2.slice(0, closeIdx);
          const subCtx: BlockCtx = { ...ctx, src: body, pos: 0, tree: [] , stopCloseTag: undefined};
          const subBlock: Extract<KBlock, { kind: "htmlBlock" }> = {
            kind: "htmlBlock",
            tag: name,
            attrs,
            content: { raw: [] },
            isClosed: false,
          };
          parseRawHtmlInto(subCtx, subBlock);
          (el as { el: { children: HtmlRawNode[] } }).el.children.push(...(subBlock.content as { raw: HtmlRawNode[] }).raw);
          ctx.pos += closeIdx;
          const closeMatch = /^<\/[^>]*>/.exec(ctx.src.slice(ctx.pos))!;
          ctx.pos += closeMatch[0].length;
        } else {
          const body = rest2;
          const subCtx: BlockCtx = { ...ctx, src: body, pos: 0, tree: [], stopCloseTag: undefined };
          const subBlock: Extract<KBlock, { kind: "htmlBlock" }> = {
            kind: "htmlBlock",
            tag: name,
            attrs,
            content: { raw: [] },
            isClosed: false,
          };
          parseRawHtmlInto(subCtx, subBlock);
          (el as { el: { children: HtmlRawNode[] } }).el.children.push(...(subBlock.content as { raw: HtmlRawNode[] }).raw);
          ctx.pos = ctx.src.length;
        }
      }
      continue;
    }
    const closeTag = HTML_TAG_CLOSE_RE.exec(at);
    if (closeTag !== null) {
      const closeName = HTML_KNOWN_ELEMENTS.has(closeTag[1].toLowerCase())
        ? closeTag[1].toLowerCase()
        : closeTag[1];
      if (closeName === block.tag) {
        ctx.pos += closeTag[0].length;
        break;
      }
      children.push(textOf(closeTag[0]));
      ctx.pos += closeTag[0].length;
      continue;
    }
    children.push(textOf("<"));
    ctx.pos += 1;
  }
}

function parseBlocksRest(ctx: BlockCtx): void {
  const src = ctx.src;
  while (ctx.pos < src.length && !ctx.stopped) {
    const rest = src.slice(ctx.pos);
    if (parseBlankLine(ctx, rest)) continue;
    if (parseIndentedCodeBlock(ctx, rest)) continue;
    if (parseFencedCodeBlock(ctx, rest)) continue;
    if (parseBlockquote(ctx, rest)) continue;
    if (parseAtxHeader(ctx, rest)) continue;
    if (parseHorizontalRule(ctx, rest)) continue;
    if (parseListBlock(ctx, rest)) continue;
    if (parseDefinitionList(ctx, rest)) continue;
    if (parseBlockHtml(ctx, rest)) continue;
    if (parseSetextHeader(ctx, rest)) continue;
    if (parseBlockMath(ctx, rest)) continue;
    if (parseTable(ctx, rest)) continue;
    if (parseFootnoteDefinition(ctx, rest)) continue;
    if (parseLinkDefinition(ctx, rest)) continue;
    if (parseAbbrevDefinition(ctx, rest)) continue;
    if (parseBlockExtensions(ctx, rest)) continue;
    if (parseEobMarker(ctx, rest)) continue;
    const para = parseParagraphInto(ctx.tree, src, ctx.pos);
    ctx.pos = para.nextPos;
  }
}

const TABLE_SEP_LINE_RE = /^([+|: \t-]*?-[+|: \t-]*?)[ \t]*\n/;
const TABLE_FSEP_LINE_RE = /^[+|: \t=]*?=[+|: \t=]*?[ \t]*\n/;
const TABLE_ROW_LINE_RE = /^(.*?)[ \t]*\n/;
function hasUnescapedPipe(line: string): boolean {
  if (line.startsWith("|")) return true;
  for (let i = 1; i < line.length; i++) {
    if (line[i] === "|" && line[i - 1] !== "\\") return true;
  }
  return false;
}
const TABLE_LINE_RE = new RegExp(`^(?:\\||[^\\n]*[^\\\\\\n]\\|).*?\\n`);

function parseTable(ctx: BlockCtx, rest: string): boolean {
  if (!afterBlockBoundary(ctx)) return false;
  const savedPos = ctx.pos;
  const origPos = ctx.pos;
  const alignment: TableAlign[] = [];
  const leadingPipe = /^\s*\|/.test(TABLE_LINE_RE.exec(rest)?.[0] ?? "");
  let pos = ctx.pos;
  const sep0 = TABLE_SEP_LINE_RE.exec(rest.slice(pos));
  if (sep0 !== null) pos += sep0[0].length;

  const sections: TableSection[] = [];
  let rows: string[][] = [];
  let hasFooter = false;
  let columns = 0;
  const addContainer = (type: TableSection["type"], force: boolean): void => {
    if (!hasFooter || type !== "tbody" || force) {
      sections.push({ type, rows });
      rows = [];
    }
  };

  for (;;) {
    const at = rest.slice(pos);
    if (!TABLE_LINE_RE.test(at)) break;
    const sep = TABLE_SEP_LINE_RE.exec(at);
    if (sep !== null) {
      if (rows.length === 0) {
      } else if (alignment.length === 0 && !hasFooter) {
        addContainer("thead", false);
        for (const m of sep[1].matchAll(/[ \t]?(:?)-+(:?)[ \t]?/g)) {
          const left = m[1] ?? "";
          const right = m[2] ?? "";
          alignment.push(
            left === "" && right === ""
              ? "default"
              : right === ""
                ? "left"
                : left === ""
                  ? "right"
                  : "center",
          );
        }
      } else {
        addContainer("tbody", false);
      }
      pos += sep[0].length;
      continue;
    }
    const fsep = TABLE_FSEP_LINE_RE.exec(at);
    if (fsep !== null) {
      if (rows.length !== 0) addContainer("tbody", true);
      hasFooter = true;
      pos += fsep[0].length;
      continue;
    }
    const row = TABLE_ROW_LINE_RE.exec(at);
    if (row === null) break;
    rows.push(splitTableRow(row[1], leadingPipe));
    columns = Math.max(columns, rows[rows.length - 1]!.length);
    pos += row[0].length;
  }
  ctx.pos = pos;

  if (!atBlockBoundary(rest.slice(ctx.pos))) {
    ctx.pos = savedPos;
    return false;
  }

  const tableText = rest.slice(origPos, ctx.pos - 1);
  const carry = { pipe: false };
  if (!pipeVerification(tableText, carry)) {
    ctx.pos = savedPos;
    return false;
  }

  addContainer(hasFooter ? "tfoot" : "tbody", false);
  if (!sections.some((s) => s.type === "tbody")) {
    ctx.pos = savedPos;
    return false;
  }
  for (const section of sections) {
    for (const row of section.rows) {
      while (row.length < columns) row.push("");
    }
  }
  if (alignment.length > columns) alignment.length = columns;
  else while (alignment.length < columns) alignment.push("default");

  ctx.tree.push(takeBlockEl(ctx, { kind: "table", alignment, sections }));
  return true;
}

function splitTableRow(line: string, leadingPipe: boolean): string[] {
  const cells: string[] = [];
  const parts = line.split(/(<code.*?>[\s\S]*?<\/code>)/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      if (cells.length === 0) cells.push("");
      cells[cells.length - 1]! += part;
      return;
    }
    for (const child of walkCodespans(part)) {
      if (child.kind === "text") {
        const pieces = (child.value ?? "").split(/(?<!\\)\|/).map((t) => t.replace(/\\\|/g, "|"));
        if (cells.length === 0) cells.push(pieces[0] ?? "");
        else cells[cells.length - 1]! += pieces[0] ?? "";
        for (const piece of pieces.slice(1)) cells.push(piece);
      } else {
        const content = child.content ?? "";
        const run = (content.match(/`+/g)?.sort().at(-1) ?? "") + "`";
        const tmp =
          run + (run.length > 1 ? " " : "") + content + (run.length > 1 ? " " : "") + run;
        if (cells.length === 0) cells.push(tmp);
        else cells[cells.length - 1]! += tmp;
      }
    }
  });
  if (leadingPipe && (cells[0] ?? "").trim() === "") cells.shift();
  if ((cells[cells.length - 1] ?? "").trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

function walkCodespans(text: string): { kind: "text" | "code"; value?: string; content?: string }[] {
  const out: { kind: "text" | "code"; value?: string; content?: string }[] = [];
  let run = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "`") {
      const parsed = parseCodespan(text, i);
      const single = text[i] === "`" && parseCodespanRun(text, i) !== null;
      void single;
      out.push({ kind: "code", content: codespanRawContent(text, i, parsed.next) });
      i = parsed.next;
      continue;
    }
    run += text[i];
    i += 1;
  }
  if (run !== "") out.push({ kind: "text", value: run });
  return out;
}

function codespanRawContent(text: string, start: number, next: number): string {
  let run = 0;
  while (text[start + run] === "`") run += 1;
  if (next - (start + run) < run) return text.slice(start + run, next);
  return text.slice(start + run, next - run);
}

function parseCodespanRun(text: string, start: number): string | null {
  return text[start] === "`" ? "`" : null;
}

function pipeVerification(tableText: string, carry: { pipe: boolean }): boolean {
  let pipeOnLine = false;
  let i = 0;
  while (i < tableText.length) {
    const ch = tableText[i];
    if (ch === "`") {
      const parsed = parseCodespan(tableText, i);
      i = parsed.next;
      continue;
    }
    if (ch === "<") {
      const comment = /^<!--[\s\S]*?-->/.exec(tableText.slice(i));
      if (comment !== null) {
        if (!tableLinesStep(comment[0], carry, (v) => (pipeOnLine = v))) return false;
        i += comment[0].length;
        continue;
      }
      const openTag = HTML_TAG_RE.exec(tableText.slice(i));
      if (openTag !== null) {
        pipeOnLine = pipeOnLine || hasUnescapedPipe(openTag[1]);
        i += openTag[0].length;
        continue;
      }
      const closeTag = HTML_TAG_CLOSE_RE.exec(tableText.slice(i));
      if (closeTag !== null) {
        if (!tableLinesStep(closeTag[0], carry, (v) => (pipeOnLine = v))) return false;
        i += closeTag[0].length;
        continue;
      }
    }
    let j = i;
    while (j < tableText.length && tableText[j] !== "`" && tableText[j] !== "<") j++;
    if (!tableLinesStep(tableText.slice(i, j), carry, (v) => (pipeOnLine = v))) return false;
    i = j;
  }
  return pipeOnLine;
}

function tableLinesStep(
  value: string,
  carry: { pipe: boolean },
  setPipe: (v: boolean) => void,
): boolean {
  const lines = value.split("\n");
  const first = lines[0] ?? "";
  if (lines.length > 1 && !carry.pipe && !hasUnescapedPipe(first)) return false;
  setPipe((lines.length > 1 ? false : carry.pipe) || hasUnescapedPipe(lines[lines.length - 1] ?? ""));
  return true;
}
let pipeCarry = false;

function parseAttributeList(str: string, target?: Ial): Ial {
  const ial: Ial = target ?? { attrs: [], refs: [] };
  const trimmed = str.trim();
  if (trimmed === "" || trimmed === ":") return ial;
  const any = new RegExp(
    `(^|\\s)(?:(\w[\w-]*)=("|')((?:\\\\}|\\.[^}])*?)\\3|((?:#[A-Za-z][\w:-]*|\\.[^\\s.#]+)+)|(\w[\w-]*))(?=\\s|$)`,
    "g",
  );
  for (const m of trimmed.matchAll(any)) {
    if (m[6] !== undefined) {
      ial.refs.push(m[6]);
    } else if (m[5] !== undefined) {
      for (const part of m[5].matchAll(/#([A-Za-z][\w:-]*)|\.([^\s.#]+)/g)) {
        if (part[1] !== undefined) {
          const existing = ial.attrs.find(([n]) => n === "id");
          if (existing !== undefined) existing[1] = part[1];
          else ial.attrs.push(["id", part[1]]);
        } else {
          const existing = ial.attrs.find(([n]) => n === "class");
          if (existing !== undefined) existing[1] = `${existing[1]} ${part[2]}`.replace(/^ +/, "");
          else ial.attrs.push(["class", part[2]!]);
        }
      }
    } else {
      const key = m[2]!;
      const value = (m[3] ?? "").replace(/\\(\}|\\)/g, "$1");
      const existing = ial.attrs.find(([n]) => n === key);
      if (existing !== undefined) existing[1] = value;
      else ial.attrs.push([key, value]);
    }
  }
  return ial;
}

function parseBlockExtensions(ctx: BlockCtx, rest: string): boolean {
  if (!/^ {0,3}\{:/.test(rest)) return false;
  const ald = /^ {0,3}\{:(\w[\w-]*):((?:\\}|[^}])+)\}\s*?\n/.exec(rest);
  if (ald !== null) {
    const ial = parseAttributeList(ald[2], ctx.state.alds.get(ald[1]));
    ctx.state.alds.set(ald[1], ial);
    ctx.tree.push(takeBlockEl(ctx, { kind: "eob", value: "ald" }));
    ctx.pos += ald[0].length;
    return true;
  }
  const ext = EXT_BLOCK_START_RE.exec(rest);
  if (ext !== null) {
    return parseExtensionStartTag(ctx, ext, "block");
  }
  const ialStart = ialBlockStartRe().exec(rest);
  if (ialStart !== null) {
    const last = ctx.tree[ctx.tree.length - 1];
    const eligible =
      last !== undefined &&
      last.kind !== "blank" &&
      (last.kind !== "eob" ||
        ["link_def", "abbrev_def", "footnote_def"].includes(last.value ?? ""));
    if (eligible) {
      const target = getBlockIal(last);
      parseAttributeList(ialStart[1], target);
      ctx.pos += ialStart[0].length;
      if (!ialBlockStartRe().test(rest.slice(ctx.pos))) {
        ctx.tree.push(takeBlockEl(ctx, { kind: "eob", value: "ial" }));
      }
    } else {
      ctx.blockIal = parseAttributeList(ialStart[1], ctx.blockIal);
      ctx.pos += ialStart[0].length;
    }
    return true;
  }
  return false;
}

function getBlockIal(block: KBlock): Ial {
  const holder = block as { ial?: Ial };
  if (holder.ial === undefined) {
    holder.ial = { attrs: [], refs: [] };
  }
  return holder.ial;
}

const EXT_BLOCK_START_RE = new RegExp(
  `^ {0,3}(?:\\{::(\\w+)(?:\\s((?:\\\\}|[^}])*?)|)(/)?\\}|\\{:/(${`\\w[\\w-]*`})?\\})\\s*?\\n`,
);

function parseExtensionStartTag(
  ctx: BlockCtx,
  startMatch: RegExpExecArray,
  type: "block",
): boolean {
  const savedPos = ctx.pos;
  ctx.pos += startMatch[0].length;
  if (startMatch[4] !== undefined) {
    ctx.pos = savedPos;
    return false;
  }
  const ext = startMatch[1]!;
  const selfClosing = startMatch[3] !== undefined;
  const opts = parseAttributeList(startMatch[2] ?? "");
  let body: string | undefined;
  if (!selfClosing) {
    const stopRe = new RegExp(`\\{:/(?:${escapeRegExp(ext)})?\\}`, "g");
    const rest = ctx.src;
    stopRe.lastIndex = ctx.pos;
    const stop = stopRe.exec(rest);
    if (stop === null) {
      ctx.pos = savedPos;
      return false;
    }
    body = rest.slice(ctx.pos, stop.index);
    ctx.pos = stop.index + stop[0].length;
    if (type === "block") body = body.replace(/\n$/, "");
  }
  switch (ext) {
    case "comment": {
      if (typeof body === "string" && type === "block") {
        ctx.tree.push(takeBlockEl(ctx, { kind: "xmlComment", value: `<!-- ${body} -->` }));
      }
      return true;
    }
    case "nomarkdown": {
      if (typeof body === "string" && type === "block") {
        ctx.tree.push(takeBlockEl(ctx, { kind: "raw", value: body }));
      }
      return true;
    }
    case "options": {
      if (type === "block") ctx.tree.push(takeBlockEl(ctx, { kind: "eob", value: "extension" }));
      return true;
    }
    default: {
      ctx.pos = savedPos;
      return false;
    }
  }
}

function parseFootnoteMarker(
  text: string,
  start: number,
  state: KramdownState,
): { html: string; next: number } | null {
  const m = /^\[\^(\w[\w-]*)\]/.exec(text.slice(start));
  if (m === null) return null;
  const def = state.footnotes.get(m[1]);
  if (def === undefined) return null;
  let entry = state.footnoteOrder.find((e) => e.name === m[1]);
  if (entry === undefined) {
    entry = { name: m[1], repeats: 0 };
    state.footnoteOrder.push(entry);
  } else {
    entry.repeats += 1;
  }
  const number = state.footnoteOrder.indexOf(entry) + 1;
  const suffix = entry.repeats === 0 ? "" : `:${entry.repeats}`;
  const attrs: [string, string][] = [];
  const ial = state.footnoteIals.get(m[1]);
  if (ial !== undefined) applyIal(attrs, ial, state);
  return {
    html: `<sup id="fnref:${m[1]}${suffix}"${htmlAttributes(attrs)}><a href="#fn:${m[1]}" class="footnote" rel="footnote" role="doc-noteref">${number}</a></sup>`,
    next: start + m[0].length,
  };
}

function parseSpanHtml(
  text: string,
  start: number,
  state: KramdownState,
): { kind: "text"; html: string; next: number } | { kind: "el"; seg: SpanSeg; next: number } | null {
  const at = text.slice(start);
  const comment = /^<!--[\s\S]*?-->/.exec(at);
  if (comment !== null) {
    return { html: comment[0], next: start + comment[0].length, isText: true } as never;
  }
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>/.exec(at);
  if (cdata !== null) {
    return { html: escapeHtmlText(cdata[1]), next: start + cdata[0].length, isText: true } as never;
  }
  const closeTag = /^<\/([\p{L}_][-\p{L}\p{N}._:]*)\s*>/u.exec(at);
  if (closeTag !== null) {
    return { html: escapeHtmlText(closeTag[0]), next: start + closeTag[0].length, isText: true } as never;
  }
  const openTag = HTML_TAG_RE.exec(at);
  if (openTag === null) {
    return null;
  }
  let tagName = openTag[1];
  if (HTML_KNOWN_ELEMENTS.has(tagName.toLowerCase())) tagName = tagName.toLowerCase();
  if (HTML_BLOCK_ELEMENTS.has(tagName)) {
    return { html: escapeHtmlText(openTag[0]), next: start + openTag[0].length, isText: true } as never;
  }
  const attrs = parseHtmlAttributes(openTag[2] ?? "", HTML_KNOWN_ELEMENTS.has(tagName));
  for (const attr of attrs) {
    if (attr[1] !== "") attr[1] = attr[1].replace(/\n+/g, " ");
  }
  let doParsing = HTML_CONTENT_MODEL[tagName] !== "raw";
  const mdIdx = attrs.findIndex(([n]) => n === "markdown");
  if (mdIdx >= 0) {
    const val = attrs[mdIdx][1];
    attrs.splice(mdIdx, 1);
    if (val === "span") doParsing = true;
    else if (val === "raw") doParsing = false;
    else if (val === "default" || val === "1") doParsing = HTML_CONTENT_MODEL[tagName] !== "raw";
  }
  const isClosed = openTag[4] !== undefined;
  const seg: SpanSeg = { t: "el", tag: tagName, attrs, children: [] };
  const next0 = start + openTag[0].length;
  if (isClosed || HTML_ELEMENTS_WITHOUT_BODY.has(seg.tag)) {
    return { kind: "el", seg, next: next0 };
  }
  const stopRe = new RegExp(
    `</${escapeRegExp(seg.tag)}\\s*>`,
    HTML_KNOWN_ELEMENTS.has(seg.tag) ? "gim" : "gm",
  );
  const rest = text.slice(next0);
  const stopMatch = stopRe.exec(rest);
  if (!doParsing) {
    const bodyEnd = stopMatch === null ? rest.length : stopMatch.index;
    const body = rest.slice(0, bodyEnd);
    seg.children = walkSpanHtmlOnly(body);
    if (stopMatch === null) return { kind: "el", seg, next: text.length };
    return { kind: "el", seg, next: next0 + bodyEnd + stopMatch[0].length };
  }
  const walked = parseSpans(bodyOf(rest, stopMatch), new Set(), state, {});
  seg.children = walked.segs;
  if (stopMatch === null) return { kind: "el", seg, next: text.length };
  return { kind: "el", seg, next: next0 + stopMatch.index + stopMatch[0].length };
}

function bodyOf(rest: string, stopMatch: RegExpExecArray | null): string {
  return stopMatch === null ? rest : rest.slice(0, stopMatch.index);
}

function walkSpanHtmlOnly(text: string): SpanSeg[] {
  const segs: SpanSeg[] = [];
  let run = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "<") {
      const inner = parseSpanHtml(text, i, makeKramdownState());
      if (inner !== null && inner.kind === "el") {
        if (run !== "") {
          segs.push({ t: "s", s: escapeHtmlText(run) });
          run = "";
        }
        segs.push(inner.seg);
        i = inner.next;
        continue;
      }
    }
    run += text[i];
    i += 1;
  }
  if (run !== "") segs.push({ t: "s", s: escapeHtmlText(run) });
  return segs;
}

function parseSpanExtension(
  text: string,
  start: number,
  state: KramdownState,
  lastElSeg: SpanSeg | undefined,
): { html: string | undefined; next: number } | null {
  const at = text.slice(start);
  const extStart = /^\{::(\w+)(?:\s((?:\\}|[^}])*?)|)(\/)?\}|^\{:\/(?:(\w[\w-]*))?\}/.exec(at);
  if (extStart !== null) {
    const isStopTag = extStart[0].startsWith("{:/");
    if (isStopTag) {
      return { html: escapeHtmlText("{"), next: start + 1 };
    }
    const ext = extStart[1]!;
    const selfClosing = extStart[3] !== undefined;
    const opts = parseAttributeList(extStart[2] ?? "");
    let body: string | undefined;
    if (!selfClosing) {
      const stopRe = new RegExp(`\\{:/(?:${escapeRegExp(ext)})?\\}`, "g");
      stopRe.lastIndex = start + extStart[0].length;
      const stop = stopRe.exec(text);
      if (stop === null) return { html: escapeHtmlText("{"), next: start + 1 };
      body = text.slice(start + extStart[0].length, stop.index);
      if (ext === "comment") {
        return { html: `<!-- ${body} -->`, next: stop.index + stop[0].length };
      }
      if (ext === "nomarkdown") {
        return { html: body, next: stop.index + stop[0].length };
      }
      if (ext === "options") {
        void opts;
        return { html: undefined, next: stop.index + stop[0].length };
      }
      return { html: escapeHtmlText("{"), next: start + 1 };
    }
    if (ext === "comment" || ext === "nomarkdown") {
      return { html: "", next: start + extStart[0].length };
    }
    return { html: undefined, next: start + extStart[0].length };
  }
  const ialMatch = /^\{:((?:\\}|[^}])+)\}/.exec(at);
  if (ialMatch !== null) {
    if (lastElSeg !== undefined && lastElSeg.t === "el") {
      const attr = parseAttributeList(ialMatch[1]);
      applyIal(lastElSeg.attrs, attr, state);
      return { html: undefined, next: start + ialMatch[0].length };
    }
    return { html: escapeHtmlText("{"), next: start + 1 };
  }
  return null;
}

function replaceAbbreviations(text: string, state: KramdownState): string {
  const keys = [...state.abbrevs.keys()].sort((a, b) => b.length - a.length);
  if (keys.length === 0) return escapeHtmlText(text);
  const escapedKeys = keys.map((k) => escapeRegExp(k).replace(/\\ /g, "[\\s\\p{Z}]+"));
  const union = escapedKeys.join("|");
  const abbrRe = new RegExp(`(?:${union})`, "yu");
  const boundaryRe = new RegExp(`(?=(?:\\W|^)(?:${union})(?!\\w))`, "gu");
  let out = "";
  let pos = 0;
  for (;;) {
    boundaryRe.lastIndex = pos;
    const bm = boundaryRe.exec(text);
    if (bm === null) break;
    const upto = bm.index;
    let temp = text.slice(pos, upto);
    abbrRe.lastIndex = upto;
    let abbr = abbrRe.exec(text)?.[0] ?? null;
    if (abbr === null) {
      const atLineStart = upto === 0 || text[upto - 1] === "\n";
      if (!atLineStart && upto < text.length) {
        temp += text[upto];
        abbrRe.lastIndex = upto + 1;
        abbr = abbrRe.exec(text)?.[0] ?? null;
        pos = abbr !== null ? upto + 1 + abbr.length : upto + 1;
      } else {
        pos = upto;
      }
    } else {
      pos = upto + abbr.length;
    }
    if (temp !== "") out += escapeHtmlText(temp);
    if (abbr !== null) {
      const title = state.abbrevs.get(abbr) ?? "";
      const attrs: [string, string][] = [];
      const ial = state.abbrevIals.get(abbr);
      if (ial !== undefined) applyIal(attrs, ial, state);
      if (title !== "") attrs.push(["title", title]);
      out += `<abbr${htmlAttributes(attrs)}>${abbr}</abbr>`;
    }
    if (pos >= text.length) break;
    if (bm.index === pos && abbr === null) break;
  }
  if (pos < text.length) out += escapeHtmlText(text.slice(pos));
  return out;
}

function convertTableHtml(
  block: Extract<KBlock, { kind: "table" }>,
  state: KramdownState,
  indent: number,
): string {
  const pad = " ".repeat(indent);
  const attrs = ialAppliedAttrs(block, state);
  let inner = "";
  for (const section of block.sections) {
    inner += `${pad}  <${section.type}>\n`;
    for (const row of section.rows) {
      inner += `${pad}    <tr>\n`;
      row.forEach((cellText, ci) => {
        const type = section.type === "thead" ? "th" : "td";
        const cellAttrs: [string, string][] = [];
        const alignment = block.alignment[ci] ?? "default";
        if (alignment !== "default") cellAttrs.push(["style", `text-align: ${alignment}`]);
        const res = parseSpans(cellText, new Set(), state).html;
        const body = res === "" ? "&nbsp;" : res;
        inner += `${pad}      <${type}${htmlAttributes(cellAttrs)}>${body}</${type}>\n`;
      });
      inner += `${pad}    </tr>\n`;
    }
    inner += `${pad}  </${section.type}>\n`;
  }
  return `${pad}<table${htmlAttributes(attrs)}>\n${inner}${pad}</table>\n`;
}

function convertHtmlBlockHtml(
  block: Extract<KBlock, { kind: "htmlBlock" }>,
  state: KramdownState,
  indent: number,
): string {
  const pad = " ".repeat(indent);
  const attrs = ialAppliedAttrs(block, state);
  const content = block.content as { raw?: HtmlRawNode[]; blocks?: KBlock[] };
  let res: string;
  if (content.raw !== undefined) {
    res = renderRawNodes(content.raw, state, true);
  } else {
    res = convertBlocks(content.blocks ?? [], state, indent + 2);
  }
  let out = "";
  out += `${pad}<${block.tag}${htmlAttributes(attrs)}`;
  if (res === "" && HTML_ELEMENTS_WITHOUT_BODY.has(block.tag)) {
    out += " />";
  } else if (res !== "") {
    out += `>${res}</${block.tag}>`;
  } else {
    out += `></${block.tag}>`;
  }
  out += "\n";
  return out;
}

function renderRawNodes(
  nodes: readonly HtmlRawNode[],
  state: KramdownState,
  suppressFraming: boolean,
): string {
  void state;
  void suppressFraming;
  let out = "";
  for (const node of nodes) {
    if ("text" in node) out += escapeHtmlText(node.text);
    else if ("comment" in node) out += node.comment;
    else {
      const el = node.el;
      const open = `<${el.tag}${htmlAttributes(el.attrs)}`;
      const res = renderRawNodes(el.children, state, true);
      if (el.isClosed) out += `${open} />`;
      else if (res !== "") out += `${open}>${res}</${el.tag}>`;
      else if (HTML_ELEMENTS_WITHOUT_BODY.has(el.tag)) out += `${open} />`;
      else out += `${open}></${el.tag}>`;
    }
  }
  return out;
}

function footnoteContentHtml(state: KramdownState): string {
  if (state.footnoteOrder.length === 0) return "";
  let lis = "";
  for (const entry of state.footnoteOrder) {
    const blocks = state.footnotes.get(entry.name) ?? [];
    let inner = convertBlocks(blocks, state, 6);
    const backlink = `<a href="#fnref:${entry.name}" class="reversefootnote" role="doc-backlink">&#8617;</a>`;
    const lastPClose = inner.lastIndexOf("</p>\n");
    if (lastPClose >= 0) {
      inner = `${inner.slice(0, lastPClose)}\u00a0${backlink}${inner.slice(lastPClose)}`;
    } else {
      inner += `      <p>${backlink}</p>\n`;
    }
    lis += `    <li id="fn:${entry.name}">\n${inner}    </li>\n`;
  }
  return `<div class="footnotes" role="doc-endnotes">\n  <ol>\n${lis}  </ol>\n</div>\n`;
}
