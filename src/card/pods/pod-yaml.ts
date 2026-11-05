export class YamlSymbol {
  constructor(readonly name: string) {}
  toString(): string {
    return `:${this.name}`;
  }
}

export class YamlMap {
  readonly entries: [YamlValue, YamlValue][] = [];
  constructor(entries: [YamlValue, YamlValue][] = []) {
    this.entries.push(...entries);
  }
  get(key: string | YamlSymbol): YamlValue | undefined {
    for (const [k, v] of this.entries) if (sameKey(k, key)) return v;
    return undefined;
  }
  set(key: YamlValue, value: YamlValue): this {
    for (const e of this.entries) {
      if (sameKey(e[0], key)) {
        e[1] = value;
        return this;
      }
    }
    this.entries.push([key, value]);
    return this;
  }
}

export type YamlValue = string | YamlSymbol | null | boolean | number | YamlValue[] | YamlMap;

function sameKey(a: YamlValue, b: YamlValue): boolean {
  if (a instanceof YamlSymbol && b instanceof YamlSymbol) return a.name === b.name;
  return a === b;
}

export const sym = (name: string): YamlSymbol => new YamlSymbol(name);

const RE_STRINGISH = /^[^\d.:-]?[\p{Alphabetic}_\s!@#$%^&*(){}<>|/\\~;=]+/u;
const RE_TIME =
  /^-?\d{4}-\d{1,2}-\d{1,2}(?:[Tt]|\s+)\d{1,2}:\d\d:\d\d(?:\.\d*)?(?:\s*(?:Z|[-+]\d{1,2}:?(?:\d\d)?))?$/;
const RE_DATE = /^\d{4}-(?:1[012]|0\d|\d)-(?:[12]\d|3[01]|0\d|\d)$/;
const RE_FLOAT = /^(?:[-+]?([0-9][0-9_,]*)?\.[0-9]*([eE][-+][0-9]+)?)$/;
const RE_INTEGER_LEGACY =
  /^(?:[-+]?0b[0-1_,]+|[-+]?0[0-7_,]+|[-+]?(?:0|[1-9](?:[0-9]|,[0-9]|_[0-9])*)|[-+]?0x[0-9a-fA-F_,]+)$/;
const RE_SEXAGESIMAL_INT = /^[-+]?[0-9][0-9_]*(:[0-5]?[0-9]){1,2}$/;
const RE_SEXAGESIMAL_FLOAT = /^[-+]?[0-9][0-9_]*(:[0-5]?[0-9]){1,2}\.[0-9_]*$/;

export function psychReadsAsString(s: string): boolean {
  if (s === "") return false;
  if (RE_STRINGISH.test(s) || s.includes("\n")) {
    if ([...s].length > 5) return true;
    if (/^[^ytonf~]/i.test(s)) return true;
    if (s === "~" || /^null$/i.test(s)) return false;
    if (/^(yes|true|on)$/i.test(s)) return false;
    if (/^(no|false|off)$/i.test(s)) return false;
    return true;
  }
  if (RE_TIME.test(s)) return !validTime(s);
  if (RE_DATE.test(s)) return !validDate(s);
  if (/^\+?\.inf$/i.test(s) || /^-\.inf$/i.test(s) || /^\.nan$/i.test(s)) return false;
  if (/^:./.test(s)) return false;
  if (RE_SEXAGESIMAL_INT.test(s) || RE_SEXAGESIMAL_FLOAT.test(s)) return false;
  if (RE_FLOAT.test(s)) return /^[-+]?\.$/.test(s);
  if (RE_INTEGER_LEGACY.test(s)) return false;
  return true;
}

function validDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days;
}

