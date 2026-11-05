export const KNOWN_DECK_LOCAL_MODS: readonly string[] = [];

export type DeckLocalModName = string;

export const DECK_LOCAL_MODS_ENV_NAMES = {
  enabled: "DECKO_DECK_LOCAL_MODS",
} as const;

export type DeckLocalModsEnv = Partial<
  Record<(typeof DECK_LOCAL_MODS_ENV_NAMES)[keyof typeof DECK_LOCAL_MODS_ENV_NAMES], unknown>
>;

export interface DeckLocalModsConfig {
  readonly enabled: readonly DeckLocalModName[];
}

export const NO_DECK_LOCAL_MODS: DeckLocalModsConfig = { enabled: [] };

function optionalText(raw: unknown, name: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") throw new Error(`${name} must be a string, got ${typeof raw}`);
  const value = raw.trim();
  return value === "" ? undefined : value;
}

function isKnownDeckLocalMod(name: string): name is DeckLocalModName {
  return (KNOWN_DECK_LOCAL_MODS as readonly string[]).includes(name);
}

export function deckLocalModsFromEnv(env: DeckLocalModsEnv | undefined): DeckLocalModsConfig {
  const enabledName = DECK_LOCAL_MODS_ENV_NAMES.enabled;
  const list = optionalText(env?.[enabledName], enabledName);
  const enabled: DeckLocalModName[] = [];
  for (const entry of (list ?? "").split(",")) {
    const name = entry.trim();
    if (name === "") continue;
    if (!isKnownDeckLocalMod(name)) {
      throw new Error(
        `${enabledName} names an unknown deck-local mod ${JSON.stringify(name)}; known: ${KNOWN_DECK_LOCAL_MODS.join(", ")}`,
      );
    }
    if (!enabled.includes(name)) enabled.push(name);
  }
  return { enabled };
}

let configured: DeckLocalModsConfig | undefined;

export function configureDeckLocalMods(config: DeckLocalModsConfig | undefined): void {
  configured = config;
}

function processEnv(): DeckLocalModsEnv | undefined {
  const proc = (globalThis as { process?: { env?: DeckLocalModsEnv } }).process;
  return proc?.env;
}

export function deckLocalMods(): DeckLocalModsConfig {
  return configured ?? deckLocalModsFromEnv(processEnv());
}
