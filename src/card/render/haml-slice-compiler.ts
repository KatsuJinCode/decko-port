export class HamlCompileError extends Error {
  constructor(message: string, public readonly rubyClassName = "Haml::SyntaxError") {
    super(message);
    this.name = rubyClassName;
  }
}

export class HamlUnsupportedError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly source: string,
  ) {
    super(`haml-slice: ${message} (line ${line}: ${JSON.stringify(source)})`);
    this.name = "HamlUnsupportedError";
  }
}

export interface HamlScope {
  locals: Record<string, unknown>;
  helpers: Record<string, (...args: unknown[]) => unknown>;
  instanceVariables?: Record<string, unknown>;
  receiverName?: string;
}

const HTML5_VOID = new Set([
  "area", "base", "br", "col", "command", "embed", "hr", "img", "input",
  "keygen", "link", "meta", "param", "source", "track", "wbr",
]);

type HamlNode =
  | { kind: "doctype"; dashes: boolean; spec: string | null; line: number }
  | { kind: "tag"; tag: string; attrs: AttrSpec; inline: InlineContent | null; children: HamlNode[]; line: number; selfClosed: boolean }
  | { kind: "text"; value: string; children: HamlNode[]; line: number }
  | { kind: "output"; expr: string; unescaped: boolean; children: HamlNode[]; line: number }
  | { kind: "script"; code: string; children: HamlNode[]; line: number }
  | { kind: "comment"; children: HamlNode[]; line: number }
  | { kind: "escapedHtml"; value: string; children: HamlNode[]; line: number }
  | { kind: "unescapedHtml"; value: string; children: HamlNode[]; line: number }
  | { kind: "notTag"; expr: string | null; literal: string | null; children: HamlNode[]; line: number }
  | { kind: "filter"; name: string; body: string[]; line: number };

type InlineContent =
  | { type: "text"; value: string }
  | { type: "output"; expr: string; unescaped: boolean }
  | { type: "interpolated"; template: string };

interface AttrSpec {
  id: string | null;
  classes: string[];
  hash: [string, string][] | null;
}

interface RawLine {
  indent: number;
  text: string;
  line: number;
}

function toRawLines(source: string): RawLine[] {
  const physical = source.replace(/\r\n/g, "\n").split("\n");
  const logical: { text: string; indent: number; line: number }[] = [];
  let buffer: { text: string; indent: number; line: number } | null = null;
  physical.forEach((raw, i) => {
    const indent = raw.length - raw.trimStart().length;
    const text = raw.trimEnd();
    if (buffer !== null) {
      buffer.text += ` ${text.trim()}`;
      if (matchBrace(buffer.text, buffer.text.indexOf("{")) >= 0) {
        logical.push(buffer);
        buffer = null;
      }
      return;
    }
    const open = text.indexOf("{");
    if (open >= 0 && matchBrace(text, open) < 0) {
      buffer = { text, indent, line: i + 1 };
      return;
    }
    logical.push({ text, indent, line: i + 1 });
  });
  if (buffer !== null) logical.push(buffer);
  return logical.filter((l) => l.text.trim() !== "");
}

class Parser {
  private readonly lines: RawLine[];
  private pos = 0;

  constructor(source: string) {
    this.lines = toRawLines(source);
  }

  parse(): HamlNode[] {
    return this.parseBlock(this.lines.length ? this.lines[0]!.indent : 0);
  }

