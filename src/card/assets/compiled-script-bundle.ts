import { uglifyHarmonyCompile } from "./uglify-harmony-compile-engine.js";

export interface AssembledScriptLeaf {
  name: string;
  core: string;
}

const LEAF_HEADER = /^\/\/ (.+\.(?:js|coffee))\s*$/gm;

export function splitAssembledScriptLeaves(assembled: string): AssembledScriptLeaf[] {
  const leaves: AssembledScriptLeaf[] = [];
  const headers: { name: string; idx: number }[] = [];
  LEAF_HEADER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LEAF_HEADER.exec(assembled)) !== null) {
    headers.push({ name: match[1] as string, idx: match.index });
  }
  for (let i = 0; i < headers.length; i += 1) {
    const start = headers[i]!.idx;
    const end = i + 1 < headers.length ? headers[i + 1]!.idx : assembled.length;
    const leafText = assembled.slice(start, end);
    const newlineAt = leafText.indexOf("\n");
    if (newlineAt === -1) continue;
    leaves.push({
      name: headers[i]!.name,
      core: leafText.slice(newlineAt + 1),
    });
  }
  return leaves;
}

export function compileScriptBundle(assembled: string): string {
  return splitAssembledScriptLeaves(assembled)
    .map((leaf) => `// ${leaf.name}\n${uglifyHarmonyCompile(leaf.core)}`)
    .join("\n");
}
