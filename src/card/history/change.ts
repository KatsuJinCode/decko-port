import type { SQLBoolean } from "../../server/schema.js";

export const TRACKED_FIELDS = [
  "name",
  "type_id",
  "db_content",
  "trash",
  "left_id",
  "right_id",
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

export type ChangeValue = string | number | boolean | null;

export interface CardFieldState {
  name: string | null;
  type_id: number;
  db_content: string | null;
  trash: SQLBoolean;
  left_id: number | null;
  right_id: number | null;
}

export function trackedFieldIndex(field: TrackedField): number {
  return TRACKED_FIELDS.indexOf(field);
}

export function trackedFieldByIndex(index: number): TrackedField | undefined {
  return TRACKED_FIELDS[index];
}

export function serializeChangeValue(value: ChangeValue): string | null {
  if (value === null) return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "t" : "f";
  return value;
}

export function changeValueForField(
  field: TrackedField,
  value: ChangeValue,
): string | null {
  if (field === "trash" && typeof value === "number") {
    return serializeChangeValue(value !== 0);
  }
  return serializeChangeValue(value);
}

export function diffTrackedFields(
  before: CardFieldState,
  after: CardFieldState,
): TrackedField[] {
  return TRACKED_FIELDS.filter((field) => before[field] !== after[field]);
}
