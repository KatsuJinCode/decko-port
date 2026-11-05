import { DeckoName } from "../name.js";
import { CARD_CODENAME_BY_ID_SQL } from "../fetch/card-read-shapes.js";
import type { ModEventCard } from "./mod-manifest.js";
import {
  registerModEventCardStateSource,
  type ModEventCardState,
  type ModEventCardStateContext,
} from "./mod-event-card-state.js";
import { envValue } from "../debug-flags.js";
import { listItemTypeConstraints } from "./mods/card-mod-list.js";
import {
  rubyBucketFromContent,
  rubyModFromContent,
  rubyStorageTypeFromContent,
} from "./mods/card-mod-carrierwave.js";

function coreSource(
  card: ModEventCard,
  ctx: ModEventCardStateContext,
): ModEventCardState {
  return ctx.params !== undefined ? { params: ctx.params } : {};
}

async function historySource(
  card: ModEventCard,
  ctx: ModEventCardStateContext,
): Promise<ModEventCardState> {
  return {
    isActCard: ctx.isActCard,
    history: await resolveHistory(card, ctx),
  };
}

function carrierwaveSource(
  card: ModEventCard,
  ctx: ModEventCardStateContext,
): ModEventCardState {
  const configured = ctx.fileStorage ?? "local";
  const save = ctx.saveInput;
  const content = card.dbContent ?? null;
  const before = card.dbContentBeforeAct ?? null;
  const riding = save?.attachmentRides === true;

  const storageType =
    save?.storageType ??
    (riding || card.action === "create"
      ? configured
      : rubyStorageTypeFromContent(content, configured));
  const currentType =
    card.action === "create" ? configured : rubyStorageTypeFromContent(before, configured);
  const currentBucket: string | false =
    currentType === "cloud" ? rubyBucketFromContent(before) ?? false : false;
  const currentMod: string | false =
    currentType === "coded" ? rubyModFromContent(before) ?? false : false;
  const savedBucket: string | false =
    storageType === "cloud"
      ? save?.bucket ?? rubyBucketFromContent(content) ?? false
      : false;
  const savedMod: string | false =
    storageType === "coded" ? save?.mod ?? rubyModFromContent(content) ?? false : false;

  return {
    storageType,
    ...(save?.storageType !== undefined ? { explicitStorageType: save.storageType } : {}),
    ...(save?.mod !== undefined ? { assignedMod: save.mod } : {}),
    currentStorageType: currentType,
    currentStorageBucket: currentBucket,
    currentStorageMod: currentMod,
    savedStorageBucket: savedBucket,
    savedStorageMod: savedMod,
    storeCodedFiles: envValue("STORE_CODED_FILES") !== undefined,
    attachmentPresent: riding,
    attachmentIsChanging: riding,
    ...(save?.actionIdOfCachedUpload !== undefined
      ? { actionIdOfCachedUpload: save.actionIdOfCachedUpload }
      : {}),
    attachmentIdentifierContent: riding ? (content ?? undefined) : (before ?? undefined),
  };
}

const NO_HISTORY_SETS: ReadonlyArray<{
  scope: "right" | "self" | "type";
  codename: string;
}> = [
  { scope: "right", codename: "autoname" },
  { scope: "right", codename: "password" },
  { scope: "right", codename: "salt" },
  { scope: "right", codename: "api_key" },
  { scope: "right", codename: "asset_input" },
  { scope: "right", codename: "asset_output" },
  { scope: "self", codename: "recent_settings" },
  { scope: "type", codename: "session" },
];

async function resolveHistory(
  card: ModEventCard,
  ctx: ModEventCardStateContext,
): Promise<boolean> {
  const fetch = ctx.fetch;
  if (fetch === undefined) return true;
  const typeCode = card.typeId !== undefined && card.typeId !== null
    ? await codenameOfId(ctx, card.typeId)
    : undefined;
  const selfCode = card.codename;
  const rightCode = card.name !== "" ? (await fetch.fetch(DeckoName.parse(card.name).rightName?.s ?? ""))?.codename : undefined;
  for (const set of NO_HISTORY_SETS) {
    if (set.scope === "type" && typeCode === set.codename) return false;
    if (set.scope === "self" && selfCode === set.codename) return false;
    if (set.scope === "right" && rightCode === set.codename) return false;
  }
  return true;
}

async function listSource(
  card: ModEventCard,
  ctx: ModEventCardStateContext,
): Promise<ModEventCardState> {
  return {
    hasOkItemTypes: await hasOkItemTypes(card, ctx),
    uniqueItems: false,
  };
}

async function hasOkItemTypes(
  card: ModEventCard,
  ctx: ModEventCardStateContext,
): Promise<boolean> {
  if (ctx.fetch === undefined || card.name === "") return false;
  return (await listItemTypeConstraints(ctx.driver, card.name)) !== undefined;
}

async function codenameOfId(
  ctx: ModEventCardStateContext,
  id: number,
): Promise<string | undefined> {
  const row = (
    await ctx.driver.query<{ codename: string | null }>(
      CARD_CODENAME_BY_ID_SQL,
      [id],
    )
  ).rows[0];
  const codename = row?.codename;
  return codename !== null && codename !== undefined && codename !== "" ? codename : undefined;
}

async function assetsSource(
  card: ModEventCard,
  ctx: ModEventCardStateContext,
): Promise<ModEventCardState> {
  if (card.codename !== undefined || card.id === undefined) return {};
  return { codename: await codenameOfId(ctx, card.id) };
}

async function accountSource(
  card: ModEventCard,
  ctx: ModEventCardStateContext,
): Promise<ModEventCardState> {
  const fetch = ctx.fetch;
  if (fetch === undefined || card.id === undefined) return {};
  const accountId = await fetch.codenames.id("account");
  const passwordId = await fetch.codenames.id("password");
  if (accountId === undefined || passwordId === undefined) return {};
  const row = (await ctx.driver.query<{ right_id: number | null }>(
    "SELECT right_id FROM cards WHERE id = ? AND trash = 0",
    [card.id],
  )).rows[0];
  if (row?.right_id !== accountId) return {};
  const child = (await ctx.driver.query<{ db_content: string | null }>(
    "SELECT db_content FROM cards WHERE left_id = ? AND right_id = ? AND trash = 0",
    [card.id, passwordId],
  )).rows[0];
  return { password: child?.db_content ?? "" };
}

export function registerDeckModEventCardStateSources(): void {
  registerModEventCardStateSource({
    modName: "core",
    setPaths: ["all/autoname", "all/content", "all/name_events", "type/cardtype"],
    load: coreSource,
  });
  registerModEventCardStateSource({
    modName: "account",
    setPaths: ["right/account/events"],
    load: accountSource,
  });
  registerModEventCardStateSource({
    modName: "history",
    setPaths: ["all/history", "all/history/events", "all/history/revision"],
    load: historySource,
  });
  registerModEventCardStateSource({
    modName: "carrierwave",
    setPaths: [
      "abstract/attachment",
      "abstract/attachment/00_upload_cache",
      "abstract/attachment/01_storage_type",
      "abstract/attachment/cloud",
      "abstract/attachment/coded",
      "abstract/attachment/local",
    ],
    load: carrierwaveSource,
  });
  registerModEventCardStateSource({
    modName: "list",
    setPaths: ["abstract/01_list/events"],
    load: listSource,
  });
  registerModEventCardStateSource({
    modName: "assets",
    setPaths: ["right/asset_output", "abstract/asset_inputter"],
    load: assetsSource,
  });
}
