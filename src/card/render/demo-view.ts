import { str } from "./format.js";
import type { ViewContext, ViewFn } from "./format.js";
import { h } from "./slot-html.js";
import { modSlotWrap } from "../mod-loader/mod-view-helpers.js";
import { cardFormShell } from "../mod-loader/mod-form-substrate.js";
import { allAdminConfigCodenamesOfCategory } from "../mod-loader/mods/core-mod.js";
import { cardFormRecaptcha } from "../mod-loader/mods/card-mod-edit.js";

const DEMO_VIEW_DEFAULT = "core";

export const demoViewSelect = (ctx: ViewContext): string => {
  const { fmt } = ctx;
  const codenames = allAdminConfigCodenamesOfCategory(ctx, "views");
  const options = codenames
    .map(
      (c) =>
        `<option${c === DEMO_VIEW_DEFAULT ? ` selected="selected"` : ""} value="${h(c)}">${h(c)}</option>`,
    )
    .join("\n");
  const select = `<select name="demo_view" id="demo_view" class="_submit-on-select">${options}</select>`;
  const { on: recaptchaOnForm, siteKey } = cardFormRecaptcha(ctx);
  const recaptchaAttrs: Array<[string, string]> = recaptchaOnForm ? [["data-recaptcha", "on"]] : [];
  const recaptchaToken = !recaptchaOnForm
    ? ""
    : `<script src="https://www.google.com/recaptcha/api.js?render=${siteKey}"></script>\n` +
      `<input type="hidden" name="recaptcha_token" id="recaptcha_token" value=""` +
      ` data-site-key="${siteKey}" data-action="get" class="_recaptcha-token" autocomplete="off" />`;
  return cardFormShell(ctx, {
    formClass: "card-form slotter",
    id: `edit_card_${fmt.card.id}`,
    htmlAttrs: recaptchaAttrs,
    action: `/${fmt.urlKey()}`,
    methodSpoof: "patch",
    success: { view: "demo" },
    recaptchaTokenHtml: recaptchaToken,
    body: select,
  });
};

export const demoView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  voo.classUp("d0-card-header", "card-header");
  voo.classUp("d0-card-body", "card-body card-text");
  voo.classUp("d0-card-frame", "card");
  voo.hide("help");
  fmt.addNameContext();
  const header =
    `<div class="${voo.classy("d0-card-header")}">` +
    `<h2 class="${voo.classy("d0-card-header-title")}">${fmt.renderView("title")}</h2>\n` +
    `${fmt.renderView("menu")}</div>`;
  const demoInner = modSlotWrap(ctx, "demo", str(fmt.renderView(DEMO_VIEW_DEFAULT)));
  const demoDiv = `<div class="demo-slot">${demoInner}</div>`;
  const body = `${demoViewSelect(ctx)}\n${demoDiv}`;
  const panel =
    `<div class="${voo.classy("d0-card-frame")}">` +
    `${header}\n\n` +
    `<div class="${voo.classy("d0-card-body")}">${body}</div></div>`;
  return modSlotWrap(ctx, "demo", panel);
};
