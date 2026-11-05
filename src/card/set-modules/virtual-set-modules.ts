import { DeckoName } from "../name.js";
import { setModuleShortname } from "../mod-loader/mod-registrar.js";
import { safeSetKeys } from "../render/set-keys.js";
import { setModuleShortnameForToken } from "./set-module-membership.js";

const virtualSetModuleShortnames = new Set<string>();

export function registerVirtualSetModule(setPath: string): void {
  virtualSetModuleShortnames.add(setModuleShortname(setPath));
}

export function virtualSetModuleShortnameList(): readonly string[] {
  return [...virtualSetModuleShortnames];
}

export function clearVirtualSetModules(): void {
  virtualSetModuleShortnames.clear();
}

export interface VirtualSetCardInput {
  readonly typeName?: string;
  readonly leftTypeName?: string;
}

export function isVirtualSetCardName(
  name: DeckoName,
  input: VirtualSetCardInput = {},
): boolean {
  if (!name.isCompound) return false;
  if (virtualSetModuleShortnames.size === 0) return false;
  const setKeys = safeSetKeys({
    name,
    typeId: undefined,
    typeName: input.typeName,
    leftTypeName: input.leftTypeName,
    isNew: true,
  });
  if (setKeys.trim() === "") return false;
  for (const token of setKeys.split(/\s+/)) {
    if (token === "") continue;
    const shortname = setModuleShortnameForToken(token);
    if (shortname !== null && virtualSetModuleShortnames.has(shortname)) {
      return true;
    }
  }
  return false;
}