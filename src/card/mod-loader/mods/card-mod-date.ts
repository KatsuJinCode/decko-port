import { isNewCard } from "../../fetch/card-record.js";
import {
  ContentOverrideRegistry,
  setDefaultContentOverrideRegistry,
  type ContentFn,
  type RegisteredContentOverride,
} from "../../render/content-overrides.js";
import type { RenderFormat } from "../../render/format.js";
import type { DeckoModManifest } from "../mod-manifest.js";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function formatDayofwkMinTz(date: Date): string {
  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const month = MONTH_NAMES[date.getUTCMonth()];
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = date.getUTCFullYear();
  const hour24 = date.getUTCHours();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const hour = String(hour12).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const ampm = hour24 < 12 ? "AM" : "PM";
  return `${weekday}, ${month} ${day}, ${year} ${hour}:${minute} ${ampm} UTC`;
}

function sqlDateTimeToDate(sql: string): Date {
  const iso = `${sql.replace(" ", "T")}Z`;
  return new Date(iso);
}

function isRealRecord(card: RenderFormat["card"]["record"]): boolean {
  return !isNewCard(card) && !card.trash;
}

function leftRenderCard(fmt: RenderFormat): RenderFormat["card"] | undefined {
  const card = fmt.card;
  const leftName = card.name.leftName;
  if (leftName === undefined) return undefined;
  return fmt.engine.fetchRenderCard(leftName.s);
}

export const whenCreatedContentFn: ContentFn = (fmt) => {
  const left = leftRenderCard(fmt);
  if (left === undefined || !isRealRecord(left.record)) return "";
  const createdAt = left.record.createdAt;
  if (createdAt === undefined || createdAt === "") return "";
  return formatDayofwkMinTz(sqlDateTimeToDate(createdAt));
};

export const whenLastEditedContentFn: ContentFn = (fmt) => {
  const left = leftRenderCard(fmt);
  if (left === undefined) return "";
  if (!isRealRecord(left.record)) return "";
  const updatedAt = left.record.updatedAt;
  if (updatedAt === undefined || updatedAt === "") {
    return "";
  }
  return formatDayofwkMinTz(sqlDateTimeToDate(updatedAt));
};

export const nowContentFn: ContentFn = (_fmt) => {
  return formatDayofwkMinTz(new Date());
};

export const dateContentOverrideEntries: readonly RegisteredContentOverride[] = [
  { setPath: "right/when_created", modName: "date", fn: whenCreatedContentFn },
  { setPath: "right/when_last_edited", modName: "date", fn: whenLastEditedContentFn },
  { setPath: "self/now", modName: "date", fn: nowContentFn },
] as const;

export function wireDateContentOverrides(): ContentOverrideRegistry {
  const registry = new ContentOverrideRegistry();
  for (const entry of dateContentOverrideEntries) registry.register(entry);
  setDefaultContentOverrideRegistry(registry);
  return registry;
}

const cardModDate: DeckoModManifest = {
  name: "date",
  gemName: "card-mod-date",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "all/calendar",
      formats: {
        html: {
          views: [],
        },
      },
    },
    {
      setPath: "right/when_created",
      contentOverrides: [whenCreatedContentFn],
      formats: {
        html: {
          views: [],
        },
      },
    },
    {
      setPath: "right/when_last_edited",
      contentOverrides: [whenLastEditedContentFn],
      formats: {
        html: {
          views: [],
        },
      },
    },
    {
      setPath: "self/now",
      contentOverrides: [nowContentFn],
      formats: {
        html: {
          views: [],
        },
      },
    },
    {
      setPath: "type/date",
      formats: {
        html: {
          views: [],
        },
      },
    },
  ],
};

export default cardModDate;