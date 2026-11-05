import { open } from "node:fs/promises";

const FEED_CHARS = 1 << 16;

export function decodeLiteral(raw) {
  if (raw.indexOf("''") < 0) return raw;
  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "'" && raw[i + 1] === "'") {
      out += "'";
      i += 2;
      continue;
    }
    out += raw[i];
    i += 1;
  }
  return out;
}

const IDENT = /[A-Za-z0-9_]/;

function scanStatement(stmtBody) {
  let i = 0;
  const n = stmtBody.length;
  while (i < n && /\s/.test(stmtBody[i])) i += 1;
  if (i >= n || stmtBody[i] !== "(") {
    throw new Error(`expected column list near ${JSON.stringify(stmtBody.slice(0, 30))}`);
  }
  i += 1;
  const columns = [];
  for (;;) {
    while (i < n && /\s/.test(stmtBody[i])) i += 1;
    if (i >= n) throw new Error("unexpected end of column list");
    let nameStart = i;
    while (i < n && IDENT.test(stmtBody[i])) i += 1;
    if (i === nameStart) throw new Error(`malformed column name near ${i}`);
    columns.push(stmtBody.slice(nameStart, i));
    while (i < n && /\s/.test(stmtBody[i])) i += 1;
    if (i < n && stmtBody[i] === ",") {
      i += 1;
      continue;
    }
    if (i < n && stmtBody[i] === ")") {
      i += 1;
      break;
    }
    throw new Error(`malformed column list near ${i}: ${JSON.stringify(stmtBody.slice(i, i + 10))}`);
  }
  while (i < n && /\s/.test(stmtBody[i])) i += 1;
  if (!stmtBody.startsWith("VALUES", i) && !stmtBody.startsWith("values", i)) {
    throw new Error(`expected VALUES near ${i}: ${JSON.stringify(stmtBody.slice(i, i + 20))}`);
  }
  i += 6;
  while (i < n && /\s/.test(stmtBody[i])) i += 1;
  if (i >= n || stmtBody[i] !== "(") {
    throw new Error(`expected VALUES tuple near ${i}: ${JSON.stringify(stmtBody.slice(i, i + 20))}`);
  }
  i += 1;
  const values = [];
  for (;;) {
    while (i < n && /\s/.test(stmtBody[i])) i += 1;
    if (i >= n) throw new Error("unexpected end of VALUES tuple");
    const c = stmtBody[i];
    if (c === "'") {
      i += 1;
      const start = i;
      for (;;) {
        const q = stmtBody.indexOf("'", i);
        if (q === -1) throw new Error("unterminated string literal");
        if (q + 1 < n && stmtBody[q + 1] === "'") {
          i = q + 2;
          continue;
        }
        values.push(decodeLiteral(stmtBody.slice(start, q)));
        i = q + 1;
        break;
      }
    } else if (c === "N" && (stmtBody[i + 1] === "U" || stmtBody[i + 1] === "u") &&
               (stmtBody[i + 2] === "L" || stmtBody[i + 2] === "l") &&
               (stmtBody[i + 3] === "L" || stmtBody[i + 3] === "l") &&
               (i + 4 >= n || !IDENT.test(stmtBody[i + 4])) &&
               (i - 1 < 0 || /\s|[(,]/.test(stmtBody[i - 1]))) {
      values.push(null);
      i += 4;
    } else if (c === "-" || c === "+" || (c >= "0" && c <= "9")) {
      const tokStart = i;
      if (c === "-" || c === "+") i += 1;
      while (i < n && /[0-9.]/.test(stmtBody[i])) i += 1;
      if (i < n && (stmtBody[i] === "e" || stmtBody[i] === "E")) {
        i += 1;
        if (i < n && (stmtBody[i] === "-" || stmtBody[i] === "+")) i += 1;
        while (i < n && /[0-9]/.test(stmtBody[i])) i += 1;
      }
      values.push(Number(stmtBody.slice(tokStart, i)));
    } else {
      throw new Error(`unexpected value char ${JSON.stringify(c)} near ${i}: ${JSON.stringify(stmtBody.slice(i, i + 20))}`);
    }
    while (i < n && /\s/.test(stmtBody[i])) i += 1;
    if (i < n && stmtBody[i] === ",") {
      i += 1;
      continue;
    }
    if (i < n && stmtBody[i] === ")") {
      i += 1;
      break;
    }
    throw new Error(`malformed VALUES tuple near ${i}: ${JSON.stringify(stmtBody.slice(i, i + 20))}`);
  }
  return { columns, values, tail: stmtBody.slice(i) };
}

export async function* deckSeedRows(path, opts = {}) {
  const tableFilter = opts.tables ? new Set(opts.tables) : undefined;
  const decoder = new TextDecoder("utf-8");
  const handle = await open(path, "r");
  try {
    const chunkBytes = opts.chunkBytes ?? (1 << 20);
    const buffer = Buffer.allocUnsafe(chunkBytes);
    let text = "";
    let read = await handle.read(buffer, 0, chunkBytes);
    let stats = { bytesRead: 0, rowsEmitted: 0, statements: 0, skippedTables: 0 };
    while (read.bytesRead > 0) {
      stats.bytesRead += read.bytesRead;
      const chunk = decoder.decode(buffer.subarray(0, read.bytesRead), { stream: true });
      text += chunk;
      let i = 0;
      while (i < text.length) {
        const head = text.indexOf("INSERT", i);
        if (head === -1) break;
        i = head;
        if (!text.startsWith("INSERT INTO ", i)) {
          i += 1;
          continue;
        }
        i += "INSERT INTO ".length;
        const tableStart = i;
        while (i < text.length && IDENT.test(text[i])) i += 1;
        const table = text.slice(tableStart, i);
        if (table.length === 0) {
          i += 1;
          continue;
        }
        let inStr = false;
        let stmtEnd = -1;
        for (let j = i; j < text.length; j++) {
          const c = text[j];
          if (inStr) {
            if (c === "'") {
              if (j + 1 < text.length && text[j + 1] === "'") {
                j += 1;
                continue;
              }
              inStr = false;
            }
            continue;
          }
          if (c === "'") {
            inStr = true;
            continue;
          }
          if (c === ";") {
            stmtEnd = j;
            break;
          }
        }
        if (stmtEnd === -1) break;
        const body = text.slice(i, stmtEnd);
        const parsed = scanStatement(body);
        stats.statements += 1;
        if (tableFilter === undefined || tableFilter.has(table)) {
          yield { table, columns: parsed.columns, values: parsed.values };
          stats.rowsEmitted += 1;
        } else {
          stats.skippedTables += 1;
        }
        i = stmtEnd + 1;
        if (i > (1 << 18)) {
          text = text.slice(i);
          i = 0;
        }
      }
      if (i > 0 && i < text.length) {
        text = text.slice(i);
        i = 0;
      } else if (i === text.length) {
        text = "";
        i = 0;
      }
      opts.onProgress?.(stats.bytesRead, stats.rowsEmitted);
      read = await handle.read(buffer, 0, chunkBytes);
    }
  } finally {
    await handle.close();
  }
}
