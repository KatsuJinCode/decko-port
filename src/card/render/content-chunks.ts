export type ChunkType = "nest" | "link" | "escaped";

export interface ContentChunk {
  kind: ChunkType;
  text: string;
  inner: string | undefined;
  start: number;
  end: number;
}

const NEST_FULL_STICKY = /\{\{([^{}]*)\}\}/y;
const LINK_FULL_STICKY = /\[\[([^\]]+)\]\]/y;
const ESCAPED_FULL_STICKY = /\\(?:\[\[[^\]]*\]\]|\{\{[^}]*\}\})/y;

export function scanChunks(content: string): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  let position = 0;
  while (position < content.length) {
    const escaped = content.indexOf("\\", position);
    const link = content.indexOf("[[", position);
    const nest = content.indexOf("{{", position);
    const candidates: Array<[number, ChunkType]> = [];
    if (escaped !== -1) candidates.push([escaped, "escaped"]);
    if (link !== -1) candidates.push([link, "link"]);
    if (nest !== -1) candidates.push([nest, "nest"]);
    if (candidates.length === 0) break;
    candidates.sort((a, b) => a[0] - b[0]);
    const [idx, kind] = candidates[0]!;
    const re =
      kind === "escaped" ? ESCAPED_FULL_STICKY : kind === "link" ? LINK_FULL_STICKY : NEST_FULL_STICKY;
    re.lastIndex = idx;
    const m = re.exec(content);
    if (m === null) {
      position = idx + 1;
      continue;
    }
    chunks.push({
      kind,
      text: m[0],
      inner: m[1],
      start: idx,
      end: idx + m[0].length,
    });
    position = idx + m[0].length;
  }
  return chunks;
}

export function eachChunk(content: string): ContentChunk[] {
  return scanChunks(content);
}

export function interpretChunkType(
  chunkType: string | ChunkType | undefined,
): ChunkType | undefined {
  if (chunkType === undefined) return undefined;
  const byName: Record<string, ChunkType> = {
    Nest: "nest",
    Link: "link",
    EscapedLiteral: "escaped",
    nest: "nest",
    link: "link",
    escaped: "escaped",
  };
  const hit = byName[chunkType];
  if (hit === undefined) throw new Error(`unknown chunk type: ${String(chunkType)}`);
  return hit;
}

export function findChunks(content: string, chunkType?: string | ChunkType): ContentChunk[] {
  const kind = interpretChunkType(chunkType);
  if (kind === undefined) return [];
  return scanChunks(content).filter((c) => c.kind === kind);
}

export function hasChunk(_content: string, _chunkType: string | ChunkType): never {
  throw new Error("undefined method 'any' for an instance of Enumerator");
}

function rubyFloatParseable(s: string): boolean {
  const t = s.trim();
  if (t === "") return false;
  if (/^[+-]?Infinity$/.test(t) || t === "NaN") return true;
  if (/^[+-]?(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|[0-9][0-9_]*)$/.test(t)) return true;
  return /^[+-]?(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9_]+)(?:[eE][+-]?[0-9_]+)?$/.test(t);
}

export function stashChunks(
  content: string,
  classes: readonly ChunkType[],
): { masked: string; stashed: string[] } {
  const wanted = new Set(classes);
  const chunks = scanChunks(content).filter((c) => wanted.has(c.kind));
  const stashed: string[] = [];
  let masked = "";
  let cursor = 0;
  for (const c of chunks) {
    masked += content.slice(cursor, c.start) + `{{${stashed.length}}}`;
    stashed.push(c.text);
    cursor = c.end;
  }
  masked += content.slice(cursor);
  return { masked, stashed };
}

export function unstashChunks(content: string, stashed: readonly string[]): string {
  return content.replace(/\{\{([^{}]*)\}\}/g, (whole, inner: string) => {
    if (!rubyFloatParseable(inner)) return whole;
    const index = Math.trunc(Number(inner));
    return stashed[index] ?? "";
  });
}

export function withoutChunks(
  content: string,
  classes: readonly ChunkType[],
  process: (masked: string) => string,
): string {
  const { masked, stashed } = stashChunks(content, classes);
  return unstashChunks(process(masked), stashed);
}

export function withoutNests(
  content: string,
  process: (masked: string) => string,
): string {
  return withoutChunks(content, ["nest"], process);
}

export function withoutReferences(
  content: string,
  process: (masked: string) => string,
): string {
  return withoutChunks(content, ["nest", "link", "escaped"], process);
}

export function stripChunks(content: string, chunkType?: string | ChunkType): string {
  const kind = interpretChunkType(chunkType);
  if (kind === undefined) return content;
  let out = "";
  let cursor = 0;
  for (const c of scanChunks(content)) {
    if (c.kind !== kind) continue;
    out += content.slice(cursor, c.start);
    cursor = c.end;
  }
  return out + content.slice(cursor);
}
