import { str, type ViewResult, allRenderingErrorsRaise, quietRenderError, PERMS_NONE_VIEWS } from "./format.js";
import {applyMaterialIconsAssetConfiguration} from "./material-icons.js";
import { applyFontAwesomeAssetConfiguration, fontAwesomeHeadTag, STOCK_FONT_AWESOME_TAG } from "./font-awesome.js";

import type { CardRecord } from "../fetch/card-record.js";
import { DeckoName } from "../name.js";
import { findRule } from "../rules/lookup.js";
import { scanNests, referencedNames } from "./nest-syntax.js";
import type { WarmupMode, WarmupRef, WarmupScan } from "./prefetch.js";
import { RenderFormat } from "./format.js";
import { UnsupportedViewError } from "./format.js";
import type { RenderCard } from "./format.js";
import {
  cloudAttachmentUrl,
  faviconTagBytes,
  META_TAGS,
  pageTitleTagBytes,
  applyDeploymentCssRevision,
  stylesheetTagsBytes,
  type HeadReadSet,
} from "./head-views.js";
import { getDeploymentCloudAssetHost } from "./views.js";
import { deckoRootUrl } from "./deployment-follow-live-config.js";
import { scriptIntegrityFor } from "./deployment-follow-live-config.js";
import type { RenderEngine } from "../render.js";
import type { FetchEngine } from "../fetch.js";
import type { HistoryRenderParams } from "../history/render-seam.js";
import { h } from "./slot-html.js";
import { debugFlag } from "../debug-flags.js";

const CLOUD_URL_PREFIX = "http://s3.amazonaws.com//files/";

const OUTSIDE_LAYOUT_VIEWS: ReadonlySet<string> = new Set([
  "edit",
  "board",
  "new_in_modal",
  "modal",
  "rule_edit",
  "modal_rule",
  "modal_nest_rules",
  "debug_server_error",
]);

export class UnknownLayoutError extends Error {
  readonly layoutName: string;
  constructor(layoutName: string, key: string) {
    super(`unknown layout card: ${key}`);
    this.name = "UnknownLayoutError";
    this.layoutName = layoutName;
  }
}

interface PageLayout {
  layoutName: string;
  kind: "card" | "code-default" | "unknown";
  layoutCardContent?: string;
  mainViewRaw?: string;
  mainNestSyntax?: string;
  unknownKey?: string;
}

export async function renderPageBytes(
  engine: RenderEngine,
  cardName: string,
  requestedView?: string,
  historyParams?: HistoryRenderParams,
  bareMainOpts?: Record<string, unknown>,
): Promise<string> {
  DeckoName.beginRequestScope();
  try {
    await resolveIdMarksInRequestedName(engine, cardName);
    const releaseCaches =
      typeof engine.fetcher?.holdTemporaryCaches === "function" ? engine.fetcher.holdTemporaryCaches() : () => {};
    const render = () =>
      engine.runWithPageConfig(() =>
        renderPageBytesWithPageConfig(engine, cardName, requestedView, historyParams, bareMainOpts),
      );
    try {
      const body =
      typeof engine.renderWithUnknownCreateVerdicts === "function"
        ? await engine.renderWithUnknownCreateVerdicts(render)
        : await render();
      return applyMaterialIconsAssetConfiguration(applyFontAwesomeAssetConfiguration(str(body), engine.fontAwesomeAssetMode),engine.materialIconsAssetMode);
    } finally {
      engine.commitSessionRolesFill?.();
      releaseCaches();
    }
  } finally {
    DeckoName.endRequestScope();
  }
}

export async function renderPageWithStatus(
  engine: RenderEngine,
  cardName: string,
  requestedView?: string,
  historyParams?: HistoryRenderParams,
  bareMainOpts?: Record<string, unknown>,
): Promise<{ html: string; status: number }> {
  const html = await renderPageBytes(engine, cardName, requestedView, historyParams, bareMainOpts);
  if (historyParams?.contentOverride !== undefined) {
    engine.resetCaches();
  }
  return { html, status: engine.pageErrorStatus ?? 200 };
}

async function resolveIdMarksInRequestedName(engine: RenderEngine, cardName: string): Promise<void> {
  if (!cardName.includes("~")) return;
  const lexicon = engine.fetcher?.lexicon;
  if (lexicon === undefined || typeof lexicon.name !== "function") return;
  for (const m of cardName.matchAll(/~(\d+)/g)) await lexicon.name(Number(m[1]));
}

