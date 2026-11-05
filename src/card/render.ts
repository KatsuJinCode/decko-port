import {readPermissionEditorOptions} from "./mod-loader/mods/card-mod-permissions.js";
import {junctionChainQuery} from "./render/junction-chain-query.js";
import {
  isCompoundRow,
  rowsMatchingPointIdentity,
  readCompositionBatch,
  waveJunctionStatement,
  waveKeysStatement,
} from "./render/wave-read-statements.js";
import type {PermissionEditorOptions} from "./render/format.js";

import { DeckoName } from "./name.js";
import { jsonShowResult } from "./render/json-show.js";
import { negotiatedFormatName } from "./render/format-negotiation.js";
import { getNameEnvironment, setNameEnvironment } from "./name/environment.js";
import { findAssignedTypeName } from "./set-patterns/set-type-assignment.js";
import { CodenameNotFoundError, NameNotFoundError } from "./name/errors.js";
import { FetchEngine, type NewCardOptions } from "./fetch.js";
import {
  invalidateSeatedPagePayloads,
  oneTripWantsPayload,
  seatOneTripPayloadForRender,
  type OneTripSeatResult,
} from "./one-trip/render-gate.js";
import { cardContent, composeCardRecord, type CardRecord } from "./fetch/card-record.js";
import { executeCount, executeQuery, type CqlQueryResult } from "../cql/execute.js";
import { parseCql } from "../cql/parser.js";
import { composeCqlResultName } from "../cql/result-name.js";
import { resolvePointerItemName, rawItemStrings } from "./render/pointer-list.js";
import { listItemContentOverride } from "./render/content-overrides.js";
import { isKnownVirtualCard } from "./render/virtual-card-registry.js";
import { findRule } from "./rules/lookup.js";
import { ruleCacheStatement, ruleIdLookup, type RuleCacheRow } from "./rules/rule-cache.js";
import { ruleLookupKeysForCard } from "./set-patterns/card-patterns.js";
import { ruleCacheKeyFromRow, settingCardNameForCode } from "./set-patterns/rule-names.js";
import { ruleNamesForCard } from "./set-patterns/rule-names.js";
import { resolveVirtualCardStructure } from "./fetch/virtual-cards.js";
import { virtualSearchCqlFor } from "./fetch/virtual-search-cards.js";
import { virtualSearchKnownName } from "./render/format.js";
import { statementAfterFirstQuery } from "../cql/consumed-conjunctions.js";
import {
  structureRuleUniverseStatement,
  structureUniverseFromResults,
  resolveStructuredContent,
  templateReferenceNames,
  defaultRuleUniverseStatement,
  structureRuleTypesFromResults,
  templateTypeNameStatement,
  templateTypeNamesFromResults,
  DEFAULT_SETTING_NAME,
  STRUCTURE_SETTING_NAME,
} from "./rules/structure.js";
import type { CardsRow } from "../server/schema.js";
import { CqlBadQuery } from "../cql/ast.js";
import { PermissionDeniedError } from "./auth/token.js";
import {
  RenderFormat,
  RUBY_MAX_DEPTH,
  cardPath,
  str,
  UnsupportedViewError,
  type RenderCard,
  type RenderEngineLike,
  type RequestTermSeat,
  type SearchBoxCompleteSeat,
  type ImageCompleteSeat,
  type ViewFn,
  type ViewResult,
} from "./render/format.js";
import { renderPageBytes, headContent, UnknownLayoutError } from "./render/page.js";
import { deckDefaultHtmlView, envOriginForSurface, pageDefaultHtmlView } from "./render/deck-origin.js";
import { deploymentDefaultHtmlViewNest } from "./render/deployment-follow-live-config.js";
import {
  enabledRolesDropdownHtml,
  myCardDropdownInnerHtml,
  rolesAccountDropdownHtml,
  signedInAccountLinksInnerHtml,
  type SessionRolesInput,
} from "./render/navbar-views.js";
import {
  HTML_VIEWS,
  SETTING_GROUPS,
  isTemplatedNestsName,
  templateLinkSetNameFromParts,
  baseTableEntry,
  baseTableSnapshot,
  flatViewRefused,
  visibleSettingCodenames,
  visibleSettingsForGroup,
} from "./render/views.js";
import { RULE_TYPE_CODENAMES_FOR_PRELOAD, RULE_TYPE_IDS_FOR_PRELOAD } from "./render/virtual-rule-card.js";
import { headViewReadStatement } from "./render/head-views.js";
import {
  bootBundleForVersion,
  bootCacheIsWarm,
  readBootContentVersion,
  storeBootBundle,
  type BootBundle,
} from "./render/boot-cache.js";
import type { SearchResultPaging } from "./render/search-paging.js";
import {
  ModLoader,
  getDefaultModLoader,
  htmlLineage,
  modGeneration,
} from "./mod-loader.js";
import { modEngineHost } from "./mod-loader/mod-engine-host.js";
import { bindModuleAdminHost } from "./mod-loader/mods/core-mod.js";
import { prepareAdminRuntime } from "./mod-loader/mods/core-admin-runtime.js";
import {
  badQuery,
  dateError,
  emptyQueryError,
  isValidDateContent,
  BAD_QUERY_CLASS_NAME,
} from "./render/errors.js";
import {
  composeAndCacheSqlRows,
  prefetchInclusionClosure,
  prefetchWarmupClosure,
  type PrefetchContext,
  type PrefetchStats,
  type WarmupCard,
  type WarmupRef,
  type WarmupScan,
  type WarmupMode,
  type WarmupStats,
} from "./render/prefetch.js";
import { readCardRowsByIdChunked } from "../server/chunked-row-reads.js";
import { CARDTYPE_GROUPS } from "./render/cardtype-groups.js";
import type {
  HistoryActionRow,
  HistoryActRow,
  HistoryChangeRow,
} from "./mod-loader/mods/card-mod-history.js";
import {
  actionPreviousValue,
  actionValue,
  historyActs,
  historyCardIds,
  historyActions,
  actionHashList,
  lastAction,
  lastAct,
  recentActs,
  updaterOf,
} from "./mod-loader/mods/card-mod-history.js";
import { trackedFieldByIndex } from "./history/change.js";

const HISTORY_SEAM_VIEWS = new Set([
  "history",
  "act",
  "action_summary",
  "action_expanded",
  "last_action_verb",
  "conflict",
  "history_tab",
  "board_act",
  "act_legend",
  "last_action",
  "change",
  "subedit_notice",
  "list_of_changes",
  "content_changes",
]);
import type {
  HistoryActionCardInfo,
  HistoryRenderParams,
  HistoryRenderReader,
} from "./history/render-seam.js";

const UPDATER_SEAM_VIEWS = new Set(["box", "box_bottom", "updated_by"]);

const FORM_VIEW_PATTERN = /edit|board|bridge|form|overlay|modal/;

const RULE_WARM_VIEWS = new Set(["edit_rules"]);
const PERMISSION_EDITOR_VIEWS = new Set([
  "input", "editor", "content_editor", "content_formgroup", "edit", "edit_in_form",
  "edit_in_modal", "rule_form_card_editor", "rule_edit", "rule_form", "overlay_rule",
  "modal_rule", "nest_rules", "modal_nest_rules", "quick_edit_setting_list",
  "quick_edit", "edit_rules",
]);
import type { UpdaterCardInfo, UpdaterRenderReader } from "./history/updater-seam.js";
import {
  FOLLOW_SEAM_VIEWS,
  followSeamRootNeeded,
  isFollowingJunction,
  prepareFollowRender,
  type FollowRenderBundle,
} from "./follow/follow-render-seam.js";
import { safeSetKeys } from "./render/set-keys.js";
import { isVirtualSetCardName } from "./set-modules/virtual-set-modules.js";
import { referencedNames, scanNests } from "./render/nest-syntax.js";
import type { PatternCardInput } from "./set-patterns/types.js";
import { PATTERN_TABLE } from "./set-patterns/registry.js";
import type { PhantomItemType, SettingClassWithRules } from "./render/format.js";
import {
  readPermissionStatements,
  readPermissionStateFromViewerResults,
  PERMISSION_GATE_COUNT_STATEMENT_INDEX,
  canReadByStoredRule,
  canReadByRuleLookup,
  ruleClosureWalkStatement,
  primeRuleClosureUniverse,
  actorKeyFromResults,
  ANONYMOUS_VIEWER,
  anonymousIdFromResults,
  type ReadViewer,
  type ReadPermissionState,
} from "./permissions/index.js";
import {
  nameHasReadOverride,
  readPermissionOverride,
  updatePermissionOverride,
} from "./permissions/read-override.js";
import {
  allTaskVerdictsForCard,
  taskVerdictForCard,
  signupApprovalAllowed,
  viewTaskPermissionStatements,
  viewTaskStateFromResults,
  type ViewTaskState,
  type WriteTask,
} from "./permissions/view-task-rules.js";
import { viewRequiresTask, type CrudTask } from "./permissions/view-perms.js";
import { installHelpRules, type HelpRulesApi } from "./render/help-popover.js";
import { setPrototypeTypeCode } from "./render/views.js";
import {
} from "./render/views.js";
import type { SQLQueryResult, SQLStatement } from "../server/driver.js";
import type { Lex } from "./fetch/lexicon.js";
import type { TokenRuntimeConfig } from "./auth/token.js";

export { UnsupportedViewError };
export { UnknownLayoutError };
export {
  BadQueryError,
  badQuery,
  emptyQueryError,
  BAD_QUERY_CLASS_NAME,
  DateError,
  dateError,
  DATE_ERROR_CLASS_NAME,
  isValidDateContent,
} from "./render/errors.js";
export type { RenderCard, PrefetchStats };
export { HTML_VIEWS };
const BOARD_ACCOUNT_PILL_TRAITS = ["*account", "*roles", "*follow", "*created", "*edited"] as const;

export const DECK_DATA_VERSION_STATEMENT =
  'SELECT "version" FROM "deck_data_version" WHERE "id" = 1';
export type { SettingClassWithRules } from "./render/format.js";

type ColdBatchSlot = SQLStatement | { readonly cachedResult: SQLQueryResult };

function isCachedColdSlot(slot: ColdBatchSlot): slot is { readonly cachedResult: SQLQueryResult } {
  return "cachedResult" in slot;
}

const SEARCH_TYPE_CODE = "search_type";

const SKIN_PARENT_TRAIT_CODENAME = "parent";

const CREATEABLE_TYPES_VIEWS = new Set([
  "edit_type",
  "edit_type_form",
  "type_formgroup",
  "board_type_formgroup",
  "new",
  "new_in_modal",
  "new_fields",
  "new_type_formgroup",
  "simple_new",
  "rule_edit",
  "rule_form",
  "overlay_rule",
  "modal_rule",
  "nest_rules",
  "modal_nest_rules",
  "quick_edit_setting_list",
  "quick_edit",
  "edit_rules",
  "grouped_list",
]);
const SET_TYPE_CODE = "set";
const CARDTYPE_TYPE_CODE = "cardtype";
const PERMISSION_RIGHT_CODENAMES: ReadonlySet<string> = new Set([
  "read",
  "create",
  "update",
  "delete",
]);
const DATE_TYPE_CODE = "date";

const PARSE_DISPATCH_VIEWS = new Set(["open", "content"]);

function searchCqlLimit(statement: Record<string, unknown>): number | undefined {
  const raw = statement["limit"];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw))) {
    return Number(raw);
  }
  return undefined;
}

const SETTING_CLASSES = PATTERN_TABLE;

function collectLinkTargetNames(content: string, out: string[]): void {
  for (const match of content.matchAll(/\[\[([^\][\n]+?)\]\]/g)) {
    const target = (match[1] ?? "").split("|")[0]?.trim() ?? "";
    if (target === "" || /^(\/|https?:|mailto:)/.test(target)) continue;
    out.push(target);
  }
}

const CORE_REACHING_VIEWS: ReadonlySet<string> = new Set([
  "core",
  "content",
  "open_content",
  "labeled_content",
  "titled_content",
  "titled",
  "open",
  "labeled",
  "closed",
]);

interface RuleCacheEntry {
  ruleId: number;
  patternCode: string;
  settingCode: string;
  anchorName: string | undefined;
}

export class RenderEngine implements RenderEngineLike {
  readonly fetcher: FetchEngine;
  readonly views: Record<string, ViewFn>;
  modLoader?: ModLoader;

  compressAssets?: () => boolean;
  scriptCompressor?: (js: string) => string;

  private renderCards = new Map<string, RenderCard>();

  private renderSeats = new Set<string>();

  private pagePrepareDepth = 0;

  pageErrorStatus: number | undefined = undefined;
  pageRootIdCounter?: number;

  pageLoudDenialTaskPhrase: string | undefined = undefined;

  attachedErrorsByKey = new Map<string, Array<{ attribute: string; message: string }>>();

  private ownedNewCardErrorEntries = new Map<string, Array<{ attribute: string; message: string }>>();

  beginPagePrepare(): void {
    this.pagePrepareDepth += 1;
    if (this.pagePrepareDepth === 1) this.pageErrorStatus = undefined;
    this.renderSeats.clear();
    if (this.sweepAllHeldCards) for (const key of this.renderCards.keys()) this.renderSeats.add(key);
  }

  endPagePrepare(): void {
    this.pagePrepareDepth = Math.max(0, this.pagePrepareDepth - 1);
  }

  private syncNewCardTypeError(
    record: CardRecord,
    buildingNewCard: boolean,
    newCard: NewCardOptions | undefined,
  ): void {
    const key = record.key ?? record.name?.key;
    if (key === undefined) return;
    const requested =
      newCard?.typeId !== undefined
        ? undefined
        : newCard?.typeCode !== undefined
          ? newCard.typeCode
          : newCard?.typeName;
    const unresolved = buildingNewCard && requested !== undefined && record.typeId === undefined;
    if (!unresolved) {
      this.releaseOwnedNewCardError(key);
      return;
    }
    const attached = this.attachedErrorsByKey.get(key);
    if (attached !== undefined && attached !== this.ownedNewCardErrorEntries.get(key)) return;
    const entries: Array<{ attribute: string; message: string }> = [
      { attribute: "type", message: `${String(requested)} is not a known type.` },
    ];
    this.attachedErrorsByKey.set(key, entries);
    this.ownedNewCardErrorEntries.set(key, entries);
  }

  private releaseOwnedNewCardError(key: string): void {
    const owned = this.ownedNewCardErrorEntries.get(key);
    if (owned === undefined) return;
    if (this.attachedErrorsByKey.get(key) === owned) this.attachedErrorsByKey.delete(key);
    this.ownedNewCardErrorEntries.delete(key);
  }

  private customizedNameBySkinKey = new Map<
    string,
    { name: string; asked: readonly string[] }
  >();

  private boardPillKnownByKey = new Map<string, boolean>();

  expireRenderCard(name: string): void {
    const key = DeckoName.parse(name ?? "").key;
    if (key !== "") {
      this.renderCards.delete(key);
      this.warmupScannedKeys.delete(key);
      this.structureProcessed.delete(key);
    }
    for (const [skinKey, answer] of [...this.customizedNameBySkinKey]) {
      if (answer.name === name || answer.asked.includes(name)) {
        this.customizedNameBySkinKey.delete(skinKey);
      }
    }
  }
  private viewDispatchCache = new Map<string, ViewFn | undefined>();
  private idsByKey = new Map<string, number>();
  private searchResults = new Map<string, RenderCard[]>();
  private searchFailures = new Map<string, Error>();
  private searchResultPagingMap = new Map<string, SearchResultPaging>();
  private searchResultCounts = new Map<string, number>();
  private searchCountResults = new Map<string, number>();
  private optionsCardCache = new Map<string, RenderCard | undefined>();
  private setHostChainCache = new Map<string, string | undefined>();
  private readPermission: ReadPermissionState | undefined;
  private readViewer: ReadViewer | undefined;
  private readViewerKey: string | undefined;
  private readViewerKeyResolved = false;
  private deniedVerdicts = new Map<number, boolean>();
  private deniedVerdictsByKey = new Map<string, boolean>();
  viewer: ReadViewer = ANONYMOUS_VIEWER;
  pageSession: ReadViewer | undefined;
  renderAbsentCards = false;
  private sessionAccountLinks: string | undefined;
  private sessionAccountLinksActorId: number | undefined;
  private sessionMyCardHtml: string | undefined;
  private sessionMyCardHtmlFilled: string | undefined;
  private sessionRolesDropdownHtml: string | undefined;
  private sessionAccountLinksFilledHtml: string | undefined;
  private sessionRolesContentFilled = false;
  private sessionRolesFillConsumedThisPass = false;
  private sessionAccountLinksHasRoles = false;

  private historyReader: HistoryRenderReader | undefined;
  private historyExport: { key: string; view: string; rows: Record<string, unknown>[] } | undefined;

  private renderSearch: {
    vars?: Record<string, string>;
    offset?: number;
    term?: string;
    main?: string;
  } | undefined;

  private searchBoxCompleteData: SearchBoxCompleteSeat | undefined;
  private imageCompleteData: ImageCompleteSeat | undefined;

  private requestTermData: RequestTermSeat | undefined;

  private renderSearchFocalKey: string | undefined;

  requestNewCard: NewCardOptions | undefined;
  requestEditorParams: Readonly<Record<string, string>> | undefined;

  private updaterReader: UpdaterRenderReader | undefined;

  private followBundle: FollowRenderBundle | undefined;

  private readonly renderedHistoryDiffMemo = new Map<number, import("./history/content-diff.js").ContentDiff>();
  private preparationHistoryDiffMemo: Map<number, import("./history/content-diff.js").ContentDiff> | undefined;
  get historyDiffMemo(): Map<number, import("./history/content-diff.js").ContentDiff> {
    return this.preparationHistoryDiffMemo ?? this.renderedHistoryDiffMemo;
  }

  async preparePageView(cardName: string, view: string, params?: HistoryRenderParams): Promise<string> {
    const previous = this.preparationHistoryDiffMemo;
    this.preparationHistoryDiffMemo = new Map();
    try {
      return await this.render(cardName, view, params);
    } finally {
      this.preparationHistoryDiffMemo = previous;
    }
  }
  imageCdnHost: string | undefined;
  fontAwesomeAssetMode?: "local";
  materialIconsAssetMode?: "local";
  phantomItemType: PhantomItemType | undefined;
  tokenConfig: TokenRuntimeConfig | undefined;
  fileStorage: "local" | "web" | "cloud" | "coded" | undefined = undefined;
  private ruleTypeIds:
    | { setting: number | undefined; set: number | undefined; user: number | undefined }
    | undefined;
  private setKeysPendingRuleTypes = new Set<string>();
  private existingRuleCards: Map<string, RenderCard> | undefined;
  private setRulePreloadDoneIds: Set<number> | undefined;
  private structureContents: Map<string, string | null> | undefined;
  private structureRuleTypes: Map<string, number> | undefined;
  private structureProcessed = new Set<string>();
  private structureRefMisses = new Set<string>();
  private defaultRuleTypes: Map<string, number> | undefined;
  private defaultRuleContents: Map<string, string | null> | undefined;
  private defaultTypeNameById: Map<number, string> | undefined;
  private taskState: ViewTaskState | undefined;
  private permissionEditorState: PermissionEditorOptions = {roles: []};
  permissionEditorOptions(): PermissionEditorOptions { return this.permissionEditorState; }

  private createableTypesCache: string[] | undefined;
  private taskVerdicts = new Map<string, Record<WriteTask, boolean | undefined>>();
  private unknownCreateMisses = new Map<string, RenderCard>();
  private unknownCreateRenderDepth = 0;
  private configureVerdicts = new Map<string, boolean | undefined>();
  private configureChecked = new Set<string>();
  private itemTypeNameByHostKey = new Map<
    string,
    { typeName: string; typeId: number } | undefined
  >();
  private pointerItemVerdicts = new Map<
    string,
    { read: boolean; create: boolean | undefined }
  >();
  private pointerItemGlobalVerdictDone = new Set<string>();
  private pageConfigActive = false;
  helpRules?: HelpRulesApi;
  private helpResolver: ReturnType<typeof installHelpRules> | undefined;
  private lastPrefetch: PrefetchStats | undefined;
  private linkScanDoneKeys: Set<string> | undefined;
  private coreAdminRuntimeEnsured = false;
  private deckDataVersion: number | undefined;

  constructor(fetcher: FetchEngine) {
    this.fetcher = fetcher;
    this.views = baseTableSnapshot();
    this.modLoader = getDefaultModLoader();
  }

  get lastRenderStats(): PrefetchStats | undefined {
    return this.lastPrefetch;
  }

  async render(cardName: string, view: string, params: HistoryRenderParams = {}): Promise<string> {
    const raw = await this.renderRaw(cardName, view, params);
    if (params.format === "json") {
      return jsonShowResult(raw, params.requestUrl ?? `${this.envOriginConfig()}${cardPath(DeckoName.parse(cardName).urlKey)}`, params.compress);
    }
    return str(raw);
  }

  async renderRaw(cardName: string, view: string, params: HistoryRenderParams = {}): Promise<ViewResult> {
    if (params.assignedType !== undefined) this.resetCaches();
    const releaseCaches =
      typeof this.fetcher?.holdTemporaryCaches === "function" ? this.fetcher.holdTemporaryCaches() : () => {};
    DeckoName.beginRequestScope();
    try {
      return await this.renderWithUnknownCreateVerdicts(() => this.renderHeld(cardName, view, params));
    } finally {
      if (params.assignedType !== undefined) this.resetCaches();
      if (params.contentOverride !== undefined && this.pagePrepareDepth === 0) {
        this.resetCaches();
      }
      DeckoName.endRequestScope();
      releaseCaches();
    }
  }

