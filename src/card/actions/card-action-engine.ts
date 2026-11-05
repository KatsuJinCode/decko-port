import {
  ActWriter,
  cardFieldStateFromRow,
  type CardFieldState,
} from "../history/write-path.js";
import { actionTypeCode } from "../history/action.js";
import { sqlDateTime } from "../history/act.js";
import { DeckoName, type Nameish } from "../name.js";
import { NoMethodError, rubyDefaultInspect } from "../render/format.js";
import {
  CodenameNotFoundError,
  NameNotFoundError,
  UnsupportedIdentifierError,
} from "../name/errors.js";
import type { CardsRow } from "../../server/schema.js";
import type { FetchEngine } from "../fetch.js";
import type { FetchArg } from "../fetch/retrieve.js";
import {
  composeCardRecord,
  newCardRecord,
  type CardRecord,
} from "../fetch/card-record.js";
import type { Lex } from "../fetch/lexicon.js";
import {
  ANONYMOUS_ACTOR_NAME,
  CardActionError,
  ModEventAbortSuccess,
  type ActionResult,
  type Actor,
  type ActionRequest,
  type AttachmentInput,
  type CanWriteHook,
  type CardActionSummary,
  type CreateCardInput,
  type DeleteCardInput,
  type RevertActionsInput,
  type SubcardInput,
  type UpdateCardInput,
} from "./types.js";
import { storeSessionCardContent } from "../session/visitor-session.js";
import { actionsToRevert, revisionOf, type Revision } from "./revert-actions.js";
import { StrictParityCrashError, strictParityFlags } from "../parity/strict-parity-flags.js";
import {
  assertNameAvailable,
  currentNameLexicon,
  findTrashedCardByLex,
  findTrashedKeyObstacle,
  nameLegalityError,
  type NameLegalityArm,
  validateComputedKey,
  validateNameLegality,
} from "./name-validation.js";
import { knownTypeSpec, resolveTypeId } from "./type-resolution.js";
import { findRule } from "../rules/lookup.js";
import {
  cleanContent,
  NO_CLEAN_RIGHT_CODENAMES,
  NO_CLEAN_TYPE_CODENAMES,
} from "./content-clean.js";
import { assertNotOwnAncestor } from "./junction-cycle-detection.js";
import {
  cardName as readRuleCardName,
  cascadeAllFieldReadRules,
  cascadeReadRuleAfterRuleSave,
  deriveReadRuleRecord,
  fetchCardsRow as readRuleFetchCardsRow,
  setMemberIds as readRuleSetMemberIds,
  typeIdByCodename as readRuleTypeIdByCodename,
  type ReadRuleWriteDeps,
} from "../permissions/set-read-rule.js";
import {
  readPermissionStatements,
  readPermissionStateFromViewerResults,
  type ReadViewer,
} from "../permissions/read-rules.js";
import {
  followRightPermitPassedForCard,
  saveTaskVerdictForCard,
  taskVerdictForCard,
  signupApprovalAllowed,
  viewTaskPermissionStatements,
  viewTaskStateFromResults,
  type ViewTaskState,
  type WriteTask,
} from "../permissions/view-task-rules.js";
import { updatePermissionOverride } from "../permissions/read-override.js";
import type { PatternCardInput } from "../set-patterns/types.js";
import {
  isStandardRuleName,
  isPreferenceName,
  quickTypeName,
  ruleContentForCard,
  ruleWalkPatternInput,
} from "./rule-content-walk.js";
import { isNewCard, isRealCard } from "../fetch/card-record.js";
import { CARD_CODENAME_BY_ID_SQL, CARD_ID_BY_JUNCTION_SQL, CARD_ROW_BY_ID_SQL, LIVE_CARD_ROW_BY_ID_SQL } from "../fetch/card-read-shapes.js";
import { cardBlockNames, declareCardBlockReads, EVERY_CARD_BLOCK_SHAPE } from "../fetch/card-block-declaration.js";
import { declareDeckStandardCards } from "../fetch/standard-card-declaration.js";
import {
  buildFollowNotifyHook,
  defaultFollowNotifyDeps,
  defaultTransport,
  expandActionResultToSavePathEvents,
  makeNotifyContext,
  runIntegrationHooks,
  savePathEventFromAction,
  type FollowerResolver,
  type NotifyTransport,

  type SavePathEvent,
  type SavePathIntegrationHook,
} from "../notify/index.js";
import {
  codedAttachmentIdentifier,
  detectAttachmentExtension,
  lastContentActionIdFromIdentifier,
  localAttachmentIdentifier,
  parseLocalAttachmentIdentifier,
} from "../attachments/attachment-content.js";
import {
  createVersionsFor,
  mountUsesImageUploader,
  renditionFileNames,
  IMAGE_VERSION_NAMES,
} from "../attachments/image-renditions.js";
import type { AttachmentStore, AttachmentStoreInput, StoredAttachment } from "../attachments/attachment-store.js";
import { DatabaseOutcomeUnknownError, supportsTransactions } from "../../server/driver.js";
import { assetBytesSha256, CommittedSaveCleanupError, discardAssetRecovery, FileCleanupCustodyRequiredError, reconcileAssetRecoveries, SaveOutcomeUnknownError, type AssetRecoveryReference } from "./save-outcome.js";
import { canResize, imageDecodes, imageVersionBytes } from "../attachments/image-resize.js";
import { emailIsValid, encryptPassword, normalizeEmail, planAccountFields } from "../auth/account-fields.js";
import { actorBot } from "../auth/actor.js";
import { runObserverEvents } from "../notify/observer.js";
import type { ScssCompiler } from "../assets/scss-compiler.js";
import { renderStyleChunks } from "../assets/skin-stylesheet.js";
import type { CoffeeCompiler } from "../assets/coffee-compiler.js";
import type { ScriptCompressor } from "../assets/script-compressor.js";
import type { JavascriptSyntaxValidator } from "../assets/javascript-syntax-validator.js";
import { rawItemStrings } from "../render/pointer-list.js";
import {
  virtualDelete,
  virtualSave,
  VirtualRecordCache,
} from "../mod-loader/mods/card-mod-virtual.js";
import {
  assertStyleCompilerFor,
  refreshReadAssetInputs,
  runStyleAssetEvents,
  scssValidationVariables,
  type SavedCard,
  type StyleAssetEventContext,
} from "./style-asset-events.js";
import { changeValueForField, trackedFieldIndex } from "../history/change.js";
import {
  clearReferencesOnDelete,
  refreshReferencesOut,
} from "./refresh-references-out.js";
import { refreshReferencesIn } from "./refresh-references-in.js";
import { updateRefererContent, updateRefererReferencesOut } from "./update-referer-content.js";
import {
  LIST_RIGHT_CODENAMES,
  LIST_SELF_CODENAMES,
  LIST_TYPE_CODENAMES,
  listItemStrings,
  standardizeIdListContent,
  standardizeListContent,
} from "./list-content.js";
import {
  DEFAULT_ACCOUNT_STATUS,
  NO_HISTORY_RIGHT_CODENAMES,
  storedPasswordValue,
  generateSalt,
  passwordErrors,
} from "./account-fields.js";
import type { PasswordHashPolicy } from "../auth/password-hash.js";
import {
  runModEventStage,
  type ModEventContext,
  type ModEventCurrentError,
  type ModEventLogger,
  type ModEventRuntime,
  type ModEventSaveInput,
  type ModEventSubcardCollection,
  type ModEventStageReport,
  type ModEventRecaptchaVerify,
} from "../mod-loader/mod-event-dispatch.js";
import {
  populateModEventCardState,
  type ModEventCardState,
  type ModEventCardStateContext,
  type ModEventSaveAttributes,
} from "../mod-loader/mod-event-card-state.js";
import {
  recaptchaSiteverifyGet,
  RECAPTCHA_CARDIO_CONFIG_DEFAULTS,
} from "../mod-loader/mods/card-mod-recaptcha.js";

import type {
  ModEngineHost,
  ModEventBodyOutcome,
  ModEventCard,
  ModEventFn,
  ModEventStage,
} from "../mod-loader/mod-manifest.js";
import { isEditConflict } from "../mod-loader/mods/card-mod-history.js";
import type { SavePathAct } from "../notify/types.js";
import {
  DEFAULT_DELAYED_EVENT_PRIORITY,
  type DelayedEventJob,
  type DelayedJobsConfig,
} from "../delayed-job/delayed-job.js";
import { expireRuleResolutionCache } from "../permissions/read-rules.js";

interface DeferredReferenceFinalize {
  card?: ModEventCard;
  thunks?: ReadonlyArray<readonly [string, () => Promise<void>]>;
}

interface PreparedCreateValidation {
  input: CreateCardInput;
  typeId: number;
  cachedUpload?: { release: () => Promise<void> };
}

export const ATTACHMENT_MOUNTS: Readonly<Record<string, "file" | "image">> = {
  file: "file",
  image: "image",
};

const HISTORY_ERROR_NOT_LATEST_REVISION = "changes not based on latest revision";

const EVENT_TAKEOVER_BUILTINS: ReadonlySet<string> = new Set([
  "refresh_references_out",
  "update_referer_content",
  "update_referer_references_out",
  "refresh_references_in",
  "clear_references",
  "delete_children",
]);

const WRITE_ORDER_OWNED_EVENTS: readonly string[] = [
  "delete_children",
  "manage_trash",
  "prepare_left_and_right",
  "rename_in_trash",
  "reset_codename_cache",
  "save_draft",
  "set_autoname",
  "set_content",
  "set_default_content",
  "update_lexicon",
  "validate_key",
  "validate_legality_of_name",
  "validate_name",
  "validate_renaming",
];

function isServerClassError(error: unknown): boolean {
  if (error instanceof ModEventAbortSuccess) return false;
  if (error instanceof CardActionError) return error.code === "server-error";
  return true;
}

export interface CardActionEngineOptions {
  actor: Actor | null;
  enabledRoleIds?: readonly number[];
  actActorId?: number;
  currentActorId?: number;
  rootStamperId?: number;
  now?: () => Date;
  ipAddress?: string | null;
  canWrite?: CanWriteHook;
  integrationHooks?: SavePathIntegrationHook[];
  followerResolver?: FollowerResolver;
  notifyTransport?: NotifyTransport;
  notifyLogger?: (line: string) => void;
  eventLogger?: ModEventLogger;
  passwordHashing?: PasswordHashPolicy;
  followMail?: { origin: string; deckoBotEmail: string };
  delayedJobs?: DelayedJobsConfig;
  attachmentStore?: AttachmentStore;
  codedAttachmentStore?: AttachmentStore;
  scssCompiler?: ScssCompiler;
  coffeeCompiler?: CoffeeCompiler;
  compressAssets?: boolean;
  scriptCompressor?: ScriptCompressor;
  javascriptValidator?: JavascriptSyntaxValidator;
  fileStorage?: string;
  modEvents?: ModEventRuntime;

  params?: Readonly<Record<string, unknown>>;
  recaptcha?: CardActionRecaptchaConfig;
}

export interface CardActionRecaptchaConfig {
  siteKey?: string;
  secretKey?: string;
  minimumScore?: number;
  verifyUrl?: string;
  alwaysOk?: boolean;
  needsSetup?: boolean;
  captchaRuleContent?:
    | unknown
    | ((cardName: string) => unknown | Promise<unknown>);
  verify?: ModEventRecaptchaVerify;
}

interface ResolvedSides {
  leftId: number | null;
  rightId: number | null;
  created: (CardActionSummary & { actId: number })[];
  reservedActionId?: number;
}

