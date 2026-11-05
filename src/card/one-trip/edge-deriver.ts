import { DeckoName } from "../name.js";
import { stripTags, scanNests } from "../render/nest-syntax.js";

const LINK_FULL_REGEXP = /\[\[([^\[\]]*)\]\]/g;

export interface DerivedReference {
  key: string;
  view?: string;
}

function absolutizeKey(raw: string, contextName: string): string | undefined {
  const stripped = stripTags(raw).trim();
  if (stripped === "") return undefined;
  try {
    const parsed = DeckoName.parse(stripped);
    if (parsed.s === "") return undefined;
    const absolute = parsed.isAbsolute
      ? parsed
      : parsed.absoluteName(DeckoName.parse(contextName));
    const key = absolute.key;
    return key === "" ? undefined : key;
  } catch {
    return undefined;
  }
}

export function deriveReferenceEdges(
  content: string,
  referencingCardName: string,
): DerivedReference[] {
  const out: DerivedReference[] = [];
  for (const piece of scanNests(content)) {
    const nest = piece.nest;
    if (nest === undefined || nest.comment !== undefined) continue;
    if (nest.name.startsWith("_")) continue;
    const key = absolutizeKey(nest.name, referencingCardName);
    if (key === undefined) continue;
    out.push({ key, view: nest.options.view });
  }
  return out;
}

export function deriveLinkEdges(
  content: string,
  referencingCardName: string,
): DerivedReference[] {
  const out: DerivedReference[] = [];
  for (const match of content.matchAll(LINK_FULL_REGEXP)) {
    const inner = match[1] ?? "";
    const target = inner.split("|")[0] ?? "";
    if (target.trim().startsWith("_")) continue;
    const key = absolutizeKey(target, referencingCardName);
    if (key === undefined) continue;
    out.push({ key });
  }
  return out;
}
