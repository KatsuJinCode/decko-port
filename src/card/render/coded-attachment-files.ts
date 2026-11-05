import { stockCodedFile } from "../attachments/stock-coded-files.js";

interface NodeSyncFs {
  readFileSync(path: string | URL, encoding: string): string;
}

let nodeFsCache: NodeSyncFs | undefined;
function nodeFsOrNull(): NodeSyncFs | undefined {
  if (nodeFsCache !== undefined) return nodeFsCache;
  try {
    const proc = (
      globalThis as unknown as {
        process?: { getBuiltinModule?: (id: string) => unknown };
      }
    ).process;
    const fs = proc?.getBuiltinModule?.("node:fs") as NodeSyncFs | undefined;
    if (fs !== undefined) nodeFsCache = fs;
    return fs ?? undefined;
  } catch {
    return undefined;
  }
}

const CODED_MOD_FILE_DIR_HREFS = new Map<string, string>();
try {
  CODED_MOD_FILE_DIR_HREFS.set(
    "carrierwave",
    new URL(
      "../mod-loader/mods/mod-coded-attachment-files/carrierwave/",
      import.meta.url,
    ).href,
  );
} catch {
}

const CODED_MOD_NAME_RE = /^:[:\w/+]+\/([^./]+)\./;

export function codedSvgFileBytes(content: string | null | undefined): string | undefined {
  const bundled = stockCodedFile(content);
  if (bundled?.extension === "svg") return new TextDecoder().decode(bundled.bytes);
  const fs = nodeFsOrNull();
  if (fs === undefined) return undefined;
  const trimmed = (content ?? "").trim();
  if (!trimmed.toLowerCase().endsWith(".svg")) return undefined;
  const modMatch = trimmed.match(CODED_MOD_NAME_RE);
  if (modMatch === null) return undefined;
  const baseDirHref = CODED_MOD_FILE_DIR_HREFS.get(modMatch[1]);
  if (baseDirHref === undefined) return undefined;
  const parts = trimmed
    .slice(1, trimmed.lastIndexOf("/"))
    .split("+")
    .map((part) => (part.startsWith(":") ? part.slice(1) : part));
  if (parts.length === 0 || parts.some((part) => part === "")) return undefined;
  const ext = trimmed.slice(trimmed.lastIndexOf("."));
  const fileUrl = new URL(
    `data/files/${parts.map(encodeURIComponent).join("/")}/image-original${ext}`,
    baseDirHref,
  );
  try {
    return fs.readFileSync(fileUrl, "utf8");
  } catch {
    return undefined;
  }
}
