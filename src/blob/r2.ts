import {
  assertBlobKey,
  assertBlobPrefix,
  blobBytesEqual,
  BlobConditionalWriteOutcomeUnknownError,
  type BlobBody,
  type BlobDriver,
  type BlobListEntry,
  type BlobListOptions,
  type BlobMetadata,
  type BlobPutOptions,
  type PutResult,
} from "./driver.js";

export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
      onlyIf?: { etagMatches: string };
    },
  ): Promise<{ key: string; size: number; etag: string; uploaded: Date; httpMetadata?: { contentType?: string } } | null>;
  get(key: string): Promise<R2ObjectLike | null | undefined>;
  head(key: string): Promise<R2ObjectLike | null | undefined>;
  delete(key: string): Promise<void>;
  list(options: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    objects: R2ObjectLike[];
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface R2ObjectLike {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

interface R2ObjectEntryLike {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
}

export class R2BlobDriver implements BlobDriver {
  private readonly bucket: R2BucketLike;

  constructor(bucket: R2BucketLike) {
    this.bucket = bucket;
  }

  async put(key: string, bytes: Uint8Array, options: BlobPutOptions = {}): Promise<PutResult> {
    assertBlobKey(key);
    const stored = await this.bucket.put(key, bytes, {
      ...(options.contentType === undefined
        ? {}
        : { httpMetadata: { contentType: options.contentType } }),
      ...(options.metadata === undefined ? {} : { customMetadata: { ...options.metadata } }),
    });
    if (stored === null) throw new Error("R2 refused an unconditional blob write");
    return {
      key: stored.key,
      size: stored.size,
      ...(stored.httpMetadata?.contentType === undefined
        ? {}
        : { contentType: stored.httpMetadata.contentType }),
      etag: stored.etag,
      lastModified: stored.uploaded,
    };
  }

  async putIfUnchanged(key: string, expected: Uint8Array, bytes: Uint8Array, options: BlobPutOptions = {}): Promise<boolean> {
    assertBlobKey(key);
    const comparison = new Uint8Array(expected);
    const replacement = new Uint8Array(bytes);
    const current = await this.bucket.get(key);
    if (current == null) return false;
    const observed = new Uint8Array(await current.arrayBuffer());
    if (!blobBytesEqual(observed, comparison)) return false;
    if (typeof current.etag !== "string" || current.etag.length === 0) throw new Error("R2 conditional restoration lacks a bound ETag");
    try {
      const stored = await this.bucket.put(key, replacement, {
        onlyIf: { etagMatches: current.etag },
        ...(options.contentType === undefined ? {} : { httpMetadata: { contentType: options.contentType } }),
        ...(options.metadata === undefined ? {} : { customMetadata: { ...options.metadata } }),
      });
      if (stored === null) return false;
      if (stored == null || stored.key !== key || typeof stored.etag !== "string") {
        throw new Error("R2 conditional PUT returned no valid acknowledgement");
      }
      return true;
    } catch (cause) {
      throw new BlobConditionalWriteOutcomeUnknownError(key, cause);
    }
  }

  async get(key: string): Promise<BlobBody | undefined> {
    assertBlobKey(key);
    const object = await this.bucket.get(key);
    if (object == null) return undefined;
    return { body: object.body, metadata: metadataOf(object) };
  }

  async getBytes(key: string): Promise<Uint8Array | undefined> {
    assertBlobKey(key);
    const object = await this.bucket.get(key);
    if (object == null) return undefined;
    return new Uint8Array(await object.arrayBuffer());
  }

  async head(key: string): Promise<BlobMetadata | undefined> {
    assertBlobKey(key);
    const object = await this.bucket.head(key);
    return object == null ? undefined : metadataOf(object);
  }

  async delete(key: string): Promise<void> {
    assertBlobKey(key);
    await this.bucket.delete(key);
  }

  async list(prefix: string, options: BlobListOptions = {}): Promise<BlobListEntry[]> {
    assertBlobPrefix(prefix);
    const collected: BlobListEntry[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page: { objects: R2ObjectEntryLike[]; truncated: boolean; cursor?: string } =
        await this.bucket.list({
          ...(prefix === "" ? {} : { prefix }),
          limit: options.limit === undefined ? undefined : options.limit - collected.length,
          ...(cursor === undefined ? {} : { cursor }),
        });
      for (const object of page.objects) collected.push(metadataOf(object));
      if (options.limit !== undefined && collected.length >= options.limit) {
        return collected.slice(0, options.limit);
      }
      if (!page.truncated || page.cursor === undefined) break;
      cursor = page.cursor;
    }
    collected.sort(byKey);
    return collected;
  }
}

function metadataOf(object: R2ObjectEntryLike): BlobMetadata {
  return {
    key: object.key,
    size: object.size,
    ...(object.httpMetadata?.contentType === undefined
      ? {}
      : { contentType: object.httpMetadata.contentType }),
    etag: object.etag,
    lastModified: object.uploaded,
  };
}

function byKey(a: { key: string }, b: { key: string }): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
