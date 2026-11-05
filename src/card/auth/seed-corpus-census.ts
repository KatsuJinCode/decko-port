export interface SeedCorpus {
  readonly gem: string;
  readonly fixtureDir: string;
  readonly tables: Readonly<Record<string, number>>;
}

export interface SeedCorpusIndexEntry {
  readonly index: number;
  readonly mod: string;
  readonly real?: SeedCorpus | null;
  readonly test?: SeedCorpus | null;
}

export interface SeedModsMutation {
  readonly file: string;
  readonly line: number;
  readonly op: string;
  readonly mod: string;
}

export interface SeedModsFirstConsumer {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export const RAILTIE_BASE_SEED_MODS_ORDER: readonly string[] = ["core"];

export const SEED_TYPE: string = "real";

export const SEED_MODS_ORDER: readonly string[] = ["defaults", "core"];

export const SEED_MODS_MUTATIONS: readonly SeedModsMutation[] = [
  { file: "card-mod-defaults-0.20.0/lib/card/mod/defaults.rb", line: 1, op: "unshift", mod: "defaults" },
];

export const DEFAULT_PATH_INDEX = 0;

export const DEFAULT_PATH_SOURCE: string = "defaults";

export const SEED_CORPUS_INDEX: readonly SeedCorpusIndexEntry[] = [
{
  index: 0,
  mod: "defaults",
  real: {
      gem: "card-mod-defaults-0.20.0",
      fixtureDir: "data/fixtures/real",
      tables: {card_actions: 599, card_acts: 1, card_changes: 0, card_references: 519, cards: 604, schema_migrations: 36, transform_migrations: 182},
    },
  test: {
      gem: "card-mod-defaults-0.20.0",
      fixtureDir: "data/fixtures/test",
      tables: {card_actions: 909, card_acts: 172, card_changes: 72, card_references: 753, cards: 904, schema_migrations: 36, transform_migrations: 182},
    },
},
  {
  index: 1,
  mod: "core",
  real: {
      gem: "core",
      fixtureDir: "data/fixtures/real",
      tables: {card_actions: 11, card_acts: 1, card_changes: 0, card_references: 1, cards: 11, schema_migrations: 33, transform_migrations: 173},
    },
  test: null,
},
];

export const SEED_MODS_FIRST_CONSUMERS: readonly SeedModsFirstConsumer[] = [
  { file: "card-mod-script-0.20.0/set/type_plus_right/set/script.rb", line: 8, text: "super(Cardio.config.seed_mods.first)" },
    { file: "card-mod-style-0.20.0/set/type_plus_right/set/style.rb", line: 14, text: "super(Cardio.config.seed_mods.first)" },
];
