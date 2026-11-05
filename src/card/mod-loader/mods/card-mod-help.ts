import { str } from "../../render/format.js";

import type { ViewContext, ViewFn } from "../../render/format.js";
import { ruleNamesForCard } from "../../set-patterns/rule-names.js";
import type { PatternCardInput } from "../../set-patterns/types.js";
import type { ModEngineHost } from "../mod-manifest.js";
import { defineMod } from "../mod-dsl.js";
import { modSlotWrap } from "../mod-view-helpers.js";
import { processHelpContent } from "../../render/help-popover.js";
import { parseNestOptions } from "../../render/nest-syntax.js";
import { warmRuleCards } from "./rule-card-warm.js";
import { popoverLink } from "./card-mod-bootstrap.js";

function helpRuleCard(ctx: ViewContext): ReturnType<ViewContext["fmt"]["engine"]["fetchRenderCard"]> {
  const card = ctx.fmt.card;
  const input: PatternCardInput = {
    name: card.name.s,
    id: card.id,
    typeId: card.typeId,
    typeName: card.typeName,
    ...(card.id === undefined ? { isNew: true } : {}),
  };
  if (card.name.isCompound) {
    const leftKey = card.name.leftName?.key;
    const left =
      leftKey !== undefined ? ctx.fmt.engine.fetchRenderCard(leftKey) : undefined;
    input.leftTypeName = left?.typeName;
  }
  for (const candidate of ruleNamesForCard(input, "*help")) {
    const record = ctx.fmt.engine.fetchRenderCard(candidate);
    if (record === undefined) continue;
    if (ctx.fmt.engine.isDenied(record)) continue;
    return record;
  }
  return undefined;
}

function rawHelpText(ctx: ViewContext): string | undefined {
  const ruleCard = helpRuleCard(ctx);
  return ruleCard === undefined ? undefined : ruleCard.dbContent;
}

function ruleBasedHelp(ctx: ViewContext): string {
  const raw = rawHelpText(ctx);
  if (raw === undefined) return "";
  return processHelpContent(ctx.fmt, raw);
}

function helpText(ctx: ViewContext): string {
  const vooHelp = ctx.voo.opts["help"];
  if (typeof vooHelp === "string" && vooHelp !== "") return vooHelp;
  return ruleBasedHelp(ctx);
}

function wrapHelpText(ctx: ViewContext, text: string): string {
  const ruleCard = helpRuleCard(ctx);
  if (ruleCard === undefined) return text;
  const href = `/${ruleCard.name.urlKey}/rule_edit`;
  const editLink =
    `<a rel="nofollow" class="edit-link slotter" title="Edit" data-bs-toggle="tooltip"` +
    ` data-bs-placement="bottom" data-slotter-mode="modal" data-modal-class="modal-lg"` +
    ` href="${href}" data-remote="true"><i class="notranslate material-icons">edit</i> </a>`;
  return `<span class='d-none'>${editLink}</span>${text}`;
}

export const helpView: ViewFn = (ctx) => {
  const help = helpText(ctx);
  const body = /^\s*$/.test(help)
    ? ""
    : `<div class="${ctx.voo.classy("help-text")}">${wrapHelpText(ctx, help)}</div>`;
  return modSlotWrap(ctx, "help", body);
};

export const helpTextView: ViewFn = (ctx) => wrapHelpText(ctx, helpText(ctx));

export const leadView: ViewFn = (ctx) => {
  ctx.voo.classUp("card-slot", "lead");
  return modSlotWrap(ctx, "lead", str(ctx.fmt.renderView("core")));
};

const popoverView: ViewFn = (ctx) => {
  return popoverLink(str(ctx.fmt.renderView("core")));
};

