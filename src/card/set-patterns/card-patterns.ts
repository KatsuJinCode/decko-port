import type { PatternCardInput } from "./types.js";
import { PATTERN_TABLE } from "./registry.js";
import { PatternInstance, type PatternCardNames } from "./instance.js";

export function concretePatternsForCard(
  card: PatternCardInput,
  patternNames?: PatternCardNames,
): PatternInstance[] {
  const instances: PatternInstance[] = [];
  for (const spec of PATTERN_TABLE) {
    const instance = PatternInstance.tryNew(spec, card, patternNames);
    if (instance) instances.push(instance);
  }
  return instances;
}

export function patternsForCard(card: PatternCardInput, patternNames?: PatternCardNames): PatternInstance[] {
  const concrete = concretePatternsForCard(card, patternNames);
  return card.isNew ? concrete.slice(1) : concrete;
}

export function setNamesForCard(card: PatternCardInput): string[] {
  return patternsForCard(card).map((pattern) => pattern.setName);
}

export function ruleLookupKeysForCard(card: PatternCardInput): string[] {
  return patternsForCard(card)
    .map((pattern) => pattern.ruleLookupKey)
    .filter((key): key is string => key !== null);
}

export function safeSetKeysForCard(card: PatternCardInput): string {
  return patternsForCard(card)
    .map((pattern) => pattern.safeKey)
    .reverse()
    .join(" ");
}

export function typeAssigningModuleKeys(card: PatternCardInput): string[] {
  const keys: string[] = [];
  for (const pattern of patternsForCard(card)) {
    if (!pattern.assignsType) continue;
    const key = pattern.moduleKey;
    if (key !== null) keys.push(key);
  }
  return keys;
}
