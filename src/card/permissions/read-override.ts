import { DeckoName } from "../name.js";
import { onDeckInflectionsChanged } from "../name/inflect.js";
import type { CardRecord } from "../fetch/card-record.js";

export interface ReadOverrideDeps {
  readonly viewerKey: string | undefined;
  fetchByKey(key: string): Promise<CardRecord | undefined>;
  fetchById(id: number): Promise<CardRecord | undefined>;
  leftReadVerdict(leftName: DeckoName, depth: number): Promise<boolean | undefined>;
}

export type IdentityOverrideDeps = Pick<
  ReadOverrideDeps,
  "viewerKey" | "fetchByKey" | "fetchById"
>;

const OVERRIDE_MAX_DEPTH = 16;

interface OverrideKeys {
  version: string;
  signin: string;
  accountLinks: string;
  head: string;
  script: string;
  enabledRoles: string;
  email: string;
  account: string;
  password: string;
  apiKey: string;
  assetOutput: string;
  style: string;
  salt: string;
  status: string;
}
let keysCache: OverrideKeys | undefined;
function overrideKeys(): OverrideKeys {
  if (keysCache === undefined) {
    keysCache = {
      version: DeckoName.parse("*version").key,
      signin: DeckoName.parse("*signin").key,
      accountLinks: DeckoName.parse("*account links").key,
      head: DeckoName.parse("*head").key,
      script: DeckoName.parse("*script").key,
      enabledRoles: DeckoName.parse("*enabled roles").key,
      email: DeckoName.parse("*email").key,
      account: DeckoName.parse("*account").key,
      password: DeckoName.parse("*password").key,
      apiKey: DeckoName.parse("*api key").key,
      assetOutput: DeckoName.parse("*asset output").key,
      style: DeckoName.parse("*style").key,
      salt: DeckoName.parse("*salt").key,
      status: DeckoName.parse("*status").key,
    };
  }
  return keysCache;
}
export function nameHasReadOverride(name: DeckoName): boolean {
  const K = overrideKeys();
  if (!name.isCompound) {
    return name.key === K.version || name.key === K.signin || name.key === K.accountLinks;
  }
  const tag = name.tagKey;
  return (
    tag === K.head ||
    tag === K.script ||
    tag === K.enabledRoles ||
    tag === K.email ||
    tag === K.account ||
    tag === K.password ||
    tag === K.apiKey ||
    tag === K.assetOutput ||
    tag === K.style
  );
}

onDeckInflectionsChanged(() => {
  keysCache = undefined;
});

const ACCOUNT_HOLDER_CODENAMES = new Set(["anonymous", "decko_bot"]);
const ACCOUNT_HOLDER_TYPE_CODENAMES = new Set(["user", "signup"]);

export async function readPermissionOverride(
  name: DeckoName,
  deps: ReadOverrideDeps,
  depth = 0,
): Promise<boolean | undefined> {
  const K = overrideKeys();
  if (!name.isCompound) {
    if (name.key === K.version || name.key === K.signin || name.key === K.accountLinks) {
      return true;
    }
    return undefined;
  }
  if (depth >= OVERRIDE_MAX_DEPTH) return undefined;
  switch (name.tagKey) {
    case K.head:
    case K.script:
    case K.enabledRoles:
      return true;
    case K.email: {
      if (deps.viewerKey === undefined) return undefined;
      return name.partKeys[0] === deps.viewerKey;
    }
    case K.account:
    case K.password:
    case K.apiKey:
      return ownAccountVerdict(name, deps, depth);
    case K.assetOutput: {
      const left = name.leftName;
      if (left === undefined) return undefined;
      return deps.leftReadVerdict(left, depth + 1);
    }
    case K.style: {
      const left = name.leftName;
      if (left === undefined) return undefined;
      const leftCard = await deps.fetchByKey(left.key);
      if (leftCard?.typeId === undefined) return undefined;
      const setType = await deps.fetchByKey("set");
      if (setType?.id === undefined) return undefined;
      return leftCard.typeId === setType.id ? true : undefined;
    }
    default:
      return undefined;
  }
}

async function ownAccountVerdict(
  name: DeckoName,
  deps: IdentityOverrideDeps,
  depth: number,
): Promise<boolean | undefined> {
  if (deps.viewerKey === undefined || depth >= OVERRIDE_MAX_DEPTH) return undefined;
  const left = name.leftName;
  if (left === undefined) return undefined;
  if (left.tagKey === overrideKeys().account) return ownAccountVerdict(left, deps, depth + 1);
  const leftCard = await deps.fetchByKey(left.key);
  if (leftCard === undefined) return undefined;
  const holder =
    (leftCard.codename !== undefined && ACCOUNT_HOLDER_CODENAMES.has(leftCard.codename)) ||
    (await isHolderType(leftCard, deps));
  if (!holder) return undefined;
  return leftCard.key === deps.viewerKey ? true : undefined;
}

async function isHolderType(card: CardRecord, deps: IdentityOverrideDeps): Promise<boolean> {
  if (card.typeId === undefined) return false;
  const typeCard = await deps.fetchById(card.typeId);
  return typeCard?.codename !== undefined && ACCOUNT_HOLDER_TYPE_CODENAMES.has(typeCard.codename);
}

export async function updatePermissionOverride(
  name: DeckoName,
  deps: IdentityOverrideDeps,
): Promise<boolean | undefined> {
  const K = overrideKeys();
  if (!name.isCompound) {
    return holderSelfVerdict(name, deps);
  }
  switch (name.tagKey) {
    case K.account:
      return ownAccountVerdict(name, deps, 0);
    case K.email:
    case K.password:
    case K.salt:
      return accountFieldOwnAccount(name, deps);
    case K.status: {
      const own = await accountFieldOwnAccount(name, deps);
      return own === true ? false : undefined;
    }
    default:
      return undefined;
  }
}

async function accountFieldOwnAccount(
  name: DeckoName,
  deps: IdentityOverrideDeps,
): Promise<boolean | undefined> {
  if (deps.viewerKey === undefined) return undefined;
  const left = name.leftName;
  if (left === undefined) return undefined;
  const leftCard = await deps.fetchByKey(left.key);
  if (leftCard?.rightId === undefined) return undefined;
  const accountCard = await deps.fetchByKey(overrideKeys().account);
  if (accountCard?.id === undefined) return undefined;
  if (leftCard.rightId !== accountCard.id) return undefined;
  return ownAccountVerdict(left, deps, 1);
}

async function holderSelfVerdict(
  name: DeckoName,
  deps: IdentityOverrideDeps,
): Promise<boolean | undefined> {
  if (deps.viewerKey === undefined) return undefined;
  const selfCard = await deps.fetchByKey(name.key);
  if (selfCard === undefined) return undefined;
  const holder =
    (selfCard.codename !== undefined && ACCOUNT_HOLDER_CODENAMES.has(selfCard.codename)) ||
    (await isHolderType(selfCard, deps));
  if (!holder) return undefined;
  return selfCard.key === deps.viewerKey ? true : undefined;
}
