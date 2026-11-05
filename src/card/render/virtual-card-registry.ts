import { cardBelongsToSet } from "./content-overrides.js";
import type { RenderCard } from "./format.js";

export interface RegisteredVirtualCardSet {
  readonly setPath: string;
  readonly modName: string;
}

export class VirtualCardRegistry {
  private readonly byPath = new Map<string, RegisteredVirtualCardSet>();

  register(entry: RegisteredVirtualCardSet): void {
    this.byPath.set(entry.setPath, entry);
  }

  clear(): void {
    this.byPath.clear();
  }

  paths(): string[] {
    return [...this.byPath.keys()];
  }

  matches(card: RenderCard): boolean {
    for (const setPath of this.byPath.keys()) {
      if (cardBelongsToSet(card, setPath, { strictCodenames: true })) return true;
    }
    return false;
  }
}

let defaultRegistry: VirtualCardRegistry | undefined = new VirtualCardRegistry();

export function setDefaultVirtualCardRegistry(
  registry: VirtualCardRegistry | undefined,
): void {
  defaultRegistry = registry;
}

export function virtualCardRegistry(): VirtualCardRegistry | undefined {
  return defaultRegistry;
}

export function isKnownVirtualCard(card: RenderCard): boolean {
  return defaultRegistry?.matches(card) === true;
}
