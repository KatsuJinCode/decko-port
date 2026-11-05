import { HTML_VIEWS } from "./render/views.js";
import { withDeclaredViewWrappers } from "./mod-loader/mod-wrapper-runtime.js";
import type { RenderCard, ViewFn } from "./render/format.js";
import { PATTERN_TABLE, type PatternSpec } from "./set-patterns/registry.js";
import {
  resolveModOrder,
  normalizeModName,
  ModNameConflictError,
  type ModDirsInput,
  type ResolvedModEntry,
} from "./mod-loader/mod-order.js";
import {
  SetModuleBasket,
  SettingRegistry,
  ModViewConfigTable,
  PatternOverlay,
  ViewRegistrationTable,
  SetModuleViewTable,
  setModuleShortname,
  setPathPattern,
  type RegisteredSetModule,
  type SetModuleKind,
  type ViewChainEntry,
} from "./mod-loader/mod-registrar.js";
import {
  anchoredModuleCandidates,
  rubySelfToken,
  safeKeyToModuleShortname,
} from "./render/set-keys-to-modules.js";
import { SET_INCLUDES } from "./mod-loader/concrete-set-includes.js";
import { DynamicSetFormatIncludes } from "./mod-loader/dynamic-set-includes.js";
import { DynamicCardIncludes } from "./mod-loader/dynamic-card-includes.js";
import { getNameEnvironment } from "./name/environment.js";
import {
  ContentOverrideRegistry,
  setDefaultContentOverrideRegistry,
  type RegisteredContentOverride,
} from "./render/content-overrides.js";
import { cardInSetModule } from "./set-modules/set-module-membership.js";
import {
  VirtualCardRegistry,
  setDefaultVirtualCardRegistry,
} from "./render/virtual-card-registry.js";
import {
  registerGemTypeAssignments,
  registerSetTypeAssignment,
  resetSetTypeAssignments,
} from "./set-patterns/set-type-assignment.js";
import {
  clearVirtualSetModules,
  registerVirtualSetModule,
} from "./set-modules/virtual-set-modules.js";
import { registerModRuleSeed } from "./mod-loader/mod-rule-seeds.js";
const HTML_DESCENDED_FORMATS = new Set(["rss", "email_html"]);

const FORMAT_PARENT: ReadonlyMap<string, string> = new Map([
  ["rss", "html"],
  ["email_html", "html"],
  ["email_text", "text"],
  ["json", "data"],
  ["yaml", "data"],
  ["xml", "data"],
  ["jsonld", "json"],
  ["scss", "css"],
]);

export function formatLineage(format: string): string[] {
  const out: string[] = [format];
  let parent = FORMAT_PARENT.get(format);
  while (parent !== undefined && !out.includes(parent)) {
    out.push(parent);
    parent = FORMAT_PARENT.get(parent);
  }
  return out;
}

export function htmlLineage(format: string): boolean {
  return format === "html" || HTML_DESCENDED_FORMATS.has(format);
}
import {
  ModEventRegistry,
  setDefaultModEventRegistry,
} from "./mod-loader/mod-event-registry.js";
import type {
  DeckoModManifest,
  ModBasketTask,
  ModCardAccessor,
  ModEngineHost,
  ModEventRegistration,
  ModEventStage,
  ModSetModuleFile,
  ModViewWrapSpec,
  ModViewConfig,
  ModFormatMethodFn,
} from "./mod-loader/mod-manifest.js";
import type { ContentFn } from "./render/content-overrides.js";
import type { RegisteredModEvent } from "./mod-loader/mod-event-registry.js";

export { normalizeModName, resolveModOrder } from "./mod-loader/mod-order.js";
export { ModNotFoundError, ModNameConflictError } from "./mod-loader/mod-order.js";
export { SettingRegistry, PatternOverlay, setModuleShortname, SetModuleViewTable } from "./mod-loader/mod-registrar.js";
export type { ViewChainEntry } from "./mod-loader/mod-registrar.js";
export { ModEventRegistry, setDefaultModEventRegistry, eventsForStage } from "./mod-loader/mod-event-registry.js";
export type { RegisteredModEvent } from "./mod-loader/mod-event-registry.js";
export { ContentOverrideRegistry, setDefaultContentOverrideRegistry, contentOverrideFor, resolveContentOverride } from "./render/content-overrides.js";
export type { ContentFn, RegisteredContentOverride } from "./render/content-overrides.js";
export { modEngineHost } from "./mod-loader/mod-engine-host.js";
export { default as cardModHelp } from "./mod-loader/mods/card-mod-help.js";
export { defineMod } from "./mod-loader/mod-dsl.js";
export type { ModDsl, SetDsl, FormatDsl, ViewOptions, EventOptions, AccessorOptions, ModOptions } from "./mod-loader/mod-dsl.js";
export { setKeysToModuleChain } from "./render/set-keys-to-modules.js";
export type { DeckoModManifest, ModEngineHost } from "./mod-loader/mod-manifest.js";
export type { ModViewConfig, ModSetModuleFile, ModSettingOpts, ModPatternRegistration } from "./mod-loader/mod-manifest.js";
export type { ModBasketTask, ModCardAccessor } from "./mod-loader/mod-manifest.js";
export type { ModEventRegistration, ModEventStage, ModEventTrigger, ModEventCard, ModEventFn } from "./mod-loader/mod-manifest.js";
export type { RegisteredSetting } from "./mod-loader/mod-registrar.js";

