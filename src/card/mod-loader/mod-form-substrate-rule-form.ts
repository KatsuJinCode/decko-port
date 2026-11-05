import { str } from "../render/format.js";

import { h } from "../render/slot-html.js";
import { RenderFormat, Voo, type ViewContext, type ViewFn } from "../render/format.js";
import { DeckoName } from "../name.js";
import { modSlotWrap } from "./mod-view-helpers.js";
import {
  parseSetName,
  labelForParsedSet,
  uncapitalizedLabelForParsedSet,
} from "../set-patterns/set-name.js";
import { setNamesForCard } from "../set-patterns/card-patterns.js";
import type { PrototypeArgs } from "../set-patterns/types.js";
import {
  cardFormShell,
  iconTag,
  modalDialogWrap,
  overlayCloseButton,
  popoverLink,
  radioButtonTag,
  ruleDeleteButtonLink,
  standardSaveAndCloseButtonBody,
  standardSaveButtonBody,
  successTags,
  toSentence,
} from "./mod-form-substrate.js";

type SetState = "current" | "overwritten" | "available";

export interface RuleFormDeps {
  prototypeTypeName?: string;
  prototypeTypeId?: number;
  editorHtml?: string;
  successView?: string;
  known?: (nameKey: string) => boolean;
}

function ruleTag(card: RenderFormat["card"]): string {
  return card.name.rightName?.s ?? "";
}

function defaultKnownFn(fmt: RenderFormat): (nameKey: string) => boolean {
  return (nameKey: string) => fmt.engine.fetchRenderCard(nameKey) !== undefined;
}

function setOptionsWalk(
  fmt: RenderFormat,
  deps: RuleFormDeps,
): Array<[string, SetState]> {
  const setName = fmt.card.name.leftName?.s ?? "";
  const tag = ruleTag(fmt.card);
  const knownFn = deps.known ?? defaultKnownFn(fmt);
  const parsedSet = parseSetName(setName);
  const args: PrototypeArgs = parsedSet.spec
    ? parsedSet.spec.prototypeArgs(parsedSet.anchorName?.s)
    : { name: parsedSet.anchorName?.s ?? "" };
  const prototypeTypeName = args.type ?? deps.prototypeTypeName ?? "RichText";
  const prototypeTypeId =
    deps.prototypeTypeId ??
    fmt.engine.fetchRenderCard(DeckoName.parse(prototypeTypeName).key)?.typeId;
  const prototype = {
    name: args.name ?? "",
    typeName: prototypeTypeName,
    typeId: prototypeTypeId,
    isNew: true,
  };
  const candidates = setNamesForCard(prototype);
  const setKey = DeckoName.parse(setName).key;
  const ownIndex = candidates.findIndex((c) => DeckoName.parse(c).key === setKey);
  const first = fmt.card.id === undefined ? 0 : ownIndex;
  const sliced = candidates.slice(first === -1 ? 0 : first);
  const known = (candidate: string): boolean =>
    knownFn(DeckoName.parse(`${candidate}+${tag}`).key);
  let existingCount = 0;
  return sliced.map((candidate): [string, SetState] => {
    if (known(candidate)) {
      existingCount += 1;
      return [candidate, existingCount === 1 ? "current" : "overwritten"];
    }
    return [candidate, existingCount > 0 ? "overwritten" : "available"];
  });
}

function urlKeyOf(name: string): string {
  return name.replace(/ /g, "_");
}

function cardLink(name: string, text: string, attrs: {
  target: string;
  known: boolean;
}): string {
  return (
    `<a target="${attrs.target}" class="${attrs.known ? "known-card" : "wanted-card"}"` +
    ` href="/${h(urlKeyOf(name))}">${text}</a>`
  );
}

function ruleSetRadioHtml(
  fmt: RenderFormat,
  opts: {
    setName: string;
    tag: string;
    state: SetState;
    narrowerRules: string[];
    seconds: string;
    knownFn: (nameKey: string) => boolean;
  },
): string {
  const id = `${fmt.uniqueId()}-${opts.seconds}`;
  let warning: string | undefined;
  if (opts.setName === "*all") {
    warning = "This rule will affect all cards! Are you sure?";
  } else if (opts.state === "current" || opts.state === "overwritten") {
    opts.narrowerRules.push(uncapitalizedLabelForParsedSet(parseSetName(opts.setName)));
    if (opts.state === "overwritten") {
      const plural = opts.narrowerRules.length > 1 ? "s" : "";
      warning =
        "This rule will not have any effect on this card unless you delete " +
        `the narrower rule${plural} for ${toSentence(opts.narrowerRules)}.`;
    }
  }
  const radio = radioButtonTag("name", `${opts.setName}+${opts.tag}`, {
    warning,
    class: "form-check-input",
    id,
  });
  const labelClasses = ["set-label", opts.state === "current" ? "current-set-label" : undefined]
    .filter((c): c is string => c !== undefined)
    .join(" ");
  let text = labelForParsedSet(parseSetName(opts.setName));
  if (opts.state === "current") {
    text += " <em>(current)</em>";
  } else if (opts.state === "overwritten") {
    const ruleName = `${opts.setName}+${opts.tag}`;
    const known = opts.knownFn(DeckoName.parse(ruleName).key);
    text += ` <em>${cardLink(ruleName, `(${opts.state})`, { target: "_blank", known })}</em>`;
  }
  const setKnown = opts.knownFn(DeckoName.parse(opts.setName).key);
  const iconLink = cardLink(opts.setName, iconTag("new_window", "text-muted"), {
    target: "decko_set",
    known: setKnown,
  });
  return (
    `<div class="form-check">` +
    `${radio}\n` +
    `<label class="form-check-label ${labelClasses}" for="${h(id)}">${text}\n${iconLink}</label></div>`
  );
}

