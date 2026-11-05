import { DeckoName } from "../name.js";
import { createHash } from "node:crypto";
import type { FetchEngine } from "../fetch.js";
import type { SQLStatement } from "../../server/driver.js";
import type { CardVirtualsRow } from "../../server/schema.js";
import type { CardsRow } from "../../server/schema.js";
import type { ActWriter } from "../history/write-path.js";
import { cardFieldStateFromRow } from "../history/write-path.js";
import { trackedFieldIndex } from "../history/change.js";
import type { AttachmentStore } from "../attachments/attachment-store.js";
import { localAttachmentIdentifier } from "../attachments/attachment-content.js";
import { rawItemStrings } from "../render/pointer-list.js";
import { composeCardRecord, newCardRecord } from "../fetch/card-record.js";
import { VirtualRecordCache, findVirtualByCard, virtualSave, validateVirtualCard } from "../mod-loader/mods/card-mod-virtual.js";
import { STYLE_SOURCES_MTIME } from "../assets/style-sources.js";
import { sqlDateTime } from "../history/act.js";
import type { ScssCompiler } from "../assets/scss-compiler.js";
import type { CoffeeCompiler } from "../assets/coffee-compiler.js";
import type { ScriptCompressor } from "../assets/script-compressor.js";
import {
  STYLE_INPUTTER_TYPES,
  StyleAssetUnsupportedError,
  assembleStyleInput,
  bootswatchSkinContent,
  styleOutputContent,
  type AssetInputStore,
  type StyleAssetDeps,
  type StyleCard,
} from "../assets/skin-stylesheet.js";
import {
  SCRIPT_INPUTTER_TYPES,
  assembleModScriptInput,
  assembleScriptInput,
  scriptOutputContent,
} from "../assets/site-script.js";
import { refreshReferencesOut } from "./refresh-references-out.js";
import { CardActionError } from "./types.js";
import { resolveTypeId } from "./type-resolution.js";
import { strictParityFlags } from "../parity/strict-parity-flags.js";

export interface StyleAssetEventContext {
  fetch: FetchEngine;
  clock: () => Date;
  newWriter: () => ActWriter;
  expire: (cardId: number, name: DeckoName) => Promise<void>;
  attachmentStore: AttachmentStore | undefined;
  storeOutput?: AttachmentStore["store"];
  compile: ScssCompiler | undefined;
  compileCoffee?: CoffeeCompiler | undefined;
  compressAssets?: boolean;
  compressScript?: ScriptCompressor | undefined;
  virtuals: VirtualRecordCache;
  refreshState?: AssetRefreshState;
}

export interface SavedCard {
  cardId: number;
  actionId: number;
  verb: "create" | "update" | "delete";
  contentBefore?: string | null;
}

const SKIN_FIELDS = new Set(["colors", "variables", "stylesheets"]);

async function rowById(ctx: StyleAssetEventContext, id: number): Promise<CardsRow | undefined> {
  const card = await ctx.fetch.fetchById(id, { skipVirtual: true, lookInTrash: true });
  if (card === undefined || card.id === undefined) return undefined;
  return {
    id: card.id,
    name: card.name?.s ?? null,
    key: card.key ?? null,
    codename: card.codename ?? null,
    left_id: card.leftId ?? null,
    right_id: card.rightId ?? null,
    current_revision_id: card.currentRevisionId ?? null,
    created_at: card.createdAt as CardsRow["created_at"],
    updated_at: card.updatedAt as CardsRow["updated_at"],
    creator_id: card.creatorId as number,
    updater_id: card.updaterId as number,
    read_rule_class: card.readRuleClass ?? null,
    read_rule_id: card.readRuleId ?? null,
    references_expired: card.referencesExpired ?? null,
    trash: card.trash ? 1 : 0,
    type_id: card.typeId as number,
    db_content: card.dbContent ?? null,
  };
}

async function codenameOf(ctx: StyleAssetEventContext, id: number | null | undefined): Promise<string | undefined> {
  if (id === null || id === undefined) return undefined;
  return (await rowById(ctx, id))?.codename ?? undefined;
}

async function styleCardFromRecord(
  ctx: StyleAssetEventContext,
  rec: { id: number | undefined; name: DeckoName | undefined; key: string | undefined; typeId: number | undefined;
    codename: string | undefined; dbContent: string | undefined; leftId: number | undefined; rightId: number | undefined;
    trash: boolean } | undefined,
): Promise<StyleCard | undefined> {
  if (rec === undefined || rec.trash || rec.id === undefined) return undefined;
  return {
    id: rec.id,
    name: rec.name?.s ?? "",
    key: rec.key ?? rec.name?.key ?? "",
    typeCode: await codenameOf(ctx, rec.typeId),
    codename: rec.codename ?? undefined,
    dbContent: rec.dbContent ?? "",
    leftId: rec.leftId,
    rightId: rec.rightId,
  };
}

