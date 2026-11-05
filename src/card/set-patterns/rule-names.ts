import { DeckoName, type Nameish } from "../name.js";
import { getNameEnvironment } from "../name/environment.js";
import type { PatternCardInput } from "./types.js";
import { patternsForCard } from "./card-patterns.js";
import type { PatternCardNames } from "./instance.js";

export function ruleName(setName: Nameish, settingName: Nameish): string {
  return `${DeckoName.parse(setName).s}+${DeckoName.parse(settingName).s}`;
}

export function ruleNamesForCard(
  card: PatternCardInput,
  settingName: Nameish,
  patternNames?: PatternCardNames,
): string[] {
  const setting = DeckoName.parse(settingName).s;
  let settingPart: string | undefined;
  return patternsForCard(card, patternNames).map((pattern) => {
    const setPart = DeckoName.parse(pattern.setName).s;
    settingPart ??= DeckoName.parse(setting).s;
    return `${setPart}+${settingPart}`;
  });
}

export function settingCardNameForCode(settingCode: string): string {
  const name = getNameEnvironment()?.codename?.name(settingCode);
  return name ?? `*${settingCode}`;
}

export function ruleCacheKey(
  ruleLookupKey: string,
  settingCode: string,
): string {
  return `${ruleLookupKey}+${settingCode}`;
}

export function ruleCacheKeyFromRow(
  anchorId: number | null | undefined,
  patternCode: string,
  settingCode: string,
): string {
  return [anchorId, patternCode, settingCode]
    .filter((part) => part !== null && part !== undefined)
    .map(String)
    .join("+");
}

export function preferenceCacheKeys(
  settingCode: string,
  userId: number | undefined,
  allUserId: number,
): string[] {
  return userId === undefined
    ? [`${settingCode}+${allUserId}`]
    : [`${settingCode}+${userId}`, `${settingCode}+${allUserId}`];
}

export function ruleClassName(
  ruleCardName: Nameish,
  trunkIsSet: boolean,
): string | null {
  if (!trunkIsSet) return null;
  return DeckoName.parse(ruleCardName).trunkName.tag;
}

export function ruleSetCardName(
  ruleCardName: Nameish,
  isPreference = false,
): string {
  const n = DeckoName.parse(ruleCardName);
  return isPreference ? n.trunkName.trunkName.s : n.trunkName.s;
}

export function ruleSettingCardName(ruleCardName: Nameish): string {
  return DeckoName.parse(ruleCardName).tag;
}
