import { str } from "../../render/format.js";
import { quietDenial } from "../../permissions/view-perms.js";

import {
  RenderFormat,
  Voo,
  type ViewContext,
  type ViewFn,
} from "../../render/format.js";
import { h } from "../../render/slot-html.js";
import { safeSetKeys } from "../../render/set-keys.js";
import { signinCoreHtml } from "../../render/signin-core-form-view.js";
import { modSlotWrap, superView } from "../mod-view-helpers.js";
import { setModuleShortname } from "../mod-registrar.js";
import { createCardBodyShell, framedView } from "./card-mod-edit.js";
import { preparedSetupVerdict } from "../../auth/first-run-setup-verdict-seam.js";
import { roleConfigsView } from "./core-mod.js";
import {
  buttonTag,
  cardFormOpen,
  CARD_FORM_CLOSE,
  checkBoxTag,
  followPath,
  linkTo,
  output,
} from "../../follow/follow-form-shapes.js";
import { isNewCard } from "../../fetch/card-record.js";
import { resetPasswordUrlView, verifyUrlView } from "../../render/views.js";
import { NoMethodError, rubyDefaultInspect } from "../../render/format.js";
import { DeckoName } from "../../name.js";
import { CodenameNotFoundError } from "../../name/errors.js";
import { getNameEnvironment } from "../../name/environment.js";
import {
  BOARD_PILL_UL_CLASSES,
  BOARD_SLOT_SELECTOR,
} from "./card-mod-edit.js";
import { DEFAULT_TOKEN_EXPIRY_SECONDS } from "../../auth/token.js";
import {
  engineOwnedEvent,
  type DeckoModManifest,
  type ModEventCard,
  type ModEventRegistration,
  type ModEventFn,
  type ModSetModuleFile,
} from "../mod-manifest.js";

function event(
  decl: Omit<ModEventRegistration, "fn"> & { fn?: ModEventFn },
): ModEventRegistration {
  return { fn: () => undefined, ...decl };
}

function tokenDaysValue(): number {
  return DEFAULT_TOKEN_EXPIRY_SECONDS / 86400;
}

const tokenDaysView: ViewFn = () => tokenDaysValue();

const verifyDaysView: ViewFn = (ctx) => tokenDaysView(ctx);

const resetPasswordDaysView: ViewFn = (ctx) => tokenDaysView(ctx);

const tokenExpiryView: ViewFn = () =>
  `<p><em>Link will expire in ${tokenDaysValue()} days</em></p>`;

const accountCoreView: ViewFn = (ctx) => {
  const fieldNest = (field: string, title: string): string =>
    ctx.fmt.nest({
      syntax: `${ctx.fmt.card.name.s}+*${field}|view:labeled|title:${title}`,
      name: `${ctx.fmt.card.name.s}+*${field}`,
      options: { view: "labeled", title, extra: {} },
      comment: undefined,
    });
  return [fieldNest("email", "email"), fieldNest("password", "password")].join(
    "\n",
  );
};

const passwordRawView: ViewFn = () => "encrypted";

const saltRawView: ViewFn = () => "Private data";

const passwordInputView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const namePrefix =
    typeof voo.opts["form_name_prefix"] === "string"
      ? (voo.opts["form_name_prefix"] as string)
      : "card";
  const idPrefix = namePrefix === "card" ? "card" : namePrefix.replace(/\]/g, "").replace(/[^-a-zA-Z0-9:.]/g, "_");
  const autocomplete =
    fmt.parent?.card.name.s === "*signin+*account" ? "on" : "off";
  return (
    `<input class="d0-card-content _pw-input form-control" placeholder="Password" autocomplete="${autocomplete}" type="password" name="${namePrefix}[content]" id="${idPrefix}_content" />\n` +
    `<span class='_toggle-password visibility-icon _pw-text-area'>\n` +
    `<i class="_toggle-pw-visibility notranslate material-icons">visibility_off</i>\n` +
    `</span>\n`
  );
};

