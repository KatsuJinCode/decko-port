import { DeckoName, type Cardish } from "../card/name.js";

export async function composeCqlResultName(
  prepend: unknown,
  name: DeckoName,
  append: unknown,
  lookupName: (id: number) => Promise<DeckoName | undefined>,
): Promise<DeckoName> {
  async function resolvePart(value: unknown): Promise<Cardish> {
    if (value === null || typeof value === "string" || value instanceof DeckoName) return value;
    if (Array.isArray(value)) {
      const parts: Cardish[] = [];
      for (const part of value) parts.push(await resolvePart(part));
      return parts;
    }
    if (typeof value === "number" && Number.isInteger(value)) {
      const resolved = await lookupName(value);
      if (resolved !== undefined) return resolved;
    }
    const rubyClass = typeof value === "boolean" ? (value ? "TrueClass" : "FalseClass")
      : typeof value === "number" ? (Number.isInteger(value) ? "Integer" : "Float")
        : value !== null && typeof value === "object" ? "Hash" : typeof value;
    const error = new Error(`${rubyClass} not supported as name identifier`);
    error.name = "ArgumentError";
    throw error;
  }

  const parts: Cardish[] = [];
  for (const value of [prepend, name, append]) {
    if (value !== null && value !== undefined) parts.push(await resolvePart(value));
  }
  return DeckoName.compose(parts);
}
