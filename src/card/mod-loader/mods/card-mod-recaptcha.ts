import type { ViewContext, ViewFn } from "../../render/format.js";
import { CardActionError } from "../../actions/types.js";
import type {
  DeckoModManifest,
  ModEventCard,
  ModEventFn,
  ModEventRegistration,
} from "../mod-manifest.js";
import type { ModEventContext } from "../mod-event-dispatch.js";

function event(
  decl: Omit<ModEventRegistration, "fn"> & { fn?: ModEventFn },
): ModEventRegistration {
  return { fn: () => undefined, ...decl };
}

export const RECAPTCHA_ERROR_CODES: Readonly<Record<string, string>> = {
  "missing-input-secret": "secret parameter is missing",
  "invalid-input-secret": "secret parameter is invalid or malformed",
  "missing-input-response": "response parameter is missing",
  "invalid-input-response": "response parameter is invalid or malformed",
  "bad-request": "request is invalid or malformed",
};

export const RECAPTCHA_DEFAULT_ERROR = "Looks like you are not a human";

export function recaptchaErrorMessages(
  errorCodes: readonly string[] | undefined | null,
): string[] {
  if (errorCodes !== undefined && errorCodes !== null && errorCodes.length > 0) {
    return errorCodes.map((code) => RECAPTCHA_ERROR_CODES[code] ?? code);
  }
  return [RECAPTCHA_DEFAULT_ERROR];
}