  private parseBlock(indent: number): HamlNode[] {
    const out: HamlNode[] = [];
    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos]!;
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw new HamlCompileError(
          `Illegal nesting: content can't be nested within it (line ${line.line}).`,
        );
      }
      this.pos += 1;
      const node = this.parseLine(line);
      if (node.kind === "script" && /^(if|unless|case)\b/.test(node.code)) {
        node.children = [...node.children, ...collectSiblingBranches(this, indent)];
      }
      out.push(node);
    }
    return out;
  }

  private takeChildren(indent: number): HamlNode[] {
    const next = this.lines[this.pos];
    if (next && next.indent > indent) return this.parseBlock(next.indent);
    return [];
  }

  peekLine(): RawLine | undefined {
    return this.lines[this.pos];
  }

  advance(): void {
    this.pos += 1;
  }

  parseLine(line: RawLine): HamlNode {
    const t = line.text;
    const head = t.slice(line.indent);

    if (head.startsWith("!!!")) {
      const m = /^!!!(-)?\s*(.*)$/.exec(head)!;
      return {
        kind: "doctype",
        dashes: m[1] === "-",
        spec: m[2]!.trim() === "" ? null : m[2]!.trim(),
        line: line.line,
      };
    }

    if (/^-#/.test(head)) {
      return { kind: "comment", children: this.takeChildren(line.indent), line: line.line };
    }

    if (/^-/.test(head)) {
      return {
        kind: "script",
        code: head.slice(1).trim(),
        children: this.takeChildren(line.indent),
        line: line.line,
      };
    }

    if (head.startsWith("/")) {
      return {
        kind: "escapedHtml",
        value: head.slice(1).trim(),
        children: this.takeChildren(line.indent),
        line: line.line,
      };
    }

    if (head.startsWith("&")) {
      return {
        kind: "unescapedHtml",
        value: head.slice(1).trim(),
        children: this.takeChildren(line.indent),
        line: line.line,
      };
    }

    if (head.startsWith("~")) {
      const rest = head.slice(1).trim();
      const literal = /^(["']).*\1$/.test(rest) ? unquote(rest) : null;
      return {
        kind: "notTag",
        expr: literal === null ? rest : null,
        literal,
        children: this.takeChildren(line.indent),
        line: line.line,
      };
    }

    if (/^:/.test(head)) {
      return { kind: "filter", name: head.slice(1).trim(), body: this.takeFilterBody(line.indent), line: line.line };
    }

    if (head.startsWith("%") || head.startsWith(".") || head.startsWith("#")) {
      return this.parseTag(line, head);
    }

    if (head.startsWith("==")) {
      throw new HamlUnsupportedError(
        "`==` (unescaped script) is outside the slice: 0 of the 78 .haml templates in the " +
          "installed deck bundle use it (tools/haml-slice/haml-feature-inventory.mjs)",
        line.line,
        head,
      );
    }
    if (head.startsWith("=")) {
      return {
        kind: "output",
        expr: head.slice(1).trim(),
        unescaped: false,
        children: this.takeChildren(line.indent),
        line: line.line,
      };
    }

    return {
      kind: "text",
      value: head,
      children: this.takeChildren(line.indent),
      line: line.line,
    };
  }

  private takeFilterBody(indent: number): string[] {
    const body: string[] = [];
    while (this.pos < this.lines.length && this.lines[this.pos]!.indent > indent) {
      const l = this.lines[this.pos]!;
      body.push(l.text.slice(indent));
      this.pos += 1;
    }
    return body;
  }

  private parseTag(line: RawLine, head: string): HamlNode {
    const parsed = parseTagLine(head, line.line);
    const children = this.takeChildren(line.indent);
    if (parsed.inline !== null && children.length > 0) {
      throw new HamlCompileError(
        `Illegal nesting: content can't be both given on the same line as %${parsed.tag} ` +
          `and nested within it.`,
      );
    }
    return { kind: "tag", ...parsed, children, line: line.line };
  }
}

function dedent(lines: string[]): string[] {
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (!nonEmpty.length) return lines;
  const min = Math.min(...nonEmpty.map((l) => l.length - l.trimStart().length));
  return lines.map((l) => l.slice(min));
}

function collectSiblingBranches(parser: Parser, indent: number): HamlNode[] {
  const branches: HamlNode[] = [];
  for (;;) {
    const line = parser.peekLine();
    if (!line || line.indent !== indent) break;
    const head = line.text.slice(indent);
    if (!/^-\s*(when\b|elsif\b|else\b)/.test(head)) break;
    parser.advance();
    branches.push(parser.parseLine(line));
  }
  return branches;
}

function unquote(s: string): string {
  const q = s[0]!;
  if ((q === '"' || q === "'") && s.endsWith(q)) return s.slice(1, -1);
  return s;
}

function parseTagLine(head: string, line: number): {
  tag: string;
  attrs: AttrSpec;
  inline: InlineContent | null;
  selfClosed: boolean;
} {
  const tagMatch = /^%([\w:-]*)/.exec(head);
  const hadTagMarker = tagMatch !== null || head.startsWith(".") || head.startsWith("#");
  const tag = tagMatch ? (tagMatch[1] === "" ? "div" : tagMatch[1]!) : "div";
  const afterTag = tagMatch ? head.slice(tagMatch[0].length) : head;

  let specSrc = afterTag;
  let tailSrc = "";
  let hashBody: string | null = null;
  const braceAt = afterTag.indexOf("{");
  if (braceAt >= 0) {
    const braceEnd = matchBrace(afterTag, braceAt);
    if (braceEnd < 0) throw new HamlCompileError(`Illegal element: unbalanced { on line ${line}.`);
    specSrc = afterTag.slice(0, braceAt);
    tailSrc = afterTag.slice(braceEnd + 1);
    hashBody = afterTag.slice(braceAt + 1, braceEnd);
  }

  const shortSpec = /^(?:#[\w-]+)?(?:\.[\w-]+)*/.exec(specSrc)![0];

  const attrs: AttrSpec = { id: null, classes: [], hash: null };
  const idMatch = /^#([\w-]+)/.exec(shortSpec);
  if (idMatch) attrs.id = idMatch[1]!;
  for (const cm of shortSpec.matchAll(/\.([\w-]+)/g)) attrs.classes.push(cm[1]!);
  if (!hadTagMarker || (shortSpec === "" && /^[.#]/.test(specSrc))) {
    throw new HamlCompileError("Illegal element: classes and ids must have values.");
  }
  if (hashBody !== null) attrs.hash = parseAttrHash(hashBody);

  let tail = (braceAt >= 0 ? tailSrc : afterTag.slice(shortSpec.length)).trim();
  let selfClosed = false;
  if (tail.endsWith("/")) {
    selfClosed = true;
    tail = tail.slice(0, -1).trim();
  }

  let inline: InlineContent | null = null;
  if (tail.startsWith("=")) {
    if (tail.startsWith("==")) {
      throw new HamlUnsupportedError(
        "`==` (unescaped script) is outside the slice: 0 of the 78 .haml templates in the " +
          "installed deck bundle use it (tools/haml-slice/haml-feature-inventory.mjs)",
        line,
        tail,
      );
    }
    inline = { type: "output", expr: tail.slice(1).trim(), unescaped: false };
  } else if (tail !== "") {
    inline = tail.includes("#{")
      ? { type: "interpolated", template: tail }
      : { type: "text", value: tail };
  }

  return { tag, attrs, inline, selfClosed };
}

function matchBrace(s: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseAttrHash(body: string): [string, string][] {
  const out: [string, string][] = [];
  for (const piece of splitTopLevel(body)) {
    const trimmed = piece.trim();
    if (trimmed === "") continue;
    const m = /^(?::([\w?!]+)|'([^']+)'|"([^"]+)"|([\w-]+))\s*(?::|=>)\s*([\s\S]+)$/.exec(trimmed);
    if (!m) throw new HamlCompileError(`Illegal attribute syntax: ${JSON.stringify(trimmed)}`);
    const key = m[1] ?? m[2] ?? m[3] ?? m[4]!;
    out.push([key!, m[5]!.trim()]);
  }
  return out;
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      cur += c;
      if (c === "\\") {
        cur += s[++i] ?? "";
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth++;
    if (c === "}" || c === "]" || c === ")") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts;
}

type Value = unknown;

class Evaluator {
  private scope: HamlScope;
  private vars: Map<string, Value>;

  constructor(scope: HamlScope) {
    this.scope = scope;
    this.vars = new Map(Object.entries(scope.locals));
  }

  callHelper(name: string, args: Value[]): Value | undefined {
    const fn = this.scope.helpers[name];
    if (!fn) return undefined;
    return fn(...args);
  }

  eval(src: string, line = 0): Value {
    const e = new ExprLexer(src, line, this);
    const v = e.parseExpression();
    e.expectEnd();
    return v;
  }

  assign(name: string, value: Value): void {
    this.vars.set(name, value);
  }

  lookup(name: string, line: number, src: string): Value {
    if (this.vars.has(name)) return this.vars.get(name);
    if (name in this.scope.helpers) return this.scope.helpers[name]!();
    if (name === "true") return true;
    if (name === "false") return false;
    if (name === "nil") return null;
    if (/^@/.test(name)) return this.scope.instanceVariables?.[name.slice(1)] ?? null;
    if (/^@@/.test(name)) return null;
    throw new HamlCompileError(
      `undefined local variable or method \`${name}' for ${this.scope.receiverName ?? "main"}`,
      "NameError",
    );
  }
}

class ExprLexer {
  private i = 0;
  constructor(
    private readonly src: string,
    private readonly line: number,
    readonly ev: Evaluator,
  ) {}

  expectEnd(): void {
    this.ws();
    if (this.i < this.src.length) {
      this.unsupported(`unexpected trailing input ${JSON.stringify(this.src.slice(this.i))}`);
    }
  }

  unsupported(detail: string): never {
    throw new HamlUnsupportedError(detail, this.line, this.src);
  }

  private ws(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i]!)) this.i++;
  }

  private peek(s: string): boolean {
    this.ws();
    return this.src.startsWith(s, this.i);
  }

  private take(s: string): boolean {
    if (this.peek(s)) {
      this.i += s.length;
      return true;
    }
    return false;
  }

  parseExpression(): Value {
    return this.parseTernary();
  }

  private parseTernary(): Value {
    const cond = this.parseOr();
    if (this.take("?")) {
      const a = this.parseTernary();
      if (!this.take(":")) this.unsupported("ternary without :");
      const b = this.parseTernary();
      return truthy(cond) ? a : b;
    }
    return cond;
  }

  private parseOr(): Value {
    let left = this.parseAnd();
    for (;;) {
      const save = this.i;
      this.ws();
      if (this.take("||")) left = truthy(left) ? left : this.parseAnd();
      else {
        this.i = save;
        return left;
      }
    }
  }

  private parseAnd(): Value {
    let left = this.parseEquality();
    for (;;) {
      const save = this.i;
      this.ws();
      if (this.take("&&")) left = truthy(left) ? this.parseEquality() : left;
      else {
        this.i = save;
        return left;
      }
    }
  }

  private parseEquality(): Value {
    let left = this.parseAdditive();
    for (;;) {
      const save = this.i;
      this.ws();
      const op = ["==", "!=", "===", "=~"].find((o) => this.src.startsWith(o, this.i));
      if (!op) {
        this.i = save;
        return left;
      }
      this.i += op.length;
      const right = this.parseAdditive();
      left = compare(op, left, right);
    }
  }

  private parseAdditive(): Value {
    let left = this.parseMultiplicative();
    for (;;) {
      const save = this.i;
      this.ws();
      const op = ["+", "-"].find((o) => this.src.startsWith(o, this.i));
      if (!op) {
        this.i = save;
        return left;
      }
      this.i += op.length;
      const right = this.parseMultiplicative();
      left = op === "+" ? rubyAdd(left, right) : num(left) - num(right);
    }
  }

  private parseMultiplicative(): Value {
    let left = this.parsePostfix();
    for (;;) {
      const save = this.i;
      this.ws();
      const op = ["*", "/", "%"].find((o) => this.src.startsWith(o, this.i));
      if (!op) {
        this.i = save;
        return left;
      }
      this.i += op.length;
      const right = this.parsePostfix();
      const a = num(left);
      const b = num(right);
      left = op === "*" ? a * b : op === "/" ? a / b : a % b;
    }
  }

  private parsePostfix(): Value {
    let value = this.parsePrimary();
    for (;;) {
      const save = this.i;
      this.ws();
      if (this.take(".")) {
        const name = this.readIdentifier();
        if (this.take("(")) {
          const args = this.parseArgs();
          value = callMethod(value, name, args, this);
        } else {
          value = readProp(value, name, this);
        }
        continue;
      }
      if (this.src.startsWith("::", this.i)) {
        this.i += 2;
        const name = this.readIdentifier();
        if (this.take("(")) value = callMethod(null, name, this.parseArgs(), this);
        else value = this.ev.lookup(name, this.line, this.src);
        continue;
      }
      this.i = save;
      return value;
    }
  }

  private parsePrimary(): Value {
    this.ws();
    if (this.i >= this.src.length) this.unsupported("unexpected end of expression");
    const c = this.src[this.i]!;

    if (c === "(") {
      this.i++;
      const v = this.parseExpression();
      if (!this.take(")")) this.unsupported("unbalanced (");
      return v;
    }
    if (c === "[") {
      this.i++;
      const items: Value[] = [];
      if (!this.take("]")) {
        do {
          items.push(this.parseExpression());
        } while (this.take(","));
        if (!this.take("]")) this.unsupported("unbalanced [");
      }
      return items;
    }
    if (c === "{") {
      this.i++;
      const entries: [Value, Value][] = [];
      if (!this.take("}")) {
        do {
          const save = this.i;
          this.ws();
          const sym = /^([A-Za-z_][\w-]*|"[^"]*"|'[^']*')(?=\s*:)/.exec(this.src.slice(this.i));
          let k: Value;
          if (sym) {
            this.i += sym[0].length;
            this.i += this.src.slice(this.i).match(/^\s*:/)![0].length;
            k = unquote(sym[1]!);
          } else {
            this.i = save;
            k = this.parseExpression();
            if (!this.take("=>")) this.unsupported("hash without =>");
          }
          entries.push([k, this.parseExpression()]);
        } while (this.take(","));
        if (!this.take("}")) this.unsupported("unbalanced {");
      }
      return Object.fromEntries(entries.map(([k, v]) => [String(k), v]));
    }
    if (c === '"' || c === "'") return this.readInterpolatedString();
    if (/[0-9]/.test(c)) return this.readNumber();
    if (/[A-Za-z_@]/.test(c)) {
      const name = this.readIdentifier();
      if (this.peek("(")) {
        this.i++;
        return callMethod(null, name, this.parseArgs(), this);
      }
      return this.ev.lookup(name, this.line, this.src);
    }
    if (this.src.startsWith("->", this.i)) {
      this.unsupported("lambda/proc literal");
    }
    this.unsupported(`unsupported expression starting at ${JSON.stringify(c)}`);
  }

  private parseArgs(): Value[] {
    const args: Value[] = [];
    if (this.take(")")) return args;
    do {
      args.push(this.parseExpression());
    } while (this.take(","));
    if (!this.take(")")) this.unsupported("unbalanced ( in call");
    return args;
  }

  private readIdentifier(): string {
    const m = /^[A-Za-z_][\w]*[?!=]?|^@[A-Za-z_][\w]*/.exec(this.src.slice(this.i));
    if (!m) this.unsupported("expected an identifier");
    this.i += m[0].length;
    return m[0];
  }

  private readNumber(): number {
    const m = /^\d+(?:_\d+)*(?:\.\d+)?/.exec(this.src.slice(this.i))!;
    this.i += m[0].length;
    return Number(m[0].replace(/_/g, ""));
  }

  private readInterpolatedString(): string {
    const quote = this.src[this.i]!;
    this.i++;
    let out = "";
    while (this.i < this.src.length) {
      const c = this.src[this.i]!;
      if (c === "\\") {
        out += unescapeChar(this.src[this.i + 1] ?? "");
        this.i += 2;
        continue;
      }
      if (c === quote) {
        this.i++;
        return out;
      }
      if (c === "#" && this.src[this.i + 1] === "{") {
        const end = matchBrace(this.src, this.i + 1);
        if (end < 0) this.unsupported("unbalanced #{");
        out += rubyToString(new ExprLexer(this.src.slice(this.i + 2, end), this.line, this.ev).parseExpression());
        this.i = end + 1;
        continue;
      }
      out += c;
      this.i++;
    }
    this.unsupported("unterminated string");
  }
}

function unescapeChar(c: string): string {
  switch (c) {
    case "n": return "\n";
    case "t": return "\t";
    case "r": return "\r";
    case "0": return "\0";
    default: return c;
  }
}

function truthy(v: Value): boolean {
  return v !== false && v !== null && v !== undefined;
}

function num(v: Value): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  throw new HamlCompileError(`undefined method '+' for ${rubyInspect(v)}`, "NameError");
}

function rubyAdd(a: Value, b: Value): Value {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (typeof a === "string" || typeof b === "string") return rubyToString(a) + rubyToString(b);
  return num(a) + num(b);
}

function compare(op: string, a: Value, b: Value): Value {
  switch (op) {
    case "==": return rubyToString(a) === rubyToString(b) || Object.is(a, b);
    case "!=": return !(rubyToString(a) === rubyToString(b) || Object.is(a, b));
    case "===": return Object.is(a, b);
    case "=~": return null;
    default: return false;
  }
}

function callMethod(recv: Value, name: string, args: Value[], lex: ExprLexer): Value {
  if (Array.isArray(recv)) {
    if (name === "join") return recv.map(rubyToString).join(args.length ? rubyToString(args[0]) : "");
    if (name === "size" || name === "length" || name === "count") return recv.length;
    if (name === "first") return recv[0] ?? null;
    if (name === "last") return recv[recv.length - 1] ?? null;
    if (name === "map" || name === "each" || name === "select" || name === "reject")
      return recv;
    lex.unsupported(`Array#${name} is outside the slice's expression subset`);
  }
  if (recv === null) {
    const helper = lex.ev.callHelper(name, args);
    if (helper !== undefined) return helper;
    if (name === "join") return (args[0] as Value[]).map(rubyToString).join(rubyToString(args[1] ?? null) || "");
    if (name === "size" || name === "length" || name === "count") return (args[0] as Value[]).length;
    if (name === "to_s") return rubyToString(args[0] ?? null);
    if (name === "present?") return truthy(args[0]) && rubyToString(args[0]) !== "";
    if (name === "blank?") return !truthy(args[0]) || rubyToString(args[0]) === "";
    if (name === "to_sym" || name === "tag") return rubyToString(args[0] ?? null);
    lex.unsupported(`method \`${name}' is outside the slice's expression subset`);
  }
  return readProp(recv, name, lex);
}

function readProp(recv: Value, name: string, lex: ExprLexer): Value {
  if (Array.isArray(recv)) {
    if (name === "size" || name === "length" || name === "count") return recv.length;
    if (name === "first") return recv[0] ?? null;
    if (name === "last") return recv[recv.length - 1] ?? null;
    if (name === "join") return recv.map(rubyToString).join("");
    lex.unsupported(`Array#${name} is outside the slice's expression subset`);
  }
  if (recv && typeof recv === "object") {
    const v = (recv as Record<string, Value>)[name];
    if (v !== undefined) return v;
    if (name === "size" || name === "length" || name === "count") return Object.keys(recv).length;
  }
  lex.unsupported(`property \`${name}' is outside the slice's expression subset`);
}

function rubyInspect(v: Value): string {
  if (v === null) return "nil";
  if (v === undefined) return "nil";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(rubyInspect).join(", ")}]`;
  return String(v);
}

function rubyToString(v: Value): string {
  if (v === null || v === undefined || v === false) return v === false ? "false" : "";
  if (v === true) return "true";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(rubyToString).join("");
  return String(v);
}

export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mergeAttrValue(key: string, to: Value, from: Value): Value {
  if (key === "id") {
    const merged = filterAndJoin(from, "_");
    if (to !== null && to !== undefined && to !== "" && merged) return `${to}_${merged}`;
    return merged || to || "";
  }
  if (key === "class") {
    const merged = filterAndJoin(from, " ");
    const existing = filterAndJoin(to, " ");
    if (existing !== "" && merged !== "") {
      return [...new Set([...existing.split(" "), ...merged.split(" ")])].join(" ");
    }
    return merged || existing;
  }
  return from;
}

function filterAndJoin(value: Value, separator: string): string {
  if (Array.isArray(value)) {
    const parts = value.flat(3).map((v) => (v === null || v === undefined || v === false ? null : rubyToString(v)));
    const kept = parts.filter((p): p is string => p !== null && p !== "");
    return kept.join(separator);
  }
  if (value === null || value === undefined || value === false) return "";
  return rubyToString(value);
}

function renderAttribute(key: string, value: Value, escapeAttrs: boolean): string | null {
  if (value === null || value === undefined) return null;
  let v: Value = value;
  if (key === "class") v = filterAndJoin(v, " ");
  if (key === "id") v = filterAndJoin(v, "_");
  if (v === true) return ` ${key}`;
  if (v === false) return null;
  const str = escapeAttrs ? htmlEscape(rubyToString(v)) : rubyToString(v);
  return ` ${key}='${str}'`;
}

function renderAttributes(spec: AttrSpec, ev: Evaluator, line: number): string {
  const attrs: [string, Value][] = [];
  if (spec.hash) {
    for (const [rawKey, rawVal] of spec.hash) {
      const key = rawKey.replace(/_/g, "-");
      const value = new ExprLexer(rawVal, line, ev).parseExpression();
      const existing = attrs.find(([k]) => k === key);
      if (existing) existing[1] = mergeAttrValue(key, existing[1], value);
      else attrs.push([key, value]);
    }
  }
  if (spec.id !== null) {
    const existing = attrs.find(([k]) => k === "id");
    if (existing) existing[1] = mergeAttrValue("id", existing[1], spec.id);
    else attrs.push(["id", spec.id]);
  }
  for (const c of spec.classes) {
    const existing = attrs.find(([k]) => k === "class");
    if (existing) existing[1] = mergeAttrValue("class", existing[1], c);
    else attrs.push(["class", c]);
  }
  const flat: [string, Value][] = [];
  for (const [key, value] of attrs) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, Value>)) {
        flat.push([`${key}-${k.replace(/_/g, "-")}`, v]);
      }
    } else {
      flat.push([key, value]);
    }
  }
  const rendered = flat
    .map(([k, v]) => renderAttribute(k, v, true))
    .filter((s): s is string => s !== null);
  rendered.sort();
  return rendered.join("");
}

const DOCTYPES: Record<string, string> = {
  "": "<!DOCTYPE html>\n",
  "5": "<!DOCTYPE html>\n",
  "html": "<!DOCTYPE html>\n",
  "1.1": "<!DOCTYPE html>\n",
  "xml": "",
  "xhtml":
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"\n' +
    '"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n',
};

class Renderer {
  private readonly ev: Evaluator;
  private readonly out: string[] = [];

  constructor(scope: HamlScope) {
    this.ev = new Evaluator(scope);
  }

  renderAll(nodes: HamlNode[]): string {
    for (const n of nodes) this.renderNode(n);
    return this.out.join("");
  }

  private emit(s: string): void {
    this.out.push(s);
  }

  private evalNode(src: string, line: number): Value {
    return this.ev.eval(src, line);
  }

  private renderNode(node: HamlNode): void {
    switch (node.kind) {
      case "doctype": {
        const key = (node.spec ?? "").replace(/^doctype\s+/i, "").toLowerCase();
        const known = DOCTYPES[key];
        if (known !== undefined) this.emit(known);
        else if (node.dashes) this.emit(`${node.spec}\n`);
        else this.emit(`<!DOCTYPE ${node.spec}>\n`);
        return;
      }
      case "comment":
        return;
      case "script":
        this.renderScript(node);
        return;
      case "escapedHtml":
        this.emit(`<!-- ${node.value} -->\n`);
        this.renderChildren(node.children);
        return;
      case "unescapedHtml":
        this.emit(`${node.value}\n`);
        this.renderChildren(node.children);
        return;
      case "notTag": {
        const v = node.literal !== null ? node.literal : this.evalNode(node.expr ?? "", node.line);
        this.emit(`${rubyToString(v)}\n`);
        this.renderChildren(node.children);
        return;
      }
      case "filter":
        this.renderFilter(node);
        return;
      case "text":
        this.emit(`${interpolate(node.value, this.ev, node.line)}\n`);
        this.renderChildren(node.children);
        return;
      case "output": {
        const v = this.evalNode(node.expr, node.line);
        this.emit(`${rubyToString(v)}\n`);
        this.renderChildren(node.children);
        return;
      }
      case "tag":
        this.renderTag(node);
        return;
    }
  }

  private renderChildren(children: HamlNode[]): void {
    for (const c of children) this.renderNode(c);
  }

  private renderScript(node: Extract<HamlNode, { kind: "script" }>): void {
    const code = node.code;
    if (code === "end") {
      throw new HamlCompileError(
        'You don\'t need to use "- end" in Haml. Un-indent to close a block:\n' +
          "- if foo?\n" +
          "  %strong Foo!\n" +
          "- else\n" +
          "  Not foo.\n" +
          '%p This line is un-indented, so it isn\'t part of the "if" block',
      );
    }

    const blockMatch = /^([\s\S]*?)\s+do\s*(\|[^|]*\|)?\s*$/.exec(code);
    if (blockMatch) {
      this.runBlock(blockMatch[1]!.trim(), blockMatch[2] ?? null, node.children, node.line);
      return;
    }
    if (/^(if|unless)\b/.test(code)) {
      this.runConditional(code, node.children, node.line);
      return;
    }
    if (/^case\b/.test(code)) {
      this.runCase(code, node.children, node.line);
      return;
    }
    const assign = /^([A-Za-z_][\w]*)\s*=\s*([\s\S]+)$/.exec(code);
    if (assign) {
      this.ev.assign(assign[1]!, this.evalNode(assign[2]!, node.line));
      this.renderChildren(node.children);
      return;
    }
    this.evalNode(code, node.line);
    this.renderChildren(node.children);
  }

  private runConditional(code: string, children: HamlNode[], line: number): void {
    const m = /^(if|unless)\s+([\s\S]+)$/.exec(code)!;
    const branches = collectBranches(children, this.ev);
    const cond = truthy(this.evalNode(m[2]!, line));
    const take = m[1] === "if" ? cond : !cond;
    if (take) {
      this.renderChildren(branches.body);
      return;
    }
    for (const w of branches.whens) {
      if (w.candidates.every((c) => truthy(c))) {
        this.renderChildren(w.body);
        return;
      }
    }
    this.renderChildren(branches.elseBody);
  }

  private runCase(code: string, children: HamlNode[], line: number): void {
    const subject = this.evalNode(code.replace(/^case\s+/, "").trim(), line);
    const branches = collectBranches(children, this.ev);
    const matches = (candidate: Value): boolean =>
      Object.is(candidate, subject) || rubyToString(candidate) === rubyToString(subject);
    for (const w of branches.whens) {
      if (w.candidates.some(matches)) {
        this.renderChildren(w.body);
        return;
      }
    }
    this.renderChildren(branches.elseBody);
  }

  private runBlock(receiverSrc: string, paramSrc: string | null, children: HamlNode[], line: number): void {
    const enumMatch = /^(.*?)\.(each|map|each_with_index|select|reject|sort_by)$/.exec(receiverSrc);
    const enumerableSrc = enumMatch ? enumMatch[1]!.trim() : receiverSrc;
    const receiver = this.evalNode(enumerableSrc, line);
    if (!Array.isArray(receiver)) {
      throw new HamlUnsupportedError(
        `block receiver \`${receiverSrc}' is not enumerable in the slice's expression subset`,
        line,
        receiverSrc,
      );
    }
    const destructure = paramSrc !== null && /\(/.test(paramSrc);
    const names = paramSrc
      ? paramSrc
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .replace(/[()]/g, "")
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n !== "")
      : [];
    for (const item of receiver) {
      if (destructure) {
        const parts = Array.isArray(item) ? item : [item];
        names.forEach((n, i) => this.ev.assign(n, parts[i] ?? null));
      } else {
        names.forEach((n, i) => this.ev.assign(n, i === 0 ? item : null));
      }
      this.renderChildren(children);
    }
  }

  private renderFilter(node: Extract<HamlNode, { kind: "filter" }>): void {
    const DEDENT_FILTERS = new Set(["plain", "escaped", "preserve"]);
    const body = DEDENT_FILTERS.has(node.name) ? dedent(node.body) : node.body;
    const text = body.join("\n");
    switch (node.name) {
      case "plain":
        this.emit(body.length ? `${text}\n` : "");
        return;
      case "escaped":
        this.emit(body.length ? `${htmlEscape(text)}\n` : "");
        return;
      case "preserve":
        this.emit(body.length ? `${interpolate(text, this.ev, node.line)}\n` : "");
        return;
      case "css":
        this.emit(body.length ? `<style>\n${text}\n</style>\n` : "");
        return;
      case "javascript":
        this.emit(body.length ? `<script>\n${text}\n</script>\n` : "");
        return;
      case "markdown":
        throw new HamlUnsupportedError(
          "the :markdown filter needs a Markdown renderer; no deck .haml template in the " +
            "installed bundle uses it (feature inventory: 0 hits across 78 files)",
          node.line,
          `:${node.name}`,
        );
      default:
        throw new HamlUnsupportedError(`unknown filter :${node.name}`, node.line, `:${node.name}`);
    }
  }

  private renderTag(node: Extract<HamlNode, { kind: "tag" }>): void {
    const tag = node.tag;
    const attrs = renderAttributes(node.attrs, this.ev, node.line);
    const open = `<${tag}${attrs}>`;

    if (HTML5_VOID.has(tag)) {
      this.emit(`${open}\n`);
      return;
    }

    if (node.inline === null) {
      if (node.children.length === 0) {
        this.emit(`${open}</${tag}>\n`);
        return;
      }
      this.emit(`${open}\n`);
      this.renderChildren(node.children);
      this.emit(`</${tag}>\n`);
      return;
    }

    const inline = this.renderInline(node.inline, node.line);
    this.emit(`${open}${inline}</${tag}>\n`);
  }

  private renderInline(inline: InlineContent, line: number): string {
    switch (inline.type) {
      case "text":
        return interpolate(inline.value, this.ev, line);
      case "interpolated":
        return interpolate(inline.template, this.ev, line);
      case "output": {
        const v = this.evalNode(inline.expr, line);
        return rubyToString(v);
      }
    }
  }
}

