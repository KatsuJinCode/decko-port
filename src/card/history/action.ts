import type { SQLBoolean } from "../../server/schema.js";

export const ACTION_TYPE_CODES = {
  create: 0,
  update: 1,
  delete: 2,
} as const;

export type ActionType = keyof typeof ACTION_TYPE_CODES;

export function actionTypeCode(type: ActionType): number {
  return ACTION_TYPE_CODES[type];
}

export function actionTypeFromCode(code: number): ActionType | undefined {
  const entry = Object.entries(ACTION_TYPE_CODES).find(([, v]) => v === code);
  return entry?.[0] as ActionType | undefined;
}

export function identifyAction(input: {
  trashBefore: SQLBoolean;
  trashAfter: SQLBoolean;
  isNewCard: boolean;
}): ActionType {
  if (input.trashAfter === 1 && input.trashBefore !== input.trashAfter) {
    return "delete";
  }
  if (input.isNewCard) return "create";
  return "update";
}
