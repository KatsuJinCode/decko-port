import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const FIXTURE_CORPUS_DIR = path.join(REPO_ROOT, "fixtures", "test-corpus");
const PRIVATE_SHARD_DIR = path.join(REPO_ROOT, "fixtures", "corpus");

const RAW_CORPUS_DIR = path.join(REPO_ROOT, "tmp", "raw-ground-truth");
export { RAW_CORPUS_DIR };

export const RAW_CORPUS_DB_PATH = path.join(RAW_CORPUS_DIR, "bench-corpus-raw.sqlite3");

export const RAW_CORPUS_VIEW_LANE_DIR = path.join(
  RAW_CORPUS_DIR,
  "expected-v2",
  "view-lane",
);

export const PRIVATE_SHARD_DIR_PATH = PRIVATE_SHARD_DIR;

const richCorpus = process.env.DECKO_TS_CORPUS_V2;

if (richCorpus !== undefined) {
  const richShard000000 = path.join(PRIVATE_SHARD_DIR, "shard-000000.jsonl");
  const richShard000014 = path.join(PRIVATE_SHARD_DIR, "shard-000014.jsonl");
  const missing = [richCorpus, richShard000000, richShard000014].filter((p) => !existsSync(p));
  if (missing.length > 0) {
    throw new Error(
      "DECKO_TS_CORPUS_V2 rich-corpus leg requested but these machine-local corpus files are missing:\n" +
        missing.map((p) => `  ${p}`).join("\n") +
        "\nThe rich leg is opt-in and never assumed; unset DECKO_TS_CORPUS_V2 to run the " +
        "committed miniature corpus (fixtures/test-corpus/), or restore the machine-local " +
        "corpus files (bench-corpus-v2.sqlite3 + fixtures/corpus/shard-000000.jsonl + shard-000014.jsonl) " +
        "to run the rich leg.",
    );
  }
}

export const CORPUS_DB_PATH = richCorpus ?? path.join(FIXTURE_CORPUS_DIR, "test-corpus.sqlite3");

export const SHARD_000000_PATH = richCorpus
  ? path.join(PRIVATE_SHARD_DIR, "shard-000000.jsonl")
  : path.join(FIXTURE_CORPUS_DIR, "test-corpus-shard-000000.jsonl");

export const SHARD_000014_PATH = richCorpus
  ? path.join(PRIVATE_SHARD_DIR, "shard-000014.jsonl")
  : path.join(FIXTURE_CORPUS_DIR, "test-corpus-shard-000014.jsonl");

export const RICH_CORPUS_REQUESTED = richCorpus !== undefined;