async function cardByName(ctx: StyleAssetEventContext, name: string): Promise<StyleCard | undefined> {
  return styleCardFromRecord(ctx, await ctx.fetch.fetchByKey(DeckoName.parse(name).key));
}

async function cardById(ctx: StyleAssetEventContext, id: number): Promise<StyleCard | undefined> {
  return styleCardFromRecord(ctx, await ctx.fetch.fetchById(id));
}

function deps(ctx: StyleAssetEventContext, staleContent: ReadonlyMap<string, string>): StyleAssetDeps {
  return {
    card: (name) => cardByName(ctx, name),
    cardByCodename: async (code) => {
      const id = await ctx.fetch.codenames.id(code);
      return id === undefined ? undefined : cardById(ctx, id);
    },
    compile: ctx.compile,
    compileCoffee: ctx.compileCoffee,
    ...(ctx.compressAssets === undefined ? {} : { compressAssets: ctx.compressAssets }),
    compressScript: ctx.compressScript,
    staleContent,
  };
}

export async function scssValidationVariables(ctx: StyleAssetEventContext): Promise<string> {
  const all = await ctx.fetch.codenames.name("all");
  const style = await ctx.fetch.codenames.name("style");
  if (all === undefined || style === undefined) return "";
  const rule = await cardByName(ctx, `${all.s}+${style.s}`);
  if (rule === undefined) return "";
  const readDeps = deps(ctx, new Map());
  const contents: string[] = [];
  for (const item of rawItemStrings(rule.dbContent)) {
    const card = await cardByName(ctx, DeckoName.parse(item).absoluteName(DeckoName.parse(rule.name)).s);
    if (card === undefined) continue;
    contents.push(card.typeCode === "bootswatch_skin" ? await bootswatchSkinContent(readDeps, card) : card.dbContent);
  }
  return contents.join("\n");
}

async function assetInputRecord(ctx: StyleAssetEventContext, inputter: StyleCard, content: string | undefined) {
  const rightId = await ctx.fetch.codenames.id("asset_input");
  if (rightId === undefined) return undefined;
  const name = DeckoName.compose([inputter.name, "*asset input"]);
  const record = newCardRecord(name);
  record.leftId = inputter.id;
  record.rightId = rightId;
  record.dbContent = content;
  record.key = name.key;
  return record;
}

function inputStore(ctx: StyleAssetEventContext): AssetInputStore {
  return {
    read: async (inputter) => {
      const record = await assetInputRecord(ctx, inputter, undefined);
      if (record === undefined) return "";
      const row = ctx.refreshState !== undefined
        ? await ctx.refreshState.read(record)
        : await findVirtualByCard(ctx.fetch.driver, record);
      return row === undefined ? undefined : row.content ?? "";
    },
    save: async (inputter, content) => {
      const record = await assetInputRecord(ctx, inputter, content);
      if (record === undefined) return;
      if (ctx.refreshState !== undefined) await ctx.refreshState.save(record, ctx.clock());
      else await virtualSave(ctx.fetch.driver, record, ctx.virtuals, ctx.clock());
    },
  };
}

async function inputMissing(ctx: StyleAssetEventContext, inputter: StyleCard): Promise<boolean> {
  const record = await assetInputRecord(ctx, inputter, undefined);
  if (record === undefined) return false;
  const row = ctx.refreshState !== undefined
    ? await ctx.refreshState.read(record)
    : await findVirtualByCard(ctx.fetch.driver, record);
  return row === undefined;
}

async function isStyleOutputter(ctx: StyleAssetEventContext, card: StyleCard): Promise<boolean> {
  if ((await codenameOf(ctx, card.rightId)) !== "style") return false;
  const left = card.leftId !== undefined ? await rowById(ctx, card.leftId) : undefined;
  return left !== undefined && (await codenameOf(ctx, left.type_id)) === "set";
}

async function isScriptOutputter(ctx: StyleAssetEventContext, card: StyleCard): Promise<boolean> {
  if ((await codenameOf(ctx, card.rightId)) !== "script") return false;
  const left = card.leftId !== undefined ? await rowById(ctx, card.leftId) : undefined;
  return left !== undefined && (await codenameOf(ctx, left.type_id)) === "set";
}

async function isModScriptCard(ctx: StyleAssetEventContext, card: StyleCard): Promise<boolean> {
  if ((await codenameOf(ctx, card.rightId)) !== "script" || card.leftId === undefined) return false;
  const left = await rowById(ctx, card.leftId);
  return (left?.codename ?? "").startsWith("mod_");
}

function isStyleTypeInputter(card: StyleCard): boolean {
  return card.typeCode !== undefined && STYLE_INPUTTER_TYPES.has(card.typeCode);
}

async function isScriptInputter(ctx: StyleAssetEventContext, card: StyleCard): Promise<boolean> {
  if (card.typeCode !== undefined && SCRIPT_INPUTTER_TYPES.has(card.typeCode)) return true;
  return isModScriptCard(ctx, card);
}

