import { applyFontAwesomeAssetConfiguration, fontAwesomeHeadTag, STOCK_FONT_AWESOME_TAG } from "../../render/font-awesome.js";
import { UnsupportedViewError, type ViewContext, type ViewFn } from "../../render/format.js";
import { applyDeploymentCssRevision } from "../../render/head-views.js";
import { attachmentUrl } from "../../render/views.js";
import { h } from "../../render/slot-html.js";
import { deckoRootUrl } from "../../render/deployment-follow-live-config.js";
import { serializerFollowsLive } from "../../render/deployment-follow-live-config.js";
import { DeckoName } from "../../name.js";
import { ruleNamesForCard } from "../../set-patterns/rule-names.js";
import { modAssetsGroupListHtml } from "./card-mod-assets.js";
import { ScriptCompressionError } from "../../assets/script-compressor.js";
import type { PatternCardInput } from "../../set-patterns/types.js";
import type {
  DeckoModManifest,
  ModEngineHost,
  ModEventFn,
} from "../mod-manifest.js";

function paramOrRuleCard(ctx: ViewContext, settingCodename: string) {
  const card = ctx.fmt.card;
  if (card.unknown === true) return undefined;
  const input: PatternCardInput = {
    name: card.name.s,
    id: card.id,
    typeId: card.typeId,
    typeName: card.typeName,
  };
  if (card.name.isCompound) {
    const leftKey = card.name.leftName?.key;
    const left =
      leftKey !== undefined ? ctx.fmt.engine.fetchRenderCard(leftKey) : undefined;
    input.leftTypeName = left?.typeName;
  }
  for (const candidate of ruleNamesForCard(input, `*${settingCodename}`)) {
    const record = ctx.fmt.engine.fetchRenderCard(candidate);
    if (record === undefined) continue;
    if (ctx.fmt.engine.isDenied(record)) continue;
    return record;
  }
  return undefined;
}

