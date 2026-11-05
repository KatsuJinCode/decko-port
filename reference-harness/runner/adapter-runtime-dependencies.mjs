import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function runtimePackageIdentity(url) {
  const target = realpathSync(fileURLToPath(url));
  if (!target.split(path.sep).includes("node_modules")) return null;
  let directory = path.dirname(target);
  while (directory !== path.dirname(directory)) {
    const file = path.join(directory, "package.json");
    try {
      const bytes = readFileSync(file), metadata = JSON.parse(bytes.toString("utf8"));
      if (typeof metadata.name === "string" && typeof metadata.version === "string") return {
        root: directory, file, name: metadata.name, version: metadata.version,
        manifest_base64: bytes.toString("base64"),
      };
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    directory = path.dirname(directory);
  }
  throw Error(`Loaded runtime package has no owned manifest: ${target}`);
}