export interface RegisteredBasketTask extends ModBasketTask {
  readonly setPath: string;
  readonly modName: string;
}

export interface RegisteredBasketWarning {
  readonly warning: string;
  readonly setPath: string;
  readonly modName: string;
}

export interface RegisteredCardAccessor extends ModCardAccessor {
  readonly setPath: string;
  readonly modName: string;
}

export interface ModSource {
  readonly manifest: DeckoModManifest;
  readonly group?: string;
}

export interface ModLoadReport {
  readonly modNames: string[];
  readonly registeredPatternCodes: string[];
  readonly registeredSetModules: string[];
  readonly registeredViews: string[];
  readonly registeredSettings: string[];
  readonly registeredContentOverrides: string[];
  readonly registeredEvents: string[];
}

interface TokenChainEntries {
  own: ViewChainEntry[];
  abstracts: ViewChainEntry[];
  modules: string[];
}

interface ChainLookup {
  table: SetModuleViewTable;
  chainMemo: Map<string, ViewChainEntry[]>;
  tokenMemo: Map<string, TokenChainEntries>;
  indefinite: boolean;
}

function chainLookup(table = new SetModuleViewTable()): ChainLookup {
  return { table, chainMemo: new Map(), tokenMemo: new Map(), indefinite: false };
}

function includeFormatAncestry(modules: string[], incoming: readonly string[]): void {
  let cursor = 0;
  for (const ancestor of incoming) {
    const existing = modules.indexOf(ancestor);
    if (existing === -1) modules.splice(cursor++, 0, ancestor);
    else if (existing >= cursor) cursor = existing + 1;
  }
}

export class ModLoader {
  private readonly sources = new Map<string, ModSource>();
  private order: ResolvedModEntry[] = [];
  private orderResolved = false;
  private loaded = false;
  private generation = 0;

  private readonly views: ViewRegistrationTable;
  private readonly viewChains = new SetModuleViewTable();
  private readonly bodyChainLookup = chainLookup(this.viewChains);
  private readonly dynamicFormatIncludes = new DynamicSetFormatIncludes();
  private readonly dynamicCardIncludes = new DynamicCardIncludes();
  private readonly settingChainLookups = new Map<keyof ModViewConfig, ChainLookup>();
  private settingValues = new WeakMap<ViewFn, unknown>();
  private readonly taskPermissionViews = new Set<string>();
  private readonly predicatePermissionViews = new Set<string>();
  private readonly permissionFormats = new Set<string>(["html"]);
  private readonly formatMethodLookup = chainLookup();
  private formatMethodValues = new WeakMap<ViewFn, ModFormatMethodFn>();
  private hasDeclaredWrappers = false;
  private wrapperChains = new WeakMap<ViewChainEntry[], ViewChainEntry[]>();
  private declaredWrapperSettings = new WeakSet<ViewFn>();
  private readonly viewConfigs = new ModViewConfigTable();
  private readonly settings = new SettingRegistry();
  private readonly patterns = new PatternOverlay();
  private readonly basket = new SetModuleBasket();
  private readonly contentOverrides = new ContentOverrideRegistry();
  private readonly virtualCards = new VirtualCardRegistry();
  private readonly modEvents = new ModEventRegistry();
  private readonly eventModulePaths: string[] = [];
  private readonly basketTaskEntries: RegisteredBasketTask[] = [];
  private readonly basketWarningEntries: RegisteredBasketWarning[] = [];
  private readonly cardAccessorEntries: RegisteredCardAccessor[] = [];

