import { open } from "node:fs/promises";

const DEFAULT_CHUNK_BYTES = 1 << 20;
const COMPACT_LIMIT = 1 << 18;
const FEED_SLICE_CHARS = 1 << 16;
const ESCAPES = new Map([
  ["0", "\0"],
  ["'", "'"],
  ['"', '"'],
  ["b", "\b"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["Z", "\x1a"],
  ["\\", "\\"],
]);

export function decodeMysqlEscapes(raw) {
  if (!raw.includes("\\") && !raw.includes("''")) return raw;
  let out = "";
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const c = raw[i];
    if (c === "\\" && i + 1 < n) {
      const next = raw[i + 1];
      if (next === "%" || next === "_") {
        out += c + next;
      } else {
        out += ESCAPES.get(next) ?? next;
      }
      i += 2;
    } else if (c === "'" && raw[i + 1] === "'") {
      out += "'";
      i += 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

function findStringEnd(buf, start, quoteChar) {
  let i = start;
  for (;;) {
    const q = buf.indexOf(quoteChar, i);
    if (q === -1) return -1;
    let bs = 0;
    let j = q - 1;
    while (j >= start && buf[j] === "\\") {
      bs += 1;
      j -= 1;
    }
    if (bs % 2 === 1) {
      i = q + 1;
      continue;
    }
    if (quoteChar === "'" && buf[q + 1] === "'") {
      i = q + 2;
      continue;
    }
    return q;
  }
}

const IDENT_RE = /[A-Za-z0-9_$.]/;
const SEP_RE = /[\s,]/;
const WS_RE = /[\s]/;

function parseBareToken(tok) {
  if (tok === "NULL" || tok === "null") return null;
  if (tok === "TRUE" || tok === "true") return 1;
  if (tok === "FALSE" || tok === "false") return 0;
  if (/^0x[0-9a-fA-F]+$/.test(tok)) return hexOrBitToBuffer("hex", tok.slice(2));
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(tok)) return Number(tok);
  return tok;
}

function hexOrBitToBuffer(kind, digits) {
  if (kind === "b") {
    const byte = Number.parseInt(digits, 2);
    return new Uint8Array(Number.isNaN(byte) ? [0] : [byte]);
  }
  const padded = digits.length % 2 === 0 ? digits : `0${digits}`;
  return Uint8Array.from(Buffer.from(padded, "hex"));
}

async function* drainParser(parser) {
  for (;;) {
    const row = parser.nextRow();
    if (row === undefined) return;
    yield row;
  }
}

export async function* dumpRows(dumpPath, opts = {}) {
  const parser = new MysqldumpInsertParser(opts);
  const chunkBytes = opts.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  const decoder = new TextDecoder("utf-8");
  const handle = await open(dumpPath, "r");
  try {
    const buffer = Buffer.allocUnsafe(chunkBytes);
    let read = await handle.read(buffer, 0, chunkBytes);
    while (read.bytesRead > 0) {
      if (opts.signal?.aborted) throw new Error("aborted");
      const text = decoder.decode(buffer.subarray(0, read.bytesRead), {
        stream: true,
      });
      for (let off = 0; off < text.length; off += FEED_SLICE_CHARS) {
        parser.feed(text.slice(off, off + FEED_SLICE_CHARS), false);
        yield* drainParser(parser);
      }
      opts.onProgress?.(parser.stats.bytesRead, parser.stats.rowsEmitted);
      read = await handle.read(buffer, 0, chunkBytes);
    }
    parser.feed(decoder.decode() + "\n", true);
    parser.finish();
    yield* drainParser(parser);
  } finally {
    await handle.close();
  }
}

export class MysqldumpInsertParser {
  buf = "";
  pos = 0;
  state = "scan";
  table = "";
  columns;
  fields;
  queue = [];
  tableFilter;
  chunkBytes;
  tolerantTruncated;
  stats = {
    bytesRead: 0,
    rowsEmitted: 0,
    statements: 0,
    maxBufferChars: 0,
    skippedTables: 0,
  };
  warnings = [];

  constructor(opts = {}) {
    this.tableFilter = opts.tables ? new Set(opts.tables) : undefined;
    this.chunkBytes = opts.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    this.tolerantTruncated = opts.tolerantTruncated ?? false;
  }

  feed(text, atEof = false) {
    this.buf += text;
    this.stats.bytesRead += text.length;
    const pending = this.buf.length - this.pos;
    if (pending > this.stats.maxBufferChars) this.stats.maxBufferChars = pending;
    this.parse(atEof);
  }

  nextRow() {
    return this.queue.shift();
  }

  finish() {
    if (this.state !== "scan") {
      const msg = `dump ended mid-statement (state=${this.state}, table=${this.table})`;
      if (this.tolerantTruncated) {
        this.warnings.push(`truncated: ${msg}`);
        return;
      }
      throw new Error(msg);
    }
  }

  eofFail(msg) {
    if (this.tolerantTruncated) {
      this.warnings.push(`truncated: ${msg}`);
      this.state = "scan";
      this.table = "";
      this.columns = undefined;
      this.fields = undefined;
      return true;
    }
    throw new Error(msg);
  }

  compact() {
    if (this.pos > 0) {
      this.buf = this.buf.slice(this.pos);
      this.pos = 0;
    }
  }

  maybeCompact(minConsumed = COMPACT_LIMIT) {
    if (this.pos >= minConsumed) this.compact();
  }

  parse(atEof) {
    for (;;) {
      const n = this.buf.length;
      if (this.pos >= n) {
        this.maybeCompact(1);
        return;
      }
      switch (this.state) {
        case "scan":
          if (!this.scanStatement(atEof)) return;
          break;
        case "table":
          if (!this.scanTableName(atEof)) return;
          break;
        case "post-table":
          if (!this.scanPostTable(atEof)) return;
          break;
        case "cols":
          if (!this.scanColumnList(atEof)) return;
          break;
        case "await-open":
          if (!this.scanTupleStart(atEof)) return;
          break;
        case "fields":
          if (!this.scanFields(atEof)) return;
          break;
        case "between":
          if (!this.afterTuple(atEof)) return;
          break;
        default:
          throw new Error(`unknown parser state: ${this.state}`);
      }
    }
  }

  scanStatement(atEof) {
    const n = this.buf.length;
    let i = this.pos;
    while (i < n) {
      const c = this.buf[i];
      if (WS_RE.test(c)) {
        i += 1;
        continue;
      }
      if (c === ";") {
        i += 1;
        continue;
      }
      if (c === "-" && this.buf[i + 1] === "-") {
        i = this.skipLine(i);
        continue;
      }
      if (c === "#") {
        i = this.skipLine(i);
        continue;
      }
      if (c === "/" && this.buf[i + 1] === "*") {
        i = this.skipBlockComment(i);
        continue;
      }
      if (c === "I" && this.buf.startsWith("INSERT INTO `", i)) {
        this.pos = i + 13;
        this.state = "table";
        this.maybeCompact();
        return true;
      }
      const next = this.skipStatement(i, atEof);
      if (next === -1) return false;
      i = next;
    }
    this.pos = i;
    this.maybeCompact();
    return false;
  }

  skipLine(i) {
    const nl = this.buf.indexOf("\n", i);
    return nl === -1 ? this.buf.length : nl + 1;
  }

  skipBlockComment(i) {
    const close = this.buf.indexOf("*/", i + 2);
    return close === -1 ? this.buf.length : close + 2;
  }

  skipStatement(i, atEof) {
    const n = this.buf.length;
    let quote = null;
    let j = i;
    while (j < n) {
      const c = this.buf[j];
      if (quote !== null) {
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === quote) quote = null;
        j += 1;
        continue;
      }
      if (c === "'" || c === '"' || c === "`") {
        quote = c;
        j += 1;
        continue;
      }
      if (c === "-" && this.buf[j + 1] === "-") {
        j = this.skipLine(j);
        continue;
      }
      if (c === "#") {
        j = this.skipLine(j);
        continue;
      }
      if (c === "/" && this.buf[j + 1] === "*") {
        j = this.skipBlockComment(j);
        continue;
      }
      if (c === ";") return j + 1;
      j += 1;
    }
    if (atEof && quote === null) return n;
    return -1;
  }

  scanTableName(atEof) {
    const close = this.buf.indexOf("`", this.pos);
    if (close === -1) {
      if (atEof) return this.eofFail("dump ended inside INSERT table name");
      return false;
    }
    this.table = this.buf.slice(this.pos, close);
    this.columns = undefined;
    this.pos = close + 1;
    this.state = "post-table";
    this.maybeCompact();
    return true;
  }

  scanPostTable(atEof) {
    const n = this.buf.length;
    let i = this.pos;
    while (i < n && WS_RE.test(this.buf[i])) i += 1;
    if (i >= n) {
      this.pos = i;
      if (atEof) return this.eofFail("dump ended before INSERT VALUES");
      return false;
    }
    if (this.buf[i] === "(") {
      this.pos = i + 1;
      this.state = "cols";
      return true;
    }
    if (this.buf.startsWith("VALUES", i) || this.buf.startsWith("values", i)) {
      this.pos = i + 6;
      this.state = "await-open";
      this.maybeCompact();
      return true;
    }
    const tail = this.buf.slice(i, Math.min(n, i + 6));
    if (
      tail.length < 6 &&
      ("VALUES".startsWith(tail) || "values".startsWith(tail))
    ) {
      if (atEof) return this.eofFail("dump ended inside the VALUES keyword");
      this.pos = i;
      return false;
    }
    throw new Error(
      `malformed INSERT INTO \`${this.table}\`: expected VALUES near byte ${this.stats.bytesRead - (n - i)}`,
    );
  }

  scanColumnList(atEof) {
    const n = this.buf.length;
    if (this.columns === undefined) this.columns = [];
    let i = this.pos;
    for (;;) {
      while (i < n && SEP_RE.test(this.buf[i])) i += 1;
      if (i >= n) {
        this.pos = i;
        if (atEof) return this.eofFail("dump ended inside column list");
        return false;
      }
      if (this.buf[i] === ")") {
        i += 1;
        break;
      }
      if (this.buf[i] === "`") {
        const end = this.buf.indexOf("`", i + 1);
        if (end === -1) {
          this.pos = i;
          if (atEof) return this.eofFail("dump ended inside column name");
          return false;
        }
        this.columns.push(this.buf.slice(i + 1, end));
        i = end + 1;
        continue;
      }
      throw new Error(`malformed column list for \`${this.table}\``);
    }
    this.pos = i;
    this.state = "post-table";
    this.maybeCompact();
    return true;
  }

  scanTupleStart(atEof) {
    const n = this.buf.length;
    let i = this.pos;
    while (i < n && SEP_RE.test(this.buf[i])) i += 1;
    if (i >= n) {
      this.pos = i;
      if (atEof) return this.eofFail("dump ended before row tuple");
      return false;
    }
    if (this.buf[i] === "(") {
      this.pos = i + 1;
      this.fields = [];
      this.state = "fields";
      return true;
    }
    if (this.buf[i] === ";") {
      this.pos = i + 1;
      this.finishStatement();
      this.maybeCompact();
      return true;
    }
    throw new Error(
      `malformed row tuple for \`${this.table}\` near byte ${this.stats.bytesRead - (n - i)}`,
    );
  }

  scanFields(atEof) {
    const n = this.buf.length;
    const fields = this.fields;
    let i = this.pos;
    for (;;) {
      while (i < n && SEP_RE.test(this.buf[i])) i += 1;
      if (i >= n) {
        this.pos = i;
        this.maybeCompact();
        if (atEof) return this.eofFail(`dump ended mid-tuple in \`${this.table}\``);
        return false;
      }
      const c = this.buf[i];
      if (c === ")") {
        this.pos = i + 1;
        this.emitRow();
        this.state = "between";
        return true;
      }
      if (c === "'" || c === '"') {
        const contentStart = i + 1;
        const end = findStringEnd(this.buf, contentStart, c);
        const edgeAmbiguous =
          end === this.buf.length - 1 && c === "'" && !atEof;
        if (end === -1 || edgeAmbiguous) {
          this.pos = i;
          this.maybeCompact();
          if (atEof && end === -1) {
              return this.eofFail(`dump ended inside a string literal in \`${this.table}\``);
            }
          return false;
        }
        fields.push(decodeMysqlEscapes(this.buf.slice(contentStart, end)));
        i = end + 1;
        continue;
      }
      const tokStart = i;
      if (c === "-" || c === "+") i += 1;
      while (i < n && IDENT_RE.test(this.buf[i])) i += 1;
      while (
        i < n &&
        (this.buf[i] === "-" || this.buf[i] === "+") &&
        i > tokStart &&
        (this.buf[i - 1] === "e" || this.buf[i - 1] === "E")
      ) {
        i += 1;
        while (i < n && IDENT_RE.test(this.buf[i])) i += 1;
      }
      if (i === tokStart) {
        throw new Error(
          `unexpected character ${JSON.stringify(c)} in \`${this.table}\` row near byte ${this.stats.bytesRead - (n - i)}`,
        );
      }
      if (i >= n) {
        this.pos = tokStart;
        this.maybeCompact();
        if (atEof) {
            return this.eofFail(`dump ended inside a bare token in \`${this.table}\``);
          }
        return false;
      }
      const tok = this.buf.slice(tokStart, i);
      if ((tok === "b" || tok === "B" || tok === "x" || tok === "X") && this.buf[i] === "'") {
        const litEnd = this.buf.indexOf("'", i + 1);
        if (litEnd === -1) {
          this.pos = tokStart;
          if (atEof) {
              return this.eofFail(`dump ended inside a hex/bit literal in \`${this.table}\``);
            }
          return false;
        }
        fields.push(
          tok === "b" || tok === "B"
            ? hexOrBitToBuffer("b", this.buf.slice(i + 1, litEnd))
            : hexOrBitToBuffer("x", this.buf.slice(i + 1, litEnd)),
        );
        i = litEnd + 1;
        continue;
      }
      if (tok.charCodeAt(0) === 95 ) {
        continue;
      }
      fields.push(parseBareToken(tok));
    }
  }

  afterTuple(atEof) {
    const n = this.buf.length;
    let i = this.pos;
    while (i < n && WS_RE.test(this.buf[i])) i += 1;
    if (i >= n) {
      this.pos = i;
      if (atEof) {
        this.finishStatement();
        this.maybeCompact();
        return true;
      }
      return false;
    }
    const c = this.buf[i];
    if (c === ",") {
      this.pos = i + 1;
      this.state = "await-open";
      this.maybeCompact();
      return true;
    }
    if (c === ";") {
      this.pos = i + 1;
      this.finishStatement();
      this.maybeCompact();
      return true;
    }
    throw new Error(
      `unexpected character after tuple in \`${this.table}\` near byte ${this.stats.bytesRead - (n - i)}`,
    );
  }

  emitRow() {
    const values = this.fields;
    this.fields = [];
    if (this.tableFilter !== undefined && !this.tableFilter.has(this.table)) {
      this.stats.skippedTables += 1;
      return;
    }
    this.queue.push({ table: this.table, values, columns: this.columns });
    this.stats.rowsEmitted += 1;
  }

  finishStatement() {
    this.stats.statements += 1;
    this.state = "scan";
    this.table = "";
    this.columns = undefined;
    this.fields = undefined;
  }
}
