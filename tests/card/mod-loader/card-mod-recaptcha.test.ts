

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createRenderTestStorage,
  seedCard,
  type RenderTestStorage,
} from "../render/render-test-storage.js";
import { ModLoader } from "../../../src/card/mod-loader.js";
import { HTML_VIEWS } from "../../../src/card/render/views.js";
import cardModRecaptcha, {
  RECAPTCHA_CARDIO_CONFIG_DEFAULTS,
  RECAPTCHA_DEFAULTS,
  RECAPTCHA_DEFAULT_ERROR,
  RECAPTCHA_DEPRECATED_CONFIG_NAMES,
  RECAPTCHA_ERROR_CODES,
  RECAPTCHA_SETTINGS_HELP_TEXT,
  captchaUsedTracker,
  handleRecaptchaConfigErrors,
  humanCheck,
  isRecaptchaSettingChild,
  recaptchaConfigIssuesMessage,
  recaptchaErrorMessages,
  recaptchaFieldContentError,
  recaptchaKeysPresent,
  recaptchaOn,
  recaptchaScriptUrl,
  recaptchaSettingValue,
  recaptchaTokenHtml,
  recaptchaSuccess,
  ruleToggle,
  usingDefaults,
  validateRecaptcha,
} from "../../../src/card/mod-loader/mods/card-mod-recaptcha.js";
import type { DeckoModManifest } from "../../../src/card/mod-loader.js";
import type { ViewContext, ViewFn } from "../../../src/card/render/format.js";
import cardModPermissions from "../../../src/card/mod-loader/mods/card-mod-permissions.js";

let storage: RenderTestStorage | undefined;

beforeAll(async () => {
  storage = await createRenderTestStorage();
  const s = storage;

  await seedCard(s, { id: 2, name: "RichText" });
  await seedCard(s, { id: 10, name: "*all", codename: "all", typeId: 13 });
  await seedCard(s, { id: 11, name: "*self", codename: "self", typeId: 14 });
  await seedCard(s, { id: 13, name: "*set", codename: "set", typeId: 13 });
  await seedCard(s, { id: 14, name: "*setting", codename: "setting", typeId: 14 });

  await seedCard(s, { id: 40, name: "site key", codename: "site_key" });
  await seedCard(s, { id: 41, name: "secret key", codename: "secret_key" });

  await seedCard(s, {
    id: 24539,
    name: "*recaptcha settings",
    codename: "recaptcha_settings",
    dbContent: "plain settings body",
  });

  await seedCard(s, {
    id: 42,
    leftId: 24539,
    rightId: 40,
    dbContent: "TEST-SITE-KEY_value",
  });
  await seedCard(s, {
    id: 43,
    leftId: 24539,
    rightId: 41,
    dbContent: "TEST-SECRET-KEY_value",
  });
}, 60_000);

afterAll(() => {
  storage?.close();
});

interface RecordedNest {
  name: string;
  syntax: string;
  view: string | undefined;
  title: string | undefined;
}

class RecordingFmt {
  readonly card = { name: { s: "*recaptcha settings" }, dbContent: "" };
  readonly nestCalls: RecordedNest[] = [];
  nest(opts: {
    name: string;
    syntax: string;
    options: { view?: string; title?: string; extra: Record<string, unknown> };
    comment: undefined;
  }): string {
    this.nestCalls.push({
      name: opts.name,
      syntax: opts.syntax,
      view: opts.options.view,
      title: opts.options.title,
    });
    return `[nested:${opts.name}|title:${opts.options.title ?? "-"}]`;
  }
}

function runCoreView(): { out: string; calls: RecordedNest[] } {
  const core = (cardModRecaptcha.setModules ?? []).find(
    (m) => m.setPath === "self/recaptcha_settings",
  )!.formats!.html!.views![0]!;
  const fmt = new RecordingFmt();
  const ctx = {
    fmt: fmt as unknown as ViewContext["fmt"],
    voo: {} as ViewContext["voo"],
  } as unknown as ViewContext;
  return { out: (core.viewFn as ViewFn)(ctx), calls: fmt.nestCalls };
}