  constructor(mods: readonly ModSource[], views: Record<string, ViewFn> = HTML_VIEWS) {
    this.views = new ViewRegistrationTable(views);
    for (const mod of mods) this.add(mod);
  }

  add(mod: ModSource): void {
    const name = normalizeModName(mod.manifest.name);
    if (this.sources.has(name)) throw new ModNameConflictError(name);
    this.sources.set(name, mod);
    this.loaded = false;
  }

  fetchMod(modName: string): ModSource | undefined {
    return this.sources.get(normalizeModName(modName));
  }

  requireMod(modName: string): ModSource {
    const mod = this.fetchMod(modName);
    if (mod === undefined) {
      throw new Error(`mod not found: ${normalizeModName(modName)}`);
    }
    return mod;
  }

  resolveOrder(input: ModDirsInput): void {
    const order = resolveModOrder({ ...input, coreMods: input.coreMods ?? [] });
    for (const entry of order) this.requireMod(entry.name);
    this.order = order;
    this.orderResolved = true;
    this.loaded = false;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  load(): ModLoadReport {
    this.reset();
    const modNames = this.orderResolved
      ? this.order.map((entry) => entry.name)
      : [...this.sources.keys()];
    const ordered = modNames.map((name) => {
      const mod = this.sources.get(name);
      if (mod === undefined) throw new Error(`mod not found: ${name}`);
      return mod;
    });

    const registeredPatternCodes: string[] = [];
    const registeredSetModules: string[] = [];
    const registeredViews: string[] = [];
    const registeredSettings: string[] = [];
    const registeredContentOverrides: string[] = [];
    const registeredEvents: string[] = [];
    this.basketTaskEntries.length = 0;
    this.basketWarningEntries.length = 0;

    this.patterns.seedCore(PATTERN_TABLE.map((spec) => spec.code));
    this.settings.clear();
    this.contentOverrides.clear();
    this.virtualCards.clear();
    this.modEvents.clear();
    this.eventModulePaths.length = 0;
    this.dynamicFormatIncludes.clear();
    this.dynamicCardIncludes.clear();
    resetSetTypeAssignments();

    for (const mod of ordered) {
      const files = [...(mod.manifest.setPatterns ?? [])].sort(byFileName);
      for (const file of files) {
        this.patterns.register(file.code, file.spec, file.index);
        registeredPatternCodes.push(file.code);
      }
    }

    for (const mod of ordered) registerGemTypeAssignments(normalizeModName(mod.manifest.name));

    const groups = this.patterns.groupedCodes();
    const wrapperMods = new Set(ordered.filter(mod => (mod.manifest.setModules ?? []).some(file =>
      Object.values(file.formats ?? {}).some(block =>
        block.methods?.some(method => method.name.startsWith("_wrapper_")))))
      .map(mod => mod.manifest.name));
    for (const group of groups) {
      for (const mod of ordered) {
        const declaresWrappers = wrapperMods.has(mod.manifest.name);
        for (const code of group) {
          const files = (mod.manifest.setModules ?? [])
            .filter((file) => setPathPattern(file.setPath) === code)
            .sort(bySetPath);
          for (const file of files) {
            this.registerSetModule(mod.manifest.name, file);
            const shortname = setModuleShortname(file.setPath);
            registeredSetModules.push(shortname);
            const kind: SetModuleKind = kindOfSetPath(file.setPath);
            for (const [formatKey, formatBlock] of Object.entries(file.formats ?? {})) {
              for (const method of formatBlock.methods ?? []) {
                if (typeof method.fn !== "function") throw Error(`Format method has no function: ${method.name}`);
                if (Object.prototype.toString.call(method.fn) === "[object AsyncFunction]") throw Error(`Format methods must be synchronous: ${method.name}`);
                const marker: ViewFn = () => { throw Error("A format method marker cannot be rendered"); };
                this.formatMethodValues.set(marker, method.fn);
                if (method.name.startsWith("_wrapper_")) this.hasDeclaredWrappers = true;
                this.formatMethodLookup.table.register(shortname, method.name, marker, kind, formatKey);
              }
              for (const view of formatBlock.views ?? []) {
                if (
                  kind !== "nonbase" &&
                  (formatKey === "html" || formatKey === "base")
                ) {
                  this.views.register(view.view, view.viewFn);
                }
                this.viewChains.register(shortname, view.view, view.viewFn, kind, formatKey);
                this.viewConfigs.register(view.view, view.config);
                this.viewConfigs.registerForModule(shortname, view.view, view.config);
                this.registerSettingMethods(shortname, view.view, view.config, kind, formatKey, declaresWrappers);
                if (!registeredViews.includes(view.view)) registeredViews.push(view.view);
              }
            }
            if (file.settingOpts !== undefined) {
              const anchor = file.setPath
                .split("/")
                .slice(1)
                .join("_")
                .replace(/^\d+_/, "");
              this.settings.register(anchor, file.settingOpts);
              registeredSettings.push(anchor);
            }
            for (const override of file.contentOverrides ?? []) {
              const fn = typeof override === "function" ? override : override.fn;
              const overrideSupersedesType =
                typeof override === "function" ? undefined : override.supersedesType;
              const supersedesType =
                overrideSupersedesType !== undefined
                  ? overrideSupersedesType
                  : file.contentKeepsType !== undefined
                    ? !file.contentKeepsType
                    : undefined;
              const belongsTo =
                file.membership === "set-module-chain"
                  ? (card: RenderCard): boolean => cardInSetModule(file.setPath, card.setKeys)
                  : undefined;
              this.contentOverrides.register({
                setPath: file.setPath,
                modName: mod.manifest.name,
                fn,
                ...(supersedesType !== undefined ? { supersedesType } : {}),
                ...(belongsTo !== undefined ? { belongsTo } : {}),
              });
              registeredContentOverrides.push(file.setPath);
            }
            if (file.virtual === true) {
              this.virtualCards.register({
                setPath: file.setPath,
                modName: mod.manifest.name,
              });
            }
            for (const event of file.events ?? []) {
              this.modEvents.register({
                ...event,
                setPath: file.setPath,
                modName: mod.manifest.name,
              });
              registeredEvents.push(event.event);
            }
            for (const task of file.basketTasks ?? []) {
              this.basketTaskEntries.push({
                ...task,
                setPath: file.setPath,
                modName: mod.manifest.name,
              });
            }
            for (const warning of file.basketWarnings ?? []) {
              this.basketWarningEntries.push({
                warning,
                setPath: file.setPath,
                modName: mod.manifest.name,
              });
            }
            for (const accessor of file.cardAccessors ?? []) {
              this.cardAccessorEntries.push({
                ...accessor,
                setPath: file.setPath,
                modName: mod.manifest.name,
              });
            }
          }
        }
      }
    }

    this.loaded = true;
    return {
      modNames,
      registeredPatternCodes,
      registeredSetModules,
      registeredViews,
      registeredSettings,
      registeredContentOverrides,
      registeredEvents,
    };
  }

  finalizeLoad(): void {
    this.loaded = true;
  }

  reload(): ModLoadReport {
    this.reset();
    return this.load();
  }

  reset(): void {
    this.generation++;
    bumpModGeneration();
    this.views.unregisterAll();
    this.viewChains.clear();
    this.dynamicFormatIncludes.clear();
    this.dynamicCardIncludes.clear();
    this.viewConfigs.clear();
    this.settingChainLookups.clear();
    this.settingValues = new WeakMap();
    this.taskPermissionViews.clear();
    this.predicatePermissionViews.clear();
    this.permissionFormats.clear();
    this.permissionFormats.add("html");
    this.formatMethodLookup.table.clear();
    this.formatMethodValues = new WeakMap();
    this.hasDeclaredWrappers = false;
    this.wrapperChains = new WeakMap();
    this.declaredWrapperSettings = new WeakSet();
    this.settings.clear();
    this.patterns.clear();
    this.basket.clear();
    this.contentOverrides.clear();
    this.virtualCards.clear();
    this.modEvents.clear();
    this.eventModulePaths.length = 0;
    clearVirtualSetModules();
    this.basketTaskEntries.length = 0;
    this.basketWarningEntries.length = 0;
    this.cardAccessorEntries.length = 0;
    this.loaded = false;
  }

  async installInto(host: ModEngineHost): Promise<void> {
    if (!this.loaded) this.load();
    for (const name of this.modNames()) {
      const mod = this.sources.get(name);
      const prepare = mod?.manifest.prepareEngine;
      if (prepare !== undefined) await prepare(host);
    }
  }

  modNames(): string[] {
    return this.orderResolved
      ? this.order.map((entry) => entry.name)
      : [...this.sources.keys()];
  }

  viewsTable(): Record<string, ViewFn> {
    return this.views.record();
  }

  viewChainTable(): SetModuleViewTable {
    return this.viewChains;
  }

  viewChain(setKeys: string, view: string, format: string = "html"): ViewChainEntry[] {
    const chain = this.lookupChain(setKeys, view, format, this.bodyChainLookup);
    if (!this.hasDeclaredWrappers || chain.length === 0) return chain;
    const cached = this.wrapperChains.get(chain);
    if (cached !== undefined) return cached;
    const first = chain[0]!;
    const wrapped = [{ ...first, viewFn: withDeclaredViewWrappers(first.viewFn,
      ctx => this.wrapperSettingForCard(ctx.fmt.card.setKeys, view, ctx.fmt.formatName)) }, ...chain.slice(1)];
    this.wrapperChains.set(chain, wrapped);
    return wrapped;
  }

  private lookupChain(setKeys: string, view: string, format: string, lookup: ChainLookup): ViewChainEntry[] {
    this.syncChainMemo();
    const memoKey = `${format}\u0000${view}\u0000${setKeys}`;
    const memoized = lookup.chainMemo.get(memoKey);
    if (memoized !== undefined) return memoized;
    lookup.indefinite = false;
    const chain = this.computeViewChain(setKeys, view, format, lookup);
    if (lookup.indefinite) return chain;
    if (lookup.chainMemo.size >= CHAIN_MEMO_LIMIT) lookup.chainMemo.clear();
    lookup.chainMemo.set(memoKey, chain);
    return chain;
  }

  private computeViewChain(setKeys: string, view: string, format: string, lookup: ChainLookup): ViewChainEntry[] {
    const tokens = setKeys.split(/\s+/).filter((s) => s !== "");
    if (tokens.length === 0) {
      const out: ViewChainEntry[] = [];
      for (const entry of lookup.table.entries()) {
        if (entry.view === view) out.push(entry);
      }
      return out;
    }
    this.syncChainMemo();
    const out: ViewChainEntry[] = [];
    const levels = formatLineage(format);
    if (!levels.includes("base")) levels.push("base");
    for (const level of levels) {
      const modules: string[] = [];
      for (const token of tokens) {
        if (token.toUpperCase() === "ALL") continue;
        includeFormatAncestry(modules, this.tokenEntries(token, view, level, lookup).modules);
      }
      for (const setModule of modules) {
        const viewFn = this.exactFormatViewFor(setModule, view, level, lookup);
        if (viewFn !== undefined) out.push({ setModule, view, viewFn });
      }
    }
    for (const level of levels) {
      out.push(...this.tokenEntries("ALL", view, level, lookup).own);
    }
    return out;
  }

  private exactFormatViewFor(shortname: string, view: string, format: string, lookup: ChainLookup): ViewFn | undefined {
    return lookup.table.viewForFormat(shortname, view, format);
  }

  private tokenEntries(
    setKeyToken: string,
    view: string,
    format: string,
    lookup: ChainLookup,
  ): TokenChainEntries {
    const memoKey = `${format}\u0000${view}\u0000${setKeyToken}`;
    const memoized = lookup.tokenMemo.get(memoKey);
    if (memoized !== undefined) return memoized;
    const own: ViewChainEntry[] = [];
    const abstracts: ViewChainEntry[] = [];
    const modules: string[] = [];
    let definitive = true;
    const selfToken = rubySelfToken(setKeyToken);
    if (selfToken === null) {
      const none = { own, abstracts, modules };
      lookup.tokenMemo.set(memoKey, none);
      return none;
    }
    const token = selfToken;
      const dashIdx = token.indexOf("-");
      if (dashIdx === -1) {
        const code = token.toLowerCase();
        const matches = this.memoShortnamesForCode(code);
        for (const shortname of matches.slice().reverse()) {
          for (const included of [shortname, ...this.dynamicFormatIncludes.included(shortname, format, stockFormatIncludes)]) {
            if (!modules.includes(included)) modules.push(included);
          }
        }
      } else {
        const resolution = anchoredModuleCandidates(token);
        definitive = resolution.definitive;
        {
          const code = token.slice(0, dashIdx).toLowerCase();
          const strippedAnchor = token
            .slice(dashIdx + 1)
            .split("-")
            .map((seg) => seg.replace(/^X/, ""))
            .join("-")
            .toLowerCase();
          const anchors =
            code !== "type_plus_right"
              ? [strippedAnchor]
              : (() => {
                  const lastDash0 = strippedAnchor.lastIndexOf("-");
                  const slashForm =
                    lastDash0 === -1
                      ? strippedAnchor
                      : `${strippedAnchor.slice(0, lastDash0)}/${strippedAnchor.slice(lastDash0 + 1)}`;
                  const forms = [strippedAnchor, slashForm];
                  for (const base of [strippedAnchor, slashForm]) {
                    const lastDash = base.lastIndexOf("-");
                    const lastSeg = base.slice(lastDash + 1);
                    if (!lastSeg.endsWith("s")) {
                      forms.push(
                        lastDash === -1
                          ? `${lastSeg}s`
                          : `${base.slice(0, lastDash + 1)}${lastSeg}s`,
                      );
                    }
                  }
                  return forms;
                })();
          const paths = resolution.paths ?? anchors.map((anchor) => `${code}/${anchor}`);
          const owners = [...new Set(paths.flatMap(path => [...this.nonbaseUnderPath(path)]))];
          for (const candidate of resolution.candidates) {
            const extras = [...includeGraphOwners(candidate), ...this.dynamicFormatIncludes.ownersFor(candidate)];
            if (owners.some(owner => owner === candidate || owner.startsWith(`${candidate}::`)) || extras.length > 0) {
              for (const owner of extras) if (!owners.includes(owner)) owners.push(owner);
              if (owners.length === 0) owners.push(candidate);
              break;
            }
          }
          if (owners.length === 0) {
            const candidate = resolution.candidates.find(shortname => this.exactFormatViewFor(shortname, view, format, lookup) !== undefined);
            if (candidate !== undefined) owners.push(candidate);
          }
          for (const owner of owners) {
            includeFormatAncestry(modules,
              [owner, ...this.dynamicFormatIncludes.included(owner, format, stockFormatIncludes)]);
          }
        }
      }
    for (const setModule of modules) {
      const viewFn = this.exactFormatViewFor(setModule, view, format, lookup);
      if (viewFn !== undefined) own.push({ setModule, view, viewFn });
    }
    const result = { own, abstracts, modules };
    if (definitive) lookup.tokenMemo.set(memoKey, result);
    else lookup.indefinite = true;
    return result;
  }

  private codeMemo = new Map<string, string[]>();
  private pathIndex: Map<string, string[]> | undefined;
  private memoGeneration = -1;

  private syncChainMemo(): void {
    const env = getNameEnvironment();
    if (env?.lexicon !== this.memoLexicon || env?.codename !== this.memoCodenames) {
      for (const lookup of [this.bodyChainLookup, this.formatMethodLookup, ...this.settingChainLookups.values()]) {
        lookup.chainMemo.clear();
        lookup.tokenMemo.clear();
      }
      this.memoLexicon = env?.lexicon;
      this.memoCodenames = env?.codename;
    }
    if (this.memoGeneration === this.generation) return;
    for (const lookup of [this.bodyChainLookup, this.formatMethodLookup, ...this.settingChainLookups.values()]) {
      lookup.chainMemo.clear();
      lookup.tokenMemo.clear();
    }
    this.codeMemo.clear();
    this.pathIndex = undefined;
    this.memoGeneration = this.generation;
  }

  private memoLexicon: unknown;
  private memoCodenames: unknown;

  private memoShortnamesForCode(code: string): string[] {
    this.syncChainMemo();
    let list = this.codeMemo.get(code);
    if (list === undefined) {
      list = this.setModuleShortnamesForCode(code);
      this.codeMemo.set(code, list);
    }
    return list;
  }

  private nonbaseUnderPath(path: string): readonly string[] {
    if (this.pathIndex === undefined) {
      const index = new Map<string, string[]>();
      for (const mod of this.basket.allNonbase()) {
        const setPath = this.basket.setPathFor(mod.shortname);
        if (setPath === undefined) continue;
        const parts = setPath.split("/");
        for (let i = 1; i <= parts.length; i++) {
          const prefix = parts.slice(0, i).join("/");
          let list = index.get(prefix);
          if (list === undefined) index.set(prefix, (list = []));
          list.push(mod.shortname);
        }
      }
      this.pathIndex = index;
    }
    return this.pathIndex.get(path) ?? [];
  }

  setModuleShortnamesForCode(code: string): string[] {
    const out: string[] = [];
    for (const mod of this.basket.base) {
      const setPath = this.basket.setPathFor(mod.shortname);
      if (setPath === undefined) continue;
      if (setPath.startsWith(`${code}/`) || setPath === code) out.push(mod.shortname);
    }
    for (const mod of this.basket.allNonbase()) {
      const setPath = this.basket.setPathFor(mod.shortname);
      if (setPath === undefined) continue;
      if (setPath.startsWith(`${code}/`) || setPath === code) out.push(mod.shortname);
    }
    return out;
  }

  viewConfigFor(view: string): ModViewConfigTableEntry | undefined {
    return this.viewConfigs.configFor(view);
  }

  formatMethodForCard(setKeys: string, method: string, format = "html"): ModFormatMethodFn | undefined {
    const first = this.lookupChain(setKeys, method, format, this.formatMethodLookup)[0];
    return first === undefined ? undefined : this.formatMethodValues.get(first.viewFn);
  }

  private registerSettingMethods(setModule: string, view: string, config: ModViewConfig | undefined,
    kind: SetModuleKind, format: string, declaresWrappers: boolean): void {
    if (config === undefined) return;
    for (const setting of Object.keys(config) as Array<keyof ModViewConfig>) {
      const value = config[setting];
      if (value === undefined || value === null || value === false) continue;
      let lookup = this.settingChainLookups.get(setting);
      if (lookup === undefined) this.settingChainLookups.set(setting, lookup = chainLookup());
      const marker: ViewFn = () => { throw Error("A view setting marker cannot be rendered"); };
      this.settingValues.set(marker, value);
      if (setting === "wrap" && declaresWrappers) this.declaredWrapperSettings.add(marker);
      lookup.table.register(setModule, view, marker, kind, format);
      if (setting === "perms") this.permissionFormats.add(format);
      if (setting === "perms" && (typeof value === "string" ? [value] : Array.isArray(value) ? value : [])
        .some(task => task === "create" || task === "update" || task === "delete")) this.taskPermissionViews.add(view);
      if (setting === "perms" && (typeof value === "string" ? [value] : Array.isArray(value) ? value : [])
        .some(task => !["none", "read", "create", "update", "delete"].some(known => known === task))) this.predicatePermissionViews.add(view);
    }
  }

  private wrapperSettingForCard(setKeys: string, view: string, format: string): {
    wrap: ModViewConfig["wrap"]; strict: boolean;
  } {
    const lookup = this.settingChainLookups.get("wrap");
    const first = lookup === undefined ? undefined : this.lookupChain(setKeys, view, format, lookup)[0];
    return {
      wrap: first === undefined ? undefined : this.settingValues.get(first.viewFn) as ModViewConfig["wrap"],
      strict: first !== undefined && this.declaredWrapperSettings.has(first.viewFn),
    };
  }

  viewSettingForCard<K extends keyof ModViewConfig>(setKeys: string, view: string,
    setting: K, format = "html"): ModViewConfig[K] | undefined {
    const lookup = this.settingChainLookups.get(setting);
    if (lookup === undefined) return undefined;
    const first = this.lookupChain(setKeys, view, format, lookup)[0];
    return first === undefined ? undefined : this.settingValues.get(first.viewFn) as ModViewConfig[K];
  }

  viewTasksRequiredForCard(setKeys: string, format?: string): boolean {
    for (const view of this.taskPermissionViews) {
      for (const level of format === undefined ? this.permissionFormats : [format]) {
        const value = this.viewSettingForCard(setKeys, view, "perms", level);
        const tasks = typeof value === "string" ? [value] : value ?? [];
        if (tasks.some(task => task === "create" || task === "update" || task === "delete")) return true;
      }
    }
    return false;
  }

  viewPredicateRequiredForCard(setKeys: string, predicate: string, format?: string): boolean {
    for (const view of this.predicatePermissionViews) {
      for (const level of format === undefined ? this.permissionFormats : [format]) {
        const value = this.viewSettingForCard(setKeys, view, "perms", level);
        if (value === predicate || (Array.isArray(value) && value.includes(predicate))) return true;
      }
    }
    return false;
  }

  viewWrapForCard(
    setKeys: string,
    view: string,
    format: string = "html",
  ): ModViewWrapSpec | undefined {
    for (const entry of this.viewChain(setKeys, view, format)) {
      const wrap = this.viewConfigs.configForModule(entry.setModule, view)?.wrap;
      if (wrap !== undefined && typeof wrap === "object" && !Array.isArray(wrap)) return wrap;
    }
    return undefined;
  }

  viewUnknownSettingForCard(
    setKeys: string,
    view: string,
    format: string = "html",
  ): true | string | false | undefined {
    return this.viewSettingForCard(setKeys, view, "unknown", format);
  }

  settingsRegistry(): SettingRegistry {
    return this.settings;
  }

  contentOverrideRegistry(): ContentOverrideRegistry {
    return this.contentOverrides;
  }

  virtualCardRegistry(): VirtualCardRegistry {
    return this.virtualCards;
  }

  eventRegistry(): ModEventRegistry {
    return this.modEvents;
  }

  basketTaskContributions(): readonly RegisteredBasketTask[] {
    return this.basketTaskEntries;
  }

  basketWarningContributions(): readonly RegisteredBasketWarning[] {
    return this.basketWarningEntries;
  }

  cardAccessorDeclarations(): readonly RegisteredCardAccessor[] {
    return this.cardAccessorEntries;
  }

  patternTable(): PatternSpec[] {
    return this.patterns.concreteCodes().map((code) => {
      const modded = this.patterns.specFor(code);
      if (modded !== undefined) return modded;
      const core = PATTERN_TABLE.find((spec) => spec.code === code);
      if (core === undefined) {
        throw new Error(`pattern spec missing for code: ${code}`);
      }
      return core;
    });
  }

  setModules(): SetModuleBasket {
    return this.basket;
  }

  eventModuleOrder() {
    const includes = this.dynamicCardIncludes.ancestries();
    return {
      patterns: this.patternTable().map(pattern => ({ code: pattern.code, anchorPartsCount: pattern.staticAnchorPartsCount })),
      setPaths: [...this.eventModulePaths],
      ...(includes === undefined ? {} : { includes }),
    };
  }

  private registerSetModule(modName: string, file: ModSetModuleFile): void {
    this.eventModulePaths.push(file.setPath);
    const shortname = setModuleShortname(file.setPath);
    const kind: SetModuleKind = kindOfSetPath(file.setPath);
    const module: RegisteredSetModule = { shortname, kind, modName };
    this.basket.register(module);
    this.basket.recordSetPath(shortname, file.setPath);
    const code = setPathPattern(file.setPath);
    const anchorParts = code === "abstract" ? 1
      : this.patternTable().find(pattern => pattern.code === code)?.staticAnchorPartsCount ?? 0;
    this.dynamicCardIncludes.register(file, anchorParts);
    this.dynamicFormatIncludes.register({ ...file,
      includeSetFormats: [...(file.includeSets ?? []), ...(file.includeSetFormats ?? [])],
    }, anchorParts);
    if (file.assignsType !== undefined) {
      registerSetTypeAssignment(shortname, file.assignsType);
    }
    if (file.virtual === true) {
      registerVirtualSetModule(file.setPath);
    }
    for (const seed of file.ruleSeeds ?? []) {
      registerModRuleSeed(modName, seed.name, seed.content);
    }
  }
}

export type ModViewConfigTableEntry = ReturnType<ModViewConfigTable["configFor"]>;

let defaultLoader: ModLoader | undefined;

export function setDefaultModLoader(loader: ModLoader | undefined): void {
  defaultLoader = loader;
}

let generation = 0;

export function modGeneration(): number {
  return generation;
}

export function bumpModGeneration(): void {
  generation++;
}

export function getDefaultModLoader(): ModLoader | undefined {
  return defaultLoader;
}

export function modViewUnknown(view: string): string | boolean | undefined {
  return defaultLoader?.viewConfigFor(view)?.unknown;
}

export function modViewPerms(view: string): ModViewConfig["perms"] {
  return defaultLoader?.viewConfigFor(view)?.perms;
}

function kindOfSetPath(setPath: string): SetModuleKind {
  const pattern = setPathPattern(setPath);
  if (pattern === "all") return "base";
  if (pattern === "abstract") return "abstract";
  return "nonbase";
}

function bySetPath(a: { setPath: string }, b: { setPath: string }): number {
  return a.setPath < b.setPath ? -1 : a.setPath > b.setPath ? 1 : 0;
}

function byFileName<T extends { code: string }>(a: T, b: T): number {
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

const CHAIN_MEMO_LIMIT = 50_000;

let includeGraphOwnerIndex: Map<string, string[]> | undefined;

function stockFormatIncludes(owner: string, format: string): readonly string[] {
  const includes = SET_INCLUDES[owner];
  if (includes === undefined) return [];
  return htmlLineage(format) ? [...(includes.html ?? []), ...(includes.base ?? [])] : [...(includes.base ?? [])];
}

function includeGraphOwners(candidate: string): readonly string[] {
  if (includeGraphOwnerIndex === undefined) {
    const index = new Map<string, string[]>();
    for (const key of Object.keys(SET_INCLUDES)) {
      const parts = key.split("::");
      for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join("::");
        let list = index.get(prefix);
        if (list === undefined) index.set(prefix, (list = []));
        list.push(key);
      }
    }
    includeGraphOwnerIndex = index;
  }
  return includeGraphOwnerIndex.get(candidate) ?? [];
}
