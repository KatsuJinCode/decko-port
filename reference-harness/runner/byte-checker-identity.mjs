import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function byteCheckerIdentity() {
  const files = [
    "byte-checker-identity.mjs", "grade-lib.mjs", "grade.mjs",
    "normalize.mjs", "manifest.mjs", "divergences.mjs",
    "adapter-source-identity.mjs", "source-git-environment.mjs",
    "adapter-source-witness.mjs",
    "adapter-source-worker-witness.mjs", "../adapters/ts/adapter.mjs",
    "../../tools/oracle/typescript-source-loader.mjs", "../../tools/oracle/typescript-transform-witness.mjs",
    "adapter-runtime-dependencies.mjs",
    "adapter-generated-source-witness.mjs",
    "adapter-generated-runtime-bindings.mjs",
  ];
  return {
    format: "decko-byte-checker/1",
    node: process.version,
    files: Object.fromEntries(files.map(file => [file,
      createHash("sha256").update(readFileSync(new URL(file, import.meta.url))).digest("hex")])),
  };
}