describe("card-mod-recaptcha against the live engine", () => {
  it("WITHOUT the mod: :core is the real core view (the card's own content, no field nests)", async () => {
    const s = storage!;
    const html = await s.engine.render("*recaptcha settings", "core");
    expect(html).toContain("plain settings body");
    expect(html).not.toContain("TEST-SITE-KEY_value");
    expect(html).not.toContain("TEST-SECRET-KEY_value");
  });

  it("the field-nest targets resolve and render :titled (the children :core composes)", async () => {
    const s = storage!;

    const site = await s.engine.render("*recaptcha settings+site key", "titled");
    expect(site).toContain("titled-view");
    expect(site).toContain("TEST-SITE-KEY_value");
    const secret = await s.engine.render("*recaptcha settings+secret key", "titled");
    expect(secret).toContain("titled-view");
    expect(secret).toContain("TEST-SECRET-KEY_value");
  });

  it("the mod's :core body composes the two field nests' bytes in order", () => {

    const { out } = runCoreView();
    expect(out).toBe(
      "[nested:*recaptcha settings+site key|title:Site key]" +
        "[nested:*recaptcha settings+secret key|title:Secret key]",
    );
  });

  it("field_nest passes the field child name, the capitalized title, and NO view option (nesting.rb:27-31)", () => {
    const { calls } = runCoreView();
    expect(calls).toEqual([
      {
        name: "*recaptcha settings+site key",
        syntax: "{{*recaptcha settings+site key}}",
        view: undefined,
        title: "Site key",
      },
      {
        name: "*recaptcha settings+secret key",
        syntax: "{{*recaptcha settings+secret key}}",
        view: undefined,
        title: "Secret key",
      },
    ]);
  });
});

describe("card-mod-recaptcha manifest structure", () => {
  it("names + groups mirror the gem metadata (dirs.rb:144-150 shape)", () => {
    expect(cardModRecaptcha.name).toBe("recaptcha");
    expect(cardModRecaptcha.gemName).toBe("card-mod-recaptcha");
    expect(cardModRecaptcha.group).toBe("gem-defaults");
  });

  it("declares exactly the 8 set files the gem's set/ tree ships (compat-report setModules: 8)", () => {
    const paths = (cardModRecaptcha.setModules ?? []).map((m) => m.setPath);
    expect(paths).toEqual([
      "abstract/recaptcha_setting",
      "all/recaptcha",
      "right/captcha",
      "right/secret_key",
      "right/site_key",
      "self/admin",
      "self/captcha",
      "self/recaptcha_settings",
    ]);
  });

  it("set/self/recaptcha_settings.rb registers exactly one html view (:core, no view config)", () => {

    const setFile = (cardModRecaptcha.setModules ?? []).find(
      (m) => m.setPath === "self/recaptcha_settings",
    );
    expect(setFile?.formats?.["html"]?.views).toEqual([
      { view: "core", viewFn: expect.any(Function) },
    ]);
    expect(Object.keys(setFile?.formats ?? {})).toEqual(["html"]);
  });

  it("the event/include_set/assign_type-only files register no views (their ported semantics are the exports)", () => {
    const withViews = (cardModRecaptcha.setModules ?? []).filter(
      (m) => m.formats !== undefined,
    );
    expect(withViews.map((m) => m.setPath)).toEqual(["self/recaptcha_settings"]);
  });
});

