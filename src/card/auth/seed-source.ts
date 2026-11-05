import {
  DEFAULT_PATH_INDEX,
  DEFAULT_PATH_SOURCE,
  SEED_CORPUS_INDEX,
  SEED_MODS_FIRST_CONSUMERS,
  SEED_MODS_ORDER,
  SEED_TYPE,
  type SeedCorpus,
  type SeedCorpusIndexEntry,
} from "./seed-corpus-census.js";

export {
  DEFAULT_PATH_INDEX,
  DEFAULT_PATH_SOURCE,
  SEED_CORPUS_INDEX,
  SEED_MODS_FIRST_CONSUMERS,
  SEED_MODS_ORDER,
  SEED_TYPE,
};
export type { SeedCorpus, SeedCorpusIndexEntry };

export type SeedEnv = "real" | "test";

export function rubySeedSource(env: SeedEnv, index: number): SeedCorpus | null {
  const entry = SEED_CORPUS_INDEX.find((e) => e.index === index);
  if (!entry) return null;
  return entry[env] ?? null;
}

export function rubyDefaultSeedSource(env: SeedEnv = "real"): SeedCorpus | null {
  return rubySeedSource(env, DEFAULT_PATH_INDEX);
}

export const PORT_SEED_SOURCE: { readonly env: SeedEnv; readonly index: number } = {
  env: "real",
  index: 0,
};

export const RUBY_SEED_MODS_FIRST: string = SEED_MODS_ORDER[0] ?? "";

export const SEED_TABLES: readonly string[] = [
  "cards", "card_actions", "card_acts", "card_changes", "card_references",
];

export const LANDED_DEFAULTS_CORPUS: {
  readonly mod: string;
  readonly index: number;
  readonly cards: number;
  readonly how: string;
} = (() => {
  const corpus = rubySeedSource("real", DEFAULT_PATH_INDEX);
  return {
    mod: DEFAULT_PATH_SOURCE,
    index: DEFAULT_PATH_INDEX,
    cards: corpus?.tables.cards ?? 0,
    how:
      "Generated from the pinned gem by tools/oracle/defaults-seed-corpus.rb " +
      "into the deploy seed asset deploy/seed/defaults-seed-corpus.json; " +
      "the boot loads it at seed time (defaults-seed-corpus-asset.ts) and " +
      "boot-seed.ts's layer A inserts it directly (seed.rb:20-22 " +
      "FixtureSet.create_fixtures - direct rows, no acts), Ruby's own seed " +
      "source. The corpus is boot-time data, not engine code: compiled in, " +
      "it crossed the engine bundle's boot-safe budget.",
  };
})();

export function seedSourceComparison(): {
  readonly port: { readonly mod: string; readonly cards: number } | null;
  readonly ruby: { readonly mod: string; readonly cards: number } | null;
  readonly sameCorpus: boolean;
} {
  const portEntry = SEED_CORPUS_INDEX.find((e) => e.index === PORT_SEED_SOURCE.index);
  const rubyCorpus = rubyDefaultSeedSource();
  const portCorpus = portEntry?.[PORT_SEED_SOURCE.env];
  return {
    port: portCorpus
      ? { mod: portEntry!.mod, cards: portCorpus.tables.cards ?? 0 }
      : null,
    ruby: rubyCorpus ? { mod: DEFAULT_PATH_SOURCE, cards: rubyCorpus.tables.cards ?? 0 } : null,
    sameCorpus: portEntry?.mod === DEFAULT_PATH_SOURCE,
  };
}