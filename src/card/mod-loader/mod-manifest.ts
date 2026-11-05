export type ModTagValue = string | number | boolean | null | readonly ModTagValue[] | {readonly [key:string]:ModTagValue};
export interface ModTagDataSerializer {toJSON(key:string):unknown;}
export type ModTagDataAttributes = Readonly<Record<string,unknown>>;
export type ModTagOptions<Values extends Readonly<Record<string,unknown>>=Readonly<Record<string,ModTagValue>>> = {
  readonly [Key in keyof Values]:Key extends 'data'?ModTagDataAttributes:ModTagValue;
};
export type ModTagDeclaration<Values extends Readonly<Record<string,unknown>>> =
  string extends keyof Values?Values:Values&ModTagOptions<Values>;

import type { ViewFn, ViewContext, ViewResult } from "../render/format.js";
import type { ContentFn } from "../render/content-overrides.js";
import type { PatternSpec } from "../set-patterns/registry.js";
import type { ModEventContext } from "./mod-event-dispatch.js";
export type { ModEventContext };

export type ModWrapperOptions = Readonly<{ class?: string } & Record<string, unknown>>;
export type ModViewWrapSpec = Readonly<Record<string, ModWrapperOptions>>;
export type ModViewWrapEntry = string | readonly [string, ModWrapperOptions];

export interface ModViewConfig {
  unknown?: boolean | string;

  perms?: string | readonly string[];

  cache?: string;

  wrap?: string | ModViewWrapEntry[] | ModViewWrapSpec;

  denial?: string;

  template?: string;
}

export interface ModViewDefinition {
  readonly view: string;

  readonly viewFn: ViewFn;

  readonly config?: ModViewConfig;
}

export interface ModFormatBlock {
  readonly views?: readonly ModViewDefinition[];
  readonly methods?: readonly ModFormatMethodDefinition[];
}

export type ModFormatMethodFn = (context: ViewContext, ...args: unknown[]) => ViewResult | boolean | undefined;
export interface ModFormatMethodDefinition {
  readonly name: string;
  readonly fn: ModFormatMethodFn;
}

export interface ModSettingOpts {
  readonly group?: string;

  readonly position?: number;

  readonly ruleTypeEditable?: boolean;

  readonly shortHelpText?: string;

  readonly helpText?: string;

  readonly restrictedToType?: readonly string[];

  readonly preference?: boolean;
}

export type ModEventStage =
  | "initialize"
  | "prepare_to_validate"
  | "validate"
  | "prepare_to_store"
  | "store"
  | "finalize"
  | "integrate"
  | "after_integrate"
  | "integrate_with_delay"
  | "extend"
  | "extend_with_delay";

export type ModEventTrigger = "create" | "update" | "delete" | "save";

export interface ModEventCard {
  readonly name: string;
  readonly id?: number;
  readonly dbContent?: string;
  readonly dbContentBeforeAct?: string | null;
  readonly key?: string;
  readonly action?: "create" | "update" | "delete";
  readonly trash?: boolean;
  readonly typeId?: number | null;
  readonly nameBeforeAct?: string;
  readonly changedFields?: readonly string[];
  readonly codename?: string;
  readonly typeIdBeforeAct?: number | null;
  readonly patternTypeId?: number | null;
  readonly receiverSetIdentities?: readonly {
    readonly name: string;
    readonly key?: string;
    readonly typeId?: number | null;
  }[];
  readonly params?: Readonly<Record<string, unknown>>;
  readonly defaultContent?: string | undefined;
  readonly authCurrentId?: number | null;
  readonly canApprove?: boolean;
  readonly alwaysOk?: boolean;
  readonly history?: boolean;
  readonly isActCard?: boolean;
  readonly storageType?: string;
  readonly explicitStorageType?: string;
  readonly assignedMod?: string;
  readonly storeCodedFiles?: boolean;
  readonly attachmentPresent?: boolean;
  readonly attachmentIsChanging?: boolean;
  readonly actionIdOfCachedUpload?: number | string;
  readonly setupApproved?: boolean;
  readonly envController?: boolean;
  readonly forceNotifications?: boolean;
  readonly password?: string | null;
  readonly silentChange?: boolean;
  readonly followable?: boolean;
  readonly expirePreferences?: boolean;
  readonly rollbackRequested?: boolean;
  readonly currentAction?: boolean;
  readonly lastActionIdBeforeEdit?: number | string | null;
  readonly recaptchaSettingChild?: boolean;
  readonly hasOkItemTypes?: boolean;
  readonly uniqueItems?: boolean;
  readonly currentStorageType?: string;
  readonly currentStorageBucket?: string | false;
  readonly currentStorageMod?: string | false;
  readonly savedStorageBucket?: string | false;
  readonly savedStorageMod?: string | false;
  readonly webStorage?: boolean;
  readonly bucketReadOnly?: boolean;
  readonly attachmentIdentifierContent?: string | null;
  readonly act?: ModEventActState;
}

