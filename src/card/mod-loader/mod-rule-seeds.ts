import { DeckoName } from "../name.js";
import { getNameEnvironment } from "../name/environment.js";

const seeds = new Map<string, string>();

export function registerModRuleSeed(modName: string, name: string, content: string): void {
  const key = DeckoName.parse(name).key;
  if (!seeds.has(key)) seeds.set(key, content);
  void modName;
}

export function modRuleSeedContentForCandidate(candidate: string): string | undefined {
  const direct = seeds.get(DeckoName.parse(candidate).key);
  if (direct !== undefined) return direct;
  const env = getNameEnvironment();
  if (env?.lexicon === undefined || env?.codename === undefined) return undefined;
  const codenameSegments: string[] = [];
  for (const segment of candidate.split("+")) {
    if (segment.startsWith("*")) {
      codenameSegments.push(DeckoName.parse(segment).key);
      continue;
    }
    const parsed = DeckoName.parse(segment);
    const id = env.lexicon.id(parsed.key);
    const codename = id !== undefined ? env.codename.nameForId(id) : undefined;
    if (codename === undefined) return undefined;
    codenameSegments.push(DeckoName.parse(codename).key);
  }
  return seeds.get(codenameSegments.join("+"));
}
