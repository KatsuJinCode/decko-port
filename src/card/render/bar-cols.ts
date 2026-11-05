import type { RenderCard } from "./format.js";

export const DEFAULT_MINI_BAR_COLS: readonly [number, number] = [9, 3];

export const RULE_BAR_COLS: readonly [number, number, number] = [5, 4, 3];
export const RULE_MINI_BAR_COLS: readonly [number, number] = [6, 6];

export function parseBarCols(content: string | undefined): [number, number] | undefined {
  if (content === undefined || content === null) return undefined;
  const trimmed = content.trim();
  if (trimmed === "") return undefined;
  const parts = trimmed.split(/[,\s]+/).filter((s) => s !== "");
  if (parts.length < 2) return undefined;
  const left = Number(parts[0]);
  const right = Number(parts[1]);
  if (!Number.isInteger(left) || !Number.isInteger(right)) return undefined;
  if (left <= 0 || right <= 0) return undefined;
  return [left, right];
}

function cardIsRule(setKeys: string): boolean {
  for (const tok of setKeys.split(" ")) {
    if (tok === "RULE") return true;
  }
  return false;
}

export type BarCols = readonly [
  number,
  number,
  number,
  number,
  number,
];

export function readBarCols(card: RenderCard, ruleContent?: string): BarCols {
  const parsed = parseBarCols(ruleContent);
  if (parsed !== undefined) {
    return [parsed[0], parsed[1], parsed[0], 4, parsed[1]];
  }
  if (cardIsRule(card.setKeys)) {
    return [
      RULE_MINI_BAR_COLS[0],
      RULE_MINI_BAR_COLS[1],
      RULE_BAR_COLS[0],
      RULE_BAR_COLS[1],
      RULE_BAR_COLS[2],
    ];
  }
  return [9, 3, 0, 0, 0];
}

export function readMiniBarCols(
  card: RenderCard,
  ruleContent?: string,
): readonly [number, number] {
  const cols = readBarCols(card, ruleContent);
  return [cols[0], cols[1]];
}

export function readFullBarCols(
  card: RenderCard,
  ruleContent?: string,
): readonly number[] {
  const parsed = parseBarCols(ruleContent);
  if (parsed !== undefined) return [parsed[0], parsed[1]];
  if (cardIsRule(card.setKeys)) {
    return [RULE_BAR_COLS[0], RULE_BAR_COLS[1], RULE_BAR_COLS[2]];
  }
  return [DEFAULT_MINI_BAR_COLS[0], DEFAULT_MINI_BAR_COLS[1]];
}
