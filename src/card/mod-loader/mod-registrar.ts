import type { ViewFn } from "../render/format.js";
import type { PatternSpec } from "../set-patterns/registry.js";
import type {
  ModSettingOpts,
  ModViewConfig,
} from "./mod-manifest.js";

function camelizedSegments(setPath: string): string[] {
  return setPath
    .split("/")
    .map((segment) => segment.replace(/^\d+_/, ""))
    .map(camelize);
}

export function setModuleShortname(setPath: string): string {
  return camelizedSegments(setPath).join("::");
}

function camelize(part: string): string {
  return part
    .split("_")
    .map((word) => (word === "" ? "" : word[0]!.toUpperCase() + word.slice(1)))
    .join("");
}

export function setPathPattern(setPath: string): string {
  return setPath.split("/")[0] ?? "";
}

export type SetModuleKind = "base" | "abstract" | "nonbase";

export interface RegisteredSetModule {
  readonly shortname: string;
  readonly kind: SetModuleKind;
  readonly modName: string;
}

export class SetModuleBasket {
  readonly base: RegisteredSetModule[] = [];
  readonly abstract: RegisteredSetModule[] = [];
  readonly nonbase: Map<string, RegisteredSetModule[]> = new Map();
  private readonly shortnameToSetPath = new Map<string, string>();

  register(module: RegisteredSetModule): void {
    const list =
      module.kind === "base"
        ? this.base
        : module.kind === "abstract"
          ? this.abstract
          : (this.nonbase.get(module.shortname) ?? []);
    if (module.kind === "nonbase") this.nonbase.set(module.shortname, list);
    const exists = list.some(
      (m) => m.shortname === module.shortname && m.modName === module.modName,
    );
    if (!exists) list.push(module);
  }

  recordSetPath(shortname: string, setPath: string): void {
    this.shortnameToSetPath.set(shortname, setPath);
  }

  setPathFor(shortname: string): string | undefined {
    return this.shortnameToSetPath.get(shortname);
  }

  allNonbase(): RegisteredSetModule[] {
    const out: RegisteredSetModule[] = [];
    for (const list of this.nonbase.values()) out.push(...list);
    return out;
  }

  clear(): void {
    this.base.length = 0;
    this.abstract.length = 0;
    this.nonbase.clear();
    this.shortnameToSetPath.clear();
  }
}

export interface RegisteredSetting {
  readonly codename: string;
  readonly group: string;
  readonly ruleTypeEditable: boolean;
  readonly shortHelpText: string | undefined;
  readonly rawHelpText: string | undefined;
  readonly rightRawHelpText: string | undefined;
  readonly restrictedToType: readonly string[];
}

export class SettingRegistry {
  readonly groups: Map<string, (RegisteredSetting | null)[]> = new Map();
  readonly preferences: Set<string> = new Set();

  register(codename: string, opts: ModSettingOpts): RegisteredSetting {
    const group = opts.group ?? "other";
    const entry: RegisteredSetting = {
      codename,
      group,
      ruleTypeEditable: opts.ruleTypeEditable ?? false,
      shortHelpText: opts.shortHelpText,
      rawHelpText: opts.helpText,
      rightRawHelpText: opts.helpText,
      restrictedToType: opts.restrictedToType ?? [],
    };

    const grp = this.groups.get(group) ?? [];
    this.groups.set(group, grp);
    const pos = opts.position;
    if (pos === undefined) {
      grp.push(entry);
    } else {
      const idx = pos - 1;
      if (grp[idx] !== undefined && grp[idx] !== null) {
        grp.splice(idx, 0, entry);
      } else {
        while (grp.length < idx) grp.push(null);
        grp[idx] = entry;
      }
    }

    if (opts.preference === true) this.preferences.add(codename);
    return entry;
  }

  codenames(): string[] {
    const out: string[] = [];
    for (const grp of this.groups.values()) {
      for (const entry of grp) {
        if (entry !== null) out.push(entry.codename);
      }
    }
    return out;
  }

  preferenceIs(codename: string): boolean {
    return this.preferences.has(codename);
  }

  clear(): void {
    this.groups.clear();
    this.preferences.clear();
  }

  findByCodename(codename: string): RegisteredSetting | undefined {
    for (const grp of this.groups.values()) {
      for (const entry of grp) {
        if (entry !== null && entry.codename === codename) return entry;
      }
    }
    return undefined;
  }
}

