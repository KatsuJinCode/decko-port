import { randomBytes } from "node:crypto";
import { cardWallClockNow, setCaptureWallClock } from "./wall-clock.js";
import {
  RECORDED_HOST_TIME_ZONE,
  formatCardDayofwkMinTz,
} from "./deck-time-zone.js";

import { getDefaultModLoader } from "./mod-loader.js";
import {
  bootstrapCoreContent,
  bootstrapFunctionsContent,
} from "./render/bootstrap-code-files.js";
import { listInputOptionsContent, toPointerContent } from "./render/content-overrides.js";

export { listInputOptionsContent, toPointerContent };

export const RECORDED_NOW_INSTANT: Date = new Date(
  "2026-09-28T22:12:00Z",
);

export const ORACLE_CAPTURE_NOW_BYTES = "Monday, September 28, 2026 03:12 PM PDT";

export const RECORDED_BYTES_ZONE = {
  ianaTimeZone: RECORDED_HOST_TIME_ZONE,
  zoneName: "PDT",
} as const;

export { setCaptureWallClock, cardWallClockNow };

export { formatCardDayofwkMinTz };

function sqlDateTimeToDate(sql: string): Date {
  const iso = `${sql.replace(" ", "T")}Z`;
  return new Date(iso);
}

function nowContent(): string {
  return formatCardDayofwkMinTz(cardWallClockNow());
}

const CARDIO_VERSION_RELEASE = "0.20.0";

const ALERTS_CONTENT = "<!-- *alerts is deprecated. please remove from layout -->";

const FOOT_CONTENT = "<!-- *foot is deprecated. please remove from layout -->";

export const CARDIO_MOD_ADDRESS_HEX_DIGITS = 16;

const CARDIO_MOD_CLASS_NAME = "Cardio::Mod";

let modIdentityCursor: bigint | undefined;
let modIdentityMask: bigint | undefined;

function nextModIdentity(): bigint {
  if (modIdentityCursor === undefined || modIdentityMask === undefined) {
    let seed = 0n;
    for (const byte of randomBytes(8)) seed = (seed << 8n) | BigInt(byte);
    modIdentityMask = (1n << 56n) - 1n;
    modIdentityCursor = (seed >> 8n) & modIdentityMask;
  }
  modIdentityCursor = (modIdentityCursor + 1n) & modIdentityMask;
  return modIdentityCursor;
}

export interface CardioModObject {
  readonly name: string;
  readonly identity: bigint;
}

export function modObjectToS(mod: CardioModObject): string {
  const address = mod.identity
    .toString(16)
    .padStart(CARDIO_MOD_ADDRESS_HEX_DIGITS, "0");
  return `#<${CARDIO_MOD_CLASS_NAME}:0x${address}>`;
}

export function deckModObjects(): readonly CardioModObject[] {
  const names = getDefaultModLoader()?.modNames() ?? ["core"];
  return names.map((name) => ({ name, identity: nextModIdentity() }));
}

export function modItemCodesContentForMods(
  mods: readonly CardioModObject[],
): string {
  return toPointerContent(mods.map((mod) => `${modObjectToS(mod)}_mod`));
}

export function modItemCodesContent(): string {
  return modItemCodesContentForMods(deckModObjects());
}

function sessionContent(dbContent: string | null | undefined): string {
  return dbContent ?? "";
}

function whenCreatedContent(card: SetModuleContentCard): string {
  if (card.leftIsReal !== true || card.leftCreatedAt === undefined) return "";
  return formatCardDayofwkMinTz(sqlDateTimeToDate(card.leftCreatedAt));
}

function whenLastEditedContent(card: SetModuleContentCard): string {
  if (card.leftIsReal !== true || card.leftUpdatedAt === undefined) return "";
  return formatCardDayofwkMinTz(sqlDateTimeToDate(card.leftUpdatedAt));
}

export interface SetModuleContentCard {
  readonly key: string;
  readonly name: string;
  readonly codename?: string | null;
  readonly typeCode?: string | null;
  readonly dbContent: string | null | undefined;
  readonly partCodenames?: readonly (string | null)[];
  readonly leftIsReal?: boolean;
  readonly leftCreatedAt?: string | undefined;
  readonly leftUpdatedAt?: string | undefined;
}

const SELF_MODULE_CHAINS: ReadonlyMap<string, (card: SetModuleContentCard) => string> =
  new Map([
    ["now", () => nowContent()],
    ["version", () => CARDIO_VERSION_RELEASE],
    ["alerts", () => ALERTS_CONTENT],
    ["foot", () => FOOT_CONTENT],
    ["mod", () => modItemCodesContent()],
    [
      "input_type+right+content_options",
      () => listInputOptionsContent(),
    ],
    ["bootstrap_core", () => bootstrapCoreContent(undefined as never)],
    ["bootstrap_functions", () => bootstrapFunctionsContent(undefined as never)],
  ]);

const RIGHT_MODULE_TAGS: ReadonlyMap<string, (card: SetModuleContentCard) => string> =
  new Map([
    ["when_created", whenCreatedContent],
    ["when_last_edited", whenLastEditedContent],
  ]);

const TYPE_MODULE_CODENAMES: ReadonlyMap<
  string,
  (card: SetModuleContentCard) => string
> = new Map([["session", (card) => sessionContent(card.dbContent)]]);

export function resolveSetModuleContent(
  card: SetModuleContentCard,
): string | undefined {
  const parts = card.partCodenames;
  if (parts !== undefined && parts.length > 0 && parts.every((p) => p !== null)) {
    const selfFn = SELF_MODULE_CHAINS.get(parts.join("+"));
    if (selfFn !== undefined) return selfFn(card);
  }
  if (parts !== undefined && parts.length > 1) {
    const tag = parts[parts.length - 1];
    if (tag !== null) {
      const rightFn = RIGHT_MODULE_TAGS.get(tag);
      if (rightFn !== undefined) return rightFn(card);
    }
  }
  if (card.typeCode != null) {
    const typeFn = TYPE_MODULE_CODENAMES.get(card.typeCode);
    if (typeFn !== undefined) return typeFn(card);
  }
  return undefined;
}
