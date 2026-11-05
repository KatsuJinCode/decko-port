import { DeckoName } from "../name.js";
import { getNameEnvironment } from "../name/environment.js";
import { findAssignedTypeName } from "../set-patterns/set-type-assignment.js";
import { ruleNamesForCard } from "../set-patterns/rule-names.js";
import type { PatternCardInput } from "../set-patterns/types.js";
import { DEFAULT_SETTING_NAME, STRUCTURE_SETTING_NAME } from "../rules/structure.js";
import type { FetchEngine } from "../fetch.js";

export interface VirtualCardResolution {
  ruleKey: string;
  templateContent: string;
  typeId?: number;
}

export interface StructureUniverseMaps {
  contents: Map<string, string | null>;
  ruleTypeIds: Map<string, number>;
}

export function resolveVirtualCardStructure(
  name: DeckoName,
  universe: StructureUniverseMaps,
  leftTypeName?: string,
  cardTypeName?: string,
  cardTypeId?: number,
): VirtualCardResolution | undefined {
  if (!name.isCompound) return undefined;
  if (universe.contents.size === 0) return undefined;
  const patternInput: PatternCardInput = {
    name,
    isNew: true,
    ...(leftTypeName !== undefined ? { leftTypeName } : {}),
    ...(cardTypeName !== undefined ? { typeName: cardTypeName } : {}),
    ...(cardTypeId !== undefined ? { typeId: cardTypeId } : {}),
  };
  const candidates = ruleNamesForCard(patternInput, STRUCTURE_SETTING_NAME);
  for (const candidate of candidates) {
    const key = DeckoName.parse(candidate).key;
    if (!universe.contents.has(key)) continue;
    const content = universe.contents.get(key) ?? null;
    if (content !== null && content.trim() === "_self") return undefined;
    return {
      ruleKey: key,
      templateContent: content ?? "",
      typeId: universe.ruleTypeIds.get(key),
    };
  }
  return undefined;
}

export interface NewCardTypeMaps {
  defaultTypeIds: Map<string, number>;
  typeNamesById: Map<number, string>;
}

export function createVirtualCardLookup(
  fetcher: FetchEngine,
  universe: StructureUniverseMaps,
  newCardTypes?: NewCardTypeMaps,
): (name: DeckoName) => Promise<VirtualCardResolution | undefined> {
  const owner = {};
  const missingLeftTypeMemo = new Map<string, string>();
  const missingLeftTypeName = (left: DeckoName): string | undefined => {
    if (newCardTypes === undefined) return undefined;
    const key = left.key;
    if (missingLeftTypeMemo.has(key)) return missingLeftTypeMemo.get(key) || undefined;
    const resolved = walkNewCardTypeName(left);
    missingLeftTypeMemo.set(key, resolved ?? "");
    return resolved;
  };
  const walkNewCardTypeName = (left: DeckoName): string | undefined => {
    if (newCardTypes === undefined) return undefined;
    const assignedName = findAssignedTypeName({ name: left.s, isNew: true });
    if (assignedName !== undefined) {
      const env = getNameEnvironment();
      const assignedId =
        env?.codename?.id(assignedName) ?? env?.lexicon?.id(DeckoName.parse(assignedName).key);
      const assignedType = assignedId === undefined ? undefined : newCardTypes.typeNamesById.get(assignedId);
      if (assignedType !== undefined) return assignedType;
    }
    if (newCardTypes.defaultTypeIds.size === 0) return undefined;
    let candidates: string[];
    try {
      candidates = ruleNamesForCard({ name: left, isNew: true }, DEFAULT_SETTING_NAME);
    } catch {
      return undefined;
    }
    for (const candidate of candidates) {
      let key: string;
      try {
        key = DeckoName.parse(candidate).key;
      } catch (err) {
        if (err instanceof Error && err.name !== "CodenameNotFoundError" && err.name !== "NameNotFoundError") {
          throw err;
        }
        continue;
      }
      const typeId = newCardTypes.defaultTypeIds.get(key);
      if (typeId === undefined) continue;
      const structureCandidates = ruleNamesForCard(
        { name: left, id: undefined, typeId, isNew: true },
        STRUCTURE_SETTING_NAME,
      );
      for (const structureCandidate of structureCandidates) {
        let structureKey: string;
        try {
          structureKey = DeckoName.parse(structureCandidate).key;
        } catch (err) {
          if (err instanceof Error && err.name !== "CodenameNotFoundError" && err.name !== "NameNotFoundError") {
            throw err;
          }
          continue;
        }
        const structureTypeId = universe.ruleTypeIds.get(structureKey);
        if (structureTypeId === undefined) continue;
        const structureContent = universe.contents.get(structureKey);
        if (structureContent !== undefined && structureContent !== null && structureContent.trim() === "_self") {
          return newCardTypes.typeNamesById.get(typeId);
        }
        return newCardTypes.typeNamesById.get(structureTypeId) ?? newCardTypes.typeNamesById.get(typeId);
      }
      return newCardTypes.typeNamesById.get(typeId);
    }
    return undefined;
  };
  const lookup = async (name: DeckoName): Promise<VirtualCardResolution | undefined> => {
    let leftTypeName: string | undefined;
    if (name.isCompound) {
      const leftKey = name.leftName?.key;
      if (leftKey !== undefined && leftKey !== "") {
        const left = await fetcher.fetchByName(leftKey);
        if (left?.typeId !== undefined) {
          const typeCard = await fetcher.fetchById(left.typeId);
          leftTypeName = typeCard?.name?.s;
        } else if (left === undefined) {
          leftTypeName = missingLeftTypeName(name.leftName!);
        }
      }
    }
    return resolveVirtualCardStructure(name, universe, leftTypeName);
  };
  return (name: DeckoName): Promise<VirtualCardResolution | undefined> => {
    const memo = DeckoName.requestMemo<Promise<VirtualCardResolution | undefined>>(owner);
    if (memo === undefined) return lookup(name);
    let hit = memo.get(name.s);
    if (hit === undefined) {
      hit = lookup(name);
      memo.set(name.s, hit);
    }
    return hit;
  };
}