export class ModViewConfigTable {
  private readonly byView = new Map<string, ModViewConfig>();
  private readonly byModuleView = new Map<string, ModViewConfig>();

  register(view: string, config: ModViewConfig | undefined): void {
    if (config === undefined) return;
    this.byView.set(view, config);
  }

  registerForModule(setModule: string, view: string, config: ModViewConfig | undefined): void {
    if (config === undefined) return;
    this.byModuleView.set(`${setModule}\u0000${view}`, config);
  }

  configFor(view: string): ModViewConfig | undefined {
    return this.byView.get(view);
  }

  configForModule(setModule: string, view: string): ModViewConfig | undefined {
    return this.byModuleView.get(`${setModule}\u0000${view}`);
  }

  entries(): ReadonlyMap<string, ModViewConfig> {
    return this.byView;
  }

  clear(): void {
    this.byView.clear();
    this.byModuleView.clear();
  }
}

export class PatternOverlay {
  private concrete: string[] = [];
  private readonly specs = new Map<string, PatternSpec>();

  seedCore(codes: readonly string[]): void {
    this.concrete = [...codes];
  }

  register(code: string, spec: PatternSpec, index: number | undefined): void {
    this.specs.set(code, spec);
    const at = index ?? 0;
    const clamped = Math.max(0, Math.min(at, this.concrete.length));
    this.concrete.splice(clamped, 0, code);
  }

  specFor(code: string): PatternSpec | undefined {
    return this.specs.get(code);
  }

  concreteCodes(): string[] {
    return [...this.concrete];
  }

  groupedCodes(withAll = true): string[][] {
    const nonbase = this.concrete.filter((code) => code !== "all").reverse();
    const groups: string[][] = [["abstract"], nonbase];
    if (withAll) groups.unshift(["all"]);
    return groups;
  }

  clear(): void {
    this.concrete = [];
    this.specs.clear();
  }
}

interface ViewRecordSnapshot {
  descriptor: PropertyDescriptor | undefined;
  value: ViewFn | undefined;
}
interface ViewRecordOwnership {
  baseline: ViewRecordSnapshot;
  owners: Array<{owner: ViewRegistrationTable; fn: ViewFn}>;
  applied: ViewRecordSnapshot;
}
const viewRecordOwnership = new WeakMap<Record<string, ViewFn>, Map<string, ViewRecordOwnership>>();

function viewRecordSnapshot(record: Record<string, ViewFn>, view: string): ViewRecordSnapshot {
  return {descriptor: Object.getOwnPropertyDescriptor(record, view), value: record[view]};
}

function sameViewRecordSnapshot(left: ViewRecordSnapshot, right: ViewRecordSnapshot): boolean {
  if (left.value !== right.value) return false;
  if (left.descriptor === undefined || right.descriptor === undefined) return left.descriptor === right.descriptor;
  return (["value", "writable", "get", "set", "enumerable", "configurable"] as const)
    .every(key => left.descriptor![key] === right.descriptor![key]);
}

function writeRegisteredView(record: Record<string, ViewFn>, view: string, fn: ViewFn): void {
  if (!Object.hasOwn(record, view)) {
    Object.defineProperty(record, view, {value: fn, writable: true, enumerable: true, configurable: true});
  } else if (!Reflect.set(record, view, fn)) throw new TypeError(`View registration is not writable: ${view}`);
}

function restoreViewRecord(record: Record<string, ViewFn>, view: string, baseline: ViewRecordSnapshot): void {
  if (baseline.descriptor === undefined) {
    if (!Reflect.deleteProperty(record, view)) throw new TypeError(`View registration cannot be removed: ${view}`);
  } else {
    Object.defineProperty(record, view, baseline.descriptor);
    if (baseline.descriptor.set !== undefined && !Reflect.set(record, view, baseline.value)) {
      throw new TypeError(`View accessor cannot be restored: ${view}`);
    }
  }
}

export class ViewRegistrationTable {
  private readonly touched = new Set<string>();

  constructor(private readonly views: Record<string, ViewFn>) {}

