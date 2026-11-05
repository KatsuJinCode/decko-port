import { DeckoName } from "../name.js";
import {
  CodenameNotFoundError,
  NameNotFoundError,
  UnsupportedIdentifierError,
} from "../name/errors.js";
import type { CardRecord } from "../fetch/card-record.js";
import { virtualSearchCqlFor } from "../fetch/virtual-search-cards.js";
import {
  scanNests,
  interpretEscapedLiteral,
  type ContentPiece,
  type NestOptions,
  type ParsedNest,
} from "./nest-syntax.js";
import { safeSetKeys } from "./set-keys.js";
import type { SearchResultPaging } from "./search-paging.js";
import { nowCardContent } from "./now-content-bytes.js";
import { cgiEscape, h, htmlEscapeKeepApostrophe, emitAttrs, newSlotId, slotOptionsJson } from "./slot-html.js";
import { viewPermissionDecision, quietDenial, renderOptSkipPerms, viewPermissionChecks, viewDenialView, type CrudTask, type ViewPermsGateInput, type ViewPermissionDirective } from "../permissions/view-perms.js";
import type { ReadViewer } from "../permissions/read-rules.js";
import { resolveContentOverride } from "./content-overrides.js";
import { NO_REQUEST_ORIGIN } from "./deck-origin.js";
import { serializerFollowsLive } from "./deployment-follow-live-config.js";
import { mainNestWithoutMainError } from "./errors.js";
import type { ModFormatMethodFn } from "../mod-loader/mod-manifest.js";
import { t } from "../i18n/i18n.js";

const ENGINE_NEST_TRACE = typeof process !== "undefined" && process.env?.DECKO_ENGINE_NEST_TRACE === "1";

const SELF_SET_TITLE_OVERRIDES: ReadonlyMap<string, string> = new Map([
  ["search", "Search Results"],
  ["recent", "Recent Changes"],
  ["signin", "Sign In"],
]);

export function cardPath(relPath: string): string {
  return /^(https?:)?\//.test(relPath) ? relPath : `/${relPath}`;
}

export class RubyRuntimeError extends Error {
  readonly rubyClass: string;
  constructor(rubyClass: string, message: string) {
    super(message);
    this.rubyClass = rubyClass;
  }
}

export class UnsupportedViewError extends Error {
  readonly view: string;
  readonly cardName: string;
  readonly rubyClass = "Card::Error::UserError";
  constructor(view: string, cardName: string) {
    super(`view (${view}) not supported for ${cardName}`);
    this.name = "UnsupportedViewError";
    this.view = view;
    this.cardName = cardName;
  }
}

export interface RenderCard {
  record: CardRecord;
  name: DeckoName;
  key: string;
  typeName: string | undefined;
  typeId: number | undefined;
  typeCode: string | undefined;
  id: number | undefined;
  dbContent: string;
  setKeys: string;
  unknown?: boolean;
  pointerItemReadVerdict?: boolean;
  hostTyped?: boolean;
}

export class Voo {
  readonly parent: Voo | undefined;
  readonly requestedView: string;
  readonly opts: Record<string, unknown>;
  liveItems: unknown;
  get items(): unknown {
    const value = this.liveItems ?? this.opts["items"];
    if (value === undefined || value === null || value === false) {
      return this.liveItems = {};
    }
    return value;
  }
  readonly viz = new Map<string, "show" | "hide">();
  readonly classUps = new Map<string, string>();
  slotViewOverride: string | undefined;
  liveTitle: string | undefined;
  liveHelp: string | undefined;
  liveEditStructure: unknown;

  readonly viewLaneRoot: boolean;

  constructor(
    parent: Voo | undefined,
    requestedView: string,
    opts: Record<string, unknown>,
    viewLaneRoot = false,
  ) {
    this.parent = parent;
    this.requestedView = requestedView;
    this.opts = opts;
    this.viewLaneRoot = viewLaneRoot;
    this.liveEditStructure = opts["edit_structure"] ?? parent?.liveEditStructure;
    if (parent !== undefined && opts["size"] === undefined) {
      const inherited = parent.opts["size"];
      if (inherited !== undefined) this.opts["size"] = inherited;
    }
    if (parent !== undefined && opts["help"] === undefined) {
      const inherited = parent.liveHelp;
      if (inherited !== undefined) this.opts["help"] = inherited;
    }
    if (parent !== undefined && opts["title"] === undefined && this.liveTitle === undefined) {
      const inherited = parent.liveTitle;
      if (inherited !== undefined) this.opts["title"] = inherited;
    }
    const ownItems = opts["items"];
    if (parent !== undefined && (ownItems === undefined || ownItems === null || ownItems === false)) {
      const inheritedItems = parent.liveItems ?? parent.opts["items"];
      if (inheritedItems !== undefined && inheritedItems !== null && inheritedItems !== false) {
        this.opts["items"] = inheritedItems;
      }
    }
    if (parent !== undefined && opts["title"] === undefined) {
      const inheritedTitle = parent.opts["title"];
      if (inheritedTitle !== undefined) this.opts["title"] = inheritedTitle;
    }
    if (parent !== undefined && opts["home_view"] === undefined) {
      const inheritedHomeView = parent.opts["home_view"];
      if (inheritedHomeView !== undefined) this.opts["home_view"] = inheritedHomeView;
    }
    for (const key of [
      "structure", "variant", "joint", "input_type", "type", "header",
      "cache", "edit", "separator", "filter", "params",
    ]) {
      if (opts[key] === undefined && parent !== undefined) {
        const inherited = parent.opts[key];
        if (inherited !== undefined) this.opts[key] = inherited;
      }
    }
  }

  private optionalEnrolledView: string | undefined;

  private rootEnrolledInherited = new Set<string>();

  processVisibility(optional: unknown): void {
    if (this.parent !== undefined) {
      for (const [view, setting] of this.parent.viz) {
        if (!this.viz.has(view)) {
          this.viz.set(view, setting);
          if (
            (this.parent.viewLaneRoot && this.parent.optionalEnrolledView === view) ||
            this.parent.rootEnrolledInherited.has(view)
          ) {
            this.rootEnrolledInherited.add(view);
          }
        }
      }
    }
    const optHide = this.opts["hide"];
    const optShow = this.opts["show"];
    if (optHide !== undefined) {
      delete this.opts["hide"];
      for (const view of normalizeVisibilityList(optHide)) this.viz.set(view, "hide");
    }
    if (optShow !== undefined) {
      delete this.opts["show"];
      for (const view of normalizeVisibilityList(optShow)) this.viz.set(view, "show");
    }
    const requested = this.requestedView;
    if (optional !== undefined && optional !== null && optional !== false && !this.viz.has(requested)) {
      this.viz.set(requested, optional === "hide" || optional === false ? "hide" : "show");
      this.optionalEnrolledView = requested;
    }
  }

  show(view: string): boolean {
    return this.viz.get(view) !== "hide";
  }

  explicitShow(view: string): boolean {
    return this.viz.get(view) === "show";
  }

  setViz(views: string | string[], setting: "show" | "hide"): void {
    const list = Array.isArray(views) ? views : [views];
    for (const view of list) this.viz.set(view, setting);
  }

  private vizWrite(views: string | string[], setting: "show" | "hide"): void {
    const list = Array.isArray(views) ? views : [views];
    for (const view of list) {
      if (this.viz.has(view)) continue;
      this.viz.set(view, setting);
    }
  }

  showViz(views: string | string[]): void {
    this.vizWrite(views, "show");
  }

  hide(views: string | string[]): void {
    this.vizWrite(views, "hide");
  }

  slotOptions(): Record<string, unknown> {
    const viewField = this.slotViewOverride ?? this.requestedView;
    const out: Record<string, unknown> = { ...this.opts, view: viewField };
    const show: string[] = [];
    const hide: string[] = [];
    for (const [view, setting] of this.viz) {
      (setting === "show" ? show : hide).push(view);
    }
    const emittedShow = serializerFollowsLive()
      ? show.filter(
          (view) =>
            !(this.viewLaneRoot && view === viewField) &&
            !(this.rootEnrolledInherited.has(view) && view !== this.requestedView),
        )
      : show;
    if (emittedShow.length > 0) out["show"] = emittedShow;
    if (hide.length > 0) out["hide"] = hide;
    return out;
  }

  classUp(klass: string, classier: string): void {
    this.classUps.set(klass, [this.classUps.get(klass), classier].filter((s) => s !== undefined && s !== "").join(" "));
  }