function assetOutputUrl(ctx: ViewContext, cardName: string): string | undefined {
  const outputCard = ctx.fmt.engine.fetchRenderCard(`${cardName}+*asset output`);
  const content = outputCard?.dbContent;
  if (content === undefined || content === "") return undefined;
  if (/^(?:https?:|\()/.test(content.trim())) {
    return attachmentUrl(content, undefined, undefined, ctx.fmt.engine.imageCdnHost);
  }
  return `/files/${content}`;
}

function rightIsScript(card: ViewContext["fmt"]["card"]): boolean {
  return card.name.isCompound && card.name.rightName?.key === "*script";
}

function leftTypeCode(ctx: ViewContext): string | undefined {
  const card = ctx.fmt.card;
  if (!card.name.isCompound) return undefined;
  const leftKey = card.name.leftName?.key;
  if (leftKey === undefined) return undefined;
  return ctx.fmt.engine.fetchRenderCard(leftKey)?.typeCode;
}

function renderCardView(ctx: ViewContext, name: string, view: string): string | undefined {
  const target = ctx.fmt.engine.fetchRenderCard(name);
  if (target === undefined) return undefined;
  return ctx.fmt.nestRecord(target, view);
}

const TRIGGER_SLOT_READY =
  "$('document').ready(function() { $('.card-slot').trigger('decko.slot.ready'); })";

function javascriptTag(content: string): string {
  return `<script>\n//<![CDATA[\n${content}\n//]]>\n</script>`;
}

function deckoScriptVariables(ctx: ViewContext): string {
  const lines: string[] = [];
  const rootUrl = deckoRootUrl() ?? `${ctx.fmt.engine.envOriginConfig?.() ?? ""}/`;
  lines.push(`decko.rootUrl='${rootUrl}';`);
  lines.push("decko.doubleClick='signed_in';");
  const styleRule = paramOrRuleCard(ctx, "style");
  if (styleRule !== undefined) {
    const cssPath = ctx.fmt.nestRecord(styleRule, "stylesheet_path");
    lines.push(`decko.cssPath='${applyDeploymentCssRevision(cssPath)}';`);
  }
  lines.push(`decko.signed_in=${ctx.fmt.engine.pageSession?.signedIn === true};`);
  return lines.join("\n") + "\n";
}

const scriptVariablesView: ViewFn = (ctx) => {
  return javascriptTag(deckoScriptVariables(ctx));
};

const javascriptTagsView: ViewFn = (ctx) => {
  const assetCard = paramOrRuleCard(ctx, "script");
  if (assetCard === undefined) return "";
  const parts: string[] = [];
  parts.push(ctx.fmt.nestRecord(assetCard, "remote_script_tags"));
  parts.push("<!-- MAIN DECKO JAVASCRIPT -->");
  const outputUrl = assetOutputUrl(ctx, assetCard.name.s);
  if (outputUrl !== undefined) {
    parts.push(`<script src="${h(outputUrl)}"></script>`);
  }
  return parts.join("\n");
};

function escapeJavascript(js: string): string {
  return js
    .replace(/\\/g, "\\\\")
    .replace(/<\//g, "<\\/")
    .replace(/\r\n/g, "\\n")
    .replace(/\r/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
}

const scriptCallsView: ViewFn = (ctx) => {
  const ace = ctx.fmt.engine.fetchRenderCard("*Ace")?.dbContent ?? "";
  const tinymce = ctx.fmt.engine.fetchRenderCard("*tinyMCE")?.dbContent ?? "";
  const configs = [
    `decko.setAceConfig('${escapeJavascript(ace)}')`,
    `decko.setTinyMCEConfig('${escapeJavascript(tinymce)}')`,
    TRIGGER_SLOT_READY,
  ].join("\n\n");
  return javascriptTag(configs);
};

const javascriptIncludeTagView: ViewFn = (ctx) => {
  const card = ctx.fmt.card;
  if (rightIsScript(card)) {
    const items = card.dbContent
      .split(/\n+/)
      .map((item) => item.replace(/\[\[|\]\]/g, "").trim())
      .filter((item) => item !== "");
    return items
      .map((item) => renderCardView(ctx, item, "javascript_include_tag") ?? "")
      .join("\n");
  }
  if (card.typeCode === "java_script" || card.typeCode === "coffee_script") {
    return `<script src="/${card.name.urlKey}.js"></script>`;
  }
  return `\n<!-- javascript_include_tag not overridden for ${card.name.s} -->\n`;
};

function remoteScriptTagsOfRuleCard(ctx: ViewContext): string {
  const card = ctx.fmt.card;
  const items = card.dbContent
    .split(/\n+/)
    .map((item) => item.replace(/\[\[|\]\]/g, "").trim())
    .filter((item) => item !== "");
  const parts: string[] = [];
  for (const item of items) {
    const tags = renderCardView(ctx, item, "remote_script_tags");
    if (tags === undefined || tags === "") continue;
    const left = DeckoName.parse(item).leftName?.s ?? item;
    parts.push(`<!-- ${left} (remote) -->\n${tags}`);
  }
  return parts.join("\n");
}

const MOD_REMOTE_SCRIPT_TAGS: Record<string, string[]> = {
  "mod: format": [
    `<script src="https://code.jquery.com/jquery-3.5.1.min.js" crossorigin="anonymous"></script>`,
    `<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-ujs/1.2.3/rails.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`,
  ],
  "mod: ace editor": [
    `<script src="https://cdnjs.cloudflare.com/ajax/libs/ace/1.18.0/ace.min.js" crossorigin="anonymous"></script>`,
  ],
  "mod: bootstrap": [
    `<script src="https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.6-rc.1/js/select2.full.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`,
    `<script src="https://kit.fontawesome.com/1366963381.js" crossorigin="anonymous"></script>`,
  ],
};

function remoteScriptTagsOfModCard(ctx: ViewContext): string {
  const card = ctx.fmt.card;
  const leftKey = card.name.leftName?.key;
  if (leftKey === undefined) return "";
  const groupRemote = ctx.fmt.engine.fetchRenderCard(`${leftKey}+*group remote`);
  const content = groupRemote?.dbContent;
  if (content !== undefined && content !== "") {
    return applyFontAwesomeAssetConfiguration(content
      .split("\n")
      .filter((src) => src !== "")
      .map((src) => `<script src="${src}"></script>`)
      .join("\n"), ctx.fmt.engine.fontAwesomeAssetMode);
  }
  const pinned = MOD_REMOTE_SCRIPT_TAGS[card.name.leftName?.s ?? ""];
  return pinned === undefined ? "" : pinned.join("\n").replace(STOCK_FONT_AWESOME_TAG, fontAwesomeHeadTag(ctx.fmt.engine.fontAwesomeAssetMode));
}

const remoteScriptTagsView: ViewFn = (ctx) => {
  const card = ctx.fmt.card;
  if (!rightIsScript(card)) {
    throw new UnsupportedViewError("remote_script_tags", card.name.s);
  }
  const leftCode = leftTypeCode(ctx);
  if (leftCode === "set") return remoteScriptTagsOfRuleCard(ctx);
  if (leftCode === "mod") return remoteScriptTagsOfModCard(ctx);
  throw new UnsupportedViewError("remote_script_tags", card.name.s);
};

export function scriptRuleSidesStatement(settingTypeId: number): {
  sql: string;
  params: unknown[];
} {
  return {
    sql:
      "WITH RECURSIVE reached(id) AS (\n" +
      "  SELECT rules.id\n" +
      "  FROM cards rules\n" +
      "    JOIN cards settings ON rules.right_id = settings.id\n" +
      "WHERE settings.type_id = ?\n" +
      "  AND settings.codename IN ('script', 'style')\n" +
      "  AND rules.trash = 0 AND settings.trash = 0\n" +
      "  UNION\n" +
      "  SELECT s.id FROM reached r\n" +
      "    JOIN cards j ON j.id = r.id AND j.trash = 0\n" +
      "    JOIN cards s ON s.id IN (j.left_id, j.right_id) AND s.id IS NOT NULL\n" +
      ")\n" +
      "SELECT c.* FROM cards c WHERE c.trash = 0 AND c.id IN (SELECT id FROM reached)",
    params: [settingTypeId],
  };
}

function scriptRuleChildrenStatement(settingTypeId: number): {
  sql: string;
  params: unknown[];
} {
  const base = scriptRuleSidesStatement(settingTypeId);
  const cte = base.sql.slice(0, base.sql.indexOf("SELECT c.* FROM cards"));
  return {
    sql:
      cte +
      "SELECT c.* FROM cards c\n" +
      "WHERE c.trash = 0 AND c.left_id IN (SELECT id FROM reached)",
    params: base.params,
  };
}

async function prepareScriptRules(host: ModEngineHost): Promise<void> {
  await host.codenames.ensureLoaded();
  const settingTypeId = host.codenames.peekId("setting");
  if (settingTypeId === undefined) return;
  const results = await host.batch([
    scriptRuleSidesStatement(settingTypeId),
    scriptRuleChildrenStatement(settingTypeId),
  ]);
  const rows: Record<string, unknown>[] = [];
  for (const result of results) {
    const resultRows = (result as { rows: Record<string, unknown>[] } | undefined)?.rows ?? [];
    rows.push(...resultRows);
  }
  if (rows.length > 0) await host.composeAndCacheRows(rows);
  for (const name of ["*Ace", "*tinyMCE"]) {
    const record = (await host.fetchByName?.(name)) as { id?: number | null } | null | undefined;
    if (record !== undefined && record !== null && record.id !== undefined && record.id !== null) {
      await host.cacheFetchedRecord(record);
    }
  }
}

function modScriptModname(ctx: ViewContext): string {
  const leftKey = ctx.fmt.card.name.leftName?.key ?? "";
  return leftKey.replace(/^mod_/, "");
}

const MOD_SCRIPT_GROUPS: Record<
  string,
  ReadonlyArray<readonly [string, readonly string[]]>
> = {
  format: [
    [
      "group: remote",
      [
        "https://code.jquery.com/jquery-3.5.1.min.js",
        "https://cdnjs.cloudflare.com/ajax/libs/jquery-ujs/1.2.3/rails.min.js",
      ],
    ],
    [
      "group: jquery",
      [
        "jquery-ui.min.js",
        "jquery.ui.autocomplete.html.js",
        "jquery.autosize.js",
        "jquery.fileupload.js",
        "jquery.iframe-transport.js",
      ],
    ],
    [
      "group: decko",
      [
        "decko.js.coffee",
        "decko_jquery.js.coffee",
        "slot.js.coffee",
        "slotter.js.coffee",
        "slot_ready.js.coffee",
        "clicks_and_hovers.js.coffee",
      ],
    ],
  ],
};

const modScriptGroupCoreView: ViewFn = (ctx) => {
  const groups = MOD_SCRIPT_GROUPS[modScriptModname(ctx)];
  if (groups === undefined) return "";
  return modAssetsGroupListHtml(groups);
};

const compressedView: ViewFn = (ctx) => {
  const core = ctx.fmt.renderRaw();
  let js = core;
  if (ctx.fmt.engine.compressAssets?.() === true) {
    const compress = ctx.fmt.engine.scriptCompressor;
    if (compress === undefined) {
      throw new ScriptCompressionError(
        ctx.fmt.card.name.s,
        new Error(
          "compress_assets is on and this host has no script compressor configured (the scriptCompressor engine option)",
        ),
      );
    }
    try {
      js = compress(core);
    } catch (e) {
      throw new ScriptCompressionError(ctx.fmt.card.name.s, e);
    }
  }
  return `// ${ctx.fmt.card.name.s}\n${js}`;
};

const validateSyntaxField = "content";

const validateCoffeescriptSyntaxFn: ModEventFn = (card, _host) => {
  void validateSyntaxField;
  void card;
};

const validateJavascriptSyntaxFn: ModEventFn = () => {};

function passiveSetModule(setPath: string): {
  setPath: string;
  formats: { html: { views: [] } };
} {
  return { setPath, formats: { html: { views: [] } } };
}

const cardModScript: DeckoModManifest = {
  name: "script",
  gemName: "card-mod-script",
  group: "gem-defaults",
  setModules: [
    {
      setPath: "abstract/00_script",
      formats: {
        js: {
          views: [
            { view: "compressed", viewFn: compressedView },
          ],
        },
        html: {
          views: [
            {
              view: "javascript_include_tag",
              viewFn: javascriptIncludeTagView,
              config: { unknown: true, cache: "never", perms: "none" },
            },
          ],
        },
      },
    },
    passiveSetModule("abstract/01_asset_script"),
    passiveSetModule("abstract/01_java_script"),
    passiveSetModule("abstract/02_coffee_script"),
    passiveSetModule("abstract/03_asset_java_script"),
    passiveSetModule("abstract/04_asset_coffee_script"),
    passiveSetModule("abstract/script_group"),
    {
      setPath: "all/head_javascript",
      formats: {
        html: {
          views: [
            {
              view: "script_variables",
              viewFn: scriptVariablesView,
              config: { unknown: true, cache: "never", perms: "none" },
            },
            {
              view: "javascript_tags",
              viewFn: javascriptTagsView,
              config: { unknown: true, cache: "force", perms: "none" },
            },
            {
              view: "script_calls",
              viewFn: scriptCallsView,
              config: { unknown: true, perms: "none" },
            },
            {
              view: "javascript_include_tag",
              viewFn: javascriptIncludeTagView,
              config: { unknown: true, cache: "never", perms: "none" },
            },
          ],
        },
      },
    },
    {
      setPath: "right/script",
      formats: {
        html: {
          views: [
            {
              view: "javascript_include_tag",
              viewFn: javascriptIncludeTagView,
              config: { unknown: true, cache: "never", perms: "none" },
            },
          ],
        },
      },
    },
    {
      setPath: "self/script",
      settingOpts: {
        group: "webpage",
        position: 5,
      },
    },
    {
      setPath: "type/coffee_script",
      events: [
        {
          event: "validate_coffeescript_syntax",
          at: "validate",
          on: ["save"],
          changed: ["type_id", "content"],
          fn: validateCoffeescriptSyntaxFn,
        },
      ],
    },
    {
      setPath: "type/java_script",
      events: [
        {
          event: "validate_javascript_syntax",
          at: "validate",
          on: ["save"],
          changed: ["type_id", "content"],
          fn: validateJavascriptSyntaxFn,
        },
      ],
    },
    passiveSetModule("type/local_script_folder_group"),
    passiveSetModule("type/local_script_manifest_group"),
    {
      setPath: "type_plus_right/mod/script",
      formats: {
        html: {
          views: [
            { view: "remote_script_tags", viewFn: remoteScriptTagsView },
            { view: "core", viewFn: modScriptGroupCoreView },
          ],
        },
      },
    },
    {
      setPath: "type_plus_right/set/script",
      formats: {
        html: {
          views: [
            { view: "remote_script_tags", viewFn: remoteScriptTagsView },
          ],
        },
      },
    },
  ],
  prepareEngine: prepareScriptRules,
};

export default cardModScript;
