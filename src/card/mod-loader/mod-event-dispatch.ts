import type { SQLDatabaseDriver } from "../../server/driver.js";
import type { RenameSwapLexicon } from "../actions/update-referer-content.js";
import type { NameLegalityArm } from "../actions/name-validation.js";
import type { CardRecord } from "../fetch/card-record.js";
import type { FetchEngine } from "../fetch.js";
import { DeckoName } from "../name.js";
import { rubyDefaultInspect, stableIdentity } from "../ruby-object-inspect.js";
import {
  ModEventRegistry,
  type RegisteredModEvent,
} from "./mod-event-registry.js";
import type {
  ModEventBodyOutcome,
  ModEventCard,
  ModEventStage,
} from "./mod-manifest.js";

export interface ModEventSaveInput {
  readonly comment: string | undefined;
  readonly commentAuthor: string | undefined;
  readonly signedInActorName: string | undefined;
  readonly now: () => Date;
  readonly session?: { commentAuthor?: string };
  readonly pendingContent: string | undefined;
  setContent(dbContent: string): void;
  commentApplied: boolean;
  readonly recaptcha?: ModEventRecaptchaInput;
  readonly colorsParams?: Readonly<Record<string, string>>;
  readonly themeColorsParams?: Readonly<Record<string, string>>;
}

export interface ModEventRecaptchaGuard {
  readonly siteKey: unknown;
  readonly secretKey: unknown;
  readonly envController: boolean;
  readonly signedIn: boolean;
  readonly alwaysOk: boolean;
  readonly needsSetup: boolean;
  readonly captchaRuleContent: unknown;
  readonly captchaCodenameExists: boolean;
  readonly isSupercard: boolean;
  readonly minimumScore: number;
  readonly verifyUrl: string;
}

export type ModEventRecaptchaVerify = (
  verifyUrl: string,
  query: { secret: string; response: string },
) => Promise<string>;

export interface ModEventRecaptchaInput {
  readonly token: string | undefined;
  readonly guard: ModEventRecaptchaGuard;
  readonly isUsed: () => boolean;
  readonly markUsed: () => void;
  readonly verify: ModEventRecaptchaVerify;
}

export interface ModEventLogger {
  debug(message: string): void;
  info(message: string): void;
}

export interface ModEventCurrentError {
  readonly message: string;
  readonly backtrace: readonly string[];
}

export interface ModEventSubcardCollection {
  readonly keys: readonly string[];
  readonly isNew: (key: string) => Promise<boolean>;
  readonly isUnfilled: (key: string) => boolean;
  readonly hasTrigger: boolean;
  readonly drop: (key: string) => void;
}

export interface ModEventTrashedObstacle {
  readonly id: number;
}