  classy(...classes: (string | string[])[]): string {
    const flat: string[] = [];
    for (const group of classes) {
      if (Array.isArray(group)) flat.push(...group);
      else if (group !== "") flat.push(group);
    }
    const out = flat.filter((s) => s !== "");
    if (out.length === 0) return "";
    const extra = this.deepExtraClasses(out[0] as string);
    if (extra !== "") out.push(extra);
    const seen = new Set<string>();
    const tokens: string[] = [];
    for (const token of out.join(" ").split(" ")) {
      if (token === "" || seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
    return tokens.join(" ");
  }

  private deepExtraClasses(klass: string): string {
    const own = this.classUps.get(klass);
    const parent = this.parent?.deepExtraClasses(klass) ?? "";
    return [own, parent].filter((s) => s !== undefined && s !== "").join(" ");
  }
}

export interface ViewContext {
  fmt: RenderFormat;
  voo: Voo;
}

export type ViewResult = string | number | null | ViewRawArray | ViewRawHash;

export type ViewRawArray = ReadonlyArray<string | number | null | ViewRawArray | ViewRawHash>;

export type ViewRawHash = Readonly<Record<string, unknown>>;

export function str(result: ViewResult): string {
  if (result === null) return "";
  if (typeof result === "string") return result;
  if (typeof result === "number") return String(result);
  return Array.isArray(result) ? result.map((x) => str(x)).join(",") : String(result);
}

export type ViewFn = (ctx: ViewContext) => ViewResult;

export interface HelpRulesApi {
  menuHelpContentBytes(fmt: RenderFormat): string;
  ruleHelpTextBytes(fmt: RenderFormat): string;
  ruleBasedHelpForCard(fmt: RenderFormat, card: RenderCard): string;
}

export type NestMode = "normal" | "template" | "edit" | "compact";

const COMPACT_TRUE_VIEWS: ReadonlyMap<string, true | string> = new Map([
  ["name", true],
  ["key", true],
  ["linkname", true],
  ["url", true],
  ["id_url", true],
  ["url_link", true],
  ["link", true],
  ["nav_link", true],
  ["codename", true],
  ["id", true],
  ["type", true],
  ["created_at", true],
  ["updated_at", true],
  ["acted_at", true],
  ["core", true],
  ["one_line_content", true],
  ["blank", true],
  ["title", true],
  ["title_link", true],
  ["title_no_link", true],
  ["compact_missing", true],
  ["followed", true],
  ["follower", true],
  ["unfollow_url", true],
]);

const MAX_NEST_CHAR_COUNT = 200;

const DEFAULT_NEST_MODE: NestMode = "normal";

let raiseAllRenderingErrors = true;

export function setRaiseAllRenderingErrors(value: boolean): void {
  raiseAllRenderingErrors = value;
}

export function allRenderingErrorsRaise(): boolean {
  return raiseAllRenderingErrors;
}

export interface RenderFormatOptions {
  parent?: RenderFormat;
  main?: boolean;
  focal?: boolean;
  errorStatus?: number;
  nestQuietErrors?: boolean;
  maxDepth?: number;
  formatName?: string;
  contextCard?: RenderCard;
  isViewLaneRoot?: boolean;
  showLayout?: boolean;
}

export const RUBY_MAX_DEPTH = 20;

export class TooDeepError extends Error {
  constructor() {
    super("Man, you're too deep.  (Too many levels of nests at a time)");
    this.name = "TooDeepError";
  }
}

const VIRTUAL_SET_CODENAMES: ReadonlySet<string> = new Set([
  "right",
  "self",
  "type",
  "type_plus_right",
]);

export class RenderFormat {
  readonly card: RenderCard;
  readonly engine: RenderEngineLike;
  readonly parent: RenderFormat | undefined;
  readonly isMain: boolean;
  readonly isFocal: boolean;
  readonly maxDepth: number;
  readonly nestQuietErrors: boolean;
  contextCard: RenderCard | undefined;
  rendered: string | undefined;
  voo: Voo | undefined;
  private depthCache: number | undefined;
  private initialContextNamesCache: string[] | undefined;
  private contextNamesCache: string[] | undefined;
  private ownNestMode: NestMode | undefined;
  private charCount: number | undefined;
  readonly isViewLaneRoot: boolean;
  readonly showLayout: boolean;

  constructor(
    card: RenderCard,
    engine: RenderEngineLike,
    opts: RenderFormatOptions = {},
  ) {
    this.card = card;
    this.engine = engine;
    this.parent = opts.parent;
    this.formatName = opts.formatName ?? opts.parent?.formatName ?? "html";
    const htmlFormat = ["html", "rss", "email_html"].includes(this.formatName);
    this.isMain = opts.main ?? (!htmlFormat && this.parent === undefined);
    this.isFocal = opts.focal ?? (htmlFormat ? this.isMain : this.parent === undefined);
    this.nestQuietErrors = opts.nestQuietErrors ?? false;
    this.maxDepth = opts.maxDepth ?? RUBY_MAX_DEPTH;
    this.contextCard = opts.contextCard;
    this.isViewLaneRoot = opts.isViewLaneRoot ?? false;
    this.showLayout = opts.showLayout ?? opts.parent?.showLayout ?? true;
    this.localErrorStatus = opts.errorStatus;
    if (opts.errorStatus !== undefined && this.parent === undefined) this.engine.pageErrorStatus = opts.errorStatus;
  }

  readonly formatName: string;
  private localErrorStatus: number | undefined;

  get errorStatus(): number | undefined {
    return this.localErrorStatus;
  }

  set errorStatus(value: number | undefined) {
    this.localErrorStatus = value;
    if (this.parent === undefined) this.engine.pageErrorStatus = value;
  }

  setRootErrorStatus(value: number | undefined): void {
    let root: RenderFormat = this;
    while (root.parent !== undefined) root = root.parent;
    root.errorStatus = value;
  }

  withFormatName(formatName: string): RenderFormat {
    return new RenderFormat(this.card, this.engine, {
      maxDepth: this.maxDepth,
      nestQuietErrors: this.nestQuietErrors,
      formatName,
      showLayout: this.showLayout,
      contextCard: this.contextCard,
    });
  }

  get nestMode(): NestMode {
    if (this.ownNestMode !== undefined) return this.ownNestMode;
    return this.parent?.nestMode ?? DEFAULT_NEST_MODE;
  }

  withNestMode<T>(mode: NestMode, body: () => T): T {
    const previous = this.ownNestMode;
    this.ownNestMode = mode;
    try {
      return body();
    } finally {
      this.ownNestMode = previous;
    }
  }

  modalNestView(view: string, nestCard: RenderCard = this.card): string {
    if (this.nestMode === "template") return "template_nest";
    if (this.nestMode === "edit") return this.viewInEditMode(view, nestCard);
    if (this.nestMode === "compact") return this.viewInCompactMode(view, nestCard);
    return view;
  }

  private viewInEditMode(view: string, nestCard: RenderCard): string {
    return this.hideViewInEditMode(view, nestCard) ? "blank" : "edit_in_form";
  }

  private hideViewInEditMode(view: string, nestCard: RenderCard): boolean {
    if (viewPermissionChecks(view, this.engine.viewPermissionSettingForCard?.(nestCard, view, this.formatName)) === null) return true;
    const structure = this.engine.structureRuleForSync?.({
      name: nestCard.name.s,
      id: nestCard.id,
      typeId: nestCard.typeId,
      typeName: nestCard.typeName,
      isNew: nestCard.record.isNew === true,
    });
    if (structure !== undefined) return true;
    return nestCard.name.s === "" || nestCard.key === "";
  }

  private viewInCompactMode(view: string, nestCard: RenderCard): string {
    const configured = this.configuredViewInCompactMode(view);
    if (configured !== undefined) return configured;
    return nestCard.unknown ? "compact_missing" : "one_line_content";
  }

  private configuredViewInCompactMode(view: string): string | undefined {
    const compactConfig = COMPACT_TRUE_VIEWS.get(view);
    if (compactConfig === true) return view;
    return compactConfig;
  }

  get depth(): number {
    if (this.depthCache === undefined) {
      this.depthCache = this.parent === undefined ? 0 : this.parent.depth + 1;
    }
    return this.depthCache;
  }

  subformatView(view: string, opts: Record<string, unknown> = {}): string {
    const sub = new RenderFormat(this.card, this.engine, {
      parent: this,
      maxDepth: this.maxDepth,
      nestQuietErrors: this.nestQuietErrors,
    });
    return str(sub.renderView(view, opts));
  }

  get initialContextNames(): readonly string[] {
    if (this.initialContextNamesCache === undefined) {
      const inherited = this.parent?.contextNames ?? [];
      const partKeys = this.card.name.partKeys;
      this.initialContextNamesCache = inherited.filter((key) => partKeys.includes(key));
    }
    return this.initialContextNamesCache;
  }

  get contextNames(): readonly string[] {
    if (this.contextNamesCache === undefined) {
      this.contextNamesCache = [...this.initialContextNames];
    }
    return this.contextNamesCache;
  }

  addNameContext(): void {
    const list = this.contextNamesCache ?? [...this.initialContextNames];
    this.contextNamesCache = list;
    for (const key of this.card.name.partKeys) {
      if (!list.includes(key)) list.push(key);
    }
  }

  slotNameContextKeys(): readonly string[] {
    return this.initialContextNames;
  }

  get contextFormat(): RenderFormat {
    return this.parent ?? this;
  }

  uniqueId(): string {
    return `${this.card.name.safeKey}-${this.nextIdNumber()}`;
  }

  nextIdNumber(): number {
    let root: RenderFormat = this;
    while (root.parent !== undefined) root = root.parent;
    root.idCounter = (root.idCounter ?? 0) + 1;
    return root.idCounter;
  }

  exportRootIdCounter(): number | undefined {
    let root: RenderFormat = this;
    while (root.parent !== undefined) root = root.parent;
    return root.idCounter;
  }

  seedRootIdCounter(value: number | undefined): void {
    let root: RenderFormat = this;
    while (root.parent !== undefined) root = root.parent;
    if (value !== undefined) root.idCounter = value;
  }

  private cardReadable(): boolean {
    if (this.card.pointerItemReadVerdict === true) return true;
    return !this.engine.isDenied(this.card);
  }

  private idCounter: number | undefined;

  contentBody = false;

  renderView(
    view: string,
    opts: Record<string, unknown> = {},
    optional: unknown = "show",
    viewLaneRoot = false,
  ): ViewResult {
    const normalized = normalizeView(view);
    let effective =
      this.card.unknown === true && !this.unknownGateSkip(normalized, opts)
        ? this.viewForUnknown(normalized, opts)
        : normalized;
    const vooOpts: Record<string, unknown> = { ...opts };
    if (this.isMain) vooOpts["main"] = true;
    const voo = new Voo(this.voo ?? undefined, normalized, vooOpts, viewLaneRoot);
    const previous = this.voo;
    this.voo = voo;
    let refusal: ReturnType<typeof viewPermissionDecision>;
    try {
      voo.processVisibility(optional);
      if (this.card.unknown !== true) {
        refusal = viewPermissionDecision(normalized, {...this.permissionGateInput(normalized), renderOpts: opts});
        if (refusal !== undefined) {
          this.noteFocalDenial(voo);
          this.deniedPermissionTask = refusal.task;
          effective = this.permissionDenialView(normalized) ?? "denial";
        }
      } else if (
        effective === normalized &&
        viewPermissionChecks(normalized, this.declaredPermission(normalized)) !== null &&
        !renderOptSkipPerms(opts)
      ) {
        refusal = viewPermissionDecision(normalized, {...this.permissionGateInput(normalized), renderOpts: opts});
        if (refusal !== undefined) {
          this.noteFocalDenial(voo);
          this.deniedPermissionTask = refusal.task;
          effective = this.permissionDenialView(normalized) ?? "denial";
        }
      }
      if (refusal === undefined && effective === "not_found" && this.formatName === "html" && this.card.unknown === true) {
        return this.notFoundFrameHtml(voo);
      }
      this.runBeforeHook(normalized, voo);
      const viewFn = this.engine.resolveView(this.card, effective, this.formatName);
      try {
        if (viewFn === undefined) {
          if (refusal !== undefined && effective === "denial") return this.defaultPermissionDenial(voo);
          if (refusal !== undefined && effective === "blank") return "";
          throw new UnsupportedViewError(effective, this.card.name.s);
        }
        return viewFn({ fmt: this, voo });
      } catch (error) {
        if (this.formatName !== "html" && this.formatName !== "rss" && this.formatName !== "email_html") throw error;
        if (!viewLaneRoot || this.isFocal || allRenderingErrorsRaise()) throw error;
        return quietRenderError(error, this.card, effective, this);
      }
    } finally {
      this.voo = previous;
    }
  }

  private noteFocalDenial(voo: Voo): void {
    if (this.isFocal && voo.parent === undefined) {
      this.setRootErrorStatus(403);
    }
  }

  selfSetTitleOverride(): string | undefined {
    return SELF_SET_TITLE_OVERRIDES.get(this.card.record.codename ?? "");
  }

  private deniedPermissionTask: CrudTask | false | undefined;

  permissionDenialHtml(voo: Voo): string {
    return this.isFocal ? this.mainLoudDenialHtml(voo, this.deniedPermissionTask ?? false)
      : quietDenial(this.deniedPermissionTask === undefined ? "" : String(this.deniedPermissionTask));
  }

  basePermissionDenial(): string {
    if (!this.isFocal) return "";
    const message = t("format_denial", {default: "Permission Denied"});
    if (typeof message !== "string") throw new TypeError("format_denial translation must be a string");
    return message;
  }

  jsonErrorResult(): ViewRawHash {
    const errors = this.engine.attachedErrorsByKey?.get(this.card.key) ?? [];
    return {error_status: this.errorStatus ?? null,
      errors: Object.fromEntries(errors.map(error => [error.attribute, error.message]))};
  }

  addError(attribute: string, message: string): void {
    const errors = this.engine.attachedErrorsByKey ??= new Map();
    const bag = errors.get(this.card.key) ?? [];
    bag.push({attribute, message});
    errors.set(this.card.key, bag);
  }

  private defaultPermissionDenial(voo: Voo): ViewResult {
    if (["html", "rss", "email_html"].includes(this.formatName)) return this.permissionDenialHtml(voo);
    if (this.formatName === "json") return this.jsonErrorResult();
    if (this.formatName === "jsonld") return JSON.stringify({
      "@context": "https://www.w3.org/ns/hydra/core#",
      "@type": "hydra:Error", "hydra:title": "403 | Permission denied",
    });
    return this.basePermissionDenial();
  }

  private declaredPermission(view: string): ViewPermissionDirective | undefined {
    return this.engine.viewPermissionSettingForCard?.(this.card, view, this.formatName);
  }

  private permissionDenialView(view: string): string | undefined {
    return this.engine.viewDenialSettingForCard?.(this.card, view, this.formatName) ?? viewDenialView(view);
  }

  private permissionGateInput(view: string): ViewPermsGateInput {
    return {declaredPerms: this.declaredPermission(view), renderOpts: this.voo?.opts ?? {},
      declaredDenial: this.permissionDenialView(view), formatName: this.formatName,
      isNewCard: this.card.id === undefined,
      taskAllowed: task => task === "read" ? this.cardReadable() : this.engine.taskAllowed?.(this.card, task),
      predicateAllowed: predicate => this.permissionPredicateAllowed(predicate)};
  }

  callFormatMethod(method: string, ...args: unknown[]): ReturnType<ModFormatMethodFn> {
    const fn = this.engine.resolveFormatMethod?.(this.card, method, this.formatName);
    if (fn === undefined) throw new NoMethodError(`Format method is not implemented: ${method}`);
    if (this.voo === null || this.voo === undefined) throw Error(`Format method requires an active view: ${method}`);
    const result = fn({fmt: this, voo: this.voo}, ...args);
    if (result !== null && (typeof result === "object" || typeof result === "function")
      && typeof (result as {then?: unknown}).then === "function") {
      void Promise.resolve(result).catch(error => console.error(`[format-method] asynchronous ${method} rejected`, error));
      throw Error(`Format methods must return synchronously: ${method}`);
    }
    return result;
  }

  private permissionPredicateAllowed(predicate: string): boolean | undefined {
    if (this.engine.resolveFormatMethod?.(this.card, predicate, this.formatName) !== undefined) {
      const value = this.callFormatMethod(predicate);
      return value !== false && value !== null && value !== undefined;
    }
    return predicate === "can_configure?" ? this.engine.canConfigure?.(this.card) : undefined;
  }

  mainLoudDenialHtml(voo: Voo, deniedTask: CrudTask | false = "read"): string {
    voo.hide("menu");
    voo.hide("help");
    const card = this.card;
    const heading = this.isMain ? "h1" : "h2";
    const header =
      `<div class="d0-card-header card-header">` +
      `<${heading} class="d0-card-header-title">` +
      `${this.renderView("title")}</${heading}></div>`;
    const message = this.loudDenialMessageHtml(deniedTask);
    const bodyClasses = this.contentBody ? `d0-card-body d0-card-content ${card.setKeys}` : "d0-card-body";
    const body = `<div class="${bodyClasses} card-body card-text"><h1>Sorry!</h1>\n${message}</div>`;
    const frame = `<div class="d0-card-frame card">${header}\n\n${body}</div>`;
    const attrs = emitAttrs({
      id: `${card.name.safeKey}-denial-view`,
      class: voo.classy(["card-slot", "denial-view", card.setKeys]),
      "data-card-id": card.id === undefined ? undefined : String(card.id),
      "data-card-name": card.id === undefined && card.name.isCompound ? card.name.urlKey : card.name.s,
      "data-card-type-id": card.typeId === undefined ? undefined : String(card.typeId),
      "data-card-type-name": card.typeName,
      "data-card-link-name": this.urlKey(),
      "data-slot-id": newSlotId(),
      "data-slot": slotOptionsJson(voo.slotOptions()),
    });
    return `<div${attrs}>${frame}</div>`;
  }

  private notFoundFrameHtml(voo: Voo): string {
    voo.hide("menu");
    voo.hide("help");
    const card = this.card;
    const title = "Not Found";
    const heading = this.isMain ? "h1" : "h2";
    const header =
      `<div class="d0-card-header card-header">` +
      `<${heading} class="d0-card-header-title">` +
      `<span class="card-title" title="${title}">${title}</span></${heading}></div>`;
    const attachedErrors = this.engine.attachedErrorsByKey?.get(card.key);
    const errors = attachedErrors !== undefined && attachedErrors.length > 0
      ? `<div class="alert alert-warning alert-dismissible " role="alert">` +
        `<button type="button" data-bs-dismiss="alert" class="btn-close" aria-label="Close"></button>\n` +
        attachedErrors.map(error => error.attribute === "abort" ? h(error.message)
          : `<p><strong>${h(error.attribute.toUpperCase())}:</strong> ${h(error.message)}</p>`).join("<hr>") +
        `</div>`
      : card.name.s === ""
        ? `<h2>\nCould not find\nthat\n</h2>\n`
        : `<h2>\nCould not find\n<em>\n${h(card.name.s)}\n</em>\n</h2>\n`;
    const parts = [errors];
    if (this.engine.pageSession?.signedIn !== true) {
      parts.push(
        `<div>Please <a class="signin-link known-card" href="/*signin/titled">sign in</a> or ` +
          `<a class="signup-link known-card" href="/new/Sign_up">sign up</a> to create it.</div>`,
      );
    }
    const body = `<div class="d0-card-body card-body card-text">${parts.join("\n")}</div>`;
    const attrs = emitAttrs({
      id: `${card.name.safeKey}-not_found-view`,
      class: voo.classy(["card-slot", "not_found-view", card.setKeys]),
      "data-card-id": card.id === undefined ? undefined : String(card.id),
      "data-card-name": card.id === undefined && card.name.isCompound ? card.name.urlKey : card.name.s,
      "data-card-type-id": card.typeId === undefined ? undefined : String(card.typeId),
      "data-card-type-name": card.typeName,
      "data-card-link-name": this.urlKey(),
      "data-slot-id": newSlotId(),
      "data-slot": slotOptionsJson(voo.slotOptions()),
    });
    return `<div${attrs}><div class="d0-card-frame card">${header}\n\n${body}</div></div>`;
  }

  private loudDenialMessageHtml(deniedTask: string | false): string {
    if (this.engine.pageSession?.signedIn === true) {
      const phrase = this.engine.pageLoudDenialTaskPhrase;
      if (phrase !== undefined) return `<div>You need permission to ${phrase}.</div>`;
      return deniedTask === false ? "<div>You need permission to do that.</div>" : `<div>You need permission to ${deniedTask} this.</div>`;
    }
    const phrase = this.engine.pageLoudDenialTaskPhrase;
    if (phrase !== undefined) {
      return (
        `<div><div>Please <a class="signin-link known-card" href="/*signin/titled">sign in</a> or ` +
        `<a class="signup-link known-card" href="/new/Sign_up">sign up</a> to ${phrase}.</div></div>`
      );
    }
    const taskPhrase = deniedTask === false ? "do that" : `${deniedTask} this`;
    return (
      `<div><div>Please <a class="signin-link known-card" href="/*signin/titled">sign in</a> or ` +
      `<a class="signup-link known-card" href="/new/Sign_up">sign up</a> to ${taskPhrase}.</div></div>`
    );
  }

  private viewForUnknown(requested: string, opts: Record<string, unknown>): string {
    if (viewPermissionChecks(requested, this.declaredPermission(requested)) === null) return requested;
    const fromChain = this.engine.viewUnknownSettingForCard?.(this.card, requested, this.formatName);
    const loaderBound = this.engine.modDeckBound?.() === true;
    const configured =
      fromChain !== undefined
        ? fromChain
        : loaderBound
          ? compiledUnknownSettingForCard(this.card, requested, true)
          : compiledUnknownSettingForCard(this.card, requested);
    if (configured === true) return requested;
    if (this.isMain && this.voo === undefined) {
      const canCreate = ["html", "rss", "email_html"].includes(this.formatName) &&
        this.engine.taskAllowed?.(this.card, "create") === true;
      this.setRootErrorStatus(canCreate ? 200 : 404);
      return canCreate ? "new" : "not_found";
    }
    const nestOpt = opts["unknown"];
    const effective = nestOpt !== undefined ? nestOpt : configured;
    if (effective === undefined || effective === false || effective === "false") {
      return "unknown";
    }
    return String(effective);
  }

  private runBeforeHook(view: string, voo: Voo): void {
    const method = `_before_${view}`;
    if (this.engine.resolveFormatMethod?.(this.card, method, this.formatName) !== undefined) {
      this.callFormatMethod(method);
      return;
    }
    if (view === "content") {
      voo.classUp("card-slot", "d0-card-content");
    } else if (view === "content_panel") {
      voo.classUp("card-slot", "d0-card-content");
      voo.classUp("card-slot", "card");
    } else if (view === "content_with_title") {
      voo.classUp("card-slot", "d0-card-content");
    } else if (view === "conflict") {
      voo.classUp("card-slot", "error-view");
    } else if (view === "bar") {
      if (this.engine.cardMatchesRuleSet?.(this.card) ?? false) {
        const categories = this.ruleSetCategories(this.rightPartCodenameForRule(), this.card);
        const classExtra = ["_rule-item", ...categories.map((c) => `_category-${c}`)].join(" ");
        voo.classUp("card-slot", classExtra);
      }
      if (
        this.cardTypeCodename === "search_type" ||
        this.cardTypeCodename === "set" ||
        this.card.typeName === "Search"
      ) {
        voo.hide("one_line_content");
      }
    }
  }

  private get cardTypeCodename(): string | undefined {
    const id = this.card.record.typeId;
    if (id === undefined) return undefined;
    return this.engine.peekCodenameById?.(id);
  }

  private cardIsRule(): boolean {
    const card = this.card;
    if (!card.name.isCompound) return false;
    if (this.engine === undefined) return false;
    return this.engine.cardIsRule?.(card) ?? false;
  }

  private rightPartCodenameForRule(): string | undefined {
    const card = this.card;
    if (!card.name.isCompound) return undefined;
    const rightKey = card.name.rightName?.key;
    if (rightKey === undefined) return undefined;
    const bare = rightKey.startsWith("*") ? rightKey.slice(1) : rightKey;
    const right =
      this.engine.fetchRenderCard(rightKey) ??
      this.engine.fetchRenderCard(bare);
    if (right === undefined) return undefined;
    return right.record.codename ?? bare;
  }

  private ruleSetCategories(settingCodename: string | undefined, ruleCard: RenderCard): string[] {
    if (settingCodename === undefined) return [];
    const result = ["all"];
    if (FIELD_SETTINGS.has(settingCodename)) result.push("field");
    if (this.recentCategoryApplies(settingCodename, ruleCard)) result.push("recent");
    if (COMMON_SETTINGS.has(settingCodename)) result.push("common");
    return result;
  }

  private recentSettingCodenames(): Set<string> {
    const recentCard = this.engine.fetchRenderCard("*recent settings");
    const content =
      recentCard === undefined || recentCard.unknown === true
        ? undefined
        : recentCard.record.dbContent;
    const items = new Set<string>();
    for (const line of (content ?? "").split("\n")) {
      const item = line.trim();
      if (item === "") continue;
      items.add(item.replace(/^\*/, "").toLowerCase().replace(/ +/g, "_"));
    }
    return items;
  }

  private recentCategoryApplies(settingCodename: string, ruleCard: RenderCard): boolean {
    if (!this.recentSettingCodenames().has(settingCodename)) return false;
    if (!REGISTERED_SETTING_CODENAMES.has(settingCodename)) return false;
    const restrictedTo = RESTRICTED_TO_TYPE.get(settingCodename);
    if (restrictedTo === undefined) return true;
    const prototypeCode = this.engine.ruleSetPrototypeTypeCode?.(ruleCard);
    return prototypeCode !== undefined && restrictedTo.has(prototypeCode);
  }

  nest(nest: ParsedNest, authoredText?: string): string {
    if (nest.comment !== undefined) return nest.comment;
    if (this.nestInvisible()) return "";
    const rawNestName = nest.name.trim();
    const contextTarget =
      rawNestName === "_" || rawNestName === "_self"
        ? (this.contextCard ?? this.card)
        : undefined;
    const targetName = contextTarget !== undefined ? contextTarget.name.s : this.resolveNestName(nest.name);
    const isBlankReference = targetName.trim() === "";
    const target = isBlankReference
      ? undefined
      : (contextTarget ?? this.engine.fetchRenderCard(targetName));
    const card =
      target ??
      this.buildUnknownNestCard(
        targetName,
        this.engine,
        this.card.typeName,
        nest.options.extra["type"],
      );
    const nestTypeOpt = nest.options.extra["type"];
    const effectiveCard =
      target !== undefined &&
      target.id === undefined &&
      target.record.isNew === true &&
      !(this.engine.cardMatchesRuleSet?.(target) ?? false)
        ? this.withNewCardContext(target, typeof nestTypeOpt === "string" ? nestTypeOpt : undefined)
        : card;
    const requestedView = normalizeView(nest.options.view ?? this.implicitNestView());
    const view = this.modalNestView(requestedView, effectiveCard);
    if (view === "blank") return "";
    if (ENGINE_NEST_TRACE) {
      console.log("ENGINE-NEST", JSON.stringify({ requested: requestedView, view, card: effectiveCard?.name?.s, unknown: effectiveCard?.unknown, nestName: nest.name }));
    }
    const viewOpts: Record<string, unknown> = {
      nest_name: DeckoName.parse(nest.name).s,
      ...(nest.chunkNestSyntax !== undefined
        ? { nest_syntax: nest.chunkNestSyntax }
        : {}),
      ...(requestedView === "closed" || requestedView === "edit"
        ? { home_view: "open" }
        : { home_view: requestedView }),
      ...this.nestOptionEntries(nest.options),
    };
    const sub = new RenderFormat(effectiveCard, this.engine, {
      parent: this,
      maxDepth: this.maxDepth,
      nestQuietErrors: this.nestQuietErrors,
    });
    if (sub.depth >= this.maxDepth) {
      throw new TooDeepError();
    }
    let rendered: string;
    try {
      const raw = sub.renderView(
        view,
        authoredText !== undefined ? { ...viewOpts, authoredNestText: authoredText } : viewOpts,
      );
      if (raw === null && authoredText !== undefined) {
        return authoredText;
      }
      rendered = str(raw);
    } catch (error) {
      if (!this.nestQuietErrors) throw error;
      rendered = quietRenderError(error, card, view, this);
    }
    return this.countNestChars(rendered);
  }

  renderDelegated(
    view: string,
    opts: Record<string, unknown> = {},
    optional: unknown = "show",
  ): string {
    try {
      return str(this.renderView(view, opts, optional));
    } catch (error) {
      const focal =
        this.formatName === "html"
          ? this.showLayout
            ? this.isMain
            : this.depth === 0
          : this.depth === 0;
      if (focal || allRenderingErrorsRaise()) throw error;
      return quietRenderError(error, this.card, view, this);
    }
  }

  private nestInvisible(): boolean {
    return (
      this.nestMode === "compact" &&
      this.charCount !== undefined &&
      this.charCount > MAX_NEST_CHAR_COUNT
    );
  }

  private countNestChars(result: string): string {
    if (this.nestMode !== "compact" || !result) return result;
    this.charCount = (this.charCount ?? 0) + result.length;
    return result;
  }

  private unknownGateSkip(view: string, opts: Record<string, unknown>): boolean {
    if (renderOptSkipPerms(opts)) return true;
    return viewPermissionChecks(view, this.declaredPermission(view)) === null;
  }

  private resolveExplicitTypeCard(name: string): RenderCard | undefined {
    const warmed = this.engine.fetchRenderCard(name);
    if (warmed !== undefined && warmed.id !== undefined) return warmed;
    const id = this.engine.peekIdByCodename?.(name);
    if (id === undefined) return undefined;
    const typeName = this.engine.peekRegisteredNameForId?.(id);
    const record = {
      id,
      name: typeName ?? name,
      codename: name,
      typeId: this.engine.peekIdByCodename?.("cardtype"),
    };
    return {
      record: record as never,
      name: (typeName ?? name) as never,
      key: name,
      typeName: typeName ?? name,
      typeId: id,
      typeCode: name,
      id,
      dbContent: "",
      setKeys: "",
    } as unknown as RenderCard;
  }

  private withNewCardContext(target: RenderCard, nestTypeOpt?: string): RenderCard {
    const explicitType =
      nestTypeOpt !== undefined ? this.resolveExplicitTypeCard(nestTypeOpt) : undefined;
    const typeId = explicitType !== undefined && explicitType.id !== undefined ? explicitType.id : target.typeId;
    const typeName =
      explicitType !== undefined && explicitType.id !== undefined
        ? explicitType.name.s
        : target.typeName;
    const typeCode =
      explicitType !== undefined && explicitType.id !== undefined
        ? (explicitType.record.codename ?? undefined)
        : target.typeCode;
    const toggleTyped = typeCode === "toggle" || typeName === "Toggle";
    const rebuiltSetKeys = safeSetKeys({
        name: target.name,
        typeId,
        typeName,
        leftTypeName: this.leftTypeNameFor(target.name),
        isNew: true,
      });
    const out = {
      ...target,
      dbContent: toggleTyped
        ? (this.engine.newCardDefaultContent?.(target.name) ?? "")
        : (target.dbContent ?? ""),
      typeId,
      typeName,
      typeCode,
      setKeys: rebuiltSetKeys,
    };
    return out;
  }

  private virtualSearchCodenameResolver():
    | ((codename: string) => string | undefined)
    | undefined {
    return virtualSearchCodenameResolverFor(this.engine);
  }

  private leftTypeNameFor(name: DeckoName): string | undefined {
    if (!name.isCompound) return this.card.typeName;
    const leftName = name.leftName;
    if (leftName === undefined) return this.card.typeName;
    const left = this.engine.fetchRenderCard(leftName.s);
    if (left !== undefined && left.typeName !== undefined) return left.typeName;
    const virtualLeftType = this.engine.virtualLeftTypeName?.(leftName);
    if (virtualLeftType !== undefined) return virtualLeftType;
    const quickType =
      this.engine.newCardDefaultType?.(leftName) ?? undefined;
    return quickType !== undefined ? quickType.typeName : "RichText";
  }

  newCardFor(targetName: string): RenderCard {
    return this.buildUnknownNestCard(targetName, this.engine);
  }

  unknownChildCard(targetName: string): RenderCard {
    return this.buildUnknownNestCard(targetName, this.engine, this.card.typeName, undefined);
  }

  private buildUnknownNestCard(
    targetName: string,
    engine: RenderEngineLike,
    leftTypeName?: string,
    nestTypeOpt?: string,
  ): RenderCard {
    const name = DeckoName.parse(targetName);
    const virtualSearchCql = virtualSearchCqlFor(name, this.virtualSearchCodenameResolver());
    if (virtualSearchCql !== undefined) {
      const searchTypeId = engine.peekIdByCodename?.("search_type");
      const searchTypeName =
        searchTypeId !== undefined
          ? engine.peekRegisteredNameForId?.(searchTypeId)
          : undefined;
      const record: CardRecord = {
        id: undefined,
        codename: undefined,
        leftId: undefined,
        rightId: undefined,
        typeId: searchTypeId,
        dbContent: virtualSearchCql,
        trash: false,
        creatorId: undefined,
        updaterId: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        currentRevisionId: undefined,
        readRuleClass: undefined,
        readRuleId: undefined,
        referencesExpired: undefined,
        name,
        key: name.key,
        isNew: true,
        fromTrash: false,
        uncacheable: false,
      };
      return {
        record,
        name,
        key: name.key,
        typeName: searchTypeName,
        typeId: searchTypeId,
        typeCode: undefined,
        id: undefined,
        dbContent: virtualSearchCql,
        setKeys: safeSetKeys({
          name,
          typeId: searchTypeId,
          typeName: searchTypeName,
          leftTypeName: this.leftTypeNameFor(name),
          isNew: true,
        }),
      };
    }
    const explicitType =
      nestTypeOpt !== undefined ? engine.fetchRenderCard(nestTypeOpt) : undefined;
    const defaulted =
      explicitType !== undefined && explicitType.id !== undefined
        ? { typeId: explicitType.id, typeName: explicitType.name.s }
        :
          engine.newCardDefaultType?.(name, this.leftTypeNameFor(name));
    const defaultContent = engine.newCardDefaultContent?.(name);
    const record: CardRecord = {
      id: undefined,
      codename: undefined,
      leftId: undefined,
      rightId: undefined,
      typeId: defaulted?.typeId,
      dbContent: undefined,
      trash: false,
      creatorId: undefined,
      updaterId: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      currentRevisionId: undefined,
      readRuleClass: undefined,
      readRuleId: undefined,
      referencesExpired: undefined,
      name,
      key: name.key,
      isNew: true,
      fromTrash: false,
      uncacheable: false,
    };
    engine.reportUnknownCard?.(name.key);
    const setKeys = safeSetKeys({
      name,
      typeId: defaulted?.typeId,
      typeName: defaulted?.typeName,
      leftTypeName: this.leftTypeNameFor(name),
      isNew: true,
    });
    const rightName = name.rightName;
    const rightCard = rightName === undefined ? undefined : engine.fetchRenderCard(rightName.s);
    const rightCodename = rightCard?.record.codename;
    const virtualSet = rightCodename !== undefined && VIRTUAL_SET_CODENAMES.has(rightCodename);
    const typeCode =
      defaulted?.typeId !== undefined
        ? engine.peekCodenameById?.(defaulted.typeId)
        : undefined;
    if (virtualSet) {
      return {
        record,
        name,
        key: name.key,
        typeName: defaulted?.typeName,
        typeId: defaulted?.typeId,
        typeCode,
        id: undefined,
        dbContent: defaultContent ?? "",
        setKeys,
      };
    }
    return {
      record,
      name,
      key: name.key,
      typeName: defaulted?.typeName,
      typeId: defaulted?.typeId,
      typeCode,
      id: undefined,
      dbContent: defaultContent ?? "",
      setKeys,
      unknown: true,
    };
  }

  private nestOptionEntries(options: NestOptions): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (options.title !== undefined) out["title"] = options.title;
    if (options.size !== undefined) out["size"] = options.size;
    if (options.show !== undefined) out["show"] = options.show;
    if (options.hide !== undefined) out["hide"] = options.hide;
    if (options.items !== undefined) out["items"] = options.items;
    if (options.extra["unknown"] !== undefined) out["unknown"] = options.extra["unknown"];
    if (options.extra["type"] !== undefined) out["type"] = options.extra["type"];
    if (options.extra["filter"] !== undefined) out["filter"] = options.extra["filter"];
    for (const [key, value] of Object.entries(options.extra)) {
      if (key in out || value === undefined) continue;
      if (key === "wrap") {
        out["wrap"] =
          typeof value === "string"
            ? (value === "" ? [] : value.split(",").map((piece) => piece.trim()))
            : value;
        continue;
      }
      out[key] = value;
    }
    return out;
  }

  defaultNestView(): string {
    return this.engine.defaultHtmlViewConfig?.() ?? "titled";
  }

  private implicitNestView(): string {
    const items = this.voo?.liveItems ?? this.voo?.opts["items"];
    if (items !== null && typeof items === "object") {
      const view = (items as Record<string, unknown>)["view"];
      if (typeof view === "string" && view !== "") return view;
    }
    return this.defaultNestView();
  }

  envOrigin(): string {
    return this.engine.envOriginConfig?.() ?? NO_REQUEST_ORIGIN;
  }

  cardUrl(rel: string): string {
    if (/^https?:/.test(rel)) return rel;
    return `${this.envOrigin()}${cardPath(rel)}`;
  }

  nestRecord(
    target: RenderCard,
    view: string,
    opts: Record<string, unknown> = {},
    nest: { pointerListItem?: boolean } = {},
  ): string {
    const shaped =
      target.id === undefined &&
      target.record.isNew === true &&
      !(this.engine.cardMatchesRuleSet?.(target) ?? false)
        ? this.withNewCardContext(target)
        : target;
    const viewOpts: Record<string, unknown> = {
      nest_name: shaped.name.s,
      ...(view === "closed" || view === "edit" ? { home_view: "open" } : { home_view: view }),
      ...opts,
    };
    const sub = new RenderFormat(shaped, this.engine, {
      parent: this,
      maxDepth: this.maxDepth,
      nestQuietErrors: this.nestQuietErrors,
    });
    if (sub.depth >= this.maxDepth) {
      throw new TooDeepError();
    }
    return str(sub.renderView(view, viewOpts));
  }

  private resolveNestName(raw: string): string {
    const name = DeckoName.parse(raw);
    if (name.isAbsolute) return name.s;
    const context = this.card.name;
    return name.absoluteName(context).s;
  }

  private contentNest(piece: { text: string; nest?: ParsedNest }): string {
    if (this.isMainNest(piece)) return this.mainNest(piece);
    return this.nest(piece.nest as ParsedNest, piece.text);
  }

  processContent(
    content: string,
    chunkList?: "default" | "references" | "nest_only",
  ): string {
    const list =
      chunkList ??
      rubyChunkListForCardType(this.card.typeCode, this.card.typeName);
    const linkPass = (text: string): string =>
      list === "default"
        ? expandContentLinks(text, this.engine, this.card.name, this.contextNames)
        : list === "references"
          ? expandWikiLinks(text, this.engine, this.card.name, this.contextNames)
          : text;
    const pieces = scanNests(content);
    let out = "";
    let i = 0;
    while (i < pieces.length) {
      const piece = pieces[i]!;
      if (piece.kind === "escaped") {
        out +=
          list === "nest_only"
            ? "\\" + this.processContent(piece.text.slice(1), list)
            : interpretEscapedLiteral(piece.text, (literal) =>
                escapeLiteralForCard(this.card, literal),
              );
        i += 1;
        continue;
      }
      if (piece.kind === "nest") {
        if (piece.nest !== undefined) {
          out += this.contentNest(piece);
        }
        i += 1;
        continue;
      }
      const opener = matchLinkWrappedNestOpener(piece.text);
      if (opener === undefined) {
        const targetOpener = matchLinkTargetNestOpener(piece.text);
        if (targetOpener === undefined) {
          out += linkPass(piece.text);
          i += 1;
          continue;
        }
        const spanned = this.spanLinkTargetOverNest(
          i,
          targetOpener,
          pieces,
          linkPass,
        );
        out += spanned.out;
        i = spanned.next;
        continue;
      }
      out += linkPass(opener.prefix);
      let label = "";
      let sawNest = false;
      let tail: string | undefined;
      let j = i + 1;
      while (j < pieces.length) {
        const inner = pieces[j]!;
        if (inner.kind === "nest") {
          sawNest = true;
          if (inner.nest !== undefined) label += this.contentNest(inner);
          j += 1;
          continue;
        }
        const closeAt = inner.text.indexOf("]]");
        if (closeAt === -1) {
          label += linkPass(inner.text);
          j += 1;
          continue;
        }
        label += expandWikiLinks(inner.text.slice(0, closeAt));
        tail = inner.text.slice(closeAt + 2);
        j += 1;
        break;
      }
      if (tail === undefined) {
        out += `[[${opener.target}|`;
        i += 1;
        continue;
      }
      out += this.renderLinkChunk(opener.target, label, sawNest);
      out += linkPass(tail);
      i = j;
    }
    return out;
  }

  private spanLinkTargetOverNest(
    openIndex: number,
    opener: { prefix: string; head: string },
    pieces: ContentPiece[],
    linkPass: (text: string) => string,
  ): { out: string; next: number } {
    let target = opener.head;
    let label = "";
    let sawDivider = false;
    let tail: string | undefined;
    let j = openIndex + 1;
    while (j < pieces.length) {
      const inner = pieces[j]!;
      if (inner.kind === "nest") {
        if (sawDivider) label += inner.text;
        else target += inner.text;
        j += 1;
        continue;
      }
      const pipeAt = sawDivider ? -1 : inner.text.indexOf("|");
      const closeAt = inner.text.indexOf("]]");
      if (pipeAt !== -1 && (closeAt === -1 || pipeAt < closeAt)) {
        target += inner.text.slice(0, pipeAt);
        label += inner.text.slice(pipeAt + 1);
        sawDivider = true;
        j += 1;
        continue;
      }
      if (closeAt === -1) {
        if (sawDivider) label += inner.text;
        else target += inner.text;
        j += 1;
        continue;
      }
      const before = inner.text.slice(0, closeAt);
      if (sawDivider) label += before;
      else target += before;
      tail = inner.text.slice(closeAt + 2);
      j += 1;
      break;
    }
    if (!sawDivider || tail === undefined) {
      return { out: `${linkPass(opener.prefix)}[[${opener.head}`, next: openIndex + 1 };
    }
    return {
      out: `${linkPass(opener.prefix)}${this.renderLinkChunk(target, label)}${linkPass(tail)}`,
      next: j,
    };
  }

  private renderLinkChunk(rawTarget: string, label: string, labelHtmlSafe = false): string {
    const target = rawTarget.trim();
    if (/^(\/|https?:|mailto:)/.test(target)) {
      if (/^https?:/.test(target)) {
        return `<a target="_blank" class="external-link" href="${h(target)}">${label}</a>`;
      }
      if (/^mailto:/.test(target)) {
        return `<a class="email-link" href="${h(target)}">${label}</a>`;
      }
      const href = `/${target.replace(/^\/+/, "")}`;
      return `<a class="internal-link" href="${h(href)}">${label}</a>`;
    }
    const named = this.engine.fetchRenderCard(absolutizeWikiTarget(target, this.card.name));
    let known = named !== undefined && named.unknown !== true;
    let hrefSource = known && named?.name !== undefined ? named.name.s : target;
    if (named === undefined) {
      const virtual = virtualSearchKnownName(target, this.engine);
      if (virtual !== undefined) {
        known = true;
        hrefSource = virtual;
      } else {
        const peeked = this.engine.peekKnownCardName?.(target);
        if (peeked !== undefined) {
          known = true;
          hrefSource = peeked;
        }
      }
    }
    let href: string;
    try {
      const parsedSource = DeckoName.parse(hrefSource);
      href = `/${parsedSource.urlKey}`;
    } catch (err) {
      if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
        href = `/${target.replace(/ /g, "_")}`;
      } else {
        throw err;
      }
    }
    if (!known) href += wantedHrefQuerySuffix(hrefSource);
    const titleAttr = labelHtmlSafe && label !== "" ? label.replace(/"/g, "&quot;") : h(label || target);
    return (
      `<a class="${known ? "known-card" : "wanted-card"}" href="${h(href)}">` +
      `<span class="card-title" title="${titleAttr}">${wrappedTitleInner(label, vooJoint(this.voo))}</span>` +
      `</a>`
    );
  }

  renderRaw(): string {
    const override = resolveContentOverride(this);
    const selfNow =
      override === undefined &&
      (this.card.record.codename === "now" || this.card.key === "*now")
        ? nowCardContent()
        : undefined;
    const raw = override !== undefined ? override : (selfNow ?? this.card.dbContent);
    this.rendered = raw;
    return raw;
  }

  get main(): RenderFormat | undefined {
    if (this.isMain) return this;
    if (this.depth > 0) return this.parent?.main;
    return undefined;
  }
  private isMainNest(piece: { nest?: ParsedNest }): boolean {
    return piece.nest !== undefined && piece.nest.name === "_main" && this.ownNestMode !== "template";
  }

  mainNest(piece: { nest?: ParsedNest }): string {
    const main = this.main;
    if (main === undefined) {
      throw mainNestWithoutMainError();
    }
    const body = main.rendered !== undefined ? main.rendered : this.mainNestRender(piece);
    return this.wrapMain(body);
  }

  private wrapMain(content: string): string {
    return `<div id="main">${content}</div>`;
  }

  private mainNestRender(piece: { nest?: ParsedNest }): string {
    const nest = piece.nest;
    const root = this.main;
    if (root === undefined || nest === undefined) return "";
    const view = nest.options.view ?? this.defaultNestView();
    const sub = new RenderFormat(root.card, this.engine, {
      parent: this,
      maxDepth: this.maxDepth,
      nestQuietErrors: this.nestQuietErrors,
      main: true,
    });
    if (sub.depth >= this.maxDepth) {
      throw new TooDeepError();
    }
    return this.withNestMode("normal", () =>
      str(sub.renderView(this.modalNestView(view, root.card), {
        ...(nest.chunkNestSyntax !== undefined ? { nest_syntax: nest.chunkNestSyntax } : {}),
        ...this.nestOptionEntries(nest.options),
        nest_name: nest.name,
        home_view: view === "closed" || view === "edit" ? "open" : view,
        main: true,
        main_view: true,
      })),
    );
  }

  contentNestsHeadCore(): boolean {
    if (this.card.typeCode === "layout_type") return false;
    for (const piece of scanNests(this.card.dbContent)) {
      const nest = piece.nest;
      if (nest === undefined || nest.comment !== undefined) continue;
      const view = nest.options.view;
      if (view !== undefined && view !== "core") continue;
      let key: string;
      try {
        key = DeckoName.parse(this.resolveNestName(nest.name)).key;
      } catch {
        continue;
      }
      if (key === "*head") return true;
    }
    return false;
  }

  processLayoutContent(content: string): string {
    return this.processContent(content, "references");
  }

  standardTitle(): string {
    const live =
      this.voo?.liveTitle ??
      (() => {
        let p = this.voo?.parent;
        while (p !== undefined) {
          if (p.liveTitle !== undefined) return p.liveTitle;
          p = p.parent;
        }
        return undefined;
      })();
    if (live !== undefined && live !== "") {
      const absolute = DeckoName.parse(live).absoluteName(this.card.name);
      return absolute.from(...this.contextNames);
    }
    const explicit = this.voo?.opts["title"];
    if (typeof explicit === "string" && explicit !== "") {
      const absolute = DeckoName.parse(explicit).absoluteName(this.card.name);
      return absolute.from(...this.contextNames);
    }
    const resolved = this.card.name.from(...this.contextNames);
    return h(settingDisplayTitle(resolved, this.engine) ?? resolved);
  }

  urlKey(): string {
    return this.card.name.urlKey;
  }

  menuHelpContentBytes(): string {
    return this.engine.helpRules?.menuHelpContentBytes(this) ?? "";
  }

  createableTypes(): string[] {
    return this.engine.createableTypes?.() ?? [];
  }
}

const SETTING_DISPLAY_TITLES: ReadonlyMap<string, string> = new Map([
  ["search", "Search Results"],
  ["signin", "Sign In"],
  ["recent", "Recent Changes"],
]);

function settingDisplayTitle(
  resolved: string,
  engine: RenderEngineLike,
): string | undefined {
  if (!resolved.startsWith("*") || resolved.includes("+")) return undefined;
  const card = engine.fetchRenderCard?.(resolved);
  const codename =
    card?.id !== undefined ? engine.peekCodenameById?.(card.id) : undefined;
  if (codename === undefined) return undefined;
  return SETTING_DISPLAY_TITLES.get(codename);
}

export interface ImageCompleteSeat {
  readonly items: readonly RenderCard[];
  readonly failure?: Error;
}

export interface SearchBoxCompleteSeat {
  readonly term: string | undefined;
  readonly exact: RenderCard | undefined;
  readonly exactKnown: boolean;
  readonly goto: readonly RenderCard[];
  readonly failure: string | undefined;
}

export interface RequestTermSeat {
  readonly term: string | undefined;
  readonly complete: readonly RenderCard[];
  readonly match: readonly RenderCard[];
  readonly failure: string | undefined;
}

export interface PhantomItemType {
  typeId: number;
  typeName: string;
  typeKey: string;
}

export interface PermissionEditorOptions {
  readonly roles: readonly {name: string; key: string}[];
  readonly cardsWithAccountUrlKey?: string;
}

export interface RenderEngineLike {
  permissionEditorOptions?(): PermissionEditorOptions;
  views: Record<string, ViewFn>;
  readonly viewer?: { signedIn?: boolean; actorId?: number };
  peekNameForId?(id: number): string | undefined;
  pageErrorStatus?: number | undefined;
  pageLoudDenialTaskPhrase?: string | undefined;
  attachedErrorsByKey?: Map<string, Array<{ attribute: string; message: string }>>;
  resolveView(card: RenderCard, view: string, format?: string): ViewFn | undefined;
  fetchRenderCard(name: string): RenderCard | undefined;
  peekKnownCardName?(name: string): string | undefined;
  peekCustomizedName?(name: string): string | undefined;
  peekBoardPillKnown?(name: string): boolean | undefined;
  executeSearch(fmt: RenderFormat): RenderCard[];
  optionsCardPairs?(card: RenderCard): Array<[string, string]>;
  structureRuleForSync?(card: {
    name: string;
    id?: number;
    typeId?: number;
    typeName?: string;
    leftTypeName?: string;
    isNew?: boolean;
  }): { ruleName: string; content: string } | undefined;
  searchResultPaging?(fmt: RenderFormat): SearchResultPaging | undefined;
  searchResultCount?(fmt: RenderFormat): number | undefined;
  searchQueryFailure?(fmt: RenderFormat): string | undefined;
  searchItemCount?(fmt: RenderFormat): number | undefined;
  searchKeyword?(card: RenderCard): string | undefined;
  searchBoxCompleteSeat?(card: RenderCard): SearchBoxCompleteSeat | undefined;
  requestTermSeat?(card: RenderCard): RequestTermSeat | undefined;
  imageCompleteSeat?(card: RenderCard): ImageCompleteSeat | undefined;
  peekAlwaysOk?(): boolean | undefined;
  tokenConfig?: { readonly secret?: string };
  isDenied(card: RenderCard): boolean;
  cqlReadScope?(): { alwaysOk: boolean; readRuleIds: number[] } | undefined;
  taskAllowed?(card: RenderCard, task: Exclude<CrudTask, "read">): boolean | undefined;
  unknownCardCreatable?(card: RenderCard): boolean;
  signupApprovalVerdict?(card: RenderCard): { approve: boolean; delete: boolean } | undefined;
  currentTypeCreatable?(typeId: number): boolean | undefined;
  createableTypes?(): string[];
  readonly pageSession?: ReadViewer;
  readonly pageSessionAccountLinksHtml?: string;
  readonly requestNewCard?: { typeId?: number; typePreset?: boolean };
  readonly requestEditorParams?: Readonly<Record<string, string>>;
  readonly pageSessionMyCardHtml?: string;
  readonly pageSessionRolesDropdownHtml?: string;
  markSessionRolesContentFilled?(): void;
  blankSessionRolesFill?(): void;
  updateVerdictForCard?(card: RenderCard): Promise<boolean | undefined> | boolean | undefined;
  readonly helpRules?: HelpRulesApi;
  reportUnknownCard?(key: string): void;
  virtualLeftTypeName?(name: DeckoName): string | undefined;
  prepareItemForRender?(name: string): Promise<RenderCard | undefined> | RenderCard | undefined;
  peekCodenameById?(typeId: number): string | undefined;
  peekIdByCodename?(codename: string): number | undefined;
  peekRegisteredNameForId?(id: number): string | undefined;
  pageHeadBytesFor?(rootKey: string): string | undefined;
  collectRules?(host: RenderCard): RenderCard[];
  ruleCacheSetLabelWinner?(
    lookupKeys: readonly string[],
    settingCode: string,
  ): { patternCode: string; anchorName: string | undefined } | undefined;
  defaultRuleTypeIdForSetName?(setName: string): number | undefined;
  cardIsRule?(card: RenderCard): boolean;
  cardMatchesRuleSet?(card: RenderCard): boolean;
  compressAssets?(): boolean;
  scriptCompressor?(js: string): string;
  ruleSetPrototypeTypeCode?(card: RenderCard): string | undefined;
  viewUnknownSettingForCard?(card: RenderCard, view: string, format?: string): true | string | false | undefined;
  viewPermissionSettingForCard?(card: RenderCard, view: string, format: string): ViewPermissionDirective | undefined;
  viewDenialSettingForCard?(card: RenderCard, view: string, format: string): string | undefined;
  resolveFormatMethod?(card: RenderCard, method: string, format: string): ModFormatMethodFn | undefined;
  modDeckBound?(): boolean;
  hasExistingRuleFor?(key: string): boolean | undefined;
  existingRuleFor?(key: string): RenderCard | undefined;
  findSettingCard?(codename: string): RenderCard | undefined;
  findRenderCardById?(id: number): RenderCard | undefined;
  setClassesWithRules?(host: RenderCard): SettingClassWithRules[];
  preparedHeadBytesFor?(rootKey: string): string | undefined;
  newCardDefaultType?(
    name: DeckoName,
    leftTypeName?: string,
  ): { typeId: number; typeName: string } | undefined;
  newCardDefaultContent?(name: DeckoName): string | undefined;
  hostItemTypeName?(card: RenderCard): { typeName: string; typeId: number } | undefined;
  pointerItemVerdict?(
    hostKey: string,
    key: string,
  ): { read: boolean; create: boolean | undefined } | undefined;
  seatPhantomReadVerdict?(key: string, denied: boolean): void;
  phantomVirtualStructure?(
    name: DeckoName,
    typeName: string | undefined,
    typeId: number | undefined,
  ): { ruleKey: string; templateContent: string; typeId?: number } | undefined;
  defaultHtmlViewConfig?(): string;
  envOriginConfig?(): string;
  canConfigure?(card: RenderCard): boolean | undefined;
  readonly imageCdnHost?: string | undefined;
  readonly fontAwesomeAssetMode?: "local";
  readonly phantomItemType?: PhantomItemType | undefined;
  readonly fileStorage?: "local" | "web" | "cloud" | "coded" | undefined;
  historyRenderReader?(): import("../history/render-seam.js").HistoryRenderReader | undefined;
  historyJsonExport?(card: RenderCard, view: string): Record<string, unknown>[] | undefined;
  updaterRenderReader?(): import("../history/updater-seam.js").UpdaterRenderReader | undefined;
  followRenderBundle?(): import("../follow/follow-render-seam.js").FollowRenderBundle | undefined;
  knownVirtualCardName?(name: DeckoName): Promise<boolean>;
  readonly historyDiffMemo?: Map<number, import("../history/content-diff.js").ContentDiff>;
}

export interface SettingClassWithRules {
  klass: import("../set-patterns/registry.js").PatternSpec;
  rules: RenderCard[];
  anchorless: boolean;
}

interface UnknownViewDecl {
  view: string;
  config: string | true;
  setTokens?: readonly string[];
  seedLayer?: boolean;
}

const UNKNOWN_VIEW_DECLS: readonly UnknownViewDecl[] = [
  { view: "open", config: true, setTokens: ["RIGHT-discussion"] },
  { view: "open_content", config: true, setTokens: ["RIGHT-discussion"] },
  { view: "titled", config: true, setTokens: ["RIGHT-discussion"] },
  { view: "titled_content", config: true, setTokens: ["RIGHT-discussion"] },
  { view: "core", config: true, setTokens: ["RIGHT-discussion"] },
  { view: "boxed", config: true, setTokens: ["TYPE-image"], seedLayer: true },
  { view: "boxed_link", config: true, setTokens: ["TYPE-image"], seedLayer: true },
  { view: "mini_bar", config: true },
  { view: "mini_unknown", config: true },
  { view: "bar_left", config: true },
  { view: "bar_menu", config: true },
  { view: "bar_body", config: true },
  { view: "closed", config: "mini_bar" },
  { view: "bar", config: "mini_bar" },
  { view: "full_bar", config: "mini_bar" },
  { view: "bar_middle", config: "blank" },
  { view: "bar_right", config: "blank" },
  { view: "titled_content", config: "blank" },
  { view: "labeled", config: "labeled" },
  { view: "labeled_content", config: "mini_unknown" },
  { view: "one_line_content", config: "mini_unknown" },
  { view: "raw_one_line_content", config: "mini_unknown" },
  { view: "template_nest", config: true },
  { view: "board_link", config: true },
  { view: "menu", config: true },
  { view: "comment_box", config: true },
  { view: "read_formgroup", config: true },
  { view: "board", config: true },
  { view: "cardboard", config: true },
  { view: "edit", config: true },
  { view: "help", config: true },
  { view: "menu", config: true },
  { view: "new", config: true },
  { view: "new_fields", config: true },
  { view: "conflict_tracker", config: true },
  { view: "guide", config: true },
  { view: "guide_tab", config: true },
  { view: "rules_tab", config: true },
  { view: "content_formgroups", config: true },
  { view: "content_formgroup", config: true },
  { view: "input", config: true },
  { view: "help_text", config: true },
];

function compiledUnknownSettingForCard(
  card: { setKeys: string },
  view: string,
  allSetOnly = false,
): string | true | undefined {
  const tokens = new Set(card.setKeys.split(/\s+/).filter((t) => t !== ""));
  if (!allSetOnly) {
    let scoped: string | true | undefined;
    for (const decl of UNKNOWN_VIEW_DECLS) {
      if (decl.view !== view || decl.setTokens === undefined) continue;
      if (decl.setTokens.some((t) => tokens.has(t))) scoped = decl.config;
    }
    if (scoped !== undefined) return scoped;
  } else {
    let seeded: string | true | undefined;
    for (const decl of UNKNOWN_VIEW_DECLS) {
      if (decl.view !== view || decl.seedLayer !== true || decl.setTokens === undefined) continue;
      if (decl.setTokens.some((t) => tokens.has(t))) seeded = decl.config;
    }
    if (seeded !== undefined) return seeded;
  }
  let all: string | true | undefined;
  for (const decl of UNKNOWN_VIEW_DECLS) {
    if (decl.view === view && decl.setTokens === undefined) all = decl.config;
  }
  return all;
}

export const PERMS_NONE_VIEWS: ReadonlySet<string> = new Set([
  "title",
  "title_link",
  "title_no_link",
  "name",
  "url_link",
  "link",
  "nav_link",
  "header",
  "header_title",
  "blank",
  "denial",
  "errors",
  "server_error",
  "not_found",
  "bad_address",
]);

function normalizeView(view: string): string {
  return view;
}

export class NoMethodError extends Error {
  override name = "NoMethodError";
}

function showAllErrors(fmt: RenderFormat | undefined): boolean {
  return fmt?.engine.peekAlwaysOk?.() === true;
}

function errorDebugPage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const frames =
    error instanceof Error && typeof error.stack === "string"
      ? error.stack.split("\n").slice(1).map((line) => line.trim())
      : [];
  return (
    "\n      <h3>Error message (visible to admin only)</h3>\n" +
    `      <p><strong>${h(message)}</strong></p>\n` +
    `      <div>${frames.join("<br>\n")}</div>\n    `
  );
}

