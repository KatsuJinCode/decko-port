import { resolve } from "node:path";
import { BlobConditionalWriteUnavailableError, type BlobDriver, type PutResult } from "../../blob/driver.js";
import { FilesystemBlobDriver } from "../../blob/filesystem.js";
import { contentTypeForExtension } from "../../blob/content-types.js";
import {
  codedAttachmentIdentifier,
  filenameWithVariant,
  localAttachmentIdentifier,
} from "./attachment-content.js";
import { createVersionsFor, IMAGE_VERSION_NAMES, renditionFileNames } from "./image-renditions.js";

export interface AttachmentStoreInput {
  cardId: number;
  actionId: number;
  ext: string;
  bytes: Uint8Array;
  renditionNames?: readonly string[];
  renditionBytes?: Readonly<Record<string, Uint8Array>>;
  area?: "files" | "tmp";
  coded?: { mod: string; dirParts: readonly string[]; mountName: string };
}

export interface StoredAttachment {
  discardIfOwned?: () => Promise<boolean>;
  identifier: string;
  size: number;
}

function composeWriteCleanup(receipts: readonly (() => Promise<boolean>)[], qualified: boolean): () => Promise<boolean> {
  return async () => {
    let owned = true;
    const errors: unknown[] = [];
    for (const cleanup of [...receipts].reverse()) {
      try {
        const removed = await cleanup();
        if (removed === false) owned = false;
        else if (removed !== true) throw new Error("Exact-write cleanup receipt returned no boolean acknowledgement");
      }
      catch (error) { errors.push(error); }
    }
    if (!qualified) errors.push(new Error("Exact-write removal custody is unavailable for part of this attachment; retained output requires reconciliation"));
    if (errors.length !== 0) throw new AggregateError(errors, "Attachment write cleanup remains unresolved");
    return owned;
  };
}

