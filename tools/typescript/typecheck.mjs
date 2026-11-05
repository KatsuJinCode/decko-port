#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { spawnNativeTypeScript } from "../platform/native-typescript-compiler.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const result = spawnNativeTypeScript(root, process.argv.slice(2), { cwd: root, stdio: "inherit" });
if (result.error) console.error(result.error);
process.exitCode = result.error || result.signal ? 1 : result.status ?? 1;
