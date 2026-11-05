import type { CardRecord } from "../fetch/card-record.js";
import type { RenderCard } from "./format.js";
import { DeckoName } from "../name.js";
import { safeSetKeys } from "./set-keys.js";

interface RuleTypeEntry {
  readonly typeId?: number;
  readonly typeName: string;
  readonly typeCode: string;
}

const POINTER_RULE_TYPE: RuleTypeEntry = { typeName: "Pointer", typeCode: "pointer" };

const RULE_TYPE_BY_SETTING: ReadonlyMap<string, RuleTypeEntry> = new Map<string, RuleTypeEntry>([
  ["autoname", { typeId: 52, typeName: "Phrase", typeCode: "phrase" }],
  ["default", { typeId: 3, typeName: "RichText", typeCode: "rich_text" }],
  ["create", { typeId: 47, typeName: "List", typeCode: "list" }],
  ["read", { typeId: 47, typeName: "List", typeCode: "list" }],
  ["update", { typeId: 47, typeName: "List", typeCode: "list" }],
  ["delete", { typeId: 47, typeName: "List", typeCode: "list" }],
  ["captcha", { typeId: 51, typeName: "Toggle", typeCode: "toggle" }],
  ["head", { typeId: 50, typeName: "HTML", typeCode: "html" }],
  ["layout", POINTER_RULE_TYPE],
  ["style", POINTER_RULE_TYPE],
  ["script", { typeId: 47, typeName: "List", typeCode: "list" }],
  ["help", { typeId: 3, typeName: "RichText", typeCode: "rich_text" }],
  ["input_type", POINTER_RULE_TYPE],
  ["guide", { typeId: 3, typeName: "RichText", typeCode: "rich_text" }],
  ["content_options", { typeId: 47, typeName: "List", typeCode: "list" }],
  ["content_option_view", { typeId: 52, typeName: "Phrase", typeCode: "phrase" }],
  ["on_create", { typeId: 47, typeName: "List", typeCode: "list" }],
  ["on_update", { typeId: 47, typeName: "List", typeCode: "list" }],
  ["on_delete", { typeId: 47, typeName: "List", typeCode: "list" }],
  ["thanks", { typeId: 52, typeName: "Phrase", typeCode: "phrase" }],
  ["follow_fields", { typeId: 47, typeName: "List", typeCode: "list" }],
  ["follow", { typeId: 47, typeName: "List", typeCode: "list" }],
]);

function ruleTypeForSetting(settingCodename: string): RuleTypeEntry | undefined {
  return RULE_TYPE_BY_SETTING.get(settingCodename);
}

export const RULE_TYPE_IDS_FOR_PRELOAD: ReadonlyArray<number> = [
  ...new Set(
    [...RULE_TYPE_BY_SETTING.values()]
      .map((v) => v.typeId)
      .filter((typeId): typeId is number => typeId !== undefined),
  ),
];

export const RULE_TYPE_CODENAMES_FOR_PRELOAD: ReadonlyArray<string> = [
  ...new Set(
    [...RULE_TYPE_BY_SETTING.values()]
      .filter((v) => v.typeId === undefined)
      .map((v) => mapEntryCodename(v)),
  ),
];

export function ruleTypeIdForSetting(settingCodename: string): number | undefined {
  return RULE_TYPE_BY_SETTING.get(settingCodename)?.typeId;
}

export interface VirtualRuleCardInputs {
  readonly setCard: RenderCard;
  readonly settingCard: RenderCard;
  readonly settingCodename: string;
  readonly deckTypeCard?: RenderCard;
  readonly newCardDefaultType?: (name: DeckoName) => { typeId: number; typeName: string } | undefined;
  readonly engine?: VirtualRuleTypeEngine;
}

interface VirtualRuleTypeEngine {
  newCardDefaultType?(name: DeckoName): { typeId: number; typeName: string } | undefined;
  peekCodenameById?(id: number): string | undefined;
  peekIdByCodename?(codename: string): number | undefined;
  peekRegisteredNameForId?(id: number): string | undefined;
}

function mapEntryCodename(entry: { typeCode: string }): string {
  return entry.typeCode === "rich_text" ? "basic" : entry.typeCode;
}

function relocateRuleType(
  entry: RuleTypeEntry,
  engine: VirtualRuleTypeEngine | undefined,
): { typeId: number; typeName: string; typeCode: string } | undefined {
  if (engine?.peekIdByCodename === undefined) return undefined;
  const codename = mapEntryCodename(entry);
  if (entry.typeId !== undefined) {
    if (engine.peekCodenameById === undefined) return undefined;
    if (engine.peekCodenameById(entry.typeId) === codename) return undefined;
  }
  const typeId = engine.peekIdByCodename(codename);
  if (typeId === undefined) return undefined;
  const typeName = engine.peekRegisteredNameForId?.(typeId) ?? entry.typeName;
  return { typeId, typeName, typeCode: entry.typeCode };
}

export function buildVirtualRuleCard(inputs: VirtualRuleCardInputs): RenderCard {
  const { setCard, settingCard, settingCodename, deckTypeCard, engine } = inputs;
  const settingNamePart =
    settingCard.name?.s !== undefined && settingCard.name.s.startsWith("*")
      ? settingCard.name.s
      : `*${settingCodename}`;
  const compoundName = `${setCard.name.s}+${settingNamePart}`;
  const name = DeckoName.parse(compoundName);
  const mapped = ruleTypeForSetting(settingCodename);
  const relocated = mapped !== undefined ? relocateRuleType(mapped, engine) : undefined;
  const ruleType = relocated ?? mapped;
  const templated =
    mapped === undefined
      ? (engine?.newCardDefaultType?.(name) ?? inputs.newCardDefaultType?.(name))
      : undefined;
  const templateType =
    templated !== undefined
      ? {
          typeId: templated.typeId,
          typeName: templated.typeName,
          typeCode: engine?.peekCodenameById?.(templated.typeId),
        }
      : undefined;
  const typeId =
    ruleType !== undefined ? ruleType.typeId : (templateType?.typeId ?? settingCard.typeId);
  const deckType =
    relocated === undefined && mapped?.typeId !== undefined ? deckTypeCard : mapped === undefined ? deckTypeCard : undefined;
  const typeName =
    deckType?.name.s ?? ruleType?.typeName ?? templateType?.typeName ?? settingCard.typeName;
  const typeCode =
    deckType?.typeCode ?? ruleType?.typeCode ?? templateType?.typeCode ?? settingCard.typeCode;
  const record: CardRecord = {
    id: undefined,
    codename: undefined,
    leftId: setCard.id,
    rightId: settingCard.id,
    typeId,
    dbContent: settingCard.dbContent,
    trash: false,
    creatorId: undefined,
    updaterId: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    currentRevisionId: undefined,
    readRuleClass: undefined,
    readRuleId: undefined,
    referencesExpired: undefined,
    name,
    key: name.key,
    isNew: true,
    fromTrash: false,
    uncacheable: false,
  };
  const setKeys = safeSetKeys({
    name,
    typeId,
    typeName,
    leftTypeName: setCard.typeName,
    isRule: true,
    isNew: true,
  });
  return {
    record,
    name,
    key: name.key,
    typeName,
    typeId,
    typeCode,
    id: undefined,
    dbContent: settingCard.dbContent,
    setKeys,
  };
}