function anonymousAccountName(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `ANON-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export class CardActionEngine {
  readonly fetch: FetchEngine;
  readonly actor: Actor | null;
  private readonly actActorId: number | undefined;
  private readonly enabledRoleIds: readonly number[] | undefined;
  private readonly currentActorId: number | undefined;
  private readonly rootStamperId: number | undefined;
  private readonly clock: () => Date;
  private readonly ipAddress: string | null;
  private readonly delayedJobs: DelayedJobsConfig | undefined;
  private readonly canWrite: CanWriteHook | undefined;
  private readonly integrationHooks: SavePathIntegrationHook[] | undefined;
  private readonly followerResolver: FollowerResolver | undefined;
  private readonly notifyTransport: NotifyTransport | undefined;
  private readonly notifyLogger: ((line: string) => void) | undefined;
  private readonly eventLogger: ModEventLogger | undefined;
  private readonly passwordHashing: PasswordHashPolicy | undefined;
  private readonly followMail: { origin: string; deckoBotEmail: string } | undefined;
  private writeTaskState: ViewTaskState | undefined;
  private readonly attachmentStore: AttachmentStore | undefined;
  private readonly codedAttachmentStore: AttachmentStore | undefined;
  private readonly scssCompiler: ScssCompiler | undefined;
  private readonly coffeeCompiler: CoffeeCompiler | undefined;
  private readonly compressAssets: boolean;
  private readonly scriptCompressor: ScriptCompressor | undefined;
  private readonly javascriptValidator: JavascriptSyntaxValidator | undefined;
  private readonly virtualCache = new VirtualRecordCache();

  private async isVirtualCacheCardRight(
    rightId: number | null | undefined,
  ): Promise<boolean> {
    if (rightId === undefined || rightId === null) return false;
    const anchorId = await this.fetch.codenames.id("asset_input");
    return anchorId !== undefined && rightId === anchorId;
  }

  private async isVirtualCacheCardName(name: DeckoName): Promise<boolean> {
    const right = name.rightName;
    if (right === undefined) return false;
    const rightId = await this.fetch.lexicon.id(right);
    return this.isVirtualCacheCardRight(rightId);
  }

  private readonly fileStorage: string | undefined;
  private readonly modEvents: ModEventRuntime | undefined;
  private readonly recaptchaConfig: CardActionRecaptchaConfig | undefined;
  private captchaUsedThisRequest = false;
  private readonly saveParams: Readonly<Record<string, unknown>> | undefined;
  private activeSaveAttributes: ModEventSaveAttributes | undefined;

  constructor(fetchEngine: FetchEngine, options: CardActionEngineOptions) {
    this.fetch = fetchEngine;
    this.actor = options.actor;
    this.enabledRoleIds = options.enabledRoleIds === undefined ? undefined : [...options.enabledRoleIds];
    this.actActorId = options.actActorId;
    this.currentActorId = options.currentActorId;
    this.rootStamperId = options.rootStamperId;
    this.clock = options.now ?? (() => new Date());
    this.ipAddress = options.ipAddress ?? null;
    this.delayedJobs = options.delayedJobs;
    this.canWrite = options.canWrite;
    this.integrationHooks = options.integrationHooks;
    this.followerResolver = options.followerResolver;
    this.notifyTransport = options.notifyTransport;
    this.notifyLogger = options.notifyLogger;
    this.eventLogger = options.eventLogger;
    this.passwordHashing = options.passwordHashing;
    this.followMail = options.followMail;
    this.attachmentStore = options.attachmentStore;
    this.codedAttachmentStore = options.codedAttachmentStore;
    this.scssCompiler = options.scssCompiler;
    this.coffeeCompiler = options.coffeeCompiler;
    this.compressAssets = options.compressAssets ?? false;
    this.scriptCompressor = options.scriptCompressor;
    this.javascriptValidator = options.javascriptValidator;
    this.fileStorage = options.fileStorage;
    this.modEvents = options.modEvents;
    this.recaptchaConfig = options.recaptcha;
    this.saveParams = options.params;
  }

  private saveDepth = 0;
  private afterCommitSteps: (() => Promise<void>)[] = [];
  private filesStoredThisSave: AttachmentStoreInput[] = [];
  private fileCleanupReceipts = new Map<AttachmentStoreInput, () => Promise<boolean>>();
  private assetOutputRestorations: { input: AttachmentStoreInput; before: Uint8Array | undefined; recovery?: AttachmentStoreInput; reference?: AssetRecoveryReference }[] = [];

  private async atomicSave<R>(work: () => Promise<R>): Promise<R> {
    if (this.saveDepth > 0) {
      this.saveDepth += 1;
      try {
        return await work();
      } finally {
        this.saveDepth -= 1;
      }
    }
    const driver = this.fetch.driver;
    if (!supportsTransactions(driver)) {
      throw new Error(
        "the SQL driver offers no transaction(), and a save must be atomic: refusing to write (src/server/driver.ts)",
      );
    }
    this.saveDepth = 1;
    this.afterCommitSteps = [];
    this.filesStoredThisSave = [];
    this.fileCleanupReceipts.clear();
    this.assetOutputRestorations = [];
    this.plannedAccountFieldActions.clear();
    let result: R;
    let prepared: R | undefined;
    try {
      result = await driver.transaction(async () => {
        const value = await work();
        if (this.plannedAccountFieldActions.size !== 0) throw new Error('unfilled account field history reservation');
        prepared = value;
        return value;
      });
    } catch (error) {
      if (error instanceof DatabaseOutcomeUnknownError) {
        const unknown = new SaveOutcomeUnknownError(error, prepared,
          [...this.filesStoredThisSave, ...this.assetOutputRestorations.map((asset) => asset.input)],
          this.afterCommitSteps.length > 0, this.assetRecoveryReferences(this.assetOutputRestorations));
        this.afterCommitSteps = [];
        this.filesStoredThisSave = [];
        this.fileCleanupReceipts.clear();
        this.assetOutputRestorations = [];
        this.pendingSalts.clear();
        this.writeTaskState = undefined;
        this.virtualCache.reset();
        this.fetch.resetCaches();
        throw unknown;
      }
      this.afterCommitSteps = [];
      try {
        await this.forgetRolledBackSave();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Save failed and external file restoration also failed");
      }
      throw error;
    } finally {
      this.saveDepth = 0;
      this.plannedAccountFieldActions.clear();
    }
    const steps = this.afterCommitSteps;
    const assetRestorations = this.assetOutputRestorations;
    this.afterCommitSteps = [];
    this.filesStoredThisSave = [];
    this.fileCleanupReceipts.clear();
    this.assetOutputRestorations = [];
    const runSteps = async (): Promise<void> => {
      for (const step of steps) await step();
    };
    let integrationError: unknown;
    try {
      if (driver.readPhase !== undefined) await driver.readPhase(runSteps);
      else await runSteps();
    } catch (error) { integrationError = error; }
    const cleanupErrors: unknown[] = [];
    for (const { recovery } of assetRestorations) {
      if (recovery === undefined) continue;
      try { await this.discardAssetRecovery(recovery); }
      catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length > 0) throw new CommittedSaveCleanupError(
      integrationError === undefined ? cleanupErrors : [integrationError, ...cleanupErrors],
      this.assetRecoveryReferences(assetRestorations), integrationError !== undefined);
    if (integrationError !== undefined) throw integrationError;
    return result;
  }

  private assetRecoveryReferences(restorations: readonly { reference?: AssetRecoveryReference }[]): AssetRecoveryReference[] {
    return restorations.flatMap(({ reference }) => reference === undefined ? [] : [reference]);
  }

  private async discardAssetRecovery(recovery: AttachmentStoreInput): Promise<void> {
    if (this.attachmentStore === undefined) throw new Error("Asset recovery requires attachmentStore");
    await discardAssetRecovery(this.attachmentStore, recovery);
  }

  private async afterCommit(step: () => Promise<void>): Promise<void> {
    if (this.saveDepth > 0) this.afterCommitSteps.push(step);
    else await step();
  }

  private async forgetRolledBackSave(): Promise<void> {
    const restorations = this.assetOutputRestorations;
    this.assetOutputRestorations = [];
    const restorationErrors: unknown[] = [];
    const cleanupReceipts = this.fileCleanupReceipts;
    this.fileCleanupReceipts = new Map();
    const existing = restorations.filter(({ before }) => before !== undefined);
    if (existing.length !== 0) {
      try {
        if (this.attachmentStore === undefined || existing.some(({ reference }) => reference === undefined)) {
          throw new Error("Derived asset recovery lacks its store or recorded conditional recovery identity");
        }
        await reconcileAssetRecoveries(this.attachmentStore, existing.map(({ reference }) => reference!), "rolled-back");
      } catch (error) { restorationErrors.push(error); }
    }
    for (const { input, before } of [...restorations].reverse()) {
      if (before !== undefined) continue;
      try {
        if (this.attachmentStore !== undefined) await this.discardRolledBackFile(this.attachmentStore, input, cleanupReceipts.get(input));
      } catch (error) { restorationErrors.push(error); }
    }
    const files = this.filesStoredThisSave;
    this.filesStoredThisSave = [];
    for (const file of files) {
      try {
        const store =
          file.coded !== undefined && this.codedAttachmentStore !== undefined
            ? this.codedAttachmentStore
            : this.attachmentStore;
        if (store !== undefined) await this.discardRolledBackFile(store, file, cleanupReceipts.get(file));
      } catch (error) { restorationErrors.push(error); }
    }
    this.pendingSalts.clear();
    this.writeTaskState = undefined;
    this.virtualCache.reset();
    this.fetch.resetCaches();
    await this.fetch.reprimeBootState();
    if (restorationErrors.length !== 0) throw new AggregateError(restorationErrors, "External file rollback cleanup failed");
  }

  private async storeWithRollbackCustody(store: AttachmentStore, input: AttachmentStoreInput,
    identity: AttachmentStoreInput = input): Promise<StoredAttachment> {
    const capture = (value: unknown) => {
      if (this.saveDepth === 0) return;
      if (value !== null && typeof value === "object" && "discardIfOwned" in value && typeof value.discardIfOwned === "function") {
        this.fileCleanupReceipts.set(identity, value.discardIfOwned.bind(value));
      }
    };
    try { const result = await store.store(input); capture(result); return result; }
    catch (error) { capture(error); throw error; }
  }

  private async discardRolledBackFile(store: AttachmentStore, input: AttachmentStoreInput,
    receipt: (() => Promise<boolean>) | undefined): Promise<void> {
    if (receipt !== undefined) {
      const removed = await receipt();
      if (typeof removed !== "boolean") throw new Error("Exact-write cleanup returned no boolean acknowledgement; reconciliation required");
      return;
    }
    if (input.coded === undefined && input.renditionNames === undefined && input.renditionBytes === undefined) {
      const current = await store.read(input.cardId, input.actionId, input.ext, undefined, input.area);
      if (current === undefined || await assetBytesSha256(current) !== await assetBytesSha256(input.bytes)) return;
    }
    throw new FileCleanupCustodyRequiredError(input);
  }

  async applyAction(request: ActionRequest): Promise<ActionResult | null> {
    switch (request.verb) {
      case "create":
        return this.createCard(request);
      case "update":
        return this.updateCard(request);
      case "delete":
        return this.deleteCard(request);
    }
  }

  private async dispatchSavePathIntegrations(
    result: ActionResult | null,
    opts: { actCardActionOmitted?: boolean; delayedStageDropped?: boolean; withinOtherAct?: boolean } = {},
  ): Promise<void> {
    if (result === null) return;
    let observerFailed = false;
    let actTarget: CardsRow | undefined;
    if (this.followMail !== undefined && result.name !== undefined) {
      const row = await this.fetchRowById(result.cardId);
      actTarget = row;
      const outcome = await runObserverEvents(this.fetch, {
        card: { id: result.cardId, name: result.name.s, typeId: row?.type_id },
        action: result.verb,
        transport: this.notifyTransport ?? defaultTransport,
        origin: this.followMail.origin,
        deckoBotEmail: this.followMail.deckoBotEmail,
        actorName: this.actor?.name ?? ANONYMOUS_ACTOR_NAME,
        ...(this.notifyLogger !== undefined ? { logger: this.notifyLogger } : {}),
      });
      observerFailed = outcome.failed;
    }
    if (await this.isAnonymousSession()) return;
    const allHooks = this.integrationHooks ?? [
      buildFollowNotifyHook(
        defaultFollowNotifyDeps(this.fetch, {
          followers: this.followerResolver,
          ...(this.followMail === undefined ? {} : { mail: this.followMail }),
        }),
      ),
    ];
    actTarget ??= await this.fetchRowById(result.cardId);
    const cardHooks = await this.isAssetOutputRight(actTarget?.right_id)
      ? allHooks.filter(h => h.event !== "notify_followers_after_save")
      : allHooks;
    const hooks = opts.delayedStageDropped === true || observerFailed
      ? cardHooks.filter((h) => h.stage !== "integrate_with_delay")
      : cardHooks;
    if (hooks.length === 0) return;
    if (this.actor === null) return;
    const actor = { id: this.actor.id, name: this.actor.name, email: null };
    const events = opts.actCardActionOmitted === true
      ? result.subactions.map((sub) =>
          savePathEventFromAction({ ...sub, actId: result.actId, subactions: [] }, actor, result.actId, false),
        )
      : expandActionResultToSavePathEvents(result, actor, opts.withinOtherAct === true);
    const actCardName = result.name?.s ?? null;
    let inline = hooks;
    if (this.delayedJobs?.delaying === true) {
      inline = hooks.filter((h) => h.stage !== "integrate_with_delay");
      const first = events[0];
      for (const hook of hooks) {
        if (hook.stage !== "integrate_with_delay" || first === undefined) continue;
        if (!hook.notable(first)) continue;
        await this.delayedJobs.queue.enqueue(this.delayedEventJob(hook, result, actor.id));
      }
    }
    if (inline.length === 0) return;
    await runIntegrationHooks({
      actId: result.actId,
      actor,
      silent: false,
      events,
      actCardName,
      hooks: inline,
      context: makeNotifyContext(this.notifyTransport ?? defaultTransport, this.notifyLogger),
    });
  }

  private delayedEventJob(hook: SavePathIntegrationHook, result: ActionResult, actorId: number): DelayedEventJob {
    const event = hook.event ?? hook.name ?? "integrate_with_delay";
    let protocol: string | null = null;
    let host: string | null = null;
    if (this.followMail !== undefined) {
      try {
        const url = new URL(this.followMail.origin);
        protocol = `${url.protocol}//`;
        host = url.hostname;
      } catch {
      }
    }
    return {
      queue: event,
      priority: hook.priority ?? DEFAULT_DELAYED_EVENT_PRIORITY,
      actId: result.actId,
      cardId: result.cardId,
      cardAttribs: { action: result.verb, currentActionId: result.actionId },
      env: {
        origin: this.followMail?.origin ?? "",
        html: true,
        "ajax?": null,
        "html?": true,
        ip: this.ipAddress,
        protocol,
        params: { ...(this.saveParams ?? {}) },
        main_name: null,
        ajax: null,
        host,
      },
      auth: { as_id: actorId, current_id: actorId },
      methodName: `${event}_without_callbacks`,
    };
  }

  private async delayedJobAct(job: DelayedEventJob): Promise<SavePathAct> {
    const driver = this.fetch.driver;
    const actId = job.actId ?? 0;
    const actRow = (await driver.query<{ card_id: number | null; actor_id: number | null }>(
      "SELECT card_id, actor_id FROM card_acts WHERE id = ? LIMIT 1",
      [actId],
    )).rows[0];
    const actorId = job.auth.current_id ?? actRow?.actor_id ?? 0;
    const actorCard = await this.fetch.fetchById(actorId);
    const actor = { id: actorId, name: actorCard?.name?.s ?? "", email: null };
    const actions = (await driver.query<{ id: number; card_id: number; action_type: number | null }>(
      "SELECT id, card_id, action_type FROM card_actions WHERE card_act_id = ? AND (draft IS NULL OR draft = 0) ORDER BY id",
      [actId],
    )).rows;
    const VERBS = ["create", "update", "delete"] as const;
    const events: SavePathEvent[] = [];
    for (const action of actions) {
      const card = await this.fetch.fetchById(action.card_id, { lookInTrash: true });
      const verb = VERBS[action.action_type ?? 1] ?? "update";
      events.push({
        card: card?.name === undefined
          ? null
          : {
              id: action.card_id,
              name: card.name.s ?? null,
              leftName: card.name.leftName?.s ?? null,
              rightName: card.name.rightName?.s ?? null,
              type: null,
              content: null,
              trashed: verb === "delete",
            },
        verb,
        actId,
        actionId: action.id,
        actor,
        silent: false,
        isDeletePath: verb === "delete",
      });
    }
    const actCard = actRow?.card_id == null ? undefined : await this.fetch.fetchById(actRow.card_id, { lookInTrash: true });
    return { actId, actor, silent: false, events, actCardName: actCard?.name?.s ?? null };
  }

  async performDelayedJob(job: DelayedEventJob): Promise<void> {
    const hooks = this.integrationHooks ?? [
      buildFollowNotifyHook(
        defaultFollowNotifyDeps(this.fetch, {
          followers: this.followerResolver,
          ...(this.followMail === undefined ? {} : { mail: this.followMail }),
        }),
      ),
    ];
    const hook = hooks.find((h) => (h.event ?? h.name) === job.queue);
    if (hook === undefined) {
      throw new Error(`undefined method '${job.methodName}' for an instance of Card`);
    }
    const act = await this.delayedJobAct(job);
    await runIntegrationHooks({
      actId: act.actId,
      actor: act.actor,
      silent: act.silent,
      events: act.events,
      actCardName: act.actCardName ?? null,
      hooks: [hook],
      context: makeNotifyContext(this.notifyTransport ?? defaultTransport, this.notifyLogger),
      onError: (err) => {
        throw err;
      },
    });
  }

  private subcardCreateInput(name: string, sub: SubcardInput, superActionId?: number | null): CreateCardInput {
    return {
      name, subcards: sub.subcards, content: sub.content,
      typeId: sub.typeId, typeCode: sub.typeCode, typeName: sub.typeName,
      attachment: sub.attachment, superActionId,
      ...(sub.history === false ? { history: false } : {}),
      ...(sub.passwordEncrypted === true ? { passwordEncrypted: true } : {}),
    };
  }

  private blankNewSubcard(sub: SubcardInput): boolean {
    return sub.fromEventField !== true && (sub.content === undefined || sub.content === "") &&
      sub.attachment === undefined && (sub.subcards === undefined || Object.keys(sub.subcards).length === 0);
  }

  private async prepareNewSubcards(
    mainName: DeckoName,
    subcards: Record<string, SubcardInput> | undefined,
    prepared: WeakMap<SubcardInput, PreparedCreateValidation>,
    deferEventFields = false,
  ): Promise<void> {
    for (const [key, sub] of Object.entries(subcards ?? {})) {
      if (prepared.has(sub) || (deferEventFields && sub.fromEventField === true)) continue;
      const name = key.startsWith("+") ? `${mainName.s}${key}` : key;
      const existing = await this.fetch.fetchByName(name);
      if (existing !== undefined && !existing.trash) continue;
      const cachedUpload =
        sub.actionIdOfCachedUpload !== undefined ? await this.resolveSubcardCachedUpload(sub, name) : undefined;
      if (this.blankNewSubcard(sub) && cachedUpload === undefined) continue;
      const input = this.subcardCreateInput(name, sub);
      if (cachedUpload !== undefined) input.attachment = cachedUpload.attachment;
      const state = await this.prepareCreateValidation(input);
      if (cachedUpload !== undefined) state.cachedUpload = { release: cachedUpload.release };
      prepared.set(sub, state);
      await this.prepareNewSubcards(DeckoName.parse(name), state.input.subcards, prepared, deferEventFields);
    }
  }

  private earlyPhaseDispatchedKeys = new Set<string>();

  private async dispatchSubcardEarlyPhases(
    mainName: DeckoName,
    subcards: Record<string, SubcardInput> | undefined,
  ): Promise<void> {
    for (const [key, sub] of Object.entries(subcards ?? {})) {
      if (sub.trash === true) continue;
      const name = key.startsWith("+") ? DeckoName.parse(`${mainName.s}${key}`) : DeckoName.parse(key);
      const existing = await this.fetch.fetchByName(name.s);
      const exists = existing !== undefined && !existing.trash && existing.id !== undefined;
      if (!exists && this.blankNewSubcard(sub)) continue;
      const cardKey = name.key;
      if (this.earlyPhaseDispatchedKeys.has(cardKey)) {
        await this.dispatchSubcardEarlyPhases(name, sub.subcards);
        continue;
      }
      this.earlyPhaseDispatchedKeys.add(cardKey);
      const assignedName = sub.name === undefined ? name : DeckoName.parse(sub.name);
      const assignedTypeId = exists
        ? sub.typeId !== undefined || sub.typeCode !== undefined || sub.typeName !== undefined
          ? await resolveTypeId(this.fetch, { ...sub, name: assignedName })
          : existing!.typeId
        : await resolveTypeId(this.fetch, { ...this.subcardCreateInput(name.s, sub), name });
      const existingRow = exists && sub.name !== undefined ? await this.fetchRowById(existing!.id!) : undefined;
      if (exists && sub.name !== undefined && existingRow === undefined) throw new Error("Nested rename lost its stored card before early phases");
      const assignedNameChanged = existingRow !== undefined && await this.updateNameIsChanging(assignedName, existingRow);
      const card = exists
        ? this.eventCard({
            name: assignedName,
            id: existing!.id,
            key: assignedName.key,
            dbContent: sub.content ?? existing!.dbContent ?? null,
            dbContentBeforeAct: existing!.dbContent ?? null,
            action: "update",
            typeId: assignedTypeId,
            typeIdBeforeAct: existing!.typeId,
            patternTypeId: existing!.typeId,
            nameBeforeAct: name.s,
            receiverSetIdentities: [
              { name: name.s, key: existing!.key ?? cardKey, typeId: existing!.typeId },
              { name: assignedName.s, key: assignedName.key, typeId: assignedTypeId },
            ],
            codename: existing!.codename ?? undefined,
            changedFields: [
              ...(sub.content !== undefined && sub.content !== (existing!.dbContent ?? null) ? ["db_content"] : []),
              ...(assignedTypeId !== existing!.typeId ? ["type_id"] : []),
              ...(assignedNameChanged ? ["name"] : []),
            ],
          })
        : this.eventCard({
            name,
            key: cardKey,
            dbContent: sub.content ?? null,
            dbContentBeforeAct: null,
            action: "create",
            typeId: assignedTypeId,
            changedFields: ["name", "type_id", ...(sub.content != null ? ["db_content"] : [])],
          });
      await this.dispatchEventStage("initialize", card);
      await this.dispatchEventStage("prepare_to_validate", card);
      await this.dispatchSubcardEarlyPhases(name, sub.subcards);
    }
  }

  private async resolveSubcardCachedUpload(
    sub: SubcardInput,
    name: string,
  ): Promise<{ attachment: AttachmentInput; release: () => Promise<void> } | undefined> {
    let codename = sub.typeCode;
    if (codename === undefined && sub.typeId !== undefined) {
      codename = (await this.fetchRowById(sub.typeId))?.codename ?? undefined;
    }
    if (codename === undefined) {
      const typeId = await resolveTypeId(this.fetch, { ...sub, name });
      codename = (await this.fetchRowById(typeId))?.codename ?? undefined;
    }
    const mount = codename !== undefined ? ATTACHMENT_MOUNTS[codename] : undefined;
    if (mount === undefined) return undefined;
    return await this.cachedUploadAttachment(sub.actionIdOfCachedUpload!, { mount });
  }

  private async saveSubcardsInWriter(
    writer: ActWriter,
    mainName: DeckoName | undefined,
    subcards: Record<string, SubcardInput> | undefined,
    superActionId: number | null,
    finalizeQueue?: (() => Promise<void>)[],
    deferredSubFinalizes?: DeferredReferenceFinalize[],
    prepared?: WeakMap<SubcardInput, PreparedCreateValidation>,
    cachedUploadReleases?: (() => Promise<void>)[],
  ): Promise<(CardActionSummary & { actId: number })[]> {
    const saved: (CardActionSummary & { actId: number })[] = [];
    if (subcards === undefined) return saved;
    const trashedHere: (CardActionSummary & { actId: number })[] = [];
    const storeOrder = await this.subcardStoreOrder(mainName, subcards);
    await this.prefetchSubcardBlock(storeOrder, mainName);
    for (const [key, sub] of storeOrder) {
      const fullName = key.startsWith("+") ? `${mainName?.s ?? ""}${key}` : key;
      const existing = await this.fetch.fetchByName(fullName);
      const existingRow =
        existing?.id !== undefined && existing.id !== null
          ? await this.fetchRowById(existing.id)
          : undefined;
      if (existingRow !== undefined && existingRow.trash === 0 && sub.trash === true) {
        const trashed = await this.trashInWriter(writer, existingRow, superActionId);
        saved.push(...trashed);
        trashedHere.push(...trashed);
        continue;
      }
      if (existingRow !== undefined && existingRow.trash === 0) {
        let updateCachedUpload: { attachment: AttachmentInput; release: () => Promise<void> } | undefined;
        if (sub.actionIdOfCachedUpload !== undefined) {
          const subTypeRow = await this.fetchRowById(existingRow.type_id);
          const subMount =
            subTypeRow?.codename != null && subTypeRow.codename !== ""
              ? ATTACHMENT_MOUNTS[subTypeRow.codename]
              : undefined;
          if (subMount !== undefined) {
            updateCachedUpload = await this.cachedUploadAttachment(sub.actionIdOfCachedUpload, {
              cardId: existingRow.id,
              mount: subMount,
            });
            if (updateCachedUpload !== undefined) cachedUploadReleases?.push(updateCachedUpload.release);
          }
        }
        const updated = await this.updateInWriter(
          writer,
          existingRow,
          {
            cardId: existingRow.id,
            content: sub.content ?? undefined,
            ...(sub.name !== undefined ? { name: sub.name } : {}),
            typeId: sub.typeId,
            typeCode: sub.typeCode,
            typeName: sub.typeName,
            attachment: updateCachedUpload?.attachment ?? sub.attachment,
            superActionId,
          },
          undefined,
          { isActCard: false, ...(finalizeQueue !== undefined ? { finalizeQueue } : {}) },
        );
        if (updated !== null) {
          saved.push({
            cardId: updated.cardId,
            actionId: updated.actionId,
            actId: updated.actId,
            verb: updated.verb,
            name: updated.name,
          });
        } else {
          const abortedBlankPassword =
            (existingRow.right_id !== null && (await this.fetch.codenames.nameForId(existingRow.right_id))) === "password" &&
            (sub.content ?? "").trim() === "";
          if (!abortedBlankPassword) {
            await this.fetch.driver.query(
              "UPDATE cards SET updated_at = ?, updater_id = ? WHERE id = ?",
              [sqlDateTime(this.clock()), this.currentActorId ?? (await this.actingIdForWrite()) ?? this.actor?.id ?? null, existingRow.id],
            );
          }
        }
        if (sub.subcards !== undefined) {
          saved.push(
            ...(await this.saveSubcardsInWriter(
              writer,
              DeckoName.parse(fullName),
              sub.subcards,
              updated?.actionId ?? superActionId,
              finalizeQueue,
              deferredSubFinalizes,
              prepared,
              cachedUploadReleases,
            )),
          );
        }
      } else {
        const fromPrepared = prepared?.get(sub);
        const subCachedUpload =
          sub.actionIdOfCachedUpload === undefined
            ? undefined
            : fromPrepared?.cachedUpload !== undefined
            ? { attachment: fromPrepared.input.attachment, release: fromPrepared.cachedUpload.release }
            : await this.resolveSubcardCachedUpload(sub, fullName);
        const blankNoop = this.blankNewSubcard(sub) && subCachedUpload === undefined;
        if (blankNoop) continue;
        const subReferenceFinalize: DeferredReferenceFinalize = {};
        const createInput = this.subcardCreateInput(fullName, sub, superActionId);
        if (subCachedUpload !== undefined && fromPrepared === undefined) {
          createInput.attachment = subCachedUpload.attachment;
        }
        const created = await this.createInWriter(
          writer,
          createInput,
          { isActCard: false, deferFinalize: subReferenceFinalize, prepared: fromPrepared, preparedSubcards: prepared },
        );
        if (subCachedUpload?.release !== undefined) cachedUploadReleases?.push(subCachedUpload.release);
        deferredSubFinalizes?.push(subReferenceFinalize);
        if (sub.history !== false) {
          saved.push({
            cardId: created.cardId,
            actionId: created.actionId,
            actId: created.actId,
            verb: created.verb,
            name: created.name,
          });
        }
        if (sub.subcards !== undefined) {
          saved.push(
            ...(await this.saveSubcardsInWriter(
              writer,
              DeckoName.parse(fullName),
              sub.subcards,
              sub.history === false ? superActionId : created.actionId,
              finalizeQueue,
              deferredSubFinalizes,
              prepared,
              cachedUploadReleases,
            )),
          );
        }
        await this.ensureAccountDefaults(
          writer,
          DeckoName.parse(fullName),
          created.cardId,
          created.actionId,
          saved,
        );
        if (deferredSubFinalizes === undefined) {
          await this.runDeferredReferenceFinalize(subReferenceFinalize);
        }
      }
    }
    if (trashedHere.length > 0) {
      const inAct = new Set<number>(trashedHere.map((t) => t.cardId));
      for (const t of trashedHere) {
        saved.push(
          ...(await this.runDeleteChildrenBody(writer, t.cardId, t.actionId, undefined, inAct)),
        );
      }
    }
    return saved;
  }

  private async finalizeAttachment(
    cardId: number,
    actionId: number,
    attachment: AttachmentInput,
    priorIdentifier: string | null,
    verb: "create" | "update",
  ): Promise<string> {
    if (this.attachmentStore === undefined) {
      throw new Error(
        "attachment save requires the engine's attachmentStore option (CardActionEngineOptions.attachmentStore)",
      );
    }
    const ext = detectAttachmentExtension(attachment.originalFilename, attachment.bytes);
    const storedActionId = actionId === 0 ? Math.floor(this.clock().getTime() / 1000) : actionId;
    const cardRow = await this.fetchRowById(cardId);
    const typeRow = cardRow !== undefined ? await this.fetchRowById(cardRow.type_id) : undefined;
    const codename = typeRow?.codename ?? undefined;
    const mount = codename !== undefined ? ATTACHMENT_MOUNTS[codename] : undefined;
    const coded = attachment.coded;
    const renditionNames =
      coded === undefined
        ? codename !== undefined && codename !== "" && mountUsesImageUploader(codename) && createVersionsFor(ext)
          ? renditionFileNames(storedActionId, ext)
          : undefined
        : mountUsesImageUploader(codename ?? "")
          ? [
              `${mount}-original${ext}`,
              ...(createVersionsFor(ext) ? IMAGE_VERSION_NAMES.map((v) => `${mount}-${v}${ext}`) : []),
            ]
          : undefined;
    let renditionBytes: Record<string, Uint8Array> | undefined;
    if (renditionNames !== undefined) {
      const versions = await imageVersionBytes(attachment.bytes, ext);
      if (versions !== undefined) {
        renditionBytes = {};
        for (const v of IMAGE_VERSION_NAMES) {
          renditionBytes[coded === undefined ? `${storedActionId}-${v}${ext}` : `${mount}-${v}${ext}`] = versions[v];
        }
      }
    }
    const storeInput: AttachmentStoreInput = {
      cardId,
      actionId: storedActionId,
      ext,
      bytes: attachment.bytes,
      renditionNames,
      ...(coded !== undefined && coded.mod !== undefined
        ? {
            coded: {
              mod: coded.mod,
              dirParts: await this.attachmentCodenameParts(cardRow),
              mountName: mount ?? "file",
            },
          }
        : {}),
    };
    this.filesStoredThisSave.push(storeInput);
    const store = coded !== undefined && this.codedAttachmentStore !== undefined ? this.codedAttachmentStore : this.attachmentStore;
    const stored = await this.storeWithRollbackCustody(store, {
      ...storeInput,
      ...(renditionBytes !== undefined ? { renditionBytes } : {}),
    }, storeInput);
    const identifier =
      coded !== undefined && coded.mod !== undefined
        ? codedAttachmentIdentifier(
            (storeInput.coded as { dirParts: readonly string[] }).dirParts,
            coded.mod,
            ext,
          )
        : localAttachmentIdentifier(cardId, storedActionId, ext);

    await this.fetch.driver.query("UPDATE cards SET db_content = ? WHERE id = ?", [
      identifier,
      cardId,
    ]);
    if (verb === "update" && actionId !== 0) {
      const result = await this.fetch.driver.query(
        "UPDATE card_changes SET value = ? WHERE card_action_id = ? AND field = ?",
        [
          changeValueForField("db_content", identifier),
          actionId,
          trackedFieldIndex("db_content"),
        ],
      );
      if ((result.rowsAffected ?? 0) === 0 && priorIdentifier !== null) {
        await this.fetch.driver.query(
          "INSERT INTO card_changes (card_action_id, field, value) VALUES (?, ?, ?)",
          [actionId, trackedFieldIndex("db_content"), changeValueForField("db_content", identifier)],
        );
      }
    }
    return identifier;
  }

  private attachmentIntermediateIdentifier(
    cardId: number,
    priorContent: string | null | undefined,
    attachment: AttachmentInput,
  ): string {
    const ext = detectAttachmentExtension(attachment.originalFilename, attachment.bytes);
    const priorAction = lastContentActionIdFromIdentifier(priorContent) ?? 0;
    return localAttachmentIdentifier(cardId, priorAction, ext);
  }

  private async validateFileExist(input: CreateCardInput, typeId: number): Promise<void> {
    const typeRow = await this.fetchRowById(typeId);
    const codename = typeRow?.codename ?? undefined;
    const mount = codename !== undefined ? ATTACHMENT_MOUNTS[codename] : undefined;
    if (mount === undefined) return;
    if (this.fileStorage === "web") {
      const content = input.content ?? "";
      if (content === "" || /^\s*$/.test(content)) {
        throw new CardActionError(
          "attachment-missing",
          "Validation failed: Url is missing is invalid",
        );
      }
      return;
    }
    const humanized = mount.charAt(0).toUpperCase() + mount.slice(1);
    const missing = (): CardActionError =>
      new CardActionError(
        "attachment-missing",
        `Validation failed: ${humanized} is missing`,
        `${mount.toUpperCase()}: is missing`,
        undefined,
        typeof input.name === "string" ? input.name : undefined,
      );
    if (input.attachment === undefined) {
      throw missing();
    }
    if (mountUsesImageUploader(mount)) {
      const ext = detectAttachmentExtension(input.attachment.originalFilename, input.attachment.bytes);
      if (canResize(ext) && !(await imageDecodes(input.attachment.bytes))) throw missing();
    }
  }

  private async validateCodedStorageType(
    attachment: AttachmentInput | undefined,
    name: DeckoName,
  ): Promise<void> {
    const coded = attachment?.coded;
    if (coded === undefined) return;
    const problems: string[] = [];
    if (coded.mod === undefined || coded.mod === "") {
      problems.push("Storage type mod argument needed to save card as coded");
    }
    const parts = await Promise.all(
      name.partNames.map(async (part) => {
        const id = await this.fetch.lexicon.id(part);
        return id === undefined ? undefined : (await this.fetchRowById(id))?.codename ?? undefined;
      }),
    );
    if (parts.some((p) => p === undefined || p === "")) {
      problems.push("Storage type codename needed for storage type coded");
    }
    if (problems.length > 0) {
      throw new CardActionError(
        "validation-failed",
        `Validation failed: ${problems.join(", ")}`,
        `STORAGE TYPE: ${problems.map((p) => p.replace(/^Storage type /, "")).join(", ")}`,
      );
    }
  }

  private async attachmentCodenameParts(cardRow: CardsRow | undefined): Promise<readonly string[]> {
    if (cardRow === undefined) return [];
    const name = (await this.fetch.fetchById(cardRow.id))?.name;
    const parts: string[] = [];
    if (name !== undefined) {
      for (const part of name.partNames) {
        const id = await this.fetch.lexicon.id(part);
        const code = id === undefined ? undefined : (await this.fetchRowById(id))?.codename ?? undefined;
        if (code !== undefined && code !== "") parts.push(code);
      }
    }
    return parts;
  }

  async createCard(input: CreateCardInput): Promise<ActionResult> {
    const outermostAct = this.saveDepth === 0;
    if (outermostAct) this.actEnvBodyOutcomes = [];
    const outerAttributes = this.activeSaveAttributes;
    try {
      const result = await this.atomicSave(async () => this.createCardInner(await knownTypeSpec(this.fetch, input)));
      return outermostAct
        ? (this.takeActEnvOutcomes(result, "create") as ActionResult)
        : result;
    } catch (error) {
      if (error instanceof ModEventAbortSuccess) {
        return { cardId: 0, actionId: 0, actId: 0, subactions: [], verb: "create" };
      }
      await this.reportServerError(
        this.eventCard({ name: DeckoName.parse(input.name ?? ""), action: "create" }),
        error,
      );
      throw error;
    } finally {
      this.pendingSaveInput = undefined;
      this.activeSaveAttributes = outerAttributes;
    }
  }

  private async applyAccountFieldEvents(input: CreateCardInput, typeId: number): Promise<CreateCardInput> {
    const signupId = await this.fetch.codenames.id("signup");
    const holderIsSignup = signupId !== undefined && typeId === signupId;
    const account = input.subcards?.["+*account"];
    if (account === undefined) {
      if (holderIsSignup) {
        throw new CardActionError(
          "user-error",
          "sign up without an account",
          "ACCOUNT: required\n+*ACCOUNT: email required",
          { account: "required", "+*account": "email required" },
        );
      }
      return input;
    }
    const fields: Record<string, { content?: string | null }> = {};
    for (const [k, v] of Object.entries(account.subcards ?? {})) fields[k] = { content: v.content };
    const emailId = await this.fetch.codenames.id("email");
    const plan = await planAccountFields({
      fields,
      holderIsSignup,
      canApprove: holderIsSignup && (await this.canApproveSignups()),
      emailTaken: async (email) => {
        if (emailId === undefined) return false;
        const r = await this.fetch.driver.query<{ id: number }>(
          "SELECT id FROM cards WHERE right_id = ? AND db_content = ? AND trash = 0 LIMIT 1",
          [emailId, email],
        );
        return r.rows.length > 0;
      },
      now: this.clock(),
    });
    if (plan.errors.length > 0) {
      throw new CardActionError("user-error", `account fields rejected: ${plan.errors.join("; ")}`, plan.errors.join("\n"));
    }
    const subcards: Record<string, SubcardInput> = {};
    for (const w of plan.writes) {
      subcards[w.key] = {
        ...(account.subcards?.[w.key] ?? {}),
        content: w.content,
        ...(w.history ? {} : { history: false }),
        ...(w.key === "+*password" ? { passwordEncrypted: true } : {}),
      };
    }
    return { ...input, subcards: { ...input.subcards, "+*account": { ...account, subcards } } };
  }

  private async assertMayRenameAccountHolder(cardId: number): Promise<void> {
    const accountId = await this.fetch.codenames.id("account");
    if (accountId === undefined) return;
    const r = await this.fetch.driver.query<{ id: number }>(
      CARD_ID_BY_JUNCTION_SQL,
      [cardId, accountId],
    );
    if (r.rows.length === 0) return;
    const state = await this.writePermissionState();
    if (this.actor !== null && this.actor.id === cardId) return;
    const helpDesk = await this.fetch.codenames.id("help_desk");
    if (helpDesk !== undefined && state.viewerParties.includes(helpDesk)) return;
    throw new CardActionError(
      "user-error",
      "cannot rename Account Holder",
      "NAME: cannot rename Account Holder",
    );
  }

  private async checkSkinFieldPermissions(name: DeckoName, typeId: number): Promise<void> {
    const skinTypeId = await this.fetch.codenames.id("bootswatch_skin");
    if (skinTypeId === undefined || typeId !== skinTypeId) return;
    const scssId = await this.fetch.codenames.id("scss");
    if (scssId === undefined) return;
    const fieldName = `${name.s}+*variables`;
    const probe = newCardRecord(DeckoName.parse(fieldName), { typeId: scssId });
    const verdict = await saveTaskVerdictForCard(
      this.fetch,
      await this.patternInputFor(probe, scssId),
      "create",
      await this.writePermissionState(),
    );
    if (verdict !== true) {
      const message = `You don't have permission to create ${fieldName}`;
      throw new CardActionError(
        "user-error",
        `skin field denied: ${message}`,
        `+*VARIABLES: permission_denied ${message}`,
        { "+*variables": `permission_denied ${message}` },
      );
    }
  }

  private async assertLayoutHasMainNest(
    row: CardsRow,
    content: string | null | undefined,
    assignedTypeId: number | undefined,
  ): Promise<void> {
    const layoutTypeId = await this.fetch.codenames.id("layout_type");
    if (layoutTypeId === undefined || (assignedTypeId ?? row.type_id) !== layoutTypeId) return;
    const nests = (text: string): string[] =>
      [...text.matchAll(/\{\{([^}|]*)/g)].map((m) => m[1].trim()).filter((n) => n !== "");
    const hasMain = async (text: string, depth: number): Promise<boolean> => {
      const names = nests(text);
      if (names.some((n) => n === "_main")) return true;
      if (depth > 5) return false;
      for (const n of names) {
        if (n.startsWith("_")) continue;
        const nested = await this.fetch.fetchByKey(DeckoName.parse(n).key);
        if (nested !== undefined && !nested.trash && (await hasMain(nested.dbContent ?? "", depth + 1))) return true;
      }
      return false;
    };
    if (await hasMain(content ?? row.db_content ?? "", 0)) return;
    const name = (await this.composedNameOf(row))?.s ?? String(row.id);
    const message = `no main nest found in layout "${name}"`;
    throw new CardActionError("user-error", message, `ERROR: ${message}`, { Error: message }, name);
  }

  private async applySkinTypeChange(
    row: CardsRow,
    input: UpdateCardInput,
    assignedTypeId: number | undefined,
  ): Promise<UpdateCardInput> {
    const skinTypeId = await this.fetch.codenames.id("bootswatch_skin");
    if (skinTypeId === undefined || assignedTypeId !== skinTypeId) return input;
    const cssId = await this.fetch.codenames.id("css");
    const scssId = await this.fetch.codenames.id("scss");
    const skinListId = await this.fetch.codenames.id("skin");
    if (scssId === undefined) return input;
    const items = (row.db_content ?? "")
      .split(/\n+/)
      .map((i) => i.replace(/\[\[|\]\]/g, "").trim())
      .filter((i) => i !== "" && DeckoName.parse(i).key !== DeckoName.parse("bootstrap default skin").key);
    const typeNames = await Promise.all(
      [cssId, scssId].map(async (id) => (id === undefined ? undefined : await this.typeNameOf(id))),
    );
    const allowed = typeNames.filter((n): n is string => n !== undefined).join(" and ");
    const problems: string[] = [];
    for (const item of items) {
      const card = await this.fetch.fetchByKey(DeckoName.parse(item).key);
      const typeId = card?.typeId ?? undefined;
      if (typeId === cssId || typeId === scssId) continue;
      const typeName = typeId === undefined || typeId === null ? "?" : await this.typeNameOf(typeId);
      problems.push(`+*STYLESHEETS: ${card?.name?.s ?? item} has an invalid type: ${typeName}. Allowed types: ${allowed}.`);
    }
    if (problems.length > 0) {
      throw new CardActionError("user-error", "skin stylesheets rejected", problems.join("\n"));
    }
    const subcards: Record<string, SubcardInput> = { ...input.subcards };
    subcards["+*colors"] ??= { typeId: scssId, fromEventField: true };
    subcards["+*variables"] ??= { typeId: scssId, fromEventField: true };
    if (items.length > 0) {
      subcards["+*stylesheets"] ??= {
        ...(skinListId === undefined ? {} : { typeId: skinListId }),
        content: items.join("\n"),
        fromEventField: true,
      };
    }
    return { ...input, subcards };
  }

  private async applySkinCreateEvents(input: CreateCardInput, typeId: number): Promise<CreateCardInput> {
    const skinTypeId = await this.fetch.codenames.id("bootswatch_skin");
    if (skinTypeId === undefined || typeId !== skinTypeId) return input;
    const parentId = await this.fetch.codenames.id("parent");
    const parentCard = parentId === undefined ? undefined : await this.fetch.fetchById(parentId);
    const parentKey = parentCard?.name?.key ?? DeckoName.parse("parent").key;
    const parentEntry = Object.entries(input.subcards ?? {}).find(
      ([k]) => DeckoName.parse(k.replace(/^\+/, "")).key === parentKey,
    )?.[1];
    const firstItem = (parentEntry?.content ?? "")
      .split(/\n+/)
      .map((i) => i.replace(/\[\[|\]\]/g, "").trim())
      .find((i) => i !== "");
    if (firstItem !== undefined) {
      const parent = await this.fetch.fetchByKey(DeckoName.parse(firstItem).key);
      if (parent !== undefined && !parent.trash && parent.typeId !== skinTypeId) {
        const message = `not a valid theme ${parent.name?.s ?? firstItem}`;
        if (strictParityFlags().skinCreate500) {
          throw new StrictParityCrashError(
            "DECKO_STRICT_PARITY_SKIN_CREATE_500",
            `strict parity: Ruby crashes creating a skin whose parent is not a skin (theme_card's NoMethodError on ${parent.name?.s ?? firstItem}); the port refused it with "${message}" instead (strict mode off)`,
          );
        }
        throw new CardActionError("user-error", message, `ABORT: ${message}`, { abort: message });
      }
    }
    const scssId = await this.fetch.codenames.id("scss");
    if (scssId === undefined) return input;
    const subcards: Record<string, SubcardInput> = { ...input.subcards };
    for (const field of ["+*colors", "+*variables"]) {
      if (subcards[field] === undefined) subcards[field] = { typeId: scssId, fromEventField: true };
    }
    return { ...input, subcards };
  }

  private async passwordFieldContent(
    rightId: number | undefined,
    leftId: number | null | undefined,
    content: string | null | undefined,
    verb: "create" | "update",
  ): Promise<{ content: string } | { skip: true } | undefined> {
    const passwordId = await this.fetch.codenames.id("password");
    if (passwordId === undefined || rightId !== passwordId) return undefined;
    const raw = content ?? "";
    if (verb === "update" && raw.trim() === "") return { skip: true };
    const problems = passwordErrors(raw);
    if (problems.length > 0) {
      throw new CardActionError(
        "user-error",
        "password field rejected",
        problems.map((m) => `PASSWORD: ${m}`).join("\n"),
      );
    }
    let salt = "";
    const saltId = await this.fetch.codenames.id("salt");
    if (leftId !== null && leftId !== undefined && saltId !== undefined) {
      const r = await this.fetch.driver.query<{ db_content: string | null }>(
        "SELECT db_content FROM cards WHERE left_id = ? AND right_id = ? AND trash = 0 LIMIT 1",
        [leftId, saltId],
      );
      salt = r.rows[0]?.db_content ?? "";
    }
    return { content: await encryptPassword(raw, salt) };
  }

  async canApproveSignups(): Promise<boolean> {
    return signupApprovalAllowed(this.fetch, await this.writePermissionState());
  }

  private async runUpdateLexiconBody(
    verb: "create" | "update",
    cardId: number,
    nameAfter: DeckoName | undefined,
    lexAfter: Lex | undefined,
    lexBefore?: Lex,
  ): Promise<void> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find((e) => e.event === "update_lexicon");
    if (runtime === undefined || registered === undefined) {
      if (verb === "create") {
        if (nameAfter !== undefined && lexAfter !== undefined) {
          this.fetch.lexicon.write(cardId, nameAfter, lexAfter);
        }
        return;
      }
      this.fetch.lexicon.deleteFor(undefined, lexBefore);
      if (nameAfter !== undefined && lexAfter !== undefined) {
        this.fetch.lexicon.write(cardId, nameAfter, lexAfter);
      }
      return;
    }
    if (this.skipsEvent("update_lexicon")) return;
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "store",
      skipEvent: (n) => this.skipsEvent(n),
      lexiconAdd: () => {
        if (nameAfter !== undefined && lexAfter !== undefined) {
          this.fetch.lexicon.write(cardId, nameAfter, lexAfter);
        }
      },
      lexiconUpdate: () => {
        this.fetch.lexicon.deleteFor(undefined, lexBefore);
        if (nameAfter !== undefined && lexAfter !== undefined) {
          this.fetch.lexicon.write(cardId, nameAfter, lexAfter);
        }
      },
    };
    await registered.fn(
      this.eventCard({
        name: nameAfter,
        id: cardId,
        action: verb,
        trash: false,
      }),
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
  }

  private async runValidateNameBody(
    name: DeckoName,
    context?: { cardId?: number; oldName?: string | null },
  ): Promise<void> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find((e) => e.event === "validate_name");
    if (runtime === undefined || registered === undefined) {
      await this.runValidateLegalityBody(name, context);
      return;
    }
    if (this.skipsEvent("validate_name")) return;
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "validate",
      skipEvent: (n) => this.skipsEvent(n),
      validateLegality: async () => {
        await this.runValidateLegalityBody(name, context);
      },
      errorsAny: () => false,
      validateUniqueness: async () => {
        await this.runValidateUniquenessBody(name, context?.cardId);
      },
    };
    await registered.fn(
      this.eventCard({
        name,
        key: name.key,
        action: context?.cardId === undefined ? "create" : "update",
      }),
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
  }

  private hasRegisteredBody(name: string): boolean {
    return this.modEvents?.registry.all().some((e) => e.event === name) === true;
  }

  private async runValidateRenamingBody(
    name: DeckoName,
    context: {
      cardId: number;
      currentKey: string;
      currentName: string | null;
      beforeName: string | null;
      contentChanging: boolean;
      typeChanging: boolean;
    },
  ): Promise<void> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find((e) => e.event === "validate_renaming");
    if (runtime === undefined || registered === undefined) return;
    if (this.skipsEvent("validate_renaming")) return;
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "validate",
      skipEvent: (n) => this.skipsEvent(n),
      sameNameAsBefore: () => name.key === context.currentKey,
      contentIsChanging: () => context.contentChanging,
      typeIsChanging: () => context.typeChanging,
      refuseContentChange: (message: string): never => {
        throw new CardActionError(
          "rename-conflict",
          "content cannot change in the same save as a rename",
          `CONTENT: ${message}`,
        );
      },
      refuseTypeChange: (message: string): never => {
        throw new CardActionError(
          "rename-conflict",
          "type cannot change in the same save as a rename",
          `TYPE: ${message}`,
        );
      },
      detectIllegalCompoundNames: async () => {
        if (context.beforeName === null || !name.isCompound) return;
        const tags = await this.childIds("right", context.cardId);
        if (tags.length === 0) return;
        throw new CardActionError(
          "rename-conflict",
          `illegal name change; existing names end in +${context.currentName ?? context.beforeName}`,
        );
      },
    };
    await registered.fn(
      this.eventCard({ name, key: name.key, action: "update" }),
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
  }

  private async runValidateUniquenessBody(
    name: DeckoName,
    selfId: number | undefined,
  ): Promise<void> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find(
      (e) => e.event === "validate_uniqueness_of_name",
    );
    if (runtime === undefined || registered === undefined) {
      await assertNameAvailable(this.fetch, name, selfId);
      return;
    }
    if (this.skipsEvent("validate_uniqueness_of_name")) return;
    const lexicon = currentNameLexicon(this.fetch);
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "validate",
      skipEvent: (n) => this.skipsEvent(n),
      cardKey: () => name.key,
      cardId: () => selfId,
      lexiconId: async (key: string) => await lexicon.id(key),
      liveCardName: async (id: number) => {
        const result = await this.fetch.driver.query<Pick<CardsRow, "name">>(
          "SELECT name FROM cards WHERE id = ? AND trash = 0 LIMIT 1",
          [id],
        );
        const row = result.rows[0];
        if (row === undefined) return undefined;
        return row.name ?? (await lexicon.name(id))?.s;
      },
      refuseNameTaken: (existingName: string): never => {
        throw new CardActionError(
          "name-conflict",
          `name is already taken: ${existingName}`,
          `NAME: must be unique; '${existingName}' already exists.`,
          undefined,
          name.s,
        );
      },
    };
    await registered.fn(
      this.eventCard({
        name,
        key: name.key,
        action: selfId === undefined ? "create" : "update",
      }),
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
  }

  private async runValidateLegalityBody(
    name: DeckoName,
    context?: { cardId?: number; oldName?: string | null },
  ): Promise<void> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find(
      (e) => e.event === "validate_legality_of_name",
    );
    if (runtime === undefined || registered === undefined) {
      validateNameLegality(name);
      return;
    }
    if (this.skipsEvent("validate_legality_of_name")) return;
    const cardId = context?.cardId;
    const oldName = context?.oldName ?? null;
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "validate",
      skipEvent: (n) => this.skipsEvent(n),
      cardName: () => name.s,
      nameBlank: () => name.s === "",
      nameIncomplete: () => name.parts.includes(""),
      nameValid: () => name.isValid,
      bannedCharacters: () => DeckoName.bannedCharacters.join(" "),
      changingExistingTagToCompound: async () => {
        if (cardId === undefined || oldName === null || !name.isCompound) return false;
        const tags = await this.childIds("right", cardId);
        return tags.length > 0;
      },
      refuseName: (message: string, arm: NameLegalityArm): never => {
        throw nameLegalityError(arm, message, name);
      },
      refuseNameTagInUse: (message: string): never => {
        throw new CardActionError(
          "rename-conflict",
          `illegal name change; existing names end in +${oldName ?? name.s}`,
          `NAME: ${message}`,
        );
      },
    };
    await registered.fn(
      this.eventCard({ name, key: name.key, action: cardId === undefined ? "create" : "update" }),
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
  }

  private async runValidateKeyBody(
    name: DeckoName,
    action: "create" | "update",
  ): Promise<void> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find((e) => e.event === "validate_key");
    if (runtime === undefined || registered === undefined) {
      validateComputedKey(name);
      return;
    }
    if (this.skipsEvent("validate_key")) return;
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "validate",
      skipEvent: (n) => this.skipsEvent(n),
      cardKey: () => name.key,
      nameKey: () => name.key,
      cardName: () => name.s,
      refuseKey: (message: string): never => {
        throw new CardActionError(
          "validation-failed",
          `Validation failed: Key ${message}`,
          `KEY: ${message}`,
          { key: message },
          name.s,
        );
      },
    };
    await registered.fn(
      this.eventCard({ name, key: name.key, action }),
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
  }

  private async applyDefaultContent(
    name: DeckoName,
    typeId: number,
    assign: (content: string) => void,
  ): Promise<void> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find((e) => e.event === "set_default_content");
    if (runtime === undefined || registered === undefined) {
      const templateContent = await this.newCardTemplateContent(name, typeId);
      if (templateContent !== undefined) assign(templateContent);
      return;
    }
    if (this.skipsEvent("set_default_content")) return;
    let assigned: string | undefined;
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "prepare_to_validate",
      skipEvent: (n) => this.skipsEvent(n),
      defaultContent: async () => this.newCardTemplateContent(name, typeId),
      setDbContent: (content) => {
        assigned = content;
      },
    };
    await registered.fn(
      this.eventCard({ name, action: "create" }),
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
    if (assigned !== undefined) assign(assigned);
  }

  private async prepareStoredContent(
    card: ModEventCard,
    content: string,
    typeId: number | null,
    rightId: number | null,
    assign: (prepared: string) => void,
  ): Promise<void> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find((e) => e.event === "set_content");
    if (runtime === undefined || registered === undefined) {
      assign(await this.cleanForStore(content, typeId, rightId));
      return;
    }
    if (this.skipsEvent("set_content")) {
      assign(content);
      return;
    }
    let prepared: string | undefined;
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "store",
      skipEvent: (n) => this.skipsEvent(n),
      prepareDbContent: async (value) => this.cleanForStore(value, typeId, rightId),
      setContent: (value) => {
        prepared = value;
      },
      clearDrafts: () => undefined,
    };
    await registered.fn(
      card,
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
    assign(prepared ?? content);
  }

  private async autonamedCreateInput(input: CreateCardInput, typeId: number): Promise<CreateCardInput> {
    const settingId = await this.fetch.codenames.id("autoname");
    const setting = settingId === undefined ? undefined : await this.fetch.fetchById(settingId);
    if (setting?.name === undefined) return input;
    const pattern = await ruleWalkPatternInput(this.fetch, { name: DeckoName.parse(""), isNew: true, typeId });
    const found = await findRule(this.fetch, pattern, setting.name);
    const rule = found?.rule;
    if (rule?.id === undefined || typeof rule.dbContent !== "string" || rule.dbContent.trim() === "") return input;
    const ruleId = rule.id;
    const ruleContent = rule.dbContent;
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find((e) => e.event === "set_autoname");
    if (runtime !== undefined && registered !== undefined) {
      if (this.skipsEvent("set_autoname")) return input;
      let assigned: string | undefined;
      const ctx: ModEventContext = {
        driver: this.fetch.driver,
        lexicon: this.fetch.lexicon,
        stage: "prepare_to_store",
        skipEvent: (n) => this.skipsEvent(n),
        autonameRule: async () => ({ id: ruleId, content: ruleContent }),
        autonameName: (seed) => this.autonameSuccessor(seed),
        setCardName: (name) => {
          assigned = name;
        },
        updateAutonameRuleContent: async (name) => {
          await this.fetch.driver.query("UPDATE cards SET db_content = ? WHERE id = ?", [name, ruleId]);
        },
        expireAutonameRule: () => {
          this.fetch.expireCard(rule);
        },
      };
      await registered.fn(
        this.eventCard({ name: DeckoName.parse(input.name ?? ""), action: "create" }),
        runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
        ctx,
      );
      expireRuleResolutionCache(this.fetch.driver);
      return assigned === undefined ? input : { ...input, name: assigned };
    }
    let name = DeckoName.parse(rule.dbContent);
    for (;;) {
      const existing = await this.fetch.fetchByName(name);
      if (existing?.id === undefined || existing.trash === true) break;
      name = name.succ();
    }
    await this.fetch.driver.query("UPDATE cards SET db_content = ? WHERE id = ?", [name.s, rule.id]);
    this.fetch.expireCard(rule);
    expireRuleResolutionCache(this.fetch.driver);
    return { ...input, name: name.s };
  }

  private async autonameSuccessor(seed: string): Promise<string> {
    let name = DeckoName.parse(seed);
    for (;;) {
      const existing = await this.fetch.fetchByName(name);
      if (existing?.id === undefined || existing.trash === true) break;
      name = name.succ();
    }
    return name.s;
  }

  private async createCardInner(input: CreateCardInput): Promise<ActionResult> {
    this.earlyPhaseDispatchedKeys.clear();
    let name = DeckoName.parse(input.name ?? "");
    this.assertAccountsHaveEmail(input.subcards);
    const actingId = await this.actingIdForWrite();
    if (actingId === undefined) this.assertWritable();
    await this.declareStandardCards();
    await this.declareSaveInputTree(name, input.subcards, input);
    await this.assertAccountFieldLeftExists(name);
    const typeId = await resolveTypeId(this.fetch, { ...input, name });
    const placeholder = newCardRecord(name, { typeId });
    await this.assertCanWrite(placeholder, "create");
    if (name.s === "") {
      input = await this.autonamedCreateInput(input, typeId);
      name = DeckoName.parse(input.name ?? "");
    }
    const typeRow = await this.fetchRowById(typeId);
    if (typeRow?.codename === "session") {
      await this.prepareCreateValidation(input, typeId);
      return { cardId: 0, actionId: 0, actId: 0, subactions: [], verb: "create" };
    }
    if (await this.isVirtualCacheCardName(name)) {
      await this.prepareCreateValidation(input, typeId);
      const leftCardId = name.leftName !== undefined
        ? await this.fetch.lexicon.id(name.leftName)
        : undefined;
      const rightCardId = name.rightName !== undefined
        ? await this.fetch.lexicon.id(name.rightName)
        : undefined;
      await virtualSave(
        this.fetch.driver,
        { ...placeholder, dbContent: input.content ?? undefined },
        this.virtualCache,
        this.clock(),
        { leftCardId, rightCardId },
      );
      return { cardId: 0, actionId: 0, actId: 0, subactions: [], verb: "create" };
    }
    let cachedUpload: { attachment: AttachmentInput; release: () => Promise<void> } | undefined;
    if (input.actionIdOfCachedUpload !== undefined) {
      const typeRow = await this.fetchRowById(typeId);
      const mount =
        typeRow?.codename != null && typeRow.codename !== ""
          ? ATTACHMENT_MOUNTS[typeRow.codename]
          : undefined;
      if (mount !== undefined) {
        cachedUpload = await this.cachedUploadAttachment(input.actionIdOfCachedUpload, { mount });
        if (cachedUpload !== undefined) input = { ...input, attachment: cachedUpload.attachment };
      }
    }
    input = await this.applyAccountFieldEvents(input, typeId);
    await this.checkSkinFieldPermissions(name, typeId);
    input = await this.applySkinCreateEvents(input, typeId);
    this.setActiveSaveAttributes(input);
    await assertStyleCompilerFor(this.styleAssetContext(actingId), name, typeId);
    await this.validateCssSaveTree(name, input, undefined, typeId);
    const prepared = await this.prepareCreateValidation(input, typeId);
    input = prepared.input;
    const preparedSubcards = new WeakMap<SubcardInput, PreparedCreateValidation>();
    await this.prepareNewSubcards(name, input.subcards, preparedSubcards, true);
    const writer = this.newWriter(actingId);
    const finalizeQueue: (() => Promise<void>)[] = [];
    const subCachedUploadReleases: (() => Promise<void>)[] = [];
    let result: ActionResult;
    const referenceFinalize: DeferredReferenceFinalize = {};
    try {
      result = await this.createInWriter(writer, input, {
        isActCard: true,
        resolvedTypeId: typeId,
        deferFinalize: referenceFinalize,
        prepared,
        preparedSubcards,
      });
    } catch (error) {
      await this.dropUnfilledActions(writer);
      throw error;
    }
    let finalResult = result;
    const deferredSubFinalizes: DeferredReferenceFinalize[] = [];
    const subResults = await this.saveSubcardsInWriter(writer, name, input.subcards, result.actionId, finalizeQueue, deferredSubFinalizes, preparedSubcards, subCachedUploadReleases);
    await this.ensureAccountDefaults(writer, name, result.cardId, result.actionId, subResults);
    if (subResults.length > 0) {
      finalResult = { ...result, subactions: [...result.subactions, ...subResults] };
    }
    await this.runDeferredReferenceFinalize(referenceFinalize);
    for (const d of deferredSubFinalizes) {
      await this.runDeferredReferenceFinalize(d);
    }
    await runStyleAssetEvents(this.styleAssetContext(actingId), this.savedCardsOf(finalResult));
    await this.afterCommit(async () => {
      await this.bumpAncestorTimestamps(CardActionEngine.savedCardIds(finalResult));
      await this.dispatchEventStage(
        "integrate",
        this.eventCard({
          name,
          id: result?.cardId,
          key: name.key,
          action: "create",
          actId: result?.actId,
          trash: false,
          typeId,
        }),
      );
      if (cachedUpload !== undefined) await cachedUpload.release();
      for (const release of subCachedUploadReleases) await release();
      await this.saveRecentlyEditedSettings(finalResult);
      await this.dispatchSavePathIntegrations(finalResult, {
        delayedStageDropped: input.attachment !== undefined && input.attachment.fromCachedUpload !== true,
        withinOtherAct: (input as { withinOtherAct?: boolean }).withinOtherAct === true,
      });
    });
    return finalResult;
  }

  private async prepareCreateValidation(input: CreateCardInput, resolvedTypeId?: number): Promise<PreparedCreateValidation> {
    const name = DeckoName.parse(input.name ?? "");
    if (input.passwordEncrypted !== true && name.isCompound && name.rightName !== undefined) {
      const rightId = await this.fetch.lexicon.id(name.rightName);
      const leftId = name.leftName !== undefined ? await this.fetch.lexicon.id(name.leftName) : undefined;
      const pw = await this.passwordFieldContent(rightId, leftId, input.content, "create");
      if (pw !== undefined && "content" in pw) input = { ...input, content: pw.content, passwordEncrypted: true };
    }
    let eventTypeId = resolvedTypeId;
    const validationCard = (): ModEventCard =>
      this.eventCard({
        name,
        key: name.key,
        dbContent: input.content,
        dbContentBeforeAct: null,
        action: "create",
        typeId: eventTypeId,
      });
    if (this.earlyPhaseDispatchedKeys.has(name.key)) {
    } else {
      this.earlyPhaseDispatchedKeys.add(name.key);
      await this.dispatchEventStage("initialize", validationCard());
      await this.prepareSubcardCollection(input.subcards, name);
      await this.dispatchEventStage("prepare_to_validate", validationCard());
      this.pendingSubcardCollection = undefined;
      await this.dispatchSubcardEarlyPhases(name, input.subcards);
    }
    await this.runValidateNameBody(name);
    const typeId =
      resolvedTypeId ??
      (await resolveTypeId(this.fetch, { ...input, name }));
    eventTypeId = typeId;
    if (input.content != null && input.attachment === undefined) {
      input.content = await this.standardizeAssignedContent(
        input.content,
        typeId,
        name.isCompound && name.leftName !== undefined ? ((await this.fetch.lexicon.id(name.leftName)) ?? null) : null,
        name.isCompound && name.rightName !== undefined ? ((await this.fetch.lexicon.id(name.rightName)) ?? null) : null,
        (input as { codename?: string }).codename,
      );
    }
    if (input.content == null && input.attachment === undefined) {
      await this.applyDefaultContent(name, typeId, (content) => {
        input.content = content;
      });
    }
    if (!this.hasRegisteredBody("validate_name")) {
      await this.runValidateUniquenessBody(name, undefined);
    }
    await this.runValidateKeyBody(name, "create");
    await this.validateFileExist(input, typeId);
    await this.validateCodedStorageType(input.attachment, name);
    await this.prepareRecaptchaSaveInput(
      input.recaptchaToken,
      "create",
      await ruleWalkPatternInput(this.fetch, { name, isNew: true, typeId }),
    );
    await this.dispatchEventStage("validate", validationCard());

    return { input, typeId };
  }

  private async createInWriter(
    writer: ActWriter,
    input: CreateCardInput,
    opts: {
      isActCard: boolean;
      resolvedTypeId?: number;
      prepared?: PreparedCreateValidation;
      preparedSubcards?: WeakMap<SubcardInput, PreparedCreateValidation>;
      deferFinalize?: DeferredReferenceFinalize;
    },
  ): Promise<ActionResult> {
    const prepared = opts.prepared ?? await this.prepareCreateValidation(input, opts.resolvedTypeId);
    input = { ...prepared.input, superActionId: input.superActionId };
    const typeId = prepared.typeId;
    const name = DeckoName.parse(input.name ?? "");
    const targetRightId = name.rightName === undefined ? undefined : await this.fetch.lexicon.id(name.rightName);
    if (await this.isAssetOutputRight(targetRightId)) input.history = false;
    const validationCard = (): ModEventCard => this.eventCard({
      name, key: name.key, dbContent: input.content, dbContentBeforeAct: null,
      action: "create", typeId,
    });

    const plannedActionId = this.plannedAccountFieldActions.get(name.key);
    if (plannedActionId !== undefined) this.plannedAccountFieldActions.delete(name.key);
    if (plannedActionId !== undefined && input.history === false) throw new Error('planned account field became historyless');
    const reservedActionId = plannedActionId ?? (name.isCompound && input.history !== false
      ? await writer.reserveAction({ actionType: "create", superActionId: input.superActionId ?? null })
      : undefined);
    await this.reserveStandardAccountFieldsBeforeHolder(writer, name, input, targetRightId, reservedActionId);
    const sides = await this.runPrepareLeftAndRightBody(writer, name, undefined, {
      reserveOwnAction: true,
    });

    const lex = this.lexOf(name, sides.leftId, sides.rightId);
    const trashed = await this.runManageTrashBody(lex, validationCard());
    await this.applyAddComment(input, "create", name, input.content ?? undefined, (c) => {
      input.content = c;
    });
    await this.dispatchEventStage("prepare_to_store", validationCard());
    if (opts.preparedSubcards !== undefined) {
      await this.prepareNewSubcards(name, input.subcards, opts.preparedSubcards);
    }
    if (input.content != null && input.attachment === undefined) {
      await this.prepareStoredContent(
        this.eventCard({ name, id: undefined, dbContent: input.content, action: "create" }),
        input.content,
        typeId,
        name.isSimple ? null : sides.rightId,
        (prepared) => {
          input.content = prepared;
        },
      );
    }

    if (trashed !== undefined) {
      const before = cardFieldStateFromRow(trashed);
      const after: CardFieldState = {
        name: name.isSimple ? name.s : null,
        type_id: typeId,
        db_content: input.content ?? "",
        trash: 0,
        left_id: name.isSimple ? null : sides.leftId,
        right_id: name.isSimple ? null : sides.rightId,
      };
      await this.dispatchEventStage(
        "store",
        this.eventCard({
          name,
          id: trashed.id,
          key: name.key,
          dbContent: input.content,
          dbContentBeforeAct: trashed.db_content ?? null,
          action: "create",
          trash: false,
          typeId,
          changedFields: [
            "name",
            "type_id",
            "trash",
            ...((input.content ?? null) !== (trashed.db_content ?? null) ? ["db_content"] : []),
          ],
        }),
      );
      const saved = await writer.updateCard({
        cardId: trashed.id,
        before,
        after,
        changedFields: (Object.keys(after) as (keyof CardFieldState)[]).filter(
          (f) => after[f] !== null,
        ),
        reservedActionId,
        key: name.isSimple ? name.key : null,
        readRule: await deriveReadRuleRecord(this.readRuleDeps(), {
          name: name.s,
          typeId,
          leftId: sides.leftId,
          rightId: sides.rightId,
          isNew: true,
        }),
        superActionId: input.superActionId ?? null,
        isActCard: opts.isActCard,
        ...(input.history === false ? { history: false } : {}),
      });
      if (saved === null) {
        throw new CardActionError("not-found", "revival produced no change");
      }
      await this.fetch.driver.query(
        "UPDATE card_actions SET action_type = ? WHERE id = ?",
        [actionTypeCode("create"), saved.actionId],
      );
      if (input.attachment !== undefined) {
        await this.finalizeAttachment(
          trashed.id,
          saved.actionId,
          input.attachment,
          trashed.db_content ?? null,
          "update",
        );
      }
      await this.expireAfterWrite({
        cardId: trashed.id,
        nameAfter: name,
        lexAfter: lex,
        verb: "create",
        codenameChanged: input.codename != null,
      codename: input.codename ?? null,
      });
      const revivalFinalizeCard = (): ModEventCard =>
        this.eventCard({
          name,
          id: trashed.id,
          key: name.key,
          dbContent: input.content,
          action: "create",
          trash: false,
          typeId,
          changedFields: [
            "name",
            "type_id",
            "trash",
            ...((input.content ?? null) !== (trashed.db_content ?? null) ? ["db_content"] : []),
          ],
        });
      const revivalFinalizeThunks: ReadonlyArray<readonly [string, () => Promise<void>]> = [
        [
          "refresh_references_out",
          () =>
            this.maybeRefreshReferencesOut({
              cardId: trashed.id,
              name,
              contentBefore: trashed.db_content,
              contentAfter: input.content ?? null,
            }),
        ],
        [
          "refresh_references_in",
          () => refreshReferencesIn(this.fetch.driver, trashed.id, name.key),
        ],
      ];
      if (opts.deferFinalize !== undefined) {
        opts.deferFinalize.card = revivalFinalizeCard();
        opts.deferFinalize.thunks = revivalFinalizeThunks;
      } else {
        await this.runFinalizeEvents(revivalFinalizeCard(), revivalFinalizeThunks);
      }
      const revivedRow = await this.fetchRowById(trashed.id);
      if (revivedRow !== undefined) {
        await cascadeReadRuleAfterRuleSave(this.readRuleDeps(), revivedRow, true);
      }
      return {
        cardId: trashed.id,
        actionId: saved.actionId,
        actId: saved.actId,
        verb: "create",
        name,
        subactions: await this.claimSides(sides.created, saved.actionId),
      };
    }

    await this.dispatchEventStage(
      "store",
      this.eventCard({
        name,
        key: name.key,
        dbContent: input.attachment !== undefined ? null : (input.content ?? null),
        action: "create",
        trash: false,
        typeId,
        changedFields: [
          "name",
          "type_id",
          ...(input.attachment !== undefined || input.content != null ? ["db_content"] : []),
          ...(input.codename != null ? ["codename"] : []),
        ],
      }),
    );
    const rightCode =
      name.isSimple || sides.rightId === null ? undefined : await this.fetch.codenames.nameForId(sides.rightId);
    if (rightCode === "password" && input.content != null && input.attachment === undefined && input.passwordEncrypted !== true) {
      const problems = passwordErrors(input.content);
      if (problems.length > 0) {
        throw new CardActionError("validation-failed", `Validation failed: ${problems.join(", ")}`);
      }
      input.content = await storedPasswordValue(input.content, await this.accountSalt(sides.leftId), this.passwordHashing);
    }
    if (rightCode === "email" && input.content != null && input.attachment === undefined && sides.rightId !== null) {
      input.content = await this.validatedEmailContent(input.content, sides.rightId, null);
    }
    if (rightCode === "account") {
      const named = Object.keys(input.subcards ?? {}).some(
        (k) => k.split("+").map((p) => p.trim().toLowerCase()).pop() === "*email",
      );
      const stored =
        !named && (await this.fetch.lexicon.id(DeckoName.parse(`${name.s}+*email`))) !== undefined;
      if (!named && !stored) {
        throw new CardActionError(
          "field-required",
          "Validation failed: Email required",
          "EMAIL: required",
          { email: "required" },
        );
      }
    }
    const created = await writer.createCard({
      name: name.isSimple ? name.s : null,
      key: name.isSimple ? name.key : null,
      type_id: typeId,
      db_content: input.attachment !== undefined ? null : (input.content ?? ""),
      left_id: name.isSimple ? null : sides.leftId,
      right_id: name.isSimple ? null : sides.rightId,
      codename: input.codename ?? null,
      comment: input.attachment?.originalFilename ?? null,
      readRule: await deriveReadRuleRecord(this.readRuleDeps(), {
        name: name.s,
        typeId,
        leftId: sides.leftId,
        rightId: sides.rightId,
        isNew: true,
      }),
      ...(sides.reservedActionId !== undefined ? { reservedActionId: sides.reservedActionId } : {}),
      ...(input.history === false ? { history: false } : {}),
      superActionId: input.superActionId ?? null,
      isActCard: opts.isActCard,
      reservedActionId,
    });
    if (rightCode !== undefined && NO_HISTORY_RIGHT_CODENAMES.has(rightCode)) {
      await this.dropHistory(created.actionId, created.actId, created.actPreexisted === true);
    }
    if (rightCode === "account") {
      this.pendingSalts.set(created.cardId, generateSalt(this.clock()));
    }
    const attachmentIdentifier =
      input.attachment !== undefined
        ? await this.finalizeAttachment(
            created.cardId,
            created.actionId,
            input.attachment,
            null,
            "create",
          )
        : null;
    await this.expireAfterWrite({
      cardId: created.cardId,
      nameAfter: name,
      lexAfter: lex,
      verb: "create",
      codenameChanged: input.codename != null,
      codename: input.codename ?? null,
    });
    const createdRow = await this.fetchRowById(created.cardId);
    if (createdRow !== undefined) {
      await cascadeReadRuleAfterRuleSave(this.readRuleDeps(), createdRow, true);
    }
    const refsContentAfter = attachmentIdentifier ?? (input.content == null
      ? null
      : createdRow === undefined ? input.content
        : await this.structureReferencesContent(createdRow, input.content));
    const referenceFinalizeCard = (): ModEventCard =>
      this.eventCard({
        name,
        id: created.cardId,
        key: name.key,
        dbContent: refsContentAfter,
        dbContentBeforeAct: null,
        action: "create",
        trash: false,
        typeId,
        actId: created.actId,
        changedFields: [
          "name",
          "type_id",
          ...(input.attachment !== undefined || input.content != null ? ["db_content"] : []),
          ...(input.codename != null ? ["codename"] : []),
        ],
      });
    const referenceFinalizeThunks: ReadonlyArray<readonly [string, () => Promise<void>]> = [
      [
        "refresh_references_out",
        () =>
          this.maybeRefreshReferencesOut({
            cardId: created.cardId,
            name,
            contentBefore: null,
            contentAfter: refsContentAfter,
          }),
      ],
      [
        "refresh_references_in",
        () => refreshReferencesIn(this.fetch.driver, created.cardId, name.key),
      ],
    ];
    if (opts.deferFinalize !== undefined) {
      opts.deferFinalize.card = referenceFinalizeCard();
      opts.deferFinalize.thunks = referenceFinalizeThunks;
    } else {
      await this.runFinalizeEvents(referenceFinalizeCard(), referenceFinalizeThunks);
    }
    return {
      cardId: created.cardId,
      actionId: created.actionId,
      actId: created.actId,
      verb: "create",
      name,
      subactions: await this.claimSides(sides.created, created.actionId),
    };
  }

  private registeredEvent(name: string): boolean {
    return this.modEvents?.registry.all().some((e) => e.event === name) === true;
  }

  async updateCard(input: UpdateCardInput): Promise<ActionResult | null> {
    const outermostAct = this.saveDepth === 0;
    if (outermostAct) this.actEnvBodyOutcomes = [];
    const outerSkip = this.saveSkip;
    const outerAttributes = this.activeSaveAttributes;
    const outerTriggers = this.actTriggers;
    if (input.skip !== undefined && input.skip.length > 0) {
      this.saveSkip = [...(outerSkip ?? []), ...input.skip];
    }
    if (input.trigger !== undefined) {
      const raw = input.trigger;
      this.actTriggers = typeof raw === "string" ? [raw] : [...raw];
    }
    try {
      const result = await this.atomicSave(async () => this.updateCardInner(await knownTypeSpec(this.fetch, input)));
      return outermostAct ? this.takeActEnvOutcomes(result, "update") : result;
    } catch (error) {
      if (error instanceof ModEventAbortSuccess) {
        return outermostAct ? this.takeActEnvOutcomes(null, "update") : null;
      }
      await this.reportServerError(
        this.eventCard({
          name: input.name !== undefined ? DeckoName.parse(input.name) : undefined,
          action: "update",
        }),
        error,
      );
      throw error;
    } finally {
      this.saveSkip = outerSkip;
      this.pendingSaveInput = undefined;
      this.activeSaveAttributes = outerAttributes;
      this.actTriggers = outerTriggers;
    }
  }

  private actTriggers: readonly string[] | undefined;

  private saveSkip: string[] | undefined;

  private actEnvBodyOutcomes: ModEventBodyOutcome[] = [];

  private takeActEnvOutcomes(
    result: ActionResult | null,
    verb: "create" | "update" | "delete",
  ): ActionResult | null {
    const outcomes = this.actEnvBodyOutcomes;
    this.actEnvBodyOutcomes = [];
    const successAppends = outcomes
      .map((outcome) => outcome.successAppend)
      .filter((append) => append !== undefined);
    const signout = outcomes.some((outcome) => outcome.signout === true);
    if (successAppends.length === 0 && !signout) return result;
    const base: ActionResult = result ?? { cardId: 0, actionId: 0, actId: 0, verb, subactions: [] };
    return {
      ...base,
      ...(successAppends.length > 0 ? { successAppends } : {}),
      ...(signout ? { signout: true } : {}),
    };
  }

  private skipsEvent(event: string): boolean {
    return (
      this.saveSkip?.includes(event) === true ||
      this.modEvents?.skip?.includes(event) === true ||
      this.modEvents?.forceSkip?.includes(event) === true
    );
  }

  private actSkipList(): readonly string[] | undefined {
    if (this.saveSkip === undefined) return this.modEvents?.skip;
    return [...(this.modEvents?.skip ?? []), ...this.saveSkip];
  }

  async useAsCurrentSkin(cardId: number): Promise<ActionResult | null> {
    const outermostAct = this.saveDepth === 0;
    if (outermostAct) this.actEnvBodyOutcomes = [];
    const result = await this.atomicSave(async () => {
      const skin = await this.fetchRowById(cardId);
      if (skin === undefined || (await this.fetchRowById(skin.type_id))?.codename !== "bootswatch_skin") {
        throw new CardActionError("user-error", "use_as_current_skin requires a Bootswatch skin");
      }
      const name = await this.composedNameOf(skin);
      const style = await this.fetch.fetchByName("*all+*style");
      if (style?.id === undefined || name === undefined) throw new CardActionError("not-found", "no *all+*style rule card");
      let inner: ActionResult | null = null;
      await this.updateCardInner({ cardId }, {
        walkNoopLifecycle: true,
        finalize: async writer => {
          inner = await this.updateCardInner({ cardId: style.id!, content: name.s, withinOtherAct: true }, { writer, isActCard: false });
        },
      });
      return inner;
    });
    return outermostAct ? this.takeActEnvOutcomes(result, "update") : result;
  }

  private async updateCardInner(input: UpdateCardInput, lifecycle: {
    writer?: ActWriter;
    isActCard?: boolean;
    walkNoopLifecycle?: boolean;
    finalize?: (writer: ActWriter) => Promise<void>;
  } = {}): Promise<ActionResult | null> {
    if (lifecycle.writer === undefined && input.withinOtherAct !== true) {
      this.earlyPhaseDispatchedKeys.clear();
    }
    const actingId = await this.actingIdForWrite();
    if (actingId === undefined) this.assertWritable();
    const row = await this.fetchRowById(input.cardId);
    if (row === undefined || (row.trash === 1 && input.lookInTrash !== true)) {
      throw new CardActionError("not-found", `no such card: ${input.cardId}`);
    }
    if (row.codename === "signin") {
      const fields = Object.keys(input.subcards ?? {}).map((k) => k.split("+").map((p) => p.trim().toLowerCase()).pop());
      if (!fields.includes("*email")) {
        throw new CardActionError("user-error", "email can't be blank", undefined, { abort: "email can't be blank" });
      }
      if (!fields.includes("*password")) {
        throw new CardActionError("user-error", "password can't be blank", undefined, { abort: "password can't be blank" });
      }
    }
    let cachedUpload: { attachment: AttachmentInput; release: () => Promise<void> } | undefined;
    if (input.actionIdOfCachedUpload !== undefined) {
      const typeRow = await this.fetchRowById(row.type_id);
      const mount =
        typeRow?.codename != null && typeRow.codename !== ""
          ? ATTACHMENT_MOUNTS[typeRow.codename]
          : undefined;
      if (mount !== undefined) {
        cachedUpload = await this.cachedUploadAttachment(input.actionIdOfCachedUpload, {
          cardId: row.id,
          mount,
        });
        if (cachedUpload !== undefined) input = { ...input, attachment: cachedUpload.attachment };
      }
    }
    this.setActiveSaveAttributes(input);
    if (input.name !== undefined) {
      const current = (await this.fetch.fetchById(row.id))?.name?.key;
      if (DeckoName.parse(input.name).key !== current) await this.assertMayRenameAccountHolder(row.id);
    }
    if (input.content !== undefined && input.content !== null && input.passwordEncrypted !== true) {
      const pw = await this.passwordFieldContent(row.right_id ?? undefined, row.left_id, input.content, "update");
      if (pw !== undefined && "skip" in pw) return null;
      if (pw !== undefined) input = { ...input, content: pw.content, passwordEncrypted: true };
    }
    if (input.trash === true && input.withinRollback !== true) {
      throw new CardActionError(
        "revert-unsupported",
        "an update cannot trash a card; trashing is deleteCard",
      );
    }
    const hasTypeSpec =
      input.typeId !== undefined ||
      input.typeCode !== undefined ||
      input.typeName !== undefined;
    const resolvedTypeId = hasTypeSpec
      ? await resolveTypeId(this.fetch, {
          ...input,
          name:
            input.name !== undefined ? DeckoName.parse(input.name) : row.name ?? undefined,
        })
      : undefined;
    const typeChanged = resolvedTypeId !== undefined && resolvedTypeId !== row.type_id;
    const card = await composeCardRecord(row, this.fetch.lexicon);
    await this.declareStandardCards();
    await this.declareSaveInputTree(
      input.name !== undefined ? DeckoName.parse(input.name) : card.name,
      input.subcards,
    );
    await this.assertCanWrite(card, "update", {
      typeChanged,
      assignedTypeId: typeChanged ? resolvedTypeId : undefined,
      assignedName:
        input.name !== undefined ? DeckoName.parse(input.name).s : undefined,
    });
    await this.assertNoEditConflict(row.id, input.lastActionIdBeforeEdit, card.name?.s);
    await this.assertLayoutHasMainNest(row, input.content, resolvedTypeId);
    if (typeChanged) input = await this.applySkinTypeChange(row, input, resolvedTypeId);
    await this.validateCssSaveTree(
      (input.name !== undefined ? DeckoName.parse(input.name) : await this.composedNameOf(row)) ?? DeckoName.parse(""),
      input,
      row,
      resolvedTypeId ?? row.type_id,
    );
    if (input.draft === true) {
      await this.runUpdateValidationWalk(
        row,
        input,
        cardFieldStateFromRow(row),
        resolvedTypeId,
      );
      const draft = await this.runSaveDraftBody(this.newWriter(actingId), row, input);
      if (draft !== undefined) return draft;
    }
    await assertStyleCompilerFor(
      this.styleAssetContext(actingId),
      (input.name !== undefined ? DeckoName.parse(input.name) : await this.composedNameOf(row)) ?? DeckoName.parse(""),
      resolvedTypeId ?? row.type_id,
    );
    const writer = lifecycle.writer ?? this.newWriter(actingId);
    const finalizeQueue: (() => Promise<void>)[] = [];
    const integrateChangedFields: { current?: readonly string[]; card?: ModEventCard } = {};
    let result = await this.updateInWriter(writer, row, input, resolvedTypeId, {
      finalizeQueue,
      changedFieldsSink: integrateChangedFields,
      isActCard: lifecycle.isActCard,
      walkNoopLifecycle: lifecycle.walkNoopLifecycle,
    });
    const deferredSubFinalizes: DeferredReferenceFinalize[] = [];
    const subCachedUploadReleases: (() => Promise<void>)[] = [];
    const subResults = await this.saveSubcardsInWriter(
      writer,
      await this.composedNameOf(row),
      input.subcards,
      result?.actionId ?? null,
      finalizeQueue,
      deferredSubFinalizes,
      undefined,
      subCachedUploadReleases,
    );
    if (result === null && subResults.length > 0) {
      result = {
        cardId: row.id,
        actionId: subResults[0].actionId,
        actId: subResults[0].actId,
        verb: "update",
        name: await this.composedNameOf(row),
        subactions: subResults,
        actCardActionOmitted: true,
      };
    } else if (result !== null && subResults.length > 0) {
      result = { ...result, subactions: [...result.subactions, ...subResults] };
    }
    if (
      result === null &&
      subResults.length === 0 &&
      input.subcards !== undefined &&
      writer.currentActId() === null
    ) {
      await this.fetch.driver.query(
        "INSERT INTO card_acts (card_id, actor_id, acted_at, ip_address) VALUES (?, ?, ?, ?)",
        [
          row.id,
          (await this.actingIdForWrite()) ?? this.actor?.id ?? null,
          sqlDateTime(this.clock()),
          this.ipAddress,
        ],
      );
    }
    if (input.withinRollback === true) {
      return result;
    }
    const committed = result;
    await runStyleAssetEvents(this.styleAssetContext(actingId), this.savedCardsOf(committed, row));
    await this.afterCommit(async () => {
      await this.bumpAncestorTimestamps(
        CardActionEngine.savedCardIds(committed).filter(
          (id) => !(committed?.actCardActionOmitted === true && id === row.id),
        ),
      );
      await this.dispatchEventStage(
        "integrate",
        this.eventCard({
          name: committed?.name,
          id: committed?.cardId ?? row.id,
          action: "update",
          dbContent: integrateChangedFields.card === undefined
            ? row.db_content : integrateChangedFields.card.dbContent,
          dbContentBeforeAct: row.db_content ?? null,
          actId: committed?.actId,
          trash: false,
          typeId: integrateChangedFields.card?.typeId ?? row.type_id,
          typeIdBeforeAct: row.type_id,
          patternTypeId: row.type_id,
          nameBeforeAct: integrateChangedFields.card?.nameBeforeAct,
          receiverSetIdentities: integrateChangedFields.card?.receiverSetIdentities,
          changedFields: integrateChangedFields.current ?? [],
        }),
      );
      await this.saveRecentlyEditedSettings(committed);
      if (cachedUpload !== undefined) await cachedUpload.release();
      for (const release of subCachedUploadReleases) await release();
      if (input.triggeredIntegrate !== undefined) await input.triggeredIntegrate();
      await this.dispatchSavePathIntegrations(committed, {
        actCardActionOmitted: committed?.actCardActionOmitted === true,
        delayedStageDropped: input.attachment !== undefined && input.attachment.fromCachedUpload !== true,
        withinOtherAct: input.withinOtherAct === true,
      });
    });
    await lifecycle.finalize?.(writer);
    return result;
  }

  private async validateCssSaveTree(
    name: DeckoName,
    input: SubcardInput,
    row?: CardsRow,
    resolvedTypeId?: number,
  ): Promise<void> {
    if (input.trash === true) return;
    const typeId = resolvedTypeId ?? (
      input.typeId !== undefined || input.typeCode !== undefined || input.typeName !== undefined || row === undefined
        ? await resolveTypeId(this.fetch, { ...input, name })
        : row.type_id
    );
    const typeCode = (await this.fetchRowById(typeId))?.codename;
    if (
      typeCode === "coffee_script" &&
      !this.skipsEvent("validate_coffeescript_syntax") &&
      this.coffeeCompiler !== undefined
    ) {
      const content = input.content ?? row?.db_content ?? await this.newCardTemplateContent(name, typeId) ?? "";
      if (row === undefined || typeId !== row.type_id || content !== row.db_content) {
        try {
          this.coffeeCompiler(content, false);
        } catch (error) {
          let message = error instanceof Error ? error.message : String(error);
          const location = (error as { location?: { first_line?: number; first_column?: number } }).location;
          if (location?.first_line !== undefined && !/^\[stdin\]:\d+:\d+:/.test(message) && !/^\d+:\d+:/.test(message)) {
            message = `SyntaxError: ${location.first_line + 1}:${(location.first_column ?? 0) + 1}: ${message}`;
          }
          message = message.replace("[stdin]:", "");
          throw new CardActionError(
            "validation-failed",
            `Validation failed: ${message}`,
            `CONTENT: ${message}`,
            { content: message },
            name.s,
          );
        }
      }
    }
    if (typeCode === "java_script" && !this.skipsEvent("validate_javascript_syntax") && this.javascriptValidator !== undefined) {
      const content = input.content ?? row?.db_content ?? await this.newCardTemplateContent(name, typeId) ?? "";
      if (row === undefined || typeId !== row.type_id || content !== row.db_content) {
        const diagnostic = this.javascriptValidator(content);
        if (diagnostic !== undefined) {
          const message = `<pre>${diagnostic}</pre>`;
          throw new CardActionError("validation-failed", `Validation failed: ${message}`, `CONTENT: ${message}`, { content: message }, name.s);
        }
      }
    }
    if ((typeCode === "css" && !this.skipsEvent("validate_css")) ||
        (typeCode === "scss" && !this.skipsEvent("validate_scss_syntax"))) {
      const content = input.content ?? row?.db_content ?? await this.newCardTemplateContent(name, typeId) ?? "";
      if (row === undefined || typeId !== row.type_id || content !== row.db_content) {
        const variables = typeCode === "scss" ? await scssValidationVariables(this.styleAssetContext(undefined)) : "";
        const source = typeCode === "scss" ? `${variables.trim()}\n${content}` : renderStyleChunks(content);
        try {
          if (typeCode !== "scss" || variables.trim() !== "") {
            await assertStyleCompilerFor(this.styleAssetContext(undefined), name, typeId);
            await this.scssCompiler!(source, typeCode === "scss" ? "nested" : "compressed");
          }
        } catch (error) {
          let message = error instanceof Error ? error.message : String(error);
          if (typeCode === "scss" && message.startsWith("LibSass compile failed: Error:")) {
            message = `${message.slice("LibSass compile failed: ".length)}\n`;
            const match = /line (\d+)/.exec(message);
            if (match !== null) {
              const lines = variables.match(/[^\n]*\n|[^\n]+$/g)?.length ?? 0;
              const corrected = Number(match[1]) - lines + 6;
              message = message.replace(/line \d+:(\d+) of \/?stdin/, `line ${corrected}:$1`)
                .replace(/>>[^\n]*/, `>> ${content.match(/[^\n]*\n|[^\n]+$/g)?.[corrected - 1] ?? ""}`);
            }
            message = `<pre>${message}</pre>`;
          }
          throw new CardActionError("validation-failed", `Validation failed: ${message}`, `CONTENT: ${message}`, { content: message }, name.s);
        }
      }
    }
    for (const [key, sub] of Object.entries(input.subcards ?? {})) {
      const fullName = DeckoName.parse(key.startsWith("+") ? `${name.s}${key}` : key);
      const existing = await this.fetch.fetchByName(fullName);
      const existingRow = existing?.id == null ? undefined : await this.fetchRowById(existing.id);
      const liveRow = existingRow?.trash === 0 ? existingRow : undefined;
      await this.validateCssSaveTree(sub.name === undefined ? fullName : DeckoName.parse(sub.name), sub, liveRow);
    }
  }

  private async updateNameIsChanging(newName: DeckoName | undefined,
    before: Pick<CardFieldState, "name" | "left_id" | "right_id">): Promise<boolean> {
    if (newName === undefined) return false;
    if ((newName.isSimple ? newName.s : null) !== before.name) return true;
    if (!newName.isCompound) return false;
    const left = newName.leftName !== undefined ? await this.fetch.lexicon.id(newName.leftName) : undefined;
    const right = newName.rightName !== undefined ? await this.fetch.lexicon.id(newName.rightName) : undefined;
    return (left ?? null) !== before.left_id || (right ?? null) !== before.right_id;
  }

  private async runUpdateValidationWalk(
    row: CardsRow,
    input: UpdateCardInput,
    before: CardFieldState,
    preResolvedTypeId?: number,
  ): Promise<{
    currentName: DeckoName | undefined;
    currentKey: string;
    newName: DeckoName | undefined;
    nameChanged: boolean;
    receiverSetIdentities: ModEventCard["receiverSetIdentities"];
  }> {
    const currentName = await this.composedNameOf(row);
    const currentKey = this.keyOf(row, currentName);
    const newName = input.name !== undefined ? DeckoName.parse(input.name) : undefined;
    const incomingContent = input.content ?? row.db_content;
    const incomingTypeId = preResolvedTypeId ??
      (input.typeId !== undefined || input.typeCode !== undefined || input.typeName !== undefined
        ? await resolveTypeId(this.fetch, { ...input, name: newName ?? currentName })
        : row.type_id);
    const receiverSetIdentities = [
      ...(input.receiver === "find" ? [] : [
        { name: currentName?.s ?? `~${row.id}`, key: currentKey, typeId: row.type_id },
      ]),
      { name: (newName ?? currentName)?.s ?? `~${row.id}`, key: newName?.key ?? currentKey, typeId: incomingTypeId },
    ];
    const nameChanged = await this.updateNameIsChanging(newName, before);
    const validationChanged: string[] = [];
    if (input.content !== undefined && input.content !== row.db_content) validationChanged.push("db_content");
    if (incomingTypeId !== row.type_id) validationChanged.push("type_id");
    if (nameChanged) validationChanged.push("name");
    const validationCard = (): ModEventCard => {
      const content = input.content ?? row.db_content;
      const changed = [...validationChanged];
      if (content !== incomingContent && !changed.includes("db_content")) {
        changed.push("db_content");
      }
      return this.eventCard({
        name: newName ?? currentName,
        id: row.id,
        key: newName?.key ?? currentKey,
        dbContent: content,
        dbContentBeforeAct: row.db_content ?? null,
        action: "update",
        trash: false,
        typeId: incomingTypeId,
        typeIdBeforeAct: row.type_id,
        patternTypeId: row.type_id,
        receiverSetIdentities,
        nameBeforeAct: currentName?.s,
        changedFields: changed,
      });
    };
    if (this.earlyPhaseDispatchedKeys.has((newName ?? currentName)?.key ?? currentKey)) {
    } else {
      await this.dispatchEventStage("initialize", validationCard());
    }
    await this.prepareTranslateVariablesSaveInput(input, validationCard());
    await this.prepareApiKeyGenerateSaveInput(input, row);
    if (this.earlyPhaseDispatchedKeys.has((newName ?? currentName)?.key ?? currentKey)) {
    } else {
      this.earlyPhaseDispatchedKeys.add((newName ?? currentName)?.key ?? currentKey);
      await this.prepareSubcardCollection(
        input.subcards,
        newName ?? currentName ?? DeckoName.parse(""),
      );
      await this.dispatchEventStage("prepare_to_validate", validationCard());
      this.pendingSubcardCollection = undefined;
      if (currentName !== undefined) await this.dispatchSubcardEarlyPhases(currentName, input.subcards);
    }
    this.pendingSaveInput = undefined;
    if (nameChanged && newName !== undefined) {
      await this.runValidateNameBody(newName, { cardId: row.id, oldName: before.name });
      if (!this.hasRegisteredBody("validate_name")) {
        await this.runValidateUniquenessBody(newName, row.id);
      }
    }
    const postSaveName = newName ?? currentName;
    if (postSaveName !== undefined) await this.runValidateKeyBody(postSaveName, "update");
    const recaptchaWalkName = newName ?? currentName ?? DeckoName.parse("");
    const recaptchaTypeId = incomingTypeId;
    await this.prepareRecaptchaSaveInput(
      input.recaptchaToken,
      "update",
      await ruleWalkPatternInput(this.fetch, {
        name: recaptchaWalkName,
        id: row.id,
        isNew: false,
        typeId: recaptchaTypeId,
      }),
    );
    await this.dispatchEventStage("validate", validationCard());
    await this.validateCodedStorageType(input.attachment, newName ?? currentName ?? DeckoName.parse(""));
    return { currentName, currentKey, newName, nameChanged, receiverSetIdentities };
  }

  private async updateInWriter(
    writer: ActWriter,
    row: CardsRow,
    input: UpdateCardInput,
    preResolvedTypeId?: number,
    opts: {
      isActCard?: boolean;
      finalizeQueue?: (() => Promise<void>)[];
      walkNoopLifecycle?: boolean;
      changedFieldsSink?: { current?: readonly string[]; card?: ModEventCard };
    } = {},
  ): Promise<ActionResult | null> {
    const before = cardFieldStateFromRow(row);
    const after: CardFieldState = { ...before };
    const { currentName, currentKey, newName, nameChanged, receiverSetIdentities } =
      await this.runUpdateValidationWalk(row, input, before, preResolvedTypeId);

    const resolvedTypeId =
      preResolvedTypeId ??
      (input.typeId !== undefined || input.typeCode !== undefined || input.typeName !== undefined
        ? await resolveTypeId(this.fetch, { ...input, name: newName ?? row.name })
        : undefined);

    if (nameChanged && newName !== undefined) {
      if (newName.key !== currentKey && input.skipValidateRenaming !== true) {
        await this.runValidateRenamingBody(newName, {
          cardId: row.id,
          currentKey,
          currentName: currentName?.s ?? null,
          beforeName: before.name,
          contentChanging:
            input.content !== undefined && input.content !== (before.db_content ?? undefined),
          typeChanging: resolvedTypeId !== undefined && resolvedTypeId !== before.type_id,
        });
        if (!this.hasRegisteredBody("validate_renaming")) {
          if (input.content !== undefined && input.content !== (before.db_content ?? undefined)) {
            throw new CardActionError(
              "rename-conflict",
              "content cannot change in the same save as a rename",
            );
          }
          if (resolvedTypeId !== undefined && resolvedTypeId !== before.type_id) {
            throw new CardActionError(
              "rename-conflict",
              "type cannot change in the same save as a rename",
            );
          }
          if (before.name !== null && newName.isCompound) {
            const tags = await this.childIds("right", row.id);
            if (tags.length > 0) {
              throw new CardActionError(
                "rename-conflict",
                `illegal name change; existing names end in +${currentName?.s ?? before.name}`,
              );
            }
          }
        }
      }
      await this.runRenameInTrashBody(writer, newName, row.id);
    }

    if (input.content !== undefined && input.attachment === undefined) {
      input.content = await this.standardizeAssignedContent(
        input.content,
        resolvedTypeId ?? before.type_id,
        before.left_id,
        before.right_id,
        row.codename ?? undefined,
      );
    }
    const updateRightCode =
      before.right_id === null ? undefined : await this.fetch.codenames.nameForId(before.right_id);
    if (updateRightCode === "password" && input.content !== undefined && input.content.trim() === "") {
      return null;
    }
    if (
      updateRightCode === "password" &&
      input.content !== undefined &&
      input.attachment === undefined &&
      input.passwordEncrypted !== true &&
      input.content !== (before.db_content ?? undefined)
    ) {
      const problems = passwordErrors(input.content);
      if (problems.length > 0) {
        throw new CardActionError("validation-failed", `Validation failed: ${problems.join(", ")}`);
      }
      input.content = await storedPasswordValue(input.content, await this.accountSalt(before.left_id), this.passwordHashing);
    }
    if (updateRightCode === "email" && input.content !== undefined && input.attachment === undefined && before.right_id !== null) {
      input.content = await this.validatedEmailContent(input.content, before.right_id, row.id);
    }
    if (input.content !== undefined) after.db_content = input.content;
    await this.applyAddComment(
      input,
      "update",
      newName ?? currentName ?? DeckoName.parse(""),
      after.db_content ?? undefined,
      (c) => {
        input.content = c;
        after.db_content = c;
      },
    );
    if (input.attachment !== undefined) {
      after.db_content = this.attachmentIntermediateIdentifier(
        row.id,
        before.db_content,
        input.attachment,
      );
    }
    if (resolvedTypeId !== undefined && resolvedTypeId !== before.type_id) {
      after.type_id = resolvedTypeId;
    }
    if (input.trash === false) after.trash = 0;
    if (input.trash === true && input.withinRollback === true) after.trash = 1;
    const lexBefore = this.lexOfRow(before);
    let lexAfter = lexBefore;
    let renameSides: ResolvedSides["created"] | undefined;
    let reservedActionId: number | undefined;

    if (nameChanged && newName !== undefined) {
      if (newName.isSimple) {
        after.name = newName.s;
        after.left_id = null;
        after.right_id = null;
        lexAfter = newName.s;
      } else {
        const peekedLeft =
          newName.leftName !== undefined
            ? await this.fetch.lexicon.id(newName.leftName)
            : undefined;
        const peekedRight =
          newName.rightName !== undefined
            ? await this.fetch.lexicon.id(newName.rightName)
            : undefined;
        await assertNotOwnAncestor(
          this.fetch.driver,
          row.id,
          [peekedLeft, peekedRight].filter(
            (id): id is number => id !== undefined && id !== row.id,
          ),
        );
        if (!await this.isAssetOutputRight(peekedRight)) {
          reservedActionId = await writer.reserveAction({
            actionType: "update",
            superActionId: input.superActionId ?? null,
          });
        }
        const sides = await this.runPrepareLeftAndRightBody(writer, newName, row.id);
        after.name = null;
        after.left_id = sides.leftId;
        after.right_id = sides.rightId;
        lexAfter = this.lexOf(newName, sides.leftId, sides.rightId);
        renameSides = sides.created;
      }
    }

    if (input.attachment === undefined && after.db_content !== null) {
      await this.prepareStoredContent(
        this.eventCard({
          name: newName ?? currentName,
          id: row.id,
          dbContent: after.db_content,
          action: "update",
        }),
        after.db_content,
        after.type_id,
        after.right_id,
        (prepared) => {
          after.db_content = prepared;
          if (input.content !== undefined) input.content = prepared;
        },
      );
    }

    const typeChanged = after.type_id !== before.type_id;
    const readRule =
      nameChanged || typeChanged
        ? await deriveReadRuleRecord(this.readRuleDeps(), {
            name:
              nameChanged && newName !== undefined
                ? newName.s
                : currentName?.s ?? before.name ?? "",
            typeId: after.type_id,
            leftId: after.left_id,
            rightId: after.right_id,
          })
        : undefined;

    const updateChangedFields = [
      ...(nameChanged ? ["name"] : []),
      ...(after.left_id !== before.left_id && !nameChanged ? ["left_id"] : []),
      ...(after.right_id !== before.right_id && !nameChanged ? ["right_id"] : []),
      ...(after.db_content !== before.db_content ? ["db_content"] : []),
      ...(after.type_id !== before.type_id ? ["type_id"] : []),
      ...(after.trash !== before.trash ? ["trash"] : []),
    ];
    const updateEventCard = (actId?: number, dbContent = after.db_content): ModEventCard => this.eventCard({
      name: nameChanged && newName !== undefined ? newName : currentName,
      id: row.id,
      key: nameChanged && newName !== undefined ? newName.key : currentKey,
      dbContent,
      dbContentBeforeAct: before.db_content ?? null,
      action: "update",
      actId,
      trash: false,
      typeId: after.type_id,
      typeIdBeforeAct: before.type_id,
      patternTypeId: before.type_id,
      nameBeforeAct: currentName?.s,
      receiverSetIdentities,
      changedFields: updateChangedFields,
    });
    if (opts.changedFieldsSink !== undefined) {
      opts.changedFieldsSink.current = updateChangedFields;
      opts.changedFieldsSink.card = updateEventCard();
    }
    const noHistory =
      (updateRightCode !== undefined && NO_HISTORY_RIGHT_CODENAMES.has(updateRightCode)) ||
      row.codename === "recent_settings";
    const changesBefore = noHistory
      ? Number(
          (await this.fetch.driver.query<{ m: number | null }>("SELECT MAX(id) AS m FROM card_changes", [])).rows[0]
            ?.m ?? 0,
        )
      : 0;
    if (
      (opts.isActCard ?? true) &&
      (await this.isVirtualCacheCardRight(row.right_id))
    ) {
      await virtualSave(
        this.fetch.driver,
        {
          ...(await composeCardRecord(row, this.fetch.lexicon)),
          dbContent: after.db_content ?? undefined,
        },
        this.virtualCache,
        this.clock(),
        { leftCardId: row.left_id ?? undefined, rightCardId: row.right_id ?? undefined },
      );
      return null;
    }
    const saved = await writer.updateCard({
      cardId: row.id,
      before,
      after,
      key: nameChanged && newName !== undefined ? (newName.isSimple ? newName.key : null) : undefined,
      readRule,
      superActionId: input.superActionId ?? null,
      comment: input.attachment?.originalFilename ?? null,
      dirtyFields: input.attachment !== undefined ? ["db_content"] : undefined,
      isActCard: opts.isActCard ?? true,
      ...(await this.isAssetOutputRight(after.right_id) ? { history: false } : {}),
      reservedActionId,
    });
    if (saved === null) {
      if (opts.walkNoopLifecycle === true) {
        const event = updateEventCard(writer.currentActId() ?? undefined);
        await this.dispatchEventStage("prepare_to_store", event);
        await this.dispatchEventStage("store", event);
        await this.expireAfterWrite({ cardId: row.id, nameAfter: currentName, verb: "update" });
        await this.runFinalizeEvents(event, []);
      }
      if (input.subcards !== undefined) {
        await this.fetch.driver.query(
          "UPDATE cards SET updated_at = ?, updater_id = ? WHERE id = ?",
          [sqlDateTime(this.clock()), ((opts.isActCard ?? true) ? this.rootStamperId : undefined) ?? this.currentActorId ?? (await this.actingIdForWrite()) ?? this.actor?.id ?? null, row.id],
        );
      }
      return null;
    }
    if (noHistory) {
      await this.fetch.driver.query("DELETE FROM card_changes WHERE id > ?", [changesBefore]);
      await this.dropHistory(saved.actionId, saved.actId, saved.actPreexisted === true);
    }
    if (after.trash === 1 && before.trash === 0) {
      await this.fetch.driver.query("UPDATE card_actions SET action_type = ? WHERE id = ?", [
        actionTypeCode("update"),
        saved.actionId,
      ]);
    }
    const storedCard = (): ModEventCard => updateEventCard(saved.actId);
    await this.dispatchEventStage("prepare_to_store", storedCard());
    await this.dispatchEventStage("store", storedCard());

    const attachmentIdentifier =
      input.attachment !== undefined
        ? await this.finalizeAttachment(
            row.id,
            saved.actionId,
            input.attachment,
            before.db_content ?? null,
            "update",
          )
        : null;

    let subactions: CardActionSummary[] = [];
    if (renameSides !== undefined && renameSides.length > 0) {
      subactions = await this.claimSides(renameSides, saved.actionId);
    }

    const nameAfter = nameChanged ? newName : currentName;
    await this.expireAfterWrite({
      cardId: row.id,
      nameAfter,
      nameBefore: currentName,
      lexBefore: nameChanged ? lexBefore : undefined,
      lexAfter: nameChanged ? lexAfter : undefined,
      verb: "update",
    });
    const skipReferers = this.skipsEvent("update_referer_content");
    const refsContentAfter = attachmentIdentifier ??
      (await this.structureReferencesContent(row, after.db_content));
    await this.runFinalizeEvents(
      updateEventCard(saved.actId, attachmentIdentifier ?? refsContentAfter),
      [
        [
          "refresh_references_out",
          () =>
            this.maybeRefreshReferencesOut({
              cardId: row.id,
              name: nameAfter,
              contentBefore: before.db_content,
              contentAfter: refsContentAfter,
            }),
        ],
        [
          "update_referer_content",
          async () => {
            if (
              nameChanged &&
              nameAfter !== undefined &&
              currentName !== undefined &&
              !skipReferers
            ) {
              await updateRefererContent(
                {
                  driver: this.fetch.driver,
                  lexicon: this.fetch.lexicon,
                  fetchRefererCard: (id) => this.fetch.bracket(id),
                  pinStaleReferer: (card) => this.fetch.pinStaleCard(card),
                },
                row.id,
                currentName,
                nameAfter,
              );
            }
          },
        ],
        [
          "update_referer_references_out",
          async () => {
            if (nameChanged && skipReferers) {
              await updateRefererReferencesOut(
                { driver: this.fetch.driver, lexicon: this.fetch.lexicon },
                row.id,
              );
            }
          },
        ],
        [
          "refresh_references_in",
          async () => {
            if (nameChanged && nameAfter !== undefined) {
              await refreshReferencesIn(this.fetch.driver, row.id, nameAfter.key, {
                unmapExisting: skipReferers,
              });
            }
          },
        ],
      ],
    );
    if (typeChanged) {
      await cascadeAllFieldReadRules(this.readRuleDeps(), row.id);
    }
    if (nameChanged) {
      const savedRow = await this.fetchRowById(row.id);
      if (savedRow !== undefined) {
        const overlay =
          currentName !== undefined && currentName.key !== nameAfter?.key
            ? new Map([[currentName.key, savedRow.id]])
            : undefined;
        await cascadeReadRuleAfterRuleSave(this.readRuleDeps(), savedRow, true, overlay, row);
      }
    }
    if (nameChanged) await this.refreshDescendantCaches(row.id);
    return {
      cardId: row.id,
      actionId: saved.actionId,
      actId: saved.actId,
      verb: "update",
      name: nameAfter,
      nameBeforeAct: nameChanged ? currentName : undefined,
      subactions,
    };
  }

  private async assertNoEditConflict(
    cardId: number,
    lastActionIdBeforeEdit: number | string | null | undefined,
    cardName?: string,
  ): Promise<void> {
    if (lastActionIdBeforeEdit === null || lastActionIdBeforeEdit === undefined) {
      return;
    }
    const conflicted = await isEditConflict(
      this.fetch.driver,
      cardId,
      lastActionIdBeforeEdit,
      this.actor?.id ?? 0,
    );
    if (!conflicted) return;
    throw new CardActionError(
      "conflict",
      HISTORY_ERROR_NOT_LATEST_REVISION,
      `CONFLICT: ${HISTORY_ERROR_NOT_LATEST_REVISION}`,
      { conflict: HISTORY_ERROR_NOT_LATEST_REVISION },
      cardName,
    );
  }

  private async runSaveDraftBody(
    writer: ActWriter,
    row: CardsRow,
    input: UpdateCardInput,
  ): Promise<ActionResult | undefined> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find((e) => e.event === "save_draft");
    if (runtime === undefined || registered === undefined) {
      return this.saveDraftInWriter(writer, row, input);
    }
    if (this.skipsEvent("save_draft")) return undefined;
    let saved: ActionResult | undefined;
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "store",
      skipEvent: (n) => this.skipsEvent(n),
      saveContentDraft: async (content) => {
        saved = await this.saveDraftInWriter(writer, row, {
          ...input,
          ...(content !== undefined ? { content } : {}),
        });
      },      abortSuccess: () => undefined,
    };
    await registered.fn(
      this.eventCard({
        name: await this.composedNameOf(row),
        id: row.id,
        dbContent: input.content ?? null,
        action: "update",
      }),
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
    return saved;
  }

  private async saveDraftInWriter(
    writer: ActWriter,
    row: CardsRow,
    input: UpdateCardInput,
  ): Promise<ActionResult> {
    const name = await this.composedNameOf(row);
    const saved = await writer.saveDraft({
      cardId: row.id,
      content: input.content ?? null,
    });
    return {
      cardId: row.id,
      actionId: saved.actionId,
      actId: saved.actId,
      verb: "update",
      name,
      subactions: [],
    };
  }

  private async runRenameInTrashBody(
    writer: ActWriter,
    newName: DeckoName,
    selfId: number,
  ): Promise<void> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find((e) => e.event === "rename_in_trash");
    if (runtime === undefined || registered === undefined) {
      if (!newName.isSimple) return;
      const obstacle = await findTrashedKeyObstacle(this.fetch.driver, newName.key);
      if (obstacle !== undefined && obstacle.id !== selfId) {
        await this.renameTrashObstacle(writer, obstacle, newName);
      }
      return;
    }
    if (this.skipsEvent("rename_in_trash")) return;
    let obstacleRow: CardsRow | undefined;
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "store",
      skipEvent: (n) => this.skipsEvent(n),
      findTrashedKeyObstacle: async (key) => {
        if (!newName.isSimple) return undefined;
        obstacleRow = await findTrashedKeyObstacle(this.fetch.driver, key);
        return obstacleRow === undefined ? undefined : { id: obstacleRow.id };
      },
      renameAsTrashObstacle: async (obstacle) => {
        if (obstacleRow === undefined || obstacleRow.id !== obstacle.id) return;
        await this.renameTrashObstacle(writer, obstacleRow, newName);
      },
    };
    await registered.fn(
      this.eventCard({ name: newName, key: newName.key, id: selfId, action: "update" }),
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
  }

  private async runResetCodenameCacheBody(
    cardId: number,
    verb: "create" | "update" | "delete",
    codename: string | null,
  ): Promise<void> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find((e) => e.event === "reset_codename_cache");
    if (runtime === undefined || registered === undefined) {
      this.fetch.codenames.resetCache();
      return;
    }
    if (this.skipsEvent("reset_codename_cache")) return;
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "integrate",
      skipEvent: (n) => this.skipsEvent(n),
      resetCodenameCache: () => {
        this.fetch.codenames.resetCache();
      },
    };
    await registered.fn(
      this.eventCard({
        name: undefined,
        id: cardId,
        action: verb,
        codename: codename === null ? undefined : codename,
      }),
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
  }

  private async renameTrashObstacle(
    writer: ActWriter,
    obstacle: CardsRow,
    newName: DeckoName,
  ): Promise<void> {
    const obstacleName = DeckoName.parse(`${newName.s}*trash`);
    const before = cardFieldStateFromRow(obstacle);
    const after: CardFieldState = { ...before, name: obstacleName.s };
    const saved = await writer.updateCard({
      cardId: obstacle.id,
      before,
      after,
      key: obstacleName.key,
      isActCard: false,
    });
    if (saved !== null) {
      await this.expireAfterWrite({
        cardId: obstacle.id,
        nameAfter: obstacleName,
        nameBefore: obstacle.name !== null ? DeckoName.parse(obstacle.name) : undefined,
        lexBefore: this.lexOfRow(before),
        lexAfter: obstacleName.s,
        verb: "update",
      });
      await this.runFinalizeEvents(
        this.eventCard({
          name: obstacleName,
          id: obstacle.id,
          key: obstacleName.key,
          dbContent: obstacle.db_content,
          action: "update",
          trash: true,
          typeId: obstacle.type_id,
          nameBeforeAct: obstacle.name ?? undefined,
          changedFields: ["name"],
        }),
        [
          [
            "refresh_references_in",
            () => refreshReferencesIn(this.fetch.driver, obstacle.id, obstacleName.key),
          ],
        ],
      );
    }
  }

  private async bumpAncestorTimestamps(cardIds: readonly number[]): Promise<void> {
    const driver = this.fetch.driver;
    const nesterSql = `SELECT DISTINCT r.referer_id AS referer_id,
           (SELECT c.trash FROM cards c WHERE c.id = r.referer_id LIMIT 1) AS referer_trash,
           (SELECT c.name FROM cards c WHERE c.id = r.referer_id LIMIT 1) AS referer_name,
           (SELECT c.left_id FROM cards c WHERE c.id = r.referer_id LIMIT 1) AS referer_left_id,
           (SELECT c.right_id FROM cards c WHERE c.id = r.referer_id LIMIT 1) AS referer_right_id
           FROM card_references r
           WHERE r.ref_type = 'I' AND r.referee_id = ? AND r.referer_id IS NOT NULL`;
    const nesterRows = new Map<number, number[]>();
    const nesterTrash = new Map<number, unknown>();
    const nesterRow = new Map<number, { name: string | null; left_id: number | null; right_id: number | null }>();
    const prefetchNesters = async (ids: readonly number[]): Promise<void> => {
      const todo = [...new Set(ids)].filter((id) => !nesterRows.has(id));
      if (todo.length === 0) return;
      const results = await driver.batch(todo.map((id) => ({ sql: nesterSql, params: [id] })));
      todo.forEach((id, i) => {
        const rows = results[i].rows as Array<{
          referer_id: number;
          referer_trash: unknown;
          referer_name: string | null;
          referer_left_id: number | null;
          referer_right_id: number | null;
        }>;
        const referers: number[] = [];
        for (const row of rows) {
          const refererId = Number(row.referer_id);
          referers.push(refererId);
          if (!nesterTrash.has(refererId)) nesterTrash.set(refererId, row.referer_trash);
          if (!nesterRow.has(refererId) && row.referer_trash !== null && row.referer_trash !== undefined) {
            nesterRow.set(refererId, {
              name: row.referer_name ?? null,
              left_id: row.referer_left_id ?? null,
              right_id: row.referer_right_id ?? null,
            });
          }
        }
        nesterRows.set(id, referers);
      });
    };
    const ids = new Set<number>();
    let frontier = [...new Set(cardIds)];
    for (let level = 0; level <= 5 && frontier.length > 0; level += 1) {
      await prefetchNesters(frontier);
      const next = [...new Set(frontier.flatMap((id) => nesterRows.get(id) ?? []))];
      for (const n of next) ids.add(n);
      if (next.length === 0) break;
      frontier = next.filter((id) => nesterTrash.get(id) === 0);
    }
    if (ids.size === 0) return;
    const list = [...ids];
    const actingId = this.currentActorId ?? (await this.actingIdForWrite()) ?? this.actor?.id ?? null;
    await driver.query(
      `UPDATE cards SET updater_id = ?, updated_at = ? WHERE id IN (${list.map(() => "?").join(", ")})`,
      [actingId, sqlDateTime(this.clock()), ...list],
    );
    const ancestorRows = list.map((id) => nesterRow.get(id));
    const nameTripleSql = "SELECT id, name, left_id, right_id FROM cards WHERE id = ? LIMIT 1";
    const seated = new Set<number>();
    let pending: number[] = [];
    for (const row of ancestorRows) {
      if (row !== undefined && row.left_id !== null && row.left_id !== undefined &&
          row.right_id !== null && row.right_id !== undefined) {
        pending.push(row.left_id, row.right_id);
      }
    }
    while (pending.length > 0) {
      const todo = [...new Set(pending)].filter(
        (id) => !seated.has(id) && !this.fetch.lexicon.heldIdEntry(id),
      );
      pending = [];
      if (todo.length === 0) break;
      for (const id of todo) seated.add(id);
      const sideResults = await driver.batch(todo.map((id) => ({ sql: nameTripleSql, params: [id] })));
      todo.forEach((id, i) => {
        const side = sideResults[i].rows[0] as
          | Pick<CardsRow, "id" | "name" | "left_id" | "right_id">
          | undefined;
        if (side === undefined) {
          this.fetch.lexicon.noteIdToLexMiss(id);
          return;
        }
        this.fetch.lexicon.noteIdToLexRow(side);
        if ((side.name === null || side.name === undefined) &&
            side.left_id !== null && side.left_id !== undefined &&
            side.right_id !== null && side.right_id !== undefined) {
          pending.push(side.left_id, side.right_id);
        }
      });
    }
    for (let i = 0; i < list.length; i += 1) {
      const row = ancestorRows[i];
      const name = row !== undefined ? await this.composedNameOf(row) : undefined;
      if (name !== undefined) {
        const record = newCardRecord(name);
        record.id = list[i];
        this.fetch.expireCard(record);
      }
    }
    expireRuleResolutionCache(driver);
  }

  private async closeAccount(
    writer: ActWriter,
    holderId: number,
    accountCardId: number,
    anonName: string,
    accountActionId: number,
  ): Promise<CardActionSummary[]> {
    const holder = await this.fetchRowById(holderId);
    if (holder === undefined || holder.trash === 1) return [];
    const summaries: CardActionSummary[] = [];
    const nameBefore = await this.composedNameOf(holder);
    const renamed = await writer.updateCard({
      cardId: holder.id,
      before: cardFieldStateFromRow(holder),
      after: { ...cardFieldStateFromRow(holder), name: anonName },
      key: DeckoName.parse(anonName).key,
      superActionId: accountActionId,
    });
    await this.expireAfterWrite({
      cardId: holder.id,
      nameBefore,
      nameAfter: DeckoName.parse(anonName),
      verb: "update",
    });
    if (renamed !== null) {
      summaries.push({ cardId: holder.id, actionId: renamed.actionId, verb: "update", name: DeckoName.parse(anonName) });
    }
    const accountId = await this.fetch.codenames.id("account");
    for (const field of await this.childRows(holder.id)) {
      if (field.left_id !== holder.id || field.right_id === accountId || field.id === accountCardId) continue;
      const saved = await writer.trashCard({
        cardId: field.id,
        before: cardFieldStateFromRow(field),
        superActionId: accountActionId,
        history: await this.fieldHasHistory(field),
      });
      if (saved === null) continue;
      if (saved.actionId !== 0) {
        summaries.push({ cardId: field.id, actionId: saved.actionId, verb: "delete", name: await this.composedNameOf(field) });
      }
      summaries.push(...(await this.runDeleteChildrenBody(writer, field.id, saved.actionId)));
    }
    return summaries;
  }

  private async fieldHasHistory(row: CardsRow): Promise<boolean> {
    if (row.right_id === null) return true;
    const passwordId = await this.fetch.codenames.id("password");
    const saltId = await this.fetch.codenames.id("salt");
    return row.right_id !== passwordId && row.right_id !== saltId && !await this.isAssetOutputRight(row.right_id);
  }

  private async isAssetOutputRight(rightId: number | null | undefined): Promise<boolean> {
    return rightId != null && await this.fetch.codenames.nameForId(rightId) === "asset_output";
  }

  private savedCardsOf(result: ActionResult | null, before?: CardsRow): SavedCard[] {
    if (result === null) return [];
    const out: SavedCard[] = [];
    if (result.actCardActionOmitted !== true) {
      out.push({
        cardId: result.cardId,
        actionId: result.actionId,
        verb: result.verb,
        ...(before !== undefined && before.id === result.cardId ? { contentBefore: before.db_content } : {}),
      });
    }
    for (const sub of result.subactions) out.push({ cardId: sub.cardId, actionId: sub.actionId, verb: sub.verb });
    return out;
  }

  async refreshReadAssetInputs(): Promise<void> {
    const bot = await actorBot(this.fetch.driver);
    await refreshReadAssetInputs(this.styleAssetContext(bot.id));
  }

  private styleAssetContext(actingId: number | undefined): StyleAssetEventContext {
    return {
      fetch: this.fetch,
      clock: this.clock,
      newWriter: () => this.newWriter(actingId),
      expire: (cardId, name) => this.expireAfterWrite({ cardId, nameAfter: name, verb: "update" }),
      attachmentStore: this.attachmentStore,
      storeOutput: (input) => this.storeAssetOutput(input),
      compile: this.scssCompiler,
      compileCoffee: this.coffeeCompiler,
      compressAssets: this.compressAssets,
      compressScript: this.scriptCompressor,
      virtuals: this.virtualCache,
    };
  }

  private async storeAssetOutput(input: AttachmentStoreInput) {
    const store = this.attachmentStore;
    if (store === undefined) throw Error("Derived asset output requires attachmentStore");
    if (this.saveDepth > 0) {
      const borrowedPrevious = await store.read(input.cardId, input.actionId, input.ext, undefined, input.area);
      const previous = borrowedPrevious === undefined ? undefined : new Uint8Array(borrowedPrevious);
      const recovery: AttachmentStoreInput | undefined = previous === undefined ? undefined : {
        cardId: input.cardId, actionId: input.actionId,
        ext: `${input.ext}.recovery-${crypto.randomUUID()}`,
        bytes: new Uint8Array(previous), area: "files",
      };
      const identity = ({ cardId, actionId, ext, area }: AttachmentStoreInput) => ({ cardId, actionId, ext, ...(area ? { area } : {}) });
      const reference: AssetRecoveryReference | undefined = recovery === undefined ? undefined : {
        target: identity(input), backup: identity(recovery),
        originalSha256: await assetBytesSha256(recovery.bytes), replacementSha256: await assetBytesSha256(input.bytes),
      };
      this.assetOutputRestorations.push({ input, before: previous === undefined ? undefined : new Uint8Array(previous), recovery, reference });
      if (recovery !== undefined) await store.store(recovery);
    }
    return this.storeWithRollbackCustody(store, input);
  }

  private static savedCardIds(result: ActionResult | null): number[] {
    if (result === null) return [];
    return [...new Set([result.cardId, ...result.subactions.map((s) => s.cardId)])];
  }

  async revertActions(input: RevertActionsInput): Promise<ActionResult | null> {
    const outermostAct = this.saveDepth === 0;
    if (outermostAct) this.actEnvBodyOutcomes = [];
    const result = await this.atomicSave(() => this.revertActionsInner(input));
    return outermostAct ? this.takeActEnvOutcomes(result, "update") : result;
  }

  private async revertActionsInner(input: RevertActionsInput): Promise<ActionResult | null> {
    const driver = this.fetch.driver;
    const row = await this.fetchRowById(input.cardId);
    if (row === undefined) {
      throw new CardActionError("not-found", `no such card: ${input.cardId}`);
    }
    const actions = await actionsToRevert(driver, {
      actId: input.actId,
      actionIds: input.actionIds,
    });
    if (actions.length === 0) {
      return this.updateCard({ cardId: row.id, lookInTrash: true, skipValidateRenaming: true });
    }
    if (strictParityFlags().revisionRestore500) {
      const typeCode = await this.fetch.codenames.nameForId(row.type_id);
      if (typeCode === "file" || typeCode === "image") {
        throw new StrictParityCrashError(
          "DECKO_STRICT_PARITY_REVISION_RESTORE_500",
          `strict parity: Ruby crashes restoring a ${typeCode} card's revision (the carrierwave revision override's ArgumentError); the port restored it instead (strict mode off)`,
        );
      }
    }
    let own: Revision = {};
    const others = new Map<number, { row: CardsRow; rev: Revision }>();
    for (const action of actions) {
      const actionCard = action.card_id === row.id ? row : await this.fetchRowById(action.card_id);
      if (actionCard === undefined) continue;
      const rev = await revisionOf(driver, actionCard, action, input.revertToPrevious === true);
      if (action.card_id === row.id) own = { ...own, ...rev };
      else others.set(action.card_id, { row: actionCard, rev: { ...(others.get(action.card_id)?.rev ?? {}), ...rev } });
    }
    const subcards: Record<string, SubcardInput> = {};
    const revivals: { row: CardsRow; rev: Revision }[] = [];
    const renames: number[] = [];
    for (const { row: other, rev } of others.values()) {
      const otherName = await this.composedNameOf(other);
      const renamesCard =
        otherName !== undefined &&
        ((rev.name !== undefined && rev.name !== otherName.s) ||
          (rev.left_id !== undefined && rev.left_id !== other.left_id) ||
          (rev.right_id !== undefined && rev.right_id !== other.right_id));
      if (renamesCard) {
        if (other.trash === 1) {
          await driver.query("UPDATE cards SET trash = 0, updated_at = ? WHERE id = ?", [
            sqlDateTime(this.clock()),
            other.id,
          ]);
        }
        subcards[otherName.s] = { name: rev.name ?? otherName.s };
        renames.push(other.id);
        continue;
      }
      if (rev.trash === false && other.trash === 1) {
        revivals.push({ row: other, rev });
        continue;
      }
      if (rev.trash === true && otherName !== undefined) {
        if (other.trash === 0) subcards[otherName.s] = { trash: true };
        continue;
      }
      if (otherName === undefined || other.trash === 1) {
        throw new CardActionError(
          "revert-unsupported",
          `reverting another card's trash state with further changes is not supported (card ${other.id})`,
        );
      }
      subcards[otherName.s] = {
        content: rev.db_content ?? "",
        ...(typeof rev.type_id === "number" ? { typeId: rev.type_id } : {}),
      };
    }
    for (const { row: other, rev } of revivals) {
      const exact =
        (rev.db_content ?? null) === (other.db_content ?? null) &&
        (rev.type_id ?? null) === other.type_id &&
        (rev.left_id ?? null) === other.left_id &&
        (rev.right_id ?? null) === other.right_id;
      if (!exact) {
        throw new CardActionError(
          "revert-unsupported",
          `reverting another card's trash state with further changes is not supported (card ${other.id})`,
        );
      }
      await driver.query(
        "UPDATE cards SET trash = 0, updated_at = ? WHERE id = ?",
        [sqlDateTime(this.clock()), other.id],
      );
    }
    const hasSubcards = Object.keys(subcards).length > 0;
    const isCompound = row.left_id !== null;
    if (isCompound && (own.left_id !== undefined && own.left_id !== row.left_id ||
      own.right_id !== undefined && own.right_id !== row.right_id)) {
      throw new CardActionError(
        "revert-unsupported",
        `reverting a compound card's parts is not supported (card ${row.id})`,
      );
    }
    const result = await this.updateCard({
      cardId: row.id,
      lookInTrash: true,
      skipValidateRenaming: true,
      withinRollback: true,
      ...(!isCompound && own.name !== undefined && own.name !== row.name ? { name: own.name } : {}),
      ...(own.db_content !== undefined && own.db_content !== null ? { content: own.db_content } : {}),
      ...(typeof own.type_id === "number" && own.type_id !== row.type_id ? { typeId: own.type_id } : {}),
      ...(own.trash === false && row.trash === 1 ? { trash: false } : {}),
      ...(own.trash === true && row.trash === 0 ? { trash: true } : {}),
      ...(hasSubcards ? { subcards } : {}),
    });
    if (result === null) {
      await this.newWriter(await this.actingIdForWrite()).clearOwnDrafts(row.id);
    }
    return result;
  }

  async deleteCard(input: DeleteCardInput): Promise<ActionResult | null> {
    const outermostAct = this.saveDepth === 0;
    if (outermostAct) this.actEnvBodyOutcomes = [];
    try {
      const result = await this.atomicSave(() => this.deleteCardInner(input));
      return outermostAct ? this.takeActEnvOutcomes(result, "delete") : result;
    } catch (error) {
      if (error instanceof ModEventAbortSuccess) {
        return { cardId: 0, actionId: 0, actId: 0, subactions: [], verb: "delete" };
      }
      await this.reportServerError(
        this.eventCard({ name: undefined, id: input.cardId, action: "delete" }),
        error,
      );
      throw error;
    } finally {
      this.pendingSaveInput = undefined;
    }
  }

  private async deleteCardInner(input: DeleteCardInput): Promise<ActionResult | null> {
    const actingId = await this.actingIdForWrite();
    if (actingId === undefined) this.assertWritable();
    await this.dispatchEventStage(
      "initialize",
      this.eventCard({ name: undefined, id: input.cardId, action: "delete" }),
    );
    const row = await this.fetchRowById(input.cardId);
    if (row === undefined) {
      throw new CardActionError("not-found", `no such card: ${input.cardId}`);
    }
    if (row.trash === 1) return null;
    const card = await composeCardRecord(row, this.fetch.lexicon);
    await this.assertCanWrite(card, "delete");
    if (
      row.codename !== null &&
      row.codename !== "" &&
      !this.registeredEvent("validate_delete")
    ) {
      const message = `${card.name?.s ?? `~${row.id}`} is is a system card. (${row.codename})`;
      throw new CardActionError(
        "protected-card",
        message,
        `DELETE: ${message}`,
        { delete: message },
        card.name?.s,
      );
    }
    if (row.type_id !== null) {
      const typeCode = (await this.fetchRowById(row.type_id))?.codename;
      if (typeCode === "skin") {
        const styleRule = await this.fetch.fetchByName("*all+*style");
        if (styleRule?.dbContent !== undefined && styleRule.dbContent !== null) {
          const cardKey = row.key ?? card.key ?? undefined;
          const itemKeys = rawItemStrings(styleRule.dbContent).map(
            (item) => DeckoName.parse(item).key,
          );
          if (cardKey !== undefined && itemKeys.includes(cardKey)) {
            const message = "Can't delete skin because it's used.";
            throw new CardActionError(
              "protected-card",
              message,
              `DELETE: ${message}`,
              { delete: message },
              card.name?.s,
            );
          }
        }
      }
    }
    const currentName = await this.composedNameOf(row);
    await this.prepareRecaptchaSaveInput(
      input.recaptchaToken,
      "delete",
      await ruleWalkPatternInput(this.fetch, {
        name: currentName ?? DeckoName.parse(""),
        id: row.id,
        isNew: false,
        typeId: row.type_id,
      }),
    );
    await this.dispatchEventStage(
      "validate",
      this.eventCard({
        name: currentName,
        id: row.id,
        key: row.key ?? undefined,
        dbContent: row.db_content,
        dbContentBeforeAct: row.db_content ?? null,
        action: "delete",
        trash: true,
        typeId: row.type_id,
        codename: row.codename ?? undefined,
        changedFields: ["trash"],
      }),
    );
    const writer = this.newWriter(actingId);
    const accountId = await this.fetch.codenames.id("account");
    const deletesAccount = accountId !== undefined && row.right_id === accountId && row.left_id !== null;
    if (deletesAccount && row.left_id !== null) {
      const holder = await this.fetchRowById(row.left_id);
      const userType = await this.fetch.codenames.id("user");
      const signupType = await this.fetch.codenames.id("signup");
      const holderCanClose = holder !== undefined && (
        (userType !== undefined && holder.type_id === userType) ||
        (signupType !== undefined && holder.type_id === signupType) ||
        holder.codename === "decko_bot" || holder.codename === "anonymous"
      );
      if (!holderCanClose) {
        const receiver = holder === undefined ? "nil" : rubyDefaultInspect("Card", holder.id);
        throw new NoMethodError(`undefined method \`close_account' for ${receiver}`);
      }
    }
    const holderAccount = accountId === undefined || row.left_id !== null
      ? undefined
      : (await this.childRows(row.id)).find((c) => c.right_id === accountId && c.left_id === row.id);
    const anonName = deletesAccount || holderAccount !== undefined ? anonymousAccountName() : undefined;
    if (row.type_id !== null) {
      const sessionType = (await this.fetchRowById(row.type_id))?.codename === "session";
      if (sessionType) {
        if (input.visitorSession !== undefined && currentName !== undefined) {
          storeSessionCardContent(input.visitorSession, currentName.s, undefined);
        }
        throw new ModEventAbortSuccess();
      }
    }
    if (await this.isVirtualCacheCardRight(row.right_id)) {
      await virtualDelete(
        this.fetch.driver,
        card,
        this.virtualCache,
        { leftCardId: row.left_id ?? undefined, rightCardId: row.right_id ?? undefined },
      );
      if (!isRealCard(card)) throw new ModEventAbortSuccess();
    }
    const saved = await writer.trashCard({
      cardId: row.id,
      before: cardFieldStateFromRow(row),
      ...(holderAccount !== undefined && anonName !== undefined
        ? { after: { ...cardFieldStateFromRow(row), name: anonName, trash: 1 }, key: DeckoName.parse(anonName).key }
        : {}),
      superActionId: input.superActionId ?? null,
      ...(await this.isAssetOutputRight(row.right_id) ? { history: false } : {}),
    });
    if (saved === null) return null;
    let closure: CardActionSummary[] = [];
    if (deletesAccount && anonName !== undefined && row.left_id !== null) {
      closure = await this.closeAccount(writer, row.left_id, row.id, anonName, saved.actionId);
    }
    const deletedCard = (): ModEventCard =>
      this.eventCard({
        name: currentName,
        id: row.id,
        key: currentName?.key ?? row.key ?? undefined,
        dbContent: row.db_content,
        dbContentBeforeAct: row.db_content ?? null,
        action: "delete",
        actId: saved.actId,
        trash: true,
        typeId: row.type_id,
        changedFields: ["trash"],
      });
    await this.dispatchEventStage("prepare_to_store", deletedCard());
    await this.dispatchEventStage("store", deletedCard());

    const subactions = [
      ...closure,
      ...(await this.runDeleteChildrenBody(writer, row.id, saved.actionId, deletedCard())),
    ];
    await this.expireAfterWrite({
      cardId: row.id,
      nameAfter: currentName,
      verb: "delete",
    });
    if (holderAccount !== undefined && anonName !== undefined) {
      await this.expireAfterWrite({ cardId: row.id, nameAfter: DeckoName.parse(anonName), verb: "update" });
    }
    const deletedCards: SavedCard[] = [
      { cardId: row.id, actionId: saved.actionId, verb: "delete" as const },
      ...subactions.map((s) => ({
        cardId: s.cardId,
        actionId: s.actionId,
        verb: "delete" as const,
      })),
    ];
    await runStyleAssetEvents(this.styleAssetContext(actingId), deletedCards);
    await this.runFinalizeEvents(deletedCard(), [
      [
        "clear_references",
        () => clearReferencesOnDelete(this.fetch.driver, row.id),
      ],
    ]);
    await cascadeReadRuleAfterRuleSave(this.readRuleDeps(), row, true);
    const result = {
      cardId: row.id,
      actionId: saved.actionId,
      actId: saved.actId,
      verb: "delete" as const,
      name: holderAccount !== undefined && anonName !== undefined
        ? DeckoName.parse(anonName)
        : deletesAccount && anonName !== undefined && currentName?.rightName !== undefined
          ? DeckoName.parse(`${anonName}+${currentName.rightName.s}`)
          : currentName,
      subactions,
    };
    await this.afterCommit(async () => {
      await this.bumpAncestorTimestamps(CardActionEngine.savedCardIds(result));
      await this.dispatchEventStage("integrate", deletedCard());
      await this.dispatchSavePathIntegrations(result);
    });
    return result;
  }

  private async subcardStoreOrder(
    mainName: DeckoName | undefined,
    subcards: Record<string, SubcardInput>,
  ): Promise<[string, SubcardInput][]> {
    const entries = Object.entries(subcards);
    if (!entries.some(([, sub]) => sub.trash === true)) return entries;
    const rows = new Map<string, CardsRow | undefined>();
    for (const [key] of entries) {
      const fullName = key.startsWith("+") ? `${mainName?.s ?? ""}${key}` : key;
      const id = await this.fetch.lexicon.id(DeckoName.parse(fullName));
      rows.set(key, id === undefined ? undefined : await this.fetchRowById(id));
    }
    const trashIds = new Map<number, string>();
    for (const [key, sub] of entries) {
      const row = rows.get(key);
      if (sub.trash === true && row !== undefined) trashIds.set(row.id, key);
    }
    const parentKey = (key: string): string | undefined => {
      const row = rows.get(key);
      if (row === undefined || subcards[key]?.trash !== true) return undefined;
      for (const side of [row.left_id, row.right_id]) {
        const owner = side === null ? undefined : trashIds.get(side);
        if (owner !== undefined && owner !== key) return owner;
      }
      return undefined;
    };
    const out: [string, SubcardInput][] = [];
    const placed = new Set<string>();
    const place = (key: string): void => {
      if (placed.has(key)) return;
      placed.add(key);
      out.push([key, subcards[key]]);
      for (const [child] of entries) if (parentKey(child) === key) place(child);
    };
    for (const [key] of entries) if (parentKey(key) === undefined) place(key);
    for (const [key] of entries) place(key);
    return out;
  }

  private async trashInWriter(
    writer: ActWriter,
    row: CardsRow,
    superActionId: number | null,
  ): Promise<(CardActionSummary & { actId: number })[]> {
    const saved = await writer.trashCard({
      cardId: row.id,
      before: cardFieldStateFromRow(row),
      superActionId,
      ...(await this.isAssetOutputRight(row.right_id) ? { history: false } : {}),
    });
    if (saved === null) return [];
    const name = await this.composedNameOf(row);
    await this.expireAfterWrite({ cardId: row.id, nameAfter: name, verb: "delete" });
    await this.runFinalizeEvents(
      this.eventCard({
        name,
        id: row.id,
        key: name?.key ?? row.key ?? undefined,
        dbContent: row.db_content,
        dbContentBeforeAct: row.db_content ?? null,
        action: "delete",
        actId: saved.actId,
        trash: true,
        typeId: row.type_id,
        changedFields: ["trash"],
      }),
      [["clear_references", () => clearReferencesOnDelete(this.fetch.driver, row.id)]],
    );
    await cascadeReadRuleAfterRuleSave(this.readRuleDeps(), row, true);
    return [{ cardId: row.id, actionId: saved.actionId, actId: saved.actId, verb: "delete", name }];
  }

  private async runManageTrashBody(
    lex: Lex | undefined,
    card: ModEventCard,
  ): Promise<Awaited<ReturnType<typeof findTrashedCardByLex>>> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find((e) => e.event === "manage_trash");
    if (runtime === undefined || registered === undefined) {
      return lex === undefined ? undefined : await findTrashedCardByLex(this.fetch.driver, lex);
    }
    if (this.skipsEvent("manage_trash")) return undefined;
    let pulled: Awaited<ReturnType<typeof findTrashedCardByLex>>;
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "prepare_to_store",
      skipEvent: (n) => this.skipsEvent(n),
      pullFromTrash: async () => {
        pulled =
          lex === undefined ? undefined : await findTrashedCardByLex(this.fetch.driver, lex);
      },
    };
    await registered.fn(
      card,
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
    return pulled;
  }

  private async runPrepareLeftAndRightBody(
    writer: ActWriter,
    name: DeckoName,
    selfId?: number,
    opts: { reserveOwnAction?: boolean } = {},
  ): Promise<ResolvedSides> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find(
      (e) => e.event === "prepare_left_and_right",
    );
    if (runtime === undefined || registered === undefined) {
      return this.ensureSides(writer, name, selfId, opts);
    }
    const created: (CardActionSummary & { actId: number })[] = [];
    const resolved = await this.assignSideIds(name);
    if (this.skipsEvent("prepare_left_and_right")) {
      return { leftId: resolved.left, rightId: resolved.right, created };
    }
    const memo = new Map<string, number>();
    const answers: { left: number | null; right: number | null } = { ...resolved };
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "store",
      skipEvent: (n) => this.skipsEvent(n),
      simpleName: !name.isCompound,
      prepareSide: async (side) => {
        const sideName = side === "left" ? name.leftName : name.rightName;
        if (sideName === undefined) return answers[side];
        const id = await this.prepareSide(
          writer,
          sideName,
          answers[side],
          selfId,
          created,
          memo,
        );
        answers[side] = id;
        return id;
      },
    };
    await registered.fn(
      this.eventCard({ name, action: selfId === undefined ? "create" : "update" }),
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
    return { leftId: answers.left, rightId: answers.right, created };
  }

  private async reportServerError(
    card: ModEventCard | undefined,
    error: unknown,
  ): Promise<void> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find((e) => e.event === "notable_exception_raised");
    if (runtime === undefined || registered === undefined) return;
    if (!isServerClassError(error)) return;
    if (this.skipsEvent("notable_exception_raised")) return;
    const current: ModEventCurrentError = {
      message: error instanceof Error ? error.message : String(error),
      backtrace:
        error instanceof Error && typeof error.stack === "string"
          ? error.stack.split("\n").slice(1)
          : [],
    };
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "integrate",
      skipEvent: (n) => this.skipsEvent(n),
      ...(this.eventLogger !== undefined ? { logger: this.eventLogger } : {}),
      currentError: current,
    };
    try {
      await registered.fn(
        card ?? this.eventCard({ name: undefined, action: "update" }),
        runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
        ctx,
      );
    } catch {
    }
  }

  private async runDeleteChildrenBody(
    writer: ActWriter,
    rootId: number,
    rootActionId: number,
    card?: ModEventCard,
    skip?: Set<number>,
  ): Promise<(CardActionSummary & { actId: number })[]> {
    const runtime = this.modEvents;
    const registered = runtime?.registry.all().find((e) => e.event === "delete_children");
    if (runtime === undefined || registered === undefined) {
      return this.deleteChildren(writer, rootId, rootActionId, skip);
    }
    if (this.skipsEvent("delete_children")) return [];
    let summaries: (CardActionSummary & { actId: number })[] = [];
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "validate",
      skipEvent: (n) => this.skipsEvent(n),
      deleteChildren: async () => {
        summaries = await this.deleteChildren(writer, rootId, rootActionId, skip);
      },
    };
    await registered.fn(
      card ?? (await this.deleteEventCard(rootId, rootActionId)),
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
    return summaries;
  }

  private async deleteEventCard(rootId: number, actId: number): Promise<ModEventCard> {
    const row = await this.fetchRowById(rootId);
    return this.eventCard({
      name: row === undefined ? undefined : await this.composedNameOf(row),
      id: rootId,
      key: row?.key ?? undefined,
      dbContent: row?.db_content ?? null,
      dbContentBeforeAct: row?.db_content ?? null,
      action: "delete",
      actId,
      trash: true,
      typeId: row?.type_id,
      changedFields: ["trash"],
    });
  }

  private async deleteChildren(
    writer: ActWriter,
    rootId: number,
    rootActionId: number,
    skip?: Set<number>,
  ): Promise<(CardActionSummary & { actId: number })[]> {
    const summaries: (CardActionSummary & { actId: number })[] = [];
    const visited = new Set<number>([rootId]);
    let frontier: { parentId: number; parentActionId: number }[] = [
      { parentId: rootId, parentActionId: rootActionId },
    ];
    while (frontier.length > 0) {
      const next: { parentId: number; parentActionId: number }[] = [];
      for (const { parentId, parentActionId } of frontier) {
        for (const child of await this.childRows(parentId)) {
          if (visited.has(child.id)) continue;
          if (skip?.has(child.id)) {
            visited.add(child.id);
            continue;
          }
          visited.add(child.id);
          const history = await this.fieldHasHistory(child);
          const saved = await writer.trashCard({
            cardId: child.id,
            before: cardFieldStateFromRow(child),
            superActionId: parentActionId,
            history,
          });
          if (saved === null) continue;
          await this.runFinalizeEvents(
            this.eventCard({
              name: await this.composedNameOf(child),
              id: child.id,
              key: child.key ?? undefined,
              dbContent: child.db_content,
              action: "delete",
              trash: true,
              typeId: child.type_id,
              changedFields: ["trash"],
            }),
            [
              [
                "clear_references",
                () => clearReferencesOnDelete(this.fetch.driver, child.id),
              ],
            ],
          );
          if (history) {
            summaries.push({
              cardId: child.id,
              actionId: saved.actionId,
              actId: saved.actId,
              verb: "delete",
              name: await this.composedNameOf(child),
            });
          }
          next.push({ parentId: child.id, parentActionId: saved.actionId });
        }
      }
      frontier = next;
    }
    return summaries;
  }

  private readRuleDeps(): ReadRuleWriteDeps {
    return { driver: this.fetch.driver, fetch: this.fetch };
  }

  private eventCard(input: {
    name: DeckoName | undefined;
    id?: number;
    key?: string;
    dbContent?: string | null;
    action: "create" | "update" | "delete";
    actId?: number;
    trash?: boolean;
    typeId?: number | null;
    nameBeforeAct?: string;
    changedFields?: readonly string[];
    dbContentBeforeAct?: string | null;
    typeIdBeforeAct?: number | null;
    patternTypeId?: number | null;
    receiverSetIdentities?: ModEventCard["receiverSetIdentities"];
    codename?: string;
  }): ModEventCard {
    return {
      name: input.name?.s ?? (input.id !== undefined ? `~${input.id}` : ""),
      id: input.id,
      key: input.key,
      dbContent: input.dbContent ?? undefined,
      dbContentBeforeAct: input.dbContentBeforeAct,
      action: input.action,
      trash: input.trash,
      typeId: input.typeId ?? null,
      nameBeforeAct: input.nameBeforeAct,
      changedFields: input.changedFields ?? [],
      typeIdBeforeAct: input.typeIdBeforeAct,
      patternTypeId: input.patternTypeId,
      receiverSetIdentities: input.receiverSetIdentities,
      codename: input.codename,
      envController: true,
      act: {
        action: input.action,
        actId: input.actId,
        skip: this.actSkipList(),
        forceSkip: this.modEvents?.forceSkip,
        trigger: this.actTriggers ?? this.modEvents?.trigger,
      },
    };
  }

  private eventStateContext(stage: ModEventStage): ModEventCardStateContext {
    return {
      ...(this.saveParams !== undefined ? { params: this.saveParams } : {}),
      authCurrentId: this.actor?.id ?? null,
      isActCard: true,
      stage,
      ...(this.activeSaveAttributes !== undefined
        ? { saveInput: this.activeSaveAttributes }
        : {}),
      ...(this.fileStorage !== undefined ? { fileStorage: this.fileStorage } : {}),
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      fetch: this.fetch,
    };
  }

  private setActiveSaveAttributes(input: {
    attachment?: { coded?: { mod?: string } };
    actionIdOfCachedUpload?: number | string;
  }): void {
    this.activeSaveAttributes = {
      attachmentRides: input.attachment !== undefined,
      ...(input.actionIdOfCachedUpload !== undefined
        ? { actionIdOfCachedUpload: input.actionIdOfCachedUpload }
        : {}),
      ...(input.attachment?.coded?.mod !== undefined
        ? { mod: input.attachment.coded.mod }
        : {}),
      ...(input.attachment?.coded !== undefined ? { storageType: "coded" } : {}),
    };
  }

  private async engineEventCardState(): Promise<ModEventCardState> {
    const state: ModEventCardState = {
      authCurrentId: this.actor?.id ?? null,
      alwaysOk: (await this.writePermissionState()).alwaysOk,
    };
    if (this.actor !== null) {
      return { ...state, canApprove: await this.canApproveSignups() };
    }
    return state;
  }

  private async dispatchEventStage(
    stage: ModEventStage,
    card: ModEventCard,
  ): Promise<ModEventStageReport | undefined> {
    const runtime = this.modEvents;
    if (runtime === undefined) return undefined;
    const engineState = await this.engineEventCardState();
    const populated = await populateModEventCardState(
      { ...card, ...engineState },
      this.eventStateContext(stage),
    );
    const report = await runModEventStage(
      this.saveSkip === undefined && this.actTriggers === undefined
        ? { ...runtime, writeOrderOwned: WRITE_ORDER_OWNED_EVENTS }
        : {
            ...runtime,
            writeOrderOwned: WRITE_ORDER_OWNED_EVENTS,
            ...(this.saveSkip === undefined ? {} : { skip: this.actSkipList() }),
            ...(this.actTriggers === undefined ? {} : { trigger: this.actTriggers }),
          },
      stage,
      populated,
      {
        driver: this.fetch.driver,
        lexicon: this.fetch.lexicon,
        fetchRefererCard: (id) => this.fetch.bracket(id),
        pinStaleReferer: (card) => this.fetch.pinStaleCard(card),
        fetch: this.fetch,
        ...(this.pendingSubcardCollection !== undefined
          ? { subcardCollection: this.pendingSubcardCollection }
          : {}),
      },
      this.pendingSaveInput,
    );
    if (report.bodyOutcomes !== undefined) {
      this.actEnvBodyOutcomes.push(...report.bodyOutcomes);
    }
    return report;
  }

  private pendingSaveInput: ModEventSaveInput | undefined;

  private pendingSubcardCollection: ModEventSubcardCollection | undefined;

  private async prepareSubcardCollection(
    subcards: Record<string, SubcardInput> | undefined,
    mainName: DeckoName,
  ): Promise<void> {
    const runtime = this.modEvents;
    if (runtime === undefined || subcards === undefined) return;
    const registered = runtime.registry.all().some((e) => e.event === "reject_empty_subcards");
    if (!registered) return;
    this.pendingSubcardCollection = {
      keys: Object.keys(subcards),
      hasTrigger: this.actTriggers !== undefined && this.actTriggers.length > 0,
      isNew: async (key) => {
        const name = key.startsWith("+") ? `${mainName.s}${key}` : key;
        const existing = await this.fetch.fetchByName(name);
        return existing === undefined || existing.trash === true;
      },
      isUnfilled: (key) => {
        const sub = subcards[key];
        return sub !== undefined && this.blankNewSubcard(sub);
      },
      drop: (key) => {
        delete subcards[key];
      },
    };
  }

  private async applyAddComment(
    input: {
      comment?: string;
      commentAuthor?: string;
      commentAuthorSession?: { commentAuthor?: string };
    },
    action: "create" | "update",
    name: DeckoName,
    pendingContent: string | undefined,
    setContent: (dbContent: string) => void,
  ): Promise<void> {
    const runtime = this.modEvents;
    if (runtime === undefined || input.comment === undefined) return;
    const registered = runtime.registry
      .all()
      .find((e) => e.event === "add_comment");
    if (registered === undefined) return;
    const commentAuthorName =
      this.actor !== null && !(await this.isAnonymousSession()) ? this.actor.name : undefined;
    const saveInput: ModEventSaveInput = {
      comment: input.comment,
      commentAuthor: input.commentAuthor,
      ...(input.commentAuthorSession !== undefined
        ? { session: input.commentAuthorSession }
        : {}),
      signedInActorName: commentAuthorName,
      now: this.clock,
      pendingContent,
      setContent,
      commentApplied: false,
    };
    this.pendingSaveInput = saveInput;
    const card = this.eventCard({
      name,
      key: name.key,
      dbContent: pendingContent,
      action,
    });
    const ctx: ModEventContext = {
      driver: this.fetch.driver,
      lexicon: this.fetch.lexicon,
      stage: "prepare_to_store",
      skipEvent: (n) =>
        runtime.skip?.includes(n) === true || runtime.forceSkip?.includes(n) === true,
      saveInput,
    };
    await registered.fn(
      card,
      runtime.host as ModEngineHost as Parameters<ModEventFn>[1],
      ctx,
    );
    saveInput.commentApplied = true;
  }

  private async prepareApiKeyGenerateSaveInput(
    input: { content?: string },
    row: CardsRow,
  ): Promise<void> {
    const runtime = this.modEvents;
    if (runtime === undefined) return;
    const registered = runtime.registry
      .all()
      .find((e) => e.event === "generate_api_key");
    if (registered === undefined) return;
    const triggers = this.actTriggers ?? this.modEvents?.trigger ?? [];
    if (!triggers.includes("generate_api_key")) return;
    const saveInput: ModEventSaveInput = {
      comment: undefined,
      commentAuthor: undefined,
      signedInActorName: this.actor?.name,
      now: this.clock,
      pendingContent: input.content ?? row.db_content ?? undefined,
      setContent: (dbContent: string) => {
        input.content = dbContent;
      },
      commentApplied: false,
    };
    this.pendingSaveInput = saveInput;
  }

  private prepareTranslateVariablesSaveInput(
    input: UpdateCardInput,
    card: ModEventCard,
  ): void {
    const runtime = this.modEvents;
    if (runtime === undefined) return;
    if (input.colorsParams === undefined && input.themeColorsParams === undefined) return;
    const registered = runtime.registry.all().some((e) => e.event === "translate_variables_to_scss");
    if (!registered) return;
    this.pendingSaveInput = {
      comment: undefined,
      commentAuthor: undefined,
      signedInActorName: undefined,
      now: this.clock,
      pendingContent: card.dbContent ?? undefined,
      setContent: (dbContent) => {
        input.content = dbContent;
      },
      commentApplied: false,
      colorsParams: input.colorsParams,
      themeColorsParams: input.themeColorsParams,
    };
  }

  private async prepareRecaptchaSaveInput(
    recaptchaToken: string | undefined,
    action: "create" | "update" | "delete",
    pattern: PatternCardInput,
  ): Promise<void> {
    void action;
    if (this.modEvents === undefined || this.recaptchaConfig === undefined) {
      return;
    }
    const registered = this.modEvents.registry
      .all()
      .some((e) => e.event === "recaptcha");
    if (!registered) return;
    const cfg = this.recaptchaConfig;
    const captchaCardId = await this.fetch.codenames.id("captcha");
    const ruleContent =
      cfg.captchaRuleContent !== undefined
        ? typeof cfg.captchaRuleContent === "function"
          ? await cfg.captchaRuleContent(DeckoName.parse(pattern.name).s)
          : cfg.captchaRuleContent
        : await ruleContentForCard(this.fetch, pattern, "captcha");
    const signedIn = !(await this.isAnonymousSession());
    const saveInput: ModEventSaveInput = {
      comment: undefined,
      commentAuthor: undefined,
      signedInActorName: signedIn ? this.actor?.name : undefined,
      now: this.clock,
      pendingContent: undefined,
      setContent: () => undefined,
      commentApplied: false,
      recaptcha: {
        token: recaptchaToken,
        guard: {
          siteKey: cfg.siteKey,
          secretKey: cfg.secretKey,
          envController: true,
          signedIn,
          alwaysOk: cfg.alwaysOk ?? false,
          needsSetup: cfg.needsSetup ?? false,
          captchaRuleContent: ruleContent,
          captchaCodenameExists: captchaCardId !== undefined,
          isSupercard: false,
          minimumScore:
            cfg.minimumScore ??
            RECAPTCHA_CARDIO_CONFIG_DEFAULTS.recaptcha_minimum_score,
          verifyUrl:
            cfg.verifyUrl ??
            RECAPTCHA_CARDIO_CONFIG_DEFAULTS.recaptcha_verify_url,
        },
        isUsed: () => this.captchaUsedThisRequest,
        markUsed: () => {
          this.captchaUsedThisRequest = true;
        },
        verify: cfg.verify ?? recaptchaSiteverifyGet,
      },
    };
    this.pendingSaveInput = saveInput;
  }

  private async runFinalizeEvents(
    card: ModEventCard,
    thunks: ReadonlyArray<readonly [string, () => Promise<void>]>,
  ): Promise<void> {
    if (this.modEvents === undefined) {
      for (const [, thunk] of thunks) await thunk();
      return;
    }
    await this.dispatchEventStage("finalize", card);
    for (const [name, thunk] of thunks) {
      if (EVENT_TAKEOVER_BUILTINS.has(name)) {
        const registered = this.modEvents.registry.all().some((e) => e.event === name);
        if (registered) continue;
      }
      await thunk();
    }
  }

  private async runDeferredReferenceFinalize(deferred: DeferredReferenceFinalize): Promise<void> {
    if (deferred.card !== undefined && deferred.thunks !== undefined) {
      await this.runFinalizeEvents(deferred.card, deferred.thunks);
    }
  }

  private assertWritable(): void {
    if (this.actor === null) {
      throw new CardActionError(
        "anonymous-actor",
        "write action rejected: no signed-in account (anonymous sessions are read-only)",
      );
    }
    if (this.actor.name === ANONYMOUS_ACTOR_NAME) {
      throw new CardActionError(
        "anonymous-actor",
        `write action rejected: ${ANONYMOUS_ACTOR_NAME} is read-only`,
      );
    }
  }

  private async isAnonymousSession(): Promise<boolean> {
    if (this.actor === null) return true;
    const anonId = await this.anonymousActorId();
    return anonId !== undefined && this.actor.id === anonId;
  }

  private async actingIdForWrite(): Promise<number | undefined> {
    if (this.actor !== null) {
      const anonId = await this.anonymousActorId();
      return anonId !== undefined && this.actor.id === anonId ? anonId : this.actor.id;
    }
    return this.anonymousActorId();
  }

  private anonymousActorIdPromise: Promise<number | undefined> | undefined;

  private anonymousActorId(): Promise<number | undefined> {
    this.anonymousActorIdPromise ??= Promise.resolve(
      this.fetch.codenames.id("anonymous"),
    );
    return this.anonymousActorIdPromise;
  }

  async assertMayUpdate(cardId: number): Promise<void> {
    const row = await this.fetchRowById(cardId);
    if (row === undefined || row.trash === 1) {
      throw new CardActionError("not-found", `no such card: ${cardId}`);
    }
    await this.assertCanWrite(await composeCardRecord(row, this.fetch.lexicon), "update");
  }

  async mayCreateCardOfType(typeId: number): Promise<boolean> {
    const pattern: PatternCardInput = {
      name: "",
      isNew: true,
      typeId,
      typeName: await this.typeNameOf(typeId),
    };
    const verdict = await saveTaskVerdictForCard(this.fetch, pattern, "create", await this.writePermissionState());
    return verdict === true;
  }

  async recordPreliminaryUpload(input: {
    cardId?: number;
    typeId: number;
    mount: "file" | "image";
    attachment: AttachmentInput;
  }): Promise<{
    actionId: number;
    cacheCardName: string | undefined;
    identifier: string;
    size: number;
    originalFilename: string;
  }> {
    if (this.attachmentStore === undefined) {
      throw new Error("a preliminary upload requires the engine's attachmentStore option");
    }
    const actingId = await this.actingIdForWrite();
    if (actingId === undefined) this.assertWritable();
    let cardId: number;
    let cacheCardName: string | undefined;
    if (input.cardId !== undefined) {
      await this.assertMayUpdate(input.cardId);
      cardId = input.cardId;
    } else {
      if (!(await this.mayCreateCardOfType(input.typeId))) {
        throw new CardActionError(
          "permission-denied",
          `actor ${this.actor?.name ?? ANONYMOUS_ACTOR_NAME} may not create a card of type ${input.typeId}`,
        );
      }
      const cacheId = await this.fetch.codenames.id(`new_${input.mount}`);
      if (cacheId === undefined) throw new CardActionError("not-found", `no *new ${input.mount} card`);
      cardId = cacheId;
      cacheCardName = (await this.fetch.fetchById(cacheId))?.name?.s;
    }
    const ext = detectAttachmentExtension(input.attachment.originalFilename, input.attachment.bytes);
    const writer = this.newWriter(actingId);
    const saved = await writer.recordUploadDraft({
      cardId,
      actionType: input.cardId === undefined ? "create" : "update",
      comment: input.attachment.originalFilename,
      changes: (actionId) =>
        input.cardId === undefined
          ? [["name", ""], ["type_id", input.typeId], ["db_content", localAttachmentIdentifier(cardId, actionId, ext)]]
          : [["db_content", localAttachmentIdentifier(cardId, actionId, ext)]],
    });
    await this.attachmentStore.store({
      cardId,
      actionId: saved.actionId,
      ext,
      bytes: input.attachment.bytes,
      ...(input.cardId === undefined ? { area: "tmp" as const } : {}),
    });
    return {
      actionId: saved.actionId,
      cacheCardName,
      identifier: localAttachmentIdentifier(cardId, saved.actionId, ext),
      size: input.attachment.bytes.byteLength,
      originalFilename: input.attachment.originalFilename,
    };
  }


  async cachedUploadAttachment(
    actionId: number | string,
    opts: { cardId?: number; mount: "file" | "image" },
  ): Promise<{ attachment: AttachmentInput; release: () => Promise<void> } | undefined> {
    const id = Number(actionId);
    if (!Number.isInteger(id) || this.attachmentStore === undefined) return undefined;
    const cacheCardId = opts.cardId ?? (await this.fetch.codenames.id(`new_${opts.mount}`));
    const action = (
      await this.fetch.driver.query<{ card_id: number | null; comment: string | null }>(
        "SELECT card_id, comment FROM card_actions WHERE id = ? AND draft = 1",
        [id],
      )
    ).rows[0];
    if (action === undefined || cacheCardId === undefined || Number(action.card_id) !== cacheCardId) return undefined;
    const change = (
      await this.fetch.driver.query<{ value: string | null }>(
        "SELECT value FROM card_changes WHERE card_action_id = ? AND field = ? ORDER BY id DESC LIMIT 1",
        [id, trackedFieldIndex("db_content")],
      )
    ).rows[0];
    const parsed = parseLocalAttachmentIdentifier(change?.value ?? null);
    if (parsed === undefined) return undefined;
    const area = opts.cardId === undefined ? ("tmp" as const) : ("files" as const);
    const bytes = await this.attachmentStore.read(parsed.cardId, parsed.actionId, parsed.ext, undefined, area);
    if (bytes === undefined) return undefined;
    const store = this.attachmentStore;
    return {
      attachment: {
        bytes,
        originalFilename: action.comment ?? `${parsed.actionId}${parsed.ext}`,
        fromCachedUpload: true,
      },
      release: async () => {
        await this.fetch.driver.query("DELETE FROM card_actions WHERE id = ?", [id]);
        await store.remove?.(parsed.cardId, parsed.actionId, parsed.ext, area);
      },
    };
  }

  private async assertCanWrite(
    card: CardRecord,
    task: WriteTask,
    opts: { typeChanged?: boolean; assignedTypeId?: number; assignedName?: string } = {},
  ): Promise<void> {
    const pattern = await this.patternInputFor(card, opts.assignedTypeId, opts.assignedName);
    const state = await this.writePermissionState();
    const override =
      task === "update" && !state.alwaysOk && opts.typeChanged !== true && opts.assignedName === undefined && card.name !== undefined
        ? await updatePermissionOverride(card.name, {
            viewerKey: this.actor !== null && !(await this.isAnonymousSession())
              ? DeckoName.parse(this.actor.name).key
              : undefined,
            fetchByKey: (key) => this.fetch.fetchByKey(key),
            fetchById: (cardId) => this.fetch.fetchById(cardId),
          })
        : undefined;
    const verdict = override ?? await saveTaskVerdictForCard(
      this.fetch,
      pattern,
      task,
      state,
      { typeChanged: opts.typeChanged, assignedName: opts.assignedName },
    );
    if (
      task === "create" &&
      verdict === true &&
      card.name !== undefined &&
      card.name.isCompound === true &&
      strictParityFlags().mailUnfollowRefusal === true &&
      (await followRightPermitPassedForCard(this.fetch, pattern, state))
    ) {
      const side = await this.failingCreateSide(card.name);
      if (side !== undefined) {
        throw new CardActionError(
          "user-error",
          `actor ${this.actor?.name ?? ANONYMOUS_ACTOR_NAME} may not ${task} card ${card.name.s}`,
          `${side.toUpperCase()}: permission_denied You don't have permission to create ${side}`,
          { [side.toLowerCase()]: `permission_denied You don't have permission to create ${side}` },
          card.name.s,
        );
      }
    }
    if (verdict === false) {
      const shownName = card.name?.s !== undefined && card.name.s !== "" ? card.name.s : "this";
      if (
        task === "create" &&
        card.name !== undefined &&
        card.name.isCompound === true &&
        (await followRightPermitPassedForCard(this.fetch, pattern, state))
      ) {
        const side = await this.failingCreateSide(card.name);
        if (side !== undefined) {
          throw new CardActionError(
            "user-error",
            `actor ${this.actor?.name ?? ANONYMOUS_ACTOR_NAME} may not ${task} card ${card.name.s}`,
            `${side.toUpperCase()}: permission_denied You don't have permission to create ${side}`,
            { [side.toLowerCase()]: `permission_denied You don't have permission to create ${side}` },
            card.name.s,
          );
        }
      }
      throw new CardActionError(
        "permission-denied",
        `actor ${this.actor?.name ?? ANONYMOUS_ACTOR_NAME} may not ${task} card ${card.name?.s ?? String(card.id)}`,
        undefined,
        { permission_denied: `You don't have permission to ${task} ${shownName}` },
      );
    }
    if (this.canWrite !== undefined) {
      let hookActor: Actor;
      if (this.actor !== null && !(await this.isAnonymousSession())) {
        hookActor = this.actor;
      } else {
        const anonActorId = await this.anonymousActorId();
        if (anonActorId === undefined) {
          throw new CardActionError(
            "anonymous-actor",
            "write action rejected: the deck cannot form the anonymous codename card",
          );
        }
        hookActor = { id: anonActorId, name: ANONYMOUS_ACTOR_NAME };
      }
      const allowed = await this.canWrite(card, hookActor);
      if (!allowed) {
        throw new CardActionError(
          "permission-denied",
          `actor ${this.actor?.name ?? ANONYMOUS_ACTOR_NAME} may not write card ${card.name?.s ?? String(card.id)}`,
        );
      }
    }
  }

  private async writeViewer(): Promise<ReadViewer> {
    if (this.actor !== null) {
      const anonId = await this.anonymousActorId();
      if (anonId !== undefined && this.actor.id === anonId) {
        return { signedIn: false, actorId: anonId };
      }
      return { signedIn: true, actorId: this.actor.id,
        ...(this.enabledRoleIds === undefined ? {} : { enabledRoleIds: this.enabledRoleIds }) };
    }
    return { signedIn: false, actorId: await this.anonymousActorId() };
  }

  private async writePermissionState(): Promise<ViewTaskState> {
    if (this.writeTaskState !== undefined) return this.writeTaskState;
    const viewer = await this.writeViewer();
    const readStmts = readPermissionStatements(viewer);
    const taskStmts = viewTaskPermissionStatements();
    const combined = await this.fetch.driver.batch([...readStmts, ...taskStmts]);
    const readResults = combined.slice(0, readStmts.length);
    const taskResults = combined.slice(readStmts.length);
    const readState = readPermissionStateFromViewerResults(readResults, viewer);
    this.writeTaskState = viewTaskStateFromResults(taskResults, readState);
    return this.writeTaskState;
  }

  private async failingCreateSide(name: DeckoName): Promise<string | undefined> {
    const state = await this.writePermissionState();
    for (const partName of [name.leftName, name.rightName]) {
      if (partName === undefined) continue;
      const existing = await this.fetch.fetchByKey(partName.key);
      if (existing !== undefined && existing.id !== undefined) continue;
      const verdict = await taskVerdictForCard(
        this.fetch,
        { name: partName, isNew: true },
        "create",
        state,
      );
      if (verdict === false) return partName.s;
    }
    return undefined;
  }

  private async patternInputFor(    card: CardRecord,
    assignedTypeId: number | undefined,
    assignedName?: string,
  ): Promise<PatternCardInput> {
    const typeId = assignedTypeId ?? card.typeId;
    const typeName = typeId !== undefined && typeId !== null ? await this.typeNameOf(typeId) : undefined;
    const assigned = assignedName !== undefined ? DeckoName.parse(assignedName) : undefined;
    let leftTypeName: string | undefined;
    const patternName = assigned ?? card.name;
    if (patternName !== undefined && patternName.isCompound) {
      leftTypeName = await quickTypeName(this.fetch, patternName.leftName);
    } else if (card.leftId !== undefined && card.leftId !== null) {
      const leftRow = await this.fetchRowById(card.leftId);
      if (leftRow !== undefined && leftRow.type_id !== null && leftRow.type_id !== undefined) {
        leftTypeName = await this.typeNameOf(leftRow.type_id);
      }
    }
    return {
      name: assigned?.s ?? card.name?.s ?? (card.id !== undefined ? `~${card.id}` : ""),
      id: card.id,
      isNew: isNewCard(card),
      typeId,
      typeName,
      leftTypeName,
      isRule:
        patternName !== undefined && patternName.isCompound
          ? (await isStandardRuleName(this.fetch, patternName)) ||
            (await isPreferenceName(this.fetch, patternName))
          : false,
    };
  }

  private async typeNameOf(typeId: number): Promise<string | undefined> {
    const row = await this.fetchRowById(typeId);
    return row?.name ?? undefined;
  }

  private newWriter(actingId?: number): ActWriter {
    const actorId = actingId ?? this.actor?.id;
    if (actorId === undefined) {
      throw new CardActionError("anonymous-actor", "no actor for write");
    }
    return new ActWriter({
      driver: this.fetch.driver,
      actorId: this.currentActorId ?? actorId,
      actActorId: this.actActorId,
      rootStamperId: this.rootStamperId,
      ipAddress: this.ipAddress,
      now: this.clock,
    });
  }

  private async newCardTemplateContent(name: DeckoName, typeId: number): Promise<string | undefined> {
    const pattern = await ruleWalkPatternInput(this.fetch, { name, isNew: true, typeId });
    const [defaultRule, structureRule] = await Promise.all([
      findRule(this.fetch, pattern, "*default"),
      findRule(this.fetch, pattern, "*structure"),
    ]);
    const structure =
      structureRule !== undefined && (structureRule.rule.dbContent ?? "").trim() !== "_self"
        ? structureRule.rule
        : undefined;
    const content = (structure ?? defaultRule?.rule)?.dbContent;
    return typeof content === "string" && content.trim() !== "" ? content : undefined;
  }

  private async saveRecentlyEditedSettings(result: ActionResult | null): Promise<void> {
    if (result === null) return;
    const driver = this.fetch.driver;
    const recentId = await this.fetch.codenames.id("recent_settings");
    if (recentId === undefined) return;
    const actions = [
      { cardId: result.cardId, actionId: result.actionId, verb: result.verb, name: result.name },
      ...result.subactions.map((s) => ({ cardId: s.cardId, actionId: s.actionId, verb: s.verb, name: s.name })),
    ];
    const actionRows = await driver.batch(
      actions.map((action) => ({ sql: CARD_ROW_BY_ID_SQL, params: [action.cardId] })),
    );
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index] as (typeof actions)[number];
      if (action.verb === "delete") continue;
      const row = actionRows[index]?.rows[0] as CardsRow | undefined;
      if (row === undefined || row.trash === 1 || row.left_id === null || row.right_id === null) continue;
      const name = action.name ?? await this.composedNameOf(row);
      if (name === undefined || !((await isStandardRuleName(this.fetch, name)) ||
        (await isPreferenceName(this.fetch, name)))) continue;
      if (action.verb === "update") {
        const changed = (
          await driver.query<{ n: number }>(
            "SELECT COUNT(*) AS n FROM card_changes WHERE card_action_id = ? AND field IN (1, 2)",
            [action.actionId],
          )
        ).rows[0];
        if (Number(changed?.n ?? 0) === 0) continue;
      }
      const recent = await this.fetchRowById(recentId);
      if (recent === undefined || recent.trash === 1) continue;
      const settingName = name.rightName?.s;
      if (settingName === undefined) continue;
      const settingKey = DeckoName.parse(settingName).key;
      const items = listItemStrings(recent.db_content).filter(
        (item) => DeckoName.parse(item).key !== settingKey,
      );
      const content = [settingName, ...items].join("\n");
      if (content === (recent.db_content ?? "")) {
        await driver.query("UPDATE cards SET updated_at = ?, updater_id = ? WHERE id = ?", [
          sqlDateTime(this.clock()),
          this.actor?.id ?? null,
          recentId,
        ]);
        continue;
      }
      await driver.query("UPDATE cards SET db_content = ?, updated_at = ?, updater_id = ? WHERE id = ?", [
        content,
        sqlDateTime(this.clock()),
        this.actor?.id ?? null,
        recentId,
      ]);
      const recentName = (await this.fetch.lexicon.name(recentId)) ?? DeckoName.parse("*recent settings");
      await refreshReferencesOut(driver, this.fetch.lexicon, recentId, recentName, content);
    }
  }

  private async dropUnfilledActions(writer: ActWriter): Promise<void> {
    const actId = writer.currentActId();
    if (actId === null) return;
    const driver = this.fetch.driver;
    await driver.query("DELETE FROM card_actions WHERE card_act_id = ? AND card_id IS NULL", [actId]);
    const left = (
      await driver.query<{ n: number }>("SELECT COUNT(*) AS n FROM card_actions WHERE card_act_id = ?", [actId])
    ).rows[0];
    if (Number(left?.n ?? 0) === 0) await driver.query("DELETE FROM card_acts WHERE id = ?", [actId]);
  }

  private async validatedEmailContent(raw: string, rightId: number, selfId: number | null): Promise<string> {
    const content = normalizeEmail(raw);
    if (content === "") return content;
    let message: string | null = null;
    if (!emailIsValid(content)) message = "must be valid address";
    const taken = (
      await this.fetch.driver.query<{ id: number }>(
        "SELECT id FROM cards WHERE right_id = ? AND db_content = ? AND trash = 0 AND id IS NOT ? LIMIT 1",
        [rightId, content, selfId],
      )
    ).rows;
    if (taken.length > 0) message = "must be unique";
    if (message === null) return content;
    throw new CardActionError("validation-failed", `Validation failed: ${message}`, `CONTENT: ${message}`, {
      content: message,
    });
  }

  private readonly pendingSalts = new Map<number, string>();
  private readonly plannedAccountFieldActions = new Map<string, number>();

  private async reserveStandardAccountFieldsBeforeHolder(
    writer: ActWriter, name: DeckoName, input: CreateCardInput,
    rightId: number | undefined, rootActionId: number | undefined,
  ): Promise<void> {
    if (rootActionId === undefined || input.history === false || name.leftName === undefined) return;
    const accountId = await this.fetch.codenames.id('account');
    if (accountId === undefined || rightId !== accountId) return;
    const holder = await this.fetch.fetchByName(name.leftName.s);
    if (holder?.id !== undefined && !holder.trash) return;
    const fields: Array<{name: DeckoName; code: string; sub: SubcardInput}> = [];
    for (const [key, sub] of Object.entries(input.subcards ?? {})) {
      const field = DeckoName.parse(key.startsWith('+') ? name.s + key : key);
      if (field.leftName?.key !== name.key || field.rightName === undefined || sub.subcards || sub.name || sub.trash || sub.attachment) return;
      const fieldId = await this.fetch.lexicon.id(field.rightName);
      const code = fieldId === undefined ? undefined : await this.fetch.codenames.nameForId(fieldId);
      if (code === undefined || !['email','salt','password','status'].includes(code)) return;
      if ((code === 'email' || code === 'status') && !(sub.content ?? '').trim()) return;
      const existing = await this.fetch.fetchByName(field.s);
      if (existing?.id !== undefined && !existing.trash) return;
      fields.push({name:field,code,sub});
    }
    if (!fields.some(field => field.code === 'email')) return;
    if (!fields.some(field => field.code === 'status')) {
      const statusName = DeckoName.parse(name.s+'+*status');
      const existing = await this.fetch.fetchByName(statusName.s);
      if (existing?.id !== undefined && !existing.trash) return;
      fields.push({name:statusName,code:'status',sub:{content:DEFAULT_ACCOUNT_STATUS}});
    }
    for (const field of fields) {
      if (field.sub.history === false || field.code === 'salt' || field.code === 'password') continue;
      if (this.plannedAccountFieldActions.has(field.name.key)) throw new Error('duplicate planned account field');
      const id = await writer.reserveAction({actionType:'create',superActionId:rootActionId});
      this.plannedAccountFieldActions.set(field.name.key,id);
    }
  }

  private async accountSalt(accountId: number | null): Promise<string | undefined> {
    if (accountId === null) return undefined;
    const pending = this.pendingSalts.get(accountId);
    if (pending !== undefined) return pending;
    const saltId = await this.fetch.codenames.id("salt");
    if (saltId === undefined) return undefined;
    const row = (
      await this.fetch.driver.query<{ db_content: string | null }>(
        "SELECT db_content FROM cards WHERE left_id = ? AND right_id = ? AND trash = 0",
        [accountId, saltId],
      )
    ).rows[0];
    return row?.db_content ?? undefined;
  }

  private async dropHistory(actionId: number, actId: number, actPreexisted: boolean): Promise<void> {
    const driver = this.fetch.driver;
    await driver.query("DELETE FROM card_changes WHERE card_action_id = ?", [actionId]);
    await driver.query("DELETE FROM card_actions WHERE id = ?", [actionId]);
    if (actPreexisted) return;
    const left = (
      await driver.query<{ n: number }>("SELECT COUNT(*) AS n FROM card_actions WHERE card_act_id = ?", [actId])
    ).rows[0];
    if (Number(left?.n ?? 0) === 0) {
      await driver.query("DELETE FROM card_acts WHERE id = ?", [actId]);
    }
  }

  private async ensureAccountDefaults(
    writer: ActWriter,
    accountName: DeckoName,
    accountId: number,
    accountActionId: number,
    saved: (CardActionSummary & { actId: number })[],
  ): Promise<void> {
    const salt = this.pendingSalts.get(accountId);
    if (salt === undefined) return;
    const fields: [string, string][] = [
      ["*salt", salt],
      ["*status", DEFAULT_ACCOUNT_STATUS],
    ];
    for (const [field, content] of fields) {
      const fieldName = DeckoName.parse(`${accountName.s}+${field}`);
      const existing = await this.fetch.lexicon.id(fieldName);
      const live = existing === undefined ? undefined : await this.fetchRowById(existing);
      if (live !== undefined && live.trash === 0) continue;
      const created = await this.createInWriter(
        writer,
        {
          name: fieldName.s, content, superActionId: accountActionId,
          ...(field === "*salt" ? { history: false } : {}),
        },
        { isActCard: false },
      );
      if (field !== "*salt") {
        saved.push({
          cardId: created.cardId,
          actionId: created.actionId,
          actId: created.actId,
          verb: created.verb,
          name: created.name,
        });
      }
    }
    this.pendingSalts.delete(accountId);
  }

  private async assertAccountFieldLeftExists(name: DeckoName): Promise<void> {
    if (name.isSimple || name.rightName === undefined || name.leftName === undefined) return;
    const right = await this.fetch.fetchByKey(name.rightName.key);
    const codename = right?.codename;
    if (codename !== "api_key" && codename !== "password") return;
    const left = await this.fetch.fetchByKey(name.leftName.key);
    if (left !== undefined && left.id !== undefined) return;
    if (codename === "api_key") {
      throw new NoMethodError("undefined method `right_id' for nil");
    }
    const message = `cannot create ${name.s}: its left card does not exist, so the password has no account salt to encrypt with`;
    throw new CardActionError("server-error", message, undefined, { ServerError: message });
  }

  private assertAccountsHaveEmail(subcards: Record<string, SubcardInput> | undefined): void {
    if (subcards === undefined) return;
    for (const [key, sub] of Object.entries(subcards)) {
      const parts = key.split("+").map((p) => p.trim().toLowerCase());
      if (key.trim().startsWith("+") && parts[parts.length - 1] === "*account") {
        const named = Object.keys(sub.subcards ?? {}).some(
          (k) => k.split("+").map((p) => p.trim().toLowerCase()).pop() === "*email",
        );
        if (!named) throw new CardActionError("field-required", `${key} email required`);
      }
      this.assertAccountsHaveEmail(sub.subcards);
    }
  }

  private async standardizeAssignedContent(
    content: string,
    typeId: number | null,
    leftId: number | null,
    rightId: number | null,
    ownCode?: string | null,
  ): Promise<string> {
    const typeCode = typeId === null ? undefined : await this.fetch.codenames.nameForId(typeId);
    const rightCode = rightId === null ? undefined : await this.fetch.codenames.nameForId(rightId);
    let isList =
      (typeCode !== undefined && LIST_TYPE_CODENAMES.has(typeCode)) ||
      (rightCode !== undefined && LIST_RIGHT_CODENAMES.has(rightCode)) ||
      (ownCode !== undefined && ownCode !== null && ownCode !== "" && LIST_SELF_CODENAMES.has(ownCode));
    const leftType = async (): Promise<string | undefined> => {
      if (leftId === null) return undefined;
      const left = await this.fetchRowById(leftId);
      return left?.type_id === undefined || left.type_id === null
        ? undefined
        : this.fetch.codenames.nameForId(left.type_id);
    };
    if (rightCode === "members" && (await leftType()) === "role") {
      return standardizeIdListContent(content, async (item) => {
        let parsed: DeckoName;
        try {
          parsed = DeckoName.parse(item);
        } catch (error) {
          if (
            error instanceof NameNotFoundError ||
            error instanceof CodenameNotFoundError ||
            error instanceof UnsupportedIdentifierError
          ) {
            return undefined;
          }
          throw error;
        }
        return this.fetch.lexicon.id(parsed);
      });
    }
    if (!isList && rightCode === "follow") isList = (await leftType()) === "user";
    if (!isList) return content;
    return standardizeListContent(content, {
      nameForId: async (id) => (await this.fetch.lexicon.name(id))?.s,
      nameForCodename: async (code) => (await this.fetch.codenames.name(code))?.s,
    });
  }

  private async cleanForStore(
    content: string,
    typeId: number | null,
    rightId: number | null,
  ): Promise<string> {
    if (content === "") return content;
    const typeCode = typeId === null ? undefined : await this.fetch.codenames.nameForId(typeId);
    if (typeCode !== undefined && NO_CLEAN_TYPE_CODENAMES.has(typeCode)) return content;
    const rightCode = rightId === null ? undefined : await this.fetch.codenames.nameForId(rightId);
    if (rightCode !== undefined && NO_CLEAN_RIGHT_CODENAMES.has(rightCode)) return content;
    return cleanContent(content);
  }

  private async ensureSides(
    writer: ActWriter,
    name: DeckoName,
    selfId?: number,
    opts: { reserveOwnAction?: boolean } = {},
  ): Promise<ResolvedSides> {
    const created: (CardActionSummary & { actId: number })[] = [];
    if (!name.isCompound) return { leftId: null, rightId: null, created };
    const resolved = await this.assignSideIds(name);
    const memo = new Map<string, number>();
    const leftId =
      name.leftName === undefined
        ? null
        : await this.prepareSide(writer, name.leftName, resolved.left, selfId, created, memo);
    const rightId =
      name.rightName === undefined
        ? null
        : await this.prepareSide(writer, name.rightName, resolved.right, selfId, created, memo);
    return { leftId, rightId, created };
  }

  private async assignSideIds(
    name: DeckoName,
  ): Promise<{ left: number | null; right: number | null }> {
    if (!name.isCompound) return { left: null, right: null };
    const lexicon = currentNameLexicon(this.fetch);
    const left = name.leftName === undefined ? null : (await lexicon.id(name.leftName)) ?? null;
    const right =
      name.rightName === undefined ? null : (await lexicon.id(name.rightName)) ?? null;
    return { left, right };
  }

  private async prepareSide(
    writer: ActWriter,
    sideName: DeckoName,
    sideId: number | null,
    selfId: number | undefined,
    created: (CardActionSummary & { actId: number })[],
    memo: Map<string, number>,
  ): Promise<number | null> {
    if (selfId !== undefined && sideId !== null && sideId === selfId) {
      const fresh = await this.recreateObstructedSide(writer, sideName, selfId, created);
      memo.set(sideName.key, fresh);
      return fresh;
    }
    if (sideId !== null) {
      const row = await this.fetchRowById(sideId);
      if (row !== undefined && row.trash !== 1) return sideId;
    }
    const known = memo.get(sideName.key);
    if (known !== undefined) return known;
    const sub = await this.createInWriter(writer, { name: sideName.s }, { isActCard: false });
    created.push(sub);
    memo.set(sideName.key, sub.cardId);
    return sub.cardId;
  }

  private async recreateObstructedSide(
    writer: ActWriter,
    sideName: DeckoName,
    selfId: number,
    created: (CardActionSummary & { actId: number })[],
  ): Promise<number> {
    const row = await this.fetchRowById(selfId);
    if (row === undefined) {
      throw new CardActionError(
        "not-found",
        `obstructed side ${sideName.s}: card ${selfId} vanished mid-rename`,
      );
    }
    await this.fetch.driver.query(
      "UPDATE cards SET name = NULL, `key` = NULL, left_id = NULL, right_id = NULL WHERE id = ?",
      [selfId],
    );
    const record = newCardRecord(sideName);
    record.id = selfId;
    this.fetch.expireCard(record);
    this.fetch.lexicon.deleteFor(selfId, this.lexOfRow(row));
    const sub = await this.createInWriter(writer, { name: sideName.s }, { isActCard: false });
    created.push(sub);
    return sub.cardId;
  }

  private async claimSides(
    created: readonly (CardActionSummary & { actId: number })[],
    superActionId: number,
  ): Promise<CardActionSummary[]> {
    if (created.length > 0 && superActionId !== 0) {
      const ids = created.map((c) => c.actionId);
      await this.fetch.driver.query(
        `UPDATE card_actions SET super_action_id = ? WHERE id IN (${ids
          .map(() => "?")
          .join(", ")})`,
        [superActionId, ...ids],
      );
    }
    return created.map(({ actId: _actId, ...summary }) => summary);
  }

  private async refreshDescendantCaches(rootId: number): Promise<void> {
    const visited = new Set<number>([rootId]);
    let frontier = [rootId];
    while (frontier.length > 0) {
      const next: number[] = [];
      for (const parentId of frontier) {
        for (const child of await this.childRows(parentId)) {
          if (visited.has(child.id)) continue;
          visited.add(child.id);
          const name = await this.composedNameOf(child);
          if (name !== undefined) {
            const record = newCardRecord(name);
            record.id = child.id;
            this.fetch.expireCard(record);
            if (child.left_id !== null && child.right_id !== null) {
              this.fetch.lexicon.write(child.id, name, [child.left_id, child.right_id]);
            }
          }
          next.push(child.id);
        }
      }
      frontier = next;
    }
  }

  private async fetchRowById(id: number): Promise<CardsRow | undefined> {
    const result = await this.fetch.driver.query<CardsRow>(
      CARD_ROW_BY_ID_SQL,
      [id],
    );
    return result.rows[0];
  }

  private async prefetchSubcardBlock(
    storeOrder: ReadonlyArray<readonly [string, SubcardInput]>,
    mainName: DeckoName | undefined,
  ): Promise<void> {
    await this.declareStandardCards();
    const rawKeys = storeOrder.map(([key]) => key);
    for (const [key, sub] of storeOrder) {
      if (sub.typeName !== undefined) rawKeys.push(String(sub.typeName));
      const fullKey = key.startsWith("+") ? `${mainName?.s ?? ""}${key}` : key;
      try {
        const parsed = DeckoName.parse(fullKey);
        if (parsed.isCompound && parsed.rightName !== undefined) {
          const right = parsed.rightName.s;
          rawKeys.push(
            `${right}+*right+*default`,
            `${right}+*right+*structure`,
            `${right}+*right+*create`,
            `${right}+*right+*read`,
          );
        }
      } catch {
      }
    }
    rawKeys.push(
      "RichText+*type+*default",
      "RichText+*type+*structure",
      "RichText+*type+*create",
      "RichText+*type+*read",
      "*all+*default",
      "*all+*structure",
      "*all+*create",
      "*all+*read",
      "*all plus+*default",
      "*all plus+*structure",
      "*all plus+*create",
      "*all plus+*read",
    );
    const names = cardBlockNames(rawKeys, mainName);
    await declareCardBlockReads(this.fetch.driver, this.fetch.lexicon, names, EVERY_CARD_BLOCK_SHAPE);
  }

  private async declareStandardCards(): Promise<void> {
    await declareDeckStandardCards(this.fetch.driver);
  }

  private async declareSaveInputTree(
    mainName: DeckoName | undefined,
    subcards: Record<string, SubcardInput> | undefined,
    input?: { typeName?: Nameish },
  ): Promise<void> {
    const rawKeys: string[] = [];
    const addCandidateRulesForName = (parsed: DeckoName, typeHint?: string): void => {
      if (parsed.s === "") return;
      rawKeys.push(
        `${parsed.s}+*self+*default`,
        `${parsed.s}+*self+*structure`,
        `${parsed.s}+*self+*create`,
        `${parsed.s}+*self+*read`,
      );
      if (parsed.isCompound && parsed.rightName !== undefined) {
        const right = parsed.rightName.s;
        rawKeys.push(
          `${right}+*right+*default`,
          `${right}+*right+*structure`,
          `${right}+*right+*create`,
          `${right}+*right+*read`,
        );
        if (typeHint !== undefined && typeHint !== "") {
          rawKeys.push(
            `${typeHint}+${right}+*type plus right+*default`,
            `${typeHint}+${right}+*type plus right+*structure`,
            `${typeHint}+${right}+*type plus right+*create`,
            `${typeHint}+${right}+*type plus right+*read`,
          );
        }
      }
    };
    const mainTypeHint = input?.typeName !== undefined ? String(input.typeName) : undefined;
    if (mainName !== undefined && mainName.s !== "") {
      rawKeys.push(mainName.s);
      addCandidateRulesForName(mainName, mainTypeHint);
    }
    if (mainTypeHint !== undefined && mainTypeHint !== "") {
      rawKeys.push(
        mainTypeHint,
        `${mainTypeHint}+*type+*default`,
        `${mainTypeHint}+*type+*structure`,
        `${mainTypeHint}+*type+*create`,
        `${mainTypeHint}+*type+*read`,
      );
    }
    rawKeys.push(
      "RichText+*type+*default",
      "RichText+*type+*structure",
      "RichText+*type+*create",
      "RichText+*type+*read",
      "*all+*default",
      "*all+*structure",
      "*all+*create",
      "*all+*read",
      "*all plus+*default",
      "*all plus+*structure",
      "*all plus+*create",
      "*all plus+*read",
    );
    const collectSubcards = (
      subs: Record<string, SubcardInput> | undefined,
      parentName: DeckoName | undefined,
      parentTypeHint: string | undefined,
    ): void => {
      if (subs === undefined) return;
      for (const [key, sub] of Object.entries(subs)) {
        const fullKey = key.startsWith("+") ? `${parentName?.s ?? ""}${key}` : key;
        rawKeys.push(fullKey);
        const subTypeHint = sub.typeName !== undefined ? String(sub.typeName) : undefined;
        if (subTypeHint !== undefined) rawKeys.push(subTypeHint);
        let parsedSub: DeckoName | undefined;
        try {
          parsedSub = DeckoName.parse(fullKey);
          addCandidateRulesForName(parsedSub, parentTypeHint);
        } catch {
          parsedSub = undefined;
        }
        if (sub.subcards !== undefined) collectSubcards(sub.subcards, parsedSub, subTypeHint);
      }
    };
    collectSubcards(subcards, mainName, mainTypeHint);
    const names = cardBlockNames(rawKeys, mainName);
    if (names.length === 0) return;
    await declareCardBlockReads(this.fetch.driver, this.fetch.lexicon, names, EVERY_CARD_BLOCK_SHAPE);
  }


  private async composedNameOf(row: Pick<CardsRow, "name" | "left_id" | "right_id">): Promise<DeckoName | undefined> {
    if (row.left_id !== null && row.left_id !== undefined) {
      const composed = await this.fetch.lexicon.composeName(row.left_id, row.right_id);
      if (composed !== undefined) return composed;
    }
    return row.name !== null && row.name !== undefined ? DeckoName.parse(row.name) : undefined;
  }

  private keyOf(row: CardsRow, composedName: DeckoName | undefined): string {
    if (row.left_id !== null && row.left_id !== undefined) {
      return composedName?.key ?? row.key ?? "";
    }
    return row.key ?? "";
  }

  private async childRows(parentId: number): Promise<CardsRow[]> {
    const result = await this.fetch.driver.query<CardsRow>(
      "SELECT * FROM cards WHERE (left_id = ? OR right_id = ?) AND trash = 0 ORDER BY id",
      [parentId, parentId],
    );
    return result.rows;
  }

  private async childIds(side: "left" | "right", cardId: number): Promise<number[]> {
    const result = await this.fetch.driver.query<Pick<CardsRow, "id">>(
      `SELECT id FROM cards WHERE ${side}_id = ? AND trash = 0`,
      [cardId],
    );
    return result.rows.map((r) => r.id);
  }

  private lexOf(
    name: DeckoName,
    leftId: number | null,
    rightId: number | null,
  ): Lex | undefined {
    if (name.isSimple) return name.s;
    if (leftId === null || rightId === null) return undefined;
    return [leftId, rightId];
  }

  private lexOfRow(
    state: Pick<CardFieldState, "name" | "left_id" | "right_id">,
  ): Lex | undefined {
    if (state.left_id !== null && state.right_id !== null) {
      return [state.left_id, state.right_id];
    }
    return state.name ?? undefined;
  }

  private async maybeRefreshReferencesOut(input: {
    cardId: number;
    name: DeckoName | undefined;
    contentBefore: string | null | undefined;
    contentAfter: string | null | undefined;
  }): Promise<void> {
    if (input.name === undefined) return;
    if ((input.contentAfter ?? null) === (input.contentBefore ?? null)) return;
    await refreshReferencesOut(
      this.fetch.driver,
      this.fetch.lexicon,
      input.cardId,
      input.name,
      input.contentAfter ?? null,
    );
  }

  private async structureReferencesContent(
    row: CardsRow,
    dbContent: string | null | undefined,
  ): Promise<string | null | undefined> {
    const name = await this.composedNameOf(row);
    if (name === undefined) return dbContent;
    const pattern = await ruleWalkPatternInput(this.fetch, {
      name,
      id: row.id,
      isNew: false,
      typeId: row.type_id,
    });
    const structureRule = await findRule(this.fetch, pattern, "*structure");
    if (structureRule === undefined || (structureRule.rule.dbContent ?? "").trim() === "_self") {
      return dbContent;
    }
    return structureRule.rule.dbContent ?? dbContent;
  }


  private async expireAfterWrite(input: {
    cardId: number;
    nameAfter: DeckoName | undefined;
    nameBefore?: DeckoName;
    lexBefore?: Lex;
    lexAfter?: Lex;
    verb: "create" | "update" | "delete";
    codenameChanged?: boolean;
    codename?: string | null;
  }): Promise<void> {
    const { cardId, nameAfter, nameBefore, lexBefore, lexAfter, verb } = input;
    expireRuleResolutionCache(this.fetch.driver);
    if (nameAfter !== undefined) {
      const record = newCardRecord(nameAfter);
      record.id = cardId;
      if (nameBefore !== undefined) record.nameBeforeAct = nameBefore;
      this.fetch.expireCard(record);
    }
    if (verb === "create") {
      if (nameAfter !== undefined && lexAfter !== undefined) {
        await this.runUpdateLexiconBody("create", cardId, nameAfter, lexAfter);
      }
    } else if (verb === "update" && lexBefore !== undefined) {
      await this.runUpdateLexiconBody("update", cardId, nameAfter, lexAfter, lexBefore);
    }
    if (input.codenameChanged === true) {
      await this.runResetCodenameCacheBody(input.cardId, input.verb, input.codename ?? null);
    }
    await this.expireRelatedStructurees(nameAfter);
  }

  private relatedExpiryNames: string[] = [];

  takeRelatedExpiryNames(): string[] {
    const names = this.relatedExpiryNames;
    this.relatedExpiryNames = [];
    return names;
  }

  private async expireRelatedStructurees(nameAfter: DeckoName | undefined): Promise<void> {
    if (nameAfter === undefined || !nameAfter.isCompound) return;
    const structureId = await this.fetch.codenames.id("structure");
    if (structureId === undefined) return;
    const tagId = await this.fetch.lexicon.id(nameAfter.tagName);
    if (tagId !== structureId) return;
    const deps = this.readRuleDeps();
    const trunkName = nameAfter.leftName;
    if (trunkName === undefined) return;
    const trunkId = await this.fetch.lexicon.id(trunkName);
    if (trunkId === undefined) return;
    const trunkRow = await readRuleFetchCardsRow(deps.driver, trunkId);
    if (trunkRow === undefined) return;
    const setId = await readRuleTypeIdByCodename(deps, "set");
    if (setId === undefined || trunkRow.type_id !== setId) return;
    const memberIds = await readRuleSetMemberIds(deps, trunkRow);
    for (const memberId of memberIds) {
      const memberName = await readRuleCardName(deps, memberId);
      if (memberName === undefined || memberName === "") continue;
      const record = newCardRecord(DeckoName.parse(memberName));
      record.id = memberId;
      this.fetch.expireCard(record);
      this.relatedExpiryNames.push(memberName);
    }
  }

  async saveHelperCardExists(name: Nameish): Promise<boolean> {
    if (name === null || name === undefined || name === "") return false;
    const row = await this.fetch.fetchWithOptions([name as FetchArg], { lookInTrash: true });
    return row !== undefined;
  }

  async uniquifyName(name: Nameish, rename: "old" | "new" = "new"): Promise<string> {
    const original = DeckoName.parse(name as string | DeckoName).s;
    if (!(await this.saveHelperCardExists(original))) return original;
    const alternative = await this.generateAlternativeName(original);
    if (rename === "old") {
      const occupying = await this.fetch.fetchWithOptions([original as FetchArg], {
        lookInTrash: true,
      });
      if (occupying?.id !== undefined) {
        await this.updateCard({ cardId: occupying.id, name: alternative });
      }
      return original;
    }
    return alternative;
  }

  async generateAlternativeName(name: string): Promise<string> {
    let candidate = `${name} 1`;
    while (await this.saveHelperCardExists(candidate)) {
      candidate = candidate.replace(/(\d+)$/, (digits) => String(Number(digits) + 1));
    }
    return candidate;
  }

  async saveHelperCreateCard(
    name: Nameish,
    contentOrArgs?: string | { content?: string },
    renameIfConflict?: "old" | "new",
  ): Promise<ActionResult> {
    const content = typeof contentOrArgs === "string" ? contentOrArgs : contentOrArgs?.content;
    const resolvedName = renameIfConflict === undefined
      ? (name as string)
      : await this.uniquifyName(name as string, renameIfConflict);
    return await this.createCard({ name: resolvedName, content });
  }

  async saveHelperUpdateCard(
    name: Nameish,
    contentOrArgs: string | { content?: string; name?: Nameish; renameIfConflict?: "old" | "new" },
  ): Promise<ActionResult | null> {
    const args = typeof contentOrArgs === "string" ? { content: contentOrArgs } : contentOrArgs;
    if (!(await this.saveHelperCardExists(name))) return null;
    const existing = await this.fetch.fetchWithOptions([name as FetchArg], {});
    if (existing?.id === undefined) return null;
    const newName = args.renameIfConflict === undefined
      ? args.name
      : await this.uniquifyName(args.name ?? name, args.renameIfConflict);
    return await this.updateCard({
      cardId: existing.id,
      ...(newName !== undefined ? { name: newName } : {}),
      ...(args.content !== undefined ? { content: args.content } : {}),
    });
  }

  async saveHelperDeleteCard(name: Nameish): Promise<ActionResult | null> {
    if (!(await this.saveHelperCardExists(name))) return null;
    const existing = await this.fetch.fetchWithOptions([name as FetchArg], {});
    if (existing?.id === undefined) return null;
    return await this.deleteCard({ cardId: existing.id });
  }

  async saveHelperDeleteCodeCard(name: Nameish): Promise<ActionResult | null> {
    if (!(await this.saveHelperCardExists(name))) return null;
    const existing = await this.fetch.fetchWithOptions([name as FetchArg], {});
    if (existing?.id === undefined) return null;
    await this.fetch.driver.query("UPDATE cards SET codename = '' WHERE id = ?", [existing.id]);
    await this.runResetCodenameCacheBody(existing.id, "update", "");
    this.fetch.expireCard(existing);
    return await this.deleteCard({ cardId: existing.id });
  }
}