describe("card-mod-recaptcha setting_opts (set/self/captcha.rb:1-5)", () => {
  it("carries the Ruby setting_opts verbatim: permission group, position 5, the help_text bytes", () => {
    const setFile = (cardModRecaptcha.setModules ?? []).find(
      (m) => m.setPath === "self/captcha",
    );
    expect(setFile?.settingOpts).toEqual({
      group: "permission",
      position: 5,
      ruleTypeEditable: false,
      helpText:
        "Anti-spam setting.  Requires non-signed-in users to complete " +
        "a [[http://decko.org/captcha|captcha]] before adding or " +
        "editing cards (where permitted).",
    });
  });

  it("registers *captcha into the permission group at slot 5, leaving Ruby's nil holes (setting.rb:101-110)", () => {

    const record = { ...HTML_VIEWS };
    const loader = new ModLoader([{ manifest: cardModRecaptcha }], record);
    loader.load();
    const permission = loader.settingsRegistry().groups.get("permission");
    expect(permission).toHaveLength(5);
    expect(permission?.[0]).toBeNull();
    expect(permission?.[1]).toBeNull();
    expect(permission?.[2]).toBeNull();
    expect(permission?.[3]).toBeNull();
    expect(permission?.[4]?.codename).toBe("captcha");
    const captcha = loader.settingsRegistry().findByCodename("captcha");
    expect(captcha?.group).toBe("permission");
    expect(captcha?.ruleTypeEditable).toBe(false);
    expect(captcha?.shortHelpText).toBeUndefined();
    expect(captcha?.rawHelpText).toContain("Anti-spam setting.");
  });

  it("composes with card-mod-permissions: *captcha lands AFTER *delete (positions 1-5 of the permission group)", () => {

    const record = { ...HTML_VIEWS };
    const loader = new ModLoader(
      [{ manifest: cardModPermissions }, { manifest: cardModRecaptcha }],
      record,
    );
    loader.load();
    const slots = loader.settingsRegistry().groups.get("permission") ?? [];
    expect(slots.map((entry) => entry?.codename ?? null)).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "captcha",
    ]);
  });
});

describe("card-mod-recaptcha through the mod loader", () => {
  it("the load report lists the one view, the one setting, and all 8 set modules", () => {
    const record = { ...HTML_VIEWS };
    const loader = new ModLoader([{ manifest: cardModRecaptcha }], record);
    const report = loader.load();
    expect(report.modNames).toEqual(["recaptcha"]);
    expect(report.registeredViews).toEqual(["core"]);
    expect(report.registeredSettings).toEqual(["captcha"]);
    expect(report.registeredSetModules).toHaveLength(8);
    for (const shortname of [
      "Abstract::RecaptchaSetting",
      "All::Recaptcha",
      "Right::Captcha",
      "Right::SecretKey",
      "Right::SiteKey",
      "Self::Admin",
      "Self::Captcha",
      "Self::RecaptchaSettings",
    ]) {
      expect(report.registeredSetModules).toContain(shortname);
    }
  });

  it("the set-module basket records every gem-tree module in the right bucket (registrar.rb:21-29)", () => {
    const record = { ...HTML_VIEWS };
    const loader = new ModLoader([{ manifest: cardModRecaptcha }], record);
    loader.load();
    const basket = loader.setModules();

    expect(basket.base.map((m) => m.shortname)).toContain("All::Recaptcha");

    expect(basket.abstract.map((m) => m.shortname)).toContain(
      "Abstract::RecaptchaSetting",
    );

    const nonbase = [...basket.nonbase.values()].flat().map((m) => m.shortname);
    for (const shortname of [
      "Right::Captcha",
      "Right::SecretKey",
      "Right::SiteKey",
      "Self::Admin",
      "Self::Captcha",
      "Self::RecaptchaSettings",
    ]) {
      expect(nonbase).toContain(shortname);
    }
    for (const module of [...basket.base, ...basket.abstract, ...[...basket.nonbase.values()].flat()]) {
      expect(module.modName).toBe("recaptcha");
    }
  });

  it("registers :core into the views record and reset restores the pre-load state", () => {
    const record = { ...HTML_VIEWS };
    const before = record["core"];
    const loader = new ModLoader([{ manifest: cardModRecaptcha }], record);
    loader.load();
    expect(record["core"]).toBeDefined();
    expect(record["core"]).not.toBe(before);
    expect(loader.viewConfigFor("core")).toBeUndefined();
    loader.reset();
    expect(record["core"]).toBe(before);
  });
});

