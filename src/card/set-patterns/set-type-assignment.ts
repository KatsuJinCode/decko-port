import { DeckoName, type Nameish } from "../name.js";
import type { FetchEngine } from "../fetch.js";
import { patternsForCard, typeAssigningModuleKeys } from "./card-patterns.js";
import { moduleKeyFromAnchorCodenames } from "./instance.js";
import type { PatternCardInput } from "./types.js";

export interface SetTypeAssignment {
  readonly moduleKey: string;
  readonly typeName: Nameish;
}

const ASSIGNMENTS = new Map<string, Nameish>();

export function resetSetTypeAssignments(): void {
  ASSIGNMENTS.clear();
}

export function registerSetTypeAssignment(
  moduleKey: string,
  typeName: Nameish,
): void {
  ASSIGNMENTS.set(moduleKey, typeName);
}

export const GEM_TYPE_ASSIGNMENTS: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  core: [["Right::Autoname", "phrase"]],
  account: [
    ["Right::Email", "phrase"],
    ["Right::Password", "phrase"],
    ["Right::Roles", "search_type"],
    ["Right::Salt", "phrase"],
    ["Right::Status", "phrase"],
    ["TypePlusRight::Role::Members", "list"],
  ],
  date: [
    ["Right::WhenCreated", "phrase"],
    ["Right::WhenLastEdited", "phrase"],
  ],
  edit: [
    ["Right::InputType", "pointer"],
    ["Right::Thanks", "phrase"],
  ],
  email: [
    ["Right::Bcc", "list"],
    ["Right::Cc", "list"],
    ["Right::From", "list"],
    ["Right::Subject", "phrase"],
    ["Right::TextMessage", "plain_text"],
    ["Right::To", "list"],
  ],
  follow: [
    ["Right::ContextualClass", "list"],
    ["Right::Disappear", "toggle"],
    ["Right::Follow", "list"],
    ["Right::Following", "list"],
    ["Right::FollowFields", "list"],
    ["Right::Message", "phrase"],
  ],
  format: [["Right::Head", "html"]],
  integrate: [
    ["Right::OnCreate", "list"],
    ["Right::OnDelete", "list"],
    ["Right::OnUpdate", "list"],
  ],
  layout: [
    ["Right::EnabledRoles", "session"],
    ["Right::Layout", "pointer"],
  ],
  list: [
    ["Right::ContentOptions", "list"],
    ["Right::ContentOptionView", "phrase"],
  ],
  permissions: [
    ["Right::Create", "list"],
    ["Right::Delete", "list"],
    ["Right::Read", "list"],
    ["Right::Update", "list"],
  ],
  recaptcha: [["Right::Captcha", "toggle"]],
  rules: [
    ["Right::Right", "set"],
    ["Right::Self", "set"],
    ["Right::Type", "set"],
    ["Right::TypePlusRight", "set"],
    ["TypePlusRight::Set::Setting", "list"],
  ],
  script: [["Right::Script", "list"]],
  search: [["Right::Count", "search_type"]],
  style: [["TypePlusRight::Set::Style", "pointer"]],
  bootstrap: [
    ["TypePlusRight::BootswatchSkin::Stylesheets", "skin"],
  ],
};

export function registerGemTypeAssignments(modName: string): void {
  for (const [moduleKey, typeName] of GEM_TYPE_ASSIGNMENTS[modName] ?? []) {
    if (!ASSIGNMENTS.has(moduleKey)) ASSIGNMENTS.set(moduleKey, typeName);
  }
}

export function registerAllGemTypeAssignments(): void {
  for (const modName of Object.keys(GEM_TYPE_ASSIGNMENTS)) registerGemTypeAssignments(modName);
}

export function snapshotSetTypeAssignments(): ReadonlyMap<string, Nameish> {
  return new Map(ASSIGNMENTS);
}

export function restoreSetTypeAssignments(snapshot: ReadonlyMap<string, Nameish>): void {
  ASSIGNMENTS.clear();
  for (const [key, type] of snapshot) ASSIGNMENTS.set(key, type);
}

export function getSetTypeAssignment(moduleKey: string): Nameish | undefined {
  return ASSIGNMENTS.get(moduleKey);
}

export interface AssignedTypeCardInput {
  readonly name: Nameish;
  readonly isNew?: boolean;
  readonly typeId?: number | null;
  readonly typeName?: Nameish | null;
  readonly leftTypeName?: Nameish | null;
  readonly isRule?: boolean;
}

export type AssignedTypeName = string | undefined;

export function findAssignedTypeName(
  card: AssignedTypeCardInput,
): AssignedTypeName {
  const parsed = DeckoName.parse(card.name);
  if (!parsed.isCompound) return undefined;
  for (const moduleKey of typeAssigningModuleKeys(patternInputFor(card))) {
    const typeName = ASSIGNMENTS.get(moduleKey);
    if (typeName !== undefined) {
      return DeckoName.parse(typeName).s;
    }
  }
  return undefined;
}

function patternInputFor(card: AssignedTypeCardInput): PatternCardInput {
  return {
    name: card.name,
    isNew: card.isNew,
    typeId: card.typeId ?? null,
    typeName: card.typeName ?? null,
    leftTypeName: card.leftTypeName ?? null,
    isRule: card.isRule ?? false,
  };
}

async function anchorCodenameDriverBacked(
  fetcher: FetchEngine,
  part: DeckoName,
): Promise<string | undefined> {
  const id = await fetcher.lexicon.id(part.key);
  if (id === undefined) return undefined;
  return fetcher.codenames.nameForId(id);
}

async function findAssignedTypeNameDriverBacked(
  fetcher: FetchEngine,
  card: AssignedTypeCardInput,
): Promise<AssignedTypeName> {
  const parsed = DeckoName.parse(card.name);
  if (!parsed.isCompound) return undefined;
  for (const pattern of patternsForCard(patternInputFor(card))) {
    if (!pattern.assignsType) continue;
    const codes: string[] = [];
    let broke = false;
    for (const part of pattern.anchorParts) {
      const code = await anchorCodenameDriverBacked(fetcher, part);
      if (code === undefined) {
        broke = true;
        break;
      }
      codes.push(code);
    }
    if (broke) continue;
    const moduleKey = moduleKeyFromAnchorCodenames(pattern.spec, codes);
    const typeName = ASSIGNMENTS.get(moduleKey);
    if (typeName !== undefined) return DeckoName.parse(typeName).s;
  }
  return undefined;
}

export async function resolveAssignedTypeId(
  fetcher: FetchEngine,
  typeName: Nameish,
): Promise<number | undefined> {
  const parsed = DeckoName.parse(typeName);
  const code = parsed.s;
  const byCode = await fetcher.codenames.id(code);
  if (byCode !== undefined) return byCode;
  const byName = await fetcher.lexicon.id(parsed);
  return byName;
}

export async function resolveAssignedTypeIdForCard(
  fetcher: FetchEngine,
  card: AssignedTypeCardInput,
): Promise<number | undefined> {
  const typeName = await findAssignedTypeNameDriverBacked(fetcher, card);
  if (typeName === undefined) return undefined;
  return resolveAssignedTypeId(fetcher, typeName);
}

export function listAssignedTypeNamesForCard(
  card: AssignedTypeCardInput,
): readonly string[] {
  const parsed = DeckoName.parse(card.name);
  if (!parsed.isCompound) return [];
  const out: string[] = [];
  for (const moduleKey of typeAssigningModuleKeys(patternInputFor(card))) {
    const typeName = ASSIGNMENTS.get(moduleKey);
    if (typeName !== undefined) out.push(DeckoName.parse(typeName).s);
  }
  return out;
}