export interface ModEventContext {
  readonly driver: SQLDatabaseDriver;
  readonly lexicon: RenameSwapLexicon;
  readonly stage: ModEventStage;
  readonly skipEvent: (name: string) => boolean;
  readonly saveInput?: ModEventSaveInput;
  readonly fetchRefererCard?: (id: number) => Promise<CardRecord | undefined>;
  readonly pinStaleReferer?: (card: CardRecord) => void;
  readonly fetch?: FetchEngine;
  readonly deleteChildren?: () => Promise<void>;
  readonly pullFromTrash?: () => Promise<void>;
  readonly logger?: ModEventLogger;
  readonly currentError?: ModEventCurrentError;
  readonly simpleName?: boolean;
  readonly prepareSide?: (side: "left" | "right") => Promise<number | null>;
  readonly subcardCollection?: ModEventSubcardCollection;
  readonly findTrashedKeyObstacle?: (
    key: string,
  ) => Promise<ModEventTrashedObstacle | undefined>;
  readonly renameAsTrashObstacle?: (obstacle: ModEventTrashedObstacle) => Promise<void>;
  readonly resetCodenameCache?: () => void;
  readonly saveContentDraft?: (content: string | undefined) => Promise<void>;
  readonly abortSuccess?: () => void;
  readonly autonameRule?: () => Promise<ModEventAutonameRule | undefined>;
  readonly autonameName?: (seed: string) => Promise<string>;
  readonly setCardName?: (name: string) => void;
  readonly updateAutonameRuleContent?: (name: string) => Promise<void>;
  readonly expireAutonameRule?: () => void;
  readonly prepareDbContent?: (content: string) => Promise<string>;
  readonly setContent?: (content: string) => void;
  readonly clearDrafts?: () => void;
  readonly defaultContent?: () => Promise<string | undefined>;
  readonly setDbContent?: (content: string) => void;
  readonly lexiconAdd?: () => void;
  readonly lexiconUpdate?: () => void;
  readonly cardKey?: () => string | undefined;
  readonly nameKey?: () => string | undefined;
  readonly cardName?: () => string | undefined;
  readonly refuseKey?: (message: string) => never;
  readonly nameBlank?: () => boolean;
  readonly nameIncomplete?: () => boolean;
  readonly nameValid?: () => boolean;
  readonly bannedCharacters?: () => string;
  readonly changingExistingTagToCompound?: () => Promise<boolean> | boolean;
  readonly refuseName?: (message: string, arm: NameLegalityArm) => never;
  readonly refuseNameTagInUse?: (message: string) => never;
  readonly validateLegality?: () => Promise<void>;
  readonly errorsAny?: () => boolean;
  readonly validateUniqueness?: () => Promise<void>;
  readonly sameNameAsBefore?: () => boolean;
  readonly contentIsChanging?: () => boolean;
  readonly typeIsChanging?: () => boolean;
  readonly refuseContentChange?: (message: string) => never;
  readonly refuseTypeChange?: (message: string) => never;
  readonly detectIllegalCompoundNames?: () => Promise<void>;
  readonly lexiconId?: (key: string) => Promise<number | undefined>;
  readonly cardId?: () => number | undefined;
  readonly liveCardName?: (id: number) => Promise<string | undefined>;
  readonly refuseNameTaken?: (existingName: string) => never;
}

export interface ModEventAutonameRule {
  readonly id: number;
  readonly content: string;
}

export type ModEventPredicateTable = Readonly<
  Record<string, (card: ModEventCard, ctx?: ModEventContext) => boolean | Promise<boolean>>
>;

export type ModEventSkipReason =
  | "on-action"
  | "changed"
  | "skip"
  | "force-skip"
  | "trigger"
  | "when-false"
  | "set-not-applicable"
  | "parent-skipped";

export interface ModEventStageReport {
  readonly stage: ModEventStage;
  readonly fired: readonly string[];
  readonly skipped: ReadonlyArray<{ event: string; reason: ModEventSkipReason }>;
  readonly failed: ReadonlyArray<{ event: string; error: unknown }>;
  readonly bodyOutcomes?: ReadonlyArray<ModEventBodyOutcome>;
}

export interface ModEventRuntime {
  readonly registry: ModEventRegistry;
  readonly moduleOrder?: ModEventModuleOrder;
  readonly methodModules?: (card: ModEventCard) => readonly string[] | Promise<readonly string[]>;
  readonly predicates?: ModEventPredicateTable;
  readonly setMember?: (
    setPath: string,
    card: ModEventCard,
    event?: string,
  ) => boolean | Promise<boolean>;
  readonly skip?: readonly string[];
  readonly forceSkip?: readonly string[];
  readonly trigger?: readonly string[];
  readonly host?: unknown;
  readonly writeOrderOwned?: readonly string[];
  readonly logger?: ModEventLogger;
  readonly onReport?: (report: ModEventStageReport) => void;
}

export interface ModEventModuleOrder {
  readonly patterns: ReadonlyArray<{ readonly code: string; readonly anchorPartsCount: number }>;
  readonly setPaths: readonly string[];
  readonly includes?: Readonly<Record<string, readonly string[]>>;
}

function onConditionApplies(
  declared: readonly string[] | undefined,
  action: "create" | "update" | "delete",
): boolean {
  const actions = (declared ?? []).flatMap((t) =>
    t === "save" ? ["create", "update"] : [t],
  );
  return actions.length === 0 || actions.includes(action);
}

const DIRTY_ALIASES: Readonly<Record<string, string>> = {
  type: "type_id",
  content: "db_content",
};

