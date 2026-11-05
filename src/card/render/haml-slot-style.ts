let inHamlHash =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.DECKO_HAML_SLOT_STYLE !== "separate";

export function setHamlSlotStyle(style: "hash" | "separate"): void {
  inHamlHash = style === "hash";
}

export function hamlSlotInHash(): boolean {
  return inHamlHash;
}