const passwordCoreView: ViewFn = () => "<em>encrypted</em>";

const openContentView: ViewFn = (ctx) => ctx.fmt.renderDelegated("core");

const oneLineContentView: ViewFn = () => "";

const signinOpenView: ViewFn = (ctx) => {
  ctx.voo.showViz("help");
  ctx.voo.hide("menu");
  return superView(ctx, setModuleShortname("self/signin"), "open");
};

function accountFollowBundle(ctx: ViewContext) {
  return ctx.fmt.engine.followRenderBundle?.();
}

const ACCOUNT_LOCALE = {
  account_check_email: "Check your email for a link to reset your password",
  account_reset_password: "Reset password",
  account_close_account: "Permanently Close Account",
  account_confirm_delete_account_prefix:
    "Are you CERTAIN you want to PERMANENTLY delete the account associated with ",
} as const;

const resetPasswordSuccessView: ViewFn = (ctx) =>
  framedView(ctx, "reset_password_success", () =>
    ACCOUNT_LOCALE.account_check_email,
  );

const signinEditButtonsView: ViewFn = () =>
  buttonTag(ACCOUNT_LOCALE.account_reset_password, {
    class: "_close-modal-on-success",
    situation: "primary",
  });

const linkWithCheckboxView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const bundle = accountFollowBundle(ctx);
  const actorName =
    bundle?.session?.actorName ?? "Anonymous";
  const disabledRolesTag = getNameEnvironment()?.codename?.name("disabled_roles");
  if (disabledRolesTag === undefined) throw new CodenameNotFoundError("unknown codename: disabled_roles");
  const rolesName = `${actorName}+${disabledRolesTag}`;
  const rolesCard = ctx.fmt.engine.fetchRenderCard(rolesName);
  const disabledIds = (rolesCard?.dbContent ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const disabled = disabledIds.includes(String(fmt.card.id));
  const name = disabled ? "drop_item" : "add_item";
  const box = checkBoxTag(
    name,
    String(fmt.card.id),
    !disabled,
    "_edit-item",
  );
  const link = fmt.renderView("link");
  const form =
    cardFormOpen({
      formId: rolesCard?.id !== undefined ? `edit_card_${rolesCard.id}` : "new_card",
      action: followPath(
        rolesCard?.name?.urlKey ?? rolesName.replace(/ /g, "_"),
        { action: "update" },
      ),
    }) + box + link + CARD_FORM_CLOSE;
  const subVoo = new Voo(undefined, "link_with_checkbox", {});
  return modSlotWrap({ fmt, voo: subVoo }, "link_with_checkbox", form);
};

const closureView: ViewFn = (ctx) => {
  const card = ctx.fmt.card;
  const accountedId = card.record.leftId;
  const accountedName = card.name.left;
  if (accountedId === undefined || accountedName === undefined) {
    throw new NoMethodError("undefined method `closure_deletions' for nil");
  }
  throw new NoMethodError(
    "private method `closure_deletions' called for " +
      rubyDefaultInspect("Card", accountedId),
  );
};

const closedAccountView: ViewFn = () =>
  "<h2>Account Closed</h2>\n" +
  "<p>\n" +
  "The sign-in account once associated with this card has been removed, the card\n" +
  "has been anonymized, and its data fields have been deleted.\n" +
  "</p>\n";

const userEmailRawView: ViewFn = ({ fmt }: ViewContext) => {
  const card = fmt.card;
  if (card.id === undefined) return "";
  return card.dbContent;
};