  private async renderHeld(cardName: string, view: string, params: HistoryRenderParams): Promise<ViewResult> {
    if (this.pagePrepareDepth === 0) this.pageErrorStatus = undefined;
    const suggestionLabelsOnly = this.liveRequest && params.format === "json" && view === "search_box_complete";
    if (this.pagePrepareDepth === 0) this.renderSeats.clear();
    await this.prepareSessionAccountLinks();
    await this.ensureRuleCacheSetLabels();
    let seat: OneTripSeatResult | undefined;
    const runSeat = async (): Promise<OneTripSeatResult | undefined> =>
      !this.liveRequest && oneTripWantsPayload()
        ? await seatOneTripPayloadForRender(cardName, this.fetcher, {
            lastSeenVersion: this.deckDataVersion,
            onStampMove: async (observed) => {
              this.resetCaches();
              this.fetcher.replayRouter.disarmRenderPlan();
              invalidateSeatedPagePayloads(this.fetcher);
              await this.fetcher.reprimeBootState();
              this.deckDataVersion = observed;
            },
          })
        : undefined;
    seat = await runSeat();
    if (this.deckDataVersion !== undefined) {
      const observed = seat?.deckDataVersion ?? (await this.readDeckDataVersion());
      if (observed !== this.deckDataVersion) {
        this.resetCaches();
        this.fetcher.replayRouter.disarmRenderPlan();
        invalidateSeatedPagePayloads(this.fetcher);
        await this.fetcher.reprimeBootState();
        this.deckDataVersion = observed;
        seat = await runSeat();
      }
    } else if (typeof seat?.deckDataVersion === "number") {
      this.deckDataVersion = seat.deckDataVersion;
    }
    const bootProbe =
      !this.bootProbeIssued && bootCacheIsWarm(this.fetcher.driver)
        ? seat?.deckDataVersion !== undefined
          ? Promise.resolve(seat.deckDataVersion)
          : readBootContentVersion(this.fetcher.driver)
        : undefined;
    this.bootProbeIssued = true;
    const [found] = await Promise.all([this.fetcher.fetchByName(cardName), bootProbe]);
    if (bootProbe !== undefined) this.bootProbeVersion = await bootProbe;
    const absentOk = this.renderAbsentCards || params.absentCard === true;
    const foundStructureKnown = found !== undefined && found.isNew === true
      ? await this.fetcher.isKnownByStructure(cardName)
      : false;
    const seatedAbsentOk = absentOk && !foundStructureKnown;
    const buildingNewCard = (found === undefined || (found.isNew === true && !foundStructureKnown)) && seatedAbsentOk;
    let record = buildingNewCard
      ? await this.fetcher.fetchByName(cardName, { new: params.newCard ?? {} })
      : found;
    if (record === undefined || record.name === undefined) {
      throw new Error(`card not found: ${cardName}`);
    }
    const name = record.name;
    this.syncNewCardTypeError(record, buildingNewCard, params.newCard);
    if (params.assignedType !== undefined && !record.isNew) {
      const type = await this.fetcher.fetchByName(params.assignedType);
      if (type?.id === undefined) throw new Error(`card type not found: ${params.assignedType}`);
      record = { ...record, typeId: type.id };
    }
    if (params.contentOverride !== undefined) {
      record = { ...record, dbContent: params.contentOverride };
    }
    if (record.isNew === true && seatedAbsentOk) this.renderCards.delete(name.key);
    this.historyReader = undefined;
    this.historyExport = undefined;
    this.updaterReader = undefined;
    this.searchBoxCompleteData = undefined;
    this.imageCompleteData = undefined;
    this.requestTermData = undefined;
    this.requestNewCard = params.newCard;
    this.requestEditorParams = params.editorParams;
    this.renderSearch = params.search;
    this.renderSearchFocalKey = name.key;
    this.sessionRolesFillConsumedThisPass = false;

    const permissionCold = this.readPermission === undefined;
    const seatGateRows = permissionCold ? seat?.permissionGateRows : undefined;
    const permissionStatements = permissionCold ? readPermissionStatements(this.viewer) : [];
    const permissionSlots: ColdBatchSlot[] = permissionStatements.map((stmt, i) =>
      i === PERMISSION_GATE_COUNT_STATEMENT_INDEX && seatGateRows !== undefined
        ? { cachedResult: seatGateRows }
        : (stmt as ColdBatchSlot),
    );
    const ruleTypesCold = this.ruleTypeIds === undefined;
    const structureCold = this.structureContents === undefined;
    const headReadsCold = !this.headReadsWarmed;
    const stampCold = this.deckDataVersion === undefined;
    const ruleWalkCold = ruleClosureWalkStatement(this.fetcher.driver);
    let foldedResults: SQLQueryResult[] | undefined;
    if (!this.closureWarm(record)) {
      const bootHit =
        this.bootProbeVersion === undefined
          ? undefined
          : bootBundleForVersion(this.fetcher.driver, this.bootProbeVersion);
      const coldSlots: ColdBatchSlot[] = [
        ...permissionSlots,
        ...(ruleTypesCold
          ? bootHit !== undefined
            ? [{ cachedResult: bootHit.codehash }]
            : [this.fetcher.codenames.codehashStatement()]
          : []),
        ...(structureCold
          ? [structureRuleUniverseStatement(), defaultRuleUniverseStatement()]
          : []),
        ...(structureCold
          ? bootHit !== undefined
            ? [{ cachedResult: bootHit.typeNames }]
            : [templateTypeNameStatement()]
          : []),
        ...(headReadsCold
          ? bootHit !== undefined
            ? [{ cachedResult: bootHit.headReads }]
            : [headViewReadStatement()]
          : []),
        ...(stampCold
          ? [{ sql: DECK_DATA_VERSION_STATEMENT, params: [] as unknown[] }]
          : []),
        ...(ruleWalkCold !== undefined ? [ruleWalkCold] : []),
      ];
      const coldStatements = coldSlots.filter(
        (slot): slot is SQLStatement => !isCachedColdSlot(slot),
      );
      const stats = await prefetchInclusionClosure(record, {
        driver: this.fetcher.driver,
        lexicon: this.fetcher.lexicon,
        writeToCache: (cached) => {
          const transientRoot =
            (params.assignedType !== undefined || params.contentOverride !== undefined) &&
            cached.key === record.key;
          if (!transientRoot) this.fetcher.writeToCache(cached);
        },
        cacheRecord: (cached) =>
          (cached.id === -1 && record.id === undefined && cached.key === record.key) ||
          ((params.assignedType !== undefined || params.contentOverride !== undefined) &&
            cached.key === record.key)
            ? this.enrichAndStore(record).then(() => undefined)
            : this.cacheFetchedRecord(cached),
        ...(coldStatements.length > 0 ? { additionalStatements: coldStatements } : {}),
        ...(this.skipRootClosureWalk && record.key === this.skipRootClosureKey ? { skipClosureWalk: true } : {}),
      });
      this.lastPrefetch = stats;
      {
        const executed = stats.additionalResults;
        let cursor = 0;
        foldedResults = coldSlots.map((slot) =>
          isCachedColdSlot(slot) ? slot.cachedResult : (executed as SQLQueryResult[])[cursor++],
        );
      }
      if (ruleWalkCold !== undefined) {
        primeRuleClosureUniverse(this.fetcher.driver, foldedResults[coldSlots.length - 1]!);
      }
      if (ruleTypesCold) await this.parseRuleTypeIds(foldedResults, permissionStatements.length);
      this.parseStructureContents(
        foldedResults,
        permissionStatements.length + (ruleTypesCold ? 1 : 0),
      );
      if (structureCold && this.defaultTypeNameById === undefined) {
        const nameIndex =
          permissionStatements.length +
          (ruleTypesCold ? 1 : 0) +
          2;
        this.defaultTypeNameById = templateTypeNamesFromResults(
          foldedResults?.[nameIndex],
        );
      }
      if (headReadsCold) {
        const headIndex =
          permissionStatements.length +
          (ruleTypesCold ? 1 : 0) +
          (structureCold ? 3 : 0);
        await this.cacheHeadViewReads(foldedResults?.[headIndex]);
        this.headReadsWarmed = true;
      }
      if (stampCold) {
        this.parseDeckDataVersion(
          foldedResults,
          permissionStatements.length +
            (ruleTypesCold ? 1 : 0) +
            (structureCold ? 3 : 0) +
            (headReadsCold ? 1 : 0),
        );
      }
      if (bootHit === undefined && ruleTypesCold && structureCold && headReadsCold) {
        storeBootBundle(this.bootBundleFrom(foldedResults, {
          codehashIndex: permissionStatements.length,
          typeNamesIndex: permissionStatements.length + (ruleTypesCold ? 1 : 0) + 2,
          headReadsIndex:
            permissionStatements.length + (ruleTypesCold ? 1 : 0) + (structureCold ? 3 : 0),
        }));
      }
      await this.enrichAndStore(record);
      this.bootProbeVersion = undefined;
    }
    if (ruleTypesCold || this.setKeysPendingRuleTypes.size > 0) {
      if (this.ruleTypeIds === undefined) {
        await this.parseRuleTypeIds(undefined, 0);
      }
      for (const pendingKey of this.setKeysPendingRuleTypes) {
        const card = this.renderCards.get(pendingKey);
        if (card === undefined || !card.name.isCompound) continue;
        const input = this.structurePatternInputForSync(card);
        let isRule = input.isRule === true;
        if (!isRule && !this.rulePartsInMap(card)) {
          const leftKey = card.name.leftName?.key;
          const leftRecord =
            leftKey !== undefined ? this.renderCards.get(leftKey)?.record : undefined;
          isRule = (await this.computeIsRule(card.name, leftRecord)) === true;
        }
        card.setKeys = safeSetKeys({
          name: card.name,
          typeId: input.typeId ?? undefined,
          typeName: typeof input.typeName === "string" ? input.typeName : undefined,
          leftTypeName:
            typeof input.leftTypeName === "string" ? input.leftTypeName : undefined,
          isRule,
        });
      }
      this.setKeysPendingRuleTypes.clear();
    }
    if (stampCold && this.deckDataVersion === undefined) {
      this.deckDataVersion = await this.readDeckDataVersion();
    }
    if (structureCold && this.structureContents === undefined) {
      await this.parseStructureContents(undefined, 0);
    }
    if (permissionCold) await this.ensureReadPermission(foldedResults, seatGateRows);
    for (const key of this.closureSurface(record)) this.renderSeats.add(key);
    await this.applyStructureContent();
    await this.preloadDefaultTypeNames();
    await this.seatUnknownRefReadVerdicts();
    await this.seatBlankKeyReadVerdict();
    await this.ensureVerdicts();
    this.populateTypeCodes();
    await this.prepareSearches(record);
    await this.applyStructureContent();
    await this.seatUnknownRefReadVerdicts();
    await this.seatBlankKeyReadVerdict();
    this.populateTypeCodes();
    await this.ensureTaskVerdicts(view);
    await this.ensureDiscussionUpdateVerdicts({ cardName, view });
    const permissionEditorRoot = this.renderCards.get(name.key);
    const permissionRight = permissionEditorRoot?.name.isCompound
      ? DeckoName.parse(permissionEditorRoot.name.tag).codename : undefined;
    const ruleContainer = view.includes("rule") || view === "quick_edit";
    if (PERMISSION_EDITOR_VIEWS.has(view) &&
        (ruleContainer || (permissionRight !== undefined && PERMISSION_RIGHT_CODENAMES.has(permissionRight)))) {
      this.permissionEditorState = await readPermissionEditorOptions(modEngineHost(this, this.fetcher));
    }
    if (CREATEABLE_TYPES_VIEWS.has(view) || params.assignedType !== undefined) {
      await this.ensureCreateableTypes();
      if (view === "new" || view === "new_in_modal" || view === "simple_new" || view === "new_fields") {
        await this.prepareCurrentTypeCreatable(record.key !== undefined ? this.renderCards.get(record.key) : undefined);
      }
    }
    await this.prepareCardtypeGroupItems(name, view);
    await this.ensureConfigureVerdict(record, view);
    await this.seatUnknownNestCreateVerdicts(record);
    await this.primePreparedCardDerivedState(record.key, suggestionLabelsOnly);
    {
      const rendered = this.fetchRenderCard(name.s);
      if (name.s.endsWith("+*asset output")) {
        const left = name.leftName;
        if (left !== undefined) await this.prepareItemForRender(left.s);
      } else if (
        rendered?.setKeys.includes("TYPE_PLUS_RIGHT-set-Xstyle") === true ||
        rendered?.setKeys.includes("TYPE_PLUS_RIGHT-set-Xscript") === true
      ) {
        await this.prepareItemForRender(`${name.s}+*asset output`);
      }
    }
    if (record.typeId !== undefined && this.peekCodenameById?.(record.typeId) === "mod") {
      await this.prepareItemForRender(`${name.s}+*style`);
      await this.prepareItemForRender(`${name.s}+*script`);
    }
    if (record.typeId !== undefined && this.peekCodenameById?.(record.typeId) === "bootswatch_skin") {
      await this.prepareItemForRender(`${name.s}+Image`);
      await this.prepareItemForRender(`${name.s}+parent`);
      await this.prepareItemForRender(`${name.s}+*colors`);
      await this.prepareItemForRender(`${name.s}+*variables`);
      await this.prepareItemForRender(`${name.s}+*stylesheets`);
      await this.prepareItemForRender("*all+*style");
      await this.warmCustomizedName(name);
      await this.warmSkinParentPointer(name);
      await this.warmCustomizedName(name);
    }
    if (record.typeId !== undefined && this.peekCodenameById?.(record.typeId) === "user") {
      await this.prepareItemForRender(`${name.s}+*account`);
      for (const accountChild of ["+*email", "+*password", "+*salt", "+*status"]) {
        await this.prepareItemForRender(`${name.s}+*account${accountChild}`);
      }
    }
    {
      const renderedCard = this.fetchRenderCard(name.s);
      if (renderedCard !== undefined) {
        if (renderedCard.typeCode === "setting") {
          await this.prepareItemForRender(`*all+${name.s}`);
          await this.prepareItemForRender("*all");
          if (renderedCard.id !== undefined) {
            const results = await this.fetcher.driver.batch([
              {
                sql: "SELECT id FROM cards WHERE right_id = ? AND left_id IS NOT NULL AND trash = 0",
                params: [renderedCard.id],
              },
            ]);
            for (const row of (results[0]?.rows ?? []) as Array<{ id: number }>) {
              const rec = await this.fetcher.fetchById(Number(row.id));
              if (rec === undefined || rec.name === undefined) continue;
              await this.enrichAndStore(rec);
            }
          }
        }
        if (renderedCard.name.isCompound) {
          const leftName = renderedCard.name.leftName;
          const rightName = renderedCard.name.rightName;
          if (leftName !== undefined && rightName !== undefined) {
            const right = this.fetchRenderCard(rightName.key);
            const rightCodename = right?.record.codename;
            if (rightCodename === "style" || rightCodename === "script") {
              const left = this.fetchRenderCard(leftName.key);
              if (left === undefined || left.typeCode !== "mod") {
                await this.prepareItemForRender(leftName.s);
              }
            }
          }
        }
      }
    }
    if (view === "edit_structure") {
      for (const candidate of ruleNamesForCard(
        { name: name.s, id: record.id, typeId: record.typeId, isNew: record.isNew === true },
        "*structure",
      )) {
        await this.prepareItemForRender(candidate);
      }
    }
    await this.warmNestedSkinImages();
    if (this.helpResolver === undefined && !(this.liveRequest && params.format === "json" && view === "search_box_complete")) {
      this.helpResolver = installHelpRules(this, this.fetcher);
      await this.helpResolver.prepare();
      await this.ensureVerdicts();
    }

    const preparedRoot = this.renderCards.get(name.key);
    if (preparedRoot === undefined) {
      throw new Error(`render card not prepared: ${name.s}`);
    }
    const rootCard =
      record.isNew === true && preparedRoot.id === undefined && seatedAbsentOk
        ? await this.seatAbsentRoot(preparedRoot)
        : preparedRoot;
    const deniedRootSkip = this.skipDeniedRootWalks && this.isDenied(rootCard);
    if (!deniedRootSkip) await this.enrichPointerListItemsClosure();
    const pointerEditorView = view === "edit" || view === "new" || view === "new_fields" || view === "new_in_modal" || view === "simple_new";
    if (pointerEditorView && view !== "edit" && rootCard.name.s === "") {
      const autoname = await this.ruleCardForSetting(this.structurePatternInputForSync(rootCard), "autoname");
      if (autoname !== undefined && autoname.name !== undefined) await this.enrichAndStore(autoname);
    }
    if (pointerEditorView) {
      if (view !== "edit") {
        const thanks = await this.ruleCardForSetting(this.structurePatternInputForSync(rootCard), "thanks");
        if (thanks !== undefined && thanks.name !== undefined) await this.enrichAndStore(thanks);
      }
      if (rootCard.typeCode === "pointer" || rootCard.typeCode === "list") {
        const inputRule = await this.ruleCardForSetting(this.structurePatternInputForSync(rootCard), "input_type");
        if (inputRule !== undefined && inputRule.name !== undefined) await this.enrichAndStore(inputRule);
      }
      await this.ensurePointerEditorOptions(rootCard);
    }
    if (view === "search_box_complete" || view === "complete") {
      await this.prepareSearchBoxComplete(rootCard);
    }
    if (view === "name_complete" || view === "name_match") {
      await this.prepareRequestTerm(rootCard, view);
    }
    if (view === "image_complete") await this.prepareImageComplete(rootCard);
    if (view === "board" || view === "cardboard") {
      await this.prepareItemForRender(`${rootCard.name.s}+*account`);
    }
    if (view === "account_tab") {
      await this.warmBoardPillExistence(rootCard);
    }
    if (view === "content_formgroups" || view === "new" || view === "core" || view === "new_buttons") {
      await this.warmSignupAccountFields(rootCard);
    }
    if (rootCard.id !== undefined && rootCard.name.isCompound && !rootCard.unknown) {
      await this.seatJunctionFieldRows(rootCard);
      await this.ensureVerdicts();
    }
    if (rootCard.id === undefined && rootCard.unknown) {
      const structure = this.structureRuleForSync({
        name: name.s,
        id: record.id,
        typeId: record.typeId,
        typeName: rootCard.typeName ?? (record.typeId !== undefined ? this.peekNameForId(record.typeId) : undefined),
        isNew: true,
      });
      if (structure !== undefined && structure.content.includes("{{")) {
        const seen = new Set<string>([name.key]);
        let warmed = false;
        for (const piece of scanNests(structure.content)) {
          if (piece.kind !== "nest" || piece.nest === undefined) continue;
          if (piece.nest.comment !== undefined) continue;
          const target = DeckoName.parse(piece.nest.name).absoluteName(name);
          if (seen.has(target.key)) continue;
          seen.add(target.key);
          if (this.fetchRenderCard(target.key) !== undefined) continue;
          const leftTypeName =
            rootCard.typeName ?? (record.typeId !== undefined ? this.peekNameForId(record.typeId) : undefined);
          const seated = await (async (): Promise<RenderCard | undefined> => {
            const found = await this.fetcher.fetchByName(target.s).catch(() => undefined);
            if (found !== undefined && found.id !== undefined) return undefined;
            const defaulted = await this.newCardDefaultType(target, leftTypeName);
            const absent = await this.fetcher.fetchByName(target.s, {
              new: defaulted !== undefined ? { typeId: defaulted.typeId } : {},
            });
            if (absent === undefined) return undefined;
            return this.seatAbsentRoot({
              name: target,
              key: target.key,
              typeId: absent.typeId ?? defaulted?.typeId,
              typeName: defaulted?.typeName,
              record: absent,
              unknown: true,
            } as RenderCard);
          })();
          if (seated === undefined) continue;
          for (const candidate of ruleNamesForCard(
            {
              name: target.s,
              id: undefined,
              typeId: undefined,
              typeName: undefined,
              leftTypeName,
              isNew: true,
            },
            "*default",
          )) {
            const ruleKey = DeckoName.parse(candidate).key;
            const ruleRow = this.fetcher.driver
              .query<{ id: number; type_id: number; db_content: string | null }>(
                "SELECT c.id, c.type_id, c.db_content FROM cards c WHERE c.key = ? AND c.trash = 0",
                [ruleKey],
              )
              .then((r) => (r.rows as Array<{ id: number; type_id: number; db_content: string | null }>)[0])
              .catch(() => undefined);
            const row = (await ruleRow) as
              | { id: number; type_id: number; db_content: string | null }
              | undefined;
            if (row === undefined) continue;
            const updated = this.fetchRenderCard(target.key);
            if (updated === undefined) break;
            const withTemplate: RenderCard = {
              ...updated,
              typeId: row.type_id,
              typeName: this.peekNameForId(row.type_id),
              typeCode: this.peekCodenameById?.(row.type_id),
              dbContent: row.db_content ?? "",
              record: { ...updated.record, typeId: row.type_id, dbContent: row.db_content ?? "" },
            };
            this.renderCards.set(target.key, withTemplate);
            break;
          }
          warmed = true;
        }
        if (warmed) await this.ensureVerdicts();
      }
    }
    await this.warmNestedSkinImages();
    if (rootCard.typeCode === "signup" || rootCard.typeCode === "user") {
      const accountTrait = this.fetcher.codenames.peekName("account") ?? "*account";
      await this.prepareItemForRender(accountTrait);
      const accountName = `${rootCard.name.s}+${accountTrait}`;
      await this.prepareItemForRender(accountName);
      for (const code of ["email", "password"]) {
        const trait = this.fetcher.codenames.peekName(code) ?? `*${code}`;
        await this.prepareItemForRender(trait);
        await this.prepareItemForRender(`${accountName}+${trait}`);
      }
    }
    if (rootCard.typeCode === "signup") {
      await this.prepareItemForRender("Anonymous");
      await this.prepareItemForRender(`${rootCard.name.s}+*account`);
      await this.prepareItemForRender(`${rootCard.name.s}+*account+*email`);
      await this.prepareItemForRender(`${rootCard.name.s}+*account+*status`);
      await this.prepareSignupApprovalVerdicts(rootCard);
      await this.ensureVerdicts();
    }
    await this.enrichNestTypeOptTargets();
    if (!deniedRootSkip) await this.enrichTemplateLinkSetJunctions();
    await this.ensureVerdicts();
    if (view === "smart_label") {
      await this.prepareItemForRender(`${name.s}+description`);
      await this.ensureVerdicts();
    }
    if (rootCard.typeCode === "set") {
      await this.preloadSetRules(rootCard);
      if (!deniedRootSkip) await this.enrichPointerListItemsClosure();
      await this.ensureVerdicts();
    }
    if (await this.preloadNestedSetRuleLists(rootCard)) {
      await this.enrichPointerListItemsClosure();
      await this.ensureVerdicts();
    }
    if (!deniedRootSkip) await this.enrichLinkTargetsForKnownClass(rootCard);
    if (
      view === "open" &&
      (rootCard.typeCode === "pointer" || rootCard.typeCode === "list") &&
      rootCard.unknown !== true &&
      !this.isDenied(rootCard) &&
      !this.isPermissionRightHost(rootCard)
    ) {
      const failContent = await this.itemOptionsParseFailure(rootCard, new Set([rootCard.key]));
      if (failContent !== undefined) {
        throw failContent === "" ? emptyQueryError() : badQuery(failContent);
      }
    }
    if (
      (view === "open" || view === "content") &&
      rootCard.typeCode === "set" &&
      rootCard.unknown !== true &&
      !this.isDenied(rootCard) &&
      !this.isPermissionRightHost(rootCard)
    ) {
      const failContent = await this.setHostOptionsParseFailure(rootCard);
      if (failContent !== undefined) {
        throw failContent === "" ? emptyQueryError() : badQuery(failContent);
      }
    }
    const format = new RenderFormat(rootCard, this, {
      ...(params.focalRoot !== undefined ? { focal: params.focalRoot } : {}),
      maxDepth: RUBY_MAX_DEPTH,
      nestQuietErrors: true,
      ...(params.format !== undefined
        ? { formatName: params.format }
        : negotiatedFormatName(params.accept)),
      isViewLaneRoot: true,
    });
    if (
      this.pageHeadBytesFor(rootCard.key) === undefined &&
      format.contentNestsHeadCore() &&
      CORE_REACHING_VIEWS.has(view)
    ) {
      this.seatPageHead(rootCard.key, await headContent(this, name, rootCard));
    }
    if (params.format === "json" && (view === "history" || view === "actions") && !this.isDenied(rootCard)) {
      const ids = rootCard.id === undefined ? [] : view === "history"
        ? await historyCardIds(this.fetcher.driver, rootCard.id) : [rootCard.id];
      const rows = await historyActions(this.fetcher.driver, ids);
      const selected = view === "actions" ? rows.filter(action => action.draft !== 1) : rows;
      this.historyExport = { key: rootCard.key, view, rows: await actionHashList(this.fetcher.driver, selected) };
    } else if (HISTORY_SEAM_VIEWS.has(view)) {
      this.historyReader = await this.prepareHistoryRender(rootCard, params);
    }
    if (
      CORE_REACHING_VIEWS.has(view) &&
      rootCard.setKeys.split(" ").includes("SELF-Xrecent")
    ) {
      this.historyReader = await this.prepareHistoryRender(rootCard, params, "recent");
    }
    if (UPDATER_SEAM_VIEWS.has(view)) {
      this.updaterReader = await this.prepareUpdaterRender(rootCard);
    }
    this.followBundle = undefined;
    if (RULE_WARM_VIEWS.has(view)) {
      const setCard = await this.fetcher.fetchByName(
        `${rootCard.name.s}+*self`,
      );
      if (setCard !== undefined) await this.cacheFetchedRecord(setCard);
    }
    if (FOLLOW_SEAM_VIEWS.has(view) || followSeamRootNeeded(rootCard)) {
      this.followBundle = await prepareFollowRender(
        this.fetcher,
        this.pageSession,
        rootCard,
        view,
      );
      if (view === "follow_section" || view === "engage_tab") {
        const session = this.followBundle.session;
        if (session !== undefined) {
          const userFollow = await this.fetcher.fetchByName(
            `${session.actorName}+*follow`,
          );
          if (userFollow !== undefined) await this.cacheFetchedRecord(userFollow);
        }
        const followersJunction = await this.fetcher.fetchByName(
          `${rootCard.name.s}+*followers`,
        );
        if (followersJunction !== undefined) {
          await this.cacheFetchedRecord(followersJunction);
        }
      }
      if (this.followBundle.followerNames.length > 0) {
        for (const followerName of this.followBundle.followerNames) {
          const follower = await this.fetcher.fetchByName(followerName);
          if (follower !== undefined) await this.cacheFetchedRecord(follower);
        }
      }
      if (isFollowingJunction(rootCard)) {
        const leftName = rootCard.name.leftName?.s;
        if (leftName !== undefined) {
          const left = await this.fetcher.fetchByName(leftName);
          if (left !== undefined) await this.cacheFetchedRecord(left);
          const leftFollowers = await this.fetcher.fetchByName(
            `${leftName}+*followers`,
          );
          if (leftFollowers !== undefined) await this.cacheFetchedRecord(leftFollowers);
        }
      }
      for (const row of [
        ...this.followBundle.followTabRows,
        ...this.followBundle.ignoreTabRows,
      ]) {
        const rowKey = DeckoName.parse(row.ruleCardName).key;
        if (this.renderCards.has(rowKey)) continue;
        const ruleCard = await this.fetcher.fetchByName(row.ruleCardName);
        if (ruleCard !== undefined) await this.cacheFetchedRecord(ruleCard);
      }
      if (view === "rule_editor" || isFollowingJunction(rootCard)) {
        for (const warmName of [
          this.followBundle.ruleEditorPreferenceName,
          this.followBundle.ruleEditorTargetName,
        ]) {
          if (warmName === undefined) continue;
          const warmed = await this.fetcher.fetchByName(warmName);
          if (warmed !== undefined) await this.cacheFetchedRecord(warmed);
        }
      }
    }
    if (
      this.pagePrepareDepth === 0 &&
      (view === "configs" || this.renderClosureNeedsCoreAdminRuntime())
    ) {
      await this.ensureCoreAdminRuntime();
    }
    await this.applyLateSeatStructureContent();
    if (FORM_VIEW_PATTERN.test(view)) await this.seatLastActionIds();
    if (
      this.historyReader === undefined &&
      this.skipSyncRender?.() !== true &&
      this.renderClosureNestsRecentCard()
    ) {
      const recentRecord = await this.fetcher.fetchByName("*recent");
      if (recentRecord !== undefined) {
        const recentCard = await this.enrichAndStore(recentRecord);
        this.historyReader = await this.prepareHistoryRender(recentCard, params, "recent");
      }
    }
    return this.skipSyncRender?.() === true
      ? ""
      : format.renderView(view, params.viewOpts ?? {}, "show", true);
  }

  async renderPage(cardName: string): Promise<string> {
    return renderPageBytes(this, cardName);
  }

  resolveView(
    card: RenderCard,
    view: string,
    format: string = "html",
  ): ViewFn | undefined {
    if (card.typeCode === SEARCH_TYPE_CODE && PARSE_DISPATCH_VIEWS.has(view)) {
      const failed = this.searchFailures.get(this.searchCacheKey(card));
      if (failed !== undefined && !this.computeIsRuleSync(card)) throw failed;
    }
    if (card.typeCode === DATE_TYPE_CODE && view === "core") {
      if (!isValidDateContent(card.dbContent)) throw dateError();
    }
    const key = `${format}|${card.key}|${view}|g${modGeneration()}`;
    const unsaved = card.id === undefined;
    const cached = unsaved ? undefined : this.viewDispatchCache.get(key);
    if (cached !== undefined) return cached;
    const resolved = this.computeResolvedView(card, view, format);
    if (resolved !== undefined && !unsaved) this.viewDispatchCache.set(key, resolved);
    return resolved;
  }

  viewUnknownSettingForCard(card: RenderCard, view: string, format = "html"): true | string | false | undefined {
    const loader = this.modLoader;
    if (loader === undefined) return undefined;
    return loader.viewUnknownSettingForCard(card.setKeys, view, format);
  }

  viewPermissionSettingForCard(card: RenderCard, view: string, format: string): import("./permissions/view-perms.js").ViewPermissionDirective | undefined {
    return this.modLoader?.viewSettingForCard(card.setKeys, view, "perms", format);
  }

  viewDenialSettingForCard(card: RenderCard, view: string, format: string): string | undefined {
    return this.modLoader?.viewSettingForCard(card.setKeys, view, "denial", format);
  }

  resolveFormatMethod(card: RenderCard, method: string, format: string): import("./mod-loader/mod-manifest.js").ModFormatMethodFn | undefined {
    return this.modLoader?.formatMethodForCard(card.setKeys, method, format);
  }

  modDeckBound(): boolean {
    return this.modLoader !== undefined;
  }

  private computeResolvedView(
    card: RenderCard,
    view: string,
    format: string,
  ): ViewFn | undefined {
    const loader = this.modLoader;
    if (loader !== undefined) {
      const chain = loader.viewChain(card.setKeys, view, format);
      if (chain.length > 0) {
        const entry = chain[0];
        if (entry !== undefined) return entry.viewFn;
      }
    }
    if (flatViewRefused(view, card.setKeys)) return undefined;
    if (format !== "html" && !htmlLineage(format) && format !== "email_text") {
      return loader !== undefined ? undefined : this.ownViewEntry(view);
    }
    return loader !== undefined ? baseTableEntry(view) : this.ownViewEntry(view);
  }

  private ownViewEntry(view: string): ViewFn | undefined {
    return Object.hasOwn(this.views, view) ? this.views[view] : undefined;
  }

  private async readDeckDataVersion(): Promise<number> {
    const result = await this.fetcher.driver.query<{ version: number }>(
      DECK_DATA_VERSION_STATEMENT,
      [],
    );
    const version = result.rows[0]?.version;
    if (typeof version !== "number") {
      throw new Error(
        "deck_data_version unreadable: the freshness stamp table/row is missing — " +
          "apply the stamp schema (db/schema.sqlite.sql [ENGINE-FRESHNESS] block, or " +
          "deploy/migrations/0003-deck-data-version-stamp.sql for provisioned databases) " +
          "before rendering",
      );
    }
    return version;
  }

  private parseDeckDataVersion(
    folded: SQLQueryResult[] | undefined,
    index: number,
  ): void {
    const result = folded?.[index];
    const version = (
      result?.rows[0] as { version?: unknown } | undefined
    )?.version;
    if (typeof version !== "number") {
      throw new Error(
        "deck_data_version unreadable: the freshness stamp table/row is missing — " +
          "apply the stamp schema (db/schema.sqlite.sql [ENGINE-FRESHNESS] block, or " +
          "deploy/migrations/0003-deck-data-version-stamp.sql for provisioned databases) " +
          "before rendering",
      );
    }
    this.deckDataVersion = version;
  }

  expireRuleCache(): void {
    this.ruleCacheSetLabels = undefined;
    this.ruleCacheSetLabelsLoad = undefined;
    this.ruleCacheAddressable = true;
    this.structureContents = undefined;
    this.structureRuleTypes = undefined;
    this.structureProcessed.clear();
    this.structureRefMisses.clear();
    this.defaultRuleTypes = undefined;
    this.defaultRuleContents = undefined;
    this.defaultTypeNameById = undefined;
  }

  resetCaches(): void {
    this.fetcher.resetCaches();
    this.renderedHistoryDiffMemo.clear();
    this.preparationHistoryDiffMemo?.clear();
    this.renderCards.clear();
    this.idsByKey.clear();
    this.expireRuleCache();
    this.attachedErrorsByKey.clear();
    this.ownedNewCardErrorEntries.clear();
    this.resetDerivedRenderState();
  }

  clearProvisionalState(level = 2): void {
    if (level >= 3) {
      this.fetcher.resetCaches();
      this.fetcher.lexicon.forgetDurableRecords();
    }
    else this.fetcher.purgeNegatives();
    if (level < 2) {
      this.structureRefMisses.clear();
      this.waveAskedSimpleKeys = undefined;
      this.wavePrimedKeys = undefined;
      this.waveAskedPairs = undefined;
      this.waveAskedSideKeyPairs.clear();
      this.warmupScannedKeys.clear();
      this.primeAskedIds = undefined;
      return;
    }
    for (const [key, card] of this.renderCards) {
      if (level >= 4 || card.id === undefined) this.renderCards.delete(key);
    }
    if (level >= 4) this.idsByKey.clear();
    this.resetDerivedRenderState();
  }

  sweepAllHeldCards = false;

  private resetDerivedRenderState(): void {
    this.renderSeats.clear();
    this.sessionAccountLinks = undefined;
    this.sessionAccountLinksActorId = undefined;
    this.sessionMyCardHtml = undefined;
    this.sessionRolesDropdownHtml = undefined;
    this.searchResults.clear();
    this.searchFailures.clear();
    this.searchResultPagingMap.clear();
    this.searchCountResults.clear();
    this.searchResultCounts.clear();
    this.pageHeadBytes.clear();
    this.optionsCardCache.clear();
    this.setHostChainCache.clear();
    this.viewDispatchCache.clear();
    this.readPermission = undefined;
    this.deniedVerdicts.clear();
    this.deniedVerdictsByKey.clear();
    this.coreAdminRuntimeEnsured = false;
    this.existingRuleCards = undefined;
    this.setRulePreloadDoneIds = undefined;
    this.ruleTypeIds = undefined;
    this.setKeysPendingRuleTypes.clear();
    this.structureContents = undefined;
    this.structureRuleTypes = undefined;
    this.structureProcessed.clear();
    this.structureRefMisses.clear();
    this.defaultRuleTypes = undefined;
    this.defaultRuleContents = undefined;
    this.defaultTypeNameById = undefined;
    this.taskState = undefined;
    this.taskVerdicts.clear();
    this.signupApprovalVerdicts.clear();
    this.currentTypeCreatableVerdicts.clear();
    this.createableTypesCache = undefined;
    this.configureVerdicts.clear();
    this.configureChecked.clear();
    this.itemTypeNameByHostKey.clear();
    this.pointerItemVerdicts.clear();
    this.pointerItemGlobalVerdictDone.clear();
    this.warmupScannedKeys.clear();
    this.customizedNameBySkinKey.clear();
    this.linkScanDoneKeys = undefined;
    this.helpRules = undefined;
    this.helpResolver = undefined;
    this.lastPrefetch = undefined;
    this.headReadsWarmed = false;
    this.pointerListHostsDone.clear();
    this.accountFieldWarmDone.clear();
    this.nestTypeOptTargetsDone.clear();
    this.templateLinkJunctionTargetsDone.clear();
    this.waveAskedSimpleKeys = undefined;
    this.wavePrimedKeys = undefined;
    this.waveAskedPairs = undefined;
    this.waveAskedSideKeyPairs.clear();
    this.primeAskedIds = undefined;
    this.typeCardsPrimed.clear();
  }

  private async parseStructureContents(
    folded: SQLQueryResult[] | undefined,
    structureStatementIndex: number,
  ): Promise<void> {
    if (this.structureContents !== undefined) return;
    let result = folded !== undefined ? folded[structureStatementIndex] : undefined;
    let defaultResult = folded !== undefined ? folded[structureStatementIndex + 1] : undefined;
    if (result === undefined || defaultResult === undefined) {
      const batch = await this.fetcher.driver.batch([
        structureRuleUniverseStatement(),
        defaultRuleUniverseStatement(),
        templateTypeNameStatement(),
      ]);
      result = batch[0];
      defaultResult = batch[1];
      if (this.defaultTypeNameById === undefined) {
        this.defaultTypeNameById = templateTypeNamesFromResults(batch[2]);
      }
    }
    this.structureContents = structureUniverseFromResults(result);
    this.structureRuleTypes = structureRuleTypesFromResults(result);
    this.defaultRuleTypes = structureRuleTypesFromResults(defaultResult);
    this.defaultRuleContents = structureUniverseFromResults(defaultResult);
  }