function preparePageView(engine: RenderEngine, name: string, view: string, params?: HistoryRenderParams): Promise<string> {
  return typeof engine.preparePageView === "function"
    ? engine.preparePageView(name, view, params)
    : engine.render(name, view, params);
}

async function isKnownVirtualCard(engine: RenderEngine, record: CardRecord): Promise<boolean> {
  if (await engine.virtualSetCard(record)) return true;
  if (record.name === undefined) return false;
  return (await engine.knownVirtualCardName?.(record.name)) === true;
}

async function renderPageBytesWithPageConfig(
  engine: RenderEngine,
  cardName: string,
  requestedView?: string,
  historyParams?: HistoryRenderParams,
  bareMainOpts?: Record<string, unknown>,
): Promise<string> {
  engine.beginPagePrepare();
  try {
    const idMark = /^~(\d+)$/.exec(cardName);
    if (idMark !== null) {
      const id = Number(idMark[1]);
      await engine.ensureFreshness();
      const identified = await engine.fetcher.fetchById(id, { skipVirtual: true });
      if (identified === undefined || identified.id !== id || identified.trash || identified.isNew) {
        const errors = engine.attachedErrorsByKey;
        const previous = errors.get("");
        const notFound = [{ attribute: "NotFound", message: "Card::Error::NotFound" }];
        errors.set("", notFound);
        try {
          const html = await renderPageBytesWithPageConfigInner(engine, "", "not_found", undefined, false, bareMainOpts);
          engine.pageErrorStatus = 404;
          return html;
        } finally {
          if (errors.get("") === notFound) {
            if (previous === undefined) errors.delete("");
            else errors.set("", previous);
          }
        }
      }
    }
    if (requestedView !== undefined && MODAL_WRAPPED_VIEWS.has(requestedView)) {
      return await renderOutsideOfLayout(engine, cardName, requestedView, historyParams);
    }
    return await renderPageBytesWithPageConfigInner(
      engine,
      cardName,
      requestedView,
      historyParams,
      false,
      bareMainOpts,
    );
  } finally {
    engine.endPagePrepare();
  }
}

const MODAL_WRAPPED_VIEWS: ReadonlySet<string> = new Set([
  "board",
  "edit",
  "new_in_modal",
  "modal",
  "modal_rule",
  "rule_edit",
  "modal_nest_rules",
  "debug_server_error",
]);

async function renderOutsideOfLayout(
  engine: RenderEngine,
  cardName: string,
  view: string,
  historyParams?: HistoryRenderParams,
): Promise<string> {
  const found = await engine.fetcher.fetchByName(cardName);
  const foundStructureKnown = found !== undefined && found.isNew === true
    ? await engine.fetcher.isKnownByStructure(cardName)
    : false;
  const absentFetch = found === undefined || (found.isNew === true && !foundStructureKnown);
  let record = absentFetch
    ? await engine.fetcher.fetchByName(cardName, { new: historyParams?.newCard ?? {} })
    : found;
  if (record !== undefined && record.id === undefined && cardName.includes("_")) {
    record = (await engine.fetcher.fetchByName(cardName.replace(/_/g, " "))) ?? record;
  }
  if (record === undefined || record.name === undefined) {
    throw new Error(`card not found: ${cardName}`);
  }
  const admittedAbsent = absentFetch && record.isNew === true;
  const body = await renderPageBytesWithPageConfigInner(
    engine,
    cardName,
    undefined,
    historyParams,
    true,
  );
  const status = engine.pageErrorStatus;
  try {
    await preparePageView(engine,
      record.name.s,
      view,
      admittedAbsent ? { ...(historyParams ?? {}), absentCard: true } : historyParams,
    );
  } catch {
  }
  const rootCard = engine.fetchRenderCard(record.name.s);
  if (rootCard === undefined) throw new Error(`render card not prepared: ${record.name.s}`);
  engine.pageErrorStatus = status;
  const modalFormat = new RenderFormat(rootCard, engine, { main: true, nestQuietErrors: true });
  modalFormat.seedRootIdCounter(engine.pageRootIdCounter);
  const layout = await resolvePageLayout(engine, record);
  const bodyView = layout.mainViewRaw ?? engine.defaultHtmlViewConfig();
  modalFormat.contentBody = bodyView === "titled" || bodyView === "labeled";
  const modal = modalFormat.renderView(view, { main: true, main_view: true }, null);
  return body.includes("</body>") ? body.replace("</body>", `${modal}</body>`) : body + modal;
}

