import { createReadStream } from "node:fs";
import { mkdir, opendir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
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
import { contentTypeForExtension } from "./content-types.js";

const READ_CHUNK = 64 * 1024;

export class FilesystemBlobDriver implements BlobDriver {
  readonly conditionalWriteUnavailableReason =
    "The filesystem namespace supports unconditional rename, not destination compare-and-replace; external and Ruby writers are not bound by a driver-local lock";
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  pathFor(key: string): string {
    assertBlobKey(key);
    const path = resolve(this.root, ...key.split("/"));
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error(`blob key ${JSON.stringify(key)} resolves outside the blob root`);
    }
    return path;
  }

  async put(key: string, bytes: Uint8Array, options: BlobPutOptions = {}): Promise<PutResult> {
    const path = this.pathFor(key);
    await mkdir(dirnameOf(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.part`;
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    const info = await stat(path);
    return {
      key,
      size: info.size,
      contentType:
        options.contentType ??
        contentTypeForExtension(extensionOf(key)) ??
        undefined,
      lastModified: info.mtime,
    };
  }

  async get(key: string): Promise<BlobBody | undefined> {
    const path = this.pathFor(key);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return undefined;
    }
    return {
      body: nodeStreamToWebStream(createReadStream(path, { highWaterMark: READ_CHUNK })),
      metadata: {
        key,
        size,
        ...contentTypeOrOmit(contentTypeForExtension(extensionOf(key))),
        lastModified: (await stat(path)).mtime,
      },
    };
  }

  async getBytes(key: string): Promise<Uint8Array | undefined> {
    const path = this.pathFor(key);
    try {
      return new Uint8Array(await readFile(path));
    } catch {
      return undefined;
    }
  }

  async head(key: string): Promise<BlobMetadata | undefined> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      if (!info.isFile()) return undefined;
      return {
        key,
        size: info.size,
        ...contentTypeOrOmit(contentTypeForExtension(extensionOf(key))),
        lastModified: info.mtime,
      };
    } catch {
      return undefined;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async list(prefix: string, options: BlobListOptions = {}): Promise<BlobListEntry[]> {
    assertBlobPrefix(prefix);
    const entries: BlobListEntry[] = [];
    await this.walk(this.root, (key, info) => {
      if (!key.startsWith(prefix)) return;
      entries.push({
        key,
        size: info.size,
        ...contentTypeOrOmit(contentTypeForExtension(extensionOf(key))),
        lastModified: info.mtime,
      });
    }, options.limit);
    entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return options.limit === undefined ? entries : entries.slice(0, options.limit);
  }

  private async walk(
    directory: string,
    emit: (key: string, info: { size: number; mtime: Date }) => void,
    limit?: number,
  ): Promise<void> {
    if (limit !== undefined && limit <= 0) return;
    let dir;
    try {
      dir = await opendir(directory);
    } catch {
      return;
    }
    for await (const entry of dir) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.walk(full, emit, limit);
        continue;
      }
      if (!entry.isFile()) continue;
      const key = full.slice(this.root.length + 1).split(sep).join("/");
      emit(key, await stat(full));
    }
  }
}

function dirnameOf(path: string): string {
  const cut = path.lastIndexOf(sep);
  return cut <= 0 ? path : path.slice(0, cut);
}

function extensionOf(key: string): string {
  const dot = key.lastIndexOf(".");
  if (dot <= key.lastIndexOf("/") + 1) return "";
  return key.slice(dot).toLowerCase();
}

function contentTypeOrOmit(type: string | undefined): { contentType?: string } {
  return type === undefined ? {} : { contentType: type };
}

export function nodeStreamToWebStream(source: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      source.on("data", (chunk: Buffer | string) => {
        controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
      });
      source.on("end", () => controller.close());
      source.on("error", (error) => controller.error(error));
    },
    cancel() {
      source.destroy();
    },
  });
}

export { readStreamToBytes };