describe("card-mod-recaptcha pure semantics: set/all/recaptcha.rb", () => {
  it("RECAPTCHA_ERROR_CODES mirrors recaptcha.rb:1-7 byte-for-byte", () => {
    expect(RECAPTCHA_ERROR_CODES).toEqual({
      "missing-input-secret": "secret parameter is missing",
      "invalid-input-secret": "secret parameter is invalid or malformed",
      "missing-input-response": "response parameter is missing",
      "invalid-input-response": "response parameter is invalid or malformed",
      "bad-request": "request is invalid or malformed",
    });
  });

  it("recaptchaErrorMessages maps known codes, passes unknown codes through (fetch(code, code)), and defaults when blank (recaptcha.rb:25-33)", () => {
    expect(recaptchaErrorMessages(["missing-input-secret", "bad-request"])).toEqual([
      "secret parameter is missing",
      "request is invalid or malformed",
    ]);
    expect(recaptchaErrorMessages(["timeout-or-duplicate"])).toEqual([
      "timeout-or-duplicate",
    ]);
    expect(recaptchaErrorMessages(["missing-input-secret", "novel-code"])).toEqual([
      "secret parameter is missing",
      "novel-code",
    ]);
    expect(recaptchaErrorMessages([])).toEqual([RECAPTCHA_DEFAULT_ERROR]);
    expect(recaptchaErrorMessages(undefined)).toEqual([RECAPTCHA_DEFAULT_ERROR]);
    expect(RECAPTCHA_DEFAULT_ERROR).toBe("Looks like you are not a human");
  });

  it("recaptchaSuccess requires success, the minimum score, and the action match (recaptcha.rb:35-39)", () => {
    const min = 0.5;
    expect(recaptchaSuccess({ success: true, score: 0.9, action: "edit" }, min, "edit")).toBe(
      true,
    );
    expect(recaptchaSuccess({ success: true, score: 0.5, action: "edit" }, min, "edit")).toBe(
      true,
    );
    expect(recaptchaSuccess({ success: true, score: 0.4, action: "edit" }, min, "edit")).toBe(
      false,
    );
    expect(recaptchaSuccess({ success: true, action: "edit" }, min, "edit")).toBe(false);
    expect(recaptchaSuccess({ success: true, score: "junk", action: "edit" }, min, "edit")).toBe(
      false,
    );
    expect(recaptchaSuccess({ success: true, score: 0.9, action: "signup" }, min, "edit")).toBe(
      false,
    );
    expect(recaptchaSuccess({ success: false, score: 0.9, action: "edit" }, min, "edit")).toBe(
      false,
    );
    expect(recaptchaSuccess({ success: true, score: 0.9, action: "edit" }, min, "edit")).toBe(
      true,
    );
  });

  it("recaptchaSuccess parses numeric-string scores the way to_f does (recaptcha.rb:37)", () => {
    const min = 0.5;
    expect(recaptchaSuccess({ success: true, score: "0.9", action: "edit" }, min, "edit")).toBe(
      true,
    );
    expect(recaptchaSuccess({ success: true, score: "0.9x", action: "edit" }, min, "edit")).toBe(
      true,
    );
  });

  it("recaptchaScriptUrl emits the api.js render URL (recaptcha.rb:85-87)", () => {
    expect(recaptchaScriptUrl("KEY-123")).toBe(
      "https://www.google.com/recaptcha/api.js?render=KEY-123",
    );
  });

  it("recaptchaTokenHtml emits the script tag + the hidden token field (recaptcha.rb:75-83)", () => {
    const html = recaptchaTokenHtml("edit", "KEY-123");
    expect(html).toContain(
      '<script src="https://www.google.com/recaptcha/api.js?render=KEY-123"></script>',
    );
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="recaptcha_token"');
    expect(html).toContain('id="recaptcha_token"');
    expect(html).toContain('value=""');
    expect(html).toContain('data-site-key="KEY-123"');
    expect(html).toContain('data-action="edit"');
    expect(html).toContain('class="_recaptcha-token"');
  });
});