export interface ModEventActState {
  readonly action: "create" | "update" | "delete";
  readonly actId?: number;
  readonly skip?: readonly string[];
  readonly forceSkip?: readonly string[];
  readonly trigger?: readonly string[];
}

export interface ModEventBodyOutcome {
  readonly successAppend?: { readonly id?: string; readonly view?: string };
  readonly signout?: boolean;
}

export type ModEventFn = (
  card: ModEventCard,
  host: ModEngineHost,
  ctx: ModEventContext,
) => void | ModEventBodyOutcome | Promise<void | ModEventBodyOutcome>;

export function engineOwnedEvent(decl: Omit<ModEventRegistration, "fn">): ModEventRegistration {
  return { ...decl, fn: () => undefined };
}

export interface ModEventRegistration {
  readonly event: string;

  readonly at?: ModEventStage;

  readonly on?: readonly ModEventTrigger[];

  readonly when?: string | ((card: ModEventCard) => unknown);

  readonly changed?: readonly string[];

  readonly changing?: readonly string[];

  readonly skip?: "allowed";

  readonly trigger?: "required";

  readonly after?: string;

  readonly before?: string;

  readonly priority?: number;

  readonly fn: ModEventFn;
}

export type ModContentOverride =
  | ContentFn
  | {
      readonly fn: ContentFn;
      readonly supersedesType?: boolean;
    };

export interface ModSetFormatInclude {
  readonly setPath: string;
  readonly only?: string | readonly string[];
  readonly except?: string | readonly string[];
}

export interface ModSetModuleFile {
  readonly setPath: string;

  readonly formats?: Readonly<Record<string, ModFormatBlock>>;

  readonly includeSetFormats?: readonly ModSetFormatInclude[];

  readonly includeSets?: readonly ModSetFormatInclude[];

  readonly settingOpts?: ModSettingOpts;

  readonly contentOverrides?: readonly ModContentOverride[];

  readonly membership?: "set-module-chain";

  readonly contentKeepsType?: boolean;

  readonly events?: readonly ModEventRegistration[];

  readonly virtual?: boolean;

  readonly assignsType?: string;

  readonly ruleSeeds?: readonly Readonly<{ name: string; content: string }>[];

  readonly basketTasks?: readonly ModBasketTask[];

  readonly basketWarnings?: readonly string[];

  readonly cardAccessors?: readonly ModCardAccessor[];
}

export interface ModCardAccessor {
  readonly name: string;
  readonly reader: boolean;
  readonly writer: boolean;
  readonly type?: string;
}

export interface ModBasketTask {
  readonly task: string;
  readonly mod: string;
  readonly irreversible?: boolean;
  readonly linkText: string;
  readonly description: string;
}

export interface ModPatternRegistration {
  readonly code: string;

  readonly spec: PatternSpec;

  readonly index?: number;
}

export interface DeckoModManifest {
  readonly name: string;

  readonly gemName?: string;

  readonly group?: string;

  readonly setPatterns?: readonly ModPatternRegistration[];

  readonly setModules?: readonly ModSetModuleFile[];

  readonly prepareEngine?: (host: ModEngineHost) => Promise<void>;
}

export interface ModEngineHost {
  fetchRenderCard(name: string): unknown;

  fetchByName?(name: string): Promise<unknown | undefined>;

  isDenied(card: unknown): boolean;

  batch(statements: readonly { sql: string; params: unknown[] }[]): Promise<unknown[]>;

  codenames: {
    ensureLoaded(): Promise<void>;
    peekId(code: string): number | undefined;
  };

  fetchById(id: number): Promise<
    | {
        name?: { s: string } | undefined;
        key?: string | undefined;
        leftId?: number | null | undefined;
        rightId?: number | null | undefined;
        dbContent?: string | undefined;
      }
    | undefined
  >;

  cacheFetchedRecord(record: unknown): Promise<void>;

  composeAndCacheRows(rows: readonly object[]): Promise<
    Array<{
      id?: number;
      name?: { s: string };
      key?: string;
      leftId?: number | null;
      rightId?: number | null;
    }>
  >;
}