  register(view: string, viewFn: ViewFn): void {
    let registrations = viewRecordOwnership.get(this.views);
    if (registrations === undefined) viewRecordOwnership.set(this.views, registrations = new Map());
    const current = viewRecordSnapshot(this.views, view);
    let state = registrations.get(view);
    if (state !== undefined && !sameViewRecordSnapshot(current, state.applied)) {
      registrations.delete(view);
      state = undefined;
    }
    const baseline = state?.baseline ?? current;
    const owners = [...(state?.owners.filter(entry => entry.owner !== this) ?? []), {owner: this, fn: viewFn}];
    writeRegisteredView(this.views, view, viewFn);
    registrations.set(view, {baseline, owners, applied: viewRecordSnapshot(this.views, view)});
    this.touched.add(view);
  }

  record(): Record<string, ViewFn> {
    return this.views;
  }

  unregisterAll(): void {
    const registrations = viewRecordOwnership.get(this.views);
    for (const view of this.touched) {
      const state = registrations?.get(view);
      if (state !== undefined && state.owners.some(entry => entry.owner === this)) {
        if (!sameViewRecordSnapshot(viewRecordSnapshot(this.views, view), state.applied)) {
          registrations!.delete(view);
        } else {
          const owners = state.owners.filter(entry => entry.owner !== this);
          const remaining = owners.at(-1);
          if (remaining === undefined) {
            restoreViewRecord(this.views, view, state.baseline);
            registrations!.delete(view);
          } else {
            if (remaining !== state.owners.at(-1)) writeRegisteredView(this.views, view, remaining.fn);
            registrations!.set(view, {...state, owners, applied: viewRecordSnapshot(this.views, view)});
          }
        }
      }
      this.touched.delete(view);
    }
  }

  touchedViews(): string[] {
    return [...this.touched];
  }
}

export interface ViewChainEntry {
  readonly setModule: string;
  readonly view: string;
  readonly viewFn: ViewFn;
}

export class SetModuleViewTable {
  private readonly byModule = new Map<string, Map<string, ViewFn>>();

  private readonly order: Array<{
    setModule: string;
    view: string;
    viewFn: ViewFn;
    kind: SetModuleKind;
    format: string;
  }> = [];

  register(
    setModule: string,
    view: string,
    viewFn: ViewFn,
    kind: SetModuleKind = "nonbase",
    format = "html",
  ): void {
    let inner = this.byModule.get(setModule);
    if (inner === undefined) {
      inner = new Map<string, ViewFn>();
      this.byModule.set(setModule, inner);
    }
    const first = this.order.find(
      (e) =>
        e.setModule === setModule && e.view === view && e.format === format,
    );
    if (first !== undefined) {
      first.viewFn = viewFn;
      inner.set(view, viewFn);
      this.byModuleViewFormat.set(`${setModule}\u0000${view}\u0000${format}`, viewFn);
      return;
    }
    inner.set(view, viewFn);
    this.order.push({ setModule, view, viewFn, kind, format });
    this.byModuleViewFormat.set(`${setModule}\u0000${view}\u0000${format}`, viewFn);
  }

  viewForFormat(setModule: string, view: string, format: string): ViewFn | undefined {
    return this.byModuleViewFormat.get(`${setModule}\u0000${view}\u0000${format}`);
  }

  private readonly byModuleViewFormat = new Map<string, ViewFn>();

  viewFor(setModule: string, view: string): ViewFn | undefined {
    return this.byModule.get(setModule)?.get(view);
  }

  universallyApplicableModulesFor(view: string): string[] {
    const out: string[] = [];
    for (const e of this.order) {
      if (e.view === view && e.kind === "base" && !out.includes(e.setModule)) {
        out.push(e.setModule);
      }
    }
    return out;
  }

  chainFor(cardChain: readonly string[], view: string): ViewChainEntry[] {
    const out: ViewChainEntry[] = [];
    if (cardChain.length === 0) {
      for (const mod of this.universallyApplicableModulesFor(view)) {
        const viewFn = this.viewFor(mod, view);
        if (viewFn !== undefined) out.push({ setModule: mod, view, viewFn });
      }
      return out;
    }
    for (const mod of cardChain) {
      const viewFn = this.viewFor(mod, view);
      if (viewFn !== undefined) out.push({ setModule: mod, view, viewFn });
    }
    return out;
  }

  clear(): void {
    this.byModule.clear();
    this.byModuleViewFormat.clear();
    this.order.length = 0;
  }

  entries(): Array<{ setModule: string; view: string; viewFn: ViewFn; format: string }> {
    return [...this.order];
  }
}
