import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const RELATIVE_SPECIFIER = /\b(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

export function staticImportClosure(repoRoot, entries) {
  const seen = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const relative = pending.pop();
    if (seen.has(relative)) continue;
    const absolute = path.join(repoRoot, relative);
    if (!existsSync(absolute)) throw new Error(`fixture source is missing from the repository: ${relative}`);
    seen.add(relative);
    const source = readFileSync(absolute, "utf8");
    for (const match of source.matchAll(RELATIVE_SPECIFIER)) {
      pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])));
    }
  }
  return [...seen].sort();
}

export function copyStaticImportClosure(repoRoot, entries, destinationRoot) {
  const files = staticImportClosure(repoRoot, entries);
  for (const file of files) {
    const destination = path.join(destinationRoot, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(repoRoot, file), destination);
  }
  return files;
}