function backtraceLink(card: RenderCard, error: unknown): string {
  return `<span title="${h(errorDebugPage(error))}">${h(card.name.s)}</span>`;
}

export { rubyDefaultInspect, stableIdentity } from "../ruby-object-inspect.js";

export function quietRenderError(
  error: unknown,
  card: RenderCard,
  view: string,
  fmt?: RenderFormat,
): string {
  const msg =
    error instanceof UnsupportedViewError ||
    error instanceof TooDeepError ||
    error instanceof CodenameNotFoundError
      ? error.message
      : showAllErrors(fmt)
        ? `Error rendering: ${backtraceLink(card, error)} (${view} view)`
        : `Error rendering: ${h(card.name.s)} (${view} view)`;
  return `<span class="render-error alert alert-danger">${msg}</span>`;
}

function normalizeVisibilityList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

export const COMMON_SETTINGS: ReadonlySet<string> = new Set([
  "create", "read", "update", "delete", "structure", "default", "guide",
]);

export const FIELD_SETTINGS: ReadonlySet<string> = new Set([
  "default", "help", "input_type", "content_options", "content_option_view",
]);

export const REGISTERED_SETTING_CODENAMES: ReadonlySet<string> = new Set([
  "autoname",
  "create", "delete", "read", "update",
  "default", "structure",
  "input_type",
  "follow", "follow_fields",
  "guide", "help",
  "on_create", "on_delete", "on_update", "thanks",
  "head", "layout",
  "content_options", "content_option_view",
  "captcha",
  "script",
  "style",
]);