async function renderPageBytesWithPageConfigInner(
  engine: RenderEngine,
  cardName: string,
  requestedView?: string,
  historyParams?: HistoryRenderParams,
  outsideOfLayout = false,
  bareMainOpts?: Record<string, unknown>,
): Promise<string> {
  const found = await engine.fetcher.fetchByName(cardName);
  const foundStructureKnown = found !== undefined && found.isNew === true
    ? await engine.fetcher.isKnownByStructure(cardName)
    : false;
  const absentFetch = found === undefined || (found.isNew === true && !foundStructureKnown);
  const record = absentFetch
    ? await engine.fetcher.fetchByName(cardName, { new: historyParams?.newCard ?? {} })
    : found;
  if (record === undefined || record.name === undefined) {
    throw new Error(`card not found: ${cardName}`);
  }
  const admittedAbsent = absentFetch && record.isNew === true;
  const layout = await resolvePageLayout(engine, record);

  if (
    requestedView !== undefined &&
    OUTSIDE_LAYOUT_VIEWS.has(requestedView) &&
    layout.layoutName.toLowerCase() !== "modal"
  ) {
    const body = await renderPageBytesWithPageConfigInner(engine, cardName, undefined, historyParams);
    await preparePageView(engine,
      record.name.s,
      requestedView,
      admittedAbsent ? { ...(historyParams ?? {}), absentCard: true } : historyParams,
    );
    const modalRoot = engine.fetchRenderCard(record.name.s);
    let modal = "";
    if (modalRoot !== undefined) {
      const modalFormat = new RenderFormat(modalRoot, engine, { main: true, nestQuietErrors: true });
      modalFormat.seedRootIdCounter(engine.pageRootIdCounter);
      modal = str(modalFormat.renderView(requestedView, { main: true, main_view: true }, null));
    }
    return body.includes("</body>") ? body.replace("</body>", () => `${modal}</body>`) : body + modal;
  }

  const recordIsNew = record.isNew === true;
  const mainView = requestedView ?? layout.mainViewRaw ?? engine.defaultHtmlViewConfig();

  let prepareError: Error | undefined;
  try {
    await preparePageView(engine,
      record.name.s,
      mainView,
      admittedAbsent ? { ...(historyParams ?? {}), absentCard: true } : historyParams,
    );
    engine.blankSessionRolesFill?.();
  } catch (error) {
    prepareError = error as Error;
  }
  if (engine.demandSeeds !== undefined && engine.demandSeeds.length > 0) {
    const seeded = await engine.warmupLayoutReferences(
      engine.demandSeeds.map((name) => ({ name, context: name, mode: "leaf" as const })),
      scanWarmDeps,
      () => ensureCodenameMarksResolvable(engine),
      true,
    );
    if (seeded.cards > 0) await engine.refreshVerdicts();
  }
  const rootCard = engine.fetchRenderCard(record.name.s);
  if (rootCard === undefined) {
    throw prepareError ?? new Error(`render card not prepared: ${record.name.s}`);
  }

  await engine.prepareSessionAccountLinks();
  const mainWarmup = await engine.warmupLayoutReferences(
    [{ name: record.name.s, context: record.name.s }],
    scanWarmDeps,
    () => ensureCodenameMarksResolvable(engine),
  );
  if (mainWarmup.cards > 0) {
    await engine.refreshVerdicts();
  }
  const mainBodySearches = await engine.prepareNestClosureSearches([
    { name: record.name.s, context: record.name.s },
  ]);
  if (mainBodySearches > 0) {
    await engine.refreshVerdicts();
  }
  await engine.ensurePermissionVerdicts();
  await engine.ensureDiscussionUpdateVerdicts();

  if (mainView === "configs" || engine.renderClosureNeedsCoreAdminRuntime()) {
    await engine.ensureCoreAdminRuntime();
  }

  await engine.applyLateSeatStructureContent();
  await engine.ensureConfigureVerdict();

  const rootFormat = new RenderFormat(rootCard, engine, {
    main: true,
    nestQuietErrors: true,
    showLayout: bareMainOpts === undefined,
  });
  const head = await headContent(engine, record.name, rootCard);
  engine.seatPageHead(rootCard.key, head);

  const skipSync = engine.skipSyncRender?.() === true;
  let mainBody: string;
  try {
    mainBody = skipSync ? "" : str(rootFormat.renderView(
      mainView,
      bareMainOpts !== undefined
        ? { ...bareMainOpts, view: mainView }
        : {
            nest_name: "_main",
            ...(layout.mainNestSyntax !== undefined ? { nest_syntax: layout.mainNestSyntax } : {}),
            main: true,
            home_view: mainView,
            ...(outsideOfLayout ? {} : { main_view: true }),
            layout: layout.layoutName,
          },
      null,
    ));
  } catch (error) {
    if (allRenderingErrorsRaise()) throw error;
    if (error instanceof UnsupportedViewError) throw error;
    mainBody = quietRenderError(error, rootCard, mainView, rootFormat);
  }
  rootFormat.rendered = str(mainBody);
  if (bareMainOpts !== undefined) return str(mainBody);

  if (layout.kind === "unknown") {
    throw new UnknownLayoutError(layout.layoutName, layout.unknownKey ?? "");
  }

  let layoutNestSeeds: WarmupRef[] = [];
  if (layout.kind === "card") {
    for (const piece of scanNests(layout.layoutCardContent ?? "")) {
      if (piece.kind === "nest" && piece.nest !== undefined && piece.nest.name !== "_main") {
        layoutNestSeeds.push({
          name: piece.nest.name,
          context: record.name.s,
          mode: nestWarmMode(piece.nest.options.view),
        });
      }
    }
    await ensureCodenameMarksResolvable(engine);
    await warmUpLayoutNests(engine, layoutNestSeeds);
    await ensureCodenameMarksResolvable(engine);
  }
  if (layoutNestSeeds.length > 0) {
    const layoutSearches = await engine.prepareNestClosureSearches(layoutNestSeeds);
    if (layoutSearches > 0) {
      await engine.refreshVerdicts();
    }
  }
  await engine.applyLateSeatStructureContent();
  await engine.ensureConfigureVerdict();
  await engine.prepareCardtypeGroupItems?.(undefined, undefined, layout.layoutCardContent);
  const interior = engine.skipSyncRender?.() === true
    ? ""
    : layout.kind === "card"
      ? rootFormat.processLayoutContent(layout.layoutCardContent ?? "")
      : codeDefaultLayoutInterior(rootFormat);
  engine.pageRootIdCounter = rootFormat.exportRootIdCounter();

  return (
    `      <!DOCTYPE HTML>\n` +
    `      <html class="h-100">\n` +
    `        <head>\n` +
    `          ${head}\n` +
    `        </head>\n` +
    `        ${resolveCloudUrls(interior)}\n` +
    `      </html>\n`
  );
}