function changedConditionApplies(
  declared: readonly string[] | undefined,
  card: ModEventCard,
): boolean {
  if (card.act?.action !== "update") return true;
  const columns = (declared ?? []).map((n) => DIRTY_ALIASES[n] ?? n);
  if (columns.length === 0) return true;
  const changing = new Set(card.changedFields ?? []);
  return columns.some((c) => changing.has(c));
}

function skipConditionApplies(event: RegisteredModEvent, runtime: ModEventRuntime): boolean {
  const plain = runtime.skip?.includes(event.event) ?? false;
  const forced = runtime.forceSkip?.includes(event.event) ?? false;
  if (!plain && !forced) return true;
  const allowed = event.skip === "allowed";
  return allowed ? false : !forced;
}

function triggerConditionApplies(event: RegisteredModEvent, runtime: ModEventRuntime): boolean {
  if (event.trigger !== "required") return true;
  return runtime.trigger?.includes(event.event) ?? false;
}

async function whenConditionApplies(
  event: RegisteredModEvent,
  runtime: ModEventRuntime,
  card: ModEventCard,
  ctx?: ModEventContext,
): Promise<{ ok: boolean; reason?: ModEventSkipReason }> {
  if (event.when === undefined) return { ok: true };
  if (typeof event.when === "function") {
    const value = await event.when(card);
    return value !== false && value !== null && value !== undefined
      ? { ok: true }
      : { ok: false, reason: "when-false" };
  }
  const predicate = runtime.predicates && Object.hasOwn(runtime.predicates, event.when)
    ? runtime.predicates[event.when]
    : undefined;
  if (predicate === undefined) {
    const error = missingEventMethod(event.when, card);
    error.cause = { when: event.when, event: event.event, setPath: event.setPath, modName: event.modName };
    throw error;
  }
  return (await predicate(card, ctx)) ? { ok: true } : { ok: false, reason: "when-false" };
}

function conditionCard(event: RegisteredModEvent, card: ModEventCard): ModEventCard {
  const oldSets = event.changing !== undefined || card.currentAction === false;
  const name = oldSets ? card.nameBeforeAct ?? card.name : card.name;
  const typeId = oldSets
    ? card.patternTypeId !== undefined ? card.patternTypeId : card.typeIdBeforeAct !== undefined ? card.typeIdBeforeAct : card.typeId
    : card.typeId;
  return {
    ...card,
    name,
    key: name === card.name ? card.key : DeckoName.parse(name).key,
    typeId,
    patternTypeId: typeId,
  };
}