const RESTRICTED_TO_TYPE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["content_options", new Set(["list", "pointer", "session"])],
  ["content_option_view", new Set(["list", "pointer", "session"])],
]);

export function wrappedTitleInner(title: string, joint = "+"): string {
  return title.split(/\s*\+\s*/).join(`<span>${joint}</span>`);
}

export function vooJoint(voo: Voo | undefined): string {
  const joint = voo?.opts["joint"];
  return typeof joint === "string" ? joint : "+";
}

const WIKI_LINK_REGEXP =
  /\\?\[\[((?:[^\[\]\n|{]|\{\{[^{}]*\}\})+?)(?:\|([^\[\]\n]+?))?\]\]/g;

const URI_SCHEME_REGEXP =
  /(?:irc|http|https|ftp|ssh|git|sftp|file|ldap|ldaps|mailto):/g;
const URI_HOST_REGEXP =
  /(?:[a-zA-Z\d](?:[-a-zA-Z\d]*[a-zA-Z\d])?\.)+(?:aero|biz|com|coop|edu|gov|info|int|mil|museum|name|net|org|ad|ae|af|ag|ai|al|am|an|ao|aq|ar|as|at|au|aw|az|ba|bb|bd|be|bf|bg|bh|bi|bj|bm|bn|bo|br|bs|bt|bv|bw|by|bz|ca|cc|cf|cd|cg|ch|ci|ck|cl|cm|cn|co|cr|cs|cu|cv|cx|cy|cz|de|dj|dk|dm|do|dz|ec|ee|eg|eh|er|es|et|fi|fj|fk|fm|fo|fr|fx|ga|gb|gd|ge|gf|gh|gi|gl|gm|gn|gp|gq|gr|gs|gt|gu|gw|gy|hk|hm|hn|hr|ht|hu|id|ie|il|in|io|iq|ir|is|it|jm|jo|jp|ke|kg|kh|ki|km|kn|kp|kr|kw|ky|kz|la|lb|lc|li|lk|lr|ls|lt|lu|lv|ly|ma|mc|md|mg|mh|mk|ml|mm|mn|mo|mp|mq|mr|ms|mt|mu|mv|mw|mx|my|mz|na|nc|ne|nf|ng|ni|nl|no|np|nr|nt|nu|nz|om|pa|pe|pf|pg|ph|pk|pl|pm|pn|pr|pt|pw|py|qa|re|ro|ru|rw|sa|sb|sc|sd|se|sg|sh|si|sj|sk|sl|sm|sn|so|sr|st|su|sv|sy|sz|tc|td|tf|tg|th|tj|tk|tm|tn|to|tp|tr|tt|tv|tw|tz|ua|ug|uk|um|us|uy|uz|va|vc|ve|vg|vi|vn|vu|wf|ws|ye|yt|yu|za|zm|zr|zw|eu)\b/g;
const URI_EMAIL_REGEXP = /[a-zA-Z\d](?:[-a-zA-Z\d.]*[a-zA-Z\d])?@\b/g;
const URI_REJECTED_PREFIX = /(?:!|":|"|'|]\()$/;
const URI_TRAILING_PUNCTUATION = new Set([",", ".", ")", "!", "?", ":"]);
const URI_FULL_REGEXP_SOURCE =
  '(?=(?:irc|http|https|ftp|ssh|git|sftp|file|ldap|ldaps|mailto):)([a-zA-Z][\\-+.a-zA-Z\\d]*):(?:((?:[\\-_.!~*\'()a-zA-Z\\d;?:@&=+$,]|%[a-fA-F\\d]{2})(?:[\\-_.!~*\'()a-zA-Z\\d;\\/?:@&=+$,\\[\\]]|%[a-fA-F\\d]{2})*)|(?:(?:\\/\\/(?:(?:(?:((?:[\\-_.!~*\'()a-zA-Z\\d;:&=+$,]|%[a-fA-F\\d]{2})*)@)?(?:((?:(?:[a-zA-Z0-9\\-.]|%[0-9a-fA-F][0-9a-fA-F])+|\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|\\[(?:(?:[a-fA-F\\d]{1,4}:)*(?:[a-fA-F\\d]{1,4}|\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})|(?:(?:[a-fA-F\\d]{1,4}:)*[a-fA-F\\d]{1,4})?::(?:(?:[a-fA-F\\d]{1,4}:)*(?:[a-fA-F\\d]{1,4}|\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}))?)\\]))(?::(\\d*))?))?|((?:[\\-_.!~*\'()a-zA-Z\\d$,;:@&=+]|%[a-fA-F\\d]{2})+))|(?!\\/\\/))(\\/(?:[\\-_.!~*\'()a-zA-Z\\d:@&=+$,]|%[a-fA-F\\d]{2})*(?:;(?:[\\-_.!~*\'()a-zA-Z\\d:@&=+$,]|%[a-fA-F\\d]{2})*)*(?:\\/(?:[\\-_.!~*\'()a-zA-Z\\d:@&=+$,]|%[a-fA-F\\d]{2})*(?:;(?:[\\-_.!~*\'()a-zA-Z\\d:@&=+$,]|%[a-fA-F\\d]{2})*)*)*)?)(?:\\?((?:[\\-_.!~*\'()a-zA-Z\\d;\\/?:@&=+$,\\[\\]]|%[a-fA-F\\d]{2})*))?)(?:\\#((?:[\\-_.!~*\'()a-zA-Z\\d;\\/?:@&=+$,\\[\\]]|%[a-fA-F\\d]{2})*))?';const URI_FULL_REGEXP = new RegExp(URI_FULL_REGEXP_SOURCE);

interface UriMatch {
  start: number;
  end: number;
  href: string;
  text: string;
  resourceType: string;
  trailing: string;
}

const URI_PREFIXES: ReadonlyArray<[RegExp, "scheme" | "host" | "email", string]> = [
  [URI_SCHEME_REGEXP, "scheme", ""],
  [URI_HOST_REGEXP, "host", "http://"],
  [URI_EMAIL_REGEXP, "email", "mailto:"],
];

interface UriPrefixMemo {
  starts: Array<number | undefined>;
  from: number[];
}

function newUriPrefixMemo(): UriPrefixMemo {
  return { starts: [undefined, undefined, undefined], from: [0, 0, 0] };
}

function nextPrefixStart(text: string, index: number, pos: number, memo: UriPrefixMemo): number {
  const known = memo.starts[index];
  if (known !== undefined && memo.from[index]! <= pos && (known === -1 || known >= pos)) {
    return known;
  }
  const regexp = URI_PREFIXES[index]![0];
  regexp.lastIndex = pos;
  const m = regexp.exec(text);
  regexp.lastIndex = 0;
  const start = m === null ? -1 : m.index;
  memo.starts[index] = start;
  memo.from[index] = pos;
  return start;
}

function findUriMatch(text: string, from: number, memo: UriPrefixMemo = newUriPrefixMemo()): UriMatch | undefined {
  const prefixes = URI_PREFIXES;
  let pos = from;
  for (;;) {
    let bestStart = -1;
    let bestKind: "scheme" | "host" | "email" | undefined;
    for (let index = 0; index < prefixes.length; index++) {
      const start = nextPrefixStart(text, index, pos, memo);
      if (start !== -1 && (bestStart === -1 || start < bestStart)) {
        bestStart = start;
        bestKind = prefixes[index]![1];
      }
    }
    if (bestStart === -1 || bestKind === undefined) return undefined;
    const prepend = prefixes.find(([_, kind]) => kind === bestKind)![2];
    const full = URI_FULL_REGEXP.exec(prepend + text.slice(bestStart));
    if (full === null || full[0].length <= prepend.length) {
      pos = bestStart + 1;
      continue;
    }
    const end = bestStart + full[0].length - prepend.length;
    if (bestStart >= 2 && URI_REJECTED_PREFIX.test(text.slice(bestStart - 2, bestStart))) {
      pos = end;
      continue;
    }
    const rawSpan = text.slice(bestStart, end);
    let chunk = prepend + rawSpan;
    const lastChar = chunk.slice(-1);
    let trailing = "";
    let choppedRaw = rawSpan;
    if (URI_TRAILING_PUNCTUATION.has(lastChar)) {
      trailing = lastChar;
      chunk = chunk.slice(0, -1);
      choppedRaw = choppedRaw.slice(0, -1);
    }
    chunk = chunk.replace(/(?:&nbsp;)+/g, "");
    chunk = chunk.replace(/\.$/, "");
    if (chunk === "") {
      pos = end;
      continue;
    }
    const schemeResourceType =
      /^https?:/.test(chunk)
        ? "external-link"
        : /^mailto:/.test(chunk)
          ? "email-link"
          : /^([a-zA-Z][\-+.a-zA-Z\d]*):/.test(chunk)
            ? `${(/^([a-zA-Z][\-+.a-zA-Z\d]*):/.exec(chunk) as RegExpExecArray)[1]}-link`
            : "";
    return bestKind === "scheme"
      ? {
          start: bestStart,
          end,
          href: chunk,
          text: chunk,
          resourceType: schemeResourceType,
          trailing,
        }
      : bestKind === "host"
        ? {
            start: bestStart,
            end,
            href: chunk,
            text: choppedRaw,
            resourceType: "external-link",
            trailing,
          }
        : {
            start: bestStart,
            end,
            href: chunk,
            text: choppedRaw,
            resourceType: "email-link",
            trailing,
          };
  }
}

export function rubyChunkListForCardType(
  typeCode: string | undefined,
  typeName: string | undefined,
): "default" | "references" | "nest_only" {
  const code = typeCode ?? typeName?.toLowerCase().replace(/\s+/g, "_");
  switch (code) {
    case "html":
    case "css":
    case "scss":
    case "layout_type":
      return "references";
    case "java_script":
    case "coffee_script":
      return "nest_only";
    default:
      return "default";
  }
}

export function escapeLiteralForCard(
  card: { typeName?: string },
  literal: string,
): string {
  return card.typeName === "Markdown"
    ? literal
    : `<span>${literal}</span>`;
}

export function virtualSearchCodenameResolverFor(
  engine: RenderEngineLike | undefined,
): ((codename: string) => string | undefined) | undefined {
  if (engine?.peekIdByCodename === undefined || engine.peekRegisteredNameForId === undefined) {
    return undefined;
  }
  return (codename) => {
    const id = engine.peekIdByCodename?.(codename);
    const holder = id !== undefined ? engine.peekRegisteredNameForId?.(id) : undefined;
    return holder !== undefined ? DeckoName.parse(holder).key : undefined;
  };
}

export function virtualSearchKnownName(
  target: string,
  engine: RenderEngineLike | undefined,
): string | undefined {
  let name: DeckoName;
  try {
    name = DeckoName.parse(target);
  } catch (err) {
    if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
      return undefined;
    }
    throw err;
  }
  if (virtualSearchCqlFor(name, virtualSearchCodenameResolverFor(engine)) === undefined) {
    return undefined;
  }
  return name.s;
}

export function expandContentLinks(
  text: string,
  engine?: RenderEngineLike,
  context?: DeckoName,
  titleContextNames?: readonly string[],
): string {
  if (!/[:.@]/.test(text)) return expandWikiLinks(text, engine, context, titleContextNames);
  let out = "";
  let pos = 0;
  const uriMemo = newUriPrefixMemo();
  for (;;) {
    const rest = text.slice(pos);
    const uri = findUriMatch(text, pos, uriMemo);
    WIKI_LINK_REGEXP.lastIndex = 0;
    const wiki = WIKI_LINK_REGEXP.exec(rest);
    const wikiStart = wiki === null ? Infinity : pos + wiki.index;
    if (uri === undefined && wiki === null) {
      out += rest;
      break;
    }
    if (uri !== undefined && uri.start <= wikiStart) {
      out += text.slice(pos, uri.start);
      const target = uri.resourceType === "external-link" ? ` target="_blank"` : "";
      const cls = uri.resourceType === "" ? "" : ` class="${uri.resourceType}"`;
      out += `<a${target}${cls} href="${h(uri.href)}">${uri.text}</a>${uri.trailing}`;
      pos = uri.end;
      continue;
    }
    WIKI_LINK_REGEXP.lastIndex = 0;
    const wikiGlobal = WIKI_LINK_REGEXP.exec(rest);
    out += text.slice(pos, wikiStart);
    out += expandWikiLinks(wikiGlobal![0], engine, context, titleContextNames);
    pos = wikiStart + wikiGlobal![0].length;
  }
  return out;
}

function linkFallbackTitle(target: string): string {
  try {
    return DeckoName.parse(target).fullyStripped.s;
  } catch (err) {
    if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) return target;
    throw err;
  }
}

