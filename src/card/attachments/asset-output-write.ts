import { parseLocalAttachmentIdentifier } from "./attachment-content.js";

export function localAttachmentUrl(identifier: string | null | undefined): string {
  if (identifier === null || identifier === undefined) return "";
  const trimmed = identifier.trim();
  if (trimmed === "") return "";
  if (trimmed.startsWith("~")) {
    const parsed = parseLocalAttachmentIdentifier(trimmed);
    if (parsed === undefined) return "";
    return `/files/${trimmed}`;
  }
  return trimmed;
}

export interface AssetOutputWriteDeps {
  engine: {
    createCard(input: {
      name: string;
      typeCode?: string;
      attachment?: { bytes: Uint8Array; originalFilename: string };
    }): Promise<unknown>;
    updateCard(input: {
      cardId: number;
      attachment?: { bytes: Uint8Array; originalFilename: string };
    }): Promise<unknown>;
  };
  fetchByName(
    name: string,
  ): Promise<{ id: number | undefined; dbContent?: string | null } | undefined>;
}

export interface StoredAssetOutput {
  url: string;
  identifier: string;
  cardId: number;
}

export async function storeAssetOutput(
  deps: AssetOutputWriteDeps,
  outputterName: string,
  content: string,
  ext: string,
): Promise<StoredAssetOutput> {
  const childName = `${outputterName}+*asset output`;
  const bytes = new TextEncoder().encode(content);
  const originalFilename = `asset_output${ext}`;

  const existing = await deps.fetchByName(childName);
  if (existing !== undefined && existing.id !== undefined) {
    await deps.engine.updateCard({
      cardId: existing.id,
      attachment: { bytes, originalFilename },
    });
  } else {
    await deps.engine.createCard({
      name: childName,
      typeCode: "file",
      attachment: { bytes, originalFilename },
    });
  }

  const stored = await deps.fetchByName(childName);
  if (stored === undefined || stored.id === undefined) {
    throw new Error(`asset output child missing after store: ${childName}`);
  }
  const identifier = stored.dbContent ?? "";
  return { url: localAttachmentUrl(identifier), identifier, cardId: stored.id };
}
