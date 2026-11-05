import { h } from "../render/slot-html.js";
import type { ViewContext } from "../render/format.js";

export function submitButton(text: string, orderedAttrs: Array<[string, string]>): string {
  const attrs: string[] = [`name="button"`, `type="submit"`];
  let hasDisableWith = false;
  for (const [key, value] of orderedAttrs) {
    if (key === "class") {
      attrs.push(`class="${value} btn btn-primary"`);
    } else {
      attrs.push(`${key}="${value}"`);
    }
    if (key === "data-disable-with") hasDisableWith = true;
  }
  if (!hasDisableWith) {
    attrs.splice(2, 0, `data-disable-with="Submitting"`);
  }
  return `<button ${attrs.join(" ")}>${h(text)}</button>`;
}

export function standardSaveButtonBody(
  ctx: Pick<ViewContext, "voo">,
  callerAttrs: Array<[string, string]> = [],
): string | undefined {
  if (!ctx.voo.show("save_button")) return undefined;
  const attrs: Array<[string, string]> = [];
  let classEmitted = false;
  for (const [key, value] of callerAttrs) {
    if (key === "class") {
      attrs.push(["class", `${value} submit-button me-3 _update-history-pills`]);
      classEmitted = true;
    } else {
      attrs.push([key, value]);
    }
  }
  if (!classEmitted) {
    attrs.push(["class", "submit-button me-3 _update-history-pills"]);
  }
  attrs.push(["data-cy", "save"]);
  return submitButton("Save", attrs);
}

export function standardSaveAndCloseButton(): string {
  return submitButton("Save and Close", [
    ["data-cy", "submit-modal"],
    ["class", "submit-button me-3 _close-on-success _update-origin"],
  ]);
}

export function buttonFormGroup(ctx: ViewContext, inner: string): string {
  return `<div class="form-group ${ctx.voo.classy("button-form-group")}">${inner}</div>`;
}

export function formgroup(
  fmt: ViewContext["fmt"],
  title: string,
  opts: { input: string; class?: string; help?: false },
  inner: string,
): string {
  const card = fmt.card;
  const attrs: string[] = [`class="form-group${opts.class ? ` ${opts.class}` : ""}"`];
  if (card.id !== undefined) attrs.push(`data-card-id="${card.id}"`);
  if (card.name.s !== "") {
    attrs.push(`data-card-name="${h(card.name.s)}"`);
    attrs.push(`data-card-link-name="${h(fmt.urlKey())}"`);
  }
  const label = `<label for="card_${opts.input}">${title}</label>`;
  return `<div ${attrs.join(" ")}>${label}\n<div class="editor ${opts.input}-editor">${inner}</div></div>`;
}

export function successTags(
  success: Record<string, unknown> | undefined,
): string {
  if (success === undefined) return "";
  return hiddenTags({ success: success });
}

function hiddenTags(hash: Record<string, unknown>, base?: string): string {
  let out = "";
  for (const [key, value] of Object.entries(hash)) {
    const name = base === undefined ? key : `${base}[${key}]`;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out += hiddenTags(value as Record<string, unknown>, name);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        out += hiddenTags({ "": item }, `${name}[]`);
      }
    } else {
      const id = name.replace(/\]/g, "").replace(/\[/g, "_");
      const valueAttr = value === null ? "" : ` value="${h(String(value))}"`;
      out += `<input type="hidden" name="${h(name)}" id="${h(id)}"${valueAttr} autocomplete="off" />`;
    }
  }
  return out;
}

export interface CardFormShellOpts {
  formClass: string;
  id: string;
  htmlAttrs: Array<[string, string]>;
  action: string;
  methodSpoof: "patch" | null;
  success: Record<string, unknown> | undefined;
  recaptchaTokenHtml?: string;
  body: string;
}

export function cardFormShell(_ctx: ViewContext, opts: CardFormShellOpts): string {
  const attrs: string[] = [`class="${opts.formClass}"`, `id="${opts.id}"`];
  for (const [key, value] of opts.htmlAttrs) attrs.push(`${key}="${value}"`);
  attrs.push(`action="${opts.action}"`);
  attrs.push(`accept-charset="UTF-8"`);
  attrs.push(`data-remote="true"`);
  attrs.push(`method="post"`);
  return (
    `<form ${attrs.join(" ")}>` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    (opts.methodSpoof === null
      ? ""
      : `<input type="hidden" name="_method" value="${opts.methodSpoof}" autocomplete="off" />`) +
    successTags(opts.success) +
    (opts.recaptchaTokenHtml ?? "") +
    opts.body +
    `</form>`
  );
}

