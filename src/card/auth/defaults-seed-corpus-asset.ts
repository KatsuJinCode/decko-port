import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DefaultsFixtureActionRow,
  DefaultsFixtureActRow,
  DefaultsFixtureCardRow,
  DefaultsFixtureChangeRow,
  DefaultsFixtureReferenceRow,
  DefaultsSeedCorpusTables,
} from "./boot-seed.js";

interface DefaultsSeedCorpusAssetFile {
  readonly source: string;
  readonly generator: string;
  readonly seedModsIndex: number;
  readonly env: string;
  readonly rowNote: string;
  readonly tables: {
    readonly cards: readonly DefaultsFixtureCardRow[];
    readonly card_actions: readonly DefaultsFixtureActionRow[];
    readonly card_acts: readonly DefaultsFixtureActRow[];
    readonly card_changes: readonly DefaultsFixtureChangeRow[];
    readonly card_references: readonly DefaultsFixtureReferenceRow[];
  };
}

const ASSET_RELPATH = join("deploy", "seed", "defaults-seed-corpus.json");

function readAssetRaw(): string {
  const start = dirname(fileURLToPath(import.meta.url));
  let dir = start;
  let lastTried = "";
  for (let up = 0; up < 8; up++, dir = dirname(dir)) {
    lastTried = join(dir, ASSET_RELPATH);
    try {
      return readFileSync(lastTried, "utf8");
    } catch {
    }
  }
  throw new Error(
    `the defaults seed corpus asset was not found climbing up from ` +
      `${start} (last tried ${lastTried})`,
  );
}

export function loadDefaultsSeedCorpusAsset(): DefaultsSeedCorpusTables {
  const raw = readAssetRaw();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      "the defaults seed corpus asset is unreadable JSON: " +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const file = parsed as DefaultsSeedCorpusAssetFile;
  if (
    !file ||
    typeof file !== "object" ||
    file.env !== "real" ||
    file.seedModsIndex !== 0 ||
    !file.tables ||
    typeof file.tables !== "object"
  ) {
    throw new Error(
      "the defaults seed corpus asset is not the file " +
        "tools/oracle/defaults-seed-corpus.rb emits; regenerate it from the " +
        "pinned gem tree",
    );
  }
  const tables = file.tables;
  for (const rubyName of [
    "cards",
    "card_actions",
    "card_acts",
    "card_changes",
    "card_references",
  ] as const) {
    if (!Array.isArray(tables[rubyName])) {
      throw new Error(
        `the defaults seed corpus asset carries no ${rubyName} table array`,
      );
    }
  }
  return {
    cards: tables.cards,
    actions: tables.card_actions,
    acts: tables.card_acts,
    changes: tables.card_changes,
    references: tables.card_references,
  };
}
