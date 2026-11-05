import { DeckoName } from "../name.js";

const STUB_AT_REGEXP = /\(StUb(.*?)sTuB\)/sy;

export interface ViewStubHash {
  cast: Record<string, unknown>;
  viewOpts: Record<string, unknown>;
  formatOpts: {
    nestMode: string | undefined;
    override: boolean;
    contextNames: DeckoName[];
  };
}

export interface ViewStubChunk {
  hash: ViewStubHash;
  start: number;
  end: number;
}

export function interpretViewStub(inner: string): ViewStubHash {
  const parsed = JSON.parse(inner) as Record<string, unknown>;
  const hash: Partial<ViewStubHash> = {};
  for (const key of Object.keys(parsed)) {
    switch (key) {
      case "cast":
        hash.cast = parsed["cast"] as Record<string, unknown>;
        break;
      case "view_opts":
        hash.viewOpts = parsed["view_opts"] as Record<string, unknown>;
        break;
      case "format_opts": {
        const raw = (parsed["format_opts"] ?? {}) as Record<string, unknown>;
        hash.formatOpts = {
          nestMode:
            typeof raw["nest_mode"] === "string" ? (raw["nest_mode"] as string) : undefined,
          override: raw["override"] === "true",
          contextNames: Array.isArray(raw["context_names"])
            ? (raw["context_names"] as string[]).map((n) => DeckoName.parse(n))
            : [],
        };
        break;
      }
      default:
        throw new Error(`unknown stub-hash key: ${key}`);
    }
  }
  return hash as ViewStubHash;
}

export function scanViewStubs(content: string): ViewStubChunk[] {
  const chunks: ViewStubChunk[] = [];
  let position = 0;
  while (position < content.length) {
    const idx = content.indexOf("(StUb", position);
    if (idx === -1) break;
    STUB_AT_REGEXP.lastIndex = idx;
    const match = STUB_AT_REGEXP.exec(content);
    if (match === null) {
      position = idx + 1;
      continue;
    }
    chunks.push({
      hash: interpretViewStub(match[1] ?? ""),
      start: idx,
      end: idx + match[0].length,
    });
    position = idx + match[0].length;
  }
  return chunks;
}

export function expandViewStubs(
  cachedContent: string,
  stubNest: (hash: ViewStubHash) => unknown,
): unknown {
  const chunks = scanViewStubs(cachedContent);
  if (chunks.length === 0) return cachedContent;
  const pieces: unknown[] = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const text = cachedContent.slice(cursor, chunk.start);
    if (text !== "") pieces.push(text);
    pieces.push(stubNest(chunk.hash));
    cursor = chunk.end;
  }
  const tail = cachedContent.slice(cursor);
  if (tail !== "") pieces.push(tail);
  if (pieces.length === 1) return pieces[0];
  return pieces.map((piece) => (typeof piece === "string" ? piece : String(piece ?? ""))).join("");
}
