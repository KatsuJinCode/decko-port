import {
  assertBlobKey,
  assertBlobPrefix,
  blobBytesEqual,
  type BlobBody,
  type BlobDriver,
  type BlobListEntry,
  type BlobListOptions,
  type BlobMetadata,
  type BlobPutOptions,
  type PutResult,
} from "./driver.js";

interface StoredObject {
  bytes: Uint8Array;
  contentType?: string;
  metadata: Record<string, string>;
  etag: string;
  lastModified: Date;
}

const STREAM_CHUNK = 64 * 1024;

export class MemoryBlobDriver implements BlobDriver {
  private readonly objects = new Map<string, StoredObject>();
  private writes = 0;

  async put(key: string, bytes: Uint8Array, options: BlobPutOptions = {}): Promise<PutResult> {
    assertBlobKey(key);
    return this.storeObject(key, bytes, options);
  }

  async putIfUnchanged(key: string, expected: Uint8Array, bytes: Uint8Array, options: BlobPutOptions = {}): Promise<boolean> {
    assertBlobKey(key);
    const current = this.objects.get(key);
    if (current === undefined || !blobBytesEqual(current.bytes, expected)) return false;
    this.storeObject(key, bytes, options);
    return true;
  }

  private storeObject(key: string, bytes: Uint8Array, options: BlobPutOptions): PutResult {
    const copy = new Uint8Array(bytes);
    this.writes += 1;
    const object: StoredObject = {
      bytes: copy,
      contentType: options.contentType,
      metadata: { ...(options.metadata ?? {}) },
      etag: `mem-${this.writes}`,
      lastModified: new Date(0),
    };
    this.objects.set(key, object);
    const result: PutResult = this.metadataOf(key, object);
    Object.defineProperty(result, "discardIfOwned", { value: async () => {
      if (this.objects.get(key) !== object) return false;
      return this.objects.delete(key);
    } });
    return result;
  }

  async get(key: string): Promise<BlobBody | undefined> {
    assertBlobKey(key);
    const object = this.objects.get(key);
    if (object === undefined) return undefined;
    return {
      body: this.streamOf(object.bytes),
      metadata: this.metadataOf(key, object),
    };
  }

  async getBytes(key: string): Promise<Uint8Array | undefined> {
    const got = await this.get(key);
    if (got === undefined) return undefined;
    return readStreamToBytes(got.body);
  }

  async head(key: string): Promise<BlobMetadata | undefined> {
    assertBlobKey(key);
    const object = this.objects.get(key);
    return object === undefined ? undefined : this.metadataOf(key, object);
  }

  async delete(key: string): Promise<void> {
    assertBlobKey(key);
    this.objects.delete(key);
  }

  async list(prefix: string, options: BlobListOptions = {}): Promise<BlobListEntry[]> {
    assertBlobPrefix(prefix);
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const limited = options.limit === undefined ? keys : keys.slice(0, options.limit);
    return limited.map((key) => this.metadataOf(key, this.objects.get(key)!));
  }

  private metadataOf(key: string, object: StoredObject): BlobMetadata {
    return {
      key,
      size: object.bytes.length,
      ...(object.contentType === undefined ? {} : { contentType: object.contentType }),
      etag: object.etag,
      lastModified: object.lastModified,
    };
  }

  private streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        const end = Math.min(offset + STREAM_CHUNK, bytes.length);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
    });
  }
}

export async function readStreamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