async function warmUpLayoutNests(
  engine: RenderEngine,
  seeds: WarmupRef[],
): Promise<void> {
  await engine.warmupLayoutReferences(seeds, scanWarmDeps, () =>
    ensureCodenameMarksResolvable(engine),
  );
  await engine.refreshVerdicts();
}

function scanWarmDeps(
  card: {
    name: DeckoName;
    dbContent: string;
    typeCode: string | undefined;
  },
  mode: WarmupMode,
): WarmupScan {
  const byContent = DeckoName.requestMemo<Map<string, WarmupScan>>(SCAN_WARM_DEPS_MEMO);
  if (byContent === undefined) return scanWarmDepsUncached(card, mode);
  let memo = byContent.get(card.dbContent);
  if (memo === undefined) {
    memo = new Map();
    byContent.set(card.dbContent, memo);
  }
  const memoKey = `${mode}\n${card.typeCode ?? ""}\n${card.name.s}`;
  const hit = memo.get(memoKey);
  if (hit !== undefined) return hit;
  const found = scanWarmDepsUncached(card, mode);
  for (const r of found.refs) Object.freeze(r);
  for (const r of found.leaves ?? []) Object.freeze(r);
  Object.freeze(found.refs);
  if (found.leaves !== undefined) Object.freeze(found.leaves);
  memo.set(memoKey, Object.freeze(found));
  return found;
}

const SCAN_WARM_DEPS_MEMO = {};

