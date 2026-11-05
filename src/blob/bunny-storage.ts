import {
  assertBlobKey,
  assertBlobPrefix,
  type BlobBody,
  type BlobDriver,
  type BlobListEntry,
  type BlobListOptions,
  type BlobMetadata,
  type BlobPutOptions,
  type PutResult,
} from "./driver.js";
import { readStreamToBytes } from "./memory.js";

interface BunnyStorageObject {
  ObjectName: string;
  Path: string;
  IsDirectory: boolean;
  Length: number;
  LastChanged: string;
  DateCreated?: string;
}

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array },
) => Promise<{ status: number; ok: boolean; headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown>; text(): Promise<string> }>;

export interface BunnyStorageOptions {
  endpoint: string;
  storageZone: string;
  accessKey: string;
  fetch?: FetchLike;
  cdnHost?: string;
}

const NOT_FOUND = 404;

export class BunnyStorageBlobDriver implements BlobDriver {
  readonly conditionalWriteUnavailableReason =
    "The configured Bunny Storage HTTP interface has no verified destination conditional PUT primitive";
  private readonly endpoint: string;
  private readonly storageZone: string;
  private readonly accessKey: string;
  private readonly doFetch: FetchLike;
  private readonly cdnHost: string | undefined;
  private readonly writtenContentTypes = new Map<string, string>();

  constructor(options: BunnyStorageOptions) {
    if (options.endpoint.trim() === "") throw new Error("bunny storage endpoint is required");
    if (options.storageZone.trim() === "") throw new Error("bunny storage zone is required");
    if (options.accessKey === "") throw new Error("bunny storage access key is required");
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.storageZone = options.storageZone;
    this.accessKey = options.accessKey;
    this.doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init as RequestInit) as never);
    this.cdnHost = options.cdnHost;
  }

  publicUrl(key: string): string | undefined {
    if (this.cdnHost === undefined) return undefined;
    assertBlobKey(key);
    return `https://${this.cdnHost}/${key}`;
  }

  async put(key: string, bytes: Uint8Array, options: BlobPutOptions = {}): Promise<PutResult> {
    assertBlobKey(key);
    const response = await this.doFetch(this.urlFor(key), {
      method: "PUT",
      headers: {
        AccessKey: this.accessKey,
        ...(options.contentType === undefined ? {} : { "Content-Type": options.contentType }),
      },
      body: bytes,
    });
    if (!response.ok) throw new BunnyError(response.status, key, "put");
    if (options.contentType !== undefined) this.writtenContentTypes.set(key, options.contentType);
    return {
      key,
      size: bytes.length,
      ...(options.contentType === undefined ? {} : { contentType: options.contentType }),
    };
  }

  async get(key: string): Promise<BlobBody | undefined> {
    assertBlobKey(key);
    const response = await this.doFetch(this.urlFor(key), {
      method: "GET",
      headers: { AccessKey: this.accessKey },
    });
    if (response.status === NOT_FOUND) return undefined;
    if (!response.ok) throw new BunnyError(response.status, key, "get");
    const buffer = new Uint8Array(await response.arrayBuffer());
    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(buffer);
          controller.close();
        },
      }),
      metadata: {
        key,
        size: buffer.length,
        ...contentTypeOrOmit(this.writtenContentTypes.get(key)),
      },
    };
  }

  async getBytes(key: string): Promise<Uint8Array | undefined> {
    const got = await this.get(key);
    if (got === undefined) return undefined;
    return readStreamToBytes(got.body);
  }

  async head(key: string): Promise<BlobMetadata | undefined> {
    assertBlobKey(key);
    const slash = key.lastIndexOf("/");
    const directory = slash === -1 ? "" : key.slice(0, slash + 1);
    const name = key.slice(slash + 1);
    const listing = await this.listDirectory(directory);
    const found = listing.find((entry) => entry.ObjectName === name && !entry.IsDirectory);
    if (found === undefined) return undefined;
    return {
      key,
      size: found.Length,
      ...contentTypeOrOmit(this.writtenContentTypes.get(key)),
      ...lastModifiedOrOmit(found.LastChanged),
    };
  }

  async delete(key: string): Promise<void> {
    assertBlobKey(key);
    const response = await this.doFetch(this.urlFor(key), {
      method: "DELETE",
      headers: { AccessKey: this.accessKey },
    });
    if (!response.ok && response.status !== NOT_FOUND) {
      throw new BunnyError(response.status, key, "delete");
    }
    this.writtenContentTypes.delete(key);
  }

  async list(prefix: string, options: BlobListOptions = {}): Promise<BlobListEntry[]> {
    assertBlobPrefix(prefix);
    const entries: BlobListEntry[] = [];
    const cut = prefix.lastIndexOf("/");
    const directory = cut === -1 ? "" : prefix.slice(0, cut + 1);
    for (const entry of await this.listDirectory(directory)) {
      if (entry.IsDirectory) continue;
      const key = `${directory}${entry.ObjectName}`;
      if (!key.startsWith(prefix)) continue;
      entries.push(this.entryFor(directory, entry));
      if (options.limit !== undefined && entries.length >= options.limit) break;
    }
    entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return options.limit === undefined ? entries : entries.slice(0, options.limit);
  }

  private entryFor(directory: string, entry: BunnyStorageObject): BlobListEntry {
    const key = `${directory}${entry.ObjectName}`;
    return {
      key,
      size: entry.Length,
      ...contentTypeOrOmit(this.writtenContentTypes.get(key)),
      ...lastModifiedOrOmit(entry.LastChanged),
    };
  }

  private async listDirectory(directory: string): Promise<BunnyStorageObject[]> {
    const response = await this.doFetch(`${this.base()}${directory}`, {
      method: "GET",
      headers: { Accept: "application/json", AccessKey: this.accessKey },
    });
    if (response.status === NOT_FOUND) return [];
    if (!response.ok) throw new BunnyError(response.status, directory, "list");
    const parsed = (await response.json()) as unknown;
    if (!Array.isArray(parsed)) {
      throw new BunnyError(response.status, directory, "list (response was not a JSON array)");
    }
    return parsed.filter(isStorageObject);
  }

  private base(): string {
    return `https://${this.endpoint}/${this.storageZone}/`;
  }

  private urlFor(key: string): string {
    return `${this.base()}${key}`;
  }
}

function contentTypeOrOmit(type: string | undefined): { contentType?: string } {
  return type === undefined ? {} : { contentType: type };
}

function lastModifiedOrOmit(value: string | undefined): { lastModified?: Date } {
  if (value === undefined) return {};
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? {} : { lastModified: parsed };
}

function isStorageObject(value: unknown): value is BunnyStorageObject {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.ObjectName === "string" && typeof record.IsDirectory === "boolean";
}

export class BunnyError extends Error {
  readonly status: number;
  readonly key: string;
  readonly operation: string;

  constructor(status: number, key: string, operation: string) {
    super(`bunny storage ${operation} failed for ${JSON.stringify(key)} with status ${status}`);
    this.name = "BunnyError";
    this.status = status;
    this.key = key;
    this.operation = operation;
  }
}