export function createFormShell(
  ctx: ViewContext,
  opts: {
    htmlAttrs: Array<[string, string]>;
    success: Record<string, unknown> | undefined;
    body: string;
    recaptchaTokenHtml?: string;
  },
): string {
  return cardFormShell(ctx, {
    formClass: "card-form slotter",
    id: "new_card",
    htmlAttrs: opts.htmlAttrs,
    action: "/card/create",
    methodSpoof: null,
    success: opts.success,
    recaptchaTokenHtml: opts.recaptchaTokenHtml,
    body: opts.body,
  });
}

export function toSentence(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const head = items.slice(0, -1).join(", ");
  return `${head}, and ${items[items.length - 1]}`;
}

const SUBSTRATE_MATERIAL_GLYPHS: Readonly<Record<string, string>> = {
  new_window: "close_fullscreen",
  help: "help",
  close: "close",
};

export function iconTag(key: string, extraClass?: string): string {
  const glyph = SUBSTRATE_MATERIAL_GLYPHS[key] ?? key;
  const cls = `notranslate material-icons`;
  return `<i class="${extraClass ? `${extraClass} ${cls}` : cls}">${glyph}</i>`;
}

export function popoverLink(text: string): string {
  return (
    `<a tabindex="0" data-bs-toggle="popover" data-bs-trigger="hover focus"` +
    ` data-bs-content="${h(text)}" class="ps-1 _popover_link" href="#">` +
    `${iconTag("help")}</a>`
  );
}

export function radioButtonTag(
  method: string,
  value: string,
  opts: { warning?: string; class?: string; id: string },
): string {
  const attrs: string[] = [];
  if (opts.warning !== undefined) attrs.push(`warning="${h(opts.warning)}"`);
  if (opts.class !== undefined) attrs.push(`class="${h(opts.class)}"`);
  attrs.push(`id="${h(opts.id)}"`);
  attrs.push(`type="radio"`);
  attrs.push(`value="${h(value)}"`);
  attrs.push(`name="card[${h(method)}]"`);
  return `<input ${attrs.join(" ")} />`;
}

export function standardSaveAndCloseButtonBody(
  opts: { close: string; callerClass?: string },
): string {
  const mergedClass = opts.callerClass
    ? `${opts.callerClass} submit-button me-3 _close-on-success _update-origin`
    : "submit-button me-3 _close-on-success _update-origin";
  return submitButton("Save and Close", [
    ["data-cy", `submit-${opts.close}`],
    ["class", mergedClass],
  ]);
}

export function overlayCloseButton(
  text: string,
  opts: { situation?: string; callerClass?: string } = {},
): string {
  const cls = `_close-overlay btn-sm${opts.callerClass ? ` ${opts.callerClass}` : ""}${
    opts.situation ? ` btn btn-${opts.situation}` : " btn btn-primary"
  }`;
  return `<button name="button" type="button" class="${cls}" data-bs-dismiss="overlay">${h(text)}</button>`;
}

export function ruleDeleteButtonLink(opts: {
  confirm: string;
  urlKey: string;
  callerClass?: string;
  dataSlotterMode?: string;
}): string {
  const attrs: string[] = [];
  attrs.push(`confirm="${h(opts.confirm)}"`);
  if (opts.dataSlotterMode !== undefined) {
    attrs.push(`data-slotter-mode="${h(opts.dataSlotterMode)}"`);
  }
  const cls = `${opts.callerClass ?? ""} slotter btn btn-outline-danger ms-auto`;
  attrs.push(`class="${h(cls)}"`);
  attrs.push(`data-confirm="${h(opts.confirm)}"`);
  attrs.push(`href="/delete/${h(opts.urlKey)}?"`);
  attrs.push(`data-remote="true"`);
  return `<a ${attrs.join(" ")}>Delete</a>`;
}

export function modalDialogWrap(opts: {
  show: (view: string) => boolean;
  titleHtml: string;
  menuHtml: string | undefined;
  footerHtml: string | undefined;
  bodyHtml: string;
  size?: string;
}): string {
  const dialogClass =
    opts.size === undefined || opts.size === ""
      ? "modal-dialog modal-dialog-centered"
      : `modal-dialog modal-dialog-centered modal-${opts.size}`;
  const header = opts.show("modal_header")
    ? `<div class='modal-header'>\n${opts.titleHtml}\n` +
      (opts.show("modal_menu") && opts.menuHtml !== undefined
        ? `${opts.menuHtml}\n`
        : "") +
      `</div>\n`
    : "";
  const footer =
    opts.footerHtml !== undefined && opts.footerHtml !== ""
      ? `<div class='modal-footer'>\n${opts.footerHtml}\n</div>\n`
      : "";
  return (
    `<div class='modal fade _modal-slot' id='modal-container' role='dialog'>\n` +
    `<!-- /, "data-backdrop": "static"} -->\n` +
    `<div class='${dialogClass}'>\n` +
    `<div class='modal-content'>\n` +
    header +
    `<div class='modal-body'>\n` +
    opts.bodyHtml +
    `\n</div>\n` +
    footer +
    `</div>\n</div>\n</div>`
  );
}