function rubyToF(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function recaptchaSuccess(
  result: { success?: unknown; score?: unknown; action?: unknown },
  minimumScore: number,
  action: string,
): boolean {
  if (!result.success) return false;
  if (rubyToF(result.score) < minimumScore) return false;
  return typeof result.action === "string" && result.action === action;
}

function rubyTruthy(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

export function ruleToggle(ruleContent: unknown): boolean {
  return String(ruleContent ?? "").trim() === "1";
}

export function recaptchaKeysPresent(
  siteKey: unknown,
  secretKey: unknown,
): boolean {
  return rubyTruthy(siteKey) && rubyTruthy(secretKey);
}

export function recaptchaOn(opts: {
  siteKey: unknown;
  secretKey: unknown;
  envController: unknown;
  signedIn: boolean;
  alwaysOk: boolean;
  needsSetup: boolean;
  captchaRuleContent: unknown;
}): boolean {
  return (
    recaptchaKeysPresent(opts.siteKey, opts.secretKey) &&
    rubyTruthy(opts.envController) &&
    !opts.signedIn &&
    !opts.alwaysOk &&
    !opts.needsSetup &&
    ruleToggle(opts.captchaRuleContent)
  );
}

export function humanCheck(
  result: { success?: unknown; score?: unknown; action?: unknown } & {
    "error-codes"?: readonly string[];
  },
  minimumScore: number,
  action: string,
): { human: boolean; errorMessages: string[] } {
  if (recaptchaSuccess(result, minimumScore, action)) {
    return { human: true, errorMessages: [] };
  }
  return {
    human: false,
    errorMessages: recaptchaErrorMessages(result["error-codes"]),
  };
}

export function handleRecaptchaConfigErrors(recaptchaToken: unknown): {
  kind: "add-error" | "card-error" | "proceed";
  message?: string;
} {
  if (recaptchaToken === "grecaptcha-undefined") {
    return { kind: "add-error", message: "needs correct v3 configuration" };
  }
  if (recaptchaToken === "recaptcha-token-field-missing") {
    return { kind: "card-error", message: "recaptcha token field missing" };
  }
  return { kind: "proceed" };
}

export function validateRecaptcha(opts: {
  captchaCodenameExists: boolean;
  isSupercard: boolean;
  captchaUsed: boolean;
  recaptchaOn: boolean;
}): boolean {
  if (!opts.captchaCodenameExists) return false;
  return !opts.isSupercard && !opts.captchaUsed && opts.recaptchaOn;
}

export function recaptchaScriptUrl(siteKey: string): string {
  return `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
}

export function recaptchaTokenHtml(action: string, siteKey: string): string {
  const script = `<script src="${recaptchaScriptUrl(siteKey)}"></script>`;
  const hidden =
    `<input type="hidden" name="recaptcha_token" id="recaptcha_token" value=""` +
    ` data-site-key="${siteKey}" data-action="${action}" class="_recaptcha-token" />`;
  return `${script}${hidden}`;
}

export function recaptchaFormOn(
  recaptchaOnOpts: Parameters<typeof recaptchaOn>[0],
  recaptchaOpt: unknown,
): boolean {
  return recaptchaOn(recaptchaOnOpts) && recaptchaOpt !== "off";
}

export function recaptchaFormHtmlAttrs(
  htmlAttrs: ReadonlyArray<readonly [string, string]>,
  formRecaptcha: boolean,
): Array<[string, string]> {
  const copy: Array<[string, string]> = htmlAttrs.map(
    ([key, value]) => [key, value] as [string, string],
  );
  if (!formRecaptcha) return copy;
  if (copy.some(([key]) => key === "data-recaptcha")) return copy;
  copy.push(["data-recaptcha", "on"]);
  return copy;
}

export function recaptchaHiddenFormTags(
  superTags: string,
  formRecaptcha: boolean,
  action: string,
  siteKey: string,
): string {
  if (!formRecaptcha) return superTags;
  return superTags + recaptchaTokenHtml(action, siteKey);
}

const RECAPTCHA_SETTING_CONTENT_PATTERN = /^[a-zA-Z0-9\-_]*$/m;

export function recaptchaFieldContentError(
  content: string,
): "invalid key" | undefined {
  return RECAPTCHA_SETTING_CONTENT_PATTERN.test(content)
    ? undefined
    : "invalid key";
}

export function isRecaptchaSettingChild(
  leftCodename: string | undefined | null,
): boolean {
  return leftCodename === "recaptcha_settings";
}

export const RECAPTCHA_DEPRECATED_CONFIG_NAMES: Readonly<{
  site_key: string;
  secret_key: string;
}> = {
  site_key: "recaptcha_public_key",
  secret_key: "recaptcha_private_key",
};

export interface RecaptchaDevelopmentDefaults {
  readonly site_key?: string;
  readonly secret_key?: string;
}

export const RECAPTCHA_CARDIO_CONFIG_DEFAULTS: Readonly<{
  recaptcha_public_key: null;
  recaptcha_private_key: null;
  recaptcha_proxy: null;
  recaptcha_site_key: null;
  recaptcha_secret_key: null;
  recaptcha_minimum_score: number;
  recaptcha_verify_url: string;
}> = {
  recaptcha_public_key: null,
  recaptcha_private_key: null,
  recaptcha_proxy: null,
  recaptcha_site_key: null,
  recaptcha_secret_key: null,
  recaptcha_minimum_score: 0.5,
  recaptcha_verify_url: "https://www.google.com/recaptcha/api/siteverify",
};

export function usingDefaults(
  siteKey: string | undefined | null,
  developmentDefault?: string,
): boolean {
  return siteKey === developmentDefault;
}

export function recaptchaSettingValue(
  cardValue: string | undefined | null,
  configValue: string | undefined | null,
  deprecatedValue: string | undefined | null,
  which: "site_key" | "secret_key" = "site_key",
  developmentDefaults?: RecaptchaDevelopmentDefaults,
): string | undefined {
  if (cardValue !== undefined && cardValue !== null && cardValue !== "") {
    return cardValue;
  }
  if (configValue !== undefined && configValue !== null && configValue !== "") {
    return configValue;
  }
  if (
    deprecatedValue !== undefined &&
    deprecatedValue !== null &&
    deprecatedValue !== ""
  ) {
    return deprecatedValue;
  }
  return developmentDefaults?.[which];
}

export const LOCALE = {
  recaptcha_link_text: "recaptcha keys",
  recaptcha_captcha_keys:
    "You are configured to use %{captcha_link}, but for that to work you need new %{recaptcha_link}.",
  recaptcha_captcha_temp:
    "Your captcha is currently working with temporary settings. This is fine for a local installation, but you will need new %{recaptcha_link} if you want to make this site public.",
} as const;

export function recaptchaConfigIssuesMessage(opts: {
  localhost: boolean;
  recaptchaLink: string;
  captchaLink: string;
}): string {
  const inner = opts.localhost
    ? LOCALE.recaptcha_captcha_temp.replace("%{recaptcha_link}", opts.recaptchaLink)
    : LOCALE.recaptcha_captcha_keys
        .replace("%{captcha_link}", opts.captchaLink)
        .replace("%{recaptcha_link}", opts.recaptchaLink);
  return `<p>${inner}</p>`;
}

export function captchaUsedTracker(): {
  isUsed(): boolean;
  markUsed(): void;
} {
  let captchaUsed: true | undefined = undefined;
  return {
    isUsed: () => captchaUsed !== undefined,
    markUsed: () => {
      captchaUsed = true;
    },
  };
}

export const RECAPTCHA_SETTINGS_HELP_TEXT =
  "Register your domain at Google's " +
  "[[http://google.com/recaptcha|reCAPTCHA service]] " +
  "and enter your site key and secret key below.<br>" +
  "If you want to turn captchas off then change all " +
  "[[*captcha|captcha rules]] to 'no'.";

function rubyCapitalize(name: string): string {
  return name === "" ? "" : name[0]!.toUpperCase() + name.slice(1).toLowerCase();
}

function fieldNest(ctx: ViewContext, field: string): string {
  const cardName = ctx.fmt.card.name.s;
  const fullName = `${cardName}+${field}`;
  return ctx.fmt.nest({
    syntax: `{{${fullName}}}`,
    name: fullName,
    options: { title: rubyCapitalize(field), extra: {} },
    comment: undefined,
  });
}

const recaptchaSettingsCoreView: ViewFn = (ctx) =>
  [fieldNest(ctx, "site key"), fieldNest(ctx, "secret key")].join("\n");

export function recaptchaSiteverifyGet(
  verifyUrl: string,
  query: { secret: string; response: string },
): Promise<string> {
  const enc = (value: string): string =>
    encodeURIComponent(value)
      .replace(/%20/g, "+")
      .replace(/!/g, "%21")
      .replace(/'/g, "%27")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/\*/g, "%2A");
  const qs = `secret=${enc(query.secret)}&response=${enc(query.response)}`;
  return fetch(`${verifyUrl}?${qs}`).then((res) => res.text());
}

export async function recaptchaEventFn(
  card: ModEventCard,
  _host: unknown,
  ctx: ModEventContext,
): Promise<void> {
  const rec = ctx.saveInput?.recaptcha;
  if (rec === undefined) return;
  const config = handleRecaptchaConfigErrors(rec.token);
  if (config.kind === "add-error") {
    throw new CardActionError(
      "recaptcha",
      config.message ?? "",
      `RECAPTCHA: ${config.message ?? ""}`,
      undefined,
      card.name,
    );
  }
  if (config.kind === "card-error") {
    throw new CardActionError(
      "recaptcha",
      config.message ?? "",
      `RECAPTCHA: ${config.message ?? ""}`,
      undefined,
      card.name,
    );
  }
  rec.markUsed();
  const body = await rec.verify(rec.guard.verifyUrl, {
    secret: String(rec.guard.secretKey ?? ""),
    response: rec.token ?? "",
  });
  const result = JSON.parse(body) as {
    success?: unknown;
    score?: unknown;
    action?: unknown;
    "error-codes"?: readonly string[];
  };
  const action = card.act?.action ?? "update";
  const verdict = humanCheck(result, rec.guard.minimumScore, action);
  if (!verdict.human) {
    throw new CardActionError(
      "recaptcha",
      verdict.errorMessages.join("\n"),
      `RECAPTCHA: ${verdict.errorMessages.join("\n")}`,
      undefined,
      card.name,
    );
  }
}

export const recaptchaModEventPredicates = {
  validate_recaptcha: (_card: ModEventCard, ctx?: ModEventContext): boolean => {
    const rec = ctx?.saveInput?.recaptcha;
    if (rec === undefined) return false;
    return validateRecaptcha({
      captchaCodenameExists: rec.guard.captchaCodenameExists,
      isSupercard: rec.guard.isSupercard,
      captchaUsed: rec.isUsed(),
      recaptchaOn: recaptchaOn({
        siteKey: rec.guard.siteKey,
        secretKey: rec.guard.secretKey,
        envController: rec.guard.envController,
        signedIn: rec.guard.signedIn,
        alwaysOk: rec.guard.alwaysOk,
        needsSetup: rec.guard.needsSetup,
        captchaRuleContent: rec.guard.captchaRuleContent,
      }),
    });
  },
  "recaptcha_setting?": (card: ModEventCard): boolean =>
    card.recaptchaSettingChild === true,
} as const;

export async function validateRecaptchaFieldFn(card: ModEventCard): Promise<void> {
  const message = recaptchaFieldContentError(card.dbContent ?? "");
  if (message !== undefined) {
    throw new CardActionError(
      "validation-failed",
      message,
      `CONTENT: ${message}`,
      { content: message },
      card.name,
    );
  }
}

const cardModRecaptcha: DeckoModManifest = {
  name: "recaptcha",
  gemName: "card-mod-recaptcha",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "abstract/recaptcha_setting",
      events: [
        event({
          event: "validate_recaptcha_field",
          at: "validate",
          when: "recaptcha_setting?",
          fn: validateRecaptchaFieldFn,
        }),
        event({ event: "set_recaptcha_site_key", at: "finalize", when: "recaptcha_setting?" }),
      ],
    },
    {
      setPath: "all/recaptcha",
      ruleSeeds: [
        { name: "*all+*captcha", content: "1" },
        { name: "signup+*type+*captcha", content: "1" },
      ],
      events: [
        {
          event: "recaptcha",
          at: "validate",
          when: "validate_recaptcha",
          fn: recaptchaEventFn,
        },
      ],
    },
    {
      setPath: "right/captcha",
      assignsType: "toggle",
    },
    {
      setPath: "right/secret_key",
    },
    {
      setPath: "right/site_key",
    },
    {
      setPath: "self/admin",
      basketWarnings: ["recaptcha_config_issues"],
    },
    {
      setPath: "self/captcha",
      settingOpts: {
        group: "permission",
        position: 5,
        ruleTypeEditable: false,
        helpText:
          "Anti-spam setting.  Requires non-signed-in users to complete " +
          "a [[http://decko.org/captcha|captcha]] before adding or " +
          "editing cards (where permitted).",
      },
    },
    {
      setPath: "self/recaptcha_settings",
      formats: {
        html: {
          views: [
            { view: "core", viewFn: recaptchaSettingsCoreView },
          ],
        },
      },
    },
  ],
};

export default cardModRecaptcha;
