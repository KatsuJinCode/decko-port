export const IMAGE_VERSION_NAMES = ["icon", "small", "medium", "large"] as const;

export type ImageVersionName = (typeof IMAGE_VERSION_NAMES)[number];

export function mountUsesImageUploader(mountCodename: string): boolean {
  return mountCodename === "image";
}

export function createVersionsFor(ext: string): boolean {
  return ext !== ".svg";
}

export function renditionFileNames(actionId: number, ext: string): string[] {
  if (!createVersionsFor(ext)) return [`${actionId}${ext}`];
  return [
    `${actionId}-original${ext}`,
    ...IMAGE_VERSION_NAMES.map((v) => `${actionId}-${v}${ext}`),
  ];
}

export function versionBytes(original: Uint8Array): Uint8Array {
  return original;
}
