import { getNameEnvironment } from "../name/environment.js";

function camelizeCode(code: string): string {
  return code
    .split("_")
    .map((word) => (word === "" ? "" : word[0]!.toUpperCase() + word.slice(1)))
    .join("");
}

function camelizeAnchor(anchor: string): string {
  if (anchor === "") return "";
  return anchor
    .split("-")
    .map((frag) => (frag === "" ? "" : camelizeCode(frag)))
    .join("+");
}

export function safeKeyToModuleShortnameCandidates(safeKey: string): string[] {
  const first = safeKeyToModuleShortname(safeKey);
  const dashIdx = safeKey.indexOf("-");
  if (dashIdx === -1) return [first];
  const code = safeKey.slice(0, dashIdx).toLowerCase();
  const anchor = safeKey.slice(dashIdx + 1);
  const frags = anchor.split("-");
  const optionsPerFrag = frags.map((f) =>
    f.startsWith("X") && f.length > 1 ? [f, f.slice(1)] : [f],
  );
  const out = new Set<string>([first]);
  if (frags.length > 1) {
    out.add(`${camelizeCode(code)}::${frags.map(camelizeCode).join("::")}`);
  }
  const total = optionsPerFrag.reduce((a, o) => a * o.length, 1);
  for (let mask = 1; mask < total; mask++) {
    let m = mask;
    const chosen: string[] = [];
    for (const opts of optionsPerFrag) {
      const idx = m % opts.length;
      m = Math.floor(m / opts.length);
      chosen.push(opts[idx]);
    }
    const camelFragments = chosen.map((frag) => camelizeCode(frag));
    out.add(`${camelizeCode(code)}::${camelFragments.join("+")}`);
    if (camelFragments.length > 1) {
      out.add(`${camelizeCode(code)}::${camelFragments.join("::")}`);
    }
  }
  return [...out];
}

export function rubySelfToken(token: string): string | null {
  if (!token.startsWith("SELF-")) return token;
  const anchor = token.slice("SELF-".length);
  if (anchor === "" || anchor.includes("-")) return token;
  const env = getNameEnvironment();
  if (env?.lexicon === undefined || env.codename === undefined) return token;
  const key = anchor.startsWith("X") && anchor.length > 1 ? `*${anchor.slice(1)}` : anchor;
  const id = env.lexicon.id(key);
  if (id === undefined) return token;
  const codename = env.codename.nameForId(id);
  if (codename === undefined || codename === "") return null;
  return `SELF-${codename}`;
}

export function anchorCodenames(token: string): { codenames: string[] } | null | undefined {
  const dashIdx = token.indexOf("-");
  if (dashIdx === -1 || token.startsWith("SELF-")) return undefined;
  const env = getNameEnvironment();
  if (env?.lexicon === undefined || env.codename === undefined) return undefined;
  const codenames: string[] = [];
  let missing = false;
  for (const frag of token.slice(dashIdx + 1).split("-")) {
    if (frag === "") return undefined;
    const key = frag.startsWith("X") && frag.length > 1 ? `*${frag.slice(1)}` : frag;
    const id = env.lexicon.id(key);
    if (id === undefined) return undefined;
    const codename = env.codename.nameForId(id);
    if (codename === undefined || codename === "") missing = true;
    else codenames.push(codename);
  }
  return missing ? null : { codenames };
}

export function moduleShortnameForCodenames(code: string, codenames: readonly string[]): string {
  return `${camelizeCode(code.toLowerCase())}::${codenames.map(camelizeCode).join("::")}`;
}

export function anchoredModuleCandidates(token: string): {
  candidates: string[];
  paths: string[] | undefined;
  definitive: boolean;
} {
  const named = safeKeyToModuleShortnameCandidates(token);
  if (token.startsWith("SELF-") || !token.includes("-")) {
    return { candidates: named, paths: undefined, definitive: true };
  }
  const resolved = anchorCodenames(token);
  if (resolved === null) return { candidates: [], paths: [], definitive: true };
  if (resolved !== undefined) {
    const code = token.slice(0, token.indexOf("-")).toLowerCase();
    return {
      candidates: [moduleShortnameForCodenames(code, resolved.codenames)],
      paths: [`${code}/${resolved.codenames.join("/")}`],
      definitive: true,
    };
  }
  const out = [...named];
  for (const c of codenameModuleShortnames(token)) if (!out.includes(c)) out.push(c);
  return { candidates: out, paths: undefined, definitive: false };
}

export function codenameModuleShortnames(safeKey: string): string[] {
  const dashIdx = safeKey.indexOf("-");
  if (dashIdx === -1) return [];
  const env = getNameEnvironment();
  if (env?.lexicon === undefined || env.codename === undefined) return [];
  const code = safeKey.slice(0, dashIdx).toLowerCase();
  let changed = false;
  const parts = safeKey
    .slice(dashIdx + 1)
    .split("-")
    .map((frag) => {
      const key = frag.startsWith("X") && frag.length > 1 ? `*${frag.slice(1)}` : frag;
      const id = env.lexicon!.id(key);
      const codename = id === undefined ? undefined : env.codename!.nameForId(id);
      if (codename === undefined || codename === "") return frag.replace(/^X/, "");
      if (codename !== frag) changed = true;
      return codename;
    });
  if (!changed) return [];
  return [`${camelizeCode(code)}::${parts.map(camelizeCode).join("::")}`];
}

export function safeKeyToModuleShortname(safeKey: string): string {
  const dashIdx = safeKey.indexOf("-");
  if (dashIdx === -1) return camelizeCode(safeKey.toLowerCase());
  const code = safeKey.slice(0, dashIdx).toLowerCase();
  const anchor = safeKey.slice(dashIdx + 1);
  return `${camelizeCode(code)}::${camelizeAnchor(anchor)}`;
}

export function setKeysToModuleChain(setKeys: string): string[] {
  if (setKeys.trim() === "") return [];
  const generalFirst = setKeys.split(/\s+/).filter((s) => s !== "");
  return generalFirst.slice().reverse().map(safeKeyToModuleShortname);
}
