export {
  PATTERN_TABLE,
  findPattern,
  patternCodes,
  patternIds,
  groupedCodes,
  reloadableCodes,
  SELF_PATTERN_CODE,
  type PatternSpec,
} from "./set-patterns/registry.js";

export { PatternInstance } from "./set-patterns/instance.js";

export {
  concretePatternsForCard,
  patternsForCard,
  setNamesForCard,
  ruleLookupKeysForCard,
  safeSetKeysForCard,
  typeAssigningModuleKeys,
} from "./set-patterns/card-patterns.js";

export {
  parseSetName,
  labelForParsedSet,
  uncapitalizedLabelForParsedSet,
  compoundOnlyForParsedSet,
  ruleCacheKeyBaseForParsedSet,
  type ParsedSetName,
} from "./set-patterns/set-name.js";

export {
  ruleName,
  ruleNamesForCard,
  settingCardNameForCode,
  ruleCacheKey,
  ruleCacheKeyFromRow,
  preferenceCacheKeys,
  ruleClassName,
  ruleSetCardName,
  ruleSettingCardName,
} from "./set-patterns/rule-names.js";

export {
  registerSetTypeAssignment,
  resetSetTypeAssignments,
  getSetTypeAssignment,
  findAssignedTypeName,
  resolveAssignedTypeId,
  resolveAssignedTypeIdForCard,
  listAssignedTypeNamesForCard,
  type SetTypeAssignment,
  type AssignedTypeCardInput,
  type AssignedTypeName,
} from "./set-patterns/set-type-assignment.js";

export type { PatternCardInput, PrototypeArgs } from "./set-patterns/types.js";