function preserveFailureWithCleanup(error: unknown, cleanup: () => Promise<boolean>): unknown {
  if (error !== null && typeof error === "object") {
    const descriptor = Object.getOwnPropertyDescriptor(error, "discardIfOwned");
    if ((descriptor === undefined && Object.isExtensible(error)) || descriptor?.configurable || (descriptor !== undefined && "writable" in descriptor && descriptor.writable)) {
      Object.defineProperty(error, "discardIfOwned", { value: cleanup });
      return error;
    }
  }
  const retained = new AggregateError([error], `Attachment write failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  Object.defineProperty(retained, "discardIfOwned", { value: cleanup });
  return retained;
}

export interface AttachmentStore {
  store(input: AttachmentStoreInput): Promise<StoredAttachment>;
  restoreIfUnchanged?(input: AttachmentStoreInput, expected: Uint8Array): Promise<boolean>;
  read(cardId: number, actionId: number, ext: string, variant?: string, area?: "files" | "tmp"): Promise<Uint8Array | undefined>;
  remove?(cardId: number, actionId: number, ext: string, area?: "files" | "tmp"): Promise<void>;
  discard?(input: AttachmentStoreInput): Promise<void>;
}

export class BlobAttachmentStore implements AttachmentStore {
  private readonly blobs: BlobDriver;
  private readonly tmpBlobs?: BlobDriver;

  constructor(blobs: BlobDriver, tmpBlobs?: BlobDriver) {
    this.blobs = blobs;
    this.tmpBlobs = tmpBlobs;
  }

  private blobsFor(area?: "files" | "tmp"): BlobDriver {
    return (area === "tmp" && this.tmpBlobs !== undefined ? this.tmpBlobs : this.blobs);
  }

  private key(cardId: number, name: string): string {
    return `${cardId}/${name}`;
  }

  private keyFor(cardId: number, name: string, area?: "files" | "tmp"): string {
    if (area !== "tmp") return `${cardId}/${name}`;
    return this.tmpBlobs !== undefined ? `files/${cardId}/${name}` : `tmp/${cardId}/${name}`;
  }

  async store(input: AttachmentStoreInput): Promise<StoredAttachment> {
    const coded = input.coded;
    const prefix = coded === undefined ? `${input.cardId}/` : `${coded.dirParts.join("/")}/`;
    const names = input.renditionNames ?? [coded === undefined ? filenameWithVariant(input.actionId, input.ext) : `${coded.mountName}${input.ext}`];
    let stored = 0;
    const cleanupReceipts: (() => Promise<boolean>)[] = [];
    let cleanupQualified = true;
    const skipped = Symbol("rendition blocked by earlier same-key failure");
    const pendingByName = new Map<string, Promise<PutResult | typeof skipped>>();
    const writes = await Promise.allSettled(names.map((name) => {
      const previous = pendingByName.get(name);
      const write = (async (): Promise<PutResult | typeof skipped> => {
        if (previous !== undefined) {
          try { if (await previous === skipped) return skipped; }
          catch { return skipped; }
        }
        const bytes = input.renditionBytes?.[name] ?? input.bytes;
        return this.blobsFor(input.area).put(
          coded === undefined ? this.keyFor(input.cardId, name, input.area) : `${prefix}${name}`,
          bytes,
          { contentType: contentTypeForExtension(input.ext) },
        );
      })();
      pendingByName.set(name, write);
      return write;
    }));
    const failures: unknown[] = [];
    for (const write of writes) {
      if (write.status === "rejected") {
        const error: unknown = write.reason;
        failures.push(error);
        const failedReceipt = error !== null && typeof error === "object" && "discardIfOwned" in error
          ? error.discardIfOwned : undefined;
        if (typeof failedReceipt === "function") cleanupReceipts.push(failedReceipt.bind(error));
        else cleanupQualified = false;
        continue;
      }
      if (write.value === skipped) continue;
      const result = write.value;
      stored = Math.max(stored, result.size);
      const receipt = result.discardIfOwned;
      if (typeof receipt !== "function") cleanupQualified = false;
      else cleanupReceipts.push(receipt.bind(result));
    }
    if (failures.length !== 0) {
      const error = failures.length === 1 ? failures[0]
        : new AggregateError(failures, "Attachment rendition writes failed");
      if (cleanupReceipts.length === 0) throw error;
      throw preserveFailureWithCleanup(error, composeWriteCleanup(cleanupReceipts, cleanupQualified));
    }
    const result: StoredAttachment = {
      identifier:
        coded !== undefined
          ? codedAttachmentIdentifier(coded.dirParts, coded.mod, input.ext)
          : localAttachmentIdentifier(input.cardId, input.actionId, input.ext),
      size: Math.max(stored, input.bytes.length),
    };
    if (cleanupQualified || cleanupReceipts.length !== 0) Object.defineProperty(result, "discardIfOwned", { value: composeWriteCleanup(cleanupReceipts, cleanupQualified) });
    return result;
  }

  async restoreIfUnchanged(input: AttachmentStoreInput, expected: Uint8Array): Promise<boolean> {
    if (input.coded !== undefined || input.renditionNames !== undefined || input.renditionBytes !== undefined) {
      throw new BlobConditionalWriteUnavailableError("Conditional restoration is qualified only for a single regular attachment object");
    }
    const driver = this.blobsFor(input.area);
    if (typeof driver.putIfUnchanged !== "function") {
      throw new BlobConditionalWriteUnavailableError(driver.conditionalWriteUnavailableReason ?? "The selected blob driver exposes no atomic conditional replacement");
    }
    const name = filenameWithVariant(input.actionId, input.ext);
    return driver.putIfUnchanged(this.keyFor(input.cardId, name, input.area), new Uint8Array(expected), new Uint8Array(input.bytes),
      { contentType: contentTypeForExtension(input.ext) });
  }

  async discard(input: AttachmentStoreInput): Promise<void> {
    const coded = input.coded;
    const prefix = coded === undefined ? `${input.cardId}/` : `${coded.dirParts.join("/")}/`;
    const names = input.renditionNames ?? [coded === undefined ? filenameWithVariant(input.actionId, input.ext) : `${coded.mountName}${input.ext}`];
    for (const name of names) {
      await this.blobsFor(input.area).delete(
        coded === undefined ? this.keyFor(input.cardId, name, input.area) : `${prefix}${name}`,
      );
    }
  }

  async remove(cardId: number, actionId: number, ext: string, area?: "files" | "tmp"): Promise<void> {
    const names = [filenameWithVariant(actionId, ext), filenameWithVariant(actionId, ext, "original")];
    if (createVersionsFor(ext)) {
      for (const version of IMAGE_VERSION_NAMES) names.push(filenameWithVariant(actionId, ext, version));
    }
    for (const name of names) {
      await this.blobsFor(area).delete(this.keyFor(cardId, name, area));
    }
  }

  async read(
    cardId: number,
    actionId: number,
    ext: string,
    variant?: string,
    area?: "files" | "tmp",
  ): Promise<Uint8Array | undefined> {
    const candidates =
      variant === undefined || variant === ""
        ? [filenameWithVariant(actionId, ext), filenameWithVariant(actionId, ext, "original")]
        : [filenameWithVariant(actionId, ext, variant), filenameWithVariant(actionId, ext)];
    for (const name of candidates) {
      const bytes = await this.blobsFor(area).getBytes(this.keyFor(cardId, name, area));
      if (bytes !== undefined) return bytes;
    }
    return undefined;
  }
}

export class LocalAttachmentStore extends BlobAttachmentStore {
  constructor(filesDir: string) {
    const resolved = resolve(filesDir);
    super(new FilesystemBlobDriver(resolved), new FilesystemBlobDriver(resolve(resolved, "..", "tmp")));
  }
}