function scanWarmDepsUncached(
  card: {
    name: DeckoName;
    dbContent: string;
    typeCode: string | undefined;
  },
  mode: WarmupMode,
): WarmupScan {
  const refs: WarmupRef[] = [];
  const leaves: WarmupRef[] = [];
  const context = card.name.s;
  const isItems = card.typeCode === "pointer" || card.typeCode === "list";
  const items = (): string[] =>
    (card.dbContent ?? "")
      .split(/\n+/)
      .map((s) => s.replace(/\[\[|\]\]/g, "").trim())
      .filter((s) => s !== "");
  if (!LINKS_ARE_LEAVES) mode = "full";

  if (mode === "nav-item") {
    if (isItems) for (const item of items()) leaves.push({ name: item, context });
    if (card.typeCode === "link_list") {
      for (const m of (card.dbContent ?? "").matchAll(/\[\[([^\][\n]+?)\]\]/g)) {
        const target = (m[1] ?? "").split("|")[0]?.trim() ?? "";
        if (target !== "" && !/^(\/|https?:|mailto:)/.test(target)) leaves.push({ name: target, context });
      }
    }
    return { refs, leaves };
  }

  for (const piece of scanNests(card.dbContent ?? "")) {
    const nest = piece.nest;
    if (nest === undefined || nest.comment !== undefined) continue;
    refs.push({ name: nest.name, context, mode: nestWarmMode(nest.options.view) });
  }
  for (const m of (card.dbContent ?? "").matchAll(/\[\[([^\][\n]+?)\]\]/g)) {
    const target = (m[1] ?? "").split("|")[0]?.trim() ?? "";
    if (target === "") continue;
    if (!LINKS_ARE_LEAVES) refs.push({ name: target, context });
    else if (mode === "navbar") refs.push({ name: target, context, mode: "nav-item" });
    else leaves.push({ name: target, context });
  }
  if (isItems) {
    for (const item of items()) {
      refs.push({ name: item, context, ...(mode === "navbar" ? { mode: "nav-item" as const } : {}) });
    }
  }
  return { refs, leaves };
}

function nestWarmMode(view: string | undefined): WarmupMode {
  if (!LINKS_ARE_LEAVES) return "full";
  if (view === "navbar_links") return "navbar";
  if (view === "nav_item") return "nav-item";
  return "full";
}

const LINKS_ARE_LEAVES = !debugFlag("DECKO_WARMUP_LINKS_SPINE");

async function ensureCodenameMarksResolvable(engine: RenderEngine): Promise<void> {
  const entries = engine.fetcher.codenames.peekEntries();
  if (entries.length === 0) return;
  const failedIds: number[] = [];
  for (const [codename, id] of entries) {
    try {
      DeckoName.parse(`:${codename}`);
    } catch {
      failedIds.push(id);
    }
  }
  if (failedIds.length > 0) {
    await engine.fetcher.warmLexicon(failedIds);
  }
}

async function resolvePageLayout(
  engine: RenderEngine,
  record: CardRecord,
): Promise<PageLayout> {
  const rule = await engine.ruleCardForSetting(
    {
      name: record.name,
      id: record.id,
      typeId: record.typeId,
      typeName:
        record.typeId !== undefined
          ? await engine.fetcher.codenames.nameForId(record.typeId)
          : undefined,
      ...(record.isNew === true ? { isNew: true } : {}),
    },
    "layout",
  );
  const layoutName =
    rule === undefined ? undefined : firstItemOfRuleContent(rule.dbContent);
  if (layoutName === undefined || layoutName === "") {
    return { layoutName: ":default", kind: "code-default" };
  }

  const layoutCard = await engine.fetcher.fetchByName(layoutName);
  const typeCode =
    layoutCard?.typeId === undefined
      ? undefined
      : await engine.fetcher.codenames.nameForId(layoutCard.typeId);
  if (
    layoutCard !== undefined &&
    layoutCard.name !== undefined &&
    (typeCode === "layout_type" || typeCode === "html" || typeCode === "basic")
  ) {
    const layoutCardContent = layoutCard.dbContent ?? "";
    const mainChunk = findMainNestChunk(layoutCardContent);
    if (mainChunk === undefined) {
      throw new Error(`no main nest found in layout "${layoutName}"`);
    }
    return {
      layoutName,
      kind: "card",
      layoutCardContent,
      mainViewRaw: mainChunk.options.view,
      mainNestSyntax: mainChunk.syntax,
    };
  }

  if (layoutName === "default") {
    return { layoutName: ":default", kind: "code-default" };
  }

  return { layoutName, kind: "unknown", unknownKey: DeckoName.parse(layoutName).key };
}

