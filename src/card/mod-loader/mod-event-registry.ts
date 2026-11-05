import type {
  ModEventFn,
  ModEventRegistration,
  ModEventStage,
  ModEventTrigger,
} from "./mod-manifest.js";

export type {
  ModEventCard,
  ModEventFn,
  ModEventRegistration,
  ModEventStage,
  ModEventTrigger,
} from "./mod-manifest.js";

export interface RegisteredModEvent {
  readonly event: string;
  readonly setPath: string;
  readonly modName: string;
  readonly at?: ModEventStage;
  readonly on?: readonly ModEventTrigger[];
  readonly when?: ModEventRegistration["when"];
  readonly changed?: readonly string[];
  readonly changing?: readonly string[];
  readonly skip?: "allowed";
  readonly trigger?: "required";
  readonly after?: string;
  readonly before?: string;
  readonly priority?: number;
  readonly fn: ModEventFn;
}

export const EVENT_API_OPTIONS: Readonly<
  Record<"on" | "changed" | "changing" | "skip" | "trigger", readonly string[]>
> = {
  on: ["create", "update", "delete", "save", "read"],
  changed: [
    "name",
    "db_content",
    "trash",
    "type_id",
    "left_id",
    "right_id",
    "codename",
    "type",
    "content",
  ],
  changing: [
    "name",
    "db_content",
    "trash",
    "type_id",
    "left_id",
    "right_id",
    "codename",
    "type",
    "content",
  ],
  skip: ["allowed"],
  trigger: ["required"],
};

const EVENT_CONDITION_NAMES = [...Object.keys(EVENT_API_OPTIONS), "when"];

const REGISTRATION_STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  "event",
  "fn",
  "setPath",
  "modName",
]);

const OPTION_EXEMPT_KEYS: ReadonlySet<string> = new Set([
  "at",
  "before",
  "after",
  "priority",
]);

export function validateConditions(entry: RegisteredModEvent): void {
  const event = entry.event;
  const record = entry as unknown as Record<string, unknown>;
  for (const key of Object.keys(entry)) {
    if (REGISTRATION_STRUCTURAL_KEYS.has(key)) continue;
    if (OPTION_EXEMPT_KEYS.has(key)) continue;
    switch (key) {
      case "on":
      case "changed":
      case "changing":
      case "skip":
      case "trigger":
        validateConditionValue(key, record[key], event);
        break;
      case "when":
        validateWhenValue(record[key], event);
        break;
      default:
        validateConditionName(key, event);
    }
  }
}

function validateConditionName(condition: string, event: string): void {
  if (EVENT_CONDITION_NAMES.includes(condition)) return;
  throw new Error(
    `invalid condition key '${condition}' in event '${event}'\n` +
      `valid conditions are ${EVENT_CONDITION_NAMES.join(", ")}`,
  );
}

function validateConditionValue(
  condition: "on" | "changed" | "changing" | "skip" | "trigger",
  value: unknown,
  event: string,
): void {
  validateStandardConditionValue(condition, value, event);
}

function validateStandardConditionValue(
  condition: "on" | "changed" | "changing" | "skip" | "trigger",
  value: unknown,
  event: string,
): void {
  const invalid = invalidConditionValues(condition, value);
  if (invalid.length === 0) return;
  const list = invalid.join(", ");
  const plural = invalid.length > 1 ? "s" : "";
  throw new Error(
    `invalid option${plural} '${list}' for condition '${condition}' in event '${event}'`,
  );
}

function invalidConditionValues(
  condition: "on" | "changed" | "changing" | "skip" | "trigger",
  value: unknown,
): string[] {
  const wrapped = Array.isArray(value) ? value.map(String) : [String(value)];
  return wrapped.filter((v) => !EVENT_API_OPTIONS[condition].includes(v));
}

function validateWhenValue(value: unknown, event: string): void {
  if (typeof value === "string" || typeof value === "function") return;
  throw new Error(
    `invalid value for condition 'when' in event '${event}'\n` +
      "must be a symbol or a proc",
  );
}

export class ModEventRegistry {
  private readonly events: RegisteredModEvent[] = [];

  register(entry: RegisteredModEvent): void {
    validateConditions(entry);
    this.events.push(entry);
  }

  all(): RegisteredModEvent[] {
    return [...this.events];
  }

  forStage(stage: ModEventStage): RegisteredModEvent[] {
    return this.events.filter((entry) => entry.at === stage);
  }

  forEvent(name: string): RegisteredModEvent | undefined {
    return this.events.find((entry) => entry.event === name);
  }

  clear(): void {
    this.events.length = 0;
  }

  size(): number {
    return this.events.length;
  }
}

let defaultRegistry: ModEventRegistry | undefined;

export function setDefaultModEventRegistry(
  registry: ModEventRegistry | undefined,
): void {
  defaultRegistry = registry;
}

export function eventsForStage(stage: ModEventStage): RegisteredModEvent[] {
  return defaultRegistry?.forStage(stage) ?? [];
}