function validTime(s: string): boolean {
  const date = /^(-?\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const time = /(\d+):(\d+):(\d+)/.exec(s.slice(date![0].length));
  if (date === null || time === null) return false;
  const [m, d] = [Number(date[2]), Number(date[3])];
  const [hh, mm, ss] = [Number(time[1]), Number(time[2]), Number(time[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 && hh <= 24 && mm <= 59 && ss <= 60;
}

const isBreak = (c: number): boolean => c === 0x0d || c === 0x0a || c === 0x85 || c === 0x2028 || c === 0x2029;
const isSpace = (c: number): boolean => c === 0x20;
const isBlankz = (c: number | undefined): boolean =>
  c === undefined || c === 0x20 || c === 0x09 || isBreak(c) || c === 0;
const isPrintable = (c: number): boolean =>
  c === 0x0a ||
  (c >= 0x20 && c <= 0x7e) ||
  (c >= 0xa0 && c <= 0xd7ff) ||
  (c >= 0xe000 && c <= 0xfffd && c !== 0xfeff);

interface ScalarAnalysis {
  multiline: boolean;
  blockPlainAllowed: boolean;
  singleQuotedAllowed: boolean;
  blockAllowed: boolean;
  empty: boolean;
}

function analyzeScalar(value: string): ScalarAnalysis {
  const cs = [...value].map((ch) => ch.codePointAt(0)!);
  if (cs.length === 0) {
    return { multiline: false, blockPlainAllowed: true, singleQuotedAllowed: true, blockAllowed: false, empty: true };
  }
  let blockIndicators = false;
  let lineBreaks = false;
  let specialCharacters = false;
  let leadingSpace = false;
  let leadingBreak = false;
  let trailingSpace = false;
  let trailingBreak = false;
  let breakSpace = false;
  let spaceBreak = false;
  let previousSpace = false;
  let previousBreak = false;
  if (value.startsWith("---") || value.startsWith("...")) blockIndicators = true;
  let precededByWhitespace = true;
  let followedByWhitespace = isBlankz(cs[1]);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (i === 0) {
      if ("#,[]{}&*!|>'\"%@`".includes(String.fromCodePoint(c))) blockIndicators = true;
      if ((c === 0x3f || c === 0x3a) && followedByWhitespace) blockIndicators = true;
      if (c === 0x2d && followedByWhitespace) blockIndicators = true;
    } else {
      if (c === 0x3a && followedByWhitespace) blockIndicators = true;
      if (c === 0x23 && precededByWhitespace) blockIndicators = true;
    }
    if (!isPrintable(c)) specialCharacters = true;
    if (isBreak(c)) lineBreaks = true;
    if (isSpace(c)) {
      if (i === 0) leadingSpace = true;
      if (i === cs.length - 1) trailingSpace = true;
      if (previousBreak) breakSpace = true;
      previousSpace = true;
      previousBreak = false;
    } else if (isBreak(c)) {
      if (i === 0) leadingBreak = true;
      if (i === cs.length - 1) trailingBreak = true;
      if (previousSpace) spaceBreak = true;
      previousSpace = false;
      previousBreak = true;
    } else {
      previousSpace = false;
      previousBreak = false;
    }
    precededByWhitespace = isBlankz(c);
    if (i + 1 < cs.length) followedByWhitespace = isBlankz(cs[i + 2]);
  }
  let blockPlainAllowed = true;
  let singleQuotedAllowed = true;
  let blockAllowed = true;
  if (leadingSpace || leadingBreak || trailingSpace || trailingBreak) blockPlainAllowed = false;
  if (trailingSpace) blockAllowed = false;
  if (breakSpace) {
    blockPlainAllowed = false;
    singleQuotedAllowed = false;
  }
  if (spaceBreak || specialCharacters) {
    blockPlainAllowed = false;
    singleQuotedAllowed = false;
    blockAllowed = false;
  }
  if (lineBreaks) blockPlainAllowed = false;
  if (blockIndicators) blockPlainAllowed = false;
  return { multiline: lineBreaks, blockPlainAllowed, singleQuotedAllowed, blockAllowed, empty: false };
}

type Style = "plain" | "single" | "double" | "literal";

interface ScalarEvent {
  value: string;
  style: Style | "any";
  plainImplicit: boolean;
  tag?: string;
}

function scalarEvent(value: YamlValue): ScalarEvent {
  if (value === null) return { value: "", style: "any", plainImplicit: true };
  if (value === true || value === false) return { value: String(value), style: "any", plainImplicit: true };
  if (typeof value === "number") return { value: String(value), style: "any", plainImplicit: true };
  if (value instanceof YamlSymbol) return { value: `:${value.name}`, style: "any", plainImplicit: true };
  const o = value as string;
  let style: Style = "plain";
  if (/\n(?!\n?$)/.test(o)) {
    style = "literal";
  } else if (o === "<<") {
    style = "single";
  } else if (o === "y" || o === "n") {
    style = "double";
  } else if (rubyLineAnchored(o, /^[^\p{L}\p{M}\p{Nd}\p{Pc}][^"]*$/u)) {
    style = "double";
  } else if (!psychReadsAsString(o) || /^0[0-7]*[89]/.test(o)) {
    style = "single";
  }
  return { value: o, style, plainImplicit: o !== "<<", ...(o === "<<" ? { tag: "!!str" } : {}) };
}

function rubyLineAnchored(s: string, re: RegExp): boolean {
  return new RegExp(re.source, `${re.flags.replace("m", "")}m`).test(s);
}

const BEST_INDENT = 2;
const BEST_WIDTH = 80;

class Emitter {
  out = "";
  column = 0;
  whitespace = true;
  indention = true;
  indent = -1;
  openEnded = false;

  put(ch: string): void {
    this.out += ch;
    this.column += 1;
  }
  putBreak(): void {
    this.out += "\n";
    this.column = 0;
  }
  write(ch: string): void {
    this.out += ch;
    this.column += 1;
  }
  writeBreak(ch: string): void {
    if (ch === "\n") this.putBreak();
    else {
      this.out += ch;
      this.column = 0;
    }
  }
  writeIndent(): void {
    const indent = this.indent >= 0 ? this.indent : 0;
    if (!this.indention || this.column > indent || (this.column === indent && !this.whitespace)) {
      this.putBreak();
    }
    while (this.column < indent) this.put(" ");
    this.whitespace = true;
    this.indention = true;
  }
  writeIndicator(indicator: string, needWhitespace: boolean, isWhitespace: boolean, isIndention: boolean): void {
    if (needWhitespace && !this.whitespace) this.put(" ");
    for (const ch of indicator) this.write(ch);
    this.whitespace = isWhitespace;
    this.indention = this.indention && isIndention;
  }

  scalar(value: YamlValue, simpleKey: boolean): void {
    const event = scalarEvent(value);
    const analysis = analyzeScalar(event.value);
    let style: Style = event.style === "any" ? "plain" : event.style;
    if (simpleKey && analysis.multiline) style = "double";
    if (style === "plain") {
      if (!analysis.blockPlainAllowed) style = "single";
      if (analysis.empty && simpleKey) style = "single";
      if (!event.plainImplicit) style = "single";
    }
    if (style === "single" && !analysis.singleQuotedAllowed) style = "double";
    if (style === "literal" && (!analysis.blockAllowed || simpleKey)) style = "double";
    if (event.tag !== undefined) {
      this.writeIndicator(event.tag, true, false, false);
    }
    const saved = this.indent;
    this.indent = this.indent < 0 ? BEST_INDENT : this.indent + BEST_INDENT;
    if (this.indent < 0) this.indent = 0;
    const allowBreaks = !simpleKey;
    this.openEnded = false;
    if (style === "plain") this.writePlain(event.value, allowBreaks);
    else if (style === "single") this.writeSingle(event.value, allowBreaks);
    else if (style === "double") this.writeDouble(event.value, allowBreaks);
    else this.writeLiteral(event.value);
    this.indent = saved;
  }

  writePlain(value: string, allowBreaks: boolean): void {
    const cs = [...value];
    if (!this.whitespace && cs.length > 0) this.put(" ");
    let spaces = false;
    let breaks = false;
    for (let i = 0; i < cs.length; i++) {
      const ch = cs[i];
      const c = ch.codePointAt(0)!;
      if (isSpace(c)) {
        if (allowBreaks && !spaces && this.column > BEST_WIDTH && cs[i + 1] !== " ") {
          this.writeIndent();
        } else {
          this.write(ch);
        }
        spaces = true;
      } else if (isBreak(c)) {
        if (!breaks && ch === "\n") this.putBreak();
        this.writeBreak(ch);
        this.indention = true;
        breaks = true;
      } else {
        if (breaks) this.writeIndent();
        this.write(ch);
        this.indention = false;
        spaces = false;
        breaks = false;
      }
    }
    this.whitespace = false;
    this.indention = false;
  }

  writeSingle(value: string, allowBreaks: boolean): void {
    const cs = [...value];
    this.writeIndicator("'", true, false, false);
    let spaces = false;
    let breaks = false;
    for (let i = 0; i < cs.length; i++) {
      const ch = cs[i];
      const c = ch.codePointAt(0)!;
      if (isSpace(c)) {
        if (allowBreaks && !spaces && this.column > BEST_WIDTH && i !== 0 && i !== cs.length - 1 && cs[i + 1] !== " ") {
          this.writeIndent();
        } else {
          this.write(ch);
        }
        spaces = true;
      } else if (isBreak(c)) {
        if (!breaks && ch === "\n") this.putBreak();
        this.writeBreak(ch);
        this.indention = true;
        breaks = true;
      } else {
        if (breaks) this.writeIndent();
        if (ch === "'") this.put("'");
        this.write(ch);
        this.indention = false;
        spaces = false;
        breaks = false;
      }
    }
    if (breaks) this.writeIndent();
    this.writeIndicator("'", false, false, false);
    this.whitespace = false;
    this.indention = false;
  }

  writeDouble(value: string, allowBreaks: boolean): void {
    const cs = [...value];
    this.writeIndicator('"', true, false, false);
    let spaces = false;
    for (let i = 0; i < cs.length; i++) {
      const ch = cs[i];
      const c = ch.codePointAt(0)!;
      if (!isPrintable(c) || c === 0xfeff || isBreak(c) || ch === '"' || ch === "\\") {
        this.put("\\");
        const named: Record<number, string> = {
          0x00: "0", 0x07: "a", 0x08: "b", 0x09: "t", 0x0a: "n", 0x0b: "v", 0x0c: "f", 0x0d: "r",
          0x1b: "e", 0x22: '"', 0x5c: "\\", 0x85: "N", 0xa0: "_", 0x2028: "L", 0x2029: "P",
        };
        if (named[c] !== undefined) this.put(named[c]);
        else {
          const [letter, width] = c <= 0xff ? ["x", 2] : c <= 0xffff ? ["u", 4] : ["U", 8];
          this.put(letter as string);
          for (const d of c.toString(16).toUpperCase().padStart(width as number, "0")) this.put(d);
        }
        spaces = false;
      } else if (isSpace(c)) {
        if (allowBreaks && !spaces && this.column > BEST_WIDTH && i !== 0 && i !== cs.length - 1) {
          this.writeIndent();
          if (cs[i + 1] === " ") this.put("\\");
        } else {
          this.write(ch);
        }
        spaces = true;
      } else {
        this.write(ch);
        spaces = false;
      }
    }
    this.writeIndicator('"', false, false, false);
    this.whitespace = false;
    this.indention = false;
  }

  writeLiteral(value: string): void {
    const cs = [...value];
    this.writeIndicator("|", true, false, false);
    const first = cs[0]?.codePointAt(0);
    if (first !== undefined && (isSpace(first) || isBreak(first))) {
      this.writeIndicator(String(BEST_INDENT), false, false, false);
    }
    let chomp: string | undefined;
    const last = cs.at(-1)?.codePointAt(0);
    if (last === undefined || !isBreak(last)) chomp = "-";
    else if (cs.length === 1) {
      chomp = "+";
      this.openEnded = true;
    } else {
      const prev = cs.at(-2)!.codePointAt(0)!;
      if (isBreak(prev)) {
        chomp = "+";
        this.openEnded = true;
      }
    }
    if (chomp !== undefined) this.writeIndicator(chomp, false, false, false);
    this.putBreak();
    this.indention = true;
    this.whitespace = true;
    let breaks = true;
    for (const ch of cs) {
      const c = ch.codePointAt(0)!;
      if (isBreak(c)) {
        this.writeBreak(ch);
        this.indention = true;
        breaks = true;
      } else {
        if (breaks) this.writeIndent();
        this.write(ch);
        this.indention = false;
        breaks = false;
      }
    }
  }

  node(value: YamlValue, ctx: { mappingValue: boolean }): void {
    if (Array.isArray(value)) this.sequence(value, ctx);
    else if (value instanceof YamlMap) this.mapping(value);
    else this.scalar(value, false);
  }

  sequence(items: YamlValue[], ctx: { mappingValue: boolean }): void {
    if (items.length === 0) {
      this.writeIndicator("[]", true, false, false);
      return;
    }
    const saved = this.indent;
    const indentless = ctx.mappingValue && !this.indention;
    if (this.indent < 0) this.indent = 0;
    else if (!indentless) this.indent += BEST_INDENT;
    for (const item of items) {
      this.writeIndent();
      this.writeIndicator("-", true, false, true);
      this.node(item, { mappingValue: false });
    }
    this.indent = saved;
  }

  mapping(map: YamlMap): void {
    if (map.entries.length === 0) {
      this.writeIndicator("{}", true, false, false);
      return;
    }
    const saved = this.indent;
    this.indent = this.indent < 0 ? 0 : this.indent + BEST_INDENT;
    for (const [k, v] of map.entries) {
      this.writeIndent();
      this.scalar(k, true);
      this.writeIndicator(":", false, false, false);
      this.node(v, { mappingValue: true });
    }
    this.indent = saved;
  }
}

export function dumpYaml(value: YamlValue): string {
  const e = new Emitter();
  e.writeIndicator("---", true, false, false);
  if ((Array.isArray(value) && value.length > 0) || (value instanceof YamlMap && value.entries.length > 0)) {
    e.node(value, { mappingValue: false });
  } else {
    e.node(value, { mappingValue: false });
  }
  e.indent = -1;
  e.writeIndent();
  if (e.openEnded) {
    e.writeIndicator("...", true, false, false);
    e.writeIndent();
  }
  return e.out;
}

export class PodYamlError extends Error {
  constructor(message: string, line: number) {
    super(`pod YAML, line ${line + 1}: ${message}`);
    this.name = "PodYamlError";
  }
}

export function resolvePlain(s: string): YamlValue {
  if (s === "" || s === "~" || /^null$/i.test(s)) return null;
  if (psychReadsAsString(s)) return s;
  if (/^:./.test(s)) {
    const quoted = /^:(["'])(.*)\1/s.exec(s);
    return sym(quoted !== null ? quoted[2].replace(/^:/, "") : s.slice(1));
  }
  if (/^(yes|true|on)$/i.test(s)) return true;
  if (/^(no|false|off)$/i.test(s)) return false;
  if (RE_INTEGER_LEGACY.test(s) && /^[-+]?(?:0|[1-9][0-9_,]*)$/.test(s)) return Number(s.replace(/[,_]/g, ""));
  return s;
}

export function loadYaml(text: string): YamlValue {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const p = new Parser(lines);
  return p.document();
}

class Parser {
  i = 0;
  constructor(readonly lines: string[]) {}

  fail(message: string): never {
    throw new PodYamlError(message, this.i);
  }

  indentOf(line: string): number {
    return line.length - line.trimStart().length;
  }

  skipBlank(): void {
    while (this.i < this.lines.length && /^\s*(#.*)?$/.test(this.lines[this.i])) this.i++;
  }

  document(): YamlValue {
    this.skipBlank();
    if (this.i >= this.lines.length) return null;
    let line = this.lines[this.i];
    if (line.startsWith("---")) {
      const rest = line.slice(3).trim();
      this.i++;
      if (rest !== "") return this.inlineValue(rest, 0);
    }
    this.skipBlank();
    if (this.i >= this.lines.length) return null;
    line = this.lines[this.i];
    return this.block(this.indentOf(line));
  }

  inlineValue(text: string, contIndent: number): YamlValue {
    if (text.startsWith("!!str ")) {
      const v = this.inlineValue(text.slice(6), contIndent);
      return typeof v === "string" ? v : v === null ? "" : String(v);
    }
    if (text === "[]") return [];
    if (text === "{}") return new YamlMap();
    if (text.startsWith('"')) return this.doubleQuoted(text, contIndent);
    if (text.startsWith("'")) return this.singleQuoted(text, contIndent);
    if (/^[|>]/.test(text)) return this.blockScalar(text, contIndent);
    return this.plain(text, contIndent);
  }

  block(indent: number): YamlValue {
    const line = this.lines[this.i];
    const body = line.slice(indent);
    if (body === "-" || body.startsWith("- ")) return this.seq(indent);
    return this.map(indent);
  }

  seq(indent: number): YamlValue[] {
    const out: YamlValue[] = [];
    while (this.i < this.lines.length) {
      this.skipBlank();
      if (this.i >= this.lines.length) break;
      const line = this.lines[this.i];
      if (this.indentOf(line) !== indent) break;
      const body = line.slice(indent);
      if (!(body === "-" || body.startsWith("- "))) break;
      const rest = body.slice(1).trimStart();
      if (rest === "") {
        this.i++;
        this.skipBlank();
        out.push(this.block(this.indentOf(this.lines[this.i])));
      } else if (this.looksLikeKey(rest)) {
        const keyIndent = indent + (body.length - rest.length);
        this.lines[this.i] = " ".repeat(keyIndent) + rest;
        out.push(this.map(keyIndent));
      } else {
        this.i++;
        out.push(this.inlineValue(rest, indent + 2));
      }
    }
    return out;
  }

  looksLikeKey(text: string): boolean {
    return this.splitKey(text) !== undefined;
  }

  splitKey(text: string): { key: YamlValue; rest: string } | undefined {
    if (text.startsWith('"') || text.startsWith("'")) {
      const q = text[0];
      let j = 1;
      while (j < text.length) {
        if (q === "'" && text[j] === "'" && text[j + 1] === "'") j += 2;
        else if (q === '"' && text[j] === "\\") j += 2;
        else if (text[j] === q) break;
        else j++;
      }
      const after = text.slice(j + 1);
      if (!(after === ":" || after.startsWith(": "))) return undefined;
      const key = q === '"' ? this.doubleQuoted(text.slice(0, j + 1), 0, true) : this.singleQuoted(text.slice(0, j + 1), 0, true);
      return { key, rest: after.slice(1).trimStart() };
    }
    const m = /^(.*?):(?: (.*)|)$/s.exec(text);
    if (m === null) return undefined;
    const idx = text.search(/:( |$)/);
    if (idx <= 0 && !text.startsWith(":")) return undefined;
    let cut = idx;
    if (text.startsWith(":")) {
      const rest = text.slice(1);
      const k = rest.search(/:( |$)/);
      if (k < 0) return undefined;
      cut = k + 1;
    }
    return { key: resolvePlain(text.slice(0, cut)), rest: text.slice(cut + 1).trimStart() };
  }

  map(indent: number): YamlMap {
    const out = new YamlMap();
    while (this.i < this.lines.length) {
      this.skipBlank();
      if (this.i >= this.lines.length) break;
      const line = this.lines[this.i];
      if (this.indentOf(line) !== indent) break;
      const body = line.slice(indent);
      if (body.startsWith("- ") || body === "-") break;
      const kv = this.splitKey(body);
      if (kv === undefined) this.fail(`expected a mapping key: ${body}`);
      if (kv.rest === "") {
        this.i++;
        this.skipBlank();
        const next = this.lines[this.i];
        if (next !== undefined) {
          const ni = this.indentOf(next);
          const nb = next.slice(ni);
          if (ni > indent || (ni === indent && (nb.startsWith("- ") || nb === "-"))) {
            out.set(kv.key, this.block(ni));
            continue;
          }
        }
        out.set(kv.key, null);
      } else {
        this.i++;
        out.set(kv.key, this.inlineValue(kv.rest, indent + 2));
      }
    }
    return out;
  }

  continuation(contIndent: number, stop: (joined: string) => boolean, first: string): string[] {
    const parts = [first];
    while (!stop(parts.join("\n")) && this.i < this.lines.length) {
      const line = this.lines[this.i];
      if (line.trim() !== "" && this.indentOf(line) < contIndent) break;
      parts.push(line);
      this.i++;
    }
    return parts;
  }

  plain(first: string, contIndent: number): YamlValue {
    const parts = [first];
    while (this.i < this.lines.length) {
      const line = this.lines[this.i];
      if (line.trim() !== "" && this.indentOf(line) < contIndent) break;
      if (line.trim() === "" ) {
        let j = this.i;
        while (j < this.lines.length && this.lines[j].trim() === "") j++;
        if (j >= this.lines.length || this.indentOf(this.lines[j]) < contIndent) break;
      }
      parts.push(line);
      this.i++;
    }
    return resolvePlain(keepOtherBreaks(foldFlow(parts.map((p) => p.replace(/^[ \t]+|[ \t]+$/g, "")))));
  }

  singleQuoted(first: string, contIndent: number, keyOnly = false): string {
    const closed = (s: string): boolean => /^'(?:[^']|'')*'\s*$/.test(s.replace(/\n/g, " "));
    const parts = keyOnly ? [first] : this.continuation(contIndent, closed, first);
    const joined = parts.join("\n");
    const inner = joined.trim().replace(/^'/, "").replace(/'\s*$/, "");
    const lines = inner.split("\n").map((l, k, a) => {
      let line = l;
      if (k > 0) line = line.replace(/^[ \t]+/, "");
      if (k < a.length - 1) line = line.replace(/[ \t]+$/, "");
      return line;
    });
    return keepOtherBreaks(foldFlow(lines)).replace(/''/g, "'");
  }

  doubleQuoted(first: string, contIndent: number, keyOnly = false): string {
    const closed = (s: string): boolean => {
      let j = 1;
      while (j < s.length) {
        if (s[j] === "\\") j += 2;
        else if (s[j] === '"') return true;
        else j++;
      }
      return false;
    };
    const parts = keyOnly ? [first] : this.continuation(contIndent, closed, first);
    const joined = parts.join("\n").trim();
    const inner = joined.slice(1, joined.lastIndexOf('"'));
    return unescapeDouble(inner);
  }

  blockScalar(header: string, contIndent: number): string {
    const m = /^([|>])([1-9])?([-+])?([1-9])?\s*$/.exec(header);
    if (m === null) this.fail(`unsupported block scalar header: ${header}`);
    const folded = m[1] === ">";
    const chomp = m[3] ?? "";
    const explicit = m[2] ?? m[4];
    const lines: string[] = [];
    let indent: number | undefined = explicit !== undefined ? contIndent - 2 + Number(explicit) : undefined;
    while (this.i < this.lines.length) {
      const line = this.lines[this.i];
      if (line.trim() === "") {
        lines.push("");
        this.i++;
        continue;
      }
      const li = this.indentOf(line);
      if (indent === undefined) indent = li;
      if (li < indent) break;
      lines.push(line.slice(indent));
      this.i++;
    }
    let trailing = 0;
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
      trailing++;
    }
    let body = folded ? foldBlock(lines) : lines.join("\n");
    if (chomp === "-") return body;
    if (lines.length > 0 || chomp === "+") body += "\n";
    if (chomp === "+") body += "\n".repeat(trailing);
    return body;
  }
}

function foldFlow(lines: string[]): string {
  let out = "";
  let pendingBreaks = 0;
  lines.forEach((line, k) => {
    if (k === 0) {
      out = line;
      return;
    }
    if (line === "" && k < lines.length - 1) {
      pendingBreaks++;
      return;
    }
    out += pendingBreaks > 0 ? "\n".repeat(pendingBreaks) : " ";
    pendingBreaks = 0;
    out += line;
  });
  if (pendingBreaks > 0) out += "\n".repeat(pendingBreaks);
  return out;
}

function keepOtherBreaks(s: string): string {
  return s.replace(new RegExp("([" + String.fromCharCode(0x85, 0x2028, 0x2029) + "])[ \\t]+", "g"), "$1");
}

function foldBlock(lines: string[]): string {
  return foldFlow(lines);
}

function unescapeDouble(inner: string): string {
  const rawLines = inner.split("\n");
  let folded = "";
  let pendingBreaks = 0;
  for (let k = 0; k < rawLines.length; k++) {
    let line = rawLines[k];
    if (k > 0) line = line.replace(/^[ \t]+/, "");
    const isLast = k === rawLines.length - 1;
    if (!isLast) line = line.replace(/(?<!\\)((?:\\\\)*)[ \t]+$/, "$1");
    if (k === 0) {
      folded = line;
    } else if (line === "" && !isLast) {
      pendingBreaks++;
      continue;
    } else {
      const prevEscaped = /(?<!\\)(\\\\)*\\$/.test(folded);
      if (prevEscaped) folded = folded.slice(0, -1);
      else folded += pendingBreaks > 0 ? "\n".repeat(pendingBreaks) : " ";
      pendingBreaks = 0;
      folded += line;
    }
  }
  let out = "";
  for (let j = 0; j < folded.length; j++) {
    const ch = folded[j];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const e = folded[++j];
    const simple: Record<string, string> = {
      "0": "\0", a: "\x07", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\v", f: "\f", r: "\r", e: "\x1b",
      " ": " ", '"': '"', "/": "/", "\\": "\\", N: "\u0085", _: "\u00a0", L: "\u2028", P: "\u2029",
    };
    if (simple[e] !== undefined) out += simple[e];
    else if (e === "x" || e === "u" || e === "U") {
      const width = e === "x" ? 2 : e === "u" ? 4 : 8;
      out += String.fromCodePoint(parseInt(folded.slice(j + 1, j + 1 + width), 16));
      j += width;
    } else {
      out += e;
    }
  }
  return out;
}