function firstItemOfRuleContent(content: string | null | undefined): string | undefined {
  if (content === null || content === undefined) return undefined;
  const trimmed = content.trim();
  if (trimmed === "") return undefined;
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0];
        const s = typeof first === "string" ? first : String(first ?? "");
        return s.trim() === "" ? undefined : s.trim();
      }
    } catch {
    }
  }
  const firstLine = trimmed.split(/\n+/)[0]?.trim() ?? "";
  return firstLine === "" ? undefined : firstLine;
}

function findMainNestChunk(
  content: string,
): { options: { view?: string; extra: Record<string, string> }; syntax: string } | undefined {
  for (const piece of scanNests(content)) {
    if (piece.kind === "nest" && piece.nest !== undefined && piece.nest.name === "_main") {
      return {
        options: { view: piece.nest.options.view, extra: piece.nest.options.extra },
        syntax: piece.nest.syntax,
      };
    }
  }
  return undefined;
}

function codeDefaultLayoutInterior(fmt: RenderFormat): string {
  const nest = (name: string, view: string): string =>
    fmt.nest({
      name,
      syntax: `${name}|${view}`,
      options: { view, extra: {} },
      comment: undefined,
    });
  return (
    `<body class="">\n` +
    `  <header>${nest(":header", "core")}</header>\n` +
    `  <article>${fmt.mainNest({ nest: {
      name: "_main",
      syntax: "_main",
      options: { extra: {} },
      comment: undefined,
    } })}</article>\n` +
    `  <aside>${nest(":sidebar", "core")}</aside>\n` +
    `  <footer>${nest(":footer", "content")}</footer>\n` +
    `</body>`
  );
}

export async function headContent(
  engine: RenderEngine,
  name: DeckoName,
  rootCard: RenderCard,
): Promise<string> {
  const read = await headReadSet(engine, "style");
  return [
    pageTitleTagBytes(read, name.s),
    (await noindex(engine, rootCard)) ? `${META_TAGS}\n<meta content='noindex' name='robots'>` : META_TAGS,
    "",
    faviconTagBytes(read),
    stylesheetTagsBytes(read),
    await universalEditButtonTag(engine, rootCard),
    await javascriptTags(engine),
    await scriptVariablesTag(engine),
    await scriptCallsTag(engine),
  ].join("\n");
}

async function noindex(engine: RenderEngine, rootCard: RenderCard): Promise<boolean> {
  if (rootCard.unknown === true) return true;
  const list = await globalSettingContent(engine, "noindex");
  if (list === undefined || list.trim() === "") return false;
  const key = rootCard.name.key;
  return list
    .split(/\n+/)
    .map((item) => item.replace(/^\s*\[\[|\]\]\s*$/g, "").trim())
    .some((item) => {
      try {
        return item !== "" && DeckoName.parse(item).key === key;
      } catch {
        return false;
      }
    });
}

export async function universalEditButtonTag(
  engine: RenderEngine,
  rootCard: RenderCard,
): Promise<string> {
  if (rootCard.id === undefined) return "";
  const updateOk = await engine.updateVerdictForCard?.(rootCard);
  if (updateOk === false) return "";
  return (
    `<link rel="alternate" type="application/x-wiki" title="Edit this page!" ` +
    `href="/${h(rootCard.name.urlKey)}/edit" />`
  );
}

async function headReadSet(engine: RenderEngine, styleSetting: string): Promise<HeadReadSet> {
  return {
    titleSetting: await globalSettingContent(engine, "title"),
    faviconSource: await globalSettingContent(engine, "favicon"),
    styleAssetOutput: await assetOutputContent(engine, styleSetting),
  };
}

async function assetOutputContent(
  engine: RenderEngine,
  settingCodename: string,
): Promise<string | undefined> {
  const rule = await engine.fetcher.fetchByName(`*all+*${settingCodename}`);
  if (rule?.name === undefined) return undefined;
  const output = await engine.fetcher.fetchByName(`${rule.name.s}+*asset output`);
  return output?.dbContent;
}