async function setConditionApplies(
  event: RegisteredModEvent,
  runtime: ModEventRuntime,
  card: ModEventCard,
  ctx: ModEventContext | undefined,
): Promise<boolean> {
  if (event.setPath === "all" || event.setPath.startsWith("all/")) return true;
  const originalReceiver = event.changing !== undefined || card.currentAction === false;
  if (originalReceiver && runtime.methodModules !== undefined) {
    const identity = eventModuleIdentity(event.setPath);
    return (await runtime.methodModules(card)).some(path => eventModuleIdentity(path) === identity);
  }
  if (originalReceiver && card.receiverSetIdentities !== undefined) {
    for (const identity of card.receiverSetIdentities) {
      if (await setConditionApplies({ ...event, changing: undefined }, runtime,
        { ...card, ...identity, key: identity.key ?? (identity.name === card.name ? card.key : DeckoName.parse(identity.name).key),
          currentAction: true, receiverSetIdentities: undefined }, ctx)) return true;
    }
    return false;
  }
  card = conditionCard(event, card);
  const includes = runtime.moduleOrder?.includes;
  if (includes !== undefined) {
    const identity = eventModuleIdentity(event.setPath);
    const directRuntime = { ...runtime, moduleOrder: { ...runtime.moduleOrder!, includes: undefined } };
    for (const [owner, ancestors] of Object.entries(includes)) {
      if (!ancestors.some(path => eventModuleIdentity(path) === identity)) continue;
      if (await setConditionApplies({ ...event, setPath: owner, changing: undefined }, directRuntime,
        { ...card, currentAction: true, receiverSetIdentities: undefined }, ctx)) return true;
    }
  }
  const parts = event.setPath.split("/").map(part => part.replace(/^\d+_/, ""));
  const anchorCount = runtime.moduleOrder?.patterns.find(p => p.code === parts[0])?.anchorPartsCount
    ?? (parts[0] === "type_plus_right" ? 2 : ["type", "right"].includes(parts[0]!) ? 1 : undefined);
  const setPath = parts[0] !== "self" && anchorCount !== undefined
    ? parts.slice(0, anchorCount + 1).join("/")
    : event.setPath;
  const supplied = runtime.setMember?.(setPath, card, event.event);
  if (supplied !== undefined) return supplied;
  const selfMatch = /^self\/(.+)$/.exec(setPath);
  if (selfMatch !== null) {
    if (card.key !== undefined) return card.key === `*${selfMatch[1]}`;
    return card.name !== "" ? DeckoName.parse(card.name).key === `*${selfMatch[1]}` : false;
  }
  const rightMatch = /^right\/(.+)$/.exec(setPath);
  if (rightMatch !== null && ctx !== undefined) {
    const right = DeckoName.parse(card.name).rightName;
    if (right === undefined) return false;
    const row = await ctx.driver
      .query<{ codename: string | null }>(
        "SELECT codename FROM cards WHERE key = ? AND trash = 0",
        [DeckoName.parse(right).key],
      )
      .then((r) => r.rows[0]);
    return row?.codename === rightMatch[1];
  }
  const typeMatch = /^type\/(.+)$/.exec(setPath);
  if (typeMatch === null || ctx === undefined) return false;
  const memberTypeId = card.typeId;
  if (memberTypeId === undefined || memberTypeId === null) return false;
  const codenameRow = await ctx.driver
    .query<{ id: number }>("SELECT id FROM cards WHERE codename = ? AND trash = 0", [typeMatch[1]])
    .then((r) => r.rows[0]);
  return codenameRow !== undefined && memberTypeId === codenameRow.id;
}

function stageCandidates(registry: ModEventRegistry, stage: ModEventStage): RegisteredModEvent[] {
  const declarations = registry.all();
  const callbacks: RegisteredModEvent[] = [];
  const target = (event: RegisteredModEvent): string | undefined =>
    event.before ?? event.after ?? (event.at === undefined ? undefined : `${event.at}_stage`);
  const kind = (event: RegisteredModEvent): string => event.before === undefined ? "after" : "before";
  const defined = new Set<string>();
  for (const declaration of declarations) {
    for (let i = callbacks.length - 1; i >= 0; i--) {
      if (defined.has(declaration.event) && target(callbacks[i]!) === declaration.event) callbacks.splice(i, 1);
    }
    const occurrences = declaration.before !== undefined || declaration.after !== undefined
      ? [
          ...(declaration.before === undefined ? [] : [{ ...declaration, after: undefined, at: undefined }]),
          ...(declaration.after === undefined ? [] : [{ ...declaration, before: undefined, at: undefined }]),
        ]
      : [declaration];
    for (const occurrence of occurrences) {
      for (let i = callbacks.length - 1; i >= 0; i--) {
        const previous = callbacks[i]!;
        if (target(previous) === target(occurrence) && kind(previous) === kind(occurrence) && previous.event === occurrence.event) callbacks.splice(i, 1);
      }
      callbacks.push(occurrence);
    }
    defined.add(declaration.event);
  }
  const all = callbacks;
  const byName = new Map<string, RegisteredModEvent[]>();
  for (const event of declarations) byName.set(event.event, [...(byName.get(event.event) ?? []), event]);
  const external = new Set(["select_action", "show_page", "act"]);
  const relativeTo = (event: RegisteredModEvent): string | undefined =>
    event.after ?? event.before;
  const rootsInStage = (event: RegisteredModEvent): boolean => {
    const pending = [{ entry: event, path: [event.event] }];
    let matches = false;
    while (pending.length) {
      const { entry, path } = pending.pop()!;
      const next = relativeTo(entry);
      if (next === undefined) { matches ||= entry.at === stage; continue; }
      if (path.includes(next)) throw new Error(`Invalid event callback cycle: ${[...path, next].join(" -> ")}`);
      const targets = byName.get(next);
      if (targets === undefined) {
        if (!external.has(next)) throw new Error(`Invalid event callback target '${next}' for '${entry.event}' (${entry.setPath})`);
        continue;
      }
      for (const target of targets) pending.push({ entry: target, path: [...path, next] });
    }
    return matches;
  };
  for (const event of declarations) rootsInStage(event);
  return all.filter(rootsInStage);
}