function absolutizeWikiTarget(target: string, context: DeckoName | undefined): string {
  if (context === undefined) return target;
  try {
    const parsed = DeckoName.parse(target);
    if (parsed.isAbsolute) return target;
    return parsed.absoluteName(context).s;
  } catch (err) {
    if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
      return target;
    }
    throw err;
  }
}

const WIKI_LINK_MEMO = {};

function memoizedWikiLink(
  kind: string,
  key: string,
  compute: () => string,
): string {
  const memo = DeckoName.requestMemo<string>(WIKI_LINK_MEMO);
  if (memo === undefined) return compute();
  const memoKey = JSON.stringify([kind, key]);
  const hit = memo.get(memoKey);
  if (hit !== undefined) return hit;
  const value = compute();
  memo.set(memoKey, value);
  return value;
}

function absolutizeWikiTargetMemoized(
  target: string,
  context: DeckoName | undefined,
): string {
  if (context === undefined) return target;
  return memoizedWikiLink("absolutize", JSON.stringify([context.s, target]), () =>
    absolutizeWikiTarget(target, context),
  );
}

function wikiLinkUrlKey(hrefSource: string, targetTrimmed: string): string {
  return memoizedWikiLink("urlKey", JSON.stringify([hrefSource, targetTrimmed]), () => {
    try {
      return DeckoName.parse(hrefSource).urlKey;
    } catch (err) {
      if (err instanceof CodenameNotFoundError || err instanceof NameNotFoundError) {
        return targetTrimmed.replace(/ /g, "_");
      }
      throw err;
    }
  });
}

