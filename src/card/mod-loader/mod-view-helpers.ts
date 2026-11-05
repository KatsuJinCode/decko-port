import type { ViewResult } from "../render/format.js";

import { emitAttrs, h, newSlotId, slotOptionsWithNameContext } from "../render/slot-html.js";
import { isNewCard } from "../fetch/card-record.js";
import { getDefaultModLoader, type ModLoader } from "../mod-loader.js";
import type { ViewContext, ViewFn } from "../render/format.js";
import type { ViewChainEntry } from "./mod-registrar.js";

function viewLoader(ctx: ViewContext): { loader: ModLoader | undefined; bound: boolean } {
  const engine = ctx.fmt.engine;
  if (engine !== undefined && "modLoader" in engine) {
    return { loader: (engine as typeof engine & { modLoader?: ModLoader }).modLoader, bound: true };
  }
  return { loader: getDefaultModLoader(), bound: false };
}

function slotId(card: ViewContext["fmt"]["card"], view: string): string {
  return `${card.name.safeKey}-${view}-view`;
}

export function viewWrapInherited(ctx: ViewContext, view: string, body: string): string {
  const spec = viewLoader(ctx).loader?.viewWrapForCard(ctx.fmt.card.setKeys, view, ctx.fmt.formatName);
  const div = spec?.["div"];
  if (div === undefined) return body;
  return `<div${emitAttrs({ class: div.class })}>${body}</div>`;
}

export function modSlotWrap(
  ctx: ViewContext,
  view: string,
  inner: string,
  extraClasses = "",
  extraData: Record<string, string> = {},
): string {
  const { fmt, voo } = ctx;
  const card = fmt.card;
  const classes = [
    voo.classy(["card-slot", `${view}-view`, card.setKeys]),
    extraClasses,
  ]
    .filter((s) => s !== "")
    .join(" ");
  const attrs = emitAttrs({
    id: slotId(card, view),
    class: classes,
    "data-card-id": card.id === undefined ? undefined : String(card.id),
    "data-card-name": isNewCard(card.record) && card.name.isCompound ? card.name.urlKey : card.name.s,
    "data-card-type-id": card.typeId === undefined ? undefined : String(card.typeId),
    "data-card-type-name": card.typeName,
    "data-card-link-name": fmt.urlKey(),
    "data-slot-id": newSlotId(),
    "data-slot": slotOptionsWithNameContext(fmt, voo),
    ...extraData,
  });
  return `<div${attrs}>${inner}</div>`;
}

export function wrappedView(view: string, body: (ctx: ViewContext) => string): ViewFn {
  return (ctx) => modSlotWrap(ctx, view, body(ctx));
}

import { HTML_VIEWS, baseTableEntry } from "../render/views.js";

export function superView(
  ctx: ViewContext,
  currentModule: string,
  view: string,
): ViewResult {
  const step = superViewStep(ctx, currentModule, view);
  if (step.kind === "next" || step.kind === "base") return step.body;
  return "";
}

export type SuperViewStep =
  | { kind: "not-in-chain" }
  | { kind: "next"; body: ViewResult }
  | { kind: "base"; body: ViewResult }
  | { kind: "empty" };

interface SuperFrame {
  readonly view: string;
  readonly chain: readonly ViewChainEntry[];
  readonly index: number;
}
const superFrames = new WeakMap<ViewContext, SuperFrame[]>();

export function superViewStep(
  ctx: ViewContext,
  currentModule: string,
  view: string,
): SuperViewStep {
  const { loader, bound } = viewLoader(ctx);
  if (loader === undefined) return { kind: "empty" };
  const card = ctx.fmt.card;
  const frames = superFrames.get(ctx);
  const active = frames?.at(-1);
  const chain = active?.view === view ? active.chain : loader.viewChain(card.setKeys, view, ctx.fmt.formatName);
  const idx = active?.view === view && chain[active.index]?.setModule === currentModule
    ? active.index : chain.findIndex((entry) => entry.setModule === currentModule);
  if (idx === -1) {
    return { kind: "not-in-chain" };
  }
  const next = chain[idx + 1];
  if (next !== undefined) {
    const stack = frames ?? [];
    if (frames === undefined) superFrames.set(ctx, stack);
    stack.push({view, chain, index: idx + 1});
    try {return {kind: "next", body: next.viewFn(ctx)};}
    finally {
      stack.pop();
      if (stack.length === 0) superFrames.delete(ctx);
    }
  }
  const base = bound ? baseTableEntry(view)
    : Object.hasOwn(HTML_VIEWS, view) ? HTML_VIEWS[view] : undefined;
  if (base === undefined) return { kind: "empty" };
  return { kind: "base", body: base(ctx) };
}
