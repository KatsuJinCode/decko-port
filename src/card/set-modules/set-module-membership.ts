import { setModuleShortname } from "../mod-loader/mod-registrar.js";
import {
  anchorCodenames,
  moduleShortnameForCodenames,
  rubySelfToken,
  safeKeyToModuleShortname,
} from "../render/set-keys-to-modules.js";

export function setModuleShortnameForToken(token: string): string | null {
  const selfToken = rubySelfToken(token);
  if (selfToken === null) return null;
  if (selfToken !== token && selfToken.startsWith("SELF-")) {
    return safeKeyToModuleShortname(selfToken);
  }
  const resolved = anchorCodenames(selfToken ?? token);
  if (resolved === undefined || resolved === null) return null;
  const anchored = selfToken ?? token;
  const code = anchored.slice(0, anchored.indexOf("-")).toLowerCase();
  return moduleShortnameForCodenames(code, resolved.codenames);
}

export function setModuleShortnamesForSetKeys(setKeys: string): string[] {
  const out: string[] = [];
  for (const token of setKeys.split(/\s+/)) {
    if (token === "") continue;
    const shortname = setModuleShortnameForToken(token);
    if (shortname !== null) out.push(shortname);
  }
  return out;
}

export function cardInSetModule(setPath: string, setKeys: string): boolean {
  if (setKeys.trim() === "") return false;
  const wanted = setModuleShortname(setPath);
  for (const shortname of setModuleShortnamesForSetKeys(setKeys)) {
    if (shortname === wanted) return true;
  }
  return false;
}