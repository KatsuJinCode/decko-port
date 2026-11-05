#!/usr/bin/env node
import { spawnNativeTypeScript } from "../platform/native-typescript-compiler.mjs";
import { assertStaticUglifierCurrent } from "../vendor/build-uglify-harmony-static.mjs";
assertStaticUglifierCurrent();
import { mkdirSync, writeFileSync, existsSync, realpathSync, rmSync } from "node:fs";
import { copyRuntimeAssets } from "./runtime-assets.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { treeDigest } from "../../reference-harness/browser/lib/journey-provenance.mjs";
import { sourceProvenance } from "./source-provenance.mjs";
const repo = fileURLToPath(new URL("../..", import.meta.url));
const config = process.argv.includes("--browser-hosts") ? "tsconfig.browser-hosts.json" : "tsconfig.dist.json";
const output = path.resolve(repo, "dist");
if (path.dirname(output) !== path.resolve(repo)) throw new Error("build output escapes checkout");
if (existsSync(output)) {
  if (path.resolve(realpathSync(output)) !== output) throw new Error("refusing redirected dist directory");
  rmSync(output, { recursive: true, force: true });
}
const result = spawnNativeTypeScript(repo, ["-p", path.join(repo,config)], { cwd: repo, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
const runtimeAssets = copyRuntimeAssets(repo);
await import(new URL("../../dist/src/card/render/bootstrap-code-files.js", import.meta.url));
await import(new URL("../../dist/src/server/libsass-wasm.js", import.meta.url));
await import(new URL("../../dist/src/card/render.js", import.meta.url));
mkdirSync(path.join(repo,".runtime"), { recursive:true });
writeFileSync(path.join(repo,".runtime/browser-build.json"), JSON.stringify({ config, runtimeAssets, ...sourceProvenance(repo), distSha256:treeDigest(path.join(repo,"dist")), builtAt:new Date().toISOString() },null,2)+"\n");
console.log("Engine distribution built; static snapshot and compiler imports verified.");