describe("card-mod-recaptcha pure semantics: set/all/recaptcha.rb predicates", () => {
  it("ruleToggle is Card::Rule.toggle: to_s.strip == '1' (card-1.110.0 lib/card/rule.rb:11-13)", () => {
    expect(ruleToggle("1")).toBe(true);
    expect(ruleToggle(" 1 ")).toBe(true);
    expect(ruleToggle("0")).toBe(false);
    expect(ruleToggle("yes")).toBe(false);
    expect(ruleToggle("")).toBe(false);
    expect(ruleToggle(undefined)).toBe(false);
    expect(ruleToggle(null)).toBe(false);
  });

  it("recaptchaKeysPresent is the && under RUBY truthiness - blank strings are truthy (recaptcha.rb:46-48)", () => {
    expect(recaptchaKeysPresent("KEY", "SECRET")).toBe(true);
    expect(recaptchaKeysPresent("", "SECRET")).toBe(true);
    expect(recaptchaKeysPresent("KEY", "")).toBe(true);
    expect(recaptchaKeysPresent(undefined, "SECRET")).toBe(false);
    expect(recaptchaKeysPresent("KEY", undefined)).toBe(false);
    expect(recaptchaKeysPresent("KEY", false)).toBe(false);
  });

  it("recaptchaOn is the six-operand conjunction (recaptcha.rb:16-23)", () => {
    const base = {
      siteKey: "KEY",
      secretKey: "SECRET",
      envController: {},
      signedIn: false,
      alwaysOk: false,
      needsSetup: false,
      captchaRuleContent: "1",
    };
    expect(recaptchaOn(base)).toBe(true);
    expect(recaptchaOn({ ...base, siteKey: undefined })).toBe(false);
    expect(recaptchaOn({ ...base, envController: null })).toBe(false);
    expect(recaptchaOn({ ...base, signedIn: true })).toBe(false);
    expect(recaptchaOn({ ...base, alwaysOk: true })).toBe(false);
    expect(recaptchaOn({ ...base, needsSetup: true })).toBe(false);
    expect(recaptchaOn({ ...base, captchaRuleContent: "0" })).toBe(false);
    expect(recaptchaOn({ ...base, captchaRuleContent: undefined })).toBe(false);
  });

  it("humanCheck composes success -> human, failure -> the error messages (recaptcha.rb:9-14)", () => {
    expect(humanCheck({ success: true, score: 0.9, action: "edit" }, 0.5, "edit")).toEqual({
      human: true,
      errorMessages: [],
    });
    expect(
      humanCheck(
        { success: false, "error-codes": ["bad-request"] },
        0.5,
        "edit",
      ),
    ).toEqual({ human: false, errorMessages: ["request is invalid or malformed"] });
    expect(humanCheck({ success: false }, 0.5, "edit")).toEqual({
      human: false,
      errorMessages: ["Looks like you are not a human"],
    });
  });

  it("handleRecaptchaConfigErrors special-cases the two sentinel tokens (recaptcha.rb:57-66)", () => {
    expect(handleRecaptchaConfigErrors("grecaptcha-undefined")).toEqual({
      kind: "add-error",
      message: "needs correct v3 configuration",
    });
    expect(handleRecaptchaConfigErrors("recaptcha-token-field-missing")).toEqual({
      kind: "card-error",
      message: "recaptcha token field missing",
    });
    expect(handleRecaptchaConfigErrors("a-real-token")).toEqual({ kind: "proceed" });
    expect(handleRecaptchaConfigErrors(undefined)).toEqual({ kind: "proceed" });
    expect(handleRecaptchaConfigErrors("")).toEqual({ kind: "proceed" });
  });

  it("validateRecaptcha is the guarded conjunction (recaptcha.rb:68-72)", () => {
    expect(
      validateRecaptcha({
        captchaCodenameExists: true,
        isSupercard: false,
        captchaUsed: false,
        recaptchaOn: true,
      }),
    ).toBe(true);
    expect(
      validateRecaptcha({
        captchaCodenameExists: false,
        isSupercard: false,
        captchaUsed: false,
        recaptchaOn: true,
      }),
    ).toBe(false);
    expect(
      validateRecaptcha({
        captchaCodenameExists: true,
        isSupercard: true,
        captchaUsed: false,
        recaptchaOn: true,
      }),
    ).toBe(false);
    expect(
      validateRecaptcha({
        captchaCodenameExists: true,
        isSupercard: false,
        captchaUsed: true,
        recaptchaOn: true,
      }),
    ).toBe(false);
    expect(
      validateRecaptcha({
        captchaCodenameExists: true,
        isSupercard: false,
        captchaUsed: false,
        recaptchaOn: false,
      }),
    ).toBe(false);
  });
});