function interpolate(template: string, ev: Evaluator, line: number): string {
  if (!template.includes("#{")) return template;
  let out = "";
  let i = 0;
  while (i < template.length) {
    if (template[i] === "#" && template[i + 1] === "{") {
      const end = matchBrace(template, i + 1);
      if (end < 0) {
        out += template.slice(i);
        return out;
      }
      out += rubyToString(new ExprLexer(template.slice(i + 2, end), line, ev).parseExpression());
      i = end + 1;
      continue;
    }
    out += template[i];
    i++;
  }
  return out;
}

interface Branches {
  body: HamlNode[];
  whens: { candidates: Value[]; body: HamlNode[] }[];
  elseBody: HamlNode[];
}

function collectBranches(children: HamlNode[], ev: Evaluator): Branches {
  const out: Branches = { body: [], whens: [], elseBody: [] };
  let inBranch = false;
  for (const child of children) {
    if (child.kind === "script" && /^(when|elsif|else)\b/.test(child.code)) {
      inBranch = true;
      if (child.code === "else") {
        out.elseBody = child.children;
        continue;
      }
      const w = /^(?:when|elsif)\s+([\s\S]+)$/.exec(child.code)!;
      const candidates = w[1]!.split(",").map((s) => ev.eval(s.trim()));
      out.whens.push({ candidates, body: child.children });
      continue;
    }
    if (!inBranch) out.body.push(child);
  }
  return out;
}

export function collectHamlFeatures(): readonly string[] {
  return [
    "doctype",
    "tag",
    "attributes",
    "text",
    "output",
    "silent-script",
    "silent-comment",
    "interpolation",
    "html-escaped",
    "unescaped-html",
    "not-tag",
    "filter",
  ];
}

export function compileHaml(source: string, scope: HamlScope): string {
  const nodes = new Parser(source).parse();
  assertNoExplicitEnd(nodes);
  return new Renderer(scope).renderAll(nodes);
}

function assertNoExplicitEnd(nodes: HamlNode[]): void {
  for (const n of nodes) {
    if (n.kind === "script") {
      if (n.code === "end") {
        throw new HamlCompileError(
          [
            'You don\'t need to use "- end" in Haml. Un-indent to close a block:',
            "- if foo?",
            "  %strong Foo!",
            "- else",
            "  Not foo.",
            '%p This line is un-indented, so it isn\'t part of the "if" block',
          ].join("\n"),
        );
      }
      assertNoExplicitEnd(n.children);
    } else if ("children" in n) {
      assertNoExplicitEnd(n.children);
    }
  }
}