async function globalSettingContent(
  engine: { fetcher: FetchEngine },
  codename: string,
): Promise<string | undefined> {
  if ((await engine.fetcher.codenames.id(codename)) === undefined) {
    return undefined;
  }
  const card = await engine.fetcher.fetchByName(`:${codename}`);
  const content = card?.dbContent;
  return content === undefined || content === null ? undefined : content;
}

export async function homeMarkContent(engine: { fetcher: FetchEngine }): Promise<string> {
  const content = await globalSettingContent(engine, "home");
  return content !== undefined && content.trim() !== "" ? content : "Home";
}

async function javascriptTags(engine: RenderEngine): Promise<string> {
  const scriptUrl = await assetOutputUrl(engine, "script");
  return [
    applyScriptIntegrity(REMOTE_SCRIPT_TAGS.replace(STOCK_FONT_AWESOME_TAG, fontAwesomeHeadTag(engine.fontAwesomeAssetMode))),
    `<!-- MAIN DECKO JAVASCRIPT -->`,
    `<script src="${scriptUrl}"></script>`,
  ].join("\n");
}

async function assetOutputUrl(engine: RenderEngine, settingCodename: string): Promise<string> {
  return cloudAttachmentUrl(await assetOutputContent(engine, settingCodename)) ?? "";
}

async function scriptVariablesTag(engine: RenderEngine): Promise<string> {
  const cssPath = applyDeploymentCssRevision(await assetOutputUrl(engine, "style"));
  const signedIn = engine.pageSession?.signedIn === true;
  const rootUrl = deckoRootUrl() ?? `${engine.envOriginConfig()}/`;
  return (
    `<script>\n//<![CDATA[\n` +
    `decko.rootUrl='${rootUrl}';\n` +
    `decko.doubleClick='signed_in';\n` +
    `decko.cssPath='${cssPath}';\n` +
    `decko.signed_in=${signedIn};\n` +
    `\n//]]>\n</script>`
  );
}

async function scriptCallsTag(engine: RenderEngine): Promise<string> {
  const ace = (await globalSettingContent(engine, "ace")) ?? "";
  const tinymce = (await globalSettingContent(engine, "tiny_mce")) ?? "";
  const configs = [
    `decko.setAceConfig('${escapeJavascript(ace)}')`,
    `decko.setTinyMCEConfig('${escapeJavascript(tinymce)}')`,
    `$('document').ready(function() { $('.card-slot').trigger('decko.slot.ready'); })`,
  ].join("\n\n");
  return `<script>\n//<![CDATA[\n${configs}\n//]]>\n</script>`;
}

function escapeJavascript(js: string): string {
  return js
    .replace(/\\/g, "\\\\")
    .replace(/<\//g, "<\\/")
    .replace(/\r\n/g, "\\n")
    .replace(/\r/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
}

const REMOTE_SCRIPT_TAGS = [
  `<!-- mod: format (remote) -->`,
  `<script src="https://code.jquery.com/jquery-3.5.1.min.js" crossorigin="anonymous"></script>`,
  `<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-ujs/1.2.3/rails.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`,
  `<!-- mod: ace editor (remote) -->`,
  `<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.18.0/ace.min.js" crossorigin="anonymous"></script>`,
  `<!-- mod: bootstrap (remote) -->`,
  `<script src="https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.6-rc.1/js/select2.full.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`,
  `<script src="https://kit.fontawesome.com/1366963381.js" crossorigin="anonymous"></script>`,
].join("\n");

export function applyScriptIntegrity(tags: string): string {
  return tags.replace(
    /<script src="([^"]+)"([^>]*)><\/script>/g,
    (tag: string, src: string, attrs: string) => {
      const integrity = scriptIntegrityFor(src);
      if (integrity === undefined) return tag;
      const referrer = attrs.indexOf(" referrerpolicy=");
      const at = referrer === -1 ? attrs.length : referrer;
      return `<script src="${src}"${attrs.slice(0, at)} integrity="${integrity}"${attrs.slice(at)}></script>`;
    },
  );
}

function resolveCloudUrls(html: string): string {
  const deployment = getDeploymentCloudAssetHost();
  const prefix = deployment !== undefined
    ? `${deployment}/files/`
    : CLOUD_URL_PREFIX;
  return html.replace(
    /\([^()\s]+\)\/(\d+\/[^\s"'<>)]+\.[A-Za-z0-9]+)/g,
    `${prefix}$1`,
  );
}