function guideRuleCard(ctx: ViewContext): ReturnType<ViewContext["fmt"]["engine"]["fetchRenderCard"]> {
  const card = ctx.fmt.card;
  const input: PatternCardInput = {
    name: card.name.s,
    id: card.id,
    typeId: card.typeId,
    typeName: card.typeName,
    ...(card.id === undefined ? { isNew: true } : {}),
  };
  if (card.name.isCompound) {
    const leftKey = card.name.leftName?.key;
    const left =
      leftKey !== undefined ? ctx.fmt.engine.fetchRenderCard(leftKey) : undefined;
    input.leftTypeName = left?.typeName;
  }
  for (const candidate of ruleNamesForCard(input, "*guide")) {
    const record = ctx.fmt.engine.fetchRenderCard(candidate);
    if (record === undefined) continue;
    if (ctx.fmt.engine.isDenied(record)) continue;
    return record;
  }
  return undefined;
}

function guideText(ctx: ViewContext): string {
  const guideCard = guideRuleCard(ctx);
  if (guideCard === undefined) return "";
  return ctx.fmt.nest({
    syntax: `{{${guideCard.name.s}|view:core}}`,
    name: guideCard.name.s,
    options: parseNestOptions("view:core"),
    comment: undefined,
  });
}

function prependGuideEditLink(ctx: ViewContext, text: string): string {
  const guideCard = guideRuleCard(ctx);
  if (guideCard === undefined) return text;
  const taskAllowed = ctx.fmt.engine.taskAllowed?.(guideCard, "update");
  if (taskAllowed !== true) return text;
  const href = `/${guideCard.name.urlKey}/rule_edit`;
  const editLink =
    `<a rel="nofollow" class="edit-link slotter" title="Edit" data-bs-toggle="tooltip"` +
    ` data-bs-placement="bottom" data-slotter-mode="modal" data-modal-class="modal-lg"` +
    ` href="${href}" data-remote="true"><i class="notranslate material-icons">edit</i> </a>`;
  return `<span class='d-none'>${editLink}</span>${text}`;
}

function guideInnerHtml(ctx: ViewContext): string {
  const text = guideText(ctx);
  if (text === "") return "";
  return `<div class="guide-text">${prependGuideEditLink(ctx, text)}</div>`;
}

export const guideView: ViewFn = (ctx) => modSlotWrap(ctx, "guide", guideInnerHtml(ctx));

async function prepareHelpAndGuideRules(host: ModEngineHost): Promise<void> {
  await host.codenames.ensureLoaded();
  const setTypeId = host.codenames.peekId("set");
  const settingTypeId = host.codenames.peekId("setting");
  if (setTypeId === undefined || settingTypeId === undefined) return;
  await warmRuleCards(host, setTypeId, settingTypeId, ["help"]);
  await warmRuleCards(host, setTypeId, settingTypeId, ["guide"]);
}

const cardModHelp = defineMod("card-mod-help", { group: "gem-defaults" }, ({ set, prepareEngine }) => {
  set("all/help", ({ format }) => {
    format("html", ({ view }) => {
      view("help", { unknown: true, cache: "never", wrap: "slot" }, helpView);
      view("help_text", { unknown: true, cache: "never" }, helpTextView);
      view("lead", leadView);
    });
  });

  set("all/guide", ({ format }) => {
    format("html", ({ view }) => {
      view("guide", { unknown: true, cache: "never", wrap: "slot" }, guideView);
    });
  });

  set("self/help", ({ setting }) => {
    setting({
      group: "editing",
      position: 1,
      ruleTypeEditable: true,
      shortHelpText: "help text people will see when editing",
      helpText: "[[http://decko.org/custom_help_text|Help text]] people will see when editing.",
    });
  });

  set("self/guide", ({ setting }) => {
    setting({
      group: "editing",
      position: 3,
      ruleTypeEditable: true,
      shortHelpText: "appears in the full editor view to guide users",
    });
  });

  set("right/help", ({ format }) => {
    format("html", ({ view }) => {
      view("popover", popoverView);
    });
  });

  prepareEngine(prepareHelpAndGuideRules);
});

export default cardModHelp;