function eventModuleIdentity(setPath: string): string {
  return setPath.split("/").map(part => part.replace(/^\d+_/, "").split("_")
    .map(word => word === "" ? "" : word[0]!.toUpperCase() + word.slice(1)).join("")).join("::");
}

class ModEventMethodMissingError extends Error {
  override readonly name = "NoMethodError";
}

function missingEventMethod(name: string, card: ModEventCard): ModEventMethodMissingError {
  return new ModEventMethodMissingError(
    `undefined method '${name}' for ${rubyDefaultInspect("Card", card.id ?? stableIdentity(card.name))}`,
  );
}

async function includedMethodModules(name: string, runtime: ModEventRuntime, card: ModEventCard,
  ctx: ModEventContext, definitions: readonly RegisteredModEvent[]): Promise<readonly string[] | undefined> {
  const order = runtime.moduleOrder;
  if (order?.includes === undefined) return undefined;
  const identities = new Set(definitions.map(entry => eventModuleIdentity(entry.setPath)));
  if (!Object.values(order.includes).some(paths => paths.some(path => identities.has(eventModuleIdentity(path))))) return undefined;
  if (card.receiverSetIdentities === undefined
    && ((card.patternTypeId !== undefined && card.patternTypeId !== card.typeId)
      || (card.nameBeforeAct !== undefined && card.nameBeforeAct !== card.name))) {
    throw new Error(`Event method '${name}' requires explicit card module ancestry after a name/type change`);
  }
  const directRuntime = { ...runtime, moduleOrder: { ...order, includes: undefined } };
  const sample = definitions[0]!;
  const chain: string[] = [];
  const attachments = card.receiverSetIdentities ?? [{ name: card.name, key: card.key, typeId: card.typeId }];
  for (const attachment of attachments) {
    const receiver = { ...card, ...attachment,
      key: attachment.key ?? (attachment.name === card.name ? card.key : DeckoName.parse(attachment.name).key),
      currentAction: true, receiverSetIdentities: undefined };
    const roots: Array<{path: string; rank: number; index: number}> = [];
    const seen = new Set<string>();
    for (const [index, path] of order.setPaths.entries()) {
      const identity = eventModuleIdentity(path);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const rank = order.patterns.findIndex(pattern => pattern.code === path.split("/")[0]);
      if (rank < 0) continue;
      if (await setConditionApplies({ ...sample, setPath: path, changing: undefined }, directRuntime,
        receiver, ctx)) roots.push({ path, rank, index });
    }
    roots.sort((a, b) => b.rank - a.rank || a.index - b.index);
    for (const root of roots) {
      let cursor = 0;
      for (const path of [root.path, ...(order.includes[root.path] ?? [])]) {
        const existing = chain.findIndex(member => eventModuleIdentity(member) === eventModuleIdentity(path));
        if (existing === -1) chain.splice(cursor++, 0, path);
        else if (existing >= cursor) cursor = existing + 1;
      }
    }
  }
  const attached = new Set(chain.map(eventModuleIdentity));
  if (!Object.values(order.includes).some(paths => paths.some(path => attached.has(eventModuleIdentity(path)) && identities.has(eventModuleIdentity(path))))) {
    return card.receiverSetIdentities?.length === 0 ? [] : undefined;
  }
  for (const definition of definitions) {
    if (!attached.has(eventModuleIdentity(definition.setPath))
      && (await setConditionApplies({ ...definition, changing: undefined }, runtime, card, ctx)
        || await setConditionApplies({ ...definition, changing: [] }, runtime, card, ctx))) {
      throw new Error(`Event method '${name}' requires explicit card module ancestry for '${definition.setPath}'`);
    }
  }
  return chain;
}

