import type { FetchEngine } from "../fetch.js";
import type { DeckoName } from "../name.js";
import type { PatternCardInput } from "../set-patterns/types.js";
import { resolveTypeId } from "./type-resolution.js";
import { CardActionError } from "./types.js";
import { findRule } from "../rules/lookup.js";

export async function ruleContentForCard(
  fetch: FetchEngine,
  pattern: PatternCardInput,
  settingCode: string,
): Promise<unknown> {
  const settingName = (await fetch.codenames.name(settingCode))?.s ?? `*${settingCode}`;
  const found = await findRule(fetch, pattern, settingName, settingCode);
  return found?.rule.dbContent;
}

export async function ruleWalkPatternInput(
  fetch: FetchEngine,
  base: {
    name: DeckoName;
    id?: number;
    isNew: boolean;
    typeId?: number | null;
  },
): Promise<PatternCardInput> {
  const storedTypeId = base.typeId !== undefined ? base.typeId : (await cardTypeId(fetch, base.name)) ?? null;
  const typeId = storedTypeId;
  const typeName = typeId !== null && typeId !== undefined ? await typeNameOfId(fetch, typeId) : undefined;
  let leftTypeName: string | undefined;
  let isRule = false;
  if (base.name.isCompound) {
    leftTypeName = await leftTypeNameOf(fetch, base.name);
    isRule = (await isStandardRuleName(fetch, base.name)) || (await isPreferenceName(fetch, base.name));
  }
  return {
    name: base.name.s,
    id: base.id,
    isNew: base.isNew,
    typeId,
    typeName,
    leftTypeName,
    isRule,
  };
}

async function cardTypeId(
  fetch: FetchEngine,
  name: DeckoName,
): Promise<number | undefined> {
  const record = await fetch.fetch(name.s);
  return record?.typeId;
}

async function typeNameOfId(
  fetch: FetchEngine,
  typeId: number,
): Promise<string | undefined> {
  const record = await fetch.fetch(typeId);
  return record?.name?.s;
}

async function leftTypeNameOf(
  fetch: FetchEngine,
  name: DeckoName,
): Promise<string | undefined> {
  return quickTypeName(fetch, name.leftName);
}

export async function quickTypeName(
  fetch: FetchEngine,
  left: DeckoName | undefined,
): Promise<string | undefined> {
  if (left === undefined || left.s === "") return "RichText";
  const record = await fetch.fetch(left.s);
  if (record !== undefined) {
    const leftTypeId = record.typeId;
    if (leftTypeId === undefined || leftTypeId === null) return undefined;
    return typeNameOfId(fetch, leftTypeId);
  }
  let newTypeId: number;
  try {
    newTypeId = await resolveTypeId(fetch, { name: left });
  } catch (err) {
    if (err instanceof CardActionError) return undefined;
    throw err;
  }
  return typeNameOfId(fetch, newTypeId);
}

export async function isStandardRuleName(
  fetch: FetchEngine,
  name: DeckoName,
): Promise<boolean> {
  const left = name.leftName;
  const right = name.rightName;
  if (left === undefined || right === undefined) return false;
  const [setId, settingId] = await Promise.all([
    fetch.codenames.id("set"),
    fetch.codenames.id("setting"),
  ]);
  if (setId === undefined || settingId === undefined) return false;
  const [leftRecord, rightRecord] = await Promise.all([
    fetch.fetch(left.s),
    fetch.fetch(right.s),
  ]);
  return (
    leftRecord !== undefined &&
    rightRecord !== undefined &&
    leftRecord.typeId === setId &&
    rightRecord.typeId === settingId
  );
}

export async function isPreferenceName(fetch: FetchEngine, name: DeckoName): Promise<boolean> {
  const parts = name.parts;
  if (parts.length <= 2) return false;
  const [setId, settingId, userId] = await Promise.all([
    fetch.codenames.id("set"),
    fetch.codenames.id("setting"),
    fetch.codenames.id("user"),
  ]);
  if (setId === undefined || settingId === undefined) return false;
  const right = name.rightName;
  if (right === undefined) return false;
  const rightRecord = await fetch.fetch(right.s);
  if (rightRecord?.typeId !== settingId) return false;
  const trunk = parts.slice(0, -2).join("+");
  const trunkRecord = await fetch.fetch(trunk);
  if (trunkRecord?.typeId !== setId) return false;
  const preferer = await fetch.fetch(parts[parts.length - 2] ?? "");
  if (preferer === undefined) return false;
  return (userId !== undefined && preferer.typeId === userId) || preferer.codename === "all";
}