function linkFallbackTitleMemoized(target: string): string {
  return memoizedWikiLink("fallbackTitle", target, () => linkFallbackTitle(target));
}

function linkTitleInContextMemoized(
  title: string,
  cardName: DeckoName,
  contextNames: readonly string[],
): string {
  if (contextNames.length === 0) return linkTitleInContext(title, cardName, contextNames);
  return memoizedWikiLink("title", JSON.stringify([cardName.s, contextNames, title]), () =>
    linkTitleInContext(title, cardName, contextNames),
  );
}

function linkNestCardName(
  fetchTarget: string,
  resolvedName: DeckoName | undefined,
): DeckoName | undefined {
  if (resolvedName !== undefined) return resolvedName;
  try {
    return DeckoName.parse(fetchTarget);
  } catch (err) {
    if (
      err instanceof CodenameNotFoundError ||
      err instanceof NameNotFoundError ||
      err instanceof UnsupportedIdentifierError
    ) {
      return undefined;
    }
    throw err;
  }
}

function linkTitleInContext(
  title: string,
  cardName: DeckoName,
  contextNames: readonly string[],
): string {
  try {
    return DeckoName.parse(title).absoluteName(cardName).from(...contextNames);
  } catch (err) {
    if (
      err instanceof CodenameNotFoundError ||
      err instanceof NameNotFoundError ||
      err instanceof UnsupportedIdentifierError
    ) {
      return title;
    }
    throw err;
  }
}

