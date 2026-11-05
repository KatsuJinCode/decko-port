export function normalizeModName(name: string): string {
  return name.replace(/^card-mod-/, "");
}

export function byteSort(values: readonly string[]): string[] {
  return [...values].sort();
}

export interface ModDirsInput {
  readonly deckModDirs?: readonly {
    readonly listing?: readonly string[];
    readonly modfile?: readonly string[];
  }[];

  readonly gemMods?: readonly string[];

  readonly coreMods?: readonly string[];
}

export interface ResolvedModEntry {
  readonly name: string;
  readonly group: string;
}

export class ModNotFoundError extends Error {
  readonly modName: string;
  constructor(modName: string) {
    super(`mod not found: ${modName}`);
    this.name = "ModNotFoundError";
    this.modName = modName;
  }
}

export class ModNameConflictError extends Error {
  readonly modName: string;
  constructor(modName: string) {
    super(`name conflict: mod with name "${modName}" already loaded`);
    this.name = "ModNameConflictError";
    this.modName = modName;
  }
}

export function resolveModOrder(input: ModDirsInput = {}): ResolvedModEntry[] {
  const entries: ResolvedModEntry[] = [];
  const byName = new Set<string>();

  const add = (rawName: string, group: string): void => {
    const name = normalizeModName(rawName);
    if (byName.has(name)) throw new ModNameConflictError(name);
    byName.add(name);
    entries.push({ name, group });
  };

  for (const name of byteSort(input.coreMods ?? ["core"])) {
    add(name, "gem-card");
  }

  for (const name of input.gemMods ?? []) {
    add(name, "gem-defaults");
  }

  for (const dir of input.deckModDirs ?? []) {
    if (dir.modfile !== undefined) {
      for (const name of dir.modfile) add(name, "custom");
    } else {
      for (const name of byteSort(dir.listing ?? [])) add(name, "custom");
    }
  }

  return entries;
}