export const signupCoreHtml = (ctx: ViewContext): string => {
  const { fmt } = ctx;
  const engine = fmt.engine;
  const card = fmt.card;
  if (card.unknown === true || isNewCard(card.record)) return "";
  const createdAt = card.record.createdAt;
  const creatorId = card.record.creatorId;
  const anonymousId = engine.fetchRenderCard("Anonymous")?.id;
  const invited = creatorId !== undefined && anonymousId !== undefined && creatorId !== anonymousId;
  const signupLine =
    `<strong>${h(card.name.s)}</strong>` +
    (invited ? " was" : "") +
    ` signed up on ${formatCardDateSeconds(createdAt)}`;
  const accountLines = signupAccountLines(ctx);
  const body = fmt.processContent(fmt.renderRaw());
  return (
    `<div class='invite-links'>\n` +
    [signupLine, ...accountLines].map((line) => `<div>${line}</div>`).join("\n") +
    `\n${body}` +
    `\n</div>\n`
  );
};

function signupAccountLines(ctx: ViewContext): string[] {  const { fmt } = ctx;
  const engine = fmt.engine;
  const account = engine.fetchRenderCard(`${fmt.card.name.s}+*account`);
  if (account === undefined || account.unknown === true) {
    return ["ERROR: signup card missing account"];
  }
  const email = engine.fetchRenderCard(`${fmt.card.name.s}+*account+*email`);
  const sent =
    email !== undefined && email.unknown !== true && !engine.isDenied(email)
      ? `A verification email has been sent to ${h(email.dbContent)}`
      : undefined;
  const linkLine = verificationLinkLine(ctx);
  return [sent, linkLine].filter((line): line is string => line !== undefined);
}

function verificationLinkLine(ctx: ViewContext): string | undefined {
  const { fmt } = ctx;
  const verdict = fmt.engine.signupApprovalVerdict?.(fmt.card);
  if (verdict === undefined) return undefined;
  const url = h(fmt.urlKey());
  const links: string[] = [];
  if (verdict.approve) {
    const status = fmt.engine.fetchRenderCard(`${fmt.card.name.s}+*account+*status`);
    const action = status !== undefined && status.unknown !== true && status.dbContent.trim() === "unverified"
      ? "Resend"
      : "Send";
    links.push(
      `<a class="known-card" href="/update/${url}?card%5Btrigger%5D=approve_with_verification">${action} verification email</a>`,
      `<a class="known-card" href="/update/${url}?card%5Btrigger%5D=approve_without_verification">Approve without verification</a>`,
    );
  }
  if (verdict.delete) links.push(`<a class="known-card" href="/delete/${url}">Deny and delete</a>`);
  return links.length === 0 ? undefined : links.join(" ");
}

function formatCardDateSeconds(sql: string | undefined): string {
  if (sql === undefined || sql === "") return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(sql);
  if (m === null) return "";
  const month = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][Number(m[2]) - 1];
  if (month === undefined) return "";
  const day = String(Number(m[3])).padStart(2, " ");
  return `${month} ${day}, ${m[1]} ${m[4]}:${m[5]}:${m[6]}`;
}

function signupInvitation(fmt: ViewContext["fmt"]): boolean {
  return (
    fmt.engine.viewer?.signedIn === true &&
    fmt.engine.signupApprovalVerdict?.(fmt.card)?.approve === true
  );
}

const signupNewView: ViewFn = (ctx) => {
  ctx.voo.liveTitle = signupInvitation(ctx.fmt) ? "Invite" : "Sign up";
  return superView(ctx, setModuleShortname("type/signup/views"), "new");
};

const signupNewButtonsHtml = (invitation = false): string => {
  const create =
    `<button name="button" type="submit" data-disable-with="Submitting" class="submit-button create-submit-button btn btn-primary">Submit</button>`;
  const invite = invitation
    ? `<button name="button" type="submit" class="btn btn-primary">Send Invitation</button>`
    : undefined;
  return (
    `<div class="form-group button-form-group">` +
    [create, invite].filter((b) => b !== undefined).join("\n") +
    `</div>`
  );
};

const signupNewButtonsView: ViewFn = ({ fmt }) => signupNewButtonsHtml(signupInvitation(fmt));