export function wantedHrefQuerySuffix(hrefSource: string): string {
  try {
    const parsed = DeckoName.parse(hrefSource);
    const resolved = parsed.parts.join(DeckoName.JOINT);
    if (parsed.urlKey === resolved.replace(/ /g, "_")) return "";
    return `?card%5Bname%5D=${cgiEscape(resolved)}`;
  } catch {
    return "";
  }
}

export function expandWikiLinks(
  text: string,
  engine?: RenderEngineLike,
  context?: DeckoName,
  titleContextNames?: readonly string[],
): string {
  return text.replace(WIKI_LINK_REGEXP, (match, target: string, label: string | undefined) => {
    if (match.startsWith("\\")) {
      return `[[${label !== undefined ? `${target}|${label}` : target}]]`;
    }
    const targetTrimmed = target.trim();
    if (/^(\/|https?:|mailto:)/.test(targetTrimmed)) {
      if (/^https?:/.test(targetTrimmed)) {
        return `<a target="_blank" class="external-link" href="${h(targetTrimmed)}">${
          (label ?? targetTrimmed).trim()
        }</a>`;
      }
      if (/^mailto:/.test(targetTrimmed)) {
        return `<a class="email-link" href="${h(targetTrimmed)}">${
          (label ?? targetTrimmed).trim()
        }</a>`;
      }
      const href = `/${targetTrimmed.replace(/^\/+/, "")}`;
      return `<a class="internal-link" href="${h(href)}">${(label ?? targetTrimmed).trim()}</a>`;
    }
    const fetchTarget = absolutizeWikiTargetMemoized(targetTrimmed, context);
    const namedLink = engine?.fetchRenderCard(fetchTarget);
    let known = namedLink !== undefined && namedLink.unknown !== true;
    let hrefSource =
      known && namedLink?.name !== undefined ? namedLink.name.s : targetTrimmed;
    if (namedLink === undefined && engine !== undefined) {
      const virtual = virtualSearchKnownName(targetTrimmed, engine);
      if (virtual !== undefined) {
        known = true;
        hrefSource = virtual;
      } else {
        const peeked = engine.peekKnownCardName?.(targetTrimmed);
        if (peeked !== undefined) {
          known = true;
          hrefSource = peeked;
        }
      }
    }
    let href: string;
    href = `/${wikiLinkUrlKey(hrefSource, targetTrimmed)}`;
    if (!known) href += wantedHrefQuerySuffix(hrefSource);
    const displayText = label !== undefined ? label.trim() : linkFallbackTitleMemoized(targetTrimmed);
    const nestCard = linkNestCardName(fetchTarget, known ? namedLink?.name : undefined);
    const nestContextNames =
      nestCard === undefined || titleContextNames === undefined
        ? []
        : titleContextNames.filter((key) => nestCard.partKeys.includes(key));
    const titleText =
      nestCard === undefined
        ? displayText
        : linkTitleInContextMemoized(displayText, nestCard, nestContextNames);
    return (
      `<a class="${known ? "known-card" : "wanted-card"}" href="${h(href)}">` +
      `<span class="card-title" title="${titleText.replace(/"/g, "&quot;")}">` +
      `${wrappedTitleInner(titleText)}</span>` +
      `</a>`
    );
  });
}

function matchLinkWrappedNestOpener(text: string): { prefix: string; target: string } | undefined {
  const match = /(?<!\\)\[\[([^\[\]\n|]+)\|\s*$/.exec(text);
  if (match === null || match.index === undefined) return undefined;
  return { prefix: text.slice(0, match.index), target: match[1] ?? "" };
}

function matchLinkTargetNestOpener(text: string): { prefix: string; head: string } | undefined {
  const match = /(?<!\\)\[\[([^{}[\]\n|]*)$/.exec(text);
  if (match === null || match.index === undefined) return undefined;
  return { prefix: text.slice(0, match.index), head: match[1] ?? "" };
}
