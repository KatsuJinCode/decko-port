import { ruleNamesForCard, settingCardNameForCode } from "../../set-patterns/rule-names.js";
import type { PatternCardInput } from "../../set-patterns/types.js";
import type {
  DeckoModManifest,
  ModEngineHost,
  ModEventCard,
  ModEventFn,
} from "../mod-manifest.js";

export interface ObserverCardRef {
  readonly name: string;

  readonly dbContent: string;

  readonly typeName?: string | undefined;
}

export interface ObserverLookup {
  fetch(name: string, context: string | undefined): ObserverCardRef | undefined;

  isListCard(card: ObserverCardRef): boolean;
}

export type ObserverTrigger = PatternCardInput;

export type EventCardDeliver = (eventCard: ObserverCardRef, trigger: ObserverTrigger) => void;

function rawItemStrings(content: string): string[] {
  if (content === "") return [];
  return content
    .split(/\n+/)
    .map((item) => item.replace(/\[\[|\]\]/g, "").trim());
}

function itemCardsOf(
  card: ObserverCardRef,
  lookup: ObserverLookup,
): (ObserverCardRef | undefined)[] {
  return rawItemStrings(card.dbContent).map((raw) =>
    lookup.fetch(raw, card.name),
  );
}

export function recursedItemCards(
  card: ObserverCardRef,
  lookup: ObserverLookup,
): ObserverCardRef[] {
  const list: ObserverCardRef[] = [];
  const book = new Set<string>();
  let items: (ObserverCardRef | undefined)[] = lookup.isListCard(card)
    ? itemCardsOf(card, lookup)
    : [card];
  while (items.length > 0) {
    const item = items.shift();
    if (item === undefined) {
      throw new Error(
        "recursed_item_cards: unfetchable item card " +
          "(Ruby: NoMethodError on nil.recursable_items?, recursed.rb:34)",
      );
    }
    if (book.has(item.name)) continue;
    book.add(item.name);
    if (lookup.isListCard(item)) {
      items = [
        ...itemCardsOf(item, lookup).filter(
          (nested): nested is ObserverCardRef => nested !== undefined,
        ),
        ...items,
      ];
    } else {
      list.push(item);
    }
  }
  return list;
}

export function eventCards(
  trigger: ObserverTrigger,
  settingCode: string,
  lookup: ObserverLookup,
  cache?: readonly ObserverCardRef[] | undefined,
): ObserverCardRef[] {
  if (cache !== undefined) return [...cache];
  const rule = observerRuleCard(trigger, settingCode, lookup);
  if (rule === undefined) return [];
  return recursedItemCards(rule, lookup);
}

export function observerRuleCard(
  trigger: ObserverTrigger,
  settingCode: string,
  lookup: ObserverLookup,
): ObserverCardRef | undefined {
  const settingName = settingCardNameForCode(settingCode);
  for (const candidate of ruleNamesForCard(trigger, settingName)) {
    const found = lookup.fetch(candidate, undefined);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function executeCardEvents(
  args: { on: "create" | "update" | "delete" },
  trigger: ObserverTrigger,
  lookup: ObserverLookup,
  deliver: EventCardDeliver,
  cache?: readonly ObserverCardRef[] | undefined,
): void {
  const setting = `on_${args.on}`;
  for (const eventCard of eventCards(trigger, setting, lookup, cache)) {
    deliver(eventCard, trigger);
  }
}

export function cacheDeleteCardEvents(
  trigger: ObserverTrigger,
  lookup: ObserverLookup,
): ObserverCardRef[] {
  return eventCards(trigger, "on_delete", lookup);
}

export const OBSERVER_EVENT_DECLARATIONS = [
  { event: "observer_create", stage: "integrate", on: "create" },
  { event: "observer_update", stage: "integrate", on: "update" },
  { event: "observer_delete", stage: "integrate", on: "delete" },
  { event: "cache_delete_card_events", stage: "store", on: "delete" },
] as const;

export function observerLookupFromHost(host: ModEngineHost): ObserverLookup {
  return {
    fetch: (name: string, _context: string | undefined) => {
      const fetched = host.fetchRenderCard(name) as
        | { name?: { s: string }; dbContent?: string; typeName?: string }
        | undefined;
      if (fetched === undefined) return undefined;
      return {
        name: fetched.name?.s ?? name,
        dbContent: fetched.dbContent ?? "",
        typeName: fetched.typeName,
      };
    },
    isListCard: (c) =>
      c.typeName === "list" ||
      c.typeName === "listed" ||
      c.typeName === "List",
  };
}

export const NO_OP_DELIVER: EventCardDeliver = () => {
};

const deleteEventCache = new Map<string, readonly ObserverCardRef[]>();

function makeObserverEventFn(
  action: "create" | "update" | "delete",
): ModEventFn {
  return (card: ModEventCard, host: ModEngineHost) => {
    const lookup = observerLookupFromHost(host);
    const memo =
      action === "delete" ? deleteEventCache.get(card.name) : undefined;
    if (action === "delete") deleteEventCache.delete(card.name);
    executeCardEvents({ on: action }, { name: card.name }, lookup, NO_OP_DELIVER, memo);
  };
}

function cacheDeleteCardEventsFn(
  card: ModEventCard,
  host: ModEngineHost,
): void {
  const lookup = observerLookupFromHost(host);
  const memo = cacheDeleteCardEvents({ name: card.name }, lookup);
  deleteEventCache.set(card.name, memo);
}

export const ASSIGN_TYPE_DECLARATIONS = [
  { setPath: "right/on_create", setModule: "Right::OnCreate", type: "list" },
  { setPath: "right/on_delete", setModule: "Right::OnDelete", type: "list" },
  { setPath: "right/on_update", setModule: "Right::OnUpdate", type: "list" },
] as const;

const cardModIntegrate: DeckoModManifest = {
  name: "integrate",
  gemName: "card-mod-integrate",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "all/observer",
      events: [
        {
          event: "observer_create",
          at: "integrate",
          on: ["create"],
          fn: makeObserverEventFn("create"),
        },
        {
          event: "observer_update",
          at: "integrate",
          on: ["update"],
          fn: makeObserverEventFn("update"),
        },
        {
          event: "observer_delete",
          at: "integrate",
          on: ["delete"],
          fn: makeObserverEventFn("delete"),
        },
        {
          event: "cache_delete_card_events",
          at: "store",
          on: ["delete"],
          fn: cacheDeleteCardEventsFn,
        },
      ],
    },
    {
      setPath: "right/on_create",
      assignsType: "list",
    },
    {
      setPath: "right/on_delete",
      assignsType: "list",
    },
    {
      setPath: "right/on_update",
      assignsType: "list",
    },
    {
      setPath: "self/on_create",
      settingOpts: {
        group: "event",
        position: 1,
        ruleTypeEditable: false,
        helpText: "Configure events to be executed when card is created",
      },
    },
    {
      setPath: "self/on_delete",
      settingOpts: {
        group: "event",
        position: 3,
        ruleTypeEditable: false,
        helpText: "Configure events to be executed when card is deleted",
      },
    },
    {
      setPath: "self/on_update",
      settingOpts: {
        group: "event",
        position: 2,
        ruleTypeEditable: false,
        helpText: "Configure events to be executed when card is updated",
      },
    },
    {
      setPath: "self/thanks",
      settingOpts: {
        group: "other",
        position: 3,
        ruleTypeEditable: false,
        shortHelpText: "destination after card is created",
        helpText:
          "Destination after card is created. " +
          "[[http://decko.org/Custom_thank_you_messages_for_forms|more]]",
      },
    },
  ],
};

export default cardModIntegrate;