async function eventMethod(
  name: string,
  runtime: ModEventRuntime,
  card: ModEventCard,
  ctx: ModEventContext,
): Promise<RegisteredModEvent> {
  const definitions = runtime.registry.all().filter(entry => entry.event === name);
  const methods = new Map<string, RegisteredModEvent>();
  for (const entry of definitions) methods.set(eventModuleIdentity(entry.setPath), entry);
  if (runtime.methodModules !== undefined) {
    for (const setPath of await runtime.methodModules(card)) {
      const definition = methods.get(eventModuleIdentity(setPath));
      if (definition !== undefined) return definition;
    }
    throw missingEventMethod(name, card);
  }
  if (methods.size === 1) return [...methods.values()][0]!;
  const includedModules = await includedMethodModules(name, runtime, card, ctx, [...methods.values()]);
  if (includedModules !== undefined) {
    for (const path of includedModules) {
      const method = methods.get(eventModuleIdentity(path));
      if (method !== undefined) return method;
    }
    throw missingEventMethod(name, card);
  }
  const order = runtime.moduleOrder;
  const firstModuleIndex = new Map<string, number>();
  order?.setPaths.forEach((setPath, index) => {
    const identity = eventModuleIdentity(setPath);
    if (!firstModuleIndex.has(identity)) firstModuleIndex.set(identity, index);
  });
  const applicable: RegisteredModEvent[] = [];
  for (const definition of methods.values()) {
    const assigned = await setConditionApplies({ ...definition, changing: undefined }, runtime, card, ctx);
    if (assigned) applicable.push(definition);
    else if (await setConditionApplies({ ...definition, changing: [] }, runtime, card, ctx)) {
      throw new Error(`Event method '${name}' requires explicit card module ancestry after a name/type change`);
    }
  }
  if (applicable.length === 0) throw missingEventMethod(name, card);
  if (applicable.length === 1) return applicable[0]!;
  if (order === undefined) throw new Error(`Event method '${name}' requires the loaded module order to resolve duplicate definitions`);
  const patternRank = (entry: RegisteredModEvent): number => {
    const pattern = entry.setPath.split("/")[0]!.replace(/^\d+_/, "");
    const rank = order.patterns.findIndex(p => p.code === pattern);
    if (rank < 0) throw new Error(`Event method '${name}' requires explicit card module ancestry for '${entry.setPath}'`);
    if (!firstModuleIndex.has(eventModuleIdentity(entry.setPath))) throw new Error(`Missing loaded module '${entry.setPath}' for event '${name}'`);
    return rank;
  };
  const ranked = applicable.map(entry => ({ entry, rank: patternRank(entry), index: firstModuleIndex.get(eventModuleIdentity(entry.setPath))! }));
  const buckets = new Map<number, string>();
  for (const { entry, rank } of ranked) {
    const pattern = order.patterns[rank]!;
    const parts = entry.setPath.split("/").map(part => part.replace(/^\d+_/, ""));
    const bucket = (pattern.code === "self" ? parts : parts.slice(0, pattern.anchorPartsCount + 1)).join("/");
    const previous = buckets.get(rank);
    if (previous !== undefined && previous !== bucket) {
      throw new Error(`Event method '${name}' requires explicit card module ancestry across '${previous}' and '${bucket}'`);
    }
    buckets.set(rank, bucket);
  }
  ranked.sort((a, b) => a.rank - b.rank || b.index - a.index);
  return ranked[0]!.entry;
}

const HOST_REQUIRED: unknown = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "this event body requires the composition's engine host (ModEventRuntime.host)",
      );
    },
  },
);

