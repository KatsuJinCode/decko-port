import { linkTo } from "../follow/follow-form-shapes.js";
import { cardFormShell } from "../mod-loader/mod-form-substrate.js";
import { DeckoName } from "../name.js";
import { CodenameNotFoundError } from "../name/errors.js";
import { getNameEnvironment } from "../name/environment.js";
import { cardPath } from "./format.js";
import type { ViewContext } from "./format.js";

const SIGNIN_FORM_LOCALE = {
  account_or_sign_up: "...or sign up!",
  account_reset_password: "Reset password",
  account_sign_in: "Sign in",
} as const;

function signupLink(ctx: ViewContext): string {
  const name = getNameEnvironment()?.codename?.name("signup");
  if (name === undefined) throw new CodenameNotFoundError("unknown codename: signup");
  const known =
    ctx.fmt.engine.fetchRenderCard(name) !== undefined ||
    getNameEnvironment()?.lexicon?.id(DeckoName.parse(name).key) !== undefined;
  const cls = known ? "known-card" : "wanted-card";
  const markUrlKey = DeckoName.parse(name).urlKey;
  return linkTo(SIGNIN_FORM_LOCALE.account_or_sign_up, cardPath(`new/${markUrlKey}`), {
    class: cls,
  });
}

function resetPasswordLink(ctx: ViewContext): string {
  const href = cardPath(`${ctx.fmt.urlKey()}/edit?slot%5Bhide%5D%5B%5D=board_link`);
  return (
    `<a rel="nofollow" class="slotter" href="${href}" data-remote="true">` +
    `${SIGNIN_FORM_LOCALE.account_reset_password}</a>`
  );
}

function signinButton(): string {
  return (
    `<button name="button" type="submit" class="btn btn-primary">` +
    `${SIGNIN_FORM_LOCALE.account_sign_in}</button>`
  );
}

function signinField(name: string): [string, Record<string, unknown>] {
  const tag = getNameEnvironment()?.codename?.name(name);
  if (tag === undefined) throw new CodenameNotFoundError(`unknown codename: ${name}`);
  const nestName = `+${tag}`;
  return [
    nestName,
    { title: name, view: "titled", nest_name: nestName, skip_perms: true },
  ];
}

export function signinCoreHtml(ctx: ViewContext): string {
  const { fmt } = ctx;
  const editStructure = [signinField("email"), signinField("password")];
  ctx.voo.liveEditStructure = editStructure;
  const body = fmt.withNestMode("edit", () => coreHaml(ctx));
  return cardFormShell(ctx, {
    formClass: "card-form slotter autosave",
    id: `edit_card_${fmt.card.id}`,
    htmlAttrs: [["recaptcha", "off"]],
    action: `/update/${fmt.urlKey()}`,
    methodSpoof: "patch",
    success: signinSuccess(ctx),
    body,
  });
}

function coreHaml(ctx: ViewContext): string {
  const { fmt } = ctx;
  const fields = fmt.renderView("content_formgroups");
  return (
    `<div class='signin-fields'>\n` +
    `${fields}\n` +
    `</div>\n` +
    `<div class='form-group signin-buttons'>\n` +
    `<div class='reset-password-link'>\n` +
    `${resetPasswordLink(ctx)}\n` +
    `</div>\n` +
    `<div class='signin-button'>\n` +
    `${signinButton()}\n` +
    `</div>\n` +
    `<div class='signup-button'>\n` +
    `${signupLink(ctx)}\n` +
    `</div>\n` +
    `</div>\n`
  );
}

function signinSuccess(_ctx: ViewContext): Record<string, unknown> {
  return { redirect: true, mark: "*previous" };
}