async function isInputter(ctx: StyleAssetEventContext, card: StyleCard): Promise<boolean> {
  return (await isStyleInputter(ctx, card)) || (await isScriptInputter(ctx, card));
}

async function isStyleInputter(ctx: StyleAssetEventContext, card: StyleCard): Promise<boolean> {
  if (isStyleTypeInputter(card) || card.codename === "style_mods") return true;
  if ((await codenameOf(ctx, card.rightId)) !== "style") return false;
  const left = card.leftId !== undefined ? await rowById(ctx, card.leftId) : undefined;
  return (left?.codename ?? "").startsWith("mod_");
}

function refuse(err: unknown): never {
  if (err instanceof StyleAssetUnsupportedError) {
    throw new CardActionError("server-error", err.message);
  }
  throw err;
}

async function updateAssetInput(
  ctx: StyleAssetEventContext,
  card: StyleCard,
  stale: ReadonlyMap<string, string>,
  visited: Set<number>,
): Promise<void> {
  if (visited.has(card.id)) return;
  visited.add(card.id);
  const store = inputStore(ctx);
  const styleContent = await assembleStyleInput(deps(ctx, stale), store, card).catch(refuse);
  const content = styleContent ?? (await assembleScriptSide(deps(ctx, stale), card).catch(refuse));
  if (content === undefined) return;
  await store.save(card, content);
  for (const dependent of await dependentAssetInputters(ctx, card)) {
    await updateAssetInput(ctx, dependent, stale, visited);
  }
  for (const outputter of await outputterReferers(ctx, card)) {
    await updateAssetOutput(ctx, outputter.card, stale, outputter.family);
  }
}

async function dependentAssetInputters(ctx: StyleAssetEventContext, card: StyleCard): Promise<StyleCard[]> {
  if (card.codename === "style_mods") return activeThemeCards(ctx);
  const referers = await referringCards(ctx, card);
  return (await Promise.all(referers.map(async (c) => ((await isInputter(ctx, c)) ? c : undefined)))).filter(
    (c): c is StyleCard => c !== undefined,
  );
}

interface OutputterReferer {
  card: StyleCard;
  family: "style" | "script";
}

async function outputterReferers(
  ctx: StyleAssetEventContext,
  card: StyleCard,
): Promise<readonly OutputterReferer[]> {
  const out: { card: StyleCard; family: "style" | "script" }[] = [];
  for (const referer of await referringCards(ctx, card)) {
    if (await isStyleOutputter(ctx, referer)) out.push({ card: referer, family: "style" });
    else if (await isScriptOutputter(ctx, referer)) out.push({ card: referer, family: "script" });
  }
  return out;
}

async function referringCards(ctx: StyleAssetEventContext, card: StyleCard): Promise<StyleCard[]> {
  const referers = ctx.refreshState?.referers.get(card.id) ?? (
    await ctx.fetch.driver.query<{ referer_id: number }>(
      "SELECT DISTINCT referer_id FROM card_references WHERE referee_id = ? ORDER BY referer_id", [card.id],
    )
  ).rows.map((r) => Number(r.referer_id));
  return (await Promise.all(referers.map((id) => cardById(ctx, id)))).filter(
    (c): c is StyleCard => c !== undefined,
  );
}

async function activeThemeCards(ctx: StyleAssetEventContext): Promise<StyleCard[]> {
  const rule = await cardByName(ctx, "*all+*style");
  if (rule === undefined) return [];
  const items = (
    await Promise.all(rawItemStrings(rule.dbContent).map((name) => cardByName(ctx, name)))
  ).filter((c): c is StyleCard => c !== undefined);
  return items.filter((c) => c.typeCode === "bootswatch_skin");
}

async function assembleScriptSide(deps: StyleAssetDeps, card: StyleCard): Promise<string | undefined> {
  return assembleModScriptInput(deps, card) ?? assembleScriptInput(deps, card);
}

export function assetOutputNameSlot(bytes: Uint8Array): number {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return Number(BigInt(`0x${digest.slice(0, 12)}`) % 1_000_000_000_000n);
}

