import { DeckoName } from "../name.js";
import {
  allLabel,
  allPlusLabel,
  allPlusShortLabel,
  allShortLabel,
  rightGenericLabel,
  rightLabel,
  rightShortLabel,
  ruleLabel,
  ruleShortLabel,
  rstarLabel,
  rstarShortLabel,
  selfGenericLabel,
  selfLabel,
  selfShortLabel,
  starLabel,
  starShortLabel,
  typeGenericLabel,
  typeLabel,
  typePlusRightGenericLabel,
  typePlusRightLabel,
  typePlusRightShortLabel,
  typeShortLabel,
} from "./labels.js";
import type { PatternCardInput, PrototypeArgs } from "./types.js";

export interface PatternSpec {
  readonly loadIndex: number;

  readonly registerSite: string;

  readonly code: string;

  readonly patternCardName: string;

  readonly compoundOnly: boolean;

  readonly assignsType: boolean;

  readonly staticAnchorPartsCount: number;

  applies(card: PatternCardInput): boolean;

  anchorName?(card: PatternCardInput): string | undefined;

  anchorId?(card: PatternCardInput): number | null | undefined;

  anchorPartsCountFor?(anchorName: string | undefined): number;

  label(anchor: string | undefined): string;

  shortLabel(anchor: string | undefined): string;

  genericLabel(): string;

  prototypeArgs(anchor: string | undefined): PrototypeArgs;
}

function defaultApplies(compoundOnly: boolean, card: PatternCardInput): boolean {
  return compoundOnly ? DeckoName.parse(card.name).isCompound : true;
}

function nameOf(card: PatternCardInput): DeckoName {
  return DeckoName.parse(card.name);
}

function labelAsGeneric(
  label: (anchor: string | undefined) => string,
): () => string {
  return () => label(undefined);
}

