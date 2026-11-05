import { DeckoName, type Nameish } from "../name.js";
import type { FetchEngine } from "../fetch.js";
import { CardActionError, type TypeSpec } from "./types.js";
import { resolveAssignedTypeIdForCard } from "../set-patterns/set-type-assignment.js";
import { patternsForCard } from "../set-patterns/card-patterns.js";
import type { PatternCardInput } from "../set-patterns/types.js";

export async function knownTypeSpec<T extends TypeSpec>(fetcher: FetchEngine, spec: T): Promise<T> {
  if (spec.typeId !== undefined && spec.typeId !== 0) return spec;
  if (spec.typeCode !== undefined && (await fetcher.codenames.id(spec.typeCode)) === undefined) {
    const { typeCode: _dropped, ...rest } = spec;
    return knownTypeSpec(fetcher, rest as T);
  }
  if (spec.typeCode === undefined && spec.typeName !== undefined) {
    const id = await fetcher.lexicon.id(DeckoName.parse(spec.typeName as Nameish).key);
    if (id === undefined) {
      const { typeName: _dropped, ...rest } = spec;
      return rest as T;
    }
  }
  return spec;
}

export async function resolveTypeId(
  fetcher: FetchEngine,
  spec: TypeSpec & { name?: Nameish },
): Promise<number> {
  if (spec.typeId !== undefined && spec.typeId !== 0) {
    await assertTypeCardExists(fetcher, spec.typeId);
    return spec.typeId;
  }
  if (spec.typeCode !== undefined) {
    const id = await fetcher.codenames.id(spec.typeCode);
    if (id === undefined) {
      throw new CardActionError("type-unknown", `${spec.typeCode} is not a known type.`);
    }
    await assertTypeCardExists(fetcher, id);
    return id;
  }
  if (spec.typeName !== undefined) {
    const id = await fetcher.lexicon.id(DeckoName.parse(spec.typeName as Nameish).key);
    if (id === undefined) {
      throw new CardActionError("type-unknown", `${String(spec.typeName)} is not a known type.`);
    }
    await assertTypeCardExists(fetcher, id);
    return id;
  }
  if (spec.name !== undefined) {
    const assignedId = await resolveAssignedTypeIdForCard(fetcher, {
      name: spec.name,
      isNew: true,
      leftTypeName: await leftTypeNameOf(fetcher, spec.name),
    });
    if (assignedId !== undefined) return assignedId;
    const templateId = await templateTypeId(fetcher, spec.name);
    if (templateId !== undefined) return templateId;
  }
  return defaultTypeId(fetcher);
}

async function leftTypeNameOf(fetcher: FetchEngine, name: Nameish): Promise<Nameish | null> {
  const parsed = DeckoName.parse(name);
  if (!parsed.isCompound || parsed.leftName === undefined) return null;
  const left = await fetcher.fetchByName(parsed.leftName.key, { skipModules: true });
  const leftTypeId = left?.typeId;
  if (leftTypeId === undefined) return null;
  return (await fetcher.fetchById(leftTypeId, { skipModules: true }))?.name ?? null;
}

async function templateTypeId(
  fetcher: FetchEngine,
  name: Nameish,
): Promise<number | undefined> {
  const parsed = DeckoName.parse(name);
  const setTypeId = await fetcher.codenames.id("set");
  const settingTypeId = await fetcher.codenames.id("setting");
  const defaultSettingCard = await fetcher.fetchWithOptions(
    [{ codename: "default" }],
    { skipModules: true },
  );
  const defaultSettingGateOpen =
    settingTypeId !== undefined &&
    defaultSettingCard !== undefined &&
    !defaultSettingCard.trash &&
    defaultSettingCard.typeId === settingTypeId;
  const structureSettingCard = await fetcher.fetchWithOptions(
    [DeckoName.parse("*structure")],
    { skipModules: true },
  );
  const structureSettingGateOpen =
    settingTypeId !== undefined &&
    structureSettingCard !== undefined &&
    !structureSettingCard.trash &&
    structureSettingCard.typeId === settingTypeId;
  const patternCard: PatternCardInput = {
    name,
    isNew: true,
    typeId: null,
    typeName: null,
    leftTypeName: null,
    isRule: false,
  };
  let defaultType: number | undefined;
  if (defaultSettingGateOpen) {
    for (const pattern of patternsForCard(patternCard)) {
      if (pattern.anchorless && pattern.patternCode === "all") continue;
      const setCard = await fetcher.fetchWithOptions(
        [DeckoName.parse(pattern.setName)],
        { skipModules: true },
      );
      if (setCard === undefined || setCard.trash) continue;
      if (setTypeId === undefined || setCard.typeId !== setTypeId) continue;
      const ruleCard = await fetcher.fetchWithOptions(
        [DeckoName.parse(pattern.setName), DeckoName.parse("*default")],
        { skipModules: true },
      );
      if (ruleCard !== undefined && ruleCard.typeId !== undefined) {
        defaultType = ruleCard.typeId;
        break;
      }
    }
  }
  let dupType = defaultType;
  if (dupType === undefined) {
    const globalDefault = await fetcher.fetchWithOptions(
      [{ codename: "all" }, { codename: "default" }],
      { skipModules: true },
    );
    dupType = globalDefault?.typeId;
  }
  let leftTypeName: Nameish | null = null;
  if (parsed.isCompound && parsed.leftName !== undefined) {
    const left = await fetcher.fetchByName(parsed.leftName.key, { skipModules: true });
    const leftTypeId = left?.typeId;
    if (leftTypeId !== undefined) {
      leftTypeName = (await fetcher.fetchById(leftTypeId, { skipModules: true }))?.name ?? null;
    }
  }
  const dupInput: PatternCardInput = {
    name,
    isNew: true,
    typeId: dupType ?? null,
    typeName:
      dupType !== undefined
        ? ((await fetcher.fetchById(dupType, { skipModules: true }))?.name ?? null)
        : null,
    leftTypeName,
    isRule: false,
  };
  if (structureSettingGateOpen) {
    for (const pattern of patternsForCard(dupInput)) {
      const setCard = await fetcher.fetchWithOptions(
        [DeckoName.parse(pattern.setName)],
        { skipModules: true },
      );
      if (setCard === undefined || setCard.trash) continue;
      if (setTypeId === undefined || setCard.typeId !== setTypeId) continue;
      const ruleCard = await fetcher.fetchWithOptions(
        [DeckoName.parse(pattern.setName), DeckoName.parse("*structure")],
        { skipModules: true },
      );
      if (ruleCard === undefined) continue;
      if (ruleCard.dbContent !== undefined && ruleCard.dbContent.trim() === "_self") {
        return defaultType;
      }
      return ruleCard.typeId;
    }
  }
  return defaultType;
}

export async function defaultTypeId(fetcher: FetchEngine): Promise<number> {
  const ruleCard = await fetcher.fetchWithOptions(
    [{ codename: "all" }, { codename: "default" }],
    { skipModules: true },
  );
  if (ruleCard === undefined || ruleCard.typeId === undefined) {
    throw new CardActionError("type-unknown", "no such type (default type rule is missing)");
  }
  return ruleCard.typeId;
}

export async function assertTypeCardExists(
  fetcher: FetchEngine,
  typeId: number,
): Promise<void> {
  const typeCard = await fetcher.fetchById(typeId, { skipModules: true });
  if (typeCard === undefined || typeCard.trash) {
    throw new CardActionError("type-unknown", "no such type");
  }
}
