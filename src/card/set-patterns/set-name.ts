import { DeckoName, type Nameish } from "../name.js";
import { getNameEnvironment } from "../name/environment.js";
import { findPattern, type PatternSpec } from "./registry.js";

export interface ParsedSetName {
  readonly setName: string;

  readonly anchored: boolean;

  readonly patternCardName: DeckoName;

  readonly anchorName: DeckoName | null;

  readonly patternCode: string | null;

  readonly spec: PatternSpec | undefined;
}

export function parseSetName(input: Nameish): ParsedSetName {
  const setName = DeckoName.parse(input);
  const anchored = setName.isCompound;
  const patternCardName = setName.tagName;
  const anchorName = anchored ? (setName.leftName ?? null) : null;

  let patternCode: string | null = null;
  const codename = patternCardName.codename;
  if (codename !== undefined) {
    patternCode = codename;
  } else {
    patternCode = null;
  }

  const spec = patternCode === null ? undefined : findPattern(patternCode);
  return {
    setName: setName.s,
    anchored,
    patternCardName,
    anchorName,
    patternCode,
    spec,
  };
}

export function labelForParsedSet(parsed: ParsedSetName): string {
  return parsed.spec
    ? parsed.spec.label(parsed.anchorName?.s)
    : "";
}

export function uncapitalizedLabelForParsedSet(_parsed: ParsedSetName): string {
  return "";
}

export function compoundOnlyForParsedSet(
  parsed: ParsedSetName,
): boolean | null {
  if (!parsed.spec) return null;
  return parsed.spec.compoundOnly;
}

export function ruleCacheKeyBaseForParsedSet(
  parsed: ParsedSetName,
): string | undefined {
  const env = getNameEnvironment();
  const setName = DeckoName.parse(parsed.setName);
  if (setName.isCompound) {
    const leftId = setName.leftName?.cardId;
    const rightId = setName.rightName?.cardId;
    const rightCode =
      rightId === undefined ? undefined : env?.codename?.nameForId(rightId);
    if (leftId === undefined || rightCode === undefined) return undefined;
    return `${leftId}+${rightCode}`;
  }
  const id = setName.cardId;
  if (id === undefined) return undefined;
  return env?.codename?.nameForId(id);
}