async function updateAssetOutput(
  ctx: StyleAssetEventContext,
  outputter: StyleCard,
  stale: ReadonlyMap<string, string>,
  family: "style" | "script",
  preparedContent?: string,
): Promise<void> {
  const eventDeps = deps(ctx, stale);
  const store = inputStore(ctx);
  const css = preparedContent ?? (family === "style"
    ? await styleOutputContent(eventDeps, store, outputter).catch(refuse)
    : await scriptOutputContent(eventDeps, store, outputter).catch(refuse));
  if (ctx.attachmentStore === undefined) {
    throw new Error("storing the site stylesheet requires the engine's attachmentStore option");
  }
  if (ctx.refreshState?.collectOutputs && ctx.refreshState.outputs.has(outputter.id)) {
    ctx.refreshState.outputs.set(outputter.id, { card: outputter, family, content: css });
    return;
  }
  try {
  await ctx.refreshState?.flush();
  const outputRightId = await ctx.fetch.codenames.id("asset_output");
  if (outputRightId === undefined) throw new Error("the deck has no *asset output codename card");
  const name = DeckoName.compose([outputter.name, "*asset output"]);
  const ext = family === "style" ? ".css" : ".js";
  const bytes = new TextEncoder().encode(css);
  const stamp = strictParityFlags().scriptBundleClockNames
    ? Math.floor(ctx.clock().getTime() / 1000)
    : assetOutputNameSlot(bytes);
  const existing = ctx.refreshState?.outputRows.has(outputter.id) ? ctx.refreshState.outputRows.get(outputter.id) : (
    await ctx.fetch.driver.query<CardsRow>(
      "SELECT * FROM cards WHERE left_id = ? AND right_id = ? AND trash = 0",
      [outputter.id, outputRightId],
    )
  ).rows[0];
  const writer = ctx.newWriter();
  let cardId: number;
  if (existing !== undefined) {
    cardId = existing.id;
  } else {
    const fileTypeId = await ctx.fetch.codenames.id("file");
    if (fileTypeId === undefined) throw new Error("the deck has no File cardtype");
    const created = await writer.createCard({
      name: null,
      key: null,
      left_id: outputter.id,
      right_id: outputRightId,
      type_id: fileTypeId,
      db_content: "",
      history: false,
    });
    cardId = created.cardId;
  }
  const output = { cardId, actionId: stamp, ext, bytes };
  if (ctx.storeOutput !== undefined) await ctx.storeOutput(output);
  else await ctx.attachmentStore.store(output);
  const before = existing ?? (await rowById(ctx, cardId));
  if (before === undefined) throw new Error(`asset output card ${cardId} vanished`);
  const state = cardFieldStateFromRow(before);
  await writer.updateCard({
    cardId,
    before: state,
    after: { ...state, db_content: localAttachmentIdentifier(cardId, stamp, ext) },
    dirtyFields: ["db_content"],
    history: false,
  });
  await ctx.expire(cardId, name);
  ctx.refreshState?.outputRows.set(outputter.id, { ...before, db_content: localAttachmentIdentifier(cardId, stamp, ext) });
  if (ctx.refreshState?.collectOutputs) ctx.refreshState.outputs.set(outputter.id, { card: outputter, family, content: css });
  } catch (error) {
    if (ctx.refreshState !== undefined) ctx.refreshState.publicationFailed = true;
    throw error;
  }
}

const CONTENT_BEFORE_SQL = `SELECT ch.value FROM card_changes ch JOIN card_actions a ON a.id = ch.card_action_id
        WHERE a.card_id = ? AND a.id < ? AND ch.field = ? AND (a.draft IS NULL OR a.draft = 0)
        ORDER BY a.id DESC LIMIT 1`;

async function contentBeforeBatch(
  ctx: StyleAssetEventContext,
  cards: readonly { cardId: number; actionId: number }[],
): Promise<(string | undefined)[]> {
  if (cards.length === 0) return [];
  const results = await ctx.fetch.driver.batch(
    cards.map((card) => ({
      sql: CONTENT_BEFORE_SQL,
      params: [card.cardId, card.actionId, trackedFieldIndex("db_content")],
    })),
  );
  return results.map((result) => {
    const row = result.rows[0] as { value: string | null } | undefined;
    return row === undefined ? undefined : row.value ?? "";
  });
}

async function changedField(ctx: StyleAssetEventContext, saved: SavedCard, field: "db_content" | "type_id"): Promise<boolean> {
  if (saved.verb === "create") return true;
  if (saved.actionId === 0) return false;
  const row = (
    await ctx.fetch.driver.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM card_changes WHERE card_action_id = ? AND field = ?",
      [saved.actionId, trackedFieldIndex(field)],
    )
  ).rows[0];
  return Number(row?.n ?? 0) > 0;
}