export const PATTERN_TABLE: readonly PatternSpec[] = Object.freeze([
  {
    loadIndex: 9,
    registerSite: "card-1.110.0 mod/core/set_pattern/09_self.rb",
    code: "self",
    patternCardName: "*self",
    compoundOnly: false,
    assignsType: false,
    staticAnchorPartsCount: 1,
    applies: () => true,
    anchorName: (card) => nameOf(card).s,
    anchorId: (card) => card.id ?? null,
    anchorPartsCountFor: (anchorName) =>
      anchorName === undefined
        ? 1
        : DeckoName.parse(anchorName).partNames.length || 1,
    label: (anchor) => `The card "${anchor}"`,
    shortLabel: (anchor) => anchor ?? "",
    genericLabel: () => "a single card",
    prototypeArgs: (anchor) => ({ name: anchor ?? "" }),
  },
  {
    loadIndex: 8,
    registerSite: "card-1.110.0 mod/core/set_pattern/08_type_plus_right.rb",
    code: "type_plus_right",
    patternCardName: "*type plus right",
    compoundOnly: true,
    assignsType: true,
    staticAnchorPartsCount: 2,
    applies: (card) => defaultApplies(true, card),
    anchorName: (card) => {
      const leftType =
        card.leftTypeName == null
          ? "RichText"
          : DeckoName.parse(card.leftTypeName).s;
      return `${leftType}+${nameOf(card).tag}`;
    },
    label: typePlusRightLabel,
    shortLabel: typePlusRightShortLabel,
    genericLabel: typePlusRightGenericLabel,
    prototypeArgs: (anchor) => {
      const anchorName = anchor ?? "";
      const joint = anchorName.lastIndexOf("+");
      return {
        name: `+${joint < 0 ? anchorName : anchorName.slice(joint + 1)}`,
        supercard: {
          name: "*dummy",
          type: joint < 0 ? "" : anchorName.slice(0, joint),
        },
      };
    },
  },
  {
    loadIndex: 7,
    registerSite: "card-1.110.0 mod/core/set_pattern/07_right.rb",
    code: "right",
    patternCardName: "*right",
    compoundOnly: true,
    assignsType: true,
    staticAnchorPartsCount: 1,
    applies: (card) => defaultApplies(true, card),
    anchorName: (card) => nameOf(card).tag,
    label: rightLabel,
    shortLabel: rightShortLabel,
    genericLabel: rightGenericLabel,
    prototypeArgs: (anchor) => ({ name: `*dummy+${anchor ?? ""}` }),
  },
  {
    loadIndex: 6,
    registerSite: "card-1.110.0 mod/core/set_pattern/06_rule.rb",
    code: "rule",
    patternCardName: "*rule",
    compoundOnly: true,
    assignsType: false,
    staticAnchorPartsCount: 0,
    applies: (card) => card.isRule === true,
    label: ruleLabel,
    shortLabel: ruleShortLabel,
    genericLabel: labelAsGeneric(ruleLabel),
    prototypeArgs: () => ({ name: "*all+*create" }),
  },
  {
    loadIndex: 5,
    registerSite: "card-1.110.0 mod/core/set_pattern/05_rstar.rb",
    code: "rstar",
    patternCardName: "*rstar",
    compoundOnly: true,
    assignsType: false,
    staticAnchorPartsCount: 0,
    applies: (card) => nameOf(card).isRStar,
    label: rstarLabel,
    shortLabel: rstarShortLabel,
    genericLabel: labelAsGeneric(rstarLabel),
    prototypeArgs: () => ({ name: "*dummy+*dummy" }),
  },
  {
    loadIndex: 4,
    registerSite: "card-1.110.0 mod/core/set_pattern/04_star.rb",
    code: "star",
    patternCardName: "*star",
    compoundOnly: false,
    assignsType: false,
    staticAnchorPartsCount: 0,
    applies: (card) => nameOf(card).isStar,
    label: starLabel,
    shortLabel: starShortLabel,
    genericLabel: labelAsGeneric(starLabel),
    prototypeArgs: () => ({ name: "*dummy" }),
  },
  {
    loadIndex: 3,
    registerSite: "card-1.110.0 mod/core/set_pattern/03_type.rb",
    code: "type",
    patternCardName: "*type",
    compoundOnly: false,
    assignsType: false,
    staticAnchorPartsCount: 1,
    applies: (card) => card.typeId != null,
    anchorName: (card) =>
      card.typeName == null ? undefined : DeckoName.parse(card.typeName).s,
    anchorId: (card) => card.typeId ?? null,
    label: typeLabel,
    shortLabel: typeShortLabel,
    genericLabel: typeGenericLabel,
    prototypeArgs: (anchor) => ({ type: anchor ?? "" }),
  },
  {
    loadIndex: 2,
    registerSite: "card-1.110.0 mod/core/set_pattern/02_all_plus.rb",
    code: "all_plus",
    patternCardName: "*all plus",
    compoundOnly: true,
    assignsType: false,
    staticAnchorPartsCount: 0,
    applies: (card) => defaultApplies(true, card),
    label: allPlusLabel,
    shortLabel: allPlusShortLabel,
    genericLabel: labelAsGeneric(allPlusLabel),
    prototypeArgs: () => ({ name: "+" }),
  },
  {
    loadIndex: 1,
    registerSite: "card-1.110.0 mod/core/set_pattern/01_all.rb",
    code: "all",
    patternCardName: "*all",
    compoundOnly: false,
    assignsType: false,
    staticAnchorPartsCount: 0,
    applies: () => true,
    label: allLabel,
    shortLabel: allShortLabel,
    genericLabel: labelAsGeneric(allLabel),
    prototypeArgs: () => ({}),
  },
]);

export const SELF_PATTERN_CODE = "self";

export function findPattern(patternCode: string): PatternSpec | undefined {
  return PATTERN_TABLE.find((spec) => spec.code === patternCode);
}

export function patternCodes(): string[] {
  return PATTERN_TABLE.map((spec) => spec.code);
}

export function patternIds(
  codenameId: (code: string) => number | undefined,
): (number | undefined)[] {
  return PATTERN_TABLE.map((spec) => codenameId(spec.code));
}

export function groupedCodes(withAll = true): string[][] {
  const nonbase = patternCodes()
    .filter((code) => code !== "all")
    .reverse();
  const groups: string[][] = [["abstract"], nonbase];
  if (withAll) groups.unshift(["all"]);
  return groups;
}

export function reloadableCodes(): string[] {
  return [...patternCodes().filter((code) => code !== "all"), "abstract"];
}