  defaultHtmlViewConfig(): string {
    if (this.pageConfigActive) return pageDefaultHtmlView();
    return deploymentDefaultHtmlViewNest() ?? deckDefaultHtmlView() ?? "titled";
  }

  envOriginConfig(): string {
    return envOriginForSurface(this.pageConfigActive);
  }

  async runWithPageConfig<T>(fn: () => Promise<T>): Promise<T> {
    const prior = this.pageConfigActive;
    this.pageConfigActive = true;
    try {
      if (this.readPermission === undefined) await this.ensureReadPermission();
      if (this.helpResolver === undefined) {
        this.helpResolver = installHelpRules(this, this.fetcher);
        await this.helpResolver.prepare();
      }
      return await fn();
    } finally {
      this.pageConfigActive = prior;
    }
  }

  private async preloadDefaultTypeNames(): Promise<void> {
    if (this.defaultRuleTypes === undefined) return;
    if (this.defaultTypeNameById !== undefined) return;
    const map = new Map<number, string>();
    const ids = [
      ...new Set([
        ...(this.defaultRuleTypes?.values() ?? []),
        ...(this.structureRuleTypes?.values() ?? []),
      ]),
    ];
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(", ");
      const result = await this.fetcher.driver.query<CardsRow>(
        `SELECT id, name FROM cards WHERE id IN (${placeholders}) AND trash = 0`,
        ids,
      );
      for (const row of result.rows as CardsRow[]) {
        if (row.name !== null && row.name !== undefined && row.name !== "") {
          map.set(row.id, row.name);
        }
      }
    }
    this.defaultTypeNameById = map;
  }

  phantomVirtualStructure(
    name: DeckoName,
    typeName: string | undefined,
    typeId: number | undefined,
  ): { ruleKey: string; templateContent: string; typeId?: number } | undefined {
    if (!name.isCompound) return undefined;
    if (this.structureContents === undefined || this.structureRuleTypes === undefined) {
      return undefined;
    }
    return resolveVirtualCardStructure(
      name,
      { contents: this.structureContents, ruleTypeIds: this.structureRuleTypes },
      undefined,
      typeName,
      typeId,
    );
  }
  virtualLeftTypeName(name: DeckoName): string | undefined {
    if (!name.isCompound) return undefined;
    if (this.structureContents === undefined || this.structureRuleTypes === undefined) {
      return undefined;
    }
    const resolution = resolveVirtualCardStructure(
      name,
      { contents: this.structureContents, ruleTypeIds: this.structureRuleTypes },
      undefined,
    );
    if (resolution?.typeId === undefined) return undefined;
    return this.fetcher.codenames.peekNameForId(resolution.typeId);
  }

  newCardDefaultType(
    name: DeckoName,
    leftTypeName?: string,
  ): { typeId: number; typeName: string } | undefined {
    const assignedName = findAssignedTypeName({ name: name.s, isNew: true, leftTypeName });
    if (assignedName !== undefined) {
      const env = getNameEnvironment();
      const assignedId =
        env?.codename?.id(assignedName) ?? env?.lexicon?.id(DeckoName.parse(assignedName).key);
      if (assignedId !== undefined) {
        const assignedType =
          env?.lexicon?.name(assignedId) ?? env?.codename?.nameForId(assignedId);
        if (assignedType !== undefined) {
          return { typeId: assignedId, typeName: assignedType };
        }
      }
    }
    const universe = this.defaultRuleTypes;
    const names = this.defaultTypeNameById;
    if (universe === undefined || universe.size === 0 || names === undefined) return undefined;
    const candidates = ruleNamesForCard(
      {
        name,
        id: undefined,
        typeId: undefined,
        typeName: undefined,
        leftTypeName,
        isNew: true,
      },
      DEFAULT_SETTING_NAME,
    );
    for (const candidate of candidates) {
      let key: string;
      try {
        key = DeckoName.parse(candidate).key;
      } catch (err) {
        if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
          continue;
        }
        throw err;
      }
      const typeId = universe.get(key);
      if (typeId === undefined) continue;
      const typeName = names.get(typeId);
      if (typeName === undefined) return undefined;
      const structureTypes = this.structureRuleTypes;
      const structureContents = this.structureContents;
      if (structureTypes !== undefined && structureTypes.size > 0) {
        const structureCandidates = ruleNamesForCard(
          { name, id: undefined, typeId, typeName, leftTypeName, isNew: true },
          STRUCTURE_SETTING_NAME,
        );
        for (const structureCandidate of structureCandidates) {
          let structureKey: string;
          try {
            structureKey = DeckoName.parse(structureCandidate).key;
          } catch (err) {
            if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
              continue;
            }
            throw err;
          }
          const structureTypeId = structureTypes.get(structureKey);
          if (structureTypeId === undefined) continue;
          const structureContent = structureContents?.get(structureKey);
          if (structureContent !== undefined && structureContent !== null && structureContent.trim() === "_self") {
            return { typeId, typeName };
          }
          const structureTypeName = names.get(structureTypeId);
          return structureTypeName !== undefined
            ? { typeId: structureTypeId, typeName: structureTypeName }
            : { typeId, typeName };
        }
      }
      return { typeId, typeName };
    }
    return undefined;
  }

  defaultRuleTypeIdForSetName(setName: string): number | undefined {
    const universe = this.defaultRuleTypes;
    if (universe === undefined || universe.size === 0) return undefined;
    let key: string;
    try {
      key = DeckoName.parse(`${setName}+*default`).key;
    } catch (err) {
      if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
        return undefined;
      }
      throw err;
    }
    return universe.get(key);
  }

  private ruleCacheSetLabels:
    | Map<string, RuleCacheEntry>
    | undefined;
  private ruleCacheSetLabelsLoad: Promise<void> | undefined;
  private ruleCacheAddressable = true;

  async ensureRuleCacheSetLabels(): Promise<void> {
    if (this.ruleCacheSetLabels !== undefined) return;
    this.ruleCacheSetLabelsLoad ??= (async () => {
      const setTypeId = this.peekIdByCodename("set");
      const settingTypeId = this.peekIdByCodename("setting");
      if (setTypeId === undefined || settingTypeId === undefined) {
        this.ruleCacheSetLabels = new Map();
        this.ruleCacheAddressable = false;
        return;
      }
      const statement = ruleCacheStatement(setTypeId, settingTypeId);
      const result = await this.fetcher.driver.query<RuleCacheRow>(
        statement.sql,
        statement.params ?? [],
      );
      const anchorIds=[...new Set(result.rows.filter(row=>row.anchor_id!==null).map(row=>Number(row.anchor_id)))];
      const names=await this.fetcher.lexicon.names(anchorIds);
      const anchorNames=new Map([...names].map(([id,name])=>[id,name?.s]));
      const hash = new Map<string, RuleCacheEntry>();
      for (const row of result.rows) {
        const anchorId = row.anchor_id === null ? null : Number(row.anchor_id);
        const patternSourceId =
          anchorId === null ? Number(row.set_id) : Number(row.set_tag_id ?? 0);
        const patternCode = this.peekCodenameById(patternSourceId);
        const settingCode = this.peekCodenameById(Number(row.setting_id));
        if (patternCode === undefined || settingCode === undefined) continue;
        hash.set(
          ruleCacheKeyFromRow(anchorId, patternCode, settingCode),
          {
            ruleId: Number(row.rule_id),
            patternCode,
            settingCode,
            anchorName:
              anchorId === null ? undefined : anchorNames.get(anchorId),
          },
        );
      }
      this.ruleCacheSetLabels = hash;
    })();
    await this.ruleCacheSetLabelsLoad;
  }

  ruleCacheSetLabelWinner(
    lookupKeys: readonly string[],
    settingCode: string,
  ): { patternCode: string; anchorName: string | undefined } | undefined {
    const hash = this.ruleCacheSetLabels;
    if (hash === undefined) return undefined;
    for (const key of lookupKeys) {
      const winner = hash.get(`${key}+${settingCode}`);
      if (winner !== undefined) return winner;
    }
    return undefined;
  }

  async ruleCardForSetting(
    card: PatternCardInput,
    settingCode: string,
  ): Promise<CardRecord | undefined> {
    await this.ensureRuleCacheSetLabels();
    if (!this.ruleCacheAddressable) {
      const byName = await findRule(this.fetcher, card, settingCardNameForCode(settingCode), settingCode);
      return byName?.rule;
    }
    const hash = this.ruleCacheSetLabels;
    if (hash === undefined) return undefined;
    const winner = ruleIdLookup(hash, ruleLookupKeysForCard(card), settingCode);
    if (winner === undefined) return undefined;
    const rule = await this.fetcher.fetchById(winner.ruleId);
    if (rule === undefined) return undefined;
    if (rule.name !== undefined) return rule;
    if (winner.anchorName === undefined) {
      const name = DeckoName.parse(`*${winner.patternCode}+*${winner.settingCode}`);
      return { ...rule, name, key: name.key };
    }
    const name = DeckoName.parse(
      `${winner.anchorName}+*${winner.patternCode}+*${winner.settingCode}`,
    );
    return { ...rule, name, key: name.key };
  }

  ruleSetPrototypeTypeCode(card: RenderCard): string | undefined {
    if (!card.name.isCompound) return undefined;
    const parts = card.name.parts;
    if (parts.length < 2) return undefined;
    const setCard = this.fetchRenderCard(parts.slice(0, -1).join("+"));
    if (setCard === undefined) return undefined;
    return setPrototypeTypeCode(this, setCard);
  }

  newCardDefaultContent(name: DeckoName): string | undefined {
    const universe = this.defaultRuleContents;
    if (universe === undefined || universe.size === 0) return undefined;
    const candidates = ruleNamesForCard(
      { name, id: undefined, typeId: undefined, typeName: undefined },
      DEFAULT_SETTING_NAME,
    );
    for (const candidate of candidates) {
      let key: string;
      try {
        key = DeckoName.parse(candidate).key;
      } catch (err) {
        if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
          continue;
        }
        throw err;
      }
      if (!universe.has(key)) continue;
      return universe.get(key) ?? "";
    }
    return undefined;
  }

  async applyLateSeatStructureContent(): Promise<void> {
    await this.applyStructureContent();
    await this.prepareCardtypeGroupItems();
  }

  private async applyStructureContent(): Promise<void> {
    const universe = this.structureContents;
    if (universe === undefined) return;
    for (let round = 0; round < 8; round++) {
      const toFetch = new Map<string, string>();
      let seatedExisting = false;
      for (const [key, card] of this.renderCards) {
        if (!this.renderSeats.has(key)) continue;
        if (this.structureProcessed.has(key)) continue;
        this.structureProcessed.add(key);
        const resolved = resolveStructuredContent(
          this.structurePatternInputForSync(card),
          universe,
        );
        const contentForRefs = resolved !== undefined
          ? resolved.templateContent
          : card.dbContent;
        if (resolved !== undefined && resolved.templateContent !== card.dbContent) {
          card.dbContent = resolved.templateContent;
        }
        const lazyRefs = this.skipStructureRefWalks;
        for (const refName of templateReferenceNames(contentForRefs, card.name)) {
          if (lazyRefs) {
            let lazyKey: string;
            try {
              lazyKey = DeckoName.parse(refName).key;
            } catch {
              lazyKey = "";
            }
            if (lazyKey !== "" && !this.eagerStructureRefs.has(lazyKey)) {
              this.skippedStructureRefs.set(lazyKey, refName);
              continue;
            }
          }
          let refKey: string;
          try {
            refKey = DeckoName.parse(refName).key;
          } catch (err) {
            if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
              continue;
            }
            throw err;
          }
          if (refKey !== "" && this.renderCards.has(refKey) && !this.renderSeats.has(refKey)) {
            for (const k of this.closureSurfaceFromKey(refKey)) {
              if (!this.renderSeats.has(k)) {
                this.renderSeats.add(k);
                seatedExisting = true;
              }
            }
            continue;
          }
          if (
            refKey === "" ||
            this.renderCards.has(refKey) ||
            this.structureRefMisses.has(refKey) ||
            toFetch.has(refKey)
          ) {
            continue;
          }
          toFetch.set(refKey, refName);
        }
      }
      if (toFetch.size === 0) {
        if (seatedExisting) continue;
        return;
      }
      const simpleKeys: string[] = [];
      const compoundNames: string[] = [];
      for (const [refKey, refName] of toFetch) {
        if (DeckoName.parse(refName).isCompound) compoundNames.push(refName);
        else simpleKeys.push(refKey);
      }
      let enrichedAny = false;
      if (simpleKeys.length > 0) {
        const placeholders = simpleKeys.map(() => "?").join(", ");
        const result = await this.fetcher.driver.query<CardsRow>(
          `SELECT * FROM cards WHERE "key" COLLATE NOCASE IN (${placeholders}) AND trash = 0`,
          simpleKeys,
        );
        const rows = result.rows as CardsRow[];
        for (const row of rows) {
          const record = await composeCardRecord(row, this.fetcher.lexicon);
          if (record.name === undefined) continue;
          await this.cacheFetchedRecord(record);
          enrichedAny = true;
        }
        const foundKeys = new Set(rows.map((row) => row.key));
        for (const missKey of simpleKeys) {
          if (!foundKeys.has(missKey)) this.structureRefMisses.add(missKey);
        }
      }
      if (compoundNames.length > 0) {
        const seatedAny = await this.seatNamesByWave(compoundNames);
        if (seatedAny) enrichedAny = true;
      }
      for (const refName of compoundNames) {
        const fetched = await this.fetcher.fetchByName(refName);
        const refKey = DeckoName.parse(refName).key;
        if (fetched === undefined || fetched.name === undefined) {
          this.structureRefMisses.add(refKey);
          continue;
        }
        await this.enrichAndStore(fetched);
        enrichedAny = true;
      }
      if (!enrichedAny && !seatedExisting) return;
    }
  }

  private async primePreparedCardDerivedState(rootKey: string | undefined, suggestionLabelsOnly = false): Promise<void> {
    const typeIds = new Set<number>();
    for (const card of this.renderCards.values()) {
      if (!this.renderSeats.has(card.key)) continue;
      const t = card.record.typeId;
      if (
        typeof t === "number" &&
        Number.isSafeInteger(t) &&
        t > 0 &&
        !this.typeCardsPrimed.has(t)
      ) {
        typeIds.add(t);
      }
    }
    if (typeIds.size > 0) {
      for (const id of typeIds) this.typeCardsPrimed.add(id);
      const ids = [...typeIds];
      const typeStatements: SQLStatement[] = [];
      if (!this.setTypeCardPrimed) {
        this.setTypeCardPrimed = true;
        typeStatements.push({
          sql: `SELECT * FROM cards WHERE codename = 'set' AND trash = 0`,
          params: [],
        });
      }
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const placeholders = chunk.map(() => "?").join(", ");
        typeStatements.push({
          sql: `SELECT * FROM cards WHERE id IN (${placeholders}) AND trash = 0`,
          params: chunk,
        });
      }
      const candidateSettings = ["*content options", "*help", "*structure", "*default"];
      let seatCandidates = true;
      if (suggestionLabelsOnly) seatCandidates = false;
      if (rootKey !== undefined && rootKey !== "") {
        if (this.ruleCandidatesPrimedFor.has(rootKey)) seatCandidates = false;
        else this.ruleCandidatesPrimedFor.add(rootKey);
      }
      const names = new Set<string>();
      if (seatCandidates) {
        for (const card of this.renderCards.values()) {
          if (!this.renderSeats.has(card.key)) continue;
          if (card.record.isNew) continue;
          for (const setting of candidateSettings) {
            let candidates: string[];
            try {
              candidates = ruleNamesForCard(this.structurePatternInputForSync(card), setting);
            } catch (err) {
              if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
                continue;
              }
              throw err;
            }
            for (const candidate of candidates) names.add(candidate);
          }
        }
      }
      if (seatCandidates && names.size > 0) {
        const anticipated: string[] = [];
        const universe = this.structureContents;
        if (universe !== undefined) {
          for (const candidate of names) {
            let candidateName: DeckoName;
            try {
              candidateName = DeckoName.parse(candidate);
            } catch {
              continue;
            }
            const content = universe.get(candidateName.key);
            if (content === undefined || content === null || content === "") continue;
            if (this.renderCards.has(candidateName.key) || this.structureProcessed.has(candidateName.key)) continue;
            for (const refName of templateReferenceNames(content, candidateName)) {
              let refKey: string;
              try {
                refKey = DeckoName.parse(refName).key;
              } catch {
                continue;
              }
              if (refKey === "" || this.renderCards.has(refKey) || this.structureRefMisses.has(refKey)) continue;
              anticipated.push(refName);
            }
          }
        }
        await this.seatNamesByWave([...names], typeStatements, anticipated);
      } else {
        const rows = (await readCompositionBatch(this.fetcher.driver, typeStatements)).flatMap(
          (result) => (result.rows as CardsRow[]) ?? [],
        );
        const pointRows = await this.primeRowsForComposition(rows);
        for (const row of pointRows) {
          const record = await composeCardRecord(row, this.fetcher.lexicon);
          if (record.name === undefined || record.id === undefined) continue;
          if (row.name !== null && row.name !== undefined) {
            this.fetcher.lexicon.write(record.id, record.name, row.name);
          }
          await this.cacheFetchedRecord(record);
        }
      }
    }
  }

  private async seatNamesByWave(
    names: string[],
    preambleStatements?: SQLStatement[],
    primeOnly: string[] = [],
  ): Promise<boolean> {
    if (names.length === 0) return false;
    const knownId = (key: string): number | undefined => {
      const card = this.renderCards.get(key);
      const id = card?.record.id;
      return typeof id === "number" && id > 0 ? id : undefined;
    };
    const levelKeys = (name: DeckoName): string[] => {
      const keys = name.partKeys.slice();
      const parts = name.parts;
      for (let n = 2; n <= parts.length; n++) {
        keys.push(n === parts.length ? name.key : DeckoName.parse(parts.slice(0, n).join("+")).key);
      }
      return keys;
    };
    const MAX_WAVE_ROUNDS = 25;
    const pending = new Set<string>();
    const seatKeys = new Set<string>();
    for (const raw of names) {
      let name: DeckoName;
      try {
        name = DeckoName.parse(raw);
      } catch (err) {
        if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
          continue;
        }
        throw err;
      }
      if (primeOnly.length > 0) for (const key of levelKeys(name)) seatKeys.add(key);
      if (this.renderCards.has(name.key) || this.structureRefMisses.has(name.key)) continue;
      pending.add(raw);
    }
    const primeRaws = new Set<string>();
    const primeOnlyKeys = new Set<string>();
    for (const raw of primeOnly) {
      let name: DeckoName;
      try {
        name = DeckoName.parse(raw);
      } catch {
        continue;
      }
      if (seatKeys.has(name.key) || this.renderCards.has(name.key) || this.structureRefMisses.has(name.key)) continue;
      for (const key of levelKeys(name)) if (!seatKeys.has(key)) primeOnlyKeys.add(key);
      pending.add(raw);
      primeRaws.add(raw);
    }
    if (this.wavePrimedKeys === undefined) this.wavePrimedKeys = new Set();
    const wavePrimedKeys = this.wavePrimedKeys;
    const primeAskedSimple = new Set<string>();
    const primeAskedChains = new Set<string>();
    if (this.waveAskedSimpleKeys === undefined) this.waveAskedSimpleKeys = new Map();
    if (this.waveAskedPairs === undefined) this.waveAskedPairs = new Map();
    const askedSimpleKeys = this.waveAskedSimpleKeys;
    const askedPairs = this.waveAskedPairs;
    const askedSideKeyPairs = this.waveAskedSideKeyPairs;
    const callAskedSimple = new Set<string>();
    const callAskedPairs = new Set<string>();
    const callAnsweredSimple = new Set<string>();
    const callAnsweredPairs = new Set<string>();
    let preamble = preambleStatements ?? [];
    let seatedAny = false;
    for (let round = 0; round < MAX_WAVE_ROUNDS && pending.size > 0; round++) {
      const simpleKeys: string[] = [];
      const sideKeyPairs: { left: string; right: string; raw: string }[] = [];
      const sideIdPairs: { leftId: number; rightId: number; lex: Lex }[] = [];
      const chainAsks: { junction: DeckoName; partKeys: string[]; raw: string }[] = [];
      const primeSideKeyPairs: { left: string; right: string; raw: string }[] = [];
      const nextRound: string[] = [];
      let heldSeatThisRound = false;
      const askSimple = (key: string, raw: string, prime: boolean): void => {
        if (key === "" || this.renderCards.has(key)) return;
        if (prime && !seatKeys.has(key)) {
          if (
            primeAskedSimple.has(key) ||
            askedSimpleKeys.has(key) ||
            this.fetcher.lexicon.heldKeyNegative(key) ||
            this.fetcher.retrieveFromCacheByKey(key) !== undefined
          ) {
            return;
          }
          primeAskedSimple.add(key);
          callAskedSimple.add(key);
          simpleKeys.push(key);
          return;
        }
        if (askedSimpleKeys.has(key)) return;
        askedSimpleKeys.set(key, raw);
        callAskedSimple.add(key);
        simpleKeys.push(key);
      };
      for (const raw of pending) {
        let name: DeckoName;
        try {
          name = DeckoName.parse(raw);
        } catch (err) {
          if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
            continue;
          }
          throw err;
        }
        if (this.renderCards.has(name.key)) continue;
        const prime = primeRaws.has(raw) && !seatKeys.has(name.key);
        if (!prime && wavePrimedKeys.has(name.key)) {
          const held = this.fetcher.retrieveFromCacheByKey(name.key);
          if (held !== undefined) {
            heldSeatThisRound = true;
            await this.cacheFetchedRecord(held);
            seatedAny = true;
            continue;
          }
        }
        const left = name.leftName;
        const right = name.rightName;
        if (prime && (!name.isCompound || left === undefined || right === undefined)) {
          askSimple(name.key, raw, true);
          continue;
        }
        if (!name.isCompound || left === undefined || right === undefined) {
          const key = name.key;
          if (
            !this.renderCards.has(key) &&
            !askedSimpleKeys.has(key) &&
            !this.fetcher.lexicon.heldKeyNegative(key)
          ) {
            const held = this.fetcher.retrieveFromCacheByKey(key);
            if (held !== undefined) {
              heldSeatThisRound = true;
              await this.cacheFetchedRecord(held);
              seatedAny = true;
            } else {
              askedSimpleKeys.set(key, raw);
              callAskedSimple.add(key);
              simpleKeys.push(key);
            }
          }
          continue;
        }
        const leftId = knownId(left.key);
        const rightId = knownId(right.key);
        if (leftId !== undefined && rightId !== undefined) {
          const lex: Lex = [leftId, rightId];
          const pairKey = `L-${leftId}-${rightId}`;
          if (!askedPairs.has(pairKey) && !this.fetcher.lexicon.lexEntryKnown(lex)) {
            askedPairs.set(pairKey, { leftId, rightId, lex });
            callAskedPairs.add(pairKey);
            sideIdPairs.push({ leftId, rightId, lex });
          } else if (
            !askedPairs.has(pairKey) &&
            this.fetcher.lexicon.peekIdByLex(lex) !== undefined
          ) {
            const held = this.fetcher.retrieveFromCacheByKey(name.key);
            if (held !== undefined) {
              heldSeatThisRound = true;
              await this.cacheFetchedRecord(held);
              seatedAny = true;
            } else {
              askedPairs.set(pairKey, { leftId, rightId, lex });
              callAskedPairs.add(pairKey);
              sideIdPairs.push({ leftId, rightId, lex });
            }
          }
        } else if (prime && !left.isCompound && !right.isCompound) {
          const sidePairKey = `${left.key}~${right.key}`;
          if (!askedSideKeyPairs.has(sidePairKey) && !primeAskedChains.has(sidePairKey)) {
            primeAskedChains.add(sidePairKey);
            primeSideKeyPairs.push({ left: left.key, right: right.key, raw });
            askSimple(left.key, left.s, true);
            askSimple(right.key, right.s, true);
          }
        } else if (!left.isCompound && !right.isCompound) {
          const sidePairKey = `${left.key}~${right.key}`;
          if (!askedSideKeyPairs.has(sidePairKey)) {
            askedSideKeyPairs.add(sidePairKey);
            sideKeyPairs.push({ left: left.key, right: right.key, raw });
            if (!this.renderCards.has(left.key) && !askedSimpleKeys.has(left.key)) {
              askedSimpleKeys.set(left.key, left.s);
              callAskedSimple.add(left.key);
              simpleKeys.push(left.key);
            }
            if (!this.renderCards.has(right.key) && !askedSimpleKeys.has(right.key)) {
              askedSimpleKeys.set(right.key, right.s);
              callAskedSimple.add(right.key);
              simpleKeys.push(right.key);
            }
          }
        } else if (left.isCompound && leftId === undefined) {
          const partNames = name.partNames;
          for (const part of partNames) askSimple(part.key, part.s, prime);
          const partKeys = partNames.map((part) => part.key);
          const pairRaw = partNames.slice(0, 2).map((p) => p.s).join("+");
          const pairKey = `${partKeys[0]}~${partKeys[1]}`;
          const pairSeats = !prime || seatKeys.has(DeckoName.parse(pairRaw).key);
          if (
            !askedSideKeyPairs.has(pairKey) &&
            !(!pairSeats && primeAskedChains.has(pairKey)) &&
            knownId(DeckoName.parse(pairRaw).key) === undefined
          ) {
            if (pairSeats) {
              askedSideKeyPairs.add(pairKey);
              sideKeyPairs.push({ left: partKeys[0]!, right: partKeys[1]!, raw: pairRaw });
            } else {
              primeAskedChains.add(pairKey);
              primeSideKeyPairs.push({ left: partKeys[0]!, right: partKeys[1]!, raw: pairRaw });
            }
          }
          for (let depth = 3; depth <= partNames.length; depth++) {
            const prefixKeys = partKeys.slice(0, depth);
            const chainKey = prefixKeys.join("~");
            if (askedSideKeyPairs.has(chainKey) || primeAskedChains.has(chainKey)) continue;
            const prefixRaw = depth === partNames.length ? raw : partNames.slice(0, depth).map((p) => p.s).join("+");
            const prefix = depth === partNames.length ? name : DeckoName.parse(prefixRaw);
            if (this.renderCards.has(prefix.key)) continue;
            if (!prime || seatKeys.has(prefix.key)) askedSideKeyPairs.add(chainKey);
            else primeAskedChains.add(chainKey);
            chainAsks.push({ junction: prefix.leftName!, partKeys: prefixKeys, raw: prefixRaw });
          }
        } else {
          nextRound.push(left.s, right.s);
          if (prime) {
            for (const side of [left, right]) if (!seatKeys.has(side.key)) primeRaws.add(side.s);
            primeRaws.add(raw);
          }
          nextRound.push(raw);
        }
      }
      if (
        simpleKeys.length === 0 &&
        sideKeyPairs.length === 0 &&
        primeSideKeyPairs.length === 0 &&
        chainAsks.length === 0 &&
        sideIdPairs.length === 0
      ) {
        if (nextRound.length === 0) break;
        if (!heldSeatThisRound && nextRound.length >= pending.size) {
          const next = new Set(nextRound);
          if (next.size === pending.size && [...next].every((raw) => pending.has(raw))) break;
        }
        pending.clear();
        for (const raw of nextRound) pending.add(raw);
        continue;
      }
      const statements: SQLStatement[] = [];
      const statementKinds: ("seat" | "prime" | "auto")[] = [];
      const tagStatements = (kind: "seat" | "prime" | "auto"): void => {
        while (statementKinds.length < statements.length) statementKinds.push(kind);
      };
      if (preamble.length > 0) {
        statements.push(...preamble);
        preamble = [];
      }
      tagStatements("seat");
      if (simpleKeys.length > 0) {
        for (let i = 0; i < simpleKeys.length; i += 90) {
          statements.push(waveKeysStatement(simpleKeys.slice(i, i + 90)));
        }
      }
      tagStatements("auto");
      for (const [pairs, kind] of [
        [sideKeyPairs, "seat"],
        [primeSideKeyPairs, "prime"],
      ] as const) {
        for (let i = 0; i < pairs.length; i += 45) {
          const chunk = pairs.slice(i, i + 45);
          statements.push(
            waveJunctionStatement(
              chunk.map((pair) => pair.left),
              chunk.map((pair) => pair.right),
            ),
          );
        }
        tagStatements(kind);
      }
      if (chainAsks.length > 0) {
        const byDepth = new Map<number, typeof chainAsks>();
        for (const ask of chainAsks) {
          const list = byDepth.get(ask.partKeys.length) ?? [];
          list.push(ask);
          byDepth.set(ask.partKeys.length, list);
        }
        for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
          const asks = byDepth.get(depth)!;
          const perStatement = Math.max(1, Math.floor(90 / depth));
          for (let i = 0; i < asks.length; i += perStatement) {
            const chunk = asks.slice(i, i + perStatement);
            statements.push(junctionChainQuery(chunk.map(ask=>ask.partKeys)));
          }
        }
      }
      if (sideIdPairs.length > 0) {
        for (let i = 0; i < sideIdPairs.length; i += 400) {
          const chunk = sideIdPairs.slice(i, i + 400);
          const tuple = chunk.map(() => "(j.left_id = ? AND j.right_id = ?)").join(" OR ");
          const params = chunk.flatMap((pair) => [pair.leftId, pair.rightId]);
          statements.push({
            sql: `SELECT j.* FROM cards j WHERE j.trash = 0 AND (${tuple})`,
            params,
          });
        }
      }
      tagStatements("auto");
      const rows: CardsRow[] = [];
      const rowKinds: ("seat" | "prime" | "auto")[] = [];
      (await readCompositionBatch(this.fetcher.driver, statements)).forEach((result, i) => {
        for (const row of (result.rows as CardsRow[]) ?? []) {
          rows.push(row);
          rowKinds.push(statementKinds[i] ?? "auto");
        }
      });
      const pointRows = await this.primeRowsForComposition(rows);
      const fetchedPairs = new Set<string>();
      const pairAnswerIds = new Set(pointRows.filter(isCompoundRow).map(row => row.id));
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex]!;
        if (isCompoundRow(row)) {
          fetchedPairs.add(`L-${row.left_id}-${row.right_id}`);
          if (!pairAnswerIds.has(row.id)) continue;
        }
        const record = await composeCardRecord(row, this.fetcher.lexicon);
        if (record.name === undefined || record.key === undefined || record.key === "") continue;
        callAnsweredSimple.add(record.key);
        if (row.name !== null && row.name !== undefined) {
          this.fetcher.lexicon.write(record.id!, record.name, row.name);
        } else if (
          row.left_id !== null &&
          row.left_id !== undefined &&
          row.right_id !== null &&
          row.right_id !== undefined
        ) {
          this.fetcher.lexicon.write(record.id!, record.name, [row.left_id, row.right_id]);
        }
        const rowKind = rowKinds[rowIndex];
        if (rowKind === "prime" || (rowKind === "auto" && primeOnlyKeys.has(record.key))) {
          if (!this.renderCards.has(record.key) && this.fetcher.peekStaleCard(record.key) === undefined) {
            this.fetcher.writeToCache(record);
            wavePrimedKeys.add(record.key);
          }
          continue;
        }
        await this.cacheFetchedRecord(record);
        seatedAny = true;
      }
      for (const pairKey of fetchedPairs) callAnsweredPairs.add(pairKey);
      const keyJoinMisses: { junctionKey: string; leftKey: string; rightKey: string }[] = [];
      for (const pair of [...sideKeyPairs, ...primeSideKeyPairs]) {
        let asked: DeckoName;
        try {
          asked = DeckoName.parse(pair.raw);
        } catch {
          continue;
        }
        keyJoinMisses.push({ junctionKey: asked.key, leftKey: pair.left, rightKey: pair.right });
      }
      for (const ask of chainAsks) {
        keyJoinMisses.push({
          junctionKey: DeckoName.parse(ask.raw).key,
          leftKey: ask.junction.key,
          rightKey: ask.partKeys[ask.partKeys.length - 1]!,
        });
      }
      for (const miss of keyJoinMisses) {
        if (this.renderCards.has(miss.junctionKey) || wavePrimedKeys.has(miss.junctionKey)) continue;
        const primedId = (key: string): number | undefined =>
          wavePrimedKeys.has(key) ? this.fetcher.retrieveFromCacheByKey(key)?.id : undefined;
        const leftId = knownId(miss.leftKey) ?? primedId(miss.leftKey);
        const rightId = knownId(miss.rightKey) ?? primedId(miss.rightKey);
        if (leftId === undefined || rightId === undefined) continue;
        const pairKey = `L-${leftId}-${rightId}`;
        if (askedPairs.has(pairKey)) continue;
        const lex: Lex = [leftId, rightId];
        if (this.fetcher.lexicon.lexEntryKnown(lex)) continue;
        askedPairs.set(pairKey, { leftId, rightId, lex });
        callAskedPairs.add(pairKey);
      }
      const missingSimple: { key: string; id: undefined }[] = [];
      for (const key of callAskedSimple) {
        if (!callAnsweredSimple.has(key) && !this.renderCards.has(key)) {
          missingSimple.push({ key, id: undefined });
        }
      }
      if (missingSimple.length > 0) this.fetcher.lexicon.primeIdsByKey(missingSimple);
      for (const pairKey of callAskedPairs) {
        if (!callAnsweredPairs.has(pairKey)) {
          const entry = askedPairs.get(pairKey);
          if (entry !== undefined) this.fetcher.lexicon.primeIdByLex(entry.lex, undefined);
        }
      }
      pending.clear();
      for (const raw of nextRound) pending.add(raw);
    }
    if (preamble.length > 0) {
      const rows = (await readCompositionBatch(this.fetcher.driver, preamble)).flatMap(
        (result) => (result.rows as CardsRow[]) ?? [],
      );
      const pointRows = await this.primeRowsForComposition(rows);
      for (const row of pointRows) {
        const record = await composeCardRecord(row, this.fetcher.lexicon);
        if (record.name === undefined || record.id === undefined) continue;
        if (row.name !== null && row.name !== undefined) {
          this.fetcher.lexicon.write(record.id, record.name, row.name);
        }
        await this.cacheFetchedRecord(record);
        seatedAny = true;
      }
    }
    return seatedAny;
  }

  private async primeRowsForComposition(inputRows: CardsRow[]): Promise<CardsRow[]> {
    const rows = await rowsMatchingPointIdentity(this.fetcher.driver, inputRows, {
      storedKeyFallback: this.fetcher.lexicon.storedKeyFallback,
    });
    if (rows.length === 0) return rows;
    if (this.primeAskedIds === undefined) this.primeAskedIds = new Set();
    const askedPrimeIds = this.primeAskedIds;
    const inHand = new Map<number, CardsRow>();
    const missing = new Set<number>();
    const fullRows: CardsRow[] = [];
    for (const row of rows) {
      if (typeof row.id === "number") {
        inHand.set(row.id, row);
        fullRows.push(row);
      }
    }
    const PRIME_ID_CHUNK = 500;
    const collectNeeds = (source: Iterable<CardsRow>): number => {
      let added = 0;
      for (const row of source) {
        for (const side of [row.left_id, row.right_id]) {
          if (
            typeof side === "number" &&
            !inHand.has(side) &&
            !missing.has(side) &&
            !askedPrimeIds.has(side)
          ) {
            missing.add(side);
            added += 1;
          }
        }
        if (
          typeof row.type_id === "number" &&
          !inHand.has(row.type_id) &&
          !missing.has(row.type_id) &&
          !askedPrimeIds.has(row.type_id)
        ) {
          missing.add(row.type_id);
          added += 1;
        }
      }
      return added;
    };
    collectNeeds(inHand.values());
    for (const row of inHand.values()) this.fetcher.lexicon.noteIdToLexRow(row);
    if (missing.size < 6) return rows;
    const absent = new Set<number>();
    let guard = 0;
    while (missing.size > 0 && guard < 8) {
      guard += 1;
      const ids = [...missing];
      missing.clear();
      for (let i = 0; i < ids.length; i += PRIME_ID_CHUNK) {
        const chunk = ids.slice(i, i + PRIME_ID_CHUNK);
        for (const id of chunk) askedPrimeIds.add(id);
        const read = await this.fetcher.driver.query<
          Pick<CardsRow, "id" | "name" | "left_id" | "right_id">
        >(
          `SELECT id, name, left_id, right_id FROM cards WHERE id IN (${chunk
            .map(() => "?")
            .join(", ")})`,
          chunk,
        );
        const freshById = new Map<number, CardsRow>();
        const found = new Set<number>();
        for (const row of read.rows) {
          const askedId = row.id;
          if (typeof askedId !== "number" || found.has(askedId)) continue;
          found.add(askedId);
          const slim = {
            id: askedId,
            name: row.name ?? null,
            left_id: row.left_id ?? null,
            right_id: row.right_id ?? null,
          } as CardsRow;
          if (!inHand.has(askedId)) {
            inHand.set(askedId, slim);
            freshById.set(askedId, slim);
          }
          this.fetcher.lexicon.noteIdToLexRow(slim, { primeReverse: false });
        }
        for (const id of chunk) if (!found.has(id)) absent.add(id);
        collectNeeds(freshById.values());
      }
    }
    for (const id of absent) this.fetcher.lexicon.noteIdToLexMiss(id);
    for (const row of fullRows) {
      if (row.trash !== 0) continue;
      const record = await composeCardRecord(row, this.fetcher.lexicon);
      if (record.name === undefined || record.id === undefined) continue;
      this.fetcher.writeToCache(record);
    }
    return rows;
  }

  async knownVirtualCardName(name: DeckoName): Promise<boolean> {
    if (!name.isCompound) return false;
    let leftTypeName: string | undefined;
    const leftKey = name.leftName?.key;
    if (leftKey !== undefined && leftKey !== "") {
      const left = await this.fetcher.fetchByName(leftKey);
      if (left?.typeId !== undefined && left.typeId !== null) {
        leftTypeName = (await this.fetcher.fetchById(left.typeId))?.name?.s;
      }
    }
    const setKeys = safeSetKeys({
      name,
      typeId: undefined,
      typeName: undefined,
      leftTypeName,
      isNew: true,
    });
    return isKnownVirtualCard({ name, setKeys, typeName: undefined } as RenderCard);
  }

  private async seatAbsentRoot(card: RenderCard): Promise<RenderCard> {
    const name = card.name;
    let leftTypeName: string | undefined;
    if (name.isCompound && name.leftName !== undefined) {
      const left = await this.fetcher.fetchByName(name.leftName.s);
      if (left?.typeId !== undefined && left.typeId !== null) {
        leftTypeName = (await this.fetcher.fetchById(left.typeId))?.name?.s;
      }
    }
    const typed =
      card.typeId !== undefined
        ? { typeId: card.typeId, typeName: card.typeName ?? "" }
        : this.newCardDefaultType(name, leftTypeName);
    const typeId = typed?.typeId;
    const structure = this.structureRuleForSync({
      name: name.s,
      id: undefined,
      typeId,
      typeName: typed?.typeName,
      isNew: true,
    });
    const dbContent =
      card.record.dbContent !== undefined && card.record.dbContent !== null
        ? card.dbContent
        : structure === undefined
          ? (this.newCardDefaultContent(name) ?? "")
          : "";
    const setKeys = safeSetKeys({ name, typeId, typeName: typed?.typeName, leftTypeName, isNew: true });
    const knownVirtual = isKnownVirtualCard({
      ...card,
      name,
      typeId,
      typeName: typed?.typeName,
      setKeys,
    } as RenderCard);
    const seated: RenderCard = {
      ...card,
      record: { ...card.record, typeId },
      typeId,
      typeName: typed?.typeName,
      typeCode: typeId === undefined ? undefined : this.fetcher.codenames.peekNameForId(typeId),
      setKeys,
      dbContent,
      unknown: !(
        knownVirtual ||
        isVirtualSetCardName(name, {
          ...(typed?.typeName !== undefined ? { typeName: typed.typeName } : {}),
          ...(leftTypeName !== undefined ? { leftTypeName } : {}),
        })
      ),
    };
    this.renderCards.set(card.key, seated);
    if (this.readPermission !== undefined) {
      if (this.taskState === undefined) {
        const results = await this.fetcher.driver.batch(viewTaskPermissionStatements());
        this.taskState = viewTaskStateFromResults(results, this.readPermission);
      }
      const verdicts = await allTaskVerdictsForCard(
        this.fetcher,
        this.structurePatternInputForSync(seated),
        this.taskState,
      );
      this.taskVerdicts.set(seated.key, verdicts);
      if (verdicts.create === true || this.readPermission.alwaysOk) {
        await this.ensureCreateableTypes();
        for (const candidate of ruleNamesForCard(this.structurePatternInputForSync(seated), "*guide")) {
          const guide = await this.prepareItemForRender(candidate);
          if (guide?.id === undefined || this.taskVerdicts.has(guide.key)) continue;
          const guideVerdicts = await allTaskVerdictsForCard(
            this.fetcher,
            this.structurePatternInputForSync(guide),
            this.taskState,
          );
          this.taskVerdicts.set(guide.key, await this.applyUpdateOverride(guide, guideVerdicts));
        }
        await this.ensureVerdicts();
      }
    }
    return seated;
  }

  private async seatUnknownNestCreateVerdicts(record: CardRecord): Promise<void> {
    if (this.readPermission === undefined || this.readPermission.alwaysOk) return;
    if (this.readPermission.signedInActorId === undefined) return;
    const rootKey = record.key ?? (record.name ? DeckoName.parse(record.name).key : undefined);
    const root = rootKey !== undefined ? this.renderCards.get(rootKey) : undefined;
    if (root === undefined || root.dbContent === undefined || root.dbContent === "") return;
    const misses: DeckoName[] = [];
    for (const ref of referencedNames(root.dbContent)) {
      const pipe = ref.name.indexOf("|");
      const base = pipe === -1 ? ref.name : ref.name.slice(0, pipe);
      let name: DeckoName;
      try {
        name = DeckoName.parse(DeckoName.parse(base).absolute(root.name));
      } catch {
        continue;
      }
      if (name.key === "" || this.renderCards.has(name.key) || this.taskVerdicts.has(name.key)) continue;
      if (virtualSearchCqlFor(name, this.codenameHolderKey) !== undefined) continue;
      misses.push(name);
    }
    if (misses.length === 0) return;
    if (this.taskState === undefined) {
      const results = await this.fetcher.driver.batch(viewTaskPermissionStatements());
      this.taskState = viewTaskStateFromResults(results, this.readPermission);
    }
    for (const name of misses) {
      let leftTypeName: string | undefined;
      if (name.isCompound && name.leftName !== undefined) {
        const left = await this.fetcher.fetchByName(name.leftName.s, { skipVirtual: true });
        if (left?.typeId !== undefined && left.typeId !== null) {
          leftTypeName = (await this.fetcher.fetchById(left.typeId, { skipModules: true }))?.name?.s;
        }
      }
      const defaulted = this.newCardDefaultType(name, leftTypeName);
      const input = {
        name,
        isNew: true,
        ...(defaulted?.typeId !== undefined ? { typeId: defaulted.typeId } : {}),
        ...(defaulted?.typeName !== undefined ? { typeName: defaulted.typeName } : {}),
      };
      const create = await taskVerdictForCard(this.fetcher, input, "create", this.taskState);
      this.taskVerdicts.set(name.key, { update: undefined, delete: undefined, create });
    }
  }

  async prepareCardtypeGroupItems(rootName?: DeckoName, view?: string, layoutContent?: string): Promise<void> {
    const requested = rootName?.key === "cardtype" && view === "grouped_list";
    const nestsGroup = (content: string | undefined): boolean =>
      typeof content === "string" && content.includes("grouped_list") && scanNests(content).some(piece =>
        piece.nest?.options.view === "grouped_list");
    const nested = !requested && (nestsGroup(layoutContent) || [...this.renderSeats].some(key =>
      nestsGroup(this.renderCards.get(key)?.dbContent)));
    if (!requested && !nested) return;
    await this.ensureCreateableTypes();
    const names = [...new Set([...Object.values(CARDTYPE_GROUPS).flat(), ...this.createableTypes()])];
    await this.seatNamesByWave(names);
    for (const name of names) {
      const key = DeckoName.parse(name).key;
      if (!this.renderCards.has(key)) this.structureRefMisses.add(key);
    }
    await this.applyStructureContent();
    await this.preloadDefaultTypeNames();
    await this.seatUnknownRefReadVerdicts();
    await this.ensureVerdicts();
  }

  private async seatUnknownRefReadVerdicts(): Promise<void> {
    if (this.readPermission === undefined) return;
    for (const refKey of this.structureRefMisses) {
      if (refKey === "" || this.deniedVerdictsByKey.has(refKey)) continue;
      let parsed: DeckoName;
      try {
        parsed = DeckoName.parse(refKey);
      } catch (err) {
        if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
          continue;
        }
        throw err;
      }
      if (parsed.key === "") continue;
      if (parsed.isCompound) {
        const defaulted = this.newCardDefaultType(parsed);
        const input = {
          name: parsed,
          isNew: true,
          ...(defaulted?.typeId !== undefined ? { typeId: defaulted.typeId } : {}),
          ...(defaulted?.typeName !== undefined ? { typeName: defaulted.typeName } : {}),
        };
        const read = await canReadByRuleLookup(this.fetcher, input, this.readPermission);
        this.deniedVerdictsByKey.set(refKey, read === false);
        continue;
      }
      const defaulted = this.newCardDefaultType(parsed);
      const input = {
        name: parsed,
        isNew: true,
        ...(defaulted?.typeId !== undefined ? { typeId: defaulted.typeId } : {}),
        ...(defaulted?.typeName !== undefined ? { typeName: defaulted.typeName } : {}),
      };
      const read = await canReadByRuleLookup(this.fetcher, input, this.readPermission);
      this.deniedVerdictsByKey.set(refKey, read === false);
    }
  }

  private async seatBlankKeyReadVerdict(): Promise<void> {
    if (this.readPermission === undefined) return;
    if (this.deniedVerdictsByKey.has("")) return;
    const name = DeckoName.parse("");
    const defaulted = this.newCardDefaultType(name);
    const read = await canReadByRuleLookup(
      this.fetcher,
      {
        name,
        id: undefined,
        isNew: true,
        ...(defaulted?.typeId !== undefined ? { typeId: defaulted.typeId } : {}),
        ...(defaulted?.typeName !== undefined ? { typeName: defaulted.typeName } : {}),
      },
      this.readPermission,
    );
    this.deniedVerdictsByKey.set("", read === false);
  }

  private async structurePatternInputFor(card: RenderCard): Promise<PatternCardInput> {
    let leftTypeName: string | undefined;
    let leftRecord: CardRecord | undefined;
    if (card.name.isCompound) {
      const leftKey = card.name.leftName?.key;
      leftRecord =
        leftKey !== undefined
          ? ((await this.fetcher.fetchByName(leftKey)) ?? undefined)
          : undefined;
      if (leftRecord !== undefined) {
        leftTypeName = (await this.enrichAndStore(leftRecord)).typeName;
      }
    }
    const isRule = card.name.isCompound ? await this.computeIsRule(card.name, leftRecord) : false;
    return {
      name: card.name,
      id: card.id,
      typeId: card.typeId,
      typeName: card.typeName,
      ...(leftTypeName !== undefined ? { leftTypeName } : {}),
      ...(isRule !== undefined ? { isRule } : {}),
    };
  }

  private structurePatternInputForSync(card: RenderCard): PatternCardInput {
    let leftTypeName: string | undefined;
    if (card.name.isCompound) {
      const leftKey = card.name.leftName?.key;
      if (leftKey !== undefined) {
        const leftCard = this.peekPrepared(leftKey);
        if (leftCard !== undefined) leftTypeName = leftCard.typeName;
      }
    }
    const isRule = this.computeIsRuleSync(card);
    return {
      name: card.name,
      id: card.id,
      typeId: card.typeId,
      typeName: card.typeName,
      ...(leftTypeName !== undefined ? { leftTypeName } : {}),
      ...(isRule ? { isRule } : {}),
    };
  }

  private rulePartsInMap(card: RenderCard): boolean {
    const name = card.name;
    const rightKey = name.rightName?.key;
    const leftKey = name.leftName?.key;
    if (rightKey === undefined || leftKey === undefined) return true;
    const rightCard = this.renderCards.get(rightKey);
    if (rightCard === undefined || !this.renderCards.has(leftKey)) return false;
    if (name.parts.length <= 2 || rightCard.record.typeId !== this.ruleTypeIds?.setting) {
      return true;
    }
    const trunkKey = DeckoName.parse(name.parts.slice(0, -2).join("+")).key;
    const prefererKey = DeckoName.parse(name.parts[name.parts.length - 2] ?? "").key;
    return (
      (trunkKey === "" || this.renderCards.has(trunkKey)) &&
      (prefererKey === "" || this.renderCards.has(prefererKey))
    );
  }

  private computeIsRuleSync(card: RenderCard): boolean {
    const ids = this.ruleTypeIds;
    if (ids === undefined || ids.setting === undefined || ids.set === undefined) {
      return false;
    }
    const name = card.name;
    if (!name.isCompound) return false;
    const rightKey = name.rightName?.key;
    if (rightKey === undefined) return false;
    const rightCard = this.peekPrepared(rightKey);
    if (rightCard === undefined || rightCard.record.typeId !== ids.setting) return false;
    if (name.parts.length > 2) {
      const leftKey = name.leftName?.key;
      if (leftKey !== undefined) {
        const leftCard = this.peekPrepared(leftKey);
        if (leftCard !== undefined && leftCard.record.typeId === ids.set) return true;
      }
      const trunkKey = DeckoName.parse(name.parts.slice(0, -2).join("+")).key;
      if (trunkKey === "") return false;
      const trunkCard = this.peekPrepared(trunkKey);
      if (trunkCard === undefined || trunkCard.record.typeId !== ids.set) return false;
      const prefererKey = DeckoName.parse(name.parts[name.parts.length - 2] ?? "").key;
      if (prefererKey === "") return false;
      const prefererCard = this.peekPrepared(prefererKey);
      if (prefererCard === undefined) return false;
      if (ids.user !== undefined && prefererCard.record.typeId === ids.user) return true;
      return prefererCard.record.codename === "all";
    }
    const twoPartLeftKey = name.leftName?.key;
    if (twoPartLeftKey === undefined) return false;
    const twoPartLeft = this.peekPrepared(twoPartLeftKey);
    return twoPartLeft?.record.typeId === ids.set;
  }

  private async ensureReadPermission(
    folded?: SQLQueryResult[],
    seatGateRows?: SQLQueryResult,
  ): Promise<ReadPermissionState> {
    if (this.readPermission !== undefined) return this.readPermission;
    const statements = readPermissionStatements(this.viewer);
    let results: SQLQueryResult[];
    if (seatGateRows !== undefined) {
      const rest = statements.filter(
        (_, i) => i !== PERMISSION_GATE_COUNT_STATEMENT_INDEX,
      );
      const live = await this.fetcher.driver.batch(rest);
      results = [];
      let k = 0;
      statements.forEach((_, i) => {
        results.push(
          i === PERMISSION_GATE_COUNT_STATEMENT_INDEX
            ? seatGateRows
            : (live as SQLQueryResult[])[k++],
        );
      });
    } else {
      results = folded ?? (await this.fetcher.driver.batch(statements));
    }
    const viewer: ReadViewer =
      this.viewer.signedIn === true
        ? this.viewer
        : { signedIn: false, actorId: anonymousIdFromResults(results) };
    this.readPermission = readPermissionStateFromViewerResults(results, viewer);
    this.readViewer = viewer;
    if (!this.readViewerKeyResolved) {
      const known = actorKeyFromResults(results, viewer.actorId);
      if (known !== undefined) {
        this.readViewerKey = known.key;
        this.readViewerKeyResolved = true;
      }
    }
    return this.readPermission;
  }

  private async verdictPatternInput(
    name: DeckoName,
    id: number | undefined,
    typeId: number | undefined,
    typeName: string | undefined,
  ): Promise<PatternCardInput> {
    let leftTypeName: string | undefined;
    if (name.isCompound) {
      const leftKey = name.leftName?.key;
      if (leftKey !== undefined) {
        const leftCard = this.peekPrepared(leftKey);
        if (leftCard !== undefined) {
          leftTypeName = leftCard.typeName;
        } else {
          const leftRecord = await this.fetcher.fetchByKey(leftKey);
          if (leftRecord !== undefined) {
            leftTypeName = (await this.enrichAndStore(leftRecord)).typeName;
          }
        }
      }
    }
    return {
      name,
      id,
      typeId,
      ...(typeName !== undefined ? { typeName } : {}),
      ...(leftTypeName !== undefined ? { leftTypeName } : {}),
    };
  }

  async refreshVerdicts(): Promise<void> {
    await this.ensureVerdicts();
  }

  async ensurePermissionVerdicts(): Promise<void> {
    await this.ensureReadPermission();
    await this.ensureVerdicts();
  }

  private async ensureVerdicts(): Promise<void> {
    const state = this.readPermission;
    if (state === undefined) return;
    for (const seatKey of this.renderSeats) {
      const card = this.renderCards.get(seatKey);
      if (card === undefined) continue;
      if (card.id === undefined) {
        if (this.deniedVerdictsByKey.has(card.key)) continue;
        const allowed = await this.cardReadAllowed(
          card.name,
          undefined,
          card.record.typeId,
          card.typeName,
          undefined,
        );
        this.deniedVerdictsByKey.set(card.key, allowed === false);
        continue;
      }
      if (this.deniedVerdicts.has(card.id)) continue;
      const allowed = await this.cardReadAllowed(
        card.name,
        card.id,
        card.record.typeId,
        card.typeName,
        card.record.readRuleId,
      );
      this.deniedVerdicts.set(card.id, allowed === false);
    }
  }

  private async cardReadAllowed(
    name: DeckoName,
    id: number | undefined,
    typeId: number | undefined,
    typeName: string | undefined,
    storedReadRuleId: number | undefined,
    depth = 0,
  ): Promise<boolean | undefined> {
    const state = this.readPermission;
    if (state === undefined) return undefined;
    if (!state.alwaysOk) {
      const needsViewerKey =
        name.isCompound &&
        (name.tagKey === "*email" ||
          name.tagKey === "*account" ||
          name.tagKey === "*password" ||
          name.tagKey === "*api_key");
      const override = await readPermissionOverride(name, {
        viewerKey: needsViewerKey ? await this.resolveViewerKey() : this.readViewerKey,
        fetchByKey: (key) => this.fetcher.fetchByKey(key),
        fetchById: (cardId) => this.fetcher.fetchById(cardId),
        leftReadVerdict: (leftName, leftDepth) =>
          this.leftReadAllowed(leftName, leftDepth),
      }, depth);
      if (override !== undefined) return override;
    }
    if (id !== undefined && storedReadRuleId !== undefined) {
      return canReadByStoredRule(storedReadRuleId, state);
    }
    return canReadByRuleLookup(
      this.fetcher,
      await this.verdictPatternInput(name, id, typeId, typeName),
      state,
    );
  }

  private async leftReadAllowed(
    leftName: DeckoName,
    depth: number,
  ): Promise<boolean | undefined> {
    const leftRecord = await this.fetcher.fetchByKey(leftName.key);
    if (leftRecord === undefined) return undefined;
    return this.cardReadAllowed(
      leftRecord.name ?? leftName,
      leftRecord.id,
      leftRecord.typeId,
      undefined,
      leftRecord.readRuleId,
      depth,
    );
  }

  private async resolveViewerKey(): Promise<string | undefined> {
    if (this.readViewerKeyResolved) return this.readViewerKey;
    this.readViewerKeyResolved = true;
    const actorId = this.readViewer?.actorId;
    if (actorId === undefined) return undefined;
    const actor = await this.fetcher.fetchById(actorId);
    this.readViewerKey = actor?.key;
    return this.readViewerKey;
  }

  private populateTypeCodes(): void {
    const codenames = this.fetcher.codenames;
    for (const card of this.renderCards.values()) {
      if (card.typeCode !== undefined) continue;
      if (card.typeId === undefined) continue;
      card.typeCode = codenames.peekNameForId(card.typeId);
    }
  }

  async ensureFreshness(): Promise<void> {
    const observed = await this.readDeckDataVersion();
    if (this.deckDataVersion === undefined || observed === this.deckDataVersion) {
      this.deckDataVersion = observed;
      return;
    }
    this.resetCaches();
    this.fetcher.replayRouter.disarmRenderPlan();
    invalidateSeatedPagePayloads(this.fetcher);
    await this.fetcher.reprimeBootState();
    this.deckDataVersion = observed;
  }

  async canReadCard(record: CardRecord, typeName?: string): Promise<boolean> {
    await this.ensureReadPermission();
    if (record.id !== undefined && this.deniedVerdicts.has(record.id)) {
      return !this.deniedVerdicts.get(record.id);
    }
    const allowed =
      record.name === undefined
        ? true
        : await this.cardReadAllowed(
            record.name,
            record.id,
            record.typeId,
            typeName,
            record.readRuleId,
          );
    const denied = allowed === false;
    if (record.id !== undefined) this.deniedVerdicts.set(record.id, denied);
    else if (record.key !== undefined && record.key !== "") {
      this.deniedVerdictsByKey.set(record.key, denied);
    }
    return !denied;
  }

  cqlReadScope(): { alwaysOk: boolean; readRuleIds: number[] } | undefined {
    const state = this.readPermission;
    if (state === undefined) return undefined;
    if (state.alwaysOk) return { alwaysOk: true, readRuleIds: [] };
    return { alwaysOk: false, readRuleIds: [...state.readableRuleIds] };
  }

  async cqlPermissionOptions(): Promise<{
    alwaysOk: boolean;
    readRuleIds: number[];
  }> {
    const state = await this.ensureReadPermission();
    if (state.alwaysOk) {
      return { alwaysOk: true, readRuleIds: [] };
    }
    return { alwaysOk: false, readRuleIds: [...state.readableRuleIds] };
  }

  private peekPrepared(key: string): RenderCard | undefined {
    const card = this.renderCards.get(key);
    if (card === undefined && this.skippedStructureRefAsked !== undefined) {
      const name = this.skippedStructureRefs.get(key);
      if (name !== undefined) this.skippedStructureRefAsked.add(name);
    }
    return card;
  }

  fetchRenderCard(name: string): RenderCard | undefined {
    const requested = DeckoName.parse(name);
    const card = this.renderCards.get(requested.key);
    if (card === undefined) {
      this.demandRecorder?.add(requested.s);
      if (this.skippedStructureRefs.has(requested.key)) this.skippedStructureRefAsked?.add(requested.s);
      return undefined;
    }
    if (card.id !== undefined || card.record.isNew !== true) return card;
    if (card.name.s === requested.s) return card;
    return { ...card, name: requested, key: requested.key };
  }

  async cardExists(name: string): Promise<boolean> {
    const parsed = DeckoName.parse(name);
    if (!parsed.isCompound) {
      const seated = this.renderCards.get(parsed.key);
      if (seated !== undefined) return seated.name.s === name;
      const row = await this.fetcher.driver.query<{ id: number }>(
        "SELECT id FROM cards WHERE name = ? AND trash = 0 LIMIT 1",
        [name],
      );
      return row.rows.length > 0;
    }
    return (await this.fetcher.fetchByName(parsed)) !== undefined;
  }

  private async warmSkinParentPointer(skinName: DeckoName): Promise<void> {
    const aliasName = `${skinName.s}+parent`;
    const aliasKey = DeckoName.parse(aliasName).key;
    if (this.renderCards.has(aliasKey)) return;
    const rightId = await this.fetcher.codenames.id(SKIN_PARENT_TRAIT_CODENAME);
    if (rightId === undefined) return;
    const leftId = await this.fetcher.lexicon.id(skinName);
    if (leftId === undefined) return;
    const row = await this.fetcher.driver.query<{ id: number }>(
      "SELECT id FROM cards WHERE left_id = ? AND right_id = ? AND trash = 0 LIMIT 1",
      [leftId, rightId],
    );
    const junction = row.rows[0];
    if (junction === undefined) return;
    const rightName = await this.fetcher.lexicon.name(rightId);
    if (rightName === undefined) return;
    const composed = `${skinName.s}+${rightName.s}`;
    if (composed === aliasName) return;
    const seated =
      this.fetchRenderCard(composed) ?? (await this.prepareItemForRender(composed));
    if (seated === undefined) return;
    this.renderCards.set(aliasKey, seated);
  }

  private async warmCustomizedName(skinName: DeckoName): Promise<void> {
    if (this.customizedNameBySkinKey.has(skinName.key)) return;
    if (this.fetchRenderCard(`${skinName.s}+parent`) !== undefined) return;
    const base = `${skinName.s} customized`;
    const asked: string[] = [];
    let answer = base;
    let n = 1;
    while (await this.cardExists(answer)) {
      asked.push(answer);
      answer = `${base} ${n}`;
      n += 1;
    }
    this.customizedNameBySkinKey.set(skinName.key, { name: answer, asked });
  }

  private async seatJunctionFieldRows(rootCard: RenderCard): Promise<void> {
    if (rootCard.id === undefined) return;
    const children = (await this.fetcher.driver.query<CardsRow>(
      "SELECT * FROM cards WHERE left_id = ? AND trash = false",
      [rootCard.id],
    )).rows;
    for (const row of children) {
      const tag = row.right_id !== undefined && row.right_id !== null
        ? this.peekNameForId(row.right_id)
        : undefined;
      if (tag === undefined) continue;
      await this.prepareItemForRender(`${rootCard.name.s}+${tag}`);
    }
  }

  private async warmSignupAccountFields(rootCard: RenderCard): Promise<void> {
    if (!rootCard.setKeys.split(" ").includes("TYPE-sign_up")) return;
    const trait = this.fetcher.codenames.peekName("account") ?? "*account";
    const account = await this.prepareItemForRender(`${rootCard.name.s}+${trait}`);
    if (account !== undefined) await this.seatJunctionFieldRows(account);
  }

  private async warmBoardPillExistence(rootCard: RenderCard): Promise<void> {
    this.boardPillKnownByKey.clear();
    for (const trait of BOARD_ACCOUNT_PILL_TRAITS) {
      const name = `${rootCard.name.s}+${trait}`;
      const virtual =
        virtualSearchKnownName(name, this) !== undefined || trait === "*roles";
      this.boardPillKnownByKey.set(
        DeckoName.parse(name).key,
        virtual || (await this.cardExists(name)),
      );
    }
  }

  peekBoardPillKnown(name: string): boolean | undefined {
    return this.boardPillKnownByKey.get(DeckoName.parse(name).key);
  }

  peekCustomizedName(skinName: string): string | undefined {
    return this.customizedNameBySkinKey.get(DeckoName.parse(skinName).key)?.name;
  }

  peekKnownCardName(name: string): string | undefined {
    let key: string;
    try {
      key = DeckoName.parse(name).key;
    } catch {
      return undefined;
    }
    const id = this.fetcher.codenames.peekId(key);
    if (id === undefined) return undefined;
    return this.fetcher.codenames.peekRegisteredName(id);
  }

  async visibleSettingCodenamesFor(name: string): Promise<ReadonlyArray<string> | undefined> {
    await this.parseStructureContents(undefined, 0);
    await this.preloadDefaultTypeNames();
    const card = await this.prepareItemForRender(name);
    if (card === undefined) return undefined;
    if (card.name.leftName !== undefined) await this.prepareItemForRender(card.name.leftName.s);
    if (card.name.rightName !== undefined) await this.prepareItemForRender(card.name.rightName.s);
    return visibleSettingCodenames(this, card);
  }

  async prepareItemForRender(name: string): Promise<RenderCard | undefined> {
    const cached = this.fetchRenderCard(name);
    if (cached !== undefined) return cached;
    const record = await this.fetcher.fetchByName(name);
    if (record === undefined || record.name === undefined) {
      this.reportUnknownCard(name);
      return undefined;
    }
    return this.enrichAndStore(record);
  }

  private async enrichLinkTargetsForKnownClass(rootCard: RenderCard): Promise<void> {
    const targets: string[] = [];
    if (this.linkScanDoneKeys === undefined) this.linkScanDoneKeys = new Set();
    for (const card of this.renderCards.values()) {
      if (!this.renderSeats.has(card.key)) continue;
      if (this.linkScanDoneKeys.has(card.key)) continue;
      this.linkScanDoneKeys.add(card.key);
      const content = card.dbContent;
      if (content === undefined || content === "" || !content.includes("[[")) continue;
      collectLinkTargetNames(content, targets);
    }
    const staticHelp = this.helpResolver?.peekStaticHelpTextFor(rootCard);
    if (staticHelp !== undefined && staticHelp.includes("[[")) {
      collectLinkTargetNames(staticHelp, targets);
    }
    let seated = false;
    if (targets.length > 0) {
      await this.seatNamesByWave([...targets]);
    }
    for (const target of targets) {
      if (this.fetchRenderCard(target) !== undefined) continue;
      const prepared = await this.prepareItemForRender(target);
      if (prepared !== undefined) seated = true;
    }
    if (seated) await this.ensureVerdicts();
  }

  renderClosureNeedsCoreAdminRuntime(): boolean {
    for (const card of this.renderCards.values()) {
      const content = card.dbContent?.toString();
      if (content !== undefined && content.includes("|configs")) return true;
      if (card.typeCode === "mod") return true;
    }
    return false;
  }

  renderClosureNestsRecentCard(): boolean {
    for (const key of this.renderSeats) {
      const content = this.renderCards.get(key)?.dbContent?.toString();
      if (content === undefined || !content.includes("{{")) continue;
      for (const piece of scanNests(content)) {
        const nest = piece.nest;
        if (nest === undefined || nest.comment !== undefined) continue;
        const nameKey = nest.name.trim().toLowerCase();
        if (nameKey === "*recent" || nameKey === ":recent") return true;
      }
    }
    return false;
  }

  private async seatLastActionIds(): Promise<void> {
    const missing = new Map<number, RenderCard[]>();
    for (const card of this.renderCards.values()) {
      if (card.id === undefined || card.record.currentRevisionId !== undefined) continue;
      const list = missing.get(card.id) ?? [];
      list.push(card);
      missing.set(card.id, list);
    }
    if (missing.size === 0) return;
    const ids = [...missing.keys()];
    const { rows } = await this.fetcher.driver.query<{ card_id: number; last_id: number }>(
      `SELECT card_id, MAX(id) AS last_id FROM card_actions WHERE card_id IN (${ids.map(() => "?").join(", ")})` +
        ` AND (draft IS NULL OR draft = 0) GROUP BY card_id`,
      ids,
    );
    for (const row of rows) {
      for (const card of missing.get(Number(row.card_id)) ?? []) {
        card.record.currentRevisionId = Number(row.last_id);
      }
    }
  }

  async ensureCoreAdminRuntime(): Promise<void> {
    if (this.coreAdminRuntimeEnsured) return;
    this.coreAdminRuntimeEnsured = true;
    const host = modEngineHost(this, this.fetcher);
    bindModuleAdminHost(host);
    const before = new Set(this.renderCards.keys());
    await prepareAdminRuntime(host);
    for (const [key, card] of this.renderCards) {
      if (before.has(key)) continue;
      await this.canReadCard(card.record, card.typeName);
    }
  }

  reportUnknownCard(_key: string): void {
  }

  lastWarmupStats: WarmupStats | undefined;

  skipSyncRender: (() => boolean) | undefined;

  demandRecorder: Set<string> | undefined;
  demandSeeds: string[] | undefined;
  warmupChaseOff = false;
  warmupSidesUnscanned = false;
  skipRootClosureWalk = false;
  skipRootClosureKey: string | undefined;
  liveRequest = false;
  skipDeniedRootWalks = false;
  skipStructureRefWalks = false;
  eagerStructureRefs: ReadonlySet<string> = new Set<string>();
  readonly skippedStructureRefs = new Map<string, string>();
  skippedStructureRefAsked: Set<string> | undefined;

  async warmupLayoutReferences(
    seeds: WarmupRef[],
    scan: (card: WarmupCard, mode: WarmupMode) => WarmupScan,
    onRound?: () => Promise<void>,
    force = false,
  ): Promise<WarmupStats> {
    if (this.warmupChaseOff && !force) {
      const empty: WarmupStats = { batches: 0, statements: 0, rounds: 0, cards: 0, fallbacks: 0 };
      this.lastWarmupStats = empty;
      return empty;
    }
    const stats = await prefetchWarmupClosure(
      seeds,
      {
        driver: this.fetcher.driver,
        lexicon: this.fetcher.lexicon,
        writeToCache: (cached) => this.fetcher.writeToCache(cached),
        cacheRecord: (cached) => this.cacheFetchedRecord(cached).then(() => undefined),
        getCard: (key) => this.renderCards.get(key),
        scannedKeys: this.warmupScannedKeys,
        ...(this.fetcher.virtualCardLookup !== undefined
          ? {
              virtualLookup: async (abs: string) =>
                this.fetcher.virtualCardLookup?.(DeckoName.parse(abs)),
            }
          : {}),
        prepareFallback: async (name) => (await this.prepareItemForRender(name)) ?? undefined,
        ...(onRound !== undefined ? { onRound } : {}),
        ...(this.warmupSidesUnscanned ? { sidesUnscanned: true } : {}),
      },
      scan,
    );
    this.lastWarmupStats = stats;
    return stats;
  }

  async prepareNestClosureSearches(seeds: WarmupRef[]): Promise<number> {
    this.populateTypeCodes();
    const visited = new Set<string>();
    const queue: RenderCard[] = [];
    for (const seed of seeds) {
      let key: string | undefined;
      try {
        const parsed = DeckoName.parse(seed.name);
        key = (
          parsed.isAbsolute ? parsed : parsed.absoluteName(DeckoName.parse(seed.context))
        ).key;
      } catch {
        continue;
      }
      if (key === undefined) continue;
      const card = this.renderCards.get(key);
      if (card !== undefined && !visited.has(card.key)) queue.push(card);
    }
    let executed = 0;
    while (queue.length > 0) {
      const card = queue.shift() as RenderCard;
      if (visited.has(card.key)) continue;
      visited.add(card.key);
      for (const ref of referencedNames(card.dbContent)) {
        let refKey: string | undefined;
        try {
          const parsed = DeckoName.parse(ref.name);
          refKey = (parsed.isAbsolute ? parsed : parsed.absoluteName(card.name)).key;
        } catch {
          continue;
        }
        if (refKey === undefined) continue;
        const refCard = this.renderCards.get(refKey);
        if (refCard !== undefined && !visited.has(refCard.key)) queue.push(refCard);
        if (refCard === undefined) {
          let resolved: string;
          try {
            const pipe = ref.name.indexOf("|");
            const parsed = DeckoName.parse(pipe === -1 ? ref.name : ref.name.slice(0, pipe));
            resolved = (parsed.isAbsolute ? parsed : parsed.absoluteName(card.name)).s;
          } catch {
            continue;
          }
          const items = await this.prepareVirtualFamilySearch(resolved);
          if (items !== undefined) {
            queue.push(...items);
            executed++;
          }
        }
      }
      if (card.typeCode !== SEARCH_TYPE_CODE) continue;
      if (this.searchResults.has(this.searchCacheKey(card)) || this.searchFailures.has(this.searchCacheKey(card))) continue;
      if (this.isDenied(card)) continue;
      try {
        const items = await this.runSearch(card);
        this.searchResults.set(this.searchCacheKey(card), items);
        queue.push(...items);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.searchFailures.set(this.searchCacheKey(card), error);
        this.searchResults.set(this.searchCacheKey(card), []);
      }
      executed++;
    }
    return executed;
  }

  private pointerListHostsDone = new Set<string>();
  private accountFieldWarmDone = new Set<string>();

   private warmupScannedKeys = new Set<string>();

  private renderCardsGrewSinceClosure = false;

  private nestTypeOptTargetsDone = new Set<string>();
  private nestTypeOptScanned = new Set<string>();
  private nestTypeOptLastSize = -1;

  private async enrichNestTypeOptTargets(): Promise<void> {
    if (this.renderCards.size === this.nestTypeOptLastSize) return;
    this.nestTypeOptLastSize = this.renderCards.size;
    const need = new Set<string>();
    for (const card of this.renderCards.values()) {
      if (!this.renderSeats.has(card.key)) continue;
      if (this.nestTypeOptScanned.has(card.key)) continue;
      this.nestTypeOptScanned.add(card.key);
      const content = card.dbContent;
      if (content === undefined || content === "" || !content.includes("type:")) continue;
      for (const piece of scanNests(content)) {
        if (piece.kind !== "nest" || piece.nest === undefined) continue;
        const t = piece.nest.options.extra["type"];
        if (typeof t !== "string" || t === "" || this.nestTypeOptTargetsDone.has(t)) continue;
        if (this.fetchRenderCard(t) === undefined) need.add(t);
      }
    }
    if (need.size > 0) {
      await this.seatNamesByWave([...need]);
    }
    for (const name of need) {
      this.nestTypeOptTargetsDone.add(name);
      await this.prepareItemForRender(name);
    }
  }

  private templateLinkJunctionTargetsDone = new Set<string>();
  private waveAskedSimpleKeys?: Map<string, string>;
  private wavePrimedKeys?: Set<string>;
  private waveAskedPairs?: Map<string, { leftId: number; rightId: number; lex: Lex }>;
  private primeAskedIds?: Set<number>;
  private waveAskedSideKeyPairs = new Set<string>();
  private typeCardsPrimed = new Set<number>();
  private ruleCandidatesPrimedFor = new Set<string>();
  private setTypeCardPrimed = false;
  private templateLinkJunctionScanned = new Set<string>();
  private templateLinkJunctionLastSize = -1;

  private async enrichTemplateLinkSetJunctions(): Promise<void> {
    if (this.renderCards.size === this.templateLinkJunctionLastSize) return;
    this.templateLinkJunctionLastSize = this.renderCards.size;
    const need = new Set<string>();
    for (const card of this.renderCards.values()) {
      if (!this.renderSeats.has(card.key)) continue;
      if (this.templateLinkJunctionScanned.has(card.key)) continue;
      const content = card.dbContent;
      if (content === undefined || content === "" || !content.includes("{{")) continue;
      if (!isTemplatedNestsName(card.name)) continue;
      this.templateLinkJunctionScanned.add(card.key);
      const trunk = card.name.trunkName;
      const tagCard = this.fetchRenderCard(trunk.tagName.s);
      const base = tagCard?.record.codename === "type" ? trunk.leftName : undefined;
      for (const piece of scanNests(content)) {
        if (piece.kind !== "nest" || piece.nest === undefined) continue;
        if (piece.nest.comment !== undefined) continue;
        const raw = piece.nest.name.trim();
        if (raw === "" || raw === "_" || raw === "_self") continue;
        let nestName: DeckoName;
        try {
          nestName = DeckoName.parse(raw);
        } catch (err) {
          if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) continue;
          throw err;
        }
        if (!nestName.fieldOnly) continue;
        const composed = templateLinkSetNameFromParts(base, nestName);
        if (composed.s === "" || this.templateLinkJunctionTargetsDone.has(composed.key)) continue;
        if (this.fetchRenderCard(composed.s) !== undefined) {
          this.templateLinkJunctionTargetsDone.add(composed.key);
          continue;
        }
        need.add(composed.s);
        this.templateLinkJunctionTargetsDone.add(composed.key);
      }
    }
    if (need.size > 0) {
      await this.seatNamesByWave([...need]);
    }
    for (const name of need) await this.prepareItemForRender(name);
  }

  private async warmNestedSkinImages(): Promise<void> {
    const skinImageNames = new Set<string>();
    const pushSkin = (card: RenderCard | undefined): void => {
      if (card?.typeCode === "bootswatch_skin" && card.name !== undefined) {
        skinImageNames.add(`${card.name.s}+Image`);
      }
    };
    for (const card of this.renderCards.values()) {
      if (!this.renderSeats.has(card.key)) continue;
      pushSkin(card);
      for (const result of this.searchResults.get(card.key) ?? []) pushSkin(result);
      if (this.isPointerLikeHost(card)) {
        for (const item of this.pointerItemNamesOf(card)) {
          let key: string;
          try {
            key = DeckoName.parse(item).key;
          } catch (err) {
            if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) continue;
            throw err;
          }
          pushSkin(this.renderCards.get(key));
        }
      }
    }
    for (const imageName of skinImageNames) {
      if (this.fetchRenderCard(imageName) !== undefined) continue;
      const imageChild = await this.fetcher.fetchByName(imageName);
      if (imageChild !== undefined && imageChild.name !== undefined) {
        await this.enrichAndStore(imageChild);
      }
    }
  }

  private hasUnwalkedSeatedHost(): boolean {
    for (const key of this.renderSeats) {
      if (this.pointerListHostsDone.has(key)) continue;
      const card = this.renderCards.get(key);
      if (card === undefined) continue;
      if (
        card.typeCode === "pointer" ||
        card.typeCode === "list" ||
        card.typeCode === "search_type" ||
        card.typeCode === "skin" ||
        card.typeName === "Search"
      ) {
        return true;
      }
    }
    return false;
  }

  private async enrichPointerListItemsClosure(): Promise<void> {
    if (!this.renderCardsGrewSinceClosure && !this.hasUnwalkedSeatedHost()) return;
    this.renderCardsGrewSinceClosure = false;
    const MAX_ROUNDS = RUBY_MAX_DEPTH;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let grew = false;
      const pendingHosts: RenderCard[] = [];
      for (const card of this.renderCards.values()) {
        if (!this.renderSeats.has(card.key)) continue;
        if (!this.isPointerLikeHost(card)) continue;
        if (this.pointerListHostsDone.has(card.key)) continue;
        pendingHosts.push(card);
      }
      if (pendingHosts.length > 0) {
        const merged = new Set<string>();
        for (const host of pendingHosts) {
          for (const item of this.pointerItemNamesOf(host)) merged.add(item);
          for (const candidate of this.optionsRuleCandidatesOf(host)) merged.add(candidate);
        }
        const cqlTypeNames = new Set<string>();
        this.collectCqlItemTypeNames(pendingHosts, new Set<string>(), cqlTypeNames);
        for (const t of cqlTypeNames) merged.add(t);
        if (merged.size > 0) await this.seatNamesByWave([...merged]);
      }
      for (const card of this.renderCards.values()) {
        if (!this.renderSeats.has(card.key)) continue;
        if (
          card.name.isCompound &&
          card.name.rightName?.key === "*account" &&
          !this.accountFieldWarmDone.has(card.key)
        ) {
          this.accountFieldWarmDone.add(card.key);
          const beforeAccount = this.renderCards.size;
          await this.prepareItemForRender(`${card.name.s}+*email`);
          await this.prepareItemForRender(`${card.name.s}+*password`);
          if (this.renderCards.size !== beforeAccount) grew = true;
        }
        if (
          card.typeCode !== "pointer" &&
          card.typeCode !== "list" &&
          card.typeCode !== "search_type" &&
          card.typeCode !== "skin" &&
          card.typeName !== "Search"
        ) {
          continue;
        }
        if (this.pointerListHostsDone.has(card.key)) continue;
        const before = this.renderCards.size;
        await this.resolveHostItemTypeName(card);
        await this.enrichPointerListItems(card);
        this.pointerListHostsDone.add(card.key);
        if (this.renderCards.size !== before) grew = true;
      }
      if (!grew) return;
    }
  }

  hostItemTypeName(
    card: RenderCard,
  ): { typeName: string; typeId: number } | undefined {
    return this.itemTypeNameByHostKey.get(card.key);
  }

  pointerItemVerdict(
    hostKey: string,
    key: string,
  ): { read: boolean; create: boolean | undefined } | undefined {
    return this.pointerItemVerdicts.get(`${hostKey}|${key}`);
  }

  seatPhantomReadVerdict(key: string, denied: boolean): void {
    this.deniedVerdictsByKey.set(key, denied);
  }

  private async ensurePointerItemVerdicts(
    host: RenderCard,
    missNames: readonly string[],
    hostItemType?: { typeName: string; typeId: number },
  ): Promise<void> {
    if (missNames.length === 0) return;
    if (this.readPermission === undefined) return;
    let taskState = this.taskState;
    if (taskState === undefined) {
      const results = await this.fetcher.driver.batch(viewTaskPermissionStatements());
      taskState = viewTaskStateFromResults(results, this.readPermission);
      this.taskState = taskState;
    }
    for (const name of missNames) {
      let parsed: DeckoName;
      try {
        parsed = DeckoName.parse(name);
      } catch (err) {
        if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
          continue;
        }
        throw err;
      }
      const key = parsed.key;
      if (key === "") continue;
      const verdictKey = `${host.key}|${key}`;
      if (this.pointerItemVerdicts.has(verdictKey)) continue;
      const defaulted = hostItemType ?? this.newCardDefaultType(parsed);
      const input = {
        name: parsed,
        isNew: true,
        ...(defaulted?.typeId !== undefined ? { typeId: defaulted.typeId } : {}),
        ...(defaulted?.typeName !== undefined ? { typeName: defaulted.typeName } : {}),
      };
      const read = await canReadByRuleLookup(this.fetcher, input, this.readPermission);
      const create = await taskVerdictForCard(this.fetcher, input, "create", taskState);
      this.pointerItemVerdicts.set(verdictKey, { read: read === true, create });
      if (hostItemType === undefined && !this.pointerItemGlobalVerdictDone.has(key)) {
        this.pointerItemGlobalVerdictDone.add(key);
        this.deniedVerdictsByKey.set(key, read === false);
        const existing = this.taskVerdicts.get(key) ?? { update: undefined, create: undefined, delete: undefined };
        this.taskVerdicts.set(key, { ...existing, create });
      }
    }
  }

  private async resolveHostItemTypeName(host: RenderCard): Promise<void> {
    if (this.itemTypeNameByHostKey.has(host.key)) return;
    this.itemTypeNameByHostKey.set(host.key, undefined);
    let resolved: { typeName: string; typeId: number } | undefined;
    try {
      resolved = await this.itemTypeIdOf(host, new Set([host.key]));
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Invalid JSON search query")) {
        return;
      }
      throw err;
    }
    if (resolved !== undefined) {
      this.itemTypeNameByHostKey.set(host.key, resolved);
    }
  }

  private async itemTypeIdOf(
    card: RenderCard,
    visiting: Set<string>,
  ): Promise<{ typeName: string; typeId: number } | undefined> {
    if (
      card.typeCode === SEARCH_TYPE_CODE ||
      card.typeCode === SET_TYPE_CODE ||
      card.typeName === "Search"
    ) {
      return this.cqlItemTypeId(card);
    }
    if (card.typeCode === "pointer" || card.typeCode === "list") {
      const opt = await this.resolveOptionsCard(card);
      if (opt === undefined) return undefined;
      if (opt.key === card.key || visiting.has(opt.key)) return undefined;
      visiting.add(opt.key);
      return this.itemTypeIdOf(opt, visiting);
    }
    return undefined;
  }

  private optionsRuleCandidatesOf(host: RenderCard): string[] {
    const out: string[] = [];
    try {
      for (const candidate of ruleNamesForCard(
        this.structurePatternInputForSync(host),
        "*content options",
      )) {
        out.push(candidate);
      }
    } catch (err) {
      if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
        return out;
      }
      throw err;
    }
    return out;
  }

  private collectCqlItemTypeNames(
    hosts: readonly RenderCard[],
    visiting: Set<string>,
    out: Set<string>,
  ): void {
    for (const host of hosts) {
      this.collectCqlItemTypeNamesOf(host, visiting, out);
    }
  }

  private collectCqlItemTypeNamesOf(
    card: RenderCard,
    visiting: Set<string>,
    out: Set<string>,
  ): void {
    if (visiting.has(card.key)) return;
    visiting.add(card.key);
    if (
      card.typeCode === SEARCH_TYPE_CODE ||
      card.typeCode === SET_TYPE_CODE ||
      card.typeName === "Search"
    ) {
      const content = card.dbContent?.toString();
      if (content === undefined || content.trim() === "") return;
      let query: unknown;
      try {
        query = JSON.parse(content);
      } catch {
        return;
      }
      if (query === null || typeof query !== "object" || Array.isArray(query)) return;
      const type = (query as Record<string, unknown>)["type"];
      if (typeof type === "string" && type !== "" && type !== "_left") out.add(type);
      return;
    }
    if (card.typeCode === "pointer" || card.typeCode === "list") {
      if (this.optionsCardCache.has(card.key)) {
        const opt = this.optionsCardCache.get(card.key);
        if (opt !== undefined) this.collectCqlItemTypeNamesOf(opt, visiting, out);
      }
    }
  }

  private async cqlItemTypeId(
    card: RenderCard,
  ): Promise<{ typeName: string; typeId: number } | undefined> {
    const content = card.dbContent?.toString();
    if (content === undefined || content.trim() === "") return undefined;
    let query: unknown;
    try {
      query = JSON.parse(content);
    } catch {
      throw new Error(`Invalid JSON search query: ${content}`);
    }
    if (query === null || typeof query !== "object" || Array.isArray(query)) {
      return undefined;
    }
    const type = (query as Record<string, unknown>)["type"];
    if (typeof type === "number") {
      if (!Number.isInteger(type)) return undefined;
      return this.typeNameForTypeId(type);
    }
    if (typeof type !== "string" || type === "" || type === "_left") return undefined;
    const typeCard = await this.fetcher.fetchByName(type);
    if (typeCard?.id === undefined || typeCard.name === undefined) return undefined;
    return { typeName: typeCard.name.s, typeId: typeCard.id };
  }

  private async typeNameForTypeId(
    id: number,
  ): Promise<{ typeName: string; typeId: number } | undefined> {
    const typeCard = await this.fetcher.fetchById(id);
    if (typeCard?.name === undefined) return undefined;
    return { typeName: typeCard.name.s, typeId: id };
  }

  private pointerItemNamesOf(card: RenderCard): string[] {
    return (listItemContentOverride(card) ?? card.dbContent)
      .toString()
      .split(/\n+/)
      .map((s) => s.replace(/\[\[|\]\]/g, "").trim())
      .filter((s) => s.length > 0)
      .map((s) => resolvePointerItemName(s, card.name));
  }

  private isPointerLikeHost(card: RenderCard): boolean {
    return (
      card.typeCode === "pointer" ||
      card.typeCode === "list" ||
      card.typeCode === "search_type" ||
      card.typeCode === "skin" ||
      card.typeName === "Search"
    );
  }

  private async enrichPointerListItems(card: RenderCard): Promise<void> {
    const items = this.pointerItemNamesOf(card);
    const missNames: string[] = [];
    if (items.length > 0) {
      await this.seatNamesByWave(items);
    }
    for (const name of items) {
      try {
        if (DeckoName.parse(name).key === "") continue;
        const prepared = await this.prepareItemForRender(name);
        if (prepared === undefined) missNames.push(name);
      } catch (err) {
        if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
          const idMatch = /^~(\d+)$/.exec(name.trim());
          if (idMatch !== null) {
            const id = Number(idMatch[1] as string);
            if (Number.isSafeInteger(id)) {
              const resolved = await this.fetcher.lexicon.name(id);
              if (resolved !== undefined && resolved.s !== "") {
                const record = await this.fetcher.fetchById(id);
                if (record?.name !== undefined) {
                  await this.enrichAndStore(record);
                  continue;
                }
              }
            }
          }
          this.reportUnknownCard(name);
          missNames.push(name);
          continue;
        }
        throw err;
      }
    }
    await this.ensurePointerItemVerdicts(
      card,
      missNames,
      this.hostItemTypeName(card),
    );
  }

  private async preloadNestedSetRuleLists(rootCard: RenderCard): Promise<boolean> {
    const targets: Array<{ target: string; context: DeckoName }> = [];
    for (const card of this.renderCards.values()) {
      if (!this.renderSeats.has(card.key)) continue;
      const content = card.dbContent;
      if (content === undefined || !content.includes("setting_list")) continue;
      for (const m of content.matchAll(/\{\{([^{}|]+)\|([^{}]*)\}\}/g)) {
        if (!/\b[a-z]+_setting_list\b/.test(m[2] ?? "")) continue;
        targets.push({ target: (m[1] ?? "").trim(), context: card.name });
      }
    }
    let ran = false;
    for (const { target, context } of targets) {
      let name: string;
      try {
        const parsed = DeckoName.parse(target);
        name = parsed.isAbsolute ? parsed.s : parsed.absoluteName(context).s;
      } catch (err) {
        if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) continue;
        throw err;
      }
      const setCard = await this.prepareItemForRender(name);
      if (setCard === undefined || setCard.typeCode !== "set" || setCard.key === rootCard.key) continue;
      await this.preloadSetRules(setCard);
      ran = true;
    }
    return ran;
  }

  private async preloadSetRules(setCard: RenderCard): Promise<void> {
    if (setCard.id === undefined) return;
    if (this.setRulePreloadDoneIds?.has(setCard.id) === true) return;
    const result = await this.fetcher.driver.query<CardsRow>(
      `SELECT * FROM cards WHERE left_id = ? AND trash = 0 ` +
      `ORDER BY db_content, name`,
      [setCard.id],
    );
    if (result.rows.length > 0) {
      const rightIds = new Set<number>();
      for (const row of result.rows) {
        if (row.right_id !== null && row.right_id !== undefined) rightIds.add(row.right_id);
      }
      for (const rid of rightIds) {
        const existing = await this.fetcher.fetchById(rid);
        if (existing === undefined || existing.name === undefined) continue;
        await this.cacheFetchedRecord(existing);
      }
      for (const row of result.rows) {
        const record = await composeCardRecord(row, this.fetcher.lexicon);
        if (record.name === undefined) continue;
        await this.cacheFetchedRecord(record);
      }
    }
    await this.preloadAllSettingCards();
    const codenameTypeIds: number[] = [];
    for (const preloadCodename of RULE_TYPE_CODENAMES_FOR_PRELOAD) {
      const typeId = await this.fetcher.codenames.id(preloadCodename);
      if (typeId !== undefined) codenameTypeIds.push(typeId);
    }
    for (const preloadTypeId of [...RULE_TYPE_IDS_FOR_PRELOAD, ...codenameTypeIds]) {
      const typeRecord = await this.fetcher.fetchById(preloadTypeId);
      if (typeRecord === undefined || typeRecord.name === undefined) continue;
      await this.enrichAndStore(typeRecord);
    }
    await this.preloadVirtualRuleVerdicts(setCard);
    if (this.setRulePreloadDoneIds === undefined) this.setRulePreloadDoneIds = new Set();
    this.setRulePreloadDoneIds.add(setCard.id);
  }

  private async preloadAllSettingCards(): Promise<void> {
    const allCodenames = [
      "autoname", "default", "structure",
      "create", "read", "update", "delete", "captcha",
      "head", "layout", "style", "script",
      "help", "input_type", "guide", "content_options", "content_option_view",
      "on_create", "on_update", "on_delete",
      "thanks", "follow_fields", "follow",
    ];
    const placeholders = allCodenames.map(() => "?").join(",");
    const result = await this.fetcher.driver.query<CardsRow>(
      `SELECT * FROM cards WHERE codename IN (${placeholders}) AND trash = 0`,
      allCodenames,
    );
    for (const row of result.rows) {
      const record = await composeCardRecord(row, this.fetcher.lexicon);
      if (record.name === undefined) continue;
      await this.cacheFetchedRecord(record);
    }
  }

  private headReadsWarmed = false;

  private bootProbeVersion: number | undefined;

  private bootProbeIssued = false;

  private bootBundleFrom(
    folded: SQLQueryResult[] | undefined,
    indices: { codehashIndex: number; typeNamesIndex: number; headReadsIndex: number },
  ): BootBundle {
    const empty: SQLQueryResult = { rows: [], rowsAffected: 0 };
    return {
      version: this.bootProbeVersion,
      driver: this.fetcher.driver,
      codehash: folded?.[indices.codehashIndex] ?? empty,
      typeNames: folded?.[indices.typeNamesIndex] ?? empty,
      headReads: folded?.[indices.headReadsIndex] ?? empty,
    };
  }

  private async cacheHeadViewReads(result: SQLQueryResult | undefined): Promise<void> {
    for (const row of result?.rows ?? []) {
      const record = await composeCardRecord(row as CardsRow, this.fetcher.lexicon);
      if (record.name === undefined) continue;
      record.key = record.name.key;
      await this.cacheFetchedRecord(record);
    }
  }

  private async preloadVirtualRuleVerdicts(setCard: RenderCard): Promise<void> {
    const state = this.readPermission;
    if (state === undefined) return;
    if (this.existingRuleCards === undefined) this.existingRuleCards = new Map();
    for (const groupName of SETTING_GROUPS) {
      const groupSettings = visibleSettingsForGroup(this, setCard, groupName);
      for (const settingCodename of groupSettings) {
        const settingCard = this.findSettingCard(settingCodename);
        if (settingCard === undefined) continue;
        const name = DeckoName.parse(`${setCard.name.s}+*${settingCodename}`);
        if (this.deniedVerdictsByKey.has(name.key)) continue;
        const allowed = await this.cardReadAllowed(
          name,
          undefined,
          settingCard.typeId,
          settingCard.typeName,
          undefined,
        );
        this.deniedVerdictsByKey.set(name.key, allowed === false);
        if (!this.existingRuleCards.has(name.key)) {
          const protoInput = await this.prototypePatternInput(setCard);
          if (protoInput !== undefined) {
            const rule = await this.findPrototypeRule(
              protoInput,
              settingCard.name?.s ?? `*${settingCodename}`,
            );
            if (rule !== undefined && rule.rule.name !== undefined) {
              const ruleCard = await this.enrichAndStore(rule.rule);
              if (ruleCard !== undefined) this.existingRuleCards.set(name.key, ruleCard);
            }
          }
        }
      }
    }
  }

  private async findPrototypeRule(
    protoInput: PatternCardInput,
    setting: string,
  ): Promise<{ rule: CardRecord } | undefined> {
    const candidates = ruleNamesForCard(protoInput, setting);
    const protoName =
      protoInput.name instanceof DeckoName
        ? protoInput.name
        : DeckoName.parse(String(protoInput.name));
    const quickLeftTypeName =
      protoInput.typeId !== undefined &&
      protoInput.isNew === true &&
      protoInput.leftTypeName === undefined &&
      protoName.isCompound
        ? await this.quickTypeName(protoName.leftName)
        : undefined;
    for (const candidate of candidates) {
      if (
        protoInput.typeId === undefined &&
        /\+(\*type|\*type plus right)\+/.test(candidate)
      ) {
        continue;
      }
      const tprMatch = /^(.*)\+\*type plus right\+/.exec(candidate);
      let probe = candidate;
      if (
        tprMatch !== null &&
        quickLeftTypeName !== undefined &&
        protoInput.typeName !== undefined &&
        tprMatch[1].startsWith(`${protoInput.typeName}+`)
      ) {
        probe = `${quickLeftTypeName}${candidate.slice(String(protoInput.typeName).length)}`;
      } else if (tprMatch !== null && quickLeftTypeName === undefined) {
        continue;
      }
      let record: CardRecord | undefined;
      try {
        record = await this.fetcher.fetchByName(probe);
      } catch (err) {
        if (
          err instanceof CodenameNotFoundError ||
          err instanceof NameNotFoundError
        ) {
          continue;
        }
        throw err;
      }
      if (record !== undefined && record.name !== undefined) {
        return { rule: record };
      }
    }
    return undefined;
  }

  private async quickTypeName(name: DeckoName | undefined): Promise<string | undefined> {
    if (name === undefined) return undefined;
    const candidates = ruleNamesForCard(
      { name, id: undefined, typeId: undefined, typeName: undefined, isNew: true },
      "*default",
    );
    for (const candidate of candidates) {
      if (/\+(\*type|\*type plus right)\+/.test(candidate)) continue;
      let record: CardRecord | undefined;
      try {
        record = await this.fetcher.fetchByName(candidate);
      } catch (err) {
        if (
          err instanceof CodenameNotFoundError ||
          err instanceof NameNotFoundError
        ) {
          continue;
        }
        throw err;
      }
      if (record !== undefined && record.typeId !== undefined) {
        const typeCard = await this.fetcher.fetchById(record.typeId);
        const typeName = typeCard?.name?.s;
        if (typeName !== undefined) return typeName;
      }
    }
    return undefined;
  }

  peekAlwaysOk(): boolean | undefined {
    return this.readPermission?.alwaysOk;
  }

  isDenied(card: RenderCard): boolean {
    if (card.id !== undefined) {
      const verdict = this.deniedVerdicts.get(card.id);
      if (verdict !== undefined) return verdict;
      const state = this.readPermission;
      const storedRule = card.record.readRuleId;
      if (state === undefined || storedRule === undefined) return false;
      if (nameHasReadOverride(card.name)) return false;
      const denied = !canReadByStoredRule(storedRule, state);
      this.deniedVerdicts.set(card.id, denied);
      return denied;
    }
    return this.deniedVerdictsByKey.get(card.key) === true;
  }

  taskAllowed(card: RenderCard, task: Exclude<CrudTask, "read">): boolean | undefined {
    if (this.readPermission?.alwaysOk) return true;
    return this.taskVerdicts.get(card.key)?.[task];
  }

  private signupApprovalVerdicts = new Map<string, { approve: boolean; delete: boolean }>();

  signupApprovalVerdict(card: RenderCard): { approve: boolean; delete: boolean } | undefined {
    return this.signupApprovalVerdicts.get(card.key);
  }

  private currentTypeCreatableVerdicts = new Map<number, boolean>();

  currentTypeCreatable(typeId: number): boolean | undefined {
    if (this.readPermission?.alwaysOk) return true;
    return this.currentTypeCreatableVerdicts.get(typeId);
  }

  private async prepareCurrentTypeCreatable(card: RenderCard | undefined): Promise<void> {
    if (card === undefined || card.typeId === undefined || this.currentTypeCreatableVerdicts.has(card.typeId)) return;
    if (this.readPermission === undefined) return;
    if (this.taskState === undefined) {
      const results = await this.fetcher.driver.batch(viewTaskPermissionStatements());
      this.taskState = viewTaskStateFromResults(results, this.readPermission);
    }
    const typeName = (await this.fetcher.fetchById(card.typeId, { skipVirtual: true }))?.name?.s;
    const verdict = await taskVerdictForCard(
      this.fetcher,
      { name: "", isNew: true, typeId: card.typeId, typeName },
      "create",
      this.taskState,
    );
    this.currentTypeCreatableVerdicts.set(card.typeId, verdict === true);
  }

  private async prepareSignupApprovalVerdicts(card: RenderCard): Promise<void> {
    if (this.signupApprovalVerdicts.has(card.key)) return;
    const state = this.readPermission ?? (await this.ensureReadPermission());
    if (this.taskState === undefined) {
      const results = await this.fetcher.driver.batch(viewTaskPermissionStatements());
      this.taskState = viewTaskStateFromResults(results, state);
    }
    const approve = await signupApprovalAllowed(this.fetcher, this.taskState);
    const own = await allTaskVerdictsForCard(this.fetcher, this.structurePatternInputForSync(card), this.taskState);
    this.signupApprovalVerdicts.set(card.key, { approve, delete: own.delete === true });
  }

  async virtualSetCard(record: CardRecord): Promise<boolean> {
    if (record.name === undefined) return false;
    let leftTypeName: string | undefined;
    if (record.leftId !== undefined && record.leftId !== null) {
      const left = await this.fetcher.fetchById(record.leftId);
      leftTypeName =
        left?.typeId !== undefined && left.typeId !== null
          ? this.fetcher.codenames.peekNameForId(left.typeId) ?? undefined
          : undefined;
    }
    const typeName =
      record.typeId !== undefined && record.typeId !== null
        ? this.fetcher.codenames.peekNameForId(record.typeId) ?? undefined
        : undefined;
    return isVirtualSetCardName(record.name, {
      ...(typeName !== undefined ? { typeName } : {}),
      ...(leftTypeName !== undefined ? { leftTypeName } : {}),
    });
  }

  unknownCardCreatable(card: RenderCard): boolean {
    const verdict = this.taskAllowed(card, "create");
    if (
      verdict === undefined &&
      card.id === undefined &&
      this.readPermission !== undefined &&
      !this.unknownCreateMisses.has(card.key)
    ) {
      this.unknownCreateMisses.set(card.key, card);
    }
    return verdict === true;
  }

  private nameSessionActor: { id: number; name: string } | undefined;

  private async ensureNameSession(): Promise<void> {
    const env = getNameEnvironment();
    if (env === undefined) return;
    let name = "Anonymous";
    const session = this.pageSession;
    if (session?.signedIn === true && session.actorId !== undefined) {
      if (this.nameSessionActor?.id !== session.actorId) {
        const actor = await this.fetcher.fetchById(session.actorId, { skipVirtual: true });
        const actorName = actor?.name?.s;
        this.nameSessionActor =
          actorName === undefined || actorName === "" ? undefined : { id: session.actorId, name: actorName };
      }
      if (this.nameSessionActor !== undefined) name = this.nameSessionActor.name;
    }
    if (env.session !== name) setNameEnvironment({ ...env, session: name });
  }

  async renderWithUnknownCreateVerdicts(run: () => Promise<ViewResult>): Promise<ViewResult> {
    if (this.unknownCreateRenderDepth > 0) return run();
    this.unknownCreateRenderDepth += 1;
    try {
      await this.ensureNameSession();
      let html = await run();
      for (let pass = 0; pass < 4 && this.unknownCreateMisses.size > 0; pass++) {
        const misses = [...this.unknownCreateMisses.values()];
        this.unknownCreateMisses.clear();
        if (this.readPermission === undefined) break;
        if (this.taskState === undefined) {
          const results = await this.fetcher.driver.batch(viewTaskPermissionStatements());
          this.taskState = viewTaskStateFromResults(results, this.readPermission);
        }
        for (const card of misses) {
          if (this.taskVerdicts.get(card.key)?.create !== undefined) continue;
          const create = await taskVerdictForCard(
            this.fetcher,
            { ...this.structurePatternInputForSync(card), isNew: true },
            "create",
            this.taskState,
          );
          const existing = this.taskVerdicts.get(card.key) ?? { update: undefined, create: undefined, delete: undefined };
          this.taskVerdicts.set(card.key, { ...existing, create: create ?? false });
        }
        html = await run();
      }
      return html;
    } finally {
      this.unknownCreateMisses.clear();
      this.unknownCreateRenderDepth -= 1;
    }
  }

  resetRequestSession(): void {
    this.sessionAccountLinks = undefined;
    this.sessionAccountLinksActorId = undefined;
    this.sessionMyCardHtml = undefined;
    this.sessionMyCardHtmlFilled = undefined;
    this.sessionRolesDropdownHtml = undefined;
    this.sessionAccountLinksFilledHtml = undefined;
    this.sessionRolesContentFilled = false;
    this.sessionRolesFillConsumedThisPass = false;
    this.sessionAccountLinksHasRoles = false;
  }

  commitSessionRolesFill(): void {
    if (this.sessionRolesFillConsumedThisPass) this.sessionRolesContentFilled = true;
  }

  private get sessionRolesFillVisible(): boolean {
    return this.sessionRolesContentFilled || this.sessionRolesFillConsumedThisPass;
  }

  get pageSessionAccountLinksHtml(): string | undefined {
    return this.sessionRolesFillVisible
      ? (this.sessionAccountLinksFilledHtml ?? this.sessionAccountLinks)
      : this.sessionAccountLinks;
  }

  get pageSessionMyCardHtml(): string | undefined {
    return this.sessionRolesFillVisible ? (this.sessionMyCardHtmlFilled ?? this.sessionMyCardHtml) : this.sessionMyCardHtml;
  }

  get pageSessionRolesDropdownHtml(): string | undefined {
    return this.sessionRolesDropdownHtml;
  }

  markSessionRolesContentFilled(): void {
    if (this.sessionAccountLinksHasRoles) this.sessionRolesFillConsumedThisPass = true;
  }

  blankSessionRolesFill(): void {
    this.sessionRolesFillConsumedThisPass = false;
  }

  async prepareSessionAccountLinks(): Promise<void> {
    const session = this.pageSession;
    if (session?.signedIn !== true || session.actorId === undefined) return;
    if (
      this.sessionAccountLinks !== undefined &&
      this.sessionAccountLinksActorId === session.actorId
    ) {
      return;
    }
    const actor = await this.fetcher.fetchById(session.actorId, { skipVirtual: true });
    if (actor?.name === undefined || actor.name === null || actor.name.s === "") {
      this.pageSession = undefined;
      this.sessionAccountLinks = undefined;
      this.sessionAccountLinksActorId = undefined;
      this.sessionMyCardHtml = undefined;
      this.sessionMyCardHtmlFilled = undefined;
      this.sessionRolesDropdownHtml = undefined;
      this.sessionAccountLinksFilledHtml = undefined;
      return;
    }
    const actorName: string = actor.name.s;
    const accountSettingsName = `${actorName}+*account settings`;
    const accountSettingsRecord = await this.fetcher.fetchByKey(
      DeckoName.parse(accountSettingsName).key,
      { skipVirtual: true },
    );
    const accountSettingsReal = accountSettingsRecord !== undefined;
    const accountSettingsTypeName =
      accountSettingsRecord?.typeId !== undefined
        ? await this.fetcher.codenames.nameForId(accountSettingsRecord.typeId)
        : undefined;
    const accountSettingsVirtual =
      (await this.ruleCardForSetting(
        {
          name: DeckoName.parse(accountSettingsName),
          id: accountSettingsRecord?.id,
          typeId: accountSettingsRecord?.typeId,
          typeName: accountSettingsTypeName,
        },
        "structure",
      )) !== undefined;
    const signinId = await this.fetcher.codenames.id("signin");
    const signinReal =
      signinId !== undefined &&
      (await this.fetcher.fetchById(signinId, { skipVirtual: true })) !== undefined;
    const known = {
      actor: true,
      accountSettings: accountSettingsReal || accountSettingsVirtual,
      signin: signinReal,
    };
    const rolesInput = await this.sessionRolesInput(actor);
    this.sessionAccountLinksHasRoles = rolesInput !== undefined;
    this.sessionMyCardHtml =
      rolesInput === undefined
        ? myCardDropdownInnerHtml(actorName, known, [])
        : enabledRolesDropdownHtml(rolesInput, known, false);
    this.sessionMyCardHtmlFilled =
      rolesInput === undefined ? undefined : enabledRolesDropdownHtml(rolesInput, known, true);
    this.sessionRolesDropdownHtml =
      rolesInput === undefined
        ? myCardDropdownInnerHtml(actorName, known, [])
        : rolesAccountDropdownHtml(rolesInput, known);
    this.sessionAccountLinks = signedInAccountLinksInnerHtml(actorName, known, this.sessionMyCardHtml);
    this.sessionAccountLinksFilledHtml =
      rolesInput === undefined
        ? undefined
        : signedInAccountLinksInnerHtml(actorName, known, this.sessionMyCardHtmlFilled);
    this.sessionAccountLinksActorId = session.actorId;
  }

  private async sessionRolesInput(actor: CardRecord): Promise<SessionRolesInput | undefined> {
    const state = this.readPermission ?? (await this.ensureReadPermission());
    if (actor.id === undefined || actor.name === undefined) return undefined;
    if ((await this.fetcher.codenames.id("enabled_roles")) === undefined) return undefined;
    const anyoneId = await this.fetcher.codenames.id("anyone");
    const partyRoles = (state.grantedRoleIds ?? state.parties).filter((id) => id !== anyoneId && id !== actor.id);
    if (partyRoles.length <= 1) return undefined;
    const anyoneSignedInId = await this.fetcher.codenames.id("anyone_signed_in");
    const membersId = await this.fetcher.codenames.id("members");
    let roleIds = partyRoles;
    if (membersId !== undefined) {
      const memberRoles = partyRoles.filter((id) => id !== anyoneSignedInId);
      const placeholders = memberRoles.map(() => "?").join(", ");
      const ordered =
        memberRoles.length === 0
          ? []
          : ((
              await this.fetcher.driver.query<{ left_id: number }>(
                `SELECT left_id FROM cards WHERE right_id = ? AND trash = 0 AND left_id IN (${placeholders}) ORDER BY id`,
                [membersId, ...memberRoles],
              )
            ).rows as Array<{ left_id: number }>).map((row) => Number(row.left_id));
      const rest = memberRoles.filter((id) => !ordered.includes(id));
      roleIds = [
        ...(anyoneSignedInId !== undefined && partyRoles.includes(anyoneSignedInId) ? [anyoneSignedInId] : []),
        ...ordered,
        ...rest,
      ];
    }
    const roles: string[] = [];
    for (const id of roleIds) {
      const role = await this.fetcher.fetchById(id, { skipVirtual: true });
      if (role?.name === undefined || role.name === null) return undefined;
      roles.push(role.name.s);
    }
    const sessionTypeId = await this.fetcher.codenames.id("session");
    if (sessionTypeId === undefined) return undefined;
    const sessionType = await this.fetcher.fetchById(sessionTypeId, { skipVirtual: true });
    const actorType =
      actor.typeId === undefined ? undefined : await this.fetcher.fetchById(actor.typeId, { skipVirtual: true });
    if (sessionType?.name == null || actorType?.name == null) return undefined;
    return {
      actorName: actor.name.s,
      actorTypeKey: actorType.name.key,
      sessionTypeId,
      sessionTypeName: sessionType.name.s,
      roles,
      ...(state.grantedRoleIds === undefined ? {} : {
        enabledRoles: roles.filter((_name, index) => state.parties.includes(roleIds[index]!)),
      }),
    };
  }

  async updateVerdictForCard(card: RenderCard): Promise<boolean | undefined> {
    if (this.readPermission?.alwaysOk) return true;
    if (this.readPermission === undefined) return undefined;
    if (card.id === undefined) return undefined;
    const memoized = this.taskVerdicts.get(card.key);
    if (memoized !== undefined) return memoized.update;
    if (this.taskState === undefined) {
      const results = await this.fetcher.driver.batch(viewTaskPermissionStatements());
      this.taskState = viewTaskStateFromResults(results, this.readPermission);
    }
    const verdicts = await allTaskVerdictsForCard(
      this.fetcher,
      this.structurePatternInputForSync(card),
      this.taskState,
    );
    this.taskVerdicts.set(card.key, await this.applyUpdateOverride(card, verdicts));
    return this.taskVerdicts.get(card.key)?.update;
  }

  peekNameForId(id: number): string | undefined {
    return this.fetcher.peekNameForId(id);
  }

  canConfigure(card: RenderCard): boolean | undefined {
    if (this.readPermission?.alwaysOk) return true;
    return this.configureVerdicts.get(card.key);
  }

  async ensureConfigureVerdict(record?: CardRecord, requestedView?: string): Promise<void> {
    if (this.readPermission === undefined) return;
    if (this.readPermission.alwaysOk) return;
    const universe = this.structureContents;
    const rootKey =
      record === undefined
        ? undefined
        : (record.key ?? (record.name ? DeckoName.parse(record.name).key : undefined));
    const hosts: RenderCard[] = [];
    const consider = (card: RenderCard | undefined): void => {
      if (card === undefined || this.configureVerdicts.has(card.key)) return;
      if (hosts.includes(card)) return;
      const directiveNeeds = this.modLoader?.viewPredicateRequiredForCard(card.setKeys, "can_configure?") === true
        || (card.key === rootKey && (requestedView === "configure_button" || requestedView === "configure_link"));
      if (this.configureChecked.has(card.key) && !directiveNeeds) return;
      let nests = directiveNeeds || card.dbContent.includes("configure_button");
      if (!nests && universe !== undefined && universe.size > 0) {
        const resolved = resolveStructuredContent(this.structurePatternInputForSync(card), universe);
        nests = resolved !== undefined && resolved.templateContent.includes("configure_button");
      }
      if (nests) hosts.push(card);
      else this.configureChecked.add(card.key);
    };
    if (rootKey !== undefined) consider(this.renderCards.get(rootKey));
    for (const card of this.renderCards.values()) {
      if (this.renderSeats.has(card.key)) consider(card);
    }
    if (hosts.length === 0) return;
    if (this.taskState === undefined) {
      const results = await this.fetcher.driver.batch(viewTaskPermissionStatements());
      this.taskState = viewTaskStateFromResults(results, this.readPermission);
    }
    const byRule = new Map<string, boolean | undefined>();
    for (const card of hosts) {
      const ruleName = `${card.name.s}+*type+*structure`;
      const ruleKey = DeckoName.parse(ruleName).key;
      if (!byRule.has(ruleKey)) {
        byRule.set(
          ruleKey,
          await taskVerdictForCard(this.fetcher, { name: ruleName }, "update", this.taskState),
        );
      }
      this.configureVerdicts.set(card.key, byRule.get(ruleKey));
    }
  }

  async ensureDiscussionUpdateVerdicts(page?: {
    cardName: string;
    view: string;
  }): Promise<void> {
    if (this.readPermission === undefined) return;
    let hasDiscussionCard = false;
    for (const card of this.renderCards.values()) {
      if (!this.renderSeats.has(card.key)) continue;
      if (card.id !== undefined && card.name.rightName?.key === "discussion") {
        hasDiscussionCard = true;
        break;
      }
    }
    if (!hasDiscussionCard && !this.isBoardDiscussionPage(page)) {
      return;
    }
    if (this.taskState === undefined) {
      const results = await this.fetcher.driver.batch(viewTaskPermissionStatements());
      this.taskState = viewTaskStateFromResults(results, this.readPermission);
    }
    if (page !== undefined && this.isBoardDiscussionPage(page)) {
      await this.seatBoardPagePhantomDiscussionVerdict(page.cardName);
    }
    for (const card of this.renderCards.values()) {
      if (!this.renderSeats.has(card.key)) continue;
      if (this.taskVerdicts.has(card.key)) continue;
      if (card.name.rightName?.key !== "discussion") continue;
      if (card.id === undefined) {
        const verdicts = await allTaskVerdictsForCard(
          this.fetcher,
          this.structurePatternInputForSync(card),
          this.taskState,
        );
        this.taskVerdicts.set(card.key, {
          update: undefined,
          create: verdicts.create,
          delete: undefined,
        });
        continue;
      }
      this.taskVerdicts.set(
        card.key,
        await this.applyUpdateOverride(
          card,
          await allTaskVerdictsForCard(
            this.fetcher,
            this.structurePatternInputForSync(card),
            this.taskState,
          ),
        ),
      );
    }
  }

  private isBoardDiscussionPage(page?: { cardName: string; view: string }): boolean {
    return (
      page !== undefined &&
      page.view === "board" &&
      page.cardName !== "" &&
      this.readPermission?.signedInActorId !== undefined
    );
  }

  private async seatBoardPagePhantomDiscussionVerdict(cardName: string): Promise<void> {
    const name = DeckoName.parse(`${cardName}+discussion`);
    if (this.taskVerdicts.has(name.key)) return;
    if (this.renderCards.has(name.key)) return;
    const defaulted = this.newCardDefaultType(name);
    const verdicts = await allTaskVerdictsForCard(
      this.fetcher,
      {
        name,
        isNew: true,
        ...(defaulted?.typeId !== undefined ? { typeId: defaulted.typeId } : {}),
        ...(defaulted?.typeName !== undefined ? { typeName: defaulted.typeName } : {}),
      },
      this.taskState!,
    );
    this.taskVerdicts.set(name.key, {
      update: undefined,
      delete: undefined,
      create: verdicts.create,
    });
  }

  private async ensureTaskVerdicts(view: string): Promise<void> {
    if (this.readPermission === undefined) return;
    const rootRequiresTasks = viewRequiresTask(view);
    const cards = [...this.renderCards.values()].filter(card => this.renderSeats.has(card.key)
      && !this.taskVerdicts.has(card.key)
      && (rootRequiresTasks || this.modLoader?.viewTasksRequiredForCard(card.setKeys) === true));
    if (cards.length === 0) return;
    if (this.taskState === undefined) {
      const results = await this.fetcher.driver.batch(viewTaskPermissionStatements());
      this.taskState = viewTaskStateFromResults(results, this.readPermission);
    }
    for (const card of cards) {
      const verdicts = await allTaskVerdictsForCard(
        this.fetcher,
        this.structurePatternInputForSync(card),
        this.taskState,
      );
      this.taskVerdicts.set(card.key, await this.applyUpdateOverride(card, verdicts));
    }
  }

  private async applyUpdateOverride(
    card: RenderCard,
    verdicts: { update: boolean | undefined; create: boolean | undefined; delete: boolean | undefined },
  ): Promise<{ update: boolean | undefined; create: boolean | undefined; delete: boolean | undefined }> {
    const override = await updatePermissionOverride(card.name, {
      viewerKey: await this.resolveViewerKey(),
      fetchByKey: (key) => this.fetcher.fetchByKey(key),
      fetchById: (cardId) => this.fetcher.fetchById(cardId),
    });
    return override === undefined ? verdicts : { ...verdicts, update: override };
  }

  private async ensureCreateableTypes(): Promise<void> {
    if (this.createableTypesCache !== undefined) return;
    this.createableTypesCache = [];
    if (this.readPermission === undefined) return;
    if (this.taskState === undefined) {
      const results = await this.fetcher.driver.batch(viewTaskPermissionStatements());
      this.taskState = viewTaskStateFromResults(results, this.readPermission);
    }
    const state = this.taskState;
    const [types] = await this.fetcher.driver.batch([{
      sql:
        `SELECT c.id AS id, c.name AS name FROM cards c ` +
        `WHERE c.type_id = ` +
        `  (SELECT id FROM cards WHERE codename = 'cardtype' AND trash = 0 ORDER BY id LIMIT 1) ` +
        `AND c.trash = 0 ` +
        `AND (c.codename IS NULL OR c.codename NOT IN (` +
        `  'mod', 'set', 'setting', 'signup', 'remote_manifest_group',` +
        `  'local_script_folder_group', 'local_script_manifest_group',` +
        `  'local_style_folder_group', 'local_style_manifest_group',` +
        `  'bootswatch_skin', 'session'))`,
      params: [],
    }]);
    const ok: string[] = [];
    for (const row of (types?.rows ?? []) as Array<{ id: number; name: string }>) {
      const verdict = await taskVerdictForCard(
        this.fetcher,
        { name: "", isNew: true, typeId: row.id, typeName: row.name },
        "create",
        state,
      );
      if (verdict === true) ok.push(row.name);
    }
    ok.sort();
    this.createableTypesCache = ok;
  }

  createableTypes(): string[] {
    return this.createableTypesCache ?? [];
  }

  executeSearch(fmt: RenderFormat): RenderCard[] {
    return this.searchResults.get(this.searchCacheKey(fmt.card)) ?? [];
  }

  private searchCacheKey(card: RenderCard): string {
    if (this.renderSearchFocalKey !== card.key || this.renderSearch === undefined) return card.key;
    return `${card.key}|${JSON.stringify({ v: this.renderSearch.vars ?? {}, o: this.renderSearch.offset ?? 0 })}`;
  }

  searchResultPaging(fmt: RenderFormat): SearchResultPaging | undefined {
    return this.searchResultPagingMap.get(this.searchCacheKey(fmt.card));
  }

  searchItemCount(fmt: RenderFormat): number | undefined {
    return this.searchResultCounts.get(this.searchCacheKey(fmt.card));
  }

  searchKeyword(_card: RenderFormat["card"]): string | undefined {
    const term = this.renderSearch?.term;
    if (term !== undefined && term !== "") {
      const main = this.renderSearch?.main;
      return term.startsWith("+") && main !== undefined ? main + term : term;
    }
    const keyword = this.renderSearch?.vars?.["keyword"];
    return keyword !== undefined && keyword !== "" ? keyword : undefined;
  }

  searchResultCount(fmt: RenderFormat): number | undefined {
    return this.searchCountResults.get(this.searchCacheKey(fmt.card));
  }

  searchQueryFailure(fmt: RenderFormat): string | undefined {
    return this.searchFailures.get(this.searchCacheKey(fmt.card))?.message;
  }

  historyJsonExport(card: RenderCard, view: string): Record<string, unknown>[] | undefined {
    const seat = this.historyExport;
    return seat?.key === card.key && seat.view === view ? seat.rows : undefined;
  }

  historyRenderReader(): HistoryRenderReader | undefined {
    return this.historyReader;
  }

  updaterRenderReader(): UpdaterRenderReader | undefined {
    return this.updaterReader;
  }

  private async prepareUpdaterRender(rootCard: RenderCard): Promise<UpdaterRenderReader> {
    const cardId = rootCard.id;
    if (cardId === undefined) return { rootCardId: undefined, updaters: [] };
    const rows = await updaterOf(this.fetcher.driver, cardId);
    const updaters: UpdaterCardInfo[] = [];
    for (const row of rows) {
      const id = Number(row.id);
      const record = await this.fetcher.fetchById(id);
      updaters.push({ cardId: id, name: record?.name?.s });
    }
    return { rootCardId: cardId, updaters };
  }

  followRenderBundle(): FollowRenderBundle | undefined {
    return this.followBundle;
  }

  private async prepareHistoryRender(
    rootCard: RenderCard,
    params: HistoryRenderParams,
    source: "history" | "recent" = "history",
  ): Promise<HistoryRenderReader> {
    const driver = this.fetcher.driver;
    const cardId = rootCard.id;

    let currentUserId = -1;
    if (this.viewer.signedIn === true && this.viewer.actorId !== undefined) {
      currentUserId = this.viewer.actorId;
    } else {
      const anon = await driver.query<{ id: number }>(
        "SELECT id FROM cards WHERE codename = 'anonymous' LIMIT 1",
        [],
      );
      currentUserId = Number(anon.rows[0]?.id ?? -1);
    }

    const emptyReader: HistoryRenderReader = {
      params,
      rootCardId: cardId,
      currentUserId,
      acts: [],
      actsTotal: 0,
      cardLastAct: undefined,
      cardLastAction: undefined,
      actById: () => undefined,
      actionById: () => undefined,
      actionsOfAct: () => [],
      actionOn: () => undefined,
      actionsAffecting: () => [],
      approvedActions: (actions) => actions,
      actionCard: () => undefined,
      cardInfo: () => undefined,
      value: () => undefined,
      previousValue: () => undefined,
      typeNameForId: () => undefined,
      rootUpdateAllowed: this.taskAllowed(rootCard, "update"),
      changes: new Map(),
    };
    if (cardId === undefined) return emptyReader;

    const historyCardIdList = await historyCardIds(driver, cardId);
    const rawActs =
      source === "recent"
        ? await recentActs(driver)
        : await historyActs(driver, historyCardIdList, {
            currentUserId,
            withDrafts: true,
          });

    let requestedAct: HistoryActRow | undefined;
    const requestedActId = params.actId;
    if (requestedActId !== undefined && /^\d+$/.test(requestedActId)) {
      const wantedId = Number(requestedActId);
      const fromHistory = rawActs.find((a) => a.id === wantedId);
      requestedAct =
        fromHistory ??
        (await driver.query<HistoryActRow>("SELECT * FROM card_acts WHERE id = ?", [wantedId]))
          .rows[0];
    }

    const loadedActIds = rawActs.map((a) => a.id);
    if (requestedAct !== undefined && !loadedActIds.includes(requestedAct.id)) {
      loadedActIds.push(requestedAct.id);
    }
    const actIds = loadedActIds;
    const actions =
      actIds.length === 0
        ? ([] as HistoryActionRow[])
        : (
            await driver.query<HistoryActionRow>(
              `SELECT * FROM card_actions WHERE card_act_id IN (${actIds.map(() => "?").join(", ")}) ORDER BY id`,
              actIds,
            )
          ).rows;
    const actionIds = actions.map((a) => a.id);
    const changeRows: HistoryChangeRow[] = [];
    if (actionIds.length > 0) {
      const rows = await driver.query<{
        id: number;
        card_action_id: number;
        field: number;
        value: string | null;
      }>(
        `SELECT * FROM card_changes WHERE card_action_id IN (${actionIds.map(() => "?").join(", ")}) ORDER BY id`,
        actionIds,
      );
      for (const row of rows.rows) {
        const field = trackedFieldByIndex(Number(row.field));
        if (field === undefined) continue;
        changeRows.push({ cardActionId: Number(row.card_action_id), field, value: row.value });
      }
    }

    const cardLastAct = await lastAct(driver, cardId);
    const cardLastAction = await lastAction(driver, cardId);

    const involvedCardIds = new Set<number>();
    for (const action of actions) if (action.card_id !== null) involvedCardIds.add(Number(action.card_id));
    for (const act of rawActs) if (act.card_id !== null) involvedCardIds.add(Number(act.card_id));
    for (const act of rawActs) involvedCardIds.add(Number(act.actor_id));
    if (requestedAct !== undefined) {
      if (requestedAct.card_id !== null) involvedCardIds.add(Number(requestedAct.card_id));
      involvedCardIds.add(Number(requestedAct.actor_id));
    }
    if (rootCard.record.creatorId !== undefined) involvedCardIds.add(Number(rootCard.record.creatorId));
    const cardById = new Map<number, RenderCard>();
    const cardInfoById = new Map<number, HistoryActionCardInfo>();
    for (const id of involvedCardIds) {
      const record = await this.fetcher.fetchById(id);
      if (record === undefined || record.name === undefined) continue;
      const renderCard = await this.enrichAndStore(record);
      cardById.set(id, renderCard);
      cardInfoById.set(id, {
        cardId: id,
        name: renderCard.name.s,
        typeId: record.typeId ?? null,
        typeName: renderCard.typeName,
        renderCard,
      });
    }
    if (this.peekCodenameById !== undefined) {
      let styleModsWarmed = false;
      for (const renderCard of cardById.values()) {
        if (this.peekCodenameById(renderCard.typeId ?? -1) !== "bootswatch_skin") continue;
        const n = renderCard.name.s;
        await this.prepareItemForRender(`${n}+*colors`);
        await this.prepareItemForRender(`${n}+*variables`);
        await this.prepareItemForRender(`${n}+*stylesheets`);
        await this.prepareItemForRender(`${n}+parent`);
        if (!styleModsWarmed) {
          await this.prepareItemForRender("style: mods");
          styleModsWarmed = true;
        }
      }
    }

    const valueCache = new Map<number, Map<string, string | number | boolean | null | undefined>>();
    const previousCache = new Map<number, Map<string, string | number | boolean | null | undefined>>();
    const diffFields = ["name", "type_id", "db_content"] as const;
    const projections = await Promise.allSettled(actions.map(async (action) => {
      if (action.card_id === null || !cardInfoById.has(Number(action.card_id))) return;
      for (const field of diffFields) {
        const value = await actionValue(driver, action, field);
        const previous = await actionPreviousValue(driver, action, field);
        let own = valueCache.get(action.id);
        if (own === undefined) valueCache.set(action.id, (own = new Map()));
        own.set(field, value);
        let ownPrev = previousCache.get(action.id);
        if (ownPrev === undefined) previousCache.set(action.id, (ownPrev = new Map()));
        ownPrev.set(field, previous);
      }
    }));
    for (const projection of projections) {
      if (projection.status === "rejected") throw projection.reason;
    }

    const typeNames = new Map<number, string>();
    for (const id of involvedCardIds) {
      const info = cardInfoById.get(id);
      if (info?.typeId !== undefined && info.typeId !== null && !typeNames.has(info.typeId)) {
        const record = await this.fetcher.fetchById(info.typeId);
        if (record?.name !== undefined) typeNames.set(info.typeId, record.name.s);
      }
    }

    await this.ensureVerdicts();
    for (const [involvedId, renderCard] of cardById) {
      if (this.deniedVerdicts.has(involvedId)) continue;
      const allowed = await this.cardReadAllowed(
        renderCard.name,
        involvedId,
        renderCard.record.typeId,
        renderCard.typeName,
        renderCard.record.readRuleId,
      );
      this.deniedVerdicts.set(involvedId, allowed === false);
    }
    const cleanActs = rawActs.filter(
      (act) => act.card_id !== null && cardInfoById.has(Number(act.card_id)),
    );
    const rootHistoryIds = new Set(historyCardIdList);
    return this.finishHistoryReader(rootCard, params, currentUserId, {
      rawActs: cleanActs,
      actions,
      changeRows,
      cardInfoById,
      valueCache,
      previousCache,
      typeNames,
      cardLastAct,
      cardLastAction,
      rootHistoryIds,
      requestedAct,
    });
  }

  private async finishHistoryReader(
    rootCard: RenderCard,
    params: HistoryRenderParams,
    currentUserId: number,
    loaded: {
      rawActs: HistoryActRow[];
      actions: HistoryActionRow[];
      changeRows: HistoryChangeRow[];
      cardInfoById: Map<number, HistoryActionCardInfo>;
      valueCache: Map<number, Map<string, string | number | boolean | null | undefined>>;
      previousCache: Map<number, Map<string, string | number | boolean | null | undefined>>;
      typeNames: Map<number, string>;
      cardLastAct: HistoryActRow | undefined;
      cardLastAction: HistoryActionRow | undefined;
      rootHistoryIds: Set<number> | undefined;
      requestedAct: HistoryActRow | undefined;
    },
  ): Promise<HistoryRenderReader> {
    const cardId = rootCard.id;
    const {
      rawActs,
      actions,
      changeRows,
      cardInfoById,
      valueCache,
      previousCache,
      typeNames,
      cardLastAct,
      cardLastAction,
      rootHistoryIds,
      requestedAct,
    } = loaded;
    const actionsByActRaw = new Map<number, HistoryActionRow[]>();
    for (const action of actions) {
      if (action.card_act_id === null) continue;
      const actId = Number(action.card_act_id);
      const list = actionsByActRaw.get(actId);
      if (list === undefined) actionsByActRaw.set(actId, [action]);
      else list.push(action);
    }
    const acts = rawActs.filter((act) =>
      (actionsByActRaw.get(act.id) ?? []).some(
        (a) => a.card_id !== null && this.deniedVerdicts.get(Number(a.card_id)) !== true,
      ),
    );
    const actByIdMap = new Map<number, HistoryActRow>(acts.map((a) => [a.id, a]));
    if (requestedAct !== undefined && !actByIdMap.has(requestedAct.id)) {
      actByIdMap.set(requestedAct.id, requestedAct);
    }
    const actionByIdMap = new Map<number, HistoryActionRow>(actions.map((a) => [a.id, a]));
    const changesByAction = new Map<number, HistoryChangeRow[]>();
    for (const change of changeRows) {
      const list = changesByAction.get(change.cardActionId);
      if (list === undefined) changesByAction.set(change.cardActionId, [change]);
      else list.push(change);
    }
    const readValue = (
      action: HistoryActionRow,
      field: "name" | "type_id" | "db_content" | "content" | "trash",
    ): string | number | boolean | null | undefined =>
      valueCache.get(action.id)?.get(field === "content" ? "db_content" : field);

    const readPrevious = (
      action: HistoryActionRow,
      field: "name" | "type_id" | "db_content" | "content" | "trash",
    ): string | number | boolean | null | undefined =>
      previousCache.get(action.id)?.get(field === "content" ? "db_content" : field);

    return {
      params,
      rootCardId: cardId,
      currentUserId,
      acts,
      actsTotal: acts.length,
      cardLastAct,
      cardLastAction,
      actById: (id) => actByIdMap.get(id),
      actionById: (id) => actionByIdMap.get(id),
      actionsOfAct: (actId) => actionsByActRaw.get(actId) ?? [],
      actionOn: (actId, onCardId) =>
        (actionsByActRaw.get(actId) ?? []).find((a) => a.card_id === onCardId && a.draft !== 1),
      actionsAffecting: (actId, affectingCardId) =>
        (actionsByActRaw.get(actId) ?? []).filter(
          (a) =>
            a.card_id === affectingCardId ||
            (a.card_id !== null && rootHistoryIds?.has(Number(a.card_id)) === true),
        ),
      approvedActions: (list) =>
        list.filter((a) => {
          if (a.card_id === null) return false;
          const info = cardInfoById.get(Number(a.card_id));
          if (info === undefined) return false;
          return this.deniedVerdicts.get(Number(a.card_id)) !== true;
        }),
      actionCard: (a) => (a.card_id === null ? undefined : cardInfoById.get(Number(a.card_id))),
      cardInfo: (id) => cardInfoById.get(id),
      value: readValue,
      previousValue: readPrevious,
      typeNameForId: (typeId) => typeNames.get(typeId),
      rootUpdateAllowed: this.taskAllowed(rootCard, "update"),
      changes: changesByAction,
    };
  }

  collectRules(host: RenderCard): RenderCard[] {
    if (host.id === undefined) return [];
    const out: RenderCard[] = [];
    for (const card of this.renderCards.values()) {
      if (card.id === host.id) continue;
      if (!card.name.isCompound) continue;
      const leftKey = card.name.leftName?.key;
      if (leftKey === undefined) continue;
      const leftId = this.idsByKey.get(leftKey);
      if (leftId === host.id) out.push(card);
    }
    return out;
  }

  peekCodenameById(typeId: number): string | undefined {
    return this.fetcher.codenames.peekNameForId(typeId);
  }

  peekIdByCodename(codename: string): number | undefined {
    return this.fetcher.codenames.peekId(codename);
  }

  peekRegisteredNameForId(id: number): string | undefined {
    return this.fetcher.codenames.peekRegisteredName(id);
  }

  private pageHeadBytes = new Map<string, string>();
  seatPageHead(rootKey: string, bytes: string): void {
    this.pageHeadBytes.set(rootKey, bytes);
  }
  pageHeadBytesFor(rootKey: string): string | undefined {
    return this.pageHeadBytes.get(rootKey);
  }

  findSettingCard(codename: string): RenderCard | undefined {
    for (const card of this.renderCards.values()) {
      if (card.record.codename === codename) return card;
    }
    return undefined;
  }

  findRenderCardById(id: number): RenderCard | undefined {
    for (const card of this.renderCards.values()) {
      if (card.id === id) return card;
    }
    return undefined;
  }

  setClassesWithRules(host: RenderCard): SettingClassWithRules[] {
    const out: SettingClassWithRules[] = [];
    const hostKey = host.key;
    if (hostKey === "") return out;
    const settingBuckets = new Map<string, RenderCard[]>();
    for (const card of this.renderCards.values()) {
      if (card.id === undefined) continue;
      if (!card.name.isCompound) continue;
      if (card.name.rightName?.key !== hostKey) continue;
      if (this.isDenied(card)) continue;
      const leftKey = card.name.leftName?.key;
      if (leftKey === undefined) continue;
      const left = this.peekPrepared(leftKey);
      if (left === undefined || left.typeCode !== "set") continue;
      let bucketKey = leftKey;
      if (left.name.isCompound) {
        const leftRightKey = left.name.rightName?.key;
        if (leftRightKey !== undefined) bucketKey = leftRightKey;
      }
      const bucket = settingBuckets.get(bucketKey);
      if (bucket === undefined) {
        settingBuckets.set(bucketKey, [card]);
      } else {
        bucket.push(card);
      }
    }
    const byteOrder = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
    for (const klass of [...SETTING_CLASSES].reverse()) {
      const bucketKey = DeckoName.parse(klass.patternCardName).key;
      const rules = settingBuckets.get(bucketKey);
      if (rules === undefined || rules.length === 0) continue;
      rules.sort((a, b) => {
        const contentOrder = byteOrder(a.record.dbContent ?? "", b.record.dbContent ?? "");
        if (contentOrder !== 0) return contentOrder;
        return (a.id ?? 0) - (b.id ?? 0);
      });
      out.push({
        klass,
        rules,
        anchorless: klass.anchorName === undefined,
      });
    }
    return out;
  }

  private isPermissionRightHost(card: RenderCard): boolean {
    if (!card.name.isCompound) return false;
    const rightKey = card.name.rightName?.key;
    if (rightKey === undefined) return false;
    const right = this.peekPrepared(rightKey);
    const codename = right?.record.codename;
    return codename !== undefined && PERMISSION_RIGHT_CODENAMES.has(codename);
  }

  private async itemOptionsParseFailure(
    card: RenderCard,
    seen: Set<string>,
  ): Promise<string | undefined> {
    const opt = await this.resolveOptionsCard(card);
    if (opt === undefined) return undefined;
    if (seen.has(opt.key)) return undefined;
    seen.add(opt.key);
    if (opt.typeCode === SEARCH_TYPE_CODE || opt.typeCode === SET_TYPE_CODE) {
      const raw = opt.dbContent;
      if (raw === "") return "";
      try {
        JSON.parse(raw);
        return undefined;
      } catch {
        return raw;
      }
    }
    if (opt.typeCode === "pointer" || opt.typeCode === "list") {
      return this.itemOptionsParseFailure(opt, seen);
    }
    return undefined;
  }

  private async resolveOptionsCard(card: RenderCard): Promise<RenderCard | undefined> {
    const cached = this.optionsCardCache.get(card.key);
    if (this.optionsCardCache.has(card.key)) return cached;
    let resolved: RenderCard | undefined;
    const rule = await this.ruleCardForSetting(
      this.structurePatternInputForSync(card),
      "content_options",
    );
    if (rule !== undefined && rule.name !== undefined) {
      resolved = await this.enrichAndStore(rule);
    }
    if (resolved === undefined && card.name.isCompound) {
      const rightKey = card.name.rightName?.key;
      const right = rightKey !== undefined ? this.peekPrepared(rightKey) : undefined;
      const rightTypeId = right?.record.typeId;
      if (
        rightTypeId !== undefined &&
        this.fetcher.codenames.peekNameForId(rightTypeId) === CARDTYPE_TYPE_CODE
      ) {
        this.optionsCardCache.set(card.key, undefined);
        return undefined;
      }
    }
    if (resolved === undefined) {
      const allRecord = await this.fetcher.fetchByName("*all");
      if (allRecord !== undefined && allRecord.name !== undefined) {
        resolved = await this.enrichAndStore(allRecord);
      }
    }
    this.optionsCardCache.set(card.key, resolved);
    return resolved;
  }

  private async setHostOptionsParseFailure(
    host: RenderCard,
  ): Promise<string | undefined> {
    if (this.setHostChainCache.has(host.key)) {
      return this.setHostChainCache.get(host.key);
    }

    const settings = ["content_options", "help", "structure", "default"];

    for (const settingCode of settings) {
      const rule = await this.ruleCardForSetting(
        this.structurePatternInputForSync(host),
        settingCode,
      );
      if (rule !== undefined && rule.name !== undefined) {
        const ruleCard = await this.enrichAndStore(rule);
        if (ruleCard !== undefined) {
          const fail = this.ruleCardParseFailure(ruleCard);
          if (fail !== undefined) {
            this.setHostChainCache.set(host.key, fail);
            return fail;
          }
          if (
            ruleCard.typeCode === "pointer" || ruleCard.typeCode === "list"
          ) {
            const optFail = await this.itemOptionsParseFailure(
              ruleCard,
              new Set([host.key, ruleCard.key]),
            );
            if (optFail !== undefined) {
              this.setHostChainCache.set(host.key, optFail);
              return optFail;
            }
          }
        }
      }
    }

    const recentRuleRecord = await this.fetcher.fetchByName("*recent settings+*self+*content options");
    if (recentRuleRecord !== undefined && recentRuleRecord.name !== undefined) {
      const recentRule = await this.enrichAndStore(recentRuleRecord);
      if (recentRule !== undefined) {
        const fail = this.ruleCardParseFailure(recentRule);
        if (fail !== undefined) {
          this.setHostChainCache.set(host.key, fail);
          return fail;
        }
      }
    }

    this.setHostChainCache.set(host.key, undefined);
    return undefined;
  }

  private ruleCardParseFailure(card: RenderCard): string | undefined {
    if (card.typeCode !== SEARCH_TYPE_CODE) {
      return undefined;
    }
    const raw = card.dbContent;
    if (raw === "") return "";
    try {
      JSON.parse(raw);
      return undefined;
    } catch {
      return raw;
    }
  }


  private async parseRuleTypeIds(
    folded: SQLQueryResult[] | undefined,
    permissionStatementCount: number,
  ): Promise<void> {
    const result = folded !== undefined ? folded[permissionStatementCount] : undefined;
    if (result !== undefined) {
      this.fetcher.codenames.foldCodehashResults(result);
    } else {
      await this.fetcher.codenames.ensureLoaded();
    }
    this.ruleTypeIds = {
      setting: this.fetcher.codenames.peekId("setting"),
      set: this.fetcher.codenames.peekId("set"),
      user: this.fetcher.codenames.peekId("user"),
    };
  }

  hasExistingRuleFor(key: string): boolean | undefined {
    if (this.existingRuleCards === undefined) return undefined;
    return this.existingRuleCards.has(key);
  }

  existingRuleFor(key: string): RenderCard | undefined {
    return this.existingRuleCards?.get(key);
  }

  private async prototypePatternInput(setCard: RenderCard): Promise<PatternCardInput | undefined> {
    const rightName = setCard.name.rightName;
    const codenameOf = async (name: string | undefined): Promise<string | undefined> => {
      if (name === undefined) return undefined;
      let card = this.fetchRenderCard(name);
      if (card === undefined) {
        const record = await this.fetcher.fetchByName(name);
        if (record !== undefined) card = await this.enrichAndStore(record);
      }
      const id = card?.id;
      return id !== undefined ? this.peekCodenameById(id) : undefined;
    };
    const patternCode =
      rightName !== undefined ? await codenameOf(rightName.s) : await codenameOf(setCard.name.s);
    const anchorName = setCard.name.leftName?.s;
    const fetchAnchor = async (): Promise<RenderCard | undefined> => {
      if (anchorName === undefined) return undefined;
      let real = this.fetchRenderCard(anchorName);
      if (real === undefined) {
        const record = await this.fetcher.fetchByName(anchorName);
        if (record !== undefined) real = await this.enrichAndStore(record);
      }
      return real;
    };
    switch (patternCode) {
      case "all":
        return { name: DeckoName.parse(""), id: undefined, typeId: undefined, typeName: undefined, isNew: true };
      case "all_plus":
      case "rstar":
      case "rule":
      case "star": {
        const protoName =
          patternCode === "all_plus"
            ? "+"
            : patternCode === "rstar"
              ? "*dummy+*dummy"
              : patternCode === "rule"
                ? "*all+*create"
                : "*dummy";
        const parsed = DeckoName.parse(protoName);
        const defaultType = this.newCardDefaultType(parsed);
        return {
          name: parsed,
          id: undefined,
          typeId: defaultType?.typeId,
          typeName: defaultType?.typeName,
          isNew: true,
        };
      }
      case "self": {
        const real = await fetchAnchor();
        if (real !== undefined && real.id !== undefined) {
          return { name: real.name, id: real.id, typeId: real.typeId, typeName: real.typeName, isNew: false };
        }
        return anchorName !== undefined
          ? { name: DeckoName.parse(anchorName), id: undefined, typeId: undefined, isNew: true }
          : undefined;
      }
      case "type": {
        const typeCard = await fetchAnchor();
        if (typeCard === undefined || typeCard.id === undefined) {
          return { name: DeckoName.parse(""), id: undefined, typeId: undefined, isNew: true };
        }
        return {
          name: DeckoName.parse(""),
          id: undefined,
          typeId: typeCard.id,
          typeName: typeCard.name,
          isNew: true,
        };
      }
      case "right": {
        if (anchorName === undefined) return undefined;
        const parsed = DeckoName.parse(`*dummy+${anchorName}`);
        const defaultType = this.newCardDefaultType(parsed);
        return {
          name: parsed,
          id: undefined,
          typeId: defaultType?.typeId,
          typeName: defaultType?.typeName,
          isNew: true,
        };
      }
      case "type_plus_right": {
        const leftName = setCard.name.leftName;
        const rightPart = leftName?.rightName?.s;
        const typeName = leftName?.leftName?.s;
        if (rightPart === undefined || typeName === undefined) return undefined;
        const parsed = DeckoName.parse(`*dummy+${rightPart}`);
        const defaultType = this.newCardDefaultType(parsed, typeName);
        return {
          name: parsed,
          id: undefined,
          typeId: defaultType?.typeId,
          typeName: defaultType?.typeName,
          leftTypeName: typeName,
          isNew: true,
        };
      }
      default:
        return undefined;
    }
  }

  cardMatchesRuleSet(card: RenderCard): boolean {
    const ids = this.ruleTypeIds;
    if (ids === undefined || ids.setting === undefined || ids.set === undefined) {
      return false;
    }
    if (!card.name.isCompound) return false;
    if (card.setKeys.split(/\s+/).includes("RULE")) return true;
    const rightKey = card.name.rightName?.key;
    const leftKey = card.name.leftName?.key;
    if (rightKey === undefined || leftKey === undefined) return false;
    const rightRecord = this.peekPrepared(rightKey);
    const leftRecord = this.peekPrepared(leftKey);
    if (rightRecord === undefined || leftRecord === undefined) return false;
    return (
      rightRecord.record.typeId === ids.setting &&
      leftRecord.record.typeId === ids.set
    );
  }

  cardIsRule(card: RenderCard): boolean {
    const ids = this.ruleTypeIds;
    if (ids === undefined || ids.setting === undefined || ids.set === undefined) {
      return false;
    }
    const name = card.name;
    if (!name.isCompound || name.parts.length !== 3) return false;
    const rightKey = name.rightName?.key;
    const leftKey = name.leftName?.key;
    if (rightKey === undefined || leftKey === undefined) return false;
    const rightRecord = this.peekPrepared(rightKey);
    const leftRecord = this.peekPrepared(leftKey);
    if (rightRecord === undefined || leftRecord === undefined) return false;
    return (
      rightRecord.record.typeId === ids.setting &&
      leftRecord.record.typeId === ids.set
    );
  }

  private async computeIsRule(
    name: DeckoName,
    leftRecord: CardRecord | undefined,
  ): Promise<boolean | undefined> {
    const ids = this.ruleTypeIds;
    if (ids === undefined || ids.setting === undefined || ids.set === undefined) {
      return undefined;
    }
    const rightTypeId = await this.fetchTypeIdForPart(name.rightName);
    if (rightTypeId === undefined || rightTypeId !== ids.setting) return false;
    if (name.parts.length > 2) {
      const standardLeftTypeId = await this.fetchTypeIdForPart(name.leftName);
      if (standardLeftTypeId === ids.set) return true;
    } else if (leftRecord !== undefined && leftRecord.typeId === ids.set) {
      return true;
    }
    if (name.parts.length > 2) {
      const trunkTypeId = await this.fetchTypeIdForPart(
        DeckoName.parse(name.parts.slice(0, -2).join("+")),
      );
      if (trunkTypeId !== ids.set) return false;
      const prefererPart = name.parts[name.parts.length - 2] ?? "";
      const prefererTypeId = await this.fetchTypeIdForPart(DeckoName.parse(prefererPart));
      if (ids.user !== undefined && prefererTypeId === ids.user) return true;
      const prefererKey = DeckoName.parse(prefererPart).key;
      const prefererRecord =
        prefererKey !== "" ? ((await this.fetcher.fetchByName(prefererKey)) ?? undefined) : undefined;
      return prefererRecord?.codename === "all";
    }
    return false;
  }

  private async fetchTypeIdForPart(part: DeckoName | undefined): Promise<number | undefined> {
    if (part === undefined) return undefined;
    const key = part.key;
    if (key === "") return undefined;
    const record = (await this.fetcher.fetchByName(key)) ?? undefined;
    return record?.typeId;
  }

  private closureSurface(record: CardRecord): Set<string> {
    if (record.key === undefined || record.key === "") return new Set<string>();
    return this.closureSurfaceFromKey(record.key);
  }

  private closureSurfaceFromKey(rootKey: string): Set<string> {
    const surface = new Set<string>();
    if (!this.renderCards.has(rootKey)) return surface;
    const queue: string[] = [rootKey];
    while (queue.length > 0) {
      const key = queue.pop() as string;
      if (surface.has(key)) continue;
      const card = this.renderCards.get(key);
      if (card === undefined) continue;
      surface.add(key);
      for (const ref of this.cardReferenceKeys(card)) {
        if (this.structureRefMisses.has(ref)) continue;
        if (!surface.has(ref) && this.renderCards.has(ref)) queue.push(ref);
      }
    }
    return surface;
  }

  private closureWarm(record: CardRecord): boolean {
    if (record.key === undefined || record.key === "") return false;
    if (!this.renderCards.has(record.key)) return false;
    const seen = new Set<string>();
    const queue: string[] = [record.key];
    while (queue.length > 0) {
      const key = queue.pop() as string;
      if (seen.has(key)) continue;
      seen.add(key);
      const card = this.renderCards.get(key);
      if (card === undefined) return false;
      const tagKey =
        card.name !== undefined && card.name.isCompound
          ? DeckoName.parse(card.name.tag).key
          : undefined;
      if (
        (tagKey === "*html_message" || tagKey === "*text_message") &&
        card.name.leftName !== undefined
      ) {
        const junctionKey = `${card.name.leftName.key}+*test_context`;
        const junction = this.renderCards.get(junctionKey);
        if (junction === undefined) return false;
        const firstItem = (junction.dbContent ?? "")
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line !== "");
        if (firstItem !== undefined && !this.renderCards.has(DeckoName.parse(firstItem).key)) {
          return false;
        }
      }
      for (const ref of this.cardReferenceKeys(card)) {
        if (this.structureRefMisses.has(ref)) continue;
        if (!this.renderCards.has(ref)) return false;
        if (!seen.has(ref)) queue.push(ref);
      }
      if (card.typeCode === SEARCH_TYPE_CODE && !this.searchResults.has(card.key)) {
        return false;
      }
    }
    return true;
  }

  private cardReferenceKeys(card: RenderCard): string[] {
    const keys: string[] = [];
    for (const ref of referencedNames(card.dbContent)) {
      if (ref.relative) continue;
      const pipe = ref.name.indexOf("|");
      const base = pipe === -1 ? ref.name : ref.name.slice(0, pipe);
      let key: string;
      try {
        key = DeckoName.parse(base).absoluteName(card.name).key;
      } catch (err) {
        if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) continue;
        throw err;
      }
      if (key !== "") keys.push(key);
    }
    return keys;
  }

  private async cacheFetchedRecord(record: CardRecord): Promise<void> {
    if (record.key === undefined || record.key === "") return;
    const kept = this.fetcher.peekStaleCard(record.key);
    if (kept !== undefined) {
      await this.enrichAndStore(kept);
      return;
    }
    this.fetcher.writeToCache(record);
    await this.enrichAndStore(record);
  }

  private async enrichAndStore(record: CardRecord): Promise<RenderCard> {
    const key = record.key as string;
    const existing = this.renderCards.get(key);
    if (existing !== undefined) return existing;

    const name = record.name ?? DeckoName.parse("");
    const typeId = record.typeId;
    let typeName: string | undefined;
    let typeCode: string | undefined;
    if (typeId !== undefined) {
      const typeRecord =
        (await this.fetcher.retrieveFromCacheById(typeId)) ??
        (await this.fetcher.fetchById(typeId));
      typeName = typeRecord?.name?.s;
      typeCode = this.fetcher.codenames.peekNameForId(typeId);
    }
    let leftTypeName: string | undefined;
    let leftRecord: CardRecord | undefined;
    if (name.isCompound) {
      const leftKey = name.leftName?.key;
      leftRecord =
        leftKey !== undefined
          ? (await this.fetcher.fetchByName(leftKey)) ?? undefined
          : undefined;
      if (leftRecord !== undefined) {
        const leftCard = await this.enrichAndStore(leftRecord);
        leftTypeName = leftCard.typeName;
      }
    }
    const isRule = name.isCompound ? await this.computeIsRule(name, leftRecord) : false;
    if (name.isCompound && isRule === undefined) this.setKeysPendingRuleTypes.add(key);
    const card: RenderCard = {
      record,
      name,
      key,
      typeName,
      typeId,
      typeCode,
      id: record.id,
      dbContent: cardContent(record),
      setKeys: safeSetKeys({
        name,
        typeId,
        typeName,
        leftTypeName,
        isRule,
        ...(record.isNew ? { isNew: true } : {}),
      }),
    };
    this.renderCards.set(key, card);
    if (record.id !== undefined) this.idsByKey.set(key, record.id);
    this.renderSeats.add(key);
    this.renderCardsGrewSinceClosure = true;
    return card;
  }

  private async prepareSearches(root: CardRecord): Promise<void> {
    const visited = new Set<string>();
    const queue: CardRecord[] = [root];
    while (queue.length > 0) {
      const current = queue.shift() as CardRecord;
      const key = current.key;
      if (key === undefined || visited.has(key)) continue;
      visited.add(key);
      const card = this.renderCards.get(key);
      if (card === undefined) continue;
      for (const refKey of this.cardReferenceKeys(card)) {
        const refCard = this.renderCards.get(refKey);
        if (refCard !== undefined && !visited.has(refKey)) queue.push(refCard.record);
      }
      for (const ref of referencedNames(card.dbContent)) {
        const relative = ref.relative;
        const pipe = ref.name.indexOf("|");
        const base = pipe === -1 ? ref.name : ref.name.slice(0, pipe);
        let resolvedName: string;
        try {
          resolvedName = DeckoName.parse(base).absolute(card.name);
        } catch (err) {
          if (!relative) continue;
          if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) continue;
          throw err;
        }
        if (resolvedName === undefined || resolvedName === "") continue;
        const refKey = DeckoName.parse(resolvedName).key;
        let refCard = this.renderCards.get(refKey);
        if (!relative) {
          if (refCard === undefined) {
            const items = await this.prepareVirtualFamilySearch(resolvedName);
            for (const item of items ?? []) {
              if (!visited.has(item.key)) queue.push(item.record);
            }
          }
          continue;
        }
        if (refCard === undefined) {
          refCard = await this.prepareItemForRender(resolvedName);
        }
        if (refCard === undefined) {
          const items = await this.prepareVirtualFamilySearch(resolvedName);
          for (const item of items ?? []) {
            if (!visited.has(item.key)) queue.push(item.record);
          }
        }
        if (refCard !== undefined && !visited.has(refCard.key)) queue.push(refCard.record);
      }
      if (this.isDenied(card)) continue;
      if (card.typeCode === SEARCH_TYPE_CODE) {
        const searchKey = this.searchCacheKey(card);
        if (this.searchResults.has(searchKey) || this.searchFailures.has(searchKey)) continue;
        try {
          const items = await this.runSearch(card);
          this.searchResults.set(searchKey, items);
          for (const item of items) {
            if (!visited.has(item.key)) queue.push(item.record);
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.searchFailures.set(searchKey, error);
          this.searchResults.set(searchKey, []);
        }
        continue;
      }
    }
  }

  private codenameHolderKey = (codename: string): string | undefined => {
    const id = this.peekIdByCodename(codename);
    const holder = id !== undefined ? this.peekRegisteredNameForId(id) : undefined;
    return holder !== undefined ? DeckoName.parse(holder).key : undefined;
  };

  private async prepareVirtualFamilySearch(resolvedName: string): Promise<RenderCard[] | undefined> {
    let name: DeckoName;
    try {
      name = DeckoName.parse(resolvedName);
    } catch {
      return undefined;
    }
    const cql = virtualSearchCqlFor(name, this.codenameHolderKey);
    if (cql === undefined) return undefined;
    const key = name.key;
    if (this.searchResults.has(key) || this.searchFailures.has(key)) return undefined;
    const items = await this.runSearch({ name, key, dbContent: cql } as RenderCard);
    this.searchResults.set(key, items);
    return items;
  }

  optionsCardSource(card: RenderCard):
    | { source: "rule"; card: RenderCard }
    | { source: "right-type"; name: string }
    | { source: "all"; card: RenderCard }
    | undefined {
    const settingId = this.peekIdByCodename("content_options");
    if (settingId !== undefined) {
      const settingName = this.peekRegisteredNameForId(settingId);
      if (settingName !== undefined) {
        const setting = DeckoName.parse(settingName);
        const input: PatternCardInput = {
          name: card.name.s,
          id: card.id,
          typeId: card.typeId,
          typeName: card.typeName,
        };
        if (card.name.isCompound) {
          const leftKey = card.name.leftName?.key;
          const left =
            leftKey !== undefined ? this.fetchRenderCard(leftKey) : undefined;
          input.leftTypeName = left?.typeName;
        }
        for (const candidate of ruleNamesForCard(input, setting.s)) {
          const record = this.fetchRenderCard(candidate);
          if (record === undefined || record.unknown === true) continue;
          if (this.isDenied(record)) continue;
          return { source: "rule", card: record };
        }
      }
    }
    const rightName = card.name.rightName;
    if (rightName !== undefined) {
      const right = this.fetchRenderCard(rightName.key);
      if (
        right !== undefined &&
        right.unknown !== true &&
        right.typeCode === "cardtype"
      ) {
        return { source: "right-type", name: `${rightName.s}+*type+by name` };
      }
    }
    const all = this.fetchRenderCard("*all");
    if (all !== undefined && all.unknown !== true) {
      return { source: "all", card: all };
    }
    return undefined;
  }

  private async ensurePointerEditorOptions(rootCard: RenderCard): Promise<void> {
    if (rootCard.typeCode !== "pointer" && rootCard.typeCode !== "list") return;
    const source = this.optionsCardSource(rootCard);
    if (source === undefined) return;
    if (source.source === "right-type") {
      await this.prepareVirtualFamilySearch(source.name);
      return;
    }
    const typeCode = source.card.typeCode;
    if (typeCode !== SEARCH_TYPE_CODE && typeCode !== "search" && typeCode !== "set") return;
    const key = source.card.key;
    if (this.searchResults.has(key) || this.searchFailures.has(key)) return;
    const limit = source.source === "rule" ? 50 : 100;
    try {
      const items = await this.runSearch(source.card, limit);
      this.searchResults.set(key, items);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.searchFailures.set(key, error);
      this.searchResults.set(key, []);
    }
  }

  seatedSearchItems(key: string): RenderCard[] | undefined {
    return this.searchResults.get(key);
  }

  structureRuleForSync(
    card: PatternCardInput,
  ): { ruleName: string; content: string } | undefined {
    const resolved = resolveStructuredContent(
      card,
      this.structureContents ?? new Map(),
    );
    return resolved === undefined
      ? undefined
      : { ruleName: resolved.ruleName, content: resolved.templateContent };
  }

  optionsCardPairs(card: RenderCard): Array<[string, string]> {
    const source = this.optionsCardSource(card);
    let standard: string[];
    if (source === undefined) {
      standard = [];
    } else if (source.source === "right-type") {
      const key = DeckoName.parse(source.name).key;
      standard = (this.searchResults.get(key) ?? []).map((r) => r.name.s);
    } else {
      const opts = source.card;
      if (opts.typeCode === "json") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(opts.dbContent ?? ""));
        } catch {
          throw badQuery(String(opts.dbContent ?? ""));
        }
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(`options card ${opts.name.s} is not a JSON hash`);
        }
        return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [
          k,
          String(v),
        ]);
      }
      if (opts.typeCode === SEARCH_TYPE_CODE || opts.typeCode === "search" || opts.typeCode === "set") {
        standard = (this.searchResults.get(opts.key) ?? []).map((r) => r.name.s);
      } else {
        standard = rawItemStrings(opts.dbContent).map((item) =>
          DeckoName.parse(item.replace(/\[\[|\]\]/g, "").trim()).absoluteName(opts.name).s,
        );
      }
    }
    const selected = rawItemStrings(card.dbContent)
      .map((item) => item.replace(/\[\[|\]\]/g, "").trim())
      .filter((item) => item !== "")
      .map((item) => DeckoName.parse(item).absoluteName(card.name).s);
    const names: string[] = [];
    for (const name of [...standard, ...selected]) {
      if (!names.includes(name)) names.push(name);
    }
    return names.map((name) => [name, name]);
  }

  private async runSearch(card: RenderCard, limitOverride?: number): Promise<RenderCard[]> {
    const rawContent = card.dbContent;
    if (rawContent === "") {
      throw emptyQueryError();
    }
    let statement: unknown;
    try {
      statement = JSON.parse(rawContent);
    } catch {
      throw badQuery(rawContent);
    }
    if (statement === null || typeof statement !== "object" || Array.isArray(statement)) {
      return [];
    }
    const stmtHash = statement as Record<string, unknown>;
    const cqlLimit = searchCqlLimit(statement as Record<string, unknown>);
    const limit =
      limitOverride === undefined ? (cqlLimit ?? 20) : limitOverride <= 0 ? 0 : limitOverride;
    if (limitOverride === undefined || limitOverride > 0) {
      (statement as Record<string, unknown>)["limit"] = limit;
    } else {
      delete (statement as Record<string, unknown>)["limit"];
    }
    const focalSearch =
      this.renderSearch !== undefined && this.renderSearchFocalKey === card.key
        ? this.renderSearch
        : undefined;
    const vars = focalSearch?.vars;
    const declaredVars = stmtHash["vars"];
    const resultNames = stmtHash["prepend"] === undefined && stmtHash["append"] === undefined
      ? {} : parseCql({
      prepend: stmtHash["prepend"], append: stmtHash["append"], context: stmtHash["context"],
      vars: {
        ...(declaredVars !== null && typeof declaredVars === "object" && !Array.isArray(declaredVars) ? declaredVars : {}),
        ...vars,
      },
    }, { context: card.name.s }).statementExtras;
    const { prepend, append } = resultNames;
    const alterResults = (prepend !== undefined && prepend !== null && prepend !== false)
      || (append !== undefined && append !== null && append !== false);
    for (const [key, value] of Object.entries(statement as Record<string, unknown>)) {
      const varMatch = /^\$(\w+)$/.exec(String(value));
      if (varMatch === null) continue;
      const varValue = vars?.[varMatch[1]];
      if (varValue === undefined || varValue === "") {
        delete (statement as Record<string, unknown>)[key];
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(varValue);
      } catch {
        parsed = varValue;
      }
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        delete (statement as Record<string, unknown>)[key];
        Object.assign(statement as Record<string, unknown>, parsed);
      } else {
        (statement as Record<string, unknown>)[key] = String(parsed);
      }
    }
    const searchOffset = focalSearch?.offset;
    if (searchOffset !== undefined && searchOffset > 1000 && this.viewer.signedIn !== true) {
      throw new PermissionDeniedError("limit parameter exceeds maximum for anonymous users (1000)");
    }
    if (searchOffset !== undefined && searchOffset > 0) {
      (statement as Record<string, unknown>)["offset"] = searchOffset;
    }
    let rows: CardsRow[];
    let records: Map<number, CardRecord>;
    let paging: SearchResultPaging | undefined;
    let searchCount: number | undefined;
    {
      const queryOptions = {
        ...(await this.cqlPermissionOptions()),
        parse: {
          context: card.name.s,
          ensureCardId: (nameish: string) => this.fetcher.lexicon.id(nameish),
          resolveCardId: (nameish: string) => {
            const key = DeckoName.parse(nameish).key;
            return this.idsByKey.get(key) ?? this.fetcher.lexicon.peekId(nameish);
          },
        },
      };
      const result = await executeQuery(
        this.fetcher.driver,
        statement as Record<string, unknown>,
        queryOptions,
      );
      if ("rows" in result) {
        rows = result.rows;
      } else {
        rows = [];
        this.searchCountResults.set(this.searchCacheKey(card), result.count);
        return [];
      }
      rows = await this.canonicalizeDanglingSideRows(rows);
    records = await this.prefetchSearchResultRows(rows);
      if ((limit >= 1 && rows.length >= limit) || (searchOffset ?? 0) > 0) {
        const countStatement = statementAfterFirstQuery(statement as Record<string, unknown>);
        delete countStatement["offset"];
        delete countStatement["limit"];
        const count = await executeCount(this.fetcher.driver, countStatement, queryOptions);
        searchCount = count;
        if (limit >= 1 && count > limit) paging = { limit, offset: searchOffset ?? 0, count };
      }
      this.searchResultCounts.set(this.searchCacheKey(card), searchCount ?? rows.length);
    }
    const items: RenderCard[] = [];
    for (const row of rows) {
      const record = records.get(row.id);
      if (record === undefined) continue;
      if (!(await this.canReadCard(record))) continue;
      if (record.name === undefined) continue;
      if (alterResults) {
        const altered = await composeCqlResultName(prepend, record.name, append,
          (id) => this.fetcher.lexicon.name(id));
        const fetched = await this.fetcher.fetchByName(altered, { new: {} });
        if (fetched !== undefined) {
          if (fetched.typeId === undefined) {
            const leftKey = altered.leftName?.key;
            const leftRecord =
              leftKey !== undefined && leftKey !== ""
                ? (await this.fetcher.fetchByName(leftKey)) ?? undefined
                : undefined;
            const leftTypeName =
              leftRecord !== undefined ? (await this.enrichAndStore(leftRecord)).typeName : undefined;
            const defaulted = this.newCardDefaultType(altered, leftTypeName);
            if (defaulted !== undefined) fetched.typeId = defaulted.typeId;
          }
          if (fetched.dbContent === undefined || fetched.dbContent === "") {
            const content = this.newCardDefaultContent(altered);
            if (content !== undefined && content !== "") fetched.dbContent = content;
          }
          items.push(await this.enrichAndStore(fetched));
          continue;
        }
      }
      const enriched = await this.enrichAndStore(record);
      items.push(enriched);
    }
    if (searchCount !== undefined) {
      this.searchResultCounts.set(this.searchCacheKey(card), searchCount);
    }
    if (paging !== undefined) {
      this.searchResultPagingMap.set(this.searchCacheKey(card), { ...paging, ...(vars !== undefined ? { query: { ...vars } } : {}) });
    }
    return items;
  }

  private async prepareSearchBoxComplete(rootCard: RenderCard): Promise<void> {
    const term = this.searchKeyword(rootCard);
    let exact: RenderCard | undefined;
    let exactKnown = false;
    {
      const real = await this.fetcher.fetchByName(term ?? "", { skipVirtual: true });
      if (real !== undefined && real.id !== undefined) {
        exactKnown = true;
        exact = await this.enrichAndStore(real);
      } else if (
        virtualSearchCqlFor(DeckoName.parse(term ?? ""), this.codenameHolderKey) === undefined
      ) {
        const fabricated = await this.fetcher.fetchByName(term ?? "", { new: {} });
        if (fabricated !== undefined) exact = await this.enrichAndStore(fabricated);
      }
    }
    const goto: RenderCard[] = [];
    let failure: string | undefined;
    let statement: Record<string, unknown> = {};
    let statementBroken: string | undefined;
    try {
      const parsed: unknown = JSON.parse(rootCard.dbContent ?? "");
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        statement = {};
      } else {
        statement = { ...(parsed as Record<string, unknown>) };
      }
    } catch (e) {
      statementBroken =
        rootCard.dbContent === ""
          ? "can't run search with empty content"
          : `Invalid JSON search query: ${rootCard.dbContent ?? ""}`;
    }
    if (statementBroken !== undefined) {
      this.searchBoxCompleteData = {
        term,
        exact,
        exactKnown,
        goto,
        failure: statementBroken,
      };
      return;
    }
    statement["limit"] = 8;
    statement["sort_by"] = "name";
    statement["return"] = "name";
    statement["complete"] = term ?? "";
    try {
      const result = await executeQuery(this.fetcher.driver, statement, {
        ...(await this.cqlPermissionOptions()),
        parse: {
          context: rootCard.name.s,
          ensureCardId: (nameish: string) => this.fetcher.lexicon.id(nameish),
          resolveCardId: (nameish: string) => {
            const key = DeckoName.parse(nameish).key;
            return this.idsByKey.get(key) ?? this.fetcher.lexicon.peekId(nameish);
          },
        },
      });
      if (!("rows" in result)) {
        this.searchBoxCompleteData = { term, exact, exactKnown, goto, failure };
        return;
      }
      const seenKeys = new Set<string>();
      for (const row of result.rows) {
        const selected = await composeCardRecord(row, this.fetcher.lexicon);
        const record = selected.name === undefined
          ? undefined
          : await this.fetcher.fetchByName(selected.name.s);
        if (record === undefined) continue;
        if (!(await this.canReadCard(record))) continue;
        if (record.name === undefined) continue;
        const enriched = await this.enrichAndStore(record);
        if (seenKeys.has(enriched.key)) continue;
        seenKeys.add(enriched.key);
        goto.push(enriched);
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
    this.searchBoxCompleteData = { term, exact, exactKnown, goto, failure };
  }

  private async prepareRequestTerm(
    rootCard: RenderCard,
    view: "name_complete" | "name_match",
  ): Promise<void> {
    const term = this.renderSearch?.term;
    let failure: string | undefined;
    let statement: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(rootCard.dbContent ?? "");
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        statement = {};
      } else {
        statement = { ...(parsed as Record<string, unknown>) };
      }
    } catch (e) {
      failure =
        rootCard.dbContent === ""
          ? "can't run search with empty content"
          : `Invalid JSON search query: ${rootCard.dbContent ?? ""}`;
    }
    const complete: RenderCard[] = [];
    const match: RenderCard[] = [];
    const runNameCql = async (
      cql: Record<string, unknown>,
      sink: RenderCard[],
    ): Promise<void> => {
      const merged = { ...statement, ...cql };
      const perm = await this.cqlPermissionOptions();
      const result = await executeQuery(this.fetcher.driver, merged, {
        ...perm,
        parse: {
          context: rootCard.name.s,
          ensureCardId: (nameish: string) => this.fetcher.lexicon.id(nameish),
          resolveCardId: (nameish: string) => {
            const key = DeckoName.parse(nameish).key;
            return this.idsByKey.get(key) ?? this.fetcher.lexicon.peekId(nameish);
          },
        },
      });
      if (!("rows" in result)) return;
      const seenKeys = new Set<string>();
      for (const row of result.rows) {
        const selected = await composeCardRecord(row, this.fetcher.lexicon);
        const record =
          selected.name === undefined
            ? undefined
            : await this.fetcher.fetchByName(selected.name.s);
        if (record === undefined) continue;
        if (!(await this.canReadCard(record))) continue;
        if (record.name === undefined) continue;
        const enriched = await this.enrichAndStore(record);
        if (seenKeys.has(enriched.key)) continue;
        seenKeys.add(enriched.key);
        sink.push(enriched);
      }
    };
    if (failure === undefined) {
      try {
        await runNameCql(
          { limit: 8, sort_by: "name", return: "name", complete: term ?? "" },
          complete,
        );
        if (view === "name_match") {
          const remaining = 8 - complete.length;
          if ((term ?? "") !== "" && remaining > 0) {
            await runNameCql(
              {
                limit: remaining,
                sort_by: "name",
                return: "name",
                name_match: term,
                ...(complete.length
                  ? { name: ["not in", ...complete.map((c) => c.name.s)] }
                  : {}),
              },
              match,
            );
          }
        }
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
      }
    }
    this.requestTermData = { term, complete, match, failure };
  }

  requestTermSeat(_card: RenderFormat["card"]): RequestTermSeat | undefined {
    return this.requestTermData;
  }

  private async prepareImageComplete(rootCard: RenderCard): Promise<void> {
    const items: RenderCard[] = [];
    try {
      const content = rootCard.dbContent ?? "";
      if (content === "") throw new CqlBadQuery("can't run search with empty content");
      let parsed: unknown;
      try { parsed = JSON.parse(content); }
      catch { throw new CqlBadQuery(`Invalid JSON search query: ${content}`); }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`cql content is not a Hash: ${content}`);
      }
      let term = this.renderSearch?.term;
      if (term?.trim() === "") term = undefined;
      const main = this.renderSearch?.main;
      if (term?.startsWith("+") && main !== undefined) term = main + term;
      const names = new Set<string>();
      const select = async (specific: Record<string, unknown>, limit: number): Promise<void> => {
        const result = await executeQuery(this.fetcher.driver, {
          ...(parsed as Record<string, unknown>), limit, sort_by: "name", return: "name",
          ...specific,
        }, {
          ...(await this.cqlPermissionOptions()),
          parse: {
            context: rootCard.name.s,
            ensureCardId: name => this.fetcher.lexicon.id(name),
            resolveCardId: name => this.idsByKey.get(DeckoName.parse(name).key) ?? this.fetcher.lexicon.peekId(name),
          },
        });
        if (!("rows" in result)) return;
        for (const row of result.rows) {
          const selected = await composeCardRecord(row, this.fetcher.lexicon);
          if (selected.name === undefined || names.has(selected.name.s)) continue;
          const record = await this.fetcher.fetchByName(selected.name.s);
          if (record === undefined || !(await this.canReadCard(record))) continue;
          names.add(selected.name.s);
          items.push(await this.enrichAndStore(record));
        }
      };
      const imageId = await this.fetcher.codenames.id("image");
      if (imageId === undefined) throw new CodenameNotFoundError("image");
      await select({ complete: term ?? "", type: imageId }, 8);
      if (items.length < 8 && term !== undefined) {
        await select({ name_match: term, ...(names.size ? { name: ["not in", ...names] } : {}), type: imageId }, 8 - items.length);
      }
      this.imageCompleteData = { items };
    } catch (error) {
      this.imageCompleteData = { items, failure: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  imageCompleteSeat(_card: RenderCard): ImageCompleteSeat | undefined {
    return this.imageCompleteData;
  }

  searchBoxCompleteSeat(_card: RenderFormat["card"]): SearchBoxCompleteSeat | undefined {
    return this.searchBoxCompleteData;
  }

  private danglingSideRowCanonical: Map<number, number> | undefined;

  private async danglingSideRowCanonicalMap(): Promise<Map<number, number>> {
    if (this.danglingSideRowCanonical !== undefined) {
      return this.danglingSideRowCanonical;
    }
    const result = await this.fetcher.driver.query<CardsRow>(
      "SELECT c.* FROM cards c WHERE c.trash = 0 AND c.left_id IS NOT NULL AND " +
        "(NOT EXISTS (SELECT 1 FROM cards l WHERE l.id = c.left_id) OR " +
        " NOT EXISTS (SELECT 1 FROM cards r WHERE r.id = c.right_id))",
      [],
    );
    const names = new Map<string, number>();
    const remap = new Map<number, number>();
    for (const row of result.rows) {
      const record = await composeCardRecord(row, this.fetcher.lexicon);
      if (record.name === undefined) continue;
      const key = record.name.key;
      const current = names.get(key);
      if (current === undefined || row.id < current) {
        names.set(key, row.id);
      }
    }
    for (const row of result.rows) {
      const record = await composeCardRecord(row, this.fetcher.lexicon);
      if (record.name === undefined) continue;
      const canonicalId = names.get(record.name.key);
      if (canonicalId !== undefined) remap.set(row.id, canonicalId);
    }
    this.danglingSideRowCanonical = remap;
    return remap;
  }

  private async canonicalizeDanglingSideRows(rows: CardsRow[]): Promise<CardsRow[]> {
    if (rows.length === 0) return rows;
    if (!rows.some((r) => r.left_id !== null && r.left_id !== undefined)) {
      return rows;
    }
    const remap = await this.danglingSideRowCanonicalMap();
    if (remap.size === 0) return rows;
    let swapped = false;
    const canonicalRows = new Map<number, CardsRow>();
    const out: CardsRow[] = [];
    for (const row of rows) {
      const canonicalId = remap.get(row.id);
      if (canonicalId === undefined || canonicalId === row.id) {
        out.push(row);
        continue;
      }
      let canonicalRow = canonicalRows.get(canonicalId);
      if (canonicalRow === undefined) {
        const fetched = await this.fetcher.driver.query<CardsRow>(
          "SELECT * FROM cards WHERE id = ? AND trash = 0",
          [canonicalId],
        );
        canonicalRow = fetched.rows[0];
        if (canonicalRow === undefined) {
          canonicalRows.set(canonicalId, row);
          out.push(row);
          continue;
        }
        canonicalRows.set(canonicalId, canonicalRow);
      }
      out.push(canonicalRow);
      swapped = true;
    }
    return swapped ? out : rows;
  }

  private async prefetchSearchResultRows(rows: CardsRow[]): Promise<Map<number, CardRecord>> {
    const records = new Map<number, CardRecord>();
    if (rows.length === 0) return records;
    const ids: number[] = [];
    const seen = new Set<number>();
    const pushId = (id: number | null | undefined): void => {
      if (id === null || id === undefined || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    };
    for (const row of rows) {
      pushId(row.id);
      pushId(row.type_id);
      pushId(row.left_id);
      pushId(row.right_id);
    }
    const fetched = await readCardRowsByIdChunked(this.fetcher.driver, ids);
    if (fetched.length === 0) return records;
    const ctx: PrefetchContext = {
      driver: this.fetcher.driver,
      lexicon: this.fetcher.lexicon,
      writeToCache: (record) => this.fetcher.writeToCache(record),
      cacheRecord: (record) => this.cacheFetchedRecord(record),
    };
    const composed = await composeAndCacheSqlRows(fetched, ctx);
    for (const record of composed) {
      if (record.id !== undefined) records.set(record.id, record);
    }
    return records;
  }
}