export async function assertStyleCompilerFor(
  ctx: StyleAssetEventContext,
  name: DeckoName,
  typeId: number | undefined,
): Promise<void> {
  const compressorMissing = ctx.compressAssets === true && ctx.compressScript === undefined;
  if (ctx.compile !== undefined && ctx.compileCoffee !== undefined && !compressorMissing) return;
  let missing: "SCSS" | "CoffeeScript" | "script compressor" | undefined;
  const typeCode = await codenameOf(ctx, typeId);
  if (typeCode !== undefined && STYLE_INPUTTER_TYPES.has(typeCode) && ctx.compile === undefined) missing = "SCSS";
  if (typeCode === "coffee_script" && ctx.compileCoffee === undefined) {
    missing ??= "CoffeeScript";
  }
  if ((typeCode === "coffee_script" || typeCode === "java_script") && compressorMissing) {
    missing ??= "script compressor";
  }
  if (!missing && name.isCompound && name.rightName !== undefined && name.leftName !== undefined) {
    const right = await ctx.fetch.fetchByKey(name.rightName.key);
    const rightCode = right?.codename ?? undefined;
    const left = await ctx.fetch.fetchByKey(name.leftName.key);
    const leftType = left === undefined ? undefined : await codenameOf(ctx, left.typeId);
    const leftIsSet = leftType === "set" || (left === undefined && (await typeCodeOfName(ctx, name.leftName)) === "set");
    if (
      (rightCode === "style" && leftIsSet && ctx.compile === undefined) ||
      (rightCode !== undefined && SKIN_FIELDS.has(rightCode) && leftType === "bootswatch_skin" && ctx.compile === undefined)
    ) {
      missing = "SCSS";
    } else if (rightCode === "script" && leftIsSet && ctx.compileCoffee === undefined) {
      missing = "CoffeeScript";
    } else if (rightCode === "script" && leftIsSet && compressorMissing) {
      missing = "script compressor";
    }
  }
  if (missing !== undefined) {
    const what =
      missing === "script compressor"
        ? "script compressor configured (the scriptCompressor engine option, needed under compressAssets)"
        : `${missing} compiler configured (the ${missing === "SCSS" ? "scssCompiler" : "coffeeCompiler"} engine option)`;
    throw new CardActionError(
      "user-error",
      `${name.s}: saving it rebuilds asset files, and this host has no ${what}`,
    );
  }
}

const READ_ASSET_INPUT_NAMES: readonly string[] = ["style: mods"];

export async function refreshReadAssetInputs(ctx: StyleAssetEventContext): Promise<void> {
  const store = ctx.storeOutput ?? ctx.attachmentStore?.store.bind(ctx.attachmentStore);
  if (store !== undefined) ctx = { ...ctx, storeOutput: memoizeRefreshOutputStore(store) };
  const refresh = async () => {
    const state = await prepareAssetRefresh(ctx);
    if (state?.idle) return;
    const working = state === undefined ? ctx : { ...ctx, refreshState: state };
    const publishOutputs = async () => {
      if (state !== undefined) state.collectOutputs = false;
      for (const output of state?.outputs.values() ?? []) {
        await updateAssetOutput(working, output.card, new Map(), output.family, output.content);
      }
    };
    try {
      const inputters = state === undefined ? await standardInputtersNeedingRefresh(working)
        : await Promise.all(state.standardIds.map(id => cardById(working, id)));
      for (const card of inputters) {
        if (card === undefined) continue;
      await updateAssetInput(working, card, new Map(), new Set());
    }
    for (const name of READ_ASSET_INPUT_NAMES) {
      const card = await cardByName(working, name);
      if (card === undefined || !(await inputMissing(working, card))) continue;
      await updateAssetInput(working, card, new Map(), new Set());
    }
    } catch (error) {
      if (state?.publicationFailed) throw error;
      try { await state?.flush(); await publishOutputs(); }
      catch (flushError) { throw new AggregateError([error, flushError], "Asset refresh assembly and persistence failed"); }
      throw error;
    }
    await state?.flush();
    await publishOutputs();
  };
  const driver = ctx.fetch.driver;
  if (driver.readPhase !== undefined) await driver.readPhase(refresh);
  else await refresh();
}

export function memoizeRefreshOutputStore(store: AttachmentStore["store"]): AttachmentStore["store"] {
  const written = new Map<string, { digest: string; result: Awaited<ReturnType<AttachmentStore["store"]>> }>();
  return async input => {
    if (input.area !== undefined || input.coded !== undefined || input.renditionNames !== undefined || input.renditionBytes !== undefined) return store(input);
    const key = JSON.stringify([input.cardId, input.actionId, input.ext]);
    const digest = createHash("sha256").update(input.bytes).digest("hex");
    const previous = written.get(key);
    if (previous?.digest === digest) return previous.result;
    written.delete(key);
    const result = await store(input);
    written.set(key, { digest, result });
    return result;
  };
}

async function standardInputtersNeedingRefresh(ctx: StyleAssetEventContext): Promise<StyleCard[]> {
  const modTypeId = await ctx.fetch.codenames.id("mod");
  const inputRightId = await ctx.fetch.codenames.id("asset_input");
  if (modTypeId === undefined || inputRightId === undefined) return [];
  const rows = (
    await ctx.fetch.driver.query<{ id: number }>(
      "SELECT c.id AS id FROM cards c " +
        "JOIN cards l ON l.id = c.left_id JOIN cards r ON r.id = c.right_id " +
        "LEFT JOIN card_virtuals v ON v.right_id = ? AND v.left_id = c.id " +
        "WHERE c.trash = 0 AND l.type_id = ? AND r.codename IN ('style', 'script') " +
        "AND (v.id IS NULL OR v.updated_at IS NULL OR v.updated_at < ?) ORDER BY c.id",
      [inputRightId, modTypeId, sqlDateTime(STYLE_SOURCES_MTIME)],
    )
  ).rows;
  return (await Promise.all(rows.map((r) => cardById(ctx, Number(r.id))))).filter(
    (c): c is StyleCard => c !== undefined,
  );
}

