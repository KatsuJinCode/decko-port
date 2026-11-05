import { currentRequestContext } from "../request-context.js";

export interface NameLexicon {
  name(id: number): string | undefined;
  id(key: string): number | undefined;
}

export interface NameCodenameRegistry {
  id(codename: string): number | undefined;
  name(codename: string): string | undefined;
  nameForId(id: number): string | undefined;
}

export interface NameEnvironment {
  readonly session?: string;
  readonly mainName?: string;
  readonly lexicon?: NameLexicon;
  readonly codename?: NameCodenameRegistry;
}

let currentEnvironment: NameEnvironment | undefined;

export function setNameEnvironment(environment: NameEnvironment | undefined): void {
  const ctx = currentRequestContext();
  if (ctx !== undefined) ctx.environment = environment;
  else currentEnvironment = environment;
}

export function getNameEnvironment(): NameEnvironment | undefined {
  const ctx = currentRequestContext();
  return ctx !== undefined ? ctx.environment : currentEnvironment;
}

export function recordAsMain(
  paramMain: string | undefined,
  cardName: string | undefined,
): string {
  const mainName = paramMain ?? cardName ?? "";
  setNameEnvironment({ ...getNameEnvironment(), mainName });
  return mainName;
}
