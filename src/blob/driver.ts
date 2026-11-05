export interface BlobMetadata {
  key: string;
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
}

export type PutResult = BlobMetadata & {
  discardIfOwned?: () => Promise<boolean>;
};

export interface BlobPutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface BlobBody {
  body: ReadableStream<Uint8Array>;
  metadata: BlobMetadata;
}

export interface BlobListEntry extends BlobMetadata {
  key: string;
}

export interface BlobListOptions {
  limit?: number;
}

export interface BlobDriver {
  put(key: string, bytes: Uint8Array, options?: BlobPutOptions): Promise<PutResult>;

  putIfUnchanged?(key: string, expected: Uint8Array, bytes: Uint8Array, options?: BlobPutOptions): Promise<boolean>;
  readonly conditionalWriteUnavailableReason?: string;

  get(key: string): Promise<BlobBody | undefined>;

  getBytes(key: string): Promise<Uint8Array | undefined>;

  head(key: string): Promise<BlobMetadata | undefined>;

  delete(key: string): Promise<void>;

  list(prefix: string, options?: BlobListOptions): Promise<BlobListEntry[]>;
}

export class BlobConditionalWriteUnavailableError extends Error {
  readonly code = "blob-conditional-write-unavailable";
  readonly retrySafe = false;
  constructor(readonly reason: string) {
    super(`Automatic restoration remains unresolved: ${reason}`);
    this.name = "BlobConditionalWriteUnavailableError";
  }
}

export class BlobConditionalWriteOutcomeUnknownError extends Error {
  readonly code = "blob-conditional-write-outcome-unknown";
  readonly retrySafe = false;
  constructor(readonly key: string, readonly cause: unknown) {
    super(`Conditional blob replacement outcome is unresolved; retain the recovery copy: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "BlobConditionalWriteOutcomeUnknownError";
  }
}

export function blobBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

export class BlobKeyError extends Error {
  constructor(key: string, reason: string) {
    super(`invalid blob key ${JSON.stringify(key)}: ${reason}`);
    this.name = "BlobKeyError";
  }
}

export function assertBlobKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) throw new BlobKeyError(String(key), "empty");
  if (key.length > 1024) throw new BlobKeyError(key, "longer than 1024 characters");
  if (key.includes("\\")) throw new BlobKeyError(key, "contains a backslash");
  if (key.startsWith("/")) throw new BlobKeyError(key, "absolute");
  if (key.endsWith("/")) throw new BlobKeyError(key, "trailing slash");
  for (const segment of key.split("/")) {
    if (segment.length === 0) throw new BlobKeyError(key, "empty path segment");
    if (segment === "." || segment === "..") throw new BlobKeyError(key, "relative segment");
    if (segment.includes("\0")) throw new BlobKeyError(key, "contains a NUL byte");
  }
}

export function assertBlobPrefix(prefix: string): void {
  if (prefix === "") return;
  if (prefix.endsWith("/")) {
    assertBlobKey(prefix.slice(0, -1));
    return;
  }
  if (prefix.includes("\0")) throw new BlobKeyError(prefix, "contains a NUL byte");
  for (const segment of prefix.split("/")) {
    if (segment === "." || segment === "..") throw new BlobKeyError(prefix, "relative segment");
  }
}