export async function runStyleAssetEvents(ctx: StyleAssetEventContext, savedCards: readonly SavedCard[]): Promise<void> {
  const saved = savedCards.filter((s) => s.verb !== "delete");
  const savedIds = new Set(saved.map((s) => s.cardId));
  const cards = new Map<number, StyleCard>();
  const stale = new Map<string, string>();
  const askingBefore = saved.filter((s) => s.verb === "update" && s.contentBefore === undefined);
  const beforeByCard = new Map<number, string | undefined>();
  const beforeAnswers = await contentBeforeBatch(
    ctx,
    askingBefore.map((s) => ({ cardId: s.cardId, actionId: s.actionId })),
  );
  askingBefore.forEach((s, index) => beforeByCard.set(s.cardId, beforeAnswers[index]));
  for (const s of saved) {
    const card = await cardById(ctx, s.cardId);
    if (card === undefined) continue;
    cards.set(s.cardId, card);
    if (s.verb === "update") {
      const before =
        s.contentBefore !== undefined
          ? s.contentBefore ?? ""
          : beforeByCard.get(s.cardId);
      if (before !== undefined && before !== card.dbContent) stale.set(card.key, before);
    }
  }
  for (const s of saved) {
    const card = cards.get(s.cardId);
    if (card === undefined) continue;
    const own = new Map(stale);
    own.delete(card.key);
    if ((await isInputter(ctx, card)) && (await changedField(ctx, s, "db_content"))) {
      await updateAssetInput(ctx, card, own, new Set());
    }
    if (SKIN_FIELDS.has((await codenameOf(ctx, card.rightId)) ?? "") && card.leftId !== undefined && !savedIds.has(card.leftId)) {
      const skin = await cardById(ctx, card.leftId);
      if (skin?.typeCode === "bootswatch_skin") await updateAssetInput(ctx, skin, stale, new Set());
    }
    if (await isStyleOutputter(ctx, card)) await updateAssetOutput(ctx, card, own, "style");
    if (await isScriptOutputter(ctx, card)) await updateAssetOutput(ctx, card, own, "script");
  }
  for (const s of savedCards) {
    if (s.verb !== "delete") continue;
    const rec = await ctx.fetch.fetchById(s.cardId, { lookInTrash: true });
    const card = rec === undefined ? undefined : await styleCardFromRecord(ctx, { ...rec, trash: false });
    if (card === undefined || !(await isInputter(ctx, card))) continue;
    await updateReferersAfterInputDeleted(ctx, card, stale);
  }
}

async function updateReferersAfterInputDeleted(
  ctx: StyleAssetEventContext,
  card: StyleCard,
  stale: ReadonlyMap<string, string>,
): Promise<void> {
  const referers = (
    await ctx.fetch.driver.query<{ referer_id: number }>(
      "SELECT DISTINCT referer_id FROM card_references WHERE referee_id = ? ORDER BY referer_id",
      [card.id],
    )
  ).rows.map((r) => Number(r.referer_id));
  const referringCards = (await Promise.all(referers.map((id) => cardById(ctx, id)))).filter(
    (c): c is StyleCard => c !== undefined,
  );
  for (const referer of referringCards) {
    if (await isInputter(ctx, referer)) await updateAssetInput(ctx, referer, stale, new Set());
  }
  for (const referer of referringCards) {
    if (await isStyleOutputter(ctx, referer)) await updateAssetOutput(ctx, referer, stale, "style");
    if (await isScriptOutputter(ctx, referer)) await updateAssetOutput(ctx, referer, stale, "script");
  }
}

async function typeCodeOfName(ctx: StyleAssetEventContext, name: DeckoName): Promise<string | undefined> {
  const rec = await ctx.fetch.fetchByKey(name.key);
  if (rec !== undefined && !rec.trash) return codenameOf(ctx, rec.typeId);
  try {
    return codenameOf(ctx, await resolveTypeId(ctx.fetch, { name }));
  } catch {
    return undefined;
  }
}

async function isRule(ctx: StyleAssetEventContext, name: DeckoName): Promise<boolean> {
  const parts = name.parts;
  if (parts.length < 2) return false;
  const right = DeckoName.parse(parts[parts.length - 1]);
  if ((await typeCodeOfName(ctx, right)) !== "setting") return false;
  if ((await typeCodeOfName(ctx, DeckoName.compose(parts.slice(0, -1)))) === "set") return true;
  if (parts.length > 2 && (await typeCodeOfName(ctx, DeckoName.compose(parts.slice(0, -2)))) === "set") {
    const preferer = DeckoName.parse(parts[parts.length - 2]);
    const rec = await ctx.fetch.fetchByKey(preferer.key);
    return rec?.codename === "all" || (await codenameOf(ctx, rec?.typeId)) === "user";
  }
  return false;
}