export async function runModEventStage(
  runtime: ModEventRuntime,
  stage: ModEventStage,
  card: ModEventCard,
  deps: {
    driver: SQLDatabaseDriver;
    lexicon: RenameSwapLexicon;
    fetchRefererCard?: (id: number) => Promise<CardRecord | undefined>;
    pinStaleReferer?: (card: CardRecord) => void;
    fetch?: FetchEngine;
    subcardCollection?: ModEventSubcardCollection;
  },
  saveInput?: ModEventSaveInput,
): Promise<ModEventStageReport> {
  const writeOrderOwned = new Set(runtime.writeOrderOwned ?? []);
  const stageEntries = stageCandidates(runtime.registry, stage).filter(
    (entry) => !writeOrderOwned.has(entry.event),
  );
  const fired: string[] = [];
  const skipped: Array<{ event: string; reason: ModEventSkipReason }> = [];
  const failed: Array<{ event: string; error: unknown }> = [];
  const bodyOutcomes: ModEventBodyOutcome[] = [];
  const ctx: ModEventContext = {
    driver: deps.driver,
    lexicon: deps.lexicon,
    ...(deps.fetchRefererCard !== undefined ? { fetchRefererCard: deps.fetchRefererCard } : {}),
    ...(deps.pinStaleReferer !== undefined ? { pinStaleReferer: deps.pinStaleReferer } : {}),
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...(deps.subcardCollection !== undefined ? { subcardCollection: deps.subcardCollection } : {}),
    ...(runtime.logger !== undefined ? { logger: runtime.logger } : {}),
    stage,
    skipEvent: (name) =>
      runtime.skip?.includes(name) === true || runtime.forceSkip?.includes(name) === true,
    ...(saveInput !== undefined ? { saveInput } : {}),
  };
  const candidates = stageEntries;
  const children = (event: RegisteredModEvent, kind: "before" | "after") =>
    candidates.filter(child => child[kind] === event.event);
  const skipCallbacks = (event: RegisteredModEvent): void => {
    for (const child of [...children(event, "before").reverse(), ...children(event, "after")]) {
      skipped.push({ event: child.event, reason: "parent-skipped" });
      skipCallbacks(child);
    }
  };
  const active = new Set<RegisteredModEvent>();
  const runEvent = async (event: RegisteredModEvent): Promise<void> => {
    if (active.has(event)) throw new Error(`Invalid event callback recursion at '${event.event}'`);
    if (!onConditionApplies(event.on, card.act?.action ?? "update")) {
      skipped.push({ event: event.event, reason: "on-action" });
      skipCallbacks(event);
      return;
    }
    if (!changedConditionApplies(event.changed, card) ||
        !changedConditionApplies(event.changing, card)) {
      skipped.push({ event: event.event, reason: "changed" });
      skipCallbacks(event);
      return;
    }
    if (!skipConditionApplies(event, runtime)) {
      skipped.push({
        event: event.event,
        reason: runtime.forceSkip?.includes(event.event) ? "force-skip" : "skip",
      });
      skipCallbacks(event);
      return;
    }
    if (!triggerConditionApplies(event, runtime)) {
      skipped.push({ event: event.event, reason: "trigger" });
      skipCallbacks(event);
      return;
    }
    if (!(await setConditionApplies(event, runtime, card, ctx))) {
      skipped.push({ event: event.event, reason: "set-not-applicable" });
      skipCallbacks(event);
      return;
    }
    const when = await whenConditionApplies(event, runtime, card, ctx);
    if (!when.ok) {
      skipped.push({ event: event.event, reason: when.reason ?? "when-false" });
      skipCallbacks(event);
      return;
    }
    const method = await eventMethod(event.event, runtime, card, ctx);
    try {
      active.add(event);
      for (const child of children(event, "before").reverse()) await runEvent(child);
      const outcome = await method.fn(card, (runtime.host ?? HOST_REQUIRED) as Parameters<
        typeof event.fn
      >[1], ctx);
      if (outcome !== undefined && outcome !== null) bodyOutcomes.push(outcome);
      fired.push(event.event);
      for (const child of children(event, "after")) await runEvent(child);
    } catch (error) {
      if (method.before === undefined && method.after === undefined && method.at?.includes("integrate") === true) {
        failed.push({ event: event.event, error });
        return;
      }
      throw error;
    } finally {
      active.delete(event);
    }
  };
  for (const event of candidates) {
    if (event.before === undefined && event.after === undefined) await runEvent(event);
  }
  const report: ModEventStageReport = {
    stage,
    fired,
    skipped,
    failed,
    ...(bodyOutcomes.length > 0 ? { bodyOutcomes } : {}),
  };
  runtime.onReport?.(report);
  return report;
}
