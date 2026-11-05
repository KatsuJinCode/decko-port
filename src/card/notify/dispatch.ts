import type {
  NotifyContext,
  NotifyTransport,
  SavePathAct,
  SavePathEvent,
  SavePathIntegrationHook,
} from "./types.js";
import type { ActionResult } from "../actions/types.js";

export interface IntegrationDispatchInput {
  readonly actId: number;
  readonly actor: { readonly id: number; readonly name: string; readonly email: string | null };
  readonly silent: boolean;
  readonly events: readonly SavePathEvent[];
  readonly actCardName?: string | null;
  readonly hooks: readonly SavePathIntegrationHook[];
  readonly context: NotifyContext;
  readonly onError?: (err: unknown, hook: SavePathIntegrationHook, event: SavePathEvent) => void;
}

export async function runIntegrationHooks(
  input: IntegrationDispatchInput,
): Promise<IntegrationHookReceipt[]> {
  const receipts: IntegrationHookReceipt[] = [];
  const act: SavePathAct = {
    actId: input.actId,
    actor: input.actor,
    silent: input.silent,
    events: input.events,
    actCardName: input.actCardName ?? null,
  };
  for (const hook of input.hooks) {
    if (hook.fireAct !== undefined) {
      if (input.events.length === 0) continue;
      if (!hook.notable(input.events[0])) {
        receipts.push({ hook: hook.name ?? "<anonymous>", event: input.events[0], status: "skipped" });
        continue;
      }
      try {
        await hook.fireAct(act, input.context);
        receipts.push({ hook: hook.name ?? "<anonymous>", event: input.events[0], status: "fired" });
      } catch (err) {
        const handler = input.onError ?? ((e, h, ev) => {
          input.context.logger?.(`[notify] hook=${h.name ?? "?"} event=card#${ev.card?.id ?? "?"} failed: ${(e as Error).message}`);
        });
        handler(err, hook, input.events[0]);
        receipts.push({ hook: hook.name ?? "<anonymous>", event: input.events[0], status: "failed", error: err });
      }
      continue;
    }
    for (const event of input.events) {
      if (!hook.notable(event)) {
        receipts.push({ hook: hook.name ?? "<anonymous>", event, status: "skipped" });
        continue;
      }
      try {
        await hook.fire(event, input.context);
        receipts.push({ hook: hook.name ?? "<anonymous>", event, status: "fired" });
      } catch (err) {
        const handler = input.onError ?? ((e, h, ev) => {
          input.context.logger?.(`[notify] hook=${h.name ?? "?"} event=card#${ev.card?.id ?? "?"} failed: ${(e as Error).message}`);
        });
        handler(err, hook, event);
        receipts.push({ hook: hook.name ?? "<anonymous>", event, status: "failed", error: err });
      }
    }
  }
  return receipts;
}

export type IntegrationHookReceipt = {
  readonly hook: string;
  readonly event: SavePathEvent;
  readonly status: "fired" | "skipped" | "failed";
  readonly error?: unknown;
};

export function savePathEventFromAction(
  action: ActionResult,
  actor: { readonly id: number; readonly name: string; readonly email: string | null },
  actId: number,
  silent: boolean,
): SavePathEvent {
  return {
    card: action.name === undefined
      ? null
      : {
          id: action.cardId,
          name: action.name.s ?? null,
          leftName: action.name.leftName?.s ?? null,
          rightName: action.name.rightName?.s ?? null,
          type: null,
          content: null,
          trashed: action.verb === "delete",
        },
    verb: action.verb,
    actId,
    actionId: action.actionId,
    actor,
    silent,
    isDeletePath: action.verb === "delete",
  };
}

export function expandActionResultToSavePathEvents(
  action: ActionResult,
  actor: { readonly id: number; readonly name: string; readonly email: string | null },
  silent: boolean,
): SavePathEvent[] {
  const events: SavePathEvent[] = [];
  events.push(savePathEventFromAction(action, actor, action.actId, silent));
  for (const sub of action.subactions) {
    events.push(savePathEventFromAction(
      { ...sub, actId: action.actId, subactions: [] },
      actor,
      action.actId,
      silent,
    ));
  }
  return events;
}

export function makeNotifyContext(
  transport: NotifyTransport,
  logger?: (line: string) => void,
): NotifyContext {
  return { transport, ...(logger !== undefined ? { logger } : {}) };
}