export async function saveRecentlyEditedSettings(
  ctx: StyleAssetEventContext,
  savedCards: readonly SavedCard[],
): Promise<void> {
  const recentId = await ctx.fetch.codenames.id("recent_settings");
  if (recentId === undefined) return;
  for (const s of savedCards) {
    if (s.verb === "delete") continue;
    const rec = await ctx.fetch.fetchById(s.cardId);
    if (rec?.name === undefined || rec.trash) continue;
    if (!(await changedField(ctx, s, "db_content")) && !(await changedField(ctx, s, "type_id"))) continue;
    if (!(await isRule(ctx, rec.name))) continue;
    const recent = await rowById(ctx, recentId);
    if (recent === undefined || recent.trash) continue;
    const setting = DeckoName.parse(rec.name.parts[rec.name.parts.length - 1]);
    const items = rawItemStrings(recent.db_content ?? "").filter(
      (item) => item !== "" && DeckoName.parse(item).key !== setting.key,
    );
    const content = [setting.s, ...items].join("\n");
    if (content === (recent.db_content ?? "")) continue;
    const state = cardFieldStateFromRow(recent);
    await ctx.newWriter().updateCard({
      cardId: recentId,
      before: state,
      after: { ...state, db_content: content },
      history: false,
    });
    const recentName = DeckoName.parse(recent.name ?? "*recent settings");
    await refreshReferencesOut(ctx.fetch.driver, ctx.fetch.lexicon, recentId, recentName, content, { asList: true });
    await ctx.expire(recentId, recentName);
  }
}

class AssetRefreshState {
  idle = false;
  standardIds: number[] = [];
  collectOutputs = true;
  publicationFailed = false;
  readonly outputs = new Map<number, OutputterReferer & { content: string }>();
  readonly outputRows = new Map<number, CardsRow | undefined>();
  readonly referers = new Map<number, number[]>();
  private readonly rows = new Map<string, CardVirtualsRow | undefined>();
  private readonly pending = new Map<string, { row: CardVirtualsRow; existing: boolean; originalContent: string | null; key: string }>();
  constructor(private readonly ctx: StyleAssetEventContext) {}
  private pair(card: { leftId?: number; rightId?: number }): string { return `${card.leftId}:${card.rightId}`; }
  seed(ids: number[], right: number, rows: CardVirtualsRow[]): void {
    for (const id of ids) this.rows.set(`${id}:${right}`, undefined);
    for (const row of rows) this.rows.set(`${row.left_id}:${row.right_id}`, { ...row });
  }
  async read(card: ReturnType<typeof newCardRecord>): Promise<CardVirtualsRow | undefined> {
    const key = this.pair(card);
    if (!this.rows.has(key)) this.rows.set(key, await findVirtualByCard(this.ctx.fetch.driver, card));
    return this.rows.get(key);
  }
  async save(card: ReturnType<typeof newCardRecord>, now: Date): Promise<void> {
    const key = this.pair(card), previous = await this.read(card);
    let pending = this.pending.get(key);
    if (pending === undefined) {
      if (previous === undefined) validateVirtualCard(card);
      const row: CardVirtualsRow = previous === undefined
        ? { id: 0, left_id: card.leftId ?? null, right_id: card.rightId ?? null,
            left_key: card.name?.leftKey ?? null, content: card.dbContent ?? null, updated_at: sqlDateTime(now) }
        : { ...previous };
      pending = { row, existing: previous !== undefined, originalContent: previous?.content ?? null, key: card.key ?? "" };
      this.pending.set(key, pending);
    }
    pending.row.content = card.dbContent ?? null;
    pending.row.updated_at = sqlDateTime(now);
    this.rows.set(key, pending.row);
  }
  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pending) this.ctx.virtuals.delete(entry.key);
    const statements: SQLStatement[] = pending.map(({ row, existing, originalContent }) => {
      if (!existing) return { sql: "INSERT INTO card_virtuals (left_id, right_id, left_key, content, updated_at) VALUES (?, ?, ?, ?, ?)",
        params: [row.left_id, row.right_id, row.left_key, row.content, row.updated_at] };
      return row.content === originalContent
        ? { sql: "UPDATE card_virtuals SET updated_at = ? WHERE id = ?", params: [row.updated_at, row.id] }
        : { sql: "UPDATE card_virtuals SET content = ?, updated_at = ? WHERE id = ?", params: [row.content, row.updated_at, row.id] };
    });
    const results = await this.ctx.fetch.driver.batch(statements);
    for (let i = 0; i < pending.length; i++) {
      const entry = pending[i]!;
      if (!entry.existing) {
        const id = Number(results[i]?.lastInsertRowId);
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Asset refresh insert returned no virtual row id");
        entry.row.id = id;
      }
      this.ctx.virtuals.write(entry.key, entry.row);
    }
  }
}