const ACCOUNT_CONTENT_ITEMS: ReadonlyArray<readonly [string, string]> = [
  ["Created", "*created"],
  ["Edited", "*edited"],
];

const ACCOUNT_DETAILS_ITEMS: ReadonlyArray<
  readonly [string, string, Record<string, unknown>?]
> = [
  [
    "Email and Password",
    "*account",
    { path: { slot: { hide: ["help_link", "board_link"] } } },
  ],
  ["Roles", "*roles", { path: { view: "content" } }],
  ["Notifications", "*follow"],
  [
    "API",
    "*account",
    {
      path: {
        view: "api_key",
        items: { view: "content" },
        slot: { hide: ["help_link", "board_link"] },
      },
    },
  ],
  ["Close Account", "*account", { path: { view: "closure" } }],
];

const BOARD_PILL_BASE_OPTS = {
  slotSelector: BOARD_SLOT_SELECTOR,
};

function pillPathQuery(path: Record<string, unknown>): string {
  const pairs: Array<[string, string]> = [];
  const flat = (
    prefix: string,
    value: Record<string, unknown> | readonly string[] | string,
  ): void => {
    if (Array.isArray(value)) {
      for (const item of value) pairs.push([`${prefix}[]`, String(item)]);
    } else if (typeof value === "object" && value !== null) {
      for (const k of Object.keys(value).sort()) {
        flat(
          `${prefix}[${k}]`,
          (value as Record<string, unknown>)[k] as Record<string, unknown> | readonly string[] | string,
        );
      }
    } else {
      pairs.push([prefix, String(value)]);
    }
  };
  for (const k of Object.keys(path).sort()) {
    const v = path[k];
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      flat(k, v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      for (const item of v) pairs.push([`${k}[]`, String(item)]);
    } else {
      pairs.push([k, String(v)]);
    }
  }
  return pairs
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)
          .replace(/%20/g, "+")
          .replace(/%2B/g, "%2B")}=${encodeURIComponent(v).replace(/%20/g, "+")}`,
    )
    .join("&amp;");
}

function deepMergePaths(
  base: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(extra)) {
    const b = out[k];
    const e = extra[k];
    out[k] =
      b !== null && typeof b === "object" && !Array.isArray(b) && e !== null && typeof e === "object" && !Array.isArray(e)
        ? deepMergePaths(b as Record<string, unknown>, e as Record<string, unknown>)
        : e;
  }
  return out;
}

function accountBoardPillItem(
  cardName: string,
  text: string,
  trait: string,
  extraPath: Record<string, unknown> | undefined,
  known: boolean,
): string {
  const cyTable: Record<string, string> = {
    roles: "role",
    notifications: "notification",
  };
  const cyBase = text.toLowerCase().replace(/ /g, "_");
  const cy = `${cyTable[cyBase] ?? cyBase}-pill`;
  const base: Record<string, unknown> = {
    layout: "overlay",
    slot: { items: { view: "closed" } },
    view: "content",
  };
  const merged = deepMergePaths(base, (extraPath ?? {}) as Record<string, unknown>);
  const viewSegment = String(merged.view);
  const rest = { ...merged };
  delete rest.view;
  const query = pillPathQuery(rest);
  const href = query === ""
    ? `/${DeckoName.parse(`${cardName}+${trait}`).urlKey}/${viewSegment}`
    : `/${DeckoName.parse(`${cardName}+${trait}`).urlKey}/${viewSegment}?${query}`;
  return (
    `<li class="nav-item">` +
    `<a data-slot-selector="${h(BOARD_PILL_BASE_OPTS.slotSelector)}"` +
    ` data-slotter-mode="override" class="slotter nav-link ${known ? "known-card" : "wanted-card"}"` +
    ` data-bs-toggle="pill" data-breadcrumb="Account" data-breadcrumb-class="account"` +
    ` data-cy="${cy}" href="${href}" data-remote="true">${text}</a></li>`
  );
}

const accountTabHtml = (cardName: string, isKnown: (name: string) => boolean = () => true): string => {
  const settings = ACCOUNT_DETAILS_ITEMS.map(([text, trait, extra]) =>
    accountBoardPillItem(cardName, text, trait, extra?.path as Record<string, unknown> | undefined, isKnown(`${cardName}+${trait}`)),
  );
  const content = ACCOUNT_CONTENT_ITEMS.map(([text, trait]) =>
    accountBoardPillItem(cardName, text, trait, undefined, isKnown(`${cardName}+${trait}`)),
  );
  const section = (title: string, pills: readonly string[]): string =>
    `<h6 class="ms-1 mt-3">${title}</h6>${pills.join("\n")}`;
  return (
    `<ul class="${BOARD_PILL_UL_CLASSES}">` +
    section("Settings", settings) +
    "\n" +
    section("Content", content) +
    `</ul>`
  );
};

const accountTabView: ViewFn = ({ fmt }) =>
  accountTabHtml(fmt.card.name.s, (name) => fmt.engine.peekBoardPillKnown?.(name) ?? true);

export const accountProbeSurface = {
  signupNewTitle(): string {
    return "Sign up";
  },
  signupNewButtonsHtml,
  accountTabHtml,
  signinEditVoo(): {
    title: string;
    editStructure: ReadonlyArray<{ name: string; title: string; view: string; skipPerms: boolean }>;
    hide: readonly string[];
  } {
    return {
      title: "Forgot Password",
      editStructure: [{ name: "+*email", title: "email", view: "titled", skipPerms: true }],
      hide: ["help"],
    };
  },
};

function accountFormgroups(ctx: ViewContext): string {
  const { fmt } = ctx;
  const template = fmt.engine.findSettingCard?.("account") ?? fmt.engine.fetchRenderCard("*account");
  const accountName = `${fmt.card.name.s}+${template?.name.s ?? "*account"}`;
  const existing = fmt.engine.fetchRenderCard(accountName);
  const accountCard =
    existing !== undefined && existing.unknown !== true
      ? existing
      : (() => {
          if (template === undefined) return undefined;
          const name = DeckoName.parse(accountName);
          return {
            ...template,
            name,
            key: name.key,
            id: undefined,
            unknown: true,
            record: { ...template.record, id: undefined, name, key: name.key, isNew: true },
            setKeys: safeSetKeys({
              name,
              typeId: template.typeId,
              typeName: template.typeName,
              leftTypeName: undefined,
              isNew: true,
            }),
          } as ViewContext["fmt"]["card"];
        })();
  if (accountCard === undefined) {
    return "";
  }
  const sub = new RenderFormat(accountCard, fmt.engine, { parent: fmt, maxDepth: fmt.maxDepth, nestQuietErrors: fmt.nestQuietErrors });
  const accountRelative = accountCard.name.from(fmt.card.name);
  return str(sub.renderView("content_formgroups", {
    skip_perms: true,
    structure: "true",
    form_name_prefix: `card[subcards][${accountRelative}]`,
  }));
}

const signupContentFormgroupsView: ViewFn = (ctx) => {
  const { fmt } = ctx;
  const accountFormgroupsBytes = accountFormgroups(ctx);
  const multiCardArm = "";
  return output([accountFormgroupsBytes, multiCardArm]);
};

const accountBeforeContentFormgroupsView: ViewFn = (ctx) => {
  const email = ctx.fmt.engine.findSettingCard?.("email")?.name.s ?? "*email";
  const password = ctx.fmt.engine.findSettingCard?.("password")?.name.s ?? "*password";
  ctx.voo.liveEditStructure = [
    [`+${email}`, { title: "email" }],
    [`+${password}`, { title: "password" }],
  ];
  return superView(ctx, setModuleShortname("right/account/views"), "content_formgroups");
};

const SETUP_HELP_BYTES =
  `<h3>First, set up an account.</h3>
