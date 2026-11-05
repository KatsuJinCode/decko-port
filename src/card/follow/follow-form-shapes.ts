export function output(parts: ReadonlyArray<string | undefined | null>): string {
  return parts
    .flat()
    .filter((p): p is string => p !== undefined && p !== null && p !== "")
    .join("\n");
}

export function formEscape(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

export function toParam(hash: Record<string, string>): string {
  return Object.keys(hash)
    .sort()
    .map((k) => `${formEscape(k)}=${formEscape(hash[k])}`)
    .join("&");
}

export function followPath(
  markUrlKey: string | undefined,
  opts: {
    action?: "update" | "create" | "delete";
    view?: string;
    query?: Record<string, string>;
  } = {},
): string {
  const mark = markUrlKey ?? "";
  let base: string;
  if (opts.action !== undefined) {
    base = mark === "" ? `card/${opts.action}` : `${opts.action}/${mark}`;
  } else if (mark !== "" && opts.view !== undefined) {
    base = `${mark}/${opts.view}`;
  } else {
    base = mark;
  }
  const query = opts.query ?? {};
  const qs = Object.keys(query).length > 0 ? `?${toParam(query)}` : "";
  return `/${base}${qs}`;
}

export function hiddenFieldTag(name: string, value: string): string {
  return (
    `<input type="hidden" name="${name}" id="${name}" value="${value}"` +
    ` autocomplete="off" />`
  );
}

export function hiddenTags(
  hash: Record<string, string>,
  base?: string,
): string {
  return Object.entries(hash)
    .map(([key, value]) =>
      hiddenFieldTag(base === undefined ? key : `${base}[${key}]`, value),
    )
    .join("");
}

export function successTags(success: Record<string, string> | undefined): string {
  if (success === undefined || Object.keys(success).length === 0) return "";
  return hiddenTags(success, "success");
}

export function cardFormOpen(opts: {
  formId: string;
  action: string;
  classes?: string;
  htmlAttrs?: string;
}): string {
  const classes = opts.classes ?? "card-form slotter autosave";
  return (
    `<form class="${classes}" id="${opts.formId}"${opts.htmlAttrs ?? ""}` +
    ` action="${opts.action}" accept-charset="UTF-8" data-remote="true"` +
    ` method="post">` +
    `<input name="utf8" type="hidden" value="&#x2713;" autocomplete="off" />` +
    `<input type="hidden" name="_method" value="patch" autocomplete="off" />`
  );
}

export const CARD_FORM_CLOSE = `</form>`;

export function checkBoxTag(
  name: string,
  value: string,
  checked: boolean,
  extraClass?: string,
): string {
  const classAttr = extraClass === undefined ? "" : ` class="${extraClass}"`;
  const checkedAttr = checked ? ` checked="checked"` : "";
  return (
    `<input type="checkbox" name="${name}" id="${name}" value="${value}"${classAttr}${checkedAttr} />`
  );
}

export function buttonTag(
  content: string,
  opts: {
    type?: string;
    name?: string;
    value?: string;
    situation?: string;
    class?: string;
    ariaLabel?: string;
    data?: Record<string, string>;
  } = {},
): string {
  const situation = opts.situation ?? "primary";
  const cls = [opts.class, "btn", `btn-${situation}`]
    .filter((c) => c !== undefined && c !== "")
    .join(" ");
  let attrs = `name="${opts.name ?? "button"}" type="${opts.type ?? "submit"}"`;
  if (opts.value !== undefined) attrs += ` value="${opts.value}"`;
  attrs += ` class="${cls}"`;
  if (opts.ariaLabel !== undefined) attrs += ` aria-label="${opts.ariaLabel}"`;
  for (const [k, v] of Object.entries(opts.data ?? {})) {
    attrs += ` data-${k}="${v}"`;
  }
  return `<button ${attrs}>${content}</button>`;
}

export function submitButton(
  args: {
    text?: string;
    situation?: string;
    disableWith?: string;
    name?: string;
    value?: string;
    class?: string;
  } = {},
): string {
  return buttonTag(args.text ?? "Submit", {
    situation: args.situation ?? "primary",
    name: args.name,
    value: args.value,
    class: args.class,
    data: { "disable-with": args.disableWith ?? "Submitting" },
  });
}

export function linkTo(
  text: string,
  href: string,
  attrs: Record<string, string | undefined> = {},
): string {
  let attrStr = "";
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    attrStr += ` ${k}="${v}"`;
  }
  return `<a${attrStr} href="${href}">${text}</a>`;
}
