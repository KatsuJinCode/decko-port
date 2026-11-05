import type { ViewFn } from "../render/format.js";
import type { ContentFn } from "../render/content-overrides.js";
import type { PatternSpec } from "../set-patterns/registry.js";
import { normalizeModName } from "./mod-order.js";
import { declaredWrapperMethod, type DeclaredWrapperBody } from "./mod-wrapper-runtime.js";
import { declaredTagWrapper } from "./mod-tag-wrapper.js";
import type {
  ModTagDeclaration,
  DeckoModManifest,
  ModBasketTask,
  ModCardAccessor,
  ModEngineHost,
  ModEventFn,
  ModEventRegistration,
  ModEventStage,
  ModEventTrigger,
  ModFormatBlock,
  ModFormatMethodFn,
  ModFormatMethodDefinition,
  ModPatternRegistration,
  ModSetModuleFile,
  ModSettingOpts,
  ModViewConfig,
  ModViewDefinition,
} from "./mod-manifest.js";

export type ViewOptions = ModViewConfig;

export interface EventOptions {
  readonly on?: ModEventTrigger | readonly ModEventTrigger[];
  readonly before?: string;
  readonly after?: string;
  readonly when?: ModEventRegistration["when"];
  readonly changed?: string | readonly string[];
  readonly changing?: string | readonly string[];
  readonly skip?: "allowed";
  readonly trigger?: "required";
  readonly priority?: number;
  readonly engineOwned?: boolean;
}

export interface AccessorOptions {
  readonly type?: string;
}

export interface ModOptions {
  readonly group?: string;
}

export interface FormatDsl {
  view(name: string, fn: ViewFn): void;
  view(name: string, options: ViewOptions, fn: ViewFn): void;
  method(name: string, fn: ModFormatMethodFn): void;
  before(view: string, fn: ModFormatMethodFn): void;
  wrapper(name: string, body: DeclaredWrapperBody): void;
  wrapper<Values extends Readonly<Record<string,unknown>>>(name: string, tag: string, defaults?: Values & ModTagDeclaration<NoInfer<Values>>): void;
}

export interface SetDsl extends Pick<FormatDsl, "view" | "before"> {
  readonly setPath: string;
  format(body: (dsl: FormatDsl) => void): void;
  format(name: string | readonly string[], body: (dsl: FormatDsl) => void): void;
  event(name: string, fn?: ModEventFn): void;
  event(name: string, stage: ModEventStage, fn?: ModEventFn): void;
  event(name: string, options: EventOptions, fn?: ModEventFn): void;
  event(name: string, stage: ModEventStage, options: EventOptions, fn?: ModEventFn): void;
  setting(options: ModSettingOpts): void;
  accessor(name: string, options?: AccessorOptions): void;
  reader(name: string, options?: AccessorOptions): void;
  writer(name: string, options?: AccessorOptions): void;
  assignType(type: string): void;
  virtual(): void;
  content(fn: ContentFn): void;
  ruleSeed(seed: { name: string; content: string }): void;
  basketTask(task: ModBasketTask): void;
  basketWarning(name: string): void;
}

