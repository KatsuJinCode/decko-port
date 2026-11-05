import { EXTENSION_CONTENT_TYPES } from "../card/attachments/attachment-content.js";

export { EXTENSION_CONTENT_TYPES };

export function contentTypeForExtension(extension: string): string | undefined {
  if (extension.length === 0) return undefined;
  const normalized = (extension.startsWith(".") ? extension : `.${extension}`).toLowerCase();
  return EXTENSION_CONTENT_TYPES[normalized];
}