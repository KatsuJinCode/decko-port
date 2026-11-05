import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(here, "../../../tools/oracle/typescript-source-loader.mjs")).href, import.meta.url);
await import(pathToFileURL(path.join(here, "adapter.ts")).href);
