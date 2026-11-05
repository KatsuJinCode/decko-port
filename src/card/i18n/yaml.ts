export type YamlValue = string | { [k: string]: YamlValue };

export function parseYaml(input: string): YamlValue {
  const lines = splitLines(input);
  const ctx: ParseContext = { lines, index: 0 };
  const result = parseNode(ctx, 0);
  skipBlankAndComment(ctx);
  if (ctx.index < ctx.lines.length) {
    throw new Error(
      `yaml: unexpected trailing content at line ${ctx.lines[ctx.index]!.line}: ` +
        JSON.stringify(ctx.lines[ctx.index]!.raw),
    );
  }
  return result;
}

interface RawLine {
  readonly raw: string;
  readonly indent: number;
  readonly line: number;
}

interface ParseContext {
  readonly lines: RawLine[];
  index: number;
}

function splitLines(input: string): RawLine[] {
  const out: RawLine[] = [];
  let lineNo = 0;
  for (const rawLine of input.split(/\r?\n/)) {
    lineNo++;
    if (rawLine.startsWith("#")) continue;
    if (rawLine.trim() === "") continue;
    let indent = 0;
    while (indent < rawLine.length && rawLine[indent] === " ") indent++;
    out.push({ raw: rawLine.slice(indent), indent, line: lineNo });
  }
  return out;
}

function skipBlankAndComment(ctx: ParseContext): void {
  while (ctx.index < ctx.lines.length) {
    const ln = ctx.lines[ctx.index]!;
    if (ln.raw === "" || ln.raw.startsWith("#")) ctx.index++;
    else break;
  }
}

function parseNode(ctx: ParseContext, indent: number): YamlValue {
  skipBlankAndComment(ctx);
  const first = ctx.lines[ctx.index];
  if (first === undefined) {
    throw new Error("yaml: unexpected end of input");
  }
  if (first.indent < indent) {
    throw new Error(
      `yaml: dedent at line ${first.line} (got ${first.indent}, expected >= ${indent})`,
    );
  }
  if (first.indent > indent) {
    throw new Error(
      `yaml: indent at line ${first.line} exceeds expected ${indent}`,
    );
  }

  const colonAt = firstColon(first.raw);
  if (colonAt === -1) {
    return parseScalar(first.raw);
  }
  const key = stripQuotes(first.raw.slice(0, colonAt).trim());
  const valuePart = first.raw.slice(colonAt + 1).trim();

  const out: { [k: string]: YamlValue } = {};
  if (valuePart !== "") {
    out[key] = parseScalar(valuePart);
    ctx.index++;
    skipBlankAndComment(ctx);
    while (ctx.index < ctx.lines.length && ctx.lines[ctx.index]!.indent === indent) {
      const sib = ctx.lines[ctx.index]!;
      const sibColon = firstColon(sib.raw);
      if (sibColon === -1) {
        throw new Error(
          `yaml: expected map entry at line ${sib.line}: ${JSON.stringify(sib.raw)}`,
        );
      }
      const sibKey = stripQuotes(sib.raw.slice(0, sibColon).trim());
      const sibValue = sib.raw.slice(sibColon + 1).trim();
      if (sibValue !== "") {
        out[sibKey] = parseScalar(sibValue);
        ctx.index++;
      } else {
        ctx.index++;
        skipBlankAndComment(ctx);
        out[sibKey] = parseNode(ctx, indent + 2);
      }
      skipBlankAndComment(ctx);
    }
    return out;
  }

  ctx.index++;
  skipBlankAndComment(ctx);
  if (ctx.index >= ctx.lines.length) {
    out[key] = "";
    return out;
  }
  const next = ctx.lines[ctx.index]!;
  if (next.indent <= indent) {
    out[key] = "";
  } else {
    out[key] = parseNode(ctx, indent + 2);
  }

  skipBlankAndComment(ctx);
  while (ctx.index < ctx.lines.length && ctx.lines[ctx.index]!.indent === indent) {
    const sib = ctx.lines[ctx.index]!;
    const sibColon = firstColon(sib.raw);
    if (sibColon === -1) {
      throw new Error(
        `yaml: expected map entry at line ${sib.line}: ${JSON.stringify(sib.raw)}`,
      );
    }
    const sibKey = stripQuotes(sib.raw.slice(0, sibColon).trim());
    const sibValue = sib.raw.slice(sibColon + 1).trim();
    if (sibValue !== "") {
      out[sibKey] = parseScalar(sibValue);
      ctx.index++;
    } else {
      ctx.index++;
      skipBlankAndComment(ctx);
      out[sibKey] = parseNode(ctx, indent + 2);
    }
    skipBlankAndComment(ctx);
  }
  return out;
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
    if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  }
  return s;
}

function firstColon(s: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === ":" && !inSingle && !inDouble) {
      const next = s[i + 1];
      if (next === undefined || next === " ") return i;
    }
  }
  return -1;
}

function parseScalar(s: string): string {
  if (s === "") return "";
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return unescapeDoubleQuoted(s.slice(1, -1));
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s.replace(/\s+$/, "");
}

function unescapeDoubleQuoted(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "\\" && i + 1 < s.length) {
      const next = s[i + 1]!;
      switch (next) {
        case "n":
          out += "\n";
          break;
        case "t":
          out += "\t";
          break;
        case '"':
          out += '"';
          break;
        case "\\":
          out += "\\";
          break;
        case "0":
          out += "\0";
          break;
        default:
          out += next;
          break;
      }
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