describe("card-mod-recaptcha pure semantics: set/self/captcha.rb state + set/self/recaptcha_settings.rb help text", () => {
  it("captchaUsedTracker mirrors the @captcha_used ivar (self/captcha.rb:7-13)", () => {
    const captcha = captchaUsedTracker();
    expect(captcha.isUsed()).toBe(false);
    captcha.markUsed();
    expect(captcha.isUsed()).toBe(true);
    const fresh = captchaUsedTracker();
    expect(fresh.isUsed()).toBe(false);
  });

  it("RECAPTCHA_SETTINGS_HELP_TEXT carries the raw_help_text bytes (recaptcha_settings.rb:2-8)", () => {
    expect(RECAPTCHA_SETTINGS_HELP_TEXT).toBe(
      "Register your domain at Google's " +
        "[[http://google.com/recaptcha|reCAPTCHA service]] " +
        "and enter your site key and secret key below.<br>" +
        "If you want to turn captchas off then change all " +
        "[[*captcha|captcha rules]] to 'no'.",
    );
    expect(RECAPTCHA_SETTINGS_HELP_TEXT).toContain("<br>");
    expect(RECAPTCHA_SETTINGS_HELP_TEXT).toContain("[[*captcha|captcha rules]]");
  });
});

describe("card-mod-recaptcha pure semantics: set/abstract/recaptcha_setting.rb", () => {
  it("recaptchaFieldContentError accepts keys, blanks, hyphens, underscores; rejects the rest (recaptcha_setting.rb:1-5)", () => {
    expect(recaptchaFieldContentError("6Lc3c-EoAAAAALnzfnHIWb5Rqy-rNui8l8qsguYG")).toBe(
      undefined,
    );
    expect(recaptchaFieldContentError("key_with-under_1")).toBe(undefined);
    expect(recaptchaFieldContentError("")).toBe(undefined);
    expect(recaptchaFieldContentError("invalid key")).toBe("invalid key");
    expect(recaptchaFieldContentError("bad!")).toBe("invalid key");
    expect(recaptchaFieldContentError("ünicode")).toBe("invalid key");
  });

  it("the ^...$ anchors are LINE anchors, matching Ruby's Onigmo semantics (oracle-pinned)", () => {

    expect(recaptchaFieldContentError("ok\nbad!")).toBe(undefined);
    expect(recaptchaFieldContentError("\nok\n")).toBe(undefined);
    expect(recaptchaFieldContentError("bad!\nalso bad!")).toBe("invalid key");
  });

  it("isRecaptchaSettingChild matches the :recaptcha_settings left codename only (recaptcha_setting.rb:11-13)", () => {
    expect(isRecaptchaSettingChild("recaptcha_settings")).toBe(true);
    expect(isRecaptchaSettingChild("captcha")).toBe(false);
    expect(isRecaptchaSettingChild(undefined)).toBe(false);
    expect(isRecaptchaSettingChild(null)).toBe(false);
  });
});

