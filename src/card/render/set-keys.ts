import { safeSetKeysForCard } from "../set-patterns/card-patterns.js";
import type { DeckoName } from "../name.js";

export interface SetKeysInput {
  name: DeckoName;
  typeId: number | undefined;
  typeName: string | undefined;
  leftTypeName: string | undefined;
  isRule?: boolean;
  isNew?: boolean;
}

export function safeSetKeys(input: SetKeysInput): string {
  return safeSetKeysForCard({
    name: input.name.s,
    typeId: input.typeId,
    typeName: input.typeName,
    leftTypeName: input.leftTypeName,
    isRule: input.isRule,
    ...(input.isNew === true ? { isNew: true } : {}),
  });
}