function boardRuleSetSelectionHtml(
  fmt: RenderFormat,
  deps: RuleFormDeps,
  seconds: string,
): string {
  const tag = ruleTag(fmt.card);
  const narrowerRules: string[] = [];
  const knownFn = deps.known ?? defaultKnownFn(fmt);
  const radios = setOptionsWalk(fmt, deps)
    .reverse()
    .map(([setName, state]) =>
      ruleSetRadioHtml(fmt, { setName, tag, state, narrowerRules, seconds, knownFn }),
    );
  return (
    `<div class="set-list _set-editor"><div class="col-xs-6 mt-3 mb-5">` +
    `${radios.join("\n")}</div></div>`
  );
}

function followLabel(setName: string): string {
  const parsed = parseSetName(setName);
  return parsed.spec ? parsed.spec.shortLabel(parsed.anchorName?.s) : "";
}

function editRuleButtonsHtml(
  ctx: ViewContext,
  formType: "overlay" | "modal",
): string {
  const fmt = ctx.fmt;
  const save =
    standardSaveButtonBody(ctx, [
      ["class", "_rule-submit-button"],
    ]) ?? "";
  const saveAndClose = standardSaveAndCloseButtonBody({
    close: formType,
    callerClass: "_rule-submit-button",
  });
  const cancel = overlayCloseButton("Cancel", {
    situation: "secondary",
    callerClass: "btn-sm",
  });
  let deleteSection = "";
  if (fmt.card.id !== undefined) {
    const settingName = ruleTag(fmt.card);
    const setName = fmt.card.name.leftName?.s ?? "";
    const confirm =
      `Are you sure you want to delete the ${settingName} rule for ${followLabel(setName)}?`;
    deleteSection =
      `<span class="rule-delete-section">` +
      ruleDeleteButtonLink({
        confirm,
        urlKey: fmt.urlKey(),
        callerClass: `_close-${formType}-on-success`,
        dataSlotterMode: "silent-success",
      }) +
      `</span>`;
  }
  return (
    `<div class="button-area">` +
    [save, saveAndClose, cancel, deleteSection].join("\n") +
    `</div>`
  );
}

export function ruleFormHtml(ctx: ViewContext, deps: RuleFormDeps = {}): string {
  const fmt = ctx.fmt;
  const successView = deps.successView ?? "open";
  const mark = fmt.card.name.s.replace(/ /g, "_");
  const formType: "overlay" | "modal" = "overlay";
  const editorHtml = deps.editorHtml ?? fmt.renderView("rule_form_card_editor");
  const seconds = String(Math.floor(Date.now() / 1000));
  const inner =
    successTags({ mark, view: successView }) +
    `<div class='guide-line rule-section mt-4'>\n` +
    `<h5>\n` +
    `<div class='guide-line-number'>1</div>\n` +
    `Define rule\n` +
    `</h5>\n` +
    editorHtml +
    `<div class='rule-section'>\n` +
    `<h5>\n` +
    `<div class='guide-line-number'>2</div>\n` +
    `Apply to set\n` +
    popoverLink(
      "Each rule applies to a set of cards. Rules for more specific sets override rules for more general ones.",
    ) +
    `\n</h5>\n` +
    `<div class='card-editor'>\n` +
    boardRuleSetSelectionHtml(fmt, deps, seconds) +
    `\n` +
    editRuleButtonsHtml(ctx, formType) +
    `\n</div>\n</div>\n`;
  return cardFormShell(ctx, {
    formClass: "card-rule-form card-form slotter",
    id: `edit_card_${fmt.card.id}`,
    htmlAttrs: [["data-slotter-mode", "update-origin"]],
    action: "/card/update",
    methodSpoof: "patch",
    success: undefined,
    body: inner,
  });
}

export function modalRuleHtml(
  ctx: ViewContext,
  deps: { editorHtmlFor?: (name: string) => string; known?: (nameKey: string) => boolean } = {},
): string {
  const { fmt, voo } = ctx;
  const sub = new RenderFormat(fmt.card, fmt.engine, { parent: fmt, maxDepth: fmt.maxDepth });
  const subVoo = new Voo(undefined, "rule_form", {});
  subVoo.viz.set("rule_form", "show");
  const subCtx: ViewContext = { fmt: sub, voo: subVoo };
  const editorHtml = deps.editorHtmlFor?.(fmt.card.name.s);
  const bodyHtml = modSlotWrap(
    subCtx,
    "rule_form",
    ruleFormHtml(subCtx, { editorHtml, successView: "overlay_rule", known: deps.known }),
  );
  return (
    modalDialogWrap({
      show: (view: string) => voo.show(view),
      titleHtml: str(fmt.renderView("title")),
      menuHtml: voo.show("modal_menu") ? str(fmt.renderView("modal_menu")) : undefined,
      footerHtml: str(fmt.renderView("modal_footer")),
      bodyHtml,
    }) + "\n"
  );
}

export const modalRuleView: ViewFn = (ctx) => modalRuleHtml(ctx);

export const ruleFormView: ViewFn = (ctx) =>
  modSlotWrap(ctx, "rule_form", ruleFormHtml(ctx));