export interface ModDsl {
  readonly name: string;
  set(path: string, body: (dsl: SetDsl) => void): void;
  setPattern(code: string, spec: PatternSpec, options?: { index?: number }): void;
  prepareEngine(fn: (host: ModEngineHost) => Promise<void>): void;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const toList = <T>(value: T | readonly T[] | undefined): readonly T[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? (value as readonly T[]) : [value as T];

function defined<T extends object>(source: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

const BASE_FORMAT = "base";

class SetFileBuilder {
  readonly file: Mutable<ModSetModuleFile>;
  private readonly formats = new Map<string, ModViewDefinition[]>();
  private readonly formatMethodLists = new Map<string, ModFormatMethodDefinition[]>();

  constructor(setPath: string) {
    this.file = { setPath };
  }

  formatViews(name: string): ModViewDefinition[] {
    let views = this.formats.get(name);
    if (views === undefined) {
      views = [];
      this.formats.set(name, views);
      const blocks: Record<string, ModFormatBlock> = { ...(this.file.formats ?? {}) };
      blocks[name] = { views };
      this.file.formats = blocks;
    }
    return views;
  }

  push<K extends keyof ModSetModuleFile>(key: K, entry: unknown): void {
    const list = (this.file[key] as unknown[] | undefined) ?? [];
    list.push(entry);
    (this.file as Record<string, unknown>)[key] = list;
  }

  formatDsl(name: string): FormatDsl {
    const views = this.formatViews(name);
    const builder = this;
    return {
      view(viewName: string, optionsOrFn: ViewOptions | ViewFn, maybeFn?: ViewFn): void {
        const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
        if (fn === undefined) {
          throw new Error(`defineMod: view :${viewName} has no body`);
        }
        const config = typeof optionsOrFn === "function" ? undefined : defined(optionsOrFn);
        views.push(
          config === undefined || Object.keys(config).length === 0
            ? { view: viewName, viewFn: fn }
            : { view: viewName, viewFn: fn, config },
        );
      },
      before(viewName: string, fn: ModFormatMethodFn): void {
        builder.formatDsl(name).method(`_before_${viewName}`, fn);
      },
      method(methodName: string, fn: ModFormatMethodFn): void {
        let methods = builder.formatMethodLists.get(name);
        if (methods === undefined) {
          methods = [];
          builder.formatMethodLists.set(name, methods);
          builder.file.formats = {...builder.file.formats, [name]: {...builder.file.formats?.[name], methods}};
        }
        methods.push({name: methodName, fn});
      },
      wrapper(wrapperName: string, declaration: DeclaredWrapperBody | string, defaults?: Readonly<Record<string,unknown>>): void {
        const body = typeof declaration === "string" ? declaredTagWrapper(declaration, defaults) : declaration;
        const methods = declaredWrapperMethod(wrapperName, body);
        const dsl = builder.formatDsl(name);
        dsl.method(`_wrapper_${wrapperName}`, methods.implementation);
        dsl.method(`wrap_with_${wrapperName}`, methods.invocation);
      },
    } as FormatDsl;
  }

  dsl(): SetDsl {
    const builder = this;
    let baseFormat: FormatDsl | undefined;
    const accessorEntry = (name: string, reader: boolean, writer: boolean, options?: AccessorOptions): void => {
      const entry: ModCardAccessor = defined({ name, reader, writer, type: options?.type });
      builder.push("cardAccessors", entry);
    };
    return {
      setPath: builder.file.setPath,
      before(viewName: string, fn: ModFormatMethodFn): void {
        baseFormat ??= builder.formatDsl(BASE_FORMAT);
        baseFormat.before(viewName, fn);
      },
      view(name: string, optionsOrFn: ViewOptions | ViewFn, maybeFn?: ViewFn): void {
        baseFormat ??= builder.formatDsl(BASE_FORMAT);
        (baseFormat.view as (n: string, o: ViewOptions | ViewFn, f?: ViewFn) => void)(
          name,
          optionsOrFn,
          maybeFn,
        );
      },
      format(
        nameOrBody: string | readonly string[] | ((dsl: FormatDsl) => void),
        maybeBody?: (dsl: FormatDsl) => void,
      ): void {
        const names = typeof nameOrBody === "function" ? [BASE_FORMAT] : toList(nameOrBody)!;
        const body = typeof nameOrBody === "function" ? nameOrBody : maybeBody;
        if (body === undefined) throw new Error("defineMod: format block has no body");
        for (const formatName of names) body(builder.formatDsl(formatName));
      },
      event(name: string, ...rest: unknown[]): void {
        let stage: ModEventStage | undefined;
        let options: EventOptions = {};
        let fn: ModEventFn | undefined;
        for (const arg of rest) {
          if (typeof arg === "string") stage = arg as ModEventStage;
          else if (typeof arg === "function") fn = arg as ModEventFn;
          else if (arg !== undefined && arg !== null) options = arg as EventOptions;
        }
        const { engineOwned, ...opts } = options;
        if (engineOwned === true && fn !== undefined) {
          throw new Error(`defineMod: engine-owned event :${name} takes no body`);
        }
        const decl: Omit<ModEventRegistration, "fn"> = defined({
          event: name,
          at: stage,
          on: toList(opts.on),
          when: opts.when,
          changed: toList(opts.changed),
          changing: toList(opts.changing),
          skip: opts.skip,
          trigger: opts.trigger,
          after: opts.after,
          before: opts.before,
          priority: opts.priority,
        });
        builder.push("events", { ...decl, fn: fn ?? (() => undefined) });
      },
      setting(options: ModSettingOpts): void {
        if (builder.file.settingOpts !== undefined) {
          throw new Error(`defineMod: ${builder.file.setPath} already has setting_opts`);
        }
        builder.file.settingOpts = options;
      },
      accessor: (name, options) => accessorEntry(name, true, true, options),
      reader: (name, options) => accessorEntry(name, true, false, options),
      writer: (name, options) => accessorEntry(name, false, true, options),
      assignType(type: string): void {
        builder.file.assignsType = type;
      },
      virtual(): void {
        builder.file.virtual = true;
      },
      content(fn: ContentFn): void {
        builder.push("contentOverrides", fn);
      },
      ruleSeed(seed): void {
        builder.push("ruleSeeds", seed);
      },
      basketTask(task): void {
        builder.push("basketTasks", task);
      },
      basketWarning(name): void {
        builder.push("basketWarnings", name);
      },
    } as SetDsl;
  }
}

export function defineMod(gemName: string, body: (dsl: ModDsl) => void): DeckoModManifest;
export function defineMod(
  gemName: string,
  options: ModOptions,
  body: (dsl: ModDsl) => void,
): DeckoModManifest;
export function defineMod(
  gemName: string,
  optionsOrBody: ModOptions | ((dsl: ModDsl) => void),
  maybeBody?: (dsl: ModDsl) => void,
): DeckoModManifest {
  const options: ModOptions = typeof optionsOrBody === "function" ? {} : optionsOrBody;
  const body = typeof optionsOrBody === "function" ? optionsOrBody : maybeBody;
  if (body === undefined) throw new Error(`defineMod ${gemName}: no body`);

  const name = normalizeModName(gemName);
  const files: SetFileBuilder[] = [];
  const byPath = new Map<string, SetFileBuilder>();
  const patterns: ModPatternRegistration[] = [];
  let prepare: ((host: ModEngineHost) => Promise<void>) | undefined;

  body({
    name,
    set(path, setBody) {
      let builder = byPath.get(path);
      if (builder === undefined) {
        builder = new SetFileBuilder(path);
        byPath.set(path, builder);
        files.push(builder);
      }
      setBody(builder.dsl());
    },
    setPattern(code, spec, patternOptions) {
      patterns.push(
        patternOptions?.index === undefined ? { code, spec } : { code, spec, index: patternOptions.index },
      );
    },
    prepareEngine(fn) {
      if (prepare !== undefined) throw new Error(`defineMod ${gemName}: prepareEngine given twice`);
      prepare = fn;
    },
  });

  return defined({
    name,
    gemName: gemName === name ? undefined : gemName,
    group: options.group,
    setPatterns: patterns.length > 0 ? patterns : undefined,
    setModules: files.length > 0 ? files.map((f) => f.file as ModSetModuleFile) : undefined,
    prepareEngine: prepare,
  });
}