describe("card-mod-recaptcha pure semantics: config/late/recaptcha.rb + set/self/admin.rb", () => {
  it("RECAPTCHA_DEFAULTS carries the development-only keys (config/late/recaptcha.rb:20-23)", () => {
    expect(RECAPTCHA_DEFAULTS).toEqual({
      site_key: "6Lc3c-EoAAAAALnzfnHIWb5Rqy-rNui8l8qsguYG",
      secret_key: "6Lc3c-EoAAAAAEg9K_IAUNgx73eTbtBucCGnOQqf",
    });
  });

  it("RECAPTCHA_DEPRECATED_CONFIG_NAMES mirrors @deprecated (config/late/recaptcha.rb:16-19)", () => {
    expect(RECAPTCHA_DEPRECATED_CONFIG_NAMES).toEqual({
      site_key: "recaptcha_public_key",
      secret_key: "recaptcha_private_key",
    });
  });

  it("RECAPTCHA_CARDIO_CONFIG_DEFAULTS mirrors the Railtie defaults (lib/card/mod/recaptcha.rb:1-10, the compat report's 7 cardioConfigKeys)", () => {
    expect(RECAPTCHA_CARDIO_CONFIG_DEFAULTS).toEqual({
      recaptcha_public_key: null,
      recaptcha_private_key: null,
      recaptcha_proxy: null,
      recaptcha_site_key: null,
      recaptcha_secret_key: null,
      recaptcha_minimum_score: 0.5,
      recaptcha_verify_url: "https://www.google.com/recaptcha/api/siteverify",
    });
  });

  it("usingDefaults is the recaptcha_config_issues? check (config/late/recaptcha.rb:32-34 + self/admin.rb:3-5)", () => {
    expect(usingDefaults(RECAPTCHA_DEFAULTS.site_key)).toBe(true);
    expect(usingDefaults("CUSTOM_KEY")).toBe(false);
    expect(usingDefaults(undefined)).toBe(false);
    expect(usingDefaults(null)).toBe(false);
  });

  it("recaptchaSettingValue follows the card > config > deprecated > default precedence (config/late/recaptcha.rb:39-44)", () => {
    expect(recaptchaSettingValue("CARD", "CONFIG", "DEPRECATED")).toBe("CARD");
    expect(recaptchaSettingValue(undefined, "CONFIG", "DEPRECATED")).toBe("CONFIG");
    expect(recaptchaSettingValue(undefined, undefined, "DEPRECATED")).toBe("DEPRECATED");
    expect(recaptchaSettingValue(undefined, undefined, undefined)).toBe(
      RECAPTCHA_DEFAULTS.site_key,
    );
    expect(recaptchaSettingValue("", "CONFIG", "DEPRECATED")).toBe("CONFIG");
  });

  it("recaptchaSettingValue's default operand follows the setting - @defaults[setting] (config/late/recaptcha.rb:43)", () => {
    expect(
      recaptchaSettingValue(undefined, undefined, undefined, "site_key"),
    ).toBe("6Lc3c-EoAAAAALnzfnHIWb5Rqy-rNui8l8qsguYG");
    expect(
      recaptchaSettingValue(undefined, undefined, undefined, "secret_key"),
    ).toBe("6Lc3c-EoAAAAAEg9K_IAUNgx73eTbtBucCGnOQqf");
    expect(recaptchaSettingValue(undefined, undefined, undefined)).toBe(
      RECAPTCHA_DEFAULTS.site_key,
    );
  });

  it("recaptchaConfigIssuesMessage composes the localhost (temp) branch (self/admin.rb:10-14 + en.yml:4)", () => {
    const html = recaptchaConfigIssuesMessage({
      localhost: true,
      recaptchaLink: "<a>recaptcha keys</a>",
      captchaLink: "<a>*captcha</a>",
    });
    expect(html).toBe(
      "<p>Your captcha is currently working with temporary settings. This is fine for a local installation, but you will need new <a>recaptcha keys</a> if you want to make this site public.</p>",
    );
  });

  it("recaptchaConfigIssuesMessage composes the hosted (keys) branch with both links (self/admin.rb:16-20 + en.yml:3)", () => {
    const html = recaptchaConfigIssuesMessage({
      localhost: false,
      recaptchaLink: "<a>recaptcha keys</a>",
      captchaLink: "<a>*captcha</a>",
    });
    expect(html).toBe(
      "<p>You are configured to use <a>*captcha</a>, but for that to work you need new <a>recaptcha keys</a>.</p>",
    );
  });

  it("no i18n placeholder survives interpolation (the t() calls are fully consumed)", () => {
    const html = recaptchaConfigIssuesMessage({
      localhost: false,
      recaptchaLink: "R",
      captchaLink: "C",
    });
    expect(html).not.toContain("%{");
  });
});

describe("card-mod-recaptcha manifest typing", () => {
  it("is assignable to DeckoModManifest", () => {
    const manifest: DeckoModManifest = cardModRecaptcha;
    expect(manifest.name).toBe("recaptcha");
  });
});
