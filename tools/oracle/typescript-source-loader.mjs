import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformWithOxc } from "vite";
import { transformWitnessEnabled, witnessTransform } from "./typescript-transform-witness.mjs";

function typescriptSibling(specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  if (!specifier.endsWith(".js")) return null;
  if (specifier.startsWith("./node_modules/")) return null;
  return `${specifier.slice(0, -".js".length)}.ts`;
}

function typescriptSiblingForFileUrl(specifier) {
  if (!specifier.startsWith("file:") || !specifier.endsWith(".js")) return null;
  const asPath = fileURLToPath(specifier);
  const candidate = `${asPath.slice(0, -".js".length)}.ts`;
  return existsSync(candidate) ? pathToFileURL(candidate).href : null;
}

export async function resolve(specifier, context, nextResolve) {
  const absolute = typescriptSiblingForFileUrl(specifier);
  if (absolute !== null) return await nextResolve(absolute, context);

  const sibling = typescriptSibling(specifier);
  if (sibling !== null && context.parentURL !== undefined) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      const parentPath = fileURLToPath(context.parentURL);
      const candidate = pathToFileURL(path.resolve(path.dirname(parentPath), sibling));
      if (existsSync(fileURLToPath(candidate))) {
        return await nextResolve(sibling, context);
      }
      throw err;
    }
  }
  return await nextResolve(specifier, context);
}

const CACHE_DIR = process.env.DUAL_LANE_TSC_CACHE_DIR;

function cachePathFor(source) {
  const hash = createHash("sha256").update(source).digest("hex");
  return path.join(CACHE_DIR, `${hash.slice(0, 32)}.mjs`);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:") || !url.endsWith(".ts")) {
    return await nextLoad(url, context);
  }
  const filePath = fileURLToPath(url);
  const source = readFileSync(filePath, "utf8");

  if (CACHE_DIR !== undefined) {
    try {
      const cached = cachePathFor(source);
      if (existsSync(cached)) {
        const code = readFileSync(cached, "utf8");
        if (transformWitnessEnabled()) {
          let transformed, verificationError;
          try { transformed = (await transformWithOxc(source, filePath, { lang: "ts" })).code; }
          catch (error) { verificationError = error; }
          witnessTransform({ url, source, returned: code, transformed, error: verificationError, cache: "hit; fresh transform verified separately", transformer: transformWithOxc });
        }
        return { format: "module", source: code, shortCircuit: true };
      }
      const { code } = await transformWithOxc(source, filePath, { lang: "ts" });
      witnessTransform({ url, source, returned: code, transformed: code, cache: "miss", transformer: transformWithOxc });
      try {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(cached, code);
      } catch {
      }
      return { format: "module", source: code, shortCircuit: true };
    } catch {
    }
  }

  const { code } = await transformWithOxc(source, filePath, { lang: "ts" });
  witnessTransform({ url, source, returned: code, transformed: code, cache: "disabled", transformer: transformWithOxc });
  return { format: "module", source: code, shortCircuit: true };
}