` +
  `<div class='pb-2'>
` +
  `As the first account holder for this deck, you will automatically have several
` +
  `permissioned roles. You can configure these roles at any time.
` +
  `</div>
` +
  `<div class='alert-warning p-3'>
` +
  `WARNING: Email delivery is turned off.
` +
  `Change settings in config/application.rb to send sign up notifications.
` +
  `</div>
`;

function setupHiddenFields(ctx: ViewContext): string {
  const typeId = ctx.fmt.engine.fetchRenderCard("User")?.id;
  const hiddenFieldTag = (name: string, value: string): string =>
    `<input type="hidden" name="${h(name)}" id="${h(name.replace(/]/g, "").replace(/\[/g, "_"))}" value="${h(value)}" autocomplete="off" />`;
  const out = [
    hiddenFieldTag("card[type_id]", String(typeId ?? "")),
    hiddenFieldTag("card[trigger][]", "check_setup"),
    hiddenFieldTag("success[redirect]", "true"),
    hiddenFieldTag("success[mark]", "/"),
  ];
  return out.join("");
}

const setupView: ViewFn = (ctx) => {
  const { fmt, voo } = ctx;
  const verdict = preparedSetupVerdict();
  if (verdict === undefined || verdict.open !== true) {
    return quietDenial("false");
  }
  return fmt.withNestMode("edit", () => {
    voo.liveTitle = "Your deck is ready to go!";
    voo.setViz("help", "show");
    voo.setViz("menu", "hide");
    voo.liveHelp = SETUP_HELP_BYTES;
    return framedView(ctx, "setup", () => {
      const body = output([
        setupHiddenFields(ctx),
        str(fmt.renderView("name_formgroup")),
        accountFormgroups(ctx),
        `<div class="form-group button-form-group"><button name="button" type="submit" data-disable-with="Setting up" class="btn btn-primary">Set up</button></div>`,
      ]);
      const form = createCardBodyShell(ctx, { body });
      return form;
    });
  });
};

const signinEditView: ViewFn = (ctx) => {
  const voo = accountProbeSurface.signinEditVoo();
  if (ctx.voo.opts["title"] === undefined) ctx.voo.liveTitle = voo.title;
  ctx.voo.liveEditStructure = voo.editStructure.map((f: { name: string; title: string; view: string; skipPerms: boolean }) => [
    f.name, { title: f.title, view: f.view, skip_perms: f.skipPerms },
  ]);
  for (const hidden of voo.hide) ctx.voo.hide(hidden);
  return superView(ctx, setModuleShortname("self/signin"), "edit");
};

const setModules: ModSetModuleFile[] = [
  {
    setPath: "all/account",
    events: [
      engineOwnedEvent({ event: "generate_token" }),
      engineOwnedEvent({ event: "set_stamper", at: "prepare_to_validate" }),
    ],
  },
  { setPath: "all/password_input" },
  { setPath: "abstract/account_field" },
  {
    setPath: "abstract/account_holder",
    events: [
      engineOwnedEvent({
        event: "validate_account_holder_name_change",
        at: "validate",
        on: ["update"],
        changed: ["name"],
      }),
    ],
    formats: {
      html: {
        views: [
          { view: "closed_account", viewFn: closedAccountView },
          { view: "account_tab", viewFn: accountTabView },
        ],
      },
    },
  },
  { setPath: "right/account" },
  {
    setPath: "right/account/events",
    events: [
      engineOwnedEvent({
        event: "set_default_salt",
        at: "prepare_to_validate",
        on: ["create"],
      }),
      engineOwnedEvent({
        event: "set_default_status",
        at: "prepare_to_validate",
        on: ["create"],
      }),
      engineOwnedEvent({
        event: "reset_password",
        at: "prepare_to_validate",
        on: ["update"],
        trigger: "required",
      }),
      engineOwnedEvent({
        event: "verify_and_activate",
        at: "prepare_to_validate",
        on: ["update"],
        trigger: "required",
      }),
      event({
        event: "password_redirect",
        at: "finalize",
        on: ["update"],
        when: "password_redirect?",
        fn: (card) => ({ successAppend: { id: card.name, view: "edit" } }),
      }),
      engineOwnedEvent({ event: "send_password_reset_email", at: "integrate", trigger: "required" }),
      engineOwnedEvent({ event: "send_verification_email", at: "integrate", trigger: "required" }),
      engineOwnedEvent({ event: "send_welcome_email", at: "integrate", trigger: "required" }),
      engineOwnedEvent({ event: "activate_account" }),
      engineOwnedEvent({
        event: "delete_account",
        at: "prepare_to_validate",
        on: ["delete"],
      }),
      event({
        event: "signout_upon_delete",
        at: "integrate",
        on: ["delete"],
        when: "current_account?",
        fn: () => ({ signout: true }),
      }),
    ],
  },
  {
    setPath: "right/account/views",
    formats: {
      html: {
        views: [
          { view: "content_formgroups", viewFn: accountBeforeContentFormgroupsView },
          { view: "core", viewFn: accountCoreView },
          { view: "verify_url", viewFn: (ctx) => verifyUrlView(ctx), config: { cache: "never", denial: "blank" } },
          { view: "reset_password_url", viewFn: (ctx) => resetPasswordUrlView(ctx), config: { denial: "blank" } },
          { view: "token_days", viewFn: tokenDaysView },
          { view: "verify_days", viewFn: verifyDaysView },
          { view: "reset_password_days", viewFn: resetPasswordDaysView },
          { view: "token_expiry", viewFn: tokenExpiryView },
          { view: "closure", viewFn: closureView, config: { perms: "delete", wrap: "slot" } },
        ],
      },
    },
  },
  {
    setPath: "right/email",
    assignsType: "phrase",
    events: [
      engineOwnedEvent({ event: "validate_email", at: "validate", on: ["save"] }),
      engineOwnedEvent({
        event: "validate_unique_email",
        after: "validate_email",
        on: ["save"],
      }),
      engineOwnedEvent({ event: "downcase_email", at: "prepare_to_validate", on: ["save"] }),
    ],
  },
  {
    setPath: "right/password",
    assignsType: "phrase",
    events: [
      engineOwnedEvent({
        event: "encrypt_password",
        at: "store",
        on: ["save"],
        changed: ["content"],
      }),
      engineOwnedEvent({ event: "validate_password_length", at: "validate", on: ["save"] }),
      engineOwnedEvent({ event: "validate_password_chars", at: "validate", on: ["save"] }),
      engineOwnedEvent({
        event: "validate_password_present",
        at: "prepare_to_validate",
        on: ["update"],
      }),
    ],
    formats: {
      html: {
        views: [
          { view: "raw", viewFn: passwordRawView },
          { view: "core", viewFn: passwordCoreView },
          { view: "input", viewFn: passwordInputView },
        ],
      },
    },
  },
  { setPath: "right/roles" },
  {
    setPath: "right/salt",
    assignsType: "phrase",
    formats: {
      base: {
        views: [{ view: "raw", viewFn: saltRawView }],
      },
    },
  },
  {
    setPath: "right/status",
    assignsType: "phrase",
  },
  { setPath: "self/anonymous" },
  { setPath: "self/decko_bot" },
  { setPath: "self/role" },
  {
    setPath: "self/signin",
    events: [
      engineOwnedEvent({
        event: "send_reset_password_token",
        before: "signin",
        on: ["update"],
        trigger: "required",
      }),
      engineOwnedEvent({ event: "signin", at: "validate", on: ["update"] }),
      engineOwnedEvent({ event: "signin_success", after: "signin" }),
      engineOwnedEvent({ event: "signout", at: "validate", on: ["delete"] }),
    ],
    formats: {
      html: {
        views: [
          { view: "core", viewFn: (ctx) => signinCoreHtml(ctx), config: { cache: "never" } },
          { view: "open", viewFn: signinOpenView },
          { view: "open_content", viewFn: openContentView },
          { view: "one_line_content", viewFn: oneLineContentView },
          { view: "reset_password_success", viewFn: resetPasswordSuccessView },
          { view: "edit_buttons", viewFn: signinEditButtonsView },
          { view: "edit", viewFn: signinEditView },
        ],
      },
    },
  },
  {
    setPath: "type/role",
    formats: {
      html: {
        views: [
          { view: "link_with_checkbox", viewFn: linkWithCheckboxView, config: { cache: "never" } },
          { view: "configs", viewFn: roleConfigsView },
        ],
      },
    },
  },
  {
    setPath: "type/signup",
    events: [
      engineOwnedEvent({
        event: "auto_approve_with_verification",
        at: "validate",
        on: ["create"],
        when: "can_approve?",
      }),
      event({
        event: "approve_with_verification",
        at: "validate",
        on: ["update"],
        trigger: "required",
      }),
      engineOwnedEvent({
        event: "approve_without_verification",
        at: "validate",
        on: ["update"],
        trigger: "required",
      }),
      event({ event: "act_as_current_for_integrate_stage", at: "integrate", on: ["create"] }),
    ],
  },
  {
    setPath: "type/signup/views",
    formats: {
      html: {
        views: [
          { view: "new", viewFn: signupNewView, config: { cache: "never" } },
          { view: "new_buttons", viewFn: signupNewButtonsView, config: { cache: "never" } },
          { view: "content_formgroups", viewFn: signupContentFormgroupsView },
          { view: "core", viewFn: (ctx) => signupCoreHtml(ctx) },
        ],
      },
    },
  },
  {
    setPath: "type/user",
    events: [
      engineOwnedEvent({ event: "check_setup", before: "check_permissions", on: ["create"], trigger: "required" }),
      engineOwnedEvent({ event: "setup_first_user", at: "finalize", on: ["create"], when: "setup?" }),
      event({
        event: "signin_after_setup",
        at: "integrate",
        on: ["create"],
        when: "setup?",
      }),
    ],
    formats: {
      html: {
        methods: [{ name: "needs_setup?", fn: () => preparedSetupVerdict()?.open === true }],
        views: [{ view: "setup", viewFn: setupView, config: { cache: "never", unknown: true, perms: "needs_setup?" } }],
      },
    },
  },
  { setPath: "type_plus_right/cardtype/account" },
  {
    setPath: "type_plus_right/role/members",
    events: [event({ event: "update_role_cache", at: "finalize" })],
  },
  {
    setPath: "type_plus_right/user/email",
    virtual: true,
    formats: {
      html: {
        views: [{ view: "raw", viewFn: userEmailRawView }],
      },
    },
  },
];

export const accountModEventPredicates = {
  "can_approve?": (card: ModEventCard): boolean => card.canApprove === true,
  "setup?": (card: ModEventCard): boolean => card.setupApproved === true,
  "current_account?": (card: ModEventCard): boolean =>
    card.id !== undefined &&
    card.authCurrentId !== null &&
    card.authCurrentId !== undefined &&
    card.id === card.authCurrentId,
  "password_redirect?": (card: ModEventCard): boolean =>
    card.authCurrentId !== null &&
    card.authCurrentId !== undefined &&
    card.id !== undefined &&
    card.id === card.authCurrentId &&
    (card.password ?? "") === "",
} as const;

const cardModAccount: DeckoModManifest = {
  name: "account",
  gemName: "card-mod-account",
  group: "gem",
  setModules,
};

export default cardModAccount;
