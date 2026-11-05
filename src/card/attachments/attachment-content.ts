export const BINARY_CONTENT_TYPE = "application/octet-stream";

const MAGIC_SIGNATURES: readonly { bytes: number[]; ext: string; type: string }[] = [
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ext: ".png", type: "image/png" },
  { bytes: [0xff, 0xd8, 0xff], ext: ".jpg", type: "image/jpeg" },
  { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], ext: ".gif", type: "image/gif" },
  { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], ext: ".gif", type: "image/gif" },
  { bytes: [0x25, 0x50, 0x44, 0x46], ext: ".pdf", type: "application/pdf" },
  { bytes: [0x50, 0x4b, 0x03, 0x04], ext: ".zip", type: "application/zip" },
];

export const EXTENSION_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".txt": "text/plain",
  ".text": "text/plain",
  ".csv": "text/csv",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};

export const IMAGE_VARIANTS = ["icon", "small", "medium", "large", "original"] as const;
export type ImageVariant = (typeof IMAGE_VARIANTS)[number];

function looksTextual(bytes: Uint8Array): boolean {
  const window = bytes.subarray(0, 1024);
  for (const byte of window) {
    if (byte === 0) return false;
  }
  return true;
}

export function extensionOfFilename(filename: string): string {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  const ext = base.slice(dot).toLowerCase();
  return /^[.][a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

export function detectAttachmentExtension(originalFilename: string, bytes: Uint8Array): string {
  const fromName = extensionOfFilename(originalFilename);
  if (fromName !== "") return fromName;
  for (const sig of MAGIC_SIGNATURES) {
    if (startsWith(bytes, sig.bytes)) return sig.ext;
  }
  if (looksTextual(bytes) && bytes.length > 0) return ".txt";
  return "";
}

export function detectAttachmentContentType(
  originalFilename: string,
  bytes: Uint8Array,
  declaredType?: string | null,
): string {
  const ext = extensionOfFilename(originalFilename);
  const byPath = ext !== "" ? EXTENSION_CONTENT_TYPES[ext] : undefined;
  if (byPath !== undefined && byPath.startsWith("text/")) return byPath;
  for (const sig of MAGIC_SIGNATURES) {
    if (startsWith(bytes, sig.bytes)) return sig.type;
  }
  if (looksTextual(bytes) && bytes.length > 0) {
    const head = new TextDecoder("utf-8", { fatal: false })
      .decode(bytes.subarray(0, 512))
      .toLowerCase();
    if (head.includes("<svg")) return "image/svg+xml";
    if (byPath !== undefined) return byPath;
    return "text/plain";
  }
  const declared = (declaredType ?? "").trim().toLowerCase();
  if (declared !== "") return declared;
  return BINARY_CONTENT_TYPE;
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

export function localAttachmentIdentifier(cardId: number, actionId: number, ext: string): string {
  return `~${cardId}/${actionId}${ext}`;
}

export function codedAttachmentIdentifier(codenameParts: readonly string[], mod: string, ext: string): string {
  return `${codenameParts.map((c) => `:${c}`).join("+")}/${mod}${ext}`;
}

export function lastContentActionIdFromIdentifier(
  content: string | null | undefined,
): number | null {
  if (content === null || content === undefined || content === "") return null;
  const parts = content.split(/[/.]/);
  const candidate = parts[parts.length - 2];
  if (candidate === undefined || !/^\d+$/.test(candidate)) return null;
  return Number.parseInt(candidate, 10);
}

export interface ParsedLocalIdentifier {
  cardId: number;
  actionId: number;
  ext: string;
}

export function parseLocalAttachmentIdentifier(
  content: string | null | undefined,
): ParsedLocalIdentifier | undefined {
  if (content === null || content === undefined) return undefined;
  const match = /^~(\d+)\/(\d+)(\.[a-z0-9]{1,10})?$/.exec(content.trim());
  if (match === null) return undefined;
  return {
    cardId: Number.parseInt(match[1], 10),
    actionId: Number.parseInt(match[2], 10),
    ext: match[3] ?? "",
  };
}

export function filenameWithVariant(actionId: number, ext: string, variant?: string): string {
  if (variant === undefined || variant === "") return `${actionId}${ext}`;
  return `${actionId}-${variant}${ext}`;
}
