export {
  BINARY_CONTENT_TYPE,
  IMAGE_VARIANTS,
  detectAttachmentContentType,
  detectAttachmentExtension,
  extensionOfFilename,
  filenameWithVariant,
  lastContentActionIdFromIdentifier,
  localAttachmentIdentifier,
  parseLocalAttachmentIdentifier,
  type ImageVariant,
  type ParsedLocalIdentifier,
} from "./attachment-content.js";
export {
  AttachmentStore,
  BlobAttachmentStore,
  LocalAttachmentStore,
  type AttachmentStoreInput,
  type StoredAttachment,
} from "./attachment-store.js";
