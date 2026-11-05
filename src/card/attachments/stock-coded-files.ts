import { assets } from "../../../vendor/decko-coded-attachments/assets.js";

export function stockCodedFile(content: string | null | undefined, size = "original") {
  if (!content || !Object.hasOwn(assets, content)) return undefined;
  const asset = assets[content]!;
  const variant = asset.extension === "svg" && ["original", "icon", "small", "medium", "large"].includes(size) ? "original" : size;
  const file = Object.hasOwn(asset.versions, variant) ? asset.versions[variant] : undefined;
  if (!file) return undefined;
  return {
    codename: asset.codename, extension: asset.extension, sha256: file.sha256,
    bytes: Uint8Array.from(atob(file.base64), char => char.charCodeAt(0)),
  };
}