async function prepareAssetRefresh(ctx: StyleAssetEventContext): Promise<AssetRefreshState | undefined> {
  const mod = await ctx.fetch.codenames.id("mod"), input = await ctx.fetch.codenames.id("asset_input");
  if (mod === undefined || input === undefined) return undefined;
  const state = new AssetRefreshState(ctx);
  const pending = (await ctx.fetch.driver.query<{ id: number; standard: number }>(`SELECT c.id, 1 AS standard
    FROM cards c JOIN cards l ON l.id=c.left_id JOIN cards r ON r.id=c.right_id
    LEFT JOIN card_virtuals v ON v.left_id=c.id AND v.right_id=?
    WHERE c.trash=0 AND l.type_id=? AND r.codename IN ('style','script')
      AND (v.id IS NULL OR v.updated_at IS NULL OR v.updated_at < ?)
    UNION SELECT c.id, 0 AS standard FROM cards c WHERE c.codename='style_mods' AND c.trash=0
      AND NOT EXISTS (SELECT 1 FROM card_virtuals v WHERE v.left_id=c.id AND v.right_id=?)
    ORDER BY id`, [input, mod, sqlDateTime(STYLE_SOURCES_MTIME), input])).rows;
  state.standardIds = pending.filter(row => Number(row.standard) === 1).map(row => Number(row.id));
  if (pending.length === 0) { state.idle = true; return state; }
  const sql = `SELECT c.* FROM cards c JOIN cards l ON l.id=c.left_id JOIN cards r ON r.id=c.right_id
    LEFT JOIN card_virtuals v ON v.left_id=c.id AND v.right_id=?
    WHERE c.trash=0 AND r.codename IN ('style','script') AND (l.codename='all' OR
      (l.type_id=? AND (v.id IS NULL OR v.updated_at IS NULL OR v.updated_at < ?)))
    UNION SELECT * FROM cards WHERE codename='style_mods' AND trash=0`;
  const rows = (await ctx.fetch.driver.query<CardsRow>(sql, [input, mod, sqlDateTime(STYLE_SOURCES_MTIME)])).rows;
  const idsSql = (ids: number[]): string => {
    if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid asset graph card id");
    return ids.length === 0 ? "NULL" : ids.join(",");
  };
  const known = new Set(rows.map(row => row.id));
  let frontier = [...known];
  while (frontier.length > 0) {
    const wave = idsSql(frontier), seen = idsSql([...known]);
    const next = (await ctx.fetch.driver.query<CardsRow>(`SELECT * FROM cards WHERE id NOT IN (${seen}) AND id IN (
      SELECT type_id FROM cards WHERE id IN (${wave})
      UNION SELECT left_id FROM cards WHERE id IN (${wave})
      UNION SELECT right_id FROM cards WHERE id IN (${wave})
      UNION SELECT referee_id FROM card_references WHERE referer_id IN (${wave})
      UNION SELECT r.referer_id FROM card_references r JOIN cards c ON c.id=r.referer_id
        JOIN cards t ON t.id=c.type_id LEFT JOIN cards s ON s.id=c.right_id
        WHERE r.referee_id IN (${wave}) AND c.trash=0 AND
          (t.codename IN ('bootswatch_skin','scss','css','skin','javascript','coffee_script')
           OR c.codename='style_mods' OR s.codename IN ('style','script'))
    )`, [])).rows;
    frontier = next.map(row => row.id);
    for (const row of next) { known.add(row.id); rows.push(row); }
  }
  for (const row of rows) ctx.fetch.lexicon.noteIdToLexRow(row);
  for (const row of rows) {
    const record = await composeCardRecord(row, ctx.fetch.lexicon);
    if (record.key !== undefined && ctx.fetch.peekStaleCard(record.key) === undefined) ctx.fetch.writeToCache(record);
  }
  const ids = rows.map(row => row.id);
  if (ids.length === 0) return state;
  const output = await ctx.fetch.codenames.id("asset_output");
  const result = await ctx.fetch.driver.batch([
    { sql: `SELECT * FROM card_virtuals WHERE right_id = ? AND left_id IN (${idsSql(ids)})`, params: [input] },
    { sql: `SELECT DISTINCT referee_id, referer_id FROM card_references WHERE referee_id IN (${idsSql(ids)}) ORDER BY referer_id`, params: [] },
    { sql: `SELECT * FROM cards WHERE right_id = ? AND left_id IN (${idsSql(ids)}) AND trash = 0`, params: [output ?? null] },
  ]);
  state.seed(ids, input, result[0]!.rows as CardVirtualsRow[]);
  for (const id of ids) state.outputRows.set(id, undefined);
  for (const row of result[2]!.rows as CardsRow[]) if (row.left_id !== null && state.outputRows.get(row.left_id) === undefined) state.outputRows.set(row.left_id, row);
  for (const id of ids) state.referers.set(id, []);
  for (const row of result[1]!.rows as { referee_id: number; referer_id: number }[]) state.referers.get(row.referee_id)!.push(row.referer_id);
  return state;
}
